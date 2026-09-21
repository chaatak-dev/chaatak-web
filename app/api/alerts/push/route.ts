/**
 * /api/alerts/push — turning notifications on for this account.
 *
 *   GET     the VAPID public key, and whether alerts can reach here
 *   POST    register this device's push subscription
 *   DELETE  drop this device's push subscription
 *
 * SEPARATE FROM SAVING A PLACE, deliberately. Watching a district and
 * agreeing to be woken by it are two decisions, and a product that takes the
 * second one on the strength of the first is how people end up disabling
 * notifications for the one app that had something urgent to say. So this
 * route is only ever called because someone pressed the thing that says
 * "notify me", and the browser permission prompt happens at that moment and
 * at no other.
 *
 * The subscriber row the alert daemon reads is written here, with this
 * account's user id as the subscriber id — one person is one subscriber
 * however many devices they sign in on, so deduplication on
 * (subscriberId, dispatchKey) keeps meaning one alert per person per warning.
 */

import { addChannel, alertStatus, removeWebPushChannel } from '@/lib/accounts/store';
import { readProfile } from '@/lib/accounts/store';
import { guardRate, HttpError, readJson, withUser } from '@/lib/accounts/route';
import { isLanguageCode } from '@/lib/i18n/languages';

export const dynamic = 'force-dynamic';

/**
 * The VAPID public key is public by construction — it is the key a browser
 * uses to verify that a push came from this server, and it is sent to the
 * push service in the clear. The private half stays in the environment and
 * never leaves it. Serving it from here rather than inlining it as a
 * NEXT_PUBLIC_ variable keeps one copy of it, in one place.
 */
export async function GET(): Promise<Response> {
  return withUser(async (user) => ({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    // No key configured means push cannot work on this deployment. Said
    // plainly, so the interface can offer Telegram or nothing rather than a
    // button that fails silently.
    available: Boolean(process.env.VAPID_PUBLIC_KEY),
    alerts: await alertStatus(user.id),
  }));
}

export async function POST(request: Request): Promise<Response> {
  return withUser(async (user) => {
    guardRate('locations', user.id);

    const body = await readJson(request);

    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    const p256dh = typeof body.p256dh === 'string' ? body.p256dh.trim() : '';
    const auth = typeof body.auth === 'string' ? body.auth.trim() : '';

    if (!endpoint || !p256dh || !auth) {
      throw new HttpError(400, 'An incomplete push subscription.');
    }
    // A push endpoint is a URL issued by the browser's push service. Anything
    // else is not something web-push can deliver to.
    if (!/^https:\/\//i.test(endpoint) || endpoint.length > 1_000) {
      throw new HttpError(400, 'Not a usable push endpoint.');
    }

    const profile = await readProfile(user.id);
    const lang = isLanguageCode(body.lang)
      ? body.lang
      : isLanguageCode(profile?.lang)
        ? profile.lang
        : 'hi';

    await addChannel(
      user.id,
      { kind: 'webpush', endpoint, p256dh, auth },
      // The daemon renders from the template catalogue in this language.
      // Only the two with a human-translated warning taxonomy reach it.
      lang === 'en' ? 'en' : 'hi',
    );

    return { ok: true, alerts: await alertStatus(user.id) };
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return withUser(async (user) => {
    const body = await readJson(request);
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    if (!endpoint) throw new HttpError(400, 'Which subscription?');

    await removeWebPushChannel(user.id, endpoint);

    return { ok: true, alerts: await alertStatus(user.id) };
  });
}
