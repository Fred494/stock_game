import crypto from 'node:crypto';
import {
  TOTAL_ROUNDS, MAX_PLAYERS, SHOP_AFTER_ROUND, POWERUP_COST, CONNECTED_WINDOW_MS,
  READY_COUNTDOWN_MS, TIMING, DEFAULT_BUDGET,
} from './config.js';
import { STOCKS, STOCK_BY_ID, FX_SNAPSHOT } from './stocks.js';
import { EVENTS, OPENING } from './events.js';
const evOf = (game, r) => (game.market.events || EVENTS)[r - 1];
import { buildMarket, roundReturn, direction } from './market.js';
import { MICRO, valueCents, toCents } from './money.js';
import { quoteBuy, quoteSell, applyBuy, applySell, positionQty, wealth, taxRate, REDUCED_RATE, STANDARD_RATE } from './trading.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = () => crypto.randomBytes(24).toString('hex');
const AVATARS = ['#4F8EFF', '#2BD99F', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8', '#FB923C', '#F472B6'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const POWERUPS = {
  oracle: { name: 'The Oracle', needsStock: true },
  shield: { name: 'Crash Shield', needsStock: false },
  rocket: { name: 'Profit Rocket', needsStock: true },
};
export const SHIELD_MAX = 1_000_000;
export const ROCKET_MAX_VALUE = 5_000_000;
export const ROCKET_MAX_PAYOUT = 1_500_000;

export class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, msg) => { throw new GameError(code, msg); };

export function makeCode(existing = () => false) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!existing(c)) return c;
  }
}

export function createGame({ code, timing = 'standard', seed, durations, hostToken, timed } = {}) {
  const ht = hostToken || token();
  const sd = seed ?? crypto.randomInt(1, 2 ** 31);
  const game = {
    v: 1, code, createdAt: Date.now(), status: 'lobby', timingName: timing,
    // Untimed by default: the host starts every phase. Timed only for the quick demo / tests / simulations.
    timed: timed ?? (durations != null || timing === 'quick'), introDone: false,
    durations: durations || TIMING[timing] || TIMING.standard,
    hostHash: sha(ht), players: [],
    round: 0, phase: 'lobby', remainingMs: 0, totalMs: 0, paused: false, speed: 1,
    settledThrough: 0, countdownMs: null, settlements: {}, history: {},
    market: buildMarket(sd), fx: FX_SNAPSHOT,
    news: Array.from({ length: 12 }, (_, i) => ({ round: i + 1, real: null })),
    nextCode: null, finishedAt: null, updatedAt: Date.now(),
  };
  return { game, hostToken: ht };
}

// ---------------------------------------------------------------- lobby

export const isHost = (game, t) => !!t && sha(t) === game.hostHash;
export const findPlayerByToken = (game, t) => (t ? game.players.find((p) => p.tokenHash === sha(t)) : null);
const connected = (p, now = Date.now()) => now - (p.lastSeen || 0) < CONNECTED_WINDOW_MS;

export function cleanName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

export function addPlayer(game, { name, avatar, token: existing }) {
  if (existing) {
    const p = findPlayerByToken(game, existing);
    if (p) { p.lastSeen = Date.now(); return { player: p, token: existing, reconnected: true }; }
  }
  if (game.status !== 'lobby') fail('started', 'Este jogo já começou.');
  const n = cleanName(name);
  if (n.length < 1) fail('bad_name', 'Escreve um nome.');
  if (game.players.length >= MAX_PLAYERS) fail('full', 'Esta sala está cheia (6 jogadores).');
  if (game.players.some((p) => p.name.toLowerCase() === n.toLowerCase())) fail('name_taken', 'Esse nome já está a ser usado nesta sala.');
  const t = token();
  const color = AVATARS.includes(avatar) ? avatar : AVATARS[game.players.length % AVATARS.length];
  const p = {
    id: crypto.randomBytes(6).toString('hex'), name: n, avatar: color, tokenHash: sha(t),
    budget: null, startCash: null, cash: 0, holdings: {}, trades: [], taxPaid: 0, ready: false,
    powerup: null, requestIds: [], lastSeen: Date.now(), joinedAt: Date.now(),
  };
  game.players.push(p);
  return { player: p, token: t, reconnected: false };
}

