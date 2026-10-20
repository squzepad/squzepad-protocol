// Gates: npm run gates. Exit 0 only when every gate passes. Builds its own variants under .gate-tmp/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const { build } = await import('./build.mjs');
const R = await import('../src/lib/register.mjs');
const M = await import('../src/js/market.mjs');
const F = await import('../src/js/format.mjs');
const C = await import('./lib/checks.mjs');
const { words, bigrams, h, ALLOW } = await import('./lib/copy.mjs');
const { load, analyze } = await import('./analyze-assets.mjs');
const { LOGO_ALPHA } = await import('./images.mjs');

const TMP = '.gate-tmp';
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const regFile = 'src/register.json';
const reg = readJson(regFile);
const { read, textFiles, byRecord, attr, openTags } = C;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const gates = [];
const gate = (name, fn) => gates.push({ name, fn });
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const noIssues = (issues) => { if (issues.length) throw new Error(issues.slice(0, 80).join('\n    ')); };

// ---------- helpers for state-independent mutation ----------
const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const synthAddr = (seed) => Array.from({ length: 44 }, (_, i) => b58[(seed * 7 + i * 13 + (i * i) % 11) % b58.length]).join('');
const FACT = R.FACT_FIELDS;
function inertOf(rec) {
  const o = { ...rec, state: 'absent' };
  for (const f of FACT) delete o[f];
  return o;
}
function statedOf(rec) {
  const o = { ...rec, state: 'stated' };
  if (rec.id === 'ca') o.value = synthAddr(3);
  else if (rec.id === 'x') o.url = 'https://x.com/mutation_probe';
  else if (rec.id === 'github') o.url = 'https://github.com/mutation-probe/repo';
  else o.url = 'https://launch.example/app';
  return o;
}
// Reads the current record at runtime and returns its opposite.
const flip = (rec) => (rec.state === 'stated' ? inertOf(rec) : statedOf(rec));
function regWith(rec) {
  return { records: reg.records.map((r) => (r.id === rec.id ? rec : r)) };
}
function buildVariant(name, variantReg) {
  const f = path.join(TMP, name + '.json');
  fs.writeFileSync(f, JSON.stringify(variantReg));
  const out = path.join(TMP, name);
  build({ registerFile: f, out });
  return out;
}

// ============================ GATES ============================

// ---- register ----
gate('register: schema valid, inert records carry no value or url', () => noIssues(R.validate(reg)));
gate('register: chain record states Solana with the stated rpc and batch scope', () => {
  const c = R.byId(reg, 'chain');
  must(c.state === 'stated' && c.value === 'Solana', 'chain not Solana');
  must(c.rpc === 'https://solana-rpc.publicnode.com', 'rpc mismatch');
  must(c.source === 'client statement' && c.scope === 'batch-level', 'source/scope mismatch');
});
gate('register: dates exist as data only and never ship in dist', () => {
  must(reg.records.every((r) => !r.checked || /^\d{4}-\d{2}-\d{2}$/.test(r.checked)), 'bad data date');
  const pub = JSON.stringify(R.publicRegister(reg));
  must(!/\d{4}-\d{2}-\d{2}/.test(pub), 'public register carries a date');
  must(!fs.existsSync('dist/register.json'), 'dist ships register.json');
});

