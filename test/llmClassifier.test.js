import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt, SYSTEM_PROMPT, ALLOWED_INDUSTRIES } from '../src/classification/prompt.js';
import { parseClassification, classifyLead, classifyBatch, resolveProvider } from '../src/classification/llmClassifier.js';
import { needsClassification, buildUpdatePayload } from '../src/jobs/runLlmClassification.js';

// ── prompt ───────────────────────────────────────────────────────────────────

test('SYSTEM_PROMPT lists every taxonomy slug so the model cannot invent a 13th industry', () => {
  for (const slug of ALLOWED_INDUSTRIES) {
    assert.ok(SYSTEM_PROMPT.includes(slug), `expected taxonomy slug "${slug}" in the system prompt`);
  }
});

test('buildUserPrompt truncates website prose and surfaces prior-layer signal', () => {
  const lead = {
    company_name: 'Acme',
    category: 'Company',
    website: 'https://acme.com',
    industry: 'web-development',
    tag_source: 'rules',
    tag_confidence: 0.4,
    tags: ['web-development'],
    websiteProse: 'x'.repeat(5000),
  };
  const prompt = buildUserPrompt(lead);
  assert.ok(prompt.includes('Acme'));
  assert.ok(prompt.includes('prior guess: web-development'));
  assert.ok(prompt.length < 5000, 'prose must be truncated, not passed through whole');
});

test('buildUserPrompt handles a lead with no website content gracefully', () => {
  const prompt = buildUserPrompt({ company_name: 'NoSite Co' });
  assert.ok(prompt.includes('no website content available'));
});

// ── parseClassification (JSON extraction + repair) ─────────────────────────

test('parseClassification accepts clean JSON', () => {
  const result = parseClassification(
    '{"primary_industry":"ai-ml","secondary_services":["cloud-devops"],"confidence":0.8,"rationale_short":"builds ML pipelines"}'
  );
  assert.equal(result.industry, 'ai-ml');
  assert.deepEqual(result.secondary, ['cloud-devops']);
  assert.equal(result.confidence, 0.8);
});

test('parseClassification strips a markdown code fence the model added despite instructions', () => {
  const raw = '```json\n{"primary_industry":"mobile-apps","secondary_services":[],"confidence":0.6,"rationale_short":"ios/android"}\n```';
  const result = parseClassification(raw);
  assert.equal(result.industry, 'mobile-apps');
});

test('parseClassification extracts JSON even with leading/trailing chatter', () => {
  const raw = 'Sure, here is the classification:\n{"primary_industry":"ecommerce","secondary_services":[],"confidence":0.7,"rationale_short":"sells products online"}\nHope that helps!';
  const result = parseClassification(raw);
  assert.equal(result.industry, 'ecommerce');
});

test('parseClassification returns null for unrecoverable garbage', () => {
  assert.equal(parseClassification('not json at all'), null);
  assert.equal(parseClassification(''), null);
  assert.equal(parseClassification(null), null);
});

test('parseClassification treats a hallucinated industry slug as unclassified, not as data corruption', () => {
  const raw = '{"primary_industry":"underwater-basketweaving","secondary_services":[],"confidence":0.9,"rationale_short":"x"}';
  const result = parseClassification(raw);
  assert.equal(result.industry, null, 'a slug outside the taxonomy must never reach the leads table');
});

test('parseClassification treats "unclassified" as a legitimate null result, not a parse failure', () => {
  const result = parseClassification('{"primary_industry":"unclassified","secondary_services":[],"confidence":0.2,"rationale_short":"too vague"}');
  assert.notEqual(result, null);
  assert.equal(result.industry, null);
});

test('parseClassification clamps out-of-range confidence and filters secondary duplicates of the primary', () => {
  const result = parseClassification(
    '{"primary_industry":"ai-ml","secondary_services":["ai-ml","cloud-devops","not-a-real-slug"],"confidence":1.4,"rationale_short":"x"}'
  );
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.secondary, ['cloud-devops']);
});

// ── provider resolution ─────────────────────────────────────────────────────

test('resolveProvider returns the groq adapter and rejects an unimplemented provider by name', () => {
  assert.ok(resolveProvider('groq'));
  assert.throws(() => resolveProvider('gemini'), /Unknown LLM_PROVIDER/);
});

// ── classifyLead / classifyBatch (network stubbed) ─────────────────────────

function stubGroqResponse(bodies) {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call++;
    return body;
  };
  return () => {
    globalThis.fetch = original;
  };
}

const withGroqKey = { env: { GROQ_KEY_1: 'test-key' } };

test('classifyLead returns a parsed result on a clean 200', async () => {
  const restore = stubGroqResponse([
    {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"primary_industry":"ai-ml","secondary_services":[],"confidence":0.9,"rationale_short":"ai company"}' } }],
        usage: { total_tokens: 150 },
      }),
    },
  ]);
  try {
    const { result, error, usage } = await classifyLead({ company_name: 'Acme AI' }, withGroqKey);
    assert.equal(error, null);
    assert.equal(result.industry, 'ai-ml');
    assert.equal(usage.total_tokens, 150);
  } finally {
    restore();
  }
});

