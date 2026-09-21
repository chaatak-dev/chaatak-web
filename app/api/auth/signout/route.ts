/**
 * POST /api/auth/signout
 *
 * Ends the session server-side and clears the cookies. POST rather than GET,
 * because a GET would let any page on the internet sign someone out with an
 * <img> tag — harmless-looking and genuinely annoying at 3am when the reason
 * you have an account is to be warned about a cyclone.
 */

import { supabaseRoute } from '@/lib/auth/server';
import { json } from '@/lib/accounts/route';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const supabase = await supabaseRoute();

  // Not configured means not signed in. Answering ok is the truth.
  if (!supabase) return json({ ok: true });

  // `scope: 'local'` on purpose: this device stops being signed in, other
  // devices stay signed in. Signing out on a borrowed phone should not log
  // someone out of their own.
  const { error } = await supabase.auth.signOut({ scope: 'local' });

  if (error) {
    console.error(JSON.stringify({ event: 'auth.signout.failed', error: error.message }));
    return json({ error: 'Could not sign out. Try again.' }, 500);
  }

  return json({ ok: true });
}
