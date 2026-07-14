# Call of Cthulhu PDF Importer

## Overview

Import content from documents that use the standard Chaosium layout into the
[CoC7 system](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT).
Requires Foundry VTT v13+.

Tested on the following documents:

- Masks of Nyarlathotep (Keeper Reference Booklet)
- CoC7 Quick Start
- CoC7 Keeper Rulebook (Part 3: Scenarios)
- Gateways to Terror
- Doors to Darkness
- Dead Light and Other Dark Turns
- Does Love Forgive
- Mansions of Madness
- Pulp Cthulhu

A single import reads a document once and creates both **actors** and, when the
document contains them, **items** (currently the Pulp Cthulhu talents and
archetypes). Everything is placed in folders named after the source file; a
re-import refreshes same-named entries instead of duplicating them.

### Actors

Import actors from the various flavors of the standard stat block layout —
ordinary "Name, age N, description" blocks as well as multi-column table stat
blocks for NPC groups. Each block yields characteristics, derived stats, combat,
skills, languages, spells, Sanity loss, and armor.

Where the CoC7 system has a matching compendium item, the importer adopts it so
imported content keeps the real CoCID, icon, and properties:

- **Weapons** are matched to the system's weapon compendium (core content
  preferred over the wiki fallback), with size/alias handling for common melee
  and firearm names and correct thrown-weapon profiles. The book's printed
  damage always wins, but impale/range/skill metadata comes from the match.
- **Skills** are created with their specialization filled in, so specialized and
  "(Any)" skills don't prompt the sheet for a name on import.

Note that the importer skips large portions of description prose — maneuver
mechanics, creature flavor, and the like — so consult the source documents when
running the game.

### Pulp Talents & Archetypes

The 40 player talents and 22 archetypes from the Pulp Cthulhu rulebook are
parsed and imported as CoC7 `talent` and `archetype` items. Archetypes carry
their core characteristic(s), bonus points, suggested occupations/traits, talent
count, and a resolved skill list (each skill mapped to its CoCID itemKey).

Items are filed in a `<file name>` **Item** folder with one subfolder per type
(`Talents`, `Archetypes`); actors live at the top level of a same-named **Actor**
folder. (Foundry keeps Actor and Item folders in separate trees, so these are two
sibling folders of the same name.)

## Usage

1. Install the module from
   `https://raw.githubusercontent.com/dgladkov/coc-pdf-importer/refs/heads/main/module.json`
2. Go to Settings → Game Settings → Call of Cthulhu PDF Importer → Import button
3. Upload the document(s) and wait until the import is complete
4. Navigate to the Actors or Items sidebar. Entries are created in folders named
   after the source file (items under `Talents` / `Archetypes` subfolders).

## Development

### Prerequisites

- **Node.js 22+** (developed on Node 26). TypeScript sources are run directly
  via `node --experimental-strip-types`, so there is **no separate transpile
  step** for tests or tooling.
- `npm install` to pull dependencies (`pdfjs-dist`, `math.sumprecise`, and the
  dev toolchain: `esbuild`, `typescript`, `prettier`, `@thednp/dommatrix`).
- **7-Zip** is required only for `npm run build:module` (the release zip): the
  `7z` CLI on Windows, `7zz` (p7zip) on Linux/macOS.

### How it works

Parsing is split from Foundry entirely: `process.ts` and `pulp.ts` never touch
the Foundry API, which is what makes them directly testable.

1. **Extraction & parsing** — `processPDF()` (in `process.ts`) uses `pdfjs-dist`
   to read every page's text runs **once**, keeping each run's font size. From
   that shared representation it runs two independent parsers and returns
   `{ actors, items }`:
   - the **actor parser** strips repeating page furniture, finds stat-block
     anchors (the `STR … CON` run), recovers each block's name/age/description
     (using font size to separate a heading from body prose), and parses the
     stats into `CocCharacter`s. Multi-column group tables expand to one
     character per column.
   - the **item parser** (`pulp.ts`) reads the book's reference tables/sections
     into internal `PulpItem` structures (talents, archetypes). These keep
     source-faithful data — e.g. skill *names*, not resolved CoCIDs — and a
     document without those sections yields no items.
2. **Import** — `importDocument()` (in `document.ts`) creates the world
   documents:
   - actors via `importCharacters()` (`importer.ts`), which maps each
     `CocCharacter` onto CoC7 actor system data and embedded items (skills,
     weapons + backing skills, spells), at the top level of a `<file name>`
     Actor folder.
   - items via `createPulpItems()` (`document.ts`), which builds the Foundry
     `talent`/`archetype` documents — resolving skill names to CoCID itemKeys
     here, at the Foundry boundary — and files them under typed subfolders of a
     `<file name>` Item folder.

   A re-import replaces same-named entries in each folder instead of duplicating.

### npm scripts

- `npm run dev` — esbuild in watch mode → rebuilds `module.js` on change (use
  inside a live Foundry data dir)
- `npm run build` — one-off production bundle to `module.js` (+ source map, +
  pdf.js worker)
- `npm run build:module` — **release** build → `build/module.zip` +
  `build/module.json` (requires 7-Zip)
- `npm run type-check` — `tsc --noEmit` over `src/`, `test/`, `tools/`
- `npm test` — unit tests (fast, fixture-free, CI)
- `npm run test:integration` — book-level tests + golden snapshots — **needs the
  fixtures**
- `npm run dump:json` — parse every fixture (or one: `-- "<file.pdf>"`) →
  `out/<name>.json` (each file holds `{ actors, items }`)
- `npm run dump:text` — dump raw pdf.js text of a fixture → `out/<name>.txt`
  (for debugging extraction)

### Testing

Three tiers:

- **Unit** (`src/*.test.ts`, run by `npm test`) — fast, self-contained checks:
  the parsers against synthetic stat-block / reference text, and the Foundry
  builders against a mock harness. These use generic placeholder names, no
  copyrighted text, and are the CI gate.
- **Integration** (`test/integration/process.integration.test.ts`) — parse the
  real PDFs and assert on specific characters. Requires the fixtures.
- **Golden snapshots** (`test/integration/golden.test.ts`) — re-parse each
  fixture and compare the full `{ actors, items }` output byte-for-byte against
  `golden/<name>.json`, plus an assertion that no actor falls back to an
  "Unknown" name. This is the backward-compatibility guard: refactor the parsers
  freely, then confirm the snapshots are unchanged. To accept an intentional
  output change, run `npm run dump:json` and copy `out/*.json` into `golden/`.

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

`npm run build:module` produces two artifacts in `build/`:

- `module.zip` — the installable module, packed with 7-Zip at ultra compression.
  It contains `module.json`, `module.js` (+ source map), the shimmed
  `pdf.worker.min.mjs`, and the `lang/` and `templates/` folders.
- `module.json` — a copy of the manifest served next to the zip, so a release's
  manifest URL can point at it while the download URL points at `module.zip`.

7-Zip must be installed (`7z` on Windows, `7zz` on Linux/macOS).
