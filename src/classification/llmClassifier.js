// Layer 3 LLM classifier — the last resort for leads the rules pass
// (src/quality/classifier.js) and the web-tagger pass (src/quality/webTagger.js)
// both left unclassified or low-confidence. Provider-agnostic by design:
// classifyLead/classifyBatch never touch a provider directly, so adding one is
// a new file in providers/ plus one line in PROVIDERS below.
//
// Every provider here has a free tier, which is the selection criterion — this
// project runs on free infrastructure end to end. They are all OpenAI-shaped
// Chat Completions, which is why each adapter is ~40 lines rather than a
// bespoke client.
import { SYSTEM_PROMPT, buildUserPrompt, ALLOWED_INDUSTRIES } from './prompt.js';
import { callGroq, loadGroqKeys, GROQ_DEFAULT_MODEL } from './providers/groq.js';
import {
  callOpenRouter,
  loadOpenRouterKeys,
  OPENROUTER_DEFAULT_MODEL,
} from './providers/openrouter.js';
import { callCerebras, loadCerebrasKeys, CEREBRAS_DEFAULT_MODEL } from './providers/cerebras.js';
import { callGemini, loadGeminiKeys, GEMINI_DEFAULT_MODEL } from './providers/gemini.js';
import {
  callCloudflare,
  loadCloudflareKeys,
  CLOUDFLARE_DEFAULT_MODEL,
} from './providers/cloudflare.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each provider exposes: call({apiKey, model, systemPrompt, userPrompt, maxTokens, timeoutMs}),
// loadKeys(env), defaultModel. 'deepseek'/'openai' remain deliberate gaps —
// neither has a free tier worth wiring for this workload.
const PROVIDERS = {
  groq: { call: callGroq, loadKeys: loadGroqKeys, defaultModel: GROQ_DEFAULT_MODEL },
  openrouter: {
    call: callOpenRouter,
    loadKeys: loadOpenRouterKeys,
    defaultModel: OPENROUTER_DEFAULT_MODEL,
  },
  cerebras: { call: callCerebras, loadKeys: loadCerebrasKeys, defaultModel: CEREBRAS_DEFAULT_MODEL },
  gemini: { call: callGemini, loadKeys: loadGeminiKeys, defaultModel: GEMINI_DEFAULT_MODEL },
  cloudflare: {
    call: callCloudflare,
    loadKeys: loadCloudflareKeys,
    defaultModel: CLOUDFLARE_DEFAULT_MODEL,
  },
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
    // Enough attempts to ride out a free-tier rate limit rather than treating
    // the first 429 as terminal. With exponential backoff, 5 attempts span
    // roughly 2s+4s+8s+16s of waiting before giving up on a lead.
    maxRetries = 5,
  } = opts;

  const provider = resolveProvider(providerName);
  const keys = provider.loadKeys(env);
  if (keys.length === 0) return { result: null, error: `no API keys configured for provider "${providerName}"` };

  const userPrompt = buildUserPrompt(lead);
  // Attempts must not be derived from key count alone. With a single key that
  // gave 2 tries, and on a rate-limited free tier the first 429 plus one fixed
  // 2s wait burned both — a measured run classified 56 of 1000 leads and failed
  // 644 on HTTP 429. Retries are about waiting out a limit, not cycling keys.
  const maxAttempts = Math.max(keys.length * 2, maxRetries);
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
      if (err.retryable && attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt, retryDelayMs, err.retryAfterMs));
        continue;
      }
      // Non-retryable (bad request, auth failure) — no point rotating keys.
      break;
    }
  }
  return { result: null, error: lastErr || 'exhausted retries' };
}

/**
 * How long to wait before retrying attempt N (0-based).
 *
 * Prefers the server's own Retry-After when it sent one — no guess beats being
 * told. Otherwise exponential backoff with jitter: a fixed delay across several
 * concurrent workers makes them retry in lockstep and trip the same limit
 * together, so the retries themselves keep the limit tripped. Jitter spreads
 * them out; the exponent gives a saturated free tier time to actually recover.
 *
 * Capped so one stubborn lead can't stall a whole batch for minutes.
 */
export function backoffMs(attempt, baseMs = 2000, retryAfterMs = null) {
  const CAP_MS = 60000;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(retryAfterMs, CAP_MS);
  }
  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.random() * baseMs; // full-ish jitter, never negative
  return Math.min(exponential + jitter, CAP_MS);
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
