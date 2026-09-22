/**
 * /api/account — who is signed in, and how to stop being.
 *
 *   GET     the profile, the alert status, and whether accounts exist at all
 *   PATCH   the reply language
 *   DELETE  the account and everything it owns
 *
 * GET is the one account route that answers for a guest, because "nobody is
 * signed in" is the answer the interface needs in order to show a sign-in
 * button. Everything else requires a session.
 */

import { authConfigured } from '@/lib/auth/config';
import { currentUser } from '@/lib/auth/server';
import { DEFAULT_PREFERENCES, readPreferences } from '@/lib/i18n/preferences';
import {
  alertStatus,
  deleteAccount,
  readProfile,
  saveLanguagePreferences,
} from '@/lib/accounts/store';
import { guardRate, json, readJson, withUser } from '@/lib/accounts/route';
import { isMissingSchema } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const configured = authConfigured();
  const user = configured ? await currentUser() : null;

  if (!user) return json({ configured, user: null });

  /*
   * The profile row is mirrored at sign-in, but a first read is not the place
   * to fail over a missing one. A session with no profile row — a migration
   * applied after someone signed in, a write that lost its connection — still
   * describes a real person, and the identity from the token is enough to
   * show them their own name.
   */
  try {
    const [profile, alerts] = await Promise.all([
      readProfile(user.id),
      alertStatus(user.id),
    ]);

    return json({
      configured,
      user: {
        id: user.id,
        email: profile?.email ?? user.email,
        name: profile?.name ?? user.name,
        avatarUrl: profile?.avatarUrl ?? user.avatarUrl,
        languages: profile?.languages ?? DEFAULT_PREFERENCES,
      },
      alerts,
    });
  } catch (error) {
    if (isMissingSchema(error)) {
      return json({
        configured,
        user: { ...user, languages: DEFAULT_PREFERENCES },
        alerts: { enabled: false, channels: { webpush: 0, telegram: 0 } },
        warning: 'Account tables are missing. Run `node scripts/migrate.mjs`.',
      });
    }
    throw error;
  }
}

/**
 * The three language preferences, kept on the account.
 *
 * They live in the browser too, which is what a guest uses — but an alert
 * dispatched while the phone is asleep has no browser to ask, so the choice
 * has to exist server-side for the daemon to render in.
 *
 * The ALERT language is derived here rather than sent: the client could
 * assert anything, and the daemon can only render the two languages the
 * warning taxonomy is human-translated into. Resolving it server-side from
 * the same rules the interface uses means the two cannot drift, and a
 * template that does not exist can never be asked for.
 */
export async function PATCH(request: Request): Promise<Response> {
  return withUser(async (user) => {
    const body = await readJson(request);

    const preferences = readPreferences(body.languages ?? body);

    // The same path the Telegram bot's /settings takes. The alert language is
    // derived there, from the same rules the interface uses, and the
    // subscriber row the daemon reads is synced with it.
    const alertLang = await saveLanguagePreferences(user.id, preferences);

    return { ok: true, languages: preferences, alertLang };
  });
}

/**
 * DELETE — the account, its conversations, its messages, its monitored
 * locations, its profile and its alert subscription.
 *
 * Not reversible, and not softened: there is no "deleted" flag, no grace
 * period and nothing kept back. The confirmation is the client's job; by the
 * time a request reaches here the answer has been given.
 */
export async function DELETE(): Promise<Response> {
  return withUser(async (user) => {
    guardRate('destructive', user.id);

    await deleteAccount(user.id);

    console.log(JSON.stringify({ event: 'account.deleted', userId: user.id }));

    /*
     * The cookie in the browser still holds a token, but it is now a token
     * for a user who does not exist: `getUser()` asks the auth server, which
     * finds nothing, so every following request is unauthenticated. The
     * client clears the cookie immediately after this anyway — this is just
     * the reason that a failure to do so is not a security problem.
     */
    return { ok: true };
  });
}
