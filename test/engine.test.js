import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game.js';
import { buildMarket, NOISE } from '../src/market.js';

import { STOCKS } from '../src/stocks.js';
import { quoteSell, quoteBuy, applyBuy, applySell, taxRate } from '../src/trading.js';
import { toCents, MICRO } from '../src/money.js';

const mkPlayer = (cash = 1_000_000) => ({ cash, holdings: {}, taxPaid: 0, trades: [] });

function lobby(n = 2, budget = 100000) {
  const { game, hostToken } = G.createGame({ code: 'TEST01', seed: 42, durations: { news: 60, trading: 60, reaction: 120, shop: 60 } });
  const ps = [];
  for (let i = 0; i < n; i++) {
    const { player, token } = G.addPlayer(game, { name: 'P' + i });
    G.setBudget(game, player.id, budget);
    ps.push({ p: player, token });
  }
  return { game, hostToken, ps };
}
const toTrading = (game) => { G.startGame(game); G.advance(game); };

test('names unique, validated, no impersonation', () => {
  const { game } = lobby(1);
  assert.throws(() => G.addPlayer(game, { name: 'p0' }), /já está a ser usado/);
  assert.throws(() => G.addPlayer(game, { name: '   ' }), /Escreve um nome/);
  const a = G.addPlayer(game, { name: 'Zed' });
  const again = G.addPlayer(game, { name: 'whatever', token: a.token });
  assert.equal(again.reconnected, true);
  assert.equal(again.player.id, a.player.id);
  assert.equal(G.findPlayerByToken(game, 'forged'), undefined);
});

test('room holds max 6 players', () => {
  const { game } = lobby(6);
  assert.throws(() => G.addPlayer(game, { name: 'Seventh' }), /cheia/);
});

test('host-assigned budgets validated and locked', () => {
  const { game, ps } = lobby(2);
  assert.throws(() => G.setBudget(game, ps[0].p.id, -5), /número positivo/);
  assert.throws(() => G.setBudget(game, ps[0].p.id, NaN), /número positivo/);
  assert.throws(() => G.setBudget(game, ps[0].p.id, Infinity), /número positivo/);
  const { game: g2 } = G.createGame({ code: 'X', seed: 1 });
  G.addPlayer(g2, { name: 'A' });
  assert.throws(() => G.startGame(g2), /orçamento inicial/);
  G.setBudget(game, ps[0].p.id, 125000);
  G.setBudget(game, ps[1].p.id, 90000);
  G.startGame(game);
  assert.equal(ps[0].p.cash, 12_500_000);
  assert.equal(ps[1].p.cash, 9_000_000);
  assert.throws(() => G.setBudget(game, ps[0].p.id, 1), /bloqueados/);
});

test('buy: fractional shares, no overspend', () => {
  const p = mkPlayer(10_000);
  const q = quoteBuy(p, 3333, 10_000);
  assert.ok(q.ok);
  assert.equal(q.qty, Math.floor((10_000 * MICRO) / 3333));
  applyBuy(p, 'X', q, 1);
  assert.equal(p.cash, 0);
  assert.equal(quoteBuy(p, 3333, 100).ok, false);
  assert.equal(quoteBuy(mkPlayer(500), 100, 501).ok, false);
});

test('tax rate boundary: 4 completed rounds', () => {
  assert.equal(taxRate(4, 1), 0.28);
  assert.equal(taxRate(5, 1), 0.20);
  assert.equal(taxRate(6, 2), 0.20);
  assert.equal(taxRate(8, 4), 0.20);
  assert.equal(taxRate(12, 8), 0.20);
  assert.equal(taxRate(12, 9), 0.28);
});

test('sell: FIFO, mixed tax rates, partial lots', () => {
  const p = mkPlayer(0);
  p.holdings.X = { lots: [
    { qty: 1 * MICRO, cost: 10_000, round: 1, price: 10_000 }, // 1 share @100
    { qty: 1 * MICRO, cost: 20_000, round: 4, price: 20_000 }, // 1 share @200
  ] };
  // sell 1.5 shares at 300 each in round 5 => 450 gross
  const q = quoteSell(p, 'X', 30_000, 45_000, 5);
  assert.ok(q.ok);
  assert.equal(q.lots.length, 2);
  assert.equal(q.lots[0].rate, 0.20); // lot from round 1: 5-1=4
  assert.equal(q.lots[1].rate, 0.28); // lot from round 4: 5-4=1
  assert.equal(q.lots[0].gain, 20_000);
  assert.equal(q.lots[0].tax, 4_000);
  assert.equal(q.lots[1].qty, 500_000);
  assert.equal(q.lots[1].cost, 10_000);
  assert.equal(q.lots[1].gain, 5_000);
  assert.equal(q.lots[1].tax, 1_400);
  assert.equal(q.tax, 5_400);
  assert.equal(q.net, q.gross - 5_400);
  applySell(p, 'X', q);
  assert.equal(p.holdings.X.lots.length, 1);
  assert.equal(p.holdings.X.lots[0].qty, 500_000);
  assert.equal(p.holdings.X.lots[0].cost, 10_000);
  assert.equal(p.cash, q.net);
  assert.equal(p.taxPaid, 5_400);
});

