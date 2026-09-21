/**
 * Validating a guest transcript on its way into an account.
 *
 * This is the person's OWN conversation being handed back, so the job is
 * shape rather than trust: nobody else can read these rows, and refusing them
 * would only lose someone their chat. What must not happen is a malformed
 * entry reaching the database or the renderer — a turn with no role, a
 * timestamp that is not a date, a grounding object the provenance line cannot
 * draw.
 *
 * Grounding is kept as sent, deliberately. It is the provenance the answer
 * shipped with, and dropping it would leave a number in someone's history
 * with no citation under it — which is the one thing this product never
 * displays.
 */

import { isLanguageCode } from '../i18n/languages';
import type { Grounding } from '../chat/types';
import type { TurnToStore } from './store';

/** The browser keeps 40 turns; this is slack, not a target. */
export const MAX_IMPORT_TURNS = 200;

/** Longer than any answer this system produces, by a wide margin. */
export const MAX_IMPORT_TEXT = 8_000;

type IncomingTurn = {
  id?: unknown;
  role?: unknown;
  text?: unknown;
  lang?: unknown;
  at?: unknown;
  grounding?: unknown;
};

/**
 * One turn, or null if there is nothing usable in it.
 *
 * @param now the clock, injected so a turn with no timestamp is testable
 */
export function readImportedTurn(
  input: unknown,
  now: () => Date = () => new Date(),
): TurnToStore | null {
  if (!input || typeof input !== 'object') return null;
  const turn = input as IncomingTurn;

  const role = turn.role === 'user' || turn.role === 'assistant' ? turn.role : null;
  if (!role) return null;

  const text = typeof turn.text === 'string' ? turn.text.slice(0, MAX_IMPORT_TEXT) : '';
  if (!text.trim()) return null;

  const lang = isLanguageCode(turn.lang) ? turn.lang : 'hi';

  // The time the turn actually happened, so an adopted conversation reads in
  // the order it was spoken rather than in the order it was uploaded.
  const at =
    typeof turn.at === 'string' && !Number.isNaN(Date.parse(turn.at))
      ? new Date(turn.at).toISOString()
      : now().toISOString();

  /*
   * The browser's own id for the turn becomes the idempotency key, prefixed
   * so it can never collide with a client id minted by a live exchange. A
   * turn with no id falls back to its time and role, which is stable enough
   * that re-running the same import does not duplicate it.
   */
  const clientId =
    typeof turn.id === 'string' && turn.id.trim()
      ? `guest:${turn.id.trim().slice(0, 80)}`
      : `guest:${at}:${role}`;

  return {
    clientId,
    role,
    text,
    lang,
    at,
    grounding: readGrounding(turn.grounding),
  };
}

/** Structural only: enough that the provenance line can render it. */
export function readGrounding(value: unknown): Grounding | null {
  if (!value || typeof value !== 'object') return null;

  const g = value as Record<string, unknown>;
  const place = g.place as Record<string, unknown> | undefined;
  const provenance = g.provenance as Record<string, unknown> | undefined;

  if (!place || typeof place !== 'object') return null;
  if (!provenance || typeof provenance !== 'object') return null;
  if (typeof place.name !== 'string') return null;
  if (typeof provenance.source !== 'string') return null;
  if (typeof provenance.issuedAt !== 'string') return null;

  return value as Grounding;
}
