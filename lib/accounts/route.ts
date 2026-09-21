/**
 * The shape every account route shares: who is asking, what went wrong, and
 * how that is reported.
 *
 * It exists so that no route has to remember to check the session, and so
 * that a database that has not been migrated reports the one thing that fixes
 * it rather than a 500 with a Postgres error code in it.
 */

import { AUTH_UNCONFIGURED } from '../auth/config';
import { AuthRequiredError, requireUser, type AuthUser } from '../auth/server';
import { isConfigurationError, mayRevealConfiguration } from '../errors';
import { isMissingSchema } from '../db/pool';
import { LIMITS, rateLimit } from '../ratelimit';

export type AccountHandler<T> = (user: AuthUser) => Promise<T>;

const NO_STORE = { 'cache-control': 'no-store' } as const;

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Run a handler with an authenticated user, turning every known failure into
 * a stated one.
 *
 * The catch-all deliberately does not echo an unknown error to the client.
 * An account route's failures can carry row contents, and a message that
 * helps a developer is a message that describes somebody's data.
 */
export async function withUser<T>(handler: AccountHandler<T>): Promise<Response> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }

  try {
    const body = await handler(user);
    return json(body ?? { ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, ...error.extra }, error.status);
    }

    /*
     * The tables are not there. Every other database error is a fault; this
     * one is a task, and naming it saves an hour of reading stack traces for
     * a fix that is one command long.
     */
    if (isMissingSchema(error)) {
      console.error(
        JSON.stringify({ event: 'accounts.schema.missing', error: String(error) }),
      );
      return json(
        {
          error:
            'The account tables are not present. Run `node scripts/migrate.mjs`.',
          kind: 'configuration',
        },
        503,
      );
    }

    if (isConfigurationError(error)) {
      console.error(
        JSON.stringify({ event: 'accounts.misconfigured', error: error.message }),
      );
      return json(
        {
          error: mayRevealConfiguration() ? error.message : AUTH_UNCONFIGURED,
          kind: 'configuration',
        },
        503,
      );
    }

    console.error(
      JSON.stringify({
        event: 'accounts.failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
}

/** A refusal a handler can throw, with the status it should answer with. */
export class HttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

/** Throws a 429 when this user has been doing something too fast. */
export function guardRate(
  action: keyof typeof LIMITS,
  userId: string,
): void {
  const { limit, windowMs } = LIMITS[action];
  const result = rateLimit(`${action}:${userId}`, limit, windowMs);
  if (!result.ok) {
    throw new HttpError(429, 'Too many requests. Try again shortly.', {
      retryAfter: result.retryAfter,
    });
  }
}

/** Reads a JSON body, or throws a stated 400. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('not an object');
    }
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Malformed request body.');
  }
}

/** A non-empty string, trimmed and capped, or null. */
export function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}
