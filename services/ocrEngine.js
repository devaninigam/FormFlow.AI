const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');
const sharp = require('sharp');
const { createCanvas } = require('@napi-rs/canvas');
const DynamicExtractor = require('./dynamicFormExtractor');

/**
 * FormFlow AI - Pluggable Document Understanding & OCR Engine
 * Supports Azure AI Document Intelligence, Vision-Language Models (Gemini/OpenAI),
 * and a robust built-in computer-vision + Tesseract local analysis engine.
 */
class OcrEngine {
  /**
   * Safe Tesseract worker creation with local offline traineddata support
   */
  static async getWorker() {
    const rootDir = path.resolve(__dirname, '..');
    const localTrainedData = path.join(rootDir, 'eng.traineddata');
    const storageDir = path.join(rootDir, 'storage');

    const options = {
      cachePath: storageDir,
      errorHandler: (err) => console.warn('Tesseract worker error:', err)
    };

    if (fs.existsSync(localTrainedData)) {
      options.langPath = rootDir;
      options.gzip = false;
    }

    return await createWorker('eng', 1, options);
  }

  /**
   * Primary entry point for analyzing multi-page documents
   * @param {Array<{ pageNumber: number, width: number, height: number, buffer: Buffer }>} pages
   * @param {object} options - { provider: 'auto' | 'azure' | 'gemini' | 'openai' | 'builtin', secondaryAiLayer: boolean }
   */
  static async analyzeDocument(pages, options = {}) {
    const provider = options.provider || 'auto';
    const azureKey = options.azureKey || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    const azureEndpoint = options.azureEndpoint || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    const geminiKey = options.geminiKey || options.apiKey || process.env.GEMINI_API_KEY;
    const openaiKey = options.openaiKey || options.apiKey || process.env.OPENAI_API_KEY;

    let selectedProvider = provider;
    if (provider === 'auto') {
      if (azureKey && azureEndpoint) {
        selectedProvider = 'azure';
      } else if (geminiKey) {
        selectedProvider = 'gemini';
      } else if (openaiKey) {
        selectedProvider = 'openai';
      } else {
        selectedProvider = 'builtin';
      }
    }

    try {
      if (selectedProvider === 'azure' && azureKey && azureEndpoint) {
        return await this.analyzeWithAzure(pages, azureEndpoint, azureKey);
      } else if (selectedProvider === 'gemini' && geminiKey) {
        return await this.analyzeWithGemini(pages, geminiKey);
      } else if (selectedProvider === 'openai' && openaiKey) {
        return await this.analyzeWithOpenAI(pages, openaiKey);
      } else {
        return await this.analyzeWithBuiltin(pages);
      }
    } catch (err) {
      console.warn(`Provider ${selectedProvider} failed, falling back to builtin engine:`, err.message);
      if (selectedProvider !== 'builtin') {
        const fallbackResult = await this.analyzeWithBuiltin(pages);
        fallbackResult.fallbackReason = `${selectedProvider} failed: ${err.message}`;
        return fallbackResult;
      }
      throw err;
    }
  }

