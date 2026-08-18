// Cerebras adapter — OpenAI-compatible Chat Completions, same shape as
// providers/groq.js. Cerebras runs Llama models on its own inference silicon
// and is typically the fastest of the free options; its free tier is rate-
// limited per minute/day rather than billed.
const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';

// Cerebras' catalogue is small and changes; query GET /v1/models with the key
// rather than assuming a Llama id (llama3.1-8b 404s — the naming differs from
// both Groq and OpenRouter).
//
// IMPORTANT: Cerebras is NOT reliably free. Verified live 2026-08-18: a fresh
// account with a valid key returns HTTP 402 payment_required ("Visit your
// billing tab") for every model, so this provider is unusable without billing
// enabled. Unlike a 429 that means "wait", 402 means "pay" — it is correctly
// non-retryable below. Prefer openrouter or cloudflare for a free setup.
const DEFAULT_MODEL = 'gpt-oss-120b';

export function loadCerebrasKeys(env = process.env) {
  const numbered = [1, 2, 3].map((i) => env[`CEREBRAS_KEY_${i}`]).filter(Boolean);
  if (numbered.length > 0) return numbered;
  return [env.CEREBRAS_API_KEY].filter(Boolean);
}

/**
 * One HTTP request to Cerebras chat completions. Key rotation and retry stay
 * with the caller (llmClassifier.js), matching callGroq's contract.
 */
export async function callCerebras({ apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutMs }) {
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
    const err = new Error(`Cerebras HTTP ${res.status}`);
    err.status = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Cerebras response had no message content');
  return { text, usage: data?.usage || null };
}

export const CEREBRAS_DEFAULT_MODEL = DEFAULT_MODEL;
