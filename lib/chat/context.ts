/**
 * Bounding what gets sent to the model.
 *
 * Trimming is oldest-first and in whole messages. There is deliberately no
 * summarisation step: compacting history through a model would put a model
 * between the user's words and the query layer, which is the rewriting
 * forbidden everywhere else in this system. Dropping is lossy and honest;
 * summarising is lossy and invents.
 */

import type {
  ChatContext,
  ContextTurn,
  FactsSnapshot,
  Message,
  StandingQuery,
} from './types';

export const LIMITS = {
  /** Six exchanges. */
  maxTurns: 12,
  /** Roughly 1500 tokens at ~4 chars each. */
  maxChars: 6000,
  /** The newest message is never dropped, so it may be truncated instead. */
  maxSingleTurnChars: 2000,
} as const;

function compact(message: Message): ContextTurn {
  return { role: message.role, text: message.text };
}

/**
 * @param facts the CURRENT turn's fact set, or null for an ungrounded turn.
 *   Earlier turns' facts are never passed here — see ChatContext.facts.
 */
export function boundContext(
  messages: Message[],
  standing: StandingQuery | null,
  facts: FactsSnapshot | null,
): ChatContext {
  // Newest-first while trimming, flipped back at the end.
  const newestFirst = messages.slice(-LIMITS.maxTurns).reverse().map(compact);

  const kept: ContextTurn[] = [];
  let used = 0;

  for (const turn of newestFirst) {
    const isNewest = kept.length === 0;
    let text = turn.text;

    // One very long message must not starve the rest of the window.
    if (text.length > LIMITS.maxSingleTurnChars) {
      text = text.slice(0, LIMITS.maxSingleTurnChars);
    }

    if (used + text.length > LIMITS.maxChars) {
      // The newest message is kept whatever the budget says: it is the
      // question being answered. Everything older simply stops here.
      if (!isNewest) break;
      text = text.slice(0, LIMITS.maxChars);
    }

    kept.push({ role: turn.role, text });
    used += text.length;
  }

  return {
    history: kept.reverse(),
    // Never trimmed. Small, and it is what makes a follow-up resolvable.
    standing,
    facts,
  };
}
