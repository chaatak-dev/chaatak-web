/**
 * The link token: what it carries (nothing), and the shape Telegram requires.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { deepLink, hashLinkToken, LINK_PREFIX, maskEmail, newLinkToken, readLinkPayload } from './link';

test('a token is 43 characters of the start-parameter alphabet', () => {
  for (let n = 0; n < 50; n++) {
    const token = newLinkToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  }
});

test('tokens do not repeat', () => {
  const seen = new Set(Array.from({ length: 500 }, () => newLinkToken()));
  assert.equal(seen.size, 500);
});

test('the deep link fits Telegram’s 64-character start parameter', () => {
  const url = deepLink('ChaatakBot', newLinkToken());
  const start = new URL(url).searchParams.get('start') ?? '';
  assert.ok(start.length <= 64, `${start.length} characters`);
  assert.match(start, /^[A-Za-z0-9_-]+$/);
  assert.ok(url.startsWith('https://t.me/ChaatakBot?start=link_'));
});

test('the link carries no account information', () => {
  const token = newLinkToken();
  const url = deepLink('ChaatakBot', token);
  // Nothing but the prefix and the random token: no id, no email, no time.
  assert.equal(new URL(url).searchParams.get('start'), `${LINK_PREFIX}${token}`);
});

test('only the hash is stored, and it is stable and one-way', () => {
  const token = newLinkToken();
  assert.equal(hashLinkToken(token), hashLinkToken(token));
  assert.match(hashLinkToken(token), /^[0-9a-f]{64}$/);
  assert.ok(!hashLinkToken(token).includes(token));
  assert.notEqual(hashLinkToken(token), hashLinkToken(newLinkToken()));
});

test('a /start payload is read as a link only when it is exactly one', () => {
  const token = newLinkToken();
  assert.equal(readLinkPayload(`link_${token}`), token);
  assert.equal(readLinkPayload(token), null, 'no prefix');
  assert.equal(readLinkPayload(`link_${token}x`), null, 'too long');
  assert.equal(readLinkPayload('link_short'), null, 'too short');
  assert.equal(readLinkPayload(`link_${token.slice(0, 42)}!`), null, 'outside the alphabet');
  assert.equal(readLinkPayload(''), null);
  assert.equal(readLinkPayload(undefined), null);
});

test('an email is recognisable but not disclosed', () => {
  assert.equal(maskEmail('yash.sharma@gmail.com'), 'ya•••@gmail.com');
  assert.equal(maskEmail('ab@x.in'), 'a•••@x.in');
  assert.equal(maskEmail('not an email'), null);
  assert.equal(maskEmail(null), null);
});
