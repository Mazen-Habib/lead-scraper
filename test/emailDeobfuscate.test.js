import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { deobfuscateEmails } from '../src/lib/emailDeobfuscate.js';

// Real Cloudflare-shaped hex for sales@example.com, key 0x2a — generated the
// same way Cloudflare's own obfuscator does (first byte = XOR key), not
// hand-typed, so this is a genuine round-trip test.
const CF_HEX = '2a594b464f596a4f524b475a464f04494547';

test('decodes a Cloudflare data-cfemail attribute', () => {
  const html = `<a class="__cf_email__" data-cfemail="${CF_HEX}">[email&#160;protected]</a>`;
  const $ = cheerio.load(html);
  assert.deepEqual(deobfuscateEmails(html, $), ['sales@example.com']);
});

test('recovers a bracket-wrapped obfuscated email', () => {
  const html = 'Reach us at jane [at] acme [dot] com for more info.';
  assert.deepEqual(deobfuscateEmails(html, null), ['jane@acme.com']);
});

test('recovers a paren-wrapped obfuscated email', () => {
  const html = 'Email: john(at)company(dot)co.uk';
  const found = deobfuscateEmails(html, null);
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith('john@company.'));
});

test('does not match bare "at"/"dot" in ordinary prose', () => {
  const html = 'Look at our new office, based dot to dot across town.';
  assert.deepEqual(deobfuscateEmails(html, null), []);
});

test('ignores an invalid data-cfemail (too short / non-hex)', () => {
  const html = '<a data-cfemail="zz">[email protected]</a>';
  const $ = cheerio.load(html);
  assert.deepEqual(deobfuscateEmails(html, $), []);
});

test('returns [] for html with nothing obfuscated at all', () => {
  const html = '<p>Contact us through the form below.</p>';
  const $ = cheerio.load(html);
  assert.deepEqual(deobfuscateEmails(html, $), []);
});
