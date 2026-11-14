import { API, api, esc, $, eur, eur0, pct, cls, logo, toast, POWERUP_INFO, lineChart, priceChart, fmtClock, PHASE_LABEL } from './common.js';

const KEY = 'mm-host';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
let host = load();
let S = null, sig = '', clockAt = 0;
let presets = [110000, 108000, 106000, 104000, 102000, 100000];
let pres = false, quick = false;
const app = $('#app');
const colors = ['#2BD99F', '#4F8EFF', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8'];
const joinUrl = () => `${location.origin}${location.pathname.replace(/host\.html$/, '')}play.html?code=${host.code}`;

api('/api/config').then((c) => { presets = c.presets; }).catch(() => {});

async function poll() {
  if (!host) return;
  try {
    S = await api(`/api/games/${host.code}/state`, { token: host.token });
    if (S.build) { if (window.__build && window.__build !== S.build) { location.reload(); return; } window.__build = S.build; }
    clockAt = performance.now() + S.remainingMs;
    const key = JSON.stringify({ ...S, serverNow: 0, remainingMs: 0, countdownMs: S.countdownMs == null ? null : 1 });
    const typing = document.activeElement?.classList.contains('bud');
    if (key !== sig && !typing) { sig = key; render(); }
  } catch (e) { if (e.status === 401 || e.status === 404) { localStorage.removeItem(KEY); host = null; S = null; render(); } }
}
setInterval(poll, 1000);
setInterval(() => {
  if (!S) return;
  const t = $('#timer'); if (t) t.textContent = S.paused ? `${fmtClock(S.remainingMs)} ⏸` : fmtClock(Math.max(0, clockAt - performance.now()));
}, 250);

const hostCall = async (body, okMsg) => {
  try { const r = await api(`/api/games/${host.code}/host`, { method: 'POST', body, token: host.token }); if (okMsg) toast(okMsg); await poll(); sig = ''; render(); return r; }
  catch (e) {
    if (e.code === 'confirm_required' && window.confirm(`${e.message}\n\nUnfinished players will lose their remaining trading time.`)) return hostCall({ ...body, confirm: true });
    toast(e.message, 'err'); return null;
  }
};

function render() {
  document.body.classList.toggle('big', pres);
  if (!host || !S) { app.innerHTML = createView(); return; }
  if (S.status === 'lobby') app.innerHTML = lobbyView();
  else if (S.status === 'finished') app.innerHTML = finalView();
  else app.innerHTML = gameView();
}

function createView() {
  return `<div style="max-width:560px;margin:8vh auto;text-align:center"><h1 style="font-size:44px">ELVA<span class="up">STOCKS</span></h1><p class="muted">Host control center. Create a room, share the code, assign budgets, and run the game.</p>
  <div class="card" style="text-align:left"><p class="muted" style="margin:0">Jogo <b>sem tempo</b>: tu decides quando começa cada fase de cada ronda (notícia, comprar e vender, reação do mercado).</p>
  <button class="btn green" style="width:100%;margin-top:16px" data-act="create">Create Game</button></div>
  <p class="muted"><a href="index.html">About the game</a> · <a href="play.html">Join as a player</a></p></div>`;
}

let selStock = null;
const headBar = () => `<div class="hbar"><span class="brand" style="font-size:18px">ELVA<b>STOCKS</b></span><span class="chip">Room ${esc(host.code)}</span><span class="grow"></span>
  ${S && S.status !== 'lobby' ? '<button class="btn ghost sm" data-act="restart">↺ Reiniciar jogo</button>' : ''}<button class="btn ghost sm" data-act="newroom">＋ Nova sala</button>
  <button class="btn ghost sm" data-act="pres">${pres ? 'Exit presentation' : '📺 Presentation mode'}</button></div>`;

function lobbyView() {
  const n = S.players.length;
  const ok = n > 0 && S.players.every((p) => p.budget != null);
  return `${headBar()}<div class="grid">
  <div class="card"><div class="muted">Join at <b>${esc(location.host)}</b> with code</div><div class="code">${esc(S.code)}</div>
    <div class="row" style="align-items:flex-start"><img class="qr" alt="QR code to join" src="${API}/api/qr?text=${encodeURIComponent(joinUrl())}"><div class="grow muted">Players scan the QR code or open<br><b style="word-break:break-all">${esc(joinUrl())}</b><br><br>Up to ${S.maxPlayers} players. Names must be unique.<br><br><a href="${esc(joinUrl())}" target="_blank" rel="noopener">Join as a player in a new tab →</a></div></div></div>
  <div class="card"><h2 style="font-size:20px">Players & starting budgets (${n}/${S.maxPlayers})</h2><p class="muted" style="font-size:13px">You assign every budget. Nothing is automatic. Budgets lock when the game starts.</p>
    ${S.players.map((p) => `<div class="prow"><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><div><b>${esc(p.name)}</b> <span class="dot ${p.connected ? 'on' : ''}" title="${p.connected ? 'connected' : 'offline'}"></span> <span class="muted" style="font-size:12px">${p.budget == null ? 'sem orçamento' : '€' + (p.budget / 100).toLocaleString('pt-PT')}</span><div class="mini" style="margin-top:4px">${presets.map((v) => `<button class="chip" data-act="preset" data-id="${esc(p.id)}" data-v="${v}" aria-pressed="${p.budget === v * 100}" style="border:0;cursor:pointer;${p.budget === v * 100 ? 'background:var(--green);color:#05241b;box-shadow:0 0 0 2px var(--green)' : 'color:var(--text)'}">${p.budget === v * 100 ? '✓ ' : ''}${v / 1000}k</button>`).join('')}</div></div>
      <input class="bud" data-id="${esc(p.id)}" inputmode="decimal" value="${p.budget == null ? '' : p.budget / 100}" placeholder="€ budget" aria-label="Budget for ${esc(p.name)}"><button class="btn ghost sm" data-act="kick" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button></div>`).join('') || '<p class="muted">Waiting for players to join…</p>'}
    <div class="ctl" style="margin-top:14px"><button class="btn ghost sm" data-act="reset">Reset to defaults (€100,000 each)</button><button class="btn ghost sm" data-act="same">Same amount for all…</button></div>
    <button class="btn green" style="width:100%;margin-top:16px" data-act="start" ${ok ? '' : 'disabled'}>${ok ? 'Start Game' : n ? 'Assign every budget to start' : 'Waiting for players'}</button></div></div>
  <p class="muted" style="text-align:center;margin-top:18px">${S.priceSource === 'demo-simulated' ? 'Demo mode: stock reference prices are simulated and labelled as such.' : ''}</p>`;
}

function gameView() {
  const running = S.phase;
  const nextLabel = S.phase === 'news' ? 'Abrir a negociação' : S.phase === 'trading' ? 'Fechar a negociação' : S.phase === 'reaction' ? (S.round === S.shopAfter ? 'Abrir a loja de power-ups' : S.round === S.totalRounds ? 'Ver resultados finais' : `Começar a ronda ${S.round + 1}`) : `Começar a ronda ${S.round + 1}`;
  const steps = [['news', '① Notícia'], ['trading', '② Comprar e vender'], ['reaction', '③ Reação do mercado']];
  const byId = Object.fromEntries(S.stocks.map((s) => [s.id, s]));
  const ready = S.players.filter((p) => p.ready).length;
  const mv = S.lastSettlement;
  const introCard = `<div class="card" style="grid-column:1/-1;border-color:var(--gold)"><h2 style="font-size:24px;margin:0 0 8px">Resumo rápido do jogo</h2>
    <ul style="line-height:1.7;margin:0 0 14px;padding-left:20px;font-size:17px">
      <li><b>Objetivo:</b> acabar com mais dinheiro (riqueza) depois de 12 rondas.</li>
      <li><b>Cada ronda tem 3 fases:</b> ① ver a notícia, ② comprar e vender ações, ③ ver como o mercado reagiu.</li>
      <li><b>Imposto:</b> 28% sobre os lucros ao vender (20% se mantiveres a ação 4 ou mais rondas). Perdas não pagam imposto.</li>
      <li><b>Depois da ronda 6:</b> loja de power-ups (um por jogador).</li>
      <li><b>Sem tempo:</b> o anfitrião inicia cada fase quando quiser.</li></ul>
    <button class="btn green" data-act="intro">▶ Começar a ronda 1</button></div>`;
  return `${headBar()}
  <div class="grid">
  ${S.intro ? introCard : ''}
    <div class="card"><div class="muted">Ronda ${S.round}/${S.totalRounds} · ${esc(PHASE_LABEL[S.phase])} ${S.paused ? '<span class="chip paused">EM PAUSA</span>' : ''}</div>
      ${S.phase === 'shop' ? '<div style="margin:10px 0;font-weight:700">Loja de power-ups aberta</div>' : `<div class="ctl" style="margin:10px 0;gap:6px">${steps.map(([k, l]) => `<span class="chip" style="${S.phase === k ? 'background:var(--blue);color:#fff' : ''}">${l}</span>`).join('')}</div>`}
      ${S.timed ? '<div class="timer num" id="timer"></div>' : ''}
      ${S.phase === 'trading' ? `<div class="muted" style="margin-bottom:6px">${ready}/${S.players.length} jogadores prontos</div>` : ''}
      ${S.countdownMs != null ? `<div class="chip paused">Todos prontos: a avançar em ${Math.ceil(S.countdownMs / 1000)} s</div>` : ''}
      <div class="ctl" style="margin-top:12px">
        <button class="btn green" data-act="next" ${S.intro ? 'disabled' : ''}>▶ ${nextLabel}</button>
        ${S.timed ? `<button class="btn ${S.paused ? 'green' : 'ghost'} sm" data-act="${S.paused ? 'resume' : 'pause'}">${S.paused ? '▶ Continuar' : '⏸ Pausa'}</button>
        ${[1, 2, 4].map((v) => `<button class="btn ${S.speed === v ? '' : 'ghost'} sm" data-act="speed" data-v="${v}">${v}×</button>`).join('')}` : ''}
      </div></div>
    <div class="card">${S.news ? `<span class="chip">Round ${S.news.round} event</span> <span class="chip" style="color:var(--gold)">fictional scenario</span><h2 style="font-size:22px;margin:8px 0">${esc(S.news.headline)}</h2><p>${esc(S.news.summary)}</p><p class="muted">Teaches: ${esc(S.news.teaches)}<br>Companies: ${S.news.relevant.map((id) => esc(byId[id].ticker)).join(', ')}</p>${S.news.real ? `<p class="muted">Real coverage: ${esc(S.news.real.headline)} (${esc(S.news.real.publisher)}) <a href="${esc(S.news.real.url)}" target="_blank" rel="noopener noreferrer">source</a></p>` : '<p class="muted" style="font-size:12px">No live news provider configured: showing the fictional practice scenario only.</p>'}` : ''}</div>
  </div>
  <div class="grid" style="margin-top:16px">
    <div class="card"><h2 style="font-size:20px">Leaderboard ${S.phase === 'trading' ? `<span class="muted" style="font-size:14px">· ${ready}/${S.players.length} ready</span>` : ''}</h2>
      <table><tr><th>#</th><th>Player</th><th class="r">Wealth</th><th class="r">Return</th><th class="r nopres">Cash</th><th class="r">Tax</th><th>Status</th></tr>
      ${S.leaderboard.map((l) => { const p = S.players.find((x) => x.id === l.id); return `<tr><td>${l.rank}</td><td><span class="dot ${p.connected ? 'on' : ''}"></span> <b>${esc(l.name)}</b> <span class="muted nopres">(${eur0(l.start)})</span></td><td class="r num">${eur0(l.wealth)}</td><td class="r num ${cls(l.ret)}">${pct(l.ret, 1)}</td><td class="r num nopres">${eur0(l.cash)}</td><td class="r num">${eur0(l.tax)}</td><td>${p.ready ? '<span class="chip open">Ready</span>' : p.connected ? '' : '<span class="chip closed">offline</span>'} ${p.powerup ? `<span class="pbadge">${POWERUP_INFO[p.powerup.type].icon} ${esc(p.powerup.status)}</span>` : ''}</td></tr>`; }).join('')}</table></div>
    <div class="card"><h2 style="font-size:20px">Market ${mv ? '· Round ' + mv.round + ' reaction' : '(starting prices)'}</h2>
      ${selStock && byId[selStock] ? `<div style="margin:8px 0 14px"><b>${esc(byId[selStock].name)}</b> <span class="muted">${esc(byId[selStock].ticker)} · evolução do preço</span> <button class="btn ghost sm" data-act="stock" data-id="${esc(selStock)}" style="float:right">✕</button>${priceChart(byId[selStock].history || [], { w: 520, h: 200 })}</div>` : '<p class="muted" style="font-size:13px;margin:0 0 6px">Clica numa ação para ver o gráfico.</p>'}
      <table><tr><th></th><th>Stock</th><th class="r">Price</th><th class="r">Move</th></tr>
      ${(mv ? [...mv.moves].sort((a, b) => b.pct - a.pct) : S.stocks.map((s) => ({ id: s.id, price: s.price, pct: 0 }))).map((m) => `<tr data-act="stock" data-id="${esc(m.id)}" style="cursor:pointer${selStock === m.id ? ';background:var(--bg3)' : ''}"><td>${logo(byId[m.id], 26)}</td><td>${esc(byId[m.id].name)} <span class="muted">${esc(byId[m.id].ticker)}</span></td><td class="r num">${eur(m.price)}</td><td class="r num ${cls(m.pct)}">${mv ? pct(m.pct) : '—'}</td></tr>`).join('')}</table></div>
  </div>
  <div class="card nopres" style="margin-top:16px"><h2 style="font-size:20px">Wealth by round</h2>${lineChart(S.leaderboard.map((l, i) => ({ name: l.name, color: colors[i % 6], points: S.history[l.id] || [] })), { w: 900, h: 260 })}</div>`;
}

function finalView() {
  const R = S.results;
  return `${headBar()}<div class="card" style="text-align:center;border-color:var(--gold)"><div style="font-size:54px">🏆</div><div class="muted">ELVASTOCKS CHAMPION</div><h1 style="font-size:44px">${esc(R.champion.name)}</h1><div class="num gold" style="font-size:30px">${eur(R.champion.wealth)} · ${pct(R.champion.ret, 1)}</div>${R.awards?.bestReturn ? `<div class="muted" style="margin-top:8px">📈 Best return: <b>${esc(R.awards.bestReturn.name)}</b> ${pct(R.awards.bestReturn.ret, 1)}</div>` : ''}</div>
  <div class="grid" style="margin-top:16px"><div class="card"><h2 style="font-size:20px">Final leaderboard</h2><table><tr><th>#</th><th>Player</th><th class="r">Wealth</th><th class="r">Return</th><th class="r">Tax</th><th>Profile</th><th>Best / worst</th></tr>
    ${R.players.map((p) => `<tr><td>${p.rank}</td><td><b>${esc(p.name)}</b></td><td class="r num">${eur0(p.wealth)}</td><td class="r num ${cls(p.ret)}">${pct(p.ret, 1)}</td><td class="r num">${eur0(p.tax)}</td><td>${esc(p.profile.name)}</td><td class="muted">${p.best ? esc(p.best.name) : '—'} / ${p.worst ? esc(p.worst.name) : '—'}</td></tr>`).join('')}</table>
    <p class="muted" style="font-size:12px">${esc(R.tiebreak)}</p></div>
  <div class="card"><h2 style="font-size:20px">Wealth by round</h2>${lineChart(R.players.map((p, i) => ({ name: p.name, color: colors[i % 6], points: p.history })), { w: 600, h: 280 })}</div></div>
  <div class="card" style="margin-top:16px"><h2 style="font-size:20px">What moved the market</h2>${R.events.map((e) => `<p><b>R${e.round} ${esc(e.title)}</b>${e.reversed ? ' (priced-in reversal)' : ''} <span class="muted">${esc(e.teaches)}</span></p>`).join('')}</div>
  <div class="ctl" style="margin-top:16px"><button class="btn green" data-act="again">▶ Play again (new room, same players)</button><a class="btn ghost" href="index.html" style="text-decoration:none;display:inline-grid;place-items:center">About the game</a></div>`;
}

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'create') {
    quick = false;
    try { const r = await api('/api/games', { method: 'POST', body: { timing: quick ? 'quick' : 'standard' } }); host = { code: r.code, token: r.hostToken }; localStorage.setItem(KEY, JSON.stringify(host)); sig = ''; await poll(); render(); }
    catch (er) { toast(er.message, 'err'); }
  } else if (a === 'pres') { pres = !pres; render(); }
  else if (a === 'preset') await hostCall({ action: 'setBudget', playerId: el.dataset.id, euros: Number(el.dataset.v) });
  else if (a === 'kick') await hostCall({ action: 'removePlayer', playerId: el.dataset.id });
  else if (a === 'reset') await hostCall({ action: 'resetBudgets' }, 'All budgets set to €100,000');
  else if (a === 'same') { const v = window.prompt('Starting budget for every player (€):', '100000'); if (v != null) await hostCall({ action: 'setAllBudgets', euros: Number(v) }); }
  else if (a === 'start') await hostCall({ action: 'start' });
  else if (a === 'pause' || a === 'resume') await hostCall({ action: a });
  else if (a === 'intro') await hostCall({ action: 'intro' });
  else if (a === 'next') await hostCall({ action: 'nextPhase' });
  else if (a === 'nextround') await hostCall({ action: 'nextRound' });
  else if (a === 'speed') await hostCall({ action: 'speed', speed: Number(el.dataset.v) });
  else if (a === 'restart') { if (window.confirm('Reiniciar o jogo? Todo o progresso é apagado, os jogadores ficam na sala e voltam ao lobby com novo mercado.')) await hostCall({ action: 'resetGame' }, 'Jogo reiniciado'); }
  else if (a === 'newroom') {
    if (!window.confirm('Criar uma nova sala? Os jogadores atuais têm de entrar com o novo código.')) return;
    const r = await hostCall({ action: 'newRoom' });
    if (r?.nextCode) { host = { code: r.nextCode, token: host.token }; localStorage.setItem(KEY, JSON.stringify(host)); S = null; sig = ''; await poll(); render(); }
  }
  else if (a === 'stock') { selStock = selStock === el.dataset.id ? null : el.dataset.id; sig = ''; render(); }
  else if (a === 'again') {
    const r = await hostCall({ action: 'playAgain' });
    if (r?.nextCode) { host = { code: r.nextCode, token: host.token }; localStorage.setItem(KEY, JSON.stringify(host)); S = null; sig = ''; await poll(); render(); }
  }
});
app.addEventListener('change', async (e) => {
  if (e.target.classList.contains('bud')) await hostCall({ action: 'setBudget', playerId: e.target.dataset.id, euros: Number(e.target.value.replace(',', '.')) });
});
document.addEventListener('keydown', (e) => { if (e.key === 'p' && !/INPUT/.test(document.activeElement.tagName)) { pres = !pres; render(); } });

render();
poll();
