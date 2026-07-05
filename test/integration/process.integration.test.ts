// Integration tests: these run the parser against the real published PDFs.
//
// The PDFs are copyrighted and NOT committed. To run these, place the documents
// listed in fixtures/README.md into the fixtures/ directory, then:
//   npm run test:integration
// Without the fixtures the `before` hooks fail with a clear "fixture not found"
// message — that is expected, they are not part of the normal CI unit suite.
import { describe, test, before } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { processPDF } from "../../src/process.ts";

async function load(file: string) {
  const path = `./fixtures/${file}`;
  let buf: Buffer;
  try {
    buf = await fs.readFile(path);
  } catch {
    throw new Error(
      `Fixture "${file}" not found at ${path}. Integration tests need the ` +
        `copyrighted PDFs — see fixtures/README.md for the list to add.`,
    );
  }
  return processPDF(new Uint8Array(buf));
}

function byName(chars: Awaited<ReturnType<typeof processPDF>>, name: string) {
  const c = chars.find((c) => c.name === name);
  assert.ok(c, `character "${name}" not found`);
  return c;
}

// ---------------------------------------------------------------------------
// Dead Light & Other Dark Turns — standard "Name, age N, desc" format
// ---------------------------------------------------------------------------
describe("Dead Light", () => {
  let chars: Awaited<ReturnType<typeof processPDF>>;
  before(async () => {
    chars = await load("CHA23159_-_Dead_Light_and_Other_Dark_Turns.pdf");
  });

  test("Emilia Webb — characteristics, derived, combat, skills", () => {
    const c = byName(chars, "Emilia Webb");
    assert.equal(c.age, 23);
    assert.equal(c.description, "semi-amnesiac granddaughter");
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(c.characteristics).map(([k, v]) => [k, v!.value]),
      ),
      {
        STR: 40,
        CON: 50,
        SIZ: 45,
        DEX: 70,
        INT: 80,
        APP: 60,
        POW: 50,
        EDU: 85,
        SAN: 50,
        HP: 9,
      },
    );
    assert.deepEqual(c.derived, {
      DB: "0",
      Build: 0,
      Move: 8,
      MP: 10,
      Luck: null,
    });
    assert.deepEqual(c.combat, [
      {
        name: "Brawl",
        value: 25,
        half: 12,
        fifth: 5,
        damage: "1D3",
        note: null,
      },
      {
        name: "Dodge",
        value: 35,
        half: 17,
        fifth: 7,
        damage: null,
        note: null,
      },
    ]);
    assert.equal(c.skills["Science (Biology)"], 30);
    assert.equal(c.skills["Stealth"], 40); // last skill in the list must survive
    assert.equal(c.sanityLoss, null); // ordinary NPCs have no Sanity loss line
  });

  test("Winifred Brewer — negative damage bonus / build", () => {
    const c = byName(chars, "Winifred Brewer");
    assert.equal(c.derived.DB, "-2");
    assert.equal(c.derived.Build, -2);
    assert.equal(c.combat[0].damage, "1D3-2");
  });

  test("Sam Keelham — image caption above the name is not absorbed", () => {
    // "The generator in the cellar" (caption, same font as the name) sits on the
    // line above "Sam Keelham," / "age 48, ..."; only the name line is kept.
    const c = byName(chars, "Sam Keelham");
    assert.equal(c.age, 48);
    assert.equal(c.description, "cowardly gas station manager");
  });

  test("Mary Laker — parenthetical damage notes move to combat.note", () => {
    const c = byName(chars, "Mary Laker");
    const revolver = c.combat.find((a) => a.name === ".22 Revolver");
    assert.ok(revolver, ".22 Revolver attack missing");
    assert.equal(revolver!.damage, "1D6");
    assert.equal(revolver!.note, "not on person, in cash register");
    // Attacks without a note keep note null.
    assert.equal(c.combat.find((a) => a.name === "Brawl")!.note, null);
  });

  test("Dead Light — large creature named from its heading", () => {
    const c = byName(chars, "The Dead Light");
    assert.equal(c.age, null);
    assert.equal(c.characteristics.STR!.value, 70);
    assert.match(c.sanityLoss ?? "", /Dead Light/);
  });

  test("Billy Esterhouse — marked SAN and insanity note", () => {
    const c = byName(chars, "Billy Esterhouse");
    assert.equal(c.characteristics.SAN!.value, 32);
    assert.equal(c.characteristics.SAN!.marked, true);
    assert.equal(c.characteristics.SAN!.raw, "32*");
    assert.match(c.notes[0] ?? "", /indefinitely insane/);
  });
});