export function setBudget(game, playerId, euros) {
  if (game.status !== 'lobby') fail('locked', 'Os orçamentos ficam bloqueados quando o jogo começa.');
  const p = game.players.find((x) => x.id === playerId) || fail('no_player', 'Jogador desconhecido.');
  const c = toCents(euros);
  if (!Number.isFinite(c) || c < 0 || c > 1e12) fail('bad_budget', 'O orçamento tem de ser um número positivo.');
  p.budget = c;
}
export function resetBudgets(game) {
  if (game.status !== 'lobby') fail('locked', 'Os orçamentos ficam bloqueados quando o jogo começa.');
  for (const p of game.players) p.budget = DEFAULT_BUDGET * 100;
}
export function removePlayer(game, playerId) {
  if (game.status !== 'lobby') fail('locked', 'Só é possível remover jogadores antes de o jogo começar.');
  game.players = game.players.filter((p) => p.id !== playerId);
}

export function startGame(game) {
  if (game.status !== 'lobby') fail('started', 'O jogo já começou.');
  if (game.players.length < 1) fail('no_players', 'É preciso pelo menos um jogador.');
  for (const p of game.players) {
    if (p.budget == null || !Number.isFinite(p.budget) || p.budget < 0) fail('no_budget', `Atribui um orçamento inicial a ${p.name}.`);
  }
  for (const p of game.players) { p.startCash = p.budget; p.cash = p.budget; }
  game.status = 'running';
  game.startedAt = Date.now();
  snapshot(game);
  enterPhase(game, 'news', 1);
}

// ---------------------------------------------------------------- phases

export const pricesNow = (game) => game.market.path[game.settledThrough];

function enterPhase(game, phase, round) {
  game.phase = phase;
  if (round != null) game.round = round;
  const d = game.durations;
  game.totalMs = (d[phase] || 0) * 1000;
  game.remainingMs = game.totalMs;
  game.countdownMs = null;
  if (phase === 'trading') for (const p of game.players) p.ready = false;
  game.updatedAt = Date.now();
}

export function snapshot(game) {
  const prices = pricesNow(game);
  for (const p of game.players) {
    (game.history[p.id] ||= [])[game.settledThrough] = wealth(p, prices);
  }
}

export function settleRound(game) {
  const r = game.round;
  if (game.settledThrough >= r || r < 1) return; // idempotent: never settle twice
  const oldP = game.market.path[r - 1];
  const newP = game.market.path[r];
  const payouts = {};
  for (const p of game.players) {
    const pu = p.powerup;
    if (!pu || pu.status !== 'active' || pu.round !== r) continue;
    if (pu.type === 'shield') {
      let change = 0;
      for (const id of Object.keys(p.holdings)) {
        const q = positionQty(p, id);
        change += valueCents(q, newP[id]) - valueCents(q, oldP[id]);
      }
      const payout = Math.min(SHIELD_MAX, Math.max(0, -change));
      p.cash += payout;
      pu.status = 'used';
      pu.result = { round: r, marketChange: change, payout };
      payouts[p.id] = payout;
    } else if (pu.type === 'rocket') {
      const q = positionQty(p, pu.stockId);
      const pos = valueCents(q, oldP[pu.stockId]);
      const eligible = Math.min(ROCKET_MAX_VALUE, pos);
      const ret = newP[pu.stockId] / oldP[pu.stockId] - 1;
      const payout = Math.min(ROCKET_MAX_PAYOUT, Math.round(2 * eligible * Math.max(0, ret)));
      p.cash += payout;
      pu.status = 'used';
      pu.result = { round: r, stockId: pu.stockId, eligible, stockReturn: ret, payout };
      payouts[p.id] = payout;
    }
  }
  const ev = evOf(game, r);
  const mr = game.market.rounds[r - 1];
  const moves = STOCKS.map((s) => {
    const ret = newP[s.id] / oldP[s.id] - 1;
    const sens = ev.sens[s.id] || 0;
    let why = null;
    if (sens !== 0) {
      why = ev.roles[s.id] || '';
      if (mr.reversed) why = `Apesar de a notícia parecer ${sens > 0 ? 'positiva' : 'negativa'} para ela, os investidores já a tinham refletido no preço e o mercado reagiu ao contrário. ${why}`;
    } else if (Math.abs(ret) >= 0.005) {
      why = 'Sem ligação direta à notícia: acompanhou o mercado em geral e o seu setor.';
    }
    return { id: s.id, price: newP[s.id], prevPrice: oldP[s.id], pct: ret, direct: sens !== 0, why };
  });
  // Per-player recap: what each position they held gained or lost this round (private to that player).
  const pnl = {};
  for (const p of game.players) {
    const rows = [];
    for (const id of Object.keys(p.holdings)) {
      const q = positionQty(p, id);
      if (q <= 0) continue;
      rows.push({ id, qty: q, pnl: valueCents(q, newP[id]) - valueCents(q, oldP[id]), pct: newP[id] / oldP[id] - 1 });
    }
    rows.sort((a, b) => b.pnl - a.pnl);
    pnl[p.id] = { rows, total: rows.reduce((a, x) => a + x.pnl, 0), payout: payouts[p.id] || 0, wealth: wealth(p, newP) };
  }
  game.settlements[r] = { round: r, title: ev.title, teaches: ev.teaches, reversed: mr.reversed, marketPct: mr.marketPct, moves, payouts, pnl };
  game.settledThrough = r;
  snapshot(game);
  game.updatedAt = Date.now();
}

