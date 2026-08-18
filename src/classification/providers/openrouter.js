// OpenRouter adapter — the fallback Layer 3 provider for when Groq isn't
// usable (it isn't available in every country, and this project is run from
// Pakistan). Like Groq, OpenRouter speaks OpenAI-compatible Chat Completions
// over plain `fetch`, so this is the same ~30 lines with a different base URL.
//
// Why OpenRouter as the alternative: one key reaches many models, and several
// carry a `:free` suffix that costs nothing — so the "everything in this stack
// is free" property holds. If a given free model is saturated, switching is a
// model-string change (env LLM_MODEL), not a new provider.
import { parseRetryAfter } from './retryAfter.js';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// A `:free` model by design — see the note above. Free models are rate-limited
// rather than billed, so a 429 here means "wait", not "pay", which is exactly
// what llmClassifier.js's retry loop already handles via err.retryable.
//
// Verified live against OpenRouter's catalogue: this model returns clean JSON
// with ZERO reasoning tokens. That matters more than raw capability here —
// most of the current free pool (gpt-oss-20b, nemotron-nano) are reasoning
// models that spend 100-260 tokens thinking before emitting anything, so at
// classifyLead's 120-token budget they return an EMPTY content string and the
// classification fails. If you swap this model, check reasoning_tokens in the
// usage payload, not just that the call returns 200.
const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

// Mirrors loadGroqKeys' 1..3 pool convention so llmClassifier.js's rotation
// works identically regardless of which provider is selected. A single
// OPENROUTER_API_KEY (no suffix) is also accepted, since one key is the common
// case for OpenRouter — unlike Groq, there's little reason to hold three.
export function loadOpenRouterKeys(env = process.env) {
  const numbered = [1, 2, 3].map((i) => env[`OPENROUTER_KEY_${i}`]).filter(Boolean);
  if (numbered.length > 0) return numbered;
  return [env.OPENROUTER_API_KEY].filter(Boolean);
}

/**
 * Calls OpenRouter chat completions for one prompt pair. Exactly one HTTP
 * request; key rotation and retry are the caller's job (llmClassifier.js),
 * matching callGroq's contract.
 */
export async function callOpenRouter({ apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutMs }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter uses these for attribution on its dashboard/leaderboards.
      // Optional, but sending them keeps the account's usage legible rather
      // than showing up as anonymous traffic.
      'HTTP-Referer': 'https://github.com/Mazen-Habib/lead-scraper',
      'X-Title': 'lead-scraper',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      temperature: 0,
      max_tokens: maxTokens ?? 120,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs ?? 20000),
  });

  if (!res.ok) {
    const err = new Error(`OpenRouter HTTP ${res.status}`);
    err.status = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    // Free tiers rate-limit aggressively and say how long to wait; honouring it
    // beats guessing. Seconds per the HTTP spec, occasionally a date.
    err.retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
    throw err;
  }

  const data = await res.json();

  // OpenRouter returns HTTP 200 with an `error` object for upstream provider
  // failures (model cold/unavailable, free-tier pool exhausted) rather than a
  // non-2xx status, so `res.ok` alone is not enough to call this a success.
  if (data?.error) {
    const err = new Error(`OpenRouter: ${data.error.message || 'upstream error'}`);
    err.status = data.error.code;
    err.retryable = data.error.code === 429 || Number(data.error.code) >= 500;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    // Distinguish the reasoning-model case from a generic empty response: a
    // reasoning model that burned the whole budget thinking returns 200 with
    // empty content and non-zero reasoning_tokens. Saying so beats "no message
    // content", which sends the reader hunting for a network fault.
    const reasoning = data?.usage?.completion_tokens_details?.reasoning_tokens;
    if (reasoning > 0) {
      throw new Error(
        `OpenRouter returned no content: model "${model || DEFAULT_MODEL}" spent all ` +
          `${reasoning} completion tokens on internal reasoning. Raise maxTokens or ` +
          `pick a non-reasoning model.`
      );
    }
    throw new Error('OpenRouter response had no message content');
  }
  return { text, usage: data?.usage || null };
}

export const OPENROUTER_DEFAULT_MODEL = DEFAULT_MODEL;
