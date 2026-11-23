/**
 * Probe which crop + preprocess actually reads handwriting on 1-hds.png
 */
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

const IMAGE = path.join(__dirname, '..', 'storage', 'uploads', '1795277542785_98727bcf_1-hds.png');

const CELLS = [
  { key: 'ref', x0: 0.12, x1: 0.36, y0: 0.225, y1: 0.258, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' },
  { key: 'formDate', x0: 0.42, x1: 0.62, y0: 0.225, y1: 0.258, wl: '0123456789/-. ' },
  { key: 'project', x0: 0.70, x1: 0.96, y0: 0.225, y1: 0.258, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- ' },
  { key: 'name', x0: 0.28, x1: 0.68, y0: 0.288, y1: 0.318, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\'- ' },
  { key: 'dob', x0: 0.76, x1: 0.96, y0: 0.288, y1: 0.318, wl: '0123456789/-. ' },
  { key: 'addr', x0: 0.22, x1: 0.68, y0: 0.318, y1: 0.355, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,\'- ' },
  { key: 'postcode', x0: 0.78, x1: 0.96, y0: 0.318, y1: 0.348, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' },
  { key: 'phone', x0: 0.22, x1: 0.50, y0: 0.348, y1: 0.378, wl: '0123456789 ' },
  { key: 'adult', x0: 0.68, x1: 0.96, y0: 0.348, y1: 0.378, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\'- ' },
  { key: 'session', x0: 0.16, x1: 0.70, y0: 0.408, y1: 0.440, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ' },
  { key: 'incDate', x0: 0.12, x1: 0.32, y0: 0.448, y1: 0.478, wl: '0123456789/-. ' },
  { key: 'incTime', x0: 0.36, x1: 0.55, y0: 0.448, y1: 0.478, wl: '0123456789:ampmAMP. ' },
  { key: 'space', x0: 0.62, x1: 0.92, y0: 0.448, y1: 0.478, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ' }
];

async function isolateInk(raw, w, h) {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = raw[i * 3];
    const g = raw[i * 3 + 1];
    const b = raw[i * 3 + 2];
    const minRG = Math.min(r, g);
    const luma = 0.3 * r + 0.59 * g + 0.11 * b;
    const blueInk = b > r + 12 && b > g + 8 && luma < 200;
    const dark = luma < 150 || minRG < 120;
    out[i] = (blueInk || dark) ? 0 : 255;
  }
  return sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

async function main() {
  const meta = await sharp(IMAGE).metadata();
  const width = meta.width;
  const height = meta.height;
  console.log('size', width, height);

  const worker = await createWorker('eng', 1, {
    cachePath: path.join(__dirname, '..', 'storage'),
    langPath: path.join(__dirname, '..'),
    gzip: false
  });

  for (const cell of CELLS) {
    const left = Math.round(width * cell.x0);
    const top = Math.round(height * cell.y0);
    const cw = Math.max(8, Math.round(width * (cell.x1 - cell.x0)));
    const ch = Math.max(8, Math.round(height * (cell.y1 - cell.y0)));
    const crop = await sharp(IMAGE).extract({ left, top, width: cw, height: ch }).png().toBuffer();
    const scale = 4;
    const big = await sharp(crop)
      .resize({ width: cw * scale, height: ch * scale, kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();

    const variants = {};
    variants.norm = await sharp(big).grayscale().normalize().linear(1.5, -30).sharpen({ sigma: 1 }).png().toBuffer();
    variants.thr = await sharp(big).grayscale().normalize().threshold(168).png().toBuffer();
    const rawBig = await sharp(big).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    variants.ink = await isolateInk(rawBig.data, rawBig.info.width, rawBig.info.height);

    console.log('\n===', cell.key, 'crop', cw, 'x', ch, '===');
    for (const [name, buf] of Object.entries(variants)) {
      for (const psm of ['7', '8']) {
        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          tessedit_char_whitelist: cell.wl,
          preserve_interword_spaces: '1'
        });
        const ret = await worker.recognize(buf);
        const text = (ret.data.text || '').replace(/\s+/g, ' ').trim();
        const conf = ret.data.confidence;
        if (text) console.log(`  ${name} psm${psm} c=${conf.toFixed(0)}: ${text}`);
      }
    }
  }

  await worker.terminate();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
