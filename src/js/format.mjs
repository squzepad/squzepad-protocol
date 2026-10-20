// Number formatting. No Intl date APIs anywhere: the page shows no dates.

const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
const DASH = '—';

export function fmtCompactUsd(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const f = (n, s) => '$' + (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + s;
  if (a >= 1e9) return f(v / 1e9, 'B');
  if (a >= 1e6) return f(v / 1e6, 'M');
  if (a >= 1e3) return f(v / 1e3, 'K');
  return '$' + v.toFixed(a >= 100 ? 0 : 2);
}

export function fmtPrice(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  if (v === 0) return '$0.00';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1) return '$' + v.toFixed(2);
  if (v >= 0.01) return '$' + v.toFixed(4);
  let zeros = Math.floor(-Math.log10(v));
  let sig = Math.round(v * 10 ** (zeros + 4));
  if (sig >= 10000) { zeros -= 1; sig = Math.round(v * 10 ** (zeros + 4)); }
  const digits = String(sig);
  if (zeros >= 4) return '$0.0' + String(zeros).split('').map((d) => SUB[+d]).join('') + digits;
  return '$0.' + '0'.repeat(zeros) + digits;
}

export function fmtChange(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const s = a >= 1000 ? Math.round(a).toLocaleString('en-US') : a >= 100 ? a.toFixed(0) : a.toFixed(1);
  return (v < 0 ? '▼ ' : v > 0 ? '▲ ' : '') + s + '%';
}

export const fmtInt = (v) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : Math.round(v).toLocaleString('en-US'));

export const shortAddr = (a) => (a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a);
