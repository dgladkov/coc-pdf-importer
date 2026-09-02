// Unit tests for Chaosium appendix parsers. Synthetic text only — mirrors
// structure (Cost/Casting time, tome bullets, artefact Link) without
// copyrighted Masks prose.
import { describe, test } from "node:test";
import assert from "node:assert";
import {
  parseSpellCosts,
  parseStudyUnits,
  parseAppendixSpells,
  parseAppendixTomes,
  parseAppendixArtefacts,
  parseAppendixItems,
  isArtefactWeapon,
  splitArtefactBlurb,
} from "./appendix.ts";

describe("parseSpellCosts", () => {
  test("maps mp, san, pow, hp clauses", () => {
    assert.deepEqual(parseSpellCosts("4 magic points; 1D2 Sanity points"), {
      magicPoints: "4",
      sanity: "1d2",
      power: "",
      hitPoints: "",
      others: "",
    });
    assert.deepEqual(parseSpellCosts("5 POW; 1D6 Sanity points"), {
      magicPoints: "",
      sanity: "1d6",
      power: "5",
      hitPoints: "",
      others: "",
    });
    assert.deepEqual(
      parseSpellCosts("variable magic points; 1D4 Sanity points"),
      {
        magicPoints: "variable",
        sanity: "1d4",
        power: "",
        hitPoints: "",
        others: "",
      },
    );
  });

  test("puts unknown clauses in others", () => {
    const c = parseSpellCosts("3 magic points; a rare gem");
    assert.equal(c.magicPoints, "3");
    assert.equal(c.others, "a rare gem");
  });

  test("accepts per-round and all-remaining cost forms", () => {
    const per = parseSpellCosts("5 magic points per round; 1D10 Sanity points");
    assert.equal(per.magicPoints, "5");
    assert.equal(per.sanity, "1d10");
    assert.match(per.others, /per round/i);
    const all = parseSpellCosts(
      "all remaining magic points; all remaining POW; all remaining Sanity points",
    );
    assert.equal(all.magicPoints, "all remaining");
    assert.equal(all.power, "all remaining");
    assert.equal(all.sanity, "all remaining");
  });
});

describe("parseStudyUnits", () => {
  test("maps week/day/month/hour to CoC7 keys", () => {
    assert.equal(parseStudyUnits("weeks"), "CoC7.weeks");
    assert.equal(parseStudyUnits("day"), "CoC7.days");
    assert.equal(parseStudyUnits("Months"), "CoC7.months");
  });
});

describe("parseAppendixSpells", () => {
  const sample = `
APPENDIX B
SPELLS
Alpha Bolt (Folk)
 • Cost: 4 magic points; 1D2 Sanity points
 • Casting time: 1 round
Fires a glowing bolt that deals harm to one target.
Beta Ward
Note: requires a prepared circle.
 • Cost: 2 magic points; 1 Sanity point
 • Casting time: 5+ minutes
Creates a short-lived barrier against spirits.
APPENDIX C
TOMES
`;

  test("parses name, costs, casting time, and body", () => {
    const spells = parseAppendixSpells(sample);
    assert.equal(spells.length, 2);
    assert.equal(spells[0].name, "Alpha Bolt (Folk)");
    assert.equal(spells[0].castingTime, "1 round");
    assert.equal(spells[0].costs.magicPoints, "4");
    assert.equal(spells[0].costs.sanity, "1d2");
    assert.match(spells[0].description, /glowing bolt/);
    assert.equal(spells[1].name, "Beta Ward");
    assert.equal(spells[1].castingTime, "5+ minutes");
    assert.match(spells[1].description, /Note:.*prepared circle/i);
    assert.match(spells[1].description, /short-lived barrier/);
  });

  test("returns empty when no appendix B", () => {
    assert.deepEqual(parseAppendixSpells("just some travel text"), []);
  });

  test("parses Serpent-style NEW SPELLS with ALL-CAPS titles", () => {
    const spells = parseAppendixSpells(`
APPENDIX B
NEW ARTIFACTS, TECHNOLOGY, TOMES AND SPELLS
TOMES
Fake Tome
 • Sanity Loss: 1D4
 • Cthulhu Mythos: +1/+2 percentiles
 • Mythos Rating: 9
 • Study: 1 week
 • Spells: Contact Yig
NEW SPELLS
BECOME THE DARKNESS
 • Cost: all remaining magic points; all remaining POW; all remaining Sanity points
 • Casting time: 1 round
Self-sacrifice to the dark god.
COILS OF YIG
 • Cost: 5 magic points per round; 1D10 Sanity points
 • Casting time: 10 minutes
Coils crush the target.
Keeper note: ignore this as a title.
SKINWALKING
 • Cost: 10 magic points
 • Casting time: 1 hour
Wear another's skin.
`);
    assert.equal(spells.length, 3);
    assert.equal(spells[0].name, "BECOME THE DARKNESS");
    assert.equal(spells[0].costs.magicPoints, "all remaining");
    assert.equal(spells[1].name, "COILS OF YIG");
    assert.equal(spells[1].costs.magicPoints, "5");
    assert.equal(spells[2].name, "SKINWALKING");
    assert.ok(!spells.some((s) => /Keeper/i.test(s.name)));
    assert.ok(!spells.some((s) => /Contact Yig NEW/i.test(s.name)));
  });

  test("parses Innsmouth M-bullet Cost/Casting time", () => {
    const spells = parseAppendixSpells(`
Marine Magic & Artifacts
Alter Weather
M Cost: 10+ magic points
M Casting time: 3+ minutes
Moderates weather conditions.
Appear Human (Variant)
M Cost: 5+ magic points
M Casting time: 5+ rounds
Enables a deep one to appear human.
`);
    assert.equal(spells.length, 2);
    assert.equal(spells[0].name, "Alter Weather");
    assert.equal(spells[0].costs.magicPoints, "10+");
    assert.equal(spells[0].castingTime, "3+ minutes");
    assert.equal(spells[1].name, "Appear Human (Variant)");
  });
});

