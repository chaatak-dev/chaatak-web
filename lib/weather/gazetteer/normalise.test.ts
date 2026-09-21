import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalise, scriptOf } from './normalise';

/**
 * Both sides of every lookup run through normalise(). If it ever treats the
 * stored form and the typed form differently the index stops matching and
 * nothing fails loudly, so its behaviour is pinned here.
 */

test('accents fold off Latin so a geocoder spelling matches a typed one', () => {
  assert.equal(normalise('Barabānki'), 'barabanki');
  assert.equal(normalise('Karnāl'), 'karnal');
  assert.equal(normalise('Bāra Bankī'), 'barabanki');
});

test('Indic combining marks survive, because they are not decoration', () => {
  // A blanket \p{M} strip turns बाराबंकी into बरबक and नैनीताल into नननतल,
  // which would collapse most of the Devanagari index onto a handful of keys.
  assert.equal(normalise('बाराबंकी'), 'बाराबंकी');
  assert.equal(normalise('नैनीताल'), 'नैनीताल');
  assert.notEqual(normalise('नैनीताल'), normalise('बाराबंकी'));
});

test('the administrative suffix comes off in every script', () => {
  assert.equal(normalise('Nainital district'), 'nainital');
  assert.equal(normalise('Hissār District'), 'hissar');
  assert.equal(normalise('नैनीताल जिला'), 'नैनीताल');
  assert.equal(normalise('નૈનિતાલ જિલ્લો'), 'નૈનિતાલ');
});

test('spacing and punctuation are removed, not merely collapsed', () => {
  // "Bara Banki" and "Barabanki" are one place and only one is what gets typed.
  assert.equal(normalise('Bara Banki'), normalise('Barabanki'));
  assert.equal(normalise('  Pune  '), 'pune');
  assert.equal(normalise('New-Delhi'), 'newdelhi');
});

test('a name that normalises to nothing is not a name', () => {
  assert.equal(normalise(''), '');
  assert.equal(normalise('   '), '');
  assert.equal(normalise('!!!'), '');
});

test('scripts are identified so they are never compared across', () => {
  assert.equal(scriptOf('Nainital'), 'latn');
  assert.equal(scriptOf('नैनीताल'), 'deva');
  assert.equal(scriptOf('কলকাতা'), 'beng');
  assert.equal(scriptOf('சென்னை'), 'taml');
  assert.equal(scriptOf('અમદાવાદ'), 'gujr');
  assert.equal(scriptOf('ਅੰਮ੍ਰਿਤਸਰ'), 'guru');
});
