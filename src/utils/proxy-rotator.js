// src/utils/proxy-rotator.js — sticky per-domain proxy rotation.
// Loads config/proxies.json (gitignored). A given domain sticks to one proxy for up
// to 50 uses, then rotates to the next. Returns Playwright-format proxy objects, or
// null when no proxies are configured (→ direct connection).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROXIES_PATH = join(process.cwd(), 'config', 'proxies.json');
const MAX_USES_PER_PROXY = 50;

export class ProxyRotator {
  constructor() {
    this.proxies = this._load();
    this.index = 0;
    // domain -> { proxyIndex, uses }
    this.sticky = new Map();
  }

  _load() {
    try {
      if (!existsSync(PROXIES_PATH)) return [];
      const raw = JSON.parse(readFileSync(PROXIES_PATH, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw.proxies || [];
      return list.filter((p) => p && p.host && p.port);
    } catch {
      return [];
    }
  }

  /** Convert an internal proxy entry to Playwright's proxy option shape. */
  _toPlaywright(p) {
    const scheme = p.protocol || 'http';
    const proxy = { server: `${scheme}://${p.host}:${p.port}` };
    if (p.username) proxy.username = p.username;
    if (p.password) proxy.password = p.password;
    return proxy;
  }

  /**
   * Get a proxy for a domain. Same domain returns the same proxy until it has been
   * used MAX_USES_PER_PROXY times, then advances. Returns null when unconfigured.
   */
  getProxy(domain = '_default') {
    if (this.proxies.length === 0) return null;

    let entry = this.sticky.get(domain);
    if (!entry || entry.uses >= MAX_USES_PER_PROXY) {
      this.index = (this.index + (entry ? 1 : 0)) % this.proxies.length;
      entry = { proxyIndex: this.index, uses: 0 };
      this.sticky.set(domain, entry);
    }

    entry.uses += 1;
    return this._toPlaywright(this.proxies[entry.proxyIndex]);
  }

  get hasProxies() {
    return this.proxies.length > 0;
  }
}

// Shared singleton.
const rotator = new ProxyRotator();
export default rotator;
