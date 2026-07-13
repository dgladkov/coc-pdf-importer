// Ad-hoc importer for Pulp Cthulhu rulebook reference content — currently the
// pulp talents. This is deliberately separate from the actor/stat-block parser
// in process.ts: it reads the book's fixed reference *tables*, not per-NPC stat
// blocks, so it gets its own parsing rather than complicating the general path.
// See E:/export_trait.json for the target "talent" item schema.
//
// This module is pure: it parses text into internal item structures (PulpItem)
// and never touches pdf.js or the Foundry API. It keeps source-faithful data —
// e.g. skill names, not resolved CoCIDs. The text comes from process.ts (which
// reads the PDF once); turning these into Foundry documents and creating them in
// the world is the importer's job (see document.ts).

export type TalentCategory =
  | "physical"
  | "mental"
  | "combat"
  | "miscellaneous";

export interface PulpTalent {
  name: string;
  category: TalentCategory;
  description: string;
}

const CATEGORY_BY_HEADER: Record<string, TalentCategory> = {
  PHYSICAL: "physical",
  MENTAL: "mental",
  COMBAT: "combat",
  MISCELLANEOUS: "miscellaneous",
};

// The four player-talent tables each read:
//   "TABLE n: <CATEGORY> TALENTS (CHOOSE OR ROLL 1D10) Roll <Category> Talent"
// followed by ten rows "<roll> <Name> : <description>". The header is matched in
// full uppercase so the mixed-case "1. Table 3: Physical Talents" cross-reference
// list elsewhere on the page is ignored. (Table 5 prints "( CHOOSE" with a stray
// space, hence the \s* after the paren.)
const TABLE_HEADER =
  /TABLE\s+\d+:\s*(PHYSICAL|MENTAL|COMBAT|MISCELLANEOUS)\s+TALENTS\s*\(\s*CHOOSE OR ROLL 1D10\s*\)\s*Roll\s+\w+\s+Talent\s+/gi;

// A talent name is a run of capitalized words; the description that follows runs
// until the next "<roll> <Name>:" row or a page artifact (the next TABLE header,
// a running header like "25 CREATING PULP HEROES", or a letter-spaced page footer
// "s h o o t i n g d e e p o n e s"). The name/description separator is ":" with
// optional surrounding space ("Alert:" and "Keen Vision : " both occur).
const NAME = String.raw`[A-Z][A-Za-z][A-Za-z '/-]*?`;
const ENTRY = new RegExp(
  String.raw`(\d{1,2})\s+(${NAME})\s*:\s*(.+?)(?=\s+\d{1,2}\s+${NAME}\s*:|\s+TABLE\s+\d|\s+\d+\s+[A-Z]{2,}\s+[A-Z]{2,}|\s+(?:[A-Za-z]\s){4,}|$)`,
  "g",
);

