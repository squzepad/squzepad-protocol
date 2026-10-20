// Static build: src/ -> dist/. Everything the host needs lives in dist/ and nothing else.
// Usage: node scripts/build.mjs [--register <file>] [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, publicRegister, renderSocial, renderCa, renderChip, renderLauncher } from '../src/lib/register.mjs';
import { treeSvg } from './tree.mjs';
import { load, squareRegion, resizePremul, toPngBuffer, composeOnBg, traceLogo, pathOf, LOGO_ALPHA } from './images.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; };
const registerFile = arg('--register', 'src/register.json');
const out = arg('--out', 'dist');

export function build({ registerFile, out }) {
  const reg = JSON.parse(fs.readFileSync(registerFile, 'utf8'));
  const errs = validate(reg);
  if (errs.length) throw new Error('register invalid:\n  ' + errs.join('\n  '));
  const tokens = JSON.parse(fs.readFileSync('src/tokens.json', 'utf8'));
  const P = Object.fromEntries(tokens.palette.map((p) => [p.name, p.hex]));

  fs.rmSync(out, { recursive: true, force: true });
  for (const d of ['css', 'js', 'img', 'fonts']) fs.mkdirSync(path.join(out, d), { recursive: true });
  const w = (f, data) => fs.writeFileSync(path.join(out, f), data);

  // tokens.css: the single file that holds colour literals.
  const lines = tokens.palette.map((p) => `  --${p.name}: ${p.hex}; /* ${p.source} @ ${p.x},${p.y} (${p.use}) */`);
  w('css/tokens.css', `/* Palette: ${tokens.provenance}. */\n:root {\n${lines.join('\n')}\n}\n`);

  fs.copyFileSync('src/style.css', path.join(out, 'css/style.css'));
  for (const f of fs.readdirSync('src/js')) fs.copyFileSync(path.join('src/js', f), path.join(out, 'js', f));

  const fontDir = 'node_modules/@fontsource-variable';
  fs.copyFileSync(`${fontDir}/geist/files/geist-latin-wght-normal.woff2`, path.join(out, 'fonts/geist.woff2'));
  fs.copyFileSync(`${fontDir}/geist-mono/files/geist-mono-latin-wght-normal.woff2`, path.join(out, 'fonts/geist-mono.woff2'));

  // Images: premultiplied resize of the transparent logo, apple icon, favicon traced from the pixel grid.
  const logo = load(LOGO_ALPHA);
  const region = squareRegion(logo, 0.05);
  for (const s of [128, 384]) w(`img/logo-${s}.png`, toPngBuffer(resizePremul(logo, region, s)));
  w('apple-touch-icon.png', toPngBuffer(composeOnBg(resizePremul(logo, region, 360), 180, 30, P.bg)));
  fs.copyFileSync('reference/SAMPUL SQUZEPAD JPG.jpg.jpeg', path.join(out, 'og.jpg'));

  const loops = traceLogo(logo);
  if (loops.length !== 3) throw new Error(`favicon trace expected 3 shapes, got ${loops.length}`);
  const [top, mid, bot] = loops;
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
<defs>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="28" y2="28"><stop offset="0" stop-color="${P['lime-hi']}"/><stop offset="0.5" stop-color="${P.mint}"/><stop offset="1" stop-color="${P.teal}"/></linearGradient>
<linearGradient id="v" gradientUnits="userSpaceOnUse" x1="14" y1="13" x2="18" y2="19"><stop offset="0" stop-color="${P['violet-hi']}"/><stop offset="1" stop-color="${P['violet-lo']}"/></linearGradient>
</defs>
<path fill="url(#g)" d="${pathOf(top)}"/>
<path fill="url(#v)" d="${pathOf(mid)}"/>
<path fill="url(#g)" d="${pathOf(bot)}"/>
</svg>
`;
  w('favicon.svg', favicon);

  // HTML
  let html = fs.readFileSync('src/index.html', 'utf8');
  const subs = {
    '@@THEME@@': P.bg,
    '@@CA@@': renderCa(reg),
    '@@SOCIAL_X@@': renderSocial(reg, 'x'),
    '@@SOCIAL_GH@@': renderSocial(reg, 'github'),
    '@@TREE@@': treeSvg(),
    '@@LAUNCHER_NAV@@': renderLauncher(reg, 'btn primary hide-m', '<span>Launcher</span>'),
    '@@LAUNCHER_CARD@@': renderLauncher(
      reg,
      'act primary card spot',
      '<span class="act-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V10M12 10c0-3 2-5 5-5 0 3-2 5-5 5ZM12 13c0-2.5-1.7-4-4.5-4 0 2.5 1.7 4 4.5 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="act-b"><b>Enter the launcher</b><small>Plant a seed, or add an offshoot to an existing one.</small></span>',
    ),
    '@@CHIPS@@': ['ca', 'x', 'github', 'launcher'].map((id) => renderChip(reg, id)).join('\n        '),
    '@@REGISTER_JSON@@': JSON.stringify(publicRegister(reg)).replace(/</g, '\\u003c'),
  };
  for (const [k, v] of Object.entries(subs)) html = html.split(k).join(v);
  const left = html.match(/@@[A-Z_]+@@/g);
  if (left) throw new Error('unreplaced template slots: ' + left.join(','));
  w('index.html', html);

  w('robots.txt', 'User-agent: *\nAllow: /\n');
  w('_headers', [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    "  Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; connect-src 'self' https://api.dexscreener.com; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    '/fonts/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/img/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'));
  return { reg, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ registerFile, out });
  const n = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : n.push(path.join(d, e.name))));
  walk(out);
  console.log(`build ok: ${out}/ (${n.length} files)`);
}
