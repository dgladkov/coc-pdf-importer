// Ad-hoc importer for the Down Darker Trails (Old West) sourcebook's reference
// chapters: its occupations, the altered/new skill write-ups from its skill
// list, its typical-weapons tables, and its shamanic/folk magic spells. Like
// pulp.ts and appendix.ts, this reads the book's fixed reference content (not
// per-NPC stat blocks) and is pure text-in, structures-out — no pdf.js or
// Foundry API. Foundry shaping (resolving skill names to CoCIDs, building item
// documents) happens in document.ts.
import { parseSpellCosts } from "./appendix.ts";
import type { SpellCosts } from "./appendix.ts";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanSpaces(s: string): string {
  return s
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,;:])/g, "$1")
    // Collapse space-before-period only for a real sentence end, not a caliber
    // marker (".22", ".44") — those keep their leading space ("or .22", "Big
    // .50") since the period there belongs to the number, not the prior word.
    .replace(/\s+\.(?!\d)/g, ".")
    // Close a spurious space PDF extraction leaves inside a compound
    // ("Spear/ Brawl" -> "Spear/Brawl").
    .replace(/\/\s+/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

// This book's running headers/footers ("20 20 CHAPTER 1", "41 41 EQUIPMENT &
// WEAPONS") interleave into the reading-order text at page boundaries, and a
// decorative dingbat font used for chapter-opening ornaments extracts as
// Private Use Area codepoints. Strip both so neither leaks into parsed fields.
function stripFurniture(s: string): string {
  return s
    .replace(/[-]/g, " ")
    .replace(/\b\d{1,3}\s+\d{1,3}\s+CHAPTER\s+\d+\b/g, " ")
    .replace(/\b\d{1,3}\s+\d{1,3}\s+OLD WEST INVESTIGATORS\b/gi, " ")
    .replace(/\b\d{1,3}\s+\d{1,3}\s+EQUIPMENT\s*(?:&|and)\s*WEAPONS\b/gi, " ")
    .replace(/\b\d{1,3}\s+\d{1,3}\s+THE SUPERNATURAL WEST\b/gi, " ")
    // An illustration-only page prints just its own page number once, not the
    // usual repeated "NN NN" header pair, before this same running title.
    .replace(/\b\d{1,3}\s+THE SUPERNATURAL WEST\b/gi, " ")
    // A photo caption sits directly before the spells chapter's first entry,
    // with no punctuation between them once the running header above is gone.
    .replace(/\bA Hopi Snake Priest\b/g, " ")
    // An "Opposite: <caption>" plate credit lands mid-sentence in Unmask
    // Demon's description at a page break.
    .replace(/\bOpposite:\s*The Sun Dance\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Occupations
// ---------------------------------------------------------------------------

// The book's 26 Old West occupations, in print order (alphabetical) — a niche,
// book-specific anchor list in the same spirit as pulp.ts's ARCHETYPE_NAMES:
// each occupation's own "• Occupation Skill Points:" bullet is a reliable
// anchor, but the heading text above it needs a known name to search for.
const OCCUPATION_NAMES = [
  "Artist", "Confidence Trickster", "Cowboy/Cowgirl", "Craftsperson",
  "Dilettante/Greenhorn", "Doctor", "Entertainer", "Expressman/Expresswoman",
  "Farmer", "Gambler", "Gunfighter", "Hobo/Drifter", "Journalist/Author",
  "Lawman", "Lawyer/Judge", "Man or Woman of God", "Merchant",
  "Miner/Prospector", "Outlaw", "Politician", "Rancher", "Scholar/Teacher",
  "Scientist/Engineer", "Scout/Mountain Man or Woman", "Soldier/Warrior",
  "Unskilled Laborer",
];

export interface OldWestSkillPoint {
  multiplier: number;
  selected: true;
  optional: boolean;
}

export interface OldWestSkillGroup {
  options: number;
  skills: string[];
}

export interface OldWestOccupation {
  name: string;
  description: string;
  // Keyed by lowercase characteristic (str/con/siz/dex/app/int/pow/edu), per the
  // CoC7 "occupation" item schema.
  occupationSkillPoints: Record<string, OldWestSkillPoint>;
  creditRating: { min: number; max: number };
  skills: string[]; // fixed/common skills, source-faithful names
  groups: OldWestSkillGroup[]; // "one interpersonal skill (Charm, Fast Talk, ...)"
  personal: number; // "any N other skills as personal or era specialties"
  personalText: string;
  special: string; // optional "• Special:" clause (e.g. Sanity loss immunity)
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

// "EDU × 2 + (DEX × 2 or POW × 2)." -> the plain terms outside the parens are
// mandatory; each term inside the (... or ...) group is an alternative (the
// player picks one), so all of them are marked optional.
function parseOccupationSkillPoints(
  raw: string,
): Record<string, OldWestSkillPoint> {
  const result: Record<string, OldWestSkillPoint> = {};
  const paren = raw.match(/\(([^)]*)\)/);
  const mandatory = paren
    ? raw.slice(0, paren.index) + raw.slice(paren.index! + paren[0].length)
    : raw;
  const termRe = /([A-Z]{3})\s*[×xX]\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = termRe.exec(mandatory))) {
    result[m[1].toLowerCase()] = {
      multiplier: Number(m[2]),
      selected: true,
      optional: false,
    };
  }
  if (paren) {
    for (const term of paren[1].split(/\s+or\s+/i)) {
      const tm = term.match(/([A-Z]{3})\s*[×xX]\s*(\d+)/);
      if (tm) {
        result[tm[1].toLowerCase()] = {
          multiplier: Number(tm[2]),
          selected: true,
          optional: true,
        };
      }
    }
  }
  return result;
}

// "6–60." / "9–30 (10–60 for author)." -> the primary range (a parenthetical
// variant note, when present, is dropped — it's prose, not a second range).
function parseCreditRating(raw: string): { min: number; max: number } {
  const m = raw.match(/(\d+)\s*[–-]\s*(\d+)/);
  return m ? { min: Number(m[1]), max: Number(m[2]) } : { min: 0, max: 0 };
}

// Paren-aware comma split: a choice clause's own alternatives ("one
// interpersonal skill (Charm, Fast Talk, Intimidate, or Persuade)") must stay
// one segment, not be shattered by their internal commas.
function splitSkillSegments(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts
    .map((p) => p.replace(/^\s*and\s+/i, "").trim())
    .filter(Boolean);
}

// Sort a skills list (already comma-split) into fixed/common skills, "choose N
// from (A, B, C)" groups, and the trailing "any N other skills as personal or
// era specialties" clause.
function classifySkillSegments(raw: string): {
  skills: string[];
  groups: OldWestSkillGroup[];
  personal: number;
  personalText: string;
} {
  const skills: string[] = [];
  const groups: OldWestSkillGroup[] = [];
  let personal = 0;
  let personalText = "";
  for (const segment of splitSkillSegments(raw)) {
    const seg = segment.replace(/\.\s*$/, "").trim();
    if (!seg) continue;
    // Usually "any N other skills as ..."; occasionally just "N other skill(s)
    // as ..." when the "and" that introduced it (already stripped) carried the
    // meaning "any" would elsewhere (e.g. Gambler's "and one other skill...").
    const personalMatch = seg.match(
      /^(?:any\s+)?(one|two|three|four)\s+(other\s+skills?\s+as\s+.+)$/i,
    );
    if (personalMatch) {
      personal = WORD_NUM[personalMatch[1].toLowerCase()] ?? 1;
      personalText = personalMatch[2];
      continue;
    }
    const groupMatch = seg.match(
      /^(one|two|three|four)\s+[a-z][a-z\s]*?\s+skills?\s*\(([^)]+)\)$/i,
    );
    if (groupMatch) {
      // "Charm, Fast Talk, Intimidate, or Persuade" — the comma before the
      // final item also swallows its "or"/"and", so that doesn't survive as a
      // leftover word on the last pool entry.
      const pool = groupMatch[2]
        .split(/,\s*(?:or|and)\s+|,\s*|\s+or\s+|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
      groups.push({
        options: WORD_NUM[groupMatch[1].toLowerCase()] ?? 1,
        skills: pool,
      });
      continue;
    }
    skills.push(seg.replace(/\(any\)/gi, "(Any)"));
  }
  return { skills, groups, personal, personalText };
}

// A Civil War character-creation sidebar is interleaved between the
// Soldier/Warrior and Unskilled Laborer entries in reading order; strip it so
// it doesn't leak into Soldier/Warrior's Special clause.
const CIVIL_WAR_SIDEBAR =
  /OPTIONAL RULE: INVESTIGATORS WITH CIVIL WAR EXPERIENCE[\s\S]*?viewing a corpse or gross injury\./;

// The occupations chapter's running header. "Occupation Skill Points:" bullets
// and the occupation names above are generic — Pulp Cthulhu has 66 such bullets
// and prose containing "Doctor", "Farmer", … — so the anchors alone would parse
// any investigator rulebook into 22 bogus Old West occupations. Only Down Darker
// Trails carries this header.
const OLD_WEST_MARKER = /\bOLD WEST INVESTIGATORS\b/;

export function parseOldWestOccupations(rawText: string): OldWestOccupation[] {
  if (!OLD_WEST_MARKER.test(rawText)) return [];
  const text = cleanSpaces(
    stripFurniture(rawText).replace(CIVIL_WAR_SIDEBAR, " "),
  );

  const anchors = [...text.matchAll(/Occupation Skill Points:/g)].map(
    (m) => m.index!,
  );
  if (anchors.length === 0) return [];
  const count = Math.min(anchors.length, OCCUPATION_NAMES.length);

  // Each occupation's heading (its name) sits between the end of the previous
  // occupation's own name and its "Occupation Skill Points:" anchor. Locate all
  // headings up front, searching forward from the end of the previous one, so
  // the description (the prose paragraph) can be sliced out per occupation.
  const headingStart: number[] = [];
  let searchFrom = 0;
  for (let i = 0; i < count; i++) {
    const re = new RegExp(String.raw`\b${escapeRe(OCCUPATION_NAMES[i])}\b`);
    const m = re.exec(text.slice(searchFrom, anchors[i]));
    const start = m ? searchFrom + m.index : anchors[i];
    headingStart.push(start);
    searchFrom = start + OCCUPATION_NAMES[i].length;
  }

  const occupations: OldWestOccupation[] = [];
  for (let i = 0; i < count; i++) {
    const anchor = anchors[i];
    const name = OCCUPATION_NAMES[i];
    const description = cleanSpaces(
      text.slice(headingStart[i] + name.length, anchor).replace(/•\s*$/, ""),
    );

    // Bound this occupation's field block at the next occupation's heading; the
    // last occupation has none, so fall back to the "SKILL LIST" section marker
    // that follows it (or a generous window, if that isn't found either).
    let windowEnd: number;
    if (i + 1 < count) {
      windowEnd = headingStart[i + 1];
    } else {
      const tailWindow = text.slice(anchor, Math.min(text.length, anchor + 2500));
      const tail = tailWindow.match(/\bSKILL LIST\b/);
      windowEnd = tail ? anchor + tail.index! : anchor + tailWindow.length;
    }
    const block = text.slice(anchor, windowEnd);

    const pointsMatch = block.match(/Occupation Skill Points:\s*(.+?)\s*•/);
    // A dropped-cap font artifact sometimes splits "Credit" into "C redit".
    const creditMatch = block.match(/C\s*redit\s+Rating\s*:\s*(.+?)\s*•/);
    const skillsMatch = block.match(/Skills:\s*(.+?)(?:\s*•\s*Special:|$)/);
    // Special clauses are a single sentence; bound at its first closing paren +
    // period rather than the next heading, so nothing printed after it (e.g. a
    // sidebar) can leak in.
    const specialMatch = block.match(/Special:\s*(.+?\))\./);
    if (!pointsMatch || !creditMatch || !skillsMatch) continue;

    const { skills, groups, personal, personalText } = classifySkillSegments(
      skillsMatch[1],
    );

    occupations.push({
      name,
      description,
      occupationSkillPoints: parseOccupationSkillPoints(pointsMatch[1]),
      creditRating: parseCreditRating(creditMatch[1]),
      skills,
      groups,
      personal,
      personalText,
      special: specialMatch ? cleanSpaces(specialMatch[1]) : "",
    });
  }
  return occupations;
}

