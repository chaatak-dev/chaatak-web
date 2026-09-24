/**
 * Groq, via its OpenAI-compatible endpoint.
 *
 * Model ids and the base URL come from env, so moving to a paid key or a
 * different model is configuration rather than a code change.
 *
 * Note for anyone probing this API by hand: Groq sits behind Cloudflare, which
 * rejects some clients on User-Agent alone and answers "error code: 1010".
 * That is a fingerprint block, not an auth failure — it looks exactly like a
 * dead key and is not one.
 */

import type {
  CompletionRequest,
  CompletionResult,
  LanguageModel,
} from './types';

const BASE_URL = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1';
const DEFAULT_TIMEOUT_MS = 12_000;

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export function groqModel(model: string, label = 'groq'): LanguageModel {
  return {
    name: label,
    model,

    configured() {
      return Boolean(process.env.GROQ_API_KEY);
    },

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const key = process.env.GROQ_API_KEY;
      if (!key) {
        return { kind: 'unavailable', provider: label, reason: 'no GROQ_API_KEY' };
      }

      const body: Record<string, unknown> = {
        model,
        temperature: request.temperature ?? 0,
        max_tokens: request.maxTokens ?? 500,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      };

      if (request.schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.schemaName ?? 'result',
            strict: true,
            schema: request.schema,
          },
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
          body: JSON.stringify(body),
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

      if (res.status === 429) {
        return { kind: 'rateLimited', provider: label, retryAfterMs: retryAfterMs(res) };
      }
      if (res.status === 401 || res.status === 403) {
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