// ---------------------------------------------------------------------------
// Masks of Nyarlathotep — Luck, multi-attack combat, Languages, group tables
// ---------------------------------------------------------------------------
describe("Masks of Nyarlathotep", () => {
  let chars: Awaited<ReturnType<typeof processPDF>>;
  before(async () => {
    chars = await load(
      "CHA23153_-_Masks_of_Nyarlathotep_-_Keeper_Reference_Booklet_v3.pdf",
    );
  });

  test("Jackson Elias — full profile", () => {
    const c = byName(chars, "Jackson Elias");
    assert.equal(c.age, 41);
    assert.equal(c.characteristics.STR!.value, 70);
    assert.equal(c.characteristics.SAN!.value, 76);
    assert.equal(c.derived.Luck, 80);
    assert.equal(c.derived.DB, "+1D4");
    // Multi-attack combat: brawl (with "or weapon"), revolver, dodge.
    const revolver = c.combat.find((a) => a.name === ".45 revolver");
    assert.ok(revolver, ".45 revolver attack missing");
    assert.equal(revolver!.damage, "1D10+2");
    assert.equal(
      c.combat.find((a) => a.name === "Brawl")!.damage,
      "1D3+1D4 or weapon",
    );
    assert.ok(c.combat.some((a) => a.name === "Dodge"));
    // Languages parsed separately from skills.
    assert.equal(c.languages["English"], 85);
    assert.equal(c.skills["Cthulhu Mythos"], 4);
    assert.equal(c.skills["Survival (Mountains)"], 25);
    assert.equal(c.attacksPerRound, "1");
    assert.deepEqual(c.spells, []); // Jackson is not a spellcaster
  });

  test("name stops at a sentence boundary but keeps title abbreviations", () => {
    // "...Spells: Wave of Oblivion. Sir Aubrey Penhew, appears 55, ..." — the
    // trailing spell name from the previous block must not join the name.
    assert.ok(byName(chars, "Sir Aubrey Penhew"));
    // Abbreviations / initials are still preserved.
    assert.ok(byName(chars, "Dr. Mordecai Lemming"));
    assert.ok(byName(chars, "Robert B. F. Mackenzie"));
  });

  test("Edward Gavigan — comma-separated spell list", () => {
    const c = byName(chars, "Edward Gavigan");
    assert.ok(
      c.spells.length >= 15,
      `expected many spells, got ${c.spells.length}`,
    );
    assert.ok(c.spells.includes("Contact Nyarlathotep"));
    assert.ok(c.spells.includes("Shrivelling"));
    // Asterisk markers are stripped from names.
    assert.ok(c.spells.includes("Pharaoh's Breath"));
    assert.ok(c.spells.every((s) => !s.includes("*")));
  });

  test("weapon names with an internal caliber dot stay intact", () => {
    const c = byName(chars, "Lt. Martin Poole");
    assert.ok(
      c.combat.some((a) => a.name === "Colt .38 revolver"),
      "Colt .38 revolver should be one attack, not split at the dot",
    );
    // "Colt" must not leak into the previous attack's damage.
    assert.equal(
      c.combat.find((a) => a.name === "Brawl")!.damage,
      "1D3+1D4 or blackjack 1D8+1D4",
    );
  });

  test("page furniture spanning a page break is stripped from combat", () => {
    // The Bloated Woman's Sickle attack straddles a page break; the running
    // header / side title / page numbers must not leak into its damage.
    const c = byName(chars, "The Bloated Woman");
    assert.equal(c.combat.find((a) => a.name === "Sickle")!.damage, "1D4+3D6");
  });

  test("prose-embedded monster is named from its heading font size", () => {
    // "Shantak" heading (taller font) sits directly before its blurb; the
    // concatenated text alone could not separate it from "Enormous bird-like...".
    assert.ok(byName(chars, "Shantak"));
    // The comma-descriptor heading keeps name and descriptor apart.
    const nitocris = byName(chars, "Sharifa Rawash (a.k.a. Nitocris)");
    assert.equal(nitocris.description, "the revivified queen");
  });

  test("names with tricky tokens are recovered", () => {
    // "(Cultist #2)" parenthetical (the "#2)" fragment has no letters).
    assert.ok(byName(chars, "Colm Doyle (Cultist #2)"));
    // Lowercase-particle surname "al-Dhahabi".
    assert.ok(byName(chars, "Ahmed al-Dhahabi"));
    // Shared-profile block named before "Use this profile ...".
    assert.ok(byName(chars, "Lascars"));
  });

  test("group member name drops a same-font section title on the line above", () => {
    // "Elias' Murderers" (group title) sits on the line above "Iregi Kipkemboi
    // (Cultist #1), 23, ..." at the same font size; the age line wins.
    assert.ok(byName(chars, "Iregi Kipkemboi (Cultist #1)"));
  });

  test("percentage-only attacks and footnote markers split into records", () => {
    const c = byName(chars, "Bloody Tongue Cultists (Nyc) 1");
    // "Panga 45%, damage 1D8" — no (half/fifth) in the source; derived here.
    const panga = c.combat.find((a) => a.name === "Panga")!;
    assert.equal(panga.value, 45);
    assert.equal(panga.half, 22);
    assert.equal(panga.fifth, 9);
    assert.equal(panga.damage, "1D8");
    // ".22 revolver*" — footnote marker stripped, kept as its own attack.
    const revolver = c.combat.find((a) => a.name === ".22 revolver")!;
    assert.equal(revolver.value, 30);
    assert.equal(revolver.damage, "1D6");
    // The brawl damage must not swallow the following attacks.
    assert.equal(
      c.combat.find((a) => a.name === "Brawl")!.damage,
      "1D3 or small knife/straight razor 1D4",
    );
  });

  test("Bloody Tongue Cultists — group table expands to 8 members", () => {
    // Two regional Bloody Tongue tables exist; the "(Nyc)" region qualifier keeps
    // them distinct ("(Kenya)" is the other) instead of colliding.
    const members = chars.filter((c) =>
      /^Bloody Tongue Cultists \(Nyc\) \d+$/.test(c.name),
    );
    assert.equal(members.length, 8);
    // Column 1: STR 60 CON 75 SIZ 60 (per the reference table).
    const first = byName(chars, "Bloody Tongue Cultists (Nyc) 1");
    assert.equal(first.characteristics.STR!.value, 60);
    assert.equal(first.characteristics.CON!.value, 75);
    // Each member gets its own column's values.
    assert.equal(
      byName(chars, "Bloody Tongue Cultists (Nyc) 2").characteristics.STR!.value,
      50,
    );
  });

  test("lettered squad tables are qualified with the group title", () => {
    // "Cultist Squad A" table with columns A1..A5 -> "Cultist Squad A1".."A5",
    // rather than a bare, contextless "A1".
    for (const n of [
      "Cultist Squad A1",
      "Cultist Squad A5",
      "Cultist Squad D5",
    ]) {
      assert.ok(byName(chars, n), `${n} missing`);
    }
  });

  test("group name is not polluted by the previous block's combat line", () => {
    // The running header that separated the blocks is stripped as furniture, so
    // the "Steadfast Constables" title follows "...Dodge 35% (17/7)" directly;
    // the trailing "Dodge" must not be absorbed into the group name.
    assert.equal(
      chars.filter((c) => /^Steadfast Constables/.test(c.name)).length,
      8,
    );
    assert.ok(
      chars.every((c) => !/^Dodge /.test(c.name)),
      'a name began with "Dodge"',
    );
  });

  test("far section-heading title names a group behind a prose blurb", () => {
    // "CRAZED CREW OF THE DARK MISTRESS" is set at section-heading size and sits
    // above a long blurb, out of reach of the label-prefix and name-height
    // paths; the section-heading fallback still names its 6 members.
    assert.equal(
      chars.filter((c) => /^Crazed Crew of the Dark Mistres/.test(c.name))
        .length,
      6,
    );
    // With that recovery, no group falls back to a bare "NPC N".
    assert.ok(
      chars.every((c) => !/^NPC \d+$/.test(c.name)),
      'a group fell back to "NPC N"',
    );
  });
});

