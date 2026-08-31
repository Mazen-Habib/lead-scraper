/**
 * Recovers emails that sites deliberately hide from plain "@" regex scraping
 * — the two patterns actually seen in the wild, not a speculative list:
 *
 *  1. Cloudflare's email-obfuscation feature: replaces a real mailto/text
 *     email with `<a class="__cf_email__" data-cfemail="HEX">[email
 *     protected]</a>` (or a bare `data-cfemail="HEX"` span). HEX decodes with
 *     a single-byte XOR — the first byte is the key, applied to every byte
 *     after it — documented reverse-engineering of Cloudflare's own JS.
 *  2. Manually obfuscated text: "name [at] domain [dot] com", "name(at)
 *     domain(dot)com" — common enough on small business sites that a scraper
 *     relying on a literal "@"/"." match misses them entirely.
 *
 * Deliberately does NOT touch bare " at "/" dot " without brackets/parens —
 * that pattern collides constantly with ordinary prose ("look at our new
 * office", "based dot to dot dot"), and a false-positive "email" that isn't
 * one is worse than missing a genuinely obfuscated one.
 */

function decodeCfEmail(hex) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 4) return null;
  const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
  const key = bytes[0];
  const decoded = bytes.slice(1).map((b) => b ^ key);
  const str = decoded.map((b) => String.fromCharCode(b)).join('');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str) ? str : null;
}

// "[at]", "(at)", "{at}" and the dot equivalents, case-insensitive, with
// optional surrounding spaces — the bracket/paren is what makes this a
// high-precision match instead of a bare-word one.
const BRACKETED_OBFUSCATION_RE =
  /([a-zA-Z0-9._%+-]+)\s*[[({]\s*at\s*[\])}]\s*([a-zA-Z0-9.-]+)\s*[[({]\s*dot\s*[\])}]\s*([a-zA-Z]{2,})/gi;

/**
 * Returns any emails recoverable only through de-obfuscation — plain "@"
 * emails are already handled by the caller's own EMAIL_RE/mailto passes, so
 * this only needs to cover what those two miss.
 */
export function deobfuscateEmails(html, $) {
  const found = [];

  if ($) {
    $('[data-cfemail]').each((_, el) => {
      const hex = $(el).attr('data-cfemail');
      const email = hex && decodeCfEmail(hex);
      if (email) found.push(email);
    });
  }

  let match;
  BRACKETED_OBFUSCATION_RE.lastIndex = 0;
  while ((match = BRACKETED_OBFUSCATION_RE.exec(html)) !== null) {
    found.push(`${match[1]}@${match[2]}.${match[3]}`.toLowerCase());
  }

  return found;
}
