/**
 * Turning a district name into IMD's numeric Obj_id.
 *
 * IMD keys district warnings on a number. Chaatak carries a name, because a
 * name is what a person says and what a geocoder returns. This is the join,
 * and it is the highest-consequence lookup in the codebase: get it wrong and
 * someone is shown another district's warning, which is worse than showing
 * them nothing.
 *
 * So it is deliberately conservative. Exact first. A bounded repair second,
 * because IMD spells a dozen districts its own way — THIRUNELVELI for
 * Tirunelveli, BANGLORE URBAN for Bengaluru Urban, MYSORE for Mysuru — and
 * refusing those would lose real warnings for real districts. Anything
 * ambiguous is refused outright rather than guessed between.
 *
 * The list is IMD's own, fetched by `npm run build:imd-districts` and
 * committed. It is never written by hand.
 */

import data from './imd-districts.json';
import { editDistance } from './gazetteer/match';
import { normalise } from './gazetteer/normalise';

export type ImdDistrict = { id: string; name: string };

type Index = {
  districts: ImdDistrict[];
  byName: Map<string, ImdDistrict[]>;
};

let cached: Index | null = null;

function build(): Index {
  const districts = data.districts as ImdDistrict[];
  const byName = new Map<string, ImdDistrict[]>();
  for (const district of districts) {
    const key = normalise(district.name);
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(district);
    else byName.set(key, [district]);
  }
  return { districts, byName };
}

export function imdDistrictIndex(): Index {
  if (!cached) cached = build();
  return cached;
}

/**
 * How far a name may stray, by length.
 *
 * Tighter than the place gazetteer's budget. That one is repairing what a
 * person typed, where a wrong answer is visible and correctable. This is
 * reconciling two official spellings of the same administrative unit, where a
 * wrong answer is invisible and is somebody else's warning.
 */
function budget(length: number): number {
  if (length <= 5) return 0;
  if (length <= 10) return 1;
  return 2;
}

/**
 * The IMD district for a name, or nothing.
 *
 * Nothing is a usable answer: the caller renders an explicit no-data state,
 * which is honest, rather than a warning belonging to another district.
 */
export function findImdDistrict(name: string): ImdDistrict | null {
  const key = normalise(name);
  if (!key) return null;

  const { districts, byName } = imdDistrictIndex();

  const exact = byName.get(key);
  // Two IMD districts normalising to one name would make the choice a coin
  // flip, so it is refused rather than taken.
  if (exact) return exact.length === 1 ? exact[0] : null;

  const max = budget(key.length);
  if (max === 0) return null;

  let best = max + 1;
  let winners: ImdDistrict[] = [];
  for (const district of districts) {
    const candidate = normalise(district.name);
    if (!candidate) continue;
    const distance = editDistance(key, candidate, max);
    if (distance > max) continue;
    if (distance < best) {
      best = distance;
      winners = [district];
    } else if (distance === best && !winners.includes(district)) {
      winners.push(district);
    }
  }

  // One survivor or none. Two real districts equally close is exactly the
  // case where guessing sends a cyclone warning to the wrong state.
  return winners.length === 1 ? winners[0] : null;
}
