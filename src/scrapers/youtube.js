/**
 * YouTube Data API v3 — the one "social platform" source that's actually
 * free and ToS-compliant (unlike Instagram/LinkedIn/Facebook/TikTok, which
 * the architecture plan deliberately did NOT recommend building automated
 * scrapers against — see memory.md).
 *
 * Free tier: 10,000 quota units/day, no paid tier exists — you apply to
 * Google for more, you don't buy it. search.list costs 100 units/call
 * (so ~100 searches/day, shared across everything using this key);
 * channels.list costs only 1 unit/call. Designed around that: one
 * search.list per query to find candidate channels, then one batched
 * channels.list (up to 50 IDs per call) for the actual data — never the
 * other way around.
 *
 * A channel's "About" description commonly includes a business website
 * and/or a contact email directly (creators/small businesses list this for
 * sponsorship inquiries) — that's the actual lead signal here, not the
 * video content itself.
 */
import { cleanEmail } from '../lib/cleanLead.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const URL_RE = /https?:\/\/[^\s)"'<>]+/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;

// Aggregator/platform links that show up constantly in channel descriptions
// but are never the business's own site — same idea as duckduckgo.js's
// social-host filter, applied to a different source. Full registrable
// domains, not name+TLD combined — linktr.ee and bit.ly don't share the
// .com/.be TLD the others do, so treating "TLD" as a swappable suffix
// silently let both through undetected (caught by test/youtube.test.js).
const NON_BUSINESS_HOSTS = new Set([
  'youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'twitter.com',
  'x.com', 'tiktok.com', 'linkedin.com', 'discord.com', 'patreon.com',
  'linktr.ee', 'bit.ly',
]);
function isNonBusinessHost(hostname) {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return NON_BUSINESS_HOSTS.has(h) || [...NON_BUSINESS_HOSTS].some((d) => h.endsWith(`.${d}`));
}

function extractWebsite(description) {
  const urls = description.match(URL_RE) || [];
  for (const raw of urls) {
    try {
      const { hostname } = new URL(raw);
      if (!isNonBusinessHost(hostname)) return raw.replace(/[.,;]+$/, '');
    } catch {
      /* skip malformed URL */
    }
  }
  return '';
}

function extractEmail(description) {
  const matches = description.match(EMAIL_RE) || [];
  for (const raw of matches) {
    const email = cleanEmail(raw);
    if (email) return email;
  }
  return '';
}

async function apiGet(path, params, apiKey) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Searches for channels matching `query`, then pulls their descriptions in
 * one cheap batched call. Returns leads shaped like every other source.
 */
export async function scrapeYouTube(query, opts = {}) {
  const apiKey = opts.apiKey || process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('  !! YouTube: YOUTUBE_API_KEY not set — skipped (this is fine, it just means the source is off)');
    return [];
  }

  const maxResults = Math.min(opts.maxResults || 10, 50);
  const search = await apiGet('search', { part: 'snippet', type: 'channel', q: query, maxResults }, apiKey);
  const channelIds = (search.items || []).map((it) => it.snippet.channelId).filter(Boolean);
  if (channelIds.length === 0) return [];

  const details = await apiGet(
    'channels',
    { part: 'snippet,brandingSettings', id: channelIds.join(',') },
    apiKey
  );

  const leads = [];
  for (const ch of details.items || []) {
    const description = ch.snippet?.description || '';
    const website = extractWebsite(description);
    const email = extractEmail(description);
    if (!website && !email) continue; // no usable lead signal on this channel

    leads.push({
      name: ch.snippet?.title || '',
      category: query,
      website,
      email,
      address: ch.snippet?.country || '',
      maps_url: `https://www.youtube.com/channel/${ch.id}`,
    });
  }
  return leads;
}
