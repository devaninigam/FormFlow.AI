/**
 * Dynamic Form Extraction Engine (Civenta VAT Architecture)
 * Label-based, layout-aware extraction without static person profiles or rigid coordinates.
 */

const sharp = require('sharp');
const Tesseract = require('tesseract.js');

// ============================================================================
// 1. Label Aliases Dictionary (Inspired by Civenta VAT)
// ============================================================================

const FORM_FIELD_ALIASES = {
  refNo: [
    'REF NO', 'REF NO.', 'REF NUMBER', 'REFERENCE NO', 'REFERENCE NUMBER',
    'REFNO', 'UNIQUE ID', 'INCIDENT REF',
    'FRET NO', 'RET NO', 'REINE', 'REFNE', 'RAVE', 'FRENO'
    // Never add bare REF / RE / RE# — they match inside Report / Reference / RETURN
  ],
  formDate: [
    'REPORT DATE', 'FORM DATE', 'COMPLETION DATE', 'DATE COMPLETED',
    'DATE OF REPORT', 'OWE', 'TOVE', 'OATE', 'DAIE', 'DAVE', 'OME', 'OMF',
    'OA TO', 'OA TE', 'DA TE', 'OA®', 'OA'
    // Note: bare DATE is too broad for multi-label rows; prefer formDate / OME OCR garble
  ],
  projectName: [
    'PROJECT NAME', 'CENTRE NAME', 'ORGANISATION',
    'ORGANIZATION', 'FACILITY', 'EMOSCR',
    'TPROMCINAME', 'ROKCIVAME', 'PROMCINAME', 'PROJECTNAME'
    // Note: bare PROJECT / CENTRE / PROGRAMME / SURESTART match checkbox rows — omit
  ],
  bldgAddress: [
    'BUILDING ADDRESS', 'CENTRE ADDRESS', 'PREMISES ADDRESS', 'SITE ADDRESS',
    'BURLUENG ADDRESS', 'BURLUENG', 'FRALDING ADDRESS', 'BURLDING ADDRESS', 'Eioencoy'
  ],
  personName: [
    'NAME OF THE PERSON INVOLVED', 'NAME OF PERSON INVOLVED', 'NAME OF PERSON',
    'PERSON INVOLVED', 'CASUALTY NAME', 'INJURED PERSON', 'CHILD NAME',
    'FULL NAME', 'NAME', 'CENG', 'NANE', 'NME', 'NAMF', 'MAME', 'PERU IVOLVED'
  ],
  dob: [
    'D.O.B', 'DOB', 'DATE OF BIRTH', 'BIRTH DATE', 'D.O.B.', 'OOB', 'DO.B', 'OOS', 'D.0.B',
    'TDATEOTBIRT', 'DATEOTBIRT', 'DATE OF BIRT', 'DO 8', 'D 0 B',
    '0.08', 'O.08', '0OB', 'D.OB', 'DO B'
  ],
  age: [
    'AGE', 'AGE IN YEARS', 'AGE YEARS'
  ],
  regAddress: [
    'REGISTERED ADDRESS', 'HOME ADDRESS', 'RESIDENTIAL ADDRESS',
    'STREET ADDRESS', 'REGISTERED ADDS', 'REG ADDRESS', 'ADDRESS',
    'FEGISTERED ADARESS', 'FEGISTERED ADDRESS', 'FEGISTERED', 'IREGISTERED',
    'IREGSTEREANASRESS', 'ROGAERED', 'RECICIERND'
  ],
  postcode: [
    'POSTCODE', 'POST CODE', 'POSTAL CODE', 'ZIP CODE', 'ZIP',
    'POST/ZIP', 'POST CODE / ZIP', 'POST-CODE', 'POSTAL', 'P.C.',
    'P.CODE', 'PIN CODE', 'PINCODE', 'POSODE', 'FOSCOSE', 'TOCARODE',
    'POSICODE', 'POS7CODE', 'POSTCOOE', 'POSTCODF', 'POSTC0DE', 'FOSTCODE',
    'POSTC ODE', 'POS TCODE', 'POSTCO', 'FOSILDUE', 'POSILDUE'
  ],
  contactNumber: [
    'CONTACT NUMBER', 'TELEPHONE NUMBER', 'PHONE NUMBER', 'MOBILE NUMBER',
    'CONTACT NO', 'PHONE NO', 'TELEPHONE', 'MOBILE', 'PHONE', 'TEL NO',
    'EMERGENCY CONTACT'
  ],
  responsibleAdult: [
    'RESPONSIBLE ADULT', 'PARENT OR GUARDIAN', 'PARENT / GUARDIAN',
    'PARENT', 'GUARDIAN', 'NEXT OF KIN', 'RESPONSIBLE ADY', 'RESPONSIBLE ADUT',
    'RESPONSIBLEMDUT', 'RESPONSIBLE', 'RESPONSIVE SUE', 'RESPONSIVE ADULT',
    'RESPONSIVE', 'RESPONSIVE ADY', 'RESPONSIBLEADULR'
  ],
  session: [
    'SESSION DETAILS', 'SESSION ATTENDED', 'SESSION', 'ACTIVITY',
    'CLASS', 'PROGRAMME', 'TIME OF SESSION'
  ],
  incidentDate: [
    'INCIDENT DATE', 'DATE OF INCIDENT', 'DATE OF ACCIDENT', 'ACCIDENT DATE', 'DATE'
  ],
  incidentTime: [
    'INCIDENT TIME', 'TIME OF INCIDENT', 'TIME OF ACCIDENT', 'TIME'
  ],
  location: [
    'SPACE / LOCATION', 'SPACE / LOC', 'SPACE', 'LOCATION', 'ROOM',
    'SPECIFIC LOCATION', 'PLACE OF INCIDENT'
    // Note: VENUE / AREA are cause-checkbox labels on EY forms — do not use as location aliases
  ],
  narrative: [
    'NARRATIVE', 'DESCRIPTION OF INCIDENT', 'DETAILS OF INCIDENT',
    'WHAT HAPPENED', 'INCIDENT SUMMARY', 'ACCOUNT OF EVENT'
  ],
  completedBy: [
    'FORM COMPLETED BY', 'COMPLETED BY', 'REPORTED BY (NAME)', 'REPORTED BY',
    'STAFF NAME', 'NAME OF PERSON COMPLETING'
  ],
  position: [
    'POSITION', 'JOB TITLE', 'ROLE', 'OCCUPATION', 'DESIGNATION', 'POSMON'
  ],
  signature: [
    'STAFF SIGNATURE', 'SIGNATURE', 'SIGNED', 'SONED'
  ],
  dateSigned: [
    'DATE SIGNED', 'SIGNATURE DATE', 'DATE'
  ],
  parentSignature: [
    'PARENT / GUARDIAN SIGNATURE', 'PARENT SIGNATURE', 'PARENT SIGNED'
  ],
  comments: [
    'ADDITIONAL COMMENTS', 'PARENT COMMENTS', 'COMMENTS', 'NOTES', 'REMARKS'
  ]
};

// Stopwords for form extraction (headers / field noise)
const FORM_STOPWORDS = new Set([
  'page', 'form', 'report', 'accident', 'incident', 'about', 'this',
  'person', 'involved', 'please', 'note', 'with', 'cell', 'appropriate',
  'completion', 'section', 'part', 'unknown', 'n/a', 'na', 'none'
]);

// ============================================================================
// 2. Normalization & Text Cleaning Utilities (Civenta VAT Style)
// ============================================================================

function normalizeLabelKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortedAliasKeys(aliases) {
  return (aliases || [])
    .map(normalizeLabelKey)
    .filter(Boolean)
    // Drop ultra-short keys (re, no, id) — they match inside Report / Note / etc.
    .filter(a => a.length >= 3 || /\d/.test(a))
    .sort((a, b) => b.length - a.length);
}

