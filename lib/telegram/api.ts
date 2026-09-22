/**
 * The one Telegram Bot API client.
 *
 * Both halves of the integration go through here — the bot answering a
 * question and the alert daemon delivering a warning — so there is one place
 * that knows how Telegram fails and what each failure means.
 *
 * THE TOKEN NEVER LEAVES THIS FILE. It is part of every request URL, which is
 * why no URL is ever logged or returned, and why a network error is reduced to
 * its name rather than its message: Node's fetch errors can carry the address
 * they were trying to reach.
 *
 * Every call returns a result rather than throwing. The caller always has to
 * decide what a failure means for it — a reply that did not send is not the
 * same thing as an alert that did not send — and a thrown error is how that
 * decision gets skipped.
 */

const DEFAULT_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The longest `retry_after` honoured inline. Telegram's flood control can ask
 * for minutes; sleeping that long inside a webhook invocation would hold the
 * function open for nothing, so a longer wait is returned to the caller.
 */
const MAX_INLINE_WAIT_MS = 5_000;

export type TelegramFailure = {
  ok: false;
  /** HTTP status, or 0 when nothing came back at all. */
  status: number;
  /** Telegram's own description, or the error's name. Never a URL. */
  description: string;
  /** Seconds Telegram asked us to wait, on a 429. */
  retryAfter?: number;
};

export type TelegramResult<T> = { ok: true; result: T } | TelegramFailure;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/**
 * Where the Bot API lives.
 *
 * Overridable for Telegram's own self-hosted Bot API server and for local
 * end-to-end runs against a recording stub. Plain http is accepted only for
 * loopback, so a typo cannot send the token across a network unencrypted.
 */
export function apiBase(env: Record<string, string | undefined> = process.env): string {
  const raw = env.TELEGRAM_API_BASE?.trim();
  if (!raw) return DEFAULT_BASE;

  try {
    const url = new URL(raw);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) {
      return raw.replace(/\/+$/, '');
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_BASE;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type CallOptions = {
  timeoutMs?: number;
  /**
   * Extra attempts on a transient failure — a network error, a 5xx, or a 429
   * short enough to wait out. Zero by default: the alert dispatcher runs its
   * own retry policy, and two stacked policies multiply rather than add.
   */
  retries?: number;
};

export async function callTelegram<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  options: CallOptions = {},
): Promise<TelegramResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, status: 0, description: 'TELEGRAM_BOT_TOKEN is not set' };
  }

  const retries = options.retries ?? 0;

  for (let attempt = 0; ; attempt++) {
    const result = await once<T>(token, method, params, options.timeoutMs);
    if (result.ok) return result;
    if (attempt >= retries || !transient(result)) return result;

    // Telegram says exactly how long to wait on a 429; guessing shorter is how
    // a bot gets its limit tightened.
    const waitMs =
      result.status === 429 ? (result.retryAfter ?? 1) * 1000 : 300 * (attempt + 1);
    if (waitMs > MAX_INLINE_WAIT_MS) return result;
    await sleep(waitMs);
  }
}

async function once<T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TelegramResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    // The name only. The message may carry the URL, and the URL carries the
    // token.
    return {
      ok: false,
      status: 0,
      description: error instanceof Error ? error.name : 'network',
    };
  }

  let body: {
    ok?: boolean;
    result?: T;
    description?: string;
    parameters?: { retry_after?: number };
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* the status alone decides */
  }

  if (res.ok && body.ok !== false) return { ok: true, result: body.result as T };

  return {
    ok: false,
    status: res.status,
    description: body.description ?? `HTTP ${res.status}`,
    ...(body.parameters?.retry_after !== undefined
      ? { retryAfter: body.parameters.retry_after }
      : {}),
  };
}

/** Worth another attempt: nothing came back, the server failed, or flood control. */
export function transient(failure: TelegramFailure): boolean {
  return failure.status === 0 || failure.status === 429 || failure.status >= 500;
}

/**
 * The chat is unreachable for good: the person blocked the bot, deleted their
 * account, or the chat never existed.
 *
 * Deliberately narrow. The old sender treated EVERY 400 as a dead chat, so a
 * message Telegram merely refused to parse — a district name with an
 * underscore in Markdown — would have removed the channel and silenced every
 * warning after it. A malformed message is a bug to fix, not a person who
 * left.
 */
export function chatIsGone(failure: TelegramFailure): boolean {
  if (failure.status === 403) return true;
  if (failure.status !== 400) return false;
  return /chat not found|user not found|user is deactivated|bot was blocked|peer_id_invalid|chat_id is empty/i.test(
    failure.description,
  );
}

/* ------------------------------------------------------------------ */
/* Who the bot is                                                      */
/* ------------------------------------------------------------------ */

let username: Promise<string | null> | null = null;

/**
 * The bot's @username, from getMe, fetched once per process.
 *
 * Needed to build a t.me deep link. It is not a secret and does not change,
 * so asking Telegram once is enough; a failure is not cached, so the next
 * caller tries again rather than inheriting a transient outage.
 */
export function botUsername(): Promise<string | null> {
  if (!username) {
    username = callTelegram<{ username?: string }>('getMe', {}, { retries: 1 }).then(
      (result) => {
        if (result.ok && result.result.username) return result.result.username;
        username = null;
        return null;
      },
    );
  }
  return username;
}

/** Test seam. */
export function resetBotIdentity(): void {
  username = null;
}
