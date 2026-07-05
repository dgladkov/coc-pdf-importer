// Golden-snapshot regression test: re-parse each fixture PDF and compare the
// output, byte-for-byte, against a saved snapshot in golden/. This locks in the
// full parser output so refactors can be verified to change nothing.
//
// Both fixtures/ and golden/ are copyrighted and NOT committed. To (re)generate
// the snapshots: `npm run dump:json` then copy out/*.json into golden/. A test
// skips when its fixture or snapshot is missing.
import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { processPDF } from "../../src/process.ts";

// Every fixture is parsed and its output snapshotted under the same base name.
const FILES = [
  "CHA23131 Call of Cthulhu 7th Edition Quick-Start Rules",
  "CHA23140_-_Gateways_to_Terror_1.1",
  "CHA23148_-_Doors_to_Darkness_v1.1",
  "CHA23153_-_Masks_of_Nyarlathotep_-_Keeper_Reference_Booklet_v3",
  "CHA23159_-_Dead_Light_and_Other_Dark_Turns",
  "CHA23178-Book3-Scenarios-2026-download",
  "The Lightless Beacon - Call of Cthulhu",
];

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path);
  } catch {
    return null;
  }
}

// The first character whose serialized form differs, for a focused assertion.
function firstDiff(actual: any[], golden: any[]) {
  const n = Math.max(actual.length, golden.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(actual[i]) !== JSON.stringify(golden[i]))
      return { i, name: actual[i]?.name ?? golden[i]?.name };
  }
  return null;
}

describe("golden snapshots — parser output is unchanged", () => {
  for (const base of FILES) {
    test(base, async (t) => {
      const goldenBuf = await readOrNull(`golden/${base}.json`);
      const pdfBuf = await readOrNull(`fixtures/${base}.pdf`);
      if (!goldenBuf) return t.skip("golden snapshot missing");
      if (!pdfBuf) return t.skip("fixture PDF missing");

      const chars = await processPDF(new Uint8Array(pdfBuf));
      const actual = JSON.stringify(chars, null, 2);
      const goldenText = goldenBuf.toString("utf8");
      if (actual === goldenText) return;

      // Not equal — surface a focused, readable failure.
      const golden = JSON.parse(goldenText);
      assert.equal(
        chars.length,
        golden.length,
        `character count changed: golden ${golden.length} -> now ${chars.length}`,
      );
      const d = firstDiff(chars, golden);
      if (d)
        assert.deepStrictEqual(
          chars[d.i],
          golden[d.i],
          `character #${d.i} ("${d.name}") differs from golden`,
        );
      assert.equal(actual, goldenText, "output differs from golden snapshot");
    });
  }
});
