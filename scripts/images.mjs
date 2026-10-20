// Raster work for the logo: premultiplied resize (the transparent PNG stores pure-black RGB under alpha 0,
// so straight-alpha averaging would bleed black into the edges) and a contour trace for the favicon.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { load } from './analyze-assets.mjs';

export const LOGO_ALPHA = 'brand/LOGO SQUZEPAD PNG...png';

export function bbox(img, thr = 8) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] > thr) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1, y1 };
}

// Square crop around the artwork (with a margin fraction), returned as a region of the source.
export function squareRegion(img, margin = 0.06) {
  const b = bbox(img);
  const side = Math.ceil(Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) * (1 + margin * 2));
  const cx = (b.x0 + b.x1 + 1) / 2, cy = (b.y0 + b.y1 + 1) / 2;
  return { x: cx - side / 2, y: cy - side / 2, size: side };
}

// Area-average resample of `region` into size x size, premultiplied; output straight alpha.
export function resizePremul(img, region, size) {
  const out = new PNG({ width: size, height: size });
  const k = region.size / size;
  for (let oy = 0; oy < size; oy++) for (let ox = 0; ox < size; ox++) {
    const sx0 = region.x + ox * k, sx1 = sx0 + k, sy0 = region.y + oy * k, sy1 = sy0 + k;
    let r = 0, g = 0, b = 0, a = 0, w = 0;
    for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
      const fy = wy(y, sy0, sy1);
      if (y < 0 || y >= img.h) { w += fy * (sx1 - sx0); continue; }
      for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
        const fx = wx(x, sx0, sx1);
        const wt = fx * fy;
        w += wt;
        if (x < 0 || x >= img.w) continue;
        const i = (y * img.w + x) * 4;
        const al = img.data[i + 3] / 255;
        r += img.data[i] * al * wt; g += img.data[i + 1] * al * wt; b += img.data[i + 2] * al * wt; a += al * wt;
      }
    }
    const o = (oy * size + ox) * 4;
    const A = w ? a / w : 0;
    out.data[o + 3] = Math.round(A * 255);
    if (A > 0) { out.data[o] = Math.round(r / w / A); out.data[o + 1] = Math.round(g / w / A); out.data[o + 2] = Math.round(b / w / A); }
  }
  return out;
}
const wy = (y, a, b) => Math.min(y + 1, b) - Math.max(y, a);
const wx = wy;

export const toPngBuffer = (png) => PNG.sync.write(png, { colorType: 6 });

// Opaque icon: logo centred on a flat background colour.
export function composeOnBg(logoPng, size, pad, bgHex) {
  const out = new PNG({ width: size, height: size });
  const bg = [1, 3, 5].map((i) => parseInt(bgHex.slice(i, i + 2), 16));
  const inner = size - pad * 2;
  for (let i = 0; i < size * size; i++) { out.data[i * 4] = bg[0]; out.data[i * 4 + 1] = bg[1]; out.data[i * 4 + 2] = bg[2]; out.data[i * 4 + 3] = 255; }
  const s = resizeSquare(logoPng, inner);
  for (let y = 0; y < inner; y++) for (let x = 0; x < inner; x++) {
    const si = (y * inner + x) * 4, di = ((y + pad) * size + x + pad) * 4;
    const a = s.data[si + 3] / 255;
    for (let c = 0; c < 3; c++) out.data[di + c] = Math.round(s.data[si + c] * a + out.data[di + c] * (1 - a));
  }
  return out;
}
function resizeSquare(png, size) {
  return resizePremul({ w: png.width, h: png.height, data: png.data }, { x: 0, y: 0, size: png.width }, size);
}

