/**
 * POST /api/cron/warnings  — the alert daemon.
 *
 * Polls district warnings independently of user activity, decides what is new,
 * and dispatches. Runs as an authenticated endpoint rather than a long-running
 * process because Vercel has no long-running processes — and because an
 * endpoint is a curl you can watch, which makes "run it twice" something you
 * can see rather than something you take on faith.
 *
 * Safe to invoke concurrently. Dedup is an atomic claim in Postgres, not a
 * single-runner assumption.
 */

import { dispatchAll } from '@/lib/alerts/dispatch';
import { decidePoll } from '@/lib/alerts/poll';
import { alertStore } from '@/lib/alerts/store';
import type { PollDecision } from '@/lib/alerts/types';
import { weatherSource } from '@/lib/weather/source';
import type { DistrictId } from '@/lib/weather/types';

/** Never prerendered, never cached: it has side effects by definition. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Without a secret configured the endpoint stays shut rather than open.
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }
  return runPoll();
}

/** Vercel Cron issues GET. Same work, same guard. */
export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }
  return runPoll();
}

async function runPoll(): Promise<Response> {
  const started = Date.now();
  const store = alertStore();
  const now = new Date();

  try {
    await store.migrate();

    const districts = (await store.allSubscribedDistricts()) as DistrictId[];
    if (districts.length === 0) {
      return Response.json({
        ok: true,
        districts: 0,
        note: 'no subscriptions yet',
        latencyMs: Date.now() - started,
      });
    }

    const source = weatherSource();
    const decisions: PollDecision[] = [];
    const perDistrict: Record<string, unknown>[] = [];

    for (const district of districts) {
      const answer = await source.getWarnings(district);

      // noData means the source has no warning product — we do not know, so
      // nothing is withdrawn and nothing is dispatched. Only an explicit
      // answer (a list, or noWarning) says anything about this district.
      const current = Array.isArray(answer)
        ? answer
        : answer.kind === 'noWarning'
          ? []
          : null;

      if (current === null) {
        perDistrict.push({ district, skipped: 'source has no warning product' });
        continue;
      }

      const seen = await store.seenWarnings(district);
      const outcome = decidePoll({ district, current, seen, now });

      await store.markSeen(outcome.toMark);
      if (outcome.toForget.length > 0) {
        await store.forgetSeen(district, outcome.toForget);
      }
      decisions.push(...outcome.decisions);

      // Enough per poll to tell a genuine reissue from a restatement: each
      // fingerprint seen this time, and whether it differs from the record.
      perDistrict.push({
        district,
        inForce: current.length,
        warnings: outcome.toMark.map((m) => ({
          id: m.warningId,
          severity: m.severity,
          fingerprint: m.fingerprint,
          changed: !seen.some(
            (s) => s.warningId === m.warningId && s.fingerprint === m.fingerprint,
          ),
        })),
        withdrawn: outcome.withdrawn,
        expired: outcome.expired,
      });
    }

    const subscribers = await store.subscribersForDistricts(districts);
    const summary = await dispatchAll(store, decisions, subscribers);

    const body = {
      ok: true,
      at: now.toISOString(),
      store: store.name,
      source: source.name,
      districts: districts.length,
      subscribers: subscribers.length,
      decisions: decisions.length,
      dispatch: summary,
      perDistrict,
      latencyMs: Date.now() - started,
    };

    console.log(JSON.stringify({ event: 'cron.warnings', ...body }));
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'cron.warnings.failed', error: message }));
    return Response.json(
      { ok: false, error: message, latencyMs: Date.now() - started },
      { status: 500 },
    );
  }
}
