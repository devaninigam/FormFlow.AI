const fs = require('fs');
const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');

async function verifyAll() {
  const tests = [
    {
      name: 'Aiden Murphy (Digital PDF)',
      path: 'C:/Users/nigam/Downloads/Accident_Incident_Report_01_Aiden_Murphy.pdf',
      mime: 'application/pdf',
      expectedPerson: 'AIDEN MURPHY',
      expectedRef: '301B'
    },
    {
      name: 'Priya Nair (Digital PDF)',
      path: 'storage/uploads/1792582415139_6180638c_Accident_Incident_Report_02_Priya_Nair.pdf',
      mime: 'application/pdf',
      expectedPerson: 'PRIYA NAIR',
      expectedRef: 'AB 25'
    },
    {
      name: 'Aiden Murphy (Screenshot Image)',
      path: 'storage/uploads/1792583648715_5ecfbf23_Screenshot_4.png',
      mime: 'image/png',
      expectedPerson: 'AIDEN MURPHY',
      expectedRef: '301B'
    }
  ];

  for (const t of tests) {
    console.log(`\n========================================`);
    console.log(`TESTING: ${t.name}`);
    console.log(`========================================`);
    if (!fs.existsSync(t.path)) {
      console.log(`File missing: ${t.path}`);
      continue;
    }

    const pages = await ImagePreprocessor.extractPages(t.path, t.mime);
    const result = await OcrEngine.analyzeDocument(pages, { provider: 'auto' });

    console.log('Total fields extracted:', result.fields.length);
    const populated = result.fields.filter(f => f.value && f.value !== '' && f.value !== 'false');
    console.log('Populated fields count:', populated.length);

    const ref = result.fields.find(f => /ref no/i.test(f.label))?.value;
    const name = result.fields.find(f => /name of the person/i.test(f.label))?.value;
    const dob = result.fields.find(f => /d\.o\.b/i.test(f.label))?.value;
    const bldg = result.fields.find(f => /building address/i.test(f.label))?.value;
    const regAddr = result.fields.find(f => /registered address/i.test(f.label))?.value;
    const postcode = result.fields.find(f => /postcode/i.test(f.label))?.value;
    const contact = result.fields.find(f => /contact number/i.test(f.label))?.value;
    const narrative = result.fields.find(f => /narrative/i.test(f.label))?.value;
    const completedBy = result.fields.find(f => /completed by/i.test(f.label))?.value;
    const position = result.fields.find(f => /position/i.test(f.label))?.value;

    console.log('  Ref No:           ', ref);
    console.log('  Person Name:      ', name);
    console.log('  DOB:              ', dob);
    console.log('  Building Address: ', bldg);
    console.log('  Reg Address:      ', regAddr);
    console.log('  Postcode:         ', postcode);
    console.log('  Contact:          ', contact);
    console.log('  Completed By:     ', completedBy);
    console.log('  Position:         ', position);
    console.log('  Narrative length: ', narrative?.length);

    const checkedBoxes = result.fields.filter(f => f.type === 'checkbox' && (f.value === 'true' || f.value === true));
    console.log('  Checked boxes:    ', checkedBoxes.map(b => b.label));

    if (name === t.expectedPerson && ref === t.expectedRef) {
      console.log(`>>> PASS: ${t.name}`);
    } else {
      console.log(`>>> FAIL: ${t.name} (Expected ${t.expectedPerson}, got ${name})`);
    }
  }
}

verifyAll().catch(console.error);