export function advance(game, { confirm = false } = {}) {
  if (game.status !== 'running') fail('not_running', 'O jogo não está a decorrer.');
  switch (game.phase) {
    case 'news': enterPhase(game, 'trading'); break;
    case 'trading': {
      if (!confirm && game.players.some((p) => !p.ready && connected(p))) fail('confirm_required', 'Alguns jogadores ainda não terminaram de negociar. Avançar mesmo assim?');
      settleRound(game);
      enterPhase(game, 'reaction');
      break;
    }
    case 'reaction':
      if (game.round === SHOP_AFTER_ROUND) enterPhase(game, 'shop');
      else if (game.round >= TOTAL_ROUNDS) finishGame(game);
      else enterPhase(game, 'news', game.round + 1);
      break;
    case 'shop': snapshot(game); enterPhase(game, 'news', game.round + 1); break;
    default: fail('bad_phase', 'Nada para avançar.');
  }
}

export function nextRound(game, opts = {}) {
  if (game.status !== 'running') fail('not_running', 'O jogo não está a decorrer.');
  if (game.phase === 'trading' && !opts.confirm && game.players.some((p) => !p.ready && connected(p))) {
    fail('confirm_required', 'Alguns jogadores ainda não terminaram de negociar. Avançar mesmo assim?');
  }
  if (game.phase === 'news' || game.phase === 'trading') { settleRound(game); enterPhase(game, 'reaction'); }
  advance(game, { confirm: true });
}

export function finishGame(game) {
  if (game.status === 'finished') return;
  settleRound(game);
  snapshot(game);
  game.status = 'finished';
  game.phase = 'finished';
  game.finishedAt = Date.now();
  game.remainingMs = 0; game.totalMs = 0; game.countdownMs = null;
  for (const p of game.players) if (p.powerup && p.powerup.status !== 'used') p.powerup.expired = true;
}

/** The host closes the quick intro summary shown at the start of the game. */
export function endIntro(game) { if (game.status === 'running') game.introDone = true; }
export function setPaused(game, paused) { if (game.status === 'running') game.paused = !!paused; }
export function setSpeed(game, s) {
  if (![1, 2, 4].includes(Number(s))) fail('bad_speed', 'A velocidade tem de ser 1, 2 ou 4.');
  game.speed = Number(s);
}

