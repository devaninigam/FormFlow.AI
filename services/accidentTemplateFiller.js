const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

/**
 * Accident Report Master Template Filler
 * Injects extracted and verified fields into the official
 * "Accident Report Template.docx" — same rows, columns, and checkbox cells.
 */
class AccidentTemplateFiller {
  static isAccidentReport(docData) {
    if (!docData) return false;
    const title = (docData.documentTitle || docData.filename || '').toLowerCase();
    if (/accident|incident|injury|riddor|example\s*[12]/i.test(title)) return true;

    const fields = docData.fields || [];
    return fields.some(f => /riddor|injury|incident|cause|ey staff|daycare|toybox/i.test(f.label || ''));
  }

  static async fillDocx(docData) {
    const templatePath = path.join(__dirname, '../templates/accident_report_template.docx');
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Master template not found at ${templatePath}`);
    }

    const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
    let xml = await zip.file('word/document.xml').async('text');

    const fields = docData.fields || [];

    const getVal = (regex, fallback = '') => {
      const f = fields.find(item => regex.test(item.label || ''));
      if (!f || f.value === undefined || f.value === null) return fallback;
      const v = String(f.value).trim();
      return v !== '' ? v : fallback;
    };

    const isChecked = (regex) => {
      const f = fields.find(item => regex.test(item.label || ''));
      if (!f || f.value === undefined || f.value === null) return false;
      const val = String(f.value).toLowerCase().trim();
      return ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(val);
    };

    const vRefNo = getVal(/ref\s*no|reference/i, '');
    const vFormDate = getVal(/^form date$/i, getVal(/form date/i, ''));
    const vProject = getVal(/project name|project/i, '');
    const vAddress = getVal(/building address/i, '');
    const vName = getVal(/name of the person|person involved/i, '');
    const vDob = getVal(/d\.o\.b|date of birth/i, '');
    const vAge = getVal(/^age$/i, '');
    const vRegAddress = getVal(/registered address/i, '');
    const vPostcode = getVal(/postcode|zip/i, '');
    const vAdult = getVal(/responsible adult/i, '');
    const vContact = getVal(/contact number|phone/i, '');
    const vSession = getVal(/session/i, '');
    const vIncDate = getVal(/^incident date$/i, getVal(/incident date/i, vFormDate));
    const vIncTime = getVal(/incident time|^time$/i, '');
    const vLocation = getVal(/space|location|room/i, '');
    const vNarrative = getVal(/narrative|description|details of what happened/i, '');
    const vCompletedBy = getVal(/completed by/i, '');
    const vPosition = getVal(/position/i, '');
    const vSignature = getVal(/signature \(reporter\)|^signature$/i, getVal(/signature/i, ''));
    const vDateSigned = getVal(/date signed/i, '');

    const escapeXml = (str) => String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    /** Replace every <w:t> text node that exactly matches oldText */
    const replaceExactText = (oldText, newText) => {
      const esc = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      xml = xml.replace(
        new RegExp(`(<w:t(?: xml:space="preserve")?>)${esc}(</w:t>)`, 'g'),
        `$1${escapeXml(newText)}$2`
      );
    };

    /**
     * Find a label in a cell, then set the FIRST text run in the NEXT table cell.
     * Used for: Ref No -> value, DATE -> value, D.O.B -> value, etc.
     */
    const setNextCellValue = (labelNeedle, value) => {
      if (value === undefined || value === null) return;
      const idx = xml.indexOf(labelNeedle);
      if (idx === -1) return;

      const labelCellEnd = xml.indexOf('</w:tc>', idx);
      if (labelCellEnd === -1) return;

      const nextTcStart = xml.indexOf('<w:tc>', labelCellEnd);
      if (nextTcStart === -1) return;
      const nextTcEnd = xml.indexOf('</w:tc>', nextTcStart);
      if (nextTcEnd === -1) return;

      let cell = xml.substring(nextTcStart, nextTcEnd + '</w:tc>'.length);
      if (/<w:t[\s>]/.test(cell)) {
        cell = cell.replace(
          /(<w:t(?: xml:space="preserve")?>)[\s\S]*?(<\/w:t>)/,
          `$1${escapeXml(value)}$2`
        );
        // Clear any remaining extra text runs in that cell (keep first only meaningful)
        let first = true;
        cell = cell.replace(/<w:t(?: xml:space="preserve")?>[\s\S]*?<\/w:t>/g, (m) => {
          if (first) {
            first = false;
            return m;
          }
          return '<w:t></w:t>';
        });
      } else {
        cell = cell.replace(
          /(<w:p[^>]*>)/,
          `$1<w:r><w:t>${escapeXml(value)}</w:t></w:r>`
        );
      }
      xml = xml.substring(0, nextTcStart) + cell + xml.substring(nextTcEnd + '</w:tc>'.length);
    };

    /**
     * Replace content that shares a cell with a label prefix.
     * e.g. "BUILDING ADDRESS 6c wildflower..." or "NAME  NICSS"
     */
    const setInlineAfterLabel = (labelRegex, value) => {
      xml = xml.replace(labelRegex, (match, prefix, suffix) => {
        return `${prefix}${escapeXml(value)}${suffix || ''}`;
      });
    };

    /**
     * Set checkbox mark in the cell immediately AFTER the label cell.
     * Template stores marks as "x" or empty / non-breaking space.
     */
    const setCheck = (keyword, checked) => {
      const mark = checked ? 'x' : '';
      let searchFrom = 0;
      while (true) {
        const kwIdx = xml.indexOf(keyword, searchFrom);
        if (kwIdx === -1) return;

        // Prefer the cell that contains this keyword, then the next sibling cell
        const labelCellEnd = xml.indexOf('</w:tc>', kwIdx);
        if (labelCellEnd === -1 || labelCellEnd > kwIdx + 800) {
          searchFrom = kwIdx + keyword.length;
          continue;
        }

        const tcStart = xml.indexOf('<w:tc>', labelCellEnd);
        const tcEnd = xml.indexOf('</w:tc>', tcStart);
        if (tcStart === -1 || tcEnd === -1 || tcStart > labelCellEnd + 50) {
          searchFrom = kwIdx + keyword.length;
          continue;
        }

        let cellXml = xml.substring(tcStart, tcEnd);
        // Only touch small checkbox cells (avoid writing into large content cells)
        if (cellXml.length < 1200) {
          if (/<w:t[\s>]/.test(cellXml)) {
            cellXml = cellXml.replace(
              /(<w:t(?: xml:space="preserve")?>)[\s\S]*?(<\/w:t>)/,
              `$1${mark === '' ? '&#160;' : mark}$2`
            );
          } else if (mark) {
            cellXml = cellXml.replace(/(<w:p[^>]*>)/, `$1<w:r><w:t>${mark}</w:t></w:r>`);
          }
          xml = xml.substring(0, tcStart) + cellXml + xml.substring(tcEnd);
          return;
        }
        searchFrom = kwIdx + keyword.length;
      }
    };

    // -------------------------------------------------------------------------
    // 1) Clear known sample placeholder values from the master template
    // -------------------------------------------------------------------------
    replaceExactText('Hemant Mehta', vName || '');
    replaceExactText('16/07/1993', vDob || '');
    replaceExactText('BTBT12', vPostcode || '');
    replaceExactText('Working day', vSession || '');
    replaceExactText('Slipped and banged his head', vNarrative || '');
    replaceExactText('belfast', '');
    replaceExactText(', BT11BT', '');
    replaceExactText('       -09/09/26       -     ', vFormDate || '');
    replaceExactText('09 -  09 - 26', vIncDate || '');

    // -------------------------------------------------------------------------
    // 2) Label → next-cell value fills (canonical form grid)
    // -------------------------------------------------------------------------
    setNextCellValue('Ref No', vRefNo);
    setNextCellValue('Name of the person involved', vName);
    setNextCellValue('O.B</w:t>', vDob);
    setNextCellValue('Registered Address', vRegAddress);
    setNextCellValue('Postcode', vPostcode);

    // Responsible Adult sits alone at end of its row — keep value in the same cell
    if (vAdult) {
      xml = xml.replace(
        '<w:t>Responsible Adult</w:t>',
        `<w:t xml:space="preserve">Responsible Adult: ${escapeXml(vAdult)}</w:t>`
      );
    }

    // Contact Number → next cell (phone value)
    setNextCellValue('Contact Number', vContact);

    // Form DATE (first DATE label under ABOUT THIS FORM)
    {
      const aboutForm = xml.indexOf("ABOUT THIS FORM");
      if (aboutForm !== -1 && vFormDate) {
        const dateLabel = xml.indexOf('>DATE</w:t>', aboutForm);
        if (dateLabel !== -1 && dateLabel < aboutForm + 2500) {
          const labelCellEnd = xml.indexOf('</w:tc>', dateLabel);
          const nextTcStart = xml.indexOf('<w:tc>', labelCellEnd);
          const nextTcEnd = xml.indexOf('</w:tc>', nextTcStart);
          if (nextTcStart !== -1 && nextTcEnd !== -1) {
            let cell = xml.substring(nextTcStart, nextTcEnd + 7);
            cell = cell.replace(/<w:t(?: xml:space="preserve")?>[\s\S]*?<\/w:t>/g, '<w:t></w:t>');
            cell = cell.replace(/(<w:t(?: xml:space="preserve")?>)(<\/w:t>)/, `$1${escapeXml(vFormDate)}$2`);
            xml = xml.substring(0, nextTcStart) + cell + xml.substring(nextTcEnd + 7);
          }
        }
      }
    }

    // Project name lives as "NAME  NICSS" in a text run
    setInlineAfterLabel(
      /(<w:t[^>]*>NAME\s+)[^<]*(<\/w:t>)/,
      vProject
    );

    // Building address: label + sample street in same / adjacent runs
    setInlineAfterLabel(
      /(<w:t[^>]*>BUILDING ADDRESS\s*)[^<]*(<\/w:t>)/,
      vAddress
    );

    // Session
    if (vSession) {
      replaceExactText('Working day', vSession);
      // In case already cleared above
      xml = xml.replace(
        /(<w:t[^>]*>SESSION<\/w:t>[\s\S]{0,400}?<w:t(?: xml:space="preserve")?>)[^<]*(<\/w:t>)/,
        `$1${escapeXml(vSession)}$2`
      );
    }

    // Incident DATE / TIME / SPACE — rebuild SPACE run
    xml = xml.replace(
      /<w:t>SPACE\s*[^<]*<\/w:t>/,
      `<w:t>SPACE    ${escapeXml(vLocation || '')}</w:t>`
    );

    // TIME cell often only contains ":"
    if (vIncTime) {
      // Prefer replacing the TIME label's next cell
      const timeIdx = xml.indexOf('>TIME</w:t>');
      if (timeIdx !== -1) {
        const labelCellEnd = xml.indexOf('</w:tc>', timeIdx);
        const nextTcStart = xml.indexOf('<w:tc>', labelCellEnd);
        const nextTcEnd = xml.indexOf('</w:tc>', nextTcStart);
        if (nextTcStart !== -1 && nextTcEnd !== -1) {
          let cell = xml.substring(nextTcStart, nextTcEnd + 7);
          if (/<w:t[\s>]/.test(cell)) {
            cell = cell.replace(
              /(<w:t(?: xml:space="preserve")?>)[\s\S]*?(<\/w:t>)/,
              `$1${escapeXml(vIncTime)}$2`
            );
          } else {
            cell = cell.replace(/(<w:p[^>]*>)/, `$1<w:r><w:t>${escapeXml(vIncTime)}</w:t></w:r>`);
          }
          xml = xml.substring(0, nextTcStart) + cell + xml.substring(nextTcEnd + 7);
        }
      }
    }

    // Incident date fragments — put value into the DATE cell after ABOUT THE INCIDENT
    // (second DATE occurrence after ABOUT THE INCIDENT banner)
    const incidentBanner = xml.indexOf('ABOUT THE INCIDENT');
    if (incidentBanner !== -1 && vIncDate) {
      const dateLabel = xml.indexOf('>DATE</w:t>', incidentBanner);
      if (dateLabel !== -1) {
        const labelCellEnd = xml.indexOf('</w:tc>', dateLabel);
        const nextTcStart = xml.indexOf('<w:tc>', labelCellEnd);
        const nextTcEnd = xml.indexOf('</w:tc>', nextTcStart);
        if (nextTcStart !== -1 && nextTcEnd !== -1) {
          let cell = xml.substring(nextTcStart, nextTcEnd + 7);
          // Wipe all text runs then set first
          cell = cell.replace(/<w:t(?: xml:space="preserve")?>[\s\S]*?<\/w:t>/g, '<w:t></w:t>');
          cell = cell.replace(
            /(<w:t(?: xml:space="preserve")?>)(<\/w:t>)/,
            `$1${escapeXml(vIncDate)}$2`
          );
          xml = xml.substring(0, nextTcStart) + cell + xml.substring(nextTcEnd + 7);
        }
      }
    }

    // Narrative
    if (vNarrative) {
      replaceExactText('Slipped and banged his head', vNarrative);
      xml = xml.replace(
        /(<w:t[^>]*>NARRATIVE<\/w:t>[\s\S]{0,800}?<w:t(?: xml:space="preserve")?>)[^<]*(<\/w:t>)/,
        `$1${escapeXml(vNarrative)}$2`
      );
    }

    // Completion & sign-off (text is often split across runs)
    if (vCompletedBy) {
      xml = xml.replace(
        /(<w:t xml:space="preserve">BY\s*<\/w:t><\/w:r>)[\s\S]{0,400}?(<\/w:p>)/,
        `$1<w:r><w:t>${escapeXml(vCompletedBy)}</w:t></w:r>$2`
      );
      // Fallback: replace remaining Hemant/Mehta fragments
      replaceExactText('Hemant', vCompletedBy);
      xml = xml.replace(/<w:t xml:space="preserve"> Mehta<\/w:t>/g, '<w:t></w:t>');
      xml = xml.replace(/<w:t> Mehta<\/w:t>/g, '<w:t></w:t>');
    }

    if (vPosition) {
      xml = xml.replace(
        /(<w:t[^>]*>POSITION\s*)[^<]*(<\/w:t>)/,
        `$1${escapeXml(vPosition)}$2`
      );
    }

    // SIGNED / DATE in completion block (avoid PARENT / GUARDIAN blank lines)
    {
      const completedIdx = xml.indexOf('FORM COMPLETED');
      if (completedIdx !== -1) {
        const parentIdx = xml.indexOf('PARENT / GUARDIAN', completedIdx);
        const blockEnd = parentIdx === -1 ? xml.length : parentIdx;
        let block = xml.substring(completedIdx, blockEnd);

        if (vSignature) {
          block = block.replace(/<w:t>H<\/w:t>/, `<w:t>${escapeXml(vSignature)}</w:t>`);
          block = block.replace(/<w:t>emant<\/w:t>/g, '<w:t></w:t>');
          block = block.replace(
            /(<w:t[^>]*>SIGNED\s*)[^<]*(<\/w:t>)/,
            `$1${escapeXml(vSignature)}$2`
          );
        }
        if (vDateSigned) {
          block = block.replace(
            /(<w:t[^>]*>DATE\s*)[^<]*(<\/w:t>)/,
            `$1${escapeXml(vDateSigned)}$2`
          );
        }
        if (vCompletedBy) {
          block = block.replace(/<w:t>Hemant<\/w:t>/g, `<w:t>${escapeXml(vCompletedBy)}</w:t>`);
          block = block.replace(/<w:t xml:space="preserve"> Mehta<\/w:t>/g, '<w:t></w:t>');
          block = block.replace(/<w:t> Mehta<\/w:t>/g, '<w:t></w:t>');
        }

        xml = xml.substring(0, completedIdx) + block + xml.substring(blockEnd);
      }
    }

    // -------------------------------------------------------------------------
    // 3) Checkboxes — clear sample marks, then apply verified values
    // -------------------------------------------------------------------------
    const checkboxLabels = [
      'EY Staff',
      'Non EY',
      'Visitor',
      'Parent',
      'Daycare',
      'ToyBox',
      'SureStart',
      'ACCIDENT',
      'INCIDENT',
      'NEAR MISS',
      'RIDDOR',
      'MODERATE',
      'MINOR',
      'DANGEROUS OCCURRENCE',
      'REPORTABLE DISEASE',
      'INJURY TO PUBLIC',
      'INJURY 3 DAYS',
      'MAJOR INJURY',
      'DEATH',
      'PEER',
      'EQUIPMENT',
      'UNKNOWN',
      'SLIP/TRIP/FALL',
      'COSHH',
      'TRAFFIC',
      'MANUAL HANDLING',
      'CHOKING',
      'VENUE',
      'ABRASION / SMALL CUT / LIGHT BLEED',
      'BRUISE / SWELLING / REDNESS',
      'STRAIN / DISLOCATION',
      'FRACTURE / BROKEN BONE',
      'INJURY TO HEAD / FACE',
      'SENSORY LOSS',
      'LOSS OF CONSCIOUSNESS',
      'ORGAN INJURY / OPEN WOUND',
      'PROPERTY DAMAGE (INC VEHICLE)',
      'EMOTIONAL DISTRESS',
      'RETURN TO ACTIVITIES',
      'FIRST AID APPLIED',
      'TO RESPONSIBLE ADULT CARE',
      'NIAS CALLED',
      'HOSPITAL ADMITTANCE',
      'EMOTIONAL SUPPORT'
    ];

    // Clear all first
    for (const label of checkboxLabels) {
      setCheck(label, false);
    }

    // Staff
    setCheck('EY Staff', isChecked(/staff:\s*ey staff/i));
    setCheck('Non EY', isChecked(/staff:\s*non ey/i));
    setCheck('Visitor', isChecked(/staff:\s*visitor/i));
    setCheck('Parent', isChecked(/staff:\s*parent/i));

    // Child
    setCheck('Daycare', isChecked(/child status:\s*daycare|daycare/i));
    setCheck('ToyBox', isChecked(/child status:\s*toybox|toybox/i));
    setCheck('SureStart', isChecked(/child status:\s*surestart|surestart/i));

    // Type
    setCheck('ACCIDENT', isChecked(/incident type:\s*accident/i));
    setCheck('INCIDENT', isChecked(/incident type:\s*incident/i));
    setCheck('NEAR MISS', isChecked(/incident type:\s*near miss|near miss/i));

    // Severity
    setCheck('RIDDOR', isChecked(/severity.*riddor|^severity riddor/i));
    setCheck('MODERATE', isChecked(/severity.*moderate|severity riddor.*moderate/i) || /moderate/i.test(getVal(/severity/i, '')));
    setCheck('MINOR', isChecked(/severity.*minor/i));

    // RIDDOR details
    setCheck('DANGEROUS OCCURRENCE', isChecked(/dangerous occurrence/i));
    setCheck('REPORTABLE DISEASE', isChecked(/reportable disease/i));
    setCheck('INJURY TO PUBLIC', isChecked(/injury to public/i));
    setCheck('INJURY 3 DAYS', isChecked(/injury 3 days/i));
    setCheck('MAJOR INJURY', isChecked(/major injury/i));
    setCheck('DEATH', isChecked(/riddor:\s*death|^death$/i));

    // Cause
    setCheck('PEER', isChecked(/contact with.*peer/i));
    setCheck('EQUIPMENT', isChecked(/cause:\s*equipment/i));
    setCheck('UNKNOWN', isChecked(/cause:\s*unknown/i));
    setCheck('SLIP/TRIP/FALL', isChecked(/slip.*trip.*fall/i));
    setCheck('COSHH', isChecked(/coshh/i));
    setCheck('TRAFFIC', isChecked(/cause:\s*traffic|traffic/i));
    setCheck('MANUAL HANDLING', isChecked(/manual handling/i));
    setCheck('CHOKING', isChecked(/choking/i));
    setCheck('VENUE', isChecked(/cause:\s*venue|venue/i));

    // Injury type
    setCheck('ABRASION / SMALL CUT / LIGHT BLEED', isChecked(/abrasion|cut/i));
    setCheck('BRUISE / SWELLING / REDNESS', isChecked(/bruise|redness/i));
    setCheck('STRAIN / DISLOCATION', isChecked(/strain|dislocation/i));
    setCheck('FRACTURE / BROKEN BONE', isChecked(/fracture/i));
    setCheck('INJURY TO HEAD / FACE', isChecked(/injury to head|head \/ face/i));
    setCheck('SENSORY LOSS', isChecked(/sensory loss/i));
    setCheck('LOSS OF CONSCIOUSNESS', isChecked(/consciousness/i));
    setCheck('ORGAN INJURY / OPEN WOUND', isChecked(/organ injury/i));
    setCheck('PROPERTY DAMAGE (INC VEHICLE)', isChecked(/property damage/i));
    setCheck('EMOTIONAL DISTRESS', isChecked(/emotional distress/i));

    // Outcome
    setCheck('RETURN TO ACTIVITIES', isChecked(/return to activities/i));
    setCheck('FIRST AID APPLIED', isChecked(/first aid/i));
    setCheck('TO RESPONSIBLE ADULT CARE', isChecked(/responsible adult care/i));
    setCheck('NIAS CALLED', isChecked(/nias called/i));
    setCheck('HOSPITAL ADMITTANCE', isChecked(/hospital admittance/i));
    setCheck('EMOTIONAL SUPPORT', isChecked(/emotional support/i));

    zip.file('word/document.xml', xml);
    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });
  }
}

module.exports = AccidentTemplateFiller;
