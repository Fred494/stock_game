import { STOCKS } from './stocks.js';
import { OPENING, pickEvents } from './events.js';
import { pickQuiz } from './quiz.js';

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

// Random movement (percent, hard bound) added to EVERY company EVERY round, on top of the event's headline move.
// Calm companies stay within ±5%, the most volatile within ±15%.
export const NOISE = { low: 5, medium: 10, high: 15 };

const clamp = (x, lim) => Math.max(-lim, Math.min(lim, x));
const noiseFor = (rng, vol) => clamp((gauss(rng) * NOISE[vol]) / 2, NOISE[vol]);

/**
 * Reproducible simulation of all 12 rounds from a seed.
 * return = the event's headline move for that company (events.js `moves`) + bounded random noise.
 * Output is SERVER-SECRET until each round is settled.
 */
export function buildMarket(seed) {
  const rng = mulberry32(seed >>> 0);
  const events = pickEvents(rng); // 12 stories for this game, order and selection depend on the seed

  // Opening scenario (public history): how the stocks behaved BEFORE round 1, so the game starts with volatility.
  const base = Object.fromEntries(STOCKS.map((s) => [s.id, s.startPriceCents]));
  const openStart = {};
  const prelude = [];
  for (const s of STOCKS) {
    const sens = OPENING.sens[s.id] || 0;
    const pct = clamp(sens * OPENING.ceiling * (0.7 + 0.3 * rng()) + noiseFor(rng, s.vol), 20);
    openStart[s.id] = Math.max(1, Math.round(base[s.id] * (1 + pct / 100)));
    prelude.push({ id: s.id, from: base[s.id], price: openStart[s.id], pct: openStart[s.id] / base[s.id] - 1, direct: sens !== 0, why: sens !== 0 ? OPENING.roles[s.id] || '' : '' });
  }
  const path = [openStart];
  const rounds = [];

  for (let r = 1; r <= 12; r++) {
    const ev = events[r - 1];
    const prev = path[r - 1];
    const next = {};
    const detail = {};
    for (const s of STOCKS) {
      const newsPct = ev.moves[s.id] || 0;
      const noisePct = noiseFor(rng, s.vol);
      next[s.id] = Math.max(1, Math.round(prev[s.id] * (1 + (newsPct + noisePct) / 100)));
      detail[s.id] = { newsPct, noisePct };
    }
    path.push(next);
    rounds.push({ round: r, reversed: false, intensity: 1, marketPct: 0, detail });
  }
  const quiz = pickQuiz(mulberry32(((seed >>> 0) ^ 0x5bd1e995) >>> 0)); // separate rng: does not change prices
  return { seed, path, rounds, prelude, events, quiz };
}

export const roundReturn = (market, r, id) => market.path[r][id] / market.path[r - 1][id] - 1;
export const FLAT_THRESHOLD = 0.005;
export function direction(ret) {
  if (Math.abs(ret) < FLAT_THRESHOLD) return 'FLAT';
  return ret > 0 ? 'UP' : 'DOWN';
}
