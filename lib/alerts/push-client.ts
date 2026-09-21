'use client';

/**
 * Asking the browser for a push subscription.
 *
 * WHEN THIS RUNS: only when someone presses the control that turns alerts on.
 * Not on page load, not when they save a place, not when they grant location.
 * Permission prompts spend a trust budget that cannot be topped up — a
 * browser only asks once, and a prompt that arrives before the person has
 * asked for anything is how the answer becomes "block" forever.
 *
 * The three permission states are kept distinct on purpose. "Not asked" is a
 * question worth putting in front of someone; "denied" is a decision, and
 * re-prompting is not even possible — the browser refuses silently, which
 * looks to the user like a button that does nothing.
 */

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): PushPermission {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushPermission;
}

/**
 * VAPID keys travel as base64url and the Push API wants bytes.
 *
 * `atob` reads standard base64, so the URL-safe characters have to be put
 * back and the padding restored before it will parse.
 */
function decodeVapidKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Backed by a plain ArrayBuffer, not a SharedArrayBuffer: `applicationServerKey`
  // takes a BufferSource, and the shared variant is not one.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function encodeKey(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export type SubscribeResult =
  | { ok: true; subscription: PushSubscriptionKeys }
  | { ok: false; reason: 'unsupported' | 'denied' | 'failed'; detail?: string };

/**
 * Subscribe this device, asking for permission on the way.
 *
 * Reuses an existing subscription when the browser already has one, rather
 * than replacing it. A resubscribe mints a new endpoint and leaves the old one
 * on the server — which is how one device starts receiving every warning
 * twice.
 */
export async function subscribeToPush(
  vapidPublicKey: string,
): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Required by every browser that implements the Push API: a
        // subscription that could deliver a silent push is not allowed.
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(vapidPublicKey),
      }));

    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh ?? encodeKey(subscription.getKey('p256dh'));
    const auth = json.keys?.auth ?? encodeKey(subscription.getKey('auth'));

    if (!subscription.endpoint || !p256dh || !auth) {
      return { ok: false, reason: 'failed', detail: 'incomplete subscription' };
    }

    return {
      ok: true,
      subscription: { endpoint: subscription.endpoint, p256dh, auth },
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : 'subscribe failed',
    };
  }
}

/** The endpoint this device currently holds, if any. */
export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Stop this device receiving alerts.
 *
 * The browser subscription is dropped as well as the server record. Leaving
 * it would mean the browser still holds a live endpoint for a server that no
 * longer knows about it — harmless, but it makes "off" less true than it
 * looks.
 */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return null;

    const { endpoint } = subscription;
    await subscription.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}
