/**
 * /api/conversations — the recent list.
 *
 *   GET     this user's conversations, most recent activity first
 *   POST    start one
 *   DELETE  delete all of them
 *
 * Every statement underneath is scoped to the user id from the validated
 * session. Nothing here reads an id from the request.
 */

import {
  createConversation,
  deleteAllConversations,
  listConversations,
} from '@/lib/accounts/store';
import { guardRate, readJson, readString, withUser } from '@/lib/accounts/route';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return withUser(async (user) => ({
    conversations: await listConversations(user.id),
  }));
}

/**
 * POST — an empty conversation.
 *
 * Rarely needed: the ordinary path creates a conversation lazily, on the
 * first question, so pressing "New chat" and changing your mind does not
 * leave a row called nothing in the recent list. This exists for the client
 * that wants an id up front.
 */
export async function POST(request: Request): Promise<Response> {
  return withUser(async (user) => {
    guardRate('conversations', user.id);

    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const title = readString(body.title, 120);

    return { conversation: await createConversation(user.id, { title }) };
  });
}

/**
 * DELETE — every conversation this user has.
 *
 * Messages go with them through the foreign key. Monitored locations do not:
 * deleting chat history is not the same decision as stopping alerts, and
 * conflating them would silently switch off the warnings someone signed up
 * for while they were tidying their sidebar.
 */
export async function DELETE(): Promise<Response> {
  return withUser(async (user) => {
    guardRate('destructive', user.id);
    const deleted = await deleteAllConversations(user.id);
    return { ok: true, deleted };
  });
}
