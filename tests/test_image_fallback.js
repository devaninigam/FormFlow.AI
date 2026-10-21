const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const ImagePreprocessor = require('./services/imagePreprocessor');

async function testFull() {
  const filePath = 'C:/Nigam/Aiv-Projects/Projects/FormFlow AI/storage/uploads/1792583648715_5ecfbf23_Screenshot_4.png';
  const pages = await ImagePreprocessor.extractPages(filePath, 'image/png');
  const buf = pages[0].buffer;
  const W = pages[0].width;
  const H = pages[0].height;

  const worker = await createWorker('eng');
  const ret = await worker.recognize(buf, {}, { blocks: true });
  const allLines = [];
  for (const b of ret.data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        allLines.push(l.text.trim());
      }
    }
  }

  // Row crops for image fallback
  const cropText = async (topNorm, hNorm) => {
    const cropBuf = await sharp(buf)
      .extract({ left: Math.round(0.06 * W), top: Math.round(topNorm * H), width: Math.round(0.88 * W), height: Math.round(hNorm * H) })
      .toBuffer();
    const res = await worker.recognize(cropBuf);
    return res.data.text.trim();
  };

  const rowTexts = await Promise.all([
    cropText(0.180, 0.040), // 0: Ref/Date/Proj
    cropText(0.215, 0.038), // 1: Bldg Address
    cropText(0.255, 0.040), // 2: Name/DOB/Age
    cropText(0.290, 0.040), // 3: RegAddr/Postcode/Adult
    cropText(0.325, 0.035), // 4: Contact
    cropText(0.395, 0.035), // 5: Session
    cropText(0.435, 0.035), // 6: Incident Date/Time/Space
    cropText(0.765, 0.065), // 7: Narrative
    cropText(0.830, 0.045), // 8: Completed By & Position
    cropText(0.860, 0.035), // 9: Date Signed
    cropText(0.895, 0.035), // 10: Parent Sign
    cropText(0.925, 0.035)  // 11: Parent Date/Time
  ]);

  await worker.terminate();

  console.log('Row 0:', rowTexts[0]);
  console.log('Row 1:', rowTexts[1]);
  console.log('Row 2:', rowTexts[2]);
  console.log('Row 3:', rowTexts[3]);
  console.log('Row 4:', rowTexts[4]);
  console.log('Row 5:', rowTexts[5]);
  console.log('Row 6:', rowTexts[6]);
  console.log('Row 7:', rowTexts[7]);
  console.log('Row 8:', rowTexts[8]);
}

testFull().catch(console.error);