describe("parseAppendixTomes", () => {
  const sample = `
APPENDIX C
TOMES
Red Book of Test
English, by Ada Example, 1920. Quarto, red leather binding.
 • Link: Test Library, page 12.
A curious volume of invented rites.
Relevance: useful for the finale puzzle.
 • Sanity Loss: 1D6
 • Cthulhu Mythos: +2/+5 percentiles
 • Mythos Rating: 18
 • Study: 10 weeks
 • Spells: Alpha Bolt, Beta Ward.
Blue Codex
Latin, translated by Otto Other, 1228. Folio, black letter.
 • Link: Vault, page 99.
Older and more dangerous.
Relevance: contains the gate clue.
 • Sanity Loss: 2D10
 • Cthulhu Mythos: +5/+11 percentiles
 • Mythos Rating: 48
 • Study: 66 weeks
 • Spells: none
APPENDIX D
ARTIFACTS
`;

  test("parses bibliographic fields and stats", () => {
    const tomes = parseAppendixTomes(sample);
    assert.equal(tomes.length, 2);
    const t = tomes[0];
    assert.equal(t.name, "Red Book of Test");
    assert.equal(t.language, "English");
    assert.equal(t.author, "Ada Example");
    assert.equal(t.date, "1920");
    assert.match(t.physical, /Quarto/);
    assert.match(t.link, /Test Library/);
    assert.match(t.description, /curious volume/);
    assert.match(t.relevance, /finale puzzle/);
    assert.equal(t.sanityLoss, "1D6");
    assert.deepEqual(t.cthulhuMythos, { initial: 2, final: 5 });
    assert.equal(t.mythosRating, 18);
    assert.deepEqual(t.study, { necessary: 10, units: "CoC7.weeks" });
    assert.match(t.spells, /Alpha Bolt/);
    assert.equal(tomes[1].name, "Blue Codex");
    assert.equal(tomes[1].spells, "none");
  });

  test("keeps title after Spells: none and Spanish written-by metadata", () => {
    const text = `
APPENDIX C
TOMES
PERU
Final Confessions of Gaspar Figueroa
Spanish, written by Gaspar Figueroa, 1543. Octavo, handwritten on vellum.
 • Link: Museo, page 65.
A rambling manuscript.
Relevance: useful clue.
 • Sanity Loss: 1D3
 • Cthulhu Mythos: +1/+2 percentiles
 • Mythos Rating: 9
 • Study: 2 weeks
 • Spells: none
AMERICA
The Pnakotic Manuscripts
English, author and translator unknown, 15th century. Quarto, red leather.
 • Link: Library, page 134.
Five bound manuscripts.
Relevance: deep lore.
 • Sanity Loss: 1D8
 • Cthulhu Mythos: +3/+7 percentiles
 • Mythos Rating: 30
 • Study: 45 weeks
 • Spells: Contact Yithian.
The Black Rites of Luveh-Keraphf
Egyptian hieroglyphs, by Luveh-Keraphf, c. Thirteenth Dynasty Egypt (1786-1633 BCE). Ten papyrus scrolls.
 • Link: Bedroom, page 10.
Forbidden rites.
Relevance: Egypt chapter.
 • Sanity Loss: 1D10
 • Cthulhu Mythos: +2/+4 percentiles
 • Mythos Rating: 30
 • Study: 6 weeks
 • Spells: none
APPENDIX D
ARTIFACTS
`;
    const tomes = parseAppendixTomes(text);
    assert.deepEqual(
      tomes.map((t) => t.name),
      [
        "Final Confessions of Gaspar Figueroa",
        "The Pnakotic Manuscripts",
        "The Black Rites of Luveh-Keraphf",
      ],
    );
    assert.equal(tomes[0].region, "Peru");
    assert.equal(tomes[0].language, "Spanish");
    assert.equal(tomes[1].region, "America");
    assert.equal(tomes[2].language, "Egyptian");
  });
});

