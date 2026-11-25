const ExcelJS = require('exceljs');
const { extractEarlyYearsFormModel } = require('./dynamicFormExtractor');

/**
 * Excel (.xlsx) Document Generator
 * Formats extracted data into a presentation-ready Digital Form sheet
 * that mirrors the uploaded document layout, plus a clean data table and audit sheet.
 */
class ExcelExporter {
  /**
   * Generate an executive-styled multi-sheet Excel workbook Buffer
   * @param {object} docData - Extracted document data { document, filename, documentTitle, fields, tables, summary }
   * @returns {Promise<Buffer>}
   */
  static async generateExcel(docData) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FormFlow AI';
    workbook.created = new Date();

    const fields = docData.fields || [];
    const tables = docData.tables || [];
    const summary = docData.summary || {};

    const findVal = (regex) => {
      const f = fields.find(field => regex.test(field.label));
      return f && f.value !== undefined && f.value !== null ? String(f.value).trim() : '';
    };

    const isChecked = (regex) => {
      const f = fields.find(field => regex.test(field.label));
      if (!f) return false;
      const v = String(f.value || '').toLowerCase();
      return ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(v);
    };

    // Early Years Accident = main FormFlow export layout when classifier says so
    const isAccidentReport =
      docData.formLayout === 'early_years_accident' ||
      ((docData.formLayout !== 'dynamic') && (
        /accident|incident|example\s*[12]/i.test(`${docData.documentTitle || ''} ${docData.filename || ''}`) ||
        fields.some(f => /riddor|name of the person involved|ey staff|toybox/i.test(f.label || ''))
      ));

    // -------------------------------------------------------------
    // SHEET 1: Digital Form (Matches Document Visual Structure)
    // -------------------------------------------------------------
    const formSheet = workbook.addWorksheet('Digital Form', {
      views: [{ showGridLines: true }]
    });

    formSheet.getColumn('A').width = 4;
    formSheet.getColumn('B').width = 18;
    formSheet.getColumn('C').width = 24;
    formSheet.getColumn('D').width = 18;
    formSheet.getColumn('E').width = 24;
    formSheet.getColumn('F').width = 18;
    formSheet.getColumn('G').width = 24;

    // Title Banner
    formSheet.mergeCells('B2:G2');
    const titleCell = formSheet.getCell('B2');
    titleCell.value = isAccidentReport ? 'ACCIDENT & INCIDENT REPORT FORM' : (docData.documentTitle || 'DIGITAL FORM EXPORT').toUpperCase();
    titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    formSheet.getRow(2).height = 34;

    // Subtitle Bar
    formSheet.mergeCells('B3:G3');
    const subCell = formSheet.getCell('B3');
    subCell.value = `Source: ${docData.filename || 'Uploaded Document'}  |  Exported: ${new Date().toLocaleDateString()}  |  Total Items: ${fields.length}`;
    subCell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    formSheet.getRow(3).height = 20;

