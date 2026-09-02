// Unit tests for the Down Darker Trails (Old West) parsers. Synthetic prose
// only — mirrors the book's structural framing (bullet labels, table headers,
// column layout, the book's own fixed occupation/skill name lists which the
// parser anchors on) without copyrighted descriptions or stat values.
import { describe, test } from "node:test";
import assert from "node:assert";
import {
  parseOldWestOccupations,
  parseOldWestSkills,
  parseOldWestWeapons,
  parseOldWestSpells,
  parseOldWestItems,
} from "./oldwest.ts";

// The occupations chapter's running header — the parser's guard that the text
// is this book at all (its bullet anchors and names are generic).
const MARKER = "12 12 OLD WEST INVESTIGATORS ";

describe("parseOldWestOccupations", () => {
  // The book's occupations are printed in a fixed alphabetical order the parser
  // anchors on; "Artist" and "Confidence Trickster" are the first two.
  const TWO_OCCUPATIONS =
    MARKER +
    "Artist Generic flavor text about artists goes here. " +
    "• Occupation Skill Points: EDU × 2 + (DEX × 2 or POW × 2). " +
    "• Credit Rating: 6–60. " +
    "• Skills: History, Library Use, one interpersonal skill (Charm, Fast Talk, or Persuade), any two other skills as personal or era specialties. " +
    "Confidence Trickster Generic flavor text about tricksters goes here. " +
    "• Occupation Skill Points: EDU × 4. " +
    "• Credit Rating: 10–80. " +
    "• Skills: Disguise, Dodge. " +
    "• Special: limited Sanity loss immunity (loses minimum possible for seeing blood and gore). " +
    "SKILL LIST more text follows.";

  test("parses points, credit rating, common skills, a choice group, and personal specialties", () => {
    const [artist] = parseOldWestOccupations(TWO_OCCUPATIONS);
    assert.equal(artist.name, "Artist");
    assert.equal(
      artist.description,
      "Generic flavor text about artists goes here.",
    );
    assert.deepEqual(artist.occupationSkillPoints, {
      edu: { multiplier: 2, selected: true, optional: false },
      dex: { multiplier: 2, selected: true, optional: true },
      pow: { multiplier: 2, selected: true, optional: true },
    });
    assert.deepEqual(artist.creditRating, { min: 6, max: 60 });
    assert.deepEqual(artist.skills, ["History", "Library Use"]);
    assert.deepEqual(artist.groups, [
      { options: 1, skills: ["Charm", "Fast Talk", "Persuade"] },
    ]);
    assert.equal(artist.personal, 2);
    assert.equal(
      artist.personalText,
      "other skills as personal or era specialties",
    );
    assert.equal(artist.special, "");
  });

  test("parses a trailing Special clause bounded at its own sentence, and a mandatory-only points formula", () => {
    const [, trickster] = parseOldWestOccupations(TWO_OCCUPATIONS);
    assert.equal(trickster.name, "Confidence Trickster");
    assert.deepEqual(trickster.occupationSkillPoints, {
      edu: { multiplier: 4, selected: true, optional: false },
    });
    assert.deepEqual(trickster.creditRating, { min: 10, max: 80 });
    assert.deepEqual(trickster.skills, ["Disguise", "Dodge"]);
    assert.equal(
      trickster.special,
      "limited Sanity loss immunity (loses minimum possible for seeing blood and gore)",
    );
  });

  test("tolerates a dropped-cap 'C redit Rating' kerning artifact", () => {
    const text =
      MARKER +
      "Artist Flavor text here. " +
      "• Occupation Skill Points: EDU × 4. " +
      "• C redit Rating: 9–20. " +
      "• Skills: Climb, Jump.";
    const [artist] = parseOldWestOccupations(text);
    assert.deepEqual(artist.creditRating, { min: 9, max: 20 });
  });

  test("returns [] when no occupation section is present", () => {
    assert.deepEqual(parseOldWestOccupations("just some prose"), []);
  });

  test("returns [] for another book's occupation list (no Old West running header)", () => {
    // Pulp Cthulhu / the core rules print the same "Occupation Skill Points:"
    // bullets and use generic occupation names; without this book's running
    // header none of it is Old West content.
    const text =
      "Doctor Flavor text. • Occupation Skill Points: EDU × 4. • Credit Rating: 30–80. " +
      "• Suggested Contacts: hospitals. • Skills: First Aid, Medicine. " +
      "Farmer Flavor. • Occupation Skill Points: EDU × 2 + (DEX × 2 or STR × 2). • Credit Rating: 9–30. • Skills: Natural World.";
    assert.deepEqual(parseOldWestOccupations(text), []);
  });
});