// ---- repo hygiene ----
gate('hygiene: no CLAUDE.md, no .claude/, no attribution anywhere in the repo', () => {
  const skip = (p) => /node_modules|\.gate-tmp|[\\/]dist[\\/]?$/.test(p) || /\.(png|jpe?g|woff2)$/.test(p);
  const files = C.walk('.', (p) => /node_modules|\.gate-tmp|[\\/]\.git$|gates\.mjs$/.test(p));
  const bad = files.filter((f) => /(^|[\\/])CLAUDE\.md$/i.test(f) || /(^|[\\/])\.claude[\\/]/.test(f));
  const pat = new RegExp(['cla' + 'ude', 'anthr' + 'opic', 'open' + 'ai', 'chat' + 'gpt', 'co-?authored-by', 'generated (?:by|with)', '\\bA' + 'I\\b', '\\bL' + 'LM\\b'].join('|'), 'i');
  const hits = files.filter((f) => !skip(f) && /\.(md|json|mjs|js|css|html|txt|svg)$|LICENSE$/.test(f) && !/package-lock/.test(f)).filter((f) => pat.test(read(f)));
  noIssues([...bad.map((f) => `forbidden file ${f}`), ...hits.map((f) => `attribution wording in ${f}`)]);
});
gate('hygiene: README.md, docs/whitepaper.md and an MIT LICENSE exist at the root, not in dist', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) must(fs.existsSync(f), `${f} missing`);
  const lic = read('LICENSE');
  must(/MIT License/.test(lic) && /Copyright \(c\) 2026 Squzepad/.test(lic), 'LICENSE must be MIT, Squzepad, 2026');
  for (const f of ['README.md', 'LICENSE', 'docs', 'CLAUDE.md']) must(!fs.existsSync(path.join('dist', f)), `dist contains ${f}`);
  const rd = read('README.md');
  must(/Solana/.test(rd) && /squzepad\.fun/i.test(rd) && /Overview/.test(rd) && /Features/.test(rd) && /Links/.test(rd), 'README sections incomplete');
  const wp = read('docs/whitepaper.md');
  must(/Phase 1/.test(wp) && /Phase 4/.test(wp) && /Tokenomics/i.test(wp) && /Team/i.test(wp) && /Vision/i.test(wp), 'whitepaper sections incomplete');
});

