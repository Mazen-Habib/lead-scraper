/**
 * GitHub Organizations lead source, via GitHub's free REST API.
 * Free, legal (public API, ToS-compliant), structured JSON, no anti-bot.
 * Finds orgs by location, then reads each org's public profile for
 * website/email. Most reliable source in this pipeline since it's a
 * first-party structured API rather than DOM scraping.
 */

const API = 'https://api.github.com';

function headers(token) {
  const h = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'lead-scraper/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;

async function ghFetch(url, token) {
  const res = await fetch(url, { headers: headers(token), signal: AbortSignal.timeout(15000) });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const waitMs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) + 1000 : 60000;
    throw new Error(`GitHub API rate-limited (retry after ~${Math.ceil(waitMs / 1000)}s). Add a token in config.githubOrgs.token to raise limits.`);
  }
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status} @ ${url}`);
  return res.json();
}

/**
 * Searches GitHub for organizations located in `location`, then fetches
 * each org's public profile for website/email/bio.
 * @param {string} location - free-text location, e.g. "Karachi" or "Pakistan"
 * @param {object} opts - { token, maxResults }
 */
export async function scrapeGithubOrgs(location, opts = {}) {
  const { token = '', maxResults = 50 } = opts;
  const leads = [];

  const q = encodeURIComponent(`location:"${location}" type:org`);
  const search = await ghFetch(`${API}/search/users?q=${q}&per_page=${Math.min(maxResults, 100)}`, token);

  for (const item of search.items || []) {
    try {
      const org = await ghFetch(`${API}/orgs/${item.login}`, token);
      leads.push({
        name: org.name || org.login,
        category: 'software / open source',
        website: org.blog && /^https?:\/\//.test(org.blog) ? org.blog : (org.blog ? `https://${org.blog}` : ''),
        email: org.email && EMAIL_RE.test(org.email) ? org.email : '',
        phone: '',
        address: org.location || location,
        linkedin: '',
        facebook: '',
        instagram: '',
        rating: '',
        reviews: org.public_repos != null ? String(org.public_repos) : '',
        maps_url: org.html_url,
      });
    } catch (err) {
      console.warn(`  ! Skipped org "${item.login}": ${err.message.split('\n')[0]}`);
    }
  }

  return leads;
}
