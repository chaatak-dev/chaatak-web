'use client';

/**
 * The browser's Supabase client. Sign-in, sign-out, and keeping the session
 * cookie fresh — nothing else.
 *
 * No Chaatak data is read through this client. Conversations, messages and
 * monitored locations all go through Chaatak's own API routes, which validate
 * the session server-side and scope every statement by the user id they got
 * back. Reading directly from the browser would work — row-level security
 * would allow it — but it would put the ownership rules in two places, and the
 * copy in the database is the one that is hard to change in a hurry.
 *
 * Storage is cookies, not localStorage, so the server sees the same session
 * the browser does. That is the whole reason for @supabase/ssr.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authConfig } from './config';

let client: SupabaseClient | null = null;

/**
 * The client, or null when accounts are not configured.
 *
 * One per tab, memoised: a second client would open a second auth listener
 * and race the first one to refresh the same token.
 */
export function supabaseBrowser(): SupabaseClient | null {
  if (client) return client;

  const config = authConfig();
  if (!config) return null;

  client = createBrowserClient(config.url, config.anonKey);
  return client;
}

/**
 * Start Google sign-in.
 *
 * `redirectTo` points at Chaatak's own callback route rather than at a page,
 * because the code-for-session exchange has to happen somewhere that can write
 * cookies. `next` carries where the person was, so signing in from the
 * locations panel returns to the locations panel.
 */
export async function signInWithGoogle(next = '/'): Promise<{ error?: string }> {
  const supabase = supabaseBrowser();
  if (!supabase) return { error: 'Accounts are not configured.' };

  const callback = new URL('/api/auth/callback', window.location.origin);
  callback.searchParams.set('next', next);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
      queryParams: {
        // Ask Google to show the account chooser rather than silently
        // reusing whichever account the browser happens to be holding. On a
        // shared phone that silence is a real problem.
        prompt: 'select_account',
      },
    },
  });

  return error ? { error: error.message } : {};
}
