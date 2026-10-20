// Live market pipeline. Pure: no DOM, no register lookups beyond the config it is handed.
// The contract-address state has no input here by construction.

export const POLL_MS = 60000;
export const TOP_N = 10;
export const CHUNK = 30;
export const TIMEOUT_MS = 12000;

// Exponential backoff with equal jitter: half fixed, half random. attempt starts at 0.
export function backoffDelay(attempt, { base = 4000, cap = POLL_MS, rand = Math.random } = {}) {
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.round(exp / 2 + rand() * (exp / 2));
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export function solanaAddresses(boosts) {
  const seen = new Set();
  const out = [];
  for (const b of Array.isArray(boosts) ? boosts : []) {
    if (b && b.chainId === 'solana' && typeof b.tokenAddress === 'string' && !seen.has(b.tokenAddress)) {
      seen.add(b.tokenAddress);
      out.push(b.tokenAddress);
    }
  }
  return out;
}

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// One row per token. Price and 24h change come from the deepest pool; volume and liquidity are summed over the
// token's pools where it is the base asset.
export function aggregate(pairs, addresses) {
  const wanted = new Set(addresses);
  const groups = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const a = p && p.baseToken && p.baseToken.address;
    if (!a || p.chainId !== 'solana' || !wanted.has(a)) continue;
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push(p);
  }
  const rows = [];
  for (const [address, list] of groups) {
    const liq = (p) => num(p.liquidity && p.liquidity.usd) ?? 0;
    const best = list.reduce((a, b) => (liq(b) > liq(a) ? b : a));
    const sum = (f) => {
      const vals = list.map(f).filter((v) => v !== null);
      return vals.length ? vals.reduce((x, y) => x + y, 0) : null;
    };
    const info = list.map((p) => p.info && p.info.imageUrl).find((u) => typeof u === 'string' && /^https:\/\//.test(u));
    rows.push({
      address,
      symbol: String(best.baseToken.symbol || '').slice(0, 14),
      name: String(best.baseToken.name || best.baseToken.symbol || '').slice(0, 40),
      imageUrl: info || null,
      priceUsd: num(best.priceUsd),
      change24h: num(best.priceChange && best.priceChange.h24),
      volume24h: sum((p) => num(p.volume && p.volume.h24)),
      liquidityUsd: sum((p) => num(p.liquidity && p.liquidity.usd)),
    });
  }
  return rows;
}

export const byVolume = (a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1);
export const rankTop = (rows, n = TOP_N) => [...rows].sort(byVolume).slice(0, n);

async function getJson(url, fetchImpl, timeout = TIMEOUT_MS) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    if (t) clearTimeout(t);
  }
}

// cfg is the market-source register record: { url, pairsUrl }.
export async function loadBoard(cfg, fetchImpl = globalThis.fetch) {
  const boosts = await getJson(cfg.url, fetchImpl);
  const addrs = solanaAddresses(boosts);
  if (!addrs.length) throw new Error('no solana entries');
  const pages = await Promise.all(chunk(addrs, CHUNK).map((c) => getJson(cfg.pairsUrl + c.join(','), fetchImpl)));
  const rows = aggregate(pages.flat(), addrs);
  if (!rows.length) throw new Error('no pairs');
  return { tracked: rows.length, top: rankTop(rows) };
}

// Poller: poll every intervalMs, pause while hidden, fetch immediately on becoming visible, back off on failure,
// and never discard the last good result. Timer and visibility are injected so the logic is testable.
export function createPoller({ run, onData, onStatus, intervalMs = POLL_MS, isVisible = () => true, timers = { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h) }, rand = Math.random }) {
  let handle = null;
  let streak = 0;
  let inFlight = false;
  let hasData = false;

  const schedule = (ms) => {
    timers.clear(handle);
    handle = isVisible() ? timers.set(tick, ms) : null;
  };

  async function tick() {
    if (inFlight) return;
    if (!isVisible()) { handle = null; return; }
    inFlight = true;
    onStatus(hasData ? 'refreshing' : 'connecting');
    try {
      const data = await run();
      hasData = true;
      streak = 0;
      onData(data);
      onStatus('live');
      inFlight = false;
      schedule(intervalMs);
    } catch (err) {
      streak += 1;
      onStatus(hasData ? 'retrying' : 'error', err);
      inFlight = false;
      schedule(backoffDelay(streak - 1, { cap: intervalMs, rand }));
    }
  }

  return {
    start: () => tick(),
    visibilityChanged() {
      if (isVisible()) { timers.clear(handle); tick(); } else { timers.clear(handle); handle = null; }
    },
    get streak() { return streak; },
  };
}
