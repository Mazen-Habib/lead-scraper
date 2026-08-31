import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeOlx } from '../src/scrapers/olx.js';

const LIST_HTML = `
  <html><body>
    <a href="/item/tax-service-iid-1111">Tax Service</a>
    <a href="/item/tax-service-iid-1111">Tax Service</a>
    <a href="/item/legal-service-iid-2222">Legal Service</a>
  </body></html>
`;

function itemHtml({ title, city, description }) {
  return `
    <html><body>
      <h1>${title}</h1>
      <p>${city ? `Some Area, ${city}` : ''}</p>
      <div>Description</div>
      <div>${description}</div>
      <script>window.dataLayer=[];</script>
      <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABC123"></iframe></noscript>
    </body></html>
  `;
}

test('scrapeOlx recovers a spaced-out obfuscated domain from the description, not the GTM tracking pixel', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/consultancy-services_c707005')) return { ok: true, text: async () => LIST_HTML };
    return {
      ok: true,
      text: async () =>
        itemHtml({
          title: 'Tax Consultant & Tax Filing Service',
          city: 'Islamabad',
          description: 'Need help with tax matters? tax. msft. pk Contact us today.',
        }),
    };
  };
  try {
    const leads = await scrapeOlx('consultancy-services_c707005', { maxListings: 5 });
    assert.equal(leads.length, 2);
    assert.equal(leads[0].website, 'https://tax.msft.pk');
    assert.equal(leads[0].address, 'Islamabad');
    assert.equal(leads[0].category, 'consultancy services');
  } finally {
    global.fetch = originalFetch;
  }
});

test('scrapeOlx leaves website/email empty when the description has neither, rather than guessing', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/consultancy-services_c707005')) return { ok: true, text: async () => LIST_HTML };
    return {
      ok: true,
      text: async () => itemHtml({ title: 'Legal Service', city: 'Karachi', description: 'Contact us for a quote.' }),
    };
  };
  try {
    const leads = await scrapeOlx('consultancy-services_c707005', { maxListings: 5 });
    assert.equal(leads[0].website, '');
    assert.equal(leads[0].email, '');
    assert.equal(leads[0].address, 'Karachi');
  } finally {
    global.fetch = originalFetch;
  }
});

test('scrapeOlx returns [] when the category page itself fails to load', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  try {
    const leads = await scrapeOlx('nonexistent-category_c0', { maxListings: 5 });
    assert.deepEqual(leads, []);
  } finally {
    global.fetch = originalFetch;
  }
});
