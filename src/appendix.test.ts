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
    assert.deepEqual(
      parseSpellCosts("4 magic points; 1D2 Sanity points"),
      {
        magicPoints: "4",
        sanity: "1d2",
        power: "",
        hitPoints: "",
        others: "",
      },
    );
    assert.deepEqual(parseSpellCosts("5 POW; 1D6 Sanity points"), {
      magicPoints: "",
      sanity: "1d6",
      power: "5",
      hitPoints: "",
      others: "",
    });
    assert.deepEqual(parseSpellCosts("variable magic points; 1D4 Sanity points"), {
      magicPoints: "variable",
      sanity: "1d4",
      power: "",
      hitPoints: "",
      others: "",
    });
  });

  test("puts unknown clauses in others", () => {
    const c = parseSpellCosts("3 magic points; a rare gem");
    assert.equal(c.magicPoints, "3");
    assert.equal(c.others, "a rare gem");
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
});

describe("artefact helpers", () => {
  test("weapon heuristic", () => {
    assert.equal(isArtefactWeapon("A scrying glass with no edge."), false);
    assert.equal(
      isArtefactWeapon("This blade deals 1D8+1 damage in Fighting (Sword)."),
      true,
    );
    assert.equal(
      isArtefactWeapon("Both a scrying device and a powerful weapon of attack."),
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
Iron Test Blade
 • Link: Armory, page 10.
A curved sword. The blade deals 1D8+1 damage and always harms supernatural beings.
`;

  test("parses link, keeper text, and weapon flag", () => {
    const items = parseAppendixArtefacts(sample);
    assert.equal(items.length, 2);
    assert.equal(items[0].name, "Golden Test Mirror");
    assert.match(items[0].link, /Hotel Test/);
    assert.match(items[0].keeper, /polished gold/);
    assert.equal(items[0].isWeapon, false);
    assert.equal(items[1].name, "Iron Test Blade");
    assert.equal(items[1].isWeapon, true);
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