// ---------------------------------------------------------------------------
// Core Rulebook scenarios — heading-named groups with letter-spaced labels
// ---------------------------------------------------------------------------
describe("Core Rulebook scenarios", () => {
  let chars: Awaited<ReturnType<typeof processPDF>>;
  before(async () => {
    chars = await load("CHA23178-Book3-Scenarios-2026-download.pdf");
  });

  test("heading-named group with shattered labels is numbered, not fragmented", () => {
    // "SIX MOBSTERS" sits far above its table (past a blurb) so the prefix walk
    // can't reach it — the font-size heading supplies the name. Its columns are
    // letter-spaced member names ("Fergie" -> "Fergi","e"); the shattered row is
    // rejected and members are numbered from the heading instead.
    assert.equal(
      chars.filter((c) => /^Six Mobsters \d+$/.test(c.name)).length,
      6,
    );
    assert.ok(byName(chars, "Six Zombies 1"));
    assert.ok(byName(chars, "Six Policemen 6"));
    // No stray single-letter fragment ("e", "i") survives as a name.
    assert.ok(
      chars.every((c) => c.name.length > 1),
      "a single-character name survived",
    );
  });

  test("group with Combat/Skills printed before the stat table", () => {
    // "SIX POLICEMEN" prints its shared Combat and Skills sections ahead of the
    // "1 2 3 4 5 6 / STR ..." table, so they precede STR and fall outside the
    // block body; they are recovered from the pre-table region.
    const p = byName(chars, "Six Policemen 1");
    assert.equal(p.combat.find((a) => a.name === "Brawl")!.value, 40);
    assert.ok(p.combat.some((a) => /revolver/i.test(a.name)));
    assert.ok(p.combat.some((a) => a.name === "Dodge"));
    assert.ok(Object.keys(p.skills).length > 5, "skills also recovered");
  });
});

