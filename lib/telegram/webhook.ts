/**
 * The webhook's front door: is this Telegram, and is this an update.
 *
 * Pure, so the checks that matter most are tested without a server.
 *
 * AUTHENTICATION is Telegram's own: setWebhook registers a secret, and
 * Telegram sends it back on every delivery in X-Telegram-Bot-Api-Secret-Token.
 * It is compared in constant time, and with no secret configured the endpoint
 * stays shut rather than open — the same stance the cron endpoint takes.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { TgUpdate } from './types';

export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Telegram's updates are small — a message is at most 4096 characters. Far
 * above any real update, far below anything that could hurt.
 */
export const MAX_BODY_BYTES = 256 * 1024;

export type Verdict = 'ok' | 'denied' | 'unconfigured';

export function authenticate(
  presented: string | null,
  secret: string | undefined = process.env.TELEGRAM_WEBHOOK_SECRET,
): Verdict {
  if (!secret) return 'unconfigured';
  if (!presented) return 'denied';

  // Hash both sides first: timingSafeEqual needs equal lengths, and comparing
  // lengths directly would say how long the secret is.
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(secret, 'utf8').digest();
  return timingSafeEqual(a, b) ? 'ok' : 'denied';
}

export type ReadResult =
  | { ok: true; update: TgUpdate }
  | { ok: false; status: 400 | 413; error: string };

/**
 * The body, as an update — or why not.
 *
 * Only the envelope is checked here: a JSON object with a positive integer
 * update_id. What is inside is Telegram's to define and the bot's to read
 * defensively; an update type the bot does not know is acknowledged and
 * ignored, never refused, because refusing it would make Telegram redeliver
 * it and hold up every update behind it.
 */
export async function readUpdate(request: Request): Promise<ReadResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'too large' };

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'unreadable body' };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'too large' };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: 'malformed json' };
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'not an object' };
  }

  const id = (body as { update_id?: unknown }).update_id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
    return { ok: false, status: 400, error: 'no update_id' };
  }

  return { ok: true, update: body as TgUpdate };
}

export type WebhookDeps = {
  /** True the first time an update id is seen. */
  claim(updateId: number): Promise<boolean>;
  /** Run after the response — `after()` in the route, immediate in a test. */
  schedule(task: () => Promise<void>): void;
  handle(update: TgUpdate): Promise<unknown>;
  secret?: string;
};

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * The whole webhook, minus the framework: authenticate, read, claim,
 * acknowledge, and hand the work to `schedule`.
 */
export async function handleWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const verdict = authenticate(
    request.headers.get(SECRET_HEADER),
    'secret' in deps ? deps.secret : process.env.TELEGRAM_WEBHOOK_SECRET,
  );

  if (verdict === 'unconfigured') {
    console.error(
      JSON.stringify({ event: 'telegram.webhook.unconfigured', missing: 'TELEGRAM_WEBHOOK_SECRET' }),
    );
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
  // Refused before the body is read: an unauthenticated caller learns nothing
  // about what a well-formed update would have to look like.
  if (verdict === 'denied') {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const read = await readUpdate(request);
  if (!read.ok) {
    console.warn(JSON.stringify({ event: 'telegram.webhook.rejected', reason: read.error }));
    return Response.json({ ok: false, error: read.error }, { status: read.status, headers: NO_STORE });
  }

  const { update } = read;

  if (!(await deps.claim(update.update_id))) {
    // Already handled. Acknowledged, so Telegram stops redelivering it.
    return Response.json({ ok: true, duplicate: true }, { headers: NO_STORE });
  }

  deps.schedule(async () => {
    await deps.handle(update);
  });

  return Response.json({ ok: true }, { headers: NO_STORE });
}