test('no tax on losses, no refund; cannot oversell', () => {
  const p = mkPlayer(0);
  p.holdings.X = { lots: [{ qty: MICRO, cost: 20_000, round: 1, price: 20_000 }] };
  const q = quoteSell(p, 'X', 10_000, 10_000, 2);
  assert.equal(q.tax, 0);
  assert.equal(q.gain, -10_000);
  assert.equal(q.net, 10_000);
  assert.equal(quoteSell(p, 'X', 10_000, 20_000, 2).ok, false);
  assert.equal(quoteSell(p, 'Y', 10_000, 100, 2).ok, false);
});

test('selling the entire position removes it and holdings never go negative', () => {
  const p = mkPlayer(0);
  p.holdings.X = { lots: [{ qty: 333_333, cost: 1_000, round: 1, price: 3_000 }] };
  const q = quoteSell(p, 'X', 3_000, 1_000, 1);
  assert.ok(q.ok);
  applySell(p, 'X', q);
  assert.equal(p.holdings.X, undefined);
});

test('market is reproducible, bounded and varied', () => {
  const a = buildMarket(7), b = buildMarket(7), c = buildMarket(8);
  assert.deepEqual(a.path, b.path);
  assert.notDeepEqual(a.path, c.path);
  let ups = 0, downs = 0;
  for (let r = 1; r <= 12; r++) {
    for (const s of STOCKS) {
      const ret = a.path[r][s.id] / a.path[r - 1][s.id] - 1;
      const cap = (Math.abs(a.events[r - 1].moves[s.id] || 0) + NOISE[s.vol]) / 100;
      assert.ok(Math.abs(ret) <= cap + 0.0015, `${s.id} r${r} ${ret}`);
      if (ret > 0.001) ups++; else if (ret < -0.001) downs++;
    }
  }
  assert.ok(ups > 40 && downs > 40, 'both directions occur');
});

test('trading only in trading phase; frozen prices; idempotent orders', () => {
  const { game, ps } = lobby(1);
  const [{ p }] = ps;
  G.startGame(game);
  assert.throws(() => G.trade(game, p, { stockId: 'KO', side: 'buy', amount: 10_000 }), /fechada/);
  G.advance(game);
  const before = G.pricesNow(game)['KO'];
  const r1 = G.trade(game, p, { stockId: 'KO', side: 'buy', amount: 100_000, requestId: 'a' });
  assert.ok(r1.trade);
  const r2 = G.trade(game, p, { stockId: 'KO', side: 'buy', amount: 100_000, requestId: 'a' });
  assert.equal(r2.duplicate, true);
  assert.equal(p.cash, 10_000_000 - 100_000);
  assert.equal(G.pricesNow(game)['KO'], before);
  assert.throws(() => G.trade(game, p, { stockId: 'KO', side: 'buy', amount: 99_999_999 }), /Dinheiro insuficiente/);
  G.advance(game, { confirm: true });
  assert.throws(() => G.trade(game, p, { stockId: 'KO', side: 'buy', amount: 10_000 }), /fechada/);
  assert.equal(game.phase, 'reaction');
  assert.notEqual(G.pricesNow(game)['KO'], undefined);
});

test('paused game freezes the clock but still allows trades', () => {
  const { game, ps } = lobby(1);
  toTrading(game);
  G.setPaused(game, true);
  assert.ok(G.trade(game, ps[0].p, { stockId: 'KO', side: 'buy', amount: 10_000 }).trade);
  const r = game.remainingMs;
  G.tick(game, 5000);
  assert.equal(game.remainingMs, r);
  G.setPaused(game, false);
  G.tick(game, 5000);
  assert.equal(game.remainingMs, r - 5000);
});

test('timer speed scales countdown, not returns', () => {
  const { game } = lobby(1);
  toTrading(game);
  G.setSpeed(game, 4);
  const r = game.remainingMs;
  G.tick(game, 1000);
  assert.equal(game.remainingMs, r - 4000);
  assert.throws(() => G.setSpeed(game, 3), /velocidade/);
});