// ---------------------------------------------------------------------------
// Gateways to Terror — "Name: <Archetype>, age N" pre-generated format
// ---------------------------------------------------------------------------
describe("Gateways to Terror", () => {
  let chars: Awaited<ReturnType<typeof processPDF>>;
  before(async () => {
    chars = await load("CHA23140_-_Gateways_to_Terror_1.1.pdf");
  });

  test("Archaeologist archetype", () => {
    const c = byName(chars, "Archaeologist");
    assert.equal(c.age, 36);
    assert.equal(c.characteristics.STR!.value, 60);
    assert.ok(Object.keys(c.skills).length > 5);
  });

  test("Abomination — large creature named from its (font-size) heading", () => {
    // Heading "The Abomination, creature of the Necropolis" sits before a long
    // blurb; the taller name font recovers it despite the distance from STR.
    const c = byName(chars, "The Abomination");
    assert.equal(c.characteristics.STR!.value, 200);
    assert.equal(c.description, "creature of the Necropolis");
    assert.match(c.sanityLoss ?? "", /Abomination/);
  });

  test('Abomination — combat recovered without a "Combat" heading', () => {
    // This block has no "Combat" label — it leads with "Special Powers" then
    // "Attacks per round", and the profiles follow a paragraph of prose.
    const c = byName(chars, "The Abomination");
    assert.equal(c.combat.find((a) => a.name === "Fighting")!.damage, "3D6");
    assert.equal(c.combat.find((a) => a.name === "Khopesh")!.damage, "1D6+3D6");
    assert.ok(c.combat.some((a) => a.name === "Dodge" && a.value === 17));
    assert.match(c.attacksPerRound ?? "", /punch/);
  });

  test("The Author — investigator combat listed with no section heading", () => {
    // The pre-gen investigator lists "Fighting (Brawl) 40% (20/8)... Dodge 25%"
    // bare between the derived stats and "Skills", with no "Combat" heading.
    const c = byName(chars, "The Author");
    assert.equal(
      c.combat.find((a) => a.name === "Fighting (Brawl)")!.value,
      40,
    );
    assert.ok(c.combat.some((a) => a.name === "Dodge" && a.value === 25));
  });
});

