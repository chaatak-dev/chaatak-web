/**
 * Each air quality index's own bands, and nothing that maps one onto another.
 *
 * Pure and dependency-free so the server adapters, the rail and the map all
 * read the same thresholds. A map that coloured 180 as "poor" while the rail
 * called it "moderate" would be two answers to one question.
 */

export type AqiBand =
  | 'good'
  /** CPCB's second band. The European index calls its second band "fair". */
  | 'satisfactory'
  | 'fair'
  | 'moderate'
  | 'poor'
  | 'veryPoor'
  | 'severe';

/**
 * CPCB's National AQI bands: 0–50, 51–100, 101–200, 201–300, 301–400, 401–500.
 *
 * Upper bounds, inclusive, as CPCB draws them. The map's CPCB scale is built
 * from this same table so the two cannot drift.
 */
export const CPCB_BANDS: readonly [number, AqiBand][] = [
  [50, 'good'],
  [100, 'satisfactory'],
  [200, 'moderate'],
  [300, 'poor'],
  [400, 'veryPoor'],
  [500, 'severe'],
];

export function cpcbBand(value: number): AqiBand {
  for (const [upper, band] of CPCB_BANDS) {
    if (value <= upper) return band;
  }
  // Above 500 is off CPCB's scale, and still the worst band it has.
  return 'severe';
}

/**
 * The European index's own bands. CPCB's breakpoints are different numbers
 * with different names, and mapping one onto the other is exactly the silent
 * mistranslation this module refuses.
 */
export function europeanBand(value: number): AqiBand {
  if (value <= 20) return 'good';
  if (value <= 40) return 'fair';
  if (value <= 60) return 'moderate';
  if (value <= 80) return 'poor';
  if (value <= 100) return 'veryPoor';
  return 'severe';
}
