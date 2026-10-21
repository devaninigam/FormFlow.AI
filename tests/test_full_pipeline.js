const fs = require('fs');

async function testFullPipeline() {
  const tests = [
    { name: 'Equipment Inspection (Image)', file: './storage/samples/sample_equipment_inspection.png', mime: 'image/png' },
    { name: 'Medical Intake (Image)', file: './storage/samples/sample_medical_intake.png', mime: 'image/png' },
    { name: 'Tax Photocopy (Image)', file: './storage/samples/sample_tax_photocopy.png', mime: 'image/png' },
    { name: 'Multipage Contract (PDF)', file: './storage/samples/sample_multipage_contract.pdf', mime: 'application/pdf' },
    { name: 'Example 2 (User PDF)', file: './storage/uploads/1792499485048_37015bab_Example_2.pdf', mime: 'application/pdf' }
  ];

  for (const t of tests) {
    console.log('\n======================================================');
    console.log('TESTING FULL PIPELINE:', t.name);
    console.log('======================================================');

    const fileBuf = fs.readFileSync(t.file);
    const blob = new Blob([fileBuf], { type: t.mime });
    const form = new FormData();
    form.append('document', blob, t.file.split('/').pop());

    // 1. Upload
    const upRes = await fetch('http://localhost:5000/api/document-convert/upload', {
      method: 'POST',
      body: form
    });
    if (!upRes.ok) throw new Error('Upload failed: ' + (await upRes.text()));
    const upData = await upRes.json();
    const docId = upData.document.id;
    console.log('✓ Uploaded successfully. Doc ID:', docId);

    // 2. Analyze
    const anRes = await fetch('http://localhost:5000/api/document-convert/analyze/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'builtin' })
    });
    if (!anRes.ok) throw new Error('Analyze failed: ' + (await anRes.text()));
    const anData = await anRes.json();
    const fields = anData.document.fields || [];
    const tables = anData.document.tables || [];
    console.log(`✓ Analyzed: ${fields.length} fields, ${tables.length} tables`);
    console.log('  Top 3 fields:', fields.slice(0, 3).map(f => f.label + ' => ' + f.value));

    // 3. PDF Preview
    const prevRes = await fetch('http://localhost:5000/api/document-convert/preview/pdf/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!prevRes.ok) throw new Error('PDF Preview failed: ' + (await prevRes.text()));
    const prevData = await prevRes.json();
    console.log(`✓ PDF Preview generated: ${prevData.previewImages?.length} page previews`);

    // 4. Word Export
    const wordRes = await fetch('http://localhost:5000/api/document-convert/export/word/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, tables })
    });
    if (!wordRes.ok) throw new Error('Word export failed: ' + (await wordRes.text()));
    const wordBuf = await wordRes.arrayBuffer();
    console.log(`✓ Word Export generated: ${wordBuf.byteLength} bytes`);

    // 5. Excel Export
    const xlRes = await fetch('http://localhost:5000/api/document-convert/export/excel/' + docId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, tables })
    });
    if (!xlRes.ok) throw new Error('Excel export failed: ' + (await xlRes.text()));
    const xlBuf = await xlRes.arrayBuffer();
    console.log(`✓ Excel Export generated: ${xlBuf.byteLength} bytes`);
  }

  console.log('\n======================================================');
  console.log('ALL 5 DOCUMENT PIPELINE TESTS PASSED 100%!');
  console.log('======================================================');
}

testFullPipeline().catch(console.error);