// Undo the spacing artifacts PDF extraction leaves around punctuation:
// "( Clairvoyance" -> "(Clairvoyance", "Weird Science , page" -> "Weird Science,
// page", and collapse any double spaces.
function cleanDescription(s: string): string {
  return s
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Upper-case the first letter. The book lists talent descriptions as lowercase
// sentence fragments (they follow "Name : " in the table); this makes each read
// as a sentence.
function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Split a comma-separated list ("Agency Detective, Bank Robber, and Ranger") into
// its trimmed entries, dropping a trailing "." and a leading "and", and closing
// the spurious space PDF extraction leaves inside a compound ("Gentleman/ Lady",
// "name- dropper").
function splitCommaList(raw: string): string[] {
  return raw
    .replace(/\.\s*$/, "")
    .split(/,\s*/)
    .map((s) =>
      s
        .replace(/^and\s+/i, "")
        .replace(/\/\s+/g, "/")
        .replace(/([A-Za-z])-\s+(?=[A-Za-z])/g, "$1-")
        .trim(),
    )
    .filter(Boolean);
}

// Parse the four pulp player-talent tables into their 40 talents. Tolerant of the
// tables appearing on different pages and in any order; each table yields its
// rows 1..10 in sequence and stops as soon as the roll numbering breaks (which
// marks the end of a table's rows).
export function parsePulpTalents(text: string): PulpTalent[] {
  const talents: PulpTalent[] = [];
  const headers = [...text.matchAll(TABLE_HEADER)];
  for (let h = 0; h < headers.length; h++) {
    const category = CATEGORY_BY_HEADER[headers[h][1].toUpperCase()];
    const start = headers[h].index! + headers[h][0].length;
    const end = h + 1 < headers.length ? headers[h + 1].index! : text.length;
    const body = text.slice(start, end);

    ENTRY.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastRoll = 0;
    while ((m = ENTRY.exec(body))) {
      const roll = Number(m[1]);
      // Rows are numbered 1..10, strictly increasing; a non-increasing or
      // out-of-range roll means we have run past the table into other prose.
      if (roll <= lastRoll || roll > 10) break;
      lastRoll = roll;
      talents.push({
        name: m[2].trim(),
        category,
        description: capitalizeFirst(cleanDescription(m[3])),
      });
    }
  }
  return talents;
}

// --- Archetypes ------------------------------------------------------------
// Archetypes are prose sections (a name heading, a description, then an
// "Adjustments" bullet block), not a table. Parsing anchors on the fixed,
// alphabetically-ordered name list and the 22 "Adjustments" markers — a niche,
// book-specific approach the user signed off on for this import.

const ARCHETYPE_NAMES = [
  "Adventurer", "Beefcake", "Bon Vivant", "Cold Blooded", "Dreamer", "Egghead",
  "Explorer", "Femme Fatale", "Grease Monkey", "Hard Boiled", "Harlequin",
  "Hunter", "Mystic", "Outsider", "Rogue", "Scholar", "Seeker", "Sidekick",
  "Steadfast", "Swashbuckler", "Thrill Seeker", "Two-Fisted",
];

const CORE_CHARS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu"];
const TALENT_WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

// A few source skill lists carry non-canonical names; normalize each to the real
// system skill name(s). An entry can expand to more than one ("Firearms (Rifle
// and/or Handgun)" is really two firearms skills).
const SKILL_ALIASES: Record<string, string[]> = {
  "Language Other (Any)": ["Language (Any)"],
  "Firearms (Rifle and/or Handgun)": [
    "Firearms (Rifle/Shotgun)",
    "Firearms (Handgun)",
  ],
  Cryptography: ["Science (Cryptography)"],
  Navigation: ["Navigate"],
  Photography: ["Art/Craft (Photography)"],
};

export interface PulpArchetype {
  name: string;
  description: string;
  coreCharacteristics: string[]; // lowercase keys, e.g. ["con"] or ["dex","app"]
  bonusPoints: number;
  talents: number;
  skills: string[]; // skill names as printed, e.g. "Fighting (Brawl)"
  suggestedOccupations: string[];
  suggestedTraits: string[];
}

const escapeReChars = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
// Name alternation tolerant of the margin index's hyphen-joined variants
// ("Cold-Blooded" vs the heading's "Cold Blooded").
const ARCH_NAME_ALT = [...ARCHETYPE_NAMES]
  .sort((a, b) => b.length - a.length)
  .map((n) => escapeReChars(n).replace(/ /g, "[ -]"))
  .join("|");
const ARCH_NAME_START = new RegExp("^(?:" + ARCH_NAME_ALT + ")\\b");
const ARCH_MARGIN_RUN = new RegExp("(?:\\b(?:" + ARCH_NAME_ALT + ")\\b[ ,]*){2,}", "g");

// Drop page-running headers/footers and illustration credits that PDF extraction
// interleaves into the archetype prose.
function stripArchetypeArtifacts(text: string): string {
  return (
    text
      .replace(/\s*\d+\s+CREATING PULP HEROES\s*/g, " ")
      .replace(/s h o o t i n g d e e p o n e s\s+\d+\s+CHAPTER \d+\s*/g, " ")
      .replace(/\s*Archetypes s by Chris Lackey\s*/g, " ")
      // The two-column chapter intro (dropcap paragraph, the "Creating Pulp
      // Heroes" steps, the "Step One" heading, and the plate credit) is
      // interleaved by the flat reading order into the first archetype's
      // (Adventurer's) description — remove that whole block.
      .replace(
        /\bI\s*n Pulp Cthulhu\s*,\s*investigators are called heroes[\s\S]*?Manuel Leza moreno/,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

function cleanArchetypeDescription(d: string): string {
  d = d
    .replace(/\bPULP ARCHETYPES\b/g, " ")
    .replace(ARCH_MARGIN_RUN, " ") // strip margin-index name runs
    .replace(/\(\s+/g, "(") // undo PDF spacing artifacts around punctuation
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,;])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  // Prose ends in a sentence terminator; drop any trailing margin/header fragment
  // (which carries no punctuation) after the final one.
  const m = d.match(/^.*[.!?]["”'’]?/s);
  return (m ? m[0] : d).trim();
}

// The heading of `name` before `before`: its last Title-Case occurrence that
// begins the description prose — not one followed by another archetype name or
// immediately by "Adjustments" (both mark the margin index / an illustration
// caption). Archetype prose refers to archetypes in lowercase, so a Title-Case
// occurrence is always a heading, margin entry, or caption.
function archetypeHeading(
  text: string,
  name: string,
  before: number,
): RegExpExecArray | null {
  const re = new RegExp("\\b" + escapeReChars(name) + "\\b", "g");
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < before) {
    const after = text.slice(m.index + name.length).trimStart();
    if (!ARCH_NAME_START.test(after) && !/^Adjustments\b/.test(after)) last = m;
  }
  return last;
}

const archField = (body: string, re: RegExp) =>
  (body.match(re) || [])[1]?.trim() ?? "";

// Parse the pulp archetype entries. Anchors on the "Adjustments • Core
// characteristic" markers (in the book's alphabetical order, matched to the name
// list) and returns [] when the section is absent, so non-pulp documents yield
// nothing.
export function parsePulpArchetypes(rawText: string): PulpArchetype[] {
  const text = stripArchetypeArtifacts(rawText);
  const adj = [...text.matchAll(/\bAdjustments\s+•\s*Core characteristic/g)].map(
    (m) => m.index!,
  );
  if (adj.length === 0) return [];

  const count = Math.min(adj.length, ARCHETYPE_NAMES.length);
  const heads = ARCHETYPE_NAMES.slice(0, count).map((name, i) =>
    archetypeHeading(text, name, adj[i]),
  );

  const archetypes: PulpArchetype[] = [];
  for (let i = 0; i < count; i++) {
    const name = ARCHETYPE_NAMES[i];
    const nameEnd = heads[i] ? heads[i]!.index + name.length : adj[i];
    let description = cleanArchetypeDescription(text.slice(nameEnd, adj[i]));
    // The bullets run from this Adjustments to the next entry's heading (or a
    // bounded window for the last one).
    const bulletsEnd =
      i + 1 < count && heads[i + 1]
        ? heads[i + 1]!.index
        : Math.min(adj[i] + 1600, text.length);
    const body = text.slice(adj[i], bulletsEnd);

    const coreRaw = archField(body, /Core characteristic:\s*([^•]*)/);
    const coreCharacteristics = CORE_CHARS.filter((c) =>
      new RegExp("\\b" + c.toUpperCase() + "\\b").test(coreRaw),
    );
    const bonusPoints = Number(archField(body, /Add\s+(\d+)\s+bonus points/)) || 100;
    // The skill list may carry a trailing "; <clause>" note (e.g. Mystic's "if
    // the Psychic talent is taken, allocate skill points to the chosen psychic
    // skill(s)"). Split it off and fold it into the description rather than
    // treating the clause as skills.
    const skillsRaw = archField(body, /following skills:\s*([^•]*)/);
    const semicolon = skillsRaw.indexOf(";");
    const skillNote =
      semicolon >= 0
        ? skillsRaw.slice(semicolon + 1).replace(/\.\s*$/, "").trim()
        : "";
    if (skillNote) description += " " + capitalizeFirst(skillNote) + ".";
    // Skill names are tidied ("(any)" -> "(Any)") and normalized to canonical
    // system skills — a couple of non-canonical source entries are mapped or
    // split into two (see SKILL_ALIASES).
    const skills = splitCommaList(
      semicolon >= 0 ? skillsRaw.slice(0, semicolon) : skillsRaw,
    )
      .map((s) => s.replace(/\(any\)/gi, "(Any)"))
      .flatMap((s) => SKILL_ALIASES[s] ?? [s]);
    const suggestedOccupations = splitCommaList(
      archField(body, /Suggested occupations:\s*([^•]*)/),
    );
    const talents =
      TALENT_WORD_NUM[
        archField(body, /Talents:\s*(?:any\s+)?(\w+)/).toLowerCase()
      ] ?? 2;
    // Traits are the last bullet, so bound the list at its ending "." — otherwise
    // it spills into the following margin index or chapter text.
    const suggestedTraits = splitCommaList(
      archField(body, /Suggested traits:\s*([^•.]*)/),
    );

    archetypes.push({
      name,
      description,
      coreCharacteristics,
      bonusPoints,
      talents,
      skills,
      suggestedOccupations,
      suggestedTraits,
    });
  }
  return archetypes;
}

// A parsed pulp item, tagged by kind so the importer can build the matching
// Foundry document. Both variants hold source-faithful data — e.g. archetype
// `skills` are the printed names, not resolved CoCIDs; that resolution and all
// Foundry-schema shaping happen at import (see document.ts).
export type PulpItem =
  | ({ kind: "talent" } & PulpTalent)
  | ({ kind: "archetype" } & PulpArchetype);

// Parse every pulp reference item a rulebook's text yields (talents, archetypes).
// Each parser is guarded by its own specific section header/structure, so a
// document with none of them yields nothing — that is how the importer decides a
// document "has items" without false positives.
export function parsePulpItems(text: string): PulpItem[] {
  return [
    ...parsePulpTalents(text).map((t) => ({ kind: "talent" as const, ...t })),
    ...parsePulpArchetypes(text).map((a) => ({ kind: "archetype" as const, ...a })),
  ];
}
