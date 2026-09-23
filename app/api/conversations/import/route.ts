/**
 * POST /api/conversations/import
 *
 * Adopting the conversation someone was already having when they signed in.
 *
 * Chaatak does not ask anyone to log in before answering a question, so the
 * ordinary path is: ask, get an answer, ask another, and only then decide to
 * keep it. That conversation lives in this browser's sessionStorage and has
 * no owner. This is where it gets one.
 *
 * WHAT HAPPENS TO A GUEST CHAT, stated plainly because a vague answer here is
 * how people lose things:
 *
 *   - Signing in copies the current guest conversation into the account, in
 *     order, with its original timestamps and the provenance each answer
 *     shipped with.
 *   - The browser's copy is then cleared — after the server confirms, never
 *     before — so the same chat does not exist twice with two futures.
 *   - Nothing is merged. The transcript becomes a new conversation of its
 *     own; it is never appended to an existing one, and never reaches any
 *     account but the one that just signed in.
 *   - Not signing in changes nothing: the guest copy stays where it was, in
 *     this browser, until the tab closes.
 *
 * `guestKey` makes it exactly once. It is unique per user, so a retry, a
 * double-submit or a second tab finishing the same sign-in all land on the
 * conversation that was already created.
 */

import { appendTurns, createConversation } from '@/lib/accounts/store';
import { MAX_IMPORT_TURNS, readImportedTurn } from '@/lib/accounts/import';
import { conversationTitle } from '@/lib/accounts/title';
import { guardRate, HttpError, readJson, withUser } from '@/lib/accounts/route';
import type { TurnToStore } from '@/lib/accounts/store';
import { replyLanguage } from '@/lib/i18n/detect';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withUser(async (user) => {
    guardRate('import', user.id);

    const body = await readJson(request);

    const guestKey =
      typeof body.guestKey === 'string' && body.guestKey.trim()
        ? body.guestKey.trim().slice(0, 100)
        : null;
    if (!guestKey) throw new HttpError(400, 'A guest key is required.');

    const raw = Array.isArray(body.messages) ? body.messages : [];
    if (raw.length === 0) throw new HttpError(400, 'Nothing to import.');
    if (raw.length > MAX_IMPORT_TURNS) {
      throw new HttpError(413, 'That conversation is too long to import.');
    }

    const turns = raw
      .map((turn) => readImportedTurn(turn))
      .filter((turn): turn is TurnToStore => turn !== null);

    if (turns.length === 0) throw new HttpError(400, 'Nothing to import.');

    // Named from its opening question, in the language that question was
    // written in — the same rule a conversation started while signed in
    // follows, and no model call in either case.
    const firstQuestion = turns.find((turn) => turn.role === 'user');
    const title = firstQuestion
      ? conversationTitle({
          question: firstQuestion.text,
          lang: replyLanguage(firstQuestion.text, firstQuestion.lang),
        })
      : null;

    const conversation = await createConversation(user.id, { guestKey, title });

    // `on conflict do nothing` on (conversation_id, client_id) means a second
    // run of the same import writes no second copy of anything.
    await appendTurns(user.id, conversation.id, turns, title);

    return { conversation, imported: turns.length };
  });
}