test('unanimous ready -> 5s countdown -> reaction; cancel on unready; skip warns', () => {
  const { game, ps } = lobby(2);
  toTrading(game);
  ps.forEach(({ p }) => { p.lastSeen = Date.now(); });
  assert.throws(() => G.advance(game), /não terminaram/);
  G.setReady(game, ps[0].p, true);
  G.tick(game, 1000);
  assert.equal(game.countdownMs, null);
  G.setReady(game, ps[1].p, true);
  G.tick(game, 1000);
  assert.equal(game.countdownMs, 4000);
  G.setReady(game, ps[1].p, false);
  assert.equal(game.countdownMs, null);
  G.setReady(game, ps[1].p, true);
  G.tick(game, 2000); G.tick(game, 2000); G.tick(game, 2000);
  assert.equal(game.phase, 'reaction');
  assert.equal(game.settledThrough, 1);
});

test('ready locks trading until edit; disconnected players do not block', () => {
  const { game, ps } = lobby(2);
  toTrading(game);
  ps[0].p.lastSeen = Date.now();
  ps[1].p.lastSeen = 0; // disconnected
  G.setReady(game, ps[0].p, true);
  assert.throws(() => G.trade(game, ps[0].p, { stockId: 'KO', side: 'buy', amount: 10_000 }), /Pronto/);
  G.tick(game, 5100);
  assert.equal(game.phase, 'reaction');
});

test('round settlement is idempotent', () => {
  const { game } = lobby(1);
  toTrading(game);
  G.settleRound(game);
  const prices = JSON.stringify(G.pricesNow(game));
  G.settleRound(game); G.settleRound(game);
  assert.equal(JSON.stringify(G.pricesNow(game)), prices);
  assert.equal(game.settledThrough, 1);
});

function playTo(game, round, phase) {
  while (!(game.round === round && game.phase === phase)) G.advance(game, { confirm: true });
}

test('power-up shop: one per player, €8,000, no overdraft, only after round 6', () => {
  const { game, ps } = lobby(2, 1000); // €1,000 budgets
  G.startGame(game);
  assert.throws(() => G.purchasePowerup(game, ps[0].p, 'oracle'), /fechada/);
  playTo(game, 6, 'shop');
  assert.throws(() => G.purchasePowerup(game, ps[0].p, 'oracle'), /Dinheiro insuficiente/);
  ps[0].p.cash = 2_000_000;
  G.purchasePowerup(game, ps[0].p, 'oracle');
  assert.equal(ps[0].p.cash, 1_200_000);
  assert.throws(() => G.purchasePowerup(game, ps[0].p, 'shield'), /Só podes comprar um/);
});

test('oracle: private direction, consumed, not before round 7', () => {
  const { game, ps } = lobby(2, 100000);
  const [{ p }, { p: other }] = ps;
  G.startGame(game);
  playTo(game, 6, 'shop');
  G.purchasePowerup(game, p, 'oracle');
  assert.throws(() => G.activatePowerup(game, p, { stockId: 'AZN' }), /rondas 7 a 12/);
  playTo(game, 7, 'news');
  G.activatePowerup(game, p, { stockId: 'AZN' });
  assert.equal(p.powerup.status, 'used');
  assert.ok(['UP', 'DOWN', 'FLAT'].includes(p.powerup.result.direction));
  const mine = JSON.stringify(G.playerView(game, p));
  const theirs = JSON.stringify(G.playerView(game, other));
  assert.ok(mine.includes('direction'));
  assert.ok(!theirs.includes('direction'));
  assert.throws(() => G.activatePowerup(game, p, { stockId: 'AZN' }), /Não tens nenhum power-up/);
});

test('crash shield pays loss up to €10,000, never on gains, consumed once', () => {
  const { game, ps } = lobby(1, 1_000_000);
  const [{ p }] = ps;
  G.startGame(game);
  playTo(game, 6, 'shop');
  G.purchasePowerup(game, p, 'shield');
  playTo(game, 7, 'news');
  G.activatePowerup(game, p, {});
  G.advance(game);
  // force a deterministic loss: hold a position and fake the market drop
  p.holdings.X = { lots: [{ qty: 1000 * MICRO, cost: 1, round: 7, price: 1 }] };
  game.market.path[6].X = 10_000; game.market.path[7].X = 9_000; // -€10,000... per share -1000c*1000=-1,000,000c
  G.advance(game, { confirm: true });
  assert.equal(p.powerup.status, 'used');
  assert.equal(p.powerup.result.marketChange, -1_000_000);
  assert.equal(p.powerup.result.payout, 1_000_000);
  game.settledThrough = 7; // no double payout
  const cash = p.cash; G.settleRound(game);
  assert.equal(p.cash, cash);
});

