// Layer 3 classification prompt — reuses the SAME shared/taxonomy.json the
// rules classifier (src/quality/classifier.js) and the web tagger
// (src/quality/webTagger.js) already use, so the LLM is never allowed to
// invent a 13th industry the rest of the app doesn't understand.
import { TAXONOMY } from '../quality/classifier.js';

const ALLOWED_INDUSTRIES = TAXONOMY.industries.map((i) => i.slug);

// Truncated hard enough that a Groq free-tier token budget is never at risk —
// this is the last, most-ambiguous slice of leads, not a place to spend more
// tokens than the first two free layers did combined.
const MAX_PROSE_CHARS = 2800; // ~700 tokens

export { ALLOWED_INDUSTRIES };

export const SYSTEM_PROMPT = `You classify B2B companies into a fixed taxonomy. Output ONLY valid JSON, no markdown, no code fences, no explanation outside the JSON.

Allowed industries (use the exact slug, nothing else):
${ALLOWED_INDUSTRIES.join(', ')}

Rules:
- primary_industry must be one of the allowed slugs above, or "unclassified" if genuinely none fit.
- secondary_services: 0-3 additional slugs from the same list that also apply. Omit the primary one.
- confidence: your genuine certainty from 0.0 to 1.0. Use low values (below 0.5) when the evidence is thin or contradictory — do not inflate confidence to seem helpful.
- rationale_short: max 15 words, the single strongest piece of evidence.

Output shape exactly:
{"primary_industry":"slug","secondary_services":["slug"],"confidence":0.0,"rationale_short":"..."}`;

/**
 * Builds the user message for one lead. Includes whatever weak signal the
 * earlier layers already produced (rules tags, web-tagger tags) as context —
 * the LLM isn't starting from zero, it's resolving a case those two passes
 * couldn't confidently close.
 */
export function buildUserPrompt(lead) {
  const prose = (lead.websiteProse || '').slice(0, MAX_PROSE_CHARS);
  const priorSignal = [
    lead.industry ? `prior guess: ${lead.industry} (${lead.tag_source}, confidence ${lead.tag_confidence ?? 'n/a'})` : null,
    Array.isArray(lead.tags) && lead.tags.length > 0 ? `prior tags: ${lead.tags.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `Company: ${lead.company_name || lead.name || 'Unknown'}`,
    lead.category ? `Directory category: ${lead.category}` : null,
    lead.website ? `Website: ${lead.website}` : null,
    priorSignal || null,
    prose ? `Website content (truncated):\n${prose}` : '(no website content available)',
  ]
    .filter(Boolean)
    .join('\n');
}
