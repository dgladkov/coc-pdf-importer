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
    assert.deepEqual(
      c.combat.map((a) => a.name),
      [
        "Fighting",
        "Tickle",
        "Blackjack",
        "Hatchet (thrown)",
        "Dart (thrown)",
        "Dodge",
      ],
    );
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
    assert.equal(
      garrote.note,
      "mnvr. to escape or suffer 1D6 damage per round",
    );
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
    assert.equal(
      c.combat.some((a) => /weapon/i.test(a.name)),
      false,
    );
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
      {
        name: "Brawl",
        value: 70,
        half: 35,
        fifth: 14,
        damage: "1D3+1D4",
        note: null,
      },
      {
        name: "Cudgel",
        value: 70,
        half: 35,
        fifth: 14,
        damage: "1D6+1D4",
        note: null,
      },
      {
        name: "Big club",
        value: 70,
        half: 35,
        fifth: 14,
        damage: "1D8+1D4",
        note: null,
      },
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

  test("a comma between an alternative's name and its own damage is not a split point", () => {
    const [c] = parseCocCharacters(
      "Goon, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        // "brass knuckles, 1D3+1": the comma joins name to damage, not two weapons.
        "Brawl 55% (27/11), damage 1D3, or brass knuckles, 1D3+1 Dodge 25% (12/5)",
    );
    assert.deepEqual(c.combat.slice(0, 2), [
      {
        name: "Brawl",
        value: 55,
        half: 27,
        fifth: 11,
        damage: "1D3",
        note: null,
      },
      {
        name: "Brass knuckles",
        value: 55,
        half: 27,
        fifth: 11,
        damage: "1D3+1",
        note: null,
      },
    ]);
  });

  test("an alternative that spells its damage with the 'damage' keyword splits cleanly", () => {
    const [c] = parseCocCharacters(
      "Goon, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        "Brawl 55% (27/11), damage 1D3+1D4, or billy club, damage 1D6+1D4 Dodge 25% (12/5)",
    );
    assert.deepEqual(
      c.combat.slice(0, 2).map((a) => ({ name: a.name, damage: a.damage })),
      [
        { name: "Brawl", damage: "1D3+1D4" },
        { name: "Billy club", damage: "1D6+1D4" },
      ],
    );
  });

  test("';' and 'with' introduce weapon alternatives, and names shed stray operators", () => {
    const [c] = parseCocCharacters(
      "Goon, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        // ";", "with", and a trailing "+" on the additive form all normalize.
        "Brawl 50% (25/10), damage 1D3+1D4; with brass knuckles +1D3+1 Dodge 25% (12/5)",
    );
    assert.deepEqual(
      c.combat.slice(0, 2).map((a) => ({ name: a.name, damage: a.damage })),
      [
        { name: "Brawl", damage: "1D3+1D4" },
        { name: "Brass knuckles", damage: "1D3+1" },
      ],
    );
  });

  test("a spelled-out '+ damage bonus(...)' is a damage continuation, not an alternative", () => {
    const [c] = parseCocCharacters(
      "Ghoul, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        "Fighting 55% (27/11), damage 1D3 + damage bonus(1D4) + possible infection Dodge 30% (15/6)",
    );
    const f = c.combat.find((a) => a.name === "Fighting")!;
    assert.equal(f.damage, "1D3 + damage bonus(1D4) + possible infection");
    assert.equal(c.combat.length, 2); // Fighting + Dodge, no phantom weapon
  });

  test("a truncated 'or by weapon (e.g...)' clause is dropped, not kept as damage", () => {
    const [c] = parseCocCharacters(
      "Fish, deep STR 80 CON 80 SIZ 80 DEX 50 INT 50 APP — POW 60 EDU — SAN — HP 16 " +
        "DB: +1D4 Build: 2 Move: 8 MP: 12 Combat Attacks per round: 1 " +
        "Fighting 40% (20/8), damage 1D6+1D4 or by weapon (e.g Dodge 20% (10/4)",
    );
    const f = c.combat.find((a) => a.name === "Fighting")!;
    assert.equal(f.damage, "1D6+1D4");
    assert.equal(
      c.combat.some((a) => /weapon/i.test(a.name)),
      false,
    );
  });

  test("a footnote '*' glued to a skill value does not hide the following attack", () => {
    const [c] = parseCocCharacters(
      "Thug, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        // "Switchblade*65%" would otherwise be swallowed into the Brawl damage.
        "Brawl 65% (32/13), damage 1D3+1D4 Switchblade*65% (32/13), damage 1D6+1D4 Dodge 25% (12/5)",
    );
    assert.deepEqual(
      c.combat.slice(0, 2).map((a) => ({ name: a.name, damage: a.damage })),
      [
        { name: "Brawl", damage: "1D3+1D4" },
        { name: "Switchblade", damage: "1D6+1D4" },
      ],
    );
  });

  test("an accented weapon name is read whole, not truncated at the accent", () => {
    const [c] = parseCocCharacters(
      "Guard, x STR 60 CON 60 SIZ 60 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 12 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10 Combat Attacks per round: 1 " +
        // "Tantō" must not truncate at "ō", which would hide its "65%" profile.
        "Brawl 60% (30/12), damage 1D3+1D4 Tantō 65% (32/13), damage 1D4+1 Dodge 25% (12/5)",
    );
    assert.deepEqual(
      c.combat.slice(0, 2).map((a) => ({ name: a.name, damage: a.damage })),
      [
        { name: "Brawl", damage: "1D3+1D4" },
        { name: "Tantō", damage: "1D4+1" },
      ],
    );
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
    // whole ("Lore (Theology: Methodism)"); compact "Sciences (Biology 70%, ...)"
    // expands per specialisation; a balanced "Science (Physics)" stays intact.
    assert.equal(c.skills["Climb"], 40);
    assert.equal(c.skills["Lore (Theology: Methodism)"], 60);
    assert.equal(c.skills["Science (Biology)"], 70);
    assert.equal(c.skills["Science (Chemistry)"], 90);
    assert.equal(c.skills["Science (Physics)"], 25);
    assert.equal(c.skills["Spot Hidden"], 45);
    // Prose prefix "Varies, assume" dropped; the dedicated "Languages" section's
    // bare names merge into the skills as "Language (X)".
    assert.equal(c.skills["Language (Arabic)"], 35);
    assert.equal(c.skills["Language (English)"], 35);
    // No entry starts lowercase or has unbalanced parentheses.
    const bad = (k: string) =>
      /^[a-z]/.test(k) ||
      (k.match(/\(/g) ?? []).length !== (k.match(/\)/g) ?? []).length;
    assert.ok(!Object.keys(c.skills).some(bad), "a skill name is malformed");
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

  test("a possessive in a group title keeps its 's' lowercase", () => {
    const cs = parseCocCharacters(
      "SCANLON'S VAQUEROS 1 2 " +
        "STR 60 50 CON 55 65 SIZ 60 55 DEX 60 70 INT 65 45 " +
        "APP 50 55 POW 70 45 EDU 30 40 SAN 40 45 HP 12 12 " +
        "DB: 0 Build: 0 Move: 8",
    );
    assert.deepEqual(
      cs.map((c) => c.name),
      ["Scanlon's Vaqueros 1", "Scanlon's Vaqueros 2"],
    );
  });

  // A dedicated "Languages:" section merges into the skills as "Language (X)".
  test("a Languages section merges into skills as Language (X)", () => {
    const [c] = parseCocCharacters(
      "Scholar, x STR 50 CON 50 SIZ 50 DEX 50 INT 60 APP 50 POW 50 EDU 70 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Skills Library Use 60%, Spot Hidden 40%. " +
        "Languages Latin 40%, Greek 25%.",
    );
    assert.equal(c.skills["Library Use"], 60);
    assert.equal(c.skills["Language (Latin)"], 40);
    assert.equal(c.skills["Language (Greek)"], 25);
  });

  // Inline language skills come in several forms; all canonicalise to
  // "Language (X)", and the Pulp "Languages (any desired)" skill is neither a
  // section heading (it must not truncate the skills) nor left uncanonicalised.
  test("inline language skills canonicalise to Language (X)", () => {
    const [c] = parseCocCharacters(
      "Adept, x STR 50 CON 50 SIZ 50 DEX 50 INT 60 APP 50 POW 50 EDU 70 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 " +
        "Skills Own Language (English) 65%, Other Language (French) 30%, " +
        "Languages (any desired) 70%, Listen 55%, Spot Hidden 45%.",
    );
    assert.equal(c.skills["Language (English)"], 65);
    assert.equal(c.skills["Language (French)"], 30);
    assert.equal(c.skills["Language (Any)"], 70);
    // The "Languages (any desired)" skill did not truncate the list.
    assert.equal(c.skills["Listen"], 55);
    assert.equal(c.skills["Spot Hidden"], 45);
    // No "Own/Other Language" or bare "Languages" survives.
    const raw = (k: string) =>
      /^\s*(?:own|other)\s+language|^languages\b/i.test(k);
    assert.ok(
      !Object.keys(c.skills).some(raw),
      "an uncanonicalised language name survives",
    );
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

  test("an ALL-CAPS name with an age is recovered and proper-cased", () => {
    const [c] = parseCocCharacters(
      "JOHN SMITH, 45, harbour master STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 " +
        "DB: 0 Build: 0 Move: 8",
    );
    assert.equal(c.name, "John Smith");
    assert.equal(c.age, 45);
    assert.equal(c.description, "harbour master");
  });

  test("an ALL-CAPS name keeps its apostrophe's next letter lowercase", () => {
    const [c] = parseCocCharacters(
      "Y'HATH, 300, a horror STR 125 CON 385 SIZ 105 DEX 150 INT 125 APP 10 " +
        "POW 300 EDU 10 SAN 10 HP 49 DB: +2D6 Build: 3 Move: 8",
    );
    assert.equal(c.name, "Y'hath");
  });

  test("a paired nickname quote survives ALL-CAPS proper-casing", () => {
    const [c] = parseCocCharacters(
      '"SWEDE" NIELSEN, 40, a henchman STR 85 CON 80 SIZ 80 DEX 60 INT 70 APP 45 ' +
        "POW 55 EDU 55 SAN 50 HP 16 DB: +1D6 Build: 2 Move: 8",
    );
    assert.equal(c.name, '"Swede" Nielsen');
  });

  test("ALL-CAPS proper-casing handles O'/D' particles, slashes, Mc, and quoted connectors", () => {
    const stats =
      " STR 60 CON 60 SIZ 60 DEX 60 INT 60 APP 60 POW 60 EDU 60 SAN 60 HP 12 DB: 0 Build: 0 Move: 8";
    const name = (heading: string) =>
      parseCocCharacters(heading + ", 40, a person" + stats)[0].name;
    assert.equal(name("SEAMUS O'SHEA"), "Seamus O'Shea");
    assert.equal(name("GLA'AKI"), "Gla'aki");
    assert.equal(name("WANG MA/LO MAI"), "Wang Ma/Lo Mai");
    assert.equal(name("DENNY MCDAID"), "Denny McDaid");
    // A connector opening a quoted nickname is capitalised. ("de" is a name
    // particle the text-path name walk accepts; the book's '"THE DOG"' form
    // reaches the same rule via the font-size heading path.)
    assert.equal(name('JOHN "DE" SILVA'), 'John "De" Silva');
  });

  test("a pre-generated investigator's 'Age: N Occupation: X Nationality: Y' heading", () => {
    const [c] = parseCocCharacters(
      "36 INTRODUCTION JANE DOE Age: 29 Occupation: Anthropologist Nationality: Australian " +
        "STR 50 CON 60 SIZ 55 DEX 60 INT 80 APP 65 POW 60 EDU 85 SAN 60 HP 11 DB: 0 Build: 0 Move: 8 MP: 12",
    );
    assert.equal(c.name, "Jane Doe");
    assert.equal(c.age, 29);
    assert.equal(c.description, "Anthropologist");
  });

  test("a quoted name's closing quote after the comma does not hide the age", () => {
    const [c] = parseCocCharacters(
      '"JANE DOE," age 17, spawn of something STR 100 CON 130 SIZ 55 DEX 100 INT 55 ' +
        "APP 15 POW 60 EDU 10 SAN 10 HP 18 DB: +1D4 Build: 1 Move: 11",
    );
    assert.equal(c.name, "Jane Doe");
    assert.equal(c.age, 17);
    assert.equal(c.description, "spawn of something");
  });

  test("a trailing 'Archetype: X' annotation is dropped from the descriptor", () => {
    const [c] = parseCocCharacters(
      "JANE DOE, 36, Medical Doctor Archetype: Scholar STR 50 CON 80 SIZ 65 DEX 45 INT 70 " +
        "APP 55 POW 65 EDU 95 SAN 65 HP 29 DB: 0 Build: 0 Move: 7 MP: 13",
    );
    assert.equal(c.description, "Medical Doctor");
  });

  test("'Average Damage Bonus (DB):' is read as the damage bonus, and a stray word ends a label's values", () => {
    // "CHAPTER 6" (a running header repeating too rarely to be furniture) sits
    // between POW's value and the HP line; its "6" must not become a second
    // POW column, and "+6D6" must land in DB rather than HP.
    const [c] = parseCocCharacters(
      "Big Lizard, carnivore STR 335 (10D6+32) x5 CON 175 (4D6+21) x5 SIZ 265 (6D6+32) x5 " +
        "DEX 80 (2D6+9) x5 POW 65 (2D6+6) x5 CHAPTER 6 HP: 44 Average Damage Bonus (DB): +6D6 " +
        "Average Build: 7 Move: 12 Combat Fighting 60% (30/12), damage 2D6+DB",
    );
    assert.equal(c.name, "Big Lizard");
    assert.equal(c.characteristics.POW!.value, 65);
    assert.equal(c.characteristics.HP!.value, 44);
    assert.equal(c.derived.DB, "+6D6");
    assert.equal(c.derived.Build, 7);
  });

  test("a '/' or '*' between a label and its value is neutral", () => {
    const chars = parseCocCharacters(
      "Leech Host STR 5 50 CON 5 55 SIZ 5 65 POW 35 35 DEX 80 65 INT * 50 (70*) 50 HP: 4 12 " +
        "Average Damage Bonus: 0 Average Build: 0 Move: 8 (leech) / 6 (animated host) Luck: — " +
        "Combat Fighting 30% (15/6), damage 1D3",
    );
    assert.equal(chars.length, 2);
    assert.equal(chars[1].derived.Move, 6);
    assert.equal(chars[0].characteristics.INT!.value, 50);
  });

  test("the 'char. average roll' column header is not part of a name or descriptor", () => {
    const [c] = parseCocCharacters(
      "HORSE char. average roll STR 140 (3D6+18) x5 CON 65 (2D6+6) x5 SIZ 130 (4D6+12) x5 " +
        "DEX 50 (3D6) x5 POW 50 (3D6) x5 HP: 19 Average Damage Bonus (DB): +2D6 Average Build: 3 " +
        "Average Move*: 11 Combat Attacks per round: 1 Fighting 25% (12/5), damage 1D8+DB",
    );
    assert.equal(c.name, "Horse");
    assert.equal(c.description, "");
    assert.equal(c.derived.Move, 11);
    assert.equal(c.derived.DB, "+2D6");
  });

  test("a heading's parenthetical holding a comma is a descriptor, not part of the name", () => {
    const chars = parseCocCharacters(
      "MISCELLANEOUS RANCH-HANDS (Scanlon's vaqueros, Romero's cowboys) #1 #2 " +
        "STR 65 60 CON 75 60 SIZ 60 65 DEX 60 65 INT 60 55 APP 45 55 POW 55 50 EDU 50 45 SAN 55 50 HP 13 12 " +
        "DB: +1D4 +1D4 Build: 1 1 Move: 8 8 Combat Brawl 50% (25/10), damage 1D3+1D4",
    );
    assert.deepEqual(
      chars.map((c) => c.name),
      ["Miscellaneous Ranch-Hands 1", "Miscellaneous Ranch-Hands 2"],
    );
  });

  test("a comma-less 'Name age N, descriptor' heading beats an earlier sidebar entry", () => {
    const [c] = parseCocCharacters(
      "Notable Folk M Jane Roe, 34, human, the manager. M Grant Adam, 39, hybrid, foreman. " +
        "Jerome Bicknell age 34, distillery operator STR 70 APP 55 CON 70 POW 60 SIZ 60 EDU 70 " +
        "DEX 55 SAN 48 INT 85 HP 13 DB +1D4 Build 1 Move 7 MP 12 Combat Brawl 40% (20/8), damage 1D3",
    );
    assert.equal(c.name, "Jerome Bicknell");
    assert.equal(c.age, 34);
    assert.equal(c.description, "distillery operator");
  });

  test("a closing quote after a sentence period is a name boundary", () => {
    const [c] = parseCocCharacters(
      'Details are found in Lovecraft\'s "The Thing on the Doorstep." Morris Grimes age 56, cemetery keeper ' +
        "STR 85 CON 80 SIZ 90 DEX 40 INT 40 APP 15 POW 30 EDU 10 SAN 10 HP 17 DB +1D6 Build 2 Move 5",
    );
    assert.equal(c.name, "Morris Grimes");
  });

  test("the book's index (dot leaders) ends the last block's body", () => {
    const [c] = parseCocCharacters(
      "Jane Doe, 30, clerk STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Traits: nervous and quick. " +
        "INDEX Backstory . . . . . . . 13 Ill Luck (Spell) . . . . . 158 Treasured Possession . . . 14",
    );
    assert.deepEqual(c.background, [
      { title: "Traits", text: "nervous and quick" },
    ]);
  });

  // Font-size runs with page numbers, for the page-based bounds. Body text is
  // 9pt, name headings 11pt, section titles taller.
  function chunked(runs: { t: string; h?: number; p?: number }[]) {
    const chunks: any[] = [];
    let text = "";
    for (const r of runs) {
      if (text) text += " ";
      const start = text.length;
      text += r.t;
      chunks.push({
        text: r.t,
        height: r.h ?? 9,
        start,
        end: text.length,
        newline: true,
        page: r.p ?? 1,
      });
    }
    return { text, chunks };
  }
  const STATS =
    "STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 DB: 0 Build: 0 Move: 8 MP: 10";

  test("a block's body never runs past the page after its STR line", () => {
    const { text, chunks } = chunked([
      { t: "Jane Doe, 30, clerk", h: 11, p: 2 },
      {
        t:
          STATS +
          " Combat Brawl 40% (20/8), damage 1D3 Traits: cunning and dangerous.",
        p: 2,
      },
      {
        t: "The scenario continues on the next page with more about the town.",
        p: 3,
      },
      {
        t: "Nothing on this later page concerns her at all; it is another chapter entirely.",
        p: 5,
      },
      { t: "Bob Roe, 40, farmer", h: 11, p: 8 },
      { t: STATS + " Combat Brawl 30% (15/6), damage 1D3", p: 8 },
    ]);
    const [jane] = parseCocCharacters(text, chunks);
    assert.equal(jane.name, "Jane Doe");
    const traits = jane.background.find((b) => b.title === "Traits")!.text;
    assert.ok(traits.startsWith("cunning and dangerous"));
    assert.ok(!traits.includes("Nothing on this later page"), traits);
  });

  test("a heading is searched on the STR page and the one before only; a tall title there names the block", () => {
    const { text, chunks } = chunked([
      {
        t: "With thanks to John D. Rateliff, and Dean Engelhardt. Thanks to all of the backers.",
        p: 1,
      },
      {
        t: "Pages of rules text follow, none of it about anyone in particular.",
        p: 3,
      },
      { t: "AVERAGE MOOK", h: 17, p: 5 },
      {
        t:
          "STR 40 CON 50 SIZ 50 DEX 45 INT 30 APP 30 POW 30 EDU 40 SAN 30 HP 10 DB: 0 Build: 0 Move: 7 MP: 6 " +
          "Brawl 35% (17/7), damage 1D3 Dodge 25% (12/5) Skills: none.",
        p: 5,
      },
      { t: "Jane Doe, 30, clerk", h: 11, p: 9 },
      { t: STATS + " Combat Brawl 40% (20/8), damage 1D3", p: 9 },
    ]);
    const names = parseCocCharacters(text, chunks).map((c) => c.name);
    assert.deepEqual(names, ["Average Mook", "Jane Doe"]);
  });

  test("a derived-stats line displaced into the skill list is read as derived stats", () => {
    // Two-column layout: the HP/DB/Build/Move/MP column is emitted after the
    // description bullets, in the middle of the skills.
    const [c] = parseCocCharacters(
      "Victor Obrecht age 45, proprietor STR 50 APP 55 CON 70 POW 60 SIZ 60 EDU 65 DEX 55 SAN 53 INT 65 " +
        "M Description: overweight and balding. M Traits: sullen and cautious. " +
        "Skills Appraise 50%, Gambling 60%, Navigate (Innsmouth) HP 13 DB 0 Build 0 Move 6 MP 12 30%, Persuade 45%. " +
        "Combat Fighting 60% (30/12) damage 1D3 Dodge 27% (13/5)",
    );
    assert.equal(c.name, "Victor Obrecht");
    assert.equal(c.characteristics.HP!.value, 13);
    assert.deepEqual(c.derived, {
      DB: "0",
      Build: 0,
      Move: 6,
      MP: 12,
      Luck: null,
    });
    assert.equal(c.skills["Navigate (Innsmouth)"], 30);
    assert.equal(c.skills["Persuade"], 45);
  });

  test("a sidebar's list label and bullet glyph are not part of a name", () => {
    const [c] = parseCocCharacters(
      "Notable Folk M Alice Throckmorton, 60, human, a retired local. M George, deep one, her husband STR 80 CON 60 " +
        "SIZ 55 DEX 50 INT 60 APP 40 POW 55 EDU 50 SAN 50 HP 11 DB: +1D4 Build: 1 Move: 6 MP: 11",
    );
    assert.equal(c.name, "Alice Throckmorton");
    assert.equal(c.description, "human, a retired local");
  });

  test("a comma-less heading's name comes from its own heading run(s), not a sub-heading above", () => {
    const { text, chunks } = chunked([
      { t: "Refinery Workers", h: 10, p: 3 },
      { t: 'Richard "Rich"', h: 16, p: 3 },
      { t: "Gorton", h: 16, p: 3 },
      { t: "age 56, hateful father", p: 3 },
      {
        t: "STR 65 CON 60 SIZ 70 DEX 50 INT 55 APP 30 POW 50 EDU 40 SAN 45 HP 13 DB +1D4 Build 1 Move 7 MP 10 Combat Brawl 50% (25/10), damage 1D3",
        p: 3,
      },
      { t: "Jane Doe, 30, clerk", h: 11, p: 5 },
      { t: STATS + " Combat Brawl 40% (20/8), damage 1D3", p: 5 },
    ]);
    const [c] = parseCocCharacters(text, chunks);
    assert.equal(c.name, 'Richard "Rich" Gorton');
    assert.equal(c.age, 56);
    assert.equal(c.description, "hateful father");
  });

  test("headerless stat lines under one section title are numbered as its members", () => {
    const line = (s: string) => ({ t: s, p: 4 });
    const { text, chunks } = chunked([
      { t: "Jane Doe, 30, clerk", h: 11, p: 2 },
      { t: STATS + " Combat Brawl 40% (20/8), damage 1D3", p: 2 },
      { t: "Profiles: Innsmouth Humans", h: 16, p: 4 },
      line(
        "STR 50 APP 50 CON 50 POW 60 SIZ 45 EDU 45 DEX 70 SAN 60 INT 70 HP 11 DB 0 Build 0 Move 8 MP 12",
      ),
      line(
        "STR 40 APP 50 CON 55 POW 75 SIZ 55 EDU 85 DEX 55 SAN 75 INT 80 HP 11 DB 0 Build 0 Move 8 MP 15",
      ),
      line(
        "STR 40 APP 55 CON 60 POW 50 SIZ 55 EDU 55 DEX 55 SAN 50 INT 65 HP 15 DB +1D4 Build 1 Move 7 MP 10",
      ),
      { t: "Bob Roe, 40, farmer", h: 11, p: 7 },
      { t: STATS + " Combat Brawl 30% (15/6), damage 1D3", p: 7 },
    ]);
    const names = parseCocCharacters(text, chunks).map((c) => c.name);
    assert.deepEqual(names, [
      "Jane Doe",
      "Innsmouth Humans 1",
      "Innsmouth Humans 2",
      "Innsmouth Humans 3",
      "Bob Roe",
    ]);
  });

  test("a creature's stat lines typeset after a following group table are its own", () => {
    // Masks booklet: "Sample Children of the Sphinx" is printed between the
    // Black Sphinx's description and its Fighting/Skills/Armor/Spells/Sanity
    // lines; the Children keep only their table.
    const chars = parseCocCharacters(
      "The Big Beast, spawn of something A monstrous spawn. " +
        "STR 800 CON 400 SIZ 1750 DEX 45 INT 05 APP - POW 375 EDU - SAN - HP 85 DB: +15D6 Build: 16 Move: 8 MP: 75 Luck: - " +
        "Combat Attacks per round: 3 (smash, grab, or munch) Tentacle Grab (mnvr): grabs its victim first. " +
        "SAMPLE CHILDREN OF THE BEAST Cheetah Bull STR 40 60 CON 75 75 SIZ 70 70 DEX 50 40 INT 30 15 POW 55 55 HP 14 14 " +
        "DB 0 +1D4 Build 0 1 Move 7 7 MP 11 11 Attack Bite Gore Fighting 60% (30/12), damage 15D6 " +
        "Tentacle Grab (mnvr) 40% (20/10), allows a munch Skills Sense Prey 35%. Armor: 19-point hide. " +
        "Spells: Contact Something. Sanity loss: 1D4/1D8 Sanity points to see the Big Beast in full.",
    );
    const beast = chars.find((c) => c.name === "The Big Beast")!;
    assert.equal(beast.combat[0].damage, "15D6");
    assert.equal(beast.skills["Sense Prey"], 35);
    assert.equal(beast.armor, "19-point hide");
    assert.deepEqual(beast.spells, ["Contact Something"]);
    assert.match(beast.sanityLoss ?? "", /Big Beast/);
    assert.equal(beast.attacksPerRound, "3 (smash, grab, or munch)");
    const cheetah = chars.find((c) => /Cheetah$/.test(c.name))!;
    assert.deepEqual(cheetah.combat, []);
    assert.equal(cheetah.armor, null);
    assert.equal(cheetah.sanityLoss, null);
  });

  test("a section-less group does not inherit an unrelated creature's sections", () => {
    // Masks book: the Children table is followed by the Black Pharaoh.
    const chars = parseCocCharacters(
      "SAMPLE CHILDREN OF THE BEAST Cheetah Bull STR 40 60 CON 75 75 SIZ 70 70 DEX 50 40 INT 30 15 POW 55 55 HP 14 14 " +
        "DB 0 +1D4 Build 0 1 Move 7 7 MP 11 11 Attack Bite Gore " +
        "The Dark King, avatar of something Tall and haughty. STR 105 CON 75 SIZ 75 DEX 90 INT 430 APP - POW 500 EDU - SAN - " +
        "HP 15 DB: +1D6 Build: 2 Move: 9 MP: 100 Combat Attacks per round: 1 per two rounds (energy blast) " +
        "Energy Blast automatic, damage 20 points Armor: none. Sanity loss: 0/1D2 Sanity points to see the Dark King in his human aspect.",
    );
    const cheetah = chars.find((c) => /Cheetah$/.test(c.name))!;
    assert.deepEqual(cheetah.combat, []);
    assert.equal(cheetah.sanityLoss, null);
    assert.equal(cheetah.attacksPerRound, null);
    // A bare line under a generic-kind Sanity line still shares it (two forms of one creature).
    const forms = parseCocCharacters(
      "Ssathasaa, serpent person STR 60 CON 55 SIZ 55 DEX 75 INT 90 APP - POW 120 EDU - SAN - HP 11 DB: 0 Build: 0 Move: 8 MP: 24 " +
        "Ssathasaa, as Bertha Shipley STR 20 CON 40 SIZ 40 DEX 30 INT 45 APP 45 POW 40 EDU 30 SAN - HP 8 DB: -1 Build: -1 Move: 5 MP: 8 " +
        "Combat Attacks per round: 1 Fighting 60% (30/12), damage 1D3 Dodge 30% (15/6) Skills Stealth 70%. " +
        "Sanity loss: 0/1D6 Sanity points to see a serpent person.",
    );
    assert.equal(forms[0].combat.length, 2);
    assert.match(forms[0].sanityLoss ?? "", /serpent person/);
  });

  test("'Fighting Brawl NN%' is read as the Brawl attack", () => {
    const [c] = parseCocCharacters(
      "Jane Doe, 30, clerk " +
        STATS +
        " Combat Attacks per round: 1 Fighting Brawl 65% (32/13), damage 1D3+1D4 Dodge 35% (17/7)",
    );
    assert.equal(c.combat[0].name, "Brawl");
    assert.equal(c.combat[0].value, 65);
  });

  test("a block's Pulp Combat / Pulp Talents sections become its pulp variant", () => {
    const [c] = parseCocCharacters(
      "Jane Doe, 30, clerk " +
        STATS +
        " Luck: 80 " +
        "Combat Attacks per round: 1 Brawl 60% (30/12), damage 1D3+1D4 or weapon .45 revolver 60% (30/12), damage 1D10+2 Dodge 50% (25/10) " +
        "Pulp Combat Brawl 80% (40/16), damage 1D3+1D4 or weapon .45 revolver 80% (40/16), damage 1D10+2 Dodge 60% (30/12) " +
        "Pulp Talents Alert: never surprised in combat. Tough Guy: soaks up damage, may spend 10 Luck points to shrug off up to 5 hit points worth of damage taken in one combat round. " +
        "Psychic Power : Divination 60%. " +
        "Skills Charm 45%, Climb 60%. Languages English 85%.",
    );
    // The standard block is untouched by the pulp sections.
    assert.equal(c.combat.find((a) => a.name === "Brawl")!.value, 60);
    assert.equal(c.skills["Charm"], 45);
    assert.deepEqual(
      c.pulp!.combat.map((a) => [a.name, a.value]),
      [
        ["Brawl", 80],
        [".45 revolver", 80],
        ["Dodge", 60],
      ],
    );
    assert.deepEqual(c.pulp!.talents, [
      { name: "Alert", description: "Never surprised in combat" },
      {
        name: "Tough Guy",
        description:
          "Soaks up damage, may spend 10 Luck points to shrug off up to 5 hit points worth of damage taken in one combat round",
      },
      { name: "Psychic Power (Divination)", description: "Divination 60%" },
    ]);
    assert.equal(c.pulp!.hp, null);
  });

  test("a block without pulp sections has no pulp field", () => {
    const [c] = parseCocCharacters(
      "Jane Doe, 30, clerk " +
        STATS +
        " Combat Brawl 40% (20/8), damage 1D3 Skills Charm 45%.",
    );
    assert.equal("pulp" in c, false);
  });

  test("an Innsmouth pulp box: bulleted talents with pulp HP/Luck, ended by following prose", () => {
    const chars = parseCocCharacters(
      "Bob Smith age 30, clerk STR 50 APP 50 CON 50 POW 60 SIZ 50 EDU 45 DEX 70 SAN 60 INT 70 HP 11 DB 0 Build 0 Move 8 MP 15 " +
        "Skills Climb 40%. COMBAT % damage Brawl 40% (20/8) damage 1D4+1 Dodge 40% (20/16) Pulp Modification Pulp Talents " +
        "M HP: 20 M Luck: 45 M Fleet Footed: spend 10 Luck to avoid being outnumbered in melee combat for one combat encounter. " +
        "M Quick Draw: does not need to have their firearm readied to gain +50 DEX for combat. Third Floor A walk runs the perimeter. " +
        "Failure: the roll fails. Fumble: the roll fumbles.",
    );
    const [c] = chars;
    assert.equal(c.pulp!.hp, 20);
    assert.equal(c.pulp!.luck, 45);
    assert.deepEqual(
      c.pulp!.talents.map((t) => t.name),
      ["Fleet Footed", "Quick Draw"],
    );
    assert.equal(
      c.pulp!.talents[1].description,
      "Does not need to have their firearm readied to gain +50 DEX for combat",
    );
    // The box's stray "Tough Guy" prose does not become a combat entry.
    assert.deepEqual(
      c.combat.map((a) => a.name),
      ["Brawl", "Dodge"],
    );
  });

  test("Two-Headed Serpent's parenthesised talents, two of them separated by ';'", () => {
    const [c] = parseCocCharacters(
      "Jane Doe, 30, clerk " +
        STATS +
        " Combat Brawl 40% (20/8), damage 1D3 Skills Climb 40%. " +
        "Pulp Talents Rapid Attack (may spend 10 Luck points to gain one further attack in a single combat round); " +
        "F leet Footed (may spend 10 Luck to avoid being outnumbered (e.g. by two or more) in melee combat) " +
        "Armor: 1-point scales. Spells: Contact Yig.",
    );
    assert.deepEqual(c.pulp!.talents, [
      {
        name: "Rapid Attack",
        description:
          "May spend 10 Luck points to gain one further attack in a single combat round",
      },
      {
        name: "Fleet Footed",
        description:
          "May spend 10 Luck to avoid being outnumbered (e.g. by two or more) in melee combat",
      },
    ]);
    assert.equal(c.armor, "1-point scales");
  });

  test("a talent's mid-sentence 'Sanity loss' does not end an Innsmouth box", () => {
    const [c] = parseCocCharacters(
      "Bob Smith age 30, clerk STR 50 APP 50 CON 50 POW 60 SIZ 50 EDU 45 DEX 70 SAN 60 INT 70 HP 11 DB 0 Build 0 Move 8 MP 15 " +
        "Skills Climb 40%. COMBAT % damage Brawl 40% (20/8) damage 1D4+1 Dodge 40% (20/16) Pulp Modification Pulp Talents " +
        "M HP: 20 M Luck: 42 M Hardened: ignores Sanity loss from viewing horrific injuries or the deceased. " +
        "M Resourceful: always has what's needed at hand; spend 10 Luck points to find a useful piece of equipment or tool. " +
        "M Strong Willed: spend 10 Luck points to gain one bonus die when making POW rolls. 611 FULLER RESIDENCE A house.",
    );
    assert.deepEqual(c.pulp!.talents, [
      {
        name: "Hardened",
        description:
          "Ignores Sanity loss from viewing horrific injuries or the deceased",
      },
      {
        name: "Resourceful",
        description:
          "Always has what's needed at hand; spend 10 Luck points to find a useful piece of equipment or tool",
      },
      {
        name: "Strong Willed",
        description:
          "Spend 10 Luck points to gain one bonus die when making POW rolls",
      },
    ]);
    assert.equal(c.sanityLoss, null);
  });

  // Innsmouth's boxes sit in a sidebar, so a page's text order can put one NPC's
  // box after the next NPC's block. Pulp HP is (CON + SIZ) / 5: each box goes to
  // the block whose characteristics give its HP, and one nobody's do is dropped.
  test("Innsmouth pulp boxes are claimed by the actor whose CON + SIZ gives the box's HP", () => {
    const cs = parseCocCharacters(
      "Ann Able age 33, scientist STR 60 APP 60 CON 75 POW 70 SIZ 70 EDU 60 DEX 60 SAN 50 INT 70 HP 14 DB 0 Build 0 Move 8 MP 14 " +
        "Skills Climb 40%. COMBAT % damage Brawl 40% (20/8) damage 1D3 Dodge 30% (15/6) " +
        "Bob Baker age 50, retainer STR 55 APP 55 CON 65 POW 55 SIZ 75 EDU 60 DEX 45 SAN 50 INT 60 HP 14 DB +1D4 Build 1 Move 5 MP 11 " +
        "Skills Listen 60%. COMBAT % damage Fighting 55% (27/11) damage 1D3+1D4 Dodge 30% (15/6) " +
        "Pulp Modification Pulp Talents M HP: 29 M Luck: 60 M Fleet Footed: may spend 10 Luck to avoid being outnumbered in melee combat for one combat encounter. " +
        "M Night Vision: ignore penalty die for shooting in the dark. " +
        "Pulp Modification Pulp Talents M HP: 28 M Luck: 27 M Heavy Hitter: may spend 10 Luck points to add an additional damage die when dealing out melee damage. " +
        "M Quick Draw: does not need to have their firearm readied. " +
        "Pulp Modification Pulp Talents M HP: 40 M Luck: 50 M Alert: never surprised in combat. Third Floor A walk runs the perimeter.",
    );
    assert.equal(cs.length, 2);
    const [ann, bob] = cs;
    assert.equal(ann.pulp!.hp, 29);
    assert.equal(ann.pulp!.luck, 60);
    assert.deepEqual(
      ann.pulp!.talents.map((t) => t.name),
      ["Fleet Footed", "Night Vision"],
    );
    assert.equal(bob.pulp!.hp, 28);
    assert.equal(bob.pulp!.luck, 27);
    assert.deepEqual(
      bob.pulp!.talents.map((t) => t.name),
      ["Heavy Hitter", "Quick Draw"],
    );
  });

  test("a base form does not take the pulp sections printed for its Form continuation", () => {
    const cs = parseCocCharacters(
      "Eloise Vane, 21, heiress STR 35 CON 40 SIZ 60 DEX 45 INT 60 APP 70 POW 50 EDU 70 SAN 46 HP 10 " +
        "DB: 0 Build: 0 Move: 7 MP: 10 Luck: 50 Combat Attacks per round: 1 Brawl 25% (12/5), damage 1D3 Dodge 30% (15/6) " +
        "Skills Charm 40%, Climb 40%. Languages English 70%. " +
        "Eloise in Ghoul Form STR 85 CON 80 SIZ 80 DEX 90 INT 60 APP — POW 50 EDU — SAN — HP 16 " +
        "DB: +1D6 Build: 2 Move: 10 MP: 8 Luck: 50 Combat Attacks per round: 3 Fighting 40% (20/8), damage 1D6+1D6 Dodge 60% (30/12) " +
        "Pulp Combat Fighting 80% (40/16), damage 1D6+1D6 Dodge 70% (35/14) " +
        "Pulp Talents Tough Guy: soaks up damage, may spend 10 Luck points to shrug off up to 5 damage taken in one combat round. " +
        "Skills Climb 60%, Stealth 60%.",
    );
    assert.equal(cs.length, 2);
    const [base, ghoul] = cs;
    assert.equal("pulp" in base, false);
    assert.deepEqual(
      ghoul.pulp!.combat.map((a) => [a.name, a.value]),
      [
        ["Fighting", 80],
        ["Dodge", 70],
      ],
    );
    assert.deepEqual(
      ghoul.pulp!.talents.map((t) => t.name),
      ["Tough Guy"],
    );
  });

  test("a Psychic Power's form is read from the start of a longer description", () => {
    const [c] = parseCocCharacters(
      "Jane Doe, 30, clerk " +
        STATS +
        " Combat Brawl 40% (20/8), damage 1D3 " +
        "Pulp Talents Psychic Power: Psychometry 70%; sense the emotional connections of inanimate objects. " +
        "Strong Willed: gains a bonus die when making POW rolls. Skills Climb 40%.",
    );
    assert.deepEqual(c.pulp!.talents, [
      {
        name: "Psychic Power (Psychometry)",
        description:
          "Psychometry 70%; sense the emotional connections of inanimate objects",
      },
      {
        name: "Strong Willed",
        description: "Gains a bonus die when making POW rolls",
      },
    ]);
  });

  test("the generic NPC member-name fallback keeps its acronym", () => {
    // A group table with numeric column labels and no recoverable title.
    const chars = parseCocCharacters(
      "1 2 STR 60 50 CON 60 50 SIZ 60 50 DEX 60 50 INT 60 50 APP 60 50 POW 60 50 EDU 60 50 SAN 60 50 HP 12 10 " +
        "DB: 0 0 Build: 0 0 Move: 8 8 Combat Brawl 50% (25/10), damage 1D3",
    );
    assert.deepEqual(
      chars.map((c) => c.name),
      ["NPC 1", "NPC 2"],
    );
  });

  test("an unpaired quote left by name truncation is dropped", () => {
    const [c] = parseCocCharacters(
      '"VIOLET SCANLON, age 17, a monster STR 100 CON 130 SIZ 55 DEX 100 INT 55 ' +
        "APP 15 POW 60 EDU 10 SAN 10 HP 18 DB: +1D4 Build: 1 Move: 11",
    );
    assert.equal(c.name, "Violet Scanlon");
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

  // Armor: an "N-point ..." descriptor or "none"; the rulebook's armor-mechanic
  // sentence is not a creature's armor and is rejected.
  test("armor is captured; the rules definition is rejected", () => {
    const [a] = parseCocCharacters(
      "Beast, hide STR 80 CON 80 SIZ 80 DEX 50 INT 40 APP 40 POW 50 EDU 40 SAN 40 HP 16 " +
        "DB: +1D6 Build: 2 Move: 8 MP: 10 Combat Fighting 50% (25/10), damage 1D6 Dodge 25% (12/5) " +
        "Armor: 3-point fur and gristle. Sanity Loss: 1/1D6 Sanity points to see the beast.",
    );
    assert.equal(a.armor, "3-point fur and gristle");
    const [b] = parseCocCharacters(
      "Guard, plain STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Armor: none.",
    );
    assert.equal(b.armor, "none");
    const [c] = parseCocCharacters(
      "Human, plain STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Armor: Each point of armor reduces the damage received by 1 point.",
    );
    assert.equal(c.armor, null);
    // A period inside a parenthetical ("(e.g. ...)") must not cut the value.
    const [d] = parseCocCharacters(
      "Mage, robed STR 50 CON 50 SIZ 50 DEX 50 INT 80 APP 50 POW 90 EDU 80 SAN 40 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 18 " +
        "Armor: none, but the Scepters absorb 1D10 magical damage (e.g. if a spell is cast). " +
        "Sanity Loss: 1/1D6 Sanity points to see it.",
    );
    assert.equal(
      d.armor,
      "none, but the Scepters absorb 1D10 magical damage (e.g. if a spell is cast)",
    );
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

  // A descriptive "Attacks per round" count (dice and/or prose, "1D8 bites per
  // target", "1 per two rounds (energy blast)") is captured in full, bounded at
  // the first attack name.
  test("a descriptive Attacks per round count is captured in full", () => {
    const [a] = parseCocCharacters(
      "Beast, x STR 80 CON 80 SIZ 80 DEX 50 INT 40 APP 40 POW 50 EDU 40 SAN 40 HP 16 " +
        "DB: +1D6 Build: 2 Move: 8 MP: 10 " +
        "Combat Attacks per round: 1D8 bites per target " +
        "Fighting 60% (30/12), damage 1D6 Dodge 30% (15/6)",
    );
    assert.equal(a.attacksPerRound, "1D8 bites per target");
    const [b] = parseCocCharacters(
      "Avatar, dark STR 200 CON 140 SIZ 250 DEX 50 INT 100 APP — POW 70 EDU — SAN — HP 39 " +
        "DB: +5D6 Build: 6 Move: 7 MP: 75 " +
        "Combat Attacks per round: 1 per two rounds (energy blast) " +
        "Energy Blast Automatic, damage, 20 points Dodge 30% (15/6)",
    );
    assert.equal(b.attacksPerRound, "1 per two rounds (energy blast)");
  });

  // A block with two "Combat" headings (one over the attack prose, one over the
  // stat lines) leaves a heading word before the first attack; it must not be
  // read as part of the attack name ("Combat Fighting" -> "Fighting").
  test('a second "Combat" heading is not glued onto the attack name', () => {
    const [c] = parseCocCharacters(
      "Undead, foul STR 100 CON 90 SIZ 65 DEX 75 INT 30 APP 50 POW 50 EDU 20 SAN 40 HP 15 " +
        "DB: +1D6 Build: 2 Move: 7 MP: 10 " +
        "Combat Attacks per round: 1 (grab) " +
        "Grab (mnvr): holds and pins the victim, ready to suck the life out. " +
        "Combat Fighting 60% (30/12), damage 1D6 Dodge 35% (17/7)",
    );
    assert.ok(
      c.combat.some((a) => a.name === "Fighting"),
      "Fighting captured without a Combat prefix",
    );
    assert.ok(
      !c.combat.some((a) => /\bCombat\b/.test(a.name)),
      "an attack name still includes Combat",
    );
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

  // A "Sciences (Biology 70%, Chemistry 90%)" umbrella lists several
  // specialisations with the value inside the parenthetical; each becomes its
  // own "Science (Spec)" skill.
  test('"Sciences (Biology 70%, Chemistry 90%)" expands per specialisation', () => {
    const [c] = parseCocCharacters(
      "Scholar, learned STR 50 CON 50 SIZ 50 DEX 50 INT 80 APP 50 POW 60 EDU 90 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 12 " +
        "Skills Listen 40% Sciences (Biology 70%, Chemistry 90%) Spot Hidden 45%",
    );
    assert.equal(c.skills["Science (Biology)"], 70);
    assert.equal(c.skills["Science (Chemistry)"], 90);
    assert.equal(c.skills["Sciences"], undefined); // umbrella not kept as a skill
    assert.equal(c.skills["Listen"], 40);
    assert.equal(c.skills["Spot Hidden"], 45);
  });

  // A skill whose "%" is dropped but which keeps its "(half/fifth)" pair
  // ("Navigate 10 (5/2)") is still one skill, and does not swallow the next.
  test("a skill missing its % but with a (half/fifth) is captured", () => {
    const [c] = parseCocCharacters(
      "Noble, idle STR 50 CON 40 SIZ 60 DEX 60 INT 50 APP 50 POW 70 EDU 80 SAN 70 HP 10 " +
        "DB: 0 Build: 0 Move: 7 MP: 14 " +
        "Skills Navigate 10 (5/2) Occult 60% (30/12) Ride 50% (25/10)",
    );
    assert.equal(c.skills["Navigate"], 10);
    assert.equal(c.skills["Occult"], 60);
    assert.equal(c.skills["Ride"], 50);
  });

  // Line-break hyphenation ("Per- suade") and a space just inside a parenthesis
  // ("( Japanese)") in a skill name are repaired.
  test("skill names shed line-break hyphenation and paren spaces", () => {
    const [c] = parseCocCharacters(
      "Clerk, x STR 50 CON 50 SIZ 50 DEX 50 INT 60 APP 50 POW 50 EDU 70 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 " +
        "Skills Per- suade 40%, Language ( Japanese) 50%, Science (Lin- guistics) 30%, " +
        "Th row 55%",
    );
    assert.equal(c.skills["Persuade"], 40);
    assert.equal(c.skills["Language (Japanese)"], 50);
    assert.equal(c.skills["Science (Linguistics)"], 30);
    assert.equal(c.skills["Throw"], 55); // ad-hoc "Th row" -> "Throw"
  });

  // A U+FFFD replacement char from a PDF decoding failure is dropped ("Prof�
  // Smith" -> "Prof Smith").
  test("a replacement character is stripped from the text", () => {
    const [c] = parseCocCharacters(
      "Prof� Smith, age 40, scholar STR 50 CON 50 SIZ 50 DEX 50 INT 80 APP 50 " +
        "POW 50 EDU 80 SAN 50 HP 10 DB: 0 Build: 0 Move: 8 MP: 10",
    );
    assert.ok(!/�/.test(c.name), "no replacement char in name");
    assert.equal(c.name, "Prof Smith");
  });

  // A group-size marker "(2)" in a shared-profile name is kept, not treated as a
  // non-name value that ends the name.
  test('a "(N)" group-size marker is part of the name', () => {
    const [c] = parseCocCharacters(
      "Bodyguards (2) Use this profile for all of them. " +
        "STR 60 CON 80 SIZ 65 DEX 55 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 14 " +
        "DB: +1D4 Build: 1 Move: 8 MP: 10",
    );
    assert.equal(c.name, "Bodyguards (2)");
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

  // A "Suggested spells:" preamble introduces the real comma-separated list; the
  // preamble label must not be captured as a spell.
  test('a "Suggested spells:" preamble is dropped, not read as a spell', () => {
    const [c] = parseCocCharacters(
      "Sorcerer, dark STR 50 CON 50 SIZ 50 DEX 50 INT 80 APP 50 POW 90 EDU 80 SAN 20 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 18 " +
        "Spells: any spells as the Keeper wishes. Suggested spells: " +
        "Breath of the Deep, Contact Cthulhu, Wither Limb. See Appendix B.",
    );
    assert.deepEqual(c.spells, [
      "Breath of the Deep",
      "Contact Cthulhu",
      "Wither Limb",
    ]);
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

  // When the last name in a comma list runs off into next-page prose, the
  // over-long entry is trimmed back to the spell name (the capitalised run),
  // while normal-length names — even ones with lowercase words — are kept whole.
  test("a spell name is trimmed where the list bleeds into prose", () => {
    const [c] = parseCocCharacters(
      "Sorcerer, cruel STR 50 CON 50 SIZ 50 DEX 50 INT 80 APP 50 POW 90 EDU 80 SAN 20 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 18 " +
        "Spells: Wither Limb, Contact Deity are tethered close by and their " +
        "barks attract a guard watching the theater at night",
    );
    assert.deepEqual(c.spells, ["Wither Limb", "Contact Deity"]);
  });

  // A "Keeper note:" prose label in the spell region reads like a named,
  // described entry but is not a spell — a real spell name never says "note".
  test('a "Keeper note" label is not read as a spell', () => {
    const [c] = parseCocCharacters(
      "Monster, vast STR 550 CON 350 SIZ 400 DEX 40 INT 60 POW 90 HP 75 " +
        "DB: +6D6 Build: 7 Move: 6 MP: 18 " +
        "Spells: Dominate (variant): the target obeys. Keeper note: this is " +
        "advice for running the scene, not a spell.",
    );
    assert.deepEqual(c.spells, ["Dominate (variant)"]);
  });

  // A pre-gen investigator carries background sections; each is captured under
  // its heading, and the list that precedes them is not swallowed by the prose.
  test("investigator background sections are parsed", () => {
    const [c] = parseCocCharacters(
      "Sleuth, private eye STR 50 CON 50 SIZ 50 DEX 50 INT 70 APP 60 POW 60 EDU 75 SAN 55 HP 10 " +
        "DB: 0 Build: 0 Move: 8 " +
        "Skills: Spot Hidden 60%, Library Use 50%. " +
        "Personal Description: A tall, weathered figure. " +
        "Ideology and Beliefs: The truth will out. " +
        "Traits: Relentless once on a case.",
    );
    assert.deepEqual(
      c.background.map((s) => s.title),
      ["Personal Description", "Ideology and Beliefs", "Traits"],
    );
    assert.equal(c.background[0].text, "A tall, weathered figure");
    assert.equal(c.background[2].text, "Relentless once on a case");
    // The Skills list is not swallowed by the background prose that follows it.
    assert.equal(c.skills["Spot Hidden"], 60);
  });

  // Some sheets head the description block with a bare "Description" (as the
  // Dhole House importer does); it still maps to the Personal Description section.
  test('a bare "Description" heading maps to Personal Description', () => {
    const [c] = parseCocCharacters(
      "Scholar, retired STR 40 CON 45 SIZ 55 DEX 45 INT 80 APP 55 POW 65 EDU 85 SAN 60 HP 10 " +
        "DB: 0 Build: 0 Move: 7 " +
        "Description: A stooped man with ink-stained fingers. " +
        "Traits: Meticulous to a fault.",
    );
    assert.deepEqual(
      c.background.map((s) => s.title),
      ["Personal Description", "Traits"],
    );
    assert.equal(
      c.background[0].text,
      "A stooped man with ink-stained fingers",
    );
  });

  // A monster's unbounded body can bleed into rules prose mentioning a heading
  // word; without the human characteristics (APP/EDU) an investigator sheet
  // requires, that is not a background.
  test("a creature without APP/EDU gets no background from prose bleed", () => {
    const [c] = parseCocCharacters(
      "Horror, foul STR 90 CON 90 SIZ 120 DEX 40 INT 50 APP - POW 80 EDU - SAN - HP 21 " +
        "DB: +1D6 Build: 2 Move: 8 " +
        "Sanity Loss: 1/1D8 Sanity points to see it. " +
        "Significant People: madness-table prose mentioning a Significant Person.",
    );
    assert.deepEqual(c.background, []);
  });

  // A pre-gen's carried gear is printed as a comma list under a bare
  // "Possessions"/"Equipment" heading; it is parsed into an items array with the
  // trailing "and" dropped and leading dots (".38") preserved.
  test("a Possessions gear list is parsed into an items array", () => {
    const [c] = parseCocCharacters(
      "Sleuth, private eye, age 40 STR 50 CON 50 SIZ 50 DEX 50 INT 70 APP 60 POW 60 EDU 75 SAN 55 HP 10 " +
        "DB: 0 Build: 0 Move: 8 " +
        "Skills: Spot Hidden 60%. " +
        "Possessions Notebook, engraved fountain pen, and a .38 revolver.",
    );
    assert.deepEqual(c.items, [
      "Notebook",
      "engraved fountain pen",
      "a .38 revolver",
    ]);
  });

  // A comma inside brackets itemizes one item's contents and must not split it
  // ("ghost hunting kit (talcum powder, thermometer, string)" is one item).
  test("a bracketed sub-list stays a single item", () => {
    const [c] = parseCocCharacters(
      "Sleuth, private eye, age 40 STR 50 CON 50 SIZ 50 DEX 50 INT 70 APP 60 POW 60 EDU 75 SAN 55 HP 10 " +
        "DB: 0 Build: 0 Move: 8 " +
        "Equipment: ghost hunting kit (talcum powder, thermometer, string, Holy Bible), flashlight, notebook",
    );
    assert.deepEqual(c.items, [
      "ghost hunting kit (talcum powder, thermometer, string, Holy Bible)",
      "flashlight",
      "notebook",
    ]);
  });

  // "Treasured Possessions" is the background/ties section, not a gear list — the
  // items parser must not pick it up.
  test("a Treasured Possessions section is not read as a gear list", () => {
    const [c] = parseCocCharacters(
      "Clerk, timid STR 50 CON 50 SIZ 50 DEX 50 INT 70 APP 60 POW 60 EDU 75 SAN 55 HP 10 " +
        "DB: 0 Build: 0 Move: 8 " +
        "Treasured Possessions: a photograph of a lost love.",
    );
    assert.deepEqual(c.items, []);
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

  // A creature with two forms lists a qualified "Skills (human)" / "Skills (Beast
  // Form)" per form after the last form's stats; each form gets its own, and the
  // base form also inherits the shared Languages/Sanity.
  test("a two-form creature routes qualified skills to each form", () => {
    const cs = parseCocCharacters(
      "Shifter, were-thing Human Form STR 60 CON 70 SIZ 55 DEX 95 INT 80 APP 90 POW 90 EDU 90 SAN 45 HP 12 " +
        "DB: 0 Build: 0 Move: 9 MP: 18 Combat Attacks per round (human): 2 Brawl 70% (35/14), damage 1D4 Dodge 45% (22/9) " +
        "Beast Form STR 90 CON 75 SIZ 90 DEX 120 INT 80 APP — POW 95 EDU — SAN — HP 16 " +
        "DB: +1D6 Build: 2 Move: 12 MP: 19 Combat Attacks per round: 2 Fighting 50% (25/10), damage 1D6 Dodge 60% (30/12) " +
        "Skills (human) Climb 75%, Stealth 75%. Skills (Beast Form) Climb 95%, Stealth 100%. " +
        "Languages English 35%. Sanity loss: 0/1D6 Sanity points to see it change.",
    );
    assert.equal(cs.length, 2);
    const [base, beast] = cs;
    assert.equal(base.skills["Climb"], 75); // human form's own skills
    assert.equal(base.skills["Stealth"], 75);
    assert.equal(base.skills["Language (English)"], 35); // shared section inherited
    assert.match(base.sanityLoss ?? "", /0\/1D6/); // shared section inherited
    assert.equal(beast.skills["Climb"], 95); // beast form's own skills
    assert.equal(beast.skills["Stealth"], 100);
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

  test("a bestiary '(page NNN)' cross-reference is stripped from the name", () => {
    const [c] = parseCocCharacters(
      "The Beast (page 306), horror STR 80 CON 80 SIZ 90 DEX 60 INT 50 APP — POW 60 EDU — SAN — HP 17 " +
        "DB: +2D6 Build: 3 Move: 8 MP: 12",
    );
    assert.equal(c.name, "The Beast");
  });

  test("a header far from STR (a sidebar wedged before the stats) is still recovered", () => {
    const sidebar = "SIDEBAR BOX " + "boxed prose ".repeat(30); // > the near window
    const [, villain] = parseCocCharacters(
      "First NPC, age 20, a bystander STR 50 CON 50 SIZ 50 DEX 50 INT 50 APP 50 POW 50 EDU 50 SAN 50 HP 10 " +
        "DB: 0 Build: 0 Move: 8 " +
        "Hector Sample, age 33, a villain He then did many bad things over a long paragraph. " +
        sidebar +
        "STR 60 CON 70 SIZ 55 DEX 65 INT 55 APP 45 POW 80 EDU 70 SAN 50 HP 12 DB: +1D4 Build: 1 Move: 8",
    );
    assert.equal(villain.name, "Hector Sample");
    assert.equal(villain.age, 33);
    assert.equal(villain.description, "a villain");
  });

  test("a credits-list name (empty block, connector description) is dropped", () => {
    // A name picked out of "... Contributor, and Someone ..." leaves description
    // "and" and no combat/skills/spells — not a real actor.
    const cs = parseCocCharacters(
      "Contributor, and STR 40 CON 50 SIZ 50 DEX 45 INT 30 APP 30 POW 30 EDU 40 SAN 30 HP 10 " +
        "DB: 0 Build: 0 Move: 8 MP: 6",
    );
    assert.deepEqual(cs, []);
  });

  test("a minimal creature (only characteristics) with a real description is kept", () => {
    const [c] = parseCocCharacters(
      "The Sphinx, ancient guardian STR 90 CON 90 SIZ 120 DEX 40 INT 80 APP — POW 90 EDU — SAN — HP 21 " +
        "DB: +3D6 Build: 4 Move: 8 MP: 18",
    );
    assert.equal(c.name, "The Sphinx");
    assert.equal(c.description, "ancient guardian");
  });

  // Modern Chaosium two-column sheets flatten as STR…APP…CON… (zigzag), not
  // classic STR…CON…. Innsmouth and similar books use this layout.
  test("zigzag STR APP CON characteristic order is recognised", () => {
    const [c] = parseCocCharacters(
      "Tough Hybrid, age 30, EOD agent STR 70 APP 30 CON 60 POW 45 SIZ 55 EDU 50 DEX 70 SAN — INT 50 " +
        "HP 11 DB +1D4 Build 1 Move 9 MP 9 " +
        "Combat Brawl 65% (32/13) damage 1D3+DB Dodge 35% (17/7) " +
        "Skills Climb 50%, Swim 60%.",
    );
    assert.equal(c.name, "Tough Hybrid");
    assert.equal(c.age, 30);
    assert.equal(c.characteristics.STR!.value, 70);
    assert.equal(c.characteristics.APP!.value, 30);
    assert.equal(c.characteristics.CON!.value, 60);
    assert.equal(c.characteristics.SAN!.value, null);
    assert.equal(c.characteristics.INT!.value, 50);
    assert.equal(c.derived.DB, "+1D4");
  });

  test("zigzag layout still keeps classic STR CON blocks", () => {
    const cs = parseCocCharacters(
      "Classic Guard, age 40, watchman STR 60 CON 70 SIZ 55 DEX 50 INT 50 APP 45 POW 50 EDU 40 SAN 50 HP 12 " +
        "DB: 0 Build: 0 Move: 8 MP: 10 Combat Brawl 40% (20/8) damage 1D3 " +
        "Skills Listen 40%. " +
        "Zig Agent, age 25, hybrid STR 70 APP 30 CON 60 POW 45 SIZ 55 EDU 50 DEX 70 SAN — INT 50 " +
        "HP 11 DB 0 Build 0 Move 9 MP 9 Combat Brawl 50% (25/10) damage 1D3 " +
        "Skills Swim 70%.",
    );
    assert.equal(cs.length, 2);
    assert.equal(cs[0].characteristics.STR!.value, 60);
    assert.equal(cs[0].characteristics.CON!.value, 70);
    assert.equal(cs[1].characteristics.APP!.value, 30);
    assert.equal(cs[1].characteristics.CON!.value, 60);
  });

  test("zigzag accepts EDU ? as a null characteristic", () => {
    const [c] = parseCocCharacters(
      "Funny Sam, age 39, secretive vagrant STR 75 APP 25 CON 85 POW 45 SIZ 85 EDU ? DEX 50 SAN 31 INT 50 " +
        "HP 17 DB +1D4 Build 1 Move 7 MP 9 Combat Brawl 40% (20/8) damage 1D3 " +
        "Skills Stealth 50%.",
    );
    assert.equal(c.characteristics.EDU!.value, null);
    assert.equal(c.characteristics.EDU!.raw, "?");
    assert.equal(c.characteristics.STR!.value, 75);
  });
});
