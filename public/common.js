// Shared helpers for the player and host apps. All dynamic text goes through esc() or textContent.
export const API = (window.MM_API || '').replace(/\/$/, '');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);

export const eur = (cents, dec = 2) => (cents / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec });
export const eur0 = (cents) => eur(cents, 0);
export const pct = (x, d = 2) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
export const qtyFmt = (micro) => (micro / 1e6).toLocaleString('en-IE', { maximumFractionDigits: 4 });
export const cls = (x) => (x > 0.00001 ? 'up' : x < -0.00001 ? 'down' : 'muted');

export async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'O pedido falhou'); e.code = data.code; e.status = res.status; throw e; }
  return data;
}

const initials = (s) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
/** Company logo: favicon service first, then a second source, then a ticker badge. */
export function logo(stock, size = 44) {
  const d = encodeURIComponent(stock.domain);
  return `<img class="logo" width="${size}" height="${size}" loading="lazy" alt="" data-t="${esc(initials(stock.ticker))}" data-fb="https://icons.duckduckgo.com/ip3/${esc(stock.domain)}.ico" src="https://www.google.com/s2/favicons?domain=${d}&sz=128" style="width:${size}px;height:${size}px">`;
}
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo')) return;
  if (img.dataset.fb && !img.dataset.tried) { img.dataset.tried = '1'; img.src = img.dataset.fb; return; }
  const sp = document.createElement('span');
  sp.className = 'logo fb'; sp.textContent = img.dataset.t || '?'; sp.style.cssText = `width:${img.width}px;height:${img.height}px`;
  img.replaceWith(sp);
}, true);
// Tiny favicons (16px) come back as a generic globe; treat very small natural sizes as failures.
document.addEventListener('load', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.classList.contains('logo') && img.naturalWidth && img.naturalWidth < 24 && !img.dataset.tried && img.dataset.fb) {
    img.dispatchEvent(new Event('error'));
  }
}, true);

export function toast(msg, kind = 'ok') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// Sound + haptics (optional, user-toggleable)
let ctx;
export const fx = {
  on: (() => { try { return localStorage.getItem('mm-sound') !== '0'; } catch { return true; } })(),
  toggle() { this.on = !this.on; try { localStorage.setItem('mm-sound', this.on ? '1' : '0'); } catch { /* ignore */ } return this.on; },
  beep(freq = 660, ms = 90, vib = 0) {
    if (!this.on) return;
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + ms / 1000);
      if (vib && navigator.vibrate) navigator.vibrate(vib);
    } catch { /* ignore */ }
  },
};

export const POWERUP_INFO = {
  oracle: { name: 'O Oráculo', icon: '🔮', color: '#A78BFA', desc: 'Descobre, só tu, se uma ação vai SUBIR, DESCER ou ficar IGUAL nesta ronda.' },
  shield: { name: 'Escudo Anti-Queda', icon: '🛡️', color: '#4F8EFF', desc: 'Se a tua carteira perder valor nesta ronda, recebes de volta a perda até €10.000.' },
  rocket: { name: 'Foguetão de Lucro', icon: '🚀', color: '#F26B78', desc: 'Escolhe uma ação: se subir, ganhas um bónus de 2× o ganho, até €50.000 investidos (máx. €15.000).' },
};

/** SVG line chart of wealth history. series: [{name,color,points:[cents...]}] */
export function lineChart(series, { w = 640, h = 260 } = {}) {
  const all = series.flatMap((s) => s.points.filter((x) => x != null));
  if (!all.length) return '';
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = { l: 56, r: 12, t: 12, b: 24 };
  const n = Math.max(...series.map((s) => s.points.length));
  const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#263a55" stroke-width="1"/><text x="${pad.l - 6}" y="${y(v) + 4}" fill="#8FA3BE" font-size="10" text-anchor="end">${esc(eur0(v))}</text>`;
  }
  for (let i = 0; i < n; i++) g += `<text x="${x(i)}" y="${h - 6}" fill="#8FA3BE" font-size="10" text-anchor="middle">${i}</text>`;
  const lines = series.map((s) => {
    const pts = s.points.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
    return `<polyline fill="none" stroke="${esc(s.color)}" stroke-width="2.5" stroke-linejoin="round" points="${pts}"/>`;
  }).join('');
  const legend = series.map((s) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px"><i style="width:10px;height:10px;border-radius:50%;background:${esc(s.color)}"></i>${esc(s.name)}</span>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Portfolio value by round">${g}${lines}</svg><div>${legend}</div>`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export const PHASE_LABEL = { lobby: 'Sala', news: 'Notícias', trading: 'Negociação', reaction: 'Reação do mercado', shop: 'Loja de Power-Ups', finished: 'Resultados finais' };

/** Simple price-history line chart for ONE stock. points = prices in cents, index 0 = opening price. */
export function priceChart(points, { w = 480, h = 190, color, marks = [], avg = null } = {}) {
  const pts = points.filter((v) => v != null);
  if (pts.length < 2) return '<p class="muted" style="text-align:center;margin:8px 0">Ainda sem histórico.</p>';
  let lo = Math.min(...pts, ...marks.map((m) => m.price), ...(avg ? [avg] : [])), hi = Math.max(...pts, ...marks.map((m) => m.price), ...(avg ? [avg] : []));
  const padv = (hi - lo) * 0.1 || hi * 0.02 || 1;
  lo -= padv; hi += padv;
  const pad = { l: 50, r: 10, t: 10, b: 22 };
  const x = (i) => pad.l + (i / (pts.length - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  const up = pts[pts.length - 1] >= pts[0];
  const col = color || (up ? '#2BD99F' : '#F26B78');
  let g = '';
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#263a55"/><text x="${pad.l - 5}" y="${y(v) + 4}" fill="#8FA3BE" font-size="10" text-anchor="end">${(v / 100).toFixed(2)}</text>`;
  }
  pts.forEach((_, i) => { g += `<text x="${x(i)}" y="${h - 6}" fill="#8FA3BE" font-size="10" text-anchor="middle">${i === 0 ? 'Antes' : i === 1 ? 'Início' : 'R' + (i - 1)}</text>`; });
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = pts.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${col}"/>`).join('');
  const avgLine = avg ? `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(avg)}" y2="${y(avg)}" stroke="#F5C56B" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${w - pad.r}" y="${y(avg) - 4}" fill="#F5C56B" font-size="10" text-anchor="end">média ${(avg / 100).toFixed(2)}</text>` : '';
  const mk = marks.filter((m) => m.i >= 0 && m.i < pts.length).map((m) => { const cx = x(m.i), cy = y(m.price); const left = cx > w * 0.7; return `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${pad.t}" y2="${h - pad.b}" stroke="#F5C56B" stroke-opacity=".45" stroke-dasharray="3 3"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6.5" fill="#F5C56B" stroke="#0b1522" stroke-width="2"/><text x="${(left ? cx - 10 : cx + 10).toFixed(1)}" y="${(cy - 9).toFixed(1)}" fill="#F5C56B" font-size="11" font-weight="700" text-anchor="${left ? 'end' : 'start'}">${m.label}</text>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Evolução do preço">${g}${avgLine}<polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" points="${line}"/>${dots}${mk}</svg>`;
}
