import crypto from 'node:crypto';

export const words = (t) => (t.toLowerCase().match(/[a-z0-9$]+(?:[.'’][a-z0-9]+)*/g) || []).map((x) => x.replace(/’/g, "'"));
export const bigrams = (w) => w.slice(1).map((x, i) => w[i] + ' ' + x);
export const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// Function words and unavoidable domain terms that do not count as borrowed vocabulary.
export const ALLOW = new Set(`a an the and or but if so of on in to for from by with at as is are was be been it its this that these those you your we our they them their he she his her not no nor than then there here
 up down out over under into onto off all any each every one two three four more most less only just also can will would could should may might do does did done has have had get gets got let lets
 every other another such what which who whom whose when where why how about after before between through while per via
 solana sol pump.fun usd 24h x github 1 2 3 4 5 6 7 8 9 10
 // terms that are the subject matter itself (a parent/child token family with shared fees), not borrowed voice
 parent child children family token tokens fee fees share creator wallet chain locked volume pool market launch launches`.split(/\s+/));
