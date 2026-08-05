// Rules-based region resolver (roadmap 4.2) — promotes the region-keyword
// matching that used to live only in the frontend's LeadsTable.tsx (matched
// client-side against address+search_query on every filter change) into a
// real column computed once at scrape time, from the shared definition in
// ../../shared/regions.json.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGIONS = JSON.parse(readFileSync(resolve(root, 'shared/regions.json'), 'utf8'));

function regionHaystack(lead) {
  return [lead.address, lead.search_query].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Resolves a single lead's region slug/label against the shared region
 * keyword lists. Returns null if nothing matches (address too sparse, or a
 * location the taxonomy doesn't cover yet).
 */
export function resolveRegion(lead) {
  const haystack = regionHaystack(lead);
  if (!haystack) return null;

  let best = null;
  for (const { slug, label, keywords } of REGIONS.regions) {
    const matched = keywords.filter((kw) => haystack.includes(kw));
    if (matched.length > 0 && (!best || matched.length > best.matchCount)) {
      best = { slug, label, matchCount: matched.length };
    }
  }
  return best ? best.slug : null;
}

/** Sets `region` on every lead in place. */
export function resolveRegions(leads) {
  let resolved = 0;
  for (const lead of leads) {
    lead.region = resolveRegion(lead);
    if (lead.region) resolved++;
  }
  console.log(`  Resolved region for ${resolved}/${leads.length} leads`);
  return leads;
}

export { REGIONS };