// ---------- favicon trace ----------
// Coverage grid from the real pixels (premultiplied area average), marching squares at 0.5, RDP simplify.
function coverage(img, region, n) {
  const g = new Float32Array(n * n);
  const k = region.size / n;
  for (let oy = 0; oy < n; oy++) for (let ox = 0; ox < n; ox++) {
    let a = 0, w = 0;
    for (let y = Math.floor(region.y + oy * k); y < Math.ceil(region.y + (oy + 1) * k); y++) for (let x = Math.floor(region.x + ox * k); x < Math.ceil(region.x + (ox + 1) * k); x++) {
      w++;
      if (x >= 0 && y >= 0 && x < img.w && y < img.h) a += img.data[(y * img.w + x) * 4 + 3] / 255;
    }
    g[oy * n + ox] = a / w;
  }
  return g;
}

function contours(g, n) {
  // Edge-keyed segments; each grid cell contributes 0..2 segments joining points on its edges.
  const at = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : g[y * n + x]);
  const lerp = (a, b) => (0.5 - a) / (b - a);
  const segs = new Map(); // key -> [{to, p}]
  const pt = (kind, x, y) => {
    if (kind === 'h') { const t = lerp(at(x, y), at(x + 1, y)); return { key: `h${x},${y}`, x: x + t, y }; }
    const t = lerp(at(x, y), at(x, y + 1));
    return { key: `v${x},${y}`, x, y: y + t };
  };
  const add = (a, b) => {
    if (!segs.has(a.key)) segs.set(a.key, { p: a, n: [] });
    if (!segs.has(b.key)) segs.set(b.key, { p: b, n: [] });
    segs.get(a.key).n.push(b.key); segs.get(b.key).n.push(a.key);
  };
  for (let y = -1; y < n; y++) for (let x = -1; x < n; x++) {
    const tl = at(x, y) >= 0.5, tr = at(x + 1, y) >= 0.5, br = at(x + 1, y + 1) >= 0.5, bl = at(x, y + 1) >= 0.5;
    const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const T = () => pt('h', x, y), B = () => pt('h', x, y + 1), L = () => pt('v', x, y), R = () => pt('v', x + 1, y);
    const m = {
      1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
      8: [[L, T]], 9: [[T, B]], 10: [[L, B], [T, R]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
    }[code];
    for (const [p, q] of m) add(p(), q());
  }
  const used = new Set();
  const loops = [];
  for (const [key, node] of segs) {
    if (used.has(key)) continue;
    const loop = [];
    let cur = key, prev = null;
    while (cur && !used.has(cur)) {
      used.add(cur);
      const nd = segs.get(cur);
      loop.push(nd.p);
      const next = nd.n.find((k) => k !== prev && !used.has(k));
      prev = cur; cur = next;
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let dmax = 0, idx = 0;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) { const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [a, b];
}

// Returns { loops: [ [ {x,y} in 0..32 ] ], kind } - one loop per shape, ordered top chevron, square, bottom chevron.
export function traceLogo(img, vb = 32, inset = 2) {
  const region = squareRegion(img, 0.0);
  const n = 192;
  const g = coverage(img, region, n);
  const scale = (vb - inset * 2) / n;
  const loops = contours(g, n).map((l) => {
    let far = 1, fd = 0;
    l.forEach((p, i) => { const d = Math.hypot(p.x - l[0].x, p.y - l[0].y); if (d > fd) { fd = d; far = i; } });
    const a = rdp(l.slice(0, far + 1), 0.55);
    const b = rdp([...l.slice(far), l[0]], 0.55);
    const simp = a.slice(0, -1).concat(b.slice(0, -1));
    return simp.map((p) => ({ x: +(inset + (p.x + 0.5) * scale).toFixed(2), y: +(inset + (p.y + 0.5) * scale).toFixed(2) }));
  });
  loops.sort((a, b) => cy(a) - cy(b));
  return loops;
}
const cy = (l) => l.reduce((s, p) => s + p.y, 0) / l.length;

export const pathOf = (loop) => 'M' + loop.map((p) => `${p.x} ${p.y}`).join('L') + 'Z';
export { load };
