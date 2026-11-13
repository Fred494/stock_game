// The 21 playable companies. Starting prices are DEMO reference prices in EUR (simulated, clearly labelled).
// providerSymbol is the ticker a market-data provider (Yahoo/Finnhub style) expects.
const S = (id, name, ticker, listing, providerSymbol, vol, sector, domain, demoPriceEUR) => ({
  id, name, ticker, listing, providerSymbol, vol, sector, domain,
  startPriceCents: Math.round(demoPriceEUR * 100),
  priceSource: 'demo-simulated',
});

export const STOCKS = [
  S('NVDA', 'NVIDIA', 'NVDA', 'NASDAQ', 'NVDA', 'high', 'semis', 'nvidia.com', 135),
  S('AAPL', 'Apple', 'AAPL', 'NASDAQ', 'AAPL', 'medium', 'bigtech', 'apple.com', 195),
  S('META', 'Meta Platforms', 'META', 'NASDAQ', 'META', 'high', 'bigtech', 'meta.com', 540),
  S('AMZN', 'Amazon', 'AMZN', 'NASDAQ', 'AMZN', 'medium', 'bigtech', 'amazon.com', 180),
  S('AMD', 'AMD', 'AMD', 'NASDAQ', 'AMD', 'high', 'semis', 'amd.com', 145),
  S('INTC', 'Intel', 'INTC', 'NASDAQ', 'INTC', 'high', 'semis', 'intel.com', 22),
  S('V', 'Visa', 'V', 'NYSE', 'V', 'low', 'payments', 'visa.com', 265),
  S('MA', 'Mastercard', 'MA', 'NYSE', 'MA', 'low', 'payments', 'mastercard.com', 450),
  S('EDP', 'EDP', 'EDP', 'Lisbon', 'EDP.LS', 'medium', 'utilities', 'edp.com', 3.6),
  S('GALP', 'Galp', 'GALP', 'Lisbon', 'GALP.LS', 'medium', 'energy', 'galp.com', 15.5),
  S('JNJ', 'Johnson & Johnson', 'JNJ', 'NYSE', 'JNJ', 'low', 'health', 'jnj.com', 150),
  S('AZN', 'AstraZeneca', 'AZN', 'LSE / Nasdaq', 'AZN', 'medium', 'health', 'astrazeneca.com', 125),
  S('TSM', 'Taiwan Semiconductor Manufacturing', 'TSM', 'NYSE ADR', 'TSM', 'high', 'semis', 'tsmc.com', 170),
  S('SPCX', 'SpaceX', 'SPCX', 'Nasdaq (assumed)', 'SPCX', 'high', 'space', 'spacex.com', 120),
  S('005930', 'Samsung Electronics', '005930', 'Korea', '005930.KS', 'medium', 'semis', 'samsung.com', 52),
  S('COST', 'Costco', 'COST', 'NASDAQ', 'COST', 'medium', 'retail', 'costco.com', 820),
  S('KO', 'Coca-Cola', 'KO', 'NYSE', 'KO', 'low', 'staples', 'coca-colacompany.com', 62),
  S('PG', 'Procter & Gamble', 'PG', 'NYSE', 'PG', 'low', 'staples', 'pg.com', 158),
  S('PM', 'Philip Morris International', 'PM', 'NYSE', 'PM', 'low', 'staples', 'pmi.com', 105),
  S('2222', 'Saudi Aramco', '2222', 'Saudi Arabia', '2222.SR', 'medium', 'energy', 'aramco.com', 7.1),
  S('WMT', 'Walmart', 'WMT', 'NYSE', 'WMT', 'low', 'retail', 'walmart.com', 72),
];
export const STOCK_BY_ID = Object.fromEntries(STOCKS.map((s) => [s.id, s]));

// FX snapshot recorded once and locked for the game (demo values; replace via a live provider).
export const FX_SNAPSHOT = { base: 'EUR', date: 'demo-fixture', USD: 0.92, GBP: 1.17, KRW: 0.00068, SAR: 0.245, locked: true };
