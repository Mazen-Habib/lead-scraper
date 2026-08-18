// Cloudflare Workers AI adapter — uses Cloudflare's OpenAI-compatible route so
// the response parsing matches every other provider here. Note the native
// Workers AI route (/ai/run/<model>) returns {result: {response}} instead of
// {choices: [...]}, so this must stay on the /ai/v1/ path below.
//
// Cloudflare is the one provider here that needs TWO values: the endpoint is
// account-scoped, so a token alone is useless. CLOUDFLARE_ACCOUNT_ID is read
// at call time and loadCloudflareKeys() reports no keys when it's absent —
// that way an incomplete config is a clean no-op (the same shape as every
// other unconfigured rung in this project) rather than a 404 mid-run.
// Verified live through the /ai/v1/ path below. Cloudflare retires models on a
// published schedule and a retired one returns HTTP 410 with a "Model has been
// deprecated" body — which reads like a dead endpoint but is not, so check the
// model catalogue before touching the URL:
//   GET /client/v4/accounts/<id>/ai/models/search?task=Text%20Generation
import { parseRetryAfter } from './retryAfter.js';
const DEFAULT_MODEL = '@cf/meta/llama-3.2-3b-instruct';

function endpointFor(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
}

export function loadCloudflareKeys(env = process.env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID) return [];
  const numbered = [1, 2, 3].map((i) => env[`CLOUDFLARE_KEY_${i}`]).filter(Boolean);
  if (numbered.length > 0) return numbered;
  return [env.CLOUDFLARE_API_TOKEN].filter(Boolean);
}

/**
 * One HTTP request to Cloudflare Workers AI. Key rotation and retry stay with
 * the caller (llmClassifier.js), matching callGroq's contract.
 */
export async function callCloudflare({ apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutMs, env = process.env }) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    // Defensive: loadCloudflareKeys already gates on this, so reaching here
    // means someone called the adapter directly.
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required for the cloudflare provider');
  }

  const res = await fetch(endpointFor(accountId), {
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
    const err = new Error(`Cloudflare HTTP ${res.status}`);
    err.status = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    // Free tiers rate-limit aggressively and say how long to wait; honouring it
    // beats guessing. Seconds per the HTTP spec, occasionally a date.
    err.retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Cloudflare response had no message content');
  return { text, usage: data?.usage || null };
}

export const CLOUDFLARE_DEFAULT_MODEL = DEFAULT_MODEL;
