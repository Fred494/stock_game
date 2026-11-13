import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'mm-test-' + Date.now());
const { server } = await import('../src/server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('end-to-end over HTTP: join, budgets, play, host-only, privacy, reconnect', async () => {
  const created = await call('POST', '/api/games', { timing: 'quick' });
  const { code, hostToken } = created.body;
  assert.match(code, /^[A-Z2-9]{6}$/);

  const a = (await call('POST', `/api/games/${code}/join`, { name: 'Ana' })).body;
  const b = (await call('POST', `/api/games/${code}/join`, { name: 'Bo' })).body;
  assert.equal((await call('POST', `/api/games/${code}/join`, { name: 'ana' })).status, 400);

  // players cannot run host commands
  assert.equal((await call('POST', `/api/games/${code}/host`, { action: 'start' }, a.token)).status, 403);
  // cannot start without budgets
  assert.equal((await call('POST', `/api/games/${code}/host`, { action: 'start' }, hostToken)).status, 400);
  await call('POST', `/api/games/${code}/host`, { action: 'setBudget', playerId: a.playerId, euros: 125000 }, hostToken);
  await call('POST', `/api/games/${code}/host`, { action: 'setBudget', playerId: b.playerId, euros: 100000 }, hostToken);
  assert.equal((await call('POST', `/api/games/${code}/host`, { action: 'start' }, hostToken)).status, 200);

  // unauthenticated and forged tokens rejected
  assert.equal((await call('GET', `/api/games/${code}/state`)).status, 401);
  assert.equal((await call('GET', `/api/games/${code}/state`, null, 'nope')).status, 401);

  let s = (await call('GET', `/api/games/${code}/state`, null, a.token)).body;
  assert.equal(s.phase, 'news');
  assert.equal(s.me.cash, 12_500_000);
  assert.equal(s.stocks.length, 24);
  assert.ok(!JSON.stringify(s).includes('"path"'));

  await call('POST', `/api/games/${code}/host`, { action: 'nextPhase' }, hostToken);
  const t = await call('POST', `/api/games/${code}/player`, { action: 'trade', stockId: 'NVDA', side: 'buy', amount: 1_000_000, requestId: 'r1' }, a.token);
  assert.equal(t.status, 200);
  const dup = await call('POST', `/api/games/${code}/player`, { action: 'trade', stockId: 'NVDA', side: 'buy', amount: 1_000_000, requestId: 'r1' }, a.token);
  assert.equal(dup.body.duplicate, true);
  const over = await call('POST', `/api/games/${code}/player`, { action: 'trade', stockId: 'NVDA', side: 'buy', amount: 99_000_000_00 }, a.token);
  assert.equal(over.status, 400);

  // reconnect via stored token
  const re = (await call('POST', `/api/games/${code}/join`, { name: 'x', token: a.token })).body;
  assert.equal(re.playerId, a.playerId);
  s = (await call('GET', `/api/games/${code}/state`, null, a.token)).body;
  assert.equal(s.me.cash, 11_500_000);

  // host sees ready/leaderboard; nextPhase warns about unfinished players
  const warn = await call('POST', `/api/games/${code}/host`, { action: 'nextPhase' }, hostToken);
  assert.equal(warn.status, 409);
  await call('POST', `/api/games/${code}/host`, { action: 'nextPhase', confirm: true }, hostToken);
  const h = (await call('GET', `/api/games/${code}/state`, null, hostToken)).body;
  assert.equal(h.phase, 'reaction');
  assert.equal(h.leaderboard.length, 2);
  assert.equal(h.lastSettlement.moves.length, 24);
});
