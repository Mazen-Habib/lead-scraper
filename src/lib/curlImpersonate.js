// curl-impersonate wrapper — fallback for plain fetch() calls that get
// blocked at the TLS/HTTP2 fingerprint layer (a site sees "this isn't a real
// browser's handshake" and serves a 403 before any JS challenge even runs).
// Not a replacement for cloakEngine/scraplingEngine, which solve a different
// problem (Cloudflare JS challenges) — this only helps sites that fingerprint
// the TLS handshake itself, which a full browser session doesn't need.
//
// Entirely opt-in and self-disabling: if the curl-impersonate binary isn't on
// PATH (e.g. local Windows dev without WSL), every call returns null after
// one cheap probe, and callers fall back to their normal behavior exactly as
// if this file didn't exist.
import { spawnSync } from 'child_process';

const BIN = process.env.CURL_IMPERSONATE_BIN || 'curl_chrome116';
let binAvailable = null; // null = not probed yet, true/false once known

function probeBinary() {
  if (binAvailable !== null) return binAvailable;
  try {
    const r = spawnSync(BIN, ['--version'], { timeout: 5000 });
    binAvailable = r.status === 0;
  } catch {
    binAvailable = false;
  }
  if (!binAvailable) console.log(`  [curl-impersonate] "${BIN}" not on PATH — fallback disabled`);
  return binAvailable;
}

/**
 * Fetches a URL's HTML through curl-impersonate (Chrome TLS/HTTP2 fingerprint).
 * Returns the response body, or null if the binary is unavailable, the
 * request fails, or times out. Never throws.
 */
export function curlFetchText(url, { timeoutMs = 15000 } = {}) {
  if (!probeBinary()) return null;
  try {
    const r = spawnSync(BIN, ['-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), url], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: timeoutMs + 2000,
    });
    if (r.status !== 0 || !r.stdout) return null;
    return r.stdout;
  } catch {
    return null;
  }
}
