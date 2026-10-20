// Detectors shared by the gates and by the mutation harness. Each returns a list of issue strings.
import fs from 'node:fs';
import path from 'node:path';
import { unmatched as scanUnmatched } from '../../src/lib/scan.mjs';

export const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md']);

export function walk(dir, skip = () => false) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p, e)) continue;
    if (e.isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}
export const textFiles = (dir) => walk(dir).filter((f) => TEXT_EXT.has(path.extname(f)));
export const read = (f) => fs.readFileSync(f, 'utf8');

// ---- html helpers ----
export function openTags(html) {
  return [...html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\s*\/?>/g)].map((m) => ({ tag: m[1], attrs: m[2], raw: m[0] }));
}
export const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
};
export const byRecord = (html, id) => openTags(html).filter((t) => attr(t.attrs, 'data-record') === id);

// Visible text + user-facing attributes (title, aria-label, alt, placeholder, meta content).
export function pageText(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ');
  const attrs = [...body.matchAll(/\s(?:title|aria-label|alt|placeholder|content)="([^"]*)"/g)].map((m) => m[1]);
  const text = body.replace(/<[^>]+>/g, ' ');
  return decode(text + ' ' + attrs.join(' ')).replace(/\s+/g, ' ');
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function jsStrings(src) {
  const out = [];
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// ---- LINK RULE: no href / copy payload for unstated records; stated social records link out ----
export function linkRule(html) {
  const issues = [];
  for (const t of openTags(html)) {
    const id = attr(t.attrs, 'data-record');
    if (!id) continue;
    const state = attr(t.attrs, 'data-state');
    const href = attr(t.attrs, 'href');
    const copy = attr(t.attrs, 'data-copy');
    if (state !== 'stated') {
      if (href !== null) issues.push(`${id}: inert element has href`);
      if (copy !== null) issues.push(`${id}: inert element has copy payload`);
      if (t.tag === 'a' || t.tag === 'button') issues.push(`${id}: inert element is interactive (${t.tag})`);
    }
  }
  return issues;
}

// ---- NO DATES ----
const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_RES = [
  [/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/, 'iso-like date'],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, 'slash date'],
  [new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'i'), 'month day'],
  [new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\b`, 'i'), 'day month'],
  [new RegExp(`\\b${MONTHS}\\.?,?\\s+(?:19|20)\\d{2}\\b`, 'i'), 'month year'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/i, 'clock string'],
];
const TEXT_ONLY_RES = [
  [/\b(?:19|20)\d{2}\b/, 'year'],
  [/\bas of\b/i, '"as of"'],
  [/\bchecked\b/i, '"checked"'],
  [/\blast (?:updated|checked|seen)\b/i, 'last-updated wording'],
  [/\b(?:\d+\s*(?:s|m|h|d|sec|min|hr|hour|day|week|month|year)s?\s+ago|just now)\b/i, 'relative time'],
  [/\b(?:timestamp|updated at|as at)\b/i, 'timestamp wording'],
];
const API_RE = /new Date\b|Date\.now|toLocale(?:Date|Time)String|toISOString|Intl\.DateTimeFormat|getFullYear|performance\.timeOrigin/;

export function dates(file, content) {
  const issues = [];
  const ext = path.extname(file);
  let surfaces = [];
  if (ext === '.html') surfaces = [pageText(content)];
  else if (ext === '.js' || ext === '.mjs') {
    surfaces = jsStrings(content);
    if (API_RE.test(content.replace(/performance\.now/g, ''))) issues.push(`${file}: date/time API used`);
  } else if (ext === '.css') surfaces = [...content.matchAll(/content:\s*"([^"]*)"/g)].map((m) => m[1]);
  else return issues;
  for (const s of surfaces) {
    for (const [re, name] of DATE_RES) if (re.test(s)) issues.push(`${file}: ${name} in "${s.slice(0, 60)}"`);
    for (const [re, name] of TEXT_ONLY_RES) if (re.test(s)) issues.push(`${file}: ${name} in "${s.slice(0, 60)}"`);
  }
  return issues;
}

// ---- PALETTE RULE ----
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
export function colourLiterals(content) {
  return { hex: content.match(HEX_RE) || [], fn: content.match(FN_RE) || [] };
}
export function sourceColourIssues(file, content) {
  const { hex, fn } = colourLiterals(content);
  const issues = [];
  if (hex.length) issues.push(`${file}: hex literal ${hex[0]}`);
  if (fn.length) issues.push(`${file}: colour function ${fn[0]}`);
  return issues;
}

// ---- GATE WARNING: address-shaped strings must match the stated registry ----
export function addressIssues(file, content, reg) {
  return scanUnmatched(content, reg).map((a) => `${file}: unregistered ${a.kind} address-shaped string ${a.value.slice(0, 12)}…`);
}
