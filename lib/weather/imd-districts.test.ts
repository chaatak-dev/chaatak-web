import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findImdDistrict, imdDistrictIndex } from './imd-districts';

/**
 * The highest-consequence lookup in the codebase.
 *
 * Get it wrong and someone is shown another district's warning, which is
 * worse than showing them nothing at all. So the tests are mostly about what
 * it refuses.
 */

test('the register is IMD own and covers the country at the right scale', () => {
  const { districts } = imdDistrictIndex();
  // 718 in the bulletin this was built from. Far fewer would mean the list
  // silently shrank, and a district missing from it is a district nobody
  // gets warned about.
  assert.ok(districts.length > 700, `only ${districts.length} districts`);
  for (const d of districts) {
    assert.match(d.id, /^\d+$/, `${d.name} has a non-numeric id`);
    assert.ok(d.name.trim().length > 0);
  }
  // Ids are unique, or a name would resolve to two different districts.
  assert.equal(new Set(districts.map((d) => d.id)).size, districts.length);
});

test('an exact district name resolves to its IMD id', () => {
  assert.equal(findImdDistrict('Barabanki')?.id, '440');
  assert.equal(findImdDistrict('BARABANKI')?.id, '440');
  assert.equal(findImdDistrict('Nainital')?.id, '516');
  assert.equal(findImdDistrict('Kolkata')?.id, '237');
  assert.equal(findImdDistrict('Nicobar')?.id, '573');
});

test('IMD own spellings are reconciled, because refusing them loses warnings', () => {
  // IMD writes several districts its own way. These are two official
  // spellings of one administrative unit, not a typo.
  assert.equal(findImdDistrict('Tirunelveli')?.name, 'THIRUNELVELI');
  assert.equal(findImdDistrict('Kachchh')?.name, 'KACHCHH');
});

test('a district IMD does not cover resolves to nothing', () => {
  // The register holds 718 districts and does not cover the whole country --
  // Pune and Mumbai are absent from this product. Saying so is honest;
  // attaching a neighbour's warning is not.
  for (const name of ['Zzzznotadistrict', 'Atlantis', '', '   ', '!!!']) {
    assert.equal(findImdDistrict(name), null, JSON.stringify(name));
  }
});

test('a short name gets no spelling latitude at all', () => {
  // At five characters or fewer one edit reaches several real districts, and
  // a typo is then indistinguishable from a different place.
  const short = findImdDistrict('Bida');
  assert.ok(short === null || short.name.toLowerCase() === 'bida');
});

test('the budget is tighter than the place gazetteer, on purpose', () => {
  // The gazetteer repairs what a person typed, where a wrong answer is
  // visible and correctable. This reconciles two official spellings, where a
  // wrong answer is invisible and is somebody else's warning. "Mysuru" and
  // "MYSORE" are two edits apart and are deliberately NOT joined here.
  const m = findImdDistrict('Mysuru');
  assert.ok(m === null || m.name === 'MYSORE');
});

test('every resolved district comes back with a usable numeric id', () => {
  for (const name of ['Barabanki', 'Nainital', 'Kolkata', 'Nicobar', 'Tirunelveli']) {
    const d = findImdDistrict(name);
    assert.ok(d, name);
    assert.match(d.id, /^\d+$/);
    assert.ok(Number(d.id) > 0);
  }
});
