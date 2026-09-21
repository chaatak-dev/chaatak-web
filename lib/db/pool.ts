/**
 * The one Postgres pool.
 *
 * Connects through Supabase's transaction pooler (port 6543). Vercel opens a
 * connection per invocation and a direct connection would exhaust the limit,
 * so the pool here is deliberately tiny and short-lived — the pooler is the
 * real pool.
 *
 * ONE pool for the whole process, not one per module. The alert store had its
 * own; accounts arriving with a second would have doubled the connections an
 * invocation holds against a limit that already assumes a small number.
 *
 * Transaction-pooler consequence worth knowing: prepared statements and
 * session state do not survive between queries, so every caller sends a single
 * self-contained statement. No `BEGIN`-spanning logic, no `SET`.
 *
 * Nothing here bypasses ownership. Queries run as `postgres`, which holds
 * BYPASSRLS, so row-level security is not what protects one account from
 * another on this path — every statement in lib/accounts scopes itself by a
 * user id taken from a validated session. RLS guards the other door, the
 * public PostgREST one, which the browser can reach with the anon key.
 */

import { Pool } from 'pg';
import { ConfigurationError } from '../errors';

let pool: Pool | null = null;

export function db(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ConfigurationError(
      'DATABASE_URL is not set. Accounts, chat history and monitored ' +
        'locations all read from Postgres; weather queries do not.',
    );
  }

  pool = new Pool({
    connectionString,
    // Supabase's pooler terminates TLS with its own certificate chain.
    ssl: { rejectUnauthorized: false },
    // The pooler is the pool. Holding more than a couple here per invocation
    // is what exhausts the limit.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return pool;
}

/** Closes the pool. Tests and scripts; a serverless invocation never calls it. */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

/**
 * Postgres error codes this codebase reacts to by name rather than by digits.
 *
 * `uniqueViolation` is load-bearing: the three-location limit and the
 * duplicate-district rule are both unique constraints, and catching the
 * violation is how a concurrent fourth insert is refused. A count-then-insert
 * would let two requests past the same check.
 */
export const PG_ERROR = {
  uniqueViolation: '23505',
  undefinedTable: '42P01',
  foreignKeyViolation: '23503',
} as const;

export function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * True when the failure is "these tables do not exist yet".
 *
 * Worth telling apart from every other database error, because the fix is
 * `node scripts/migrate.mjs` and no amount of retrying will find it.
 */
export function isMissingSchema(error: unknown): boolean {
  return isPgError(error, PG_ERROR.undefinedTable);
}
