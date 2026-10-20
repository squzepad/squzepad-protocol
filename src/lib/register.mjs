// Register pattern: every external fact is one record with a state of stated | absent | unconfirmed.
// Only stated records carry value/url. Everything else renders inert.

export const STATES = ['stated', 'absent', 'unconfirmed'];
export const FACT_FIELDS = ['value', 'url', 'handle', 'rpc', 'pairsUrl'];

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HOSTS = { x: ['x.com', 'twitter.com', 'www.x.com'], github: ['github.com', 'www.github.com'] };

export const byId = (reg, id) => reg.records.find((r) => r.id === id);
export const isStated = (r) => !!r && r.state === 'stated';

// LINK RULE: the url is stored, the handle is derived from it.
export function deriveHandle(id, url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  if (!parts.length) return '';
  return id === 'x' ? '@' + parts[0] : parts.join('/');
}

export function validate(reg) {
  const errs = [];
  const seen = new Set();
  for (const r of reg.records || []) {
    if (!r.id || seen.has(r.id)) errs.push(`duplicate or missing id: ${r.id}`);
    seen.add(r.id);
    if (!STATES.includes(r.state)) errs.push(`${r.id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const f of FACT_FIELDS) if (f in r) errs.push(`${r.id}: inert record carries ${f}`);
      continue;
    }
    if (!('value' in r) && !('url' in r)) errs.push(`${r.id}: stated record has no value or url`);
    if (r.id === 'ca' && !B58.test(r.value || '')) errs.push('ca: not a Solana address');
    if (HOSTS[r.id]) {
      try {
        const u = new URL(r.url);
        if (u.protocol !== 'https:' || !HOSTS[r.id].includes(u.hostname)) errs.push(`${r.id}: url host not allowed`);
        else if (!deriveHandle(r.id, r.url)) errs.push(`${r.id}: no handle derivable`);
      } catch {
        errs.push(`${r.id}: bad url`);
      }
    }
  }
  for (const id of ['chain', 'market-source', 'ca', 'x', 'github']) if (!byId(reg, id)) errs.push(`missing record ${id}`);
  return errs;
}

// What ships to the browser: no dates, no notes; inert records carry only id, label and state.
export function publicRegister(reg) {
  return {
    records: reg.records.map((r) => {
      const o = { id: r.id, label: r.label, state: r.state };
      if (r.state === 'stated') for (const f of FACT_FIELDS) if (f in r) o[f] = r[f];
      return o;
    }),
  };
}

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ENT[c]);

export const ICONS = {
  // Official X mark
  x: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  // Official GitHub Octicon (mark-github-24)
  github:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.936-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128a10.193 10.193 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.221 2.64.111 2.915.701.77 1.127 1.747 1.127 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11Z"/></svg>',
};

// Top-right social icon: icon only, always rendered, inert unless stated. No href for unstated records.
export function renderSocial(reg, id) {
  const r = byId(reg, id);
  const icon = ICONS[id];
  if (isStated(r)) {
    const handle = deriveHandle(id, r.url);
    return `<a class="icon-btn" data-record="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(r.label)} ${esc(handle)}" title="${esc(r.label)} ${esc(handle)}">${icon}</a>`;
  }
  return `<span class="icon-btn is-inert" data-record="${id}" data-state="${r.state}" role="img" aria-disabled="true" aria-label="${esc(r.label)} pending" title="${esc(r.label)} pending">${icon}</span>`;
}

const COPY_ICONS =
  '<span class="ca-act" aria-hidden="true"><svg class="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><svg class="i-done" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

// Contract-address slot: full address, click to copy. Inert until stated.
export function renderCa(reg) {
  const r = byId(reg, 'ca');
  if (isStated(r)) {
    return `<button class="ca-field" type="button" data-record="ca" data-state="stated" data-copy="${esc(r.value)}" aria-label="Copy contract address ${esc(r.value)}"><span class="ca-addr">${esc(r.value)}</span>${COPY_ICONS}</button>`;
  }
  return `<div class="ca-field is-inert" data-record="ca" data-state="${r.state}" aria-disabled="true"><span class="ca-addr">pending</span></div>`;
}

// Footer chips: label + "pending" only when inert.
export function renderChip(reg, id) {
  const r = byId(reg, id);
  if (isStated(r)) {
    const v = r.value || deriveHandle(id, r.url);
    return `<li class="chip" data-record="${id}" data-state="stated"><span class="chip-k">${esc(r.label)}</span><span class="chip-v">${esc(v)}</span></li>`;
  }
  return `<li class="chip is-inert" data-record="${id}" data-state="${r.state}"><span class="chip-k">${esc(r.label)}</span><span class="chip-v">pending</span></li>`;
}

// Launcher card/button: a link when stated, an inert block with "pending" otherwise.
export function renderLauncher(reg, cls, inner) {
  const r = byId(reg, 'launcher');
  if (isStated(r)) return `<a class="${cls}" data-record="launcher" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  return `<div class="${cls} is-inert" data-record="launcher" data-state="${r.state}" aria-disabled="true">${inner}<span class="pend">pending</span></div>`;
}
