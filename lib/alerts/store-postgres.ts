/**
 * The Postgres store. This is the selectable default, because "running the job
 * twice sends it once" has to be true across processes, not just within one.
 *
 * The connection lives in lib/db/pool.ts, shared with the account tables —
 * one pool per process against the transaction pooler, because a second pool
 * would double the connections an invocation holds against a limit that
 * already assumes a small number.
 *
 * Transaction-pooler consequence worth knowing: prepared statements and
 * session state do not survive between queries, so everything below is a
 * single self-contained statement. No `BEGIN`-spanning logic, no `SET`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, db } from '../db/pool';
import type {
  AlertStore,
  Channel,
  ClaimState,
  DispatchRecord,
  SeenWarning,
  Subscriber,
  SubscriberId,
} from './types';
import type { DistrictId } from '../weather/types';

/** Kept as a local name so the statements below read exactly as they did. */
const getPool = db;

export const postgresStore: AlertStore = {
  name: 'postgres',

  async migrate(): Promise<void> {
    const sql = readFileSync(
      join(process.cwd(), 'migrations', '001_alerts.sql'),
      'utf8',
    );
    // Every statement is IF NOT EXISTS, so concurrent invocations racing this
    // is harmless and it can run on every cold start.
    await getPool().query(sql);
  },

  async subscribersForDistricts(districts: DistrictId[]): Promise<Subscriber[]> {
    if (districts.length === 0) return [];
    const { rows } = await getPool().query(
      `select id, districts, lang, channels, created_at
         from subscribers
        where districts && $1::text[]`,
      [districts],
    );
    return rows.map(rowToSubscriber);
  },

  async allSubscribedDistricts(): Promise<DistrictId[]> {
    const { rows } = await getPool().query(
      `select distinct unnest(districts) as district from subscribers`,
    );
    return rows.map((r) => r.district as DistrictId);
  },

  async upsertSubscriber(subscriber: Subscriber): Promise<void> {
    await getPool().query(
      `insert into subscribers (id, districts, lang, channels, created_at)
       values ($1, $2::text[], $3, $4::jsonb, $5)
       on conflict (id) do update
         set districts = excluded.districts,
             lang      = excluded.lang,
             channels  = excluded.channels`,
      [
        subscriber.id,
        subscriber.districts,
        subscriber.lang,
        JSON.stringify(subscriber.channels),
        subscriber.createdAt,
      ],
    );
  },

  async removeChannel(id: SubscriberId, channel: Channel): Promise<void> {
    // A push endpoint that answers 410 Gone is dead for good; keeping it would
    // mean retrying a subscription that can never succeed again.
    await getPool().query(
      `update subscribers
          set channels = coalesce((
                select jsonb_agg(c)
                  from jsonb_array_elements(channels) c
                 where c <> $2::jsonb
              ), '[]'::jsonb)
        where id = $1`,
      [id, JSON.stringify(channel)],
    );
  },

  /**
   * The atomic claim.
   *
   * One statement, never a read followed by a write. A row comes back only if
   * this runner either inserted the claim or successfully stole an expired
   * lease; two runners firing together means exactly one gets true.
   *
   * The DO UPDATE ... WHERE clause is the part that matters. A plain
   * DO NOTHING would leave a claim from a runner that died standing forever,
   * and the warning would never be sent — a silent drop, which is worse than
   * a duplicate in a system that exists to warn people.
   */
  async claim(
    subscriberId: SubscriberId,
    dispatchKey: string,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<boolean> {
    const { rows } = await getPool().query(
      `insert into dispatch_claims (subscriber_id, dispatch_key, state, attempt, claimed_at)
       values ($1, $2, 'claimed', 1, now())
       on conflict (subscriber_id, dispatch_key) do update
          set claimed_at = now(),
              attempt    = dispatch_claims.attempt + 1,
              state      = 'claimed'
        where dispatch_claims.attempt < $4
          and (
            -- an abandoned lease: the runner that held it never came back
            (dispatch_claims.state = 'claimed'
              and dispatch_claims.claimed_at < now() - ($3::bigint * interval '1 millisecond'))
            -- or a previous attempt failed and is worth retrying
            or dispatch_claims.state = 'failed'
          )
       returning 1`,
      [subscriberId, dispatchKey, leaseMs, maxAttempts],
    );
    return rows.length > 0;
  },

  async settleClaim(
    subscriberId: SubscriberId,
    dispatchKey: string,
    state: Exclude<ClaimState, 'claimed'>,
  ): Promise<void> {
    await getPool().query(
      `update dispatch_claims set state = $3
        where subscriber_id = $1 and dispatch_key = $2`,
      [subscriberId, dispatchKey, state],
    );
  },

  async seenWarnings(district: DistrictId): Promise<SeenWarning[]> {
    const { rows } = await getPool().query(
      `select district, warning_id, fingerprint, severity, valid_to, last_seen_at
         from seen_warnings where district = $1`,
      [district],
    );
    return rows.map((r) => ({
      district: r.district as DistrictId,
      warningId: r.warning_id,
      fingerprint: r.fingerprint,
      severity: r.severity,
      validTo: new Date(r.valid_to).toISOString(),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
    }));
  },

  async markSeen(seen: SeenWarning[]): Promise<void> {
    if (seen.length === 0) return;
    await getPool().query(
      `insert into seen_warnings
         (district, warning_id, fingerprint, severity, valid_to, last_seen_at)
       select * from unnest(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::timestamptz[]
       )
       on conflict (district, warning_id) do update
         set fingerprint  = excluded.fingerprint,
             severity     = excluded.severity,
             valid_to     = excluded.valid_to,
             last_seen_at = excluded.last_seen_at`,
      [
        seen.map((s) => s.district),
        seen.map((s) => s.warningId),
        seen.map((s) => s.fingerprint),
        seen.map((s) => s.severity),
        seen.map((s) => s.validTo),
        seen.map((s) => s.lastSeenAt),
      ],
    );
  },

  async forgetSeen(district: DistrictId, warningIds: string[]): Promise<void> {
    if (warningIds.length === 0) return;
    await getPool().query(
      `delete from seen_warnings where district = $1 and warning_id = any($2::text[])`,
      [district, warningIds],
    );
  },

  async recordDispatch(record: DispatchRecord): Promise<void> {
    await getPool().query(
      `insert into dispatch_log
         (subscriber_id, dispatch_key, warning_id, district, severity,
          kind, channel, result, attempt, latency_ms, error, at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        record.subscriberId,
        record.dispatchKey,
        record.warningId,
        record.district,
        record.severity,
        record.kind,
        record.channel,
        record.result,
        record.attempt,
        record.latencyMs,
        record.error ?? null,
        record.at,
      ],
    );
  },

  async close(): Promise<void> {
    await closeDb();
  },
};

function rowToSubscriber(row: {
  id: string;
  districts: string[];
  lang: string;
  channels: unknown;
  created_at: Date;
}): Subscriber {
  return {
    id: row.id as SubscriberId,
    districts: (row.districts ?? []) as DistrictId[],
    lang: row.lang === 'en' ? 'en' : 'hi',
    channels: (typeof row.channels === 'string'
      ? JSON.parse(row.channels)
      : (row.channels ?? [])) as Channel[],
    createdAt: new Date(row.created_at).toISOString(),
  };
}
