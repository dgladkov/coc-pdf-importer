# Call of Cthulhu PDF Importer

## Overview

Import Actors from various official PDF documents using the standard Chaosium
stat block layout. Requires Foundry VTT v13+.

Tested on the following documents:

- Masks of Nyarlathotep (Keeper Reference Booklet)
- CoC7 Quick Start
- CoC7 Keeper Rulebook (Part 3: Scenarios)
- Gateways to Terror
- Doors to Darkness
- Dead Light and Other Dark Turns

Note that the importer will skeep large portions of important description prose,
such as maneuver mechanics and creature flavor - consult the source document
when running the game.

## Usage

1. Install the module from
   `https://raw.githubusercontent.com/dgladkov/coc-pdf-importer/refs/heads/main/module.json`
2. Go to Settings -> Game Settings -> Call of Cthulhu PDF Importer -> Import
   button
3. Upload the documents and wait until the import is complete
4. Navigate to Actors UI. Actors are created in folders matching the source file
   name.

## Development

### Prerequisites

- **Node.js 22+** (developed on Node 26). TypeScript sources are run directly
  via `node --experimental-strip-types`, so there is **no separate transpile
  step** for tests or tooling.
- `npm install` to pull dependencies (`pdfjs-dist`, `math.sumprecise`, and the
  dev toolchain: `esbuild`, `typescript`, `prettier`, `@thednp/dommatrix`).

### How it works

1. **Extraction** — `processPDF()` (in `process.ts`) uses `pdfjs-dist` to pull
   text runs, keeping each run's font size. It strips repeating page furniture
   (running headers, page numbers) and concatenates the rest.
2. **Parsing** — `parseCocCharacters()` finds stat-block anchors (the
   `STR … CON` run), recovers each block's name/age/description (using font size
   to separate a heading from body prose), then parses characteristics, derived
   stats, combat, skills, languages, spells, and Sanity loss into a
   `CocCharacter`. Multi-column group tables expand to one character per column.
3. **Import** — `importCharacters()` (in `importer.ts`) maps each `CocCharacter`
   onto CoC7 actor system data and embedded items (skills, weapons + backing
   skills, spells), placing them in a folder named after the source file. A
   re-import replaces same-named actors instead of duplicating.

`process.ts` is pure and Foundry-free, which is what makes it directly testable.

### npm scripts

- `npm run dev` - esbuild in watch mode → rebuilds `module.js` on change (use
  inside a live Foundry data dir)
- `npm run build` - One-off production bundle to `module.js` (+ source map, +
  pdf.js worker)
- `npm run build:module` - Clean **release** build into `build/` (manifest,
  `module.js`, worker, `lang/`, `templates/`)
- `npm run type-check` - `tsc --noEmit` over `src/`, `test/`, `tools/` |
- `npm test` - Unit tests (fast, fixture-free, CI)
- `npm run test:integration` - Book-level tests + golden snapshots — **needs the
  fixtures**
- `npm run dump:json` - Parse every fixture (or one: `-- "<file.pdf>"`) →
  `out/<name>.json`
- `npm run dump:text` - Dump raw pdf.js text of a fixture → `out/<name>.txt`
  (for debugging extraction)

### Testing

Three tiers:

- **Unit** (`src/*.test.ts`, run by `npm test`) — fast, self-contained checks
  against synthetic stat-block strings. These use generic placeholder names, no
  copyrighted text, and are the CI gate.
- **Integration** (`test/integration/process.integration.test.ts`) — parse the
  real PDFs and assert on specific characters. Requires the fixtures.
- **Golden snapshots** (`test/integration/golden.test.ts`) — re-parse each
  fixture and compare the full output byte-for-byte against
  `golden/<name>.json`. This is the backward-compatibility guard: refactor
  `process.ts` freely, then confirm the snapshots are unchanged. To accept an
  intentional output change, run `npm run dump:json` and copy `out/*.json` into
  `golden/`.

The PDFs and snapshots are copyrighted and gitignored; integration and golden
tests **skip** when they're absent. See `fixtures/README.md` for the setup.

### The `Math.sumPrecise` / `DOMMatrix` shims

pdf.js needs `Math.sumPrecise` (recent JS) and a DOM `DOMMatrix`, which are
missing in Node and in older browsers. They are installed in three contexts:

- **Node** (tests + tooling): `node-setup.ts`, loaded via `--import`.
- **Browser main thread**: `import "math.sumprecise/auto"` at the top of
  `index.ts`, bundled into `module.js`.
- **Browser pdf.js worker**: `tools/copy-worker.js` prepends the shim to
  `pdf.worker.min.mjs` when it's copied into a build.

Without the worker shim, text extraction silently truncates glyph runs.

### Building for release

`npm run build:module` assembles a clean `build/` directory with exactly the
files Foundry ships: `module.json`, `module.js` (+ map), the shimmed
`pdf.worker.min.mjs`, and the `lang/` and `templates/` folders. Zip that as the
release artifact.
