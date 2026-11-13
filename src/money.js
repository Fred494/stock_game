// Money is kept in integer cents. Share quantities are integer micro-shares (1e-6 share).
export const MICRO = 1_000_000;

export const toCents = (euros) => {
  const n = Number(euros);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
};
export const valueCents = (qtyMicro, priceCents) => Math.round((qtyMicro * priceCents) / MICRO);
export const fmtEUR = (cents) =>
  (cents / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
