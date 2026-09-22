/**
 * POST /api/chat
 *
 *   parse → fetch → render → VERIFY → ship
 *
 * The pipeline itself is `answerQuestion` in lib/chat/answer.ts, shared with
 * every other client — the Telegram bot asks through the same function. What
 * stays here is what only the web has: reading the request, knowing which
 * signed-in person is asking, and writing the turn into their history.
 *
 * Runs server-side so no provider key or upstream endpoint reaches the
 * browser. An answer always ships: if the model is out or the gate rejects,
 * the template goes instead and the user never learns a provider failed.
 */

import { isConfigurationError, mayRevealConfiguration } from '@/lib/errors';
import { isLanguageCode } from '@/lib/i18n/languages';
import { currentUser } from '@/lib/auth/server';
import { persistTurn } from '@/lib/accounts/persist';
import { conversationTitle } from '@/lib/accounts/title';
import type { ConversationId } from '@/lib/accounts/types';
import { answerQuestion } from '@/lib/chat/answer';
import { readCoords } from '@/lib/chat/coords';
import { readPreference } from '@/lib/i18n/preferences';
import type { Message, StandingQuery } from '@/lib/chat/types';
import type { SpeechLang } from '@/lib/speech/types';

type ChatRequest = {
  question?: string;
  lang?: string;
  history?: Message[];
  standing?: StandingQuery | null;
  /**
   * Which conversation to write this turn into. Null starts one. Ignored
   * entirely for a guest — there is nothing to write into.
   */
  conversationId?: string | null;
  /** The client's id for this exchange, so a resend is not a second copy. */
  clientId?: string;
  /**
   * The browser's current position, sent ONLY when the person has just been
   * asked for it. Used to name a place and then discarded: nothing stores a
   * coordinate, and a question that named a place ignores this field.
   */
  coords?: { latitude?: unknown; longitude?: unknown } | null;
  /**
   * The language to answer in, when the person has named one.
   *
   * `auto` — the default — means mirror whatever they wrote. An explicit
   * value is a setting they went and changed, so it is honoured rather than
   * second-guessed by the script of the question.
   */
  assistantLang?: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: 'malformed body' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return Response.json({ error: 'no question' }, { status: 400 });

  /*
   * Who is asking, if anyone.
   *
   * From the session cookie, never from the body — a request cannot name the
   * account it wants its history written into. A guest is the ordinary case
   * and costs nothing: `currentUser()` returns null and the turn is simply
   * not saved.
   */
  const askedAt = new Date().toISOString();
  const user = await currentUser().catch(() => null);
  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId
      ? (body.conversationId as ConversationId)
      : null;
  const clientId =
    typeof body.clientId === 'string' && body.clientId
      ? body.clientId.slice(0, 80)
      : `turn:${askedAt}`;

  // Any of the seven. An unrecognised code falls back rather than throwing:
  // a bad language header should not cost someone their forecast.
  const lang: SpeechLang = isLanguageCode(body.lang) ? body.lang : 'hi';

  try {
    const { reply, title } = await answerQuestion({
      question,
      lang,
      assistant: readPreference(body.assistantLang),
      history: Array.isArray(body.history) ? body.history : [],
      standing: body.standing ?? null,
      coords: readCoords(body.coords),
    });

    /*
     * History is written on EVERY exit — the out-of-scope line, the
     * unresolvable place, and the ordinary answer alike. A conversation that
     * silently drops the turns it found awkward is worse than one that keeps
     * everything, because the gap is invisible.
     *
     * Except a turn that only asks "which place?". It is a request for input,
     * not an answer, and the same question is about to be asked again with a
     * coordinate attached; saving it would put the question in the transcript
     * twice.
     *
     * A guest skips it entirely. So does a failed write: `persistTurn` catches
     * its own errors and returns null, and the answer ships either way.
     */
    if (user && !reply.needsLocation) {
      const saved = await persistTurn({
        userId: user.id,
        conversationId,
        clientId,
        question,
        questionLang: lang,
        askedAt,
        answer: reply.text,
        answerLang: reply.lang,
        grounding: reply.grounding,
        // Composed from the parse, not from a second model call: the place,
        // the variable and the day are already known by the time we are here.
        title: conversationTitle(title),
      });

      if (saved) {
        reply.conversationId = saved.conversationId;
        reply.conversationTitle = saved.title;
      }
    }

    return Response.json(reply, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    /*
     * A misconfigured deployment is reported AS a misconfiguration.
     *
     * An opaque 500 was rendered by the client as "Could not reach the
     * server. Check your connection" — sending an operator to look at their
     * wifi while the actual fault was an environment variable. The message
     * names the variable, never a value.
     */
    const configuration = isConfigurationError(error);
    const message = error instanceof Error ? error.message : String(error);

    // Logged at full detail whatever the environment, so a production fault is
    // still findable in the platform logs even when the response withholds it.
    console.error(
      JSON.stringify({
        event: configuration ? 'chat.misconfigured' : 'chat.failed',
        error: message,
      }),
    );

    return Response.json(
      {
        error: {
          kind: configuration ? 'configuration' : 'internal',
          // Withheld in production: a visitor can act on "not your
          // connection", not on the name of an environment variable.
          detail: configuration && mayRevealConfiguration() ? message : undefined,
        },
      },
      // 503, not 500: the service is unavailable until someone changes a
      // setting, which is a different thing from a request going wrong.
      { status: configuration ? 503 : 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
