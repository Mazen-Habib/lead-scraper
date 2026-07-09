import { chromium } from 'playwright';

/**
 * Scrapes Google Maps search results for business leads.
 * Returns: [{ name, category, website, phone, address, rating, reviews, maps_url }]
 */
export async function scrapeGoogleMaps(query, maxResults = 40, headless = true) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();
  const results = [];

  try {
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Dismiss the cookie/consent screen if Google shows one
    try {
      const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
      await consent.click({ timeout: 4000 });
    } catch {
      /* no consent screen */
    }

    await page.waitForSelector('div[role="feed"]', { timeout: 30000 });

    // Scroll the results feed until we have enough links or the list ends
    let stagnantRounds = 0;
    let prevCount = 0;
    while (true) {
      const count = await page.locator('a.hfpxzc').count();
      if (count >= maxResults) break;

      const endOfList = await page
        .locator('span:has-text("reached the end of the list")')
        .count();
      if (endOfList > 0) break;

      if (count === prevCount) {
        stagnantRounds++;
        if (stagnantRounds >= 6) break;
      } else {
        stagnantRounds = 0;
      }
      prevCount = count;

      await page.locator('div[role="feed"]').evaluate((el) => el.scrollBy(0, 2500));
      await page.waitForTimeout(1500);
    }

    const links = await page
      .locator('a.hfpxzc')
      .evaluateAll((anchors) =>
        anchors.map((a) => ({ url: a.href, name: a.getAttribute('aria-label') || '' }))
      );

    console.log(`  Found ${links.length} places for "${query}", visiting detail pages...`);

    for (const item of links.slice(0, maxResults)) {
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('h1', { timeout: 15000 });
        await page.waitForTimeout(800);

        const details = await page.evaluate(() => {
          const q = (sel) => document.querySelector(sel);
          const label = (sel, prefix) => {
            const el = q(sel);
            if (!el) return '';
            return (el.getAttribute('aria-label') || '').replace(prefix, '').trim();
          };
          return {
            website: q('a[data-item-id="authority"]')?.href || '',
            phone: label('button[data-item-id^="phone"]', /^Phone:\s*/),
            address: label('button[data-item-id="address"]', /^Address:\s*/),
            category: q('button[jsaction*=".category"]')?.textContent?.trim() || '',
            rating: q('div.F7nice span[aria-hidden="true"]')?.textContent?.trim() || '',
            reviews:
              q('div.F7nice span[aria-label*="review"]')
                ?.textContent?.replace(/[()]/g, '')
                .trim() || '',
          };
        });

        results.push({ name: item.name, ...details, maps_url: item.url });
        process.stdout.write(`  [${results.length}/${Math.min(links.length, maxResults)}] ${item.name}\r\n`);
      } catch (err) {
        console.warn(`  ! Skipped "${item.name}": ${err.message.split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
