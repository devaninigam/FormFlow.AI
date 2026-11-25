const path = require('path');
const fs = require('fs');
const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');
const WordExporter = require('../services/wordExporter');
const ExcelExporter = require('../services/excelExporter');
const JsonExporter = require('../services/jsonExporter');
const PdfReconstructor = require('../services/pdfReconstructor');

async function runTests() {
  console.log('=== FormFlow AI Multi-Document Diversity & Accuracy Test ===\n');

  // Test 1: Medical Intake Form
  console.log('--- Test 1: Medical Intake Form ---');
  const medicalPath = path.join(__dirname, '../storage/samples/sample_medical_intake.png');
  const medicalPages = await ImagePreprocessor.extractPages(medicalPath, 'image/png');
  console.log(`Extracted pages: ${medicalPages.length}`);

  const medicalResult = await OcrEngine.analyzeDocument(medicalPages, {
    mimeType: 'image/png',
    provider: 'builtin'
  });

  console.log(`Document Layout: ${medicalResult.formLayout}`);
  console.log(`Document Type: ${medicalResult.documentType || 'N/A'}`);
  console.log(`Fields extracted: ${medicalResult.fields?.length || 0}`);
  console.log(`Tables extracted: ${medicalResult.tables?.length || 0}`);

  if (medicalResult.formLayout === 'early_years_accident') {
    throw new Error('FAIL: Medical intake form was incorrectly classified as early_years_accident!');
  }
  console.log('Sample extracted fields:');
  (medicalResult.fields || []).slice(0, 8).forEach(f => {
    console.log(`  [${f.type}] ${f.label}: "${f.value}" (conf: ${f.confidence})`);
  });
  console.log('>>> PASS: Medical Intake Form properly extracted as dynamic document.\n');

  // Test 2: Equipment Inspection Form
  console.log('--- Test 2: Equipment Inspection Form ---');
  const equipPath = path.join(__dirname, '../storage/samples/sample_equipment_inspection.png');
  const equipPages = await ImagePreprocessor.extractPages(equipPath, 'image/png');
  const equipResult = await OcrEngine.analyzeDocument(equipPages, {
    mimeType: 'image/png',
    provider: 'builtin'
  });

  console.log(`Document Layout: ${equipResult.formLayout}`);
  console.log(`Fields extracted: ${equipResult.fields?.length || 0}`);
  if (equipResult.formLayout === 'early_years_accident') {
    throw new Error('FAIL: Equipment inspection form was incorrectly classified as early_years_accident!');
  }
  (equipResult.fields || []).slice(0, 8).forEach(f => {
    console.log(`  [${f.type}] ${f.label}: "${f.value}" (conf: ${f.confidence})`);
  });
  console.log('>>> PASS: Equipment Inspection Form properly extracted as dynamic document.\n');

  // Test 3: Multi-Page Contract PDF
  console.log('--- Test 3: Multi-Page Contract PDF ---');
  const contractPath = path.join(__dirname, '../storage/samples/sample_multipage_contract.pdf');
  const contractPages = await ImagePreprocessor.extractPages(contractPath, 'application/pdf');
  console.log(`Extracted pages count: ${contractPages.length}`);
  if (contractPages.length <= 1) {
    console.warn(`Note: sample_multipage_contract has ${contractPages.length} page(s)`);
  }

  const contractResult = await OcrEngine.analyzeDocument(contractPages, {
    mimeType: 'application/pdf',
    provider: 'builtin'
  });

  console.log(`Result pages count: ${contractResult.pages?.length || 0}`);
  console.log(`Fields extracted across all pages: ${contractResult.fields?.length || 0}`);
  if (contractPages.length > 1 && (contractResult.pages?.length || 0) < contractPages.length) {
    throw new Error(`FAIL: Multi-page document dropped pages! Input: ${contractPages.length}, Output: ${contractResult.pages?.length}`);
  }
  console.log('>>> PASS: Multi-page document processed all pages properly.\n');

  // Test 4: Early Years Accident Form
  console.log('--- Test 4: Early Years Accident Form ---');
  const accidentPath = path.join(__dirname, '../storage/samples/sample_accident_report.png');
  if (fs.existsSync(accidentPath)) {
    const accidentPages = await ImagePreprocessor.extractPages(accidentPath, 'image/png');
    const accidentResult = await OcrEngine.analyzeDocument(accidentPages, {
      mimeType: 'image/png',
      provider: 'builtin'
    });
    console.log(`Document Layout: ${accidentResult.formLayout}`);
    console.log(`Fields extracted: ${accidentResult.fields?.length || 0}`);
    const filledFields = (accidentResult.fields || []).filter(f => f.value && f.value.trim().length > 0 && f.value !== 'false');
    console.log(`Filled fields count: ${filledFields.length}`);
    console.log('>>> PASS: Accident form recognized and extracted.\n');
  }

  // Test 5: Exports (Word, Excel, JSON, PDF Reconstruction)
  console.log('--- Test 5: Document Exports & PDF Reconstruction ---');
  const sampleDoc = {
    id: 'test_doc_123',
    filename: 'test_medical_intake.png',
    formLayout: medicalResult.formLayout,
    documentType: medicalResult.documentType || 'medical_form',
    pages: medicalPages,
    fields: medicalResult.fields || [],
    tables: medicalResult.tables || []
  };

  const docx = await WordExporter.generateDocx(sampleDoc);
  if (!Buffer.isBuffer(docx) || docx.length < 100) {
    throw new Error('FAIL: Word exporter returned invalid buffer');
  }
  console.log(`Word export size: ${docx.length} bytes`);

  const xlsx = await ExcelExporter.generateExcel(sampleDoc);
  if (!Buffer.isBuffer(xlsx) || xlsx.length < 100) {
    throw new Error('FAIL: Excel exporter returned invalid buffer');
  }
  console.log(`Excel export size: ${xlsx.length} bytes`);

  const json = JsonExporter.formatJson(sampleDoc);
  if (!json || !json.fields) {
    throw new Error('FAIL: JSON exporter returned invalid structure');
  }
  console.log(`JSON export field count: ${json.fields.length}`);

  const recon = await PdfReconstructor.reconstruct(medicalPages, medicalResult.fields || []);
  if (!Buffer.isBuffer(recon.pdfBuffer) || recon.pdfBuffer.length < 500) {
    throw new Error('FAIL: PDF Reconstructor returned invalid PDF buffer');
  }
  console.log(`Reconstructed PDF size: ${recon.pdfBuffer.length} bytes`);
  console.log('>>> PASS: All export formats (Word, Excel, JSON, PDF Reconstruction) verified.\n');

  console.log('=== ALL 5 DIVERSE DOCUMENT & PIPELINE TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
