// Unit tests for the Foundry actor builder. Foundry's globals (game, ui, Actor,
// Folder) are replaced with a lightweight mock harness that records what would
// be created, so the CoC7 mapping can be checked without a running game.
//
// All character data here is generic placeholder text — no published content.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { importCharacters } from "./importer.ts";
import type { CocCharacter, Characteristics, CombatEntry } from "./process.ts";

// --- generic fixtures ------------------------------------------------------

function chars(values: Record<string, number | null>): Characteristics {
  const out: any = {};
  for (const [k, v] of Object.entries(values))
    out[k] = { value: v, raw: String(v), marked: false };
  return out;
}

function attack(name: string, over: Partial<CombatEntry> = {}): CombatEntry {
  return { name, value: 40, half: 20, fifth: 8, damage: "1D4", note: null, ...over };
}

function makeCharacter(over: Partial<CocCharacter> = {}): CocCharacter {
  return {
    name: "Test Subject",
    age: 30,
    description: "",
    characteristics: {},
    derived: { DB: null, Build: null, Move: null, MP: null, Luck: null },
    attacksPerRound: null,
    combat: [],
    skills: {},
    languages: {},
    spells: [],
    sanityLoss: null,
    notes: [],
    ...over,
  };
}

// --- Foundry mock harness --------------------------------------------------

let created: any[];
let folders: any[];
let world: any[];
let notes: string[];

beforeEach(() => {
  created = [];
  folders = [];
  world = [];
  notes = [];
  let n = 0;
  (globalThis as any).game = {
    i18n: { localize: (k: string) => k, format: (k: string) => k },
    folders: { find: (p: any) => folders.find(p) },
    actors: { filter: (p: any) => world.filter(p) },
    settings: { registerMenu() {} },
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
  (globalThis as any).Actor = {
    create: async (d: any) => {
      const a: any = { id: "a" + ++n, ...d, items: [], updates: [], deleted: false };
      a.createEmbeddedDocuments = async (_type: string, docs: any[]) => {
        a.items.push(...docs);
      };
      a.update = async (u: any) => a.updates.push(u);
      a.delete = async () => (a.deleted = true);
      created.push(a);
      world.push(a);
      return a;
    },
  };
});

afterEach(() => {
  for (const k of ["game", "ui", "Actor", "Folder"])
    delete (globalThis as any)[k];
});

const item = (a: any, name: string) => a.items.find((i: any) => i.name === name);

// --- tests -----------------------------------------------------------------

describe("importCharacters — system data", () => {
  test("maps characteristics, attribs, and infos into CoC7 system data", async () => {
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({
            STR: 60, CON: 55, SIZ: 65, DEX: 50, INT: 70,
            APP: 45, POW: 40, EDU: 80, SAN: 40, HP: 12,
          }),
          derived: { DB: "+1D4", Build: 1, Move: 8, MP: 8, Luck: 55 },
          age: 42,
          description: "night watchman",
        }),
      ],
      { notify: false },
    );
    const s = created[0].system;
    assert.equal(s.characteristics.str.value, 60);
    assert.equal(s.characteristics.edu.value, 80);
    assert.equal(s.characteristics.san, undefined); // SAN/HP are attribs, not chars
    assert.equal(s.attribs.san.value, 40);
    assert.equal(s.attribs.hp.value, 12);
    assert.equal(s.attribs.mp.value, 8);
    assert.equal(s.attribs.mov.value, 8);
    assert.equal(s.attribs.build.value, 1);
    assert.equal(s.attribs.lck.value, 55);
    assert.equal(s.attribs.db.value, "1D4"); // "+1D4" -> "1D4"
    assert.equal(s.infos.age, "42");
    assert.equal(s.infos.occupation, "night watchman");
  });

  test("omits attribs that are absent from the stat block", async () => {
    await importCharacters(
      [makeCharacter({ characteristics: chars({ STR: 50 }) })],
      { notify: false },
    );
    const s = created[0].system;
    assert.equal(s.attribs.mp, undefined);
    assert.equal(s.attribs.lck, undefined);
    assert.equal(s.attribs.db, undefined);
  });

  test("sanity-loss dice split into special.sanLoss", async () => {
    await importCharacters(
      [makeCharacter({ sanityLoss: "1/1D6 Sanity points to see it" })],
      { notify: false },
    );
    assert.deepEqual(created[0].system.special.sanLoss, {
      checkPassed: "1",
      checkFailled: "1D6",
    });
  });

  test("attacks-per-round parses to a leading integer", async () => {
    await importCharacters(
      [makeCharacter({ attacksPerRound: "up to 4 (tendril or consume)" })],
      { notify: false },
    );
    assert.equal(created[0].system.special.attacksPerRound, 4);
  });

  test("sanity loss and notes are escaped into the keeper description", async () => {
    await importCharacters(
      [
        makeCharacter({
          sanityLoss: "1/1D6 to see it",
          notes: ["kept a <secret> & a lie"],
        }),
      ],
      { notify: false },
    );
    const html = created[0].system.description.keeper;
    assert.match(html, /Sanity loss: 1\/1D6 to see it/);
    assert.match(html, /kept a &lt;secret&gt; &amp; a lie/);
  });

  test("imported HP/MP override the auto-derived values", async () => {
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({ HP: 12 }),
          derived: { DB: null, Build: null, Move: null, MP: 15, Luck: null },
        }),
      ],
      { notify: false },
    );
    const u = created[0].updates[0];
    assert.equal(u["system.attribs.hp.auto"], false);
    assert.equal(u["system.attribs.hp.value"], 12);
    assert.equal(u["system.attribs.mp.value"], 15);
  });
});

