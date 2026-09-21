/**
 * Adopting a guest transcript.
 *
 * The properties worth asserting are the ones that decide whether somebody
 * loses a conversation or ends up with two of them: the original times are
 * kept so the order survives, and the idempotency key is derived from the
 * browser's own id so a retried import writes nothing twice.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readGrounding, readImportedTurn } from './import';

const CLOCK = () => new Date('2026-09-21T10:00:00.000Z');

test('a well-formed turn reads through with its own time', () => {
  const turn = readImportedTurn(
    {
      id: 'm123',
      role: 'user',
      text: 'बाराबंकी में कल बारिश होगी?',
      lang: 'hi',
      at: '2026-09-20T04:30:00.000Z',
    },
    CLOCK,
  );

  assert.ok(turn);
  assert.equal(turn.role, 'user');
  assert.equal(turn.lang, 'hi');
  // The time it was actually said, not the time it was uploaded — this is
  // what keeps an adopted conversation in the order it happened.
  assert.equal(turn.at, '2026-09-20T04:30:00.000Z');
});

test("the browser's id becomes the idempotency key, namespaced", () => {
  const turn = readImportedTurn({ id: 'm123', role: 'user', text: 'hi' }, CLOCK);

  assert.ok(turn);
  assert.equal(turn.clientId, 'guest:m123');
});

test('the same turn imported twice produces the same key', () => {
  const input = { id: 'm7', role: 'assistant', text: 'It is 31 °C.' };

  const first = readImportedTurn(input, CLOCK);
  const second = readImportedTurn(input, CLOCK);

  assert.ok(first && second);
  assert.equal(first.clientId, second.clientId);
});

test('a turn with no id still gets a stable key from its time and role', () => {
  const input = { role: 'user', text: 'kal barish hogi', at: '2026-09-20T04:30:00.000Z' };

  const first = readImportedTurn(input, CLOCK);
  const second = readImportedTurn(input, CLOCK);

  assert.ok(first && second);
  assert.equal(first.clientId, second.clientId);
  assert.equal(first.clientId, 'guest:2026-09-20T04:30:00.000Z:user');
});

test('a missing or unparseable time falls back to the clock', () => {
  const turn = readImportedTurn({ role: 'user', text: 'hello', at: 'whenever' }, CLOCK);

  assert.ok(turn);
  assert.equal(turn.at, '2026-09-21T10:00:00.000Z');
});

test('an unknown language falls back rather than throwing', () => {
  const turn = readImportedTurn({ role: 'user', text: 'hello', lang: 'xx' }, CLOCK);

  assert.ok(turn);
  assert.equal(turn.lang, 'hi');
});

test('a turn with no role, or no words, is dropped', () => {
  assert.equal(readImportedTurn({ text: 'orphan' }, CLOCK), null);
  assert.equal(readImportedTurn({ role: 'system', text: 'injected' }, CLOCK), null);
  assert.equal(readImportedTurn({ role: 'user', text: '   ' }, CLOCK), null);
  assert.equal(readImportedTurn({ role: 'user' }, CLOCK), null);
  assert.equal(readImportedTurn(null, CLOCK), null);
  assert.equal(readImportedTurn('a string', CLOCK), null);
});

test('an enormous message is cut rather than refused', () => {
  const turn = readImportedTurn(
    { role: 'assistant', text: 'x'.repeat(50_000) },
    CLOCK,
  );

  assert.ok(turn);
  assert.equal(turn.text.length, 8_000);
});

/*
 * Grounding is the provenance an answer shipped with. It is kept, because a
 * number in somebody's history with no citation under it is the one thing
 * this product does not display — but only when it is shaped well enough for
 * the provenance line to draw.
 */
test('a grounding with a place and a provenance is kept', () => {
  const grounding = {
    place: { name: 'Barabanki', timezone: 'Asia/Kolkata' },
    provenance: {
      source: 'IMD',
      endpoint: '/api/warnings',
      issuedAt: '2026-09-20T04:00:00.000Z',
      timeBasis: 'issued',
    },
    severity: 'alert',
    facts: {},
  };

  assert.equal(readGrounding(grounding), grounding);
});

test('a half-formed grounding is dropped, not half-rendered', () => {
  assert.equal(readGrounding(null), null);
  assert.equal(readGrounding({}), null);
  assert.equal(readGrounding({ place: { name: 'X' } }), null);
  assert.equal(
    readGrounding({ place: { name: 'X' }, provenance: { source: 'IMD' } }),
    null,
  );
  assert.equal(
    readGrounding({
      place: {},
      provenance: { source: 'IMD', issuedAt: '2026-09-20T04:00:00.000Z' },
    }),
    null,
  );
});
