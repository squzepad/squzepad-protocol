import { initReveal } from './spring.mjs';
import { loadBoard, createPoller, TOP_N } from './market.mjs';
import { fmtCompactUsd, fmtPrice, fmtChange, shortAddr } from './format.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => mq.matches;

// ---------- register (public copy, no dates) ----------
let register = { records: [] };
try { register = JSON.parse($('#register-public').textContent); } catch { /* page still renders without it */ }
const record = (id) => register.records.find((r) => r.id === id);

// ---------- toast + copy ----------
const toast = $('#toast');
let toastTimer = 0;
function say(msg) {
  toast.textContent = msg;
  toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), 1800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'sr-only';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-copy]');
  if (!t) return;
  const ok = await copyText(t.dataset.copy);
  if (!ok) {
    // Clipboard refused (permissions or embedded browser): leave the full address selected for a manual copy.
    const a = $('.ca-addr', t);
    if (a) { const r = document.createRange(); r.selectNodeContents(a); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    say(a ? 'Address selected. Press Ctrl+C to copy' : 'Copy blocked by the browser');
    return;
  }
  t.classList.add('is-copied');
  say('Address copied');
  setTimeout(() => t.classList.remove('is-copied'), 1600);
});

// ---------- scroll progress ----------
const bar = $('#progress');
let barQueued = false;
function paintBar() {
  barQueued = false;
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max).toFixed(4) : 0})`;
}
addEventListener('scroll', () => { if (!barQueued) { barQueued = true; requestAnimationFrame(paintBar); } }, { passive: true });
paintBar();

// ---------- spotlight ----------
document.addEventListener('pointermove', (e) => {
  const s = e.target.closest && e.target.closest('.spot');
  if (!s) return;
  const b = s.getBoundingClientRect();
  s.style.setProperty('--mx', e.clientX - b.left + 'px');
  s.style.setProperty('--my', e.clientY - b.top + 'px');
}, { passive: true });

// ---------- hero parallax (pointer + scroll) ----------
const layers = $$('[data-depth]');
const par = { tx: 0, ty: 0, x: 0, y: 0, raf: 0 };
function parStep() {
  par.x += (par.tx - par.x) * 0.08;
  par.y += (par.ty - par.y) * 0.08;
  const sy = Math.min(scrollY, 900);
  for (const el of layers) {
    const d = Number(el.dataset.depth);
    el.style.transform = `translate3d(${(par.x * d * 22).toFixed(2)}px, ${(par.y * d * 16 - sy * d * 0.14).toFixed(2)}px, 0)`;
  }
  const settled = Math.abs(par.tx - par.x) < 0.002 && Math.abs(par.ty - par.y) < 0.002;
  par.raf = settled ? 0 : requestAnimationFrame(parStep);
}
function kick() { if (!par.raf && !reduced()) par.raf = requestAnimationFrame(parStep); }
addEventListener('pointermove', (e) => {
  par.tx = (e.clientX / innerWidth - 0.5) * 2;
  par.ty = (e.clientY / innerHeight - 0.5) * 2;
  kick();
}, { passive: true });
addEventListener('scroll', kick, { passive: true });
mq.addEventListener('change', () => { if (reduced()) layers.forEach((el) => { el.style.transform = ''; }); });

// ---------- mobile menu ----------
const menuBtn = $('#menu-btn');
const menu = $('#nav-links');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  menu.classList.toggle('is-open', open);
});
menu.addEventListener('click', (e) => {
  if (e.target.closest('a')) { menuBtn.setAttribute('aria-expanded', 'false'); menu.classList.remove('is-open'); }
});

// ---------- count-up with flash ----------
const ease = (t) => 1 - Math.pow(1 - t, 4);
function setNumber(el, value, fmt) {
  const prev = el._v;
  el._v = value;
  if (value === null || value === undefined || !Number.isFinite(value)) { el.textContent = fmt(null); return; }
  cancelAnimationFrame(el._raf);
  const from = Number.isFinite(prev) ? prev : 0;
  if (reduced() || from === value) { el.textContent = fmt(value); return; }
  if (Number.isFinite(prev)) {
    el.classList.remove('tick-up', 'tick-down');
    void el.offsetWidth;
    el.classList.add(value > prev ? 'tick-up' : 'tick-down');
    clearTimeout(el._flash);
    el._flash = setTimeout(() => el.classList.remove('tick-up', 'tick-down'), 1600);
  }
  const t0 = performance.now();
  const dur = Number.isFinite(prev) ? 700 : 1100;
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = fmt(from + (value - from) * ease(k));
    if (k < 1) el._raf = requestAnimationFrame(tick);
    else el.textContent = fmt(value);
  };
  el._raf = requestAnimationFrame(tick);
}

// ---------- market UI ----------
const list = $('#board-list');
const track = $('#ticker-track');
const filter = $('#filter');
const empty = $('#board-empty');
const note = $('#board-note');
const state = { top: [], sort: 'volume', q: '' };

const sorters = {
  volume: (a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1),
  liquidity: (a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1),
  movers: (a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity),
};

function hue(addr) { let h = 0; for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0; return h % 5; }
function logo(t, cls) {
  const wrap = document.createElement('span');
  wrap.className = 'logo ' + (cls || '');
  const tile = () => {
    wrap.textContent = (t.symbol || t.name || '?').trim().charAt(0).toUpperCase() || '?';
    wrap.classList.add('tile', 't' + hue(t.address));
  };
  if (t.imageUrl) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { wrap.replaceChildren(); tile(); });
    img.src = t.imageUrl;
    wrap.append(img);
  } else tile();
  return wrap;
}
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

function skeletons() {
  list.replaceChildren();
  for (let i = 0; i < TOP_N; i++) {
    const li = el('li', 'row is-skel');
    li.append(el('span', 'c-rank sk w-s'), el('span', 'c-id sk w-l'), el('span', 'c-pc sk w-m'), el('span', 'c-stats sk w-m'));
    list.append(li);
  }
}

function buildRow(t) {
  const li = el('li', 'row spot');
  li.dataset.addr = t.address;
  const rank = el('span', 'c-rank');
  const id = el('span', 'c-id');
  const nm = el('span', 'nm');
  nm.append(el('strong', '', t.name), el('small', '', '$' + t.symbol));
  id.append(logo(t), nm);
  const pc = el('span', 'c-pc');
  pc.append(el('span', 'c-price num'), el('span', 'c-chg chg'));
  const stats = el('span', 'c-stats');
  const vol = el('span', 'c-vol'); vol.append(el('span', 'lbl', 'Turnover'), el('span', 'num v'));
  const liq = el('span', 'c-liq'); liq.append(el('span', 'lbl', 'Liquidity'), el('span', 'num v'));
  stats.append(vol, liq);
  const btn = el('button', 'copy', '');
  btn.type = 'button';
  btn.dataset.copy = t.address;
  btn.setAttribute('aria-label', `Copy address of ${t.name} (${shortAddr(t.address)})`);
  btn.title = 'Copy address';
  btn.innerHTML = '<svg class="i-copy" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><svg class="i-done" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  li.append(rank, id, pc, stats, btn);
  return li;
}

function paintRow(li, t, i, first) {
  $('.c-rank', li).textContent = String(i + 1).padStart(2, '0');
  setNumber($('.c-price', li), t.priceUsd, fmtPrice);
  const chg = $('.c-chg', li);
  chg.textContent = fmtChange(t.change24h);
  chg.classList.toggle('up', (t.change24h ?? 0) > 0);
  chg.classList.toggle('down', (t.change24h ?? 0) < 0);
  setNumber($('.c-vol .v', li), t.volume24h, fmtCompactUsd);
  setNumber($('.c-liq .v', li), t.liquidityUsd, fmtCompactUsd);
  li.dataset.q = (t.name + ' ' + t.symbol + ' ' + t.address).toLowerCase();
  if (first) li.style.setProperty('--i', i);
}

function renderBoard() {
  const sorted = [...state.top].sort(sorters[state.sort]);
  const existing = new Map($$('.row[data-addr]', list).map((n) => [n.dataset.addr, n]));
  const firstPaint = $('.row.is-skel', list) !== null || existing.size === 0;
  if (firstPaint) list.replaceChildren();
  const frag = [];
  sorted.forEach((t, i) => {
    let li = existing.get(t.address);
    const fresh = !li;
    if (fresh) { li = buildRow(t); li.classList.add('enter'); }
    existing.delete(t.address);
    paintRow(li, t, i, fresh);
    li.hidden = !!state.q && !li.dataset.q.includes(state.q);
    frag.push(li);
  });
  existing.forEach((n) => n.remove());
  list.append(...frag);
  empty.hidden = !state.q || frag.some((n) => !n.hidden);
}

function renderTicker() {
  const sig = state.top.map((t) => t.address).join();
  if (track.dataset.sig !== sig) {
    track.dataset.sig = sig;
    const mk = () => {
      const g = el('ul', 'ticker-set');
      for (const t of state.top) {
        const li = el('li', 'tick');
        li.dataset.addr = t.address;
        li.append(logo(t, 'sm'), el('b', '', '$' + t.symbol), el('span', 'tp'), el('span', 'tc chg'));
        g.append(li);
      }
      return g;
    };
    const a = mk();
    const b = mk();
    b.setAttribute('aria-hidden', 'true');
    track.replaceChildren(a, b);
    requestAnimationFrame(() => {
      const w = a.getBoundingClientRect().width;
      track.style.setProperty('--loop', w + 'px');
      track.style.setProperty('--dur', Math.max(24, w / 55) + 's');
    });
  }
  for (const t of state.top) {
    $$(`.tick[data-addr="${CSS.escape(t.address)}"]`, track).forEach((li) => {
      $('.tp', li).textContent = fmtPrice(t.priceUsd);
      const c = $('.tc', li);
      c.textContent = fmtChange(t.change24h);
      c.classList.toggle('up', (t.change24h ?? 0) > 0);
      c.classList.toggle('down', (t.change24h ?? 0) < 0);
    });
  }
}

function renderStats(data) {
  const top = data.top;
  const sum = (f) => top.reduce((a, t) => a + (t[f] ?? 0), 0);
  const lead = [...top].filter((t) => t.change24h !== null).sort(sorters.movers)[0];
  setNumber($('[data-stat="count"]'), data.tracked, (v) => (v === null ? '—' : String(Math.round(v))));
  setNumber($('[data-stat="volume"]'), sum('volume24h'), fmtCompactUsd);
  setNumber($('[data-stat="liquidity"]'), sum('liquidityUsd'), fmtCompactUsd);
  setNumber($('[data-stat="mover"]'), lead ? lead.change24h : null, (v) => (v === null ? '—' : fmtChange(v)));
  $('[data-stat="mover-name"]').textContent = lead ? '$' + lead.symbol : 'no data';
}

function onData(data) {
  state.top = data.top;
  note.hidden = true;
  list.classList.remove('is-error');
  renderBoard();
  renderTicker();
  renderStats(data);
  document.body.classList.add('has-data');
}

const LABEL = { connecting: 'Linking', live: 'Streaming', refreshing: 'Streaming', retrying: 'Retrying', error: 'Offline' };
function onStatus(s) {
  $$('[data-status]').forEach((p) => {
    p.dataset.status = s === 'refreshing' ? 'live' : s;
    $('.pill-t', p).textContent = LABEL[s];
  });
  if (s === 'error' && !state.top.length) {
    list.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const li = el('li', 'row is-dash');
      li.append(el('span', 'c-rank', '—'), el('span', 'c-id', '—'), el('span', 'c-pc', '—'), el('span', 'c-stats', '—'));
      list.append(li);
    }
    list.classList.add('is-error');
    $$('[data-stat]').forEach((n) => { if (n.dataset.stat !== 'mover-name') n.textContent = '—'; });
  }
  if (s === 'error' || s === 'retrying') {
    note.hidden = false;
    note.textContent = s === 'error'
      ? 'The market source is silent. Dashes stand in for numbers until it answers, and the board keeps trying.'
      : 'That refresh failed. The previous numbers remain on screen while the board tries again.';
  } else if (s === 'live') note.hidden = true;
}

// Market follows the market-source record only.
const src = record('market-source');
if (src && src.state === 'stated') {
  skeletons();
  const poller = createPoller({
    run: () => loadBoard(src),
    onData,
    onStatus,
    isVisible: () => document.visibilityState === 'visible',
  });
  document.addEventListener('visibilitychange', () => poller.visibilityChanged());
  poller.start();
} else {
  onStatus('error');
}

$$('#sort-tabs [role="tab"]').forEach((tab) => tab.addEventListener('click', () => {
  state.sort = tab.dataset.sort;
  $$('#sort-tabs [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  if (state.top.length) renderBoard();
}));
$('#sort-tabs').addEventListener('keydown', (e) => {
  const tabs = $$('#sort-tabs [role="tab"]');
  const i = tabs.indexOf(document.activeElement);
  if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  n.focus(); n.click();
});
filter.addEventListener('input', () => { state.q = filter.value.trim().toLowerCase(); if (state.top.length) renderBoard(); });

initReveal(reduced);
document.documentElement.dataset.ready = '1';
