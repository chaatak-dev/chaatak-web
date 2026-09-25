/**
 * POST /api/climate/explain   { query: "<the analysis's own query string>", lang: "hi" | "en" }
 *
 * The client sends the QUESTION, never the statistics. The analysis is
 * recomputed here — from the archive cache, normally — so the model is only
 * ever shown numbers this server computed, and a tampered request can at
 * most ask about a different place.
 */

import { explainAnalysis } from '@/lib/climate/explain';
import { readQuery } from '@/lib/climate/params';
import { runClimateAnalysis } from '@/lib/climate/service';
import type { ExplainResponse } from '@/lib/climate/types';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let body: { query?: unknown; lang?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send JSON.' }, { status: 400 });
  }
  if (typeof body.query !== 'string' || body.query.length > 600) {
    return Response.json({ error: 'Send the analysis query.' }, { status: 400 });
  }
  const lang = body.lang === 'hi' ? 'hi' : 'en';

  const read = readQuery(new URLSearchParams(body.query));
  if (!read.ok) return Response.json({ error: read.problem }, { status: 400 });

  // Model calls are the scarce resource on free tiers.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = rateLimit(`climate-explain:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) {
    return Response.json({ error: 'Too many requests.' }, { status: 429, headers: { 'retry-after': String(limit.retryAfter) } });
  }

  const analysis = await runClimateAnalysis(read.query);
  let result: ExplainResponse;
  if (analysis.kind !== 'analysis') {
    result = { kind: 'unavailable', reason: 'analysisFailed' };
  } else {
    result = await explainAnalysis(analysis, lang);
  }
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}