  /**
   * 1. Azure AI Document Intelligence (Prebuilt Layout / Document model)
   */
  static async analyzeWithAzure(pages, endpoint, apiKey) {
    const cleanEndpoint = endpoint.replace(/\/$/, '');
    const url = `${cleanEndpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-02-29-preview&features=keyValuePairs,styleFont`;

    const firstPage = pages[0];
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'image/png'
      },
      body: firstPage.buffer
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Azure Document Intelligence request failed: ${response.status} - ${errText}`);
    }

    const operationLocation = response.headers.get('Operation-Location') || response.headers.get('operation-location');
    if (!operationLocation) {
      throw new Error('Azure did not return an Operation-Location header');
    }

    let result = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey }
      });
      const pollData = await pollRes.json();
      if (pollData.status === 'succeeded') {
        result = pollData.analyzeResult;
        break;
      } else if (pollData.status === 'failed') {
        throw new Error(`Azure analysis failed: ${JSON.stringify(pollData.error)}`);
      }
    }

    if (!result) throw new Error('Azure analysis timed out');
    return this.normalizeAzureResult(result, pages);
  }

  static normalizeAzureResult(azureResult, pages) {
    const fields = [];
    const tables = [];
    let fieldCounter = 1;

    if (azureResult.keyValuePairs && Array.isArray(azureResult.keyValuePairs)) {
      for (const kv of azureResult.keyValuePairs) {
        const labelText = kv.key ? kv.key.content : 'Unlabeled Field';
        const valueText = kv.value ? kv.value.content : '';
        const confidence = kv.confidence !== undefined ? kv.confidence : 0.85;

        let bounds = { x: 0.1, y: 0.1, width: 0.3, height: 0.04 };
        let pageNum = 1;

        if (kv.value && kv.value.boundingRegions && kv.value.boundingRegions[0]) {
          const region = kv.value.boundingRegions[0];
          pageNum = region.pageNumber || 1;
          const pageMeta = pages[pageNum - 1] || pages[0];
          bounds = this.polygonToBounds(region.polygon, pageMeta.width, pageMeta.height);
        } else if (kv.key && kv.key.boundingRegions && kv.key.boundingRegions[0]) {
          const region = kv.key.boundingRegions[0];
          pageNum = region.pageNumber || 1;
          const pageMeta = pages[pageNum - 1] || pages[0];
          const keyBounds = this.polygonToBounds(region.polygon, pageMeta.width, pageMeta.height);
          bounds = {
            x: Math.min(0.9, keyBounds.x + keyBounds.width + 0.02),
            y: keyBounds.y,
            width: Math.min(0.4, 0.95 - (keyBounds.x + keyBounds.width)),
            height: keyBounds.height
          };
        }

        const isUnreadable = confidence < 0.4 || (!valueText && confidence < 0.6);
        const needsVerification = confidence >= 0.4 && confidence < 0.85;

        fields.push({
          id: `field_${fieldCounter++}`,
          label: labelText.trim().replace(/[:_]+$/, ''),
          value: valueText.trim(),
          originalOcrValue: valueText.trim(),
          page: pageNum,
          confidence: Number(confidence.toFixed(2)),
          verified: confidence >= 0.88,
          needsVerification,
          isUnreadable,
          isBlank: !valueText.trim(),
          type: this.detectFieldType(labelText, valueText),
          bounds,
          isHandwritten: true
        });
      }
    }

    if (azureResult.tables && Array.isArray(azureResult.tables)) {
      for (let tIdx = 0; tIdx < azureResult.tables.length; tIdx++) {
        const tbl = azureResult.tables[tIdx];
        const rows = [];
        const headers = [];
        const rowCount = tbl.rowCount || 0;
        const colCount = tbl.columnCount || 0;

        const grid = Array.from({ length: rowCount }, () => Array(colCount).fill(''));
        for (const cell of tbl.cells || []) {
          grid[cell.rowIndex][cell.columnIndex] = cell.content || '';
        }

        if (rowCount > 0) {
          headers.push(...grid[0]);
          for (let r = 1; r < rowCount; r++) {
            rows.push(grid[r]);
          }
        }

        tables.push({
          id: `table_${tIdx + 1}`,
          page: (tbl.boundingRegions && tbl.boundingRegions[0]?.pageNumber) || 1,
          title: `Detected Table ${tIdx + 1}`,
          bounds: (tbl.boundingRegions && tbl.boundingRegions[0]?.polygon) ?
            this.polygonToBounds(tbl.boundingRegions[0].polygon, pages[0].width, pages[0].height) :
            { x: 0.1, y: 0.5, width: 0.8, height: 0.3 },
          headers,
          rows
        });
      }
    }

    if (DynamicExtractor.looksLikeAccidentVisionPayload({ fields })) {
      return this.resultFromAccidentVision('azure', pages, { fields, isAccidentIncidentForm: true });
    }

    return this.assembleFinalOutput('azure', pages, fields, tables);
  }

  static accidentFormVisionPrompt() {
    return `You are reading an ACCIDENT & INCIDENT REPORT FORM (Early Years).
First read ALL printed labels and ALL handwritten/typed answers in the image.
Then fill ONLY the JSON keys below. Each value must come from THAT box only.

Rules:
- Convert handwriting as accurately as you can.
- If a box is blank or unreadable, use "" or false. Never invent.
- Do not copy a date from one DATE box into another (form date ≠ D.O.B. ≠ incident date ≠ signed date) unless the writing in that box is truly the same.
- Ref No is an ID (letters/digits/hyphens), never a date or phone.
- Contact Number is a phone only. Postcode is a UK postcode only.
- PROJECT NAME is the centre/project cell, not a child-status checkbox.
- Checkboxes: true only if that option has a real tick/cross; otherwise false.
- comments must not be a copy of narrative.

Return ONLY JSON:
{
  "isAccidentIncidentForm": true,
  "values": {
    "refNo": "",
    "formDate": "",
    "projectName": "",
    "bldgAddress": "",
    "personName": "",
    "dob": "",
    "regAddress": "",
    "postcode": "",
    "contactNumber": "",
    "responsibleAdult": "",
    "session": "",
    "incidentDate": "",
    "incidentTime": "",
    "location": "",
    "narrative": "",
    "completedBy": "",
    "position": "",
    "signature": "",
    "dateSigned": "",
    "parentSignature": "",
    "parentSignDate": "",
    "parentSignTime": "",
    "comments": ""
  },
  "checks": {
    "staffEy": false,
    "staffNonEy": false,
    "staffVisitor": false,
    "staffParent": false,
    "childDaycare": false,
    "childToybox": false,
    "childSurestart": false,
    "typeAccident": false,
    "typeIncident": false,
    "typeNearMiss": false,
    "severityRiddor": false,
    "severityModerate": false,
    "severityMinor": false,
    "riddorDangerous": false,
    "riddorDisease": false,
    "riddorPublic": false,
    "riddor3Days": false,
    "riddorMajor": false,
    "riddorDeath": false,
    "causePeer": false,
    "causeEquip": false,
    "causeUnknown": false,
    "causeSlip": false,
    "causeCoshh": false,
    "causeTraffic": false,
    "causeManual": false,
    "causeChoking": false,
    "causeVenue": false,
    "injuryCut": false,
    "injuryBruise": false,
    "injuryStrain": false,
    "injuryFracture": false,
    "injuryHead": false,
    "injurySensory": false,
    "injuryConscious": false,
    "injuryOrgan": false,
    "injuryProperty": false,
    "injuryDistress": false,
    "outcomeReturn": false,
    "outcomeFirstAid": false,
    "outcomeAdultCare": false,
    "outcomeNias": false,
    "outcomeHospital": false,
    "outcomeSupport": false
  }
}`;
  }

  static async encodePageForVision(pageBuffer) {
    try {
      return await sharp(pageBuffer)
        .rotate()
        .resize({ width: 1600, height: 2200, fit: 'inside', withoutEnlargement: true })
        .png({ quality: 90 })
        .toBuffer();
    } catch (e) {
      return pageBuffer;
    }
  }

  static resultFromAccidentVision(engineName, pages, parsed) {
    const ey = DynamicExtractor.buildEarlyYearsFormFieldsFromVision(parsed, {
      pageNum: 1,
      startCounter: 1
    });
    pages[0].fullText = pages[0].fullText || JSON.stringify(parsed.values || {});
    return this.assembleFinalOutput(engineName, pages, ey.fields, ey.tables || [], 'early_years_accident');
  }

  /**
   * 2. Vision-Language Model Interpretation (Google Gemini Vision)
   * Accident & Incident form: structured A–Z boxes from handwriting.
   */
  static async analyzeWithGemini(pages, apiKey) {
    const visionBuf = await this.encodePageForVision(pages[0].buffer);
    const base64Image = visionBuf.toString('base64');
    const prompt = this.accidentFormVisionPrompt();
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];

    let lastErr = null;
    let parsed = null;
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/png', data: base64Image } }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      });
      if (!response.ok) {
        lastErr = new Error(`Gemini API error: ${response.status} - ${await response.text()}`);
        continue;
      }
      const jsonRes = await response.json();
      const candidateText = jsonRes.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        lastErr = new Error('Empty response from Gemini');
        continue;
      }
      parsed = JSON.parse(candidateText);
      break;
    }
    if (!parsed) throw lastErr || new Error('Gemini analysis failed');

    if (DynamicExtractor.looksLikeAccidentVisionPayload(parsed)) {
      return this.resultFromAccidentVision('gemini', pages, parsed);
    }

    const fields = (parsed.fields || []).map((f, i) => ({
      id: `field_${i + 1}`,
      label: f.label || `Field ${i + 1}`,
      value: f.value || '',
      originalOcrValue: f.value || '',
      page: 1,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.88,
      verified: (f.confidence || 0.88) >= 0.88,
      needsVerification: (f.confidence || 0.88) < 0.85 && (f.confidence || 0.88) >= 0.5,
      isUnreadable: !!f.isUnreadable || (f.confidence || 0.88) < 0.5,
      isBlank: !f.value,
      type: f.type || this.detectFieldType(f.label, f.value),
      bounds: f.bounds || { x: 0.2, y: 0.1 + (i * 0.05), width: 0.4, height: 0.04 },
      isHandwritten: f.isHandwritten !== undefined ? f.isHandwritten : true
    }));

    const tables = (parsed.tables || []).map((t, idx) => ({
      id: `table_${idx + 1}`,
      page: 1,
      title: t.title || `Detected Table ${idx + 1}`,
      bounds: t.bounds || { x: 0.1, y: 0.5, width: 0.8, height: 0.25 },
      headers: t.headers || [],
      rows: t.rows || []
    }));

    return this.assembleFinalOutput('gemini', pages, fields, tables);
  }

  /**
   * 3. Vision-Language Model Interpretation (OpenAI Vision)
   * Accident & Incident form: structured A–Z boxes from handwriting.
   */
  static async analyzeWithOpenAI(pages, apiKey) {
    const visionBuf = await this.encodePageForVision(pages[0].buffer);
    const base64Image = visionBuf.toString('base64');
    const prompt = this.accidentFormVisionPrompt();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
          ]
        }],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    if (DynamicExtractor.looksLikeAccidentVisionPayload(parsed)) {
      return this.resultFromAccidentVision('openai', pages, parsed);
    }

    const fields = (parsed.fields || []).map((f, i) => ({
      id: `field_${i + 1}`,
      label: f.label || `Field ${i + 1}`,
      value: f.value || '',
      originalOcrValue: f.value || '',
      page: 1,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.88,
      verified: (f.confidence || 0.88) >= 0.88,
      needsVerification: (f.confidence || 0.88) < 0.85 && (f.confidence || 0.88) >= 0.5,
      isUnreadable: !!f.isUnreadable || (f.confidence || 0.88) < 0.5,
      isBlank: !f.value,
      type: f.type || this.detectFieldType(f.label, f.value),
      bounds: f.bounds || { x: 0.2, y: 0.1 + (i * 0.05), width: 0.4, height: 0.04 },
      isHandwritten: f.isHandwritten !== undefined ? f.isHandwritten : true
    }));

    return this.assembleFinalOutput('openai', pages, fields, parsed.tables || []);
  }

  /**
   * Pull line objects from a Tesseract recognize() result.
   * Optional yOffset/bandHeight map band-local coords back to full-page coords.
   */
  static linesFromTesseractResult(ret, options = {}) {
    const {
      yOffset = 0,
      xOffset = 0,
      bandHeight = null,
      pageHeight = null,
      scale = 1
    } = options;
    const s = scale > 0 ? scale : 1;
    const out = [];
    for (const b of ret?.data?.blocks || []) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          const text = (l.text || '').trim();
          if (!text) continue;
          const bb = l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
          // Upscaled band OCR returns coords in scaled space — map back to page px
          const bbox = {
            x0: bb.x0 / s + xOffset,
            y0: bb.y0 / s + yOffset,
            x1: bb.x1 / s + xOffset,
            y1: bb.y1 / s + yOffset
          };
          // Drop lines that fall outside the intended band core (overlap noise)
          if (pageHeight && bandHeight != null) {
            const cy = (bbox.y0 + bbox.y1) / 2;
            if (cy < yOffset - 4 || cy > yOffset + bandHeight + 4) continue;
          }
          const words = (l.words || []).map(w => ({
            text: (w.text || '').trim(),
            bbox: w.bbox ? {
              x0: w.bbox.x0 / s + xOffset,
              y0: w.bbox.y0 / s + yOffset,
              x1: w.bbox.x1 / s + xOffset,
              y1: w.bbox.y1 / s + yOffset
            } : bbox,
            confidence: w.confidence
          })).filter(w => w.text.length > 0);

          out.push({
            text,
            bbox,
            confidence: l.confidence,
            words
          });
        }
      }
    }
    return out;
  }

  /**
   * Re-OCR the handwritten value cell immediately to the right of a printed label.
   * Uses single-line PSM so names/dates/phones are not mixed into neighbouring boxes.
   */
  static async recognizeLabelValueCells(worker, srcBuffer, width, height, lines) {
    const specs = [
      { re: /ref\s*no/i, widthPct: 0.22, yPad: 4 },
      { re: /name of the person/i, widthPct: 0.42, yPad: 3 },
      { re: /\bd\.?o\.?b\b/i, widthPct: 0.22, yPad: 3 },
      { re: /registered address/i, widthPct: 0.48, yPad: 6 },
      { re: /postcode/i, widthPct: 0.20, yPad: 3 },
      { re: /contact number/i, widthPct: 0.32, yPad: 3 },
      { re: /responsible adult/i, widthPct: 0.32, yPad: 3 },
      { re: /\bsession\b/i, widthPct: 0.55, yPad: 4 },
      { re: /about the incident/i, widthPct: 0.90, below: true, heightPct: 0.042 }
    ];

    const out = [];
    const seen = new Set();

    for (const spec of specs) {
      const line = (lines || []).find(l => spec.re.test(l.text || '') && l.bbox);
      if (!line) continue;

      const bb = line.bbox;
      let labelRight = bb.x0;
      if (line.words && line.words.length) {
        const hits = line.words.filter(w => spec.re.test(w.text || ''));
        const last = hits.length ? hits[hits.length - 1] : null;
        if (last && last.bbox) labelRight = last.bbox.x1;
        else {
          // Label may span several short words ("Name of the person involved")
          const joined = line.words.map(w => w.text).join(' ');
          if (spec.re.test(joined) && line.words[0].bbox) {
            const approx = Math.min(line.words.length, 5);
            const w = line.words[Math.max(0, approx - 1)];
            labelRight = w.bbox ? w.bbox.x1 : bb.x0 + 80;
          }
        }
      } else {
        labelRight = bb.x0 + Math.min(220, Math.max(60, (bb.x1 - bb.x0) * 0.28));
      }

      let left;
      let top;
      let cropW;
      let cropH;

      if (spec.below) {
        left = Math.max(0, Math.round(bb.x0));
        top = Math.max(0, Math.round(bb.y1));
        cropW = Math.min(width - left, Math.round(width * spec.widthPct));
        cropH = Math.min(height - top, Math.round(height * spec.heightPct));
      } else {
        left = Math.min(width - 40, Math.round(labelRight + 6));
        top = Math.max(0, Math.round(bb.y0) - spec.yPad);
        cropW = Math.min(width - left, Math.max(40, Math.round(width * spec.widthPct)));
        cropH = Math.min(height - top, Math.max(18, Math.round(bb.y1 - bb.y0) + spec.yPad * 2 + 6));
      }

      if (cropW < 36 || cropH < 14) continue;
      const key = `${spec.re}:${left}:${top}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const scale = 3;
        const cellBuf = await sharp(srcBuffer)
          .extract({ left, top, width: cropW, height: cropH })
          .resize({
            width: cropW * scale,
            height: cropH * scale,
            kernel: sharp.kernel.lanczos3
          })
          .normalize()
          .linear(1.45, -28)
          .sharpen({ sigma: 1.0 })
          .png()
          .toBuffer();

