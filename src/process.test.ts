// Unit tests: fast, self-contained checks against synthetic stat-block text.
// These need no PDF fixtures and run as part of normal CI (`npm test`). The
// fixture-driven, book-level checks live in test/integration (`npm run
// test:integration`).
import { describe, test } from "node:test";
import assert from "node:assert";
import { parseCocCharacters } from "./process.ts";

describe("parseCocCharacters (unit)", () => {
  test("em-dash characteristics parse as null", () => {
    const [c] = parseCocCharacters(
      "The Thing, horror STR 70 CON 70 SIZ 90 DEX 80 INT 80 APP — POW 100 EDU — SAN — HP 16 " +
        "DB: +1D6 Build: 2 Move: 6 MP: 20",
    );
    assert.equal(c.characteristics.APP!.value, null);
    assert.equal(c.characteristics.APP!.raw, "-");
    assert.equal(c.characteristics.POW!.value, 100);
    assert.equal(c.derived.DB, "+1D6");
  });

  test("reordered / reduced characteristic sets (Quick-Start style)", () => {
    const [c] = parseCocCharacters(
      "RAT PACK, swarm STR 35 CON 55 SIZ 35 POW 50 DEX 70 HP: 9 " +
        "Average Damage Bonus: -1 Average Build: -1 Move: 9",
    );
    assert.equal(c.characteristics.STR!.value, 35);
    assert.equal(c.characteristics.POW!.value, 50);
    assert.equal(c.characteristics.DEX!.value, 70);
    assert.equal(c.characteristics.INT, undefined); // not present, not invented
    assert.equal(c.derived.DB, "-1");
    assert.equal(c.derived.Build, -1);
  });

  test('captures "Attacks per round" even when combat is prose-only', () => {
    const [c] = parseCocCharacters(
      "RAT PACK, swarm STR 35 CON 55 SIZ 35 POW 50 DEX 70 HP: 9 " +
        "DB: -1 Build: -1 Move: 9 Combat Attacks per round: 1. Rats attack with teeth and claws.",
    );
    assert.equal(c.attacksPerRound, "1");
    assert.deepEqual(c.combat, []); // no "NN% (h/f)" profiles to extract
  });

  test("Sanity loss is captured for monsters and bounded at the sentence", () => {
    const [c] = parseCocCharacters(
      "The Thing, horror STR 70 CON 70 SIZ 90 DEX 80 INT 80 APP — POW 100 EDU — SAN — HP 16 " +
        "DB: +1D6 Build: 2 Move: 6 MP: 20 Sanity Loss: 1/1D6 Sanity points to see the Thing. More prose here.",
    );
    assert.equal(c.sanityLoss, "1/1D6 Sanity points to see the Thing");
  });

  test("Sanity loss is bounded at a bullet (rewards-list style)", () => {
    const [c] = parseCocCharacters(
      "The Beast, monster STR 90 CON 90 SIZ 90 DEX 40 INT 40 APP — POW 60 EDU — SAN — HP 18 " +
        "DB: +1D6 Build: 2 Move: 8 MP: 12 Sanity Loss: 1D6 • Occult Lore: +2/+4 percentiles",
    );
    assert.equal(c.sanityLoss, "1D6");
  });

  test('prose "Sanity loss" without a colon is not captured (human NPC)', () => {
    const [c] = parseCocCharacters(
      "Bob, hero STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Brawl 25% (12/5), damage 1D3 Dodge 25% (12/5) " +
        "Skills Spot Hidden 40%. Note: reduce the Sanity loss to 0/1D3 in darkness.",
    );
    assert.equal(c.sanityLoss, null);
  });

  test("a combat (half/fifth) value is never mistaken for the name", () => {
    // An alternate-form stat block ("Beast Form") follows the previous profile's
    // combat, so the name walk starts from "...(42/17), damage ...". The bare
    // "(42/17)" is a Hard/Extreme value, not a name fragment.
    const [, second] = parseCocCharacters(
      "Guard, cultist STR 60 CON 70 SIZ 55 DEX 95 INT 80 APP 90 POW 90 EDU 90 SAN 45 HP 12 " +
        "DB: 0 Build: 0 Move: 9 MP: 18 Luck: 45 Combat Brawl 85% (42/17), damage 1D4+1 Dodge 55% (27/11) " +
        "Beast Form STR 90 CON 75 SIZ 90 DEX 120 INT 80 APP — POW 95 EDU — SAN — HP 16 " +
        "DB: +1D6 Build: 2 Move: 12 MP: 19",
    );
    assert.equal(second.name, "Beast Form");
    assert.equal(second.characteristics.STR!.value, 90);
  });

  test("group titles keep connector words and internal hyphens", () => {
    const stats =
      "STR 60 60 CON 60 60 SIZ 60 60 DEX 60 60 INT 60 60 APP 60 60 POW 60 60 EDU 60 60 " +
      "SAN 30 30 HP 12 12 DB: 0 Build: 0 Move: 8";
    // "on" is a connector (kept despite being < 3 chars); the label is qualified
    // with the full title rather than dropping the particle.
    const [a] = parseCocCharacters(
      `MARSH DWELLERS ON BLACK LAKE ISLAND 1 2 ${stats}`,
    );
    assert.equal(a.name, "Marsh Dwellers on Black Lake Island 1");
    // A comma subtitle is folded in and hyphenated compounds keep each part
    // capitalised.
    const [b] = parseCocCharacters(`GHOUL, RAVENOUS BONE-GNAWERS 1 2 ${stats}`);
    assert.equal(b.name, "Ghoul Ravenous Bone-Gnawers 1");
  });

  test('a monster "average / rolls" block parses as one creature, not columns', () => {
    // The generation formula next to each value ("(1D6+6) ×5", bare "2D6 ×5")
    // and the "Average / Rolls" header row must not be read as extra columns or
    // as the creature's name; "Hit Points:" is recognised as HP.
    const [c, ...rest] = parseCocCharacters(
      "MONSTERS  Test Swarm , mutated monsters  Average  Rolls  " +
        "STR 45 (1D6+6) ×5 CON 65 (2D6+6) ×5 SIZ 55 (2D6+4) ×5 " +
        "POW 35 2D6 ×5 DEX 45 (2D6+2) ×5 Hit Points: 12 " +
        "Average Damage Bonus: 0 Average Build: 0 Move: 7 Luck: — " +
        "Combat Attacks per round: 1 Fighting 45% (22/9), damage 1D3 Dodge n/a " +
        "Sanity loss: 0/1D3 to see the swarm.",
    );
    assert.equal(rest.length, 0); // one creature, not an "Average"/"Rolls" pair
    assert.equal(c.name, "Test Swarm");
    assert.equal(c.characteristics.STR?.value, 45);
    assert.equal(c.characteristics.POW?.value, 35);
    assert.equal(c.characteristics.HP?.value, 12);
    assert.equal(c.sanityLoss, "0/1D3 to see the swarm");
  });

  test("a bare 'roll'/'char.'/'average' header row is not used as a name", () => {
    const [c] = parseCocCharacters(
      "char. average roll s STR 70 (4D6) ×5 CON 65 (2D6+6) ×5 SIZ 50 (3D6) ×5 " +
        "INT 50 (3D6) ×5 POW 50 (3D6) ×5 DEX 35 (2D6) ×5 Hit Points: 11 " +
        "DB: 0 Build: 0 Move: 7 Combat Attacks per round: 1 Fighting 40% (20/8), damage 1D6 " +
        "Sanity loss: 0/1D6 to see the beast.",
    );
    assert.notEqual(c.name, "roll");
    assert.notEqual(c.name, "char. average roll");
    // Falls back to the creature named in the Sanity-loss line.
    assert.equal(c.name, "Beast");
  });

  test("a named-column 'char. A B roll' table uses the column labels", () => {
    // The odd "average / rolls" layout puts the column labels between a "char."
    // stat-name header and a "roll(s)" formula header, not at the row's tail;
    // they must be read as the member labels ("Alpha"/"Beta"), not "1"/"2".
    const cs = parseCocCharacters(
      "MONSTERS Test Swarm char. Alpha Beta roll s (for beta form) " +
        "STR 5 50 (3D6) ×5 CON 5 55 (3D6) ×5 SIZ 5 65 (2D6+6) ×5 " +
        "POW 35 35 (2D6) ×5 DEX 80 65 (2D6+6) ×5 HP: 4 12 " +
        "Average Damage Bonus: 0 Average Build: 0 Move: 8 " +
        "Combat Attacks per round: 1 Fighting 40% (20/8), damage 1D6 " +
        "Sanity loss: 0/1D6 to see them.",
    );
    assert.deepEqual(
      cs.map((c) => ({ name: c.name, str: c.characteristics.STR?.value })),
      [
        { name: "Test Swarm Alpha", str: 5 },
        { name: "Test Swarm Beta", str: 50 },
      ],
    );
  });

  test('"up to N (...)" attacks-per-round is preserved', () => {
    const [c] = parseCocCharacters(
      "The Thing, horror STR 70 CON 70 SIZ 90 DEX 80 INT 80 APP — POW 100 EDU — SAN — HP 16 " +
        "DB: +1D6 Build: 2 Move: 6 MP: 20 Combat Attacks per round: up to 4 (1D4 lash or 1 consume).",
    );
    assert.equal(c.attacksPerRound, "up to 4 (1D4 lash or 1 consume)");
  });

  test("attack names shed prose/range/count that bled in from the prior attack", () => {
    const [c] = parseCocCharacters(
      "The Thing, horror STR 70 CON 70 SIZ 90 DEX 80 INT 80 APP 50 POW 100 EDU 50 SAN 50 HP 16 " +
        "DB: +1D6 Build: 2 Move: 6 MP: 20 Combat Attacks per round: 1 " +
        // Prose maneuver with no % ("Seize ...") precedes the real "Tickle" attack.
        "Fighting 45% (22/9), damage 1D4 Seize (mnvr) victim is held for Tickle or other attacks " +
        "Tickle 40% (20/8), damage 1D2 " +
        // Dangling ")" from the prior damage note leaks before "Hatchet".
        "Blackjack 55% (27/11), damage 1D4+1 (if Hard CON roll failed) " +
        "Hatchet (thrown) 40% (20/8), damage 1D6+1, base range 8 yards " +
        "Dart (thrown) 40% (20/8), damage 1D3 Dodge 35% (17/7)",
    );
    assert.deepEqual(c.combat.map((a) => a.name), [
      "Fighting",
      "Tickle",
      "Blackjack",
      "Hatchet (thrown)",
      "Dart (thrown)",
      "Dodge",
    ]);
  });

  test("a %-less / prose Dodge does not leak into the prior attack's damage", () => {
    const [c] = parseCocCharacters(
      "Miner, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        // "1D3 + DB" damage (DB must not start the next name); "Dodge n/a" has no %.
        "Brawl 60% (30/12), damage 1D3 + DB Grab (mnvr) 60% (30/12), damage 1D6 Dodge n/a",
    );
    assert.deepEqual(
      c.combat.map((a) => ({ name: a.name, damage: a.damage })),
      [
        { name: "Brawl", damage: "1D3 + DB" },
        { name: "Grab (mnvr)", damage: "1D6" },
      ],
    );
  });

  test("attack profile with a comma before (h/f) and a %-less Dodge value", () => {
    const [c] = parseCocCharacters(
      "Man, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        "Brawl 65% (32/13), damage 1D3 .38 revolver 40%, (20/8), damage 1D10 Dodge 27 (13/5)",
    );
    const revolver = c.combat.find((a) => a.name === ".38 revolver")!;
    assert.equal(revolver.value, 40);
    assert.equal(revolver.damage, "1D10");
    const dodge = c.combat.find((a) => a.name === "Dodge")!;
    assert.equal(dodge.value, 27); // "Dodge 27 (13/5)" — no % sign
    assert.equal(dodge.half, 13);
  });

  test("a maneuver profile's prose effect becomes the note, not lost", () => {
    const [c] = parseCocCharacters(
      "Man, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        // "(22/9)," is followed by an effect clause, not "damage X".
        "Garrote 45% (22/9), mnvr. to escape or suffer 1D6 damage per round Dodge 45% (22/9)",
    );
    const garrote = c.combat.find((a) => a.name === "Garrote")!;
    assert.equal(garrote.damage, null);
    assert.equal(garrote.note, "mnvr. to escape or suffer 1D6 damage per round");
    assert.ok(c.combat.some((a) => a.name === "Dodge"));
  });

  test("a '(...)' note in damage is not truncated by a following attack", () => {
    const [c] = parseCocCharacters(
      "Beast, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        // The "1)" inside "(minimum 1)" must not read as the start of the next
        // attack; "failed)" must not let a name span to the next "%".
        "Fighting 25% (12/5), damage 1D3-2 (minimum 1) Grab (mnvr) 25% (12/5), damage 1D4+1 + unconsciousness (if Hard CON roll failed) Dodge 25% (12/5)",
    );
    const fighting = c.combat.find((a) => a.name === "Fighting")!;
    assert.equal(fighting.damage, "1D3-2");
    assert.equal(fighting.note, "minimum 1");
    const grab = c.combat.find((a) => a.name === "Grab (mnvr)")!;
    assert.equal(grab.damage, "1D4+1 + unconsciousness");
    assert.equal(grab.note, "if Hard CON roll failed");
  });

  test("a comma-laden '(...)' clause is not absorbed into an attack name", () => {
    const [c] = parseCocCharacters(
      "Thing, horror STR 80 CON 80 SIZ 90 DEX 40 INT 40 APP — POW 60 EDU — SAN — HP 21 " +
        "DB: +2D6 Build: 3 Move: 4 MP: 12 Combat " +
        // The attacks-per-round prose has a comma-laden parenthetical.
        "Attacks per round: 1D4 malformed appendages (lashing out, kicking, or goring) " +
        "Fighting 40% (20/8), damage 1D6+2D6 Dodge 17% (8/3)",
    );
    const fighting = c.combat.find((a) => a.name === "Fighting")!;
    assert.ok(fighting, "Fighting attack should be recovered cleanly");
    assert.equal(fighting.damage, "1D6+2D6");
    assert.ok(
      c.combat.every((a) => !/malformed/.test(a.name)),
      "prose must not leak into an attack name",
    );
  });

  test("a bare 'or weapon' in brawl damage is dropped as redundant", () => {
    const [c] = parseCocCharacters(
      "Man, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        "Brawl 55% (27/11), damage 1D3+1D4 or weapon Dodge 25% (12/5)",
    );
    const brawl = c.combat.find((a) => a.name === "Brawl")!;
    assert.equal(brawl.damage, "1D3+1D4"); // "or weapon" stripped
    assert.equal(c.combat.some((a) => /weapon/i.test(a.name)), false);
  });

  test("a named 'or weapon' becomes its own capitalized combat entry", () => {
    const [c] = parseCocCharacters(
      "Thug, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        "Brawl 60% (30/12), damage 1D3+1D4 or cudgel 1D8+1D4 Dodge 25% (12/5)",
    );
    assert.deepEqual(
      c.combat.map((a) => ({ name: a.name, value: a.value, damage: a.damage })),
      [
        { name: "Brawl", value: 60, damage: "1D3+1D4" },
        { name: "Cudgel", value: 60, damage: "1D8+1D4" }, // shares the brawl %
        { name: "Dodge", value: 25, damage: null },
      ],
    );
  });

  test("a comma/'or' list of weapon alternatives splits into one entry each", () => {
    const [c] = parseCocCharacters(
      "Brute, x STR 80 CON 60 SIZ 80 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 14 " +
        "DB: +1D4 Build: 2 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        "Brawl 70% (35/14), damage 1D3+1D4, cudgel 1D6+1D4, or big club 1D8+1D4 Dodge 25% (12/5)",
    );
    assert.deepEqual(c.combat.slice(0, 3), [
      { name: "Brawl", value: 70, half: 35, fifth: 14, damage: "1D3+1D4", note: null },
      { name: "Cudgel", value: 70, half: 35, fifth: 14, damage: "1D6+1D4", note: null },
      { name: "Big club", value: 70, half: 35, fifth: 14, damage: "1D8+1D4", note: null },
    ]);
  });

  test("an 'or <prose>' with no weapon damage is left inline", () => {
    const [c] = parseCocCharacters(
      "Blob, horror STR 90 CON 90 SIZ 90 DEX 40 INT 40 APP — POW 60 EDU — SAN — HP 18 " +
        "DB: +1D6 Build: 2 Move: 6 MP: 12 Combat Attacks per round: 1 " +
        "Fighting 80% (40/16), damage 9D6 or it can choose to engulf the target Dodge 20% (10/4)",
    );
    const fighting = c.combat.find((a) => a.name === "Fighting")!;
    assert.equal(fighting.damage, "9D6 or it can choose to engulf the target");
    assert.equal(c.combat.length, 2); // Fighting + Dodge only, no phantom weapon
  });

  test("skill/language entries shed qualifiers, prose, and unbalanced parens", () => {
    const [c] = parseCocCharacters(
      "Guard, watch STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 " +
        "Skills (human) Climb 40%, Lore (Theology: Methodism) 60%, Sciences (Biology 70%, " +
        "Chemistry 90%), Science (Physics) 25%, Spot Hidden 45%. " +
        "Languages Varies, assume Arabic 35%, English 35%, various Mythos languages 40%.",
    );
    // Leading "(human)" qualifier dropped; a nested ":" specialisation is kept
    // whole ("Lore (Theology: Methodism)"); compact "(Biology 70%, ...)" ->
    // "Sciences" (no unclosed paren); a balanced "Science (Physics)" stays intact.
    assert.equal(c.skills["Climb"], 40);
    assert.equal(c.skills["Lore (Theology: Methodism)"], 60);
    assert.equal(c.skills["Sciences"], 70);
    assert.equal(c.skills["Science (Physics)"], 25);
    assert.equal(c.skills["Spot Hidden"], 45);
    // Prose prefix "Varies, assume" dropped, leaving the bare language names.
    assert.equal(c.languages["Arabic"], 35);
    assert.equal(c.languages["English"], 35);
    // No entry starts lowercase or has unbalanced parentheses.
    const bad = (k: string) =>
      /^[a-z]/.test(k) ||
      (k.match(/\(/g) ?? []).length !== (k.match(/\)/g) ?? []).length;
    assert.ok(!Object.keys(c.skills).some(bad), "a skill name is malformed");
    assert.ok(!Object.keys(c.languages).some(bad), "a language name is malformed");
  });

  test("a numeric multi-column group expands to one character per column", () => {
    const cs = parseCocCharacters(
      "ALPHA SQUAD 1 2 3 " +
        "STR 60 50 70 CON 55 65 60 SIZ 60 55 65 DEX 60 70 50 INT 65 45 55 " +
        "APP 50 55 60 POW 70 45 50 EDU 30 40 35 SAN 40 45 40 HP 12 12 13 " +
        "DB: 0 Build: 0 Move: 8",
    );
    assert.equal(cs.length, 3);
    assert.deepEqual(
      cs.map((c) => c.name),
      ["Alpha Squad 1", "Alpha Squad 2", "Alpha Squad 3"],
    );
    assert.equal(cs[0].characteristics.STR!.value, 60);
    assert.equal(cs[1].characteristics.STR!.value, 50);
    assert.equal(cs[2].characteristics.INT!.value, 55);
  });

  test("languages parse separately from skills", () => {
    const [c] = parseCocCharacters(
      "Scholar, x STR 50 CON 50 SIZ 50 DEX 50 INT 60 APP 50 POW 50 EDU 70 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Skills Library Use 60%, Spot Hidden 40%. " +
        "Languages Latin 40%, Greek 25%.",
    );
    assert.equal(c.skills["Library Use"], 60);
    assert.equal(c.languages["Latin"], 40);
    assert.equal(c.languages["Greek"], 25);
    assert.equal(c.skills["Latin"], undefined); // languages are not skills
  });

  test("comma-separated spell list is parsed and markers stripped", () => {
    const [c] = parseCocCharacters(
      "Sorcerer, x STR 50 CON 50 SIZ 50 DEX 50 INT 60 APP 50 POW 80 EDU 60 SAN 20 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 16 Spells: Cloud Memory*, Wither Limb, Mind Blast. *See appendix.",
    );
    assert.deepEqual(c.spells, ["Cloud Memory", "Wither Limb", "Mind Blast"]);
  });

  test("descriptive spell list captures the name before each colon", () => {
    const [c] = parseCocCharacters(
      "Sorcerer, x STR 50 CON 50 SIZ 50 DEX 50 INT 60 APP 50 POW 80 EDU 60 SAN 20 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 16 " +
        "Spells DOMINATE (variant): forces obedience. FLESH WARD: absorbs damage.",
    );
    assert.ok(c.spells.includes("DOMINATE (variant)"));
    assert.ok(c.spells.includes("FLESH WARD"));
  });

  test("an ALL-CAPS name with an age is recovered", () => {
    const [c] = parseCocCharacters(
      "JOHN SMITH, 45, harbour master STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 " +
        "DB: 0 Build: 0 Move: 8",
    );
    assert.equal(c.name, "JOHN SMITH");
    assert.equal(c.age, 45);
    assert.equal(c.description, "harbour master");
  });

  test("lowercase particles and a title abbreviation stay in the name", () => {
    const [a] = parseCocCharacters(
      "Erik van der Berg, 50, merchant STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 " +
        "DB: 0 Build: 0 Move: 8",
    );
    assert.equal(a.name, "Erik van der Berg");
    const [b] = parseCocCharacters(
      "Dr. Jane Doe, 40, physician STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 " +
        "DB: 0 Build: 0 Move: 8",
    );
    assert.equal(b.name, "Dr. Jane Doe");
  });

  test("spelled-out derived labels normalise (Damage Bonus / Build / Move / MP)", () => {
    const [c] = parseCocCharacters(
      "The Horror, x STR 90 CON 90 SIZ 100 DEX 40 INT 40 APP — POW 60 EDU — SAN — HP 19 " +
        "Damage Bonus: +1D6 Average Build: 2 Move Rate: 7 Magic Points: 12",
    );
    assert.equal(c.derived.DB, "+1D6");
    assert.equal(c.derived.Build, 2);
    assert.equal(c.derived.Move, 7);
    assert.equal(c.derived.MP, 12);
  });

  test("a marked (starred) characteristic keeps its raw and marked flag", () => {
    const [c] = parseCocCharacters(
      "Patient, x STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 25* HP 10 " +
        "DB: 0 Build: 0 Move: 8",
    );
    assert.equal(c.characteristics.SAN!.value, 25);
    assert.equal(c.characteristics.SAN!.marked, true);
    assert.equal(c.characteristics.SAN!.raw, "25*");
  });

  test("a firearm with a caliber-dot name is kept intact and detected", () => {
    const [c] = parseCocCharacters(
      "Gunman, x STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Brawl 40% (20/8), damage 1D3 " +
        "Colt .45 revolver 55% (27/11), damage 1D10+2 Dodge 40% (20/8)",
    );
    const rev = c.combat.find((a) => a.name === "Colt .45 revolver")!;
    assert.equal(rev.value, 55);
    assert.equal(rev.damage, "1D10+2");
    assert.equal(c.combat.find((a) => a.name === "Brawl")!.damage, "1D3");
  });

  test("a percentage-only weapon derives its half/fifth thresholds", () => {
    const [c] = parseCocCharacters(
      "Thug, x STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Club 45%, damage 1D8",
    );
    const club = c.combat.find((a) => a.name === "Club")!;
    assert.equal(club.value, 45);
    assert.equal(club.half, 22);
    assert.equal(club.fifth, 9);
    assert.equal(club.damage, "1D8");
  });

  test("a footnote marker on a weapon name is stripped", () => {
    const [c] = parseCocCharacters(
      "Thug, x STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Brawl 40% (20/8), damage 1D3 " +
        ".32 pistol* 30% (15/6), damage 1D8 Dodge 30% (15/6)",
    );
    const pistol = c.combat.find((a) => /pistol/.test(a.name))!;
    assert.equal(pistol.name, ".32 pistol");
    assert.equal(pistol.value, 30);
  });

  test("a maneuver with no percentage but a bare damage is captured", () => {
    const [c] = parseCocCharacters(
      "Brute, x STR 80 CON 80 SIZ 80 DEX 50 INT 40 APP 40 POW 50 EDU 40 SAN 40 HP 16 " +
        "DB: +1D6 Build: 2 Move: 8 MP: 10 Combat Fighting 50% (25/10), damage 1D6 " +
        "Overwhelm (fighting maneuver) damage 2D6 Dodge 25% (12/5)",
    );
    const overwhelm = c.combat.find((a) => /Overwhelm/.test(a.name))!;
    assert.ok(overwhelm, "maneuver captured");
    assert.equal(overwhelm.value, null);
    assert.equal(overwhelm.damage, "2D6");
  });

  test("a Sanity loss without a colon (prose mention) is not captured", () => {
    const [c] = parseCocCharacters(
      "Hero, brave STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Notes: he can reduce the Sanity loss to 0/1D3 in daylight.",
    );
    assert.equal(c.sanityLoss, null);
  });

  // A lowercase section-label word in combat prose ("its special power",
  // "ignores any armor", "engage in combat") must not end the Combat section
  // before its real attack lines are reached.
  test("lowercase label words in combat prose do not truncate combat", () => {
    const [c] = parseCocCharacters(
      "Prowler, night-thing STR 90 CON 110 SIZ 60 DEX 35 INT 80 APP — POW 90 EDU — SAN — HP 17 " +
        "DB: +1D4 Build: 1 Move: 9 MP: 18 " +
        "Combat Attacks per round: 1 (claw or special power). " +
        "Fighting: the creature opens with its special power, ignoring any armor, before it will engage in combat directly. " +
        "Fighting 50% (25/10), damage 1D6+1D4 " +
        "Grab (mnvr) 50% (25/10), holds the victim fast " +
        "Dodge 17% (8/3) Skills Stealth 80%",
    );
    const names = c.combat.map((a) => a.name);
    assert.ok(names.includes("Fighting"), `Fighting captured (got ${names})`);
    assert.ok(names.includes("Dodge"), `Dodge captured (got ${names})`);
    const fighting = c.combat.find((a) => a.name === "Fighting")!;
    assert.equal(fighting.damage, "1D6+1D4");
    const grab = c.combat.find((a) => /Grab/.test(a.name))!;
    assert.equal(grab.note, "holds the victim fast");
  });

  // Capitalised (Title-case and ALL-CAPS) headings still bound sections.
  test("an ALL-CAPS section heading still bounds the combat section", () => {
    const [c] = parseCocCharacters(
      "Beast, x STR 80 CON 80 SIZ 80 DEX 50 INT 40 APP 40 POW 50 EDU 40 SAN 40 HP 16 " +
        "DB: +1D6 Build: 2 Move: 8 MP: 10 Combat Fighting 50% (25/10), damage 1D6 Dodge 25% (12/5) " +
        "SKILLS Climb 40% Stealth 60%",
    );
    assert.deepEqual(
      c.combat.map((a) => a.name),
      ["Fighting", "Dodge"],
    );
    assert.equal(c.skills["Climb"], 40);
  });

  // "average / rolls" monster blocks mark inapplicable characteristics "n/a" in
  // both columns; the block must still be recognised and stay a single creature.
  test('an "average / rolls" block with n/a characteristics is recognised', () => {
    const cs = parseCocCharacters(
      "Wraith, formless STR n/a n/a CON n/a n/a SIZ (6D6+9)×5 150 " +
        "DEX (4D6+6)×5 100 INT (2D6+3)×5 50 POW (8D6+12)×5 200 " +
        "Average Magic Points: 50 Move: 12",
    );
    assert.equal(cs.length, 1);
    const [c] = cs;
    assert.equal(c.characteristics.STR, undefined); // n/a -> not invented
    assert.equal(c.characteristics.CON, undefined);
    assert.equal(c.characteristics.SIZ!.value, 150);
    assert.equal(c.characteristics.INT!.value, 50);
    assert.equal(c.derived.MP, 50);
    assert.equal(c.derived.Move, 12);
  });

  // A stray characteristic value in trailing prose ("... has INT 90 after
  // feeding") must not be read as a second group column.
  test("a lone extra characteristic value does not create a group column", () => {
    const cs = parseCocCharacters(
      "Beast, x STR 80 CON 80 SIZ 80 DEX 50 INT 40 APP 40 POW 50 EDU 40 SAN 40 HP 16 " +
        "DB: +1D6 Build: 2 Move: 8 MP: 10 Note: it has INT 90 after feeding. " +
        "Combat Fighting 50% (25/10), damage 1D6",
    );
    assert.equal(cs.length, 1); // one creature, not two
    assert.equal(cs[0].characteristics.INT!.value, 40);
  });

  // An inline "Special: ..." note among the attack prose must not end the combat
  // section before the real attack profiles that follow it.
  test('an inline "Special:" note does not truncate combat', () => {
    const [c] = parseCocCharacters(
      "Avatar, foul STR 200 CON 80 SIZ 90 DEX 35 INT 15 APP — POW 75 EDU — SAN — HP 17 " +
        "DB: +3D6 Build: 4 Move: 10 MP: 15 " +
        "Attacks per round: 1 (pseudopod, pustule) " +
        "Fighting attacks: it reaches out with formless pseudopods. " +
        "Special: its stench forces a CON roll or nausea. " +
        "Fighting 85% (42/17), damage 7D6 " +
        "Exploding pustule 100% (50/20), damage 2D10 Dodge 30% (15/6)",
    );
    assert.deepEqual(
      c.combat.map((a) => a.name),
      ["Fighting", "Exploding pustule", "Dodge"],
    );
    assert.equal(c.combat.find((a) => a.name === "Fighting")!.damage, "7D6");
  });

  // A footnote marker between a skill name and its value ("Divination* 55%")
  // must not block the skill from being captured.
  test("a skill with a footnote marker before its value is captured", () => {
    const [c] = parseCocCharacters(
      "Psychic, gifted STR 50 CON 50 SIZ 50 DEX 50 INT 70 APP 50 POW 80 EDU 60 SAN 40 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 16 " +
        "Skills Clairvoyance and Divination* 55% Cthulhu Mythos 5% First Aid 70%",
    );
    assert.equal(c.skills["Clairvoyance and Divination"], 55);
    assert.equal(c.skills["Cthulhu Mythos"], 5);
    assert.equal(c.skills["First Aid"], 70);
  });

  // A skill whose value abuts the name with no space ("Art/Craft (Photography)35%")
  // must still be captured.
  test("a skill with no space before its value is captured", () => {
    const [c] = parseCocCharacters(
      "Detective, sharp STR 70 CON 50 SIZ 65 DEX 80 INT 80 APP 35 POW 50 EDU 60 SAN 50 HP 11 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10 " +
        "Skills Art/Craft (Photography)35% Climb 30% Drive Auto10%",
    );
    assert.equal(c.skills["Art/Craft (Photography)"], 35);
    assert.equal(c.skills["Climb"], 30);
    assert.equal(c.skills["Drive Auto"], 10);
  });

  // A parenthetical with an abbreviating period ("(inc. Driver Ant Column)")
  // must not end the comma-separated spell list early.
  test("a spell list is not truncated by a period inside a parenthetical", () => {
    const [c] = parseCocCharacters(
      "Sorcerer, vile STR 50 CON 50 SIZ 50 DEX 50 INT 80 APP 50 POW 90 EDU 80 SAN 20 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 18 " +
        "Spells: Bind Animal (inc. Driver Ant Column), Call Cthugha, " +
        "Contact Nyarlathotep, Voorish Sign. See Appendix B.",
    );
    assert.deepEqual(c.spells, [
      "Bind Animal",
      "Call Cthugha",
      "Contact Nyarlathotep",
      "Voorish Sign",
    ]);
  });

  // An auto-hit attack reads "automatic" where a skill % would sit and may carry
  // a non-dice damage ("Energy Blast automatic, damage, 20 points").
  test("an auto-hit attack with a non-dice damage is captured", () => {
    const [c] = parseCocCharacters(
      "Pharaoh, dark STR 200 CON 140 SIZ 250 DEX 50 INT 100 APP — POW 70 EDU — SAN — HP 39 " +
        "DB: +5D6 Build: 6 Move: 7 MP: 75 " +
        "Attacks per round: 1 Energy Blast Automatic, damage, 20 points Dodge 30% (15/6)",
    );
    assert.deepEqual(
      c.combat.map((a) => a.name),
      ["Energy Blast", "Dodge"],
    );
    const blast = c.combat.find((a) => a.name === "Energy Blast")!;
    assert.equal(blast.value, null); // auto-hit, no skill roll
    assert.equal(blast.damage, "20 points");
    assert.equal(blast.note, "automatic");
  });

  // A prose "... 1 point of Sanity loss ..." note among the attack description
  // must not end the combat section before the real attack profiles.
  test('an inline "Sanity loss" mention does not truncate combat', () => {
    const [c] = parseCocCharacters(
      "Horror, vast STR 200 CON 400 SIZ 250 DEX 45 INT 30 APP — POW 90 EDU — SAN — HP 65 " +
        "DB: +10D6 Build: 12 Move: 8 MP: 18 " +
        "Attacks per round: 1 (crush) " +
        "Howl: a blood-curdling cry which inflicts 1 point of Sanity loss upon all who hear it. " +
        "Fighting 85% (42/17), damage 1D6+10D6 Dodge 30% (15/6) " +
        "Sanity Loss: 1D6/1D20 Sanity points to see the horror",
    );
    assert.deepEqual(
      c.combat.map((a) => a.name),
      ["Fighting", "Dodge"],
    );
    // The real Sanity Loss line is still parsed independently.
    assert.match(c.sanityLoss ?? "", /1D6\/1D20/);
  });

  // A set of separate single-column stat lines (e.g. paired NPCs or a creature's
  // two forms) shares one Combat/Skills section printed after the last line; a
  // "bare" earlier line inherits it instead of coming out empty.
  test("a bare stat line inherits the set's shared trailing section", () => {
    const cs = parseCocCharacters(
      "Mr. Foo, servant STR 80 CON 120 SIZ 60 DEX 20 INT 65 APP 45 POW 50 EDU 40 SAN 40 HP 18 " +
        "DB: +1D4 Build: 1 Move: 6 MP: 10 " +
        "Mrs. Foo, servant STR 65 CON 140 SIZ 80 DEX 20 INT 70 APP 40 POW 40 EDU 40 SAN 40 HP 22 " +
        "DB: +1D4 Build: 1 Move: 6 MP: 8 " +
        "Combat Attacks per round: 1 (brawl or hook) Fighting 40% (20/8), damage 1D3+1D4 " +
        "Hook 40% (20/8), damage 1D6+1D4 Dodge 10% (5/2)",
    );
    assert.equal(cs.length, 2);
    // The first line is bare (only characteristics) but inherits the shared
    // Combat printed after the second line.
    assert.deepEqual(
      cs[0].combat.map((a) => a.name),
      ["Fighting", "Hook", "Dodge"],
    );
    assert.equal(cs[0].attacksPerRound, "1 (brawl or hook)");
    assert.equal(cs[1].combat.length, 3); // the second keeps it from its own body
  });

  // Bulleted label words are list items in bled-in appendix prose, not this
  // block's section headings, so they must not populate the section.
  test("a bulleted label in trailing prose is not a section heading", () => {
    const [c] = parseCocCharacters(
      "Clerk, ordinary STR 50 CON 50 SIZ 50 DEX 50 INT 60 APP 50 POW 50 EDU 70 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Fighting (Brawl) 25% (12/5), damage 1D3 Dodge 25% (12/5) " +
        "Skills Accounting 60% Spot Hidden 45% " +
        "Later in the scenario an appendix reads: • Spells: Flesh Ward (variant), Mindblast (variant)",
    );
    assert.deepEqual(c.spells, []);
    assert.equal(c.skills["Accounting"], 60);
  });
});