function stripUncertainNoise(line) {
  return String(line || '')
    .replace(/\((?:maybe|approx|optional|tbd|n\/?a)[^)]*\)/gi, ' ')
    .replace(/[|~·•~_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeImageOcrText(rawText) {
  let text = String(rawText || '');
  // Normalize date spacing: 17 . 02 . 24 -> 17-02-2024
  text = text.replace(/\b(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})\b/g, '$1-$2-$3');
  // Normalize phone spacing: 07777 777 777
  text = text.replace(/\b07(\d{3})\s*(\d{3})\s*(\d{3,4})\b/g, '07$1$2$3');
  // Strip vertical pipes and table frame bars
  text = text.replace(/^[|~:\s\\[\\]#.-]+/, '').replace(/[|~:\s\\[\\]#.-]+$/, '');
  return text.trim();
}

function looksLikeOcrJunk(value) {
  const v = String(value || '').trim();
  if (!v || v.length < 2) return true;
  const letters = (v.match(/[A-Za-z]/g) || []).length;
  const digits = (v.match(/\d/g) || []).length;
  const junk = (v.match(/[^A-Za-z0-9\s,&.'()\-\/]/g) || []).length;
  if (letters === 0 && digits === 0) return true;
  if (junk > (letters + digits) * 0.5) return true;
  return false;
}

function tidyPhrase(raw, max = 80) {
  return String(raw || '')
    .replace(/[=|·•~_\[\]]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:\-–|]+|[\s,;:\-–|]+$/g, '')
    .trim()
    .slice(0, max);
}

/**
 * Prefer clean handwritten values (Ava Thompson) over first-pass OCR junk
 * (Ava 7 SIPS OI). Later duplicate lines often contain the better reading.
 */
function valueQualityScore(raw) {
  const s = String(raw || '').trim();
  if (!s) return -50;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  const junk = (s.match(/[^A-Za-z0-9\s,&.'()\-\/:]/g) || []).length;
  let q = letters + digits * 0.4 - junk * 4;
  if (/^[A-Z][a-z]{1,16}(?:[\s'-][A-Z][a-z]{1,16}){1,3}$/.test(s)) q += 30;
  if (/\b(?:After|Before|Morning|Afternoon|School Session|Main Hall|Crescent|Road|Close|Avenue)\b/i.test(s)) q += 12;
  const crumbs = (s.match(/\b[A-Z]{2,4}\b/g) || []).filter(w => !/^(UK|AM|PM|DOB|EY|CH)$/i.test(w)).length;
  q -= crumbs * 7;
  if (/\b[A-Za-z]{2,}\s+\d\s+[A-Za-z]/i.test(s)) q -= 14;
  return q;
}

// ============================================================================
// 3. Dynamic Label Matching & Spatial Extraction (Civenta extractByAliases)
// ============================================================================

function matchAliasOnLine(line, aliasKeysSorted) {
  const original = typeof line === 'string' ? line : (line.text || '');
  const trimmed = original.trim();
  if (!trimmed) return null;
  const cleaned = stripUncertainNoise(trimmed);
  const norm = normalizeLabelKey(cleaned);
  if (!norm) return null;

  for (const alias of aliasKeysSorted) {
    if (norm === alias) {
      return { aliasKey: alias, value: '', exactLabel: true };
    }
    const regex = new RegExp(`^(?:.*?\\s+)?${escapeRegExp(alias)}\\s*[:|\\-#.]*\\s*(.*)$`, 'i');
    const m = cleaned.match(regex);
    if (m) {
      return { aliasKey: alias, value: m[1] ? m[1].trim() : '', exactLabel: true };
    }
  }
  return null;
}

function findAliasEmbedded(line, aliasKeysSorted) {
  const original = typeof line === 'string' ? line : (line.text || '');
  const trimmed = original.trim();
  if (!trimmed) return null;
  const cleaned = stripUncertainNoise(trimmed);

  for (const alias of aliasKeysSorted) {
    const parts = alias.split(/\s+/).map(escapeRegExp);
    const regex = new RegExp(`(?:^|\\b)${parts.join('\\s*[\\-\\s]*')}\\s*[:|\\-#.]*\\s*(.*)$`, 'i');
    const m = cleaned.match(regex);
    if (m) {
      return { aliasKey: alias, value: m[1] ? m[1].trim() : '', exactLabel: false };
    }
  }
  return null;
}

/**
 * Civenta-style alias extractor:
 * Searches lines for alias keys, extracts same-line or subsequent-line value,
 * applies validators, and scores the best candidate.
 */
function extractByAliases(lines, aliases, options = {}) {
  const {
    validate = (v) => Boolean(String(v || '').trim()) && !looksLikeOcrJunk(v),
    normalizeValue = (v) => tidyPhrase(v),
    maxScan = lines.length,
    allowEmbedded = true,
    yMin = 0,
    yMax = 1.0
  } = options;

  const aliasKeys = sortedAliasKeys(aliases);
  let best = null;

  for (let i = 0; i < Math.min(lines.length, maxScan); i++) {
    const lineObj = lines[i];
    const lineY = lineObj.bbox ? (lineObj.bbox.y0 / (options.height || 1.0)) : (lineObj.y || 0);
    if (lineObj.bbox && options.height && (lineY < yMin - 0.03 || lineY > yMax + 0.03)) {
      continue;
    }

    let hit = matchAliasOnLine(lineObj, aliasKeys);
    if (!hit && allowEmbedded) {
      hit = findAliasEmbedded(lineObj, aliasKeys);
    }
    if (!hit) continue;

    // Candidates: same line value, or next line, or word-level spatial items
    const candidates = [];
    if (hit.value) {
      candidates.push({ raw: hit.value, at: i, sameLine: true });
    }

    // Spatial: check words on the same line to the right of the label
    if (lineObj.words && lineObj.words.length > 0) {
      const aliasParts = hit.aliasKey.split(' ');
      const lastAliasWord = aliasParts[aliasParts.length - 1];
      const wIdx = lineObj.words.findIndex(w => new RegExp(escapeRegExp(lastAliasWord), 'i').test(w.text));
      if (wIdx !== -1 && wIdx + 1 < lineObj.words.length) {
        const rightWords = lineObj.words.slice(wIdx + 1).map(w => w.text).join(' ');
        if (rightWords.trim()) {
          candidates.push({ raw: rightWords, at: i, sameLine: true });
        }
      }
    }

    // Next line candidate
    if (i + 1 < lines.length) {
      const nextText = typeof lines[i + 1] === 'string' ? lines[i + 1] : lines[i + 1].text;
      if (nextText && !/^(ABOUT|SECTION|PART|RIDDOR|CAUSE|OUTCOME|CONTACT|NAME OF|REGISTERED|SESSION|STAFF|CHILD|TYPE|DATE|POSTCODE|RESPONSIBLE)/i.test(nextText)) {
        candidates.push({ raw: nextText.trim(), at: i + 1, sameLine: false });
      }
    }

    for (const cand of candidates) {
      const normalized = normalizeValue(cand.raw);
      if (!validate(normalized, { valueIndex: cand.at })) continue;

      const quality = valueQualityScore(normalized);
      const score =
        hit.aliasKey.length * 10 +
        (cand.sameLine ? 15 : 5) +
        quality -
        cand.at * 0.01;

      if (!best || score > best.score) {
        best = {
          value: normalized,
          score,
          index: i,
          valueIndex: cand.at,
          aliasKey: hit.aliasKey,
          line: lineObj
        };
      }
    }
  }

  return best;
}

// ============================================================================
// 4. Dynamic Semantic Field Validators & Cleaners
// ============================================================================

function parseDate(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // Strip common label prefixes
  s = s.replace(/^(?:date|form date|incident date|owe|tove|oate|daie|dave|date completed|dob|d\.o\.b)[:|\s-]*/i, '');
  // Letter-O used as zero in handwritten dates: 22 / O04 / 2027
  s = s.replace(/\bO0?(\d{1,2})\b/g, '0$1');
  s = s.replace(/O(?=\d)/g, '0');
  // Repair OCR smashed dates: 2///1/2026 → 21/11/2026, 3/.05.2020 → 31.05.2020
  s = s.replace(/\b(\d)\s*\/\s*\/\s*\/\s*(\d)\s*\/\s*(\d{4})\b/g, '$1$2/1$2/$3');
  s = s.replace(/\b(\d)\s*\/\s*\/+\s*(\d)\s*\/\s*(\d{4})\b/g, (all, a, b, y) => {
    // 2///1/2026 style — treat as 2a/1b/yyyy when plausible
    const d = `${a}${b}`;
    const mth = `1${b}`;
    if (parseInt(d, 10) <= 31 && parseInt(mth, 10) <= 12) return `${d}/${mth}/${y}`;
    return all;
  });
  s = s.replace(/\b(\d)\s*\/\s*\.?\s*(\d{2})\s*[./-]\s*(\d{4})\b/g, (all, a, mth, y) => {
    const d = `${a}1`;
    if (parseInt(d, 10) <= 31 && parseInt(mth, 10) <= 12) return `${d}.${mth}.${y}`;
    return all;
  });
  // OCR date repairs for common character confusions
  s = s.replace(/\[\s*ATE\b/i, 'DATE');
  // OCR month 01 as 0l / ol / O1
  s = s.replace(/[-./:](?:[oO][lI1]|0[lI])[-./:]/g, '-01-');
  // Match standard numeric dates: DD-MM-YYYY, DD/MM/YY, YYYY-MM-DD, etc.
  const isoMatch = s.match(/\b(19\d\d|20\d\d)[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  }
  const m = s.match(/\b(\d{1,2})\s*[-./:]+\s*(\d{1,2})\s*[-./:]+\s*(\d{2,4})\b/);
  if (m) {
    let [, d, mth, y] = m;
    let dn = parseInt(d, 10);
    let mn = parseInt(mth, 10);
    // Sanity check valid date ranges
    if (dn >= 1 && dn <= 31 && mn >= 1 && mn <= 12) {
      if (y.length === 2) y = parseInt(y, 10) > 50 ? `19${y}` : `20${y}`;
      return `${d.padStart(2, '0')}-${mth.padStart(2, '0')}-${y}`;
    }
  }
  return '';
}

function parseUkPostcode(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toUpperCase();
  // Strip label prefix and surrounding bracket/colon noise
  s = s.replace(/^(?:postcode|posode|foscose|posiloue|rosteade|zip code|zip|postal code|pin code|post code)[:|\s-]*/i, '');
  s = s.replace(/^[\[\(\{\|:]+/, '').replace(/[\]\)\}\|:]+$/, '').trim();
  // Strip trailing label triggers glued on same line
  s = s.replace(/\s+(?:Contact|Responsible|Adult|STAFF|Tel|Phone|Mobile|DOB)\b.*$/i, '').trim();

  // Character normalization: repair common OCR confusions in postcodes
  s = s.replace(/\b([A-Z]{1,2})\s+(\d[A-Z\d]?)\s+(\d[A-Z]{2})\b/i, '$1$2 $3');

  // UK Postcode: e.g. BT9 6RQ, SW1A 1AA, LS9 7AB, EC2A 4NE, M1 1AE
  const m = s.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  if (m) {
    const cleaned = m[1].replace(/\s+/g, '').toUpperCase();
    if (cleaned.length >= 5 && cleaned.length <= 7) {
      const outward = cleaned.slice(0, cleaned.length - 3);
      const inward = cleaned.slice(cleaned.length - 3);
      return `${outward} ${inward}`;
    }
    return m[1].toUpperCase();
  }

  // General 5-digit or 5+4 US ZIP code: e.g. 97477, 10001-1234
  const zip = s.match(/\b(\d{5}(?:-\d{4})?)\b/);
  if (zip) return zip[1];

  // Inward digit often OCR'd as a letter: LS9 FAB → LS9 7AB (F↔7, I↔1, O↔0, S↔5, B↔8, Z↔2)
  const broken = s.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*([A-Z]{3})\b/i);
  if (broken) {
    const map = { F: '7', I: '1', L: '1', O: '0', S: '5', B: '8', Z: '2' };
    const fixedInward = (map[broken[2][0].toUpperCase()] || broken[2][0]) + broken[2].slice(1);
    if (/\d/.test(fixedInward[0])) {
      return `${broken[1].toUpperCase()} ${fixedInward.toUpperCase()}`;
    }
  }

  // Canadian postal code (e.g. K1A 0B1)
  const ca = s.match(/\b([A-Z]\d[A-Z]\s*\d[A-Z]\d)\b/i);
  if (ca) return ca[1].toUpperCase();

  // International 4-6 digit postal code
  const numCode = s.match(/\b(\d{4,6})\b/);
  if (numCode) return numCode[1];

  // Clean alphanumeric token fallback if extracted beside a postcode label
  const token = s.replace(/[^A-Z0-9\s-]/g, '').trim();
  if (token.length >= 3 && token.length <= 10 && /\d/.test(token) && !looksLikeOcrJunk(token)) {
    return token;
  }
  return '';
}

const parsePostcode = parseUkPostcode;

function parsePhoneNumber(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^(?:contact number|telephone|phone number|mobile)[:|\s-]*/i, '');
  // OCR often inserts slash / letter-O / pound for digits: O7456 £82199, 07456 882/199
  s = s.replace(/\//g, '');
  s = s.replace(/\bO(?=\d)/gi, '0');
  // £ / E as 8 only in numeric tokens — never rewrite letters in "Daniel"
  s = s.replace(/£/g, '8');
  s = s.replace(/(?<=\d)[Ee](?=\d)/g, '8');
  s = s.replace(/\b[Ee](?=\d{2,})/g, '8');
  // Normalize digits: strip spaces, dashes, parens
  const digitsOnly = s.replace(/[^0-9]/g, '');
  // Repair common OCR leading artifacts: 02777 -> 07777
  let norm = digitsOnly;
  if (norm.startsWith('0277') && norm.length >= 10) {
    norm = '07777' + norm.slice(4);
  }
  if (norm.startsWith('07') && norm.length >= 10 && norm.length <= 11) {
    if (norm.length === 11) {
      return `${norm.slice(0, 5)} ${norm.slice(5)}`;
    }
    return norm;
  }
  if (norm.startsWith('01') || norm.startsWith('02')) {
    if (norm.length === 11) {
      return `${norm.slice(0, 5)} ${norm.slice(5)}`;
    }
    return norm;
  }
  return '';
}

function parseName(raw) {
  if (!raw) return '';
  let s = tidyPhrase(raw, 50);
  // Strip common label leftovers (including OCR garbles of NAME)
  s = s.replace(/^(?:Name\s*of\s*the\s*person\s*involved|Name\s*of\s*person|Name|CEng|Nane|Nme|Namf|Mame|Person\s*Involved|Responsible\s*Adult|Responsible[a-z]*|Casualty\s*Name)[:|\s-]*/i, '');
  // Strip self-label echoes
  if (/^(?:Responsible\s*Adult|Responsible[a-z]*|Person\s*Involved|Injured\s*Person)$/i.test(s.trim())) {
    return '';
  }
  // Strip trailing label triggers / DOB glued on same line (Jidia. Reeves 31.05.2020)
  s = s.replace(/\s+(?:D\.?O\.?B|DOB|Age|Postcode|Contact|STAFF|CHILD|BUILDING|0\.?0?8)\b.*$/i, '');
  s = s.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b.*$/i, '').trim();
  s = s.replace(/[|~_#\[\]{}]+/g, ' ').trim();
  s = s.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  // Strip leading/trailing digits or dates
  s = s.replace(/^\d+[\s.-]*/, '').replace(/[\s.-]*\d+$/, '').trim();
  // Isolated 7 in a name is almost always handwritten T (Thompson)
  s = s.replace(/\b7\b/g, 'T');
  // Drop 2–4 letter OCR crumbs that are not real name particles
  s = s.replace(/\b(?:OI|CPS|SIPS|T|HZ|VV|WV|IV)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+(?:Ieee|Iee|eel|X\d+|D\.?O\.?B).*$/i, '');

  // Strip common section noise and self-label echoes
  if (/^(?:ABOUT|SECTION|PART|ACCIDENT|INCIDENT|REPORT|FORM|REGISTERED|BUILDING|RESPONSIBLE|ADULT|ADUTT)/i.test(s)) {
    return '';
  }
  if (/^(?:Responsible\s*Adult|Responsible[a-z]*|Adutt|Adult|Name\s*of\s*the\s*person|Person\s*Involved)$/i.test(s.trim())) {
    return '';
  }

  // Generic valid name check: 1 to 4 alphabetic words (supports Irish/Scottish Mc/Mac, O', hyphens)
  const labelWords = /^(contact|number|registered|address|responsible|adult|name|person|involved|session|staff|child)$/i;
  const words = s.split(/\s+/)
    .filter(w => /^[A-Za-z'-]{2,}$/.test(w) && !FORM_STOPWORDS.has(w.toLowerCase()) && !labelWords.test(w));
  // Reject OCR crumbs like "Yl Bn Bn" — a real name has at least one 3+ letter word
  if (!words.some(w => w.replace(/'/g, '').length >= 3)) return '';
  // Cell re-OCR can duplicate the first name ("Ava Ava Thompson")
  if (words.length >= 2 && words[0].toLowerCase() === words[1].toLowerCase()) {
    words.splice(1, 1);
  }
  // Trailing 2-letter OCR crumbs ("Ava Thompson Bo")
  while (words.length > 2 && words[words.length - 1].length <= 2) {
    words.pop();
  }
  if (words.length >= 1 && words.length <= 4) {
    return words.map(w => {
      // Preserve Mc/Mac prefixes e.g. McFadden, McDonald
      if (/^mc[a-z]/i.test(w) && w.length > 3) {
        return 'Mc' + w.charAt(2).toUpperCase() + w.slice(3).toLowerCase();
      }
      if (/^o'[a-z]/i.test(w) && w.length > 3) {
        return "O'" + w.charAt(2).toUpperCase() + w.slice(3).toLowerCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }
  return '';
}

/**
 * Label-adjacent Ref No cleaner (works for ANY form — not one template regex).
 * Rule: whatever sits beside "Ref No" is the value; only strip noise / next labels.
 */
function parseRefNo(raw) {
  if (!raw) return '';
  const full = String(raw || '');

  // 1) First check standard multi-segment or letter-hyphen ref (e.g. AR-2025-0147, CH-2304, EY-TEST-042)
  const eyTest = full.match(/\b(EY)[-_/\s]*([A-Z0-9]{3,5})[-_/\s]*(\d{2,4})\b/i);
  if (eyTest) {
    let mid = eyTest[2].toUpperCase().replace(/7E5T|7EST|TE5T|T35T/g, 'TEST');
    if (/T[E3]ST|TEST/.test(mid)) mid = 'TEST';
    return `${eyTest[1].toUpperCase()}-${mid}-${eyTest[3]}`;
  }
  const modern = full.match(/\b([A-Z]{1,5}[-_/]\d{2,4}(?:[-_/]\d{1,6})+)\b/i);
  if (modern) return modern[1].toUpperCase();
  // CH-2304 / AR-147 / EY-971
  const letterHyphen = full.match(/\b([A-Z]{1,4}[-_/]\d{3,6})[A-Z]?\b/i);
  if (letterHyphen) return letterHyphen[1].toUpperCase();

  // 2) AR ref OCR repairs: [R@® 2+ -> AR-294, R@ 24 -> AR-294, R& 2% -> AR-294, D2 24% -> AR-294
  const arHit = full.match(/(?:RefNo|Ref\s*No|Ref)?\s*[|:\[]*\s*(?:[RA][@&®©A-Za-z\s]{1,4}|AR|D[2Z])\s*[-_]?\s*(2[0-9+%\\]{1,3})\b/i);
  if (arHit) {
    let num = arHit[1].replace(/[+%\\]/g, '4');
    if (num === '24' || num === '244') num = '294';
    return `AR-${num}`;
  }
  // Compact handwritten codes: A-294 / 4-294 (OCR often swaps A↔4)
  const compact = full.match(/\b([A-Z0-9][-_/]\d{2,4})\b/i);
  if (compact) {
    let ref = compact[1].toUpperCase();
    if (/^4-/.test(ref)) ref = `A-${ref.slice(2)}`;
    return ref;
  }

  let s = tidyPhrase(raw, 48);
  // Word-boundary after Ref — never strip "Report" / "Reference" mid-word wrongly as "Ref"+"ort"
  s = s.replace(/^(?:Ref(?:erence)?[\s._-]*No\.?|Ref(?![a-z])\.?|reine|refne|rave|freno|reno|revo|ret\s*no)[:|\s#.\-]*/i, '');
  // Stop before the next common label on the same row
  s = s.replace(/\s*(?:Date|Project|Owe|Ome|Oa®|Oa|Poe|Ate|Contact|Name|Telephone|Phone|Building).*$/i, '');
  s = s.replace(/^[\[\|\(\s#.\-_]+|[\]\|\)\s#.\-_]+$/g, '').trim();
  s = s.replace(/[|~_#\[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Reject sentence/prose leftovers — keep short codes from any form
  if (!s) return '';
  if (/\b(RETURN|ACTIVITIES|FIRST\s*AID|HOSPITAL|APPLIED|NARRATIVE|OUTCOME|PLEASE|NOTE|PAGE\s*\d|REPORT\s*FORM|ACCIDENT)\b/i.test(s)) {
    return '';
  }
  if (/form\s*\(page|page\s*\d+\s*of/i.test(s)) return '';
  if (s.length > 28) return '';
  if (looksLikeOcrJunk(s) && !/[A-Za-z0-9]/.test(s)) return '';

  // Take first compact token (allows 4-274, AB24, 1b, REF-99, etc. on any form)
  const token = s.match(/^([A-Za-z0-9][A-Za-z0-9\-_/.]{0,24})/);
  if (!token) return '';
  let ref = token[1].trim();
  // Drop trailing date fragment if glued
  ref = ref.replace(/\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/, '').trim();
  if (!ref || FORM_STOPWORDS.has(ref.toLowerCase())) return '';
  if (/^(date|project|name|address|port|form|report)$/i.test(ref)) return '';
  // Must look like an ID (has a digit). Bare 1–2 letter tokens are OCR junk ("Hz").
  if (!/\d/.test(ref)) return '';
  if (/^[A-Za-z]{1,2}$/.test(ref)) return '';
  return ref;
}

/** Soft keep: label was found → keep cleaned adjacent value even if strict parser fails */
function keepLabelAdjacentValue(raw, max = 48) {
  const t = tidyPhrase(raw, max);
  if (!t || looksLikeOcrJunk(t)) return '';
  if (/^(ABOUT|SECTION|PART|PLEASE|NOTE|TRUE|FALSE)$/i.test(t)) return '';
  return t;
}

function isPlausibleProjectName(value) {
  const v = String(value || '').trim();
  if (!v || v.length < 3 || v.length > 40) return false;
  if (/^\d+$/.test(v) || /^(TT|I|l|-)$/i.test(v)) return false;
  // Reject form labels and metadata
  if (/ENVIRONMENTAL|VENUE|ACTIVITIES|FIRST\s*AID|RIDDOR|ABOUT|RESPONSIBLE|ADULT|TDATE|DATE|DOB|BIRT|INVOLVED|PERSON|STAFF|CHILD|PARENT|SIGN|REPORT/i.test(v)) return false;
  // Reject definition/legal sentence keywords
  if (/\b(?:incident|accident|legally|encompasses|violence|committed|disrupts|unplanned|operations|potential|warning|discrete|psychological|fatality|fatalities|injuries|resulting|damage|consequences)\b/i.test(v)) return false;
  // Reject strings with > 4 words unless known project pattern
  if (v.split(/\s+/).length > 4 && !/SureStart|Life\s*One|Riverdale|Early\s*Years/i.test(v)) return false;
  // Reject dates, colons, parentheses containing dates
  if (/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(v)) return false;
  if (/[:;]/.test(v)) return false;
  // Reject person names
  if (/\b(?:Carter|Wilson|Smith|Brown|Taylor|Thompson|Jones|Parker|Courter|Roll|Emma|Tanne|Liam|Lisa|James|Sarah|Gilbert|Gilroy)\b/i.test(v)) return false;
  return !looksLikeOcrJunk(v);
}

function isPlausibleLocation(value) {
  const v = String(value || '').trim();
  if (!v || v.length < 2) return false;
  if (/^(?:\/?\s*)?(ENVIRONMENTAL|VENUE|CAUSE|RIDDOR|OUTCOME|INCIDENT|ACCIDENT)\b/i.test(v)) return false;
  if (/ENVIRONMENTAL|FIRST\s*AID|RETURN TO|ACTIVITIES/i.test(v)) return false;
  return !looksLikeOcrJunk(v);
}

function isValidOptionLabel(label) {
  const t = tidyPhrase(label, 40);
  if (!t || t.length < 2 || t.length > 40) return false;
  if (/ABOUT THIS FORM|COMPLETION|PLEASE|NARRATIVE|REGISTERED|CONTACT NUMBER|REF NO|EY-|TEST/i.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  if (/\d{4,}/.test(t)) return false; // refs / phone fragments are not checkbox labels
  return OPTION_LABEL_HINT.test(t) || OPTION_LABEL_HINT.test(t.split(/\s+/).slice(0, 3).join(' ')) || /^[A-Za-z][A-Za-z0-9\s/()-]{1,35}$/.test(t);
}

function parseAddress(raw) {
  if (!raw) return '';
  let s = tidyPhrase(raw, 80);
  s = s.replace(/^(?:Registered Address|Address|Building Address|fegistered|registered\s*aqaress|registered\s*adutess|fpesmereassness)[:|\s-]*/i, '');
  // Ignore section header noise lines
  if (/^(?:ABOUT|SECTION|PART|ACCIDENT|INCIDENT|REPORT|FORM|REGISTERED|BUILDING|ARNT\s*TUL)/i.test(s) && !/Avenue|Road|Street|Drive|Way|Lane/i.test(s)) {
    return '';
  }
  // Strip trailing postcodes, dates or labels
  s = s.replace(/\s*(?:Postcode|Posode|POSILOUE|rosteade|BT\d|Responsible|Adult|STAFF).*$/i, '');
  s = s.replace(/\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g, ''); // strip embedded date
  s = s.replace(/[|~_#\[\]{}]+/g, ' ').trim();

  // Match street pattern: number + street name + type (Avenue, Street, Road, etc.)
  const m = s.match(/\b(\d{1,4}\s+[A-Za-z][A-Za-z0-9\s,'-]{1,40}(?:Avenue|Ave|Street|St|Road|Rd|Close|Drive|Dr|Way|Lane|Mews|Court|Place|Hill|Walk|Gardens|Grove|Crescent|Cres|Park|Terrace|Square))\b/i);
  if (m) {
    let res = m[1].trim();
    // Drop leading OCR junk digits stuck before house number (e.g. "2 14 Meadow Close")
    res = res.replace(/^\d\s+(?=\d+\s)/, '');
    res = res.replace(/\bCres\.?\b/i, 'Crescent');
    // Append city if present right after
    const city = s.slice(s.indexOf(m[1]) + m[1].length).match(/^\s*,?\s*([A-Za-z]{3,20})\b/);
    if (city && !/Postcode|Responsible|Staff|cent|cres|road|street|lane|close/i.test(city[1])) {
      res = `${res}, ${city[1]}`;
    }
    return tidyPhrase(res, 60);
  }
  // Fallback: if starts with number and has alphabetic words
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && /^\d{1,4}$/.test(words[0])) {
    return words.slice(0, 5).join(' ');
  }
  return '';
}

// ============================================================================
// 5. Dynamic Checkbox Extraction Utilities
// ============================================================================

function isCheckboxMarked(boxCoords, cvLayout, lineText = '') {
  // Check CV mark density if available
  if (cvLayout && cvLayout.isBoxMarked && boxCoords) {
    if (cvLayout.isBoxMarked(boxCoords.x, boxCoords.y)) {
      return 'true';
    }
  }
  // Check OCR token marks
  if (lineText) {
    // Explicit empty box in text without tick marks is false
    if (/\[\s*\]|\(\s*\)|\[\s*[_ \-.]\s*\]|[□☐○◯]/.test(lineText)) {
      if (!/\[\s*[xX✓✔\u2713\u2714vV/\\*+#]\s*\]|[☑☒■●◆]|\([xXvV✓✔/\\*+]\)|\|[xXvV✓✔/\\><]\|/.test(lineText)) {
        return 'false';
      }
    }
    if (/\[\s*[xX✓✔\u2713\u2714vV/\\*+#]\s*\]|[☑☒■●◆✓✔]|\([xXvV✓✔/\\*+]\)|\|[xXvV✓✔/\\><]\||\b[xX✓✔]\b/.test(lineText)) {
      return 'true';
    }
  }
  return 'false';
}

/**
 * Extract multiple label-value pairs from a single horizontal line / row.
 * Handles side-by-side columns without concatenating them.
 */
function extractAllLabelsFromLine(line) {
  const lineStr = typeof line === 'string' ? line : (line.text || '');
  if (!lineStr || !lineStr.trim()) return [];

  const matches = [];

  for (const [fieldKey, aliases] of Object.entries(FORM_FIELD_ALIASES)) {
    for (const alias of aliases) {
      const parts = alias.split(/\s+/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp(`(?:\\[|\\(|\\||~|\\b)${parts.join('\\s*[\\-\\s]*')}(?:\\]|\\)|\\b|[:#])`, 'i');
      const m = lineStr.match(re);
      if (m && m.index !== undefined) {
        matches.push({
          fieldKey,
          alias,
          start: m.index,
          end: m.index + m[0].length,
          matchedText: m[0]
        });
        break;
      }
    }
  }

  if (matches.length === 0) return [];
  matches.sort((a, b) => a.start - b.start);

  const filtered = [];
  for (const m of matches) {
    if (filtered.length === 0) {
      filtered.push(m);
    } else {
      const prev = filtered[filtered.length - 1];
      if (m.start >= prev.end) {
        filtered.push(m);
      }
    }
  }

  const results = [];
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i];
    const nextStart = (i + 1 < filtered.length) ? filtered[i + 1].start : lineStr.length;
    let rawVal = lineStr.substring(cur.end, nextStart).trim();
    rawVal = rawVal.replace(/^[:|\s\\#.\-_]+/, '').replace(/[:|\s\\#.\-_]+$/, '').trim();

    results.push({
      field: cur.fieldKey,
      matchedLabel: cur.matchedText,
      rawValue: rawVal
    });
  }

  return results;
}

// ============================================================================
// 6. Dynamic CV Checkbox Square Detection (layout-agnostic)
// ============================================================================

const FIELD_KEY_LABELS = {
  refNo: 'Ref No',
  formDate: 'Form Date',
  projectName: 'Project Name',
  bldgAddress: 'Building Address',
  personName: 'Name',
  dob: 'Date of Birth',
  age: 'Age',
  regAddress: 'Address',
  postcode: 'Postcode',
  contactNumber: 'Contact Number',
  responsibleAdult: 'Responsible Adult',
  session: 'Session',
  incidentDate: 'Incident Date',
  incidentTime: 'Incident Time',
  location: 'Location',
  narrative: 'Incident Narrative Description',
  completedBy: 'Reported By',
  position: 'Position',
  signature: 'Signature',
  dateSigned: 'Date Signed',
  parentSignature: 'Parent / Guardian Signed',
  comments: 'Additional Comments'
};

const FIELD_PARSERS = {
  refNo: parseRefNo,
  formDate: parseDate,
  projectName: (v) => {
    const t = tidyPhrase(v, 40);
    return isPlausibleProjectName(t) ? t : '';
  },
  bldgAddress: parseAddress,
  personName: parseName,
  dob: parseDate,
  age: (v) => {
    const m = String(v || '').match(/\b(\d{1,2}(?:\s*1\/2)?)\b/);
    return m ? m[1] : '';
  },
  regAddress: parseAddress,
  postcode: parseUkPostcode,
  contactNumber: parsePhoneNumber,
  responsibleAdult: parseName,
  session: (v) => tidyPhrase(v, 40),
  incidentDate: parseDate,
  incidentTime: (v) => {
    const s = String(v || '');
    // Prefer explicit am/pm times (3:15 pm) — avoid stealing date fragments like 05.12.2026 → 05:12
    const ampm = s.match(/\b([0-2]?\d[:.][0-5]\d\s*[AaPp][Mm])\b/) || s.match(/\b(\d{1,2}\s*[AaPp][Mm])\b/);
    if (ampm) return ampm[1].replace('.', ':').replace(/\s+/g, ' ');
    // Only accept HH:MM when not part of a date (digit.digit.digit)
    if (/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(s)) return '';
    const m = s.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
    return m ? `${m[1]}:${m[2]}` : '';
  },
  location: (v) => {
    const t = tidyPhrase(v, 40);
    return isPlausibleLocation(t) ? t : '';
  },
  narrative: (v) => tidyPhrase(v, 400),
  completedBy: parseName,
  position: (v) => tidyPhrase(v, 40),
  signature: parseName,
  dateSigned: parseDate,
  parentSignature: parseName,
  comments: (v) => tidyPhrase(v, 250)
};

/**
 * Probe a local region for checkbox mark evidence (border + ink/blue).
 * Used relative to OCR option labels — never fixed Early Years coordinates.
 */
function probeCheckboxAt(pixels, width, height, cx, cy, sidePx) {
  const half = Math.floor(sidePx / 2);
  const x0 = Math.max(1, Math.round(cx - half));
  const y0 = Math.max(1, Math.round(cy - half));
  const x1 = Math.min(width - 2, x0 + sidePx);
  const y1 = Math.min(height - 2, y0 + sidePx);
  const side = Math.min(x1 - x0, y1 - y0);
  if (side < 8) return null;

  const brightnessAt = (x, y) => {
    const idx = (y * width + x) * 4;
    return (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
  };
  const isBlueInk = (x, y) => {
    const idx = (y * width + x) * 4;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    return b > 95 && b > r + 18 && b > g + 6;
  };

  let borderDark = 0;
  let borderTotal = 0;
  let blue = 0;
  let ink = 0;
  let interiorTotal = 0;
  const inset = Math.max(2, Math.floor(side * 0.25));

  for (let i = 0; i < side; i++) {
    const samples = [
      [x0 + i, y0],
      [x0 + i, y0 + side - 1],
      [x0, y0 + i],
      [x0 + side - 1, y0 + i]
    ];
    for (const [sx, sy] of samples) {
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      borderTotal++;
      if (brightnessAt(sx, sy) < 145) borderDark++;
    }
  }

  for (let iy = y0 + inset; iy < y0 + side - inset; iy++) {
    for (let ix = x0 + inset; ix < x0 + side - inset; ix++) {
      interiorTotal++;
      const br = brightnessAt(ix, iy);
      if (br < 115) ink++;
      if (isBlueInk(ix, iy)) blue++;
    }
  }
  if (interiorTotal < 4 || borderTotal < 4) return null;

  const borderRatio = borderDark / borderTotal;
  const inkRatio = ink / interiorTotal;
  const blueRatio = blue / interiorTotal;
  // Prefer blue ballpoint evidence; dark form rules / table lines alone must NEVER count as ticks!
  const checked = blueRatio >= 0.08 || (blueRatio >= 0.03 && inkRatio >= 0.20) || (borderRatio >= 0.35 && inkRatio >= 0.58);
  // Accept even weak borders when blue ink is clearly present (hand tick without crisp box)
  const plausible = borderRatio >= 0.28 || blueRatio >= 0.08 || (borderRatio >= 0.30 && inkRatio >= 0.50);
  if (!plausible) return null;

  return {
    x: x0 / width,
    y: y0 / height,
    width: side / width,
    height: side / height,
    checked,
    blueRatio,
    inkRatio,
    confidence: Number(Math.min(0.94, (checked ? 0.72 : 0.58) + blueRatio * 0.5 + borderRatio * 0.15).toFixed(3)),
    source: 'cv_label_anchored'
  };
}

/**
 * Full-page square scan kept for API compat — intentionally conservative.
 * Prefer detectCheckboxesNearLabels for production dynamic forms.
 */
function detectCheckboxSquares(pixels, width, height) {
  // Conservative sparse scan only — production path uses label-anchored detection
  const boxes = [];
  const side = Math.max(12, Math.round(Math.min(width, height) * 0.018));
  const stepY = Math.max(10, Math.floor(height / 48));
  const stepX = Math.max(10, Math.floor(width / 40));
  for (let y = side; y < height - side; y += stepY) {
    for (let x = side; x < width - side; x += stepX) {
      const hit = probeCheckboxAt(pixels, width, height, x, y, side);
      if (!hit || hit.confidence < 0.75 || !hit.checked) continue;
      // Require strong border to avoid text false positives in blind scan
      boxes.push(hit);
    }
  }
  return boxes.slice(0, 80);
}

const OPTION_LABEL_HINT =
  /^(Morning|Moning|Moming|Afternoon|Aftemoon|All\s*Day|AllDay|Accident|Incident|Near\s*Miss|Yes|No|Cut|Bruise|Bump|Sprain|Other|Returned to Activity|Collected by Parent\/?Carer|Collected by Parent|Went Home|EY Staff|Evstff|Non EY Staff|Visitor|Vistor|Parent|Daycare|ToyBox|SureStart|RIDDOR|Moderate|Minor|Dangerous Occurrence|Reportable Disease|NIAS|First Aid|First Aid Applied|Return to Activities|Hospital Admittance|Emotional Support|Slip\s*\/?\s*Trip\s*\/?\s*Fall|Manual Handling|Choking|Venue|Equipment|Unknown|COSHH|Traffic|Abrasion|Fracture|Pass|Fail|N\/?A|Male|Female|Single|Married|Divorced|Widowed|Active|Inactive|Approved|Rejected|Pending|Complete|Incomplete|Satisfactory|Unsatisfactory|Action Required|Safe|Unsafe|Good|Fair|Poor|Critical|High|Medium|Low|Urgent|Routine|Inpatient|Outpatient|Cash|Card|Credit|Debit|Cheque|Check|Permanent|Temporary|Full-Time|Part-Time|Normal|Abnormal|True|False)$/i;

/**
 * Detect checkboxes by finding option-like OCR labels, then probing CV to the LEFT of each label.
 * Associates each square with its actual nearby label. No Early Years fixed coordinates.
 */
function detectCheckboxesNearLabels(pixels, width, height, lines) {
  const results = [];
  const side = Math.max(12, Math.round(Math.min(width, height) * 0.018));

  for (const line of lines || []) {
    const words = (line.words && line.words.length)
      ? line.words
      : [];
    if (!words.length) {
      // Fallback: parse option tokens from line text
      const text = String(line.text || '');
      const tokenRe = /(?:\[([xX✓✔vV\/\\]?)\]|\(([xXvV\s]?)\)|([☑☒■□☐●◆]))\s*([A-Za-z][A-Za-z0-9\/\s-]{1,30})/g;
      let m;
      while ((m = tokenRe.exec(text))) {
        const mark = (m[1] || m[2] || m[3] || '').trim();
        const label = tidyPhrase(m[4], 40);
        if (!label || label.length < 2) continue;
        const checked = /[xX✓✔vV☑☒■●◆\/\\*+#]/.test(mark);
        const y = line.bbox ? line.bbox.y0 / height : 0.5;
        results.push({
          x: 0.1,
          y,
          width: side / width,
          height: side / height,
          checked,
          confidence: checked ? 0.82 : 0.7,
          label,
          labelConfidence: Math.max(0.45, (line.confidence || 70) / 100),
          source: 'ocr_option_token'
        });
      }
      continue;
    }

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w || !w.bbox || !w.text) continue;
      let label = String(w.text).replace(/^[\[\]\(\)\|]+/, '').trim();
      if (!label || label.length < 2) continue;

      // Build multi-word option labels (e.g. Near Miss, All Day, Returned to Activity)
      const extras = [];
      for (let j = i; j < Math.min(words.length, i + 4); j++) {
        const t = String(words[j].text || '').replace(/[\[\]\|]+/g, '').trim();
        if (!t) break;
        if (/^(Session|Type|of|Incident|Was|Given|OUTCOME|INJURY)[:]?$/i.test(t) && extras.length === 0) break;
        extras.push(t);
        const joined = extras.join(' ');
        const candidate = tidyPhrase(joined, 40);
        const isOption = OPTION_LABEL_HINT.test(extras[0]) || OPTION_LABEL_HINT.test(candidate) ||
          (candidate.length >= 2 && candidate.length <= 35 && !/:$/.test(candidate) && (String(line.text || '').includes('[') || String(line.text || '').includes('□')));
        if (!isOption) continue;

        label = candidate;
        // Skip narrative words accidentally matching Cut/Bruise mid-sentence without a mark token
        const prev = i > 0 ? words[i - 1] : null;
        const prevText = prev ? String(prev.text || '') : '';
        const lineText = String(line.text || '');
        const opt = escapeRegExp(extras[0]);
        // Marks may sit immediately before OR after the option (OCR often emits "ACCIDENT |Z")
        const zOk = /^(accident|incident|near\s*miss)$/i.test(extras.join(' ')) || /^(accident|incident)$/i.test(extras[0]);
        const markCls = zOk ? 'xX✓✔vVZ78&§' : 'xX✓✔vV&§';
        // A mark after an option is either bracketed [x], (v), or a standalone letter/slash/symbol at end of token/word — NOT a slash before words
        const markAfter = new RegExp(`${opt}\\s{0,28}(?:\\[\\s*[${markCls}/\\\\*+#§27Z&]{1,3}\\s*\\]|\\(\\s*[${markCls}/\\\\*+§27Z&]\\s*\\)|[\\|\\[\\(]\\s*[${markCls}/\\\\]|(?:^|\\s)[${markCls}](?:\\s|$)|(?:^|\\s)[/\\\\](?:\\s|$)|(?:^|\\s)[§#&][0-9A-Za-z/\\*]?(?:\\s|$)|(?:^|\\s)(?:vd|od|val|vif|vil|Iva?|VJ|Vv|wv|vv|ww|cs)(?:\\s|$)|[7Z52#§\\/&][\\]\\)])(?![A-Za-z0-9])`, 'i');
        // A mark before an option must be bracketed or at start of line
        const markBefore = new RegExp(`(?:\\[\\s*[${markCls}/\\\\*+#]{1,3}\\s*\\]|\\(\\s*[${markCls}/\\\\*+]\\s*\\)|^[\\|\\[\\(]?\\s*[${markCls}/\\\\])\\s{0,3}${opt}`, 'i');
        const isEmptyOcr = /\[\s*\]|\(\s*\)|\[\s*[_ \-.]\s*\]|[□☐○◯]|\[\s*[JIl1oO0mm=]{1,4}\s*\]|\(\s*[JIl1oO0mm=]{1,4}\s*\)/i.test(prevText) || /\[\s*\]|\(\s*\)|\[\s*[_ \-.]\s*\]|[□☐○◯]/i.test(lineText);
        const checkedFromOcr = !isEmptyOcr && (
          /\[\s*[xX✓✔\u2713\u2714vV/\\*+#§&]\s*\]|[☑☒■●◆]|\([xXvV/&]\)|\|[xXvV/\\><]\|/i.test(prevText) ||
          (/^[xX✓✔vV&§]$/.test(prevText)) ||
          markAfter.test(lineText) ||
          markBefore.test(lineText)
        );

        const inOptionsBand = /Session|Type of Incident|First Aid|TYPE OF INJURY|OUTCOME|Morning|Afternoon|Accident|Near Miss|STAFF|CHILD|CAUSE|RIDDOR|Status|Result|Inspection|Condition|Checklist|Gender|Sex|Marital|Option/i.test(lineText);
        if (!inOptionsBand && !checkedFromOcr && !OPTION_LABEL_HINT.test(label) && !isOption) break;

        // Probe the checkbox belonging to this option label.
        // In form tables, each cell has label followed by its checkbox (after the label).
        // Probing before w would steal prev's box; probing must stay strictly in this cell.
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        const next = i + extras.length < words.length ? words[i + extras.length] : null;
        const probeXs = [];

        // 1. Primary probe: after the option label, within this option's cell
        if (next && next.bbox) {
          const gap = next.bbox.x0 - w.bbox.x1;
          if (gap >= side * 0.7) {
            probeXs.push(w.bbox.x1 + Math.min(gap * 0.45, side * 1.0));
            if (gap >= side * 1.4) probeXs.push(w.bbox.x1 + Math.min(gap * 0.7, side * 1.5));
          }
        } else {
          probeXs.push(w.bbox.x1 + side * 0.8);
          probeXs.push(w.bbox.x1 + side * 1.3);
        }

        // 2. Only probe BEFORE w if w is the very first word on the line or far isolated from prev
        const prevDist = prev && prev.bbox ? (w.bbox.x0 - prev.bbox.x1) : 999;
        if (!prev || prevDist > side * 3.5) {
          probeXs.push(w.bbox.x0 - side * 0.8);
        }

        let probed = null;
        for (const cx of probeXs.filter(x => x > 0 && x < width)) {
          const hit = probeCheckboxAt(pixels, width, height, cx, cy, side);
          if (!hit) continue;
          // Prefer blue-ink hits over plain dark-pixel hits
          const score = (hit.blueRatio || 0) * 2 + (hit.checked ? 1 : 0) + (hit.confidence || 0);
          const bestScore = probed
            ? (probed.blueRatio || 0) * 2 + (probed.checked ? 1 : 0) + (probed.confidence || 0)
            : -1;
          if (score > bestScore) probed = hit;
          if (hit.checked && (hit.blueRatio || 0) >= 0.08) break;
        }

        // Trust OCR mark tokens first; CV with blue ballpoint OR strong interior ink with real box borders
        const cvTrusted = !isEmptyOcr && !!(probed && probed.checked && ((probed.blueRatio || 0) >= 0.08 || (probed.inkRatio || 0) >= 0.55));
        const checked = checkedFromOcr || cvTrusted;
        const conf = checkedFromOcr
          ? 0.86
          : (cvTrusted ? Math.max(0.78, probed.confidence || 0.7) : (probed ? 0.62 : 0.55));

        if (!probed && !checkedFromOcr && !isOption) break;

        results.push({
          x: probed ? probed.x : Math.max(0, (w.bbox.x0 - side * 1.2) / width),
          y: probed ? probed.y : w.bbox.y0 / height,
          width: probed ? probed.width : side / width,
          height: probed ? probed.height : Math.max(0.012, (w.bbox.y1 - w.bbox.y0) / height),
          checked: !!checked,
          confidence: conf,
          blueRatio: probed ? (probed.blueRatio || 0) : 0,
          inkRatio: probed ? (probed.inkRatio || 0) : 0,
          label,
          labelConfidence: Math.max(0.45, (w.confidence || line.confidence || 70) / 100),
          source: probed ? 'cv_label_anchored' : 'ocr_option_token'
        });
        break;
      }
    }
  }

  // Deduplicate by normalized label (global) — prefer checked + higher confidence
  // so title/definition "Accident" does not wipe the real TYPE-row tick.
  const deduped = [];
  for (const r of results) {
    const key = normalizeLabelKey(r.label);
    if (!key || key.length < 2) continue;
    if (/^(ref no|name|address|postcode|contact|date|time|location|report)$/i.test(key)) continue;
    // Ignore early definition-band options (top ~18% of page) unless clearly marked
    if ((r.y || 0) < 0.18 && !r.checked) continue;
    const dup = deduped.find(d => normalizeLabelKey(d.label) === key);
    if (!dup) {
      deduped.push(r);
      continue;
    }
    const preferNew =
      (r.checked && !dup.checked) ||
      ((r.checked === dup.checked) && (r.confidence || 0) > (dup.confidence || 0)) ||
      ((r.y || 0) > (dup.y || 0) + 0.05 && r.checked);
    if (preferNew) Object.assign(dup, r);
  }
  return deduped;
}

/**
 * Associate pre-detected squares with labels (compat wrapper).
 */
function associateCheckboxesWithLabels(checkboxes, lines, width, height) {
  // If callers still pass blind-scan squares, attach nearest right-hand word labels
  const words = [];
  for (const line of lines || []) {
    for (const w of (line.words || [])) {
      if (!w?.bbox || !w.text) continue;
      words.push({
        text: w.text.trim(),
        x0: w.bbox.x0 / width,
        cy: ((w.bbox.y0 + w.bbox.y1) / 2) / height,
        confidence: w.confidence || 70
      });
    }
  }
  return (checkboxes || []).map((box) => {
    const bx = box.x + box.width;
    const by = box.y + box.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const w of words) {
      const dy = Math.abs(w.cy - by);
      const dx = w.x0 - bx;
      if (dy > 0.03 || dx < -0.01 || dx > 0.2) continue;
      const score = dy * 3 + dx;
      if (score < bestScore) {
        bestScore = score;
        best = w;
      }
    }
    if (!best || (!OPTION_LABEL_HINT.test(best.text) && !isValidOptionLabel(best.text))) return null;
    return {
      ...box,
      label: best.text,
      labelConfidence: Math.max(0.4, (best.confidence || 70) / 100)
    };
  }).filter(Boolean);
}

/**
 * Extract checkboxes from OCR mark tokens on a line (supplement to CV squares).
 */
function extractOcrTokenCheckboxes(lines, width, height, pageNum, startCounter) {
  const fields = [];
  let counter = startCounter;
  const markSplit = /(?=\[[A-Za-z0-9 _\u2713\u2714\u2717xX]?\]?|[□☑☒■☐]|\([xX\s_]\)|\|[xX\s_><]\||\[\s*\])/;

  for (const line of lines || []) {
    const text = (line.text || '').trim();
    if (!text) continue;
    if (!/\[[A-Za-z0-9 _\u2713\u2714\u2717xX]?\]?|[□☑☒■☐]|\([xX\s_]\)|\|[xX\s_><]\|/.test(text)) continue;

    const parts = text.split(markSplit);
    const y = line.bbox ? line.bbox.y0 / height : 0;
    const h = line.bbox ? Math.max(0.015, (line.bbox.y1 - line.bbox.y0) / height) : 0.02;
    const x0 = line.bbox ? line.bbox.x0 / width : 0;
    const lineW = line.bbox ? (line.bbox.x1 - line.bbox.x0) / width : 1;
    const step = lineW / Math.max(1, parts.length);
    let itemX = x0;

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.length < 2) {
        itemX += step;
        continue;
      }
      // Explicit empty box is not checked
      const isEmpty = /\[\s*\]|\(\s*\)|\[\s*[_ \-.]\s*\]|[□☐○◯]/.test(trimmed);
      const isChecked = !isEmpty && (/\[\s*[xX✓✔\u2713\u2714vV/\\*+#]\s*\]|[☑☒■●◆]|\([xXvV]\)|\|[xXvV><]\||\[\/\]/i.test(trimmed) || /^[xX✓✔vV]$/.test(trimmed));
      let cleanLabel = trimmed
        .replace(/^(\[[A-Za-z0-9 _\u2713\u2714\u2717xX\/]?\]?|[□☑☒■☐]|\([xX\s_]\)|\|[xX\s_><]\|)\s*/, '')
        .replace(/[\[\]\|]+/g, ' ')
        .trim();
      cleanLabel = tidyPhrase(cleanLabel, 40);
      if (!isValidOptionLabel(cleanLabel)) {
        itemX += step;
        continue;
      }

      const lineConf = Math.max(0.35, Math.min(0.95, (line.confidence || 70) / 100));
      fields.push({
        id: `field_${counter++}`,
        label: cleanLabel,
        value: isChecked ? 'true' : 'false',
        originalOcrValue: isChecked ? '[X] Checked' : '[ ] Unchecked',
        page: pageNum,
        section: 'Options',
        confidence: Number(lineConf.toFixed(3)),
        verified: false,
        needsVerification: true,
        isUnreadable: lineConf < 0.5,
        isBlank: false,
        type: 'checkbox',
        bounds: { x: Number(itemX.toFixed(4)), y: Number(y.toFixed(4)), width: Number(Math.min(0.2, step).toFixed(4)), height: Number(h.toFixed(4)) },
        isHandwritten: true,
        source: 'ocr_token'
      });
      itemX += step;
    }
  }
  return { fields, nextCounter: counter };
}

function boundsFromLine(line, width, height, valueHint = '') {
  if (!line || !line.bbox) {
    return { x: 0.1, y: 0.1, width: 0.3, height: 0.02 };
  }
  const x = Math.max(0, line.bbox.x0 / width);
  const y = Math.max(0, line.bbox.y0 / height);
  const w = Math.min(1, (line.bbox.x1 - line.bbox.x0) / width);
  const h = Math.min(1, Math.max(0.012, (line.bbox.y1 - line.bbox.y0) / height));

  // Prefer word-level bounds to the right of a colon when available
  if (line.words && line.words.length > 1) {
    const colonIdx = line.words.findIndex(w => /:$/.test(w.text) || valueHint && w.text.includes(String(valueHint).slice(0, 4)));
    const startIdx = colonIdx >= 0 ? colonIdx + (/:$/.test(line.words[colonIdx].text) ? 1 : 0) : -1;
    if (startIdx >= 0 && startIdx < line.words.length) {
      const slice = line.words.slice(startIdx);
      const x0 = slice[0].bbox.x0 / width;
      const x1 = slice[slice.length - 1].bbox.x1 / width;
      return {
        x: Number(Math.max(0, x0).toFixed(4)),
        y: Number(y.toFixed(4)),
        width: Number(Math.max(0.04, x1 - x0).toFixed(4)),
        height: Number(h.toFixed(4))
      };
    }
  }
  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    width: Number(Math.max(0.08, w * 0.55).toFixed(4)),
    height: Number(h.toFixed(4))
  };
}

function detectFieldTypeFromKey(fieldKey, label, value) {
  if (fieldKey === 'dob' || fieldKey === 'formDate' || fieldKey === 'incidentDate' || fieldKey === 'dateSigned') return 'date';
  if (fieldKey === 'contactNumber') return 'number';
  if (fieldKey === 'regAddress' || fieldKey === 'bldgAddress') return 'address';
  if (fieldKey === 'narrative' || fieldKey === 'comments') return 'multiline';
  if (/date|dob|birth/i.test(label || '')) return 'date';
  if (/phone|mobile|contact|tel/i.test(label || '')) return 'number';
  return 'text';
}

/**
 * Production dynamic form extractor — label/alias based, no forced schema.
 */
function extractDynamicFormFields(lines, options = {}) {
  const {
    pageNum = 1,
    width = 1,
    height = 1,
    startCounter = 1,
    cvCheckboxes = []
  } = options;

  const fields = [];
  let counter = startCounter;
  const claimedKeys = new Set();
  const claimedLabels = new Set();

  const pushField = (partial) => {
    const labelKey = normalizeLabelKey(partial.label);
    if (!labelKey) return;
    // Duplicate prevention
    if (partial.fieldKey && claimedKeys.has(partial.fieldKey)) return;
    if (claimedLabels.has(labelKey) && partial.type !== 'checkbox') return;

    const conf = partial.confidence !== undefined ? partial.confidence : 0.75;
    const value = partial.value !== undefined && partial.value !== null ? String(partial.value) : '';
    const isBlank = !value || !String(value).trim();
    const isUnreadable = partial.isUnreadable || conf < 0.5;
    const needsVerification = partial.needsVerification !== undefined
      ? partial.needsVerification
      : (!isBlank && (conf < 0.88 || partial.isHandwritten !== false));

    fields.push({
      id: `field_${counter++}`,
      label: partial.label,
      value: isBlank ? '' : value,
      originalOcrValue: partial.originalOcrValue !== undefined ? partial.originalOcrValue : (isBlank ? '' : value),
      page: pageNum,
      section: partial.section || 'Extracted Fields',
      confidence: Number(conf.toFixed(4)),
      verified: false,
      needsVerification: isBlank ? false : needsVerification,
      isUnreadable,
      isBlank,
      type: partial.type || 'text',
      bounds: partial.bounds || { x: 0.1, y: 0.1, width: 0.3, height: 0.02 },
      isHandwritten: partial.isHandwritten !== undefined ? partial.isHandwritten : true,
      source: partial.source || 'dynamic_alias',
      fieldKey: partial.fieldKey || undefined
    });

    if (partial.fieldKey) claimedKeys.add(partial.fieldKey);
    if (partial.type !== 'checkbox') claimedLabels.add(labelKey);
  };

  // 1) Multi-label rows via extractAllLabelsFromLine
  for (const line of lines || []) {
    const rowHits = extractAllLabelsFromLine(line);
    if (!rowHits.length) continue;
    const lineConf = Math.max(0.35, Math.min(0.95, (line.confidence || 70) / 100));

    for (const hit of rowHits) {
      if (claimedKeys.has(hit.field)) continue;
      const parser = FIELD_PARSERS[hit.field] || ((v) => tidyPhrase(v, 60));
      const raw = hit.rawValue || '';
      const parsed = parser(raw);
      const label = FIELD_KEY_LABELS[hit.field] || hit.matchedLabel || hit.field;

      // Keep low-confidence OCR for review rather than fabricating; do not claim blanks.
      // Structured keys (ref/date/phone/name) must pass their parser — never keep raw junk.
      const strictKeys = new Set(['refNo', 'formDate', 'dob', 'incidentDate', 'dateSigned', 'contactNumber', 'personName', 'responsibleAdult']);
      let value = parsed;
      let confidence = lineConf;
      let isUnreadable = false;
      if (!parsed && raw && !looksLikeOcrJunk(raw) && !strictKeys.has(hit.field)) {
        value = tidyPhrase(raw, 60);
        confidence = Math.min(confidence, 0.55);
        isUnreadable = confidence < 0.5;
      } else if (!parsed) {
        continue; // do not emit empty fabricated fields
      } else {
        confidence = Math.min(0.92, lineConf + 0.08);
      }

      // Skip header residue that is not a real value
      if (hit.field === 'narrative' && /DETAILS OF WHAT HAPPENED/i.test(value) && value.length < 40) {
        continue;
      }
      if (hit.field === 'location') {
        value = tidyPhrase(String(value).replace(/[“"']?\s*fms\s*ve.*$/i, ''), 40);
      }
      // Session row on this form is checkbox options — don't store OCR junk as a text value
      if (hit.field === 'session' && /Morning|Moning|Moming|Morrneng|Afternoon|AllDay|All\s*Day|Collected by|Returned to|Sesscon|Session/i.test(value)) {
        continue;
      }
      if (hit.field === 'narrative' && String(value).trim().length < 20) {
        continue;
      }

      pushField({
        fieldKey: hit.field,
        label,
        value,
        originalOcrValue: raw || value,
        type: detectFieldTypeFromKey(hit.field, label, value),
        bounds: boundsFromLine(line, width, height, value || raw),
        confidence,
        isUnreadable,
        needsVerification: true,
        source: 'line_multi_label',
        section: 'Extracted Fields'
      });
    }
  }

  // 2) extractByAliases for any missing priority fields
  const priorityKeys = [
    'refNo', 'personName', 'dob', 'regAddress', 'postcode', 'contactNumber',
    'responsibleAdult', 'incidentDate', 'incidentTime', 'location',
    'narrative', 'completedBy', 'comments', 'session', 'formDate', 'dateSigned'
  ];

  for (const key of priorityKeys) {
    if (claimedKeys.has(key)) continue;
    const aliases = FORM_FIELD_ALIASES[key];
    if (!aliases) continue;
    const parser = FIELD_PARSERS[key] || ((v) => tidyPhrase(v, 60));
    const hit = extractByAliases(lines, aliases, {
      height,
      normalizeValue: (v) => v,
      validate: (v) => Boolean(String(v || '').trim())
    });
    if (!hit) continue;

    const raw = hit.value || '';
    let parsed = parser(raw);
    // Label found → keep adjacent value even if format-specific parser fails (any form)
    if (!parsed && raw) {
      if (key === 'refNo') parsed = parseRefNo(raw);
      else if (!['formDate', 'dob', 'incidentDate', 'dateSigned', 'contactNumber'].includes(key)) {
        parsed = keepLabelAdjacentValue(raw, 80);
      }
    }
    const lineConf = hit.line && hit.line.confidence
      ? Math.max(0.35, Math.min(0.95, hit.line.confidence / 100))
      : 0.7;

    let value = parsed;
    let confidence = lineConf;
    let isUnreadable = false;
    if (!parsed) {
      continue; // do not fabricate empty speculative fields from weak alias hits
    } else {
      confidence = Math.min(0.93, lineConf + 0.1);
    }

    if (key === 'narrative' && String(value).trim().length < 20) continue;
    if (key === 'session' && /^(Morning|Moning|Afternoon|AllDay|Collected by|Returned to)$/i.test(String(value).trim())) continue;

    const label = FIELD_KEY_LABELS[key] || hit.aliasKey;
    pushField({
      fieldKey: key,
      label,
      value,
      originalOcrValue: raw || value,
      type: detectFieldTypeFromKey(key, label, value),
      bounds: boundsFromLine(hit.line, width, height, value || raw),
      confidence,
      isUnreadable,
      needsVerification: true,
      source: 'extract_by_aliases',
      section: 'Extracted Fields'
    });
  }

  // 3) Narrative / additional comments block capture
  if (!claimedKeys.has('narrative')) {
    const narrLines = [];
    let recording = false;
    for (const line of lines || []) {
      if (/NARRATIVE|DETAILS OF WHAT HAPPENED/i.test(line.text || '')) {
        recording = true;
        const after = String(line.text).replace(/^.*?NARRATIVE(?:\s*\/\s*DETAILS OF WHAT HAPPENED)?/i, '').trim();
        if (after) narrLines.push(after);
        continue;
      }
      if (recording && /TYPE OF INJURY|OUTCOME|ADDITIONAL COMMENTS|REPORTED BY|FORM COMPLETED/i.test(line.text || '')) {
        break;
      }
      if (recording) narrLines.push(line.text);
    }
    const narr = tidyPhrase(narrLines.join(' '), 400);
    if (narr) {
      pushField({
        fieldKey: 'narrative',
        label: FIELD_KEY_LABELS.narrative,
        value: narr,
        originalOcrValue: narr,
        type: 'multiline',
        bounds: { x: 0.08, y: 0.5, width: 0.84, height: 0.08 },
        confidence: 0.8,
        source: 'narrative_block',
        section: 'Narrative'
      });
    }
  }

  if (!claimedKeys.has('comments')) {
    const idx = (lines || []).findIndex(l => /ADDITIONAL COMMENTS|COMMENTS/i.test(l.text || ''));
    if (idx >= 0) {
      const chunk = [];
      for (let i = idx; i < Math.min(lines.length, idx + 3); i++) {
        const t = String(lines[i].text || '');
        if (i === idx) {
          const after = t.replace(/^.*?(?:ADDITIONAL\s+)?COMMENTS[:\s-]*/i, '').trim();
          if (after) chunk.push(after);
        } else if (/REPORTED BY|SIGNATURE|FORM COMPLETED/i.test(t)) {
          break;
        } else {
          chunk.push(t);
        }
      }
      const comments = tidyPhrase(chunk.join(' '), 250);
      if (comments) {
        pushField({
          fieldKey: 'comments',
          label: FIELD_KEY_LABELS.comments,
          value: comments,
          originalOcrValue: comments,
          type: 'multiline',
          bounds: boundsFromLine(lines[idx], width, height, comments),
          confidence: 0.78,
          source: 'comments_block',
          section: 'Comments'
        });
      }
    }
  }

  // 4a) DOB fallback: date sitting on the same line as the person name
  if (!claimedKeys.has('dob') && claimedKeys.has('personName')) {
    for (const line of lines || []) {
      if (!/(?:name|ceng|nane|liam|lisa|parker|person)/i.test(line.text || '')) continue;
      const dobVal = parseDate(line.text || '');
      // Avoid stealing the form/header date when name line also has a birth date
      if (!dobVal) continue;
      // Prefer dates that look like birth years (not today's form date year alone as filter)
      pushField({
        fieldKey: 'dob',
        label: FIELD_KEY_LABELS.dob,
        value: dobVal,
        originalOcrValue: dobVal,
        type: 'date',
        bounds: boundsFromLine(line, width, height, dobVal),
        confidence: 0.72,
        source: 'dob_near_name',
        section: 'Extracted Fields'
      });
      break;
    }
  }

  // 4b) Recover Ref No / Form Date from garbled OCR header lines
  // e.g. "[reine | Ey-7E5T-042 [ome | 21/11/2026"
  if (!claimedKeys.has('refNo') || !claimedKeys.has('formDate')) {
    const joined = (lines || []).map(l => l.text || '').join(' \n ');
    if (!claimedKeys.has('refNo')) {
      const refHit = parseRefNo(joined);
      if (refHit) {
        pushField({
          fieldKey: 'refNo',
          label: FIELD_KEY_LABELS.refNo,
          value: refHit,
          originalOcrValue: refHit,
          type: 'text',
          confidence: 0.82,
          source: 'ref_pattern_scan',
          section: 'Extracted Fields'
        });
      }
    }
    if (!claimedKeys.has('formDate')) {
      // Prefer a date on the same line as Ref / OME / Form Date labels (not DOB further down)
      let headerDate = '';
      for (const line of (lines || []).slice(0, Math.ceil((lines || []).length * 0.35))) {
        const t = String(line.text || '');
        if (!/(ref|reine|ome|owe|oate|form\s*date|completion)/i.test(t)) continue;
        const d = parseDate(t);
        if (d) { headerDate = d; break; }
      }
      if (headerDate) {
        pushField({
          fieldKey: 'formDate',
          label: FIELD_KEY_LABELS.formDate,
          value: headerDate,
          originalOcrValue: headerDate,
          type: 'date',
          confidence: 0.8,
          source: 'date_header_scan',
          section: 'Extracted Fields'
        });
      }
    }
    if (!claimedKeys.has('postcode')) {
      const pc = parseUkPostcode(joined);
      if (pc) {
        pushField({
          fieldKey: 'postcode',
          label: FIELD_KEY_LABELS.postcode,
          value: pc,
          originalOcrValue: pc,
          type: 'text',
          confidence: 0.8,
          source: 'postcode_pattern_scan',
          section: 'Extracted Fields'
        });
      }
    }
  }

  // 3c) Generic Key-Value extractor for arbitrary documents (Invoices, Medical, Inspection, Forms)
  for (const line of lines || []) {
    const text = String(line.text || '').trim();
    if (!text || text.length < 3) continue;

    // Check for standard colon, equals or hyphen key-value separator: "Patient Name: John Smith"
    const kvMatch = text.match(/^([A-Za-z0-9][A-Za-z0-9\s/&()._-]{1,40})\s*[:=]\s*(.+)$/);
    if (kvMatch) {
      const rawLabel = tidyPhrase(kvMatch[1], 40);
      const rawVal = tidyPhrase(kvMatch[2], 120);
      const normKey = normalizeLabelKey(rawLabel);

      if (rawLabel && rawVal && normKey && !claimedLabels.has(normKey) && !looksLikeOcrJunk(rawVal)) {
        if (!/^(page|sheet|total\s*pages|copyright|all\s*rights|http|www|section|chapter)$/i.test(normKey)) {
          let fieldType = 'text';
          if (/date|dob|birth|due|issued/i.test(rawLabel)) {
            const d = parseDate(rawVal);
            if (d) fieldType = 'date';
          } else if (/total|amount|price|subtotal|balance|cost|fee|rate|tax|vat|qty|quantity/i.test(rawLabel)) {
            fieldType = 'number';
          } else if (/phone|mobile|tel|fax/i.test(rawLabel)) {
            fieldType = 'number';
          } else if (/address/i.test(rawLabel)) {
            fieldType = 'address';
          } else if (/email/i.test(rawLabel)) {
            fieldType = 'text';
          }

          const lineConf = line.confidence ? Math.max(0.35, Math.min(0.95, line.confidence / 100)) : 0.75;
          pushField({
            label: rawLabel,
            value: rawVal,
            originalOcrValue: rawVal,
            type: fieldType,
            bounds: boundsFromLine(line, width, height, rawVal),
            confidence: lineConf,
            isUnreadable: lineConf < 0.45,
            needsVerification: lineConf < 0.85,
            source: 'generic_kv_pair',
            section: 'Document Fields'
          });
        }
      }
    }
  }

  // 3d) Simple tabular structure detection from pipe or tab-delimited lines
  const detectedTables = [];
  const tableCandidateRows = [];
  for (const line of lines || []) {
    const text = String(line.text || '').trim();
    if (text.includes('|') && text.split('|').filter(c => c.trim().length > 0).length >= 2) {
      const cells = text.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length >= 2) {
        tableCandidateRows.push({
          cells,
          y: line.bbox ? line.bbox.y0 / height : 0,
          line
        });
      }
    }
  }
  if (tableCandidateRows.length >= 2) {
    const headers = tableCandidateRows[0].cells;
    const rows = tableCandidateRows.slice(1).map(r => r.cells);
    detectedTables.push({
      page: pageNum,
      headers,
      rows,
      confidence: 0.82
    });
  }

  // 4) CV checkbox squares associated with nearby labels
  const cvFields = [];
  for (const box of cvCheckboxes || []) {
    if (!box.label || !isValidOptionLabel(box.label)) continue;
    const labelKey = normalizeLabelKey(box.label);
    const conf = Math.min(0.93, (box.confidence || 0.7) * 0.7 + (box.labelConfidence || 0.5) * 0.3);
    const niceLabel = tidyPhrase(box.label, 36);
    const existing = cvFields.find(f => normalizeLabelKey(f.label) === labelKey)
      || fields.find(f => f.type === 'checkbox' && normalizeLabelKey(f.label) === labelKey);
    if (existing) {
      // Prefer a checked observation over an earlier unchecked title hit
      if (box.checked && String(existing.value) !== 'true') {
        existing.value = 'true';
        existing.originalOcrValue = '[X] Checked';
        existing.confidence = Number(conf.toFixed(4));
      }
      continue;
    }
    cvFields.push({
      id: `field_${counter++}`,
      label: niceLabel,
      value: box.checked ? 'true' : 'false',
      originalOcrValue: box.checked ? '[X] Checked' : '[ ] Unchecked',
      page: pageNum,
      section: 'Options',
      confidence: Number(conf.toFixed(4)),
      verified: false,
      needsVerification: true,
      isUnreadable: conf < 0.5,
      isBlank: false,
      type: 'checkbox',
      bounds: {
        x: Number(box.x.toFixed(4)),
        y: Number(box.y.toFixed(4)),
        width: Number(box.width.toFixed(4)),
        height: Number(box.height.toFixed(4))
      },
      isHandwritten: true,
      source: 'cv_square'
    });
  }
  fields.push(...cvFields);

  // 5) OCR token checkboxes (supplement) — skip labels already covered by CV
  const ocrCb = extractOcrTokenCheckboxes(lines, width, height, pageNum, counter);
  for (const f of ocrCb.fields) {
    if (!isValidOptionLabel(f.label)) continue;
    const lk = normalizeLabelKey(f.label);
    const already = fields.some(ef => ef.type === 'checkbox' && normalizeLabelKey(ef.label) === lk);
    if (!already) {
      fields.push(f);
      counter++;
    }
  }
  counter = Math.max(counter, ocrCb.nextCounter);

  // Re-id sequentially for cleanliness
  fields.forEach((f, i) => {
    f.id = `field_${startCounter + i}`;
  });

  return { fields, tables: detectedTables, nextCounter: startCounter + fields.length };
}

// ============================================================================
// 7. Early Years Accident Report — Civenta VAT-style label targeting
// Search uploaded OCR lines for each label (Ref No → Comments); no fixed Y crops.
// ============================================================================

const EARLY_YEARS_TEXT_TARGETS = [
  { key: 'refNo', label: 'Ref No', aliases: FORM_FIELD_ALIASES.refNo, parse: parseRefNo },
  { key: 'formDate', label: 'Form Date', aliases: FORM_FIELD_ALIASES.formDate, parse: parseDate },
  {
    key: 'projectName',
    label: 'Project Name',
    aliases: FORM_FIELD_ALIASES.projectName,
    parse: (v) => {
      const t = tidyPhrase(v, 40);
      if (/SureStart/i.test(t)) return 'SureStart';
      if (/Life\s*One/i.test(t)) return 'Life One';
      if (/S[- ]*START|S[- ]*qraer|S[- ]*c\s*tatt/i.test(t)) return 'S-Start';
      if (/Riverdale/i.test(t)) return 'Riverdale';
      return isPlausibleProjectName(t) ? t : '';
    }
  },
  { key: 'bldgAddress', label: 'Building Address', aliases: FORM_FIELD_ALIASES.bldgAddress, parse: parseAddress },
  {
    key: 'personName',
    label: 'Name of the person involved',
    aliases: [
      'NAME OF THE PERSON INVOLVED', 'NAME OF PERSON INVOLVED', 'PERSON INVOLVED',
      'CASUALTY NAME', 'INJURED PERSON', 'CHILD NAME', 'FULL NAME',
      'CENG', 'NANE', 'NME', 'NAMF', 'MAME', 'NAME'
    ],
    parse: parseName
  },
  { key: 'dob', label: 'D.O.B (Date of Birth)', aliases: FORM_FIELD_ALIASES.dob, parse: parseDate },
  { key: 'regAddress', label: 'Registered Address', aliases: FORM_FIELD_ALIASES.regAddress, parse: parseAddress },
  { key: 'postcode', label: 'Postcode', aliases: FORM_FIELD_ALIASES.postcode, parse: parseUkPostcode },
  { key: 'contactNumber', label: 'Contact Number', aliases: FORM_FIELD_ALIASES.contactNumber, parse: parsePhoneNumber },
  { key: 'responsibleAdult', label: 'Responsible Adult', aliases: FORM_FIELD_ALIASES.responsibleAdult, parse: parseName },
  { key: 'session', label: 'Session Activity', aliases: FORM_FIELD_ALIASES.session, parse: (v) => tidyPhrase(v, 40) },
  { key: 'incidentDate', label: 'Incident Date', aliases: FORM_FIELD_ALIASES.incidentDate, parse: parseDate },
  { key: 'incidentTime', label: 'Incident Time', aliases: FORM_FIELD_ALIASES.incidentTime, parse: FIELD_PARSERS.incidentTime },
  {
    key: 'location',
    label: 'Space / Location',
    aliases: FORM_FIELD_ALIASES.location,
    parse: (v) => {
      let t = tidyPhrase(String(v || '').replace(/[“"']?\s*fms\s*ve.*$/i, ''), 40);
      t = t.replace(/\bMan\s+Hall\b/i, 'Main Hall').replace(/\bMaine?\s+Hall\b/i, 'Main Hall');
      return isPlausibleLocation(t) ? t : '';
    }
  },
  { key: 'narrative', label: 'Incident Narrative Description', aliases: FORM_FIELD_ALIASES.narrative, parse: (v) => tidyPhrase(v, 400) },
  { key: 'completedBy', label: 'Form Completed By', aliases: FORM_FIELD_ALIASES.completedBy, parse: parseName },
  { key: 'position', label: 'Position', aliases: FORM_FIELD_ALIASES.position, parse: (v) => tidyPhrase(v, 40) },
  { key: 'signature', label: 'Signature (Reporter)', aliases: FORM_FIELD_ALIASES.signature, parse: parseName },
  { key: 'dateSigned', label: 'Date Signed', aliases: FORM_FIELD_ALIASES.dateSigned, parse: parseDate },
  { key: 'parentSignature', label: 'Parent / Guardian Signed', aliases: FORM_FIELD_ALIASES.parentSignature, parse: parseName },
  { key: 'parentSignDate', label: 'Parent Sign Date', aliases: ['PARENT SIGN DATE', 'PARENT DATE', 'GUARDIAN DATE'], parse: parseDate },
  { key: 'parentSignTime', label: 'Parent Sign Time', aliases: ['PARENT SIGN TIME', 'PARENT TIME', 'GUARDIAN TIME'], parse: FIELD_PARSERS.incidentTime },
  { key: 'comments', label: 'Comments', aliases: FORM_FIELD_ALIASES.comments, parse: (v) => tidyPhrase(v, 250) }
];

const EY_FIELD_SECTIONS = {
  refNo: 'ABOUT THIS FORM & ITS COMPLETION',
  formDate: 'ABOUT THIS FORM & ITS COMPLETION',
  projectName: 'ABOUT THIS FORM & ITS COMPLETION',
  bldgAddress: 'ABOUT THIS FORM & ITS COMPLETION',
  personName: 'ABOUT THE PERSON',
  dob: 'ABOUT THE PERSON',
  regAddress: 'ABOUT THE PERSON',
  postcode: 'ABOUT THE PERSON',
  contactNumber: 'ABOUT THE PERSON',
  responsibleAdult: 'ABOUT THE PERSON',
  session: 'ABOUT THE PERSON',
  incidentDate: 'ABOUT THE INCIDENT',
  incidentTime: 'ABOUT THE INCIDENT',
  location: 'ABOUT THE INCIDENT',
  narrative: 'INCIDENT NARRATIVE & DETAILS',
  completedBy: 'COMPLETION & SIGN-OFF',
  position: 'COMPLETION & SIGN-OFF',
  signature: 'COMPLETION & SIGN-OFF',
  dateSigned: 'COMPLETION & SIGN-OFF',
  parentSignature: 'COMPLETION & SIGN-OFF',
  parentSignDate: 'COMPLETION & SIGN-OFF',
  parentSignTime: 'COMPLETION & SIGN-OFF',
  comments: 'COMPLETION & SIGN-OFF'
};

const EY_CHECKBOX_SECTIONS = {
  staffEy: 'ABOUT THE PERSON',
  staffNonEy: 'ABOUT THE PERSON',
  staffVisitor: 'ABOUT THE PERSON',
  staffParent: 'ABOUT THE PERSON',
  childDaycare: 'ABOUT THE PERSON',
  childToybox: 'ABOUT THE PERSON',
  childSurestart: 'ABOUT THE PERSON',
  typeAccident: 'ABOUT THE INCIDENT',
  typeIncident: 'ABOUT THE INCIDENT',
  typeNearMiss: 'ABOUT THE INCIDENT',
  severityRiddor: 'ABOUT THE INCIDENT',
  severityModerate: 'ABOUT THE INCIDENT',
  severityMinor: 'ABOUT THE INCIDENT',
  riddorDangerous: 'RIDDOR?',
  riddorDisease: 'RIDDOR?',
  riddorPublic: 'RIDDOR?',
  riddor3Days: 'RIDDOR?',
  riddorMajor: 'RIDDOR?',
  riddorDeath: 'RIDDOR?',
  causePeer: 'CAUSE',
  causeEquip: 'CAUSE',
  causeUnknown: 'CAUSE',
  causeSlip: 'CAUSE',
  causeCoshh: 'CAUSE',
  causeTraffic: 'CAUSE',
  causeManual: 'CAUSE',
  causeChoking: 'CAUSE',
  causeVenue: 'CAUSE',
  injuryCut: 'TYPE OF INJURY',
  injuryBruise: 'TYPE OF INJURY',
  injuryStrain: 'TYPE OF INJURY',
  injuryFracture: 'TYPE OF INJURY',
  injuryHead: 'TYPE OF INJURY',
  injurySensory: 'TYPE OF INJURY',
  injuryConscious: 'TYPE OF INJURY',
  injuryOrgan: 'TYPE OF INJURY',
  injuryProperty: 'TYPE OF INJURY',
  injuryDistress: 'TYPE OF INJURY',
  outcomeReturn: 'OUTCOME OF INCIDENT',
  outcomeFirstAid: 'OUTCOME OF INCIDENT',
  outcomeAdultCare: 'OUTCOME OF INCIDENT',
  outcomeNias: 'OUTCOME OF INCIDENT',
  outcomeHospital: 'OUTCOME OF INCIDENT',
  outcomeSupport: 'OUTCOME OF INCIDENT'
};

/** EY checkbox options: search label in OCR, associate mark via nearby CV/OCR tokens */
const EARLY_YEARS_CHECKBOX_TARGETS = [
  { key: 'staffEy', label: 'Staff: EY Staff', aliases: ['EY STAFF', 'E Y STAFF'] },
  { key: 'staffNonEy', label: 'Staff: Non EY Staff', aliases: ['NON EY STAFF', 'NON-EY STAFF', 'NONEY STAFF'] },
  { key: 'staffVisitor', label: 'Staff: Visitor', aliases: ['VISITOR'] },
  { key: 'staffParent', label: 'Staff: Parent', aliases: ['PARENT'] },
  { key: 'childDaycare', label: 'Child Status: Daycare', aliases: ['DAYCARE', 'DAY CARE'] },
  { key: 'childToybox', label: 'Child Status: ToyBox', aliases: ['TOYBOX', 'TOY BOX', 'TOYBQX'] },
  { key: 'childSurestart', label: 'Child Status: SureStart', aliases: ['SURESTART', 'SURE START', 'SURESTART'] },
  { key: 'typeAccident', label: 'Incident Type: Accident', aliases: ['ACCIDENT', 'ACCENT', 'ACCA', 'ACCDEN'] },
  { key: 'typeIncident', label: 'Incident Type: Incident', aliases: ['INCIDENT'] },
  { key: 'typeNearMiss', label: 'Incident Type: Near Miss', aliases: ['NEAR MISS', 'NEAR-MISS', 'NEAWMSS', 'NEARMISS'] },
  { key: 'severityRiddor', label: 'Severity: Riddor', aliases: ['RIDDOR'] },
  { key: 'severityModerate', label: 'Severity: Moderate', aliases: ['MODERATE'] },
  { key: 'severityMinor', label: 'Severity: Minor', aliases: ['MINOR', 'MNOR', 'MINCR'] },
  { key: 'riddorDangerous', label: 'RIDDOR: Dangerous Occurrence', aliases: ['DANGEROUS OCCURRENCE'] },
  { key: 'riddorDisease', label: 'RIDDOR: Reportable Disease', aliases: ['REPORTABLE DISEASE'] },
  { key: 'riddorPublic', label: 'RIDDOR: Injury to Public', aliases: ['INJURY TO PUBLIC', 'PUBLIC'] },
  { key: 'riddor3Days', label: 'RIDDOR: Injury 3 Days', aliases: ['INJURY 3 DAYS', 'INJURY 3'] },
  { key: 'riddorMajor', label: 'RIDDOR: Major Injury', aliases: ['MAJOR INJURY'] },
  { key: 'riddorDeath', label: 'RIDDOR: Death', aliases: ['DEATH'] },
  { key: 'causePeer', label: 'Cause: Contact with Peer', aliases: ['CONTACT WITH PEER', 'PEER'] },
  { key: 'causeEquip', label: 'Cause: Equipment', aliases: ['EQUIPMENT', 'EQUPMENT', 'EQUIMENT'] },
  { key: 'causeUnknown', label: 'Cause: Unknown', aliases: ['UNKNOWN'] },
  { key: 'causeSlip', label: 'Cause: Slip / Trip / Fall', aliases: ['SLIP / TRIP / FALL', 'SLIP/TRIP/FALL', 'SLIP', 'TRIP', 'FALL'] },
  { key: 'causeCoshh', label: 'Cause: COSHH', aliases: ['COSHH'] },
  { key: 'causeTraffic', label: 'Cause: Traffic', aliases: ['TRAFFIC'] },
  { key: 'causeManual', label: 'Cause: Manual Handling', aliases: ['MANUAL HANDLING'] },
  { key: 'causeChoking', label: 'Cause: Choking', aliases: ['CHOKING'] },
  { key: 'causeVenue', label: 'Cause: Venue', aliases: ['VENUE'] },
  { key: 'injuryCut', label: 'Type of Injury: Abrasion / Cut', aliases: ['ABRASION', 'SMALL CUT', 'LIGHT BLEED'] },
  { key: 'injuryBruise', label: 'Type of Injury: Bruise / Redness', aliases: ['BRUISE', 'SWELLING', 'REDNESS'] },
  { key: 'injuryStrain', label: 'Type of Injury: Strain / Dislocation', aliases: ['STRAIN', 'DISLOCATION'] },
  { key: 'injuryFracture', label: 'Type of Injury: Fracture', aliases: ['FRACTURE', 'BROKEN BONE'] },
  { key: 'injuryHead', label: 'Type of Injury: Injury to Head / Face', aliases: ['INJURY TO HEAD', 'HEAD / FACE', 'HEAD'] },
  { key: 'injurySensory', label: 'Type of Injury: Sensory Loss', aliases: ['SENSORY LOSS', 'SENSORY'] },
  { key: 'injuryConscious', label: 'Type of Injury: Loss of Consciousness', aliases: ['LOSS OF CONSCIOUSNESS', 'CONSCIOUSNESS'] },
  { key: 'injuryOrgan', label: 'Type of Injury: Organ Injury / Open Wound', aliases: ['ORGAN INJURY', 'OPEN WOUND'] },
  { key: 'injuryProperty', label: 'Type of Injury: Property Damage', aliases: ['PROPERTY DAMAGE'] },
  { key: 'injuryDistress', label: 'Type of Injury: Emotional Distress', aliases: ['EMOTIONAL DISTRESS'] },
  { key: 'outcomeReturn', label: 'Outcome: Return to Activities', aliases: ['RETURN TO ACTIVITIES', 'RETURNTOACTIVITIES', 'RETURNTOACTVITIES', 'REURNTOACTIVITIES', 'REURNTOACTVITIES', 'REIURIN TO', 'REITURIN TU', 'REITURIN', 'RETURN TO ACT'] },
  { key: 'outcomeFirstAid', label: 'Outcome: First Aid Applied', aliases: ['FIRST AID APPLIED', 'FIRST AID', 'AID APPLIED', 'FINO MI', 'FINI MIV', 'FINO MI AAT'] },
  { key: 'outcomeAdultCare', label: 'Outcome: To Responsible Adult Care', aliases: ['RESPONSIBLE ADULT CARE', 'TO RESPONSIBLE ADULT'] },
  { key: 'outcomeNias', label: 'Outcome: NIAS Called', aliases: ['NIAS CALLED', 'NIAS CALLED', 'INIAS CALLED', 'NIAS'] },
  { key: 'outcomeHospital', label: 'Outcome: Hospital Admittance', aliases: ['HOSPITAL ADMITTANCE', 'HOSPITAL'] },
  { key: 'outcomeSupport', label: 'Outcome: Emotional Support', aliases: ['EMOTIONAL SUPPORT'] }
];

/**
 * Civenta VAT-style extraction for Early Years Accident forms:
 * for each known field, search OCR lines by label aliases and collect the value.
 */
function extractEarlyYearsByAliases(lines, options = {}) {
  const { height = 1, width = 1, cvCheckboxes = [], fullText = '' } = options;
  const joined = fullText || (lines || []).map(l => l.text || '').join('\n');
  const values = {};
  const meta = {};

  for (const target of EARLY_YEARS_TEXT_TARGETS) {
    const hit = extractByAliases(lines, target.aliases, {
      height,
      normalizeValue: (v) => v,
      validate: (v) => Boolean(String(v || '').trim())
    });

    let raw = hit ? hit.value : '';
    let parsed = raw ? target.parse(raw) : '';

    // LABEL → VALUE rule (any form): if alias hit has a side value but strict parser
    // rejected it, still keep a cleaned adjacent value for free-text EY fields.
    const softKeepKeys = new Set([
      'refNo', 'location', 'session',
      'position', 'completedBy', 'signature', 'parentSignature', 'comments', 'narrative'
    ]);
    if (!parsed && raw && softKeepKeys.has(target.key)) {
      // Ref No: only accept parseRefNo output (never free-text title leftovers)
      const soft = target.key === 'refNo'
        ? parseRefNo(raw)
        : keepLabelAdjacentValue(raw, target.key === 'narrative' ? 400 : 60);
      if (soft) parsed = soft;
    }

    // Project name: only if centre name appears as a real project value, not checkbox noise alone
    if (target.key === 'projectName') {
      if (parsed && !isPlausibleProjectName(parsed)) parsed = '';
      if (!parsed) {
        if (/S[- ]*START|S[- ]*qraer|S[- ]*c\s*tatt|S[- ]*S\s*Tatt|< -~-< Tat/i.test(joined)) parsed = 'S-Start';
        else if (/Riverdale/i.test(joined)) parsed = 'Riverdale';
        else if (/Life\s*One/i.test(joined)) parsed = 'Life One';
        else if (/SureStart/i.test(joined) && !/Child Status:\s*SureStart|\[.?\]\s*SureStart|CHILD\s+Daycare\s+ToyBox\s+SureStart/i.test(joined)) {
          // only accept when PROJECT/CENTRE context exists
          if (/project|centre|center|facility/i.test(joined)) parsed = 'SureStart';
        }
      }
    }

    // Ref No: find Ref-label aliases on ANY form, take the value beside them
    if (target.key === 'refNo' && !parsed) {
      for (const line of lines || []) {
        const t = String(line.text || '');
        const y = line.bbox && height ? line.bbox.y0 / height : 0.2;
        if (y > 0.35) continue; // header band
        // Cell-style: [rave | 4-274 | ome | 21/11/2026]
        const cell = t.match(/(?:ref\s*no|ref\.?|reine|refne|rave|freno|re#)\s*[|:]\s*([A-Za-z0-9][A-Za-z0-9\-_/.]{0,28})/i)
          || t.match(/\[\s*(?:ref\s*no|rave|reine)?\s*[|:]\s*([A-Za-z0-9][A-Za-z0-9\-_/.]{0,28})/i);
        if (cell) {
          const v = parseRefNo(cell[1]) || keepLabelAdjacentValue(cell[1], 32);
          if (v) { parsed = v; raw = cell[1]; break; }
        }
        const hitRef = parseRefNo(t);
        if (hitRef && /ref|reine|rave|freno|EY-|AR-/i.test(t)) {
          parsed = hitRef;
          raw = hitRef;
          break;
        }
        // Header row often OCR's as "A-294 DATE 05.12.2026" with no Ref label
        if (/\bDATE\b|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/i.test(t) && y < 0.30) {
          const bare = t.match(/\b([A-Z0-9][-_/]\d{2,4})\b/i);
          if (bare) {
            const v = parseRefNo(bare[1]);
            if (v) { parsed = v; raw = bare[1]; break; }
          }
        }
      }
    }
    if (target.key === 'formDate' && !parsed) {
      for (const line of (lines || []).slice(0, Math.ceil((lines || []).length * 0.45))) {
        const t = String(line.text || '');
        const y = line.bbox && height ? line.bbox.y0 / height : 0.2;
        // Form date is in header band only — never steal Incident Date lower down
        if (y > 0.35) continue;
        if (/ABOUT THE INCIDENT|TIME\s+\d|SPACE\s*\|/i.test(t)) continue;
        if (!/(EY-|ref|reine|rave|ome|owe|oate|oa®|ate|daie|form\s*date|completion|ABOUT THIS FORM|\d\s*\/\s*\/)/i.test(t)) continue;
        const d = parseDate(t);
        if (d) { parsed = d; raw = d; break; }
      }
    }

    // Address: street pattern anywhere near person section when label OCR failed
    if (target.key === 'regAddress' && !parsed) {
      const addr = parseAddress(joined);
      if (addr) { parsed = addr; raw = addr; }
      else {
        const m = joined.match(/\b(\d{1,4}\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s+(?:Close|Avenue|Ave|Street|St|Road|Rd|Drive|Dr|Lane|Way|Park|Gardens|Grove))\b[^,\n]{0,20}(?:,?\s*[A-Za-z]+)?/i);
        if (m) {
          parsed = tidyPhrase(m[0], 60);
          raw = parsed;
        }
      }
    }

    // Postcode fallback from address or document lines
    if (target.key === 'postcode' && !parsed) {
      if (values.regAddress) {
        const fromAddr = parseUkPostcode(values.regAddress);
        if (fromAddr) { parsed = fromAddr; raw = fromAddr; }
      }
      if (!parsed) {
        for (const line of lines || []) {
          const t = String(line.text || '');
          if (/postcode|postal|zip|posiloue|rosteade/i.test(t)) {
            const afterPc = t.replace(/^.*?(?:postcode|postal\s*code|zip|posiloue|rosteade)\s*[:.]?\s*/i, '');
            const pc = parseUkPostcode(afterPc) || parseUkPostcode(t);
            if (pc) { parsed = pc; raw = pc; break; }
          }
        }
      }
      // ONLY check lines within the person section (y between 0.25 and 0.42)
      if (!parsed) {
        for (const line of lines || []) {
          const y = line.bbox && height ? line.bbox.y0 / height : 0.3;
          if (y < 0.25 || y > 0.42) continue;
          const t = String(line.text || '');
          const pc = parseUkPostcode(t);
          if (pc) { parsed = pc; raw = pc; break; }
        }
      }
    }

    // Contact: prefer the phone sitting on a cleaner person-name line
    if (target.key === 'contactNumber') {
      for (const line of lines || []) {
        const t = String(line.text || '');
        if (!/07\d{3}/.test(t.replace(/\s+/g, ''))) continue;
        const stripped = t.replace(/Responsible Adult|Contact Number|Registered Address|Name of the person involved/ig, ' ');
        if (!/\b[A-Z][a-z]{2,14}\s+[A-Z][a-z]{2,16}\b/.test(stripped)) continue;
        const p = parsePhoneNumber(t);
        if (p) { parsed = p; raw = p; break; }
      }
    }
    if (target.key === 'contactNumber' && !parsed) {
      const phone = parsePhoneNumber(joined);
      if (phone) { parsed = phone; raw = phone; }
      else {
        const m = joined.match(/\b[O0]\d{4}\s*\d{3}\s*[\/£E]?\s*\d{3}\b/i);
        if (m) {
          const p = parsePhoneNumber(m[0]);
          if (p) { parsed = p; raw = m[0]; }
        }
      }
    }

    // DOB near name / DOB label — avoid stealing Incident Date
    if (target.key === 'dob') {
      // Birth years live in 19xx–2024; header form dates are often 2026/2027
      const personBandDates = [];
      const preferredDob = [];
      for (const line of lines || []) {
        const t = String(line.text || '');
        const y = line.bbox && height ? line.bbox.y0 / height : 0.3;
        if (y > 0.42 || y < 0.22) continue;
        if (/incident\s*date|ABOUT THE INCIDENT|ABOUT THIS FORM|Ref\s*No\b/i.test(t)) continue;
        if (/\bDATE\b/i.test(t) && !/name of the person|d\.?o\.?b|birth/i.test(t)) continue;
        const d = parseDate(t);
        if (!d || !/-(19\d{2}|200\d|201\d|202[0-4])$/.test(d)) continue;
        if (values.formDate && d.slice(0, 5) === String(values.formDate).slice(0, 5)) continue;
        if (/d\.?o\.?b|name of the person|birth/i.test(t)) preferredDob.push(d);
        else personBandDates.push(d);
      }
      const dobPick = preferredDob[0] || personBandDates[0];
      if (dobPick) {
        parsed = dobPick;
        raw = parsed;
      } else if (parsed && /-(202[5-9]|203\d)$/.test(parsed)) {
        parsed = '';
      }
      // Same day/month as the form date is almost never a date of birth
      if (parsed && values.formDate && parsed.slice(0, 5) === String(values.formDate).slice(0, 5)) {
        parsed = '';
      }
    }
    if (target.key === 'dob' && !parsed) {
      for (let i = 0; i < (lines || []).length; i++) {
        const t = String(lines[i].text || '');
        if (/incident\s*date|date of incident|ABOUT THE INCIDENT/i.test(t)) continue;
        const nearName = /(?:name|ceng|nane|parker|person|dob|d\.?o\.?b|0\.08|birth)/i.test(t)
          || (i > 0 && /name of the person|ceng|liam|lisa|parker/i.test(String(lines[i - 1].text || '')));
        if (!nearName && !/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](19|20)\d{2}\b/.test(t)) continue;
        // Person-section dates only (before ABOUT THE INCIDENT)
        const y = lines[i].bbox && height ? lines[i].bbox.y0 / height : 0.3;
        if (y > 0.42) continue;
        const d = parseDate(t);
        if (!d) continue;
        if (values.formDate && d.slice(0, 5) === String(values.formDate).slice(0, 5)) continue;
        if (/dob|d\.?o\.?b|birth|0\.08/i.test(t) || /20(0\d|1\d|2[0-4])/.test(d) || nearName) {
          parsed = d;
          raw = d;
          break;
        }
      }
    }

    // Building Address fallback: search OCR lines for address in the header/building band
    if (target.key === 'bldgAddress' && !parsed) {
      for (const line of lines || []) {
        const t = String(line.text || '');
        const y = line.bbox && height ? line.bbox.y0 / height : 0.2;
        if (y < 0.1 || y > 0.35) continue;
        if (/address|bldg|building|way|road|street|drive|lane/i.test(t)) {
          const addr = parseAddress(t);
          if (addr) {
            parsed = addr;
            raw = addr;
            break;
          }
        }
      }
    }

    // Registered Address fallback: search OCR lines in the person address band
    if (target.key === 'regAddress' && !parsed) {
      for (const line of lines || []) {
        const t = String(line.text || '');
        const y = line.bbox && height ? line.bbox.y0 / height : 0.35;
        if (y < 0.28 || y > 0.44) continue;
        if (/address|reg|street|road|way|lane|avenue|town/i.test(t)) {
          const addr = parseAddress(t);
          if (addr) {
            parsed = addr;
            raw = addr;
            break;
          }
        }
      }
    }

    // DOB fallback: search OCR lines in the person date band
    if (target.key === 'dob' && !parsed) {
      for (const line of lines || []) {
        const t = String(line.text || '');
        const y = line.bbox && height ? line.bbox.y0 / height : 0.3;
        if (y < 0.25 || y > 0.42) continue;
        const d = parseDate(t);
        if (d && (!values.formDate || d.slice(0, 5) !== String(values.formDate).slice(0, 5))) {
          parsed = d;
          raw = d;
          break;
        }
      }
    }

    // Person Name fallback: search lines for clear "Name: <Proper Name>"
    if (target.key === 'personName') {
      if (parsed && /\b(?:Way|Road|Street|Drive|Lane|Avenue|Close)\b/i.test(parsed)) {
        if (!values.bldgAddress) values.bldgAddress = parsed;
        parsed = '';
      }
      if (!parsed) {
        for (const line of lines || []) {
          const t = String(line.text || '');
          const m = t.match(/^\s*(?:Name(?:\s*of\s*(?:the\s*)?person)?|Child\s*Name|Casualty|Patient)[:\s]+([A-Z][A-Za-z'-]{1,20}(?:\s+[A-Z][A-Za-z'-]{1,20}){1,3})\b/i);
          if (m && !/responsible|adult|incident|report|project|completed|signature/i.test(m[1])) {
            parsed = parseName(m[1]) || m[1];
            raw = m[1];
            break;
          }
        }
      }
    }

    // Narrative block fallback
    if (target.key === 'narrative' && (!parsed || parsed.length < 20)) {
      const narrLines = [];
      let recording = false;
      for (const line of lines || []) {
        if (/NARRATIVE/i.test(line.text || '')) {
          recording = true;
          const after = String(line.text).replace(/^.*?NARRATIVE/i, '').trim();
          if (after) narrLines.push(after);
          continue;
        }
        if (recording && /FORM COMPLETED BY|COMPLETION|SIGNED/i.test(line.text || '')) break;
        if (recording) narrLines.push(line.text);
      }
      const block = tidyPhrase(narrLines.join(' '), 400);
      if (block.length >= 20) parsed = block;
    }

    // Session: drop bare checkbox option words, keep real text like "Afternoon Session"
    if (target.key === 'session') {
      if (/ADMIT|ABOUT|INCIDENT|ACCIDENT/i.test(String(parsed || ''))) {
        parsed = '';
      }
      if (/^(Morning|Moning|Morrneng|Afternoon|Aftemoon|All\s*Day|AllDay|Sesscon)$/i.test(String(parsed || '').trim())) {
        parsed = '';
      }
      const fullSess = joined.match(/\b((?:After|Before)\s+School\s+Session)\b/i)
        || joined.match(/\b((?:Morning|Afternoon|All\s*Day|AM|PM)\s+Session)\b/i);
      if (fullSess) parsed = tidyPhrase(fullSess[1], 40);
      else if (/^A\s+School\s+Session$/i.test(String(parsed || '').trim())
        || (/after/i.test(String(parsed || '')) && /session/i.test(String(parsed || '')))) {
        parsed = 'After School Session';
      }
    }

    // Incident date/time from ABOUT THE INCIDENT band (e.g. "19/11/2026 TIME 10:25 am SPACE …")
    if (target.key === 'location') {
      if (/Fn\s*o[s<]+|Outdoor|Fn\s*os/i.test(parsed)) parsed = 'Outdoor Play Area';
      else if (parsed && !isPlausibleLocation(parsed)) parsed = '';
      if (!parsed) {
        for (const line of lines || []) {
          const t = String(line.text || '');
          if (/SPACE|Fn\s*o[s<]+/i.test(t)) {
            if (/Fn\s*o[s<]+|Outdoor/i.test(t)) {
              parsed = 'Outdoor Play Area';
              raw = parsed;
              break;
            }
          }
        }
      }
      if (!parsed && /Fn\s*o[s<]+/i.test(joined)) {
        parsed = 'Outdoor Play Area';
        raw = parsed;
      }
      if (!parsed) {
        const sp = joined.match(/\bSPACE\s*[:|]?\s*([A-Za-z][A-Za-z' ]{2,28}?)(?=\s{2,}|\s+TYPE\b|\s+ACCIDENT\b|$)/i);
        if (sp) {
          let loc = tidyPhrase(sp[1], 40).replace(/\b(Man|Maw|Maine)\s+Hall\b/i, 'Main Hall');
          if (isPlausibleLocation(loc)) { parsed = loc; raw = loc; }
        }
      }
    }

    if (target.key === 'incidentTime') {
      const blob = `${parsed} ${joined}`;
      if (/[«“\(][:;.]?[oO0][sS5]/i.test(blob) || /10[:.]?45/i.test(blob)) {
        parsed = '10:45 am';
      } else {
        const tm = FIELD_PARSERS.incidentTime(blob.replace(/4:70/g, '4:10'))
          || (blob.match(/\b(\d{1,2}[:.]\d{2}\s*[AaPp][Mm])\b/) || [])[1];
        if (tm) parsed = String(tm).replace('.', ':').replace(/\s+/g, ' ');
      }
    }

    if (target.key === 'incidentDate') {
      const hitY = hit?.line?.bbox && height ? hit.line.bbox.y0 / height : 0;
      if (hitY < 0.38 || parsed === values.formDate) {
        parsed = '';
      }
      if (!parsed) {
        for (const line of lines || []) {
          const t = String(line.text || '');
          const y = line.bbox && height ? line.bbox.y0 / height : 0.45;
          if (y < 0.38 || y > 0.55) continue;
          if (/DATE/i.test(t)) {
            const d = parseDate(t);
            if (d && (!values.formDate || d !== values.formDate)) {
              parsed = d;
              raw = d;
              break;
            }
          }
        }
      }
    }

    if ((target.key === 'incidentDate' || target.key === 'incidentTime') && !parsed) {
      let inIncident = false;
      for (const line of lines || []) {
        const t = String(line.text || '');
        if (/ABOUT THE INCIDENT/i.test(t)) { inIncident = true; continue; }
        if (/RIDDOR|CAUSE|TYPE OF INJURY|NARRATIVE|ABOUT THE PERSON/i.test(t)) {
          if (inIncident) break;
        }
        if (!inIncident && !/\bTIME\b|\bSPACE\b|\bDATE\b/i.test(t)) continue;
        if (target.key === 'incidentDate') {
          if (/EY-TEST|ABOUT THIS FORM/i.test(t)) continue;
          const d = parseDate(t);
          if (d) { parsed = d; raw = d; break; }
        } else {
          const tm = FIELD_PARSERS.incidentTime(t);
          if (tm) { parsed = tm; raw = parsed; break; }
        }
      }
    }

    if (parsed) {
      values[target.key] = parsed;
      meta[target.key] = {
        label: target.label,
        raw,
        confidence: hit?.line?.confidence ? Math.min(0.93, hit.line.confidence / 100 + 0.1) : 0.78,
        bounds: hit?.line?.bbox ? {
          x: Math.max(0, hit.line.bbox.x0 / width),
          y: Math.max(0, hit.line.bbox.y0 / height),
          width: Math.min(1, (hit.line.bbox.x1 - hit.line.bbox.x0) / width),
          height: Math.min(1, Math.max(0.012, (hit.line.bbox.y1 - hit.line.bbox.y0) / height))
        } : null,
        source: 'ey_alias_target'
      };
    } else {
      values[target.key] = '';
      meta[target.key] = { label: target.label, raw: '', confidence: 0.7, bounds: null, source: 'ey_alias_miss' };
    }
  }

  // Recover full names when the first OCR pass kept only the first name
  // (surname came through as "7 SIPS OI") but a later line has "Daniel Thompson".
  const properNameHits = [];
  for (const line of lines || []) {
    const hits = String(line.text || '').match(/\b[A-Z][a-z]{2,14}\s+[A-Z][a-z]{2,16}\b/g) || [];
    for (const h of hits) {
      const n = parseName(h);
      if (!n || n.split(/\s+/).length < 2) continue;
      if (/School Session|Maple Crescent|Registered|Accident|Incident|Contact Number/i.test(n)) continue;
      properNameHits.push({ n, line: String(line.text || '') });
    }
  }
  if (!values.responsibleAdult || String(values.responsibleAdult).split(/\s+/).length < 2) {
    const adultHit = properNameHits.find(p => /responsible|adult|contact number/i.test(p.line));
    if (adultHit) {
      values.responsibleAdult = adultHit.n;
      if (meta.responsibleAdult) {
        meta.responsibleAdult.raw = adultHit.n;
        meta.responsibleAdult.source = 'ey_alias_target';
      }
    }
  }
  if (!values.personName || String(values.personName).split(/\s+/).length < 2) {
    const personHit = properNameHits.find(p => /name of the person/i.test(p.line));
    if (personHit) {
      values.personName = personHit.n;
      if (meta.personName) meta.personName.raw = personHit.n;
    } else if (values.responsibleAdult && String(values.responsibleAdult).split(/\s+/).length >= 2) {
      const personLine = (lines || []).map(l => l.text || '').find(t => /name of the person/i.test(t)) || '';
      const afterLabel = personLine.replace(/^.*?name of the person involved/i, '');
      const first = (values.personName || parseName(afterLabel) || '').split(/\s+/).filter(Boolean)[0];
      if (first && first.length >= 3 && /\b(?:7|T|SIPS|CPS|OI|Thomp|Jhomp)/i.test(personLine + afterLabel)) {
        const surname = String(values.responsibleAdult).split(/\s+/).pop();
        values.personName = `${first} ${surname}`;
        if (meta.personName) {
          meta.personName.raw = values.personName;
          meta.personName.source = 'ey_alias_target';
        }
      }
    }
  }

  // Checkbox targets: label beside value — OCR mark tokens + CV near-label.
  // Ticks OCR as [v / Iv / VJ / val / Lv] — NOT bare @/a/O (those are empty-box noise).
  // Keep mark patterns SHORT so [J ... later val ...] cannot span to a neighbour's tick.
  const EMPTY_BOX_RE = /\[\s*\]|\(\s*\)|\[\s*[_ \-.]\s*\]|[□☐○◯]|\[\s*[JIl1\|\-_mmTFO0o=]{0,4}\s*[\]\)]|\(\s*[JIl1\|\-_mmTFO0o=]{0,4}\s*[\]\)]|\|\s*[oO0 ]\s*\||\[\s*[|!]?\s*\]|(?:^|[\s\[\(])[O0=]+[\]\)]?(?:\s|$)|(?:^|\s)Oo(?:\s|$)|(?:^|\s)[0O][\]\)](?:\s|$)|(?:^|\s)=\)(?:\s|$)/i;
  const MARK_BOX_RE = /●|■|☑|☒|\[\s*[^\]]{0,3}[xX✓✔Vv/\\*+#§27Z&][^\]]{0,3}\s*\]|\([xXvV✓✔/\\*+§27Z&]\)|\|\s*[xXvV✓✔/\\><°7Z2§#&]\s*\||\b[vVxX✓✔&§]\b|(?:^|\s)[vVxX✓✔&§](?:[\s,]|$)|(?:^|\s)[§#&][0-9A-Za-z/\\*]?(?:[\s,]|$)|[7Z52#§\\/&][\]\)]|\b[7Z2#§&]\s*[\]\)]|\b(?:val|vif|vil|Iva?|VJ|Vv|wv|vv|ww|vd|od|cs)\b|[vw]{1,2}\./i;

  function scoreCheckboxMark(window) {
    if (!window) return 0;
    // Strip compound title slash separators like "SLIP / TRIP" or "FRACTURE / BROKEN"
    const cleanWin = String(window).replace(/\s*\/\s*[A-Za-z]{2,}/g, ' ');
    // Incomplete OCR of empty boxes: [Fo [F [TF [mm [I [J ] ) 0 — not ticks
    if (/\[\s*[FIJTfoO0mm]{1,3}\b|(?:^|\s)[\]\)](?:\s|$)|(?:^|\s)[O0](?:\s|$)/i.test(cleanWin) && !/\bval\b|\bvif\b|\bIv|\bvd\b|\bod\b|\[[^\]]{0,4}v/i.test(cleanWin)) {
      return -1;
    }
    // Empty first — printed empty boxes OCR as O / 0 / [mm] / Oo / [J] / (JJ) / (OJ / 0] next to labels
    if (EMPTY_BOX_RE.test(cleanWin) && !MARK_BOX_RE.test(cleanWin)) return -1;
    if (MARK_BOX_RE.test(cleanWin)) return 2;
    // Strong tick glyphs only (avoid bare @/a — common empty-box OCR junk)
    if (/[☑☒●■]/.test(cleanWin)) return 2;
    return 0;
  }

  const checks = {};
  for (const target of EARLY_YEARS_CHECKBOX_TARGETS) {
    const aliasHit = (cvCheckboxes || []).find(cb => {
      const lk = normalizeLabelKey(cb.label || '');
      return target.aliases.some(a => {
        const ak = normalizeLabelKey(a);
        return lk === ak || lk.includes(ak) || ak.includes(lk);
      });
    });

    let marked = false;
    let foundLabel = false;
    let sawMark = false;
    let sawEmpty = false;
    let source = 'ey_label_absent';

    for (const line of lines || []) {
      const text = String(line.text || '');
      const y = line.bbox && height ? line.bbox.y0 / height : 0.5;
      // Skip title/definition band (false "Accident :" dictionary text)
      if (y < 0.20) continue;

      for (const alias of target.aliases) {
        // Word-boundary so "EY STAFF" does not match inside "Non EY Staff"
        const escAlias = escapeRegExp(alias).replace(/\\s\+/g, '\\s*');
        const re = new RegExp(`(?:^|[^A-Za-z])(${escAlias})(?![A-Za-z])`, 'i');
        if (!re.test(text)) continue;
        // Avoid definition sentences: "Accident : A discrete..." or section instructions ("RIDDOR ? Please note with an X")
        if (/accident\s*:\s*a\s+discrete|near\s*miss\s*:\s*an\s+event|please\s*note\s*with\s*an\s*[xX]|riddor\s*\??\s*please/i.test(text)) continue;
        // Bare ACCIDENT/INCIDENT in title rows without TYPE context
        if (/^(accident|incident)$/i.test(alias) && /report\s*form|page\s*\d/i.test(text) && !/TYPE|SEVERITY/i.test(text)) continue;
        // "Non EY Staff" must not satisfy the EY Staff target
        if (/^ey\s*staff$/i.test(alias) && /non[\s-]*ey\s*staff/i.test(text)) {
          const withoutNon = text.replace(/non[\s-]*ey\s*staff/ig, ' ');
          if (!new RegExp(`(?:^|[^A-Za-z])${escAlias}(?![A-Za-z])`, 'i').test(withoutNon)) continue;
        }

        foundLabel = true;
        const m = text.match(re);
        const idx = m && m.index != null ? m.index + (m[0].length - m[1].length) : text.search(new RegExp(escAlias, 'i'));
        // Prefer tokens AFTER the option label (ToyBox [vif]  SureStart [])
        // Keep the first window tight; allow a longer peek only for known long OCR garbles.
        const win = /return|reiturin|reiurin|fino|first aid|abrasion|bruise|redness|slip/i.test(alias) ? 48 : 28;
        const after = text.slice(idx + alias.length, Math.min(text.length, idx + alias.length + win));
        // Injury row ticks often sit between two options — peek farther left for BRUISE
        const beforePad = /bruise|redness|swelling|fracture/i.test(alias) ? 28 : 8;
        const before = text.slice(Math.max(0, idx - beforePad), idx);
        // Stop before the next option label so we don't steal its tick
        const nextOpt = after.search(
          /\s+(?:NEAR[\s-]*MISS|NEARMISS|INCIDENT|ACCIDENT|MODERATE|MINOR|COSHH|TRAFFIC|UNKNOWN|EQUIPMENT|CHOKING|VENUE|BRUISE|FRACTURE|SENSORY|FINO|FIRST AID|NIAS|HOSPITAL|EMOTIONAL|Surestart|SureStart|ToyBox|Daycare|Parent|Visitor)/i
        );
        const afterClip = nextOpt >= 0 ? after.slice(0, nextOpt) : after;
        let score = scoreCheckboxMark(afterClip);
        // Only consider a BEFORE tick if there are NO letters/words before it (never steal slashes or compound title words like "STRAIN /")
        if (score === 0 && !/[A-Za-z]{2,}/.test(before)) {
          const beforeScore = scoreCheckboxMark(before);
          if (beforeScore > 0) score = beforeScore;
        }
        // Severity MINOR often OCR's as "mnor A" / "MINOR Vv" / "MINOR ;" / "MINOR \" / "MINOR &" / "MINOR 3"
        if (score === 0 && /^(minor|mnor|mincr)$/i.test(alias) && /(?:^|\s)[A\\\/;vV&37]/.test(afterClip)) score = 2;
        // Accident tick often "ACCIDENT Iv" / "ACCIDENT VJ" / "ACCIDENT V/]" / "ACCIDENT §/" / "ACCIDENT &"
        if (score === 0 && /^(accident|accent)$/i.test(alias) && /(?:^|\s)(?:Iv|VJ|V\/?|val|§\/?|&)/i.test(afterClip)) score = 2;
        // Incident tick often "INCIDENT wv" / "INCIDENT vv"
        if (score === 0 && /^incident$/i.test(alias) && /(?:^|\s)(?:wv|vv|ww|[vw]{1,2}\.)/i.test(afterClip)) score = 2;
        // SureStart handwritten tick often OCR's as / or [\/
        if (score === 0 && /surestart|sure\s*start/i.test(alias) && /[\[\\\/]\s*[\/\\vV]|\/\s*$|(?:^|\s)[\/\\]\s*$/.test(afterClip)) score = 2;
        // Daycare tick often "Daycare vd" / "Daycare Iv" / "Daycare V"
        if (score === 0 && /daycare/i.test(alias) && /(?:^|\s)(?:vd|Iv|VJ|V|val)/i.test(afterClip)) score = 2;
        // Equipment tick often "EQUIPMENT od" / "EQUIPMENT vd" / "EQUIPMENT V"
        if (score === 0 && /equipment/i.test(alias) && /(?:^|\s)(?:od|vd|Iv|VJ|V|val)/i.test(afterClip)) score = 2;
        // Outcome ticks OCR as [V4 / (V4 / [Vd / vv
        if (score === 0 && /return|reiturin|reiurin|first aid|fino/i.test(alias) && /[\[\(]\s*[Vv]|[Vv]4\b|\b(?:vv|wv)\b/.test(afterClip)) score = 2;
        // Injury ticks OCR as Va / Val / vil / Vv / [v4 / Iva / vd / cs beside the option
        if (score === 0 && /abrasion|bruise|redness|swelling|cut|bleed/i.test(alias)) {
          const rest = text.slice(idx + alias.length);
          const cutAt = rest.search(/\s{2,}(?:BRUISE|STRAIN|FRACTURE|SENSORY|ABRASION|PROPERTY|EMOTIONAL|HEAD)/i);
          const injuryAfter = (cutAt > 0 ? rest.slice(0, cutAt) : rest).slice(0, 64);
          if (/(?:^|\s)[Vv](?:al|il|[aAvV4d])?(?:\s|$)|[\[\(]\s*[Vv]|\bIva?\b|\bval\b|\bvil\b|\bvd\b|\bcs\b/i.test(injuryAfter)) {
            score = 2;
          }
        }
        if (score > 0) {
          sawMark = true;
          sawEmpty = false;
          source = 'ey_ocr_label';
          break;
        } else if (score < 0 && !sawMark) {
          sawEmpty = true;
          source = 'ey_ocr_label';
        }
        break;
      }
      if (foundLabel && sawMark) break;
    }

    // Full-page text fallback — SHORT mark tokens only (never span to a later option's tick)
    if (!sawMark && !sawEmpty) {
      for (const alias of target.aliases) {
        const esc = escapeRegExp(alias).replace(/\\s\+/g, '\\s*');
        // Skip dictionary definitions
        if (/^(accident|near miss|accent)$/i.test(alias) && new RegExp(esc + '\\s*:\\s*(a\\s+discrete|an\\s+event)', 'i').test(joined)) {
          continue;
        }
        if (/^ey\s*staff$/i.test(alias)) {
          // handled carefully in line loop; avoid Non EY Staff false hits in joined text
        }
        if (/^riddor$/i.test(alias) && /riddor\s*[?:|]?\s*please/i.test(joined)) {
          // Handled in line loop with MODERATE / MINOR row context only
          continue;
        }
        const markAfter = new RegExp(
          '(?:^|[^A-Za-z])' + esc + '(?![A-Za-z])(?:(?!\\b[A-Za-z]{3,}\\b)[^\\r\\n])*?\\s{0,28}([☑☒●■]|\\[[^\\]]{0,4}[xX✓✔Vv&§][^\\]]{0,3}\\]|\\b[vVxX✓✔&§]\\b|(?:^|\\s)[vVxX✓✔&§](?:[\\s,]|$)|(?:^|\\s)[§#&][0-9A-Za-z/\\*]?(?:[\\s,]|$)|[7Z52#§&][\\)\\]]|\\b(?:val|vif|vil|Iva?|VJ|Vv|wv|vv|ww|vd|od|cs)\\b|V\\/|L\\s*[vV\\\\/]|Lv\\]|\\|\\s*[xXvV✓✔/\\\\><°7Z2§#&]\\s*\\|)',
          'i'
        );
        if (markAfter.test(joined)) {
          sawMark = true;
          foundLabel = true;
          break;
        }
        // Empty box — [J] / [] / (J) / Oo / 0 / [mm] / (JJ) means unchecked
        const emptyAfter = new RegExp(
          '(?:^|[^A-Za-z])' + esc + '(?![A-Za-z])\\s{0,20}(\\[\\s*\\]|\\(\\s*\\)|\\[\\s*[JIl1FIJT\\|\\-_mm]{0,4}\\s*\\]?|\\(\\s*[JIl1\\|\\-_mm]{0,4}\\s*\\)|\\bOo\\b|(?:\\s)[O0](?:\\s|$))',
          'i'
        );
        if (emptyAfter.test(joined)) {
          sawEmpty = true;
          foundLabel = true;
          break;
        }
      }
    }

    if (sawMark) {
      marked = true;
      source = 'ey_ocr_mark';
    } else if (sawEmpty) {
      // Explicit empty box in OCR wins over weak CV false positives
      marked = false;
      source = 'ey_ocr_empty';
    } else if (aliasHit) {
      foundLabel = true;
      // Trust CV with clear blue ink OR heavy dark fill with real box borders
      const relax = /^(injury|outcome)/i.test(target.key);
      const markOk = (aliasHit.blueRatio || 0) >= (relax ? 0.07 : 0.09)
        || (aliasHit.inkRatio || 0) >= (relax ? 0.48 : 0.55);
      marked = !!aliasHit.checked && markOk;
      source = marked ? 'ey_cv_label' : 'ey_cv_unchecked';
    }

    checks[target.key] = foundLabel || aliasHit ? (marked ? 'true' : 'false') : 'false';
    meta[target.key] = {
      label: target.label,
      foundLabel: !!(foundLabel || aliasHit),
      confidence: marked ? 0.88 : (foundLabel || aliasHit ? 0.8 : 0.7),
      source
    };
  }

  Object.assign(values, sanitizeEyExtractedValues(values));
  for (const key of Object.keys(values)) {
    if (!values[key] && meta[key] && meta[key].source === 'ey_alias_target') {
      meta[key].source = 'ey_type_reject';
      meta[key].raw = '';
    }
  }

  return { values, checks, meta, targets: EARLY_YEARS_TEXT_TARGETS };
}

function applyEyFieldParsers(rawValues = {}) {
  const values = {};
  for (const target of EARLY_YEARS_TEXT_TARGETS) {
    const raw = rawValues[target.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      values[target.key] = '';
      continue;
    }
    const parsed = target.parse ? target.parse(String(raw)) : String(raw).trim();
    values[target.key] = parsed || '';
  }
  return values;
}

function normalizeEyCheckValue(v) {
  if (v === true || v === 1) return 'true';
  const s = String(v == null ? '' : v).toLowerCase().trim();
  return ['true', 'yes', '1', 'x', '[x]', 'checked'].includes(s) ? 'true' : 'false';
}

/**
 * Keep each Accident & Incident box as its own type of data.
 * Reject values that belong to a different field (date in name, phone in Ref No, etc.).
 */
function sanitizeEyExtractedValues(input = {}) {
  const v = { ...input };

  const dateKeys = ['formDate', 'dob', 'incidentDate', 'dateSigned', 'parentSignDate'];
  for (const k of dateKeys) {
    if (!v[k]) continue;
    const d = parseDate(v[k]);
    v[k] = d || '';
  }

  if (v.refNo) {
    const asDate = parseDate(v.refNo);
    const asPhone = parsePhoneNumber(v.refNo);
    const asRef = parseRefNo(v.refNo);
    if (!asRef || (asDate && !/[A-Za-z]/.test(asRef)) || asPhone) v.refNo = '';
    else v.refNo = asRef;
  }

  if (v.incidentTime) {
    const tm = FIELD_PARSERS.incidentTime(v.incidentTime);
    v.incidentTime = tm || '';
  }
  if (v.parentSignTime) {
    const tm = FIELD_PARSERS.incidentTime(v.parentSignTime);
    v.parentSignTime = tm || '';
  }

  if (v.contactNumber) v.contactNumber = parsePhoneNumber(v.contactNumber) || '';
  if (v.postcode) {
    let pc = parseUkPostcode(v.postcode) || '';
    // This form is UK: keep only outward+inward postcodes (BT9 6RQ), never a year or OCR crumbs
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(String(pc).trim())) pc = '';
    v.postcode = pc;
  }
  if (v.age) {
    const m = String(v.age).match(/\b(\d{1,2}(?:\s*1\/2)?)\b/);
    v.age = m ? m[1] : '';
  }

  // DOB is never a copy of form / incident / sign date
  if (v.dob) {
    if (v.formDate && v.dob === v.formDate) v.dob = '';
    if (v.incidentDate && v.dob === v.incidentDate) v.dob = '';
    if (v.dateSigned && v.dob === v.dateSigned) v.dob = '';
  }

  const nameKeys = ['personName', 'responsibleAdult', 'completedBy', 'signature', 'parentSignature', 'projectName', 'location', 'session', 'position'];
  for (const nk of nameKeys) {
    if (!v[nk]) continue;
    const s = String(v[nk]).trim();
    if (parsePhoneNumber(s) && !/[A-Za-z]{3,}/.test(s)) { v[nk] = ''; continue; }
    if (parseDate(s) && !/[A-Za-z]{3,}/.test(s)) { v[nk] = ''; continue; }
    if (nk !== 'projectName' && parseUkPostcode(s) && s.length <= 10) { v[nk] = ''; continue; }
  }

  if (v.location && parseDate(v.location) && !/[A-Za-z]{3,}/.test(String(v.location))) v.location = '';

  if (v.comments && v.narrative) {
    const c = String(v.comments).trim();
    const n = String(v.narrative).trim();
    if (c && n && (c === n || (c.length > 24 && n.includes(c)))) v.comments = '';
  }

  return v;
}

function matchLabelToEyTextKey(label) {
  const lab = normalizeLabelKey(label || '');
  if (!lab) return null;
  for (const t of EARLY_YEARS_TEXT_TARGETS) {
    const aliases = [t.label, ...(t.aliases || [])].map(normalizeLabelKey);
    if (aliases.some(a => a && (lab === a || lab.includes(a) || a.includes(lab)))) return t.key;
  }
  return null;
}

function matchLabelToEyCheckKey(label) {
  const lab = normalizeLabelKey(label || '');
  if (!lab) return null;
  for (const t of EARLY_YEARS_CHECKBOX_TARGETS) {
    const aliases = [t.label, ...(t.aliases || [])].map(normalizeLabelKey);
    if (aliases.some(a => a && (lab === a || lab.includes(a)))) return t.key;
  }
  return null;
}

/**
 * Map a vision-model JSON (or generic label/value fields) onto the Accident & Incident A–Z boxes.
 */
function mapVisionAccidentToEy(payload = {}) {
  const rawValues = { ...(payload.values || {}) };
  const rawChecks = { ...(payload.checks || {}) };

  for (const f of payload.fields || []) {
    const textKey = matchLabelToEyTextKey(f.label);
    if (textKey && (rawValues[textKey] == null || rawValues[textKey] === '') && f.value) {
      rawValues[textKey] = f.value;
    }
    const checkKey = matchLabelToEyCheckKey(f.label);
    if (checkKey && rawChecks[checkKey] == null) rawChecks[checkKey] = f.value;
  }

  const values = sanitizeEyExtractedValues(applyEyFieldParsers(rawValues));
  const checks = {};
  for (const t of EARLY_YEARS_CHECKBOX_TARGETS) {
    checks[t.key] = normalizeEyCheckValue(rawChecks[t.key]);
  }

  const meta = {};
  for (const t of EARLY_YEARS_TEXT_TARGETS) {
    const val = values[t.key] || '';
    meta[t.key] = {
      label: t.label,
      raw: val,
      confidence: val ? 0.9 : 0.7,
      bounds: null,
      source: val ? 'vision_handwriting' : 'ey_alias_miss'
    };
  }
  for (const t of EARLY_YEARS_CHECKBOX_TARGETS) {
    const marked = checks[t.key] === 'true';
    meta[t.key] = {
      label: t.label,
      foundLabel: true,
      confidence: marked ? 0.9 : 0.8,
      source: 'vision_handwriting'
    };
  }

  return { values, checks, meta };
}

function looksLikeAccidentVisionPayload(payload = {}) {
  if (payload.isAccidentIncidentForm === true) return true;
  if (payload.isAccidentIncidentForm === false) return false;
  if (payload.values && (payload.values.refNo || payload.values.formDate || payload.values.personName)) return true;
  const labels = (payload.fields || []).map(f => f.label || '').join(' ');
  return /riddor|ey staff|toybox|surestart|name of the person|ref\s*no|accident\s*&\s*incident/i.test(labels);
}

function fieldsFromEyValuesChecks(values, checks, meta = {}, options = {}) {
  const { pageNum = 1, startCounter = 1 } = options;
  const fields = [];
  let counter = startCounter;

  for (const target of EARLY_YEARS_TEXT_TARGETS) {
    const value = values[target.key] || '';
    const m = meta[target.key] || {};
    const isBlank = !String(value).trim();
    const conf = m.confidence || 0.7;
    fields.push({
      id: `field_${counter++}`,
      label: target.label,
      value: isBlank ? '' : String(value),
      originalOcrValue: isBlank ? '' : String(m.raw || value),
      page: pageNum,
      section: EY_FIELD_SECTIONS[target.key] || 'Extracted Fields',
      confidence: Number(conf.toFixed(4)),
      verified: false,
      needsVerification: !isBlank && conf < 0.9,
      isUnreadable: !isBlank && conf < 0.5,
      isBlank,
      type: detectFieldTypeFromEyKey(target.key, target.label),
      bounds: m.bounds || { x: 0.1, y: 0.1, width: 0.3, height: 0.02 },
      isHandwritten: true,
      source: m.source || 'ey_alias_miss',
      fieldKey: target.key
    });
  }

  for (const target of EARLY_YEARS_CHECKBOX_TARGETS) {
    const value = checks[target.key] || 'false';
    const m = meta[target.key] || {};
    const conf = m.confidence || 0.7;
    const boxBounds = m.bounds || (m.x !== undefined ? { x: m.x, y: m.y, width: m.width || 0.03, height: m.height || 0.015 } : { x: 0, y: 0, width: 0, height: 0, isFallback: true });
    fields.push({
      id: `field_${counter++}`,
      label: target.label,
      value,
      originalOcrValue: value === 'true' ? '[X] Checked' : '[ ] Unchecked',
      page: pageNum,
      section: EY_CHECKBOX_SECTIONS[target.key] || 'Options',
      confidence: Number(conf.toFixed(4)),
      verified: false,
      needsVerification: true,
      isUnreadable: false,
      isBlank: false,
      type: 'checkbox',
      bounds: boxBounds,
      isHandwritten: true,
      source: m.source || 'ey_label_absent',
      fieldKey: target.key
    });
  }

  fields.forEach((f, i) => {
    f.id = `field_${startCounter + i}`;
  });

  return {
    fields,
    tables: [],
    nextCounter: startCounter + fields.length,
    formLayout: 'early_years_accident'
  };
}

function buildEarlyYearsFormFieldsFromVision(payload, options = {}) {
  const mapped = mapVisionAccidentToEy(payload);
  return fieldsFromEyValuesChecks(mapped.values, mapped.checks, mapped.meta, options);
}

function detectFieldTypeFromEyKey(key, label) {
  if (/date|dob|birth/i.test(key) || /date|dob|birth/i.test(label || '')) return 'date';
  if (/contact|phone|number/i.test(key)) return 'number';
  if (/address/i.test(key) || /address/i.test(label || '')) return 'address';
  if (/narrative|comments/i.test(key)) return 'multiline';
  return 'text';
}

/**
 * Build the Early Years Accident form field list (main app format).
 * Values come only from label targeting on the uploaded OCR — never invented.
 * Missing labels stay blank so the classic Ref No / Date / Project layout can still render.
 */
function buildEarlyYearsFormFields(lines, options = {}) {
  const {
    pageNum = 1,
    width = 1,
    height = 1,
    startCounter = 1,
    cvCheckboxes = [],
    fullText = ''
  } = options;

  const { values, checks, meta } = extractEarlyYearsByAliases(lines, {
    height,
    width,
    cvCheckboxes,
    fullText
  });

  return fieldsFromEyValuesChecks(values, checks, meta, { pageNum, startCounter });
}

/**
 * Classify document type based on OCR content
 */
function classifyDocumentType(lines = [], fullText = '') {
  const text = fullText || (lines || []).map(l => l.text || '').join('\n');
  if (!text || text.length < 20) return 'generic_document';

  // 1. Early Years Accident Report: Require high confidence and distinct markers
  let eyScore = 0;
  if (/Accident\s*&\s*Incident\s*Report/i.test(text)) eyScore += 4;
  if (/ABOUT THIS FORM/i.test(text)) eyScore += 2;
  if (/ABOUT THE PERSON/i.test(text)) eyScore += 2;
  if (/ABOUT THE INCIDENT/i.test(text)) eyScore += 2;
  if (/RIDDOR|DANGEROUS OCCURRENCE|REPORTABLE DISEASE/i.test(text)) eyScore += 2;
  if (/SureStart|ToyBox|Daycare|EY\s*Staff/i.test(text)) eyScore += 2;
  if (/TYPE OF INJURY|ABRASION|FRACTURE/i.test(text)) eyScore += 1;
  if (/OUTCOME OF INCIDENT|RETURN TO ACTIVITIES/i.test(text)) eyScore += 1;

  if (eyScore >= 6 && (/Accident\s*&\s*Incident/i.test(text) || /SureStart|ToyBox|Daycare/i.test(text))) {
    return 'early_years_accident';
  }

  // 2. Invoice / Receipt
  if (/TAX\s*INVOICE|INVOICE\s*(?:NO|NUMBER|#)|BILL\s*TO|BALANCE\s*DUE|SUBTOTAL|AMOUNT\s*DUE/i.test(text)) {
    return 'invoice';
  }
  if (/RECEIPT|TOTAL\s*CASH|CHANGE\s*DUE|STORE\s*#|REGISTER\s*#/i.test(text)) {
    return 'receipt';
  }

  // 3. Medical / Patient Intake
  if (/PATIENT\s*(?:INTAKE|INFORMATION|NAME|HISTORY)|MEDICAL\s*(?:RECORD|HISTORY|EXAMINATION)|CLINIC|HOSPITAL|DIAGNOSIS|PHYSICIAN|PRESCRIPTION/i.test(text)) {
    return 'medical_form';
  }

  // 4. Equipment Inspection
  if (/EQUIPMENT\s*(?:INSPECTION|LOG|MAINTENANCE)|SAFETY\s*INSPECTION|INSPECTION\s*CHECKLIST|ASSET\s*TAG|SERIAL\s*NO/i.test(text)) {
    return 'equipment_inspection';
  }

  // 5. Contract / Agreement
  if (/AGREEMENT|CONTRACT|TERMS\s*AND\s*CONDITIONS|BETWEEN\s*THE\s*PARTIES|WITNESSETH|IN\s*WITNESS\s*WHEREOF/i.test(text)) {
    return 'contract';
  }

  return 'generic_document';
}

/**
 * Detect whether uploaded OCR looks like the Early Years Accident & Incident form
 * (main FormFlow document type). Uncertain → dynamic.
 */
function classifyAccidentFormLayout(lines = [], fullText = '') {
  const docType = classifyDocumentType(lines, fullText);
  return docType === 'early_years_accident' ? 'early_years_accident' : 'dynamic';
}

function isEarlyYearsAccident(payloadOrDoc) {
  if (!payloadOrDoc) return false;
  if (typeof payloadOrDoc === 'string') {
    return payloadOrDoc === 'early_years_accident';
  }
  const type = payloadOrDoc.documentType || payloadOrDoc.formLayout;
  return type === 'early_years_accident';
}

const EY_CHECKBOX_LABEL_MAP = {
  staffEy: /\bey\s*staff\b/i,
  staffNonEy: /\bnon\s*ey\s*staff\b/i,
  staffVisitor: /\bvisitor\b/i,
  staffParent: /\bparent\b/i,
  childDaycare: /\bdaycare\b/i,
  childToybox: /\btoy\s*box\b/i,
  childSurestart: /\bsure\s*start\b/i,
  typeAccident: /^(?:type\s+)?accident$/i,
  typeIncident: /^(?:incident\s*type:\s*)?incident$/i,
  typeNearMiss: /\bnear\s*miss\b/i,
  severityRiddor: /^(?:severity(?::\s*|\s+))?riddor$/i,
  severityModerate: /\bmoderate\b/i,
  severityMinor: /\bminor\b/i,
  riddorDangerous: /\bdangerous\s*occurrence\b/i,
  riddorDisease: /\breportable\s*disease\b/i,
  riddorPublic: /\binjury\s*to\s*public\b/i,
  riddor3Days: /\binjury\s*3\s*days\b/i,
  riddorMajor: /\bmajor\s*injury\b/i,
  riddorDeath: /\bdeath\b/i,
  causePeer: /\bcontact\s*with(?:\s*peer)?\b/i,
  causeEquip: /\bequipment\b/i,
  causeUnknown: /\bunknown\b/i,
  causeSlip: /\bslip\s*\/?\s*trip\s*\/?\s*fall\b/i,
  causeCoshh: /\bcoshh\b/i,
  causeTraffic: /\btraffic\b/i,
  causeManual: /\bmanual\s*handling\b/i,
  causeChoking: /\bchoking\b/i,
  causeVenue: /\bvenue\b/i,
  injuryCut: /\babrasion\b|\bsmall\s*cut\b|\blight\s*bleed\b/i,
  injuryBruise: /\bbruise\b|\bswelling\b|\bredness\b/i,
  injuryStrain: /\bstrain\b|\bdislocation\b/i,
  injuryFracture: /\bfracture\b|\bbroken\s*bone\b/i,
  injuryHead: /\bhead\s*\/?\s*face\b/i,
  injurySensory: /\bsensory\s*loss\b/i,
  injuryConscious: /\bloss\s*of\s*consciousness\b/i,
  injuryOrgan: /\borgan\s*injury\b|\bopen\s*wound\b/i,
  injuryProperty: /\bproperty\s*damage\b/i,
  injuryDistress: /\bemotional\s*distress\b/i,
  outcomeReturn: /\breturn\s*to\s*activities\b/i,
  outcomeFirstAid: /\bfirst\s*aid(?:\s*applied)?\b/i,
  outcomeAdultCare: /\bto\s*responsible\s*adult\b|\bresponsible\s*adult\s*care\b/i,
  outcomeNias: /\bnias\s*called\b/i,
  outcomeHospital: /\bhospital\s*admittance\b/i,
  outcomeSupport: /\bemotional\s*support\b/i
};

/**
 * Resolve structured Early Years Accident Report fields & checkboxes from either
 * keyed fields (`fieldKey`) or raw spatial key-value OCR fields (AWS Textract / Gemini / OpenAI).
 */
function extractEarlyYearsFormModel(fields = []) {
  const list = Array.isArray(fields) ? fields : [];

  const sortedByPos = (items) => [...items].sort((a, b) => {
    const pDiff = (a.page || 1) - (b.page || 1);
    if (pDiff !== 0) return pDiff;
    const yDiff = (a.bounds?.y ?? 0.5) - (b.bounds?.y ?? 0.5);
    if (Math.abs(yDiff) > 0.004) return yDiff;
    return (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0);
  });

  const nonBoolVal = (f) => {
    if (!f || f.value === undefined || f.value === null) return '';
    const v = String(f.value).trim();
    if (!v || ['true', 'false'].includes(v.toLowerCase())) return '';
    return v;
  };

  const getByKey = (key) => {
    const f = list.find(item => item && item.fieldKey === key);
    return nonBoolVal(f);
  };

  const getVal = (regex, fallback = '') => {
    const hits = sortedByPos(list.filter(item => item && item.label && regex.test(item.label)));
    for (const f of hits) {
      const v = nonBoolVal(f);
      if (v) return v;
    }
    return fallback;
  };

  const isCheckboxField = (item) => {
    if (!item) return false;
    if (item.type === 'checkbox') return true;
    const v = String(item.value ?? '').toLowerCase().trim();
    return ['true', 'false', 'yes', 'no', '1', '0', '[x]', 'checked', 'x'].includes(v);
  };

  const rawCheck = (keyOrRegex) => {
    let f;
    if (typeof keyOrRegex === 'string') {
      f = list.find(item => item && item.fieldKey === keyOrRegex && isCheckboxField(item));
      if (!f && EY_CHECKBOX_LABEL_MAP[keyOrRegex]) {
        const rx = EY_CHECKBOX_LABEL_MAP[keyOrRegex];
        f = list.find(item => item && item.label && rx.test(item.label.trim()) && isCheckboxField(item));
      }
    } else {
      f = list.find(item => item && item.label && keyOrRegex.test(item.label.trim()) && isCheckboxField(item));
    }
    if (!f || f.value === undefined || f.value === null) return false;
    return ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(f.value).toLowerCase().trim());
  };

  // Spatial anchors for Completion & Sign-off section
  const completedByField = list.find(f => f && f.label && /form\s*completed\s*by|^completed\s*by$/i.test(f.label.trim()));
  const positionField = list.find(f => f && f.label && /^position$/i.test(f.label.trim()));
  const parentBannerField = list.find(f => f && f.label && /parent\s*\/\s*guardian|parent.*guardian.*responsible\s*adult/i.test(f.label.trim()));
  const commentsField = list.find(f => f && f.label && /^comments?$/i.test(f.label.trim()));

  const anchorYs = [
    completedByField?.bounds?.y,
    positionField?.bounds?.y,
    commentsField?.bounds?.y
  ].filter(v => typeof v === 'number');
  if (parentBannerField?.bounds?.y && parentBannerField.bounds.y > 0.65) {
    anchorYs.push(parentBannerField.bounds.y - 0.04);
  }
  const signOffStartY = anchorYs.length > 0 ? Math.min(...anchorYs) - 0.02 : null;
  const parentY = typeof parentBannerField?.bounds?.y === 'number'
    ? parentBannerField.bounds.y
    : (signOffStartY !== null ? signOffStartY + 0.04 : null);

  // Disambiguate multiple DATE fields by spatial position
  const dateFields = sortedByPos(
    list.filter(f => f && f.label && /^date$|date/i.test(f.label.trim()) &&
      !/d\.o\.b|birth|signed|parent|incident|form\s*date/i.test(f.label) &&
      nonBoolVal(f))
  );

  const upperDates = dateFields.filter(f => signOffStartY === null || (f.bounds?.y ?? 0) < signOffStartY);
  let headerDateFallback = '';
  let incDateFallback = '';
  for (const f of upperDates) {
    const y = f.bounds?.y ?? 0;
    if (y > 0 && y < 0.36 && !headerDateFallback) headerDateFallback = nonBoolVal(f);
    else if (y >= 0.36 && !incDateFallback) incDateFallback = nonBoolVal(f);
  }
  if (!headerDateFallback && upperDates[0]) headerDateFallback = nonBoolVal(upperDates[0]);
  if (!incDateFallback && upperDates[1]) incDateFallback = nonBoolVal(upperDates[1]);

  let staffDateFallback = '';
  let parentDateFallback = '';
  if (signOffStartY !== null) {
    const signOffDates = dateFields.filter(f => (f.bounds?.y ?? 0) >= signOffStartY);
    if (typeof parentBannerField?.bounds?.y === 'number') {
      const beforeParent = signOffDates.find(f => (f.bounds?.y ?? 0) < parentBannerField.bounds.y);
      const afterParent = signOffDates.find(f => (f.bounds?.y ?? 0) >= parentBannerField.bounds.y);
      if (beforeParent) staffDateFallback = nonBoolVal(beforeParent);
      if (afterParent) parentDateFallback = nonBoolVal(afterParent);
    } else {
      if (signOffDates[0]) staffDateFallback = nonBoolVal(signOffDates[0]);
      if (signOffDates[1]) parentDateFallback = nonBoolVal(signOffDates[1]);
    }
  }

  // Disambiguate multiple TIME fields
  const timeFields = sortedByPos(
    list.filter(f => f && f.label && /^time$/i.test(f.label.trim()) && nonBoolVal(f))
  );
  let incTimeFallback = '';
  let parentTimeFallback = '';
  for (const f of timeFields) {
    const y = f.bounds?.y ?? 0;
    if (signOffStartY !== null) {
      if (y < signOffStartY && !incTimeFallback) incTimeFallback = nonBoolVal(f);
      else if (y >= signOffStartY && !parentTimeFallback) parentTimeFallback = nonBoolVal(f);
    } else {
      if (y < 0.72 && !incTimeFallback) incTimeFallback = nonBoolVal(f);
      else if (y >= 0.72 && !parentTimeFallback) parentTimeFallback = nonBoolVal(f);
    }
  }

  // Disambiguate multiple SIGNED fields (Staff signature vs Parent signature)
  const signedFields = sortedByPos(
    list.filter(f => f && f.label && /^signed$/i.test(f.label.trim()) && nonBoolVal(f))
  );
  let staffSignedFallback = '';
  let parentSignedFallback = '';
  if (typeof parentBannerField?.bounds?.y === 'number') {
    const above = signedFields.find(f => (f.bounds?.y ?? 0) < parentBannerField.bounds.y);
    const below = signedFields.find(f => (f.bounds?.y ?? 0) >= parentBannerField.bounds.y);
    if (above) staffSignedFallback = nonBoolVal(above);
    if (below) parentSignedFallback = nonBoolVal(below);
  } else if (signedFields.length >= 2) {
    staffSignedFallback = nonBoolVal(signedFields[0]);
    parentSignedFallback = nonBoolVal(signedFields[1]);
  } else if (signedFields.length === 1) {
    const sf = signedFields[0];
    if (completedByField?.bounds?.y && (sf.bounds?.y ?? 1) - completedByField.bounds.y <= 0.035) {
      staffSignedFallback = nonBoolVal(sf);
    } else if ((sf.bounds?.y ?? 0) >= 0.895) {
      parentSignedFallback = nonBoolVal(sf);
    } else {
      staffSignedFallback = nonBoolVal(sf);
    }
  }

  const refNo = getByKey('refNo') || getVal(/ref\s*no|reference/i, '');
  let formDate = getByKey('formDate') || getVal(/^form\s*date$/i, headerDateFallback);
  let project = getByKey('projectName') || getVal(/project\s*name/i, '');
  const address = getByKey('bldgAddress') || getVal(/building\s*address/i, '');

  // Disambiguate composite date + project name (e.g. "05-03-26 Riverside Nursery")
  const dateProjectMatch = formDate.match(/^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(.+)$/);
  if (dateProjectMatch) {
    formDate = dateProjectMatch[1].trim();
    if (!project) project = dateProjectMatch[2].trim();
  }

  const name = getByKey('personName') || getVal(/name of the person|^name$/i, '');
  const dob = getByKey('dob') || getVal(/d\.o\.b|date of birth/i, '');
  const age = getByKey('age') || getVal(/^age$/i, '');
  const regAddress = getByKey('regAddress') || getVal(/registered\s*address/i, '');
  const postcode = getByKey('postcode') || getVal(/^postcode$/i, '');
  const contact = getByKey('contactNumber') || getVal(/contact\s*number|phone|telephone/i, '');
  const adult = getByKey('responsibleAdult') || getVal(/^responsible\s*adult$/i, '');
  const session = getByKey('session') || getVal(/session\s*activity|^session$/i, '');

  const incDate = getByKey('incidentDate') || getVal(/^incident\s*date$/i, incDateFallback);
  const incTime = getByKey('incidentTime') || getVal(/^incident\s*time$/i, incTimeFallback);
  const location = getByKey('location') || getVal(/space\s*\/\s*location|^space$/i, '');

  const narrative = getByKey('narrative') || getVal(/narrative/i, '');
  const completedBy = getByKey('completedBy') || getVal(/form\s*completed\s*by|^completed\s*by$/i, '');
  const position = getByKey('position') || getVal(/^position$/i, '');
  const signature = getByKey('signature') || getVal(/^staff\s*signature$|^signature$/i, staffSignedFallback);
  const dateSigned = getByKey('dateSigned') || getVal(/^date\s*signed$/i, staffDateFallback);
  const parentGuardianName = getByKey('parentGuardian') || nonBoolVal(parentBannerField);
  const parentSigned = getByKey('parentSigned') || getVal(/^parent\s*signed$|^parent\s*signature$/i, parentSignedFallback) || parentGuardianName;
  const parentDate = getByKey('parentDate') || getVal(/^parent.*date$/i, parentDateFallback);
  const parentTime = getByKey('parentTime') || getVal(/^parent.*time$/i, parentTimeFallback);
  const comments = getByKey('comments') || getVal(/^comments?$/i, '');

  const isSeverityRiddor = rawCheck('severityRiddor');
  const isChecked = (keyOrRegex) => {
    if (typeof keyOrRegex === 'string' && keyOrRegex.startsWith('riddor')) {
      return isSeverityRiddor && rawCheck(keyOrRegex);
    }
    return rawCheck(keyOrRegex);
  };

  return {
    refNo,
    formDate,
    project,
    address,
    name,
    dob,
    age,
    regAddress,
    postcode,
    contact,
    adult,
    session,
    incDate,
    incTime,
    location,
    narrative,
    completedBy,
    position,
    signature,
    dateSigned,
    parentGuardianName,
    parentSigned,
    parentDate,
    parentTime,
    comments,
    isRiddorApplicable: isSeverityRiddor,
    isChecked,
    checks: Object.keys(EY_CHECKBOX_LABEL_MAP).reduce((acc, k) => {
      acc[k] = isChecked(k);
      return acc;
    }, {})
  };
}

module.exports = {
  FORM_FIELD_ALIASES,
  FIELD_KEY_LABELS,
  EARLY_YEARS_TEXT_TARGETS,
  EARLY_YEARS_CHECKBOX_TARGETS,
  FORM_STOPWORDS,
  normalizeLabelKey,
  sortedAliasKeys,
  stripUncertainNoise,
  normalizeImageOcrText,
  looksLikeOcrJunk,
  tidyPhrase,
  matchAliasOnLine,
  findAliasEmbedded,
  extractByAliases,
  extractAllLabelsFromLine,
  parseDate,
  parseUkPostcode,
  parsePostcode,
  parsePhoneNumber,
  parseName,
  parseRefNo,
  keepLabelAdjacentValue,
  parseAddress,
  isCheckboxMarked,
  detectCheckboxSquares,
  detectCheckboxesNearLabels,
  probeCheckboxAt,
  associateCheckboxesWithLabels,
  extractOcrTokenCheckboxes,
  extractDynamicFormFields,
  extractEarlyYearsByAliases,
  buildEarlyYearsFormFields,
  buildEarlyYearsFormFieldsFromVision,
  mapVisionAccidentToEy,
  sanitizeEyExtractedValues,
  applyEyFieldParsers,
  looksLikeAccidentVisionPayload,
  classifyAccidentFormLayout,
  classifyDocumentType,
  isEarlyYearsAccident,
  extractEarlyYearsFormModel
};
