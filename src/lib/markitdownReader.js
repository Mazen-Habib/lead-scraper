// Node wrapper around src/quality/markitdown_fetch.py — second-rung content
// extractor, used only when Jina Reader (src/lib/jinaReader.js) returns null.
// Same JSON-over-stdio contract as scraplingEngine.js. Never throws — a
// missing pythonBin or a failed subprocess is treated as "no extra signal",
// exactly like a failed Jina call.
import { spawnSync } from 'child_process';

/**
 * Fetches a URL's content as Markdown via MarkItDown, running locally
 * (no external API, no rate limit) — the fallback for when Jina Reader
 * comes back empty. Returns null on any failure or if pythonBin is unset.
 */
export function readViaMarkItDown(url, { pythonBin, timeoutMs = 25000 } = {}) {
  if (!pythonBin || !url) return null;

  const result = spawnSync(pythonBin, ['src/quality/markitdown_fetch.py', 'fetch'], {
    input: JSON.stringify({ url, timeout: Math.round(timeoutMs / 1000) }),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs + 5000,
    env: { ...process.env },
  });

  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 || !result.stdout?.trim()) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    return parsed?.markdown || null;
  } catch {
    return null;
  }
}
