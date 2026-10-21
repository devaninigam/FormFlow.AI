const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const ImagePreprocessor = require('./imagePreprocessor');
const sharp = require('sharp');
const { createCanvas } = require('@napi-rs/canvas');

/**
 * Original-Layout PDF Reconstructor
 * Preserves page dimensions, logos, labels, tables, borders, and form lines,
 * cleans handwritten ink, and overlays verified typed text with font scaling and wrapping.
 */
class PdfReconstructor {
  /**
   * Reconstruct document into a digital PDF with typed text overlay
   * @param {Array<{ pageNumber: number, width: number, height: number, buffer: Buffer, pdfPointsWidth?: number, pdfPointsHeight?: number }>} pages
   * @param {Array<object>} fields - Extracted and corrected fields
   * @param {object} options - Options { fontName?: string, showCleanedImagePreview?: boolean }
   * @returns {Promise<{ pdfBuffer: Buffer, previewImages: Array<{ pageNumber: number, dataUrl: string }>, report: object }>}
   */
  static async reconstruct(pages, fields, options = {}) {
    const pdfDoc = await PDFDocument.create();
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const previewImages = [];
    let fieldsOverlaid = 0;
    let lowConfidenceCount = 0;

    for (const page of pages) {
      const pageNum = page.pageNumber;
      const pageFields = fields.filter(f => (f.page || 1) === pageNum);

      // 1. Separate handwriting and clean ink while preserving printed form lines and borders
      const cleanedPagePng = await ImagePreprocessor.cleanHandwritingFromPage(page.buffer, pageFields);

      // Embed cleaned page as background in PDF
      const embeddedImage = await pdfDoc.embedPng(cleanedPagePng);

      // Determine PDF dimensions in points
      const pdfWidth = page.pdfPointsWidth || 612; // default 8.5"
      const pdfHeight = page.pdfPointsHeight || 792; // default 11"

      const pdfPage = pdfDoc.addPage([pdfWidth, pdfHeight]);

      // Draw original background image
      pdfPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pdfWidth,
        height: pdfHeight
      });

      // Also create a canvas preview for in-browser instant inspection
      const { loadImage } = require('@napi-rs/canvas');
      const bgImg = await loadImage(cleanedPagePng);
      const previewCanvas = createCanvas(page.width, page.height);
      const previewCtx = previewCanvas.getContext('2d');
      previewCtx.drawImage(bgImg, 0, 0, page.width, page.height);

      // 2. Overlay verified typed text onto PDF and canvas preview
      for (const field of pageFields) {
        if (!field.bounds) continue;
        const b = field.bounds;
        if (typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.width !== 'number' || typeof b.height !== 'number' || isNaN(b.x) || isNaN(b.y) || isNaN(b.width) || isNaN(b.height)) {
          continue;
        }
        const val = (field.value !== undefined && field.value !== null) ? String(field.value).trim() : '';
        if (!val || field.isBlank) continue;

        if (field.confidence < 0.6) lowConfidenceCount++;

        // Convert normalized bounds (0..1) to PDF point coordinates (origin at bottom-left)
        const boxX = b.x * pdfWidth;
        const boxTop = b.y * pdfHeight;
        const boxW = Math.max(10, b.width * pdfWidth);
        const boxH = Math.max(10, b.height * pdfHeight);
        const boxBottom = pdfHeight - (boxTop + boxH);

        // Canvas pixel coordinates (origin at top-left)
        const pxX = b.x * page.width;
        const pxY = b.y * page.height;
        const pxW = b.width * page.width;
        const pxH = b.height * page.height;

        if (field.type === 'checkbox') {
          // Render checkmark or 'X'
          const isChecked = ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(val.toLowerCase());
          if (isChecked) {
            let markSize = Math.max(8, Math.min(boxW, boxH) * 0.8);
            if (isNaN(markSize) || markSize <= 0) markSize = 10;
            const markX = isNaN(boxX) ? 20 : (boxX + (boxW - markSize) / 2);
            const markY = isNaN(boxBottom) ? 20 : (boxBottom + (boxH - markSize) / 2);

            pdfPage.drawText('X', {
              x: markX,
              y: markY,
              size: markSize,
              font: boldFont,
              color: rgb(0.08, 0.2, 0.45) // Professional digital blue-black
            });

            // Canvas preview
            previewCtx.fillStyle = '#14356f';
            previewCtx.font = `bold ${Math.round(pxH * 0.8)}px sans-serif`;
            previewCtx.textAlign = 'center';
            previewCtx.textBaseline = 'middle';
            previewCtx.fillText('X', pxX + pxW / 2, pxY + pxH / 2);
          }
          fieldsOverlaid++;
          continue;
        }

        // Helper to sanitize text for pdf-lib WinAnsi standard font
        const sanitizeForPdf = (str) => {
          if (!str) return '';
          return String(str)
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u2022/g, '*')
            .replace(/[\r\n]+/g, ' ')
            .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
            .trim();
        };

