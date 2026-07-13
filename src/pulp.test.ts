// Unit tests for the pulp-talent parser/item builder. All table content here is
// generic placeholder text — only the category keywords and table framing (which
// are generic English) mirror the book; no published talent names or descriptions.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  parsePulpTalents,
  pulpTalentItem,
  buildPulpTalents,
  createPulpItems,
} from "./pulp.ts";

// Build a synthetic talent table. `rows` is [roll, name, description] tuples; the
// separator between name and description can be " : " or ":" (both occur in print).
function genTable(
  n: number,
  CAT: string,
  rows: [number, string, string][],
  sep = " : ",
): string {
  const label = CAT[0] + CAT.slice(1).toLowerCase();
  const head = `TABLE ${n}: ${CAT} TALENTS (CHOOSE OR ROLL 1D10) Roll ${label} Talent `;
  return head + rows.map(([r, name, d]) => `${r} ${name}${sep}${d}`).join(" ");
}

describe("parsePulpTalents", () => {
  test("parses each table's rows into categorized talents", () => {
    const text =
      genTable(3, "PHYSICAL", [
        [1, "Alpha", "runs fast."],
        [2, "Big Lift", "lifts heavy things."],
      ]) +
      " " +
      genTable(5, "COMBAT", [[1, "Quick Jab", "hits first."]]);
    assert.deepEqual(parsePulpTalents(text), [
      { name: "Alpha", category: "physical", description: "runs fast." },
      { name: "Big Lift", category: "physical", description: "lifts heavy things." },
      { name: "Quick Jab", category: "combat", description: "hits first." },
    ]);
  });

  test("accepts the no-space 'Name:' separator as well as ' : '", () => {
    const [t] = parsePulpTalents(
      genTable(4, "MENTAL", [[1, "Focus", "concentrates hard."]], ":"),
    );
    assert.equal(t.name, "Focus");
    assert.equal(t.description, "concentrates hard.");
  });

  test("strips a trailing running-header page artifact from the last row", () => {
    const text =
      genTable(3, "PHYSICAL", [
        [1, "Alpha", "aaa."],
        [10, "Zeta", "ends here."],
      ]) +
      " 25 RUNNING PAGE HEADER " + // "<num> CAPS CAPS" running header
      genTable(4, "MENTAL", [[1, "Mind", "thinks."]]);
    const t = parsePulpTalents(text);
    assert.equal(t.find((x) => x.name === "Zeta")!.description, "ends here.");
    assert.equal(t.find((x) => x.name === "Mind")!.category, "mental");
  });

  test("strips a trailing letter-spaced page footer from the last row", () => {
    const text =
      genTable(6, "MISCELLANEOUS", [[1, "Gizmo", "does a thing."]]) +
      " s h o o t i n g d e e p o n e s 26";
    const [t] = parsePulpTalents(text);
    assert.equal(t.description, "does a thing.");
  });

  test("cleans PDF spacing artifacts around punctuation", () => {
    const [t] = parsePulpTalents(
      genTable(6, "MISCELLANEOUS", [
        [1, "Gizmo", "builds a thing ( see Widgets , page 9 )."],
      ]),
    );
    assert.equal(t.description, "builds a thing (see Widgets, page 9).");
  });

  test("stops at a non-increasing roll (end of a table's rows)", () => {
    const text =
      genTable(3, "PHYSICAL", [
        [1, "Alpha", "aaa."],
        [2, "Bravo", "bbb."],
      ]) + " 1 Later Thing : ccc.";
    assert.deepEqual(
      parsePulpTalents(text).map((x) => x.name),
      ["Alpha", "Bravo"],
    );
  });

  test("ignores a mixed-case table cross-reference list", () => {
    const text =
      "See: 1. Table 3: Physical Talents 2. Table 4: Mental Talents. " +
      genTable(3, "PHYSICAL", [[1, "Alpha", "aaa."]]);
    assert.deepEqual(
      parsePulpTalents(text).map((x) => x.name),
      ["Alpha"],
    );
  });

  test("multi-word names are captured whole", () => {
    const [t] = parsePulpTalents(
      genTable(6, "MISCELLANEOUS", [[1, "Master of Many Things", "is versatile."]]),
    );
    assert.equal(t.name, "Master of Many Things");
  });
});

describe("pulpTalentItem", () => {
  test("builds a talent item matching the CoC7 schema", () => {
    const item = pulpTalentItem(
      { name: "Big Lift", category: "physical", description: "lifts & holds <stuff>." },
      "Test Source",
    );
    assert.equal(item.type, "talent");
    assert.equal(item.name, "Big Lift");
    assert.equal(item.img, undefined); // icon assigned at creation, not from source
    assert.equal(item.system.source, "Test Source");
    assert.equal(
      item.system.description.value,
      "Lifts &amp; holds &lt;stuff&gt;.", // capitalized, escaped, not <p>-wrapped
    );
    assert.equal(item.system.description.notes, "");
    assert.deepEqual(item.system.adjustments, []);
  });

  test("sets exactly the one matching category flag", () => {
    const item = pulpTalentItem(
      { name: "Quick Jab", category: "combat", description: "x." },
      "Src",
    );
    assert.deepEqual(item.system.type, {
      physical: false,
      mental: false,
      combat: true,
      miscellaneous: false,
      basic: false,
      insane: false,
      other: false,
    });
  });
});

