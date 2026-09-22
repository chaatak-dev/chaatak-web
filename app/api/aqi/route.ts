/**
 * GET /api/aqi?lat=<n>&lon=<n>
 *
 * Air quality for a point, through the provider abstraction. Server-side like
 * every other upstream call.
 *
 * Separate from /api/weather deliberately: it is a different provider on a
 * different cadence, and a slow or failing air-quality service must not delay
 * or fail the temperature. The rail asks for it only when the reader selects
 * the AQI metric.
 */

import { airQualitySource } from '@/lib/weather/aqi';
import { readCoords } from '@/lib/chat/coords';
import { resolvePoint } from '@/lib/weather/point';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const coords = readCoords({
    latitude: url.searchParams.get('lat'),
    longitude: url.searchParams.get('lon'),
  });

  if (!coords) {
    return Response.json({ error: 'Send a lat and lon.' }, { status: 400 });
  }

  // Resolved through the gazetteer so the answer names a place and carries a
  // timezone, exactly as the weather snapshot does.
  const place = resolvePoint(coords.latitude, coords.longitude);
  if ('kind' in place) {
    return Response.json(
      { kind: 'unresolved', noData: place },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const air = await airQualitySource().get(place);

  return Response.json(
    { kind: 'resolved', place, air },
    { headers: { 'cache-control': 'no-store' } },
  );
}
