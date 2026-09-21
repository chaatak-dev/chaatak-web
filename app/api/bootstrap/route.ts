/**
 * GET /api/bootstrap — everything the interface needs to draw itself, once.
 *
 * The first paint used to cost three requests in two waves: /api/account, and
 * then — only once that had come back with a user — /api/conversations and
 * /api/locations. Two of those waves are network round trips the person
 * spends staring at an empty sidebar, and each one paid for its own session
 * check.
 *
 * This is one request, one session check, and the queries underneath run in
 * parallel. A guest gets the same answer shaped the same way, with nothing in
 * it, and the sidebar stops waiting on a second hop to find that out.
 *
 * The individual routes remain. They are what a targeted refresh uses — after
 * saving a place, after deleting a chat — and re-fetching everything for one
 * changed list would be the opposite trade.
 */

import { authConfigured } from '@/lib/auth/config';
import { currentUser } from '@/lib/auth/server';
import { isMissingSchema } from '@/lib/db/pool';
import {
  alertStatus,
  listConversations,
  listLocations,
  readProfile,
} from '@/lib/accounts/store';
import { MAX_MONITORED } from '@/lib/accounts/types';
import { DEFAULT_PREFERENCES } from '@/lib/i18n/preferences';
import { json } from '@/lib/accounts/route';

export const dynamic = 'force-dynamic';

const NO_ALERTS = { enabled: false, channels: { webpush: 0, telegram: 0 } };

export async function GET(): Promise<Response> {
  const configured = authConfigured();
  const user = configured ? await currentUser() : null;

  if (!user) {
    return json({
      configured,
      user: null,
      alerts: NO_ALERTS,
      conversations: [],
      locations: { locations: [], limit: MAX_MONITORED, used: 0, remaining: MAX_MONITORED, alerts: NO_ALERTS },
    });
  }

  try {
    // Four reads, one wait. None of them depends on another's answer.
    const [profile, alerts, conversations, locations] = await Promise.all([
      readProfile(user.id),
      alertStatus(user.id),
      listConversations(user.id),
      listLocations(user.id),
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
      conversations,
      locations: {
        locations,
        limit: MAX_MONITORED,
        used: locations.length,
        remaining: Math.max(0, MAX_MONITORED - locations.length),
        alerts,
      },
    });
  } catch (error) {
    /*
     * A session that is real but whose tables are not there yet. The identity
     * still describes a person, so they are shown as signed in with nothing
     * saved rather than bounced to a sign-in button that would not fix it.
     */
    if (isMissingSchema(error)) {
      return json({
        configured,
        user: { ...user, languages: DEFAULT_PREFERENCES },
        alerts: NO_ALERTS,
        conversations: [],
        locations: { locations: [], limit: MAX_MONITORED, used: 0, remaining: MAX_MONITORED, alerts: NO_ALERTS },
        warning: 'Account tables are missing. Run `node scripts/migrate.mjs`.',
      });
    }

    console.error(
      JSON.stringify({
        event: 'bootstrap.failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
}
