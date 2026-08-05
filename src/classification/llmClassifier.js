// Layer 3 LLM classifier — the last resort for leads the rules pass
// (src/quality/classifier.js) and the web-tagger pass (src/quality/webTagger.js)
// both left unclassified or low-confidence. Provider-agnostic by design: today
// only Groq is wired up (see providers/groq.js — already-configured, free),
// but classifyLead/classifyBatch don't know that, so adding Gemini/DeepSeek/
// OpenAI later is a new file in providers/ plus one line in PROVIDERS below,
// not a rewrite of this module.
import { SYSTEM_PROMPT, buildUserPrompt, ALLOWED_INDUSTRIES } from './prompt.js';
import { callGroq, loadGroqKeys, GROQ_DEFAULT_MODEL } from './providers/groq.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each provider exposes: call({apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutMs}),
// loadKeys(env), defaultModel. Only 'groq' is implemented; 'gemini'/'deepseek'/
// 'openai' are intentionally left as documented gaps (see README) rather than
// speculative untested code for services this project has no credentials for.
const PROVIDERS = {
  groq: { call: callGroq, loadKeys: loadGroqKeys, defaultModel: GROQ_DEFAULT_MODEL },
};

export function resolveProvider(name = 'groq') {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown LLM_PROVIDER "${name}". Implemented: ${Object.keys(PROVIDERS).join(', ')}. ` +
        `See src/classification/providers/ to add another.`
    );
  }
  return provider;
}

/**
 * Best-effort JSON extraction. Models occasionally wrap valid JSON in a code
 * fence or add a stray character despite instructions — this recovers the
 * common cases instead of discarding an otherwise-good classification.
 */
export function parseClassification(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1].trim();

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (!braceMatch) return null;
    try {
      obj = JSON.parse(braceMatch[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;

  const primary = typeof obj.primary_industry === 'string' ? obj.primary_industry : null;
  if (!primary) return null;

  const industry = ALLOWED_INDUSTRIES.includes(primary) ? primary : primary === 'unclassified' ? null : null;
  // A slug outside the allowed list AND not "unclassified" means the model
  // hallucinated a category — treat as unclassified rather than polluting the
  // taxonomy every other part of the app relies on.
  const secondary = Array.isArray(obj.secondary_services)
    ? obj.secondary_services.filter((s) => typeof s === 'string' && ALLOWED_INDUSTRIES.includes(s) && s !== industry)
    : [];

  const confidence = typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0;
  const rationale = typeof obj.rationale_short === 'string' ? obj.rationale_short.slice(0, 200) : '';

  return { industry, secondary, confidence, rationale };
}

/**
 * Classifies one lead. Rotates across the provider's key pool on a
 * rate-limit/5xx (same shape as scrapegraph_enricher.py's Groq→Groq→Groq
 * rotation), retrying up to 2 full passes over the pool before giving up.
 *
 * Returns null (never throws) on exhaustion or an unparseable response — the
 * caller treats that as "still unclassified", same as the web tagger's
 * silent-skip contract. A batch job over hundreds of leads must never die on
 * one bad response.
 */
export async function classifyLead(lead, opts = {}) {
  const {
    providerName = 'groq',
    model,
    env = process.env,
    maxTokens = 120,
    timeoutMs = 20000,
    retryDelayMs = 2000,
  } = opts;

  const provider = resolveProvider(providerName);
  const keys = provider.loadKeys(env);
  if (keys.length === 0) return { result: null, error: `no API keys configured for provider "${providerName}"` };

  const userPrompt = buildUserPrompt(lead);
  const maxAttempts = keys.length * 2;
  let lastErr = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = keys[attempt % keys.length];
    try {
      const { text, usage } = await provider.call({
        apiKey,
        model: model || provider.defaultModel,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxTokens,
        timeoutMs,
      });
      const parsed = parseClassification(text);
      if (!parsed) {
        lastErr = 'unparseable response';
        continue; // try next key — a malformed response isn't necessarily reproducible
      }
      return { result: parsed, usage, model: model || provider.defaultModel, error: null };
    } catch (err) {
      lastErr = err.message;
      if (err.retryable) {
        await sleep(retryDelayMs);
        continue;
      }
      // Non-retryable (bad request, auth failure) — no point rotating keys.
      break;
    }
  }
  return { result: null, error: lastErr || 'exhausted retries' };
}

/**
 * Classifies many leads with bounded concurrency. Every lead's outcome is
 * independent — one failure never drops the rest of the batch, matching
 * gatherLeads()/tagLeadsFromWeb()'s per-item resilience elsewhere in this
 * pipeline.
 */
export async function classifyBatch(leads, opts = {}) {
  const { concurrency = 3 } = opts;
  const queue = [...leads];
  const results = new Map(); // lead -> outcome, in case a caller wants the association

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      const outcome = await classifyLead(lead, opts);
      results.set(lead, outcome);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return leads.map((lead) => ({ lead, ...results.get(lead) }));
}
