const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * Sample Document Generator for Diverse Testing Scenarios
 */
class SampleGenerator {
  static getSamplesDir() {
    const dir = path.join(__dirname, '..', 'storage', 'samples');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  static async generateAllSamples() {
    const dir = this.getSamplesDir();
    console.log('Generating realistic sample documents in:', dir);

    await this.generateMedicalIntake(path.join(dir, 'sample_medical_intake.png'));
    await this.generateInspectionForm(path.join(dir, 'sample_equipment_inspection.png'));
    await this.generatePhotocopyForm(path.join(dir, 'sample_tax_photocopy.png'));
    await this.generateMultiPagePdf(path.join(dir, 'sample_multipage_contract.pdf'));
    await this.generateAccidentReportForm(path.join(dir, 'sample_accident_report.png'));
    await this.generateAccidentReportPdf(path.join(dir, 'sample_accident_report.pdf'));

    console.log('Sample documents generated successfully.');
  }

  /**
   * Sample 1: Medical Intake Form photographed at slight angle with blue handwriting and checkboxes
   */
  static async generateMedicalIntake(outputPath) {
    const width = 1200;
    const height = 1600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Paper background with warm light tone and subtle phone shadow gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#fefefe');
    grad.addColorStop(0.5, '#fbfaf7');
    grad.addColorStop(1, '#f1ede4'); // subtle phone camera shadow at corner
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Printed Header
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 36px serif';
    ctx.textAlign = 'center';
    ctx.fillText('ST. JUDE REGIONAL HEALTH CLINIC', width / 2, 80);

    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('CONFIDENTIAL PATIENT INTAKE & MEDICAL HISTORY FORM', width / 2, 115);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(80, 135);
    ctx.lineTo(width - 80, 135);
    ctx.stroke();

    // Section 1: Personal Details
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.textAlign = 'left';
    ctx.fillText('1. PATIENT IDENTIFICATION', 80, 180);

    // Form lines & Printed Labels
    const drawFormField = (label, value, x, y, lineLen, isHandwritten = true) => {
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(label, x, y);

      const labelMetrics = ctx.measureText(label);
      const startX = x + labelMetrics.width + 10;
      const endX = x + lineLen;

      // Printed underline
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(startX, y + 5);
      ctx.lineTo(endX, y + 5);
      ctx.stroke();

      // Blue ink handwriting
      if (value) {
        ctx.save();
        ctx.fillStyle = isHandwritten ? '#1d4ed8' : '#0f172a'; // blue ballpoint ink
        ctx.font = isHandwritten ? 'italic 22px "Segoe Print", "Comic Sans MS", cursive, sans-serif' : '20px sans-serif';
        // subtle handwriting angle
        ctx.translate(startX + 12, y);
        ctx.rotate(-0.015);
        ctx.fillText(value, 0, 0);
        ctx.restore();
      }
    };

    drawFormField('Full Name:', 'Eleanor Vance Sterling', 80, 230, 600);
    drawFormField('Date of Birth:', '10/14/1988', 720, 230, 380);

    drawFormField('Residential Address:', '742 Evergreen Terrace, Apt 4B', 80, 290, 700);
    drawFormField('City / State:', 'Springfield, OR', 810, 290, 310);

    drawFormField('Primary Phone:', '(541) 555-0199', 80, 350, 480);
    drawFormField('Emergency Contact:', 'Marcus Sterling (Spouse)', 600, 350, 520);

    // Section 2: Checkboxes
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText('2. KNOWN ALLERGIES & SENSITIVITIES', 80, 420);

    const drawCheckbox = (label, checked, x, y) => {
      // Box
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y - 20, 24, 24);

      // Label
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#1e293b';
      ctx.fillText(label, x + 35, y);

      // Handwritten checkmark
      if (checked) {
        ctx.save();
        ctx.strokeStyle = '#1d4ed8'; // blue ink
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(x + 4, y - 8);
        ctx.lineTo(x + 10, y + 1);
        ctx.lineTo(x + 22, y - 16);
        ctx.stroke();
        ctx.restore();
      }
    };

    drawCheckbox('Penicillin / Antibiotics', true, 80, 470);
    drawCheckbox('Sulfa Drugs', false, 360, 470);
    drawCheckbox('Latex Products', true, 620, 470);
    drawCheckbox('No Known Allergies', false, 880, 470);

    // Section 3: Medical History Table
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText('3. PRIOR CONDITIONS & HOSPITALIZATIONS (TABLE)', 80, 550);

    const tableX = 80;
    const tableY = 580;
    const colWidths = [280, 180, 320, 260];
    const headers = ['Condition / Surgery', 'Year', 'Treating Physician', 'Current Status'];
    const rowHeight = 45;

    // Table Header
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(tableX, tableY, 1040, rowHeight);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(tableX, tableY, 1040, rowHeight * 4);

    let curX = tableX;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 17px sans-serif';
    for (let c = 0; c < headers.length; c++) {
      ctx.fillText(headers[c], curX + 15, tableY + 28);
      if (c > 0) {
        ctx.beginPath();
        ctx.moveTo(curX, tableY);
        ctx.lineTo(curX, tableY + rowHeight * 4);
        ctx.stroke();
      }
      curX += colWidths[c];
    }

    // Horizontal table row dividers
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.moveTo(tableX, tableY + r * rowHeight);
      ctx.lineTo(tableX + 1040, tableY + r * rowHeight);
      ctx.stroke();
    }

