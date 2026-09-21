/**
 * GET /api/auth/callback
 *
 * Where Google sends the browser back to. Exchanges the one-time code for a
 * session and writes it into cookies, which is why this is a route handler
 * and not a page: a Server Component cannot set a cookie.
 *
 * The code is single-use and short-lived, and the PKCE verifier that unlocks
 * it is a cookie this browser holds — so a code lifted from a server log or a
 * referrer header is worth nothing to anyone else.
 */

import { NextResponse } from 'next/server';
import { supabaseRoute } from '@/lib/auth/server';
import { upsertProfile } from '@/lib/accounts/store';

export const dynamic = 'force-dynamic';

/**
 * Where to go afterwards.
 *
 * Only a path on this site is accepted. A full URL here would be an open
 * redirect: sign-in links are exactly what gets forwarded to people, and
 * "chaatak.com asked me to sign in and then sent me somewhere else" is the
 * whole shape of that attack.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const code = url.searchParams.get('code');

  // Google's own refusal — the person cancelled, or the app is not approved.
  // Carried through as a query parameter so the page can say what happened
  // rather than silently landing them back where they started.
  const providerError =
    url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (providerError || !code) {
    console.warn(
      JSON.stringify({
        event: 'auth.callback.refused',
        reason: providerError ?? 'no code in callback',
      }),
    );
    return NextResponse.redirect(failedUrl(next, url.origin));
  }

  const supabase = await supabaseRoute();
  if (!supabase) {
    const unavailable = new URL(next, url.origin);
    unavailable.searchParams.set('signin', 'unavailable');
    return NextResponse.redirect(unavailable);
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error(
      JSON.stringify({ event: 'auth.exchange.failed', error: error?.message }),
    );
    return NextResponse.redirect(failedUrl(next, url.origin));
  }

  /*
   * Mirror the profile now, not on the first request that needs it.
   *
   * Everything else about an account hangs off this row, and doing it here
   * means the sidebar's first read finds a name and an avatar already there
   * instead of an account that exists but has nothing to show for itself.
   *
   * A failure is logged and swallowed: the session is valid either way, and
   * refusing to sign someone in because a display name did not save would be
   * the wrong trade.
   */
  try {
    await upsertProfile({
      id: data.user.id,
      email: data.user.email ?? null,
      name: readMeta(data.user.user_metadata, ['full_name', 'name']),
      avatarUrl: readMeta(data.user.user_metadata, ['avatar_url', 'picture']),
    });
  } catch (profileError) {
    console.error(
      JSON.stringify({
        event: 'auth.profile.failed',
        error:
          profileError instanceof Error
            ? profileError.message
            : String(profileError),
      }),
    );
  }

  // `signin=ok` is the signal the page waits for before offering to bring a
  // guest conversation across. Without it the client would have to poll for a
  // session that arrived while it was navigating.
  const destination = new URL(next, url.origin);
  destination.searchParams.set('signin', 'ok');

  return NextResponse.redirect(destination);
}

/** `next` may already carry a query string, so the flag is set, not appended. */
function failedUrl(next: string, origin: string): URL {
  const url = new URL(next, origin);
  url.searchParams.set('signin', 'failed');
  return url;
}

function readMeta(
  meta: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = meta?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
