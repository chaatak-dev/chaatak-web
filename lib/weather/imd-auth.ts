/**
 * IMD's access token: getting one, keeping it, and refreshing it safely.
 *
 * IMD authenticates with an email and password posted to an OAuth endpoint,
 * which returns a bearer token good for one hour. Every API call then needs
 * both that token and the separately issued API key.
 *
 * All three secrets stay server-side. Nothing here is importable from a client
 * component, and no value below is ever logged — a token in a log line is a
 * credential in a log line.
 */

import { ConfigurationError } from '../errors';
import { imdFetch } from './imd-transport';

const TOKEN_PATH = 'api/oauth/token.php';

/**
 * Refresh this long before the hour is up.
 *
 * A token that expires between the check and the call fails the request for
 * no reason. Five minutes is far longer than any request takes and costs at
 * most one extra sign-in per hour.
 */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** IMD's documented response. Anything else is treated as a failure. */
type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
};

export type ImdCredentials = {
  email: string;
  password: string;
  apiKey: string;
};

/**
 * Read the credentials, or say precisely what is missing.
 *
 * Throws ConfigurationError rather than returning null so a misconfigured
 * deployment fails at the first call with a message naming the variable,
 * instead of degrading into a generic upstream error that sends someone
 * looking at IMD's status page.
 */
export function imdCredentials(): ImdCredentials {
  const email = process.env.IMD_EMAIL;
  const password = process.env.IMD_PASSWORD;
  const apiKey = process.env.IMD_API_KEY;

  const missing = [
    !email && 'IMD_EMAIL',
    !password && 'IMD_PASSWORD',
    !apiKey && 'IMD_API_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new ConfigurationError(
      `IMD credentials are not configured. Missing: ${missing.join(', ')}.`,
    );
  }

  return { email: email as string, password: password as string, apiKey: apiKey as string };
}

type CachedToken = { token: string; expiresAt: number };

/**
 * Module state, which on Vercel means per function instance.
 *
 * Instances do not share memory, so each one signs in at most once an hour.
 * That is the intended cost: a shared token store would need a database round
 * trip on the read path to save an occasional sign-in, and the read path is
 * what a farmer waits on.
 */
let cached: CachedToken | null = null;

/**
 * The refresh currently in progress, if any.
 *
 * Without this, a cold instance handling several concurrent requests would
 * sign in several times at once — wasteful, and a good way to be rate limited
 * by an API that has every reason to treat a burst of sign-ins as abuse.
 * Callers that arrive mid-refresh await the same promise and share its result.
 */
let inFlight: Promise<string> | null = null;

function isFresh(entry: CachedToken | null, now: number): entry is CachedToken {
  return entry !== null && now < entry.expiresAt;
}

async function signIn(credentials: ImdCredentials, timeoutMs: number): Promise<string> {
  // Through the gateway when one is configured: an API that allowlists data
  // requests by IP has every reason to allowlist the sign-in too.
  const response = await imdFetch(
    TOKEN_PATH,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    // The status, never the body: a failed sign-in response can echo back
    // what was sent.
    throw new Error(`IMD sign-in failed with HTTP ${response.status}`);
  }

  let body: TokenResponse;
  try {
    body = (await response.json()) as TokenResponse;
  } catch {
    throw new Error('IMD sign-in returned a body that was not JSON');
  }

  if (!body.access_token) {
    throw new Error('IMD sign-in returned no access_token');
  }

  // Documented as 3600. Trusted when present and sane, defaulted when not,
  // because a missing or absurd lifetime must not produce a token treated as
  // eternal.
  const lifetimeSeconds =
    typeof body.expires_in === 'number' && body.expires_in > 0 && body.expires_in <= 86_400
      ? body.expires_in
      : 3600;

  const lifetimeMs = lifetimeSeconds * 1000;
  cached = {
    token: body.access_token,
    // Never let the skew push the expiry into the past on a short-lived token.
    expiresAt: Date.now() + Math.max(lifetimeMs - REFRESH_SKEW_MS, lifetimeMs / 2),
  };

  return cached.token;
}

/**
 * A valid bearer token, signing in only when there is no usable one.
 */
export async function imdToken(
  credentials: ImdCredentials = imdCredentials(),
  timeoutMs = 15_000,
): Promise<string> {
  if (isFresh(cached, Date.now())) return cached.token;
  if (inFlight) return inFlight;

  inFlight = signIn(credentials, timeoutMs).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Drop the cached token so the next call signs in again.
 *
 * Called when IMD rejects a token that had not reached its stated expiry —
 * a revoked or server-side-invalidated token looks exactly like a valid one
 * from here, and the only way to find out is to be refused.
 */
export function forgetImdToken(): void {
  cached = null;
}

/** Test seam. Never called by application code. */
export function __setImdTokenForTests(token: string | null, expiresAt = 0): void {
  cached = token === null ? null : { token, expiresAt };
  inFlight = null;
}
