/**
 * Who is asking, decided on the server.
 *
 * THE RULE HERE: a user id never comes from the request body, a query string,
 * a header the browser controls, or anything else the client can write. It
 * comes from `getUser()`, which sends the session token to Supabase Auth and
 * gets back the user the token actually belongs to.
 *
 * `getSession()` is not used anywhere in this codebase, on purpose. It decodes
 * the cookie and hands back whatever it says without checking a signature —
 * which is fine for deciding whether to render a sign-in button, and is not
 * fine for deciding whose conversations to return. The two calls look
 * interchangeable and are not, so the safe one is the only one wired up.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { AUTH_UNCONFIGURED, authConfig } from './config';

/** The authenticated identity, reduced to what Chaatak actually uses. */
export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * A Supabase client bound to this request's cookies.
 *
 * Returns null when accounts are not configured, so every caller has to say
 * what it does in that case rather than crashing into it.
 */
export async function supabaseRoute() {
  const config = authConfig();
  if (!config) return null;

  const store = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (written) => {
        /*
         * Refreshed tokens are written straight back onto the response.
         *
         * This throws when called from a Server Component, where cookies are
         * read-only. Chaatak reads identity only in route handlers, which can
         * write — but swallowing it keeps a future Server Component read from
         * failing the whole render over a token rotation it did not need to
         * perform. The browser client refreshes on its own schedule anyway.
         */
        try {
          for (const { name, value, options } of written) {
            store.set(name, value, options);
          }
        } catch {
          /* read-only cookie store: the refresh simply does not persist here */
        }
      },
    },
  });
}

/**
 * The signed-in user, or null.
 *
 * Null covers every "not signed in" case there is — no cookie, an expired
 * one, a forged one, a revoked session, or accounts switched off entirely.
 * Callers that need to tell those apart do not exist: the answer is the same.
 */
export async function currentUser(): Promise<AuthUser | null> {
  const supabase = await supabaseRoute();
  if (!supabase) return null;

  /*
   * A thrown error here means the auth service could not be reached at all.
   *
   * It is answered the same way as a missing cookie — null — because the
   * question is "can this request prove who it is", and during an outage the
   * answer is no. Granting access on an unverifiable token would be the other
   * way to resolve it, and it is not a way this codebase resolves anything.
   *
   * The cost is that a signed-in person briefly sees a sign-in button. The
   * alternative is that an auth outage takes the forecast down with it, which
   * is the one thing this product cannot afford: the weather path never
   * touches an account and must keep answering.
   */
  let data: Awaited<ReturnType<typeof supabase.auth.getUser>>['data'];

  try {
    const result = await supabase.auth.getUser();
    if (result.error || !result.data.user) return null;
    data = result.data;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'auth.unreachable',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }

  if (!data.user) return null;

  const meta = data.user.user_metadata ?? {};

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    // Google supplies `full_name`; `name` is what other providers use, and
    // `preferred_username` is the last resort before showing an email.
    name:
      pickString(meta.full_name) ??
      pickString(meta.name) ??
      pickString(meta.preferred_username),
    avatarUrl: pickString(meta.avatar_url) ?? pickString(meta.picture),
  };
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Thrown by `requireUser`. Carries the status the route should answer with. */
export class AuthRequiredError extends Error {
  readonly status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthRequiredError';
    this.status = status;
  }
}

/**
 * The user, or a thrown 401.
 *
 * Every account route starts with this. Nothing reads a body before it: a
 * request with no session is refused before it can describe what it wanted.
 */
export async function requireUser(): Promise<AuthUser> {
  if (!authConfig()) throw new AuthRequiredError(AUTH_UNCONFIGURED, 503);

  const user = await currentUser();
  if (!user) throw new AuthRequiredError('Sign in to use this.', 401);

  return user;
}
