'use client';

/**
 * The browser's view of the account API.
 *
 * Plain fetch against Chaatak's own routes. No Supabase client reads data
 * here: identity is a cookie the server validates, and ownership is decided
 * there. A browser that asks for another account's conversation gets a 404
 * from the server rather than a client-side check it could edit out.
 *
 * Every call returns a discriminated result rather than throwing, because
 * every caller is an interface element that has to say something either way.
 */

import type {
  AlertStatus,
  Conversation,
  MonitoredLocation,
  StoredMessage,
} from './types';
import type { NoData } from '../weather/types';

export type AccountUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  lang: string;
};

export type AccountState = {
  configured: boolean;
  user: AccountUser | null;
  alerts: AlertStatus;
  warning?: string;
};

export type LocationsState = {
  locations: MonitoredLocation[];
  limit: number;
  used: number;
  remaining: number;
  alerts: AlertStatus;
};

const NO_ALERTS: AlertStatus = {
  enabled: false,
  channels: { webpush: 0, telegram: 0 },
};

const NO_LOCATIONS: LocationsState = {
  locations: [],
  limit: 3,
  used: 0,
  remaining: 3,
  alerts: NO_ALERTS,
};

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
      // Account state must never be read from a cache. A stale conversation
      // list after a delete is a deleted chat that is still there.
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: 'Could not reach Chaatak.', status: 0 };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* an empty or non-JSON body is handled by the status below */
  }

  if (!response.ok) {
    const error =
      (body as { error?: string } | null)?.error ??
      `Request failed (${response.status}).`;
    return { ok: false, error, status: response.status };
  }

  return { ok: true, data: (body ?? {}) as T };
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

/** Everything the first paint needs, in one request. */
export type Bootstrap = AccountState & {
  conversations: Conversation[];
  locations: LocationsState;
};

/**
 * The single call the app opens with.
 *
 * One request rather than three in two waves, and one session check rather
 * than three. A guest gets the same shape with nothing in it, so the sidebar
 * never waits on a second hop to discover there is nothing to show.
 */
export async function fetchBootstrap(): Promise<Bootstrap> {
  const result = await call<Bootstrap>('/api/bootstrap');

  if (!result.ok) {
    return {
      configured: false,
      user: null,
      alerts: NO_ALERTS,
      conversations: [],
      locations: NO_LOCATIONS,
    };
  }

  const data = result.data;

  return {
    configured: Boolean(data.configured),
    user: data.user ?? null,
    alerts: data.alerts ?? NO_ALERTS,
    warning: data.warning,
    conversations: data.conversations ?? [],
    locations: data.locations ?? NO_LOCATIONS,
  };
}

/**
 * Who is signed in.
 *
 * Answers for a guest too — `user: null` is the answer the interface needs in
 * order to show a sign-in button rather than a spinner. Kept for the targeted
 * refresh; the first paint uses `fetchBootstrap`.
 */
export async function fetchAccount(): Promise<AccountState> {
  const result = await call<AccountState>('/api/account');
  if (!result.ok) return { configured: false, user: null, alerts: NO_ALERTS };
  return {
    configured: Boolean(result.data.configured),
    user: result.data.user ?? null,
    alerts: result.data.alerts ?? NO_ALERTS,
    warning: result.data.warning,
  };
}

export async function setAccountLang(lang: string): Promise<void> {
  await call('/api/account', { method: 'PATCH', body: JSON.stringify({ lang }) });
}

export async function signOutRequest(): Promise<void> {
  await call('/api/auth/signout', { method: 'POST' });
}

