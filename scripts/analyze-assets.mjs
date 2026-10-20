// Reads every asset byte: container format, IHDR, alpha histogram, dominant pixels, k-means palette snapped to real pixels.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function load(file) {
  const buf = fs.readFileSync(file);
  const isPng = buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  const info = { file, bytes: buf.length, format: isPng ? 'png' : isJpg ? 'jpeg' : 'unknown' };
  if (isPng) {
    // IHDR: length(4) 'IHDR'(4) w(4) h(4) depth(1) colortype(1) comp(1) filter(1) interlace(1)
    info.ihdr = {
      width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24],
      colorType: buf[25], interlace: buf[28],
    };
    const png = PNG.sync.read(buf);
    return { info, w: png.width, h: png.height, data: png.data };
  }
  if (isJpg) {
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { info, w: j.width, h: j.height, data: j.data };
  }
  throw new Error('unknown format ' + file);
}

export function kmeans(px, k, iters = 24) {
  // px: array of [r,g,b,idx]; deterministic seeding by quantile of luminance
  const sorted = [...px].sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  let cs = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)].slice(0, 3));
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < iters; it++) {
    const sums = cs.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => {
      let best = 0, bd = Infinity;
      cs.forEach((c, ci) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = ci; }
      });
      assign[i] = best;
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++;
    });
    cs = cs.map((c, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c));
  }
  return cs.map((c, ci) => {
    // snap to nearest real pixel in cluster
    let bi = -1, bd = Infinity, n = 0;
    px.forEach((p, i) => {
      if (assign[i] !== ci) return;
      n++;
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    });
    return { share: n / px.length, idx: bi, p: px[bi] };
  }).filter((x) => x.idx >= 0);
}

export function analyze(file, k = 8) {
  const { info, w, h, data } = load(file);
  const hist = new Array(256).fill(0);
  let blackTransparent = 0;
  const px = [];
  const step = Math.max(1, Math.floor((w * h) / 120000));
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    hist[a]++;
    if (a < 255 && data[i * 4] === 0 && data[i * 4 + 1] === 0 && data[i * 4 + 2] === 0) blackTransparent++;
    if (a > 0 && i % step === 0) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], i]);
  }
  const counts = new Map();
  for (const p of px) { const key = hex(p[0] >> 3 << 3, p[1] >> 3 << 3, p[2] >> 3 << 3); counts.set(key, (counts.get(key) || 0) + 1); }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => ({ bucket: c, share: +(n / px.length).toFixed(4) }));
  const palette = kmeans(px, k).map((c) => {
    const [r, g, b, i] = c.p; const real = i * 1;
    return { hex: hex(r, g, b), share: +c.share.toFixed(4), x: (data.length ? real % w : 0), y: Math.floor(real / w) };
  });
  return {
    ...info, width: w, height: h,
    alpha: { min: hist.findIndex((n) => n), opaque: hist[255], transparent: hist[0], partial: w * h - hist[255] - hist[0], blackTransparent },
    dominant, palette,
  };
}

if (process.argv[1] && process.argv[1].endsWith('analyze-assets.mjs')) {
  const out = [];
  for (const dir of ['brand', 'reference']) {
    for (const f of fs.readdirSync(dir)) out.push({ dir, name: f, ...analyze(path.join(dir, f)) });
  }
  fs.writeFileSync(process.argv[2] || 'assets-report.json', JSON.stringify(out, null, 1));
  for (const r of out) console.log(r.dir, r.name, r.format, r.width + 'x' + r.height, JSON.stringify(r.ihdr || {}), 'alpha', JSON.stringify(r.alpha), '\n   dom', r.dominant.map((d) => d.bucket + ':' + d.share).join(' '), '\n   pal', r.palette.map((p) => `${p.hex}@(${p.x},${p.y}) ${p.share}`).join(' '));
}
