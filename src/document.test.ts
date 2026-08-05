// Unit tests for the Foundry world-import layer: building Foundry item documents
// from internal PulpItems (pulpItemDoc) and creating them (createPulpItems).
// Foundry's globals (game, ui, Item, Folder) are replaced with a lightweight mock
// harness that records what would be created.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createPulpItems, pulpItemDoc } from "./document.ts";
import type { PulpItem } from "./pulp.ts";

const talent = (name: string): PulpItem => ({
  kind: "talent",
  name,
  category: "physical",
  description: "x.",
});

describe("pulpItemDoc", () => {
  test("builds a talent item matching the CoC7 schema", () => {
    const item = pulpItemDoc(
      {
        kind: "talent",
        name: "Big Lift",
        // Already capitalized by the parser; the doc builder only escapes.
        description: "Lifts & holds <stuff>.",
        category: "physical",
      },
      "Test Source",
    );
    assert.equal(item.type, "talent");
    assert.equal(item.name, "Big Lift");
    assert.equal(item.img, undefined); // icon assigned at creation, not from source
    assert.equal(item.system.source, "Test Source");
    // Escaped, not <p>-wrapped.
    assert.equal(item.system.description.value, "Lifts &amp; holds &lt;stuff&gt;.");
    assert.equal(item.system.description.notes, "");
    assert.deepEqual(item.system.adjustments, []);
    assert.deepEqual(item.system.type, {
      physical: true,
      mental: false,
      combat: false,
      miscellaneous: false,
      basic: false,
      insane: false,
      other: false,
    });
  });

  test("builds an archetype item, resolving skill names to CoCID itemKeys", () => {
    const item = pulpItemDoc(
      {
        kind: "archetype",
        name: "Hard Boiled",
        description: "Tough & <streetwise>.",
        coreCharacteristics: ["con"],
        bonusPoints: 100,
        talents: 2,
        skills: ["Fighting (Brawl)", "Law", "Art/Craft (any)"],
        suggestedOccupations: ["Gangster", "Boxer"],
        suggestedTraits: ["cynical", "violent"],
      },
      "Test Source",
    );
    assert.equal(item.type, "archetype");
    assert.equal(item.name, "Hard Boiled");
    assert.equal(item.img, undefined);
    assert.equal(item.system.source, "Test Source");
    assert.equal(item.system.bonusPoints, 100);
    assert.equal(item.system.talents, 2);
    assert.equal(item.system.coreCharacteristics.con, true);
    assert.equal(item.system.coreCharacteristics.str, false);
    assert.equal(item.system.description.value, "Tough &amp; &lt;streetwise&gt;.");
    // The list arrays are reassembled into strings for the Foundry HTML fields.
    assert.equal(item.system.suggestedOccupations, "Gangster, Boxer");
    assert.equal(item.system.suggestedTraits, "cynical, violent");
    // Skill names resolved to CoCIDs here, at the import boundary.
    assert.deepEqual(item.system.itemKeys, [
      "i.skill.fighting-brawl",
      "i.skill.law",
      "i.skill.art-craft-any",
    ]);
    assert.equal(item.system.coreCharacteristicsFormula.value, "(1D6+13)*5");
    assert.deepEqual(item.system.itemDocuments, []);
  });

  test("builds a hybrid spell with legacy costs and empty costList", () => {
    const item = pulpItemDoc(
      {
        kind: "spell",
        name: "Fog Test",
        castingTime: "1 round",
        costs: {
          magicPoints: "4",
          sanity: "1d2",
          power: "",
          hitPoints: "",
          others: "",
        },
        note: "",
        description: "Makes fog & <mist>.",
      },
      "Test Source",
    );
    assert.equal(item.type, "spell");
    assert.equal(item.system.castingTime, "1 round");
    assert.equal(item.system.costs.magicPoints, "4");
    assert.equal(item.system.costs.sanity, "1d2");
    assert.deepEqual(item.system.costList, []);
    assert.match(item.system.description.value, /Makes fog &amp; &lt;mist&gt;\./);
    assert.equal(item.system.source, "Test Source");
  });

  test("builds a book with keeper relevance/spells and empty itemKeys", () => {
    const item = pulpItemDoc(
      {
        kind: "tome",
        name: "Red Book",
        language: "English",
        author: "Ada",
        date: "1920",
        physical: "Quarto.",
        link: "Library, page 1.",
        description: "A curious volume.",
        relevance: "finale clue.",
        sanityLoss: "1D6",
        cthulhuMythos: { initial: 2, final: 5 },
        mythosRating: 18,
        study: { necessary: 10, units: "CoC7.weeks" },
        spells: "Fog Test",
        region: "",
      },
      "Test Source",
    );
    assert.equal(item.type, "book");
    assert.equal(item.system.language, "English");
    assert.equal(item.system.sanityLoss, "1d6");
    assert.equal(item.system.mythosRating, 18);
    assert.deepEqual(item.system.gains.cthulhuMythos, { initial: 2, final: 5 });
    assert.equal(item.system.type.mythos, true);
    assert.deepEqual(item.system.itemKeys, []);
    assert.match(item.system.description.keeper, /Relevance: finale clue/);
    assert.match(item.system.description.keeper, /Spells: Fog Test/);
  });

  test("builds artefact as item or weapon; keeper holds full text", () => {
    const mundane = pulpItemDoc(
      {
        kind: "artefact",
        name: "Charm",
        link: "Desk.",
        description: "A small charm.",
        keeper: "Link: Desk. Full mechanics here.",
        isWeapon: false,
        region: "",
      },
      "Test",
    );
    assert.equal(mundane.type, "item");
    assert.match(mundane.system.description.keeper, /Full mechanics/);
    const weapon = pulpItemDoc(
      {
        kind: "artefact",
        name: "Blade",
        link: "Armory.",
        description: "",
        keeper: "Deals 1D8 damage.",
        isWeapon: true,
        region: "Peru",
      },
      "Test",
    );
    assert.equal(weapon.type, "weapon");
    assert.equal(weapon.system.properties.spcl, true);
  });
});

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
    // Icon is assigned at creation, per kind.
    assert.ok(
      created.every((i) => i.img === "systems/CoC7/assets/icons/skills.svg"),
    );
    assert.equal(notes.length, 0); // notify: false
  });

  test("files each item kind into its own subfolder", async () => {
    const archetype: PulpItem = {
      kind: "archetype",
      name: "Hero",
      description: "d.",
      coreCharacteristics: [],
      bonusPoints: 100,
      talents: 2,
      skills: [],
      suggestedOccupations: [],
      suggestedTraits: [],
    };
    await createPulpItems([talent("Alpha"), archetype], {
      folderName: "Book",
      notify: false,
    });
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
    assert.match(notes[0], /1 items/);
  });

  test("files spells, tomes, and artefacts into typed subfolders", async () => {
    await createPulpItems(
      [
        {
          kind: "spell",
          name: "Fog Test",
          castingTime: "1 round",
          costs: {
            magicPoints: "1",
            sanity: "1",
            power: "",
            hitPoints: "",
            others: "",
          },
          note: "",
          description: "Makes fog.",
        },
        {
          kind: "tome",
          name: "Fog Tome",
          language: "English",
          author: "A Author",
          date: "1900",
          physical: "Pamphlet.",
          link: "Shelf, page 1.",
          description: "Thin booklet.",
          relevance: "none.",
          sanityLoss: "1D4",
          cthulhuMythos: { initial: 1, final: 2 },
          mythosRating: 9,
          study: { necessary: 2, units: "CoC7.weeks" },
          spells: "Fog Test",
          region: "Egypt",
        },
        {
          kind: "artefact",
          name: "Fog Charm",
          link: "Desk, page 2.",
          description: "A small charm.",
          keeper: "Link: Desk, page 2. A small charm with no combat use.",
          isWeapon: false,
          region: "Peru",
        },
      ],
      { folderName: "Masks", notify: false },
    );
    assert.ok(byName("Spells"));
    assert.ok(byName("Tomes"));
    assert.ok(byName("Artefacts"));
    assert.ok(byName("Peru"));
    assert.ok(byName("Egypt"));
    assert.equal(parentOf(byName("Spells")), byName("Masks").id);
    assert.equal(parentOf(byName("Peru")), byName("Artefacts").id);
    assert.equal(parentOf(byName("Egypt")), byName("Tomes").id);
    assert.equal(created.find((i) => i.name === "Fog Test").type, "spell");
    assert.equal(created.find((i) => i.name === "Fog Tome").type, "book");
    assert.equal(created.find((i) => i.name === "Fog Charm").type, "item");
    assert.equal(
      created.find((i) => i.name === "Fog Charm").folder,
      byName("Peru").id,
    );
    assert.equal(
      created.find((i) => i.name === "Fog Test").img,
      "systems/CoC7/assets/icons/pentagram-rose.svg",
    );
  });
});