describe("artefact helpers", () => {
  test("weapon heuristic", () => {
    assert.equal(isArtefactWeapon("A scrying glass with no edge."), false);
    assert.equal(
      isArtefactWeapon("This blade deals 1D8+1 damage in Fighting (Sword)."),
      true,
    );
    assert.equal(
      isArtefactWeapon(
        "Both a scrying device and a powerful weapon of attack.",
      ),
      true,
    );
  });

  test("split blurb keeps short physical first sentence", () => {
    const { description, keeper } = splitArtefactBlurb(
      "A golden circlet set with gems. Wearer stores magic points and hears a voice.",
    );
    assert.equal(description, "A golden circlet set with gems.");
    assert.match(keeper, /Wearer stores/);
  });
});

describe("parseAppendixArtefacts", () => {
  const sample = `
APPENDIX D
ARTIFACTS
PERU
Golden Test Mirror
 • Link: Hotel Test, page 64, Peru.
A polished gold mask used as a mirror. Viewing it may provoke visions of later events.
ENGLAND
Iron Test Blade
 • Link: Armory, page 10.
A curved sword. The blade deals 1D8+1 damage and always harms supernatural beings.
`;

  test("parses link, keeper text, weapon flag, and region", () => {
    const items = parseAppendixArtefacts(sample);
    assert.equal(items.length, 2);
    assert.equal(items[0].name, "Golden Test Mirror");
    assert.equal(items[0].region, "Peru");
    assert.match(items[0].link, /Hotel Test/);
    assert.match(items[0].keeper, /polished gold/);
    assert.equal(items[0].isWeapon, false);
    assert.equal(items[1].name, "Iron Test Blade");
    assert.equal(items[1].region, "England");
    assert.equal(items[1].isWeapon, true);
  });

  test("parses Appearance bullets and ALL-CAPS titles", () => {
    const items = parseAppendixArtefacts(`
APPENDIX D
ARTIFACTS
COBRA CROWN, THE
 • Appearance in the campaign: Chapter 7: Calcutta
The Cobra Crown was once worn by sorcerer-kings and holds great power for the wielder.
PAIN WHIP
 • Appearance in the campaign: Chapter 1: Bolivia
A twelve-foot whip covered in sharp barbs that deals 1D6 damage.
`);
    assert.equal(items.length, 2);
    assert.equal(items[0].name, "COBRA CROWN, THE");
    assert.match(items[0].link, /Calcutta/);
    assert.equal(items[1].isWeapon, true);
  });

  test("parses Innsmouth named artefact headings", () => {
    const items = parseAppendixArtefacts(`
DEEP ONE ARTIFACTS
Idols from R'lyeh
Such idols represent various statuettes usually depicting Great Cthulhu or Father Dagon and may grant boons when used with Contact spells.
Jewelry from the Deep
Golden jewelry recovered from the deep ones grants nightly dream visions of Cthulhu at a cost of Sanity.
Mapulos & Shoggoth-Twsha
Paired mapulos allow a twsha to control a shoggoth for as long as concentration holds.
Trident or Spear of the Deep
A coral-tipped trident that deals 1D8 damage and may be thrown underwater without penalty.
`);
    assert.equal(items.length, 4);
    assert.equal(items[0].name, "Idols from R'lyeh");
    assert.equal(items[3].name, "Trident or Spear of the Deep");
    assert.equal(items[3].isWeapon, true);
  });
});

describe("parseAppendixTomes — Serpent-style", () => {
  test("parses Appearance + Initial/Full Mythos titles", () => {
    const tomes = parseAppendixTomes(`
APPENDIX C
TOMES
THE INMOST NIGHT
 • Appearance in the campaign: Chapters 2–9
Naacal notebooks of strange lore.
 • Sanity Loss: 1D6
 • Cthulhu Mythos (Initial Reading): +2%
 • Cthulhu Mythos (Full Study): +5%
 • Mythos Rating: 20
 • Study: 2 weeks
 • Spells: Contact Tsathoggua, Flesh Ward
Gospel of Yig
 • Sanity Loss: 1D6
 • Cthulhu Mythos (Initial Reading): +2%
 • Cthulhu Mythos (Full Study): +4%
 • Mythos Rating: 18
 • Study: 7 days
 • Spells: Contact Yig
`);
    assert.equal(tomes.length, 2);
    assert.equal(tomes[0].name, "THE INMOST NIGHT");
    assert.equal(tomes[0].cthulhuMythos.initial, 2);
    assert.equal(tomes[0].cthulhuMythos.final, 5);
    assert.equal(tomes[1].name, "Gospel of Yig");
    assert.equal(tomes[1].study.units, "CoC7.days");
  });
});