test('shield caps at €10,000 and pays nothing on gains', () => {
  for (const [newP, expected] of [[5_000, 1_000_000], [15_000, 0]]) {
    const { game, ps } = lobby(1, 1_000_000);
    const [{ p }] = ps;
    G.startGame(game);
    playTo(game, 6, 'shop');
    G.purchasePowerup(game, p, 'shield');
    playTo(game, 7, 'news');
    G.activatePowerup(game, p, {});
    G.advance(game);
    p.holdings.X = { lots: [{ qty: 1000 * MICRO, cost: 1, round: 7, price: 1 }] };
    game.market.path[6].X = 10_000; game.market.path[7].X = newP;
    G.advance(game, { confirm: true });
    assert.equal(p.powerup.result.payout, expected);
  }
});

test('profit rocket: 2x gain on eligible value, caps, zero on loss', () => {
  const run = (posPrice, newPrice, qty) => {
    const { game, ps } = lobby(1, 1_000_000);
    const [{ p }] = ps;
    G.startGame(game);
    playTo(game, 6, 'shop');
    G.purchasePowerup(game, p, 'rocket');
    playTo(game, 7, 'news');
    G.activatePowerup(game, p, { stockId: 'AZN' });
    G.advance(game);
    p.holdings.AZN = { lots: [{ qty, cost: 1, round: 7, price: 1 }] };
    game.market.path[6].AZN = posPrice; game.market.path[7].AZN = newPrice;
    G.advance(game, { confirm: true });
    return p.powerup.result;
  };
  // 100 shares @ €100 = €10,000 position; +10% => 2*10,000*0.1 = €2,000
  let r = run(10_000, 11_000, 100 * MICRO);
  assert.equal(r.eligible, 1_000_000);
  assert.equal(r.payout, 200_000);
  // huge position: eligible capped at €50,000; +50% => 2*50,000*.5 = 50k -> payout cap €15,000
  r = run(10_000, 15_000, 10_000 * MICRO);
  assert.equal(r.eligible, 5_000_000);
  assert.equal(r.payout, 1_500_000);
  assert.equal(run(10_000, 9_000, 100 * MICRO).payout, 0);
});

test('full 12-round game, final ranking and tie-breakers, views hide the future', () => {
  const { game, ps } = lobby(3, 100000);
  G.startGame(game);
  const v0 = JSON.stringify(G.playerView(game, ps[0].p));
  assert.ok(!v0.includes('"path"') && !v0.includes('seed'));
  while (game.status === 'running') {
    if (game.phase === 'trading') {
      G.trade(game, ps[0].p, { stockId: 'NVDA', side: 'buy', amount: 500_000 });
      if (game.round % 3 === 0) { try { G.trade(game, ps[0].p, { stockId: 'NVDA', side: 'sell', amount: 300_000 }); } catch { /* ok */ } }
    }
    G.advance(game, { confirm: true });
  }
  assert.equal(game.status, 'finished');
  assert.equal(game.settledThrough, 12);
  const res = G.results(game);
  assert.equal(res.players.length, 3);
  assert.equal(res.champion.rank, 1);
  assert.deepEqual(res.players.map((x) => x.wealth), [...res.players.map((x) => x.wealth)].sort((a, b) => b - a));
  assert.equal(game.history[ps[0].p.id].length, 13);
  const idle = res.players.find((x) => x.id === ps[1].p.id);
  assert.equal(idle.wealth, 10_000_000); // untouched cash stays untouched
  assert.equal(toCents('1.005') >= 100, true);
});

test('tie-breaker: lower tax first', () => {
  const { game, ps } = lobby(2, 1000);
  G.startGame(game);
  ps[0].p.taxPaid = 500; ps[1].p.taxPaid = 100;
  const r = G.ranking(game);
  assert.equal(r[0].p.id, ps[1].p.id);
  ps[0].p.taxPaid = 100;
  const r2 = G.ranking(game);
  assert.equal(r2[0].rank, 1); assert.equal(r2[1].rank, 1); // shared position
});

test('resetGame returns to the lobby with the same players and a clean slate', () => {
  const { game, ps } = lobby(2);
  toTrading(game);
  G.trade(game, ps[0].p, { stockId: 'KO', side: 'buy', amount: 10_000 });
  const seed = game.market.seed;
  G.resetGame(game);
  assert.equal(game.status, 'lobby');
  assert.equal(game.players.length, 2);
  assert.equal(game.players[0].trades.length, 0);
  assert.equal(game.round, 0);
  assert.notEqual(game.market.seed, seed);
  G.setBudget(game, game.players[0].id, 50_000);
  G.startGame(game);
  assert.equal(game.status, 'running');
});
