/**
 * Good vs normal handwriting Accident & Incident scans:
 * layout must be the official form; filled values must pass type checks.
 */
const fs = require('fs');
const path = require('path');
const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');
const DynamicExtractor = require('../services/dynamicFormExtractor');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

const SAMPLES = [
  {
    kind: 'good',
    file: path.join(__dirname, '..', 'storage', 'uploads', '1795430875740_64bfba55_Example_1.pdf'),
    mime: 'application/pdf'
  },
  {
    kind: 'good',
    file: path.join(__dirname, '..', 'storage', 'uploads', '1795266503631_613aa37d_Completed_Accident_Incident_Report_Form.png'),
    mime: 'image/png'
  },
  {
    kind: 'normal',
    file: path.join(__dirname, '..', 'storage', 'uploads', '1795261785510_6f90aa78_Handwritten_Accident_Incident_Report_Form.png'),
    mime: 'image/png'
  },
  {
    kind: 'normal',
    file: path.join(__dirname, '..', 'storage', 'uploads', '1795266100467_45caf33c_Messy_Handwritten_Accident_Report_Form.png'),
    mime: 'image/png'
  }
];

function assertTypedFields(result, label) {
  assert(result.formLayout === 'early_years_accident', `${label} layout ${result.formLayout}`);
  assert(result.fields.length >= 50, `${label} fields ${result.fields.length}`);

  const byKey = Object.fromEntries(result.fields.filter(f => f.fieldKey).map(f => [f.fieldKey, f]));
  const val = (k) => String(byKey[k]?.value || '').trim();

  assert(byKey.refNo && byKey.formDate && byKey.projectName && byKey.comments, `${label} missing A–Z keys`);

  if (val('refNo')) {
    assert(DynamicExtractor.parseRefNo(val('refNo')), `${label} Ref No not an ID: ${val('refNo')}`);
    assert(!DynamicExtractor.parseDate(val('refNo')) || /[A-Za-z]/.test(val('refNo')), `${label} date in Ref No: ${val('refNo')}`);
  }
  if (val('formDate')) assert(DynamicExtractor.parseDate(val('formDate')), `${label} Form Date: ${val('formDate')}`);
  if (val('dob')) {
    assert(DynamicExtractor.parseDate(val('dob')), `${label} DOB: ${val('dob')}`);
    if (val('formDate')) assert(val('dob') !== val('formDate'), `${label} DOB copied form date`);
    if (val('incidentDate')) assert(val('dob') !== val('incidentDate'), `${label} DOB copied incident date`);
  }
  if (val('incidentDate')) assert(DynamicExtractor.parseDate(val('incidentDate')), `${label} incident date: ${val('incidentDate')}`);
  if (val('contactNumber')) assert(DynamicExtractor.parsePhoneNumber(val('contactNumber')), `${label} phone: ${val('contactNumber')}`);
  if (val('personName')) {
    assert(/[A-Za-z]{2,}/.test(val('personName')), `${label} name: ${val('personName')}`);
    assert(!DynamicExtractor.parseDate(val('personName')) || /[A-Za-z]{3,}/.test(val('personName')), `${label} date in name`);
  }
  if (val('comments') && val('narrative')) {
    assert(val('comments') !== val('narrative'), `${label} comments cloned narrative`);
  }

  const filled = result.fields.filter(f => f.type !== 'checkbox' && val(f.fieldKey)).length;
  return filled;
}

async function runOne(sample) {
  if (!fs.existsSync(sample.file)) {
    console.log('SKIP missing', path.basename(sample.file));
    return null;
  }
  const pages = await ImagePreprocessor.extractPages(sample.file, sample.mime);
  const result = await OcrEngine.analyzeDocument(pages, { provider: 'builtin' });
  const filled = assertTypedFields(result, `${sample.kind}:${path.basename(sample.file)}`);
  const textFields = result.fields.filter(f => f.type !== 'checkbox' && String(f.value || '').trim());
  console.log(`OK ${sample.kind} ${path.basename(sample.file)} filledText=${filled} layout=${result.formLayout}`);
  console.log('  ', textFields.slice(0, 8).map(f => `${f.fieldKey}=${f.value}`).join(' | '));
  return { kind: sample.kind, filled, file: path.basename(sample.file) };
}

async function main() {
  console.log('=== Handwriting samples (good + normal) ===');
  const ran = [];
  for (const sample of SAMPLES) {
    const row = await runOne(sample);
    if (row) ran.push(row);
  }
  assert(ran.length >= 2, 'Need at least two sample files on disk');
  const good = ran.filter(r => r.kind === 'good');
  const normal = ran.filter(r => r.kind === 'normal');
  assert(good.length >= 1, 'Need a good-handwriting sample');
  assert(normal.length >= 1, 'Need a normal-handwriting sample');
  console.log('>>> PASS: handwriting samples', ran.map(r => `${r.kind}:${r.filled}`).join(', '));
}

main().catch(err => {
  console.error('>>> FAIL:', err.message);
  process.exit(1);
});
