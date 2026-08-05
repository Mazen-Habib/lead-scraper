// Jina Reader (r.jina.ai) — turns any URL into clean Markdown with a single
// keyless HTTP call. Borrowed from Agent Reach's `web` channel, which uses it
// as its always-available zero-config backend.
//
// Why we want it: our rules classifier only sees thin metadata (category,
// company name, domain words, directory slug). For a lead whose directory
// listing just says "Company", that's nothing to match a taxonomy against.
// The company's own homepage says exactly what they do — but raw HTML is
// mostly nav/script/style noise. Jina strips all of that server-side, so we
// get the readable prose without shipping a boilerplate-removal library.
//
// It's a free public endpoint, so callers must keep concurrency modest and
// treat every failure as "no extra signal" rather than an error.

// Identify ourselves honestly rather than impersonating Chrome. That is also
// the only thing that works: a full "…Chrome/126.0.0.0 Safari/537.36" UA makes
// Cloudflare in front of r.jina.ai serve a JS challenge (403 "Just a moment…"),
// because it expects anything claiming to be a browser to solve it. A plain
// descriptive agent string is served normally.
const UA = 'lead-scraper/1.0 (+https://github.com/Mazen-Habib/lead-scraper)';

// Enough prose to classify from; homepages that dump a whole blog archive
// past this point add noise, not signal.
const MAX_CHARS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Creates a shared pacer that spaces calls at least `minIntervalMs` apart,
 * regardless of how many workers are running. Needed because the keyless
 * Jina tier allows roughly 20 requests/minute per IP — firing a few hundred
 * lead sites at it concurrently just earns a wall of 429s and silently loses
 * the tags we were trying to gain.
 */
export function createPacer(minIntervalMs) {
  let nextAllowedAt = 0;
  return async function pace() {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const runAt = Math.max(now, nextAllowedAt);
    nextAllowedAt = runAt + minIntervalMs;
    if (runAt > now) await sleep(runAt - now);
  };
}

/**
 * Fetches a URL as clean Markdown via Jina Reader.
 * Returns the text, or null if anything goes wrong (network, timeout, non-2xx,
 * empty body) — callers treat null as "no extra signal available".
 *
 * A 429 gets one retry after `rateLimitBackoffMs`, since being throttled is
 * transient and the page is still worth having.
 */
export async function readAsText(url, { timeoutMs = 20000, rateLimitBackoffMs = 5000 } = {}) {
  if (!url) return null;

  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  try {
    new URL(target);
  } catch {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://r.jina.ai/${target}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': UA, Accept: 'text/plain' },
      });
      if (res.status === 429 && attempt === 0) {
        await sleep(rateLimitBackoffMs);
        continue;
      }
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || text.trim().length < 50) return null; // effectively empty page
      return text.slice(0, MAX_CHARS);
    } catch {
      return null;
    }
  }
  return null;
}
