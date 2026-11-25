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
    const awsAccessKey = options.awsAccessKey || process.env.AWS_ACCESS_KEY_ID;
    const awsSecretKey = options.awsSecretKey || process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = options.awsRegion || process.env.AWS_REGION || 'us-east-1';
    const azureKey = options.azureKey || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    const azureEndpoint = options.azureEndpoint || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    const geminiKey = options.geminiKey || options.apiKey || process.env.GEMINI_API_KEY;
    const openaiKey = options.openaiKey || options.apiKey || process.env.OPENAI_API_KEY;

    let selectedProvider = provider;
    if (provider === 'auto') {
      if (awsAccessKey && awsSecretKey) {
        selectedProvider = 'aws';
      } else if (azureKey && azureEndpoint) {
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
      if ((selectedProvider === 'aws' || selectedProvider === 'textract') && awsAccessKey && awsSecretKey) {
        return await this.analyzeWithAwsTextract(pages, { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey, region: awsRegion });
      } else if (selectedProvider === 'azure' && azureKey && azureEndpoint) {
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
   * 0. AWS Textract Document Analysis (FORMS, TABLES, and SELECTION_ELEMENTS)
   */
  static async analyzeWithAwsTextract(pages, credentials = {}) {
    const { TextractClient, AnalyzeDocumentCommand } = require('@aws-sdk/client-textract');

    const client = new TextractClient({
      region: credentials.region || process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: credentials.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    const allFields = [];
    const allTables = [];
    let fieldCounter = 1;
    let tableCounter = 1;
    let combinedFullText = '';

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const page = pages[pIdx];
      const pageNum = page.pageNumber || (pIdx + 1);

      const command = new AnalyzeDocumentCommand({
        Document: { Bytes: page.buffer },
        FeatureTypes: ['FORMS', 'TABLES']
      });

      const response = await client.send(command);
      const blocks = response.Blocks || [];

      // Build quick lookup map by ID
      const blockMap = new Map();
      blocks.forEach(b => blockMap.set(b.Id, b));

      const getText = (block) => {
        if (!block || !block.Relationships) return '';
        let text = '';
        for (const rel of block.Relationships) {
          if (rel.Type === 'CHILD') {
            for (const cid of rel.Ids) {
              const child = blockMap.get(cid);
              if (child && child.BlockType === 'WORD') {
                text += (text ? ' ' : '') + child.Text;
              }
            }
          }
        }
        return text;
      };

      const getCheckState = (block) => {
        if (!block || !block.Relationships) return null;
        for (const rel of block.Relationships) {
          if (rel.Type === 'CHILD') {
            for (const cid of rel.Ids) {
              const child = blockMap.get(cid);
              if (child && child.BlockType === 'SELECTION_ELEMENT') {
                return child.SelectionStatus === 'SELECTED';
              }
            }
          }
        }
        return null;
      };

      let pageFullText = '';

      // 1. Extract Key-Value Pairs
      const pageFields = [];
      for (const block of blocks) {
        if (block.BlockType === 'LINE') {
          combinedFullText += ' ' + block.Text;
          pageFullText += (pageFullText ? '\n' : '') + block.Text;
        }

        if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
          const keyText = getText(block);
          if (!keyText || keyText.length < 2) continue;

          let valBlock = null;
          if (block.Relationships) {
            for (const rel of block.Relationships) {
              if (rel.Type === 'VALUE') {
                valBlock = blockMap.get(rel.Ids[0]);
                break;
              }
            }
          }

          let valText = '';
          let isCheckbox = false;
          let isChecked = false;
          let bounds = null;

          if (valBlock) {
            const check = getCheckState(valBlock);
            if (check !== null) {
              isCheckbox = true;
              isChecked = check;
              valText = isChecked ? 'true' : 'false';
            } else {
              valText = getText(valBlock);
            }

            if (valBlock.Geometry?.BoundingBox) {
              const bb = valBlock.Geometry.BoundingBox;
              bounds = {
                x: Number(Math.max(0, bb.Left).toFixed(4)),
                y: Number(Math.max(0, bb.Top).toFixed(4)),
                width: Number(Math.min(1, bb.Width).toFixed(4)),
                height: Number(Math.min(1, bb.Height).toFixed(4))
              };
            }
          }

          if (!bounds && block.Geometry?.BoundingBox) {
            const bb = block.Geometry.BoundingBox;
            bounds = {
              x: Number(Math.min(0.9, bb.Left + bb.Width + 0.02).toFixed(4)),
              y: Number(bb.Top.toFixed(4)),
              width: Number(Math.min(0.4, 0.95 - (bb.Left + bb.Width)).toFixed(4)),
              height: Number(bb.Height.toFixed(4))
            };
          }

          const conf = block.Confidence ? Number((block.Confidence / 100).toFixed(2)) : 0.85;
          const cleanLabel = keyText.trim().replace(/^:+|:+$/g, '').replace(/_+$/, '').trim();
          const trimmedVal = String(valText || '').trim();

          // Skip top-header printed glossary definition bullets mistaken as form fields
          if (
            !isCheckbox &&
            (bounds?.y ?? 1) < 0.21 &&
            /^(child\s*accident|child\s*incident|accident|near\s*miss|incident)$/i.test(cleanLabel) &&
            /unintended injury|intended injury|unplanned event|discrete,?\s*identifiable|does not cause injury/i.test(trimmedVal)
          ) {
            continue;
          }

          pageFields.push({
            id: `field_${fieldCounter++}`,
            label: cleanLabel,
            value: isCheckbox ? (isChecked ? 'true' : 'false') : trimmedVal,
            originalOcrValue: isCheckbox ? (isChecked ? '[X] Checked' : '[ ] Unchecked') : trimmedVal,
            page: pageNum,
            confidence: conf,
            verified: conf >= 0.88,
            needsVerification: conf < 0.88,
            isUnreadable: conf < 0.45,
            isBlank: !trimmedVal,
            type: isCheckbox ? 'checkbox' : this.detectFieldType(cleanLabel, trimmedVal),
            bounds: bounds || { x: 0.1, y: 0.1, width: 0.3, height: 0.02 },
            isHandwritten: true,
            source: 'aws_textract'
          });
        }
      }

      // Split composite header dates like "05-03-26 Riverside Nursery" only if Project Name wasn't already extracted
      const hasProjectField = pageFields.some(f => /project\s*name/i.test(f.label) && f.value);
      for (const f of [...pageFields]) {
        if (/^date$/i.test(f.label) && typeof f.value === 'string') {
          const dateMatch = f.value.match(/^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(.+)$/);
          if (dateMatch) {
            f.value = dateMatch[1].trim();
            f.originalOcrValue = f.value;
            if (!hasProjectField) {
              const trailingProject = dateMatch[2].trim();
              pageFields.push({
                id: `field_${fieldCounter++}`,
                label: 'Project Name',
                value: trailingProject,
                originalOcrValue: trailingProject,
                page: pageNum,
                confidence: f.confidence,
                verified: f.confidence >= 0.88,
                needsVerification: f.confidence < 0.88,
                isUnreadable: false,
                isBlank: false,
                type: 'text',
                bounds: f.bounds ? { ...f.bounds, x: Number((f.bounds.x + 0.18).toFixed(4)), width: Number((f.bounds.width * 0.6).toFixed(4)) } : null,
                isHandwritten: true,
                source: 'aws_textract'
              });
            }
          }
        }
      }

      pageFields.sort((a, b) => {
        const yDiff = (a.bounds?.y ?? 1) - (b.bounds?.y ?? 1);
        if (Math.abs(yDiff) > 0.005) return yDiff;
        return (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0);
      });

      allFields.push(...pageFields);
      page.fullText = pageFullText.trim();

      // 2. Extract Tables
      for (const block of blocks) {
        if (block.BlockType === 'TABLE' && block.Relationships) {
          const cells = [];
          for (const rel of block.Relationships) {
            if (rel.Type === 'CHILD') {
              for (const cid of rel.Ids) {
                const cell = blockMap.get(cid);
                if (cell && cell.BlockType === 'CELL') {
                  cells.push({
                    row: cell.RowIndex,
                    col: cell.ColumnIndex,
                    text: getText(cell)
                  });
                }
              }
            }
          }

          if (cells.length > 0) {
            const rowMap = new Map();
            cells.forEach(c => {
              if (!rowMap.has(c.row)) rowMap.set(c.row, []);
              rowMap.get(c.row)[c.col - 1] = c.text;
            });
            const sortedRows = Array.from(rowMap.entries())
              .sort((a, b) => a[0] - b[0])
              .map(entry => entry[1]);

            if (sortedRows.length >= 2) {
              allTables.push({
                id: `table_${tableCounter++}`,
                page: pageNum,
                headers: sortedRows[0] || [],
                rows: sortedRows.slice(1) || [],
                confidence: 0.9
              });
            }
          }
        }
      }
    }

    const docType = DynamicExtractor.classifyDocumentType([], combinedFullText);
    const layoutHint = docType === 'early_years_accident' ? 'early_years_accident' : 'dynamic';

    return this.assembleFinalOutput('aws_textract', pages, allFields, allTables, layoutHint);
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

    const isAccident = DynamicExtractor.isEarlyYearsAccident && DynamicExtractor.isEarlyYearsAccident({ fields });
    if (isAccident && typeof this.resultFromAccidentVision === 'function') {
      return this.resultFromAccidentVision('azure', pages, { fields, isAccidentIncidentForm: true });
    }

    return this.assembleFinalOutput('azure', pages, fields, tables);
  }

  static genericDocumentVisionPrompt() {
    return `You are an expert document understanding and data extraction AI.
Analyze the provided document image thoroughly and accurately. Read all printed text, handwritten entries, checkboxes, stamps, signatures, numbers, dates, codes, and table grids.

Extraction Guidelines:
1. Identify the genuine document type (e.g. "invoice", "receipt", "medical_intake", "equipment_inspection", "accident_incident_report", "contract", "tax_form", "generic_form").
2. Extract all key-value pairs and input fields:
   - "label": The printed or intended label of the field (clean, trimmed).
   - "value": The actual filled, typed, or handwritten value in that field. If empty, blank, or unchecked, use "".
   - "type": "text" | "number" | "date" | "address" | "checkbox" | "multiline".
   - "confidence": Float between 0.0 and 1.0 reflecting handwriting/text legibility.
   - "bounds": Estimated normalized bounding box { "x": float, "y": float, "width": float, "height": float } between 0.0 and 1.0 relative to page width and height. If unknown or not localized, omit bounds.
   - "isHandwritten": boolean (true if value is handwritten or hand-marked, false if printed).
   - "section": Category or section heading where this field appears (e.g. "Patient Identification", "Invoice Summary", "Sign-Off").
3. Detect all checkboxes and selection marks:
   - "label": The text label describing the checkbox option (e.g. "Male", "Female", "Yes", "No", "Pass", "Fail", "Morning", "Accident").
   - "checked": boolean (true if marked, ticked, crossed, or filled; false if empty or unselected).
   - "confidence": Float between 0.0 and 1.0.
   - "bounds": { "x", "y", "width", "height" } normalized coordinates.
4. Extract all tables:
   - "title": Table title or heading if any.
   - "headers": Array of column header strings.
   - "rows": 2D array of string values for each row and column [[col1, col2, ...], ...].
   - "bounds": { "x", "y", "width", "height" } of the table area.
5. Absolute rules:
   - NEVER invent, hallucinate, or assume missing values.
   - If a box or line is blank, return "" for its value.
   - Accurately preserve numbers, dates, references, currency, phone numbers, and codes exactly as written.

Return strictly valid JSON matching this structure:
{
  "documentType": "string",
  "documentTitle": "string",
  "fields": [
    {
      "label": "string",
      "value": "string",
      "type": "text",
      "confidence": 0.95,
      "bounds": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.04 },
      "isHandwritten": false,
      "section": "General"
    }
  ],
  "checkboxes": [
    {
      "label": "string",
      "checked": false,
      "confidence": 0.9,
      "bounds": { "x": 0.1, "y": 0.3, "width": 0.03, "height": 0.03 }
    }
  ],
  "tables": [
    {
      "title": "string",
      "headers": ["Header 1", "Header 2"],
      "rows": [["Cell 1", "Cell 2"]],
      "bounds": { "x": 0.1, "y": 0.4, "width": 0.8, "height": 0.2 }
    }
  ]
}`;
  }

  static accidentFormVisionPrompt() {
    return this.genericDocumentVisionPrompt();
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
   * Generic, schema-agnostic extraction across arbitrary document pages.
   */
  static async analyzeWithGemini(pages, apiKey) {
    const allFields = [];
    const allTables = [];
    let fieldCounter = 1;
    let tableCounter = 1;
    let detectedDocumentType = 'dynamic';
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const page = pages[pIdx];
      const pageNum = page.pageNumber || (pIdx + 1);
      const visionBuf = await this.encodePageForVision(page.buffer);
      const base64Image = visionBuf.toString('base64');
      const prompt = this.genericDocumentVisionPrompt();

      let lastErr = null;
      let parsed = null;

      for (const model of models) {
        try {
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
            const errText = await response.text();
            lastErr = new Error(`Gemini (${model}) API error: ${response.status} - ${errText}`);
            continue;
          }

          const jsonRes = await response.json();
          const candidateText = jsonRes.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!candidateText) {
            lastErr = new Error(`Empty response from Gemini (${model})`);
            continue;
          }

          parsed = JSON.parse(candidateText);
          break;
        } catch (e) {
          lastErr = e;
        }
      }

      if (!parsed) {
        console.warn(`Gemini analysis on page ${pageNum} encountered an error:`, lastErr?.message);
        continue;
      }

      if (parsed.documentType && detectedDocumentType === 'dynamic') {
        detectedDocumentType = parsed.documentType;
      }

      // Check if this page is specifically an Early Years Accident form
      const isEyAccident = pIdx === 0 && (
        parsed.documentType === 'early_years_accident' ||
        (DynamicExtractor.isEarlyYearsAccident && DynamicExtractor.isEarlyYearsAccident(parsed))
      );

      if (isEyAccident && typeof DynamicExtractor.buildEarlyYearsFormFieldsFromVision === 'function') {
        const ey = DynamicExtractor.buildEarlyYearsFormFieldsFromVision(parsed, {
          pageNum,
          startCounter: fieldCounter
        });
        allFields.push(...ey.fields);
        fieldCounter += ey.fields.length;
        detectedDocumentType = 'early_years_accident';
        page.fullText = page.fullText || JSON.stringify(parsed.values || {});
        continue;
      }

      // 1. Generic Fields
      for (const f of parsed.fields || []) {
        const val = f.value !== undefined && f.value !== null ? String(f.value).trim() : '';
        const conf = typeof f.confidence === 'number' ? Math.max(0.1, Math.min(1.0, f.confidence)) : 0.88;
        const isBlank = !val;
        const b = (f.bounds && typeof f.bounds.x === 'number') ? {
          x: Number(f.bounds.x.toFixed(4)),
          y: Number(f.bounds.y.toFixed(4)),
          width: Number(f.bounds.width.toFixed(4)),
          height: Number(f.bounds.height.toFixed(4))
        } : null;

        allFields.push({
          id: `field_${fieldCounter++}`,
          label: f.label || `Field ${fieldCounter}`,
          value: val,
          originalOcrValue: val,
          page: pageNum,
          section: f.section || 'Extracted Fields',
          confidence: Number(conf.toFixed(3)),
          verified: conf >= 0.88,
          needsVerification: !isBlank && conf < 0.85,
          isUnreadable: !!f.isUnreadable || (!isBlank && conf < 0.5),
          isBlank,
          type: f.type || this.detectFieldType(f.label, val),
          bounds: b,
          isHandwritten: f.isHandwritten !== undefined ? !!f.isHandwritten : false,
          source: 'gemini_vision'
        });
      }

      // 2. Generic Checkboxes
      for (const cb of parsed.checkboxes || []) {
        const checked = cb.checked === true || ['true', 'yes', '1', 'checked'].includes(String(cb.value || '').toLowerCase());
        const conf = typeof cb.confidence === 'number' ? Math.max(0.1, Math.min(1.0, cb.confidence)) : 0.88;
        const b = (cb.bounds && typeof cb.bounds.x === 'number') ? {
          x: Number(cb.bounds.x.toFixed(4)),
          y: Number(cb.bounds.y.toFixed(4)),
          width: Number(cb.bounds.width.toFixed(4)),
          height: Number(cb.bounds.height.toFixed(4))
        } : null;

        allFields.push({
          id: `field_${fieldCounter++}`,
          label: cb.label || 'Checkbox',
          value: checked ? 'true' : 'false',
          originalOcrValue: checked ? '[X] Checked' : '[ ] Unchecked',
          page: pageNum,
          section: cb.section || 'Options',
          confidence: Number(conf.toFixed(3)),
          verified: conf >= 0.88,
          needsVerification: conf < 0.85,
          isUnreadable: false,
          isBlank: false,
          type: 'checkbox',
          bounds: b,
          isHandwritten: true,
          source: 'gemini_checkbox'
        });
      }

      // 3. Generic Tables
      for (const tbl of parsed.tables || []) {
        const b = (tbl.bounds && typeof tbl.bounds.x === 'number') ? {
          x: Number(tbl.bounds.x.toFixed(4)),
          y: Number(tbl.bounds.y.toFixed(4)),
          width: Number(tbl.bounds.width.toFixed(4)),
          height: Number(tbl.bounds.height.toFixed(4))
        } : null;

        allTables.push({
          id: `table_${tableCounter++}`,
          page: pageNum,
          title: tbl.title || `Detected Table ${tableCounter - 1}`,
          headers: Array.isArray(tbl.headers) ? tbl.headers : [],
          rows: Array.isArray(tbl.rows) ? tbl.rows : [],
          bounds: b,
          source: 'gemini_table'
        });
      }

      page.fullText = (parsed.fields || []).map(f => `${f.label}: ${f.value}`).join('\n');
    }

    if (allFields.length === 0 && pages.length > 0) {
      throw new Error('Gemini vision analysis yielded no fields; falling back to local engine');
    }

    return this.assembleFinalOutput('gemini', pages, allFields, allTables, detectedDocumentType);
  }

  /**
   * 3. Vision-Language Model Interpretation (OpenAI Vision)
   * Generic, schema-agnostic extraction across arbitrary document pages.
   */
  static async analyzeWithOpenAI(pages, apiKey) {
    const allFields = [];
    const allTables = [];
    let fieldCounter = 1;
    let tableCounter = 1;
    let detectedDocumentType = 'dynamic';

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const page = pages[pIdx];
      const pageNum = page.pageNumber || (pIdx + 1);
      const visionBuf = await this.encodePageForVision(page.buffer);
      const base64Image = visionBuf.toString('base64');
      const prompt = this.genericDocumentVisionPrompt();

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
      const parsed = JSON.parse(content || '{}');

      if (parsed.documentType && detectedDocumentType === 'dynamic') {
        detectedDocumentType = parsed.documentType;
      }

      const isEyAccident = pIdx === 0 && (
        parsed.documentType === 'early_years_accident' ||
        (DynamicExtractor.isEarlyYearsAccident && DynamicExtractor.isEarlyYearsAccident(parsed))
      );

      if (isEyAccident && typeof DynamicExtractor.buildEarlyYearsFormFieldsFromVision === 'function') {
        const ey = DynamicExtractor.buildEarlyYearsFormFieldsFromVision(parsed, {
          pageNum,
          startCounter: fieldCounter
        });
        allFields.push(...ey.fields);
        fieldCounter += ey.fields.length;
        detectedDocumentType = 'early_years_accident';
        page.fullText = page.fullText || JSON.stringify(parsed.values || {});
        continue;
      }

      for (const f of parsed.fields || []) {
        const val = f.value !== undefined && f.value !== null ? String(f.value).trim() : '';
        const conf = typeof f.confidence === 'number' ? Math.max(0.1, Math.min(1.0, f.confidence)) : 0.88;
        const isBlank = !val;
        const b = (f.bounds && typeof f.bounds.x === 'number') ? {
          x: Number(f.bounds.x.toFixed(4)),
          y: Number(f.bounds.y.toFixed(4)),
          width: Number(f.bounds.width.toFixed(4)),
          height: Number(f.bounds.height.toFixed(4))
        } : null;

        allFields.push({
          id: `field_${fieldCounter++}`,
          label: f.label || `Field ${fieldCounter}`,
          value: val,
          originalOcrValue: val,
          page: pageNum,
          section: f.section || 'Extracted Fields',
          confidence: Number(conf.toFixed(3)),
          verified: conf >= 0.88,
          needsVerification: !isBlank && conf < 0.85,
          isUnreadable: !!f.isUnreadable || (!isBlank && conf < 0.5),
          isBlank,
          type: f.type || this.detectFieldType(f.label, val),
          bounds: b,
          isHandwritten: f.isHandwritten !== undefined ? !!f.isHandwritten : false,
          source: 'openai_vision'
        });
      }

      for (const cb of parsed.checkboxes || []) {
        const checked = cb.checked === true || ['true', 'yes', '1', 'checked'].includes(String(cb.value || '').toLowerCase());
        const conf = typeof cb.confidence === 'number' ? Math.max(0.1, Math.min(1.0, cb.confidence)) : 0.88;
        const b = (cb.bounds && typeof cb.bounds.x === 'number') ? {
          x: Number(cb.bounds.x.toFixed(4)),
          y: Number(cb.bounds.y.toFixed(4)),
          width: Number(cb.bounds.width.toFixed(4)),
          height: Number(cb.bounds.height.toFixed(4))
        } : null;

        allFields.push({
          id: `field_${fieldCounter++}`,
          label: cb.label || 'Checkbox',
          value: checked ? 'true' : 'false',
          originalOcrValue: checked ? '[X] Checked' : '[ ] Unchecked',
          page: pageNum,
          section: cb.section || 'Options',
          confidence: Number(conf.toFixed(3)),
          verified: conf >= 0.88,
          needsVerification: conf < 0.85,
          isUnreadable: false,
          isBlank: false,
          type: 'checkbox',
          bounds: b,
          isHandwritten: true,
          source: 'openai_checkbox'
        });
      }

      for (const tbl of parsed.tables || []) {
        allTables.push({
          id: `table_${tableCounter++}`,
          page: pageNum,
          title: tbl.title || `Detected Table ${tableCounter - 1}`,
          headers: Array.isArray(tbl.headers) ? tbl.headers : [],
          rows: Array.isArray(tbl.rows) ? tbl.rows : [],
          bounds: (tbl.bounds && typeof tbl.bounds.x === 'number') ? tbl.bounds : null,
          source: 'openai_table'
        });
      }
    }

    if (allFields.length === 0 && pages.length > 0) {
      throw new Error('OpenAI vision analysis yielded no fields; falling back to local engine');
    }

    return this.assembleFinalOutput('openai', pages, allFields, allTables, detectedDocumentType);
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
   * Fast, reliable local page OCR with Tesseract.
   * Performs a clean full-page pass, plus an optional boosted contrast pass if needed.
   */
  static async recognizeWithBands(ocrBuffer, width, height, options = {}) {
    const worker = await this.getWorker();
    const all = [];
    const boostSrc = options.colorBuffer || ocrBuffer;

    try {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '3'
      });

      // Pass 1: Full page standard OCR
      const full = await worker.recognize(ocrBuffer, {}, { blocks: true });
      const fullLines = this.linesFromTesseractResult(full);
      all.push(...fullLines);

      // Pass 2: If sparse or low confidence, run a single adaptive contrast pass
      const needsBoost = fullLines.length < 8 || fullLines.some(l => (l.confidence || 0) < 55);
      if (needsBoost) {
        try {
          const boostBuf = await sharp(boostSrc)
            .normalize()
            .linear(1.3, -20)
            .sharpen({ sigma: 1.0 })
            .png()
            .toBuffer();

          await worker.setParameters({ tessedit_pageseg_mode: '6' });
          const boosted = await worker.recognize(boostBuf, {}, { blocks: true });
          all.push(...this.linesFromTesseractResult(boosted));
        } catch (bErr) {
          // ignore boost failure
        }
      }
    } finally {
      try { await worker.terminate(); } catch (e) { /* ignore */ }
    }

    // Deduplicate near-identical lines
    const deduped = [];
    for (const line of all) {
      const text = String(line.text || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2) continue;
      const y = line.bbox ? line.bbox.y0 : 0;
      const dup = deduped.find(d => {
        const dy = Math.abs((d.bbox?.y0 || 0) - y);
        if (dy >= Math.max(18, height * 0.018)) return false;
        const dt = String(d.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const lt = text.toLowerCase();
        return dt === lt || (dt.length > 8 && lt.length > 8 && (dt.includes(lt) || lt.includes(dt)));
      });

      if (!dup) {
        deduped.push(line);
      } else if ((line.confidence || 0) > (dup.confidence || 0) + 5) {
        Object.assign(dup, line);
      }
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