// ---------------------------------------------------------------------------
// Altered / new skills
// ---------------------------------------------------------------------------

// The skill list's plain base-percentage table just restates skills already in
// the system's skill compendium, so it isn't imported. Only the write-ups this
// book actually adds new rules text for are worth an Item: the ones it tweaked
// ("ALTERED SKILLS") and the ones it invented ("NEW SKILLS"), each a fixed,
// book-specific name list in print order (same anchor-list approach as the
// occupations above).
const ALTERED_SKILL_NAMES = [
  "Drive Auto", "Drive Wagon/Coach", "Electrical Repair", "Natural World",
  "Psychology", "Language (Own)", "Ride",
];
const NEW_SKILL_NAMES = ["Gambling", "Language (Indian)", "Rope Use", "Trap"];

export interface OldWestSkill {
  name: string;
  base: string; // e.g. "10%", "half DEX", "EDU%"
  description: string;
}

// All four "NEW SKILLS" entries with game-mechanical Push rules end on this
// exact sentence pattern; when present it is a tighter, more reliable end
// boundary than "next known name" (which the last entry in a group lacks).
const PUSH_INSANE_SENTENCE = /If an insane investigator fails a pushed roll,[^.]*\./;

function parseSkillNameGroup(
  names: string[],
  section: string,
): OldWestSkill[] {
  const skills: OldWestSkill[] = [];
  let searchFrom = 0;
  for (let i = 0; i < names.length; i++) {
    const nameRe = new RegExp(
      String.raw`\b${escapeRe(names[i])}\s*\(([^)]*)\)`,
    );
    const m = nameRe.exec(section.slice(searchFrom));
    if (!m) continue;
    const afterName = searchFrom + m.index + m[0].length;
    // An altered skill's colon, and/or an "[Uncommon]"/"[Specializations]" tag,
    // sit between the "(base%)" and the description; skip past them.
    const lead = /^\s*(?:\[[^\]]*\]\s*)?:?\s*/.exec(section.slice(afterName))!;
    const descStart = afterName + lead[0].length;

    const next = names[i + 1];
    let descEnd = section.length;
    if (next) {
      const nm = new RegExp(String.raw`\b${escapeRe(next)}\s*\(`).exec(
        section.slice(descStart),
      );
      if (nm) descEnd = descStart + nm.index;
    }
    let description = cleanSpaces(section.slice(descStart, descEnd));
    const insane = PUSH_INSANE_SENTENCE.exec(description);
    if (insane) description = description.slice(0, insane.index + insane[0].length);

    skills.push({ name: names[i], base: cleanSpaces(m[1]), description });
    searchFrom = descStart;
  }
  return skills;
}

