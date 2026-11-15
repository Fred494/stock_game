import { api, esc, $, eur, eur0, pct, qtyFmt, cls, logo, toast, fx, POWERUP_INFO, lineChart, priceChart, fmtClock, PHASE_LABEL } from './common.js';

const AVATARS = ['#4F8EFF', '#2BD99F', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8', '#FB923C', '#F472B6'];
const KEY = 'mm-session';
const DIR_PT = { UP: 'SUBIR', DOWN: 'DESCER', FLAT: 'ficar IGUAL' };
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
  if (to === 'trading') { fx.beep(880, 160, 60); toast('A negociação abriu!'); }
  if (to === 'reaction') { fx.beep(520, 200, 120); ui.screen = 'stocks'; ui.sel = null; }
  if (to === 'news') { ui.screen = 'stocks'; ui.sel = null; }
  if (to === 'finished') fx.beep(990, 400, 200);
}
setInterval(poll, 1000);
setInterval(() => {
  if (!S) return;
  const left = S.paused ? S.remainingMs : Math.max(0, clockAt - performance.now());
  const c = $('#clock'); if (c) c.textContent = !S.timed || S.phase === 'finished' || S.phase === 'lobby' ? '' : fmtClock(left);
  const b = $('#bar'); if (b) b.style.width = `${S.timed && S.totalMs ? 100 * (1 - left / clockTotal) : 0}%`;
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
  else if (S.intro) $main.innerHTML = introView();
  else $main.innerHTML = ui.screen === 'trade' && ui.sel ? tradeView() : stocksView();
  renderOverlay();
  if (hadSearch) { const el = $('#search'); if (el) { el.focus(); el.setSelectionRange(caret, caret); } }
  if (hadAmt) { const el = $('#amt'); if (el) el.focus(); }
}

function renderTop() {
  if (!S || S.status !== 'running') { $top.innerHTML = ''; return; }
  const open = S.phase === 'trading';
  const status = open ? ['open', S.paused ? 'Negociação aberta (relógio parado)' : 'Negociação aberta'] : S.paused ? ['paused', 'Em pausa'] : S.phase === 'news' ? ['closed', 'Lê a notícia · negociação ainda fechada'] : S.phase === 'reaction' ? ['closed', 'Reação do mercado'] : S.phase === 'shop' ? ['closed', 'Loja de power-ups'] : ['closed', 'Negociação fechada'];
  $top.innerHTML = `<div class="top"><div class="top-in">
    <div class="row"><span class="brand">ELVA<b>STOCKS</b></span><span class="muted" style="font-weight:700">${esc(S.round)}/${S.totalRounds} · ${esc(PHASE_LABEL[S.phase])}</span><span class="clock num" id="clock"></span></div>
    <div class="row" style="margin-top:6px"><span class="chip ${status[0]}">${status[1]}</span><span class="grow"></span><button class="btn ghost sm" data-act="sound" aria-label="Ligar ou desligar o som">${fx.on ? '🔊' : '🔇'}</button></div>
    <div class="stats"><div class="stat"><small>Dinheiro</small><span class="num">${eur(S.me.cash)}</span></div><div class="stat"><small>Riqueza total</small><span class="num">${eur(S.me.wealth)}</span></div></div>
    <div class="bar"><i id="bar"></i></div></div></div>`;
}

function joinView() {
  const p = new URLSearchParams(location.search);
  return `<div class="hero"><h1>ELVA<b>STOCKS</b></h1><p class="muted">Entra num jogo com o código da sala do anfitrião.</p></div>
  <form class="card" id="joinForm" autocomplete="off">
    <label class="f" for="code">Código da sala</label><input id="code" class="code-in" maxlength="6" inputmode="text" autocapitalize="characters" value="${esc((p.get('code') || '').toUpperCase())}" placeholder="ABC123">
    <label class="f" for="name">O teu nome</label><input id="name" maxlength="16" placeholder="ex.: Maria">
    <label class="f">Cor do avatar</label><div class="swatches">${AVATARS.map((c) => `<button type="button" class="sw ${c === ui.avatar ? 'sel' : ''}" data-act="avatar" data-v="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}</div>
    ${ui.joinErr ? `<p class="down" role="alert">${esc(ui.joinErr)}</p>` : ''}
    <button class="btn green" style="width:100%;margin-top:18px">Entrar no jogo</button>
  </form>
  <p class="muted" style="text-align:center">Queres ser anfitrião? <a href="host.html">Criar um jogo</a></p>`;
}

function introView() {
  return `<div class="stack"><div class="hero"><h1>ELVA<b>STOCKS</b></h1><p class="muted">Resumo rápido do jogo</p></div>
  <div class="card"><ul style="line-height:1.7;margin:0;padding-left:20px">
    <li><b>Objetivo:</b> acabar com mais dinheiro (riqueza) depois de 12 rondas.</li>
    <li><b>Cada ronda tem 3 fases:</b> ① ver a notícia, ② comprar e vender ações, ③ ver como o mercado reagiu.</li>
    <li><b>Imposto:</b> 28% sobre os lucros ao vender (20% se mantiveres a ação 4 ou mais rondas). Perdas não pagam imposto.</li>
    <li><b>Depois da ronda 6:</b> loja de power-ups (um por jogador).</li>
    <li><b>Sem tempo:</b> o anfitrião inicia cada fase.</li></ul></div>
  <p class="muted" style="text-align:center">À espera que o anfitrião comece a ronda 1…</p></div>`;
}

function lobbyView() {
  return `<div class="hero"><h1>Estás dentro!</h1><p class="muted">Sala <b>${esc(S.code)}</b> · à espera que o anfitrião defina os orçamentos e comece o jogo.</p></div>
  <div class="card"><h3>Jogadores (${S.players.length}/8)</h3>${S.players.map((p) => `<div class="lb"><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><b>${esc(p.name)}</b>${p.id === S.me.id ? '<span class="chip">Tu</span>' : ''}</div>`).join('')}</div>
  <div class="card" style="margin-top:12px"><h3>Como funciona</h3><p class="muted">Em cada ronda: lê a notícia, negoceia e vê o mercado reagir. O anfitrião inicia cada fase. Os preços ficam parados enquanto negoceias. Os lucros pagam imposto quando vendes: 28%, ou 20% se mantiveres 4 ou mais rondas. Ganha quem tiver mais riqueza depois da ronda 12.</p></div>`;
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
  const full = S.phase === 'news' || S.phase === 'trading';
  const real = n.real ? `<div class="card" style="margin-top:10px;background:var(--bg)"><span class="tag">NOTÍCIA REAL</span><p style="margin:6px 0 2px"><b>${esc(n.real.headline)}</b></p><span class="muted" style="font-size:12px">${esc(n.real.publisher)} · ${n.real.publishedAt ? esc(new Date(n.real.publishedAt).toLocaleDateString()) : ''} · <a href="${esc(n.real.url)}" target="_blank" rel="noopener noreferrer">fonte</a></span></div>` : '';
  return `<div class="card news pop"><span class="tag fict">CENÁRIO DE PRÁTICA · FICTÍCIO</span> <span class="tag">Ronda ${n.round}</span>
    <h3>${esc(n.headline)}</h3>
    ${full ? `<ul class="newsl">${(n.extras && n.extras.length ? n.extras : [n.summary]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted" style="font-size:14px;margin:8px 0 0">💡 <b>Aprende:</b> ${esc(n.teaches)}</p>${real}`
      : `<p class="muted" style="font-size:13px;margin:0">${esc(n.title)}</p>`}</div>`;
}

// ---------- quiz (rounds 3 and 9)
function quizCard() {
  const z = S.quiz; if (!z) return '';
  const done = z.answered != null;
  const right = done && z.answered === z.correct;
  return `<div class="card pop quiz"><span class="tag">🎓 PERGUNTA DA RONDA ${z.round}</span><h3 style="margin:8px 0 10px">${esc(z.question)}</h3>
    ${z.options.map((o, i) => `<button class="qopt ${done ? (i === z.correct ? 'ok' : i === z.answered ? 'bad' : 'dim') : ''}" data-act="quiz" data-v="${i}" ${done ? 'disabled' : ''}><b>${'ABCD'[i]}</b><span>${esc(o)}</span></button>`).join('')}
    ${done ? `<div class="qres ${right ? 'ok' : 'bad'}"><b>${right ? '✅ Certo!' : '❌ Não foi desta.'}</b> ${esc(z.why)}</div>` : '<p class="muted" style="font-size:12px;margin:8px 0 0">Só podes responder uma vez. Não afeta o teu dinheiro: é para aprenderes.</p>'}</div>`;
}

// ---------- my portfolio
function holdInfo(s) {
  const cost = (s.lots || []).reduce((a, l) => a + l.cost, 0);
  const pnl = s.ownedValue - cost;
  return { cost, value: s.ownedValue, pnl, ret: cost > 0 ? pnl / cost : 0 };
}
function portfolio() {
  const rows = S.stocks.filter((s) => s.owned > 0).map((s) => ({ s, ...holdInfo(s) }));
  const invested = rows.reduce((a, r) => a + r.value, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  rows.forEach((r) => { r.share = invested > 0 ? r.value / invested : 0; });
  rows.sort((a, b) => b.value - a.value);
  return { rows, invested, cost, pnl: invested - cost, ret: cost > 0 ? (invested - cost) / cost : 0 };
}
const PAL = ['#4F8EFF', '#2BD99F', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8', '#FB923C', '#F472B6', '#34D399', '#FBBF24'];
function portfolioCard() {
  const P = portfolio();
  if (!P.rows.length) return '<div class="card"><p class="muted" style="margin:0">Ainda não tens ações. Toca numa empresa para comprar.</p></div>';
  const wealth = S.me.wealth || 1;
  return `<div class="card"><h3 style="margin:0 0 8px">A tua carteira</h3>
    <div class="kv"><span>Investido em ações</span><b class="num">${eur(P.invested)} <span class="muted">(${Math.round((100 * P.invested) / wealth)}% da riqueza)</span></b></div>
    <div class="kv"><span>Ganho / perda desde a compra</span><b class="num ${cls(P.pnl)}">${eur(P.pnl)} · ${pct(P.ret, 1)}</b></div>
    <div class="alloc">${P.rows.map((r, i) => `<i style="width:${(100 * r.share).toFixed(1)}%;background:${PAL[i % PAL.length]}"></i>`).join('')}</div>
    ${P.rows.map((r, i) => `<div class="kv"><span><i class="dot" style="background:${PAL[i % PAL.length]}"></i>${esc(r.s.name)}</span><b class="num">${Math.round(100 * r.share)}% <span class="${cls(r.ret)}" style="font-size:13px">${pct(r.ret, 1)}</span></b></div>`).join('')}</div>`;
}

function reactionCard() {
  const r = S.lastSettlement;
  if (!r || S.phase !== 'reaction') return '';
  const byId = Object.fromEntries(S.stocks.map((s) => [s.id, s]));
  const moves = [...r.moves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const lines = moves.filter((m) => m.why).slice(0, 8);
  const mine = S.me.powerup?.result && S.me.powerup.result.round === r.round ? S.me.powerup.result : null;
  const mr = S.myRound;
  const money = (c) => `<b class="num ${cls(c)}">${c > 0 ? '+' : c < 0 ? '−' : ''}${eur0(Math.abs(c))}</b>`;
  const recap = mr ? `<div class="card pop" style="border-left:4px solid var(--green)"><h3 style="margin:0 0 6px">O teu resumo da ronda</h3>
    ${mr.rows.length ? mr.rows.map((x) => `<div class="kv"><span>${x.pnl >= 0 ? 'Ganhaste' : 'Perdeste'} com <b>${esc(byId[x.id].name)}</b> <span class="muted">(${pct(x.pct, 1)})</span></span>${money(x.pnl)}</div>`).join('') : '<p class="muted" style="margin:4px 0">Não tinhas ações nesta ronda: o teu dinheiro ficou parado.</p>'}
    ${mr.payout ? `<div class="kv"><span>Bónus do power-up</span>${money(mr.payout)}</div>` : ''}
    <div class="kv"><span><b>Total da ronda</b></span>${money(mr.total + mr.payout)}</div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">${mr.rows.length && mr.rows[0].pnl > 0 ? `A tua melhor decisão: ${esc(byId[mr.rows[0].id].name)}.` : ''}${mr.rows.length && mr.rows[mr.rows.length - 1].pnl < 0 ? ` A pior: ${esc(byId[mr.rows[mr.rows.length - 1].id].name)}.` : ''}</p></div>` : '';
  return `${recap}<div class="card pop" style="margin-top:12px"><span class="tag">REAÇÃO DO MERCADO · SIMULADA</span><h3 style="margin:6px 0">${esc(r.title)}</h3>
    <p class="muted" style="font-size:13px">${esc(r.teaches)}${r.reversed ? ' Desta vez o mercado ignorou a manchete: a notícia já estava refletida no preço.' : ''}</p>
    ${S.myPayout ? `<div class="cd" style="margin-bottom:8px">${esc(POWERUP_INFO[S.me.powerup.type].icon)} O teu ${esc(POWERUP_INFO[S.me.powerup.type].name)} pagou ${eur(S.myPayout)}</div>` : mine ? `<div class="cd" style="margin-bottom:8px">O teu power-up pagou €0 nesta ronda</div>` : ''}
    ${lines.map((m) => `<div class="move">${logo(byId[m.id], 34)}<div class="grow"><b>${esc(byId[m.id].name)}</b> <span class="num ${cls(m.pct)}">${pct(m.pct)}</span><div class="muted" style="font-size:13px">${esc(m.why)}</div></div></div>`).join('')}
  </div>
  <div class="card" style="margin-top:12px"><h3>Classificação</h3>${S.leaderboard.map((p) => `<div class="lb"><span class="rk">${p.rank}</span><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><b class="grow">${esc(p.name)}${p.id === S.me.id ? ' (tu)' : ''}</b><span class="num">${eur0(p.wealth)}</span><span class="num ${cls(p.ret)}" style="width:68px;text-align:right">${pct(p.ret, 1)}</span></div>`).join('')}</div>`;
}

function powerupCard() {
  const pu = S.me.powerup; if (!pu) return '';
  const info = POWERUP_INFO[pu.type];
  if (pu.status === 'used' && pu.type === 'oracle' && pu.result && pu.result.round === S.round && S.phase !== 'reaction') {
    const s = S.stocks.find((x) => x.id === pu.result.stockId);
    const d = pu.result.direction;
    return `<div class="pu pop" style="--c:${info.color}"><span class="ic">${info.icon}</span> <b>O Oráculo diz:</b> <b>${esc(s.name)}</b> vai <b class="${d === 'UP' ? 'up' : d === 'DOWN' ? 'down' : 'gold'}">${esc(DIR_PT[d] || d)}</b> nesta ronda.<div class="muted" style="font-size:12px">Só tu vês isto. O tamanho exato é desconhecido.</div></div>`;
  }
  if (pu.status === 'active' && pu.round === S.round && S.phase !== 'reaction') {
    return `<div class="pu" style="--c:${info.color}"><span class="ic">${info.icon}</span> <b>${esc(info.name)} está ativo</b> nesta ronda${pu.stockId ? ` em <b>${esc(S.stocks.find((x) => x.id === pu.stockId).name)}</b>` : ''}.</div>`;
  }
  if (pu.status === 'owned' && S.phase === 'news' && S.round > S.shopAfter) {
    const needs = pu.type !== 'shield';
    return `<div class="pu" style="--c:${info.color}"><div class="row"><span class="ic">${info.icon}</span><div class="grow"><b>${esc(info.name)}</b><div class="muted" style="font-size:13px">${esc(info.desc)}</div></div></div>
      ${needs ? `<select id="puStock" style="margin-top:10px"><option value="">Escolhe uma ação…</option>${S.stocks.map((s) => `<option value="${esc(s.id)}" ${ui.puStock === s.id ? 'selected' : ''}>${esc(s.name)} (${esc(s.ticker)})</option>`).join('')}</select>` : ''}
      <button class="btn gold" style="width:100%;margin-top:10px" data-act="activate">Ativar agora (uma só vez)</button></div>`;
  }
  return '';
}

function stocksView() {
  let list = S.stocks.slice();
  const q = ui.q.trim().toLowerCase();
  if (q) list = list.filter((s) => s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q));
  const mineOnly = ui.filter === 'mine';
  if (mineOnly) list = list.filter((s) => s.owned > 0).sort((a, b) => b.ownedValue - a.ownedValue);
  const P = portfolio();
  const shareOf = Object.fromEntries(P.rows.map((r) => [r.s.id, r.share]));
  const canTrade = S.phase === 'trading';
  const dock = S.phase === 'trading'
    ? `<div class="dock">${S.me.ready ? `<button class="btn ghost" data-act="unready">✓ Pronto · Editar as minhas operações</button>` : `<button class="btn green" data-act="ready">Estou pronto</button>`}${S.countdownMs != null ? `<div class="cd" style="margin-top:8px">Todos prontos: a negociação fecha em ${Math.ceil(S.countdownMs / 1000)} s</div>` : ''}</div>` : '';
  return `<div class="stack">
    ${quizCard()}${openingCard()}${newsCard()}${powerupCard()}${reactionCard()}
    <input id="search" type="search" placeholder="Procurar empresas" value="${esc(ui.q)}" aria-label="Procurar ações">
    <div class="chips">${[['all', 'Todas'], ['mine', `As minhas (${P.rows.length})`]].map(([k, l]) => `<button class="fchip ${ui.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>
    ${mineOnly ? portfolioCard() : ''}
    ${list.map((s) => { const h = s.owned > 0 ? holdInfo(s) : null; return `<button class="stock" data-act="open" data-id="${esc(s.id)}">
      ${logo(s)}<div class="grow"><div class="nm">${esc(s.name)}${s.owned > 0 ? `<span class="own">${qtyFmt(s.owned)}</span>` : ''}</div><div class="sub">${esc(s.ticker)}<span class="vol ${s.vol}">${({ low: 'BAIXA', medium: 'MÉDIA', high: 'ALTA' })[s.vol]}</span>${h ? ` · <b>${Math.round(100 * (shareOf[s.id] || 0))}%</b> da carteira · <b class="${cls(h.ret)}">${pct(h.ret, 1)}</b>` : ''}</div></div>
      <div class="px"><div class="num">${eur(s.price)}</div><div class="num ${cls(s.change)}" style="font-size:13px">${S.settled ? pct(s.change) : '—'}</div></div></button>`; }).join('') || `<p class="muted">${mineOnly ? 'Ainda não tens ações.' : 'Nenhuma ação encontrada.'}</p>`}
    <p class="muted" style="font-size:11px;text-align:center">Os preços são valores simulados em euros virtuais (dados de demonstração). Os logótipos pertencem aos seus donos.</p>
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
  const h = s.owned > 0 ? holdInfo(s) : null;
  const lots = s.lots || [];
  const marks = Object.values(lots.reduce((m, l) => { (m[l.round] ||= { i: l.round, price: l.price, label: `Compra R${l.round} · ${(l.price / 100).toFixed(2)}€` }); return m; }, {}));
  const avg = lots.length ? Math.round(lots.reduce((a, l) => a + l.cost, 0) * 1e6 / lots.reduce((a, l) => a + l.qty, 0)) : null;
  const rateInfo = (l) => { const age = S.round - l.round; return age >= 4 ? '<b class="up">20% (já reduzido)</b>' : `28% · passa a 20% na ronda ${l.round + 4}`; };
  let detail = '';
  if (buy) {
    if (amtC > 0) detail = `Vais comprar ≈ <b class="num">${qtyFmt(Math.floor((amtC * 1e6) / s.price))}</b> ações · ficas com <b class="num">${eur(S.me.cash - amtC)}</b>`;
  } else if (q && q.ok) {
    const rates = [...new Set(q.lots.filter((l) => l.gain > 0).map((l) => Math.round(l.rate * 100)))];
    detail = `<div class="taxbox"><div class="kv"><span>Valor da venda</span><b class="num">${eur(q.gross)}</b></div><div class="kv"><span>${q.gain >= 0 ? 'Lucro' : 'Prejuízo'}</span><b class="num ${cls(q.gain)}">${eur(q.gain)}</b></div><div class="kv"><span>Taxa de imposto</span><b>${q.tax > 0 ? rates.map((r) => r + '%').join(' + ') : 'Sem imposto (sem lucro)'}</b></div><div class="kv"><span>Imposto a pagar</span><b class="num down">${eur(q.tax)}</b></div><div class="kv"><span><b>Recebes</b></span><b class="num up">${eur(q.net)}</b></div></div>`;
  } else if (q && !q.ok && amtC > 0) detail = `<span class="down">${esc(q.error)}</span>`;
  const ok = open && amtC > 0 && !ui.busy && (buy || (q && q.ok));
  const label = !open ? (S.me.ready ? 'Estás pronto' : 'Negociação fechada') : amtC <= 0 ? 'Escreve um montante' : `${buy ? '📈 Comprar' : '📉 Vender'} ${eur(amtC)} de ${s.ticker}`;
  const n = S.news;
  return `<div class="stack has-dock">
    <button class="btn ghost sm" data-act="back" style="justify-self:start">← Voltar</button>
    <div class="card row">${logo(s, 48)}<div class="grow"><h2 style="font-size:20px">${esc(s.name)}</h2><span class="muted">${esc(s.ticker)}</span></div><div style="text-align:right"><div class="num" style="font-size:20px">${eur(s.price)}</div><div class="num ${cls(s.change)}">${pct(s.change)}</div></div></div>
    ${n ? `<details class="card" style="padding:12px 14px"><summary><b>📰 Notícia:</b> ${esc(n.title)}</summary><p style="margin:8px 0 4px"><b>${esc(n.headline)}</b></p><ul class="newsl">${n.extras.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    <div class="card" style="padding:10px 8px">${priceChart(s.history || [], { marks, avg })}${marks.length ? '<p class="muted" style="font-size:12px;text-align:center;margin:4px 0 0">🟡 Pontos amarelos: onde compraste (ronda e preço) · linha tracejada: preço médio</p>' : ''}</div>
    <div class="stats" style="margin:0"><div class="stat"><small>Dinheiro disponível</small><span class="num">${eur(S.me.cash)}</span></div><div class="stat"><small>Tens desta ação</small><span class="num">${qtyFmt(s.owned)}</span><div class="muted" style="font-size:12px">${eur(s.ownedValue)}${h ? ` · <span class="${cls(h.ret)}">${pct(h.ret, 1)}</span>` : ''}</div></div></div>
    ${open ? '' : `<div class="cd">${S.me.ready ? 'Estás pronto. Toca em "Editar as minhas operações" na lista para negociar.' : 'A negociação está fechada: só podes ver.'}</div>`}
    <div class="seg" role="tablist"><button class="${buy ? 'on buy' : ''}" data-act="side" data-v="buy">📈 COMPRAR</button><button class="${!buy ? 'on sell' : ''}" data-act="side" data-v="sell">📉 VENDER</button></div>
    ${!buy && lots.length ? `<div class="card" style="padding:12px 14px"><b>Imposto sobre o lucro</b><div class="muted" style="font-size:12px;margin:2px 0 6px">Vendes primeiro as ações mais antigas. 28% sobre o lucro; 20% se as tiveres há 4 ou mais rondas. Prejuízos não pagam imposto.</div>${lots.map((l) => `<div class="kv" style="font-size:13px"><span>Ronda ${l.round} · comprada a ${eur(l.price)}</span><span>${rateInfo(l)}</span></div>`).join('')}</div>` : ''}
    <div class="card"><label class="f" for="amt" style="margin-top:0">Quanto dinheiro (€)</label><input id="amt" class="amt" inputmode="decimal" placeholder="0.00" value="${esc(ui.amount)}"><div class="quick">${buy ? quickBuy : quickSell}</div>${detail ? `<div style="margin:12px 0 0;text-align:center" class="muted">${detail}</div>` : ''}</div>
  </div>
  <div class="dock"><button class="btn bigact ${buy ? 'green' : 'red'}" data-act="confirm" ${ok ? '' : 'disabled'}>${label}</button></div>`;
}

// ---------- final results
function finalView() {
  const R = S.results, me = R.players.find((p) => p.id === S.me.id), c = R.champion;
  const colors = ['#2BD99F', '#4F8EFF', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8', '#FB923C', '#F472B6'];
  const byId = Object.fromEntries(S.stocks.map((s) => [s.id, s]));
  const pu = (p) => (p.powerup ? `${POWERUP_INFO[p.powerup.type].icon} ${POWERUP_INFO[p.powerup.type].name}${p.powerup.result ? ' · pagou ' + eur0(p.powerup.result.payout ?? 0) + (p.powerup.result.direction ? ' (' + (DIR_PT[p.powerup.result.direction] || p.powerup.result.direction) + ')' : '') : ' · por usar'}` : 'Sem power-up');
  return `<div class="stack">
    <div class="card champ pop"><div class="trophy">🏆</div><div class="muted">CAMPEÃO ELVASTOCKS</div><h1 style="font-size:30px;margin:6px 0">${esc(c.name)}</h1><div class="num gold" style="font-size:24px">${eur(c.wealth)}</div><div class="${cls(c.ret)} num">${pct(c.ret)} · começou com ${eur0(c.start)}</div></div>
    ${R.awards?.bestReturn ? `<div class="card" style="text-align:center">📈 Melhor retorno: <b>${esc(R.awards.bestReturn.name)}</b> <span class="up num">${pct(R.awards.bestReturn.ret, 1)}</span><div class="muted" style="font-size:12px">Os orçamentos iniciais são diferentes, por isso o retorno em % é a medida mais justa.</div></div>` : ''}
    <div class="card"><h3>Ficaste em ${me.rank}.º lugar</h3><p class="muted">${esc(me.profile.name)}: ${esc(me.profile.why)}</p>
      <div class="kv"><span>Perguntas certas</span><b>🎓 ${me.quiz.correct}/${me.quiz.total}</b></div><div class="kv"><span>Riqueza final</span><b class="num">${eur(me.wealth)}</b></div><div class="kv"><span>Ganho/perda total</span><b class="num ${cls(me.gain)}">${eur(me.gain)}</b></div><div class="kv"><span>Impostos pagos</span><b class="num">${eur(me.tax)}</b></div>
      ${me.best ? `<div class="kv"><span>Melhor investimento</span><b>${esc(me.best.name)} ${eur0(me.best.pnl)}</b></div>` : ''}${me.worst ? `<div class="kv"><span>Pior investimento</span><b>${esc(me.worst.name)} ${eur0(me.worst.pnl)}</b></div>` : ''}
      <div class="kv"><span>Power-up</span><b>${pu(me)}</b></div>
      <div class="kv"><span>Imposto reduzido de 20%</span><b>${me.patience.reducedRateSales ? `usado ${me.patience.reducedRateSales}×, poupaste ${eur0(me.patience.taxSaved)}` : 'não usado'}</b></div></div>
    <div class="card"><h3>Classificação</h3>${R.players.map((p) => `<details class="lb" style="display:block"><summary class="row"><span class="rk">${p.rank}</span><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><b class="grow">${esc(p.name)}</b><span class="num">${eur0(p.wealth)}</span></summary>
      <div style="padding:8px 0 4px 32px;font-size:13px" class="muted">${esc(p.profile.name)} · ${pct(p.ret, 1)} · imposto ${eur0(p.tax)}<br>${pu(p)}<br>${p.holdings.length ? 'Tem: ' + p.holdings.map((h) => esc(byId[h.id].ticker) + ' ' + eur0(h.value)).join(', ') : 'Só tem dinheiro'}</div></details>`).join('')}</div>
    <div class="card"><h3>Riqueza por ronda</h3>${lineChart(R.players.map((p, i) => ({ name: p.name, color: colors[i % 8], points: p.history })), { w: 420, h: 240 })}</div>
    <div class="card"><h3>O que mexeu com o mercado</h3>${R.events.map((e) => `<div class="move"><b style="width:26px">${e.round}</b><div class="grow"><b>${esc(e.title)}</b>${e.reversed ? '' : ''}<div class="muted" style="font-size:13px">${e.top.map((m) => `${esc(byId[m.id].ticker)} <span class="${cls(m.pct)}">${pct(m.pct, 1)}</span>`).join(' · ')}</div><div class="muted" style="font-size:12px">${esc(e.teaches)}</div></div></div>`).join('')}</div>
    <p class="muted" style="font-size:12px">${esc(R.tiebreak)} Mercado simulado (semente ${esc(R.seed)}); as regras de imposto são mecânicas do jogo, não aconselhamento fiscal.</p>
    ${S.nextCode ? `<button class="btn green" data-act="again">Entrar no próximo jogo (${esc(S.nextCode)})</button>` : `<p class="muted" style="text-align:center">Pede ao anfitrião para carregar em “Jogar outra vez”.</p>`}
  </div>`;
}

// ---------- shop overlay
function renderOverlay() {
  if (!S || S.phase !== 'shop') { $ov.innerHTML = ''; return; }
  const owned = S.me.powerup;
  $ov.innerHTML = `<div class="modal"><div class="sheet"><h2>⚡ Loja de Power-Ups</h2><p class="muted">Fecha em <b id="clock2"></b>. Podes comprar um por ${eur0(S.powerupCost)}. Ativa-o uma vez nas rondas 7 a 12, na fase de notícias. Sem reembolsos.</p>
    <div class="stack">${Object.entries(POWERUP_INFO).map(([k, i]) => {
    const can = !owned && S.me.cash >= S.powerupCost;
    const armed = ui.confirmPU === k;
    return `<div class="pu" style="--c:${i.color}"><div class="row"><span class="ic">${i.icon}</span><div class="grow"><b style="font-size:18px">${esc(i.name)}</b><div class="gold num">${eur0(S.powerupCost)}</div></div></div><p class="muted" style="font-size:14px">${esc(i.desc)}</p>
      <button class="btn ${armed ? 'gold' : ''}" style="width:100%" data-act="buypu" data-v="${k}" ${can ? '' : 'disabled'}>${owned?.type === k ? '✓ Comprado' : armed ? 'Toca outra vez para confirmar' : owned ? 'Já compraste um' : can ? 'Comprar' : 'Dinheiro insuficiente'}</button></div>`;
  }).join('')}</div>
    <button class="btn ghost" style="width:100%;margin-top:14px" data-act="closeshop">${owned ? 'Feito' : 'Não, obrigado'}</button></div></div>`;
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
    case 'quiz': await act({ action: 'answerQuiz', choice: Number(v) }); break;
    case 'ready': fx.beep(700, 80, 40); await act({ action: 'ready' }, 'Estás pronto'); break;
    case 'unready': await act({ action: 'unready' }, 'Podes voltar a negociar'); break;
    case 'confirm': {
      if (ui.busy) return; ui.busy = true; render();
      const s = stock(); const c = Math.round(parseFloat(ui.amount) * 100);
      const r = await act({ action: 'trade', stockId: ui.sel, side: ui.side, amount: c, requestId: uid() }).catch(() => null);
      ui.busy = false;
      if (r?.trade) {
        fx.beep(760, 90, 30);
        toast(ui.side === 'buy' ? `Compraste ${qtyFmt(r.trade.qty)} ${s.ticker} por ${eur(c)}` : `Vendeste ${s.ticker}: recebeste ${eur(r.trade.net)} (imposto ${eur(r.trade.tax)})`, 'ok');
        ui.amount = ''; ui.quote = null;
      }
      render(); break;
    }
    case 'activate': {
      const sel = $('#puStock'); const needs = S.me.powerup.type !== 'shield';
      if (needs && !(sel && sel.value)) { toast('Escolhe primeiro uma ação', 'err'); return; }
      const r = await act({ action: 'activatePowerup', stockId: sel?.value }, 'Power-up ativado!');
      if (r) fx.beep(980, 250, 120);
      break;
    }
    case 'buypu':
      if (ui.confirmPU === v) { ui.confirmPU = null; const r = await act({ action: 'buyPowerup', type: v }, 'Power-up comprado'); if (r) fx.beep(900, 200, 100); }
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