        // Text, Date, Number, Multiline fields
        // Dynamic font size calculation to fit inside the bounding box
        const isTwoLineBox = b.height > 0.025;
        let fontSize = isTwoLineBox
          ? 9
          : Math.min(10, Math.max(8.5, boxH * 0.72));
        if (isNaN(fontSize) || fontSize <= 0) fontSize = 9.5;

        const isNarrative = field.label && field.label.toLowerCase().includes('narrative');

        if (isNarrative) {
          // Dynamic word wrap across 3 ruled lines strictly within narrative text column
          const tableRight = Math.round(0.926 * pdfWidth);
          const narrPdfX = Math.round(0.193 * pdfWidth); // Starts cleanly after printed "NARRATIVE" column
          const maxNarrW = tableRight - narrPdfX - 6;

          const narrWords = val.replace(/[\r\n]+/g, ' ').split(/\s+/).filter(Boolean);
          const narrLines = [];
          let curLine = '';

          for (const w of narrWords) {
            const testLine = curLine ? `${curLine} ${w}` : w;
            const safeTest = sanitizeForPdf(testLine);
            if (regularFont.widthOfTextAtSize(safeTest, 9) > maxNarrW) {
              if (curLine) narrLines.push(curLine);
              curLine = w;
            } else {
              curLine = testLine;
            }
          }
          if (curLine) narrLines.push(curLine);

          const lineSpacingPdf = 0.0178 * pdfHeight;
          const line1Y = pdfHeight - (b.y + 0.0080) * pdfHeight;

          for (let lIdx = 0; lIdx < Math.min(narrLines.length, 3); lIdx++) {
            const lineY = line1Y - (lIdx * lineSpacingPdf);
            const cleanL = sanitizeForPdf(narrLines[lIdx]);
            if (cleanL) {
              pdfPage.drawText(cleanL, {
                x: narrPdfX,
                y: lineY,
                size: 9,
                font: regularFont,
                color: rgb(0.06, 0.12, 0.28)
              });
            }

            // Canvas preview
            const canvasLineX = Math.round(0.193 * page.width);
            const canvasLineY = Math.round((b.y + 0.0078 + lIdx * 0.0178) * page.height);
            previewCtx.fillStyle = '#0f172a';
            const cFont = Math.max(11, Math.round(9 * (page.height / pdfHeight)));
            previewCtx.font = `500 ${cFont}px Helvetica, Arial, sans-serif`;
            previewCtx.textAlign = 'left';
            previewCtx.textBaseline = 'middle';
            previewCtx.fillText(narrLines[lIdx], canvasLineX, canvasLineY);
          }
        } else if (field.type === 'multiline' || val.includes('\n') || val.length > 50) {
          const rightEdge = Math.min(pdfWidth - 10, boxX + boxW);
          const maxAllowedW = Math.max(30, rightEdge - (boxX + 4));
          const paragraphs = val.replace(/\r/g, '').split('\n');
          const lines = [];

          for (const para of paragraphs) {
            const words = para.split(/\s+/).filter(Boolean);
            if (words.length === 0) continue;
            let currentLine = '';

            for (const word of words) {
              const testLine = currentLine ? `${currentLine} ${word}` : word;
              const safeTest = sanitizeForPdf(testLine);
              if (regularFont.widthOfTextAtSize(safeTest || testLine, fontSize) > maxAllowedW) {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
              } else {
                currentLine = testLine;
              }
            }
            if (currentLine) lines.push(currentLine);
          }

          const lineHeight = fontSize * 1.35;
          let currentY = pdfHeight - boxTop - fontSize - 2;
          if (isNaN(currentY)) currentY = 20;

          for (const line of lines) {
            if (currentY < boxBottom) break; // prevent overflowing below box
            const cleanPdfLine = sanitizeForPdf(line);
            if (cleanPdfLine) {
              pdfPage.drawText(cleanPdfLine, {
                x: Math.max(10, (isNaN(boxX) ? 20 : boxX) + 4),
                y: currentY,
                size: fontSize,
                font: regularFont,
                color: rgb(0.06, 0.12, 0.28)
              });
            }
            currentY -= lineHeight;
          }

          // Canvas preview
          previewCtx.fillStyle = '#0f172a';
          const canvasFontSize = Math.max(9, Math.round(fontSize * (page.height / pdfHeight)));
          previewCtx.font = `500 ${canvasFontSize}px Helvetica, Arial, sans-serif`;
          previewCtx.textAlign = 'left';
          previewCtx.textBaseline = 'top';
          let canvasY = pxY + 4;
          for (const line of lines) {
            previewCtx.fillText(line, pxX + 4, canvasY);
            canvasY += canvasFontSize * 1.35;
          }
        } else {
          const cleanPdfVal = sanitizeForPdf(val);
          const maxAllowedW = Math.max(20, Math.min(boxW - 8, pdfWidth - boxX - 12));
          let textWidth = regularFont.widthOfTextAtSize(cleanPdfVal || val, fontSize);

          // Single-line field: dynamically shrink if needed to avoid overflow
          while (textWidth > maxAllowedW && fontSize > 6) {
            fontSize -= 0.5;
            textWidth = regularFont.widthOfTextAtSize(cleanPdfVal || val, fontSize);
          }
          // Baseline positioning: sit neatly inside line 1 if box is multi-line (e.g. Registered Address)
          const baselineY = isTwoLineBox
            ? (boxBottom + boxH - (0.0175 * pdfHeight) * 0.70)
            : (isNaN(boxBottom) ? 20 : (boxBottom + Math.max(2, (boxH - fontSize) * 0.35)));

          const drawX = Math.max(10, Math.min(boxX + 4, pdfWidth - textWidth - 10));

          if (cleanPdfVal) {
            pdfPage.drawText(cleanPdfVal, {
              x: drawX,
              y: baselineY,
              size: fontSize,
              font: regularFont,
              color: rgb(0.06, 0.12, 0.28)
            });
          }

          // Canvas preview setup
          const canvasFontSize = isTwoLineBox
            ? Math.round(9.5 * (page.height / pdfHeight))
            : Math.round(fontSize * (page.height / pdfHeight));
          previewCtx.fillStyle = '#0f172a';
          previewCtx.font = `500 ${canvasFontSize}px Helvetica, Arial, sans-serif`;
          const canvasY = isTwoLineBox
            ? (pxY + (0.0175 * page.height) * 0.50)
            : (pxY + pxH * 0.50);

          previewCtx.save();
          previewCtx.textAlign = 'left';
          previewCtx.textBaseline = 'middle';
          previewCtx.fillText(val, pxX + 4, canvasY);
          previewCtx.restore();
        }

        fieldsOverlaid++;
      }

      // Save preview image as base64 data URL
      const previewBuffer = previewCanvas.toBuffer('image/png');
      previewImages.push({
        pageNumber: pageNum,
        dataUrl: `data:image/png;base64,${previewBuffer.toString('base64')}`
      });
    }

    const pdfBytes = await pdfDoc.save();

    const report = {
      pagesProcessed: pages.length,
      fieldsOverlaid,
      lowConfidenceCount,
      reconstructionQuality: lowConfidenceCount > 3 ? 'review_recommended' : 'high_confidence',
      preservationMethod: 'intelligent_stroke_inpainting_and_vector_overlay'
    };

    return {
      pdfBuffer: Buffer.from(pdfBytes),
      previewImages,
      report
    };
  }
}

module.exports = PdfReconstructor;
