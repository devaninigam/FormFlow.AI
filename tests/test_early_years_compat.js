/**
 * Completed Early Years Accident upload must classify as early_years_accident,
 * keep classic form fields (Ref No / Date / Project), and fill values by label only.
 */
const fs = require('fs');
const path = require('path');
const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');

const CANDIDATES = [
  path.join(__dirname, '..', 'storage', 'uploads', '1795266503631_613aa37d_Completed_Accident_Incident_Report_Form.png'),
  path.join(__dirname, '..', 'storage', 'uploads', '1795260409619_9c4ebe70_accident_report_1_a_.jpg'),
  path.join(__dirname, '..', 'storage', 'uploads', '1795265315294_ad0734c3_Completed_Accident_and_Incident_Report_Form.png'),
  path.join(__dirname, '..', 'storage', 'uploads', '1795227767512_25b617b9_Completed_Accident_and_Incident_Report_Form.png')
];

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

async function main() {
  console.log('=== Early Years Main-Form Label Fill Regression ===');
  let filePath = CANDIDATES.find(c => fs.existsSync(c));
  assert(filePath, 'No accident form candidate on disk');

  const mime = /\.png$/i.test(filePath) ? 'image/png' : 'image/jpeg';
  console.log('File:', path.basename(filePath));

  const pages = await ImagePreprocessor.extractPages(filePath, mime);
  const result = await OcrEngine.analyzeDocument(pages, { provider: 'builtin' });

  const outPath = path.join(__dirname, '..', 'scratch', '_early_years_extraction.json');
  fs.writeFileSync(outPath, JSON.stringify({
    source: path.basename(filePath),
    formLayout: result.formLayout,
    engineUsed: result.engineUsed,
    summary: result.summary,
    fields: result.fields.map(f => ({
      label: f.label,
      value: f.value,
      type: f.type,
      source: f.source,
      isBlank: f.isBlank
    }))
  }, null, 2));

  console.log('formLayout:', result.formLayout);
  console.log('totalFields:', result.fields.length);
  console.log('checkboxes:', result.fields.filter(f => f.type === 'checkbox').length);

  assert(result.formLayout === 'early_years_accident', `Expected early_years_accident, got ${result.formLayout}`);
  assert(result.fields.length >= 50, `EY field list too small: ${result.fields.length}`);

  const ref = result.fields.find(f => /^ref\s*no$/i.test(f.label || ''));
  const formDate = result.fields.find(f => /^form date$/i.test(f.label || ''));
  const project = result.fields.find(f => /^project name$/i.test(f.label || ''));
  const name = result.fields.find(f => /name of the person/i.test(f.label || ''));

  assert(ref, 'Ref No field missing from EY layout');
  assert(formDate, 'Form Date field missing from EY layout');
  assert(project, 'Project Name field missing from EY layout');
  assert(name, 'Name field missing from EY layout');

  const filled = result.fields.filter(f => f.type !== 'checkbox' && f.value && String(f.value).trim());
  console.log('Filled text fields:', filled.map(f => `${f.label}=${f.value}`).slice(0, 12));
  assert(filled.length >= 2, 'Expected at least some values filled from OCR labels');

  console.log('>>> PASS: Early Years main-form label fill (', path.basename(filePath), ')');
}

main().catch(err => {
  console.error('>>> FAIL:', err.message);
  process.exit(1);
});
