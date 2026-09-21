/**
 * DELETE /api/locations/[id] — stop watching a place.
 *
 * Removing the row also rewrites the districts the alert daemon polls for
 * this account, in the same request. A location that is gone from the list
 * but still in the subscription would keep sending warnings for somewhere
 * the person explicitly stopped caring about — and the only way to make that
 * stop would be to guess that it was still there.
 */

import { alertStatus, listLocations, removeLocation } from '@/lib/accounts/store';
import { MAX_MONITORED } from '@/lib/accounts/types';
import { guardRate, HttpError, withUser } from '@/lib/accounts/route';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  return withUser(async (user) => {
    guardRate('locations', user.id);

    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id)) throw new HttpError(400, 'Not a location id.');

    // Scoped to this user, so another account's id is simply not found.
    const removed = await removeLocation(user.id, id);
    if (!removed) throw new HttpError(404, 'No such location.');

    const [locations, alerts] = await Promise.all([
      listLocations(user.id),
      alertStatus(user.id),
    ]);

    return {
      ok: true,
      locations,
      limit: MAX_MONITORED,
      used: locations.length,
      remaining: Math.max(0, MAX_MONITORED - locations.length),
      alerts,
    };
  });
}
