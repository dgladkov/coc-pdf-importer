// Unit tests for the pulp-talent parser/item builder. All table content here is
// generic placeholder text — only the category keywords and table framing (which
// are generic English) mirror the book; no published talent names or descriptions.
import { describe, test } from "node:test";
import assert from "node:assert";
import {
  parsePulpTalents,
  parsePulpArchetypes,
  parsePulpItems,
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
      { name: "Alpha", category: "physical", description: "Runs fast." },
      { name: "Big Lift", category: "physical", description: "Lifts heavy things." },
      { name: "Quick Jab", category: "combat", description: "Hits first." },
    ]);
  });

  test("accepts the no-space 'Name:' separator as well as ' : '", () => {
    const [t] = parsePulpTalents(
      genTable(4, "MENTAL", [[1, "Focus", "concentrates hard."]], ":"),
    );
    assert.equal(t.name, "Focus");
    assert.equal(t.description, "Concentrates hard.");
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
    assert.equal(t.find((x) => x.name === "Zeta")!.description, "Ends here.");
    assert.equal(t.find((x) => x.name === "Mind")!.category, "mental");
  });

  test("strips a trailing letter-spaced page footer from the last row", () => {
    const text =
      genTable(6, "MISCELLANEOUS", [[1, "Gizmo", "does a thing."]]) +
      " s h o o t i n g d e e p o n e s 26";
    const [t] = parsePulpTalents(text);
    assert.equal(t.description, "Does a thing.");
  });

  test("cleans PDF spacing artifacts around punctuation", () => {
    const [t] = parsePulpTalents(
      genTable(6, "MISCELLANEOUS", [
        [1, "Gizmo", "builds a thing ( see Widgets , page 9 )."],
      ]),
    );
    assert.equal(t.description, "Builds a thing (see Widgets, page 9).");
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

// --- archetypes ------------------------------------------------------------
// Content is generic placeholder text; only the archetype names (a fixed label
// set the parser anchors on) and the bullet framing are structural.

const ARCH_TEXT =
  "Adventurer Generic flavor one, ending here. Adjustments " +
  "• Core characteristic: choose either DEX or APP. " +
  "• Add 100 bonus points divided among any of the following skills: Climb, Jump, Swim. " +
  "• Suggested occupations: Job A, Job B. " +
  "• Talents: any two. " +
  "• Suggested traits: brave, bold. " +
  "Beefcake Generic flavor two, ending here. Adjustments " +
  "• Core characteristic: STR. " +
  "• Add 100 bonus points divided among any of the following skills: Climb, Throw. " +
  "• Suggested occupations: Job C. " +
  "• Talents: any three. " +
  "• Suggested traits: strong, tough.";

describe("parsePulpArchetypes", () => {
  test("parses name, description, core characteristics, skills, occupations, traits", () => {
    const [adv, beef] = parsePulpArchetypes(ARCH_TEXT);
    assert.equal(adv.name, "Adventurer");
    assert.equal(adv.description, "Generic flavor one, ending here.");
    assert.deepEqual(adv.coreCharacteristics, ["dex", "app"]); // "choose either"
    assert.equal(adv.bonusPoints, 100);
    assert.deepEqual(adv.skills, ["Climb", "Jump", "Swim"]);
    assert.equal(adv.talents, 2);
    assert.deepEqual(adv.suggestedOccupations, ["Job A", "Job B"]);
    assert.deepEqual(adv.suggestedTraits, ["brave", "bold"]);
    assert.equal(beef.name, "Beefcake");
    assert.deepEqual(beef.coreCharacteristics, ["str"]);
    assert.equal(beef.talents, 3); // "any three"
    assert.deepEqual(beef.skills, ["Climb", "Throw"]);
  });

  test("returns [] when the archetype section is absent", () => {
    assert.deepEqual(parsePulpArchetypes("No archetypes here, just prose."), []);
  });

  test("tidies '(any)' casing and closes spurious '/ ' and '- ' inside entries", () => {
    const t =
      "Adventurer Prose here. Adjustments " +
      "• Core characteristic: DEX. " +
      "• Add 100 bonus points divided among any of the following skills: Art/Craft (any), Firearms (any). " +
      "• Suggested occupations: Gentleman/ Lady, Actor. " +
      "• Talents: any two. • Suggested traits: name- dropper, brave.";
    const [a] = parsePulpArchetypes(t);
    assert.deepEqual(a.skills, ["Art/Craft (Any)", "Firearms (Any)"]);
    assert.deepEqual(a.suggestedOccupations, ["Gentleman/Lady", "Actor"]);
    assert.deepEqual(a.suggestedTraits, ["name-dropper", "brave"]);
  });

  test("normalizes non-canonical skill names and splits combined firearms", () => {
    const t =
      "Adventurer P. Adjustments • Core characteristic: DEX. " +
      "• Add 100 bonus points divided among any of the following skills: Language Other (any), Firearms (Rifle and/or Handgun), Cryptography, Navigation, Photography, Law. " +
      "• Suggested occupations: X. • Talents: any two. • Suggested traits: brave.";
    const [a] = parsePulpArchetypes(t);
    assert.deepEqual(a.skills, [
      "Language (Any)", // "Language Other (any)" -> canonical
      "Firearms (Rifle/Shotgun)", // combined entry splits into two
      "Firearms (Handgun)",
      "Science (Cryptography)", // bare specialization names -> canonical skills
      "Navigate",
      "Art/Craft (Photography)",
      "Law",
    ]);
  });

  test("folds a trailing '; <clause>' in the skill list into the description", () => {
    const t =
      "Adventurer Prose here. Adjustments • Core characteristic: DEX. " +
      "• Add 100 bonus points divided among any of the following skills: Climb, Stealth; if the Foo talent is taken, do the thing. " +
      "• Suggested occupations: X. • Talents: any two. • Suggested traits: brave.";
    const [a] = parsePulpArchetypes(t);
    assert.deepEqual(a.skills, ["Climb", "Stealth"]); // clause is not a skill
    assert.equal(a.description, "Prose here. If the Foo talent is taken, do the thing.");
  });

  test("bounds the traits list at its ending period (no margin/chapter spillover)", () => {
    const t =
      "Adventurer P. Adjustments • Core characteristic: DEX. " +
      "• Add 100 bonus points divided among any of the following skills: Climb. " +
      "• Suggested occupations: X. • Talents: any two. " +
      "• Suggested traits: brave, plucky. Beefcake Steadfast STEP TWO: GENERATE.";
    const [a] = parsePulpArchetypes(t);
    assert.deepEqual(a.suggestedTraits, ["brave", "plucky"]);
  });

  test("strips margin-index name runs and page artifacts from the description", () => {
    const t =
      "Adventurer Real prose here. Beefcake Bon Vivant Cold-Blooded 16 CREATING PULP HEROES " +
      "Adjustments • Core characteristic: DEX. " +
      "• Add 100 bonus points divided among any of the following skills: Climb. " +
      "• Suggested occupations: X. • Talents: any two. • Suggested traits: brave.";
    const [a] = parsePulpArchetypes(t);
    assert.equal(a.description, "Real prose here.");
  });
});

describe("parsePulpItems", () => {
  test("returns talents and archetypes tagged by kind, keeping raw skill names", () => {
    const text =
      genTable(3, "PHYSICAL", [[1, "Alpha", "a."]]) + " " + ARCH_TEXT;
    const items = parsePulpItems(text);
    assert.ok(items.some((i) => i.kind === "talent"));
    const arch = items.find((i) => i.kind === "archetype");
    assert.ok(arch);
    // Skills stay as printed names — CoCID resolution is deferred to import.
    assert.deepEqual((arch as any).skills, ["Climb", "Jump", "Swim"]);
  });
});
