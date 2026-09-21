/**
 * The guest transcript: a conversation that has no account behind it.
 *
 * Chaatak answers before it asks who you are, so this is where most first
 * conversations live. It is sessionStorage, deliberately — the conversation
 * lasts as long as the tab and then it is gone, which is the honest lifetime
 * for something nobody claimed. Signing in copies it into the account and
 * clears it; see /api/conversations/import for exactly what that does.
 *
 * Read through useSyncExternalStore rather than restored from an effect. That
 * gives the server a defined snapshot — an empty transcript — so there is no
 * hydration mismatch, and it keeps the persisted copy and the rendered copy
 * from drifting apart.
 */

import type { Message } from './types';

const SCROLLBACK_KEY = 'chaatak:scrollback';
const GUEST_KEY = 'chaatak:guest-key';
export const SCROLLBACK_EVENT = 'chaatak:scrollback-changed';

/** Forty turns is more than a phone screen ever shows and well under quota. */
const MAX_STORED = 40;

export const EMPTY: Message[] = [];

/*
 * The parsed value is cached because getSnapshot must return a stable
 * reference; re-parsing on every call would re-render forever.
 */
let cachedRaw: string | null = null;
let cachedMessages: Message[] = EMPTY;

export function subscribeScrollback(onChange: () => void): () => void {
  window.addEventListener(SCROLLBACK_EVENT, onChange);
  return () => window.removeEventListener(SCROLLBACK_EVENT, onChange);
}

export function scrollbackSnapshot(): Message[] {
  try {
    const raw = sessionStorage.getItem(SCROLLBACK_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedMessages = raw ? (JSON.parse(raw) as Message[]) : EMPTY;
    }
    return cachedMessages;
  } catch {
    return EMPTY;
  }
}

export function writeScrollback(messages: Message[]): void {
  const kept = messages.slice(-MAX_STORED);
  try {
    sessionStorage.setItem(SCROLLBACK_KEY, JSON.stringify(kept));
  } catch {
    // Private mode: the conversation still works, it just does not persist.
    cachedRaw = null;
    cachedMessages = kept;
  }
  window.dispatchEvent(new Event(SCROLLBACK_EVENT));
}

/**
 * Clear the guest copy.
 *
 * Called once, after the server has confirmed the conversation was adopted.
 * Clearing before that confirmation is how a transcript gets lost between two
 * storage layers, so the order is not an accident.
 */
export function clearScrollback(): void {
  try {
    sessionStorage.removeItem(SCROLLBACK_KEY);
    sessionStorage.removeItem(GUEST_KEY);
  } catch {
    /* nothing to clear */
  }
  cachedRaw = null;
  cachedMessages = EMPTY;
  window.dispatchEvent(new Event(SCROLLBACK_EVENT));
}

/**
 * A stable id for this guest conversation.
 *
 * It survives the round trip to Google and back, because sessionStorage
 * belongs to the tab and the OAuth redirect returns to the same tab. That is
 * what makes adoption idempotent: the server keys on it, so a reload
 * mid-sign-in finds the conversation that already exists instead of making a
 * second copy of the same chat.
 */
export function guestKey(): string {
  try {
    const existing = sessionStorage.getItem(GUEST_KEY);
    if (existing) return existing;

    const minted =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `g${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

    sessionStorage.setItem(GUEST_KEY, minted);
    return minted;
  } catch {
    // No storage: adoption is still correct, it just cannot be retried
    // idempotently. A fresh key each time is better than none at all.
    return `g${Date.now().toString(36)}`;
  }
}
