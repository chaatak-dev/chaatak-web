/**
 * /api/conversations/[id] — one conversation.
 *
 *   GET     its messages, oldest first
 *   PATCH   rename it
 *   DELETE  delete it, and its messages with it
 *
 * A conversation that belongs to someone else answers 404, not 403. The
 * difference matters: 403 confirms that the id exists, which is a fact about
 * another person's account.
 */

import {
  conversationMessages,
  deleteConversation,
  renameConversation,
} from '@/lib/accounts/store';
import type { ConversationId } from '@/lib/accounts/types';
import {
  guardRate,
  HttpError,
  readJson,
  readString,
  withUser,
} from '@/lib/accounts/route';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** UUIDs only. A malformed id is a bad request, not a database error. */
function readId(id: string): ConversationId {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(id)) throw new HttpError(400, 'Not a conversation id.');
  return id as ConversationId;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  return withUser(async (user) => {
    const messages = await conversationMessages(user.id, readId(id));
    if (messages === null) throw new HttpError(404, 'No such conversation.');
    return { messages };
  });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  return withUser(async (user) => {
    guardRate('conversations', user.id);

    const body = await readJson(request);
    const title = readString(body.title, 120);
    if (!title) throw new HttpError(400, 'A title cannot be empty.');

    const conversation = await renameConversation(user.id, readId(id), title);
    if (!conversation) throw new HttpError(404, 'No such conversation.');

    return { conversation };
  });
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  return withUser(async (user) => {
    guardRate('conversations', user.id);

    const deleted = await deleteConversation(user.id, readId(id));
    if (!deleted) throw new HttpError(404, 'No such conversation.');

    return { ok: true };
  });
}
