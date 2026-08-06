// Node wrapper around src/scrapers/scrapling_fetch.py — a fallback fetch layer
// for directory sources whose anti-bot defenses now block even the
// stealth-hardened cloakEngine.js Playwright session. Mirrors the JSON-over-
// stdio contract already used for ScrapegraphAI (see runPipeline.js's
// spawnSync call to scrapegraph_enricher.py): stdin JSON in, stdout JSON out,
// stderr for logs. Never throws — callers treat an empty/failed fetch as
// "the fallback also found nothing" and move on.
import { spawnSync } from 'child_process';

/**
 * jobs: [{ id, url, waitSelector?, timeout? }]
 * Returns: [{ id, url, html, status, error }] — same length/order as jobs,
 * or [] if pythonBin is missing or the subprocess fails outright.
 */
export function fetchHtmlViaScrapling(jobs, { pythonBin, timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!pythonBin || !jobs?.length) return [];

  const result = spawnSync(pythonBin, ['src/scrapers/scrapling_fetch.py', 'fetch'], {
    input: JSON.stringify({ jobs }),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: timeoutMs,
    env: { ...process.env },
  });

  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0 || !result.stdout?.trim()) {
    if (result.status !== 0) console.error('[scrapling] subprocess exited with status', result.status);
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[scrapling] JSON parse error:', e.message);
    return [];
  }
}
