/**
 * A coordinate to a canonical place.
 *
 * This is NOT a second geocoder. It reads the same gazetteer the typed-name
 * resolver reads — the ~2,400 Indian districts and towns in india.json, with
 * their own coordinates — and returns an entry from it in exactly the same
 * `Location` shape. Adding a reverse-geocoding service would have meant a
 * second index that could disagree with the first about where Barabanki is,
 * and a place that resolves differently depending on how you named it is the
 * bug this whole area of the codebase exists to prevent.
 *
 * It also costs no network call, which matters: "what's the temperature" with
 * the phone's location is meant to answer as fast as a pattern-matched query,
 * not as slowly as a geocode.
 *
 * WHAT IT DOES NOT DO: keep the coordinate. The point comes in, a place goes
 * out, and nothing persists the fix. A monitored location saved from "use my
 * location" stores the canonical place's coordinates — the town's, from the
 * gazetteer — never the device's.
 */

import {
  GAZETTEER_SOURCE,
  index,
  nearestDistrict,
  type GazetteerEntry,
} from './gazetteer/index';
import type { Location, NoData } from './types';

/** India keeps one timezone nationwide, and the gazetteer holds only India. */
const INDIA_TZ = 'Asia/Kolkata';

/**
 * India's bounding box, generously drawn.
 *
 * A first, cheap refusal for a point that is obviously not in the country —
 * someone on a VPN, a desktop browser guessing from an IP address in another
 * continent, a spoofed coordinate. IMD issues no warning outside India, so a
 * foreign point has no useful answer and gets an honest statement instead of
 * the nearest Indian town to it.
 */
const INDIA_BOX = { minLat: 6.0, maxLat: 37.6, minLon: 67.0, maxLon: 97.5 };

/**
 * How far a point may sit from the nearest known place and still be called
 * that place, in degrees of latitude — roughly 110 km.
 *
 * The gazetteer holds every district centroid in the country, so anywhere on
 * land is far closer than this. A point that is not is out at sea or over a
 * border the box did not catch, and naming a place for it would be a guess
 * wearing a provenance line.
 */
const MAX_DEGREES = 1.0;

/** Great-circle-ish distance, good enough at district scale. */
function distanceSquared(
  lat: number,
  lon: number,
  entryLat: number,
  entryLon: number,
): number {
  const dy = entryLat - lat;
  // Longitude degrees shrink toward the poles; at Indian latitudes the
  // correction is large enough to change which place is nearest.
  const dx = (entryLon - lon) * Math.cos((lat * Math.PI) / 180);
  return dy * dy + dx * dx;
}

function outsideIndia(): NoData {
  return {
    kind: 'noData',
    reason: 'unknownPlace',
    source: 'Chaatak gazetteer',
    endpoint: 'gazetteer:point',
    checkedAt: new Date().toISOString(),
    statement: {
      hi: 'आपकी जगह भारत के बाहर लगती है। IMD सिर्फ़ भारत के लिए चेतावनी जारी करता है। जगह का नाम लिखें।',
      en: 'Your location appears to be outside India. IMD issues warnings for India only. Type a place name instead.',
    },
  };
}

/**
 * The nearest place Chaatak can act on, or an honest no-data state.
 *
 * Settlements and districts are both candidates, and the nearest wins. A
 * district centroid can easily be 40km from where someone is standing while
 * the town they are actually in sits in the index too — taking the nearest of
 * everything names the town and still carries the district, because every
 * gazetteer entry knows which district it is in.
 */
export function resolvePoint(
  latitude: number,
  longitude: number,
): Location | NoData {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return outsideIndia();
  }

  if (
    latitude < INDIA_BOX.minLat ||
    latitude > INDIA_BOX.maxLat ||
    longitude < INDIA_BOX.minLon ||
    longitude > INDIA_BOX.maxLon
  ) {
    return outsideIndia();
  }

  const { entries } = index();
  let best: GazetteerEntry | null = null;
  let bestSq = Infinity;

  for (const entry of entries) {
    const sq = distanceSquared(latitude, longitude, entry.latitude, entry.longitude);
    if (sq < bestSq) {
      bestSq = sq;
      best = entry;
    }
  }

  if (!best || bestSq > MAX_DEGREES * MAX_DEGREES) {
    return outsideIndia();
  }

  // A settlement records the district it sits in; a district records itself.
  // Either way the answer carries the unit IMD would warn on, which is the
  // only field the alert side of the product can use.
  const district =
    best.district ?? nearestDistrict(best.latitude, best.longitude)?.name ?? best.name;

  return {
    name: best.name,
    admin1: best.state ?? undefined,
    admin2: district,
    country: 'India',
    countryCode: 'IN',
    // The GAZETTEER's coordinates, not the device's. What gets stored, cached
    // and logged downstream is a town, not a person's doorstep.
    latitude: best.latitude,
    longitude: best.longitude,
    timezone: INDIA_TZ,
    resolvedBy: `Chaatak gazetteer (${GAZETTEER_SOURCE})`,
    endpoint: 'gazetteer:point',
  };
}
