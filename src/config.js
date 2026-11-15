import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.PORT || 3000);
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const NEWS_PROVIDER = process.env.NEWS_PROVIDER || 'demo';
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

export const TOTAL_ROUNDS = 12;
export const MAX_PLAYERS = 8;
export const SHOP_AFTER_ROUND = 6;
export const POWERUP_COST = 800000; // cents (EUR 8,000)
export const CONNECTED_WINDOW_MS = 12000;
export const READY_COUNTDOWN_MS = 5000;

// seconds per phase
export const TIMING = {
  standard: { news: 60, trading: 60, reaction: 120, shop: 60 },
  quick: { news: 8, trading: 15, reaction: 8, shop: 8 }, // demo / smoke-test pacing
};

export const DEFAULT_BUDGET_PRESETS = [110000, 108000, 106000, 104000, 102000, 100000];
export const DEFAULT_BUDGET = 100000;
