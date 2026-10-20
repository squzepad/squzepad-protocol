# Squzepad

**Token lineages on Solana.** Plant a parent, attach children, grow the family.

[![Live site](https://img.shields.io/badge/site-squzepad.fun-aafa7f?style=flat-square)](https://squzepad.fun)
![Chain](https://img.shields.io/badge/chain-Solana-5deeae?style=flat-square)

| | |
|---|---|
| Chain | Solana |
| Contract address | _pending_ |
| Site | https://squzepad.fun |

## Overview

Squzepad links every new token to the one it descends from, so a single release can seed a whole family instead of standing alone. The site presents the concept, a four-phase plan, and a live board of the busiest Solana tokens.

## Features

- Always-on market board: the ten busiest Solana tokens by 24h volume, with logo, price, 24h change, volume, liquidity and a copy-address button.
- Live ticker fed by the same data, polled every minute, paused while the tab is hidden, with exponential backoff and last-good-data retention.
- Contract-address slot at the top of the page: inert until an address is stated, then a large click-to-copy field.
- Register-driven facts: every external fact (address, social links, launcher) is a single record that renders inert until stated.
- Motion that respects `prefers-reduced-motion`.

## Links

- X: _pending_
- GitHub: _pending_
- Launcher: _pending_

## Development

```bash
npm install
npm run build   # writes dist/ (the folder to deploy)
npm run gates   # builds variants and runs every gate
```

Facts live in `src/register.json`; colours live in `src/tokens.json` and are sampled from the brand files.

## License

MIT, see [LICENSE](LICENSE).