    let currentRow = 5;

    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };

    const addSectionBanner = (title) => {
      formSheet.mergeCells(`B${currentRow}:G${currentRow}`);
      const cell = formSheet.getCell(`B${currentRow}`);
      cell.value = title.toUpperCase();
      cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = thinBorder;
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
    };

    const setFieldPair = (colLabel, colVal, label, value) => {
      const lCell = formSheet.getCell(`${colLabel}${currentRow}`);
      lCell.value = label;
      lCell.font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      lCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      lCell.border = thinBorder;

      const vCell = formSheet.getCell(`${colVal}${currentRow}`);
      vCell.value = value || '';
      vCell.font = { name: 'Segoe UI', size: 9.5, bold: !!value, color: { argb: value ? 'FF0F172A' : 'FF94A3B8' } };
      vCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      vCell.border = thinBorder;
    };

    const setCbCell = (colStart, colEnd, label, checked) => {
      formSheet.mergeCells(`${colStart}${currentRow}:${colEnd}${currentRow}`);
      const cell = formSheet.getCell(`${colStart}${currentRow}`);
      cell.value = `${checked ? '☑ [X]' : '☐ [  ]'}  ${label}`;
      cell.font = { name: 'Segoe UI', size: 9, bold: checked, color: { argb: checked ? 'FF1E40AF' : 'FF64748B' } };
      if (checked) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      }
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = thinBorder;
    };

    if (isAccidentReport) {
      const eyModel = extractEarlyYearsFormModel(fields);
      const eyChecked = eyModel.isChecked;

      // 1. ABOUT THIS FORM & IT'S COMPLETION
      addSectionBanner("ABOUT THIS FORM & IT'S COMPLETION");
      setFieldPair('B', 'C', 'Ref No', eyModel.refNo);
      setFieldPair('D', 'E', 'DATE', eyModel.formDate);
      setFieldPair('F', 'G', 'PROJECT NAME', eyModel.project);
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      const addrCell = formSheet.getCell(`B${currentRow}`);
      addrCell.value = 'BUILDING ADDRESS';
      addrCell.font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      addrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      addrCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      addrCell.border = thinBorder;

      formSheet.mergeCells(`C${currentRow}:G${currentRow}`);
      const addrValCell = formSheet.getCell(`C${currentRow}`);
      addrValCell.value = eyModel.address;
      addrValCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      addrValCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      addrValCell.border = thinBorder;
      formSheet.getRow(currentRow).height = 22;
      currentRow += 2;

      // 2. ABOUT THE PERSON
      addSectionBanner('ABOUT THE PERSON');
      setFieldPair('B', 'C', 'Name of Person', eyModel.name);
      setFieldPair('D', 'E', 'D.O.B', eyModel.dob);
      setFieldPair('F', 'G', 'Age', eyModel.age);
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      setFieldPair('B', 'C', 'Registered Address', eyModel.regAddress);
      setFieldPair('D', 'E', 'Postcode', eyModel.postcode);
      setFieldPair('F', 'G', '', '');
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      setFieldPair('B', 'C', '', '');
      setFieldPair('D', 'E', 'Responsible Adult', eyModel.adult);
      setFieldPair('F', 'G', '', '');
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      setFieldPair('B', 'C', 'Contact Number', eyModel.contact);
      setFieldPair('D', 'E', '', '');
      setFieldPair('F', 'G', '', '');
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      // Staff Row
      const staffEy = eyChecked('staffEy');
      const staffNonEy = eyChecked('staffNonEy');
      const staffVis = eyChecked('staffVisitor');
      const staffParent = eyChecked('staffParent');

      formSheet.getCell(`B${currentRow}`).value = 'STAFF';
      formSheet.getCell(`B${currentRow}`).font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      formSheet.getCell(`B${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      formSheet.getCell(`B${currentRow}`).border = thinBorder;

      setCbCell('C', 'C', 'EY Staff', staffEy);
      setCbCell('D', 'E', 'Non EY Staff', staffNonEy);
      setCbCell('F', 'F', 'Visitor', staffVis);
      setCbCell('G', 'G', 'Parent', staffParent);
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      // Child Row
      formSheet.getCell(`B${currentRow}`).value = 'CHILD';
      formSheet.getCell(`B${currentRow}`).font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      formSheet.getCell(`B${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      formSheet.getCell(`B${currentRow}`).border = thinBorder;

      setCbCell('C', 'D', 'Daycare', eyChecked('childDaycare'));
      setCbCell('E', 'E', 'ToyBox', eyChecked('childToybox'));
      setCbCell('F', 'G', 'SureStart', eyChecked('childSurestart'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      // Session
      formSheet.getCell(`B${currentRow}`).value = 'SESSION';
      formSheet.getCell(`B${currentRow}`).font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      formSheet.getCell(`B${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      formSheet.getCell(`B${currentRow}`).border = thinBorder;

      formSheet.mergeCells(`C${currentRow}:G${currentRow}`);
      const sessVal = formSheet.getCell(`C${currentRow}`);
      sessVal.value = eyModel.session;
      sessVal.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      sessVal.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      sessVal.border = thinBorder;
      formSheet.getRow(currentRow).height = 22;
      currentRow += 2;

      // 3. ABOUT THE INCIDENT
      addSectionBanner('ABOUT THE INCIDENT');
      setFieldPair('B', 'C', 'DATE', eyModel.incDate);
      setFieldPair('D', 'E', 'TIME', eyModel.incTime);
      setFieldPair('F', 'G', 'SPACE', eyModel.location);
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      formSheet.getCell(`B${currentRow}`).value = 'TYPE';
      formSheet.getCell(`B${currentRow}`).font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      formSheet.getCell(`B${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      formSheet.getCell(`B${currentRow}`).border = thinBorder;
      setCbCell('C', 'D', 'ACCIDENT', eyChecked('typeAccident'));
      setCbCell('E', 'E', 'INCIDENT', eyChecked('typeIncident'));
      setCbCell('F', 'G', 'NEAR MISS', eyChecked('typeNearMiss'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      formSheet.getCell(`B${currentRow}`).value = 'SEVERITY';
      formSheet.getCell(`B${currentRow}`).font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      formSheet.getCell(`B${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      formSheet.getCell(`B${currentRow}`).border = thinBorder;
      setCbCell('C', 'D', 'RIDDOR', eyChecked('severityRiddor'));
      setCbCell('E', 'E', 'MODERATE', eyChecked('severityModerate'));
      setCbCell('F', 'G', 'MINOR', eyChecked('severityMinor'));
      formSheet.getRow(currentRow).height = 22;
      currentRow += 2;

      // 4. RIDDOR ?
      addSectionBanner('RIDDOR ?');
      setCbCell('B', 'D', 'DANGEROUS OCCURRENCE', eyChecked('riddorDangerous'));
      setCbCell('E', 'G', 'REPORTABLE DISEASE', eyChecked('riddorDisease'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'INJURY TO PUBLIC', eyChecked('riddorPublic'));
      setCbCell('E', 'G', 'INJURY 3 DAYS', eyChecked('riddor3Days'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'MAJOR INJURY', eyChecked('riddorMajor'));
      setCbCell('E', 'G', 'DEATH', eyChecked('riddorDeath'));
      formSheet.getRow(currentRow).height = 22;
      currentRow += 2;

      // 5. CAUSE
      addSectionBanner('CAUSE');
      setCbCell('B', 'C', 'CONTACT WITH PEER', eyChecked('causePeer'));
      setCbCell('D', 'E', 'EQUIPMENT', eyChecked('causeEquip'));
      setCbCell('F', 'G', 'UNKNOWN', eyChecked('causeUnknown'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'C', 'SLIP/TRIP/FALL', eyChecked('causeSlip'));
      setCbCell('D', 'E', 'COSHH', eyChecked('causeCoshh'));
      setCbCell('F', 'G', 'TRAFFIC', eyChecked('causeTraffic'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'C', 'MANUAL HANDLING', eyChecked('causeManual'));
      setCbCell('D', 'E', 'CHOKING', eyChecked('causeChoking'));
      setCbCell('F', 'G', 'VENUE', eyChecked('causeVenue'));
      formSheet.getRow(currentRow).height = 22;
      currentRow += 2;

      // 6. TYPE OF INJURY
      addSectionBanner('TYPE OF INJURY');
      setCbCell('B', 'D', 'ABRASION / SMALL CUT / LIGHT BLEED', eyChecked('injuryCut'));
      setCbCell('E', 'G', 'BRUISE / SWELLING / REDNESS', eyChecked('injuryBruise'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'STRAIN / DISLOCATION', eyChecked('injuryStrain'));
      setCbCell('E', 'G', 'FRACTURE / BROKEN BONE', eyChecked('injuryFracture'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'INJURY TO HEAD / FACE', eyChecked('injuryHead'));
      setCbCell('E', 'G', 'SENSORY LOSS', eyChecked('injurySensory'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'LOSS OF CONSCIOUSNESS', eyChecked('injuryConscious'));
      setCbCell('E', 'G', 'ORGAN INJURY / OPEN WOUND', eyChecked('injuryOrgan'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'PROPERTY DAMAGE (INC VEHICLE)', eyChecked('injuryProperty'));
      setCbCell('E', 'G', 'EMOTIONAL DISTRESS', eyChecked('injuryDistress'));
      formSheet.getRow(currentRow).height = 22;
      currentRow += 2;

      // 7. OUTCOME OF INCIDENT
      addSectionBanner('OUTCOME OF INCIDENT');
      setCbCell('B', 'D', 'RETURN TO ACTIVITIES', eyChecked('outcomeReturn'));
      setCbCell('E', 'G', 'FIRST AID APPLIED', eyChecked('outcomeFirstAid'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'TO RESPONSIBLE ADULT CARE', eyChecked('outcomeAdultCare'));
      setCbCell('E', 'G', 'NIAS CALLED', eyChecked('outcomeNias'));
      formSheet.getRow(currentRow).height = 22;
      currentRow++;
      setCbCell('B', 'D', 'HOSPITAL ADMITTANCE', eyChecked('outcomeHospital'));
      setCbCell('E', 'G', 'EMOTIONAL SUPPORT', eyChecked('outcomeSupport'));
      formSheet.getRow(currentRow).height = 22;
      currentRow += 2;

      // 8. NARRATIVE
      addSectionBanner('NARRATIVE');
      const narrativeVal = eyModel.narrative;
      const narrativeLines = narrativeVal.split('\n').filter(Boolean);
      for (const line of (narrativeLines.length > 0 ? narrativeLines : ['(No narrative entered)'])) {
        formSheet.mergeCells(`B${currentRow}:G${currentRow}`);
        const nCell = formSheet.getCell(`B${currentRow}`);
        nCell.value = line;
        nCell.font = { name: 'Segoe UI', size: 9.5, bold: line !== '(No narrative entered)', color: { argb: line !== '(No narrative entered)' ? 'FF0F172A' : 'FF94A3B8' } };
        nCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        nCell.border = thinBorder;
        formSheet.getRow(currentRow).height = 22;
        currentRow++;
      }
      currentRow++;

      // 9. SIGN-OFF & AUTHORIZATION
      addSectionBanner('SIGN-OFF & AUTHORIZATION');
      setFieldPair('B', 'C', 'FORM COMPLETED BY', eyModel.completedBy);
      setFieldPair('D', 'G', 'POSITION', eyModel.position);
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      setFieldPair('B', 'C', 'SIGNED', eyModel.signature);
      setFieldPair('D', 'G', 'DATE', eyModel.dateSigned);
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      formSheet.mergeCells(`B${currentRow}:G${currentRow}`);
      const parCell = formSheet.getCell(`B${currentRow}`);
      parCell.value = eyModel.parentGuardianName
        ? `PARENT / GUARDIAN / RESPONSIBLE ADULT: ${eyModel.parentGuardianName}`
        : 'PARENT / GUARDIAN / RESPONSIBLE ADULT';
      parCell.font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
      parCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      parCell.border = thinBorder;
      formSheet.getRow(currentRow).height = 20;
      currentRow++;

      setFieldPair('B', 'C', 'SIGNED', eyModel.parentSigned || '_______________________');
      setFieldPair('D', 'E', 'DATE', eyModel.parentDate || '____________');
      setFieldPair('F', 'G', 'TIME', eyModel.parentTime || '_________');
      formSheet.getRow(currentRow).height = 22;
      currentRow++;

      formSheet.mergeCells(`B${currentRow}:G${currentRow}`);
      const commCell = formSheet.getCell(`B${currentRow}`);
      commCell.value = `COMMENTS: ${eyModel.comments || '____________________________________________________________________'}`;
      commCell.font = { name: 'Segoe UI', size: 8.5, bold: !!eyModel.comments, color: { argb: eyModel.comments ? 'FF0F172A' : 'FF64748B' } };
      commCell.border = thinBorder;
      formSheet.getRow(currentRow).height = 24;
      currentRow++;
    } else {
      // Generic document layout
      const sectionMap = new Map();
      for (const f of fields) {
        const sec = f.section || 'General Details';
        if (!sectionMap.has(sec)) sectionMap.set(sec, []);
        sectionMap.get(sec).push(f);
      }

      for (const [secName, secFields] of sectionMap.entries()) {
        addSectionBanner(secName);
        for (let i = 0; i < secFields.length; i += 2) {
          const f1 = secFields[i];
          const f2 = secFields[i + 1];
          if (f2) {
            setFieldPair('B', 'D', f1.label, f1.value);
            setFieldPair('E', 'G', f2.label, f2.value);
          } else {
            setFieldPair('B', 'G', f1.label, f1.value);
          }
          formSheet.getRow(currentRow).height = 22;
          currentRow++;
        }
        currentRow++;
      }
    }

    // -------------------------------------------------------------
    // SHEET 2: Data Table (Full Extraction Database)
    // -------------------------------------------------------------
    const dataSheet = workbook.addWorksheet('Data Table', {
      views: [{ showGridLines: true }]
    });

    dataSheet.columns = [
      { header: '#', key: 'idx', width: 6 },
      { header: 'Field Key', key: 'id', width: 16 },
      { header: 'Section', key: 'section', width: 28 },
      { header: 'Form Label / Key', key: 'label', width: 34 },
      { header: 'Extracted Value', key: 'value', width: 38 },
      { header: 'Field Type', key: 'type', width: 14 },
      { header: 'Confidence', key: 'confidence', width: 14 },
      { header: 'Verified', key: 'verified', width: 12 },
      { header: 'Page', key: 'page', width: 8 }
    ];

    const dHeaderRow = dataSheet.getRow(1);
    dHeaderRow.height = 28;
    dHeaderRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder;
    });

    fields.forEach((f, idx) => {
      const confNum = typeof f.confidence === 'number' ? f.confidence : 0.88;
      const r = dataSheet.addRow({
        idx: idx + 1,
        id: f.id || `f_${idx + 1}`,
        section: f.section || 'General Information',
        label: f.label || '',
        value: f.value !== undefined ? String(f.value) : '',
        type: f.type || 'text',
        confidence: `${Math.round(confNum * 100)}%`,
        verified: f.verified ? 'YES' : 'NO',
        page: f.page || 1
      });

      r.height = 20;
      r.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 9 };
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle' };
        if (colNum === 1 || colNum === 6 || colNum === 7 || colNum === 8 || colNum === 9) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      });
    });

    // -------------------------------------------------------------
    // SHEET 3: Audit Log (Coordinates & Technical Provenance)
    // -------------------------------------------------------------
    const auditSheet = workbook.addWorksheet('Audit Log', {
      views: [{ showGridLines: true }]
    });

    auditSheet.columns = [
      { header: 'Field Key', key: 'id', width: 16 },
      { header: 'Field Label', key: 'label', width: 32 },
      { header: 'Original Raw OCR Value', key: 'ocrVal', width: 34 },
      { header: 'Verified Final Value', key: 'finalVal', width: 34 },
      { header: 'Norm X', key: 'x', width: 12 },
      { header: 'Norm Y', key: 'y', width: 12 },
      { header: 'Norm W', key: 'w', width: 12 },
      { header: 'Norm H', key: 'h', width: 12 },
      { header: 'Quality Status', key: 'status', width: 16 }
    ];

    const aHeader = auditSheet.getRow(1);
    aHeader.height = 28;
    aHeader.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder;
    });

    fields.forEach((f) => {
      const b = f.bounds || {};
      const r = auditSheet.addRow({
        id: f.id || '',
        label: f.label || '',
        ocrVal: f.originalOcrValue || f.value || '',
        finalVal: f.value !== undefined ? String(f.value) : '',
        x: typeof b.x === 'number' ? Number(b.x.toFixed(4)) : '',
        y: typeof b.y === 'number' ? Number(b.y.toFixed(4)) : '',
        w: typeof b.width === 'number' ? Number(b.width.toFixed(4)) : '',
        h: typeof b.height === 'number' ? Number(b.height.toFixed(4)) : '',
        status: f.verified ? 'Verified' : (f.confidence >= 0.85 ? 'High Confidence' : 'Review Required')
      });
      r.height = 19;
      r.eachCell(c => {
        c.font = { name: 'Segoe UI', size: 9 };
        c.border = thinBorder;
        c.alignment = { vertical: 'middle' };
      });
    });

    // -------------------------------------------------------------
    // SHEET 4: Detected Tables (if any)
    // -------------------------------------------------------------
    if (tables.length > 0) {
      const tablesSheet = workbook.addWorksheet('Tables', {
        views: [{ showGridLines: true }]
      });

      let tRow = 2;
      for (const tbl of tables) {
        tablesSheet.mergeCells(`B${tRow}:E${tRow}`);
        const tTitle = tablesSheet.getCell(`B${tRow}`);
        tTitle.value = tbl.title || 'Extracted Table Matrix';
        tTitle.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        tTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        tablesSheet.getRow(tRow).height = 24;
        tRow++;

        if (tbl.headers && tbl.headers.length > 0) {
          const hRow = tablesSheet.getRow(tRow);
          tbl.headers.forEach((h, hIdx) => {
            const c = hRow.getCell(hIdx + 2);
            c.value = h;
            c.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
            c.border = thinBorder;
          });
          hRow.height = 22;
          tRow++;
        }

        for (const rowData of tbl.rows || []) {
          const r = tablesSheet.getRow(tRow);
          rowData.forEach((val, cIdx) => {
            const c = r.getCell(cIdx + 2);
            c.value = val;
            c.font = { name: 'Segoe UI', size: 9 };
            c.border = thinBorder;
          });
          r.height = 20;
          tRow++;
        }
        tRow += 2;
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

module.exports = ExcelExporter;
