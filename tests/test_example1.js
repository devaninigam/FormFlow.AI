const fs = require('fs');
const path = require('path');
const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');

async function test() {
  const filePath = path.join(__dirname, '../storage/uploads/1795430875740_64bfba55_Example_1.pdf');
  const mime = 'application/pdf';
  const pages = await ImagePreprocessor.extractPages(filePath, mime);
  console.log(`Extracted ${pages.length} pages. Page 1 textItems count: ${pages[0].textItems ? pages[0].textItems.length : 0}`);

  const result = await OcrEngine.analyzeDocument(pages, { provider: 'builtin' });
  console.log('\n--- Extraction Summary ---');
  console.log('formLayout:', result.formLayout);
  console.log('engineUsed:', result.engineUsed);

  console.log('\n--- Text Fields ---');
  for (const f of result.fields) {
    if (f.type !== 'checkbox') {
      console.log(`[${f.fieldKey || f.id}] "${f.label}": "${f.value}" (blank=${f.isBlank}, conf=${f.confidence}, src=${f.source})`);
    }
  }

  console.log('\n--- Checkboxes ---');
  const chks = result.fields.filter(f => f.type === 'checkbox');
  for (const c of chks) {
    if (c.value === 'true' || c.value === true) {
      console.log(`  [X] "${c.label}" (${c.fieldKey}) - conf=${c.confidence}, src=${c.source}`);
    }
  }
}

test().catch(console.error);
