// Google Gemini adapter — uses Gemini's OpenAI-compatibility layer rather than
// its native generateContent API, so this stays the same ~40-line shape as
// every other provider here instead of needing a second response parser.
//
// The native API nests differently (candidates[].content.parts[].text, plus
// contents/systemInstruction instead of messages), so if this endpoint is ever
// retired the parsing below has to change too — it is not a URL swap.
import { parseRetryAfter } from './retryAfter.js';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// Flash tier: the free-est and fastest Gemini, ample for a 25-way
// classification with a short prompt.
const DEFAULT_MODEL = 'gemini-2.0-flash';

export function loadGeminiKeys(env = process.env) {
  const numbered = [1, 2, 3].map((i) => env[`GEMINI_KEY_${i}`]).filter(Boolean);
  if (numbered.length > 0) return numbered;
  // GOOGLE_API_KEY is the name Google's own SDKs default to, so accept it too
  // rather than making someone rename a key that already works elsewhere.
  return [env.GEMINI_API_KEY, env.GOOGLE_API_KEY].filter(Boolean);
}

/**
 * One HTTP request to Gemini's OpenAI-compatible endpoint. Key rotation and
 * retry stay with the caller (llmClassifier.js), matching callGroq's contract.
 */
export async function callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutMs }) {
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
    const err = new Error(`Gemini HTTP ${res.status}`);
    err.status = res.status;
    // 403 here usually means the key lacks Generative Language API access
    // rather than a transient fault, so it is deliberately not retryable —
    // retrying a misconfigured key just burns the whole rotation.
    err.retryable = res.status === 429 || res.status >= 500;
    err.retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Gemini response had no message content');
  return { text, usage: data?.usage || null };
}

export const GEMINI_DEFAULT_MODEL = DEFAULT_MODEL;
