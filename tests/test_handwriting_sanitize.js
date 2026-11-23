/**
 * Accident & Incident handwriting mapping: each box keeps the right type of value.
 */
const DynamicExtractor = require('../services/dynamicFormExtractor');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

function main() {
  console.log('=== Handwriting sanitizer + vision A–Z mapping ===');

  const dirty = DynamicExtractor.sanitizeEyExtractedValues({
    refNo: '21/11/2026',
    formDate: '21/11/2026',
    dob: '21/11/2026',
    incidentDate: '19/06/2026',
    personName: '07456 882199',
    contactNumber: 'Ava Thompson',
    postcode: '2026',
    comments: 'Fell in the hall and needed a plaster',
    narrative: 'Fell in the hall and needed a plaster'
  });

  assert(!dirty.refNo, `date must not sit in Ref No: ${dirty.refNo}`);
  assert(dirty.formDate === '21-11-2026', `form date: ${dirty.formDate}`);
  assert(!dirty.dob, `form date must not copy into DOB: ${dirty.dob}`);
  assert(dirty.incidentDate === '19-06-2026', `incident date: ${dirty.incidentDate}`);
  assert(!dirty.personName, `phone must not sit in name: ${dirty.personName}`);
  assert(!dirty.contactNumber, `name must not sit in phone: ${dirty.contactNumber}`);
  assert(!dirty.postcode, `year must not sit in postcode: ${dirty.postcode}`);
  assert(!dirty.comments, `comments must not clone narrative: ${dirty.comments}`);

  const ok = DynamicExtractor.sanitizeEyExtractedValues({
    refNo: 'CH-2304',
    formDate: '22-04-2027',
    dob: '12-01-2021',
    incidentDate: '22-04-2027',
    personName: 'Ava Thompson',
    contactNumber: '07933 661245',
    postcode: 'LS9 7AB'
  });
  assert(ok.refNo === 'CH-2304', `keep ref: ${ok.refNo}`);
  assert(ok.dob === '12-01-2021', `keep real DOB: ${ok.dob}`);
  assert(ok.formDate === ok.incidentDate, 'same calendar day on form + incident is allowed');
  assert(/Ava/.test(ok.personName), `keep name: ${ok.personName}`);
  assert(/07933/.test(ok.contactNumber), `keep phone: ${ok.contactNumber}`);
  assert(ok.postcode === 'LS9 7AB', `keep postcode: ${ok.postcode}`);
  assert(!DynamicExtractor.sanitizeEyExtractedValues({ postcode: 'KAV 74' }).postcode, 'reject OCR crumb postcode');

  const vision = DynamicExtractor.buildEarlyYearsFormFieldsFromVision({
    isAccidentIncidentForm: true,
    values: {
      refNo: 'AR-2025-0147',
      formDate: '23/01/2025',
      projectName: 'SureStart',
      personName: 'Emma Carter',
      dob: '23/01/2025',
      contactNumber: '07845 112233',
      incidentDate: '23/01/2025',
      location: 'Play Room',
      comments: 'Parent informed',
      narrative: 'Fell from climbing frame'
    },
    checks: {
      typeAccident: true,
      typeIncident: false,
      childSurestart: true
    }
  });

  assert(vision.formLayout === 'early_years_accident', vision.formLayout);
  assert(vision.fields.length >= 50, `field count ${vision.fields.length}`);

  const byKey = Object.fromEntries(vision.fields.map(f => [f.fieldKey, f]));
  assert(byKey.refNo.value === 'AR-2025-0147', byKey.refNo.value);
  assert(byKey.formDate.value, 'form date filled');
  assert(!byKey.dob.value, `vision DOB must not equal incident/form date: ${byKey.dob.value}`);
  assert(/Emma\s+Carter/i.test(byKey.personName.value), byKey.personName.value);
  assert(byKey.comments.value === 'Parent informed', byKey.comments.value);
  assert(byKey.typeAccident.value === 'true', 'accident ticked');
  assert(byKey.typeIncident.value === 'false', 'incident not ticked');

  const fromLabels = DynamicExtractor.mapVisionAccidentToEy({
    fields: [
      { label: 'Ref No', value: 'EY-294' },
      { label: 'Form Date', value: '05.12.2026' },
      { label: 'Name of the person involved', value: 'Liam Parker' }
    ]
  });
  assert(fromLabels.values.refNo === 'EY-294', fromLabels.values.refNo);
  assert(fromLabels.values.formDate, fromLabels.values.formDate);
  assert(/Liam/.test(fromLabels.values.personName), fromLabels.values.personName);

  console.log('>>> PASS: handwriting sanitizer + vision mapping');
}

main();
