import { MICRO, valueCents } from './money.js';

export const STANDARD_RATE = 0.28;
export const REDUCED_RATE = 0.20;
export const REDUCED_AFTER_ROUNDS = 4;

export const taxRate = (saleRound, purchaseRound) =>
  saleRound - purchaseRound >= REDUCED_AFTER_ROUNDS ? REDUCED_RATE : STANDARD_RATE;

export const positionQty = (player, id) =>
  (player.holdings[id]?.lots || []).reduce((a, l) => a + l.qty, 0);

export function wealth(player, prices) {
  let w = player.cash;
  for (const id of Object.keys(player.holdings)) w += valueCents(positionQty(player, id), prices[id]);
  return w;
}

/** Validate an order amount (integer cents). */
function checkAmount(amount) {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 100) {
    return 'Enter an amount of at least €1.00.';
  }
  return null;
}

export function quoteBuy(player, price, amount) {
  const err = checkAmount(amount);
  if (err) return { ok: false, error: err };
  if (amount > player.cash) return { ok: false, error: 'Dinheiro insuficiente. Não é permitido pedir emprestado.' };
  const qty = Math.floor((amount * MICRO) / price);
  if (qty <= 0) return { ok: false, error: 'Montante demasiado pequeno para comprar ações.' };
  return { ok: true, side: 'buy', qty, cost: amount, price };
}

/** Quote a sale using FIFO lots. Does not mutate. */
export function quoteSell(player, id, price, gross, round) {
  const err = checkAmount(gross);
  if (err) return { ok: false, error: err };
  const lots = player.holdings[id]?.lots || [];
  const total = lots.reduce((a, l) => a + l.qty, 0);
  if (total <= 0) return { ok: false, error: 'Não tens esta ação.' };
  const posValue = valueCents(total, price);
  if (gross > posValue + 1) return { ok: false, error: 'Não podes vender mais do que tens.' };
  let remaining = gross >= posValue ? total : Math.min(total, Math.ceil((gross * MICRO) / price));
  const taken = [];
  let proceeds = 0, cost = 0, tax = 0, gain = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    const costPart = take === lot.qty ? lot.cost : Math.round((lot.cost * take) / lot.qty);
    const procPart = valueCents(take, price);
    const g = procPart - costPart;
    const rate = taxRate(round, lot.round);
    const t = g > 0 ? Math.round(g * rate) : 0;
    taken.push({ lotRound: lot.round, qty: take, cost: costPart, proceeds: procPart, gain: g, rate, tax: t, full: take === lot.qty });
    proceeds += procPart; cost += costPart; gain += g; tax += t;
    remaining -= take;
  }
  const qty = taken.reduce((a, l) => a + l.qty, 0);
  return { ok: true, side: 'sell', qty, price, gross: proceeds, cost, gain, tax, net: proceeds - tax, lots: taken, soldAll: qty === total };
}

export function applyBuy(player, id, quote, round) {
  player.cash -= quote.cost;
  (player.holdings[id] ||= { lots: [] }).lots.push({ qty: quote.qty, cost: quote.cost, round, price: quote.price });
}

export function applySell(player, id, quote) {
  const h = player.holdings[id];
  for (const t of quote.lots) {
    const lot = h.lots[0];
    if (t.full) h.lots.shift();
    else { lot.qty -= t.qty; lot.cost -= t.cost; }
  }
  if (h.lots.length === 0) delete player.holdings[id];
  player.cash += quote.net;
  player.taxPaid += quote.tax;
}
