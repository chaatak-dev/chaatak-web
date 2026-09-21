/**
 * A coarse guard on account mutations.
 *
 * WHAT THIS IS HONESTLY WORTH: it holds within one serverless instance and
 * nowhere else. Vercel runs several concurrently, each with its own module
 * state, so a determined caller spreading requests across instances gets a
 * multiple of the limit. It is a guard against a stuck retry loop or a
 * hammering script, not a security boundary.
 *
 * The security boundaries are elsewhere and are real: the three-location
 * limit is a unique constraint, message writes are idempotent on a client id,
 * and every statement is scoped to a user id from a validated session. None
 * of those get weaker if this counter is bypassed — which is the property
 * that makes an approximate limiter acceptable here rather than a pretence.
 *
 * A shared counter in Postgres would be exact, and would also put a write on
 * the path of every read to protect against something the constraints above
 * already make harmless.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Sweeps expired buckets so a long-lived instance does not grow forever. */
function sweep(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the window resets. Sent as Retry-After on a refusal. */
  retryAfter: number;
};

/**
 * Count one attempt against a fixed window.
 *
 * @param key    what is being limited — usually `${action}:${userId}`
 * @param limit  attempts allowed per window
 * @param windowMs length of the window
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  return { ok: true, retryAfter: 0 };
}

/** Test seam. Nothing in the app calls this. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * The limits, in one place so they can be read as a set.
 *
 * Deliberately loose. Someone adding three locations, renaming two chats and
 * asking a dozen questions in a minute is using the product, not attacking
 * it, and a limiter that catches them is a bug.
 */
export const LIMITS = {
  /** Creating or deleting conversations. */
  conversations: { limit: 60, windowMs: 60_000 },
  /** Adding or removing monitored locations — a slow, deliberate action. */
  locations: { limit: 20, windowMs: 60_000 },
  /** Adopting a guest transcript. Once per sign-in in practice. */
  import: { limit: 10, windowMs: 60_000 },
  /** Deleting the account. Irreversible, so a retry loop is the only caller. */
  destructive: { limit: 5, windowMs: 300_000 },
} as const;
