/**
 * Handwritten EY form (Ava Thompson / CH-2304) must keep real text values,
 * not first-pass OCR junk like "Ava Sips Oi" / "Hz".
 */
const fs = require('fs');
const path = require('path');
const DynamicExtractor = require('../services/dynamicFormExtractor');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

function linesFromText(text) {
  const rows = String(text).split('\n');
  return rows.map((t) => {
    let y = 200;
    if (/ABOUT THIS FORM|Ref No/i.test(t)) y = 520;
    else if (/Name of the person/i.test(t)) y = 720;
    else if (/Registered Address|Postcode/i.test(t)) y = 780;
    else if (/Contact Number|Responsible Adult|Daniel/i.test(t)) y = 840;
    else if (/CHILD|SureStart/i.test(t)) y = 980;
    else if (/SESSION/i.test(t)) y = 1040;
    else if (/ABOUT THE INCIDENT/i.test(t)) y = 1100;
    else if (/DATE .*TIME|SPACE/i.test(t)) y = 1140;
    else if (/TYPE ACCIDENT|INCIDENT/i.test(t)) y = 1180;
    return {
      text: t,
      bbox: { x0: 40, y0: y, x1: 1700, y1: y + 22 },
      confidence: 80
    };
  });
}

function main() {
  assert(DynamicExtractor.parseName('Ava 7 SIPS OI 72/07/2027') === 'Ava', `name junk: ${DynamicExtractor.parseName('Ava 7 SIPS OI 72/07/2027')}`);
  assert(DynamicExtractor.parseName('Dancel 7 CPS OI') === 'Daniel', `adult junk: ${DynamicExtractor.parseName('Dancel 7 CPS OI')}`);
  assert(DynamicExtractor.parseName('Daniel Thompson') === 'Daniel Thompson', 'keep good name');
  assert(DynamicExtractor.parseName('Ava Ava Thompson') === 'Ava Thompson', `dedupe: ${DynamicExtractor.parseName('Ava Ava Thompson')}`);
  assert(DynamicExtractor.parseName('Ava Thompson Bo') === 'Ava Thompson', `trail: ${DynamicExtractor.parseName('Ava Thompson Bo')}`);
  assert(DynamicExtractor.parseRefNo('CH-2304A') === 'CH-2304', `ref A: ${DynamicExtractor.parseRefNo('CH-2304A')}`);
  assert(DynamicExtractor.parseName('Yl Bn Bn') === '', 'reject crumb name');
  assert(DynamicExtractor.parseRefNo('Hz') === '', `Hz must not be a ref: ${DynamicExtractor.parseRefNo('Hz')}`);
  assert(DynamicExtractor.parseRefNo('CH-2304') === 'CH-2304', `CH-2304: ${DynamicExtractor.parseRefNo('CH-2304')}`);
  assert(DynamicExtractor.parseRefNo('CH-2304 DATE') === 'CH-2304', `ref+date: ${DynamicExtractor.parseRefNo('CH-2304 DATE')}`);
  assert(DynamicExtractor.parseUkPostcode('LS9 FAB') === 'LS9 7AB', `postcode: ${DynamicExtractor.parseUkPostcode('LS9 FAB')}`);
  assert(/Maple Crescent/i.test(DynamicExtractor.parseAddress('3 Maple Crescent, LS9 FAB')), `addr: ${DynamicExtractor.parseAddress('3 Maple Crescent, LS9 FAB')}`);
  assert(DynamicExtractor.parseDate('22 / O04 /. 2027') === '22-04-2027', `form date: ${DynamicExtractor.parseDate('22 / O04 /. 2027')}`);

  const fullText = [
    'Accident & Incident Report Form (Page 1 of 2)',
    'ABOUT THIS FORM & IT’S COMPLETION',
    'Ref No CH-2304 DATE 22 / O04 /. 2027',
    'ABOUT THE PERSON',
    'Name of the person involved Ava 7 SIPS OI 12/01/2021',
    'Name of the person involved Ava Thompson',
    'Registered Address 3 Maple Crescent, Leeds Postcode LS9 FAB',
    'Contact Number 07933 667245 Responsible Adult: Dancel 7 CPS OI',
    'Contact Number 07933 661245 Daniel Thompson',
    'CHILD Daycare [] ToyBox [] SureStart /',
    'SESSION A School Session',
    'SESSION After School Session',
    'ABOUT THE INCIDENT',
    'DATE 22/04/2027 TIME 4:10 pm SPACE Main Hall',
    'TYPE ACCIDENT [] INCIDENT wv. NEARMISS []'
  ].join('\n');

  const lines = linesFromText(fullText);
  const { values, checks } = DynamicExtractor.extractEarlyYearsByAliases(lines, {
    width: 1800,
    height: 2400,
    fullText
  });

  console.log(values);
  console.log({ typeAccident: checks.typeAccident, typeIncident: checks.typeIncident, childSurestart: checks.childSurestart });

  assert(/CH-2304/i.test(values.refNo), `ref: ${values.refNo}`);
  assert(/Ava\s+Thompson/i.test(values.personName), `person: ${values.personName}`);
  assert(/Daniel\s+Thompson/i.test(values.responsibleAdult), `adult: ${values.responsibleAdult}`);
  assert(/After School Session/i.test(values.session), `session: ${values.session}`);
  assert(/Maple Crescent/i.test(values.regAddress), `address: ${values.regAddress}`);
  assert(/LS9\s*7AB/i.test(values.postcode), `postcode: ${values.postcode}`);
  assert(/661245/.test(String(values.contactNumber).replace(/\s/g, '')), `contact: ${values.contactNumber}`);
  assert(checks.typeIncident === 'true', `incident should be ticked, got ${checks.typeIncident}`);
  assert(checks.typeAccident !== 'true', `accident should be empty, got ${checks.typeAccident}`);
  assert(checks.childSurestart === 'true', `surestart should be ticked, got ${checks.childSurestart}`);

  console.log('>>> PASS: Ava Thompson text recovery');
}

main();
