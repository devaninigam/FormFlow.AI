const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');

/**
 * Accident Report Clean Master Vector PDF Generator
 * Renders the authentic, multi-column master form layout directly to vector PDF
 * and produces a matching high-resolution preview canvas.
 */
class AccidentReportPdfGenerator {
  static async generate(docData) {
    const fields = docData.fields || [];

    const getVal = (regex, fallback = '') => {
      const f = fields.find(item => item && item.label && regex.test(item.label));
      if (!f || f.value === undefined || f.value === null) return fallback;
      const v = String(f.value).trim();
      return v !== '' ? v : fallback;
    };

    const isChecked = (regex) => {
      const f = fields.find(item => item && item.label && regex.test(item.label) && (item.type === 'checkbox' || ['true', 'false'].includes(String(item.value).toLowerCase())));
      if (!f || f.value === undefined || f.value === null) return false;
      const v = String(f.value).toLowerCase().trim();
      return ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(v);
    };

    const refNo = getVal(/ref\s*no|reference/i, '');
    const formDate = getVal(/^form date/i, '');
    const project = getVal(/project name|project/i, '');
    const address = getVal(/building address|address/i, '');

    const name = getVal(/name of the person/i, '');
    const dob = getVal(/d\.o\.b|date of birth/i, '');
    const age = getVal(/^age/i, '');
    const regAddress = getVal(/registered address/i, '');
    const postcode = getVal(/postcode/i, '');
    const contact = getVal(/contact number/i, '');
    const adult = getVal(/responsible adult/i, '');
    const session = getVal(/session/i, '');

    const incDate = getVal(/^incident date/i, '');
    const incTime = getVal(/incident time|^time/i, '');
    const location = getVal(/space|location|room/i, '');

    const narrative = getVal(/narrative/i, '');
    const completedBy = getVal(/completed by/i, '');
    const position = getVal(/position/i, '');
    const signature = getVal(/signature/i, '');
    const dateSigned = getVal(/date signed/i, '');
    const parentSigned = getVal(/parent signed|parent.*guardian/i, '');
    const parentDate = getVal(/parent.*date/i, '');
    const parentTime = getVal(/parent.*time/i, '');
    const comments = getVal(/comments/i, '');

    // Create Canvas for high-res preview and vector PDF simultaneously
    const scale = 2;
    const cWidth = 850 * scale;
    const cHeight = 1150 * scale;
    const canvas = createCanvas(cWidth, cHeight);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // White paper background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 850, 1150);

    const marginX = 36;
    const contentW = 850 - marginX * 2;
    let y = 32;

    // 1. Document Title
    ctx.fillStyle = '#1E3A5F';
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ACCIDENT & INCIDENT REPORT FORM', 850 / 2, y + 16);
    y += 26;

    // Subtitle
    ctx.fillStyle = '#64748B';
    ctx.font = '600 9px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`FILLED FROM MASTER TEMPLATE LAYOUT • SOURCE: ${docData.filename || 'Example 2.pdf'} • ${new Date().toLocaleDateString()}`, 850 / 2, y + 8);
    y += 18;

    // Instructions Box
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(marginX, y, contentW, 58, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 8px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Incidents can range from minor near misses to severe accidents resulting in injuries, fatalities, or significant damage.', marginX + 10, y + 12);

    ctx.font = '500 7.5px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('• Child Accident: Unintended injury to a child, e.g. through play or lack of spatial awareness.', marginX + 10, y + 22);
    ctx.fillText('• Child Incident: Intended injury to another child, this includes when a child is acting because of an emotional response.', marginX + 10, y + 31);
    ctx.fillText('• Incident: Any unplanned event that disrupts normal operations or poses a risk to employees, equipment, or the environment.', marginX + 10, y + 40);
    ctx.fillText('• Accident: A discrete, identifiable, and unintended event arising out of or in connection with work causing injury.', marginX + 10, y + 49);
    y += 66;

    // Helper functions for drawing clean form tables
    const drawBanner = (title) => {
      ctx.fillStyle = '#1E3A5F';
      ctx.fillRect(marginX, y, contentW, 19);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9.5px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(title.toUpperCase(), marginX + 10, y + 13.5);
      y += 19;
    };

    const drawGridRow = (cells, rowH = 22) => {
      let curX = marginX;
      for (const cell of cells) {
        const cellW = (cell.pct / 100) * contentW;
        ctx.fillStyle = cell.isHdr ? '#E8EEF7' : (cell.bg || '#FFFFFF');
        ctx.fillRect(curX, y, cellW, rowH);

        ctx.strokeStyle = '#1E3A5F';
        ctx.lineWidth = 1;
        ctx.strokeRect(curX, y, cellW, rowH);

        if (cell.text !== undefined && cell.text !== null) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(curX + 1, y + 1, cellW - 2, rowH - 2);
          ctx.clip();

          ctx.fillStyle = cell.isHdr ? '#1E3A5F' : (cell.color || '#0F172A');
          let fSize = cell.isHdr ? 8 : (cell.fontSize || 9);
          ctx.font = `bold ${fSize}px "Segoe UI", Arial, sans-serif`;

          const strVal = String(cell.text);
          const maxW = cellW - 10;
          let textW = ctx.measureText(strVal).width;
          while (textW > maxW && fSize > 6.5) {
            fSize -= 0.5;
            ctx.font = `bold ${fSize}px "Segoe UI", Arial, sans-serif`;
            textW = ctx.measureText(strVal).width;
          }

          ctx.textAlign = cell.align || 'left';
          const textX = cell.align === 'center' ? curX + cellW / 2 : curX + 6;
          ctx.fillText(strVal, textX, y + rowH / 2 + (fSize * 0.35));
          ctx.restore();
        }

        if (cell.isCheckbox) {
          // Checkbox pill
          const isCh = cell.checked;
          ctx.fillStyle = isCh ? '#065F46' : '#475569';
          ctx.font = isCh ? 'bold 8.5px "Segoe UI", Arial, sans-serif' : '500 8.5px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(cell.label, curX + 6, y + rowH / 2 + 3);

          // Mark pill
          ctx.fillStyle = isCh ? '#BBF7D0' : '#F1F5F9';
          ctx.beginPath();
          ctx.roundRect(curX + cellW - 32, y + 3, 26, rowH - 6, 3);
          ctx.fill();

          ctx.fillStyle = isCh ? '#166534' : '#64748B';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(isCh ? '[X]' : '[  ]', curX + cellW - 19, y + rowH / 2 + 3);
        }

        curX += cellW;
      }
      y += rowH;
    };

    // 1. ABOUT THIS FORM
    drawBanner("ABOUT THIS FORM & IT'S COMPLETION");
    drawGridRow([
      { pct: 12, isHdr: true, text: 'Ref No' },
      { pct: 18, text: refNo },
      { pct: 10, isHdr: true, text: 'DATE' },
      { pct: 20, text: formDate },
      { pct: 16, isHdr: true, text: 'PROJECT NAME' },
      { pct: 24, text: project }
    ], 21);
    drawGridRow([
      { pct: 16, isHdr: true, text: 'BUILDING ADDRESS' },
      { pct: 84, text: address }
    ], 21);
    y += 10;

    // 2. ABOUT THE PERSON
    drawBanner('ABOUT THE PERSON');
    drawGridRow([
      { pct: 25, isHdr: true, text: 'Name of the person involved' },
      { pct: 35, text: name },
      { pct: 15, isHdr: true, text: 'D.O.B' },
      { pct: 25, text: age && !dob.includes(age) ? `${dob}  (Age: ${age})` : dob }
    ], 21);
    drawGridRow([
      { pct: 25, isHdr: true, text: 'Registered Address' },
      { pct: 35, text: regAddress },
      { pct: 15, isHdr: true, text: 'Postcode' },
      { pct: 25, text: postcode }
    ], 21);
    drawGridRow([
      { pct: 25, isHdr: true, text: 'Contact Number' },
      { pct: 35, text: contact },
      { pct: 15, isHdr: true, text: 'Responsible Adult' },
      { pct: 25, text: adult }
    ], 21);
    drawGridRow([
      { pct: 16, isHdr: true, text: 'STAFF' },
      { pct: 21, isCheckbox: true, label: 'EY Staff', checked: isChecked(/staff:\s*ey staff/i), bg: isChecked(/staff:\s*ey staff/i) ? '#F0FDF4' : '#FFFFFF' },
      { pct: 21, isCheckbox: true, label: 'Non EY Staff', checked: isChecked(/staff:\s*non ey/i) },
      { pct: 21, isCheckbox: true, label: 'Visitor', checked: isChecked(/staff:\s*visitor/i) },
      { pct: 21, isCheckbox: true, label: 'Parent', checked: isChecked(/staff:\s*parent/i) }
    ], 21);
    drawGridRow([
      { pct: 16, isHdr: true, text: 'CHILD' },
      { pct: 28, isCheckbox: true, label: 'Daycare', checked: isChecked(/child status:\s*daycare/i), bg: isChecked(/child status:\s*daycare/i) ? '#F0FDF4' : '#FFFFFF' },
      { pct: 28, isCheckbox: true, label: 'ToyBox', checked: isChecked(/child status:\s*toybox/i) },
      { pct: 28, isCheckbox: true, label: 'SureStart', checked: isChecked(/child status:\s*surestart/i) }
    ], 21);

    // Discrete session letter boxes
    const sessRowH = 24;
    const sessHdrW = (16 / 100) * contentW;
    ctx.fillStyle = '#E8EEF7';
    ctx.fillRect(marginX, y, sessHdrW, sessRowH);
    ctx.strokeStyle = '#1E3A5F';
    ctx.strokeRect(marginX, y, sessHdrW, sessRowH);
    ctx.fillStyle = '#1E3A5F';
    ctx.font = 'bold 8px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SESSION', marginX + 6, y + 15);

