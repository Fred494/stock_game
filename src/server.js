import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { PORT, ROOT, CORS_ORIGIN, NEWS_PROVIDER, DEFAULT_BUDGET_PRESETS } from './config.js';
import * as G from './game.js';
import { saveGame, loadAll } from './store.js';
import { prefetchNews } from './news.js';

const games = loadAll();
const dirty = new Set();
const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

// ------------------------------------------------------------ helpers
const send = (res, code, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 20000) { reject(new G.GameError('too_big', 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new G.GameError('bad_json', 'Invalid JSON')); } });
  });
}
const hits = new Map();
function limited(ip, max = 60) {
  const now = Date.now(); const h = (hits.get(ip) || []).filter((t) => now - t < 60000);
  h.push(now); hits.set(ip, h); return h.length > max;
}
const markDirty = (g) => dirty.add(g.code);

// ------------------------------------------------------------ API
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const ip = req.socket.remoteAddress || '?';
  const tok = req.headers['x-token'] || '';

  if (req.method === 'GET' && parts[1] === 'health') return send(res, 200, { ok: true, newsProvider: NEWS_PROVIDER, games: games.size });
  if (req.method === 'GET' && parts[1] === 'config') return send(res, 200, { presets: DEFAULT_BUDGET_PRESETS });
  if (req.method === 'GET' && parts[1] === 'qr') {
    const text = String(url.searchParams.get('text') || '').slice(0, 300);
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#0B1321', light: '#ffffff' } });
    return send(res, 200, svg, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' });
  }
  if (req.method === 'GET' && parts[1] === 'history') {
    const list = [...games.values()].filter((g) => g.status === 'finished').map((g) => {
      const r = G.results(g);
      return { code: g.code, finishedAt: g.finishedAt, winner: r.champion?.name, wealth: r.champion?.wealth, players: g.players.length };
    }).sort((a, b) => b.finishedAt - a.finishedAt);
    return send(res, 200, list);
  }

  if (req.method === 'POST' && parts[1] === 'games' && parts.length === 2) {
    if (limited(ip, 20)) return send(res, 429, { error: 'Mais devagar', code: 'rate' });
    const body = await readBody(req);
    const code = G.makeCode((c) => games.has(c));
    const { game, hostToken } = G.createGame({ code, timing: body.timing === 'quick' ? 'quick' : 'standard' });
    games.set(code, game); markDirty(game);
    prefetchNews(game, () => markDirty(game)).catch(() => {});
    return send(res, 200, { code, hostToken });
  }

  if (parts[1] === 'games' && parts[2]) {
    const game = games.get(String(parts[2]).toUpperCase());
    if (!game) return send(res, 404, { error: 'Sala não encontrada', code: 'no_room' });
    const sub = parts[3];

    if (req.method === 'POST' && sub === 'join') {
      if (limited(ip, 40)) return send(res, 429, { error: 'Mais devagar', code: 'rate' });
      const b = await readBody(req);
      const { player, token, reconnected } = G.addPlayer(game, { name: b.name, avatar: b.avatar, token: b.token });
      markDirty(game);
      return send(res, 200, { playerId: player.id, token, reconnected });
    }

    if (req.method === 'GET' && sub === 'state') {
      if (G.isHost(game, tok)) return send(res, 200, G.hostView(game));
      const p = G.findPlayerByToken(game, tok);
      if (p) return send(res, 200, G.playerView(game, p));
      return send(res, 401, { error: 'Sessão desconhecida', code: 'unauthorized' });
    }

    if (req.method === 'GET' && sub === 'results' && game.status === 'finished') return send(res, 200, G.results(game));

    if (req.method === 'POST' && sub === 'host') {
      if (!G.isHost(game, tok)) return send(res, 403, { error: 'Só o anfitrião', code: 'forbidden' });
      const b = await readBody(req);
      let extra = {};
      switch (b.action) {
        case 'setBudget': G.setBudget(game, b.playerId, b.euros); break;
        case 'setAllBudgets': for (const p of game.players) G.setBudget(game, p.id, b.euros); break;
        case 'resetBudgets': G.resetBudgets(game); break;
        case 'removePlayer': G.removePlayer(game, b.playerId); break;
        case 'start': G.startGame(game); break;
        case 'pause': G.setPaused(game, true); break;
        case 'resume': G.setPaused(game, false); break;
        case 'speed': G.setSpeed(game, b.speed); break;
        case 'nextPhase': G.advance(game, { confirm: !!b.confirm }); break;
        case 'nextRound': G.nextRound(game, { confirm: !!b.confirm }); break;
        case 'resetGame': G.resetGame(game); break;
        case 'newRoom': {
          const code = G.makeCode((c) => games.has(c));
          const next = G.createGame({ code, timing: game.timingName, hostToken: tok }).game;
          games.set(code, next); markDirty(next);
          prefetchNews(next, () => markDirty(next)).catch(() => {});
          extra = { nextCode: code };
          break;
        }
        case 'playAgain': {
          if (game.status !== 'finished') throw new G.GameError('not_finished', 'Game is not finished.');
          if (!game.nextCode) {
            const code = G.makeCode((c) => games.has(c));
            const next = G.createGame({ code, timing: game.timingName, hostToken: tok }).game;
            games.set(code, next); game.nextCode = code; markDirty(next);
            prefetchNews(next, () => markDirty(next)).catch(() => {});
          }
          extra = { nextCode: game.nextCode };
          break;
        }
        default: return send(res, 400, { error: 'Ação desconhecida', code: 'bad_action' });
      }
      markDirty(game);
      return send(res, 200, { ok: true, ...extra });
    }

    if (req.method === 'POST' && sub === 'player') {
      const p = G.findPlayerByToken(game, tok);
      if (!p) return send(res, 401, { error: 'Sessão desconhecida', code: 'unauthorized' });
      const b = await readBody(req);
      let out = {};
      switch (b.action) {
        case 'quote': out = { quote: G.quote(game, p, b) }; delete out.quote.stock; break;
        case 'trade': out = G.trade(game, p, b); break;
        case 'ready': G.setReady(game, p, true); break;
        case 'unready': G.setReady(game, p, false); break;
        case 'buyPowerup': G.purchasePowerup(game, p, b.type); break;
        case 'activatePowerup': G.activatePowerup(game, p, b); break;
        default: return send(res, 400, { error: 'Ação desconhecida', code: 'bad_action' });
      }
      markDirty(game);
      return send(res, 200, { ok: true, ...out });
    }
  }
  return send(res, 404, { error: 'Não encontrado', code: 'not_found' });
}

// ------------------------------------------------------------ static
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Não encontrado');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof G.GameError) return send(res, e.code === 'confirm_required' ? 409 : 400, { error: e.message, code: e.code });
    console.error(e);
    return send(res, 500, { error: 'Erro do servidor', code: 'server' });
  }
});

// ------------------------------------------------------------ clock + persistence
let last = Date.now();
setInterval(() => {
  const now = Date.now(); const dt = now - last; last = now;
  for (const g of games.values()) {
    try { if (G.tick(g, dt, now) !== undefined && g.status === 'running') markDirty(g); } catch (e) { console.error(e); }
    if (g.status === 'finished' && !g.saved) { g.saved = true; markDirty(g); }
  }
}, 250).unref();
setInterval(() => {
  for (const code of dirty) { try { saveGame(games.get(code)); } catch (e) { console.error(e); } }
  dirty.clear();
}, 2000).unref();
const flush = () => { for (const g of games.values()) { try { saveGame(g); } catch { /* ignore */ } } process.exit(0); };
process.on('SIGINT', flush); process.on('SIGTERM', flush);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'src/server.js')) {
  server.listen(PORT, () => console.log(`ElvaStocks running on http://localhost:${PORT}  (news: ${NEWS_PROVIDER})`));
}
