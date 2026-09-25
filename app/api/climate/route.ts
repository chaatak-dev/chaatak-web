/**
 * GET /api/climate?place=…&from=…&to=…&baseline=…&params=…&res=…&season=…&preset=…
 *
 * One historical climate analysis for one resolved place. Runs server-side:
 * decades of daily reanalysis are fetched, cached and reduced here, and only
 * the summaries cross the network — a few hundred numbers, not tens of
 * thousands of days.
 *
 * Like /api/weather, "we could not find that place" and "the archive has
 * nothing" are 200s carrying an explicit state. A non-200 is reserved for a
 * malformed request.
 */

import { readQuery } from '@/lib/climate/params';
import { runClimateAnalysis } from '@/lib/climate/service';
import type { ClimateResponse } from '@/lib/climate/types';

export const dynamic = 'force-dynamic';

/** Decades of reanalysis take a few seconds upstream on a cold cache. */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const read = readQuery(url.searchParams);
  if (!read.ok) {
    const body: ClimateResponse = { kind: 'invalid', problem: read.problem };
    return Response.json(body, { status: 400 });
  }

  const body = await runClimateAnalysis(read.query);
  const status = body.kind === 'failed' && body.reason === 'rateLimited' ? 503 : 200;
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...(status === 503 ? { 'retry-after': '60' } : {}),
    },
  });
}
