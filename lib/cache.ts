/**
 * Server-side response cache with a per-endpoint TTL.
 *
 * IMD's API guidelines ask for caching and response latency is a scored
 * criterion, so upstream responses are held rather than re-fetched. TTLs are
 * matched to how often each endpoint actually changes: a nowcast moves far
 * more often than a 7-day outlook, and a place name does not move at all.
 *
 * In-process and therefore per-instance and best-effort. Fluid Compute reuses
 * instances across requests so this earns its keep, but nothing depends on a
 * hit. A shared cache can replace this without touching callers.
 */

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();

/** How long each kind of upstream answer stays good for. */
export const TTL = {
  /** Place names do not move. */
  geocode: 24 * 60 * 60 * 1000,
  /** Open-Meteo advances `current` in 15-minute steps. */
  current: 10 * 60 * 1000,
  /** Daily aggregates are rebuilt on the model run. */
  daily: 60 * 60 * 1000,
  /**
   * Parsed queries. Short, because it exists to absorb a burst of people
   * asking the same thing rather than to remember anything for long.
   */
  parse: 10 * 60 * 1000,
} as const;

/**
 * @param shouldCache decides whether a given result is worth keeping. Used to
 *   hold a settled answer (including "no such place", which stays true) while
 *   never caching a transient failure.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await fetcher();
  if (shouldCache(value)) {
    store.set(key, { value, expiresAt: now + ttlMs });
  } else {
    store.delete(key);
  }
  return value;
}
