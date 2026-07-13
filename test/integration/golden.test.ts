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
  "CHA23107-_Pulp_Cthulhu_v1.7",
  "CHA23131 Call of Cthulhu 7th Edition Quick-Start Rules",
  "CHA23140_-_Gateways_to_Terror_1.1",
  "CHA23148_-_Doors_to_Darkness_v1.1",
  "CHA23153_-_Masks_of_Nyarlathotep_-_Keeper_Reference_Booklet_v3",
  "CHA23159_-_Dead_Light_and_Other_Dark_Turns",
  "CHA23167_-_Mansions_of_Madness_v1.7",
  "CHA23172_-_Does_Love_Forgive_-_V5",
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

      const doc = await processPDF(new Uint8Array(pdfBuf));
      const actual = JSON.stringify(doc, null, 2);
      const goldenText = goldenBuf.toString("utf8");
      if (actual === goldenText) return;

      // Not equal — surface a focused, readable failure over actors then items.
      const golden = JSON.parse(goldenText);
      assert.equal(
        doc.actors.length,
        golden.actors.length,
        `character count changed: golden ${golden.actors.length} -> now ${doc.actors.length}`,
      );
      const d = firstDiff(doc.actors, golden.actors);
      if (d)
        assert.deepStrictEqual(
          doc.actors[d.i],
          golden.actors[d.i],
          `character #${d.i} ("${d.name}") differs from golden`,
        );
      assert.equal(
        doc.items.length,
        golden.items.length,
        `item count changed: golden ${golden.items.length} -> now ${doc.items.length}`,
      );
      const di = firstDiff(doc.items, golden.items);
      if (di)
        assert.deepStrictEqual(
          doc.items[di.i],
          golden.items[di.i],
          `item #${di.i} ("${di.name}") differs from golden`,
        );
      assert.equal(actual, goldenText, "output differs from golden snapshot");
    });
  }
});

describe("no actor falls back to an Unknown name", () => {
  for (const base of FILES) {
    test(base, async (t) => {
      const pdfBuf = await readOrNull(`fixtures/${base}.pdf`);
      if (!pdfBuf) return t.skip("fixture PDF missing");
      const { actors } = await processPDF(new Uint8Array(pdfBuf));
      const unknown = actors.filter((a) => a.name === "Unknown").length;
      assert.equal(unknown, 0, `${unknown} actor(s) named "Unknown" in ${base}`);
    });
  }
});
