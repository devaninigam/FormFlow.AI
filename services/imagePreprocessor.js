const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createCanvas } = require('@napi-rs/canvas');

/**
 * Image and Document Preprocessor
 * Handles multi-format rasterization, page extraction, dimension tracking,
 * and ink-background separation with line/border preservation.
 */
class ImagePreprocessor {
  /**
   * Convert uploaded file buffer (or disk path for samples/tests) into high-resolution page buffers and metadata.
   * Accepts Buffer directly so user uploads never need to touch disk.
   * @param {Buffer|string} input - Document Buffer in memory or file path
   * @param {string} mimeType - File MIME type
   * @returns {Promise<Array<{ pageNumber: number, width: number, height: number, buffer: Buffer, originalType: string }>>}
   */
  static async extractPages(input, mimeType) {
    const isPdf =
      mimeType === 'application/pdf' ||
      (typeof input === 'string' && input.toLowerCase().endsWith('.pdf'));

    if (isPdf) {
      return await this.extractPdfPages(input);
    } else {
      return await this.extractImagePages(input);
    }
  }

  /**
   * Rasterize PDF pages using pdfjs-dist and @napi-rs/canvas
   */
  static async extractPdfPages(input) {
    const data = Buffer.isBuffer(input)
      ? new Uint8Array(input)
      : new Uint8Array(fs.readFileSync(input));
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const wasmUrl = path.resolve(__dirname, '../node_modules/pdfjs-dist/wasm') + '/';
    const cMapUrl = path.resolve(__dirname, '../node_modules/pdfjs-dist/cmaps') + '/';
    const standardFontDataUrl = path.resolve(__dirname, '../node_modules/pdfjs-dist/standard_fonts') + '/';

    const loadingTask = pdfjsLib.getDocument({
      data,
      wasmUrl,
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      disableFontFace: false,
      useSystemFonts: true
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    // Process all pages safely (up to 50 pages per document to prevent memory issues)
    const maxPagesToProcess = Math.min(numPages, 50);
    const pages = [];
    // Scale 2.5 (~180 DPI) for sharp OCR rendering; scale 2.0 for large multi-page docs
    const renderScale = maxPagesToProcess > 10 ? 2.0 : 2.5;

    try {
      for (let i = 1; i <= maxPagesToProcess; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = createCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d');

        // Fill white background before rendering PDF
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        await page.render({
          canvasContext: ctx,
          viewport
        }).promise;

        // Extract native digital text items and exact coordinates if present
        let textItems = [];
        try {
          const textContent = await page.getTextContent();
          textItems = (textContent.items || []).map(it => {
            const [vx, vy] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
            const w = (it.width || 0) * renderScale;
            const h = (it.height || 0) * renderScale;
            return {
              str: it.str || '',
              vx: Math.round(vx),
              vy: Math.round(vy),
              w: Math.round(w),
              h: Math.round(h),
              normX: Number((vx / viewport.width).toFixed(4)),
              normY: Number(((vy - h) / viewport.height).toFixed(4)),
              normW: Number((w / viewport.width).toFixed(4)),
              normH: Number((h / viewport.height).toFixed(4))
            };
          }).filter(it => it.str && it.str.trim().length > 0);
        } catch (err) {
          console.warn('PDF text extraction error on page', i, err.message);
        }

        const pngBuffer = canvas.toBuffer('image/png');
        pages.push({
          pageNumber: i,
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
          pdfPointsWidth: Math.round(viewport.width / renderScale),
          pdfPointsHeight: Math.round(viewport.height / renderScale),
          buffer: pngBuffer,
          originalType: 'pdf',
          textItems,
          fullText: textItems.map(it => it.str).join(' ')
        });
      }
    } finally {
      try { await pdfDoc.destroy?.(); } catch (_) { /* ignore */ }
    }

    return pages;
  }

  /**
   * Process standard image buffer/file (JPEG, PNG, TIFF, WEBP, BMP, etc.)
   * Auto-orients EXIF, normalizes high-resolution camera photos (e.g. 12MP-48MP)
   * to safe dimensions to prevent OOM and timeouts, and sharpens low-resolution scans.
   */
  static async extractImagePages(input) {
    let image = sharp(input, { failOnError: false }).rotate(); // auto-orient based on EXIF
    const metadata = await image.metadata();

    let currentW = metadata.width || 1600;
    let currentH = metadata.height || 2200;
    // Swap dimensions if EXIF orientation rotated 90 or 270 degrees
    if (metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8) {
      [currentW, currentH] = [currentH, currentW];
    }

    const maxDim = 3200;
    const minDim = 1200;
    let finalW = currentW;
    let finalH = currentH;
    let processedImage = image;

    if (Math.max(currentW, currentH) > maxDim) {
      // Scale down excessively large images (e.g. 48MP camera photos)
      // to optimal OCR resolution (~2400x3200) to keep memory footprint light and sharp
      const scale = maxDim / Math.max(currentW, currentH);
      finalW = Math.round(currentW * scale);
      finalH = Math.round(currentH * scale);
      processedImage = image.resize({ width: finalW, height: finalH, fit: 'inside' });
    } else if (currentW < minDim) {
      // Upscale low-res scans for crisp OCR recognition
      const scale = 1800 / currentW;
      finalW = 1800;
      finalH = Math.round(currentH * scale);
      processedImage = image.resize({ width: finalW, height: finalH }).sharpen();
    }

    const pngBuffer = await processedImage.png({ compressionLevel: 6 }).toBuffer();
    return [{
      pageNumber: 1,
      width: finalW,
      height: finalH,
      pdfPointsWidth: Math.round(finalW * 0.5),
      pdfPointsHeight: Math.round(finalH * 0.5),
      buffer: pngBuffer,
      originalType: metadata.format || 'image'
    }];
  }

  /**
   * Clean handwriting from a specific bounding box region on a page image
   * while strictly preserving form lines, table borders, and labels!
   *
   * @param {Buffer} pageBuffer - PNG buffer of original page
   * @param {Array<{ x: number, y: number, width: number, height: number, label: string }>} fields - Normalized (0..1) fields to clean
   * @param {object} options - Cleanup options
   * @returns {Promise<Buffer>} - Cleaned PNG buffer
   */
  static async cleanHandwritingFromPage(pageBuffer, fields, options = {}) {
    const pageImage = sharp(pageBuffer);
    const metadata = await pageImage.metadata();
    const pageWidth = metadata.width;
    const pageHeight = metadata.height;

    // Load page into canvas for pixel-level line-preserving inpainting
    const { loadImage } = require('@napi-rs/canvas');
    const img = await loadImage(pageBuffer);
    const canvas = createCanvas(pageWidth, pageHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, pageWidth, pageHeight);

    const fullImageData = ctx.getImageData(0, 0, pageWidth, pageHeight);
    const fullPixels = fullImageData.data;

    for (const field of fields) {
      if (!field.bounds) continue;
      // Do not inpaint or wipe background for blank/unfilled fields or unchecked boxes
      const fieldVal = field.value !== undefined && field.value !== null ? String(field.value).trim() : '';
      if (!fieldVal || field.isBlank) continue;
      if (field.type === 'checkbox' && !['true', 'yes', '1', '[x]', 'checked', 'x'].includes(fieldVal.toLowerCase())) {
        continue;
      }

      const b = field.bounds;
      // Skip fields with unlocalized/default fallback bounds (e.g. { x: 0.1, y: 0.1 }) to avoid wiping headers
      if ((b.x === 0.1 && b.y === 0.1) || (b.x === 0.1 && b.y === 0.3) || b.width > 0.65) {
        continue;
      }

      // Convert normalized bounds (0..1) to actual pixel coordinates
      const pxX = Math.max(0, Math.floor(b.x * pageWidth));
      const pxY = Math.max(0, Math.floor(b.y * pageHeight));
      const pxW = Math.min(pageWidth - pxX, Math.ceil(b.width * pageWidth));
      const pxH = Math.min(pageHeight - pxY, Math.ceil(b.height * pageHeight));

      if (pxW <= 6 || pxH <= 6) continue;

      // 1. Determine local background paper color by sampling pixels around edges
      let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;

      for (let y = pxY; y < pxY + pxH; y++) {
        for (let x = pxX; x < pxX + pxW; x++) {
          const idx = (y * pageWidth + x) * 4;
          const r = fullPixels[idx];
          const g = fullPixels[idx + 1];
          const bVal = fullPixels[idx + 2];
          const brightness = (r + g + bVal) / 3;

          // Sample brighter pixels as paper background (ignore ink)
          if (brightness >= 220) {
            bgR += r;
            bgG += g;
            bgB += bVal;
            bgCount++;
          }
        }
      }

      // Fallback if paper is darker (e.g. sepia/aged paper)
      if (bgCount === 0) {
        for (let y = pxY; y < pxY + pxH; y++) {
          for (let x = pxX; x < pxX + pxW; x++) {
            const idx = (y * pageWidth + x) * 4;
            const brightness = (fullPixels[idx] + fullPixels[idx + 1] + fullPixels[idx + 2]) / 3;
            if (brightness >= 180) {
              bgR += fullPixels[idx];
              bgG += fullPixels[idx + 1];
              bgB += fullPixels[idx + 2];
              bgCount++;
            }
          }
        }
      }

      const paperColor = bgCount > 0 ? {
        r: Math.round(bgR / bgCount),
        g: Math.round(bgG / bgCount),
        b: Math.round(bgB / bgCount)
      } : { r: 250, g: 250, b: 250 };

      const paperBrightness = (paperColor.r + paperColor.g + paperColor.b) / 3;
      // Only target actual dark handwriting ink (significantly darker than paper background).
      // Never set threshold near paper brightness, which causes opaque white-out blocks!
      const inkThreshold = Math.min(175, Math.max(90, Math.round(paperBrightness - 45)));

      // 2. Line detection map to preserve underlines and vertical grid lines
      // A horizontal line has consecutive dark pixels across > 60% of the box width
      const horizontalLineRows = new Set();
      for (let y = pxY; y < pxY + pxH; y++) {
        let darkSpan = 0;
        let maxSpan = 0;
        for (let x = pxX; x < pxX + pxW; x++) {
          const idx = (y * pageWidth + x) * 4;
          const brightness = (fullPixels[idx] + fullPixels[idx + 1] + fullPixels[idx + 2]) / 3;
          if (brightness < 160) {
            darkSpan++;
            if (darkSpan > maxSpan) maxSpan = darkSpan;
          } else {
            darkSpan = 0;
          }
        }
        // If a continuous dark stroke spans more than 60% of the box, check if it's a true line
        if (maxSpan >= pxW * 0.60) {
          const isAtEdge = y <= pxY + 2 || y >= pxY + pxH - 3;
          let connectsOutside = false;
          if (pxX > 5) {
            const leftIdx = (y * pageWidth + (pxX - 3)) * 4;
            if ((fullPixels[leftIdx] + fullPixels[leftIdx + 1] + fullPixels[leftIdx + 2]) / 3 < 160) connectsOutside = true;
          }
          if (pxX + pxW < pageWidth - 5) {
            const rightIdx = (y * pageWidth + (pxX + pxW + 3)) * 4;
            if ((fullPixels[rightIdx] + fullPixels[rightIdx + 1] + fullPixels[rightIdx + 2]) / 3 < 160) connectsOutside = true;
          }
          if (isAtEdge || connectsOutside || maxSpan >= pxW * 0.85) {
            horizontalLineRows.add(y);
          }
        }
      }

      // Vertical line columns (table grid borders or box sides)
      // Must span nearly full height AND connect to top or bottom borders outside the box (e.g. Session boxed cells)
      const verticalLineCols = new Set();
      const isSession = field.label && field.label.toLowerCase().includes('session');
      for (let x = pxX; x < pxX + pxW; x++) {
        let darkSpan = 0;
        let maxSpan = 0;
        for (let y = pxY; y < pxY + pxH; y++) {
          const idx = (y * pageWidth + x) * 4;
          const brightness = (fullPixels[idx] + fullPixels[idx + 1] + fullPixels[idx + 2]) / 3;
          if (brightness < 160) {
            darkSpan++;
            if (darkSpan > maxSpan) maxSpan = darkSpan;
          } else {
            darkSpan = 0;
          }
        }
        if (maxSpan >= pxH * 0.85) {
          let connectsTop = false;
          let connectsBtm = false;
          if (pxY > 2) {
            const topIdx = ((pxY - 1) * pageWidth + x) * 4;
            if ((fullPixels[topIdx] + fullPixels[topIdx + 1] + fullPixels[topIdx + 2]) / 3 < 160) connectsTop = true;
          }
          if (pxY + pxH < pageHeight - 2) {
            const btmIdx = ((pxY + pxH + 1) * pageWidth + x) * 4;
            if ((fullPixels[btmIdx] + fullPixels[btmIdx + 1] + fullPixels[btmIdx + 2]) / 3 < 160) connectsBtm = true;
          }
          if (isSession || (connectsTop && connectsBtm)) {
            verticalLineCols.add(x);
          }
        }
      }

      // 3. Remove handwriting ink while preserving detected lines and borders
      const isCheckbox = field.type === 'checkbox';
      const marginX = isCheckbox ? 1 : 2;
      const marginY = 0;
      const isNarrative = field.type === 'multiline' || (field.label && field.label.toLowerCase().includes('narrative'));

      for (let y = pxY + marginY; y < pxY + pxH - marginY; y++) {
        if (horizontalLineRows.has(y)) continue; // Keep printed underline!

        let lineStartX = pxX + marginX;
        if (isNarrative && field.bounds && field.bounds.width > 0.5) {
          const isLine1 = (y - pxY) < pxH * 0.35;
          if (isLine1 && field.label) {
            lineStartX = Math.max(lineStartX, pxX + Math.min(pxW * 0.22, 100));
          }
        }

        for (let x = lineStartX; x < pxX + pxW - marginX; x++) {
          if (verticalLineCols.has(x)) continue; // Keep vertical border!

          const idx = (y * pageWidth + x) * 4;
          const r = fullPixels[idx];
          const g = fullPixels[idx + 1];
          const bVal = fullPixels[idx + 2];
          const brightness = (r + g + bVal) / 3;

          // If this pixel is handwriting ink (darker than paper background)
          if (brightness <= inkThreshold) {
            fullPixels[idx] = paperColor.r;
            fullPixels[idx + 1] = paperColor.g;
            fullPixels[idx + 2] = paperColor.b;
            // alpha stays 255
          }
        }
      }
    }

    ctx.putImageData(fullImageData, 0, 0);
    return canvas.toBuffer('image/png');
  }
}

module.exports = ImagePreprocessor;