    // Handwritten row entries in blue ink
    const rows = [
      ['Appendectomy', '2016', 'Dr. Katherine Wells', 'Resolved / Fully Healed'],
      ['Mild Asthma', '2020', 'Dr. Robert Chen', 'Controlled (Albuterol)'],
      ['Sprained Left Ankle', '2023', 'Springfield Urgent Care', 'Asymptomatic']
    ];

    for (let r = 0; r < rows.length; r++) {
      let rX = tableX;
      for (let c = 0; c < rows[r].length; c++) {
        ctx.save();
        ctx.fillStyle = '#1e40af'; // blue ink
        ctx.font = 'italic 19px "Segoe Print", cursive, sans-serif';
        ctx.fillText(rows[r][c], rX + 15, tableY + (r + 1) * rowHeight + 28);
        ctx.restore();
        rX += colWidths[c];
      }
    }

    // Section 4: Multiline remarks & Signature
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText('4. CURRENT SYMPTOMS & REASON FOR VISIT', 80, 800);

    // Box for multiline text
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(80, 820, 1040, 140);

    ctx.save();
    ctx.fillStyle = '#1e40af';
    ctx.font = 'italic 20px "Segoe Print", cursive, sans-serif';
    ctx.fillText('Experiencing recurring migraine headaches on right temple for the past 3 weeks,', 100, 860);
    ctx.fillText('typically in the late afternoon. Sensitivity to bright screen lighting and sound.', 100, 900);
    ctx.fillText('Over-the-counter ibuprofen provides only temporary relief.', 100, 940);
    ctx.restore();

    // Signature Line
    drawFormField('Patient Signature:', 'Eleanor V. Sterling', 80, 1040, 500);
    drawFormField('Date Signed:', '10/20/2026', 700, 1040, 400);

