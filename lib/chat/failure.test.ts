import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFailure, describeFailure, failureText } from './failure';

/**
 * This shipped, and it cost real debugging time.
 *
 * The synthetic-source guard threw on every chat request because
 * WEATHER_SOURCE was still `fixture` in production. The server answered a
 * prompt 503. The client said "Could not reach the server. Check your
 * connection and try again." — so the operator went and looked at their wifi
 * while the fault was an environment variable.
 *
 * The bug was not the guard. The bug was one catch block treating "no response
 * arrived" and "a response arrived and it was an error" as the same event.
 */

test('a server error is never reported as a connection problem', () => {
  const failure = classifyFailure({ threw: false, online: true, status: 503 });
  assert.equal(failure.kind, 'serverError');

  const { en, hi } = describeFailure(failure);
  // The exact misdirection that shipped.
  assert.doesNotMatch(en, /check your connection/i);
  assert.match(en, /answered with an error/i);
  assert.match(en, /not a connection problem/i);
  assert.match(en, /503/);
  assert.match(hi, /इंटरनेट की समस्या नहीं/);
});

test('a server error surfaces the detail that points at the cause', () => {
  // The detail names an environment variable, which is what would have sent
  // the operator to the right place immediately.
  const failure = classifyFailure({
    threw: false,
    online: true,
    status: 503,
    detail: 'WEATHER_SOURCE="fixture" is a synthetic source and must never serve visitors.',
  });

  assert.match(describeFailure(failure).en, /WEATHER_SOURCE/);
  assert.match(describeFailure(failure).hi, /WEATHER_SOURCE/);
});

test('a genuinely unreachable server still says to check the connection', () => {
  // The counterweight: the old message was not wrong, it was wrong HERE. When
  // nothing came back and the browser thinks it is online, it is right again.
  const failure = classifyFailure({ threw: true, online: true });
  assert.equal(failure.kind, 'unreachable');
  assert.match(describeFailure(failure).en, /check your connection/i);
});

test('being offline is named as being offline, not as a server fault', () => {
  const failure = classifyFailure({ threw: true, online: false });
  assert.equal(failure.kind, 'offline');

  const { en } = describeFailure(failure);
  assert.match(en, /offline/i);
  assert.doesNotMatch(en, /server/i);
});

test('the three failures produce three different messages', () => {
  const messages = [
    classifyFailure({ threw: true, online: false }),
    classifyFailure({ threw: true, online: true }),
    classifyFailure({ threw: false, online: true, status: 500 }),
  ].map((f) => describeFailure(f).en);

  assert.equal(new Set(messages).size, 3, 'each failure must read differently');
});

test('both languages are populated for every failure', () => {
  for (const failure of [
    classifyFailure({ threw: true, online: false }),
    classifyFailure({ threw: true, online: true }),
    classifyFailure({ threw: false, online: true, status: 502 }),
  ]) {
    assert.ok(failureText(failure, 'hi').length > 0);
    assert.ok(failureText(failure, 'en').length > 0);
  }
});

test('a missing status still classifies as a server error', () => {
  // A response arrived but the status could not be read: still not the network.
  const failure = classifyFailure({ threw: false, online: true });
  assert.equal(failure.kind, 'serverError');
  assert.doesNotMatch(describeFailure(failure).en, /check your connection/i);
});
