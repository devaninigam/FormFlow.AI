const fs = require('fs');
const path = require('path');

const samples = [
  { name: 'Example_1.pdf', path: path.join(__dirname, 'storage/uploads/1792498909270_b451a9a0_Example_1.pdf') },
  { name: 'sample_medical_intake.png', path: path.join(__dirname, 'storage/samples/sample_medical_intake.png') },
  { name: 'sample_equipment_inspection.png', path: path.join(__dirname, 'storage/samples/sample_equipment_inspection.png') },
  { name: 'sample_tax_photocopy.png', path: path.join(__dirname, 'storage/samples/sample_tax_photocopy.png') },
  { name: 'sample_multipage_contract.pdf', path: path.join(__dirname, 'storage/samples/sample_multipage_contract.pdf') }
];

async function runTests() {
  console.log('Starting multi-document upload and extraction verification...\n');

  const results = [];

  for (const s of samples) {
    if (!fs.existsSync(s.path)) {
      console.log('Skipping (not found):', s.name);
      continue;
    }
    console.log('====================================================');
    console.log('TESTING:', s.name);
    console.log('====================================================');

    const fileBuf = fs.readFileSync(s.path);
    const blob = new Blob([fileBuf], { type: s.name.endsWith('.pdf') ? 'application/pdf' : 'image/png' });
    const formData = new FormData();
    formData.append('document', blob, s.name);

    // 1. Upload
    const uploadRes = await fetch('http://localhost:5000/api/document-convert/upload', {
      method: 'POST',
      body: formData
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.document) {
      console.error('Upload failed for', s.name, uploadData);
      continue;
    }
    const docId = uploadData.document.id;
    console.log('1. Uploaded:', docId, 'Pages:', uploadData.document.pageCount);

    // 2. Analyze
    const analyzeRes = await fetch('http://localhost:5000/api/document-convert/analyze/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'builtin' })
    });
    const analyzeData = await analyzeRes.json();
    const doc = analyzeData.document;
    console.log('2. Analyzed successfully!');
    console.log('   - Total Fields Extracted:', doc.fields?.length);
    console.log('   - Tables Extracted:', doc.tables?.length);
    console.log('   - High Confidence Count:', doc.summary?.highConfidenceCount);
    console.log('   - Needs Review Count:', doc.summary?.needsReviewCount);
    console.log('   - Top Extracted Fields:');
    (doc.fields || []).slice(0, 6).forEach(f => {
      console.log(`     * [${f.type}] ${f.label}: "${f.value}" (${Math.round((f.confidence || 0) * 100)}%)`);
    });

    if (doc.tables && doc.tables.length > 0) {
      console.log('   - Table Headers:');
      doc.tables.forEach(t => {
        console.log(`     * ${t.title || 'Table'}: [${(t.headers || []).join(' | ')}] (${t.rows?.length || 0} rows)`);
      });
    }

    // 3. Export Word
    const wordRes = await fetch('http://localhost:5000/api/document-convert/export/word/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: doc.fields, tables: doc.tables })
    });
    const wordBuf = await wordRes.arrayBuffer();
    console.log('3. Word Export:', wordRes.status, 'Size:', wordBuf.byteLength, 'bytes');

    // 4. Export PDF
    const pdfRes = await fetch('http://localhost:5000/api/document-convert/export/pdf/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: doc.fields, tables: doc.tables })
    });
    const pdfBuf = await pdfRes.arrayBuffer();
    console.log('4. PDF Export:', pdfRes.status, 'Size:', pdfBuf.byteLength, 'bytes');

    // 5. Export Excel
    const excelRes = await fetch('http://localhost:5000/api/document-convert/export/excel/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: doc.fields, tables: doc.tables })
    });
    const excelBuf = await excelRes.arrayBuffer();
    console.log('5. Excel Export:', excelRes.status, 'Size:', excelBuf.byteLength, 'bytes');

    // 6. Export JSON
    const jsonRes = await fetch('http://localhost:5000/api/document-convert/export/json/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: doc.fields })
    });
    const jsonData = await jsonRes.json();
    console.log('6. JSON Export:', jsonRes.status, 'Payload OK:', !!jsonData);

    results.push({
      document: s.name,
      pageCount: doc.pageCount,
      fieldsCount: doc.fields?.length,
      tablesCount: doc.tables?.length,
      wordStatus: wordRes.status,
      pdfStatus: pdfRes.status,
      excelStatus: excelRes.status,
      jsonStatus: jsonRes.status
    });
    console.log('');
  }

  console.log('====================================================');
  console.log('SUMMARY OF ALL TESTED DOCUMENTS');
  console.log('====================================================');
  console.table(results);
}

runTests().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
