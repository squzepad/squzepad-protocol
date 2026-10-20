// Build-time SVG for the hero lineage sketch: three parallax layers (rings, links, nodes) and the static logo.
const W = 538;
const H = 470;
const C = [W / 2, H / 2];
const r1 = (n) => Math.round(n * 10) / 10;

export function treeSvg() {
  const inner = [45, 135, 225, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: r1(C[0] + Math.cos(a) * 108), y: r1(C[1] + Math.sin(a) * 92), deg };
  });
  const outer = Array.from({ length: 8 }, (_, k) => {
    const deg = k * 45;
    const a = (deg * Math.PI) / 180;
    return { x: r1(C[0] + Math.cos(a) * 218), y: r1(C[1] + Math.sin(a) * 178), deg };
  });
  const parentOf = (o) => inner.reduce((b, n) => {
    const d = (n.x - o.x) ** 2 + (n.y - o.y) ** 2;
    return d < b.d ? { n, d } : b;
  }, { n: inner[0], d: Infinity }).n;

  const rings = `<svg class="tree-l l1" data-depth="0.25" viewBox="0 0 ${W} ${H}" aria-hidden="true"><ellipse class="ring" cx="${C[0]}" cy="${C[1]}" rx="108" ry="92"/><ellipse class="ring" cx="${C[0]}" cy="${C[1]}" rx="218" ry="178"/></svg>`;
  const links = `<svg class="tree-l l2" data-depth="0.55" viewBox="0 0 ${W} ${H}" aria-hidden="true">${inner
    .map((n) => `<path class="link" d="M${C[0]} ${C[1]} L${n.x} ${n.y}"/>`)
    .join('')}${outer.map((o) => { const p = parentOf(o); return `<path class="link soft" d="M${p.x} ${p.y} L${o.x} ${o.y}"/>`; }).join('')}</svg>`;
  const nodes = `<svg class="tree-l l3" data-depth="0.9" viewBox="0 0 ${W} ${H}" aria-hidden="true">${inner
    .map((n, i) => `<g class="node mid" style="--i:${i}"><circle cx="${n.x}" cy="${n.y}" r="26"/><text x="${n.x}" y="${n.y + 5}" text-anchor="middle">C${i + 1}</text></g>`)
    .join('')}${outer
    .map((o, i) => `<g class="node far" style="--i:${i}"><circle cx="${o.x}" cy="${o.y}" r="17"/><text x="${o.x}" y="${o.y + 4}" text-anchor="middle">G${i + 1}</text></g>`)
    .join('')}</svg>`;
  const core = `<div class="tree-core" data-depth="1.25"><img src="/img/logo-128.png" srcset="/img/logo-128.png 1x, /img/logo-384.png 3x" width="84" height="84" alt="Squzepad mark"></div>`;
  return `<div class="tree-stage">${rings}${links}${nodes}${core}</div>`;
}
