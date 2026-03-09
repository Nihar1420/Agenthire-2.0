// src/crawler/text.js — small HTML/text helpers shared by the crawler adapters.

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#x2F;': '/',
  '&#x27;': "'",
};

/** Decode the common named/numeric HTML entities. */
export function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z0-9#]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Strip tags and collapse whitespace, decoding entities. */
export function stripHtml(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Reject tracking pixels, asset filenames, and boilerplate no-reply addresses.
const JUNK_EMAIL =
  /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|sentry|wixpress|example\.(com|org)|\.(png|jpe?g|gif|svg|webp|css|js)$|@2x)/i;

/** Extract all real, de-duplicated emails from a blob of text/HTML. */
export function extractEmails(text) {
  const found = decodeEntities(String(text || '')).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const seen = new Set();
  const out = [];
  for (const raw of found) {
    const e = raw.toLowerCase();
    if (JUNK_EMAIL.test(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** The first real email in a blob, or null. */
export function extractEmail(text) {
  return extractEmails(text)[0] || null;
}

export default { decodeEntities, stripHtml, extractEmails, extractEmail };
