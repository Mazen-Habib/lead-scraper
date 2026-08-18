// Layer 3 classification job — `node src/index.js classify`.
//
// Runs as a separate, decoupled job over already-persisted leads (not inline
// in the scrape pipeline), because it isn't latency-sensitive and batching
// against a free-tier rate limit is much easier to reason about as a
// scheduled sweep than as part of a 6-hour scrape run. Mirrors the shape of
// src/personalized/runSavedSearches.js: a thin orchestration function around
// pure, independently-testable helpers.
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { classifyBatch, resolveProvider } from '../classification/llmClassifier.js';
import { readAsText } from '../lib/jinaReader.js';

const PAGE_SIZE = 500; // Supabase/PostgREST page cap

/**
 * True if a lead is worth sending to the LLM: never classified, or its
 * current tag came from something less confident than an LLM pass should be
 * trusted over, or it was classified by an LLM but a different model version
 * (a taxonomy/model change should be able to re-run without re-touching
 * everything — see forceReclassify for the "touch everything" escape hatch).
 */
export function needsClassification(lead, { confidenceThreshold = 0.65, modelVersion, forceReclassify = false } = {}) {
  if (forceReclassify) return true;
  if (!lead.tag_source || lead.industry == null) return true;
  if (lead.tag_source === 'llm') {
    // Idempotent: a lead already classified by the SAME model version is
    // left alone, even on a re-run — this is what makes repeated invocations
    // of the job safe/cheap rather than re-billing every lead every time.
    return lead.llm_model !== modelVersion;
  }
  const confidence = typeof lead.tag_confidence === 'number' ? lead.tag_confidence : 0;
  return confidence < confidenceThreshold;
}

/** The row this job writes back for one classified lead. */
export function buildUpdatePayload(classification, { model, now }) {
  const { industry, secondary, confidence, rationale } = classification;
  return {
    industry,
    tags: industry ? [industry, ...secondary] : [],
    sub_industries: secondary,
    tag_confidence: confidence,
    tag_source: 'llm',
    llm_model: model,
    classified_at: now,
    // Kept off the leads table on purpose — rationale is job-log material,
    // not a column anything queries on. Returned to the caller for logging.
    _rationale: rationale,
  };
}

async function fetchCandidates(supabase, { confidenceThreshold, modelVersion, forceReclassify, maxLeads }) {
  const rows = [];
  for (let from = 0; rows.length < maxLeads; from += PAGE_SIZE) {
    let query = supabase
      .from('leads')
      .select(
        'id, company_name, category, website, industry, tags, tag_confidence, tag_source, llm_model, deleted_at'
      )
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);

    // When not forcing a full re-run, let Postgres do the coarse filtering —
    // "confidently already tagged by rules/web" never needs to leave the DB.
    if (!forceReclassify) {
      query = query.or(`tag_source.is.null,tag_confidence.lt.${confidenceThreshold},tag_source.eq.llm`);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Supabase candidate query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (needsClassification(row, { confidenceThreshold, modelVersion, forceReclassify })) {
        rows.push(row);
        if (rows.length >= maxLeads) break;
      }
    }
    if (data.length < PAGE_SIZE) break;
  }
  return rows.slice(0, maxLeads);
}

/**
 * Fetches website prose for leads that have a website but no cached prose —
 * reuses the same Jina Reader helper the web tagger uses, so Layer 3 sees the
 * same clean text Layer 2 already proved works, rather than raw HTML.
 */
async function attachWebsiteProse(leads, { timeoutMs, concurrency = 3 }) {
  const withSite = leads.filter((l) => l.website);
  const queue = [...withSite];
  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      lead.websiteProse = (await readAsText(lead.website, { timeoutMs })) || '';
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

/**
 * Entry point. Reads config.llmClassification, selects candidates, classifies
 * them, and writes results back — or, in dry-run mode, just reports what it
 * would have done. Every failure is isolated to its own lead; the job always
 * finishes and reports counts rather than throwing partway through a batch.
 */
export async function runLlmClassification({ config = {} } = {}) {
  const opts = {
    enabled: true,
    provider: 'groq',
    model: undefined,
    confidenceThreshold: 0.65,
    batchSize: 100,
    maxLeadsPerRun: 1000,
    concurrency: 3,
    dryRun: false,
    forceReclassify: false,
    timeoutMs: 20000,
    maxRetries: 5,
    ...(config.llmClassification || {}),
  };

  if (!opts.enabled) {
    console.log('Layer 3 classification disabled (config.llmClassification.enabled = false)');
    return { candidates: 0, classified: 0, failed: 0, dryRun: opts.dryRun };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log('Supabase not configured — Layer 3 classification needs SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.');
    return { candidates: 0, classified: 0, failed: 0, dryRun: opts.dryRun };
  }

  console.log('Layer 3 (LLM) classification starting\n');
  // Ask the selected provider for its own default rather than hardcoding
  // Groq's. modelVersion is persisted per lead and drives which rows count as
  // already-classified in fetchCandidates, so stamping Groq's model name on a
  // lead an OpenRouter model actually classified would both mislabel the row
  // and make the two providers' output indistinguishable on re-runs.
  const modelVersion = opts.model || resolveProvider(opts.provider).defaultModel;

  const candidates = await fetchCandidates(supabase, {
    confidenceThreshold: opts.confidenceThreshold,
    modelVersion,
    forceReclassify: opts.forceReclassify,
    maxLeads: opts.maxLeadsPerRun,
  });
  console.log(`  ${candidates.length} candidate lead(s) selected (cap ${opts.maxLeadsPerRun})`);

  if (candidates.length === 0) {
    return { candidates: 0, classified: 0, failed: 0, dryRun: opts.dryRun };
  }

  if (opts.dryRun) {
    console.log(`  [dry-run] would classify ${candidates.length} lead(s) via ${opts.provider}/${modelVersion} — no API calls made, no writes made`);
    return { candidates: candidates.length, classified: 0, failed: 0, dryRun: true };
  }

  let classified = 0;
  let failed = 0;
  let tokensUsed = 0;

  for (let i = 0; i < candidates.length; i += opts.batchSize) {
    const chunk = candidates.slice(i, i + opts.batchSize);
    await attachWebsiteProse(chunk, { timeoutMs: opts.timeoutMs, concurrency: opts.concurrency });

    const outcomes = await classifyBatch(chunk, {
      providerName: opts.provider,
      model: opts.model,
      concurrency: opts.concurrency,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
    });

    const now = new Date().toISOString();
    for (const { lead, result, model, usage, error } of outcomes) {
      if (usage?.total_tokens) tokensUsed += usage.total_tokens;
      if (!result) {
        failed++;
        console.warn(`  !! ${lead.company_name || lead.id}: ${error || 'classification failed'}`);
        continue;
      }
      const payload = buildUpdatePayload(result, { model, now });
      const { _rationale, ...row } = payload;
      const { error: updErr } = await supabase.from('leads').update(row).eq('id', lead.id);
      if (updErr) {
        failed++;
        console.warn(`  !! ${lead.company_name || lead.id}: write failed — ${updErr.message}`);
        continue;
      }
      classified++;
    }
    console.log(`  progress: ${classified} classified, ${failed} failed (${i + chunk.length}/${candidates.length} processed)`);
  }

  console.log(`\nLayer 3 classification complete: ${classified} classified, ${failed} failed` + (tokensUsed ? `, ~${tokensUsed} tokens used` : ''));
  return { candidates: candidates.length, classified, failed, dryRun: false, tokensUsed };
}