describe("importCharacters — entity type", () => {
  test("a Sanity-loss stat block is a creature; otherwise an NPC", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Human", sanityLoss: null }),
        makeCharacter({ name: "Monster", sanityLoss: "1/1D6 to see it" }),
      ],
      { notify: false },
    );
    assert.equal(created.find((a) => a.name === "Human").type, "npc");
    assert.equal(created.find((a) => a.name === "Monster").type, "creature");
  });

  test("an explicit entity option overrides the guess", async () => {
    await importCharacters([makeCharacter({ sanityLoss: "1/1D6" })], {
      entity: "npc",
      notify: false,
    });
    assert.equal(created[0].type, "npc");
  });

  test("an empty name falls back to Unknown", async () => {
    await importCharacters([makeCharacter({ name: "" })], { notify: false });
    assert.equal(created[0].name, "Unknown");
  });
});

describe("importCharacters — items", () => {
  test("skills and languages become skill items", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { "Spot Hidden": 45, "Science (Biology)": 30 },
          languages: { Latin: 25 },
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    assert.equal(item(a, "Spot Hidden").type, "skill");
    assert.equal(item(a, "Spot Hidden").system.base, "45");
    const bio = item(a, "Science (Biology)");
    assert.equal(bio.system.specialization, "Science");
    assert.equal(bio.system.skillName, "Biology");
    assert.equal(bio.system.properties.special, true);
    const lang = item(a, "Language (Latin)");
    assert.ok(lang, "language skill created");
    assert.equal(lang.system.skillName, "Latin");
  });

  test("combat entries become weapons backed by fighting/firearm skills", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Brawl", { value: 40, damage: "1D3" }),
            attack(".38 revolver", { value: 35, damage: "1D10" }),
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const brawl = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "Brawl",
    );
    assert.equal(brawl.system.range.normal.damage, "1D3");
    assert.equal(brawl.system.properties.rngd, false);
    assert.equal(item(a, "Fighting (Brawl)").system.properties.fighting, true);
    const rev = a.items.find(
      (i: any) => i.type === "weapon" && i.name === ".38 revolver",
    );
    assert.equal(rev.system.properties.rngd, true);
    assert.equal(
      item(a, "Firearms (.38 revolver)").system.properties.firearm,
      true,
    );
  });

  test("Dodge is a skill, not a weapon", async () => {
    await importCharacters(
      [makeCharacter({ combat: [attack("Dodge", { value: 50, damage: null })] })],
      { notify: false },
    );
    const dodge = item(created[0], "Dodge");
    assert.equal(dodge.type, "skill");
    assert.equal(dodge.system.base, "50");
    assert.ok(
      !created[0].items.some(
        (i: any) => i.type === "weapon" && i.name === "Dodge",
      ),
    );
  });

  test("a maneuver attack sets the mnvr property", async () => {
    await importCharacters(
      [makeCharacter({ combat: [attack("Grab (mnvr)", { damage: "1D6" })] })],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.system.properties.mnvr, true);
  });

  test("a combat note is escaped into the weapon description", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Knife", { damage: "1D4", note: "in <boot> & sheath" })],
        }),
      ],
      { notify: false },
    );
    assert.equal(
      item(created[0], "Knife").system.description.value,
      "<p>in &lt;boot&gt; &amp; sheath</p>",
    );
  });

  test("spells become spell items in order", async () => {
    await importCharacters(
      [makeCharacter({ spells: ["Cloud Memory", "Wither Limb"] })],
      { notify: false },
    );
    const spells = created[0].items.filter((i: any) => i.type === "spell");
    assert.deepEqual(
      spells.map((s: any) => s.name),
      ["Cloud Memory", "Wither Limb"],
    );
  });

  test("a skill shared between the skills list and combat is added once", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { Dodge: 30 },
          combat: [attack("Dodge", { value: 50, damage: null })],
        }),
      ],
      { notify: false },
    );
    const dodges = created[0].items.filter((i: any) => i.name === "Dodge");
    assert.equal(dodges.length, 1);
    assert.equal(dodges[0].system.base, "30"); // first (skills) wins
  });
});