/** Server-authoritative clock. dt is real milliseconds. */
export function tick(game, dt, now = Date.now()) {
  if (game.status !== 'running' || game.paused || !game.timed) return false;
  const before = `${game.phase}${game.round}`;
  if (game.phase === 'trading') {
    const live = game.players.filter((p) => connected(p, now));
    const allReady = live.length > 0 && live.every((p) => p.ready);
    if (allReady) {
      if (game.countdownMs == null) game.countdownMs = READY_COUNTDOWN_MS;
      game.countdownMs -= dt;
      if (game.countdownMs <= 0) { advance(game, { confirm: true }); return true; }
    } else game.countdownMs = null;
  }
  game.remainingMs -= dt * game.speed;
  if (game.remainingMs <= 0) {
    advance(game, { confirm: true });
  }
  return `${game.phase}${game.round}` !== before;
}

// ---------------------------------------------------------------- player actions

function needTrading(game, p) {
  if (game.status !== 'running') fail('not_running', 'O jogo não está a decorrer.');
  if (game.phase !== 'trading') fail('closed', 'A negociação está fechada.');
  if (p.ready) fail('locked', 'Estás marcado como Pronto. Toca em "Editar as minhas operações" para negociar.');
}

export function quote(game, p, { stockId, side, amount }) {
  const s = STOCK_BY_ID[stockId] || fail('bad_stock', 'Ação desconhecida.');
  const price = pricesNow(game)[stockId];
  const cents = Number(amount);
  if (side === 'buy') return { stock: s, ...quoteBuy(p, price, cents) };
  if (side === 'sell') return { stock: s, ...quoteSell(p, stockId, price, cents, game.round) };
  return fail('bad_side', 'Tem de ser compra ou venda.');
}

export function trade(game, p, { stockId, side, amount, requestId }) {
  needTrading(game, p);
  if (requestId) {
    if (p.requestIds.includes(requestId)) return { duplicate: true };
  }
  const q = quote(game, p, { stockId, side, amount: Number(amount) });
  if (!q.ok) fail('rejected', q.error);
  if (side === 'buy') applyBuy(p, stockId, q, game.round);
  else applySell(p, stockId, q);
  if (requestId) { p.requestIds.push(requestId); if (p.requestIds.length > 300) p.requestIds.shift(); }
  const rec = {
    n: p.trades.length + 1, round: game.round, stockId, side, price: q.price, qty: q.qty,
    gross: side === 'buy' ? q.cost : q.gross, cost: q.cost, gain: q.gain ?? 0, tax: q.tax ?? 0,
    net: side === 'buy' ? q.cost : q.net, lots: q.lots?.map((l) => ({ r: l.lotRound, rate: l.rate, gain: l.gain, tax: l.tax })), at: Date.now(),
  };
  p.trades.push(rec);
  game.updatedAt = Date.now();
  return { trade: rec };
}

export function setReady(game, p, ready) {
  if (game.status !== 'running' || game.phase !== 'trading') fail('closed', 'A negociação não está aberta.');
  p.ready = !!ready;
  if (!p.ready) game.countdownMs = null;
}

export function purchasePowerup(game, p, type) {
  if (!POWERUPS[type]) fail('bad_powerup', 'Power-up desconhecido.');
  if (game.status !== 'running' || game.phase !== 'shop') fail('shop_closed', 'A loja de power-ups está fechada.');
  if (p.powerup) fail('already_owned', 'Só podes comprar um power-up.');
  if (p.cash < POWERUP_COST) fail('no_cash', 'Dinheiro insuficiente para um power-up (€8.000).');
  p.cash -= POWERUP_COST;
  p.powerup = { type, status: 'owned', boughtRound: game.round, result: null };
  game.updatedAt = Date.now();
}

export function activatePowerup(game, p, { stockId } = {}) {
  const pu = p.powerup;
  if (!pu || pu.status !== 'owned') fail('no_powerup', 'Não tens nenhum power-up por usar.');
  if (game.status !== 'running' || game.phase !== 'news' || game.round <= SHOP_AFTER_ROUND) {
    fail('bad_time', 'Os power-ups só podem ser ativados na fase de notícias das rondas 7 a 12.');
  }
  if (POWERUPS[pu.type].needsStock && !STOCK_BY_ID[stockId]) fail('bad_stock', 'Escolhe primeiro uma ação.');
  if (pu.type === 'oracle') {
    const dir = direction(roundReturn(game.market, game.round, stockId));
    pu.status = 'used';
    pu.result = { round: game.round, stockId, direction: dir };
  } else {
    pu.status = 'active';
    pu.round = game.round;
    if (pu.type === 'rocket') pu.stockId = stockId;
  }
  game.updatedAt = Date.now();
}

