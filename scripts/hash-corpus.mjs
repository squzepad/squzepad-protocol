// Turns a plain-text reference corpus into hashed word and bigram sets so the originality gate can run
// without the reference wording living in this repository.
// Usage: node scripts/hash-corpus.mjs <corpus.txt>  ->  scripts/fixtures/reference-hashes.json
import fs from 'node:fs';
import { words, bigrams, h } from './lib/copy.mjs';

const text = fs.readFileSync(process.argv[2], 'utf8');
const w = words(text);
fs.mkdirSync('scripts/fixtures', { recursive: true });
fs.writeFileSync('scripts/fixtures/reference-hashes.json', JSON.stringify({ words: [...new Set(w.map(h))].sort(), bigrams: [...new Set(bigrams(w).map(h))].sort() }));
console.log(`words ${new Set(w).size}, bigrams ${new Set(bigrams(w)).size}`);
