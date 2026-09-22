/**
 * GET /api/weather?place=<name>
 * GET /api/weather?lat=<n>&lon=<n>
 *
 * One canonical weather snapshot for one resolved location. Runs server-side
 * so no third-party endpoint or key is ever reachable from the browser.
 * Returns only what the adapters returned: this route does no arithmetic on a
 * weather value, fills in no gaps, and substitutes no second source when the
 * first is quiet.
 *
 * Current conditions and the outlook come from Open-Meteo; warnings come from
 * IMD. That division is the adapters' business, not this route's — but it is
 * why a snapshot can carry a live model reading beside a bulletin issued this
 * morning, each with its own provenance and its own age.
 *
 * An unresolvable place is a 200 carrying an explicit noData state, not an
 * error status — "we do not know" is a valid answer to a valid question. A
 * non-200 is reserved for a malformed request.
 */

import type { WeatherResponse } from '@/lib/weather/api';
import { placeResolver } from '@/lib/weather/source';
import { resolvePoint } from '@/lib/weather/point';
import { snapshotFor } from '@/lib/weather/snapshot';
import { readCoords } from '@/lib/chat/coords';
import type { Location, NoData } from '@/lib/weather/types';

export const dynamic = 'force-dynamic';

/**
 * A name or a point, resolved through the ONE place pipeline.
 *
 * A coordinate goes to the gazetteer rather than to a reverse geocoder, for
 * the same reason it does in chat: a second index could disagree with the
 * first about where Barabanki is, and a place that resolves differently
 * depending on how you named it is the bug that pipeline exists to prevent.
 */
async function resolve(url: URL): Promise<Location | NoData | null> {
  const place = url.searchParams.get('place');
  if (place !== null) return placeResolver().resolve(place);

  const coords = readCoords({
    latitude: url.searchParams.get('lat'),
    longitude: url.searchParams.get('lon'),
  });
  if (coords) return resolvePoint(coords.latitude, coords.longitude);

  return null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query =
    url.searchParams.get('place') ??
    `${url.searchParams.get('lat') ?? ''},${url.searchParams.get('lon') ?? ''}`;

  const place = await resolve(url);

  if (place === null) {
    return Response.json(
      { error: 'Send a place name, or a lat and lon.' },
      { status: 400 },
    );
  }

  // Only NoData carries a `kind`, so this narrows `place` to Location below.
  if ('kind' in place) {
    const body: WeatherResponse = { kind: 'unresolved', query, noData: place };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  }

  // The same assembly the chat pipeline and the Telegram bot use.
  const { current, outlook, warnings, fetchedAt } = await snapshotFor(place);

  const body: WeatherResponse = {
    kind: 'resolved',
    query,
    place,
    current,
    outlook,
    warnings,
  };

  return Response.json(
    { ...body, fetchedAt },
    { headers: { 'cache-control': 'no-store' } },
  );
}