test('classifyLead rotates to the next key on a 429 rather than failing immediately', async () => {
  const restore = stubGroqResponse([
    { ok: false, status: 429, json: async () => ({}) },
    {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"primary_industry":"web-development","secondary_services":[],"confidence":0.7,"rationale_short":"x"}' } }],
      }),
    },
  ]);
  try {
    const { result, error } = await classifyLead(
      { company_name: 'Acme' },
      { env: { GROQ_KEY_1: 'k1', GROQ_KEY_2: 'k2' }, retryDelayMs: 1 }
    );
    assert.equal(error, null);
    assert.equal(result.industry, 'web-development');
  } finally {
    restore();
  }
});

test('classifyLead gives up and reports an error rather than throwing when every attempt fails', async () => {
  const restore = stubGroqResponse([{ ok: false, status: 500, json: async () => ({}) }]);
  try {
    const { result, error } = await classifyLead({ company_name: 'Acme' }, { ...withGroqKey, retryDelayMs: 1 });
    assert.equal(result, null);
    assert.ok(error);
  } finally {
    restore();
  }
});

test('classifyLead reports a clear error when no API key is configured, without ever calling fetch', async () => {
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const { result, error } = await classifyLead({ company_name: 'Acme' }, { env: {} });
    assert.equal(result, null);
    assert.match(error, /no API keys configured/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('classifyBatch isolates one lead failure from the rest — one bad response never drops the batch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const name = body.messages[1].content;
    if (name.includes('Broken')) return { ok: false, status: 500, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"primary_industry":"ai-ml","secondary_services":[],"confidence":0.8,"rationale_short":"x"}' } }],
      }),
    };
  };
  try {
    const leads = [{ company_name: 'Good Co' }, { company_name: 'Broken Co' }];
    const outcomes = await classifyBatch(leads, { ...withGroqKey, retryDelayMs: 1, concurrency: 2 });
    const good = outcomes.find((o) => o.lead.company_name === 'Good Co');
    const broken = outcomes.find((o) => o.lead.company_name === 'Broken Co');
    assert.equal(good.result.industry, 'ai-ml');
    assert.equal(broken.result, null);
  } finally {
    globalThis.fetch = original;
  }
});

// ── needsClassification (candidate selection) ───────────────────────────────

test('needsClassification selects a never-classified lead', () => {
  assert.ok(needsClassification({ tag_source: null, industry: null }, {}));
});

test('needsClassification selects a low-confidence rules/web result', () => {
  assert.ok(needsClassification({ tag_source: 'rules', tag_confidence: 0.3, industry: 'ai-ml' }, { confidenceThreshold: 0.65 }));
});

test('needsClassification skips a confident rules/web result', () => {
  assert.ok(!needsClassification({ tag_source: 'rules', tag_confidence: 0.9, industry: 'ai-ml' }, { confidenceThreshold: 0.65 }));
});

test('needsClassification is idempotent: skips a lead already classified by the same model version', () => {
  const lead = { tag_source: 'llm', llm_model: 'llama-3.1-8b-instant', industry: 'ai-ml', tag_confidence: 0.8 };
  assert.ok(!needsClassification(lead, { modelVersion: 'llama-3.1-8b-instant' }));
});

test('needsClassification re-selects an llm-tagged lead when the model version changed', () => {
  const lead = { tag_source: 'llm', llm_model: 'old-model', industry: 'ai-ml', tag_confidence: 0.8 };
  assert.ok(needsClassification(lead, { modelVersion: 'new-model' }));
});

test('needsClassification force-selects everything when forceReclassify is set', () => {
  const lead = { tag_source: 'llm', llm_model: 'current', industry: 'ai-ml', tag_confidence: 0.95 };
  assert.ok(needsClassification(lead, { modelVersion: 'current', forceReclassify: true }));
});

// ── buildUpdatePayload ──────────────────────────────────────────────────────

test('buildUpdatePayload shapes a row matching the leads table columns', () => {
  const payload = buildUpdatePayload(
    { industry: 'ai-ml', secondary: ['cloud-devops'], confidence: 0.82, rationale: 'ai infra company' },
    { model: 'llama-3.1-8b-instant', now: '2026-08-05T00:00:00.000Z' }
  );
  assert.equal(payload.tag_source, 'llm');
  assert.deepEqual(payload.tags, ['ai-ml', 'cloud-devops']);
  assert.deepEqual(payload.sub_industries, ['cloud-devops']);
  assert.equal(payload.llm_model, 'llama-3.1-8b-instant');
  assert.equal(payload.classified_at, '2026-08-05T00:00:00.000Z');
});

test('buildUpdatePayload produces empty tags for a genuinely unclassifiable lead', () => {
  const payload = buildUpdatePayload(
    { industry: null, secondary: [], confidence: 0.1, rationale: 'no evidence' },
    { model: 'llama-3.1-8b-instant', now: '2026-08-05T00:00:00.000Z' }
  );
  assert.equal(payload.industry, null);
  assert.deepEqual(payload.tags, []);
});
