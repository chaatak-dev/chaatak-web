/**
 * A coordinate from the browser, validated before anything looks at it.
 *
 * Range-checked rather than merely typed. A NaN, an infinity or a longitude
 * of 400 would otherwise reach the gazetteer scan and come back with the
 * nearest place to a point that does not exist — an answer with a real name
 * and a real provenance line, about nowhere.
 *
 * Whether the point is in INDIA is a separate question, answered later by the
 * resolver, which says so honestly instead of naming the closest Indian town
 * to a person in another country.
 */

export type Coords = { latitude: number; longitude: number };

export function readCoords(input: unknown): Coords | null {
  if (!input || typeof input !== 'object') return null;

  const raw = input as { latitude?: unknown; longitude?: unknown };
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);

  // Number('') is 0 and Number(null) is 0, so an empty field would otherwise
  // arrive as a perfectly valid point in the Gulf of Guinea.
  if (raw.latitude === null || raw.latitude === undefined) return null;
  if (raw.longitude === null || raw.longitude === undefined) return null;
  if (typeof raw.latitude === 'string' && !raw.latitude.trim()) return null;
  if (typeof raw.longitude === 'string' && !raw.longitude.trim()) return null;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
}
