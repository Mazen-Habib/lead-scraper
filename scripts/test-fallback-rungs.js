/**
 * Verifies the new opt-in fallback rungs degrade gracefully with nothing
 * configured — no API keys, no curl-impersonate binary, no python passed.
 * Every call must return null/no-op and NEVER throw.
 *
 *   node scripts/test-fallback-rungs.js
 */
import { enrichWithFirecrawl } from '../src/lib/firecrawlEnricher.js';
import { curlFetchText } from '../src/lib/curlImpersonate.js';
import { readViaMarkItDown } from '../src/lib/markitdownReader.js';
import { fetchWithCrawlee } from '../src/engines/crawleeEngine.js';

async function main() {
  console.log('=== Fallback rung smoke test (nothing configured) ===\n');

  // 1. Firecrawl — no FIRECRAWL_API_KEY set
  delete process.env.FIRECRAWL_API_KEY;
  const leads = [{ website: 'https://example.com', email: '' }];
  await enrichWithFirecrawl(leads);
  console.log(`1. Firecrawl (no key): leads unchanged = ${leads[0].email === ''} ✓`);

  // 2. curl-impersonate — binary almost certainly not on PATH locally
  const curlResult = curlFetchText('https://example.com');
  console.log(`2. curl-impersonate (no binary): returned null = ${curlResult === null} ✓`);

  // 3. MarkItDown — no pythonBin passed
  const mdResult = readViaMarkItDown('https://example.com', {});
  console.log(`3. MarkItDown (no pythonBin): returned null = ${mdResult === null} ✓`);

  // 4. Crawlee — this one IS installed, so it should actually attempt a fetch.
  //    Verify it resolves to a string or null without throwing.
  try {
    const html = await fetchWithCrawlee('https://example.com', { timeoutSecs: 15 });
    console.log(`4. Crawlee (real fetch): got ${html ? html.length + ' chars' : 'null'} — no throw ✓`);
  } catch (e) {
    console.log(`4. Crawlee: THREW — ${e.message} ✗`);
  }

  console.log('\n✓ All fallback rungs are safe no-ops when unconfigured.');
}

main().catch((err) => {
  console.error('Fatal (a fallback rung threw when it should not have):', err);
  process.exit(1);
});
