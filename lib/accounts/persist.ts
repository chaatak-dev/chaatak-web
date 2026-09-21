/**
 * Writing a turn into a signed-in person's history.
 *
 * THE RULE THIS FILE EXISTS TO HOLD: saving history may never cost someone
 * their answer. The weather reply is the product; the transcript is a
 * convenience. So every failure here is caught, logged and swallowed, and the
 * answer ships regardless — a database that is down, a table that was never
 * migrated, a connection that timed out, none of them turn a forecast into an
 * error message.
 *
 * The pair is written together, user turn and assistant turn, because a
 * question saved without its answer reads as an unanswered question the next
 * time the conversation is opened.
 */

import { appendTurns, createConversation } from './store';
import type { ConversationId } from './types';
import type { Grounding } from '../chat/types';
import type { SpeechLang } from '../speech/types';

export type PersistInput = {
  userId: string;
  /** Null starts a conversation. The id comes back in the reply. */
  conversationId: ConversationId | null;
  /**
   * The client's id for this exchange. Both rows derive their idempotency key
   * from it, so a resend after a timeout writes nothing a second time.
   */
  clientId: string;
  question: string;
  questionLang: SpeechLang;
  askedAt: string;
  answer: string;
  answerLang: SpeechLang;
  grounding?: Grounding;
  /** Used only when the conversation is being created. Written once. */
  title: string | null;
};

export type PersistResult = {
  conversationId: ConversationId;
  title: string | null;
} | null;

export async function persistTurn(input: PersistInput): Promise<PersistResult> {
  try {
    const conversation = input.conversationId
      ? { id: input.conversationId, title: input.title }
      : await createConversation(input.userId, { title: input.title });

    /*
     * The answer is stamped a millisecond after the question rather than at
     * the same instant. Both are sorted by time, and two rows sharing a
     * timestamp would be ordered by whichever won the insert — which is not
     * reliably the order they were said in.
     */
    const askedAt = new Date(input.askedAt);
    const answeredAt = new Date(askedAt.getTime() + 1).toISOString();

    await appendTurns(
      input.userId,
      conversation.id,
      [
        {
          clientId: `${input.clientId}:q`,
          role: 'user',
          text: input.question,
          lang: input.questionLang,
          at: askedAt.toISOString(),
        },
        {
          clientId: `${input.clientId}:a`,
          role: 'assistant',
          text: input.answer,
          lang: input.answerLang,
          at: answeredAt,
          grounding: input.grounding ?? null,
        },
      ],
      input.title,
    );

    return { conversationId: conversation.id, title: conversation.title ?? input.title };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'chat.persist.failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}
