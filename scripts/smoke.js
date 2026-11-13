// End-to-end smoke test over HTTP against a running server: node scripts/smoke.js [baseUrl] [waitSeconds]
// Creates a quick-timing room, joins 3 bots, waits (so a human can join too), then plays all 12 rounds.
const base = process.argv[2] || 'http://localhost:3000';
const wait = Number(process.argv[3] || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, u, b, t) => {
  const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { 'x-token': t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.status); e.code = j.code; throw e; }
  return j;
};
const { code, hostToken } = await call('POST', '/api/games', { timing: 'quick' });
console.log('ROOM', code);
const bots = [];
for (const n of ['Ana', 'Rui', 'Zoe']) bots.push({ n, ...(await call('POST', `/api/games/${code}/join`, { name: n })) });
await sleep(wait * 1000);
const host = (b) => call('POST', `/api/games/${code}/host`, b, hostToken);
const hs = await call('GET', `/api/games/${code}/state`, null, hostToken);
const budgets = [125000, 120000, 100000, 110000, 105000, 115000];
for (let i = 0; i < hs.players.length; i++) await host({ action: 'setBudget', playerId: hs.players[i].id, euros: budgets[i] });
await host({ action: 'start' });
const stocks = ['NVDA', 'AAPL', 'KO', 'AZN', 'GALP', 'META'];
const log = [];
for (;;) {
  const s = await call('GET', `/api/games/${code}/state`, null, hostToken);
  if (s.status === 'finished') { log.push('FINISHED'); break; }
  for (const [i, b] of bots.entries()) {
    const act = (body) => call('POST', `/api/games/${code}/player`, body, b.token).catch((e) => log.push(`${b.n}: ${e.message}`));
    if (s.phase === 'trading') {
      const id = stocks[(s.round + i) % stocks.length];
      await act({ action: 'trade', stockId: id, side: 'buy', amount: 800000 });
      if (s.round % 2 === 0) await act({ action: 'trade', stockId: stocks[(s.round + i + 5) % 6], side: 'sell', amount: 300000 });
      await act({ action: 'ready' });
    }
    if (s.phase === 'shop') await act({ action: 'buyPowerup', type: ['oracle', 'shield', 'rocket'][i] });
    if (s.phase === 'news' && s.round > 6) {
      const ps = await call('GET', `/api/games/${code}/state`, null, b.token);
      const pu = ps.me.powerup;
      if (pu?.status === 'owned') await act({ action: 'activatePowerup', stockId: 'AZN' });
    }
  }
  await sleep(700);
}
const fin = await call('GET', `/api/games/${code}/results`);
console.log(log.filter((l) => !/not marked|closed|Trading is closed/.test(l)).slice(0, 10));
console.log(fin.players.map((p) => `${p.rank}. ${p.name} €${(p.wealth / 100).toFixed(0)} tax €${(p.tax / 100).toFixed(0)} ${p.profile.name} pu=${p.powerup?.type}:${JSON.stringify(p.powerup?.result)}`).join('\n'));
