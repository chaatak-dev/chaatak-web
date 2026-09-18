import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyReply } from './chat-gate';
import type { Severity } from '../weather/types';

/**
 * The chat gate: everything the Phase 1 gate did, plus the three things chat
 * introduces — a grounded/ungrounded split, an advice-vs-warning check, and a
 * place check that still applies when nothing was fetched.
 */

const FACTS = {
  place: { name: 'बाराबंकी', state: 'उत्तर प्रदेश' },
  current: { temperature: { value: 25.2, unit: '°C' }, windSpeed: { value: 11.7, unit: 'km/h' } },
  outlook: [{ date: '2026-09-17', maxTemp: 30.7, minTemp: 24.9 }],
};

const GAZETTEER = new Set(['बाराबंकी', 'उत्तर प्रदेश', 'jaipur', 'मुंबई', 'ghaziabad']);

const grounded = (severity: Severity | 'unknown' = 'unknown') => ({
  facts: FACTS,
  places: ['बाराबंकी', 'उत्तर प्रदेश'],
  severity,
  gazetteer: GAZETTEER,
});

const ungrounded = (places: string[] = ['बाराबंकी']) => ({
  facts: null,
  places,
  severity: 'unknown' as const,
  gazetteer: GAZETTEER,
});

/* ------------------------------------------------------------------ */
/* Grounded turns: every numeral must be in the data                   */
/* ------------------------------------------------------------------ */

test('a grounded turn may repeat the values it was given', () => {
  const reply =
    'बाराबंकी में अभी 25.2 डिग्री सेल्सियस है और हवा 11.7 किलोमीटर प्रति घंटा चल रही है।';
  assert.equal(verifyReply(reply, grounded()).ok, true);
});

test('a grounded turn may not invent a value', () => {
  const verdict = verifyReply('बाराबंकी में अभी 31 डिग्री सेल्सियस है।', grounded());
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'unknownNumber');
});

test('advice with no numbers at all is free', () => {
  // The whole point of the clarified rule: opinions are ordinary behaviour.
  const reply =
    'मैं तो अभी बाहर न निकलूँ। बारिश हो रही है और शाम तक ऐसा ही रहेगा।';
  assert.equal(verifyReply(reply, grounded()).ok, true);
});

/* ------------------------------------------------------------------ */
/* Ungrounded turns: a weather claim is a number next to a unit        */
/* ------------------------------------------------------------------ */

test('an ungrounded turn may use a number that is not a weather claim', () => {
  // Without this split the gate rejects "3" here and becomes unusable.
  const reply = 'मैं आपको अगले 3 दिन का पूर्वानुमान बता सकता हूँ।';
  assert.equal(verifyReply(reply, ungrounded()).ok, true);
});

test('an ungrounded turn may not state a value next to a unit', () => {
  // Nothing was fetched, so any numeric weather claim is fabrication.
  const verdict = verifyReply('अभी 30 डिग्री सेल्सियस है।', ungrounded());
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'unknownNumber');
});

test('an ungrounded turn may not name a place it was never given', () => {
  // The standing place is बाराबंकी; Jaipur was never in play.
  const verdict = verifyReply('Jaipur में ऑरेंज अलर्ट का मतलब है…', ungrounded());
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'unknownPlace');
});

test('an ungrounded turn may reference the standing place', () => {
  const reply = 'बाराबंकी के लिए ऑरेंज अलर्ट का मतलब है कि तैयार रहना चाहिए।';
  assert.equal(verifyReply(reply, ungrounded()).ok, true);
});

/* ------------------------------------------------------------------ */
/* Advice must never contradict an active warning                      */
/* ------------------------------------------------------------------ */

const SEVERITY_TEXT = 'लाल चेतावनी';

test('under a red warning the reply must OPEN with the severity', () => {
  // The structural defence. It catches what the lexicon misses, so it is
  // checked regardless of how the rest of the sentence is worded.
  const buried =
    'क्रिकेट खेलने में कोई खास दिक्कत नहीं लगती। वैसे लाल चेतावनी भी जारी है।';
  const verdict = verifyReply(buried, {
    ...grounded('warning'),
    severityStrings: [SEVERITY_TEXT],
  });
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'severityNotLeading');
});

test('opening with the severity and advising against is accepted', () => {
  const good =
    'लाल चेतावनी जारी है। आज क्रिकेट न खेलें, बाहर निकलना सुरक्षित नहीं है।';
  assert.equal(
    verifyReply(good, { ...grounded('warning'), severityStrings: [SEVERITY_TEXT] }).ok,
    true,
  );
});

test('unnegated reassurance under a warning is rejected even if it opens correctly', () => {
  const reassuring = 'लाल चेतावनी जारी है, लेकिन मौसम अच्छा है, आप खेल सकते हैं।';
  const verdict = verifyReply(reassuring, {
    ...grounded('warning'),
    severityStrings: [SEVERITY_TEXT],
  });
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'contradictsWarning');
});

test('negated reassurance is not mistaken for reassurance', () => {
  // "not safe" contains "safe". A naive contains-check inverts the meaning.
  const reply = 'लाल चेतावनी जारी है। बाहर जाना सुरक्षित नहीं है।';
  assert.equal(
    verifyReply(reply, { ...grounded('warning'), severityStrings: [SEVERITY_TEXT] }).ok,
    true,
  );
});

test('reassurance is fine when no warning is in force', () => {
  const reply = 'मौसम अच्छा है, आप आराम से क्रिकेट खेल सकते हैं।';
  assert.equal(verifyReply(reply, grounded('none')).ok, true);
});

test('a yellow watch requires the severity but allows measured reassurance', () => {
  const reply = 'पीली चेतावनी है। हल्की बारिश हो सकती है, वैसे खेल सकते हैं।';
  assert.equal(
    verifyReply(reply, { ...grounded('watch'), severityStrings: ['पीली चेतावनी'] }).ok,
    true,
  );
});

test('English reassurance under a warning is caught too', () => {
  const verdict = verifyReply(
    'Red warning is in force, but it should be fine to go out.',
    { ...grounded('warning'), severityStrings: ['Red warning'] },
  );
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, 'contradictsWarning');
});

test('a reply in the wrong script is rejected, however fluent', () => {
  // Measured, not hypothetical: a Bengali question came back in correct,
  // well-formed Hindi. Numerically spotless, severity intact, and still a
  // script the user never wrote in.
  const verdict = verifyReply('हाँ, कल कोलकाता में बारिश की संभावना है।', {
    facts: null,
    places: [],
    severity: 'unknown',
    expectScript: 'Beng',
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.reason, 'scriptSwitched');
});

test('the right script passes, and no expectation means no check', () => {
  assert.equal(
    verifyReply('হ্যাঁ, আগামীকাল বৃষ্টি হবে।', {
      facts: null, places: [], severity: 'unknown', expectScript: 'Beng',
    }).ok,
    true,
  );
  // A reply with no letters at all cannot switch script and must not be held
  // to one, or a bare "26 °C" would be rejected for being unreadable.
  assert.equal(
    verifyReply('26 °C', {
      facts: null, places: [], severity: 'unknown', expectScript: 'Deva',
    }).ok,
    true,
  );
});
