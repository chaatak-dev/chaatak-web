/**
 * Sarvam, as a third implementation for evaluation.
 *
 * Built against the interface, unselectable until a key exists: `configured()`
 * returns false without SARVAM_API_KEY, so the chain skips it without a
 * network call and nothing blocks on it.
 *
 * The request shape below follows Sarvam's OpenAI-compatible chat endpoint and
 * has NOT been verified against the live service — we have no key to verify
 * with. Treat it as unproven until it has been run once for real, the way
 * Bhashini and Groq were.
 */

import type {
  CompletionRequest,
  CompletionResult,
  LanguageModel,
} from './types';

const BASE_URL = process.env.SARVAM_BASE_URL ?? 'https://api.sarvam.ai/v1';
const DEFAULT_TIMEOUT_MS = 12_000;

export function sarvamModel(
  model = process.env.SARVAM_MODEL ?? 'sarvam-m',
): LanguageModel {
  const label = 'sarvam';

  return {
    name: label,
    model,

    configured() {
      return Boolean(process.env.SARVAM_API_KEY);
    },

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const key = process.env.SARVAM_API_KEY;
      if (!key) {
        return {
          kind: 'unavailable',
          provider: label,
          reason: 'no SARVAM_API_KEY — implementation present, not yet enabled',
        };
      }

      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: request.temperature ?? 0,
            max_tokens: request.maxTokens ?? 500,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            ...(request.schema
              ? { response_format: { type: 'json_object' } }
              : {}),
          }),
          signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          cache: 'no-store',
        });
      } catch (error) {
        return {
          kind: 'failed',
          provider: label,
          reason: error instanceof Error ? error.name : 'network error',
        };
      }

      if (res.status === 429) return { kind: 'rateLimited', provider: label };
      if ([401, 403, 404].includes(res.status)) {
        return { kind: 'unavailable', provider: label, reason: `HTTP ${res.status}` };
      }
      if (!res.ok) {
        return { kind: 'failed', provider: label, reason: `HTTP ${res.status}` };
      }

      try {
        const json = (await res.json()) as {
          choices?: { message?: { content?: string }; finish_reason?: string }[];
        };
        const choice = json.choices?.[0];
        const text = choice?.message?.content;
        if (typeof text !== 'string' || !text.trim()) {
          return { kind: 'failed', provider: label, reason: 'empty completion' };
        }
        // Stopped by the token limit, not by the model: the text ends
        // wherever the budget ran out — possibly one word before "not". A
        // truncated answer is not an answer, and the gate cannot see a
        // missing clause. (Reasoning models spend the same budget thinking,
        // so this is not a rare case.)
        if (choice?.finish_reason === 'length') {
          return { kind: 'failed', provider: label, reason: 'truncated at the token limit' };
        }
        return {
          kind: 'ok',
          text,
          provider: label,
          model,
          latencyMs: Date.now() - started,
        };
      } catch {
        return { kind: 'failed', provider: label, reason: 'unparseable response' };
      }
    },
  };
}