describe("importCharacters — folders and de-duplication", () => {
  test("reuses an existing Actor folder of the same name", async () => {
    folders.push({ id: "existing", name: "My Import", type: "Actor" });
    await importCharacters([makeCharacter()], {
      folderName: "My Import",
      notify: false,
    });
    assert.equal(created[0].folder, "existing");
    assert.equal(folders.length, 1); // none created
  });

  test("creates the named folder when none exists", async () => {
    await importCharacters([makeCharacter()], {
      folderName: "New Folder",
      notify: false,
    });
    assert.equal(folders.length, 1);
    assert.equal(folders[0].name, "New Folder");
    assert.equal(folders[0].type, "Actor");
  });

  test("removes a pre-existing same-named actor before re-importing", async () => {
    folders.push({ id: "fi", name: "Import", type: "Actor" });
    const old: any = {
      id: "old",
      name: "Test Subject",
      folder: { id: "fi" },
      deleted: false,
    };
    old.delete = async () => (old.deleted = true);
    world.push(old);
    await importCharacters([makeCharacter({ name: "Test Subject" })], {
      folderName: "Import",
      notify: false,
    });
    assert.equal(old.deleted, true);
    // the freshly-imported actor of the same name is NOT deleted
    assert.equal(created[0].deleted, false);
  });
});

describe("importCharacters — result and notifications", () => {
  test("returns created / failed counts and surfaces a summary notification", async () => {
    const res = await importCharacters([makeCharacter(), makeCharacter()]);
    assert.equal(res.created, 2);
    assert.equal(res.failed, 0);
    assert.equal(res.actors.length, 2);
    assert.equal(notes.length, 1); // default notify: true
  });

  test("notify: false suppresses the notification", async () => {
    await importCharacters([makeCharacter()], { notify: false });
    assert.equal(notes.length, 0);
  });

  test("a failed Actor.create counts as a failure without aborting the batch", async () => {
    const ok = (globalThis as any).Actor.create;
    (globalThis as any).Actor.create = async (d: any) => {
      if (d.name === "Bad") throw new Error("boom");
      return ok(d);
    };
    const errors: unknown[] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      const res = await importCharacters(
        [makeCharacter({ name: "Good" }), makeCharacter({ name: "Bad" })],
        { notify: false },
      );
      assert.equal(res.created, 1);
      assert.equal(res.failed, 1);
      assert.equal(res.actors.length, 1);
    } finally {
      console.error = realError;
    }
    assert.equal(errors.length, 1);
  });
});
