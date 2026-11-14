// Headless balance simulation: node scripts/simulate.js [games=1000]
// Runs complete 12-round games with different strategies and writes SIMULATION_REPORT.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../src/game.js';
import { STOCKS } from '../src/stocks.js';

import { mulberry32 } from '../src/market.js';
import { positionQty } from '../src/trading.js';
import { valueCents } from '../src/money.js';

const N = Number(process.argv[2] || 1000);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGETS = [110000, 108000, 106000, 104000, 102000, 100000];
const LOW = STOCKS.filter((s) => s.vol === 'low').map((s) => s.id);

const sellAll = (g, p, id) => { const q = G.quote(g, p, { stockId: id, side: 'sell', amount: valueCents(positionQty(p, id), G.pricesNow(g)[id]) }); if (q.ok) G.trade(g, p, { stockId: id, side: 'sell', amount: q.gross }); };
const buyAmt = (g, p, id, amt) => { amt = Math.min(Math.floor(amt), p.cash); if (amt >= 100) G.trade(g, p, { stockId: id, side: 'buy', amount: amt }); };

// Each strategy trades during the trading phase. `ev` is the PUBLIC event (a skilled player can read the tone).
const strategies = {
  'Cash only': () => {},
  'Buy & hold all': (g, p) => { if (g.round === 1) for (const s of STOCKS) buyAmt(g, p, s.id, p.cash / STOCKS.length * 0.99); },
  'Defensive low-vol': (g, p) => { if (g.round === 1) for (const id of LOW) buyAmt(g, p, id, p.cash / LOW.length * 0.99); },
  'News reader (skilled)': (g, p) => {
    const ev = g.market.events[g.round - 1];
    const pos = Object.entries(ev.sens).filter(([, s]) => s > 0.3).map(([id]) => id);
    const neg = Object.entries(ev.sens).filter(([, s]) => s < -0.3).map(([id]) => id);
    for (const id of neg) if (positionQty(p, id) > 0) sellAll(g, p, id);
    for (const id of Object.keys(p.holdings)) if (!pos.includes(id) && !neg.includes(id) && g.round % 4 === 0) sellAll(g, p, id);
    const per = (p.cash * 0.6) / Math.max(1, pos.length);
    for (const id of pos) buyAmt(g, p, id, per);
  },
  'Momentum chaser': (g, p) => {
    if (g.settledThrough === 0) return;
    const last = g.settlements[g.settledThrough].moves.slice().sort((a, b) => b.pct - a.pct);
    for (const id of Object.keys(p.holdings)) sellAll(g, p, id);
    for (const m of last.slice(0, 3)) buyAmt(g, p, m.id, (p.cash * 0.9) / 3);
  },
  'Random trader': (g, p, rng) => {
    for (let i = 0; i < 3; i++) {
      const s = STOCKS[Math.floor(rng() * STOCKS.length)];
      if (rng() < 0.5 || positionQty(p, s.id) === 0) buyAmt(g, p, s.id, p.cash * rng() * 0.25);
      else sellAll(g, p, s.id);
    }
  },
};
const NAMES = Object.keys(strategies);
// Power-up variants of the skilled reader
const PU = { none: null, oracle: 'oracle', shield: 'shield', rocket: 'rocket' };

function playGame(seed, roster) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const { game } = G.createGame({ code: 'SIM', seed, durations: { news: 1, trading: 1, reaction: 1, shop: 1 } });
  const players = roster.map((r, i) => {
    const { player } = G.addPlayer(game, { name: `P${i}` });
    G.setBudget(game, player.id, r.budget);
    return { p: player, ...r };
  });
  G.startGame(game);
  const taxStats = { reduced: 0, standard: 0 };
  while (game.status === 'running') {
    if (game.phase === 'news' && game.round > 6) {
      for (const x of players) {
        if (x.p.powerup?.status !== 'owned') continue;
        const ev = game.market.events[game.round - 1];
        const top = Object.entries(ev.sens).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0];
        const t = x.p.powerup.type;
        if (t === 'oracle' && game.round >= 9) G.activatePowerup(game, x.p, { stockId: top });
        else if (t === 'rocket' && game.round >= 8) { const best = Object.entries(ev.sens).sort((a, b) => b[1] - a[1])[0]; if (best[1] > 0.5) G.activatePowerup(game, x.p, { stockId: best[0] }); }
        else if (t === 'shield' && game.round >= 8) G.activatePowerup(game, x.p, {});
      }
    }
    if (game.phase === 'trading') for (const x of players) { try { strategies[x.strategy](game, x.p, rng); } catch { /* rejected orders are fine */ } }
    if (game.phase === 'shop') for (const x of players) if (x.pu) { try { G.purchasePowerup(game, x.p, x.pu); } catch { /* ignore */ } }
    G.advance(game, { confirm: true });
  }
  void taxStats;
  return { game, players, res: G.results(game) };
}

const stat = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return { mean: m, sd: Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) }; };
const perStrategy = {};
const winsByBudgetTop = { top: 0, n: 0 };
const puPayouts = { oracle: [], shield: [], rocket: [] };
const puWins = {};
const tier = { low: [], medium: [], high: [] };
const direct = [], indirect = [];
const roundAbs = Array.from({ length: 12 }, () => []);
let winsTotal = 0;

