/**
 * Accounts: what a signed-in person owns.
 *
 * Three things, and no weather among them. Conversations and messages are a
 * record of what was said; monitored locations are a list of places to watch.
 * Current conditions and warnings are never stored here — they come from the
 * weather pipeline on every read, because a saved value is a value that can
 * be wrong later while still looking authoritative.
 *
 * The one exception is `grounding` on a message, which keeps the provenance a
 * turn shipped with. Without it, reopening a conversation would show a number
 * with no citation. It is read back as history, never as a current value.
 */

import type { Grounding } from '../chat/types';
import type { SpeechLang } from '../speech/types';
import type { DistrictId } from '../weather/types';

export type ConversationId = string & { readonly __brand: 'ConversationId' };

export type Conversation = {
  id: ConversationId;
  /** Null only in the instant between creation and the first message. */
  title: string | null;
  createdAt: string;
  lastMessageAt: string;
};

/**
 * A stored turn, in the same shape the transcript already renders.
 *
 * Deliberately identical to `lib/chat/types.ts` `Message`, so a conversation
 * loaded from the database and one held in the browser are the same array of
 * the same objects. A separate shape would mean two render paths, and the one
 * that is exercised less is the one that breaks.
 */
export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  lang: SpeechLang;
  at: string;
  grounding?: Grounding;
};

/** How many places one account may watch. Enforced in the schema, not here. */
export const MAX_MONITORED = 3;

export type MonitoredLocation = {
  id: string;
  /** 1, 2 or 3. The schema's own expression of the limit. */
  slot: number;
  /** The place as the person asked for it, canonically spelled. */
  placeName: string;
  /** The unit IMD warns on, and exactly what the daemon polls. */
  district: DistrictId;
  state: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  resolvedBy: string | null;
  endpoint: string | null;
  createdAt: string;
};

/**
 * Why adding a location was refused.
 *
 * Both come from unique constraints rather than from a count, so a concurrent
 * fourth request is refused by the database rather than by whichever check
 * happened to run first.
 */
export type AddLocationFailure =
  | { ok: false; reason: 'full' }
  | { ok: false; reason: 'duplicate'; existing: MonitoredLocation };

export type AddLocationResult =
  | { ok: true; location: MonitoredLocation }
  | AddLocationFailure;

/**
 * Whether alerts can actually reach this account, and how.
 *
 * Separate from the location list on purpose. Saving a place and agreeing to
 * be interrupted by a notification are different decisions, and the interface
 * asks for them separately — a saved place with no channel is a perfectly
 * ordinary state, not a half-finished one.
 */
export type AlertStatus = {
  /** True when at least one channel exists — a push endpoint, or Telegram. */
  enabled: boolean;
  channels: { webpush: number; telegram: number };
};

export type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  lang: string;
};