export async function deleteAccountRequest(): Promise<{ ok: boolean; error?: string }> {
  const result = await call('/api/account', { method: 'DELETE' });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export async function fetchConversations(): Promise<Conversation[]> {
  const result = await call<{ conversations: Conversation[] }>('/api/conversations');
  return result.ok ? (result.data.conversations ?? []) : [];
}

export async function fetchMessages(id: string): Promise<StoredMessage[] | null> {
  const result = await call<{ messages: StoredMessage[] }>(
    `/api/conversations/${id}`,
  );
  return result.ok ? (result.data.messages ?? []) : null;
}

export async function renameConversationRequest(
  id: string,
  title: string,
): Promise<Conversation | null> {
  const result = await call<{ conversation: Conversation }>(
    `/api/conversations/${id}`,
    { method: 'PATCH', body: JSON.stringify({ title }) },
  );
  return result.ok ? result.data.conversation : null;
}

export async function deleteConversationRequest(id: string): Promise<boolean> {
  const result = await call(`/api/conversations/${id}`, { method: 'DELETE' });
  return result.ok;
}

export async function deleteAllConversationsRequest(): Promise<boolean> {
  const result = await call('/api/conversations', { method: 'DELETE' });
  return result.ok;
}

/**
 * Hand the guest transcript to the account that just signed in.
 *
 * Idempotent on `guestKey`, so a reload mid-sign-in adopts the same chat
 * rather than making a second copy of it.
 */
export async function importGuestConversation(
  guestKey: string,
  messages: unknown[],
): Promise<Conversation | null> {
  const result = await call<{ conversation: Conversation }>(
    '/api/conversations/import',
    { method: 'POST', body: JSON.stringify({ guestKey, messages }) },
  );
  return result.ok ? result.data.conversation : null;
}

/* ------------------------------------------------------------------ */
/* Monitored locations                                                 */
/* ------------------------------------------------------------------ */

export async function fetchLocations(): Promise<LocationsState | null> {
  const result = await call<LocationsState>('/api/locations');
  return result.ok ? result.data : null;
}

/** What the server said about an attempt to watch somewhere new. */
export type AddLocationOutcome =
  | { ok: true; state: LocationsState; location: MonitoredLocation }
  | { ok: false; reason: 'full'; state: LocationsState }
  | { ok: false; reason: 'duplicate'; state: LocationsState; existing: MonitoredLocation }
  | { ok: false; reason: 'unresolved'; noData: NoData }
  | { ok: false; reason: 'error'; error: string };

export async function addLocationRequest(
  input: { place: string } | { latitude: number; longitude: number },
): Promise<AddLocationOutcome> {
  const result = await call<
    LocationsState & {
      ok?: boolean;
      reason?: string;
      location?: MonitoredLocation;
      existing?: MonitoredLocation;
      noData?: NoData;
    }
  >('/api/locations', { method: 'POST', body: JSON.stringify(input) });

  if (!result.ok) return { ok: false, reason: 'error', error: result.error };

  const data = result.data;

  if (data.ok && data.location) {
    return { ok: true, state: toState(data), location: data.location };
  }

  if (data.reason === 'unresolved' && data.noData) {
    return { ok: false, reason: 'unresolved', noData: data.noData };
  }

  if (data.reason === 'duplicate' && data.existing) {
    return {
      ok: false,
      reason: 'duplicate',
      state: toState(data),
      existing: data.existing,
    };
  }

  return { ok: false, reason: 'full', state: toState(data) };
}

export async function removeLocationRequest(
  id: string,
): Promise<LocationsState | null> {
  const result = await call<LocationsState>(`/api/locations/${id}`, {
    method: 'DELETE',
  });
  return result.ok ? toState(result.data) : null;
}

function toState(data: Partial<LocationsState>): LocationsState {
  const locations = data.locations ?? [];
  const limit = data.limit ?? 3;
  return {
    locations,
    limit,
    used: data.used ?? locations.length,
    remaining: data.remaining ?? Math.max(0, limit - locations.length),
    alerts: data.alerts ?? NO_ALERTS,
  };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export async function fetchPushConfig(): Promise<{
  vapidPublicKey: string | null;
  available: boolean;
  alerts: AlertStatus;
} | null> {
  const result = await call<{
    vapidPublicKey: string | null;
    available: boolean;
    alerts: AlertStatus;
  }>('/api/alerts/push');
  return result.ok ? result.data : null;
}

export async function registerPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  lang: string,
): Promise<AlertStatus | null> {
  const result = await call<{ alerts: AlertStatus }>('/api/alerts/push', {
    method: 'POST',
    body: JSON.stringify({ ...subscription, lang }),
  });
  return result.ok ? result.data.alerts : null;
}

export async function unregisterPush(endpoint: string): Promise<AlertStatus | null> {
  const result = await call<{ alerts: AlertStatus }>('/api/alerts/push', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
  return result.ok ? result.data.alerts : null;
}
