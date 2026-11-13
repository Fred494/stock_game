import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, NEWS_PROVIDER } from './config.js';
import { EVENTS } from './events.js';

// Provider abstraction: each provider resolves a real-world article for an event query, or null.
// Real news is UNTRUSTED data: we only keep sanitized, length-limited text fields and http(s) URLs,
// and the client renders them with textContent (never as HTML or instructions).
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const CACHE = path.join(DATA_DIR, 'news-cache.json');
const TTL = 24 * 3600 * 1000;

function readCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } }
function writeCache(c) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(c)); } catch { /* ignore */ } }

function parseSeen(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : null;
}

export const providers = {
  demo: async () => null,
  async gdelt(query) {
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
      query: `${query} sourcelang:english`, mode: 'artlist', format: 'json', maxrecords: '5', sort: 'datedesc', timespan: '1month',
    });
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) return null;
      const data = JSON.parse(await res.text());
      const a = (data.articles || []).find((x) => /^https?:\/\//.test(x.url || '') && x.title);
      if (!a) return null;
      return {
        headline: clean(a.title, 200), publisher: clean(a.domain, 80), publishedAt: parseSeen(a.seendate),
        url: a.url, provider: 'GDELT',
      };
    } catch { return null; } finally { clearTimeout(to); }
  },
};

/** Fill game.news[].real in the background (never blocks gameplay; retries are cached). */
export async function prefetchNews(game, onUpdate = () => {}) {
  const provider = providers[NEWS_PROVIDER] || providers.demo;
  if (provider === providers.demo) return;
  const cache = readCache();
  for (const ev of EVENTS) {
    const hit = cache[ev.key];
    if (hit && Date.now() - hit.at < TTL) { game.news[ev.round - 1].real = hit.article; continue; }
    const article = await provider(ev.query);
    if (article) { cache[ev.key] = { at: Date.now(), article }; writeCache(cache); }
    game.news[ev.round - 1].real = article;
    onUpdate();
    await new Promise((r) => setTimeout(r, 5300)); // GDELT asks for ~1 request / 5 s
  }
}
