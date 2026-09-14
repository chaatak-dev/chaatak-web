/**
 * GET /api/weather?place=<name>
 *
 * Runs server-side so no third-party endpoint or key is ever reachable from
 * the browser. Returns only what the adapter returned: this route does no
 * arithmetic on a weather value, fills in no gaps, and substitutes no second
 * source when the first is quiet.
 *
 * An unresolvable place is a 200 carrying an explicit noData state, not an
 * error status — "we do not know" is a valid answer to a valid question. A
 * non-200 is reserved for a malformed request.
 */

import { OUTLOOK_DAYS, type WeatherResponse } from '@/lib/weather/api';
import { placeResolver, weatherSource } from '@/lib/weather/source';
import type { DistrictId } from '@/lib/weather/types';

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get('place');

  if (query === null) {
    return Response.json(
      { error: 'Missing required query parameter: place' },
      { status: 400 },
    );
  }

  const place = await placeResolver().resolve(query);

  // Only NoData carries a `kind`, so this narrows `place` to Location below.
  if ('kind' in place) {
    const body: WeatherResponse = { kind: 'unresolved', query, noData: place };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  }

  const source = weatherSource();

  // Phase 4 replaces this with the real resolver (lat/lon → IMD district
  // Obj_id). Until then the adapter ignores it and answers noData anyway.
  const district = (place.admin2 ?? place.name) as DistrictId;

  const [current, outlook, warnings] = await Promise.all([
    source.getCurrent(place),
    source.getForecast(place, OUTLOOK_DAYS),
    source.getWarnings(district),
  ]);

  const body: WeatherResponse = {
    kind: 'resolved',
    query,
    place,
    current,
    outlook,
    warnings,
  };

  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
