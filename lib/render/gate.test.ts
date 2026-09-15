import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFacts, verifyRender } from './gate';

/**
 * The gate is the only thing standing between a conversational model and a
 * fabricated weather value on a public-safety screen, so these fixtures test
 * both directions: it must reject what is invented, and it must NOT reject
 * what is merely phrased differently. An over-rejecting gate gets switched
 * off, and a gate that is switched off protects nobody.
 */

/** The exact payload a renderer would be handed for Ghaziabad. */
const PAYLOAD = {
  place: { name: 'Ghaziabad', district: 'Ghaziabad', state: 'Uttar Pradesh' },
  current: {
    conditionCode: 0,
    temperature: { value: 25.2, unit: '°C' },
    humidity: { value: 96, unit: '%' },
    windSpeed: { value: 11.7, unit: 'km/h' },
  },
  outlook: [
    { date: '2026-09-15', maxTemp: 30.7, minTemp: 24.9 },
    { date: '2026-09-16', maxTemp: 31.4, minTemp: 23.9 },
  ],
  issuedAt: '2026-09-15T01:45:00+05:30',
};

const FACTS = buildFacts({
  payload: PAYLOAD,
  places: ['Ghaziabad', 'Uttar Pradesh'],
});

const GAZETTEER = new Set(['ghaziabad', 'uttar pradesh', 'jaipur', 'lucknow', 'मुंबई']);

/* ------------------------------------------------------------------ */
/* The four required cases                                             */
/* ------------------------------------------------------------------ */

test('rejects a fabricated Devanagari numeral', () => {
  // ३२ was never in the data. A Latin-only \d would not even see it, so this
  // is the case where a naive gate fails open rather than closed.
  const rendered = 'गाज़ियाबाद में अभी तापमान ३२ डिग्री सेल्सियस है।';

  const verdict = verifyRender(rendered, FACTS);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'unknownNumber');
  assert.match(verdict.detail, /32/);
});

test('rejects a spelled-out number with no numeral present', () => {
  // "पच्चीस" is 25 written out. There is not one numeral in this sentence.
  const rendered = 'गाज़ियाबाद में तापमान पच्चीस डिग्री सेल्सियस है।';

  const verdict = verifyRender(rendered, FACTS);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'numberWord');
});

test('accepts a correct number formatted differently', () => {
  // The over-rejection case. 25.20 is 25.2, and २५.२ is 25.2 written in
  // Devanagari digits. Both are the value the source issued.
  for (const rendered of [
    'Ghaziabad is 25.20°C right now.',
    'गाज़ियाबाद में अभी २५.२ डिग्री सेल्सियस है।',
    'Right now it is 25.2°C in Ghaziabad, with humidity at 96%.',
  ]) {
    const verdict = verifyRender(rendered, FACTS);
    assert.equal(verdict.ok, true, `should accept: ${rendered}`);
  }
});

test('rejects an unresolved place name', () => {
  // Jaipur is a real place, and is in the gazetteer, but it is not the place
  // that was resolved for this answer.
  const rendered = 'In Jaipur it is 25.2°C right now.';

  const verdict = verifyRender(rendered, FACTS, { gazetteer: GAZETTEER });
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'unknownPlace');
  assert.match(verdict.detail, /jaipur/i);
});

/* ------------------------------------------------------------------ */
/* Not over-rejecting: the failure mode that gets a gate disabled      */
/* ------------------------------------------------------------------ */

test('accepts a natural reply that repeats only given values', () => {
  const rendered =
    'गाज़ियाबाद, उत्तर प्रदेश में अभी 25.2 डिग्री सेल्सियस है और आर्द्रता 96 प्रतिशत है। ' +
    'आज ज़्यादा से ज़्यादा 30.7 और कम से कम 24.9 डिग्री रहेगा। ' +
    'यह जानकारी 2026-09-15 को 01:45 पर अपडेट हुई।';

  assert.equal(verifyRender(rendered, FACTS, { gazetteer: GAZETTEER }).ok, true);
});

test('allows एक as an article, not as a fabricated value', () => {
  // एक is Hindi's indefinite article. A gate that rejects every reply
  // containing it is a gate nobody keeps switched on.
  const rendered = 'गाज़ियाबाद एक जगह है। अभी 25.2 डिग्री सेल्सियस है।';

  assert.equal(verifyRender(rendered, FACTS).ok, true);
});

test('allows the resolved place and its state to be named', () => {
  const rendered = 'Ghaziabad, Uttar Pradesh: 25.2°C.';

  assert.equal(verifyRender(rendered, FACTS, { gazetteer: GAZETTEER }).ok, true);
});

test('does not read a hyphenated date as a negative number', () => {
  // "2026-09-15" must read as 2026, 9, 15 — not as 2026, -9, -15, which would
  // reject a perfectly good render.
  const rendered = 'Updated 2026-09-15 at 01:45.';

  assert.equal(verifyRender(rendered, FACTS).ok, true);
});

/* ------------------------------------------------------------------ */
/* Severity: the failure the numeric checks cannot see                 */
/* ------------------------------------------------------------------ */

test('rejects a render that drops or softens the injected severity', () => {
  const withSeverity = buildFacts({
    payload: PAYLOAD,
    places: ['Ghaziabad', 'Uttar Pradesh'],
    severityStrings: ['अत्यंत भारी बारिश'],
  });

  // Fluent, numerically spotless, and the severity has been softened from
  // "extremely heavy rain" to "heavy rain". Only the verbatim check sees it.
  const softened = 'गाज़ियाबाद में भारी बारिश होगी। तापमान 25.2 डिग्री सेल्सियस।';

  const verdict = verifyRender(softened, withSeverity);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'severityAltered');

  const verbatim =
    'गाज़ियाबाद में अत्यंत भारी बारिश होगी। तापमान 25.2 डिग्री सेल्सियस।';
  assert.equal(verifyRender(verbatim, withSeverity).ok, true);
});
