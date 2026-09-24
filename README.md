# PremovedPrep — frontend

PremovedPrep is a tournament preparation platform, designed for chess analysis, exploring database games, studying opponents and building repertoires.

Live at **[premovedprep.com](https://premovedprep.com)**.

## Requirements

- Node 24
- npm 10 or newer

## How to run

```bash
npm ci
npm start # http://localhost:4200
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | dev server |
| `npm run build` | production build into `dist/premoved-prep-frontend/browser` |
| `npm test` | unit tests (Vitest) |
| `npm run lint` | ESLint, over TypeScript and templates |
| `npm run check` | everything CI runs: signal calls, bindings, UCI session, lint, both tsconfigs |
| `npm run check:signals` | fails if a template reads a signal without calling it |
| `npm run check:bindings` | fails on an `[input]` or `(output)` that the target component does not declare |
| `npm run assets` | the one below; runs automatically before `start` and `build` |
| `npm run assets:pieces` | downloads the licence-compatible Lichess piece sets into `public/piece/` |

## Licence

AGPL-3.0-only. See `LICENSE`.

- **Network Interaction Clause:** If you deploy a modified version of this application for public network use, the AGPL requires you to provide users with access to your modified source code.
- **Third-Party Assets:** Third-party code, icons, and downloaded assets operate under their own specific terms, which are listed in [`THIRD-PARTY.md`](THIRD-PARTY.md).
- PremovedPrep's custom icons and SVG logos are proprietary to the app's identity and are not covered by the project's primary license.
- The move, capture and castling recordings in `public/sound/premoved/` are Premoved's own and are covered by this project's licence.

## Trademarks and Copyrights

PremovedPrep is an independent project.
Lichess® and the Lichess artwork are registered trademarks of Lichess.org.
Stockfish is a trademark of the Stockfish developers.
FIDE is a registered trademark of the International Chess Federation.
All other software components, trademarks, and logos mentioned are the property of their respective owners. PremovedPrep is not affiliated with, endorsed by, or sponsored by any of these organizations.