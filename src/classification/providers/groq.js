// Groq adapter — the default (and currently only implemented) Layer 3
// provider. Groq's Chat Completions endpoint is OpenAI-compatible and plain
// `fetch`-callable, so this needs no SDK.
//
// Why Groq by default: GROQ_KEY_1..3 already exist in this project's env and
// GitHub secrets (used by src/scrapers/scrapegraph_enricher.py for email
// enrichment) and Groq's free tier is generous — so Layer 3 costs nothing new
// to turn on. Key rotation on rate-limit mirrors scrapegraph_enricher.py's
// pattern (Groq 1→2→3, sleep, retry) so this project has one consistent way
// of spreading load across a key pool rather than two.
import { parseRetryAfter } from './retryAfter.js';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// llama-3.1-8b-instant: fast and cheap, plenty for a 12-way classification
// task with a short prompt. The heavier 70b model is reserved for
// scrapegraph_enricher.py's harder job (open-ended email-page reading).
// Override via config/env if a harder taxonomy needs the larger model.
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

export function loadGroqKeys(env = process.env) {
  return [1, 2, 3].map((i) => env[`GROQ_KEY_${i}`]).filter(Boolean);
}

/**
 * Calls Groq chat completions for one prompt pair. Callers handle key
 * rotation/retry (see llmClassifier.js) — this function makes exactly one
 * HTTP request and returns its parsed JSON body or throws.
 */
export async function callGroq({ apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutMs }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
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
    const err = new Error(`Groq HTTP ${res.status}`);
    err.status = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    // Free tiers rate-limit aggressively and say how long to wait; honouring it
    // beats guessing. Seconds per the HTTP spec, occasionally a date.
    err.retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq response had no message content');
  return { text, usage: data?.usage || null };
}

export const GROQ_DEFAULT_MODEL = DEFAULT_MODEL;
