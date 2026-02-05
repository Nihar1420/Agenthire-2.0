// src/utils/keyword-match.js — keyword filtering for feeds.
// Rule: include-any AND exclude-none. Exclude always wins over include.
// Regexes are compiled once and cached (alnum lookaround "word boundaries" that also
// work for tokens like "node.js"/"c++", plus optional trailing-s plural tolerance).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS_PATH = join(process.cwd(), 'config', 'skills.json');

function loadFilters() {
  try {
    const skills = JSON.parse(readFileSync(SKILLS_PATH, 'utf8'));
    const f = skills.keywordFilters || {};
    return { include: f.include || [], exclude: f.exclude || [] };
  } catch {
    return { include: [], exclude: [] };
  }
}

// Cache compiled regexes keyed by the keyword string.
const regexCache = new Map();

function toRegex(keyword) {
  if (regexCache.has(keyword)) return regexCache.get(keyword);
  const escaped = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Alnum lookarounds act as boundaries but allow symbol-containing tokens;
  // trailing "s?" tolerates simple plurals.
  const pattern = `(?<![a-z0-9])${escaped}s?(?![a-z0-9])`;
  const re = new RegExp(pattern, 'i');
  regexCache.set(keyword, re);
  return re;
}

let cachedFilters = null;
function getFilters() {
  if (!cachedFilters) cachedFilters = loadFilters();
  return cachedFilters;
}

/**
 * @param {string} text  free text (title + description)
 * @param {string[]} [tags]  optional tag list to also test
 * @returns {boolean} true if the item passes the include/exclude filter
 */
export function matchKeywords(text, tags = []) {
  const { include, exclude } = getFilters();
  const haystack = `${text || ''} ${(tags || []).join(' ')}`.toLowerCase();

  // Exclude wins: any exclude hit rejects immediately.
  for (const kw of exclude) {
    if (toRegex(kw).test(haystack)) return false;
  }

  // No include list → everything not excluded passes.
  if (include.length === 0) return true;

  for (const kw of include) {
    if (toRegex(kw).test(haystack)) return true;
  }
  return false;
}

/** Test hook: force filters to reload from disk. */
export function _resetFilterCache() {
  cachedFilters = null;
  regexCache.clear();
}

export default matchKeywords;
