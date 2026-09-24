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
   * District warnings.
   *
   * Short, and shorter than the alert daemon's polling interval on purpose:
   * if the cache outlived the poll, a reissued warning could sit unnoticed for
   * a whole cycle, and silence is the dangerous direction for this one value.
   * IMD's guidelines ask callers to cache, which this still does -- a burst of
   * visitors asking about one district is one upstream call.
   */
  warnings: 3 * 60 * 1000,
  /**
   * Parsed queries. Short, because it exists to absorb a burst of people
   * asking the same thing rather than to remember anything for long.
   */
  parse: 10 * 60 * 1000,
  /**
   * The recent past, hour by hour. Its newest end advances every hour, so
   * holding it longer than that would stop "the last 24 hours" moving.
   */
  history: 20 * 60 * 1000,
  /**
   * Reanalysis of days long gone. Last April does not change, but the
   * reanalysis is still being filled in for the most recent days, so a day
   * rather than forever.
   */
  archive: 24 * 60 * 60 * 1000,
  /**
   * CPCB's station network. The feed is published hourly, so a quarter of an
   * hour keeps a new hour from waiting long while one request serves every
   * place and the map alike.
   */
  airStations: 15 * 60 * 1000,
} as const;

/** Drop one entry, so the next read goes upstream. */
export function forget(key: string): void {
  store.delete(key);
}

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
