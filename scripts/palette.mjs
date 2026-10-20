// Writes src/tokens.json: the only place colour literals exist.
// Method: k-means (k=12, deterministic luminance-quantile seeding) over non-background pixels of each asset,
// each cluster centre snapped to the nearest real pixel; roles below pick a snapped pixel by coordinate.
import fs from 'node:fs';
import { load } from './analyze-assets.mjs';

const LOGO = 'brand/LOGO SQUZEPAD PNG.png';
const BANNER = 'reference/SAMPUL SQUZEPAD JPG.jpg.jpeg';
const roles = [
  ['bg', LOGO, 0, 0, 'canvas'],
  ['bg-1', BANNER, 300, 14, 'raised surface'],
  ['bg-2', BANNER, 995, 428, 'raised surface, brighter'],
  ['void', BANNER, 760, 0, 'shadow base'],
  ['ink', BANNER, 1265, 176, 'primary text'],
  ['lime-hi', LOGO, 585, 536, 'chevron gradient start'],
  ['lime', LOGO, 585, 869, 'accent'],
  ['green', LOGO, 585, 650, 'chevron gradient'],
  ['mint', LOGO, 885, 909, 'chevron gradient'],
  ['teal', LOGO, 975, 698, 'chevron gradient end'],
  ['violet-hi', LOGO, 690, 730, 'square gradient start'],
  ['violet', LOGO, 795, 678, 'secondary accent'],
  ['violet-lo', LOGO, 780, 790, 'square gradient end'],
  ['line', LOGO, 840, 611, 'hairline base'],
  ['glow', BANNER, 1310, 173, 'mesh glow'],
];
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const cache = {};
const palette = roles.map(([name, file, x, y, use]) => {
  const a = (cache[file] ||= load(file));
  const i = (y * a.w + x) * 4;
  return { name, hex: hex(a.data[i], a.data[i + 1], a.data[i + 2]), source: file, x, y, use };
});
const tokens = {
  provenance: 'k-means k=12 per asset, centre snapped to a real pixel; x,y are source pixel coordinates (verified by gates)',
  palette,
};
fs.writeFileSync('src/tokens.json', JSON.stringify(tokens, null, 2) + '\n');
console.log(palette.map((p) => `${p.name} ${p.hex} @${p.x},${p.y}`).join('\n'));