export function parseOldWestSkills(rawText: string): OldWestSkill[] {
  const text = cleanSpaces(stripFurniture(rawText));
  const alteredHeader = text.indexOf("ALTERED SKILLS");
  const newHeader = text.indexOf("NEW SKILLS", alteredHeader);
  if (alteredHeader < 0 || newHeader < 0) return [];
  const endMarker = text.indexOf("EQUIPMENT & WEAPONS", newHeader);
  const end = endMarker >= 0 ? endMarker : Math.min(text.length, newHeader + 6000);

  const alteredSection = text.slice(alteredHeader + "ALTERED SKILLS".length, newHeader);
  const newSection = text.slice(newHeader + "NEW SKILLS".length, end);

  return [
    ...parseSkillNameGroup(ALTERED_SKILL_NAMES, alteredSection),
    ...parseSkillNameGroup(NEW_SKILL_NAMES, newSection),
  ];
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export interface OldWestWeapon {
  name: string;
  skill: string;
  damage: string;
  baseRange: string;
  usesPerRound: string;
  bullets: number | null;
  malfunction: number | null;
  cost: string;
  availability: string;
  impale: boolean;
  thrown: boolean;
  ranged: boolean;
  auto: boolean;
}

// A bare (non-parenthesised, non-space) token — the shape of a Range/Uses per
// Round/Bullets cell, which may carry a "(...)" alt-mode note or an "or"
// alternative ("9 (1)", "1 or 3", "15 (10/20/50)").
const TOK = String.raw`[^\s()]+`;
const FIELD = String.raw`${TOK}(?:\s*\([^)]*\))?(?:\s+or\s+${TOK})?`;
// A dice-damage term, allowing a "/"-separated spread (short/medium/long range
// shotgun damage) and a trailing non-numeric bonus ("+burn", "+half DB", "+DB").
const DICE_CHAIN = String.raw`\d*[Dd]\d+(?:[+-]\d+)?(?:\/\d*[Dd]?\d+(?:[+-]\d+)?)*`;
const DAMAGE_TERM = String.raw`${DICE_CHAIN}(?:\+(?:burn|half\s+DB|DB))?`;
const DAMAGE = String.raw`${DAMAGE_TERM}(?:\s*\([^)]*\))?(?:\s+or\s+${DAMAGE_TERM})?`;
const AVAIL = String.raw`\b(?:C|U|R|VR)\b(?:\/(?:C|U|R|VR)\b)?`;
const COST = String.raw`\$[\d.]+|N\/A|-`;
const MALF = String.raw`\d{2,3}|N\/A`;

// Matched fully-anchored against ONE ROW AT A TIME (see splitRows below), never
// scanned across a whole table section: several of these groups nest optional
// alternations, and letting the regex engine hunt for a match start position
// across a multi-hundred-character span invites catastrophic backtracking. An
// anchored match against a single ~40-90 char row is cheap regardless.
const FIREARM_ROW = new RegExp(
  String.raw`^(.+?)\s+(${DAMAGE})\s+(${FIELD})\s+(Full\s+Auto|${FIELD})\s+(${FIELD})\s+(${MALF})\s+(${COST})\s+(${AVAIL})$`,
);

// The melee table's Skill column is drawn from a small closed vocabulary
// (Fighting/Firearms/Rope Use/Throw), which anchors the Name/Skill boundary —
// unlike firearm names, melee weapon names can't be told apart from arbitrary
// prose by shape alone.
const MELEE_SKILL = String.raw`(?:Fighting|Firearms|Rope Use|Throw)(?:\s*\([^)]*\))?(?:\s+or\s+(?:Fighting(?:\s*\([^)]*\))?|Firearms(?:\s*\([^)]*\))?|Throw|Rope Use))?`;
const MELEE_RANGE = String.raw`Touch(?:\s+or\s+STR\s+yards)?|\d+(?:-\d+)?\s+(?:yards|feet)`;
const MELEE_ROW = new RegExp(
  String.raw`^(.+?)\s+(${MELEE_SKILL})\s+(entangle|${DAMAGE})(?:,\s*or\s+entangle)?\s+(${MELEE_RANGE})\s+(\d+(?:\/\d+)?)\s+(${MALF})\s+(${COST})\s+(${AVAIL})$`,
);

// Availability is a closed 4-code vocabulary and always the row's last field, so
// it's a cheap, unambiguous row terminator. Split on it first (fast: no nested
// optional groups) so each field regex above only ever runs against one short
// row's text, never a whole table section.
const AVAIL_TOKEN = new RegExp(AVAIL, "g");
function splitRows(section: string): string[] {
  const rows: string[] = [];
  let start = 0;
  let m: RegExpExecArray | null;
  AVAIL_TOKEN.lastIndex = 0;
  while ((m = AVAIL_TOKEN.exec(section))) {
    rows.push(section.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  return rows.filter(Boolean);
}

interface FirearmTableSpec {
  header: string; // section heading text this table starts at
  defaultSkill: string; // "All use the X skill" — applied to every row
  // A name -> skill override for a stated per-weapon exception (e.g. "except
  // for Remington Rifle Cane, which uses the Firearms (Rifle/Shotgun) skill").
  exceptionName?: string;
  exceptionSkill?: string;
  impale: boolean;
}

function findFirearmTables(text: string): FirearmTableSpec[] {
  const specs: FirearmTableSpec[] = [];
  const HEADERS = [
    "REVOLVERS",
    "HOLDOUT WEAPONS",
    "RIFLES",
    "SHOTGUNS",
    "HEAVY WEAPONS",
  ];
  for (const header of HEADERS) {
    const start = text.indexOf(header);
    if (start < 0) continue;
    // Bound the rule-bullets text at the table's own column-header row, not a
    // bare "Gun" (which also occurs mid-word in a rule bullet, e.g. "Machine
    // Gun)" in the Heavy Weapons skill note — that would truncate it early.
    const headerRow = text.slice(start).match(/\bGun\s+Damage\s+Base\s+Range\b/);
    const ruleText = headerRow
      ? text.slice(start, start + headerRow.index!)
      : "";
    // Most tables state one blanket skill ("All use the X skill, base N%.");
    // Heavy Weapons instead names the skill per weapon ("Gatling gun uses
    // Firearms (Machine Gun) skill, base 10%.") since its rows don't share one.
    const skillMatch =
      ruleText.match(/All use the ([^,]+?) skill,\s*base\s*\d+%/) ??
      ruleText.match(/uses\s+(?:the\s+)?([^,]+?)\s+skill,\s*base\s*\d+%/i);
    const exceptionMatch = ruleText.match(
      /except for ([^,]+),\s*which uses the ([^,]+?) skill/,
    );
    specs.push({
      header,
      defaultSkill: skillMatch ? cleanSpaces(skillMatch[1]) : "",
      exceptionName: exceptionMatch ? cleanSpaces(exceptionMatch[1]) : undefined,
      exceptionSkill: exceptionMatch ? cleanSpaces(exceptionMatch[2]) : undefined,
      impale: !/cannot impale/i.test(ruleText),
    });
  }
  return specs;
}

function sectionBounds(text: string, header: string, allHeaders: string[]): {
  start: number;
  end: number;
} {
  const start = text.indexOf(header);
  if (start < 0) return { start: -1, end: -1 };
  const afterAvail = text.indexOf("Availability", start);
  const rowStart = afterAvail >= 0 ? afterAvail + "Availability".length : start;
  let end = text.length;
  for (const other of allHeaders) {
    if (other === header) continue;
    const idx = text.indexOf(other, rowStart);
    if (idx >= 0 && idx < end) end = idx;
  }
  return { start: rowStart, end };
}

// "*" marks an impaling weapon (per each table's own rule bullet); "†" is an
// unrelated ammo-footnote marker (the LeMat Pistol). Either can sit before a
// trailing descriptor ("Arkansas Toothpick* (knife w/double-edged blade)")
// rather than at the very end of the name, so strip them from anywhere.
function nameSuffixFlags(rawName: string): { name: string; impale: boolean } {
  const impale = /\*/.test(rawName);
  const name = cleanSpaces(rawName.replace(/[*†]+/g, ""));
  return { name, impale };
}

function firstInt(field: string): number | null {
  const m = field.match(/\d+/);
  return m ? Number(m[0]) : null;
}

function parseFirearmSection(
  text: string,
  spec: FirearmTableSpec,
  allHeaders: string[],
): OldWestWeapon[] {
  const { start, end } = sectionBounds(text, spec.header, allHeaders);
  if (start < 0) return [];
  const section = text.slice(start, end);
  const weapons: OldWestWeapon[] = [];
  for (const row of splitRows(section)) {
    const m = FIREARM_ROW.exec(row);
    if (!m) continue;
    const { name, impale: nameImpale } = nameSuffixFlags(m[1]);
    if (!name) continue;
    const skill =
      spec.exceptionName && name === spec.exceptionName
        ? spec.exceptionSkill!
        : spec.defaultSkill;
    const usesPerRound = cleanSpaces(m[4]);
    weapons.push({
      name,
      skill,
      damage: cleanSpaces(m[2]),
      baseRange: cleanSpaces(m[3]),
      usesPerRound,
      bullets: firstInt(m[5]),
      malfunction: /N\/A/i.test(m[6]) ? null : Number(m[6]),
      cost: cleanSpaces(m[7]),
      availability: cleanSpaces(m[8]),
      impale: spec.impale || nameImpale,
      thrown: false,
      ranged: true,
      auto: /full\s*auto/i.test(usesPerRound),
    });
  }
  return weapons;
}

function parseMeleeSection(text: string, allHeaders: string[]): OldWestWeapon[] {
  const { start, end } = sectionBounds(text, "MELEE WEAPONS", allHeaders);
  if (start < 0) return [];
  const section = text.slice(start, end);
  const weapons: OldWestWeapon[] = [];
  for (const row of splitRows(section)) {
    const m = MELEE_ROW.exec(row);
    if (!m) continue;
    const { name, impale } = nameSuffixFlags(m[1]);
    if (!name) continue;
    const skill = cleanSpaces(m[2]);
    weapons.push({
      name,
      skill,
      damage: cleanSpaces(m[3]),
      baseRange: cleanSpaces(m[4]),
      usesPerRound: cleanSpaces(m[5]),
      bullets: null,
      malfunction: /N\/A/i.test(m[6]) ? null : Number(m[6]),
      cost: cleanSpaces(m[7]),
      availability: cleanSpaces(m[8]),
      impale,
      thrown: /\bThrow\b/.test(skill),
      ranged: /^Firearms\b/.test(skill) || /\bThrow\b/.test(skill),
      auto: false,
    });
  }
  return weapons;
}

// Parses the book's "typical weapons" tables (Revolvers, Holdout Weapons,
// Rifles, Shotguns, Heavy Weapons/Explosives, Melee Weapons). Two rows with an
// unusually shaped Damage/Base Range column (Dynamite, Incendiary Device) don't
// match the general row shape and are skipped — a known, accepted gap rather
// than one-off regexes for two rarely-used items.
export function parseOldWestWeapons(rawText: string): OldWestWeapon[] {
  const text = cleanSpaces(stripFurniture(rawText));
  const firearmSpecs = findFirearmTables(text);
  if (firearmSpecs.length === 0) return [];
  const allHeaders = [...firearmSpecs.map((s) => s.header), "MELEE WEAPONS"];
  return [
    ...firearmSpecs.flatMap((spec) => parseFirearmSection(text, spec, allHeaders)),
    ...parseMeleeSection(text, allHeaders),
  ];
}

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

export interface OldWestSpell {
  name: string;
  castingTime: string;
  costs: SpellCosts;
  description: string;
}

// Titles here are mixed-case ("Power Of Manitou", "Summon/Bind Child of Yig"),
// unlike the Chaosium appendix format's ALL-CAPS titles (appendix.ts), so they
// need their own extraction: a run of capitalized words (allowing lowercase
// "of"/"the" particles), zero or more trailing "(...)" notes ("(Folk)", a
// renamed spell's original name), and an optional footnote asterisk.
const OLDWEST_SPELL_TITLE = new RegExp(
  String.raw`((?:[A-Z][A-Za-z’'/-]*)(?:\s+(?:of|the|Of|The)\s+[A-Z][A-Za-z’'/-]*|\s+[A-Z][A-Za-z’'/-]*)*(?:\s*\([^)]*\))*)\s*\*?\s*$`,
);

function extractOldWestSpellTitle(before: string): string {
  const m = OLDWEST_SPELL_TITLE.exec(cleanSpaces(before));
  return m ? cleanSpaces(m[1]) : "";
}

// Casting time runs until the description's first sentence (a capitalized
// word), same shape as the book's "N days to create; N round to use" compound
// times. A single-letter word ("A defensive spell...") must still count as a
// sentence start, hence "\w*" rather than requiring a second, lowercase letter.
function parseOldWestCastingTime(rest: string): { castingTime: string; length: number } {
  const m = rest.match(/^([^.]*?)(?=\s+[A-Z]\w*)/);
  if (m) return { castingTime: cleanSpaces(m[1]), length: m[0].length };
  const fallback = cleanSpaces(rest.slice(0, 40));
  return { castingTime: fallback, length: fallback.length };
}

// The book's "Shamanic (Folk) Magic" chapter reprints Cost/Casting time spell
// write-ups in the same "• Cost: ... • Casting time: ..." shape the Chaosium
// appendix format uses (see appendix.ts's parseSpellCosts, reused here), but
// with mixed-case titles and no Chaosium APPENDIX B/tomes/artefacts framing to
// anchor on — so this gets its own section bounds and title extraction.
export function parseOldWestSpells(rawText: string): OldWestSpell[] {
  const text = cleanSpaces(stripFurniture(rawText));
  const sectionStart = text.indexOf("SHAMANIC (FOLK) MAGIC");
  if (sectionStart < 0) return [];
  const sectionEndMarker = text.indexOf("CULTS AND SECRET SOCIETIES", sectionStart);
  const section =
    sectionEndMarker >= 0
      ? text.slice(sectionStart, sectionEndMarker)
      : text.slice(sectionStart, Math.min(text.length, sectionStart + 40000));

  const spells: OldWestSpell[] = [];
  const anchors: {
    index: number;
    cost: string;
    castingTime: string;
    afterCast: number;
  }[] = [];
  // A dropped-cap font artifact occasionally splits "Casting" into "C asting"
  // (the same glyph-kerning glitch as "C redit Rating" in the occupations).
  const costFind = /•\s*Cost:\s*([^•]+?)\s+•\s*C\s*asting\s+time:\s*/gi;
  let cm: RegExpExecArray | null;
  while ((cm = costFind.exec(section))) {
    const castingStart = cm.index + cm[0].length;
    const { castingTime, length } = parseOldWestCastingTime(
      section.slice(castingStart),
    );
    anchors.push({
      index: cm.index,
      cost: cleanSpaces(cm[1]),
      castingTime,
      afterCast: castingStart + length,
    });
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const prevEnd = i === 0 ? 0 : anchors[i - 1].afterCast;
    const name = extractOldWestSpellTitle(section.slice(prevEnd, a.index));
    if (!name) continue;
    // The default bound (the next anchor's own "• Cost:") includes that next
    // spell's title, printed right before its Cost bullet; trim the body back
    // to where that title starts so it doesn't leak into this description.
    let bodyEnd = i + 1 < anchors.length ? anchors[i + 1].index : section.length;
    if (i + 1 < anchors.length) {
      const nextBefore = section.slice(a.afterCast, anchors[i + 1].index);
      const nextTitle = extractOldWestSpellTitle(nextBefore);
      const ti = nextTitle ? nextBefore.lastIndexOf(nextTitle) : -1;
      if (ti >= 0) bodyEnd = a.afterCast + ti;
    }
    const description = cleanSpaces(section.slice(a.afterCast, bodyEnd));
    spells.push({
      name,
      castingTime: a.castingTime,
      costs: parseSpellCosts(a.cost),
      description,
    });
  }
  return spells;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

// A Down Darker Trails spell is tagged "spell" (not a distinct "oldWestSpell"
// kind): it's the same Foundry document as a Chaosium-appendix spell
// (AppendixSpell in appendix.ts), just with source-faithful data from a
// differently-shaped book section, and files into the same "Spells" folder.
export type OldWestItem =
  | ({ kind: "occupation" } & OldWestOccupation)
  | ({ kind: "oldWestSkill" } & OldWestSkill)
  | ({ kind: "oldWestWeapon" } & OldWestWeapon)
  | ({ kind: "spell" } & OldWestSpell);

// Parse every Down Darker Trails reference item a document's text yields
// (occupations, altered/new skills, weapons, spells). Each parser is guarded by
// its own specific section markers, so a document with none of them yields
// nothing.
export function parseOldWestItems(text: string): OldWestItem[] {
  return [
    ...parseOldWestOccupations(text).map((o) => ({
      kind: "occupation" as const,
      ...o,
    })),
    ...parseOldWestSkills(text).map((s) => ({
      kind: "oldWestSkill" as const,
      ...s,
    })),
    ...parseOldWestWeapons(text).map((w) => ({
      kind: "oldWestWeapon" as const,
      ...w,
    })),
    ...parseOldWestSpells(text).map((s) => ({
      kind: "spell" as const,
      ...s,
    })),
  ];
}