// ---------------------------------------------------------------- views

export function ranking(game) {
  const prices = pricesNow(game);
  const rows = game.players.map((p) => {
    const w = wealth(p, prices);
    return { p, wealth: w, ret: p.startCash ? (w - p.startCash) / p.startCash : 0 };
  });
  rows.sort((a, b) => b.wealth - a.wealth || a.p.taxPaid - b.p.taxPaid || b.ret - a.ret);
  let rank = 0;
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const tie = prev && prev.wealth === row.wealth && prev.p.taxPaid === row.p.taxPaid && prev.ret === row.ret;
    if (!tie) rank = i + 1;
    row.rank = rank;
  });
  return rows;
}

const publicMeta = (s) => ({ id: s.id, name: s.name, ticker: s.ticker, listing: s.listing, vol: s.vol, domain: s.domain, priceSource: s.priceSource });

function newsView(game, round) {
  const ev = evOf(game, round);
  const real = game.news[round - 1].real;
  return {
    round, title: ev.title, headline: ev.headline, summary: ev.summary, teaches: ev.teaches,
    relevant: ev.relevant, extras: ev.extras || [],
    scenario: { fictional: true, note: 'Cenário do jogo: uma história fictícia de prática. As reações das ações são simuladas.' },
    real, // real-world article (headline, publisher, date, url) or null
  };
}

function stocksView(game, p) {
  const r = game.settledThrough;
  const cur = game.market.path[r];
  const prev = r > 0 ? game.market.path[r - 1] : cur;
  const rel = game.round >= 1 && game.round <= TOTAL_ROUNDS && game.phase !== 'finished' && !['reaction', 'shop'].includes(game.phase)
    ? new Set(evOf(game, game.round).relevant) : new Set();
  const preludeFrom = Object.fromEntries((game.market.prelude || []).map((m) => [m.id, m.from]));
  const preludeById = Object.fromEntries((game.market.prelude || []).map((m) => [m.id, m.pct]));
  return STOCKS.map((s) => {
    const q = p ? positionQty(p, s.id) : 0;
    return {
      ...publicMeta(s), price: cur[s.id], change: r > 0 ? cur[s.id] / prev[s.id] - 1 : (preludeById[s.id] ?? 0),
      owned: q, ownedValue: valueCents(q, cur[s.id]), relevant: rel.has(s.id),
      history: [preludeFrom[s.id] ?? game.market.path[0][s.id], ...game.market.path.slice(0, r + 1).map((pp) => pp[s.id])],
    };
  });
}

function base(game) {
  return {
    code: game.code, serverNow: Date.now(), status: game.status, phase: game.phase, round: game.round,
    totalRounds: TOTAL_ROUNDS, paused: game.paused, speed: game.speed,
    timed: !!game.timed, intro: game.status === 'running' && !game.introDone && game.round === 1 && game.phase === 'news',
    remainingMs: game.timed ? Math.max(0, Math.round(game.remainingMs / game.speed)) : 0, totalMs: game.timed ? Math.round(game.totalMs / game.speed) : 0,
    countdownMs: game.countdownMs, settled: game.settledThrough, nextCode: game.nextCode,
    shopAfter: SHOP_AFTER_ROUND, powerupCost: POWERUP_COST,
    fx: { date: game.fx.date, locked: true }, priceSource: 'demo-simulated',
    opening: game.status === 'lobby' ? null : { title: OPENING.title, headline: OPENING.headline, rule: OPENING.rule, moves: (game.market.prelude || []).map(({ id, pct, direct, why }) => ({ id, pct, direct, why })) },
  };
}

function lastSettlement(game) {
  const s = game.settlements[game.settledThrough];
  if (!s) return null;
  const { payouts, pnl, ...rest } = s;
  return rest;
}

