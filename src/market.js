import { STOCKS } from './stocks.js';
import { EVENTS } from './events.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0;
  while (!u) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Max |move| (percent) for directly affected HIGH-volatility stocks, per round.
export const CEILING = [6, 8, 8, 9, 10, 10, 10, 10, 12, 12, 12, 15];
// ord = ordinary-round cap, news = share of the ceiling, others = noise scales (percent)
export const TIER = {
  low: { ord: 1.5, news: 0.4, noise: 0.6, sector: 0.6, beta: 0.5 },
  medium: { ord: 2.5, news: 0.7, noise: 1.0, sector: 1.0, beta: 1.0 },
  high: { ord: 4, news: 1.0, noise: 1.6, sector: 1.4, beta: 1.4 },
};
const REVERSAL_PROB = 0.15;

const clamp = (x, lim) => Math.max(-lim, Math.min(lim, x));

/**
 * Reproducible simulation of all 12 rounds from a seed.
 * return = market + sector + company-news + bounded noise.
 * Output is SERVER-SECRET until each round is settled.
 */
export function buildMarket(seed) {
  const rng = mulberry32(seed >>> 0);
  const path = [Object.fromEntries(STOCKS.map((s) => [s.id, s.startPriceCents]))];
  const rounds = [];
  const sectors = [...new Set(STOCKS.map((s) => s.sector))];

  for (let r = 1; r <= 12; r++) {
    const ev = EVENTS[r - 1];
    const marketPct = ev.bias + gauss(rng) * 0.5;
    const sectorPct = Object.fromEntries(sectors.map((s) => [s, gauss(rng) * 0.7]));
    const reversed = rng() < REVERSAL_PROB;
    const intensity = 0.55 + 0.45 * rng();
    const prev = path[r - 1];
    const next = {};
    const detail = {};
    for (const s of STOCKS) {
      const t = TIER[s.vol];
      const sens = ev.sens[s.id] || 0;
      const base = marketPct * t.beta + sectorPct[s.sector] * t.sector + gauss(rng) * t.noise;
      const newsPct = sens * CEILING[r - 1] * t.news * intensity * (reversed ? -1 : 1);
      const cap = sens !== 0 ? Math.max(t.ord, CEILING[r - 1] * t.news) : t.ord;
      const pct = clamp(base + newsPct, cap);
      next[s.id] = Math.max(1, Math.round(prev[s.id] * (1 + pct / 100)));
      detail[s.id] = { marketPct: marketPct * t.beta, sectorPct: sectorPct[s.sector] * t.sector, newsPct, noisePct: base - marketPct * t.beta - sectorPct[s.sector] * t.sector };
    }
    path.push(next);
    rounds.push({ round: r, reversed, intensity, marketPct, detail });
  }
  return { seed, path, rounds };
}

export const roundReturn = (market, r, id) => market.path[r][id] / market.path[r - 1][id] - 1;
export const FLAT_THRESHOLD = 0.005;
export function direction(ret) {
  if (Math.abs(ret) < FLAT_THRESHOLD) return 'FLAT';
  return ret > 0 ? 'UP' : 'DOWN';
}
