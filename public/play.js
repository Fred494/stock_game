import { api, esc, $, eur, eur0, pct, qtyFmt, cls, logo, toast, fx, POWERUP_INFO, lineChart, priceChart, fmtClock, PHASE_LABEL } from './common.js';

const AVATARS = ['#4F8EFF', '#2BD99F', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8', '#FB923C', '#F472B6'];
const KEY = 'mm-session';
const uid = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* insecure context */ } return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`; };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
const clear = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

let session = load();
// A QR link / ?code= for a DIFFERENT room means "join the new room": forget the old saved session.
{
  const want = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
  if (session && want && want !== String(session.code).toUpperCase()) { clear(); session = null; }
}
let S = null; // latest server state
let sig = '';
let clockAt = 0; // performance.now() when phase ends
let clockTotal = 1;
const ui = { screen: 'stocks', sel: null, filter: 'all', q: '', side: 'buy', amount: '', quote: null, avatar: AVATARS[0], confirmPU: null, puStock: '', joinErr: '', busy: false, lastPhase: '' };

const $main = $('#main'), $top = $('#top'), $ov = $('#overlay');

// ------------------------------------------------------------ polling
async function poll() {
  if (!session) return;
  try {
    S = await api(`/api/games/${session.code}/state`, { token: session.token });
    if (S.build) { if (window.__build && window.__build !== S.build) { location.reload(); return; } window.__build = S.build; }
    const key = JSON.stringify({ ...S, serverNow: 0, remainingMs: 0, countdownMs: S.countdownMs == null ? null : 1 });
    clockAt = performance.now() + S.remainingMs; clockTotal = Math.max(1, S.totalMs);
    if (key !== sig) { sig = key; render(); }
    if (S.phase !== ui.lastPhase) { onPhaseChange(ui.lastPhase, S.phase); ui.lastPhase = S.phase; }
  } catch (e) {
    if (e.status === 401 || e.status === 404) { clear(); session = null; S = null; render(); }
  }
}
function onPhaseChange(from, to) {
  if (!from) return;
  if (to === 'trading') { fx.beep(880, 160, 60); toast('Trading is open!'); }
  if (to === 'reaction') { fx.beep(520, 200, 120); ui.screen = 'stocks'; ui.sel = null; }
  if (to === 'news') { ui.screen = 'stocks'; ui.sel = null; }
  if (to === 'finished') fx.beep(990, 400, 200);
}
setInterval(poll, 1000);
setInterval(() => {
  if (!S) return;
  const left = S.paused ? S.remainingMs : Math.max(0, clockAt - performance.now());
  const c = $('#clock'); if (c) c.textContent = S.phase === 'finished' || S.phase === 'lobby' ? '' : fmtClock(left);
  const b = $('#bar'); if (b) b.style.width = `${S.totalMs ? 100 * (1 - left / clockTotal) : 0}%`;
}, 250);

// ------------------------------------------------------------ render
function render() {
  renderTop();
  const active = document.activeElement;
  const hadSearch = active && active.id === 'search';
  const caret = hadSearch ? active.selectionStart : 0;
  const hadAmt = active && active.id === 'amt';
  if (!session || !S) $main.innerHTML = joinView();
  else if (S.status === 'lobby') $main.innerHTML = lobbyView();
  else if (S.status === 'finished') $main.innerHTML = finalView();
  else $main.innerHTML = ui.screen === 'trade' && ui.sel ? tradeView() : stocksView();
  renderOverlay();
  if (hadSearch) { const el = $('#search'); if (el) { el.focus(); el.setSelectionRange(caret, caret); } }
  if (hadAmt) { const el = $('#amt'); if (el) el.focus(); }
}

function renderTop() {
  if (!S || S.status !== 'running') { $top.innerHTML = ''; return; }
  const open = S.phase === 'trading';
  const status = open ? ['open', S.paused ? 'Trading Open (clock paused)' : 'Trading Open'] : S.paused ? ['paused', 'Paused'] : ['closed', 'Trading Closed'];
  $top.innerHTML = `<div class="top"><div class="top-in">
    <div class="row"><span class="brand">ELVA<b>STOCKS</b></span><span class="muted" style="font-weight:700">${esc(S.round)}/${S.totalRounds} · ${esc(PHASE_LABEL[S.phase])}</span><span class="clock num" id="clock"></span></div>
    <div class="row" style="margin-top:6px"><span class="chip ${status[0]}">${status[1]}</span><span class="grow"></span><button class="btn ghost sm" data-act="sound" aria-label="Toggle sound">${fx.on ? '🔊' : '🔇'}</button></div>
    <div class="stats"><div class="stat"><small>Cash</small><span class="num">${eur(S.me.cash)}</span></div><div class="stat"><small>Total wealth</small><span class="num">${eur(S.me.wealth)}</span></div></div>
    <div class="bar"><i id="bar"></i></div></div></div>`;
}

function joinView() {
  const p = new URLSearchParams(location.search);
  return `<div class="hero"><h1>ELVA<b>STOCKS</b></h1><p class="muted">Join a game with the room code from your host.</p></div>
  <form class="card" id="joinForm" autocomplete="off">
    <label class="f" for="code">Room code</label><input id="code" class="code-in" maxlength="6" inputmode="text" autocapitalize="characters" value="${esc((p.get('code') || '').toUpperCase())}" placeholder="ABC123">
    <label class="f" for="name">Your name</label><input id="name" maxlength="16" placeholder="e.g. Maria">
    <label class="f">Avatar colour</label><div class="swatches">${AVATARS.map((c) => `<button type="button" class="sw ${c === ui.avatar ? 'sel' : ''}" data-act="avatar" data-v="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
    ${ui.joinErr ? `<p class="down" role="alert">${esc(ui.joinErr)}</p>` : ''}
    <button class="btn green" style="width:100%;margin-top:18px">Join Game</button>
  </form>
  <p class="muted" style="text-align:center">Hosting? <a href="host.html">Create a game</a></p>`;
}

function lobbyView() {
  return `<div class="hero"><h1>You're in!</h1><p class="muted">Room <b>${esc(S.code)}</b> · waiting for the host to set budgets and start the game.</p></div>
  <div class="card"><h3>Players (${S.players.length}/6)</h3>${S.players.map((p) => `<div class="lb"><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><b>${esc(p.name)}</b>${p.id === S.me.id ? '<span class="chip">You</span>' : ''}</div>`).join('')}</div>
  <div class="card" style="margin-top:12px"><h3>How it works</h3><p class="muted">Each round: read the news (60s), trade (60s), then watch the market react. Prices are frozen while you trade. Profits are taxed when you sell: 28%, or 20% if held 4+ rounds. Highest wealth after round 12 wins.</p></div>`;
}

// ---------- Screen 1: stock market
function openingCard() {
  const o = S.opening;
  if (!o || S.round !== 1 || !['news', 'trading'].includes(S.phase)) return '';
  const byId = Object.fromEntries(S.stocks.map((x) => [x.id, x]));
  const moves = o.moves.slice().sort((a, b) => b.pct - a.pct);
  const row = (m) => `<div class="move">${logo(byId[m.id], 30)}<div class="grow"><b>${esc(byId[m.id].name)}</b> <span class="num ${cls(m.pct)}">${pct(m.pct)}</span>${m.why ? `<div class="muted" style="font-size:12px">${esc(m.why)}</div>` : ''}</div></div>`;
  return `<div class="card pop" style="border-left:4px solid var(--gold)"><span class="tag fict">CENÁRIO INICIAL · FICTÍCIO</span><h3>${esc(o.headline)}</h3><p class="muted" style="font-size:13px">${esc(o.rule)}</p>
    <details ${S.phase === 'news' ? 'open' : ''}><summary>Como as ações reagiram antes do jogo</summary>${moves.map(row).join('')}</details></div>`;
}
function newsCard() {
  const n = S.news; if (!n) return '';
  const full = S.phase === 'news';
  const real = n.real ? `<div class="card" style="margin-top:10px;background:var(--bg)"><span class="tag">REAL-WORLD COVERAGE</span><p style="margin:6px 0 2px"><b>${esc(n.real.headline)}</b></p><span class="muted" style="font-size:12px">${esc(n.real.publisher)} · ${n.real.publishedAt ? esc(new Date(n.real.publishedAt).toLocaleDateString()) : ''} · <a href="${esc(n.real.url)}" target="_blank" rel="noopener noreferrer">source</a></span></div>` : '';
  return `<div class="card news pop"><span class="tag fict">PRACTICE SCENARIO · FICTIONAL</span> <span class="tag">Round ${n.round}</span>
    <h3>${esc(n.headline)}</h3>
    ${full ? `<p>${(n.extras && n.extras.length ? n.extras : [n.summary]).map((x) => esc(x)).join("<br>")}</p><p class="muted" style="font-size:13px">Learn: ${esc(n.teaches)}</p><p class="muted" style="font-size:13px">Stocks in the spotlight: ${n.relevant.slice(0, 8).map((id) => esc(id)).join(', ')}${n.relevant.length > 8 ? '…' : ''}</p>${real}`
      : `<p class="muted" style="font-size:13px;margin:0">${esc(n.title)}</p>`}</div>`;
}

function reactionCard() {
  const r = S.lastSettlement;
  if (!r || S.phase !== 'reaction') return '';
  const byId = Object.fromEntries(S.stocks.map((s) => [s.id, s]));
  const moves = [...r.moves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const lines = moves.filter((m) => m.why).slice(0, 8);
  const mine = S.me.powerup?.result && S.me.powerup.result.round === r.round ? S.me.powerup.result : null;
  return `<div class="card pop"><span class="tag">MARKET REACTION · SIMULATED</span><h3 style="margin:6px 0">${esc(r.title)}</h3>
    <p class="muted" style="font-size:13px">${esc(r.teaches)}${r.reversed ? ' Desta vez o mercado ignorou a manchete: a notícia já estava refletida no preço.' : ''}</p>
    ${S.myPayout ? `<div class="cd" style="margin-bottom:8px">${esc(POWERUP_INFO[S.me.powerup.type].icon)} Your ${esc(POWERUP_INFO[S.me.powerup.type].name)} paid ${eur(S.myPayout)}</div>` : mine ? `<div class="cd" style="margin-bottom:8px">Your power-up paid €0 this round</div>` : ''}
    ${lines.map((m) => `<div class="move">${logo(byId[m.id], 34)}<div class="grow"><b>${esc(byId[m.id].name)}</b> <span class="num ${cls(m.pct)}">${pct(m.pct)}</span><div class="muted" style="font-size:13px">${esc(m.why)}</div></div></div>`).join('')}
  </div>
  <div class="card" style="margin-top:12px"><h3>Leaderboard</h3>${S.leaderboard.map((p) => `<div class="lb"><span class="rk">${p.rank}</span><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><b class="grow">${esc(p.name)}${p.id === S.me.id ? ' (you)' : ''}</b><span class="num">${eur0(p.wealth)}</span><span class="num ${cls(p.ret)}" style="width:68px;text-align:right">${pct(p.ret, 1)}</span></div>`).join('')}</div>`;
}

function powerupCard() {
  const pu = S.me.powerup; if (!pu) return '';
  const info = POWERUP_INFO[pu.type];
  if (pu.status === 'used' && pu.type === 'oracle' && pu.result && pu.result.round === S.round && S.phase !== 'reaction') {
    const s = S.stocks.find((x) => x.id === pu.result.stockId);
    const d = pu.result.direction;
    return `<div class="pu pop" style="--c:${info.color}"><span class="ic">${info.icon}</span> <b>The Oracle says:</b> <b>${esc(s.name)}</b> will be <b class="${d === 'UP' ? 'up' : d === 'DOWN' ? 'down' : 'gold'}">${esc(d)}</b> this round.<div class="muted" style="font-size:12px">Only you can see this. Exact size unknown.</div></div>`;
  }
  if (pu.status === 'active' && pu.round === S.round && S.phase !== 'reaction') {
    return `<div class="pu" style="--c:${info.color}"><span class="ic">${info.icon}</span> <b>${esc(info.name)} is armed</b> for this round${pu.stockId ? ` on <b>${esc(S.stocks.find((x) => x.id === pu.stockId).name)}</b>` : ''}.</div>`;
  }
  if (pu.status === 'owned' && S.phase === 'news' && S.round > S.shopAfter) {
    const needs = pu.type !== 'shield';
    return `<div class="pu" style="--c:${info.color}"><div class="row"><span class="ic">${info.icon}</span><div class="grow"><b>${esc(info.name)}</b><div class="muted" style="font-size:13px">${esc(info.desc)}</div></div></div>
      ${needs ? `<select id="puStock" style="margin-top:10px"><option value="">Choose a stock…</option>${S.stocks.map((s) => `<option value="${esc(s.id)}" ${ui.puStock === s.id ? 'selected' : ''}>${esc(s.name)} (${esc(s.ticker)})</option>`).join('')}</select>` : ''}
      <button class="btn gold" style="width:100%;margin-top:10px" data-act="activate">Activate now (one use)</button></div>`;
  }
  return '';
}

function stocksView() {
  let list = S.stocks.slice();
  const q = ui.q.trim().toLowerCase();
  if (q) list = list.filter((s) => s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q));
  if (ui.filter === 'news') list = list.filter((s) => s.relevant);
  if (ui.filter === 'mine') list = list.filter((s) => s.owned > 0);
  list.sort((a, b) => (b.relevant - a.relevant) || 0); // news-affected first, otherwise keep list order
  const canTrade = S.phase === 'trading';
  const dock = S.phase === 'trading'
    ? `<div class="dock">${S.me.ready ? `<button class="btn ghost" data-act="unready">✓ Ready · Edit my trades</button>` : `<button class="btn green" data-act="ready">I'm Ready</button>`}${S.countdownMs != null ? `<div class="cd" style="margin-top:8px">Everyone is ready: closing trading in ${Math.ceil(S.countdownMs / 1000)}s</div>` : ''}</div>` : '';
  return `<div class="stack">
    ${openingCard()}${newsCard()}${powerupCard()}${reactionCard()}
    ${S.phase === 'trading' && !S.me.ready ? '' : ''}
    <input id="search" type="search" placeholder="Search companies or tickers" value="${esc(ui.q)}" aria-label="Search stocks">
    <div class="chips">${[['all', 'All Stocks'], ['news', 'News-Affected'], ['mine', 'My Holdings']].map(([k, l]) => `<button class="fchip ${ui.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>
    ${list.map((s) => `<button class="stock ${s.relevant ? 'rel' : ''}" data-act="open" data-id="${esc(s.id)}" ${''}>
      ${logo(s)}<div class="grow"><div class="nm">${esc(s.name)}${s.owned > 0 ? `<span class="own">${qtyFmt(s.owned)}</span>` : ''}</div><div class="sub">${esc(s.ticker)}<span class="vol ${s.vol}">${esc(s.vol.toUpperCase())}</span></div></div>
      <div class="px"><div class="num">${eur(s.price)}</div><div class="num ${cls(s.change)}" style="font-size:13px">${S.settled ? pct(s.change) : '—'}</div></div></button>`).join('') || '<p class="muted">No stocks match.</p>'}
    <p class="muted" style="font-size:11px;text-align:center">Prices are simulated reference values in virtual euros (demo data). Logos belong to their owners.</p>
  </div>${dock}${canTrade ? '' : ''}`;
}

// ---------- Screen 2: trading
function tradeView() {
  const s = S.stocks.find((x) => x.id === ui.sel);
  const open = S.phase === 'trading' && !S.me.ready;
  const buy = ui.side === 'buy';
  const amtC = Math.round(parseFloat(ui.amount || '0') * 100) || 0;
  const quickBuy = [500, 1000, 5000, 10000].map((e) => `<button data-act="quick" data-v="${e}">€${e.toLocaleString('en-IE')}</button>`).join('') + `<button data-act="quickmax">Máx</button>`;
  const quickSell = [25, 50, 75].map((p) => `<button data-act="quickpct" data-v="${p}">${p}%</button>`).join('') + `<button data-act="quickmax">Tudo</button>`;
  const q = ui.quote;
  let detail = '';
  if (buy) {
    if (amtC > 0) detail = `Vais comprar ≈ <b class="num">${qtyFmt(Math.floor((amtC * 1e6) / s.price))}</b> ações · ficas com <b class="num">${eur(S.me.cash - amtC)}</b>`;
  } else if (q && q.ok) {
    detail = `Recebes <b class="num up">${eur(q.net)}</b> (imposto ${eur(q.tax)})`;
  } else if (q && !q.ok && amtC > 0) detail = `<span class="down">${esc(q.error)}</span>`;
  return `<div class="stack">
    <button class="btn ghost sm" data-act="back" style="justify-self:start">← Voltar</button>
    <div class="card row">${logo(s, 48)}<div class="grow"><h2 style="font-size:20px">${esc(s.name)}</h2><span class="muted">${esc(s.ticker)}</span></div><div style="text-align:right"><div class="num" style="font-size:20px">${eur(s.price)}</div><div class="num ${cls(s.change)}">${pct(s.change)}</div></div></div>
    <div class="card" style="padding:10px 8px">${priceChart(s.history || [])}</div>
    <div class="stats" style="margin:0"><div class="stat"><small>Dinheiro disponível</small><span class="num">${eur(S.me.cash)}</span></div><div class="stat"><small>Tens desta ação</small><span class="num">${qtyFmt(s.owned)}</span><div class="muted" style="font-size:12px">${eur(s.ownedValue)}</div></div></div>
    ${open ? '' : `<div class="cd">${S.me.ready ? 'Estás Pronto. Toca em "Editar" na lista para negociar.' : 'A negociação está fechada: só podes ver.'}</div>`}
    <div class="seg" role="tablist"><button class="${buy ? 'on buy' : ''}" data-act="side" data-v="buy">COMPRAR</button><button class="${!buy ? 'on sell' : ''}" data-act="side" data-v="sell">VENDER</button></div>
    <div class="card"><label class="f" for="amt" style="margin-top:0">Quanto dinheiro (€)</label><input id="amt" class="amt" inputmode="decimal" placeholder="0.00" value="${esc(ui.amount)}"><div class="quick">${buy ? quickBuy : quickSell}</div>${detail ? `<p class="muted" style="margin:12px 0 0;text-align:center">${detail}</p>` : ''}</div>
    <button class="btn ${buy ? 'green' : 'red'}" data-act="confirm" ${open && amtC > 0 && !ui.busy && (buy || (q && q.ok)) ? '' : 'disabled'}>${buy ? 'Comprar' : 'Vender'}${amtC > 0 ? ' · ' + eur(amtC) : ''}</button>
  </div>`;
}

// ---------- final results
function finalView() {
  const R = S.results, me = R.players.find((p) => p.id === S.me.id), c = R.champion;
  const colors = ['#2BD99F', '#4F8EFF', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8'];
  const byId = Object.fromEntries(S.stocks.map((s) => [s.id, s]));
  const pu = (p) => (p.powerup ? `${POWERUP_INFO[p.powerup.type].icon} ${POWERUP_INFO[p.powerup.type].name}${p.powerup.result ? ' · paid ' + eur0(p.powerup.result.payout ?? 0) + (p.powerup.result.direction ? ' (' + p.powerup.result.direction + ')' : '') : ' · unused'}` : 'No power-up');
  return `<div class="stack">
    <div class="card champ pop"><div class="trophy">🏆</div><div class="muted">ELVASTOCKS CHAMPION</div><h1 style="font-size:30px;margin:6px 0">${esc(c.name)}</h1><div class="num gold" style="font-size:24px">${eur(c.wealth)}</div><div class="${cls(c.ret)} num">${pct(c.ret)} · started with ${eur0(c.start)}</div></div>
    ${R.awards?.bestReturn ? `<div class="card" style="text-align:center">📈 Best return: <b>${esc(R.awards.bestReturn.name)}</b> <span class="up num">${pct(R.awards.bestReturn.ret, 1)}</span><div class="muted" style="font-size:12px">Starting budgets differ, so % return is the fairest skill measure.</div></div>` : ''}
    <div class="card"><h3>You finished #${me.rank}</h3><p class="muted">${esc(me.profile.name)}: ${esc(me.profile.why)}</p>
      <div class="kv"><span>Final wealth</span><b class="num">${eur(me.wealth)}</b></div><div class="kv"><span>Net gain/loss</span><b class="num ${cls(me.gain)}">${eur(me.gain)}</b></div><div class="kv"><span>Taxes paid</span><b class="num">${eur(me.tax)}</b></div>
      ${me.best ? `<div class="kv"><span>Best investment</span><b>${esc(me.best.name)} ${eur0(me.best.pnl)}</b></div>` : ''}${me.worst ? `<div class="kv"><span>Worst investment</span><b>${esc(me.worst.name)} ${eur0(me.worst.pnl)}</b></div>` : ''}
      <div class="kv"><span>Power-up</span><b>${pu(me)}</b></div>
      <div class="kv"><span>Reduced 20% tax</span><b>${me.patience.reducedRateSales ? `used ${me.patience.reducedRateSales}×, saved ${eur0(me.patience.taxSaved)}` : 'not used'}</b></div></div>
    <div class="card"><h3>Leaderboard</h3>${R.players.map((p) => `<details class="lb" style="display:block"><summary class="row"><span class="rk">${p.rank}</span><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><b class="grow">${esc(p.name)}</b><span class="num">${eur0(p.wealth)}</span></summary>
      <div style="padding:8px 0 4px 32px;font-size:13px" class="muted">${esc(p.profile.name)} · ${pct(p.ret, 1)} · tax ${eur0(p.tax)}<br>${pu(p)}<br>${p.holdings.length ? 'Holds: ' + p.holdings.map((h) => esc(byId[h.id].ticker) + ' ' + eur0(h.value)).join(', ') : 'Holds only cash'}</div></details>`).join('')}</div>
    <div class="card"><h3>Wealth by round</h3>${lineChart(R.players.map((p, i) => ({ name: p.name, color: colors[i % 6], points: p.history })), { w: 420, h: 240 })}</div>
    <div class="card"><h3>What moved the market</h3>${R.events.map((e) => `<div class="move"><b style="width:26px">${e.round}</b><div class="grow"><b>${esc(e.title)}</b>${e.reversed ? ' <span class="tag">priced-in reversal</span>' : ''}<div class="muted" style="font-size:13px">${e.top.map((m) => `${esc(byId[m.id].ticker)} <span class="${cls(m.pct)}">${pct(m.pct, 1)}</span>`).join(' · ')}</div><div class="muted" style="font-size:12px">${esc(e.teaches)}</div></div></div>`).join('')}</div>
    <p class="muted" style="font-size:12px">${esc(R.tiebreak)} Simulated market (seed ${esc(R.seed)}); capital gains tax rules are in-game mechanics, not tax advice.</p>
    ${S.nextCode ? `<button class="btn green" data-act="again">Join next game (${esc(S.nextCode)})</button>` : `<p class="muted" style="text-align:center">Ask the host to press “Play again”.</p>`}
  </div>`;
}

// ---------- shop overlay
function renderOverlay() {
  if (!S || S.phase !== 'shop') { $ov.innerHTML = ''; return; }
  const owned = S.me.powerup;
  $ov.innerHTML = `<div class="modal"><div class="sheet"><h2>⚡ Power-Up Shop</h2><p class="muted">Closes in <b id="clock2"></b>. Buy at most one for ${eur0(S.powerupCost)}. Activate it once in Rounds 7-12, during the news phase. No refunds.</p>
    <div class="stack">${Object.entries(POWERUP_INFO).map(([k, i]) => {
    const can = !owned && S.me.cash >= S.powerupCost;
    const armed = ui.confirmPU === k;
    return `<div class="pu" style="--c:${i.color}"><div class="row"><span class="ic">${i.icon}</span><div class="grow"><b style="font-size:18px">${esc(i.name)}</b><div class="gold num">${eur0(S.powerupCost)}</div></div></div><p class="muted" style="font-size:14px">${esc(i.desc)}</p>
      <button class="btn ${armed ? 'gold' : ''}" style="width:100%" data-act="buypu" data-v="${k}" ${can ? '' : 'disabled'}>${owned?.type === k ? '✓ Owned' : armed ? 'Tap again to confirm' : owned ? 'Already bought one' : can ? 'Buy' : 'Not enough cash'}</button></div>`;
  }).join('')}</div>
    <button class="btn ghost" style="width:100%;margin-top:14px" data-act="closeshop">${owned ? 'Done' : 'No thanks'}</button></div></div>`;
  tickShop();
}
function tickShop() { const c = $('#clock2'); if (c && S) c.textContent = fmtClock(S.paused ? S.remainingMs : Math.max(0, clockAt - performance.now())); }
setInterval(tickShop, 500);

// ------------------------------------------------------------ actions
async function act(body, okMsg) {
  try {
    const r = await api(`/api/games/${session.code}/player`, { method: 'POST', body, token: session.token });
    if (okMsg) toast(okMsg, 'ok');
    await poll();
    return r;
  } catch (e) { toast(e.message, 'err'); fx.beep(200, 150, 80); await poll(); return null; }
}
let qTimer;
function requote() {
  clearTimeout(qTimer);
  const c = Math.round(parseFloat(ui.amount || '0') * 100);
  if (ui.side !== 'sell' || !(c > 0)) { ui.quote = null; return; }
  qTimer = setTimeout(async () => {
    try { const r = await api(`/api/games/${session.code}/player`, { method: 'POST', token: session.token, body: { action: 'quote', stockId: ui.sel, side: 'sell', amount: c } }); ui.quote = r.quote; }
    catch (e) { ui.quote = { ok: false, error: e.message }; }
    render();
  }, 200);
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, v = el.dataset.v;
  const stock = () => S.stocks.find((s) => s.id === ui.sel);
  switch (a) {
    case 'avatar': ui.avatar = v; render(); break;
    case 'sound': fx.toggle(); fx.beep(); render(); break;
    case 'filter': ui.filter = v; render(); break;
    case 'open': ui.sel = el.dataset.id; ui.screen = 'trade'; ui.amount = ''; ui.quote = null; render(); window.scrollTo(0, 0); break;
    case 'back': ui.screen = 'stocks'; render(); break;
    case 'side': ui.side = v; ui.amount = ''; ui.quote = null; render(); break;
    case 'quick': ui.amount = String(Math.min(Number(v), S.me.cash / 100)); render(); break;
    case 'quickmax': ui.amount = ui.side === 'buy' ? (S.me.cash / 100).toFixed(2) : (stock().ownedValue / 100).toFixed(2); requote(); render(); break;
    case 'quickpct': ui.amount = ((stock().ownedValue * Number(v)) / 10000).toFixed(2); requote(); render(); break;
    case 'ready': fx.beep(700, 80, 40); await act({ action: 'ready' }, "You're ready"); break;
    case 'unready': await act({ action: 'unready' }, 'Trading unlocked'); break;
    case 'confirm': {
      if (ui.busy) return; ui.busy = true; render();
      const s = stock(); const c = Math.round(parseFloat(ui.amount) * 100);
      const r = await act({ action: 'trade', stockId: ui.sel, side: ui.side, amount: c, requestId: uid() }).catch(() => null);
      ui.busy = false;
      if (r?.trade) {
        fx.beep(760, 90, 30);
        toast(ui.side === 'buy' ? `Bought ${qtyFmt(r.trade.qty)} ${s.ticker} for ${eur(c)}` : `Sold ${s.ticker}: net ${eur(r.trade.net)} (tax ${eur(r.trade.tax)})`, 'ok');
        ui.amount = ''; ui.quote = null;
      }
      render(); break;
    }
    case 'activate': {
      const sel = $('#puStock'); const needs = S.me.powerup.type !== 'shield';
      if (needs && !(sel && sel.value)) { toast('Choose a stock first', 'err'); return; }
      const r = await act({ action: 'activatePowerup', stockId: sel?.value }, 'Power-up activated!');
      if (r) fx.beep(980, 250, 120);
      break;
    }
    case 'buypu':
      if (ui.confirmPU === v) { ui.confirmPU = null; const r = await act({ action: 'buyPowerup', type: v }, 'Power-up purchased'); if (r) fx.beep(900, 200, 100); }
      else { ui.confirmPU = v; render(); }
      break;
    case 'closeshop': $ov.innerHTML = ''; break;
    case 'again': {
      const r = await api(`/api/games/${S.nextCode}/join`, { method: 'POST', body: { name: S.me.name, avatar: S.me.avatar } }).catch((er) => { toast(er.message, 'err'); return null; });
      if (r) { session = { code: S.nextCode, token: r.token, playerId: r.playerId }; save(session); S = null; sig = ''; ui.screen = 'stocks'; await poll(); }
      break;
    }
    default:
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { ui.q = e.target.value; render(); }
  if (e.target.id === 'amt') { ui.amount = e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''); e.target.value = ui.amount; requote(); render(); }
  if (e.target.id === 'code') e.target.value = e.target.value.toUpperCase();
});
document.addEventListener('change', (e) => { if (e.target.id === 'puStock') ui.puStock = e.target.value; });
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'joinForm') return;
  e.preventDefault();
  const code = $('#code').value.trim().toUpperCase(), name = $('#name').value.trim();
  try {
    const r = await api(`/api/games/${code}/join`, { method: 'POST', body: { name, avatar: ui.avatar } });
    session = { code, token: r.token, playerId: r.playerId }; save(session); ui.joinErr = ''; sig = '';
    await poll();
  } catch (er) { ui.joinErr = er.message; render(); }
});

render();
poll();
