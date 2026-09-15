/**
 * Which store to use — the one config value.
 *
 * Postgres is the default, deliberately. "Running the job twice sends it once"
 * is the headline guarantee of this phase, and it is only true across
 * processes if the claim is an atomic write in a shared database. The memory
 * store is single-process and would make that guarantee look true in a demo
 * while being false in production.
 */

import { createMemoryStore } from './store-memory';
import { postgresStore } from './store-postgres';
import type { AlertStore } from './types';

export function alertStore(): AlertStore {
  const choice = process.env.ALERT_STORE ?? 'postgres';

  if (choice === 'memory') {
    console.warn(
      JSON.stringify({
        event: 'alerts.store.memory',
        warning:
          'in-memory store: dedup holds within one process only, NOT across concurrent invocations',
      }),
    );
    return createMemoryStore();
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'ALERT_STORE=postgres needs DATABASE_URL. Set it, or set ALERT_STORE=memory ' +
        'for a single-process run (which cannot deduplicate across invocations).',
    );
  }

  return postgresStore;
}
