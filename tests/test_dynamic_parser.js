const fs = require('fs');
const ImagePreprocessor = require('./services/imagePreprocessor');
const { createWorker } = require('tesseract.js');

function parseDocumentStructure(lines, pageNum, width, height, startCounter) {
  const normLine = (line) => ({
    text: line.text.trim(),
    bbox: line.bbox,
    words: line.words || [],
    x: Math.max(0, line.bbox.x0 / width),
    y: Math.max(0, line.bbox.y0 / height),
    w: Math.min(1.0, (line.bbox.x1 - line.bbox.x0) / width),
    h: Math.min(1.0, (line.bbox.y1 - line.bbox.y0) / height),
    conf: Math.max(0.3, Math.min(0.99, Number(((line.confidence || 75) / 100).toFixed(2))))
  });

  const nLines = lines.map(normLine).filter(l => l.text.length > 0);
  const fields = [];
  const tables = [];
  let counter = startCounter;

  // Detect field type helper
  const detectFieldType = (label, val) => {
    const l = (label || '').toLowerCase();
    const v = String(val || '').toLowerCase();
    if (l.includes('date') || /^\d{1,4}[-./\s]\d{1,2}[-./\s]\d{1,4}$/.test(v)) return 'date';
    if (l.includes('phone') || l.includes('fax') || l.includes('tel') || l.includes('ein') || l.includes('ssn') || l.includes('number') || l.includes('rate') || l.includes('fee') || l.includes('budget') || l.includes('hours') || l.includes('wage') || l.includes('tax') || /^\$|^\d+([.,]\d+)?$/.test(v)) return 'number';
    if (l.includes('address') || l.includes('city') || l.includes('state') || l.includes('street') || l.includes('zip') || l.includes('postcode')) return 'address';
    if (l.includes('signature') || l.includes('sign')) return 'signature';
    if (v.length > 50 || l.includes('narrative') || l.includes('remarks') || l.includes('notes') || l.includes('symptoms')) return 'multiline';
    return 'text';
  };

  let i = 0;
  while (i < nLines.length) {
    const cur = nLines[i];
    const text = cur.text;

    // Filter 1: Page numbers and document version footers
    if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(text) || /^\d+\s*\/\s*\d+$/.test(text) || /^(form\s+rev\b|document\s+id\b|confidential\b)/i.test(text)) {
      i++;
      continue;
    }

    // Filter 2: Pure document definitions, instructional paragraphs at top of forms
    if (/^(aero-dynamics manufacturing|child accident\s*:|child incident\s*:|incident\s*:|accident\s*:|near miss\s*:|an incident also|incidents can range)/i.test(text)) {
      i++;
      continue;
    }

    // Filter 3: Document Title / Section Banners
    // e.g. "SCHEDULE W-ZC: DECLARATION OF AMENDED COMPENSATION", "MASTER PROFESSIONAL SERVICES AGREEMENT", "PART A: PROJECT ORDER"
    const isSectionBanner = (
      /^(schedule\s+[a-z0-9-]+|part\s+[a-z0-9]|section\s+[a-z0-9]|master\s+professional|general\s+terms|declaration\s+of|terms\s+and\s+conditions)\b/i.test(text) ||
      (/^[A-Z0-9\s/&.-]+:\s*[A-Z0-9\s/&.-]+$/.test(text) && !/\d{2,}/.test(text) && text.length > 25 && /(agreement|specification|compensation|order|report|form)/i.test(text))
    );
    if (isSectionBanner) {
      i++;
      continue;
    }

    // 1. Checkboxes
    if (/\[[A-Za-z0-9 _\u2713\u2714\u2717xX]\]?|[□☑☒■☐]|\([xX\s_]\)|\|[xX\s_><]\|/.test(text)) {
      const parts = text.split(/(?=\[[A-Za-z0-9 _\u2713\u2714\u2717xX]?\]?|[□☑☒■☐]|\([xX\s_]\)|\|[xX\s_><]\|)/);
      let itemX = cur.x;
      const stepW = cur.w / Math.max(1, parts.length);

      for (const p of parts) {
        const trimmed = p.trim();
        if (!trimmed || trimmed.length < 2) continue;
        const isChecked = /\[[xXA7\u2713\u2714\u2717]\]?|[☑☒■]|\([xX]\)|\|[xX><]\|/i.test(trimmed);
        const cleanLabel = trimmed.replace(/^(\[[A-Za-z0-9 _\u2713\u2714\u2717xX]?\]?|[□☑☒■☐]|\([xX\s_]\)|\|[xX\s_><]\|)\s*/, '').trim();
        if (cleanLabel.length >= 2) {
          fields.push({
            id: `field_${counter++}`,
            label: cleanLabel,
            value: isChecked ? 'true' : 'false',
            originalOcrValue: isChecked ? '[X] Checked' : '[ ] Unchecked',
            page: pageNum,
            confidence: 0.92,
            verified: true,
            needsVerification: false,
            isUnreadable: false,
            isBlank: false,
            type: 'checkbox',
            bounds: {
              x: itemX,
              y: Math.max(0, cur.y - 0.005),
              width: Math.min(0.25, stepW),
              height: Math.max(0.02, cur.h)
            },
            isHandwritten: true
          });
        }
        itemX += stepW;
      }
      i++;
      continue;
    }

    // 2. Stacked Multi-Column Label-Value Rows
    // Line i has 2+ labels ending with colons (or short header titles), Line i+1 has values without colons
    const colonsInCur = (text.match(/:/g) || []).length;
    if (colonsInCur >= 2 && i + 1 < nLines.length && !nLines[i + 1].text.includes(':')) {
      const nextLine = nLines[i + 1];
      // Segment Line i words into label groups
      const labelGroups = [];
      let currentLabelWords = [];
      for (const w of cur.words) {
        currentLabelWords.push(w);
        if (w.text.endsWith(':')) {
          labelGroups.push(currentLabelWords);
          currentLabelWords = [];
        }
      }
      if (currentLabelWords.length > 0 && labelGroups.length > 0) {
        labelGroups[labelGroups.length - 1].push(...currentLabelWords);
      }

      const isStackedHeader = labelGroups.length >= 2 && labelGroups.every(lg => lg.length <= 6);
      if (isStackedHeader) {
        // Compute label horizontal intervals [minX, maxX]
        const intervals = labelGroups.map((lg, idx) => {
          const minX = lg[0].bbox.x0;
          const maxX = lg[lg.length - 1].bbox.x1;
          const nextMinX = labelGroups[idx + 1] ? labelGroups[idx + 1][0].bbox.x0 : width;
          return {
            label: lg.map(w => w.text).join(' ').replace(/:$/, '').trim(),
            minX,
            maxX,
            splitX: (maxX + nextMinX) / 2
          };
        });

        // Assign nextLine words to each label group
        const assignedWords = Array.from({ length: intervals.length }, () => []);
        for (const w of nextLine.words) {
          const wMid = (w.bbox.x0 + w.bbox.x1) / 2;
          let assignedIdx = intervals.length - 1;
          for (let k = 0; k < intervals.length - 1; k++) {
            if (wMid < intervals[k].splitX) {
              assignedIdx = k;
              break;
            }
          }
          assignedWords[assignedIdx].push(w);
        }

        for (let k = 0; k < intervals.length; k++) {
          const lInfo = intervals[k];
          const wordsForK = assignedWords[k];
          const cleanVal = wordsForK.map(w => w.text).join(' ').trim();
          let bBox;
          if (wordsForK.length > 0) {
            bBox = {
              x: Math.max(0, wordsForK[0].bbox.x0 / width),
              y: nextLine.y,
              width: Math.min(0.5, (wordsForK[wordsForK.length - 1].bbox.x1 - wordsForK[0].bbox.x0) / width),
              height: nextLine.h
            };
          } else {
            bBox = {
              x: Math.max(0, lInfo.minX / width),
              y: nextLine.y,
              width: Math.min(0.4, (lInfo.maxX - lInfo.minX) / width),
              height: nextLine.h
            };
          }

          fields.push({
            id: `field_${counter++}`,
            label: lInfo.label,
            value: cleanVal,
            originalOcrValue: cleanVal,
            page: pageNum,
            confidence: 0.90,
            verified: !!cleanVal,
            needsVerification: !cleanVal,
            isUnreadable: false,
            isBlank: !cleanVal,
            type: detectFieldType(lInfo.label, cleanVal),
            bounds: bBox,
            isHandwritten: true
          });
        }

        i += 2; // consumed both lines
        continue;
      }
    }

    // 3. Tables (Header line followed by data rows)
    const isTableHeader = (
      /\b(item\s*#|component|subsystem|status|measurement|corrective action|prior conditions|hospitalizations|description|qty|rate|deliverable|milestone|condition|hospital|facility)\b/i.test(text) &&
      !text.includes(':') &&
      !/(log|form|report|agreement|sheet)$/i.test(text)
    );

    if (isTableHeader) {
      // Find column header boundaries from cur.words
      // Group header words into columns
      const colHeaders = [];
      let tempWords = [];
      for (let wIdx = 0; wIdx < cur.words.length; wIdx++) {
        const w = cur.words[wIdx];
        tempWords.push(w);
        const nextW = cur.words[wIdx + 1];
        if (!nextW || (nextW.bbox.x0 - w.bbox.x1 > 35) || /^(status|measurement|corrective|qty|rate|deliverable)$/i.test(nextW.text)) {
          colHeaders.push({
            header: tempWords.map(tw => tw.text).join(' '),
            minX: tempWords[0].bbox.x0,
            maxX: tempWords[tempWords.length - 1].bbox.x1
          });
          tempWords = [];
        }
      }

      const headers = colHeaders.length >= 2 ? colHeaders.map(c => c.header) : text.split(/\s{2,}|\t|\|/).map(h => h.trim()).filter(Boolean);
      const tableRows = [];
      const tableTopY = cur.y;
      i++;

      while (i < nLines.length) {
        const rowL = nLines[i];
        if (rowL.text.includes(':') || /^(inspector remarks|current symptoms|remarks|notes|patient signature|form rev|date signed|4\.|5\.)/i.test(rowL.text)) {
          break; // table end
        }
        // Filter noise lines (divider dashes, random characters)
        if (rowL.text.length > 4 && !/^[-—_=. ]+$/.test(rowL.text) && !/^EE———/i.test(rowL.text)) {
          // If we have column intervals, assign row words by horizontal bounds
          if (colHeaders.length >= 2) {
            const cellWords = Array.from({ length: colHeaders.length }, () => []);
            for (const rw of rowL.words) {
              const rwMid = (rw.bbox.x0 + rw.bbox.x1) / 2;
              let bestCol = colHeaders.length - 1;
              for (let c = 0; c < colHeaders.length - 1; c++) {
                const split = (colHeaders[c].maxX + colHeaders[c + 1].minX) / 2;
                if (rwMid < split) {
                  bestCol = c;
                  break;
                }
              }
              cellWords[bestCol].push(rw.text);
            }
            const cells = cellWords.map(cw => cw.join(' ').trim());
            // Only add if row has content
            if (cells.some(c => c.length > 0)) {
              tableRows.push(cells);
            }
          } else {
            let cells = rowL.text.split(/\s{2,}|\t|\|/).map(c => c.trim()).filter(Boolean);
            if (cells.length > 0) tableRows.push(cells);
          }
        }
        i++;
      }

      if (tableRows.length > 0) {
        tables.push({
          id: `table_${tables.length + 1}`,
          page: pageNum,
          title: 'Extracted Document Table',
          headers: headers.length >= 2 ? headers : ['Item / Component', 'Details / Status', 'Notes / Measurement'],
          rows: tableRows,
          bounds: { x: cur.x, y: tableTopY, width: cur.w, height: 0.25 }
        });
      }
      continue;
    }

    // 4. Multiline Free-Text Area (e.g. Symptoms, Remarks, Narrative)
    if (/^(inspector remarks|current symptoms|remarks|notes|narrative|reason for visit)/i.test(text)) {
      const mLabel = text.replace(/:.*$/, '').trim();
      const mLines = [];
      const firstLineVal = text.includes(':') ? text.split(':').slice(1).join(':').trim() : '';
      if (firstLineVal) mLines.push(firstLineVal);

      const mTopY = cur.y;
      i++;
      while (i < nLines.length) {
        const nextL = nLines[i];
        if (nextL.text.includes(':') || /^(patient signature|form rev|date signed|client authorized|signoff date)/i.test(nextL.text)) {
          break;
        }
        if (nextL.text.length > 3) mLines.push(nextL.text);
        i++;
      }
      fields.push({
        id: `field_${counter++}`,
        label: mLabel,
        value: mLines.join(' '),
        originalOcrValue: mLines.join(' '),
        page: pageNum,
        confidence: 0.90,
        verified: true,
        needsVerification: false,
        isUnreadable: false,
        isBlank: mLines.length === 0,
        type: 'multiline',
        bounds: { x: cur.x, y: mTopY, width: cur.w, height: 0.1 },
        isHandwritten: true
      });
      continue;
    }

    // 5. Inline Key-Value Field(s) with Colon(s)
    if (text.includes(':')) {
      // Find colon positions in words
      const colonIndices = [];
      for (let wIdx = 0; wIdx < cur.words.length; wIdx++) {
        if (cur.words[wIdx].text.endsWith(':') || cur.words[wIdx].text === ':') {
          colonIndices.push(wIdx);
        }
      }

      if (colonIndices.length > 0) {
        // For each colon, determine label words and value words
        for (let cIdx = 0; cIdx < colonIndices.length; cIdx++) {
          const colonWordIdx = colonIndices[cIdx];
          const nextColonWordIdx = colonIndices[cIdx + 1];

          // Label words are before colonWordIdx (after previous value)
          let labelStartIdx = 0;
          if (cIdx > 0) {
            // Find start of this label between colonIndices[cIdx - 1] and colonWordIdx
            // Look for horizontal gap or short capitalized title words
            const prevColonIdx = colonIndices[cIdx - 1];
            labelStartIdx = colonWordIdx;
            while (labelStartIdx > prevColonIdx + 1) {
              const prevW = cur.words[labelStartIdx - 1];
              const curW = cur.words[labelStartIdx];
              if (curW.bbox.x0 - prevW.bbox.x1 > 35) {
                break; // gap found!
              }
              // If word has digits or lowercase with special symbols, it's value
              if (/\d|[@#$%]/.test(prevW.text)) {
                break;
              }
              labelStartIdx--;
            }
          }

          const labelWords = cur.words.slice(labelStartIdx, colonWordIdx + 1);
          const cleanLabel = labelWords.map(w => w.text).join(' ').replace(/^[\d.]+\s*/, '').replace(/:$/, '').trim();

          // Value words are from colonWordIdx + 1 up to next label start (or end of line)
          let valEndIdx = cur.words.length;
          if (nextColonWordIdx !== undefined) {
            // Find where next label begins
            let nextLabelStart = nextColonWordIdx;
            while (nextLabelStart > colonWordIdx + 1) {
              const prevW = cur.words[nextLabelStart - 1];
              const curW = cur.words[nextLabelStart];
              if (curW.bbox.x0 - prevW.bbox.x1 > 35 || /\d|[@#$%]/.test(prevW.text)) {
                break;
              }
              nextLabelStart--;
            }
            valEndIdx = nextLabelStart;
          }

          const valWords = cur.words.slice(colonWordIdx + 1, valEndIdx);
          const cleanVal = valWords.map(w => w.text).join(' ').replace(/^[_.\s—|]+/, '').replace(/[_.\s—|]+$/, '').trim();

          if (cleanLabel.length >= 2) {
            let bBox;
            if (valWords.length > 0 && cleanVal) {
              const minValX = valWords[0].bbox.x0;
              const maxValX = valWords[valWords.length - 1].bbox.x1;
              const minValY = Math.min(...valWords.map(w => w.bbox.y0));
              const maxValY = Math.max(...valWords.map(w => w.bbox.y1));
              bBox = {
                x: Math.max(0, minValX / width),
                y: Math.max(0, minValY / height),
                width: Math.min(0.9, (maxValX - minValX) / width),
                height: Math.max(0.02, Math.min(0.1, (maxValY - minValY) / height))
              };
            } else {
              const lastLabelW = labelWords[labelWords.length - 1];
              bBox = {
                x: Math.min(0.85, (lastLabelW.bbox.x1 + 10) / width),
                y: cur.y,
                width: Math.min(0.35, Math.max(0.12, (cur.bbox.x1 - lastLabelW.bbox.x1) / width)),
                height: cur.h
              };
            }

            fields.push({
              id: `field_${counter++}`,
              label: cleanLabel,
              value: cleanVal,
              originalOcrValue: cleanVal,
              page: pageNum,
              confidence: cur.conf,
              verified: cur.conf >= 0.85 && !!cleanVal,
              needsVerification: cur.conf < 0.85 || !cleanVal,
              isUnreadable: cur.conf < 0.50,
              isBlank: !cleanVal,
              type: detectFieldType(cleanLabel, cleanVal),
              bounds: bBox,
              isHandwritten: cur.conf < 0.88
            });
          }
        }
        i++;
        continue;
      }
    }

    // 6. Non-colon Label-Value Pairs (e.g. "Employer Identification Number (EIN) 84-9201948", "Medicare Tax Withheld $1,427.52")
    const valMatch = text.match(/^([A-Za-z\s/()#.-]{3,60})\s+([$§€£]?[\d,.-]+(?:\s*[A-Za-z/]+)?|[A-Z0-9-]{6,})$/);
    if (valMatch) {
      const cleanLabel = valMatch[1].trim();
      const cleanVal = valMatch[2].trim();
      if (cleanLabel.length >= 3 && !/^(total|schedule|part|form|page)/i.test(cleanLabel)) {
        // Value bounds
        const lastWord = cur.words[cur.words.length - 1];
        fields.push({
          id: `field_${counter++}`,
          label: cleanLabel,
          value: cleanVal,
          originalOcrValue: cleanVal,
          page: pageNum,
          confidence: cur.conf,
          verified: cur.conf >= 0.85,
          needsVerification: cur.conf < 0.85,
          isUnreadable: cur.conf < 0.50,
          isBlank: false,
          type: detectFieldType(cleanLabel, cleanVal),
          bounds: {
            x: Math.max(0, (lastWord ? lastWord.bbox.x0 : cur.bbox.x0) / width),
            y: cur.y,
            width: Math.min(0.5, (lastWord ? lastWord.bbox.x1 - lastWord.bbox.x0 : cur.bbox.x1 - cur.bbox.x0) / width),
            height: cur.h
          },
          isHandwritten: cur.conf < 0.88
        });
        i++;
        continue;
      }
    }

    i++;
  }

  return { fields, tables };
}

async function runTests() {
  const worker = await createWorker('eng');

  const testCases = [
    { name: 'Medical Intake', path: './storage/samples/sample_medical_intake.png', type: 'image/png' },
    { name: 'Equipment Inspection', path: './storage/samples/sample_equipment_inspection.png', type: 'image/png' },
    { name: 'Tax Photocopy', path: './storage/samples/sample_tax_photocopy.png', type: 'image/png' },
    { name: 'Contract Page 1 & 2', path: './storage/samples/sample_multipage_contract.pdf', type: 'application/pdf' }
  ];

  for (const tc of testCases) {
    console.log('\n======================================================');
    console.log(`TEST: ${tc.name}`);
    console.log('======================================================');
    const pages = await ImagePreprocessor.extractPages(tc.path, tc.type);
    let totalFields = 0;
    let totalTables = 0;

    for (const p of pages) {
      const ret = await worker.recognize(p.buffer, {}, { blocks: true });
      const lines = [];
      for (const b of ret.data.blocks || []) {
        for (const pr of b.paragraphs || []) {
          for (const l of pr.lines || []) {
            const words = (l.words || []).map(w => ({
              text: w.text.trim(),
              bbox: w.bbox,
              confidence: w.confidence
            })).filter(w => w.text.length > 0);
            lines.push({
              text: l.text.trim(),
              bbox: l.bbox,
              confidence: l.confidence,
              words
            });
          }
        }
      }

      const res = parseDocumentStructure(lines, p.pageNumber, p.width, p.height, totalFields + 1);
      totalFields += res.fields.length;
      totalTables += res.tables.length;

      console.log(`Page ${p.pageNumber}: ${res.fields.length} fields, ${res.tables.length} tables`);
      console.log('Fields:');
      for (const f of res.fields) {
        console.log(`  - [${f.type}] "${f.label}" => "${f.value}" (x: ${f.bounds.x.toFixed(3)}, w: ${f.bounds.width.toFixed(3)})`);
      }
      if (res.tables.length > 0) {
        console.log('Table headers:', res.tables[0].headers);
        console.log('Table rows:', res.tables[0].rows);
      }
    }
  }

  await worker.terminate();
}

runTests().catch(console.error);