    // Clinic footer
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Form Rev 4.2 | St. Jude Regional Health Clinic | HIPAA Compliant Document', width / 2, 1550);

    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buf);
  }

  /**
   * Sample 2: Industrial Equipment Inspection with Tables & Checkboxes
   */
  static async generateInspectionForm(outputPath) {
    const width = 1200;
    const height = 1500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 40, width - 80, height - 80);

    // Header
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AERO-DYNAMICS MANUFACTURING CORP.', width / 2, 90);

    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.fillText('FACILITY MACHINERY QUALITY & SAFETY INSPECTION LOG', width / 2, 125);

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(50, 145);
    ctx.lineTo(width - 50, 145);
    ctx.stroke();

    // Info Grid
    const drawCell = (x, y, w, h, label, val) => {
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#333333';
      ctx.font = 'bold 15px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 8, y + 20);

      if (val) {
        ctx.fillStyle = '#0f172a'; // black pen
        ctx.font = 'italic 18px "Segoe Print", cursive, sans-serif';
        ctx.fillText(val, x + 8, y + 42);
      }
    };

    drawCell(60, 160, 340, 55, 'EQUIPMENT / UNIT ID:', 'CNC-MILL-884-B');
    drawCell(400, 160, 360, 55, 'INSPECTOR NAME & BADGE:', 'David K. Morrison (#409)');
    drawCell(760, 160, 380, 55, 'INSPECTION DATE:', '2026-10-18');

    drawCell(60, 220, 340, 55, 'OPERATING HOURS:', '4,285.4 hrs');
    drawCell(400, 220, 360, 55, 'LOCATION / BAY:', 'Bay 3 - Precision Machining');
    drawCell(760, 220, 380, 55, 'OVERALL STATUS:', 'PASSED WITH NOTES');

    // Table
    const tX = 60;
    const tY = 320;
    const tW = 1080;
    const colW = [120, 340, 160, 220, 240];
    const headers = ['ITEM #', 'COMPONENT / SUBSYSTEM', 'STATUS', 'MEASUREMENT', 'CORRECTIVE ACTION'];

    ctx.fillStyle = '#222222';
    ctx.fillRect(tX, tY, tW, 35);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial, sans-serif';
    let curX = tX;
    headers.forEach((h, i) => {
      ctx.fillText(h, curX + 10, tY + 23);
      curX += colW[i];
    });

    const items = [
      ['01', 'Spindle Bearing Runout', 'PASS', '0.002 mm (OK)', 'None required'],
      ['02', 'Hydraulic Pressure Valve', 'PASS', '142 bar (Nominal)', 'Filter checked'],
      ['03', 'Coolant Lubricant Flow Rate', 'ATTENTION', '18.4 L/min (Low)', 'Topped off reservoir'],
      ['04', 'Emergency Stop Interlock', 'PASS', '< 120 ms reaction', 'Tested successfully'],
      ['05', 'Linear Axis Guide Lubrication', 'PASS', 'Optimal film', 'Greased slide rails']
    ];

    ctx.strokeStyle = '#000000';
    let rowY = tY + 35;
    items.forEach((row, rIdx) => {
      ctx.strokeRect(tX, rowY, tW, 45);
      let cellX = tX;
      row.forEach((cVal, cIdx) => {
        if (cIdx > 0) {
          ctx.beginPath();
          ctx.moveTo(cellX, rowY);
          ctx.lineTo(cellX, rowY + 45);
          ctx.stroke();
        }
        ctx.fillStyle = '#000000';
        ctx.font = '16px "Segoe Print", cursive, sans-serif';
        ctx.fillText(cVal, cellX + 10, rowY + 28);
        cellX += colW[cIdx];
      });
      rowY += 45;
    });

    // Notes Box
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillText('INSPECTOR REMARKS & SIGNOFF:', 60, 620);
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(60, 640, 1080, 120);

    ctx.font = 'italic 18px "Segoe Print", cursive, sans-serif';
    ctx.fillText('Routine 500-hour inspection completed without major safety defects.', 80, 680);
    ctx.fillText('Replaced secondary coolant O-ring gasket. Next inspection scheduled for Nov 2026.', 80, 720);

    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buf);
  }

  /**
   * Sample 3: Low-quality photocopy with slight grit and tax info
   */
  static async generatePhotocopyForm(outputPath) {
    const width = 1100;
    const height = 1450;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Greyish photocopy paper
    ctx.fillStyle = '#eae9e5';
    ctx.fillRect(0, 0, width, height);

    // Header
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DEPARTMENT OF REVENUE & TAXATION', width / 2, 70);
    ctx.font = '16px sans-serif';
    ctx.fillText('SCHEDULE W-2C: DECLARATION OF AMENDED COMPENSATION', width / 2, 100);

    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 2;
    ctx.strokeRect(60, 130, 980, 800);

    const drawField = (label, val, x, y) => {
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, x, y);

      ctx.fillStyle = '#050505';
      ctx.font = '18px "Courier New", monospace, sans-serif';
      ctx.fillText(val, x + 280, y);

      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 270, y + 4);
      ctx.lineTo(x + 650, y + 4);
      ctx.stroke();
    };

    drawField('Employer Identification Number (EIN):', '84-9201948', 90, 180);
    drawField('Legal Business Name:', 'Apex Logistics Solutions LLC', 90, 240);
    drawField('Tax Year Amended:', '2025', 90, 300);
    drawField('Total Gross Wages Reported:', '$98,450.00', 90, 360);
    drawField('Federal Income Tax Withheld:', '$16,280.50', 90, 420);
    drawField('Social Security Tax Withheld:', '$6,103.90', 90, 480);
    drawField('Medicare Tax Withheld:', '$1,427.52', 90, 540);
    drawField('Authorized Representative:', 'Sarah M. Jenkins, CPA', 90, 600);
    drawField('Contact Telephone:', '(206) 555-8931', 90, 660);

    // Add photocopier specks/noise
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    for (let i = 0; i < 8000; i++) {
      const idx = Math.floor(Math.random() * (d.length / 4)) * 4;
      const noise = (Math.random() - 0.5) * 60;
      d[idx] = Math.max(0, Math.min(255, d[idx] + noise));
      d[idx + 1] = Math.max(0, Math.min(255, d[idx + 1] + noise));
      d[idx + 2] = Math.max(0, Math.min(255, d[idx + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buf);
  }

  /**
   * Sample 4: Multi-page Consulting Agreement PDF
   */
  static async generateMultiPagePdf(outputPath) {
    const pdfDoc = await PDFDocument.create();
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Page 1
    const p1 = pdfDoc.addPage([612, 792]);
    p1.drawText('MASTER PROFESSIONAL SERVICES AGREEMENT', {
      x: 80,
      y: 720,
      size: 18,
      font: boldFont,
      color: rgb(0.1, 0.2, 0.4)
    });
    p1.drawText('PART A: PROJECT ORDER & ENGAGEMENT SPECIFICATION', {
      x: 80,
      y: 695,
      size: 11,
      font: boldFont,
      color: rgb(0.3, 0.3, 0.3)
    });

    const drawP1Field = (label, val, y) => {
      p1.drawText(label, { x: 80, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
      p1.drawLine({
        start: { x: 230, y: y - 2 },
        end: { x: 530, y: y - 2 },
        thickness: 1,
        color: rgb(0.6, 0.6, 0.6)
      });
      p1.drawText(val, { x: 240, y, size: 11, font: regularFont, color: rgb(0.05, 0.2, 0.6) });
    };

    drawP1Field('Client Organization:', 'Cascade BioTech Ventures Inc.', 640);
    drawP1Field('Primary Contact Person:', 'Dr. Kenneth A. Howard', 605);
    drawP1Field('Engagement Title:', 'AI Data Pipeline Architecture', 570);
    drawP1Field('Effective Start Date:', 'November 1, 2026', 535);
    drawP1Field('Hourly Professional Fee:', '$225.00 USD / hr', 500);
    drawP1Field('Estimated Project Budget:', '$65,000.00 USD', 465);

    p1.drawText('Page 1 of 2', { x: 280, y: 30, size: 9, font: regularFont, color: rgb(0.5, 0.5, 0.5) });

    // Page 2
    const p2 = pdfDoc.addPage([612, 792]);
    p2.drawText('MASTER PROFESSIONAL SERVICES AGREEMENT (CONT.)', {
      x: 80,
      y: 720,
      size: 14,
      font: boldFont,
      color: rgb(0.1, 0.2, 0.4)
    });
    p2.drawText('PART B: DELIVERABLES & AUTHORIZATION SIGNOFF', {
      x: 80,
      y: 695,
      size: 11,
      font: boldFont,
      color: rgb(0.3, 0.3, 0.3)
    });

    const drawP2Field = (label, val, y) => {
      p2.drawText(label, { x: 80, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
      p2.drawLine({
        start: { x: 230, y: y - 2 },
        end: { x: 530, y: y - 2 },
        thickness: 1,
        color: rgb(0.6, 0.6, 0.6)
      });
      p2.drawText(val, { x: 240, y, size: 11, font: regularFont, color: rgb(0.05, 0.2, 0.6) });
    };

    drawP2Field('Deliverable Milestone 1:', 'Architecture Blueprint Document', 630);
    drawP2Field('Deliverable Milestone 2:', 'Automated Ingestion Pipeline Code', 590);
    drawP2Field('Deliverable Milestone 3:', 'UAT & Production Deployment', 550);
    drawP2Field('Client Authorized Signatory:', 'Dr. Kenneth A. Howard (VP Engineering)', 470);
    drawP2Field('Signoff Date Executed:', 'October 19, 2026', 430);

    p2.drawText('Page 2 of 2', { x: 280, y: 30, size: 9, font: regularFont, color: rgb(0.5, 0.5, 0.5) });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, Buffer.from(pdfBytes));
  }

  /**
   * Sample 5: Accident & Incident Report Form (Grid Box Form with Checkbox Cells & Narrative)
   */
  static async generateAccidentReportForm(outputPath) {
    const width = 1200;
    const height = 1750;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // White paper
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Accident & Incident Report Form', width / 2, 70);

    // Introductory definitions
    ctx.textAlign = 'left';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#334155';
    const introLines = [
      'Incidents can range from minor near misses to severe accidents resulting in injuries, fatalities, or significant damage.',
      'Child Accident : Unintended injury to a child, e.g. through play or lack of spatial awareness',
      'Child Incident : Intended injury to another child, this includes when a child is acting because of an emotional response.',
      'Incident : Any unplanned event that disrupts normal operations or poses a risk to employees, equipment, or the environment',
      'Accident : A discrete, identifiable, and unintended event arising out of or in connection with work that causes physical or psychological injury.',
      'Near Miss : An event that does not cause injury or damage but has the potential to do so, serving as an early warning of possible future accidents.',
      'An incident also legally encompasses acts of non-consensual physical violence committed against a person while at work.'
    ];

    let introY = 110;
    for (const line of introLines) {
      ctx.fillText(line, 60, introY);
      introY += 18;
    }

    const startX = 60;
    const formWidth = 1080;
    let curY = 250;

    // Helper: draw section banner
    const drawSectionHeader = (title) => {
      ctx.fillStyle = '#881337'; // dark red/burgundy
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(title, startX, curY - 6);
      curY += 2;
    };

    // Helper: draw box border
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;

    // 1. ABOUT THIS FORM & IT'S COMPLETION
    drawSectionHeader("ABOUT THIS FORM & IT'S COMPLETION");
    ctx.strokeRect(startX, curY, formWidth, 60);
    ctx.beginPath();
    ctx.moveTo(startX, curY + 30);
    ctx.lineTo(startX + formWidth, curY + 30);
    ctx.moveTo(startX + 180, curY);
    ctx.lineTo(startX + 180, curY + 30);
    ctx.moveTo(startX + 320, curY);
    ctx.lineTo(startX + 320, curY + 30);
    ctx.moveTo(startX + 520, curY);
    ctx.lineTo(startX + 520, curY + 30);
    ctx.stroke();

    // Labels & values
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('Ref No', startX + 8, curY + 20);
    ctx.fillText('DATE', startX + 190, curY + 20);
    ctx.fillText('PROJECT NAME', startX + 530, curY + 20);
    ctx.fillText('BUILDING ADDRESS', startX + 8, curY + 50);

    // Handwritten values
    ctx.font = 'italic 18px "Segoe Print", cursive, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('27 B', startX + 75, curY + 21);
    ctx.fillText('01.03.24', startX + 245, curY + 21);
    ctx.fillText('Project One', startX + 660, curY + 21);
    ctx.fillText('HQ FORECAST', startX + 175, curY + 51);

    curY += 80;

    // 2. ABOUT THE PERSON
    drawSectionHeader('ABOUT THE PERSON');
    ctx.strokeRect(startX, curY, formWidth, 140);
    // Grid lines
    ctx.beginPath();
    ctx.moveTo(startX, curY + 30);
    ctx.lineTo(startX + formWidth, curY + 30);
    ctx.moveTo(startX, curY + 60);
    ctx.lineTo(startX + formWidth, curY + 60);
    ctx.moveTo(startX, curY + 90);
    ctx.lineTo(startX + formWidth, curY + 90);
    ctx.moveTo(startX, curY + 115);
    ctx.lineTo(startX + formWidth, curY + 115);

    ctx.moveTo(startX + 540, curY);
    ctx.lineTo(startX + 540, curY + 90);
    ctx.stroke();

    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('Name of the person involved', startX + 8, curY + 20);
    ctx.fillText('D.O.B', startX + 550, curY + 20);
    ctx.fillText('Registered Address', startX + 8, curY + 50);
    ctx.fillText('Postcode', startX + 550, curY + 50);
    ctx.fillText('Contact Number', startX + 8, curY + 80);
    ctx.fillText('Responsible Adult', startX + 550, curY + 80);
    ctx.fillText('STAFF:  EY Staff [ ]   Non EY Staff [ ]   Visitor [ ]   Parent [ ]   CHILD: Daycare [X]', startX + 8, curY + 107);
    ctx.fillText('SESSION', startX + 8, curY + 132);

    ctx.font = 'italic 18px "Segoe Print", cursive, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('John Mews', startX + 220, curY + 21);
    ctx.fillText('2002-02-17', startX + 620, curY + 21);
    ctx.fillText('2 AMY MEWS', startX + 180, curY + 51);
    ctx.fillText('BT31 8BX', startX + 630, curY + 51);
    ctx.fillText('1217R1610', startX + 120, curY + 133);

    curY += 160;

    // 3. ABOUT THE INCIDENT
    drawSectionHeader('ABOUT THE INCIDENT');
    ctx.strokeRect(startX, curY, formWidth, 80);
    ctx.beginPath();
    ctx.moveTo(startX, curY + 30);
    ctx.lineTo(startX + formWidth, curY + 30);
    ctx.moveTo(startX, curY + 55);
    ctx.lineTo(startX + formWidth, curY + 55);
    ctx.stroke();

    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('DATE', startX + 8, curY + 20);
    ctx.fillText('TIME', startX + 240, curY + 20);
    ctx.fillText('SPACE', startX + 440, curY + 20);
    ctx.fillText('TYPE:  ACCIDENT [X]     INCIDENT [ ]     NEAR MISS [ ]', startX + 8, curY + 45);
    ctx.fillText('SEVERITY RIDDOR:  MODERATE [ ]     MINOR [ ]', startX + 8, curY + 70);

    ctx.font = 'italic 18px "Segoe Print", cursive, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('01.03.24', startX + 70, curY + 21);
    ctx.fillText('11:45 AM', startX + 300, curY + 21);
    ctx.fillText('OUTDOOR PLAY AREA', startX + 510, curY + 21);

    curY += 100;

    // 4. RIDDOR?
    drawSectionHeader('RIDDOR?');
    ctx.strokeRect(startX, curY, formWidth, 75);
    ctx.beginPath();
    ctx.moveTo(startX, curY + 25);
    ctx.lineTo(startX + formWidth, curY + 25);
    ctx.moveTo(startX, curY + 50);
    ctx.lineTo(startX + formWidth, curY + 50);
    ctx.moveTo(startX + 540, curY);
    ctx.lineTo(startX + 540, curY + 75);
    ctx.stroke();

    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('DANGEROUS OCCURRENCE [ ]', startX + 15, curY + 18);
    ctx.fillText('REPORTABLE DISEASE [ ]', startX + 555, curY + 18);
    ctx.fillText('INJURY TO PUBLIC [ ]', startX + 15, curY + 43);
    ctx.fillText('INJURY 3 DAYS [ ]', startX + 555, curY + 43);
    ctx.fillText('MAJOR INJURY [X]', startX + 15, curY + 68);
    ctx.fillText('DEATH [ ]', startX + 555, curY + 68);

    curY += 95;

    // 5. CAUSE
    drawSectionHeader('CAUSE');
    ctx.strokeRect(startX, curY, formWidth, 75);
    ctx.beginPath();
    ctx.moveTo(startX, curY + 25);
    ctx.lineTo(startX + formWidth, curY + 25);
    ctx.moveTo(startX, curY + 50);
    ctx.lineTo(startX + formWidth, curY + 50);
    ctx.moveTo(startX + 360, curY);
    ctx.lineTo(startX + 360, curY + 75);
    ctx.moveTo(startX + 720, curY);
    ctx.lineTo(startX + 720, curY + 75);
    ctx.stroke();

    ctx.fillText('CONTACT WITH PEER [X]', startX + 15, curY + 18);
    ctx.fillText('EQUIPMENT [ ]', startX + 375, curY + 18);
    ctx.fillText('UNKNOWN [ ]', startX + 735, curY + 18);
    ctx.fillText('SLIP/TRIP/FALL [ ]', startX + 15, curY + 43);
    ctx.fillText('COSHH [ ]', startX + 375, curY + 43);
    ctx.fillText('TRAFFIC [ ]', startX + 735, curY + 43);
    ctx.fillText('MANUAL HANDLING [ ]', startX + 15, curY + 68);
    ctx.fillText('CHOKING [ ]', startX + 375, curY + 68);
    ctx.fillText('VENUE [ ]', startX + 735, curY + 68);

    curY += 95;

    // 6. TYPE OF INJURY
    drawSectionHeader('TYPE OF INJURY');
    ctx.strokeRect(startX, curY, formWidth, 80);
    ctx.beginPath();
    ctx.moveTo(startX, curY + 26);
    ctx.lineTo(startX + formWidth, curY + 26);
    ctx.moveTo(startX, curY + 53);
    ctx.lineTo(startX + formWidth, curY + 53);
    ctx.moveTo(startX + 540, curY);
    ctx.lineTo(startX + 540, curY + 80);
    ctx.stroke();

    ctx.fillText('ABRASION / CUT / LIGHT BLEED [X]', startX + 15, curY + 18);
    ctx.fillText('BRUISE / SWELLING / REDNESS [ ]', startX + 555, curY + 18);
    ctx.fillText('INJURY TO HEAD / FACE [ ]', startX + 15, curY + 45);
    ctx.fillText('SENSORY LOSS [ ]', startX + 555, curY + 45);
    ctx.fillText('LOSS OF CONSCIOUSNESS [ ]', startX + 15, curY + 72);
    ctx.fillText('ORGAN INJURY / OPEN WOUND [ ]', startX + 555, curY + 72);

    curY += 100;

    // 7. OUTCOME OF INCIDENT
    drawSectionHeader('OUTCOME OF INCIDENT');
    ctx.strokeRect(startX, curY, formWidth, 60);
    ctx.beginPath();
    ctx.moveTo(startX, curY + 30);
    ctx.lineTo(startX + formWidth, curY + 30);
    ctx.moveTo(startX + 540, curY);
    ctx.lineTo(startX + 540, curY + 60);
    ctx.stroke();

    ctx.fillText('RETURN TO ACTIVITIES [X]', startX + 15, curY + 20);
    ctx.fillText('FIRST AID APPLIED [ ]', startX + 555, curY + 20);
    ctx.fillText('HOSPITAL ADMITTANCE [ ]', startX + 15, curY + 50);
    ctx.fillText('EMOTIONAL SUPPORT [ ]', startX + 555, curY + 50);

    curY += 80;

    // 8. NARRATIVE
    drawSectionHeader('NARRATIVE');
    ctx.strokeRect(startX, curY, formWidth, 75);
    ctx.font = 'italic 19px "Segoe Print", cursive, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('WENT WALKING WHERE HE WAS GOING AND CUT INTO SOME GLASS. SCRATCH ON THE ARM - CLEANED UP AND DRESSED WITH PLASTER', startX + 20, curY + 45);

    curY += 95;

    // 9. SIGNOFF
    ctx.strokeRect(startX, curY, formWidth, 110);
    ctx.beginPath();
    ctx.moveTo(startX, curY + 35);
    ctx.lineTo(startX + formWidth, curY + 35);
    ctx.moveTo(startX, curY + 70);
    ctx.lineTo(startX + formWidth, curY + 70);
    ctx.moveTo(startX + 540, curY);
    ctx.lineTo(startX + 540, curY + 70);
    ctx.stroke();

    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('FORM COMPLETED BY', startX + 8, curY + 23);
    ctx.fillText('POSITION', startX + 550, curY + 23);
    ctx.fillText('SIGNED', startX + 8, curY + 58);
    ctx.fillText('DATE', startX + 550, curY + 58);
    ctx.fillText('PARENT / GUARDIAN / RESPONSIBLE ADULT:  N/A    SIGNED: N/A    DATE: N/A', startX + 8, curY + 95);

    ctx.font = 'italic 18px "Segoe Print", cursive, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('A.E. MCINTYRE', startX + 220, curY + 24);
    ctx.fillText('LEADER', startX + 660, curY + 24);
    ctx.fillText('A. McIntyre', startX + 90, curY + 59);
    ctx.fillText('01-03-24', startX + 620, curY + 59);

    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buf);
  }

  static async generateAccidentReportPdf(outputPath) {
    const pngPath = path.join(this.getSamplesDir(), 'sample_accident_report.png');
    if (!fs.existsSync(pngPath)) {
      await this.generateAccidentReportForm(pngPath);
    }
    const pngBytes = fs.readFileSync(pngPath);
    const pdfDoc = await PDFDocument.create();
    const embedded = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([612, 792]);
    page.drawImage(embedded, { x: 0, y: 0, width: 612, height: 792 });
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, Buffer.from(pdfBytes));
  }
}

module.exports = SampleGenerator;