function leaderboard(game) {
  return ranking(game).map((r) => ({
    id: r.p.id, name: r.p.name, avatar: r.p.avatar, wealth: r.wealth, cash: r.p.cash, ret: r.ret, rank: r.rank,
    start: r.p.startCash, tax: r.p.taxPaid,
  }));
}

export function playerView(game, p) {
  p.lastSeen = Date.now();
  const prices = pricesNow(game);
  const ranks = game.status === 'lobby' ? [] : ranking(game);
  const myRank = ranks.find((x) => x.p === p)?.rank || null;
  const pu = p.powerup && {
    type: p.powerup.type, status: p.powerup.status, round: p.powerup.round, stockId: p.powerup.stockId,
    result: p.powerup.result, expired: !!p.powerup.expired,
  };
  const my = p.payoutSeen;
  void my;
  const v = {
    ...base(game), role: 'player',
    me: {
      id: p.id, name: p.name, avatar: p.avatar, cash: p.cash, wealth: wealth(p, prices), ready: p.ready,
      taxPaid: p.taxPaid, start: p.startCash, rank: myRank, powerup: pu,
      holdings: Object.keys(p.holdings).map((id) => ({ id, qty: positionQty(p, id), cost: p.holdings[id].lots.reduce((a, l) => a + l.cost, 0) })),
    },
    stocks: stocksView(game, p),
    players: game.players.map((x) => ({ id: x.id, name: x.name, avatar: x.avatar })),
    leaderboard: game.status === 'lobby' ? [] : leaderboard(game).map(({ id, name, avatar, wealth: w, ret, rank }) => ({ id, name, avatar, wealth: w, ret, rank })),
    lastSettlement: lastSettlement(game),
    myPayout: game.settlements[game.settledThrough]?.payouts?.[p.id] ?? null,
    myRound: game.settlements[game.settledThrough]?.pnl?.[p.id] ?? null,
  };
  if (game.round >= 1 && game.status !== 'finished') v.news = newsView(game, game.round);
  if (game.status === 'finished') v.results = results(game);
  return v;
}

export function hostView(game) {
  const now = Date.now();
  const v = {
    ...base(game), role: 'host',
    players: game.players.map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, budget: p.budget, connected: connected(p, now), ready: p.ready,
      cash: p.cash, wealth: wealth(p, pricesNow(game)), tax: p.taxPaid, start: p.startCash,
      powerup: p.powerup ? { type: p.powerup.type, status: p.powerup.status } : null,
    })),
    leaderboard: game.status === 'lobby' ? [] : leaderboard(game),
    stocks: stocksView(game, null),
    lastSettlement: lastSettlement(game),
    history: game.history,
    maxPlayers: MAX_PLAYERS,
  };
  if (game.round >= 1 && game.status !== 'finished') v.news = newsView(game, game.round);
  if (game.status === 'finished') v.results = results(game);
  return v;
}

// ---------------------------------------------------------------- results

function stockPnl(game, p) {
  const prices = pricesNow(game);
  const m = {};
  for (const t of p.trades) {
    const x = (m[t.stockId] ||= { invested: 0, returned: 0 });
    if (t.side === 'buy') x.invested += t.cost; else x.returned += t.net;
  }
  for (const id of Object.keys(p.holdings)) {
    (m[id] ||= { invested: 0, returned: 0 }).returned += valueCents(positionQty(p, id), prices[id]);
  }
  return Object.entries(m).map(([id, x]) => ({ id, name: STOCK_BY_ID[id].name, pnl: x.returned - x.invested, invested: x.invested })).sort((a, b) => b.pnl - a.pnl);
}

