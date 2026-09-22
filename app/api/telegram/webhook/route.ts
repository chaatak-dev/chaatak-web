/**
 * POST /api/telegram/webhook — where Telegram delivers updates.
 *
 * Fast and idempotent, in that order of concern:
 *
 *   1. Authenticate: Telegram's own secret header, compared in constant time.
 *      Anything else is refused before its body is read.
 *   2. Claim the update id. Telegram redelivers an update it thinks we missed,
 *      and a claim is a single atomic insert, so a redelivery — or the same
 *      update reaching two instances at once — is handled exactly once.
 *   3. Acknowledge, and do the work after the response with `after()`.
 *      Telegram waits on this request; the pipeline may call a model. Holding
 *      Telegram's delivery open for that is how a queue backs up.
 *
 * The logic is `handleWebhook` in lib/telegram/webhook.ts, where it is tested;
 * this file supplies the real claim, the real bot and Next's `after`.
 *
 * The honest guarantee is at-most-once for a reply: an instance that dies
 * mid-answer has already acknowledged the update, and Telegram will not send
 * it again. For a chat reply that is the right trade — the person can ask
 * again — and it is not the path alerts take: alerts are dispatched by the
 * cron daemon with its own leases and retries.
 *
 * Never logged: the secret, the token, or anything a person wrote.
 */

import { after } from 'next/server';
import { isMissingSchema } from '@/lib/db/pool';
import { telegramBot } from '@/lib/telegram';
import { postgresTelegramStore } from '@/lib/telegram/store';
import { handleWebhook } from '@/lib/telegram/webhook';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The fallback claim, for when the database cannot be reached.
 *
 * Weather does not need the database, so an outage there must not stop the bot
 * answering. Dedup degrades to per-instance while it lasts — which covers the
 * common redelivery, a retry landing on the instance that is still warm — and
 * says so in the logs.
 */
const seenHere = new Set<number>();

async function claim(updateId: number): Promise<boolean> {
  try {
    return await postgresTelegramStore.claimUpdate(updateId);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: isMissingSchema(error) ? 'telegram.schema.missing' : 'telegram.claim.degraded',
        note: isMissingSchema(error)
          ? 'Telegram tables are missing. Run `npm run migrate`.'
          : 'update dedup is per-instance until the database answers',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    if (seenHere.has(updateId)) return false;
    seenHere.add(updateId);
    if (seenHere.size > 5_000) seenHere.delete(seenHere.values().next().value as number);
    return true;
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleWebhook(request, {
    claim,
    schedule: (task) => after(task),
    handle: (update) => telegramBot().handle(update),
  });
}
