/**
 * OpenCorporates company registry lead source.
 *
 * NOTE: OpenCorporates now requires an API key for all search calls
 * (free tier: 200 req/month, 50/day), and free keys are only issued for
 * projects that re-release their data under a share-alike open license —
 * not a fit for private lead data. This source is opt-in: it does nothing
 * unless you supply your own token in config.openCorporates.apiToken.
 * See https://api.opencorporates.com/documentation/API-Reference
 */

const API = 'https://api.opencorporates.com/v0.4';

/**
 * @param {string} jurisdiction - OpenCorporates jurisdiction code, e.g. "pk" for Pakistan
 * @param {string} query - free-text company name/keyword search
 * @param {object} opts - { apiToken, maxResults }
 */
export async function scrapeOpenCorporates(jurisdiction, query, opts = {}) {
  const { apiToken = '', maxResults = 30 } = opts;
  if (!apiToken) {
    console.warn('  ! OpenCorporates skipped: no config.openCorporates.apiToken set.');
    return [];
  }

  const leads = [];
  const url = `${API}/companies/search?q=${encodeURIComponent(query)}&jurisdiction_code=${encodeURIComponent(jurisdiction)}&api_token=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`OpenCorporates HTTP ${res.status}`);
  const data = await res.json();

  const companies = data?.results?.companies || [];
  for (const { company } of companies.slice(0, maxResults)) {
    leads.push({
      name: company.name || '',
      category: company.company_type || 'registered company',
      website: '',
      email: '',
      phone: '',
      address: company.registered_address_in_full || '',
      linkedin: '',
      facebook: '',
      instagram: '',
      rating: '',
      reviews: '',
      maps_url: company.opencorporates_url || '',
    });
  }

  return leads;
}