describe("parseOldWestSkills", () => {
  // ALTERED_SKILL_NAMES / NEW_SKILL_NAMES are the book's own fixed lists; using
  // its first altered and first new entry is enough to exercise both formats.
  const TEXT =
    "ALTERED AND NEW SKILLS intro sentence. ALTERED SKILLS " +
    "Drive Auto (00%): generic altered-skill filler sentence about driving. " +
    "NEW SKILLS " +
    "Gambling (10%) Generic new-skill filler sentence about wagering. " +
    "Opposing skill/Difficulty level: filler. " +
    "Pushing examples: filler. " +
    "Sample Consequences of failing a Pushed roll: filler. " +
    "If an insane investigator fails a pushed roll, generic bad thing happens. " +
    "Illustration caption that must not leak into the description. " +
    "EQUIPMENT & WEAPONS next chapter starts here.";

  test("parses a colon-separated altered skill", () => {
    const skills = parseOldWestSkills(TEXT);
    const driveAuto = skills.find((s) => s.name === "Drive Auto")!;
    assert.equal(driveAuto.base, "00%");
    assert.equal(
      driveAuto.description,
      "generic altered-skill filler sentence about driving.",
    );
  });

  test("parses a colon-less new skill, bounded at its Push-consequence sentence", () => {
    const skills = parseOldWestSkills(TEXT);
    const gambling = skills.find((s) => s.name === "Gambling")!;
    assert.equal(gambling.base, "10%");
    assert.ok(gambling.description.startsWith("Generic new-skill filler"));
    assert.ok(
      gambling.description.endsWith(
        "If an insane investigator fails a pushed roll, generic bad thing happens.",
      ),
      gambling.description,
    );
    assert.ok(!gambling.description.includes("Illustration caption"));
  });

  test("returns [] when neither ALTERED SKILLS nor NEW SKILLS is present", () => {
    assert.deepEqual(parseOldWestSkills("just some prose"), []);
  });
});

describe("parseOldWestWeapons", () => {
  const FIREARM_TEXT =
    "REVOLVERS " +
    "• All use the Firearms (Handgun) skill, base 20%. " +
    "• All are capable of impaling with an Extreme success. " +
    "Gun Damage Base Range Uses per Round Bullets Malf. Cost Availability " +
    "Test Six-Shooter 1D8 15 1 (3) 6 99 $9 U " +
    "HOLDOUT WEAPONS " +
    "• All use the Firearms (Handgun) skill, base 20%. " +
    "Gun Damage Base Range Uses per Round Bullets Malf. Cost Availability " +
    "Test Palm Pistol 1D6 3 1 2 98 $3 C " +
    "MELEE WEAPONS " +
    "• *Impaling weapon. " +
    "Weapon Skill Damage Base Range Uses per Round Malf. Cost Availability " +
    "Test Dagger* Fighting (Brawl) 1D4+DB Touch 1 N/A $2 C " +
    "Test Sling Rope Use or Throw entangle 5 feet 1 100 - C";

  test("parses a firearm row using its table's default skill", () => {
    const weapons = parseOldWestWeapons(FIREARM_TEXT);
    const revolver = weapons.find((w) => w.name === "Test Six-Shooter")!;
    assert.equal(revolver.skill, "Firearms (Handgun)");
    assert.equal(revolver.damage, "1D8");
    assert.equal(revolver.baseRange, "15");
    assert.equal(revolver.usesPerRound, "1 (3)");
    assert.equal(revolver.bullets, 6);
    assert.equal(revolver.malfunction, 99);
    assert.equal(revolver.cost, "$9");
    assert.equal(revolver.availability, "U");
    assert.equal(revolver.impale, true);
    assert.equal(revolver.ranged, true);
  });

  test("keeps separate tables' rows from bleeding into each other", () => {
    const weapons = parseOldWestWeapons(FIREARM_TEXT);
    assert.ok(weapons.find((w) => w.name === "Test Palm Pistol"));
    assert.equal(weapons.length, 4);
  });

  test("parses a melee row's own Skill column and strips a trailing impale marker", () => {
    const weapons = parseOldWestWeapons(FIREARM_TEXT);
    const dagger = weapons.find((w) => w.name === "Test Dagger")!;
    assert.equal(dagger.skill, "Fighting (Brawl)");
    // The book's literal "+DB" is kept source-faithful here; document.ts splits
    // it into the CoC7 addb flag when building the Foundry weapon document.
    assert.equal(dagger.damage, "1D4+DB");
    assert.equal(dagger.impale, true);
    assert.equal(dagger.malfunction, null); // "N/A"
  });

  test("marks a 'Rope Use or Throw' melee weapon as thrown, with an entangle damage", () => {
    const weapons = parseOldWestWeapons(FIREARM_TEXT);
    const sling = weapons.find((w) => w.name === "Test Sling")!;
    assert.equal(sling.damage, "entangle");
    assert.equal(sling.thrown, true);
    assert.equal(sling.cost, "-");
  });

  test("returns [] when no weapon table is present", () => {
    assert.deepEqual(parseOldWestWeapons("just some prose"), []);
  });
});

