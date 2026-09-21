/**
 * /api/locations — the places this account is watching.
 *
 *   GET   the list, the limit, and whether alerts can actually reach here
 *   POST  add one, by name or from a coordinate
 *
 * Three per account. The limit is a unique constraint in the schema, not a
 * count in this file — two requests arriving together cannot both become the
 * third location, which a read-then-write check would allow. The UI shows
 * "2 of 3" because the server said so, never as the authority.
 *
 * Resolution goes through the existing place pipeline: the gazetteer first,
 * geocoders only for what it does not hold, and a coordinate handled by the
 * same gazetteer rather than by a reverse-geocoding service. There is one
 * index of Indian places in this product and this route does not add a
 * second.
 */

import { addLocation, alertStatus, listLocations } from '@/lib/accounts/store';
import { MAX_MONITORED } from '@/lib/accounts/types';
import { guardRate, HttpError, readJson, withUser } from '@/lib/accounts/route';
import { placeResolver } from '@/lib/weather/source';
import { resolvePoint } from '@/lib/weather/point';
import type { Location, NoData } from '@/lib/weather/types';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return withUser(async (user) => {
    const [locations, alerts] = await Promise.all([
      listLocations(user.id),
      alertStatus(user.id),
    ]);

    return {
      locations,
      limit: MAX_MONITORED,
      used: locations.length,
      remaining: Math.max(0, MAX_MONITORED - locations.length),
      alerts,
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  return withUser(async (user) => {
    guardRate('locations', user.id);

    const body = await readJson(request);
    const resolved = await resolveRequest(body);

    /*
     * An unresolvable place is a 200 carrying an explicit noData state, the
     * same as everywhere else in this product. "We could not find that" is a
     * valid answer to a valid question, and the statement upstream wrote is
     * the one the person sees — this route does not rewrite it.
     */
    if ('kind' in resolved) {
      return { ok: false, reason: 'unresolved', noData: resolved };
    }

    const result = await addLocation(user.id, resolved);

    if (!result.ok) {
      // Both refusals are states, not errors: the account is full, or this
      // district is already covered by a place they saved earlier.
      const [locations, alerts] = await Promise.all([
        listLocations(user.id),
        alertStatus(user.id),
      ]);

      return {
        ok: false,
        reason: result.reason,
        existing: result.reason === 'duplicate' ? result.existing : undefined,
        locations,
        limit: MAX_MONITORED,
        used: locations.length,
        remaining: Math.max(0, MAX_MONITORED - locations.length),
        alerts,
      };
    }

    const [locations, alerts] = await Promise.all([
      listLocations(user.id),
      alertStatus(user.id),
    ]);

    return {
      ok: true,
      location: result.location,
      locations,
      limit: MAX_MONITORED,
      used: locations.length,
      remaining: Math.max(0, MAX_MONITORED - locations.length),
      alerts,
    };
  });
}

/**
 * Either a typed name or a point from the browser.
 *
 * A coordinate is resolved to a canonical place and then discarded — what is
 * stored is the town the gazetteer named, never the device's fix. Saving a
 * place you are standing in should not record where you were standing.
 */
async function resolveRequest(
  body: Record<string, unknown>,
): Promise<Location | NoData> {
  const place = typeof body.place === 'string' ? body.place.trim() : '';

  if (place) {
    if (place.length > 120) throw new HttpError(400, 'That place name is too long.');
    return placeResolver().resolve(place);
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return resolvePoint(latitude, longitude);
  }

  throw new HttpError(400, 'Send a place name or a coordinate.');
}
