/**
 * Shared Retry-After parsing for every LLM provider adapter.
 *
 * Free tiers rate-limit aggressively and tell you how long to wait; honouring
 * that beats guessing a backoff. Lives in one module rather than being copied
 * into each adapter — there is nothing provider-specific about reading a
 * standard HTTP header.
 *
 * Returns milliseconds, or null when the header is absent or unparseable so the
 * caller can fall back to its own backoff.
 */
export function parseRetryAfter(value) {
  if (!value) return null;
  // Both forms the spec allows: delta-seconds, or an HTTP date.
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}
