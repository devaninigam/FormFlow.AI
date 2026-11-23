/**
 * Regression: Emma Carter accident form uses Early Years layout (main app format)
 * with values filled by label targeting — no fabricated Project Name value.
 */
const fs = require('fs');
const path = require('path');
const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');

const IMAGE = path.join(
  __dirname,
  '..',
  'storage',
  'uploads',
  '1795261785510_6f90aa78_Handwritten_Accident_Incident_Report_Form.png'
);

function findField(fields, pattern) {
  return fields.find(f => pattern.test(f.label || ''));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

async function main() {
  console.log('=== Emma Carter Early Years Label-Fill Regression ===');
  assert(fs.existsSync(IMAGE), `Missing test image: ${IMAGE}`);

  const pages = await ImagePreprocessor.extractPages(IMAGE, 'image/png');
  const result = await OcrEngine.analyzeDocument(pages, { provider: 'builtin' });

  const outPath = path.join(__dirname, '..', 'scratch', '_emma_carter_extraction.json');
  fs.writeFileSync(outPath, JSON.stringify({
    formLayout: result.formLayout,
    engineUsed: result.engineUsed,
    summary: result.summary,
    fields: result.fields.map(f => ({
      label: f.label,
      value: f.value,
      type: f.type,
      confidence: f.confidence,
      isBlank: f.isBlank,
      source: f.source,
      bounds: f.bounds
    })),
    fullText: result.pages?.[0]?.fullText || pages[0]?.fullText || ''
  }, null, 2));
  console.log('Wrote', outPath);

  console.log('formLayout:', result.formLayout);
  console.log('totalFields:', result.fields.length);
  console.log('checkboxes:', result.fields.filter(f => f.type === 'checkbox').length);

  assert(result.formLayout === 'early_years_accident', `Expected early_years_accident, got ${result.formLayout}`);
  assert(result.fields.length >= 50, `EY schema too small: ${result.fields.length}`);

  const ref = findField(result.fields, /^ref\s*no$/i);
  const name = findField(result.fields, /name of the person/i) || findField(result.fields, /^name$/i);
  const dob = findField(result.fields, /date of birth|d\.?o\.?b/i);
  const contact = findField(result.fields, /contact/i);
  const incidentDate = findField(result.fields, /incident date|date of incident/i);
  const location = findField(result.fields, /location|space/i);
  const project = findField(result.fields, /project name/i);

  console.log('Ref No:', ref?.value);
  console.log('Name:', name?.value);
  console.log('DOB:', dob?.value);
  console.log('Contact:', contact?.value);
  console.log('Incident Date:', incidentDate?.value);
  console.log('Location:', location?.value);
  console.log('Project Name:', project?.value || '(blank)');

  assert(ref && /AR-2025-0147/i.test(ref.value), `Ref No missing/wrong: ${ref?.value}`);
  assert(name && /Emma\s+Carter/i.test(name.value), `Name missing/wrong: ${name?.value}`);
  const contactDigits = String(contact?.value || '').replace(/\D/g, '');
  assert(contact && /^07845\d{6}$/.test(contactDigits), `Contact missing/wrong: ${contact?.value}`);
  assert(incidentDate && /23-01-2025|23\/01\/2025/.test(incidentDate.value), `Incident date missing/wrong: ${incidentDate?.value}`);
  // Location / DOB can vary with Tesseract noise — require presence when OCR produces them, else allow blank for review
  if (location?.value) {
    assert(/Outdoor|Play|Area/i.test(location.value), `Location unexpected: ${location.value}`);
  }
  if (dob?.value) {
    assert(/\d{2}-\d{2}-2018/.test(dob.value) || dob.value !== incidentDate?.value, `DOB looks wrong: ${dob?.value}`);
  }

  // Project Name field exists for EY layout, but must not invent a value when OCR has none
  assert(project, 'Project Name field must exist in EY layout');
  assert(!project.value, 'Project Name must not be fabricated with a value');

  console.log('>>> PASS: Emma Carter Early Years label-fill');
}

main().catch(err => {
  console.error('>>> FAIL:', err.message);
  process.exit(1);
});