// ---------------------------------------------------------------------------
// Doors to Darkness — ALL-CAPS names, "(3D6 x 5)" roll formulas
// ---------------------------------------------------------------------------
describe("Doors to Darkness", () => {
  let chars: Awaited<ReturnType<typeof processPDF>>;
  before(async () => {
    chars = await load("CHA23148_-_Doors_to_Darkness_v1.1.pdf");
  });

  test("Andrew Macbride — ALL-CAPS name with age", () => {
    const c = byName(chars, "ANDREW MACBRIDE");
    assert.equal(c.age, 56);
    assert.equal(c.characteristics.STR!.value, 80);
  });

  test("NPC named from an ALL-CAPS heading before a description paragraph", () => {
    // "BILL DUNSTON, taciturn tenant  A quiet, sour-faced man ..." — heading far
    // from STR, recovered by the widened block-start search.
    const c = byName(chars, "BILL DUNSTON");
    assert.ok(c.characteristics.STR);
  });

  test("roll-formula archetype tables do not create phantom columns", () => {
    // "(3D6 x 5)" formulas must not be read as extra group columns.
    for (const c of chars) {
      assert.ok(c.characteristics.STR, `${c.name} lost its STR characteristic`);
    }
  });
});

// ---------------------------------------------------------------------------
// Quick-Start Rules — "(Hard NN/Extreme NN)" profiles + maneuver attacks
// ---------------------------------------------------------------------------
describe("Quick-Start Rules", () => {
  let chars: Awaited<ReturnType<typeof processPDF>>;
  before(async () => {
    chars = await load(
      "CHA23131 Call of Cthulhu 7th Edition Quick-Start Rules.pdf",
    );
  });

  test("RAT PACK — Hard/Extreme profiles and a profile-less maneuver", () => {
    const c = byName(chars, "RAT PACK");
    assert.equal(c.attacksPerRound, "1");
    assert.deepEqual(
      c.combat.find((a) => a.name === "Fighting"),
      {
        name: "Fighting",
        value: 40,
        half: 20,
        fifth: 8,
        damage: "1D3",
        note: null,
      },
    );
    const overwhelm = c.combat.find(
      (a) => a.name === "Overwhelm (fighting maneuver)",
    );
    assert.ok(overwhelm, "Overwhelm maneuver missing");
    assert.equal(overwhelm!.value, null);
    assert.equal(overwhelm!.damage, "2D6");
    assert.deepEqual(
      c.combat.find((a) => a.name === "Dodge"),
      {
        name: "Dodge",
        value: 42,
        half: 21,
        fifth: 8,
        damage: null,
        note: null,
      },
    );
  });

  test('Walter Corbitt — "(Hard 25%/Extreme10%)" profile, spelled-out derived, verbose damage', () => {
    const c = byName(chars, "Walter Corbitt");
    assert.equal(c.derived.DB, "+1D4"); // "Damage bonus : +1D4"
    assert.equal(c.derived.Build, 1);
    assert.equal(c.derived.MP, 18); // "Magic points: 18 (...)"
    const fighting = c.combat.find((a) => a.name === "Fighting");
    assert.ok(fighting, "Fighting attack missing");
    assert.equal(fighting!.value, 50);
    assert.equal(fighting!.half, 25);
    assert.equal(fighting!.fifth, 10);
    // Verbose damage keeps "damage bonus(1D4)" intact; prose note goes to note.
    assert.match(fighting!.damage ?? "", /1D3 \+ damage bonus\(1D4\)/);
    assert.ok(c.combat.some((a) => a.name === "Dodge" && a.value === 17));
  });

  test("Walter Corbitt — spell list bounded at the sentence end", () => {
    const c = byName(chars, "Walter Corbitt");
    assert.deepEqual(c.spells, [
      "Dominate",
      "Flesh Ward",
      "Summon/Bind Dimensional Shambler",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The Lightless Beacon — verbose prose combat (effect descriptions inline)
// ---------------------------------------------------------------------------
describe("The Lightless Beacon", () => {
  let chars: Awaited<ReturnType<typeof processPDF>>;
  before(async () => {
    chars = await load("The Lightless Beacon - Call of Cthulhu.pdf");
  });

  test("Youngling — inline effect prose does not create phantom attacks", () => {
    const c = byName(chars, "Youngling");
    // Exactly three real attacks; the "1D3 Latch damage each round ..." effect
    // prose must not become "D3"/"Latch" attacks.
    assert.deepEqual(
      c.combat.map((a) => a.name),
      ["Fighting", "Projectile Needle", "Dodge"],
    );
    const fighting = c.combat.find((a) => a.name === "Fighting")!;
    assert.equal(fighting.value, 40);
    assert.equal(fighting.damage, "1D3+1D4"); // prose after the comma is dropped
    const needle = c.combat.find((a) => a.name === "Projectile Needle")!;
    assert.equal(needle.value, 30); // name not prefixed with "Hard STR roll"
  });
});