describe("parseAppendixTomes — inline entries (Innsmouth-style)", () => {
  // No TOMES appendix: tome entries sit inline in a chapter, bulleted with the
  // "M" glyph, dated "15 th century" (superscript ordinal, no period) or
  // "by Author, 1862 – 1874" running straight into the description, and listing
  // "Suggested Spells:".
  const TEXT =
    "Prose about a library. THE MYTHOS SHELF Pnakotic Manuscripts English, author and translator unknown, 15 th century " +
    "This bound manuscript is a partial copy of a greater work. " +
    "M Sanity Loss: 1D8 M Cthulhu Mythos: +3/+7 percentiles M Mythos Rating: 30 M Study: 45 weeks " +
    "M Suggested Spells: Bless Blade, Contact Winged One (Elder Thing); others at the Keeper's discretion. " +
    "Family History English, by Obed Marsh, 1862 – 1874 Outlines the family history. " +
    "M Sanity Loss: 1D6 M Cthulhu Mythos: +2/+4 percentiles M Mythos Rating: 18 M Study: 1 week M Suggested Spells: none. " +
    "GREGOR MENDEL An Augustine friar, and other prose that follows the entries.";

  test("parses inline tomes without an appendix banner", () => {
    const tomes = parseAppendixTomes(TEXT);
    assert.deepEqual(
      tomes.map((t) => t.name),
      ["Pnakotic Manuscripts", "Family History"],
    );
    assert.equal(tomes[0].author, "author and translator unknown");
    assert.equal(tomes[0].date, "15th century");
    assert.equal(tomes[0].mythosRating, 30);
    assert.equal(
      tomes[0].description,
      "This bound manuscript is a partial copy of a greater work.",
    );
    assert.equal(tomes[1].author, "Obed Marsh");
    assert.equal(tomes[1].date, "1862 – 1874");
    // The spell list is one sentence; the prose after the last entry stays out.
    assert.equal(tomes[1].spells, "none.");
    assert.ok(tomes[0].spells.endsWith("discretion."), tomes[0].spells);
  });

  test("a section banner glued before a title is dropped", () => {
    assert.equal(parseAppendixTomes(TEXT)[0].name, "Pnakotic Manuscripts");
  });

  test("stands down on the bulleted '• Language:' sample-book shape", () => {
    const ddt =
      "SAMPLE BOOKS An Account of Travels • Language: Spanish • Sanity Loss: 1D2 • Cthulhu Mythos: 0/1 point • Mythos Rating: 3% • Study: 4 weeks • Spells: none • Skill Points: none. " +
      "Myths and Legends • Language: Spanish • Sanity Loss: 1D3 • Cthulhu Mythos: 1/2 points • Mythos Rating: 9% • Study: 5 weeks • Spells: none • Skill Points: none.";
    assert.deepEqual(parseAppendixTomes(ddt), []);
  });
});

describe("parseAppendixSpells — titles", () => {
  test("keeps a 'Call Deity: X or Y' title whole", () => {
    const spells = parseAppendixSpells(
      "NEW SPELLS Stopping the chant ends the spell. Call Deity: Father Dagon or Mother Hydra " +
        "M Cost: 1+ magic point M Casting time: 1–100 minutes Calls the deity to a consecrated stone. " +
        "Ecstasy* M Cost: 1+ magic points M Casting time: 3 rounds By touching a target the caster induces bliss.",
    );
    assert.deepEqual(
      spells.map((s) => s.name),
      ["Call Deity: Father Dagon or Mother Hydra", "Ecstasy"],
    );
  });
});

describe("parseAppendixItems", () => {
  test("tags kinds and skips books without appendices", () => {
    assert.deepEqual(parseAppendixItems("no appendices here"), []);
    const items = parseAppendixItems(`
APPENDIX B
Fog Test
 • Cost: 1 magic point; 1 Sanity point
 • Casting time: 1 round
Makes fog.
APPENDIX C
Fog Tome
English, by A Author, 1900. Pamphlet.
 • Link: Shelf, page 1.
Thin booklet.
Relevance: none.
 • Sanity Loss: 1D4
 • Cthulhu Mythos: +1/+2 percentiles
 • Mythos Rating: 9
 • Study: 2 weeks
 • Spells: Fog Test
APPENDIX D
Fog Charm
 • Link: Desk, page 2.
A small charm with no combat use.
`);
    assert.deepEqual(
      items.map((i) => i.kind),
      ["spell", "tome", "artefact"],
    );
  });
});