// ---- build output ----
gate('dist: build output present (index, favicon, css, js, fonts, logos, og)', () => {
  for (const f of ['index.html', 'favicon.svg', 'css/tokens.css', 'css/style.css', 'js/app.mjs', 'js/market.mjs', 'js/spring.mjs', 'js/boot.js', 'fonts/geist.woff2', 'fonts/geist-mono.woff2', 'img/logo-128.png', 'img/logo-384.png', 'apple-touch-icon.png', 'og.jpg', '_headers']) must(fs.existsSync('dist/' + f), `dist/${f} missing`);
});
gate('dist: nothing external loads at page start except same-origin files', () => {
  const html = read('dist/index.html');
  const bad = openTags(html).filter((t) => ['link', 'script', 'img', 'source'].includes(t.tag)).filter((t) => /(?:src|href|srcset)="https?:\/\//.test(t.raw));
  noIssues(bad.map((t) => `external reference ${t.raw.slice(0, 90)}`));
  const css = read('dist/css/style.css');
  must(!/url\(\s*["']?https?:/.test(css), 'css pulls external url');
});

// ---- assets ----
gate('assets: every brand and reference file read; IHDR, alpha, dominant pixels, snapped palette', () => {
  const rows = [];
  for (const dir of ['brand', 'reference']) for (const f of fs.readdirSync(dir)) rows.push(analyze(path.join(dir, f), 6));
  must(rows.length === 10, `expected 10 assets, read ${rows.length}`);
  for (const r of rows) {
    must(r.format !== 'unknown' && r.width > 0 && r.palette.length >= 4 && r.dominant.length, `unread asset ${r.file}`);
    if (r.format === 'png') must(r.ihdr && r.ihdr.bitDepth === 8, `png IHDR missing ${r.file}`);
  }
  const a = rows.find((r) => path.normalize(r.file) === path.normalize(LOGO_ALPHA));
  must(a.ihdr.colorType === 6 && a.alpha.transparent > 1e6 && a.alpha.blackTransparent > 1e6, 'transparent logo not detected as pure-black-under-alpha');
});
gate('assets: palette is sampled, snapped to real pixel coordinates, and nothing is invented', () => {
  const t = readJson('src/tokens.json');
  const cache = {};
  const issues = [];
  for (const p of t.palette) {
    const img = (cache[p.source] ||= load(p.source));
    const i = (p.y * img.w + p.x) * 4;
    const hex = '#' + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('');
    if (hex !== p.hex) issues.push(`${p.name}: ${p.hex} is not the pixel at ${p.source} (${p.x},${p.y}) = ${hex}`);
  }
  noIssues(issues);
  const css = read('dist/css/tokens.css');
  for (const p of t.palette) must(css.includes(`${p.hex}; /* ${p.source} @ ${p.x},${p.y}`), `provenance comment missing for ${p.name}`);
  must(/k-means/.test(css.split('\n')[0]), 'tokens.css lacks the provenance header');
});
gate('assets: logo resize is premultiplied (no dark fringe on partial-alpha edge pixels)', () => {
  const img = load('dist/img/logo-384.png');
  let n = 0, lum = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3];
    if (a > 8 && a < 247) { n++; lum += (img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]) / 3; }
  }
  must(n > 300, `too few edge pixels (${n})`);
  must(lum / n > 110, `edge pixels are dark (mean ${(lum / n).toFixed(0)}): black bled in`);
});
gate('favicon: svg 32x32, traced from the pixel grid, no comments or double hyphens', () => {
  const s = read('dist/favicon.svg');
  must(/viewBox="0 0 32 32"/.test(s) && /width="32"/.test(s) && /height="32"/.test(s), 'not 32x32');
  must(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen inside svg');
  const paths = [...s.matchAll(/<path[^>]* d="([^"]+)"/g)].map((m) => m[1]);
  must(paths.length === 3, `expected 3 traced shapes, got ${paths.length}`);
  for (const d of paths) for (const n of d.match(/-?\d+(?:\.\d+)?/g)) must(+n >= 0 && +n <= 32, `coordinate ${n} outside viewBox`);
  const pal = new Set(readJson('src/tokens.json').palette.map((p) => p.hex));
  for (const hx of s.match(/#[0-9a-f]{6}/gi)) must(pal.has(hx.toLowerCase()), `favicon colour ${hx} not in palette`);
  must(/rel="icon" href="\/favicon\.svg"/.test(read('dist/index.html')), 'favicon not linked');
});

// ---- palette rule ----
gate('palette: colour literals live in src/tokens.json only; dist hexes are all palette members', () => {
  const issues = [];
  for (const f of C.walk('src').filter((p) => /\.(css|js|mjs|html)$/.test(p))) issues.push(...C.sourceColourIssues(f, read(f)));
  for (const f of C.walk('scripts').filter((p) => /\.mjs$/.test(p) && !/gates|palette|checks|analyze/.test(p))) {
    const body = read(f);
    if (/#[0-9a-fA-F]{6}\b/.test(body)) issues.push(`${f}: hex literal`);
  }
  noIssues(issues);
  const pal = new Set(readJson('src/tokens.json').palette.map((p) => p.hex));
  for (const f of textFiles('dist')) for (const hx of C.colourLiterals(read(f)).hex) if (!pal.has(hx.toLowerCase())) issues.push(`${f}: ${hx} is not a sampled colour`);
  noIssues(issues);
  const css = read('dist/css/style.css');
  must(!C.colourLiterals(css).fn.length, 'rgb()/hsl() function in style.css');
});

// ---- no dates ----
gate('dates: zero visible dates, timestamps, clock strings or time APIs in dist', () => {
  const issues = [];
  for (const f of textFiles('dist')) issues.push(...C.dates(f, read(f)));
  noIssues(issues);
});

// ---- links / social ----
gate('social: X and GitHub icons present in the header at all breakpoints, icon only, official marks', () => {
  const html = read('dist/index.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  for (const id of ['x', 'github']) {
    const els = byRecord(header, id);
    must(els.length === 1, `${id} icon count in header = ${els.length}`);
    const el = header.slice(header.indexOf(els[0].raw));
    const inner = el.slice(el.indexOf('>') + 1, el.search(/<\/(?:a|span)>/));
    must(/<svg/.test(inner) && !inner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim(), `${id}: icon has text label`);
  }
  must(header.includes('M18.244 2.25h3.308') && header.includes('M12 1C5.923 1 1 5.923'), 'official X / Octicon paths missing');
  const css = read('dist/css/style.css');
  // .social and .icon-btn must never be hidden or removed by any media query
  must(!/\.social\s*\{[^}]*display:\s*none/.test(css) && !/\.icon-btn\s*\{[^}]*display:\s*none/.test(css), 'social icons hidden by css');
  const after = html.indexOf('class="social"');
  must(after > html.indexOf('class="nav-right"'), 'social not inside nav-right (top-right cluster)');
});
gate('link rule: unstated records have no href, no copy payload and are not interactive', () => noIssues(C.linkRule(read('dist/index.html'))));
gate('link rule: stated social records link out and the handle is derived from the stored url', () => {
  for (const id of ['x', 'github']) {
    const rec = R.byId(reg, id);
    const els = byRecord(read('dist/index.html'), id).filter((t) => attr(t.attrs, 'data-state') === rec.state);
    must(els.length >= 1, `${id}: rendered state does not follow the record`);
    if (rec.state === 'stated') {
      must(els.every((t) => attr(t.attrs, 'href') === rec.url), `${id}: href differs from record url`);
      must(attr(els[0].attrs, 'aria-label').includes(R.deriveHandle(id, rec.url)), `${id}: handle not derived`);
    }
  }
  must(!('handle' in (reg.records.find((r) => r.id === 'x') || {})), 'x record stores a handle instead of deriving it');
});

// ---- CA slot ----
gate('ca: slot sits at the top, large, full-width, with copy feedback wiring', () => {
  const html = read('dist/index.html');
  must(html.indexOf('id="ca"') > html.indexOf('</header>') && html.indexOf('id="ca"') < html.indexOf('<main'), 'ca slot not directly under the header');
  const css = read('dist/css/style.css');
  must(/\.ca\s*\{[^}]*position:\s*sticky/.test(css), 'ca slot not sticky');
  const fs2 = Number(/\.ca-field\s*\{[^}]*font:\s*500\s*clamp\(\s*\d+px,\s*[\d.]+vw,\s*(\d+)px/.exec(css)?.[1]);
  must(fs2 >= 22, `ca font cap ${fs2}px is not large`);
  const app = read('dist/js/app.mjs');
  must(/data-copy/.test(app) && /is-copied/.test(app) && /Address copied/.test(app), 'copy feedback missing');
  must(/\.is-copied \.i-done/.test(css), 'copy visual feedback missing');
});
gate('ca: current register state renders the matching branch (inert or live)', () => {
  const html = read('dist/index.html');
  const rec = R.byId(reg, 'ca');
  const els = byRecord(html, 'ca');
  must(els.length >= 1 && els.every((t) => attr(t.attrs, 'data-state') === rec.state), 'ca state mismatch');
  if (rec.state === 'stated') must(els.some((t) => attr(t.attrs, 'data-copy') === rec.value) && html.includes(rec.value), 'live ca missing full address');
  else must(!/data-copy/.test(html.split('id="ca"')[1].split('</section>')[0]), 'inert ca has copy payload');
});

// ---- mutation harness: every anchor is read from the current record at runtime ----
for (const id of ['ca', 'x', 'github', 'launcher']) {
  gate(`mutation[${id}]: flipping the current state re-renders the opposite branch correctly`, () => {
    const cur = R.byId(reg, id);
    const mut = flip(cur);
    must(mut.state !== cur.state, 'flip did not change state');
    const vreg = regWith(mut);
    noIssues(R.validate(vreg));
    const out = buildVariant(`mut-${id}`, vreg);
    const html = read(path.join(out, 'index.html'));
    const els = byRecord(html, id);
    must(els.length >= 1, `no [data-record=${id}] anchors`);
    for (const t of els) must(attr(t.attrs, 'data-state') === mut.state, `${id}: element state ${attr(t.attrs, 'data-state')} != ${mut.state}`);
    noIssues(C.linkRule(html));
    if (mut.state === 'stated') {
      if (id === 'ca') {
        must(els.some((t) => attr(t.attrs, 'data-copy') === mut.value), 'ca copy payload not the full value');
        must(html.includes(`<span class="ca-addr">${mut.value}</span>`), 'ca full address not displayed');
      } else must(els.filter((t) => t.tag === 'a').every((t) => attr(t.attrs, 'href') === mut.url), `${id}: href != record url`);
      if (id === 'x' || id === 'github') must(html.includes(R.deriveHandle(id, mut.url)), `${id}: handle not shown to assistive tech`);
    } else {
      must(els.every((t) => attr(t.attrs, 'href') === null && attr(t.attrs, 'data-copy') === null), `${id}: inert branch leaks a link or payload`);
    }
    // address scanner: the rendered build passes against its own registry, and a stated CA is caught by any other registry
    noIssues(textFiles(out).flatMap((f) => C.addressIssues(f, read(f), vreg)));
    if (id === 'ca') {
      const other = C.addressIssues('index.html', html, reg);
      must(mut.state === 'stated' ? (cur.state === 'stated' && cur.value === mut.value) || other.length > 0 : true, 'scanner missed an unregistered address');
    }
  });
}
gate('mutation: inert chips show label and "pending" only, in every state combination', () => {
  const out = path.join(TMP, 'mut-ca');
  const html = read(path.join(out, 'index.html'));
  for (const t of openTags(html).filter((x) => x.tag === 'li' && attr(x.attrs, 'data-record'))) {
    const state = attr(t.attrs, 'data-state');
    const seg = html.slice(html.indexOf(t.raw), html.indexOf('</li>', html.indexOf(t.raw)));
    if (state !== 'stated') must(/chip-v">pending</.test(seg) && !/https?:|data-copy|href/.test(seg), `inert chip leaks: ${seg.slice(0, 80)}`);
  }
});
gate('mutation: detectors fire on injected faults (link, date, hex, address, register, copy)', () => {
  const html = read('dist/index.html');
  const x = byRecord(html, 'x')[0];
  const broken = html.replace(x.raw, x.raw.replace(/data-state="[^"]*"/, 'data-state="absent"').replace(/<(a|span)/, '<span').replace(/>$/, ' href="https://example.com/z">'));
  must(C.linkRule(broken).length > 0, 'link-rule detector missed href on an inert element');
  must(C.dates('x.html', html + '<p>Updated 2026-10-20</p>').length > 0, 'date detector missed ISO date');
  must(C.dates('x.html', html + '<p>Oct 20 at 12:30</p>').length > 0, 'date detector missed month/clock');
  must(C.dates('x.js', 'const t = new Date();').length > 0, 'date detector missed Date API');
  must(C.sourceColourIssues('x.css', 'a{color:#abc123}').length > 0 && C.sourceColourIssues('x.css', 'a{color:rgba(0,0,0,.5)}').length > 0, 'colour detector missed a literal');
  const bad = JSON.parse(JSON.stringify(reg));
  const inert = bad.records.find((r) => r.state !== 'stated');
  inert.value = 'leak';
  must(R.validate(bad).length > 0, 'register validator missed value on inert record');
  const evm = '0x' + 'ab12'.repeat(10);
  const evmReg = { records: [{ id: 'ca', state: 'stated', value: evm }] };
  must(C.addressIssues('t', `a ${evm} b`, evmReg).length === 0, '0x hex wrongly rejected although stated (blanket reject)');
  must(C.addressIssues('t', `a ${evm} b`, { records: [] }).length === 1, '0x hex not matched against registry');
  must(C.addressIssues('t', `a ${'0x' + 'cd34'.repeat(10)} b`, evmReg).length === 1, 'unregistered 0x hex passed');
  must(C.addressIssues('t', synthAddr(9), { records: [] }).length === 1, 'unregistered base58 address passed');
  must(C.addressIssues('t', 'prefers-reduced-motion and 0px and a-b-c', { records: [] }).length === 0, 'scanner false positive on ordinary text');
  must(words('the network rent').length === 3 && h('network rent') === h('network rent'), 'copy hashing broken');
});
gate('mutation: market output and market markup are identical whatever the CA state is', async () => {
  const cur = R.byId(reg, 'ca');
  const out = path.join(TMP, 'mut-ca');
  const a = read('dist/index.html'), b = read(path.join(out, 'index.html'));
  const slice = (s) => s.slice(s.indexOf('<section class="pulse'), s.indexOf('</main>'));
  must(cur.state !== R.byId(readJson(path.join(TMP, 'mut-ca.json')), 'ca').state, 'harness did not flip ca');
  must(slice(a) === slice(b), 'market/section markup changes with CA state');
  for (const f of ['js/market.mjs', 'js/app.mjs', 'js/format.mjs', 'js/spring.mjs']) must(read('dist/' + f) === read(path.join(out, f)), `${f} differs between CA states`);
  const ms = (rg) => JSON.stringify(R.publicRegister(rg).records.find((r) => r.id === 'market-source'));
  must(ms(reg) === ms(readJson(path.join(TMP, 'mut-ca.json'))), 'market-source record differs between CA states');
});

// ---- address scanner on the real build ----
gate('scanner: no address-shaped string in dist except values stated in the register', () => {
  noIssues(textFiles('dist').flatMap((f) => C.addressIssues(f, read(f), reg)));
});

// ---- market ----
function fakeFeed() {
  const sol = Array.from({ length: 40 }, (_, i) => `Sol${String(i).padStart(2, '0')}${'x'.repeat(36)}${i % 9}pump`);
  const boosts = [...sol.map((a) => ({ chainId: 'solana', tokenAddress: a })), ...Array.from({ length: 5 }, (_, i) => ({ chainId: 'ethereum', tokenAddress: '0x' + String(i).repeat(40) })), { chainId: 'solana', tokenAddress: sol[0] }];
  const calls = [];
  const pairs = (addr, i) => [
    { chainId: 'solana', baseToken: { address: addr, name: 'T' + i, symbol: 'T' + i }, priceUsd: String(0.001 * (i + 1)), priceChange: { h24: i - 20 }, volume: { h24: 1000 * ((i * 7) % 40) + i }, liquidity: { usd: 500 + i }, info: i % 2 ? { imageUrl: 'https://cdn.example/x.png' } : undefined },
    { chainId: 'solana', baseToken: { address: addr, name: 'T' + i, symbol: 'T' + i }, priceUsd: String(0.002 * (i + 1)), priceChange: { h24: 3 }, volume: { h24: 10 }, liquidity: { usd: 9000 + i } },
    { chainId: 'solana', baseToken: { address: 'OtherBase' + i, name: 'o', symbol: 'o' }, quoteToken: { address: addr }, volume: { h24: 999999 }, liquidity: { usd: 1 } },
  ];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://api.test/boosts') return { ok: true, json: async () => boosts };
    if (url.startsWith('https://api.test/pairs/')) {
      const asked = url.slice('https://api.test/pairs/'.length).split(',');
      return { ok: true, json: async () => asked.flatMap((a) => pairs(a, sol.indexOf(a))) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { sol, calls, fetchImpl, cfg: { url: 'https://api.test/boosts', pairsUrl: 'https://api.test/pairs/' } };
}
gate('market: keeps Solana entries only, ranks the top 10 by 24h volume, chunks pair requests', async () => {
  const f = fakeFeed();
  const { top, tracked } = await M.loadBoard(f.cfg, f.fetchImpl);
  must(tracked === 40 && top.length === 10, `tracked ${tracked}, top ${top.length}`);
  for (let i = 1; i < top.length; i++) must(top[i - 1].volume24h >= top[i].volume24h, 'not sorted by volume desc');
  const pairCalls = f.calls.filter((u) => u.startsWith('https://api.test/pairs/'));
  must(pairCalls.length === 2 && pairCalls.every((u) => u.slice(23).split(',').length <= 30), 'pair requests not chunked to 30');
  must(f.calls[0] === f.cfg.url && pairCalls.every((u) => u.startsWith(f.cfg.pairsUrl)), 'requests do not follow the register record');
  must(!top.some((t) => t.address.startsWith('0x')), 'non-solana entry leaked');
  const best = top[0];
  must(best.priceUsd !== null && best.liquidityUsd > 9000 && best.volume24h > 0, 'aggregation wrong');
  must(M.TOP_N === 10 && M.POLL_MS === 60000, 'constants');
});
gate('market: shape fields (logo url, price, 24h change, volume, liquidity, address) present; missing ones become null', () => {
  const rows = M.aggregate([{ chainId: 'solana', baseToken: { address: 'A', name: 'n', symbol: 's' }, priceUsd: 'x' }], ['A']);
  must(rows.length === 1 && rows[0].priceUsd === null && rows[0].imageUrl === null && rows[0].volume24h === null && rows[0].liquidityUsd === null && rows[0].change24h === null, 'null handling');
  const f = fakeFeed();
  return M.loadBoard(f.cfg, f.fetchImpl).then(({ top }) => {
    for (const k of ['address', 'symbol', 'name', 'imageUrl', 'priceUsd', 'change24h', 'volume24h', 'liquidityUsd']) must(k in top[0], `field ${k}`);
    must(top.some((t) => t.imageUrl && t.imageUrl.startsWith('https://')) && top.some((t) => !t.imageUrl), 'fixture should mix logos and missing logos');
  });
});
gate('market: exponential backoff doubles to a 60s cap with jitter', () => {
  const d = (n) => M.backoffDelay(n, { rand: () => 1 });
  const lo = (n) => M.backoffDelay(n, { rand: () => 0 });
  must(d(0) === 4000 && d(1) === 8000 && d(2) === 16000 && d(3) === 32000 && d(4) === 60000 && d(9) === 60000, 'ceiling schedule wrong');
  must(lo(1) === 4000 && lo(9) === 30000, 'jitter floor wrong');
  must(M.backoffDelay(2, { rand: () => 0.5 }) > lo(2) && M.backoffDelay(2, { rand: () => 0.5 }) < d(2), 'no jitter');
});
gate('market: poller polls every 60s, pauses while hidden, fetches immediately on visible, keeps last good data', async () => {
  const q = new Map();
  let id = 0;
  const sched = [];
  const timers = { set: (fn, ms) => { id += 1; q.set(id, fn); sched.push(ms); return id; }, clear: (h) => q.delete(h) };
  let visible = true;
  let mode = 'ok';
  let runs = 0;
  const data = [];
  const status = [];
  const p = M.createPoller({ run: async () => { runs++; if (mode === 'fail') throw new Error('x'); return { n: runs }; }, onData: (d) => data.push(d), onStatus: (s) => status.push(s), isVisible: () => visible, timers, rand: () => 0.5 });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  await p.start();
  must(runs === 1 && data.length === 1 && sched.at(-1) === 60000 && status.includes('live'), 'first poll / 60s schedule wrong');
  mode = 'fail';
  [...q.values()][0]();
  await flush();
  must(status.at(-1) === 'retrying' && data.length === 1, 'refresh failure must keep last good data and say retrying');
  const first = sched.at(-1);
  q.clear();
  mode = 'fail';
  await p.start();
  must(sched.at(-1) >= first && sched.at(-1) <= 60000 && sched.at(-1) < 60000 + 1, 'backoff did not grow within the cap');
  visible = false;
  q.clear();
  p.visibilityChanged();
  await flush();
  must(q.size === 0, 'timer still armed while hidden');
  const before = runs;
  mode = 'ok';
  visible = true;
  p.visibilityChanged();
  await flush();
  must(runs === before + 1 && status.at(-1) === 'live', 'no immediate fetch on becoming visible');
  const p2 = M.createPoller({ run: async () => { throw new Error('down'); }, onData: () => { throw new Error('no data expected'); }, onStatus: (s) => status.push('p2:' + s), isVisible: () => true, timers, rand: () => 0.5 });
  await p2.start();
  must(status.includes('p2:error'), 'first-load failure must surface as error');
});
gate('market: follows the market-source record only (no CA reference anywhere in market code)', () => {
  for (const f of ['src/js/market.mjs', 'src/js/format.mjs']) must(!/contract|\bca\b|'ca'|"ca"/i.test(read(f).replace(/\/\/.*$/gm, '')), `${f} mentions the CA`);
  const app = read('src/js/app.mjs');
  const ids = [...app.matchAll(/record\('([^']+)'\)/g)].map((m) => m[1]);
  must(ids.length === 1 && ids[0] === 'market-source', `app reads records: ${ids.join(',')}`);
  must(/isVisible:\s*\(\)\s*=>\s*document\.visibilityState === 'visible'/.test(app) && /visibilitychange/.test(app), 'visibility wiring missing');
  must(/addEventListener\('error'/.test(app) && /tile/.test(app), 'letter tile fallback missing');
  must(/is-skel/.test(app) && /sk-sweep/.test(read('src/style.css')) && /\.row\.enter/.test(read('src/style.css')), 'skeleton → fade-in stagger missing');
  must(/is-dash/.test(app) && /Offline/.test(app), 'dash + error state missing');
});
gate('market: number formatting handles tiny, large and missing values', () => {
  must(F.fmtPrice(0.0003026) === '$0.0₃3026' || F.fmtPrice(0.0003026) === '$0.0003026', `price ${F.fmtPrice(0.0003026)}`);
  must(/^\$0\.0₅\d{4}$/.test(F.fmtPrice(0.0000012345)), `tiny price ${F.fmtPrice(0.0000012345)}`);
  must(F.fmtCompactUsd(24_400_000) === '$24.4M' && F.fmtCompactUsd(null) === '—' && F.fmtChange(null) === '—' && F.fmtChange(-5.25) === '▼ 5.3%', 'format');
});

// ---- motion ----
gate('motion: reduced-motion fallback is instant everywhere; spring, parallax, count-up, spotlight, progress, mesh, live dot all wired', () => {
  const css = read('dist/css/style.css');
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  must(rm.length > 40 && /animation:\s*none\s*!important/.test(rm) && /transition:\s*none\s*!important/.test(rm) && /\[data-reveal\]\s*\{[^}]*opacity:\s*1/.test(rm), 'reduced-motion block incomplete');
  for (const f of ['app.mjs']) must(/prefers-reduced-motion: reduce/.test(read('dist/js/' + f)), `${f} ignores reduced motion`);
  const sp = read('dist/js/spring.mjs'), app = read('dist/js/app.mjs');
  must(/stiffness/.test(sp) && /damping/.test(sp) && /\* s;/.test(sp) && /IntersectionObserver/.test(sp) && /i \* 70/.test(sp), 'spring reveal stagger missing');
  must(/data-depth/.test(app) && /pointermove/.test(app) && /scrollY/.test(app), 'parallax missing');
  must(/setNumber/.test(app) && /tick-up/.test(app) && /tick-down/.test(app) && /reduced\(\)/.test(app), 'count-up/flash missing');
  must(/--mx/.test(app) && /\.spot::after/.test(css), 'spotlight missing');
  must(/id="progress"/.test(read('dist/index.html')) && /\.progress\s*\{[^}]*position:\s*fixed/.test(css), 'progress bar missing');
  must(/\.blob/.test(css) && /drift-a/.test(css) && /live-ring/.test(css) && /\.grad/.test(css), 'mesh / live dot missing');
  must((read('dist/index.html').match(/data-depth/g) || []).length >= 2, 'hero parallax layers missing');
  must(/0\.7s|\.6s var\(--ease\)/.test(css) && /cubic-bezier\(\.2, \.8, \.2, 1\)/.test(css), 'measured easing missing');
});
gate('layout: no ch units, 44px tap floor, five-breakpoint rules present', () => {
  const css = read('dist/css/style.css');
  must(!/\d(?:\.\d+)?ch\b/.test(css) && !/\d(?:\.\d+)?ch\b/.test(read('dist/index.html')), 'ch unit used');
  must(/--tap:\s*44px/.test(css), 'tap floor is not 44px');
  for (const mq of ['max-width: 1100px', 'max-width: 900px', 'max-width: 760px', 'max-width: 560px']) must(css.includes(mq), `missing ${mq}`);
});

// ---- copy originality ----
gate('copy: zero shared 2-grams and zero borrowed content words against the reference', () => {
  const ref = readJson('scripts/fixtures/reference-hashes.json');
  const rb = new Set(ref.bigrams), rw = new Set(ref.words);
  const html = read('dist/index.html');
  const strings = C.jsStrings(read('src/js/app.mjs')).filter((s) => /^[A-Z$]/.test(s));
  const text = C.pageText(html) + ' ' + strings.join(' . ');
  const w = words(text);
  // pairs made only of function words ("to the", "and a") are exempt; any pair holding a content word must be unique
  const shared2 = [...new Set(bigrams(w))].filter((b) => rb.has(h(b)) && !b.split(' ').every((x) => ALLOW.has(x)));
  const shared1 = [...new Set(w)].filter((x) => rw.has(h(x)) && !ALLOW.has(x));
  noIssues([...shared2.map((b) => `shared 2-gram: "${b}"`), ...shared1.map((x) => `borrowed word: "${x}"`)]);
});

// ---- run ----
let failed = 0;
let n = 0;
for (const g of gates) {
  n += 1;
  try {
    await g.fn();
    console.log(`PASS  ${String(n).padStart(2, '0')} ${g.name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${String(n).padStart(2, '0')} ${g.name}\n    ${String(e.message || e)}`);
  }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ngates: ${gates.length - failed}/${gates.length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
