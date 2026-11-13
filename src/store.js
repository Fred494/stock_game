import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const DIR = path.join(DATA_DIR, 'games');

export function saveGame(game) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = path.join(DIR, `${game.code}.json`);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(game));
  fs.renameSync(tmp, f); // atomic replace
}

export function loadAll() {
  const games = new Map();
  if (!fs.existsSync(DIR)) return games;
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      if (g.status === 'running') g.paused = true; // resume safely after a restart
      games.set(g.code, g);
    } catch { /* skip corrupt file */ }
  }
  return games;
}
