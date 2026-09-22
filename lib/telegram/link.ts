/**
 * Connecting a Telegram to a Chaatak account: the token, and what it carries.
 *
 * WHAT THE LINK CARRIES: nothing. It is 32 random bytes, base64url — 43
 * characters, inside Telegram's 64-character limit for a start parameter and
 * inside its alphabet (A–Z, a–z, 0–9, _ and -). No user id, no email, no
 * timestamp, nothing that means anything to whoever reads it. What it
 * unlocks is decided entirely on the server, from a row that only a
 * signed-in session could have created.
 *
 * Only a hash of it is stored, so a read of the table yields nothing usable.
 * SHA-256 without a salt is the right tool for a 256-bit random secret: there
 * is no dictionary to precompute against.
 */

import { createHash, randomBytes } from 'node:crypto';

/** How long a link stays good. Long enough to open Telegram; no longer. */
export const LINK_TTL_MS = 10 * 60 * 1000;

/** The start-parameter prefix that marks a link, as opposed to any other /start. */
export const LINK_PREFIX = 'link_';

export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The token inside a /start payload, or null when the payload is not a link.
 *
 * Shape-checked before anything is looked up, so an arbitrary /start argument
 * never reaches the database as a candidate token.
 */
export function readLinkPayload(payload: string | null | undefined): string | null {
  if (!payload || !payload.startsWith(LINK_PREFIX)) return null;
  const token = payload.slice(LINK_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** https://t.me/<bot>?start=link_<token> */
export function deepLink(botUsername: string, token: string): string {
  const start = `${LINK_PREFIX}${token}`;
  // Telegram's own limit. The token is fixed-length, so this can only fail
  // if someone changes the prefix — which is worth failing loudly for.
  if (start.length > 64) throw new Error('start parameter over 64 characters');
  return `https://t.me/${encodeURIComponent(botUsername)}?start=${start}`;
}

/**
 * An email with most of the local part hidden: "ya•••@gmail.com".
 *
 * Shown in Telegram when asking "connect to this account?", so the person can
 * recognise their own account — and notice when a link someone sent them is
 * for somebody else's — without the chat carrying their whole address.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  const shown = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${shown}•••@${domain}`;
}
