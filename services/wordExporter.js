const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  HeadingLevel,
  AlignmentType
} = require('docx');

/**
 * Word (.docx) Document Generator
 * Produces pixel-perfect, authentic Word documents that mirror the clean,
 * modern UI layout (navy headers, distinct label/value cells, check pills,
 * discrete session boxes, lined narrative) with ZERO yellow highlights.
 */
class WordExporter {
  /**
   * Generate an editable .docx Buffer matching the uploaded document form layout
   * @param {object} docData - { filename, documentTitle, fields, tables, summary }
   * @returns {Promise<Buffer>}
   */
  static async generateDocx(docData) {
    const fields = docData.fields || [];
    const tables = docData.tables || [];
    const summary = docData.summary || {};

    const findVal = (regex, fallback = '') => {
      const f = fields.find(field => field && field.label && regex.test(field.label));
      if (!f || f.value === undefined || f.value === null) return fallback;
      const v = String(f.value).trim();
      return v !== '' ? v : fallback;
    };

    const isChecked = (regex) => {
      const f = fields.find(field => field && field.label && regex.test(field.label));
      if (!f || f.value === undefined || f.value === null) return false;
      const v = String(f.value || '').toLowerCase().trim();
      return ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(v);
    };

    const isAccidentReport =
      /accident|incident/i.test(docData.filename || docData.documentTitle || '') ||
      fields.some(f => /riddor|injury|incident|daycare|toybox|ey staff/i.test(f.label || ''));

    // Master Form navy border (matches Image 2 UI)
    const navyBorder = {
      top: { style: BorderStyle.SINGLE, size: 2, color: '1E3A5F' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: '1E3A5F' },
      left: { style: BorderStyle.SINGLE, size: 2, color: '1E3A5F' },
      right: { style: BorderStyle.SINGLE, size: 2, color: '1E3A5F' }
    };

    const thinBorder = {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' }
    };

    const cellMargins = { top: 70, bottom: 70, left: 110, right: 110 };

    // Helper: Header label cell (#E8EEF7 light blue, bold #1E3A5F text)
    const makeHdrCell = (text, widthPct, colSpan = 1, options = {}) => {
      return new TableCell({
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        columnSpan: colSpan > 1 ? colSpan : undefined,
        shading: { fill: options.bg || 'E8EEF7' },
        borders: navyBorder,
        margins: cellMargins,
        children: [
          new Paragraph({
            alignment: options.align || AlignmentType.LEFT,
            children: [
              new TextRun({
                text: text,
                bold: true,
                color: options.color || '1E3A5F',
                size: 16,
                font: 'Segoe UI'
              })
            ]
          })
        ]
      });
    };

    // Helper: Value cell (#FFFFFF white, bold #0F172A text)
    const makeValCell = (val, widthPct, colSpan = 1, options = {}) => {
      return new TableCell({
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        columnSpan: colSpan > 1 ? colSpan : undefined,
        shading: { fill: options.bg || 'FFFFFF' },
        borders: navyBorder,
        margins: cellMargins,
        children: [
          new Paragraph({
            alignment: options.align || AlignmentType.LEFT,
            children: [
              new TextRun({
                text: val || (options.placeholder || ''),
                bold: !!val,
                color: val ? (options.color || '0F172A') : '94A3B8',
                italics: options.italics || false,
                size: 18,
                font: options.font || 'Segoe UI'
              })
            ]
          })
        ]
      });
    };

    // Helper: Checkbox pill cell with [X] / [   ] and green highlight when checked
    const makeCheckPillCell = (label, checked, widthPct, colSpan = 1) => {
      return new TableCell({
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        columnSpan: colSpan > 1 ? colSpan : undefined,
        shading: { fill: checked ? 'F0FDF4' : 'FFFFFF' },
        borders: navyBorder,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: label,
                bold: checked,
                color: checked ? '065F46' : '334155',
                size: 16,
                font: 'Segoe UI'
              }),
              new TextRun({
                text: checked ? '   [X]' : '   [   ]',
                bold: true,
                color: checked ? '166534' : '64748B',
                size: 16,
                font: 'Consolas'
              })
            ]
          })
        ]
      });
    };

    // Helper: Dark-blue section banner row spanning all columns
    const makeBannerRow = (title, totalColSpan = 6) => {
      return new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnSpan: totalColSpan,
            shading: { fill: '1E3A5F' },
            borders: navyBorder,
            margins: { top: 75, bottom: 75, left: 130, right: 130 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: title.toUpperCase(),
                    bold: true,
                    color: 'FFFFFF',
                    size: 18,
                    font: 'Segoe UI'
                  })
                ]
              })
            ]
          })
        ]
      });
    };

    const children = [];

    if (isAccidentReport) {
      // -------------------------------------------------------------
      // Authentic Accident & Incident Report Form Document (Matches Image 2)
      // -------------------------------------------------------------
      const refNo = findVal(/ref\s*no|reference/i, '');
      const formDate = findVal(/^form date/i, '');
      const project = findVal(/project name|project/i, '');
      const address = findVal(/building address|address/i, '');

      const name = findVal(/name of the person/i, '');
      const dob = findVal(/d\.o\.b|date of birth/i, '');
      const age = findVal(/^age/i, '');
      const regAddress = findVal(/registered address/i, '');
      const postcode = findVal(/postcode/i, '');
      const contact = findVal(/contact number/i, '');
      const adult = findVal(/responsible adult/i, '');
      const session = findVal(/session/i, '');

      const incDate = findVal(/^incident date/i, '');
      const incTime = findVal(/incident time|^time/i, '');
      const location = findVal(/space|location|room/i, '');

      const narrative = findVal(/narrative/i, '');
      const completedBy = findVal(/completed by/i, '');
      const position = findVal(/position/i, '');
      const signature = findVal(/signature/i, '');
      const dateSigned = findVal(/date signed/i, '');
      const parentSigned = findVal(/parent signed|parent.*guardian/i, '');
      const parentDate = findVal(/parent.*date/i, '');
      const parentTime = findVal(/parent.*time/i, '');
      const comments = findVal(/comments/i, '');

      // Title & Subtitle
      children.push(
        new Paragraph({
          text: 'ACCIDENT & INCIDENT REPORT FORM',
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [
            new TextRun({
              text: 'ACCIDENT & INCIDENT REPORT FORM',
              bold: true,
              color: '1E3A5F',
              font: 'Segoe UI',
              size: 26
            })
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: `FILLED FROM MASTER TEMPLATE LAYOUT • SOURCE: ${docData.filename || 'Example 2.pdf'} • ${new Date().toLocaleDateString()}`,
              bold: true,
              color: '64748B',
              font: 'Segoe UI',
              size: 15
            })
          ]
        })
      );

      // Top Instructions Box
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' }
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  shading: { fill: 'F8FAFC' },
                  margins: { top: 80, bottom: 80, left: 140, right: 140 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: 'Incidents can range from minor near misses to severe accidents resulting in injuries, fatalities, or significant damage.\n', bold: true, size: 15, color: '334155', font: 'Segoe UI' }),
                        new TextRun({ text: '• Child Accident: ', bold: true, size: 15, color: '334155', font: 'Segoe UI' }),
                        new TextRun({ text: 'Unintended injury to a child, e.g. through play or lack of spatial awareness.\n', size: 15, color: '475569', font: 'Segoe UI' }),
                        new TextRun({ text: '• Child Incident: ', bold: true, size: 15, color: '334155', font: 'Segoe UI' }),
                        new TextRun({ text: 'Intended injury to another child, this includes when a child is acting because of an emotional response.\n', size: 15, color: '475569', font: 'Segoe UI' }),
                        new TextRun({ text: '• Incident: ', bold: true, size: 15, color: '334155', font: 'Segoe UI' }),
                        new TextRun({ text: 'Any unplanned event that disrupts normal operations or poses a risk to employees, equipment, or the environment.\n', size: 15, color: '475569', font: 'Segoe UI' }),
                        new TextRun({ text: '• Accident: ', bold: true, size: 15, color: '334155', font: 'Segoe UI' }),
                        new TextRun({ text: 'A discrete, identifiable, and unintended event arising out of or in connection with work causing injury.', size: 15, color: '475569', font: 'Segoe UI' })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 1: ABOUT THIS FORM & IT'S COMPLETION
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow("ABOUT THIS FORM & IT'S COMPLETION", 6),
            new TableRow({
              children: [
                makeHdrCell('Ref No', 12),
                makeValCell(refNo, 18),
                makeHdrCell('DATE', 10),
                makeValCell(formDate, 20),
                makeHdrCell('PROJECT NAME', 16),
                makeValCell(project, 24)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('BUILDING ADDRESS', 16),
                makeValCell(address, 84, 5)
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 2: ABOUT THE PERSON
      const staffEy = isChecked(/staff:\s*ey staff/i);
      const staffNonEy = isChecked(/staff:\s*non ey/i);
      const staffVis = isChecked(/staff:\s*visitor/i);
      const staffParent = isChecked(/staff:\s*parent/i);
      const childDaycare = isChecked(/child status:\s*daycare|daycare/i);
      const childToybox = isChecked(/child status:\s*toybox|toybox/i);
      const childSurestart = isChecked(/child status:\s*surestart|surestart/i);

      // Discrete session characters
      const sessionRuns = [];
      const sessionChars = (session || '').split('');
      for (const ch of sessionChars) {
        if (ch === ' ') {
          sessionRuns.push(new TextRun({ text: '   ', font: 'Consolas', size: 18 }));
        } else {
          sessionRuns.push(
            new TextRun({
              text: `[ ${ch} ] `,
              bold: true,
              color: '0F172A',
              font: 'Consolas',
              size: 18
            })
          );
        }
      }

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('ABOUT THE PERSON', 4),
            new TableRow({
              children: [
                makeHdrCell('Name of the person involved', 25),
                makeValCell(name, 35),
                makeHdrCell('D.O.B', 15),
                makeValCell(dob, 25)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('Registered Address', 25),
                makeValCell(regAddress, 35),
                makeHdrCell('Postcode', 15),
                makeValCell(postcode, 25)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('Contact Number', 25),
                makeValCell(contact, 35),
                makeHdrCell('Responsible Adult', 15),
                makeValCell(adult, 25)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('STAFF', 16),
                makeCheckPillCell('EY Staff', staffEy, 21),
                makeCheckPillCell('Non EY Staff', staffNonEy, 21),
                makeCheckPillCell('Visitor', staffVis, 21),
                makeCheckPillCell('Parent', staffParent, 21)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('CHILD', 16),
                makeCheckPillCell('Daycare', childDaycare, 28),
                makeCheckPillCell('ToyBox', childToybox, 28),
                makeCheckPillCell('SureStart', childSurestart, 28)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('SESSION', 16),
                new TableCell({
                  width: { size: 84, type: WidthType.PERCENTAGE },
                  columnSpan: 3,
                  shading: { fill: 'FFFFFF' },
                  borders: navyBorder,
                  margins: cellMargins,
                  children: [
                    new Paragraph({
                      children: sessionRuns
                    })
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 3: ABOUT THE INCIDENT
      const typeAccident = isChecked(/incident type:\s*accident|accident/i);
      const typeIncident = isChecked(/incident type:\s*incident/i);
      const typeNearMiss = isChecked(/near miss/i);

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('ABOUT THE INCIDENT', 6),
            new TableRow({
              children: [
                makeHdrCell('DATE', 12),
                makeValCell(incDate, 20),
                makeHdrCell('TIME', 10),
                makeValCell(incTime, 18),
                makeHdrCell('SPACE', 14),
                makeValCell(location, 26)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('TYPE', 16),
                makeCheckPillCell('ACCIDENT', typeAccident, 28),
                makeCheckPillCell('INCIDENT', typeIncident, 28),
                makeCheckPillCell('NEAR MISS', typeNearMiss, 28, 3)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('SEVERITY', 16),
                makeCheckPillCell('RIDDOR', isChecked(/severity:\s*riddor/i), 28),
                makeCheckPillCell('MODERATE', isChecked(/severity:\s*moderate/i), 28),
                makeCheckPillCell('MINOR', isChecked(/severity:\s*minor/i), 28, 3)
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 4: RIDDOR ?
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('RIDDOR ?', 2),
            new TableRow({
              children: [
                makeCheckPillCell('DANGEROUS OCCURRENCE', isChecked(/dangerous/i), 50),
                makeCheckPillCell('REPORTABLE DISEASE', isChecked(/reportable/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('INJURY TO PUBLIC', isChecked(/injury to public/i), 50),
                makeCheckPillCell('INJURY 3 DAYS', isChecked(/injury 3 days/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('MAJOR INJURY', isChecked(/major/i), 50),
                makeCheckPillCell('DEATH', isChecked(/death/i), 50)
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 5: CAUSE
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('CAUSE', 3),
            new TableRow({
              children: [
                makeCheckPillCell('CONTACT WITH PEER', isChecked(/contact/i), 34),
                makeCheckPillCell('EQUIPMENT', isChecked(/equipment/i), 33),
                makeCheckPillCell('UNKNOWN', isChecked(/unknown/i), 33)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('SLIP / TRIP / FALL', isChecked(/slip/i), 34),
                makeCheckPillCell('COSHH', isChecked(/coshh/i), 33),
                makeCheckPillCell('TRAFFIC', isChecked(/traffic/i), 33)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('MANUAL HANDLING', isChecked(/manual/i), 34),
                makeCheckPillCell('CHOKING', isChecked(/choking/i), 33),
                makeCheckPillCell('VENUE', isChecked(/venue/i), 33)
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 6: TYPE OF INJURY
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('TYPE OF INJURY', 2),
            new TableRow({
              children: [
                makeCheckPillCell('ABRASION / SMALL CUT / LIGHT BLEED', isChecked(/abrasion|cut/i), 50),
                makeCheckPillCell('BRUISE / SWELLING / REDNESS', isChecked(/bruise/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('STRAIN / DISLOCATION', isChecked(/strain/i), 50),
                makeCheckPillCell('FRACTURE / BROKEN BONE', isChecked(/fracture/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('INJURY TO HEAD / FACE', isChecked(/injury to head/i), 50),
                makeCheckPillCell('SENSORY LOSS', isChecked(/sensory/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('LOSS OF CONSCIOUSNESS', isChecked(/consciousness/i), 50),
                makeCheckPillCell('ORGAN INJURY / OPEN WOUND', isChecked(/organ/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('PROPERTY DAMAGE (INC VEHICLE)', isChecked(/property/i), 50),
                makeCheckPillCell('EMOTIONAL DISTRESS', isChecked(/emotional/i), 50)
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 7: OUTCOME OF INCIDENT
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('OUTCOME OF INCIDENT', 2),
            new TableRow({
              children: [
                makeCheckPillCell('RETURN TO ACTIVITIES', isChecked(/return to activities/i), 50),
                makeCheckPillCell('FIRST AID APPLIED', isChecked(/first aid/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('TO RESPONSIBLE ADULT CARE', isChecked(/to responsible/i), 50),
                makeCheckPillCell('NIAS CALLED', isChecked(/nias/i), 50)
              ]
            }),
            new TableRow({
              children: [
                makeCheckPillCell('HOSPITAL ADMITTANCE', isChecked(/hospital/i), 50),
                makeCheckPillCell('EMOTIONAL SUPPORT', isChecked(/emotional/i), 50)
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 8: NARRATIVE
      const narrLines = narrative.split('\n').filter(Boolean);
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('NARRATIVE', 1),
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: navyBorder,
                  margins: { top: 90, bottom: 90, left: 140, right: 140 },
                  shading: { fill: 'FFFFFF' },
                  children: [
                    ...narrLines.map((line, idx) =>
                      new Paragraph({
                        spacing: { before: 40, after: 40 },
                        children: [
                          idx === 0
                            ? new TextRun({ text: 'NARRATIVE: ', bold: true, color: '475569', font: 'Segoe UI', size: 18 })
                            : new TextRun({ text: '' }),
                          new TextRun({ text: line, bold: true, color: '0F172A', font: 'Segoe UI', size: 18 })
                        ]
                      })
                    ),
                    new Paragraph({
                      spacing: { before: 60, after: 20 },
                      children: [
                        new TextRun({
                          text: '_________________________________________________________________________________',
                          color: 'CBD5E1',
                          font: 'Consolas',
                          size: 16
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 120 } })
      );

      // Section 9: COMPLETION & SIGN-OFF
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeBannerRow('COMPLETION & SIGN-OFF', 4),
            new TableRow({
              children: [
                makeHdrCell('FORM COMPLETED BY', 22),
                makeValCell(completedBy, 28),
                makeHdrCell('POSITION', 18),
                makeValCell(position, 32)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('SIGNED', 22),
                makeValCell(signature, 28, 1, { color: '1E3A8A', font: 'Segoe Script' }),
                makeHdrCell('DATE', 18),
                makeValCell(dateSigned, 32)
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('PARENT / GUARDIAN / RESPONSIBLE ADULT', 100, 6, { bg: 'F1F5F9', color: '1E3A5F', align: AlignmentType.CENTER })
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('SIGNED', 16),
                makeValCell(parentSigned || '___________________', 28, 1, { color: parentSigned ? '1E3A8A' : '94A3B8' }),
                makeHdrCell('DATE', 14),
                makeValCell(parentDate || '__________', 18, 1, { color: parentDate ? '0F172A' : '94A3B8' }),
                makeHdrCell('TIME', 10),
                makeValCell(parentTime || '__________', 14, 1, { color: parentTime ? '0F172A' : '94A3B8' })
              ]
            }),
            new TableRow({
              children: [
                makeHdrCell('COMMENTS', 16),
                makeValCell(comments || '', 84, 5)
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 160 } })
      );
    } else {
      // -------------------------------------------------------------
      // Generic Dynamic Form Document
      // -------------------------------------------------------------
      let docTitle = docData.documentTitle;
      if (!docTitle || docTitle.toLowerCase() === 'document' || docTitle.toLowerCase() === 'unknown') {
        const titleField = fields.find(f => /report title|form title|document title/i.test(f.label));
        docTitle = titleField?.value || (docData.filename || 'FORM').replace(/^[0-9]+_[0-9a-f]+_/i, '').replace(/\.[^/.]+$/, '').replace(/_/g, ' ').toUpperCase();
      }

      children.push(
        new Paragraph({
          text: docTitle,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 120 }
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'DIGITAL DOCUMENT EXPORT  |  ', bold: true, color: '1E3A8A', size: 18 }),
            new TextRun({ text: `Source: ${docData.filename || 'Uploaded Document'}  |  `, italics: true, color: '64748B', size: 18 }),
            new TextRun({ text: `Exported: ${new Date().toLocaleDateString()}`, italics: true, color: '64748B', size: 18 })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 260 }
        })
      );

      // Categorize fields dynamically
      const sectionMap = new Map();
      for (const f of fields) {
        const sec = f.section || 'General Details';
        if (!sectionMap.has(sec)) sectionMap.set(sec, []);
        sectionMap.get(sec).push(f);
      }

      for (const [secName, secFields] of sectionMap.entries()) {
        const secCheckboxes = secFields.filter(f => f.type === 'checkbox');
        const secMultiline = secFields.filter(f => f.type === 'multiline' || (f.value && String(f.value).length > 70));
        const secRegular = secFields.filter(f => !secCheckboxes.includes(f) && !secMultiline.includes(f));

        const secRows = [makeBannerRow(secName, 2)];

        for (let i = 0; i < secRegular.length; i += 2) {
          const f1 = secRegular[i];
          const f2 = secRegular[i + 1];
          secRows.push(
            new TableRow({
              children: f2 ? [
                makeHdrCell(f1.label, 20),
                makeValCell(f1.value, 30),
                makeHdrCell(f2.label, 20),
                makeValCell(f2.value, 30)
              ] : [
                makeHdrCell(f1.label, 25),
                makeValCell(f1.value, 75)
              ]
            })
          );
        }

        for (let i = 0; i < secCheckboxes.length; i += 2) {
          const cb1 = secCheckboxes[i];
          const cb2 = secCheckboxes[i + 1];
          const checked1 = ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(cb1.value || '').toLowerCase());
          const checked2 = cb2 ? ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(cb2.value || '').toLowerCase()) : false;

          secRows.push(
            new TableRow({
              children: cb2 ? [
                makeCheckPillCell(cb1.label, checked1, 50),
                makeCheckPillCell(cb2.label, checked2, 50)
              ] : [
                makeCheckPillCell(cb1.label, checked1, 100)
              ]
            })
          );
        }

        for (const ml of secMultiline) {
          secRows.push(
            new TableRow({
              children: [
                makeHdrCell(ml.label, 25),
                makeValCell(ml.value, 75)
              ]
            })
          );
        }

        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: secRows
          }),
          new Paragraph({ spacing: { after: 140 } })
        );
      }
    }

    // Append detected tables if present
    if (tables.length > 0) {
      children.push(
        new Paragraph({
          text: 'Detected Tables & Option Grids',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 180, after: 100 }
        })
      );

      for (const tbl of tables) {
        if (!tbl.rows || tbl.rows.length === 0) continue;

        const tableRows = [];
        if (tbl.headers && tbl.headers.length > 0) {
          const hCells = tbl.headers.map(h =>
            new TableCell({
              shading: { fill: '1E3A5F' },
              borders: navyBorder,
              margins: cellMargins,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 17 })
                  ]
                })
              ]
            })
          );
          tableRows.push(new TableRow({ children: hCells }));
        }

        for (const rowData of tbl.rows) {
          const rCells = rowData.map((cellText, cellIdx) =>
            new TableCell({
              borders: thinBorder,
              margins: cellMargins,
              shading: { fill: cellIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF' },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: String(cellText || ''), size: 18, color: '0F172A' })
                  ]
                })
              ]
            })
          );
          tableRows.push(new TableRow({ children: rCells }));
        }

        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows
          }),
          new Paragraph({ spacing: { after: 140 } })
        );
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 720,    // 0.5 inch
                right: 720,
                bottom: 720,
                left: 720
              }
            }
          },
          children
        }
      ]
    });

    return await Packer.toBuffer(doc);
  }
}

module.exports = WordExporter;