describe("parseOldWestSpells", () => {
  const TEXT =
    "THE SUPERNATURAL WEST intro paragraph goes here, ending in a period. " +
    "SHAMANIC (FOLK) MAGIC intro prose. " +
    "• Alter Weather (Folk) • Augur (Folk) index bullets before the write-ups. " +
    "Alter Weather (Folk) " +
    "• Cost: 10+ magic points; 1 Sanity point " +
    "• Casting time: 3+ minutes " +
    "Generic filler description about weather magic goes here. " +
    "Augur (Folk) " +
    "• Cost: 4 magic points; 1D2 Sanity points " +
    "• Casting time: 5+ minutes " +
    "Generic filler description about scrying goes here. " +
    "CULTS AND SECRET SOCIETIES next section starts here.";

  test("parses a mixed-case title with a trailing '(Folk)' note, cost, and casting time", () => {
    const [alterWeather] = parseOldWestSpells(TEXT);
    assert.equal(alterWeather.name, "Alter Weather (Folk)");
    assert.equal(alterWeather.castingTime, "3+ minutes");
    assert.deepEqual(alterWeather.costs, {
      magicPoints: "10+",
      sanity: "1",
      power: "",
      hitPoints: "",
      others: "",
    });
    assert.equal(
      alterWeather.description,
      "Generic filler description about weather magic goes here.",
    );
  });

  test("does not leak the following spell's title into the previous description", () => {
    const [alterWeather] = parseOldWestSpells(TEXT);
    assert.ok(!alterWeather.description.includes("Augur"));
    const augur = parseOldWestSpells(TEXT)[1];
    assert.equal(augur.name, "Augur (Folk)");
  });

  test("returns [] when no shamanic/folk magic section is present", () => {
    assert.deepEqual(parseOldWestSpells("just some prose"), []);
  });
});

describe("parseOldWestItems", () => {
  test("tags each parsed kind and aggregates across occupations/skills/weapons/spells", () => {
    const text =
      MARKER +
      "Artist Flavor. • Occupation Skill Points: EDU × 4. • Credit Rating: 9–20. • Skills: Climb. " +
      "ALTERED AND NEW SKILLS. ALTERED SKILLS Drive Auto (00%): filler. NEW SKILLS Gambling (10%) filler. EQUIPMENT & WEAPONS " +
      "REVOLVERS • All use the Firearms (Handgun) skill, base 20%. Gun Damage Base Range Uses per Round Bullets Malf. Cost Availability " +
      "Test Gun 1D6 10 1 6 99 $5 C MELEE WEAPONS Weapon Skill Damage Base Range Uses per Round Malf. Cost Availability " +
      "Test Club Fighting (Brawl) 1D6+DB Touch 1 N/A $1 C " +
      "SHAMANIC (FOLK) MAGIC intro. Test Spell (Folk) • Cost: 1 magic point • Casting time: 1 round Filler. CULTS AND SECRET SOCIETIES";
    const items = parseOldWestItems(text);
    const kinds = items.map((i) => i.kind).sort();
    assert.deepEqual(kinds, [
      "occupation",
      "oldWestSkill",
      "oldWestSkill",
      "oldWestWeapon",
      "oldWestWeapon",
      "spell",
    ]);
  });

  test("returns [] for a document with none of this book's sections", () => {
    assert.deepEqual(parseOldWestItems("just some prose"), []);
  });
});
