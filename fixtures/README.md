# Test / tooling fixtures

The integration tests (`test/integration/`) and the dump tools (`tools/`) run the
parser against the real published PDFs. Those PDFs are copyrighted and are **not
committed** (`.gitignore` excludes `*.pdf`), so this directory is empty on a
fresh checkout and the integration suite cannot run without manual setup.

To enable them, place the following documents in this directory:

 * CHA23131 Call of Cthulhu 7th Edition Quick-Start Rules.pdf
 * CHA23140_-_Gateways_to_Terror_1.1.pdf
 * CHA23148_-_Doors_to_Darkness_v1.1.pdf
 * CHA23153_-_Masks_of_Nyarlathotep_-_Keeper_Reference_Booklet_v3.pdf
 * CHA23159_-_Dead_Light_and_Other_Dark_Turns.pdf
 * CHA23178-Book3-Scenarios-2026-download.pdf
 * The Lightless Beacon - Call of Cthulhu.pdf

Then:

    npm run test:integration          # book-level parser checks
    npm run dump:json                 # parse every fixture -> out/<name>.json
    npm run dump:text                 # raw pdf.js text of every fixture -> out/<name>.txt
    npm run dump:json -- "<file.pdf>" # ...or just one fixture (dump:text likewise)

## Golden snapshots

`test/integration/golden.test.ts` re-parses each fixture and compares the output
byte-for-byte against a snapshot in `golden/<name>.json` — a guard that refactors
change nothing. Like the PDFs, the snapshots are derived from copyrighted content
and are **not committed** (`golden/` is gitignored); each check skips when its
snapshot or fixture is missing. To (re)generate them after an intentional output
change, run `npm run dump:json` and copy `out/*.json` into `golden/`.

## Unit tests

The fast, fixture-free unit tests run separately and are part of normal CI:

    npm test
