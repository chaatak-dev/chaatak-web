'use client';

/**
 * The browser's location, asked for at the one moment it is needed.
 *
 * THE RULE: the prompt appears when a question cannot be answered without it,
 * and at no other time. Not on page load, not when someone opens the
 * locations panel, not when a question named a place. A permission prompt
 * that arrives before the person has asked for anything is how the answer
 * becomes "block" — permanently, with no way back inside the page.
 *
 * SEPARATE FROM NOTIFICATIONS, entirely. Granting location says nothing about
 * wanting to be woken at 3am, and asking for both at once is how an app ends
 * up with neither.
 *
 * A refusal is remembered. The browser will not prompt again after a denial
 * anyway — it resolves the call with an error immediately — so asking again
 * looks to the person like a button that does nothing. Remembering lets the
 * interface offer the other path instead: type a place name.
 */

const DENIED_KEY = 'chaatak:geo-denied';

/** How long to wait. A fix indoors on a cheap phone is genuinely slow. */
const TIMEOUT_MS = 10_000;

export type Coords = { latitude: number; longitude: number };

export type GeoOutcome =
  | { ok: true; coords: Coords }
  | { ok: false; reason: 'unsupported' | 'denied' | 'unavailable' | 'timeout' };

export function geoSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/** True when this browser has already said no. */
export function geoDenied(): boolean {
  try {
    return localStorage.getItem(DENIED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDenial(): void {
  try {
    localStorage.setItem(DENIED_KEY, '1');
  } catch {
    /* the refusal is still respected for this page view */
  }
}

/** Cleared when a fix succeeds, so a changed browser setting is noticed. */
function forgetDenial(): void {
  try {
    localStorage.removeItem(DENIED_KEY);
  } catch {
    /* nothing stored */
  }
}

/**
 * Whether asking is worth doing.
 *
 * Consults the Permissions API where it exists, because it answers "would
 * this prompt?" WITHOUT prompting — which is the one question that cannot be
 * answered by trying. Browsers without it fall back to what we remember.
 */
export async function canAskForLocation(): Promise<boolean> {
  if (!geoSupported()) return false;
  if (geoDenied()) return false;

  try {
    const status = await navigator.permissions?.query({
      name: 'geolocation' as PermissionName,
    });
    if (status?.state === 'denied') {
      rememberDenial();
      return false;
    }
  } catch {
    // No Permissions API, or it refuses geolocation. What we remember stands.
  }

  return true;
}

/**
 * One fix, or a stated reason there is none.
 *
 * `maximumAge` accepts a fix from the last five minutes. Somebody's district
 * does not change in five minutes, and a cached fix answers instantly instead
 * of waiting for the GPS to wake up.
 */
export async function currentPosition(): Promise<GeoOutcome> {
  if (!geoSupported()) return { ok: false, reason: 'unsupported' };

  return new Promise<GeoOutcome>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        forgetDenial();
        resolve({
          ok: true,
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          rememberDenial();
          resolve({ ok: false, reason: 'denied' });
          return;
        }
        resolve({
          ok: false,
          reason: error.code === error.TIMEOUT ? 'timeout' : 'unavailable',
        });
      },
      {
        // District-level accuracy is all this product can act on — IMD warns
        // per district — so there is no reason to spend battery on a GPS lock.
        enableHighAccuracy: false,
        timeout: TIMEOUT_MS,
        maximumAge: 300_000,
      },
    );
  });
}