describe("buildPulpTalents", () => {
  test("parses and builds items in one step", () => {
    const text =
      genTable(3, "PHYSICAL", [[1, "Alpha", "a."]]) +
      " " +
      genTable(5, "COMBAT", [[1, "Bravo", "b."]]);
    const items = buildPulpTalents(text, "Src");
    assert.equal(items.length, 2);
    assert.equal(items[0].system.type.physical, true);
    assert.equal(items[1].system.type.combat, true);
  });
});

// --- delivery (world Item creation) ----------------------------------------

describe("createPulpItems", () => {
  let created: any[];
  let folders: any[];
  let world: any[];
  let notes: string[];

  const parentOf = (f: any) => f?.folder?.id ?? f?.folder ?? null;
  const byName = (name: string) => folders.find((f) => f.name === name);

  beforeEach(() => {
    created = [];
    folders = [];
    world = [];
    notes = [];
    let n = 0;
    (globalThis as any).game = {
      folders: { find: (p: any) => folders.find(p) },
      items: { filter: (p: any) => world.filter(p) },
    };
    (globalThis as any).ui = {
      notifications: {
        info: (m: string) => notes.push(m),
        error: (m: string) => notes.push(m),
      },
    };
    (globalThis as any).Folder = {
      create: async (d: any) => {
        const f = { id: "f" + ++n, ...d };
        folders.push(f);
        return f;
      },
    };
    (globalThis as any).Item = {
      create: async (d: any) => {
        const it: any = { id: "it" + ++n, ...d, deleted: false };
        it.delete = async () => {
          it.deleted = true;
          world.splice(world.indexOf(it), 1);
        };
        created.push(it);
        world.push(it);
        return it;
      },
    };
  });

  afterEach(() => {
    for (const k of ["game", "ui", "Item", "Folder"])
      delete (globalThis as any)[k];
  });

  const talent = (name: string) =>
    pulpTalentItem({ name, category: "physical", description: "x." }, "Src");

  test("creates a document folder with a per-type subfolder holding the items", async () => {
    const res = await createPulpItems([talent("Alpha"), talent("Bravo")], {
      folderName: "Book",
      notify: false,
    });
    assert.equal(res.created, 2);
    const parent = byName("Book");
    const sub = byName("Talents");
    assert.equal(parent.type, "Item");
    assert.equal(parentOf(parent), null); // parent is top-level
    assert.equal(parentOf(sub), parent.id); // subfolder under the document folder
    assert.ok(created.every((i) => i.folder === sub.id)); // items in the subfolder
    // Icon is assigned at creation, per type.
    assert.ok(
      created.every((i) => i.img === "systems/CoC7/assets/icons/skills.svg"),
    );
    assert.equal(notes.length, 0); // notify: false
  });

  test("files each item type into its own subfolder", async () => {
    await createPulpItems(
      [talent("Alpha"), { name: "Hero", type: "archetype", system: {} }],
      { folderName: "Book", notify: false },
    );
    const talents = byName("Talents");
    const archetypes = byName("Archetypes");
    assert.equal(parentOf(talents), byName("Book").id);
    assert.equal(parentOf(archetypes), byName("Book").id);
    assert.equal(created.find((i) => i.name === "Alpha").folder, talents.id);
    assert.equal(created.find((i) => i.name === "Hero").folder, archetypes.id);
  });

  test("reuses existing document + subfolders instead of recreating them", async () => {
    folders.push({ id: "p", name: "Book", type: "Item", folder: null });
    folders.push({ id: "s", name: "Talents", type: "Item", folder: { id: "p" } });
    await createPulpItems([talent("Alpha")], { folderName: "Book", notify: false });
    assert.equal(folders.length, 2); // none created
    assert.equal(created[0].folder, "s");
  });

  test("re-import replaces a same-named item in its subfolder", async () => {
    folders.push({ id: "p", name: "Book", type: "Item", folder: null });
    folders.push({ id: "s", name: "Talents", type: "Item", folder: { id: "p" } });
    const old: any = { id: "old", name: "Alpha", folder: { id: "s" }, deleted: false };
    old.delete = async () => {
      old.deleted = true;
      world.splice(world.indexOf(old), 1);
    };
    world.push(old);
    await createPulpItems([talent("Alpha")], { folderName: "Book", notify: false });
    assert.equal(old.deleted, true); // pre-existing Alpha removed
    assert.equal(world.filter((i) => i.name === "Alpha").length, 1); // exactly one
    assert.equal(created.find((i) => i.name === "Alpha").deleted, false); // new one kept
  });

  test("no items creates nothing and no folders", async () => {
    const res = await createPulpItems([], { folderName: "Book", notify: false });
    assert.equal(res.created, 0);
    assert.equal(folders.length, 0);
  });

  test("notifies by default and reports the created count", async () => {
    await createPulpItems([talent("Alpha")], { folderName: "Book" });
    assert.equal(notes.length, 1);
    assert.match(notes[0], /1 pulp items/);
  });
});
