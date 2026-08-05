// Phase 2.2 batch mode: resolve + scrape a list of firm names, one per line.
// Each resolution can take 10-30s (Maps -> GitHub -> directory search
// fallback chain, then a deep site crawl), so this writes progress as it goes
// and checkpoints completed names — a killed/restarted run picks up where it
// left off instead of re-spending time on names already resolved.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolveFirmWebsite } from './resolveFirm.js';
import { scrapeUrl } from './scrapeUrl.js';
import { normalizeName } from '../lib/normalizeUrl.js';

function loadCheckpoint(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Reads one firm name per line from `firmsFile`, resolves + scrapes each,
 * and returns the array of successfully scored leads. Skips blank lines.
 *
 * opts: { config, pythonBin, checkpointFile } — checkpointFile defaults to
 * `${firmsFile}.progress.json` next to the input file.
 */
export async function scrapeFirms(firmsFile, opts = {}) {
  const names = readFileSync(firmsFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const checkpointFile = opts.checkpointFile || `${firmsFile}.progress.json`;
  mkdirSync(dirname(checkpointFile) || '.', { recursive: true });
  const checkpoint = loadCheckpoint(checkpointFile);

  const results = [];
  let skipped = 0;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const key = normalizeName(name);
    if (checkpoint[key]) {
      if (checkpoint[key].lead) results.push(checkpoint[key].lead);
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${names.length}] Resolving "${name}"...`);
    let lead = null;
    try {
      const hit = await resolveFirmWebsite(name);
      if (!hit) {
        console.warn(`  ! Could not resolve a website for "${name}"`);
      } else {
        console.log(`  -> ${hit.website} (via ${hit.strategy}, confidence ${hit.confidence})`);
        lead = await scrapeUrl(hit.website, opts);
        if (lead) {
          lead.name = lead.name || name;
          results.push(lead);
        }
      }
    } catch (err) {
      console.error(`  !! Failed on "${name}": ${err.message.split('\n')[0]}`);
    }

    checkpoint[key] = { name, lead };
    writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  if (skipped > 0) console.log(`Resumed: skipped ${skipped} already-processed name(s).`);
  console.log(`Done: ${results.length}/${names.length} firms resolved and scored.`);
  return results;
}