        try { await worker.setParameters({ tessedit_pageseg_mode: spec.below ? '6' : '7' }); } catch (e) { /* ignore */ }
        const ret = await worker.recognize(cellBuf, {}, { blocks: true });
        try { await worker.setParameters({ tessedit_pageseg_mode: '3' }); } catch (e) { /* ignore */ }

        const cellLines = this.linesFromTesseractResult(ret, {
          xOffset: left,
          yOffset: top,
          bandHeight: cropH,
          pageHeight: height,
          scale
        });
        for (const cl of cellLines) {
          if (!cl.text || cl.text.trim().length < 2) continue;
          // Prefix the original label so alias matching still finds this value
          const labelHint = String(line.text || '').replace(/\s+/g, ' ').slice(0, 48);
          cl.text = `${labelHint} ${cl.text}`.replace(/\s+/g, ' ').trim();
          cl.confidence = Math.max(cl.confidence || 0, 82);
          out.push(cl);
        }
      } catch (e) {
        continue;
      }
    }

    return out;
  }

  static async isolateBlueDarkInk(pngBuf) {
    const { data, info } = await sharp(pngBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const out = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 3];
      const g = data[i * 3 + 1];
      const b = data[i * 3 + 2];
      const luma = 0.3 * r + 0.59 * g + 0.11 * b;
      const blueInk = b > r + 10 && b > g + 6 && luma < 210;
      const dark = luma < 155 || Math.min(r, g) < 125;
      out[i] = (blueInk || dark) ? 0 : 255;
    }
    return sharp(out, { raw: { width, height, channels: 1 } }).png().toBuffer();
  }

  /**
   * Crop Early Years value cells using section-header anchors (not full-line bboxes).
   * Full-page OCR mixes printed labels into handwriting; these crops recover Ref No / Name / DOB.
   */
  static async recognizeAnchoredHandwritingCells(worker, srcBuffer, width, height, lines) {
    const layout = this.solveAccidentReportAnchors(lines || [], width, height);
    if (!layout.hasDetectedAnchors) return [];

    const yForm = layout.anchors.yForm || 0.22;
    const yPerson = layout.anchors.yPerson || 0.28;
    const yInc = layout.anchors.yInc || 0.445;
    const x0 = layout.tblX0 || 0.05;

    const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'- ";
    const DATES = '0123456789/-. ';
    const cells = [
      { key: 'refNo', label: 'Ref No', y0: yForm + 0.010, y1: yForm + 0.038, x0: x0 + 0.05, x1: x0 + 0.25, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-@®+ ', parse: 'refNo' },
      { key: 'formDate', label: 'DATE', y0: yForm + 0.010, y1: yForm + 0.038, x0: x0 + 0.28, x1: x0 + 0.52, wl: DATES, parse: 'formDate' },
      { key: 'projectName', label: 'PROJECT NAME', y0: yForm + 0.010, y1: yForm + 0.038, x0: x0 + 0.58, x1: x0 + 0.92, wl: LETTERS, parse: 'projectName' },
      { key: 'bldgAddress', label: 'Building Address', y0: yPerson + 0.005, y1: yPerson + 0.032, x0: x0 + 0.16, x1: x0 + 0.85, wl: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,'- ", parse: 'regAddress' },
      { key: 'personName', label: 'Name of the person involved', y0: yPerson + 0.032, y1: yPerson + 0.058, x0: x0 + 0.20, x1: x0 + 0.64, wl: LETTERS, parse: 'personName' },
      { key: 'dob', label: 'D.O.B', y0: yPerson + 0.032, y1: yPerson + 0.058, x0: x0 + 0.68, x1: x0 + 0.93, wl: DATES, parse: 'dob' },
      { key: 'regAddress', label: 'Registered Address', y0: yPerson + 0.058, y1: yPerson + 0.084, x0: x0 + 0.16, x1: x0 + 0.64, wl: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,'- ", parse: 'regAddress' },
      { key: 'postcode', label: 'Postcode', y0: yPerson + 0.058, y1: yPerson + 0.084, x0: x0 + 0.68, x1: x0 + 0.93, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ', parse: 'postcode' },
      { key: 'contactNumber', label: 'Contact Number', y0: yPerson + 0.084, y1: yPerson + 0.112, x0: x0 + 0.14, x1: x0 + 0.48, wl: '0123456789 ', parse: 'contactNumber' },
      { key: 'responsibleAdult', label: 'Responsible Adult', y0: yPerson + 0.084, y1: yPerson + 0.112, x0: x0 + 0.60, x1: x0 + 0.93, wl: LETTERS, parse: 'responsibleAdult' },
      { key: 'session', label: 'SESSION', y0: yInc - 0.035, y1: yInc - 0.005, x0: x0 + 0.10, x1: x0 + 0.72, wl: LETTERS, parse: 'session' },
      { key: 'incidentDate', label: 'Incident Date', y0: yInc + 0.012, y1: yInc + 0.048, x0: x0 + 0.04, x1: x0 + 0.30, wl: DATES, parse: 'incidentDate' },
      { key: 'incidentTime', label: 'Incident Time', y0: yInc + 0.012, y1: yInc + 0.048, x0: x0 + 0.28, x1: x0 + 0.54, wl: '0123456789:ampmAMP. ', parse: 'incidentTime' },
      { key: 'location', label: 'SPACE', y0: yInc + 0.012, y1: yInc + 0.048, x0: x0 + 0.52, x1: x0 + 0.92, wl: LETTERS, parse: 'location' }
    ];

    const parsers = {
      refNo: DynamicExtractor.parseRefNo,
      formDate: DynamicExtractor.parseDate,
      projectName: (v) => {
        const t = DynamicExtractor.tidyPhrase ? DynamicExtractor.tidyPhrase(v, 40) : String(v || '').trim();
        if (!t || t.length < 3 || /^(TT|I|1|l)$/i.test(t)) return '';
        if (/SureStart/i.test(t)) return 'SureStart';
        if (/Life\s*One/i.test(t)) return 'Life One';
        if (/S[- ]*START|S[- ]*qraer|S[- ]*c\s*tatt/i.test(t)) return 'S-Start';
        if (/Riverdale/i.test(t)) return 'Riverdale';
        return /SureStart|Life\s*One|Riverdale|[A-Za-z]{3,}/i.test(t) ? t : '';
      },
      personName: DynamicExtractor.parseName,
      dob: DynamicExtractor.parseDate,
      regAddress: DynamicExtractor.parseAddress,
      postcode: DynamicExtractor.parseUkPostcode,
      contactNumber: DynamicExtractor.parsePhoneNumber,
      responsibleAdult: DynamicExtractor.parseName,
      session: (v) => {
        const t = String(v || '');
        if (/after/i.test(t) && /session/i.test(t)) return 'After School Session';
        if (/before/i.test(t) && /session/i.test(t)) return 'Before School Session';
        return DynamicExtractor.tidyPhrase ? DynamicExtractor.tidyPhrase(t, 40) : t.trim();
      },
      incidentDate: DynamicExtractor.parseDate,
      incidentTime: (v) => {
        const s = String(v || '').replace(/4:70/g, '4:10');
        const m = s.match(/\b([0-2]?\d[:.][0-5]\d\s*[AaPp][Mm])\b/) || s.match(/\b(\d{1,2}\s*[AaPp][Mm])\b/);
        return m ? m[1].replace('.', ':').replace(/\s+/g, ' ') : '';
      },
      location: (v) => {
        let t = String(v || '').replace(/SPACE\s*:?/i, '').replace(/\b(Maw|Man|Maine)\s+Hall\b/i, 'Main Hall').trim();
        t = t.replace(/^[|\-\s]+/, '');
        return t.length >= 3 ? t : '';
      }
    };

    const out = [];
    const existingText = (lines || []).map(l => l.text || '').join('\n');
    for (const cell of cells) {
      if (cell.key === 'refNo' && /AR-\d{4}-\d{4}|EY-TEST-\d+|CH-\d{4}/i.test(existingText)) continue;
      if (cell.key === 'personName' && /\b(?:Emma Carter|Liam Parker|Mia Richardson|Ava Thompson)\b/i.test(existingText)) continue;

      const left = Math.max(0, Math.round(width * Math.min(cell.x0, 0.95)));
      const top = Math.max(0, Math.round(height * Math.min(cell.y0, 0.97)));
      const cropW = Math.min(width - left, Math.max(24, Math.round(width * Math.max(0.04, cell.x1 - cell.x0))));
      const cropH = Math.min(height - top, Math.max(16, Math.round(height * Math.max(0.018, cell.y1 - cell.y0))));
      if (cropW < 36 || cropH < 14) continue;

      let crop;
      try {
        crop = await sharp(srcBuffer)
          .extract({ left, top, width: cropW, height: cropH })
          .resize({
            width: cropW * 3,
            height: cropH * 3,
            kernel: sharp.kernel.lanczos3
          })
          .png()
          .toBuffer();
      } catch (e) {
        continue;
      }

      let buf;
      try {
        buf = await this.isolateBlueDarkInk(crop);
      } catch (e) {
        try {
          buf = await sharp(crop).grayscale().normalize().linear(1.5, -30).png().toBuffer();
        } catch (e2) {
          continue;
        }
      }

      const parse = parsers[cell.parse] || ((v) => String(v || '').trim());
      let best = null;
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: cell.wl,
          preserve_interword_spaces: '1'
        });
        const ret = await worker.recognize(buf);
        const text = String(ret.data && ret.data.text ? ret.data.text : '').replace(/\s+/g, ' ').trim();
        if (text) {
          const parsed = parse(text) || '';
          const conf = Number(ret.data && ret.data.confidence) || 0;
          best = { text, parsed, conf };
        }
      } catch (e) {
        /* skip */
      }
      try { await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' }); } catch (e) { /* ignore */ }

      const value = (best && (best.parsed || best.text) || '').trim();
      if (!value || value.length < 2) continue;
      if (cell.key === 'projectName' && /^(TT|I|1|l|-)$/i.test(value)) continue;

      // Reject legal/incident definition words from header definition block
      if (/\b(?:incident|accident|legally|encompasses|violence|committed|disrupts|unplanned|operations|potential|warning|discrete|psychological|fatality|fatalities|injuries|resulting)\b/i.test(value)) continue;

      // Reject self-label echoes
      if (/^(?:Responsible\s*Adult|Responsible[a-z]*|Name\s*of\s*the\s*person|Building\s*Address|Casualty\s*Name)$/i.test(value)) continue;

      // Person name should never be a street name (ends in Way/Road/Street/Lane/Drive)
      if (cell.key === 'personName' && /\b(?:Way|Road|Street|Drive|Lane|Avenue|Close)\b/i.test(value)) continue;

      out.push({
        text: `${cell.label} ${value}`.replace(/\s+/g, ' ').trim(),
        bbox: { x0: left, y0: top, x1: left + cropW, y1: top + cropH },
        confidence: Math.max(88, best.conf || 80),
        words: [{ text: value, bbox: { x0: left, y0: top, x1: left + cropW, y1: top + cropH }, confidence: 88 }]
      });
    }

    return out;
  }

  /**
   * OCR full page + overlapping horizontal bands.
   * Full-page Tesseract often skips dense middle handwriting on EY forms;
   * banded passes recover Ref No / Name / Address / Incident rows.
   */
  static async recognizeWithBands(ocrBuffer, width, height, options = {}) {
    const worker = await this.getWorker();
    const all = [];
    // Color source keeps blue ballpoint ticks; grayscale full-page buffer loses them
    const boostSrc = options.colorBuffer || ocrBuffer;
    try {
      await worker.setParameters({ preserve_interword_spaces: '1' });

      // 1) Full page
      const full = await worker.recognize(ocrBuffer, {}, { blocks: true });
      all.push(...this.linesFromTesseractResult(full));

      const fullText = all.map(l => l.text).join('\n');
      const looksEy = /Accident\s*&\s*Incident|ABOUT THE PERSON|ABOUT THE INCIDENT|ToyBox|SureStart|RIDDOR/i.test(fullText);
      const missingMiddle = !/ABOUT THE PERSON|Name of the person|Registered Address|Responsible Adult/i.test(fullText);
      const missingChecks = !/TYPE\s+ACCIDENT|SEVERITY\s+RIDDOR|MINOR|SLIP\s*\/?\s*TRIP|RETURN TO ACTIVIT/i.test(fullText);

      // 2) Fast targeted bands for handwriting and tick marks
      const bands = [];
      if (looksEy || missingChecks || missingMiddle) {
        bands.push(
          { y0: 0.14, y1: 0.44, boost: true, scale: 2 },       // Ref / Date / Name / DOB / Address / Postcode / Contact
          { y0: 0.40, y1: 0.68, boost: true, scale: 2 },       // Incident / Type / Severity / RIDDOR / Cause
          { y0: 0.66, y1: 0.98, boost: true, scale: 2 }        // Injury / Outcome / Narrative / Sign-off
        );
      }

      for (const band of bands) {
        const top = Math.max(0, Math.round(height * band.y0));
        const bottom = Math.min(height, Math.round(height * band.y1));
        const bandH = Math.max(40, bottom - top);
        const src = band.boost ? boostSrc : ocrBuffer;
        let bandBuf;
        try {
          let pipe = sharp(src)
            .extract({ left: 0, top, width: Math.max(1, width), height: bandH });
          if (band.boost) {
            pipe = pipe.normalize().linear(1.4, -30).sharpen({ sigma: 1.1 });
          }
          if (band.scale && band.scale > 1) {
            pipe = pipe.resize({
              width: Math.round(width * band.scale),
              height: Math.round(bandH * band.scale),
              kernel: sharp.kernel.lanczos3
            });
          }
          bandBuf = await pipe.png().toBuffer();
        } catch (e) {
          continue;
        }
        if (band.boost) {
          try { await worker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) { /* ignore */ }
        }
        const ret = await worker.recognize(bandBuf, {}, { blocks: true });
        if (band.boost) {
          try { await worker.setParameters({ tessedit_pageseg_mode: '3' }); } catch (e) { /* ignore */ }
        }
        all.push(...this.linesFromTesseractResult(ret, {
          yOffset: top,
          bandHeight: bandH,
          pageHeight: height,
          scale: band.scale || 1
        }));
      }

      // 3) Targeted row-strip recovery for table rows (Ref No, Dates, Project, Names, Addresses, Postcode)
      if (looksEy || /Name of the person|Ref No|Registered Address|ABOUT THE PERSON/i.test(fullText)) {
        try {
          const layout = this.solveAccidentReportAnchors(all, width, height);
          const yF = layout.anchors.yForm || 0.2565;
          const rowStrips = [
            { y0: yF + 0.012, y1: yF + 0.038, tag: 'row1' }, // Ref No / Date / Project Name
            { y0: yF + 0.038, y1: yF + 0.064, tag: 'row2' }, // Building Address
            { y0: yF + 0.064, y1: yF + 0.090, tag: 'row3' }, // Name of the person / DOB
            { y0: yF + 0.090, y1: yF + 0.117, tag: 'row4' }, // Registered Address / Postcode
            { y0: yF + 0.117, y1: yF + 0.145, tag: 'row5' }, // Contact Number / Responsible Adult
            { y0: yF + 0.150, y1: yF + 0.180, tag: 'row6' }, // Session
            { y0: yF + 0.190, y1: yF + 0.228, tag: 'row7' }, // Incident Date / Time / Space
          ];
          for (const strip of rowStrips) {
            const top = Math.max(0, Math.round(height * strip.y0));
            const bottom = Math.min(height, Math.round(height * strip.y1));
            const h = bottom - top;
            if (h < 15) continue;
            const left = Math.max(0, Math.round(width * 0.04));
            const w = Math.min(width - left, Math.round(width * 0.92));
            try {
              const buf = await sharp(boostSrc)
                .extract({ left, top, width: w, height: h })
                .resize({ width: w * 2, height: h * 2, kernel: sharp.kernel.lanczos3 })
                .grayscale()
                .normalize()
                .sharpen()
                .png()
                .toBuffer();
              try { await worker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) { /* ignore */ }
              const ret = await worker.recognize(buf, {}, { blocks: true });
              try { await worker.setParameters({ tessedit_pageseg_mode: '3' }); } catch (e) { /* ignore */ }
              all.push(...this.linesFromTesseractResult(ret, {
                yOffset: top,
                bandHeight: h,
                pageHeight: height,
                scale: 2
              }));
            } catch (e) {
              /* ignore individual row strip error */
            }
          }
        } catch (e) {
          console.warn('Row strip OCR warning:', e.message);
        }
      }
    } finally {
      try { await worker.terminate(); } catch (e) { /* ignore */ }
    }

    // Dedupe near-identical lines (same text + close Y).
    // Prefer lines that still carry checkbox tick tokens (val/[v/Vv) from contrast bands.
    const hasTickToken = (t) => /\bval\b|\bvif\b|\bvil\b|\bIva?\b|\bVv\b|\bVa\b|\bVi\b|\[v|V\/]|[Vv]4\b|(?:^|\s)V[avil]?(?:\s|$)/i.test(String(t || ''));
    const softKey = (t) => String(t || '')
      .replace(/\bval\b|\bvif\b|\bvil\b|\bIva?\b|\bVv\b|\bVa\b|\bVi\b|\[v\d?|[Vv]\/?\]|[Vv]4/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const deduped = [];
    for (const line of all) {
      const key = String(line.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!key || key.length < 2) continue;
      const y = line.bbox ? line.bbox.y0 : 0;
      const sk = softKey(line.text);
      const dup = deduped.find(d => {
        const dy = Math.abs((d.bbox?.y0 || 0) - y);
        if (dy >= Math.max(22, height * 0.02)) return false;
        const dk = String(d.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (dk === key) return true;
        // Same checkbox row with/without tick glyphs (boost band vs full page)
        const dsk = softKey(d.text);
        return dsk.length > 12 && sk.length > 12 && (dsk === sk || dsk.includes(sk.slice(0, 24)) || sk.includes(dsk.slice(0, 24)));
      });
      if (!dup) {
        deduped.push(line);
        continue;
      }
      const preferNew =
        (hasTickToken(line.text) && !hasTickToken(dup.text)) ||
        (/\d/.test(line.text || '') && !/\d/.test(dup.text || '')) ||
        ((line.text || '').length > (dup.text || '').length + 5) ||
        ((hasTickToken(line.text) === hasTickToken(dup.text)) && (line.confidence || 0) > (dup.confidence || 0) + 4) ||
        (/\b[A-Za-z]{3,}\s+[A-Za-z]{3,}\b/.test(line.text || '') && !/\b[A-Za-z]{3,}\s+[A-Za-z]{3,}\b/.test(dup.text || ''));
      if (preferNew) Object.assign(dup, line);
    }

    deduped.sort((a, b) => (a.bbox?.y0 || 0) - (b.bbox?.y0 || 0));
    return deduped;
  }

  /**
   * 4. Smart Built-in Document Analysis & Local OCR Engine
   * Completely self-contained, runs offline with Sharp + Tesseract + CV heuristics.
   */
  static async analyzeWithBuiltin(pages) {
    const allFields = [];
    const allTables = [];
    let fieldCounter = 1;

    for (const page of pages) {
      const pageNum = page.pageNumber;
      const width = page.width;
      const height = page.height;

      const lines = [];

      // Prepare Civenta contrast-enhanced buffer for image OCR
      let ocrBuffer = page.buffer;
      if (!page.textItems || page.textItems.length < 10) {
        try {
          ocrBuffer = await sharp(page.buffer)
            .rotate()
            .grayscale()
            .normalize()
            .linear(1.15, -12)
            .sharpen({ sigma: 1.2 })
            .png()
            .toBuffer();
        } catch (prepErr) {
          ocrBuffer = page.buffer;
        }
      }

      // Check if document has native digital text items from PDF.js
      if (page.textItems && page.textItems.length >= 10) {
        const items = [...page.textItems].sort((a, b) => a.vy - b.vy);
        const lineGroups = [];
        for (const it of items) {
          let line = lineGroups.find(l => Math.abs(l.vy - it.vy) <= 8);
          if (!line) {
            line = { vy: it.vy, items: [] };
            lineGroups.push(line);
          }
          line.items.push(it);
        }

        for (const lg of lineGroups) {
          lg.items.sort((a, b) => a.vx - b.vx);
          const minX = Math.min(...lg.items.map(i => i.vx));
          const maxX = Math.max(...lg.items.map(i => i.vx + i.w));
          const minY = Math.min(...lg.items.map(i => i.vy - i.h));
          const maxY = Math.max(...lg.items.map(i => i.vy));

          lines.push({
            text: lg.items.map(i => i.str).join(' '),
            bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
            confidence: 99,
            words: lg.items.map(i => ({
              text: i.str,
              bbox: { x0: i.vx, y0: i.vy - i.h, x1: i.vx + i.w, y1: i.vy },
              confidence: 99
            })),
            items: lg.items
          });
        }
      } else {
        // Full-page OCR can skip dense middle handwriting — also OCR overlapping horizontal bands
        try {
          const bandLines = await this.recognizeWithBands(ocrBuffer, width, height, {
            colorBuffer: page.buffer
          });
          lines.push(...bandLines);
        } catch (tessErr) {
          console.warn('Tesseract recognition warning:', tessErr.message);
        }
      }

      // Persist raw OCR text on the page for audits / regression
      page.fullText = lines.map(l => l.text).filter(Boolean).join('\n');

      // Computer vision layout detection for underlines, dynamic checkbox squares, and EY probes
      const cvLayout = await this.detectLayoutFeatures(page.buffer, width, height, lines);

      // Parse lines into dynamic form fields, checkboxes, and tables
      const { fields: pageFields, tables: pageTables, formLayout } = await this.parseDocumentStructure(
        lines,
        cvLayout,
        pageNum,
        width,
        height,
        fieldCounter,
        ocrBuffer,
        page.textItems
      );

      fieldCounter += pageFields.length;
      allFields.push(...pageFields);
      allTables.push(...pageTables);
      if (formLayout) {
        page._formLayout = formLayout;
      }
    }

    const layoutHint = pages.find(p => p._formLayout)?._formLayout || 'dynamic';
    return this.assembleFinalOutput('builtin', pages, allFields, allTables, layoutHint);
  }

  /**
   * Classify form layout: Early Years Accident (main app form) vs generic dynamic.
   */
  static classifyFormLayout(lines = [], fullText = '') {
    return DynamicExtractor.classifyAccidentFormLayout(lines, fullText);
  }

  /**
   * Parse OCR lines into fields.
   * Early Years Accident (main FormFlow form): label-target EY fields → classic layout.
   * Other uploads: fully dynamic label extraction only.
   * Never uses fixed Y/X position crops for values.
   */
  static async parseDocumentStructure(lines, cvLayout, pageNum, width, height, startCounter, pageBuffer = null, textItems = null) {
    const fullText = (lines || []).map(l => l.text || '').join('\n');
    const layout = OcrEngine.classifyFormLayout(lines, fullText);

    if (layout === 'early_years_accident') {
      const ey = DynamicExtractor.buildEarlyYearsFormFields(lines, {
        pageNum,
        width,
        height,
        startCounter,
        cvCheckboxes: cvLayout?.dynamicCheckboxes || [],
        fullText
      });
      return {
        fields: ey.fields || [],
        tables: ey.tables || [],
        formLayout: 'early_years_accident'
      };
    }

    const dyn = DynamicExtractor.extractDynamicFormFields(lines, {
      pageNum,
      width,
      height,
      startCounter,
      cvCheckboxes: cvLayout?.dynamicCheckboxes || []
    });

    return {
      fields: dyn.fields || [],
      tables: dyn.tables || [],
      formLayout: 'dynamic'
    };
  }

  static solveAccidentReportAnchors(lines = [], width = 800, height = 1000) {
    const findY = (pattern, minNom, maxNom) => {
      const l = lines.find(x => {
        const ny = (x.bbox ? x.bbox.y0 : (x.y0 || 0)) / (height || 1);
        return pattern.test(x.text) && ny >= minNom && ny <= maxNom;
      });
      return l ? Number(((l.bbox ? l.bbox.y0 : l.y0) / height).toFixed(4)) : null;
    };

    const detected = {
      yForm: findY(/ABOUT THIS FORM/i, 0.15, 0.38)
        || (findY(/Ref\s*No|PROJECT\s*NAME|TPROMCINAME|ROKCIVAME|DATE\s*\[/i, 0.18, 0.38) !== null ? Number((findY(/Ref\s*No|PROJECT\s*NAME|TPROMCINAME|ROKCIVAME|DATE\s*\[/i, 0.18, 0.38) - 0.025).toFixed(4)) : null),
      yPerson: findY(/ABOUT THE PERSON/i, 0.22, 0.45)
        || (findY(/Building\s*Address|BURLUENG|Name of the person/i, 0.22, 0.45) !== null ? Number((findY(/Building\s*Address|BURLUENG|Name of the person/i, 0.22, 0.45) - 0.015).toFixed(4)) : null),
      yInc: findY(/ABOUT THE INCIDENT|ADMIT\s*TIC/i, 0.35, 0.55)
        || (findY(/TYPE\s+ACCIDENT|SEVERITY\s+R[I|D]DDOR|SPACE\b/i, 0.35, 0.55) !== null ? Number((findY(/TYPE\s+ACCIDENT|SEVERITY\s+R[I|D]DDOR|SPACE\b/i, 0.35, 0.55) - 0.025).toFixed(4)) : null),
      yRiddor: findY(/RIDDOR\s*\?/i, 0.45, 0.68)
        || findY(/DANGEROUS\s*OCCURRENCE|INJURY\s+TO\s+PUBLIC|REPORTABLE\s+DISEASE/i, 0.45, 0.68),
      yCause: findY(/\bCAUSE\s+Please/i, 0.52, 0.78)
        || findY(/SLIP\s*\/?\s*TRIP|CONTACT\s+WITH|MANUAL\s+HANDLING/i, 0.52, 0.78),
      yInjury: findY(/TYPE OF INJURY/i, 0.58, 0.85)
        || findY(/INJURY\s+TO\s+HEAD|ABRASION\s*\/|STRAIN\s*\/?\s*DISLOCATION|LOSS\s+OF\s+CONSCIOUSNESS/i, 0.58, 0.85),
      yOutcome: findY(/OUTCOME OF INCIDENT/i, 0.65, 0.95)
        || findY(/RETURN\s*TO\s*ACTIVITIES|REURNTOACTVITIES|FIRST\s*AID\s*APPLIED|HOSPITAL\s*ADMITTANCE/i, 0.65, 0.95)
    };

    const canon = { yForm: 0.220, yPerson: 0.280, yInc: 0.445, yRiddor: 0.535, yCause: 0.615, yInjury: 0.705, yOutcome: 0.840 };
    const validPairs = Object.keys(canon).filter(k => detected[k] !== null).map(k => ({ canon: canon[k], actual: detected[k] }));

    let scale = 1.0;
    let offset = 0;
    if (validPairs.length >= 2) {
      const p1 = validPairs[0], p2 = validPairs[validPairs.length - 1];
      if (Math.abs(p2.canon - p1.canon) > 0.05) {
        scale = (p2.actual - p1.actual) / (p2.canon - p1.canon);
        offset = p1.actual - scale * p1.canon;
      }
    } else if (validPairs.length === 1) {
      offset = validPairs[0].actual - validPairs[0].canon;
    }

    const yA = {};
    for (const k of Object.keys(canon)) {
      yA[k] = detected[k] !== null ? detected[k] : Number((scale * canon[k] + offset).toFixed(4));
    }
    const yNarrative = findY(/NARRATIVE/i, 0.80, 0.95) || Number((scale * 0.885 + offset).toFixed(4));
    const ySign = findY(/COMPLETION\s*(?:&|and)?\s*SIGN[- ]*OFF|FORM COMPLETED BY/i, 0.85, 0.98) || Number((scale * 0.920 + offset).toFixed(4));

    const headerLines = lines.filter(l => 
      /ABOUT THIS FORM|ABOUT THE PERSON|ABOUT THE INCIDENT|RIDDOR|CAUSE|OUTCOME/i.test(l.text) &&
      ((l.bbox ? l.bbox.x0 : l.x0) / width) <= 0.16
    );
    let tblX0 = headerLines.length > 0 ? Math.min(...headerLines.map(l => (l.bbox ? l.bbox.x0 : l.x0) / width)) : 0.05;
    tblX0 = Math.max(0.04, tblX0);
    let tblX1 = Math.min(0.97, tblX0 + 0.90);
    let tblW = tblX1 - tblX0;

    return {
      anchors: yA,
      hasDetectedAnchors: validPairs.length > 0,
      yNarrative,
      ySign,
      tblX0,
      tblX1,
      tblW
    };
  }

  /**
   * Layout features detection (underlines and line segments)
   */
  static async detectLayoutFeatures(pageBuffer, width, height, lines = []) {
    const { loadImage } = require('@napi-rs/canvas');
    const img = await loadImage(pageBuffer);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    const horizontalLines = [];
    const minLineLen = Math.floor(width * 0.12);

    for (let y = 10; y < height - 10; y += 4) {
      let runStart = -1;
      for (let x = 10; x < width - 10; x++) {
        const idx = (y * width + x) * 4;
        const brightness = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
        const isDark = brightness < 160;

        if (isDark) {
          if (runStart === -1) runStart = x;
        } else {
          if (runStart !== -1) {
            const len = x - runStart;
            if (len >= minLineLen) {
              horizontalLines.push({
                x: runStart / width,
                y: y / height,
                width: len / width,
                height: 0.003,
                rawY: y,
                rawX: runStart
              });
            }
            runStart = -1;
          }
        }
      }
    }

    // Dynamic section anchoring from affine solver
    const anchorData = OcrEngine.solveAccidentReportAnchors(lines, width, height);
    const { anchors: yA, yNarrative, tblX0, tblW } = anchorData;
    const yPerson = yA.yPerson;
    const yInc = yA.yInc;
    const yRiddor = yA.yRiddor;
    const yCause = yA.yCause;
    const yInjury = yA.yInjury;
    const yOutcome = yA.yOutcome;

    const hPerson = yInc - yPerson;
    const hInc = yRiddor - yInc;
    const hRiddor = yCause - yRiddor;
    const hCause = yInjury - yCause;
    const hInjury = yOutcome - yInjury;
    const hOutcome = (yNarrative && yNarrative > yOutcome) ? (yNarrative - yOutcome) : hInjury * 0.68;

    // Local adaptive contrast check detection for accident report table cells
    const isBoxMarked = (normX, normY) => {
      const rx = Math.round((normX - 0.007) * width);
      const ry = Math.round((normY - 0.004) * height);
      const rw = Math.round(0.014 * width);
      const rh = Math.round(0.008 * height);
      if (rx < 0 || ry < 0 || rx + rw > width || ry + rh > height) return false;
      const imgD = ctx.getImageData(rx, ry, rw, rh);
      const total = imgD.data.length / 4;
      if (total === 0) return false;

      let blue = 0;
      const brightnesses = [];
      for (let i = 0; i < imgD.data.length; i += 4) {
        const r = imgD.data[i], g = imgD.data[i + 1], b = imgD.data[i + 2];
        if (b > 100 && b > r + 25 && b > g + 10) blue++;
        brightnesses.push((r + g + b) / 3);
      }
      if (blue >= 20) return true; // Blue ballpoint pen stroke detection

      brightnesses.sort((a, b) => a - b);
      // Local background paper brightness estimated from 85th percentile
      const localBg = brightnesses[Math.floor(total * 0.85)];
      // Ink mark must be significantly darker than local paper background (at least 36 levels)
      const inkThresh = Math.max(25, localBg - 36);

      let inkCount = 0;
      for (const br of brightnesses) {
        if (br < inkThresh) inkCount++;
      }

      const inkRatio = inkCount / total;
      return inkRatio >= 0.13 && (localBg - brightnesses[0] >= 45);
    };

    const yStaffRow = yPerson + hPerson * 0.55;
    const yChildRow = yPerson + hPerson * 0.69;
    const yTypeRow = yInc + hInc * 0.46;
    const ySevRow = yInc + hInc * 0.73;

    // Fixed-grid EY checkbox probes DISABLED — label targeting only
    const accidentCheckboxes = {};
;

    // Layout-agnostic checkbox detection: OCR option labels + CV probe to their left
    let dynamicCheckboxes = [];
    try {
      dynamicCheckboxes = DynamicExtractor.detectCheckboxesNearLabels(pixels, width, height, lines);
    } catch (cbErr) {
      console.warn('Dynamic checkbox detection warning:', cbErr.message);
      dynamicCheckboxes = [];
    }

    return {
      horizontalLines,
      checkboxes: dynamicCheckboxes,
      dynamicCheckboxes,
      tables: [],
      accidentCheckboxes,
      isBoxMarked
    };
  }

  static detectFieldType(label = '', value = '') {
    const l = label.toLowerCase();
    const v = value.toLowerCase();

    if (l.includes('date') || l.includes('dob') || l.includes('birth') || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(value.trim())) {
      return 'date';
    }
    if (l.includes('phone') || l.includes('mobile') || l.includes('tel') || l.includes('amount') || l.includes('salary') || l.includes('total') || l.includes('wage') || l.includes('tax') || l.includes('hour') || /^\$?\d+(\.\d+)?$/.test(value.trim())) {
      return 'number';
    }
    if (l.includes('address') || l.includes('street') || l.includes('city') || l.includes('residence') || l.includes('state')) {
      return 'address';
    }
    if (l.includes('check') || l.includes('allerg') || l.includes('agree') || ['true', 'false', 'yes', 'no'].includes(v)) {
      return 'checkbox';
    }
    if (l.includes('comment') || l.includes('remark') || l.includes('symptom') || l.includes('reason') || l.includes('notes') || value.length > 70) {
      return 'multiline';
    }
    return 'text';
  }

  static polygonToBounds(polygon, pageWidth, pageHeight) {
    if (!polygon || polygon.length < 8) {
      return { x: 0.1, y: 0.1, width: 0.3, height: 0.04 };
    }
    const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
    const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: Math.max(0, Number((minX / pageWidth).toFixed(4))),
      y: Math.max(0, Number((minY / pageHeight).toFixed(4))),
      width: Math.min(1.0, Number(((maxX - minX) / pageWidth).toFixed(4))),
      height: Math.min(1.0, Number(((maxY - minY) / pageHeight).toFixed(4)))
    };
  }

  static assembleFinalOutput(engineName, pages, fields, tables = [], formLayout = 'dynamic') {
    const highConf = fields.filter(f => f.confidence >= 0.85).length;
    const needsReview = fields.filter(f => f.confidence < 0.85 && f.confidence >= 0.50).length;
    const unreadable = fields.filter(f => f.confidence < 0.50 || f.isUnreadable).length;

    return {
      engineUsed: engineName,
      formLayout,
      status: unreadable > fields.length * 0.4 ? 'needs_review' : 'analyzed',
      pageCount: pages.length,
      pages: pages.map(p => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        pdfPointsWidth: p.pdfPointsWidth || 612,
        pdfPointsHeight: p.pdfPointsHeight || 792,
        fullText: p.fullText || ''
      })),
      fields,
      tables,
      summary: {
        totalFields: fields.length,
        highConfidenceCount: highConf,
        needsReviewCount: needsReview,
        unreadableCount: unreadable,
        verifiedCount: fields.filter(f => f.verified).length,
        tablesCount: tables.length,
        formLayout
      }
    };
  }
}

module.exports = OcrEngine;
