// Gate warning: never blanket-reject 0x hex. Find address-shaped strings and match each against the
// stated registry values; only unmatched ones are findings.

const SHAPES = [
  { kind: 'solana', re: /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g },
  { kind: 'evm', re: /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g },
  { kind: 'hash', re: /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g },
];

export function addressShaped(text) {
  const out = [];
  for (const { kind, re } of SHAPES) {
    for (const m of text.matchAll(re)) {
      const s = m[0];
      if (kind === 'solana' && new Set(s).size < 6) continue; // runs like "aaaa..." are not addresses
      out.push({ kind, value: s });
    }
  }
  return out;
}

export function statedValues(reg) {
  return new Set(reg.records.filter((r) => r.state === 'stated' && typeof r.value === 'string').map((r) => r.value));
}

export function unmatched(text, reg) {
  const ok = statedValues(reg);
  return addressShaped(text).filter((a) => !ok.has(a.value));
}