    const sessValW = contentW - sessHdrW;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(marginX + sessHdrW, y, sessValW, sessRowH);
    ctx.strokeRect(marginX + sessHdrW, y, sessValW, sessRowH);

    if (session) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(marginX + sessHdrW + 1, y + 1, sessValW - 2, sessRowH - 2);
      ctx.clip();
      ctx.fillStyle = '#0F172A';
      let sFont = 9.5;
      ctx.font = `bold ${sFont}px "Segoe UI", Arial, sans-serif`;
      while (ctx.measureText(String(session)).width > sessValW - 16 && sFont > 6.5) {
        sFont -= 0.5;
        ctx.font = `bold ${sFont}px "Segoe UI", Arial, sans-serif`;
      }
      ctx.textAlign = 'left';
      ctx.fillText(String(session), marginX + sessHdrW + 8, y + sessRowH / 2 + (sFont * 0.35));
      ctx.restore();
    }
    y += sessRowH + 10;

    // 3. ABOUT THE INCIDENT
    drawBanner('ABOUT THE INCIDENT');
    drawGridRow([
      { pct: 12, isHdr: true, text: 'DATE' },
      { pct: 20, text: incDate },
      { pct: 10, isHdr: true, text: 'TIME' },
      { pct: 18, text: incTime },
      { pct: 14, isHdr: true, text: 'SPACE' },
      { pct: 26, text: location }
    ], 21);
    drawGridRow([
      { pct: 16, isHdr: true, text: 'TYPE' },
      { pct: 28, isCheckbox: true, label: 'ACCIDENT', checked: isChecked(/incident type:\s*accident|accident/i), bg: isChecked(/incident type:\s*accident|accident/i) ? '#F0FDF4' : '#FFFFFF' },
      { pct: 28, isCheckbox: true, label: 'INCIDENT', checked: isChecked(/incident type:\s*incident/i) },
      { pct: 28, isCheckbox: true, label: 'NEAR MISS', checked: isChecked(/near miss/i) }
    ], 21);
    drawGridRow([
      { pct: 16, isHdr: true, text: 'SEVERITY' },
      { pct: 28, isCheckbox: true, label: 'RIDDOR', checked: isChecked(/severity:\s*riddor/i) },
      { pct: 28, isCheckbox: true, label: 'MODERATE', checked: isChecked(/severity:\s*moderate/i), bg: isChecked(/severity:\s*moderate/i) ? '#FEF3C7' : '#FFFFFF', color: isChecked(/severity:\s*moderate/i) ? '#92400E' : '#334155' },
      { pct: 28, isCheckbox: true, label: 'MINOR', checked: isChecked(/severity:\s*minor/i) }
    ], 21);
    y += 10;

    // 4. RIDDOR ?
    drawBanner('RIDDOR ?');
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'DANGEROUS OCCURRENCE', checked: isChecked(/dangerous/i) },
      { pct: 50, isCheckbox: true, label: 'REPORTABLE DISEASE', checked: isChecked(/reportable/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'INJURY TO PUBLIC', checked: isChecked(/injury to public/i) },
      { pct: 50, isCheckbox: true, label: 'INJURY 3 DAYS', checked: isChecked(/injury 3 days/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'MAJOR INJURY', checked: isChecked(/major/i) },
      { pct: 50, isCheckbox: true, label: 'DEATH', checked: isChecked(/death/i) }
    ], 20);
    y += 10;

    // 5. CAUSE
    drawBanner('CAUSE');
    drawGridRow([
      { pct: 34, isCheckbox: true, label: 'CONTACT WITH PEER', checked: isChecked(/contact with peer|cause:\s*contact/i) },
      { pct: 33, isCheckbox: true, label: 'EQUIPMENT', checked: isChecked(/equipment/i) },
      { pct: 33, isCheckbox: true, label: 'UNKNOWN', checked: isChecked(/unknown/i) }
    ], 20);
    drawGridRow([
      { pct: 34, isCheckbox: true, label: 'SLIP / TRIP / FALL', checked: isChecked(/slip/i) },
      { pct: 33, isCheckbox: true, label: 'COSHH', checked: isChecked(/coshh/i) },
      { pct: 33, isCheckbox: true, label: 'TRAFFIC', checked: isChecked(/traffic/i) }
    ], 20);
    drawGridRow([
      { pct: 34, isCheckbox: true, label: 'MANUAL HANDLING', checked: isChecked(/manual/i) },
      { pct: 33, isCheckbox: true, label: 'CHOKING', checked: isChecked(/choking/i) },
      { pct: 33, isCheckbox: true, label: 'VENUE', checked: isChecked(/venue/i) }
    ], 20);
    y += 10;

    // 6. TYPE OF INJURY
    drawBanner('TYPE OF INJURY');
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'ABRASION / SMALL CUT / LIGHT BLEED', checked: isChecked(/abrasion|cut/i), bg: isChecked(/abrasion|cut/i) ? '#F0FDF4' : '#FFFFFF' },
      { pct: 50, isCheckbox: true, label: 'BRUISE / SWELLING / REDNESS', checked: isChecked(/bruise/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'STRAIN / DISLOCATION', checked: isChecked(/strain/i) },
      { pct: 50, isCheckbox: true, label: 'FRACTURE / BROKEN BONE', checked: isChecked(/fracture/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'INJURY TO HEAD / FACE', checked: isChecked(/injury to head/i) },
      { pct: 50, isCheckbox: true, label: 'SENSORY LOSS', checked: isChecked(/sensory/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'LOSS OF CONSCIOUSNESS', checked: isChecked(/consciousness/i) },
      { pct: 50, isCheckbox: true, label: 'ORGAN INJURY / OPEN WOUND', checked: isChecked(/organ/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'PROPERTY DAMAGE (INC VEHICLE)', checked: isChecked(/property/i) },
      { pct: 50, isCheckbox: true, label: 'EMOTIONAL DISTRESS', checked: isChecked(/emotional distress/i) }
    ], 20);
    y += 10;

    // 7. OUTCOME OF INCIDENT
    drawBanner('OUTCOME OF INCIDENT');
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'RETURN TO ACTIVITIES', checked: isChecked(/return to activities/i), bg: isChecked(/return to activities/i) ? '#F0FDF4' : '#FFFFFF' },
      { pct: 50, isCheckbox: true, label: 'FIRST AID APPLIED', checked: isChecked(/first aid/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'TO RESPONSIBLE ADULT CARE', checked: isChecked(/to responsible/i) },
      { pct: 50, isCheckbox: true, label: 'NIAS CALLED', checked: isChecked(/nias/i) }
    ], 20);
    drawGridRow([
      { pct: 50, isCheckbox: true, label: 'HOSPITAL ADMITTANCE', checked: isChecked(/hospital/i) },
      { pct: 50, isCheckbox: true, label: 'EMOTIONAL SUPPORT', checked: isChecked(/emotional support/i) }
    ], 20);
    y += 10;

    // 8. NARRATIVE
    drawBanner('NARRATIVE');
    const narrH = 56;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(marginX, y, contentW, narrH);
    ctx.strokeStyle = '#1E3A5F';
    ctx.strokeRect(marginX, y, contentW, narrH);

    // Ruled lines for narrative
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginX + 8, y + 19);
    ctx.lineTo(marginX + contentW - 8, y + 19);
    ctx.moveTo(marginX + 8, y + 36);
    ctx.lineTo(marginX + contentW - 8, y + 36);
    ctx.moveTo(marginX + 8, y + 53);
    ctx.lineTo(marginX + contentW - 8, y + 53);
    ctx.stroke();

    // Word wrap narrative text
    ctx.save();
    ctx.beginPath();
    ctx.rect(marginX + 1, y + 1, contentW - 2, narrH - 2);
    ctx.clip();

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 8.5px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';

    const maxNarrW = 540;
    const narrWords = String(narrative || '').replace(/\r\n/g, ' ').replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
    const narrDisplayLines = [];
    let currentLine = '';

    for (const w of narrWords) {
      const prefix = narrDisplayLines.length === 0 ? 'NARRATIVE: ' : '';
      const test = currentLine ? `${currentLine} ${w}` : w;
      if (ctx.measureText(prefix + test).width > maxNarrW) {
        if (currentLine) narrDisplayLines.push(currentLine);
        currentLine = w;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) narrDisplayLines.push(currentLine);

    if (narrDisplayLines.length > 0) {
      ctx.fillText('NARRATIVE: ' + narrDisplayLines[0], marginX + 8, y + 15);
      if (narrDisplayLines[1]) ctx.fillText(narrDisplayLines[1], marginX + 8, y + 32);
      if (narrDisplayLines[2]) ctx.fillText(narrDisplayLines[2], marginX + 8, y + 49);
    } else {
      ctx.fillStyle = '#94A3B8';
      ctx.fillText('NARRATIVE:', marginX + 8, y + 15);
    }
    ctx.restore();
    y += narrH + 10;

    // 9. COMPLETION & SIGN-OFF
    drawBanner('COMPLETION & SIGN-OFF');
    drawGridRow([
      { pct: 25, isHdr: true, text: 'FORM COMPLETED BY' },
      { pct: 25, text: completedBy },
      { pct: 20, isHdr: true, text: 'POSITION' },
      { pct: 30, text: position }
    ], 21);
    drawGridRow([
      { pct: 25, isHdr: true, text: 'SIGNED' },
      { pct: 25, text: signature, color: '#1E40AF' },
      { pct: 20, isHdr: true, text: 'DATE' },
      { pct: 30, text: dateSigned }
    ], 21);
    drawGridRow([
      { pct: 100, isHdr: true, text: 'PARENT / GUARDIAN / RESPONSIBLE ADULT', align: 'center', bg: '#F1F5F9' }
    ], 18);
    drawGridRow([
      { pct: 16, isHdr: true, text: 'SIGNED' },
      { pct: 28, text: parentSigned || '___________________', color: parentSigned ? '#1E40AF' : '#94A3B8' },
      { pct: 14, isHdr: true, text: 'DATE' },
      { pct: 18, text: parentDate || '__________', color: parentDate ? '#0F172A' : '#94A3B8' },
      { pct: 10, isHdr: true, text: 'TIME' },
      { pct: 14, text: parentTime || '__________', color: parentTime ? '#0F172A' : '#94A3B8' }
    ], 21);
    drawGridRow([
      { pct: 20, isHdr: true, text: 'COMMENTS' },
      { pct: 80, text: comments || '' }
    ], 21);

    // Convert Canvas to PNG Buffer
    const previewPng = canvas.toBuffer('image/png');

    // Create PDF Document using the clean high-resolution image
    const pdfDoc = await PDFDocument.create();
    const pdfPage = pdfDoc.addPage([595.28, 841.89]); // A4
    const embeddedImg = await pdfDoc.embedPng(previewPng);
    const imgAspect = 850 / 1150;
    const targetW = 595.28;
    const targetH = targetW / imgAspect; // 805.37 points (fits neatly on 841.89 pt page)
    const offsetY = (841.89 - targetH) / 2; // ~18.26 pt top/bottom margins

    pdfPage.drawImage(embeddedImg, {
      x: 0,
      y: offsetY,
      width: targetW,
      height: targetH
    });

    const pdfBuffer = Buffer.from(await pdfDoc.save());

    return {
      pdfBuffer,
      previewPng,
      previewImages: [{
        pageNumber: 1,
        dataUrl: `data:image/png;base64,${previewPng.toString('base64')}`
      }],
      report: {
        pageCount: 1,
        totalFields: fields.length,
        verifiedCount: fields.length,
        lowConfidenceCount: 0,
        qualityScore: 100
      }
    };
  }
}

module.exports = AccidentReportPdfGenerator;