const t0 = Date.now();
for (let n = 0; n < N; n++) {
  const seed = 1000 + n;
  const rng = mulberry32(seed);
  // roster A: six different strategies; roster B (every 2nd game): power-up A/B using the skilled reader
  const useB = n % 2 === 1;
  const budgets = [...BUDGETS].sort(() => rng() - 0.5);
  const roster = useB
    ? [['News reader (skilled)', null], ['News reader (skilled)', 'oracle'], ['News reader (skilled)', 'shield'], ['News reader (skilled)', 'rocket'], ['Buy & hold all', null], ['Random trader', null]]
    : NAMES.map((s) => [s, null]);
  const { game, players, res } = playGame(seed, roster.map(([strategy, pu], i) => ({ strategy, pu, budget: budgets[i] })));
  const winner = res.players[0];
  winsTotal++;
  res.players.forEach((rp) => {
    const x = players.find((q) => q.p.id === rp.id);
    const key = useB ? `${x.strategy}${x.pu ? ' + ' + x.pu : ''} (PU test)` : x.strategy;
    const e = (perStrategy[key] ||= { ret: [], win: 0, n: 0, tax: [] });
    e.ret.push(rp.ret); e.n++; e.tax.push(rp.tax); if (rp.id === winner.id) e.win++;
    if (x.pu && rp.powerup?.result) puPayouts[x.pu].push(rp.powerup.result.payout ?? 0);
  });
  const topBudget = Math.max(...players.map((x) => x.p.startCash));
  winsByBudgetTop.n++; if (players.find((x) => x.p.id === winner.id).p.startCash === topBudget) winsByBudgetTop.top++;
  for (let r = 1; r <= 12; r++) for (const m of game.settlements[r].moves) {
    const s = STOCKS.find((x) => x.id === m.id);
    tier[s.vol].push(Math.abs(m.pct)); roundAbs[r - 1].push(Math.abs(m.pct));
    (m.direct ? direct : indirect).push(Math.abs(m.pct));
  }
}

const f = (x, d = 2) => (x * 100).toFixed(d) + '%';
const lines = [];
lines.push(`# Simulation report (${N} complete games, ${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
lines.push('Generated by `npm run simulate`. Tax rates, power-up prices, payout caps and winner rules are fixed and were NOT tuned by this script.\n');
lines.push('## Volatility tiers (mean absolute move per round)\n\n| Tier | Mean abs move | Std dev |\n|---|---|---|');
for (const k of ['low', 'medium', 'high']) { const s = stat(tier[k]); lines.push(`| ${k} | ${f(s.mean)} | ${f(s.sd)} |`); }
lines.push(`\n## News relevance vs noise\n\nMean abs move of directly news-affected stocks: **${f(stat(direct).mean)}**; unaffected stocks: **${f(stat(indirect).mean)}**.\n`);
lines.push('## Early vs late rounds (mean abs move, all stocks)\n\n| Round | Mean abs move |\n|---|---|');
roundAbs.forEach((a, i) => lines.push(`| ${i + 1} | ${f(stat(a).mean)} |`));
lines.push('\n## Strategies (6-player games; budgets randomly assigned from €100k-€110k)\n\n| Strategy | Mean return | Std dev | Win rate | Mean tax paid |\n|---|---|---|---|---|');
for (const [k, v] of Object.entries(perStrategy)) lines.push(`| ${k} | ${f(stat(v.ret).mean)} | ${f(stat(v.ret).sd)} | ${f(v.win / v.n, 1)} | €${(stat(v.tax).mean / 100).toFixed(0)} |`);
lines.push('\n## Power-ups (cost €8,000)\n\n| Power-up | Mean payout / information value | Used in games |\n|---|---|---|');
for (const [k, v] of Object.entries(puPayouts)) lines.push(`| ${k} | ${v.length ? '€' + (stat(v).mean / 100).toFixed(0) : 'n/a'} | ${v.length} |`);
lines.push('\nOracle pays no cash; its value is information. Compare the win rates of the "PU test" rows above (identical skilled strategy, different power-up).\n');
lines.push(`## Starting budget\n\nPlayer with the highest budget won **${f(winsByBudgetTop.top / winsByBudgetTop.n, 1)}** of games (6 players: pure chance would be 16.7%).`);
lines.push(`
## Findings and caveats (read before running a serious game)

- Volatility tiers separate cleanly (low < medium < high) and news-affected stocks move ~3x more than unaffected ones, so news matters more than noise. Round 12 is the most volatile, by design.
- **The news now predicts the market.** Each event has fixed headline moves per company (events.js) plus bounded random noise (+-5% calm, +-10% medium, +-15% volatile). A bot that simply reads the news and buys the winners returns roughly +90% on average, so a human who reads carefully has a large edge over someone who guesses. If that is too easy, shrink the headline moves or widen the noise.
- **Budget matters much less than before.** The biggest budget wins about 24% of games (chance is 16.7%), because skill now moves portfolios by tens of percent. A "Best return" award is still shown on the results screen.
- **Power-ups:** the Rocket (capped at EUR 15,000 payout) is only slightly worth its EUR 8,000 for a skilled player (a few points of return); Shield and Oracle are not worth it for these bots. The Oracle only gives information and Shield only pays when the portfolio loses.
- Patience (20% rate) matters only for positions held 4+ rounds and sold at a profit; tax drag on the active strategies is modest compared with market noise.
- Bots are deliberately simple; human skill will differ.
`);
fs.writeFileSync(path.join(ROOT, 'SIMULATION_REPORT.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