export function investorProfile(game, p) {
  const prices = pricesNow(game);
  const trades = p.trades.length;
  const sells = p.trades.filter((t) => t.side === 'sell');
  const peak = new Set(p.trades.filter((t) => t.side === 'buy').map((t) => t.stockId));
  const w = wealth(p, prices);
  const maxPos = Math.max(0, ...Object.keys(p.holdings).map((id) => valueCents(positionQty(p, id), prices[id])));
  const histCash = p.cashShare ?? (w ? p.cash / w : 1);
  const oldLots = Object.values(p.holdings).flatMap((h) => h.lots).filter((l) => game.round - l.round >= 4).length;
  const reducedSold = sells.some((t) => t.lots?.some((l) => l.rate === REDUCED_RATE));
  let name, why;
  if (trades === 0 || histCash > 0.6) { name = 'Investidor Defensivo'; why = 'Guardaste a maior parte do dinheiro seguro em numerário.'; }
  else if (trades >= 24) { name = 'Negociador Agressivo'; why = `Fizeste ${trades} ordens: compras e vendas frequentes.`; }
  else if (peak.size >= 8 && maxPos / (w || 1) < 0.3) { name = 'Investidor Diversificado'; why = `Repartiste o dinheiro por ${peak.size} empresas.`; }
  else if (sells.length <= 4 && (oldLots > 0 || reducedSold)) { name = 'Investidor de Longo Prazo'; why = 'Mantiveste posições o tempo suficiente para teres a taxa de imposto mais baixa.'; }
  else { name = 'Negociador Oportunista'; why = 'Escolheste os teus momentos e rodaste posições conforme as notícias chegavam.'; }
  return { name, why, trades, stocksTraded: peak.size };
}

export function results(game) {
  const rows = ranking(game);
  const prices = pricesNow(game);
  const players = rows.map((r) => {
    const p = r.p;
    const pnl = stockPnl(game, p);
    const soldReduced = p.trades.filter((t) => t.side === 'sell').flatMap((t) => t.lots || []).filter((l) => l.rate === REDUCED_RATE && l.gain > 0);
    const taxSaved = soldReduced.reduce((a, l) => a + Math.round(l.gain * (STANDARD_RATE - REDUCED_RATE)), 0);
    return {
      id: p.id, name: p.name, avatar: p.avatar, rank: r.rank, wealth: r.wealth, start: p.startCash, gain: r.wealth - p.startCash,
      ret: r.ret, cash: p.cash, tax: p.taxPaid, history: game.history[p.id] || [],
      powerup: p.powerup ? { type: p.powerup.type, status: p.powerup.status, result: p.powerup.result, expired: !!p.powerup.expired } : null,
      best: pnl[0] || null, worst: pnl.length > 1 ? pnl[pnl.length - 1] : null,
      profile: investorProfile(game, p),
      patience: { reducedRateSales: soldReduced.length, taxSaved },
      holdings: Object.keys(p.holdings).map((id) => ({ id, qty: positionQty(p, id), value: valueCents(positionQty(p, id), prices[id]) })),
    };
  });
  const events = Object.values(game.settlements).map((s) => ({
    round: s.round, title: s.title, teaches: s.teaches, reversed: s.reversed,
    top: [...s.moves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3),
  }));
  // Starting budgets differ by design, so also celebrate the best % return (does not change the winner rule).
  const br = [...players].sort((a, b) => b.ret - a.ret)[0] || null;
  const awards = { bestReturn: br && { id: br.id, name: br.name, ret: br.ret } };
  return { champion: players[0] || null, awards, players, events, tiebreak: 'Maior riqueza, depois menos impostos pagos, depois maior % de retorno.', totalRounds: TOTAL_ROUNDS, seed: game.market.seed };
}

export { taxRate };

/** Host reset: same room, same players, back to the lobby with a fresh market. Budgets stay editable. */
export function resetGame(game) {
  if (game.status === 'lobby') fail('already_lobby', 'O jogo ainda não começou.');
  Object.assign(game, {
    status: 'lobby', phase: 'lobby', round: 0, remainingMs: 0, totalMs: 0, paused: false, speed: 1,
    settledThrough: 0, countdownMs: null, settlements: {}, history: {}, nextCode: null, finishedAt: null,
    startedAt: null, introDone: false, market: buildMarket(crypto.randomInt(1, 2 ** 31)), updatedAt: Date.now(),
  });
  for (const p of game.players) {
    Object.assign(p, { startCash: null, cash: 0, holdings: {}, trades: [], taxPaid: 0, ready: false, powerup: null, requestIds: [] });
  }
}
