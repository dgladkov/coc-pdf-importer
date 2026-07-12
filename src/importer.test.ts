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

// A minimal compendium weapon document with the given canonical name.
function weaponDoc(name: string): any {
  return {
    name,
    type: "weapon",
    img: "weapon.svg",
    system: {
      skill: { main: { name: "Firearms (Handgun)" } },
      range: { normal: { damage: "1D10" } },
      properties: { rngd: true },
    },
    flags: {
      CoC7: {
        cocidFlag: {
          id: "i.weapon." + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        },
      },
    },
  };
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
    spells: [],
    sanityLoss: null,
    armor: null,
    background: [],
    items: [],
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
        // Mirror Foundry: assign ids and return the created documents.
        const withIds = docs.map((doc: any) => ({
          ...doc,
          _id: "it" + ++n,
          id: "it" + n,
        }));
        a.items.push(...withIds);
        return withIds;
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

  test("armor maps to attribs.armor (points value + full notes)", async () => {
    await importCharacters(
      [makeCharacter({ armor: "3-point fur and gristle" })],
      { notify: false },
    );
    const armor = created[0].system.attribs.armor;
    assert.equal(armor.value, 3);
    assert.equal(armor.auto, false);
    assert.equal(armor.notes, "3-point fur and gristle");
  });

  test("prose armor (no point value) maps to 0 with notes preserved", async () => {
    await importCharacters(
      [makeCharacter({ armor: "none, but immune to fire" })],
      { notify: false },
    );
    const armor = created[0].system.attribs.armor;
    assert.equal(armor.value, 0);
    assert.equal(armor.notes, "none, but immune to fire");
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

  test("a background block makes the actor an Investigator (character)", async () => {
    await importCharacters(
      [
        makeCharacter({
          name: "Sleuth",
          age: 40,
          background: [
            { title: "Traits", text: "Curious & stubborn." },
            { title: "Significant People", text: "Justice above all." },
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    assert.equal(a.type, "character");
    // The Investigator sheet has no npc-style "special" block.
    assert.equal(a.system.special, undefined);
    // Backstory HTML block + per-section biography rows (escaped).
    assert.match(a.system.backstory, /<h3>Traits<\/h3>/);
    assert.match(a.system.backstory, /Curious &amp; stubborn\./);
    assert.deepEqual(a.system.biography, [
      { title: "Traits", value: "<p>Curious &amp; stubborn.</p>" },
      { title: "Significant People", value: "<p>Justice above all.</p>" },
    ]);
  });

  test("a pregen with no parsed age is still an Investigator via its gear list", async () => {
    await importCharacters(
      [
        makeCharacter({
          name: "Gearhead",
          age: null,
          items: ["notebook", "fountain pen"],
          background: [{ title: "Treasured Possession", text: "a locket" }],
        }),
      ],
      { notify: false },
    );
    assert.equal(created[0].type, "character");
  });

  test("a background without an age or a ties section stays an NPC", async () => {
    // Scenario NPC / villain profile: a description + traits blurb but no age
    // and none of the investigator "ties to the world" sections.
    await importCharacters(
      [
        makeCharacter({
          name: "Villain",
          age: null,
          background: [
            { title: "Personal Description", text: "Tall, gaunt, cold-eyed." },
            { title: "Traits", text: "Ruthless." },
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    assert.equal(a.type, "npc");
    // Not an investigator sheet: no backstory/biography...
    assert.equal(a.system.backstory, undefined);
    assert.equal(a.system.biography, undefined);
    // ...but the background sections are kept in the Keeper notes.
    assert.match(a.system.description.keeper, /<h3>Personal Description<\/h3>/);
    assert.match(a.system.description.keeper, /Tall, gaunt, cold-eyed\./);
    assert.match(a.system.description.keeper, /<h3>Traits<\/h3>/);
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
  test("skills (including languages) become skill items", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: {
            "Spot Hidden": 45,
            "Science (Biology)": 30,
            "Language (Latin)": 25,
          },
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

  test("a custom weapon's backing skill is created and linked by id", async () => {
    await importCharacters(
      [makeCharacter({ combat: [attack("lightning gun", { value: 55, damage: "2D6" })] })],
      { notify: false },
    );
    const a = created[0];
    const weapon = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "lightning gun",
    );
    const skill = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Firearms (lightning gun)",
    );
    assert.ok(skill, "backing skill created");
    assert.equal(skill.system.base, "55");
    // Linked by id so the sheet does not pop a "select weapon skill" modal.
    assert.equal(weapon.system.skill.main.id, skill.id);
    assert.equal(weapon.system.skill.main.name, "Firearms (lightning gun)");
  });

  test("custom weapons with the same value and type share one skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("lightning gun", { value: 50, damage: "2D6" }),
            attack("plasma pistol", { value: 50, damage: "1D10" }),
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const firearms = a.items.filter(
      (i: any) => i.type === "skill" && i.system.specialization === "Firearms",
    );
    assert.equal(firearms.length, 1, "one shared firearms skill");
    const weapons = a.items.filter((i: any) => i.type === "weapon");
    assert.equal(weapons.length, 2);
    for (const w of weapons)
      assert.equal(w.system.skill.main.id, firearms[0].id);
  });

  test("a custom weapon reuses a matching skill already on the actor", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { "Firearms (Handgun)": 45 },
          combat: [attack("snubnose revolver", { value: 45, damage: "1D10" })],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    // No new firearms skill: the weapon reuses "Firearms (Handgun)".
    const firearms = a.items.filter(
      (i: any) => i.type === "skill" && i.system.specialization === "Firearms",
    );
    assert.equal(firearms.length, 1);
    assert.equal(firearms[0].name, "Firearms (Handgun)");
    const weapon = a.items.find((i: any) => i.type === "weapon");
    assert.equal(weapon.system.skill.main.id, firearms[0].id);
  });

  test("an abbreviated firearm matches the compendium weapon but keeps its book name", async () => {
    mockCompendium({
      weapons: [
        weaponDoc(".38 or 9mm Revolver"),
        weaponDoc(".45 Automatic"),
        weaponDoc("12-gauge Shotgun (2B)"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack(".38 revolver", { value: 45, damage: "1D10" }),
            attack(".45 auto", { value: 40, damage: "1D10+2" }),
            attack("12-g shotgun", { value: 40, damage: "4D6/2D6/1D6" }),
          ],
        }),
      ],
      { notify: false },
    );
    const weapons = created[0].items.filter((i: any) => i.type === "weapon");
    // The stat block's own names are kept...
    assert.deepEqual(weapons.map((w: any) => w.name).sort(), [
      ".38 revolver",
      ".45 auto",
      "12-g shotgun",
    ]);
    // ...but the matched compendium weapon supplied the icon and CoCID identity.
    const rev = weapons.find((w: any) => w.name === ".38 revolver");
    assert.equal(rev.img, "weapon.svg");
    assert.match(rev.flags.CoC7.cocidFlag.id, /9mm-revolver/);
  });

  test("Thompson prefers the core 50-mag weapon, then the wiki fallback", async () => {
    mockCompendium({ weapons: [weaponDoc("Thompson (50 mag)"), weaponDoc("Thompson")] });
    await importCharacters(
      [makeCharacter({ combat: [attack("Thompson SMG", { value: 45, damage: "1D10+2" })] })],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.name, "Thompson SMG"); // book name kept
    assert.match(w.flags.CoC7.cocidFlag.id, /thompson-50-mag/); // core weapon used

    created.length = 0;
    mockCompendium({ weapons: [weaponDoc("Thompson")] }); // only the wiki pack
    await importCharacters(
      [makeCharacter({ combat: [attack("Thompson submachine gun", { value: 45, damage: "1D10+2" })] })],
      { notify: false },
    );
    const w2 = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w2.name, "Thompson submachine gun");
    assert.equal(w2.flags.CoC7.cocidFlag.id, "i.weapon.thompson"); // wiki fallback
  });

  test("knife/club size is deduced from damage, ignoring the damage bonus", async () => {
    mockCompendium({
      weapons: [
        weaponDoc("Knife, Small (switchblade, etc.)"),
        weaponDoc("Knife, Medium (carving knife, etc.)"),
        weaponDoc("Knife, Large (machete, etc.)"),
        weaponDoc("Club, small (nightstick)"),
        weaponDoc("Club, large (baseball, cricket bat, poker)"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Switchblade", { value: 40, damage: "1D4+1D6" }), // small (DB die ignored)
            attack("Kitchen knife", { value: 40, damage: "1D4+2+DB" }), // medium
            attack("Hunting knife", { value: 40, damage: "1D8+1D4" }), // large
            attack("Nightstick", { value: 40, damage: "1D6+1D4" }), // small club
            attack("Heavy club", { value: 40, damage: "1D8+1" }), // large club
          ],
        }),
      ],
      { notify: false },
    );
    const cocid = (n: string) =>
      created[0].items.find((i: any) => i.type === "weapon" && i.name === n)
        .flags.CoC7.cocidFlag.id;
    assert.match(cocid("Switchblade"), /knife-small/);
    assert.match(cocid("Kitchen knife"), /knife-medium/);
    assert.match(cocid("Hunting knife"), /knife-large/);
    assert.match(cocid("Nightstick"), /club-small/);
    assert.match(cocid("Heavy club"), /club-large/);
  });

  test("a melee weapon never matches a firearm entry (class-gated)", async () => {
    mockCompendium({ weapons: [weaponDoc(".38 or 9mm Revolver")] });
    await importCharacters(
      [makeCharacter({ combat: [attack("Short sword", { value: 40, damage: "1D8" })] })],
      { notify: false },
    );
    // No compendium match -> a custom weapon named "Short sword".
    assert.ok(
      created[0].items.some((i: any) => i.type === "weapon" && i.name === "Short sword"),
    );
    assert.ok(!created[0].items.some((i: any) => i.name === ".38 or 9mm Revolver"));
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

  test("carried gear becomes generic item documents (quantity 1)", async () => {
    await importCharacters(
      [makeCharacter({ items: ["notebook", "ghost hunting kit (string, matches)"] })],
      { notify: false },
    );
    const gear = created[0].items.filter((i: any) => i.type === "item");
    assert.deepEqual(
      gear.map((g: any) => g.name),
      ["notebook", "ghost hunting kit (string, matches)"],
    );
  });
});

// --- compendium lookup -----------------------------------------------------

// Install a CoC7 skill/weapon/spell compendium on the mocked game global.
function mockCompendium(opts: {
  skills?: any[];
  weapons?: any[];
  spells?: any[];
}) {
  const byCoCID = (docs: any[]) =>
    Object.fromEntries(
      docs.map((d) => [d.flags.CoC7.cocidFlag.id, d]),
    );
  (globalThis as any).game.CoC7 = {
    skillNames: { getList: async () => byCoCID(opts.skills ?? []) },
    cocid: {
      fromCoCIDRegexBest: async ({ cocidRegExp }: { cocidRegExp: RegExp }) =>
        cocidRegExp.source.includes("weapon")
          ? (opts.weapons ?? [])
          : cocidRegExp.source.includes("spell")
            ? (opts.spells ?? [])
            : [],
    },
  };
}

describe("importCharacters — compendium lookup", () => {
  test("a matched skill is cloned (icon + CoCID kept, base overridden)", async () => {
    mockCompendium({
      skills: [
        {
          name: "Spot Hidden",
          type: "skill",
          img: "icons/spot.webp",
          _id: "abc",
          system: { skillName: "Spot Hidden", specialization: "", base: "25" },
          flags: { CoC7: { cocidFlag: { id: "i.skill.spot-hidden" } } },
        },
      ],
    });
    await importCharacters([makeCharacter({ skills: { "Spot Hidden": 65 } })], {
      notify: false,
    });
    const s = item(created[0], "Spot Hidden");
    assert.equal(s.img, "icons/spot.webp");
    assert.equal(s.system.base, "65"); // parsed value applied
    assert.notEqual(s._id, "abc"); // compendium _id stripped; a fresh id assigned
    assert.equal(s.flags.CoC7.cocidFlag.id, "i.skill.spot-hidden");
  });

  test("a specialized skill falls back to the (Any) compendium template", async () => {
    mockCompendium({
      skills: [
        {
          name: "Science (Any)",
          type: "skill",
          img: "icons/science.webp",
          system: {
            skillName: "Any",
            specialization: "Science",
            base: "1",
            properties: { special: true, requiresname: true, picknameonly: true },
          },
          flags: { CoC7: { cocidFlag: { id: "i.skill.science-any" } } },
        },
      ],
    });
    await importCharacters(
      [makeCharacter({ skills: { "Science (Biology)": 50 } })],
      { notify: false },
    );
    const s = item(created[0], "Science (Biology)");
    assert.equal(s.img, "icons/science.webp"); // template's icon
    assert.equal(s.system.skillName, "Biology");
    assert.equal(s.system.specialization, "Science");
    assert.equal(s.system.base, "50");
    assert.equal(s.system.properties.requiresname, false); // no re-prompt
    assert.equal(s.flags.CoC7.cocidFlag.id, "i.skill.science-biology");
  });

  test("a matched weapon is used with its compendium damage + backing skill", async () => {
    mockCompendium({
      skills: [
        {
          name: "Fighting (Brawl)",
          type: "skill",
          system: { skillName: "Brawl", specialization: "Fighting", base: "25" },
          flags: { CoC7: { cocidFlag: { id: "i.skill.fighting-brawl" } } },
        },
      ],
      weapons: [
        {
          name: "Brass Knuckles",
          type: "weapon",
          img: "icons/knuckles.webp",
          system: {
            skill: { main: { name: "i.skill.fighting-brawl" } },
            range: { normal: { damage: "1D3+1" } },
            properties: { rngd: false, addb: true },
          },
          flags: { CoC7: { cocidFlag: { id: "i.weapon.brass-knuckles" } } },
        },
      ],
    });
    await importCharacters(
      [makeCharacter({ combat: [attack("Brass Knuckles", { value: 55, damage: "1D3" })] })],
      { notify: false },
    );
    const a = created[0];
    const weapon = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "Brass Knuckles",
    );
    assert.equal(weapon.img, "icons/knuckles.webp");
    assert.equal(weapon.system.range.normal.damage, "1D3+1"); // compendium damage
    const skill = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Fighting (Brawl)",
    );
    assert.equal(skill.system.base, "55"); // attack skill % applied to backing skill
    assert.equal(skill.flags.CoC7.cocidFlag.id, "i.skill.fighting-brawl");
  });

  test("a compendium weapon whose skill doesn't exist creates that exact named skill", async () => {
    // The weapon references "Firearms (Lightning Gun)" by name, but only the
    // generic "Firearms (Any)" template exists. We must create the exact skill,
    // not fold it into "(Any)" (which would prompt for a specialization).
    mockCompendium({
      skills: [
        {
          name: "Firearms (Any)",
          type: "skill",
          img: "firearms.svg",
          system: {
            skillName: "Any",
            specialization: "Firearms",
            base: "1",
            properties: { special: true, requiresname: true },
          },
          flags: { CoC7: { cocidFlag: { id: "i.skill.firearms-any" } } },
        },
      ],
      weapons: [
        {
          name: "Lightning Gun",
          type: "weapon",
          img: "lg.svg",
          system: {
            skill: { main: { name: "Firearms (Lightning Gun)" } },
            range: { normal: { damage: "1D10" } },
            properties: { rngd: true },
          },
          flags: { CoC7: { cocidFlag: { id: "i.weapon.lightning-gun" } } },
        },
      ],
    });
    await importCharacters(
      [makeCharacter({ combat: [attack("Lightning Gun", { value: 40, damage: "1D10" })] })],
      { notify: false },
    );
    const a = created[0];
    assert.ok(
      a.items.find((i: any) => i.type === "weapon" && i.name === "Lightning Gun"),
    );
    const skill = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Firearms (Lightning Gun)",
    );
    assert.ok(skill, "exact named skill created");
    assert.equal(skill.system.skillName, "Lightning Gun"); // not "Any"
    assert.equal(skill.system.base, "40");
    // No generic "(Any)" skill was added (which would pop the dialog).
    assert.ok(
      !a.items.some((i: any) => i.type === "skill" && i.name === "Firearms (Any)"),
    );
  });

  test("a matched spell is cloned and CoCID-stamped", async () => {
    mockCompendium({
      spells: [
        {
          name: "Wither Limb",
          type: "spell",
          img: "icons/wither.webp",
          system: {},
          flags: { CoC7: { cocidFlag: { id: "i.spell.wither-limb" } } },
        },
      ],
    });
    await importCharacters([makeCharacter({ spells: ["Wither Limb"] })], {
      notify: false,
    });
    const sp = item(created[0], "Wither Limb");
    assert.equal(sp.img, "icons/wither.webp");
    assert.equal(sp.flags.CoC7.cocidFlag.id, "i.spell.wither-limb");
  });

  test("skills and spells are CoCID-stamped even without a compendium", async () => {
    await importCharacters(
      [makeCharacter({ skills: { "Spot Hidden": 40 }, spells: ["Cloud Memory"] })],
      { notify: false },
    );
    assert.equal(
      item(created[0], "Spot Hidden").flags.CoC7.cocidFlag.id,
      "i.skill.spot-hidden",
    );
    assert.equal(
      item(created[0], "Cloud Memory").flags.CoC7.cocidFlag.id,
      "i.spell.cloud-memory",
    );
  });

  // Language templates used in the tests below.
  const LANG_ITEMS = {
    own: {
      name: "Language (Own)",
      type: "skill",
      img: "own.svg",
      system: {
        skillName: "Own",
        specialization: "Language",
        base: "@EDU",
        properties: { special: true, requiresname: true, keepbasevalue: true },
      },
      flags: { CoC7: { cocidFlag: { id: "i.skill.language-own" } } },
    },
    any: {
      name: "Language (Any)",
      type: "skill",
      img: "any.svg",
      system: {
        skillName: "Any",
        specialization: "Language",
        base: "1",
        properties: { special: true, requiresname: true },
      },
      flags: { CoC7: { cocidFlag: { id: "i.skill.language-any" } } },
    },
    english: {
      name: "Language (English)",
      type: "skill",
      img: "english.svg",
      system: {
        skillName: "English",
        specialization: "Language",
        base: "1",
        properties: { special: true },
      },
      flags: { CoC7: { cocidFlag: { id: "i.skill.language-english" } } },
    },
  };

  test("the own template is used even when an exact language item exists", async () => {
    mockCompendium({ skills: [LANG_ITEMS.english, LANG_ITEMS.own, LANG_ITEMS.any] });
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({ EDU: 80 }),
          skills: { "Language (English)": 80, "Language (French)": 30 },
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    // English equals EDU -> the OWN template, not the exact "Language (English)".
    const eng = item(a, "Language (English)");
    assert.equal(eng.img, "own.svg"); // Language (Own), not english.svg
    assert.equal(eng.system.skillName, "English");
    assert.equal(eng.system.base, "@EDU"); // own language tracks EDU
    // French does not equal EDU -> Language (Other) missing -> Language (Any).
    const fr = item(a, "Language (French)");
    assert.equal(fr.img, "any.svg");
    assert.equal(fr.system.skillName, "French");
    assert.equal(fr.system.specialization, "Language");
    assert.equal(fr.system.base, "30");
    assert.equal(fr.system.properties.requiresname, false);
    assert.equal(fr.flags.CoC7.cocidFlag.id, "i.skill.language-french");
  });

  test("a language equal to EDU clones Language (Own); others clone Language (Any)", async () => {
    mockCompendium({ skills: [LANG_ITEMS.own, LANG_ITEMS.any] });
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({ EDU: 75 }),
          skills: { "Language (Tsalal)": 75, "Language (French)": 30 },
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const own = item(a, "Language (Tsalal)"); // equals EDU -> own
    assert.equal(own.img, "own.svg"); // cloned from Language (Own)
    assert.equal(own.system.skillName, "Tsalal");
    assert.equal(own.system.base, "@EDU"); // own language tracks EDU
    assert.equal(own.flags.CoC7.cocidFlag.id, "i.skill.language-tsalal");
    const fr = item(a, "Language (French)"); // not EDU -> Language (Any)
    assert.equal(fr.img, "any.svg");
    assert.equal(fr.system.base, "30"); // concrete value kept
  });

  test("a language above EDU keeps its concrete value (not pinned to EDU)", async () => {
    mockCompendium({ skills: [LANG_ITEMS.own, LANG_ITEMS.any] });
    await importCharacters(
      [
        makeCharacter({
          // An English professor: English is above EDU, so it is not "own".
          characteristics: chars({ EDU: 70 }),
          skills: { "Language (English)": 90 },
        }),
      ],
      { notify: false },
    );
    const eng = item(created[0], "Language (English)");
    assert.equal(eng.img, "any.svg"); // not the own template
    assert.equal(eng.system.base, "90"); // concrete value, not @EDU
  });

  test("languages get the system icon even without a compendium", async () => {
    await importCharacters(
      [makeCharacter({ skills: { "Language (Latin)": 40 } })],
      { notify: false },
    );
    const lat = item(created[0], "Language (Latin)");
    assert.equal(lat.type, "skill");
    assert.equal(lat.img, "systems/CoC7/assets/icons/skills/language.svg");
    assert.equal(lat.system.skillName, "Latin");
    assert.equal(lat.flags.CoC7.cocidFlag.id, "i.skill.language-latin");
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
