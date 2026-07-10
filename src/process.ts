import * as pdfjs from "pdfjs-dist";

export type CharacteristicName =
  "STR" | "CON" | "SIZ" | "DEX" | "INT" | "APP" | "POW" | "EDU" | "SAN" | "HP";

const CHAR_LABELS: CharacteristicName[] = [
  "STR",
  "CON",
  "SIZ",
  "DEX",
  "INT",
  "APP",
  "POW",
  "EDU",
  "SAN",
  "HP",
];

const DERIVED_LABELS = ["DB", "Build", "Move", "MP", "Luck"] as const;
type DerivedLabel = (typeof DERIVED_LABELS)[number];

// Labels that mark the end of the characteristics/derived header line.
const SECTION_LABELS = [
  "Combat",
  "Pulp Combat",
  "Pulp Talents",
  "Skills",
  "Spells",
  "Languages",
  "Special",
  "Armor",
  "Sanity Loss",
  "Notes",
  "Powers",
];

export interface CharacteristicValue {
  value: number | null;
  raw: string;
  marked: boolean;
}

export type Characteristics = Partial<
  Record<CharacteristicName, CharacteristicValue>
>;

export interface DerivedStats {
  DB: string | null;
  Build: number | null;
  Move: number | null;
  MP: number | null;
  Luck: number | null;
}

export interface CombatEntry {
  name: string;
  value: number | null; // null for maneuvers with no skill % (e.g. Overwhelm)
  half: number | null;
  fifth: number | null;
  damage: string | null;
  note: string | null;
}

export type Skills = Record<string, number>;

// A run of extracted text at a single font size, with its offsets into the
// concatenated document text.
interface TextChunk {
  text: string;
  height: number;
  start: number;
  end: number;
  newline: boolean; // this run begins a new line
}

export interface CocCharacter {
  name: string;
  age: number | null;
  description: string;
  characteristics: Characteristics;
  derived: DerivedStats;
  attacksPerRound: string | null;
  combat: CombatEntry[];
  skills: Skills;
  languages: Skills;
  spells: string[];
  sanityLoss: string | null; // present for monsters, null for ordinary NPCs
  notes: string[];
}

// ---------------------------------------------------------------------------
// Top-level parse
// ---------------------------------------------------------------------------

export function parseCocCharacters(
  rawText: string,
  chunks?: TextChunk[],
): CocCharacter[] {
  // When chunks are supplied the text is already normalised (built from them).
  const text = chunks ? rawText : normalizeText(rawText);
  const bodyHeight = chunks ? mostCommonHeight(chunks) : 0;
  // The height NPC names are set in — the most common size just above body text.
  // Section/running headers are taller and must not be mistaken for names.
  const nameHeight = chunks
    ? mostCommonHeight(chunks.filter((c) => c.height > bodyHeight))
    : 0;

  // A characteristics run always starts "STR <value>+ CON". Values are numbers
  // (optionally marked with *), or a lone "-" (an em/en dash for N/A stats),
  // each optionally followed by a "(3D6 x 5)"-style roll formula and/or an
  // "Average Rolls" multiplier printed after the formula ("45 (1D6+6) ×5").
  const value = String.raw`(?:\d{1,3}\*?|-|[Nn]/[Aa])(?:\s*\([^)]*\))?(?:\s*[×xX]\s*\d+)?`;
  const anchorRe = new RegExp(
    String.raw`\bSTR\s+${value}(?:\s+${value})*\s+CON\b`,
    "g",
  );
  const anchors = Array.from(text.matchAll(anchorRe), (m) => m.index ?? 0);

  // Resolve, for each anchor, the header that precedes it (the name/age line).
  // The age line sits before STR but a descriptive paragraph can come between
  // them, so we look back a fair distance for the age and, once found, a further
  // distance before *that* for the name (decoupled so a long description can't
  // truncate the name).
  const AGE_WINDOW = 240;
  const NAME_LOOKBACK = 90;
  const headers = anchors.map((strIndex, i) => {
    const leftBound = i > 0 ? anchors[i - 1] : 0;
    const winStart = Math.max(leftBound, strIndex - AGE_WINDOW);
    const window = text.slice(winStart, strIndex);
    // Prefer the name heading recovered from font size; fall back to the
    // text-only heuristics when there is no distinct heading run.
    const header =
      (chunks &&
        headerFromChunks(
          chunks,
          strIndex,
          leftBound,
          bodyHeight,
          nameHeight,
        )) ||
      parseHeader(text, strIndex, winStart, leftBound, NAME_LOOKBACK);
    // A last-resort section title for group tables whose heading is too tall /
    // too far for the paths above (used only when no group name is found), plus
    // the offset where that title begins (to bound the previous block's body).
    const sectionHeading: SectionHeading = chunks
      ? sectionHeadingFromChunks(chunks, strIndex, leftBound, bodyHeight)
      : { text: "", start: -1 };
    return {
      strIndex,
      header,
      window,
      headerStart: header.headerStart,
      sectionHeading: sectionHeading.text,
      headingStart: sectionHeading.start,
    };
  });

  // The body of each block runs from its STR to the start of the next block.
  const blocks = anchors.map((strIndex, i) => {
    // Bound at the next block's section-title heading when it has one: the title
    // reliably delimits the next block even when that block's name heuristic
    // reached back past the title into this block (so its headerStart is not
    // trustworthy); otherwise end at the next name line.
    let bodyEnd = text.length;
    if (i + 1 < headers.length) {
      const next = headers[i + 1];
      bodyEnd = next.headingStart > strIndex ? next.headingStart : next.headerStart;
    }
    // Text between this block's start and its STR anchor. Some group tables print
    // the shared Combat/Skills sections here, ahead of the stat table. Start at
    // the section-title heading when the name heuristic reached back past it into
    // the previous block (headingStart > headerStart); otherwise at the name.
    const blockStart =
      headers[i].headingStart > headers[i].headerStart
        ? headers[i].headingStart
        : headers[i].headerStart;
    return {
      strIndex,
      body: text.slice(strIndex, bodyEnd),
      preTable: text.slice(blockStart, strIndex),
    };
  });

  const characters: CocCharacter[] = [];

  blocks.forEach((block, i) => {
    // A "bare" stat line carries only characteristics — no Combat/Skills/Sanity
    // of its own. Such lines belong to a set (e.g. "Mr. Smith" then "Mrs. Smith",
    // or a creature's two forms) whose shared section is printed after the last
    // line, so inherit it from the next section-bearing block in the run.
    let sharedTail = "";
    if (!bodyHasSections(block.body)) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (bodyHasSections(blocks[j].body)) {
          sharedTail = blocks[j].body;
          break;
        }
      }
    }
    const { name, age, description } = headers[i].header;
    characters.push(
      ...parseBlock(
        block.body,
        headers[i].window,
        name,
        age,
        description,
        headers[i].sectionHeading,
        block.preTable,
        sharedTail,
      ),
    );
  });

  return characters;
}

// ---------------------------------------------------------------------------
// Header (name, age, description) that precedes a stat block
// ---------------------------------------------------------------------------

interface ParsedHeader {
  name: string;
  age: number | null;
  description: string;
  headerStart: number; // absolute index in `text` where the name starts
}

// The font size carrying the most characters (body text by default).
function mostCommonHeight(runs: { text: string; height: number }[]): number {
  const byHeight = new Map<number, number>();
  for (const c of runs)
    byHeight.set(c.height, (byHeight.get(c.height) ?? 0) + c.text.length);
  let best = 0;
  let bestLen = -1;
  for (const [h, len] of byHeight) {
    if (len > bestLen) {
      best = h;
      bestLen = len;
    }
  }
  return best;
}

// Recover the header using font size: the NPC name is a run taller than body
// text sitting just before the stat block (after any description blurb, which
// is body height). Section headings are taller still and a different height, so
// taking the first over-body run walking back — and only its own height's
// contiguous run — isolates the name + descriptor.
function headerFromChunks(
  chunks: TextChunk[],
  strIndex: number,
  leftBound: number,
  bodyHeight: number,
  nameHeight: number,
): ParsedHeader | null {
  if (!bodyHeight || !nameHeight) return null;

  let anchorIdx = -1;
  for (let k = 0; k < chunks.length; k++) {
    if (chunks[k].start <= strIndex && strIndex < chunks[k].end) {
      anchorIdx = k;
      break;
    }
  }
  if (anchorIdx < 0) return null;

  // Skip body-height (or smaller) runs — the stats and the description blurb.
  let i = anchorIdx - 1;
  while (
    i >= 0 &&
    chunks[i].start >= leftBound &&
    chunks[i].height <= bodyHeight
  )
    i--;
  if (i < 0 || chunks[i].start < leftBound || chunks[i].height <= bodyHeight)
    return null;

  // The first over-body run must be a name heading, not a taller section or
  // running header (e.g. "DARK TURNS"); otherwise defer to the fallbacks.
  if (chunks[i].height > nameHeight + 0.5) return null;

  // Collect the contiguous run at this heading height (name + descriptor, and
  // possibly a group title on an earlier line).
  const height = chunks[i].height;
  const run: TextChunk[] = [];
  let j = i;
  while (
    j >= 0 &&
    chunks[j].height === height &&
    chunks[j].start >= leftBound
  ) {
    run.unshift(chunks[j]);
    j--;
  }

  // Split the run into its constituent lines. When one line carries the age
  // ("Iregi Kipkemboi (Cultist #1), 23, ..."), drop any preceding lines — those
  // are group/section titles at the same font size ("Elias' Murderers").
  const lines: TextChunk[][] = [];
  for (const c of run) {
    if (c.newline || lines.length === 0) lines.push([c]);
    else lines[lines.length - 1].push(c);
  }
  const lineText = (line: TextChunk[]) => line.map((c) => c.text).join(" ");
  const hasAge = (t: string) =>
    /\b(?:age|appears)\s+\d{1,3}\b|,\s*\d{1,3}\+?\s*,/i.test(t);
  const ageLine = lines.findIndex((line) => hasAge(lineText(line)));

  let selected: TextChunk[][];
  if (ageLine >= 0) {
    // Keep the age line and any following (descriptor) lines. Also fold in
    // preceding lines that end with a comma — the name can be split onto its
    // own line ("Sam Keelham," / "age 48, ...") — but stop at a standalone
    // caption/title line ("The generator in the cellar", "Elias' Murderers").
    let start = ageLine;
    while (start > 0 && /,\s*$/.test(lineText(lines[start - 1]))) start--;
    selected = lines.slice(start);
  } else {
    selected = lines;
  }

  const parsed = parseNameRun(selected.map(lineText).join(" "));
  if (!parsed || !parsed.name) return null;
  return { ...parsed, headerStart: selected[0][0].start };
}

// The nearest section/group title (a larger-font run above the body text),
// WITHOUT the name-height guard headerFromChunks applies, plus the text offset
// where that run begins. Two uses:
//   - a last-resort name for a block whose title sits at section-heading size
//     above a descriptive blurb, far from the stat row ("Lions and Big Cats",
//     "CRAZED CREW OF THE DARK MISTRESS");
//   - the offset bounds the *previous* block's body: a group title is a tall run
//     between the prior block's last section and this block's STR, so the prior
//     body must end where this title begins (else the title, and the column-
//     number row after it, leak into that block's trailing section).
// Returns { text: "", start: -1 } when no over-body run is reached.
interface SectionHeading {
  text: string;
  start: number; // -1 when no distinct heading run was found
}

function sectionHeadingFromChunks(
  chunks: TextChunk[],
  strIndex: number,
  leftBound: number,
  bodyHeight: number,
): SectionHeading {
  const none: SectionHeading = { text: "", start: -1 };
  if (!bodyHeight) return none;

  let anchorIdx = -1;
  for (let k = 0; k < chunks.length; k++) {
    if (chunks[k].start <= strIndex && strIndex < chunks[k].end) {
      anchorIdx = k;
      break;
    }
  }
  if (anchorIdx < 0) return none;

  let i = anchorIdx - 1;
  while (i >= 0 && chunks[i].start >= leftBound) {
    // Skip body-height (or smaller) runs — the stats and the description blurb.
    while (
      i >= 0 &&
      chunks[i].start >= leftBound &&
      chunks[i].height <= bodyHeight
    )
      i--;
    if (i < 0 || chunks[i].start < leftBound || chunks[i].height <= bodyHeight)
      return none;

    // Collect the contiguous run at this heading height (the title line).
    const height = chunks[i].height;
    const parts: string[] = [];
    let start = chunks[i].start;
    let j = i;
    for (
      ;
      j >= 0 && chunks[j].height === height && chunks[j].start >= leftBound;
      j--
    ) {
      parts.unshift(chunks[j].text);
      start = chunks[j].start;
    }
    const text = clean(parts.join(" "));
    // A monster stat table prints an intermediate-sized "char. / average / roll"
    // header row above its values; that is not the creature's title, so keep
    // walking back (past the description) to the real heading above it.
    if (!isFurnitureName(text)) return { text, start };
    i = j;
  }
  return none;
}

// Parse a clean heading run ("Jackson Elias , 41, fearless investigator",
// "The Dead Light, hideous devourer", "Shantak") into name / age / description.
function parseNameRun(
  runText: string,
): { name: string; age: number | null; description: string } | null {
  // Drop a leading "Name:" label, then repair a letter-spaced colon inside the
  // heading ("Million Favored Ones : The Dead" -> "... Ones: The Dead").
  const heading = clean(runText)
    .replace(/^Name\s*:?\s*/i, "")
    .replace(/\s+:\s*/g, ": ");
  if (!heading) return null;

  const ageMatch = /,\s*(?:age\s+|appears\s+)?(\d{1,3})\+?\s*(?:,|$)/i.exec(
    heading,
  );
  if (ageMatch) {
    return {
      name: clean(heading.slice(0, ageMatch.index)),
      age: Number(ageMatch[1]),
      description: trimDescription(
        heading.slice(ageMatch.index + ageMatch[0].length),
      ),
    };
  }

  const comma = heading.indexOf(",");
  if (comma >= 0) {
    return {
      name: clean(heading.slice(0, comma)),
      age: null,
      description: trimDescription(heading.slice(comma + 1)),
    };
  }
  return { name: clean(heading), age: null, description: "" };
}

const DESCRIPTION_MAX = 80; // guard against paragraph-headers bleeding into desc

function parseHeader(
  text: string,
  strIndex: number,
  winStart: number,
  leftBound: number,
  nameLookback: number,
): ParsedHeader {
  const window = text.slice(winStart, strIndex);

  // Preferred form: "<Name>, <age>, <description>" where age may be written
  // "42", "age 42" or "appears 42", and the trailing comma may be absent when
  // the stat block follows immediately (e.g. "Name: Archetype, age 40  STR").
  // Several candidates can appear in the window (leftover prose from the
  // previous block); take the one closest to the STR anchor.
  const ageRe = /,\s*(?:age\s+|appears\s+)?(\d{1,3})\+?\s*(?:,|(?=\s*$))/gi;

  let best: RegExpMatchArray | null = null;
  for (const m of window.matchAll(ageRe)) best = m;

  if (best) {
    const commaAbs = winStart + (best.index ?? 0);
    const descAbs = commaAbs + best[0].length;
    // Read the name from a generous lookback before the age comma.
    const namePre = text.slice(
      Math.max(leftBound, commaAbs - nameLookback),
      commaAbs,
    );
    const name = extractName(namePre);
    const description = trimDescription(text.slice(descAbs, strIndex));
    return {
      name,
      age: Number(best[1]),
      description,
      headerStart: nameStartAbs(text, commaAbs, name),
    };
  }

  // Shared-profile stat blocks name the group just before the instruction, e.g.
  // "Lascars Use this profile for all of the Lascars." or "ASYLUM PATIENTS Use
  // these statistics ...". Truncate at that phrase so the name sits at the end.
  const useMatch = /\bUse\s+(?:this|these|the following)\b/i.exec(window);
  const nameWindow = useMatch ? window.slice(0, useMatch.index) : window;

  // No age, but "<Name>, <description>" right before STR (common in books that
  // print names in caps, e.g. "JOSH WINSCOTT, damned by his legacy", or
  // "Walter Corbitt, Undead Fiend").
  const descMatch = /([^.,]*?)\s*,\s+(\S[^,]*?)\s*$/.exec(nameWindow);
  if (descMatch) {
    const name = extractName(descMatch[1]);
    if (name) {
      const headerStart = winStart + nameOffset(descMatch[1], name);
      return {
        name,
        age: null,
        description: trimDescription(descMatch[2]),
        headerStart,
      };
    }
  }

  // Widened search for a "<Name>, <short descriptor>" heading that sits at the
  // block start, before a descriptive blurb (large Mythos creatures, and NPCs
  // whose stat line follows a paragraph — e.g. "BILL DUNSTON, taciturn tenant  A
  // quiet, sour-faced man ..."). The heading follows a sentence boundary and is
  // itself followed by the capitalised first word of the blurb.
  const wide = text.slice(leftBound, strIndex);
  const headerRe =
    /(?:^|[.%]\s+)([A-Z][A-Za-z'.\- ]{1,40}?),\s+([a-z][A-Za-z'\- ]{1,45}?)\s+(?=[A-Z])/g;
  for (const m of wide.matchAll(headerRe)) {
    const name = extractName(m[1]);
    if (name && looksLikeProperName(name)) {
      const nameAbs = leftBound + (m.index ?? 0) + m[0].indexOf(m[1]);
      return {
        name,
        age: null,
        description: trimDescription(m[2]),
        headerStart: nameAbs,
      };
    }
    break; // only consider the first (block-start) candidate
  }

  // Fallback: a trailing capitalised phrase (monster / alternate-form / group).
  const name = extractName(nameWindow);
  return {
    name,
    age: null,
    description: "",
    headerStart: winStart + nameOffset(nameWindow, name),
  };
}

// A proper name/heading has every word either capitalised or a known particle
// ("of", "the", "de", ...). Rejects prose fragments like "creature's weakness
// is its heart" that a greedy header regex might otherwise capture.
function looksLikeProperName(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every(
    (w) =>
      /^[A-Z(“"'#]/.test(w) ||
      /^[a-z]{1,4}-[A-Z]/.test(w) ||
      /^(?:de|del|van|von|der|den|the|of|in|and|du|da|la|le|el|bin|al|ibn|à)$/i.test(
        w,
      ),
  );
}

// Absolute index where `name` starts, searching just before position `before`.
function nameStartAbs(text: string, before: number, name: string): number {
  if (!name) return before;
  const idx = text.lastIndexOf(name, before);
  return idx >= 0 ? idx : before;
}

// Offset of `name` within `pre` (for headers we already sliced into a window).
function nameOffset(pre: string, name: string): number {
  if (!name) return pre.length;
  const idx = pre.lastIndexOf(name);
  return Math.max(0, idx >= 0 ? idx : pre.length - name.length);
}

// Descriptions are short noun phrases; when a stat block puts a paragraph
// between the header and STR, bound it so it doesn't swallow prose.
function trimDescription(raw: string): string {
  let desc = clean(raw);
  if (desc.length <= DESCRIPTION_MAX) return desc;
  const cut = desc.lastIndexOf(" ", DESCRIPTION_MAX);
  return desc.slice(0, cut > 0 ? cut : DESCRIPTION_MAX);
}

// Running headers / section titles that must never be swallowed into a name.
const HEADING_WORDS = new Set([
  "KEEPER",
  "REFERENCE",
  "BOOKLET",
  "CHARACTERS",
  "CHARACTER",
  "MONSTERS",
  "MONSTER",
  "NECROPOLIS",
  "PULP",
  "ALLIES",
  "INDEPENDENTS",
  "GUARDS",
  "CULTISTS",
  "CULTIST",
  "POLICE",
  "RESIDENTS",
  "TOWNSFOLK",
  "ANIMALS",
  "NPCS",
  "AND",
  "OR",
  "OF",
  "THE",
]);

// Walk backwards from the end of `pre`, collecting name-like tokens. Prefer a
// Title-case name; if none is found, retry allowing ALL-CAPS names (books vary
// in whether NPC names are printed in caps), bounded by known heading words.
function extractName(pre: string): string {
  const strict = collectName(pre, false);
  if (strict) return strict;
  return collectName(pre, true);
}

// Title abbreviations that legitimately carry a trailing period inside a name.
const NAME_ABBREVIATIONS = new Set([
  "DR",
  "MR",
  "MRS",
  "MS",
  "ST",
  "JR",
  "SR",
  "LT",
  "CAPT",
  "CAPTAIN",
  "COL",
  "SGT",
  "GEN",
  "REV",
  "PROF",
  "FR",
  "MME",
  "MLLE",
  "HON",
]);

function collectName(pre: string, allowCaps: boolean): string {
  const tokens = pre.trim().split(/\s+/).filter(Boolean);
  const collected: string[] = [];
  const limit = allowCaps ? 4 : 8;

  for (let i = tokens.length - 1; i >= 0 && collected.length < limit; i--) {
    const token = tokens[i];
    if (
      allowCaps &&
      HEADING_WORDS.has(token.replace(/[^A-Za-z]/g, "").toUpperCase())
    )
      break;
    // A word ending in "." is a sentence boundary (the name is after it), unless
    // it is an initial ("B.") or a title abbreviation ("Dr.", "Lt.").
    if (
      /\.$/.test(token) &&
      !/^[A-Z]\.$/.test(token) &&
      !NAME_ABBREVIATIONS.has(token.replace(/[^A-Za-z]/g, "").toUpperCase())
    ) {
      break;
    }
    // A parenthetical member marker with no letters ("#1)" in "(Cultist #1)") is
    // part of the name — keep it rather than stopping the walk. A purely numeric
    // parenthetical ("(25/10)", a combat Hard/Extreme value) is not a name, so
    // require the "#" marker and let anything else stop the walk.
    if (/#/.test(token) && !token.replace(/[^A-Za-z]/g, "")) {
      collected.unshift(token);
      continue;
    }
    if (!isNameToken(token, allowCaps)) break;
    collected.unshift(token);
  }

  return clean(collected.join(" ")).replace(/^Name\s*:?\s*/i, "");
}

function isNameToken(token: string, allowCaps: boolean): boolean {
  if (!token) return false;
  if (token.includes("%")) return false; // skill tail
  if (/^[+-]?\d+%?\.?$/.test(token)) return false; // bare number / value
  const letters = token.replace(/[^A-Za-z]/g, "");
  if (!letters) return false; // punctuation-only
  if (!allowCaps && /^[A-Z]{2,}$/.test(letters)) return false; // ALL-CAPS heading
  // Name particles (lowercase) that legitimately appear inside names.
  if (
    /^(?:de|del|van|von|der|den|the|of|in|and|du|da|la|le|el|bin|al|ibn|à)$/i.test(
      token,
    )
  ) {
    return true;
  }
  // Lowercase-particle surnames like "al-Dhahabi", "el-Masri", "bin-Rashid".
  if (/^[a-z]{1,4}-[A-Z]/.test(token)) return true;
  // Otherwise must start like a titled/quoted/parenthetical name fragment.
  return /^[A-Z("'#]/.test(token);
}

// ---------------------------------------------------------------------------
// Stat block body -> one or more characters (multi-column groups expand)
// ---------------------------------------------------------------------------

function parseBlock(
  body: string,
  window: string,
  name: string,
  age: number | null,
  description: string,
  sectionHeading = "",
  preTable = "",
  sharedTail = "",
): CocCharacter[] {
  // Rewrite spelled-out derived labels here (done per block so global text
  // offsets used for name detection stay stable).
  body = normalizeLabels(body);

  // Drop a name recovered from an "average / rolls" column-header row.
  if (isFurnitureName(name)) name = "";

  const statHeader = body.slice(0, statHeaderEnd(body));
  const cols = tokenizeStatHeader(statHeader);
  const numCols = colCount(cols);

  // Group layouts sometimes print the shared Combat/Skills/Languages sections
  // *before* the stat table, so they precede STR and land in `preTable` rather
  // than `body`. For multi-column groups, fall back to that region.
  // A group's shared sections may be printed *before* the stat table (in
  // `preTable`); a set of separate single-column stat lines (e.g. "Mr. Smith"
  // then "Mrs. Smith", or a creature's two forms) instead shares one Combat /
  // Skills / Sanity section printed *after* the last line, supplied here as
  // `sharedTail`. Both are last-resort fallbacks behind the block's own body.
  const fallback = numCols > 1 ? preTable : "";
  const combatText =
    combatSection(body) || combatSection(fallback) || combatSection(sharedTail);
  const attacksPerRound = parseAttacksPerRound(combatText);
  let combat = parseCombat(combatText);
  // Some (esp. pre-generated investigator) sheets list attack profiles with no
  // "Combat" heading at all — bare between the derived stats and "Skills". That
  // span is exactly the stat-header slice (characteristics carry no "%"), so
  // parse profiles straight from it when nothing else turned any up. Restricted
  // to single characters: a multi-column table carries its own "Fighting NN%"
  // rows, which would otherwise swallow the whole table as one attack name.
  if (numCols <= 1 && !combat.length && !combatText)
    combat = parseCombat(statHeader);
  const skills = parseKeyedList(
    sectionBody(body, "Skills") ||
      sectionBody(fallback, "Skills") ||
      sectionBody(sharedTail, "Skills"),
  );
  const languages = parseKeyedList(
    sectionBody(body, "Languages") ||
      sectionBody(fallback, "Languages") ||
      sectionBody(sharedTail, "Languages"),
  );
  const spells = parseSpells(
    sectionBody(body, "Spells") ||
      sectionBody(fallback, "Spells") ||
      sectionBody(sharedTail, "Spells"),
  );
  const sanityLoss = parseSanityLoss(body) || parseSanityLoss(sharedTail);
  const note = parseNoteBeforeCombat(body);
  const notes = note ? [note] : [];

  if (numCols <= 1) {
    return [
      {
        // Large creatures often have a description blurb between their heading
        // and STR, so no name is found nearby. Fall back to the font-size heading
        // above the blurb ("Children of the Sphinx"), then to the name in their
        // Sanity loss line ("... to see the Abomination").
        name:
          name ||
          titleFromHeading(sectionHeading) ||
          nameFromSanityLoss(sanityLoss) ||
          "Unknown",
        age,
        description,
        characteristics: characteristicsForColumn(cols, 0),
        derived: derivedForColumn(cols, 0),
        attacksPerRound,
        combat,
        skills,
        languages,
        spells,
        sanityLoss,
        notes,
      },
    ];
  }

  // Multi-column group: one character per column.
  const { groupName: windowGroup, labels } = groupColumns(window, numCols);
  // Prefer the title parsed from the label-row prefix; otherwise fall back to
  // the block's recovered (font-size) heading, e.g. "SIX MOBSTERS". As a last
  // resort use the section-heading title, which sits at section-heading size
  // above a blurb, too far / too tall for the paths above ("Crazed Crew of the
  // Dark Mistress").
  let groupName =
    (isFurnitureName(windowGroup) ? "" : windowGroup) ||
    titleCaseTitle(name) ||
    groupNameFromPrefix(sectionHeading);
  // Only when the name itself is recovered from the font-size heading is its
  // trailing descriptor a reliable group description; otherwise a per-member
  // "description" from the header window is leaked prose and stays dropped.
  let groupDescription = "";
  if (!groupName) {
    const heading = headingName(sectionHeading);
    groupName = heading.name;
    groupDescription = heading.description;
  }
  // Column labels are member names or ordinals, but letter-spaced PDF text can
  // shatter a name into fragments ("Fergie" -> "Fergi", "e"). Trust the label
  // row only when every column is a whole name / ordinal; otherwise number them.
  const useLabels = labels.length === numCols && labels.every(isMemberLabel);
  const out: CocCharacter[] = [];
  for (let j = 0; j < numCols; j++) {
    const label = useLabels ? labels[j] : String(j + 1);
    // Qualify the column label with the group title so members read
    // descriptively ("Cultist Squad A1", "Six Mobsters 3") instead of a bare
    // "A1" / "3". Only when no title could be recovered do we fall back to a
    // plain "NPC N" for numeric labels (lettered labels stand alone).
    const memberName = groupName
      ? `${groupName} ${label}`
      : /^\d+$/.test(label)
        ? `NPC ${label}`
        : label;
    out.push({
      name: memberName || `Group ${j + 1}`,
      age,
      // A per-member description from the header window is unreliable leaked
      // prose (dropped); a descriptor parsed off the group's own heading is not.
      description: groupDescription,
      characteristics: characteristicsForColumn(cols, j),
      derived: derivedForColumn(cols, j),
      attacksPerRound,
      combat,
      skills,
      languages,
      spells,
      sanityLoss,
      notes,
    });
  }
  return out;
}

function statHeaderEnd(body: string): number {
  // Ignore labels inside "(...)" (e.g. "for spells") via the paren mask.
  return nextSectionLabel(maskParens(body));
}

// Blank out parenthetical content while preserving indices, so section-label
// words that appear inside "(...)" don't trigger false boundaries.
function maskParens(s: string): string {
  return s.replace(/\([^)]*\)/g, (m) => " ".repeat(m.length));
}

// A case-insensitive whole-word (global) matcher for a literal label.
function labelRe(label: string): RegExp {
  return new RegExp(String.raw`\b${escapeRe(label)}\b`, "gi");
}

// A label occurrence is a section *heading* only when it isn't written in all
// lowercase. Headings in these books are capitalised ("Skills", "Sanity loss",
// "SPECIAL POWERS"); ordinary prose is lowercase ("its special power", "ignores
// any armor", "engage in combat"). Matching labels case-insensitively then
// dropping the all-lowercase hits keeps real headings while no longer letting a
// prose word truncate a section before its stat lines are reached.
function isHeadingCase(matched: string): boolean {
  return /[A-Z]/.test(matched);
}

// Index of the first heading-like occurrence of `label` at or after `min`, or
// -1 when there is none. A match counts only when it is heading-cased and not a
// bulleted list item: appendix prose that bleeds into a block ("• Spells: Flesh
// Ward (variant), ...") repeats real label words as bullet entries, which are
// list items, not this stat block's section headings.
function findLabel(masked: string, label: string, min = 0): number {
  const re = labelRe(label);
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    if (m.index < min || !isHeadingCase(m[0])) continue;
    const before = masked.slice(Math.max(0, m.index - 3), m.index);
    if (/[•·]\s*$/.test(before)) continue;
    return m.index;
  }
  return -1;
}

// Index of the earliest section label in `masked` (a paren-masked string), or
// its length when none is found. `exclude` skips one or more labels
// (case-insensitive) and matches before `min` are ignored.
function nextSectionLabel(
  masked: string,
  exclude: string | string[] = "",
  min = 0,
): number {
  const skip = new Set(
    (Array.isArray(exclude) ? exclude : [exclude]).map((s) => s.toLowerCase()),
  );
  let end = masked.length;
  for (const label of SECTION_LABELS) {
    if (skip.has(label.toLowerCase())) continue;
    const idx = findLabel(masked, label, min);
    if (idx >= 0 && idx < end) end = idx;
  }
  return end;
}

// Split the STR..Luck header into label -> [values...]. Handles both single
// characters (one value each) and group tables (N values each).
function tokenizeStatHeader(header: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const known = new Set<string>(
    [...CHAR_LABELS, ...DERIVED_LABELS].map((l) => l.toUpperCase()),
  );

  // Monster "average / rolls" blocks print a generation formula next to each
  // value, tagged with an "×N" multiplier: "45 (1D6+6) ×5", "35 2D6 ×5". Drop
  // the whole formula (parenthesised or bare dice) so the rolls column isn't
  // counted as extra characters.
  header = header.replace(
    /(?:\([^)]*\)|\b\d*[dD]\d+(?:[+-]\d+)?)\s*[×xX]\s*\d+/g,
    " ",
  );
  // Drop any remaining "(3D6 x 5)"-style roll formulas so they don't look like
  // extra columns.
  header = header.replace(/\([^)]*\)/g, " ");
  // "average / rolls" blocks mark unavailable characteristics as "n/a" in both
  // the roll and average columns ("STR n/a n/a CON ..."); drop them so they
  // neither count as extra group columns nor become bogus values.
  header = header.replace(/\bn\/a\b/gi, " ");

  let current: string | null = null;
  for (const token of header.split(/\s+/).filter(Boolean)) {
    const bare = token.replace(/:$/, "");
    if (known.has(bare.toUpperCase())) {
      current = canonicalLabel(bare);
      if (!result.has(current)) result.set(current, []);
      continue;
    }
    // Only push value-like tokens; skip stray words (unrecognised labels, prose)
    // so they can't be mistaken for extra group columns.
    if (current && isValueToken(token)) result.get(current)!.push(token);
  }
  return result;
}

function isValueToken(token: string): boolean {
  return (
    /^[+-]?\d{1,3}\*?$/.test(token) || // 40, -2, 32*
    /^[+-]?\d*[dD]\d+(?:[+-]\d+)?$/.test(token) || // +1D4, 1D10+5
    token === "-" || // em/en dash (N/A)
    /^none$/i.test(token)
  );
}

function canonicalLabel(label: string): string {
  const upper = label.toUpperCase();
  for (const l of [...CHAR_LABELS, ...DERIVED_LABELS]) {
    if (l.toUpperCase() === upper) return l;
  }
  return label;
}

function colCount(cols: Map<string, string[]>): number {
  // Tally how many characteristics carry each value-count. A genuine group table
  // prints the same number of values for every characteristic (one per member),
  // so a column count must be supported by at least two characteristics. A lone
  // larger count is a stray value picked up from prose (e.g. a "Keeper note: ...
  // INT 90" footnote after the stat line), not an extra column.
  const counts = new Map<number, number>();
  for (const label of CHAR_LABELS) {
    const len = cols.get(label)?.length ?? 0;
    if (len > 0) counts.set(len, (counts.get(len) ?? 0) + 1);
  }
  let n = 1;
  for (const [len, chars] of counts) {
    if (len > n && chars >= 2) n = len;
  }
  return n;
}

function characteristicsForColumn(
  cols: Map<string, string[]>,
  j: number,
): Characteristics {
  const out: Characteristics = {};
  for (const label of CHAR_LABELS) {
    const values = cols.get(label);
    if (!values || values[j] === undefined) continue;
    const raw = values[j];
    const marked = raw.includes("*");
    const num = raw.replace(/\*/g, "");
    out[label] = {
      value: /^-?\d+$/.test(num) ? Number(num) : null,
      raw,
      marked,
    };
  }
  return out;
}

function derivedForColumn(
  cols: Map<string, string[]>,
  j: number,
): DerivedStats {
  const db = (pick(cols, "DB", j) ?? "").replace(/\s+/g, "").toUpperCase();
  return {
    // Keep only a real damage bonus ("+1D4", "-2", "0"); "None"/"-"/etc. -> null.
    DB: /^[+-]?(\d+|\d*D\d+([+-]\d+)?)$/.test(db) ? db : null,
    Build: numeric(pick(cols, "Build", j)),
    Move: numeric(pick(cols, "Move", j)),
    MP: numeric(pick(cols, "MP", j)),
    Luck: numeric(pick(cols, "Luck", j)),
  };
}

function pick(
  cols: Map<string, string[]>,
  label: DerivedLabel,
  j: number,
): string | null {
  const values = cols.get(label);
  return values && values[j] !== undefined ? values[j] : null;
}

function numeric(raw: string | null): number | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/\*/g, "");
  return /^[+-]?\d+$/.test(cleaned) ? Number(cleaned) : null;
}

// For a group stat block, the tokens immediately before STR are the column
// headers: either sequential digits ("1 2 3 ... N") or per-member names
// ("Rex Zoltan", "Cheetah Bull Crocodile ...", "A1 A2 ..."). Whatever precedes
// that run is the group name ("BLOODY TONGUE CULTISTS").
function groupColumns(
  window: string,
  numCols: number,
): { groupName: string; labels: string[] } {
  const tokens = window.trim().split(/\s+/).filter(Boolean);

  // A monster "average / rolls" table is the odd one out: its column labels sit
  // *between* a "char." stat-name header and a "roll(s)" formula header, e.g.
  // "char. Leech Host roll s (for host form)" — not at the row's tail. Pull the
  // labels from that span when the layout is present.
  const labelSpan = statTableLabelSpan(tokens, numCols);
  if (labelSpan) return labelSpan;

  const labels = tokens.slice(-numCols);
  let prefix = tokens.slice(0, tokens.length - numCols).join(" ");
  // A "Use these profiles for ...." instruction commonly sits between the group
  // title and the column-label row; drop it so its trailing period doesn't
  // hide the title from groupNameFromPrefix (which stops at a sentence end).
  const useMatch = /\bUse\s+(?:this|these|the following)\b/i.exec(prefix);
  if (useMatch) prefix = prefix.slice(0, useMatch.index);
  return { groupName: groupNameFromPrefix(prefix), labels };
}

// The column labels of a monster "average / rolls" table sit between its "char."
// stat-name header and its "roll(s)" formula header ("char. Leech Host roll s
// (for host form)"). Returns those labels (with the pre-"char." text as the
// group-name prefix) when exactly numCols of them are found, else null so the
// caller uses its normal tail-of-row heuristic.
function statTableLabelSpan(
  tokens: string[],
  numCols: number,
): { groupName: string; labels: string[] } | null {
  let charIdx = -1;
  for (let k = 0; k < tokens.length; k++)
    if (/^char\.?$/i.test(tokens[k])) charIdx = k;
  if (charIdx < 0) return null;

  let rollIdx = -1;
  for (let k = charIdx + 1; k < tokens.length; k++)
    if (/^rolls?$/i.test(tokens[k])) {
      rollIdx = k;
      break;
    }
  if (rollIdx < 0) return null;

  const labels = tokens.slice(charIdx + 1, rollIdx);
  if (labels.length !== numCols || !labels.every(isMemberLabel)) return null;
  return {
    groupName: groupNameFromPrefix(tokens.slice(0, charIdx).join(" ")),
    labels,
  };
}

// Recover a group's name and descriptor from a font-size heading that carries a
// trailing descriptor ("Million Favored Ones : Leeches, horrendous bloodsuckers"
// -> name "Million Favored Ones: Leeches", description "horrendous bloodsuckers")
// — the case groupNameFromPrefix can't reach because it stops at the lowercase
// descriptor. Used only as a last resort.
function headingName(sectionHeading: string): {
  name: string;
  description: string;
} {
  const parsed = parseNameRun(sectionHeading);
  if (!parsed || !parsed.name) return { name: "", description: "" };
  // parseNameRun already normalises the letter-spaced colon in the name.
  return { name: titleFromHeading(parsed.name), description: parsed.description };
}

// A column label is trustworthy when it is an ordinal ("3"), a table cell code
// ("A1"), or a whole capitalised member name ("Fergie") — not a stray letter or
// lowercase fragment left behind by letter-spaced PDF text.
function isMemberLabel(label: string): boolean {
  return /^[A-Za-z]?\d+$/.test(label) || /^[A-Z][A-Za-z'’.\-]+$/.test(label);
}

// Turn a font-size heading run into a title, repairing letter-spaced fragments
// ("Lion s and Big Cats" -> "Lions and Big Cats", where the plural "s" was split
// off). Returns "" for a furniture row so callers fall through.
function titleFromHeading(heading: string): string {
  const merged = clean(heading).replace(
    /\b([A-Za-z]{2,})\s+([a-z])(?=\s|$)/g,
    "$1$2",
  );
  if (!merged || isFurnitureName(merged)) return "";
  return titleCaseTitle(merged);
}

// The "char. / average / rolls (for host form)" column-header row of a monster
// "average / rolls" stat table is not a name. When name recovery lands on that
// row (these blocks put the real name in a distant heading), it yields a string
// made only of those words — reject it so the block falls back to a better
// source (the Sanity-loss creature name, or the font-size heading).
function isFurnitureName(name: string): boolean {
  const words = name.split(/[\s(),.]+/).filter(Boolean);
  return (
    words.length > 0 &&
    words.every((w) => /^(?:char|averages?|rolls?|for|host|form|s)$/i.test(w))
  );
}

// Running-header / boilerplate words that are never part of a group's name.
const GROUP_NAME_STOP = new Set([
  "KEEPER",
  "REFERENCE",
  "BOOKLET",
  "PULP",
  "AVERAGE",
  "AVERAGES",
  "ROLLS",
  "ROLL",
  "CHAR",
  "MONSTERS",
  "NPCS",
]);

// Short connector/particle words that are meaningful inside a title and so are
// kept even though they fall under the stray-fragment length cut ("Villager
// Hybrids on Gray Dragon", "Cultist of the Bloated Woman").
const TITLE_CONNECTORS = new Set([
  "of",
  "on",
  "the",
  "and",
  "for",
  "to",
  "in",
  "at",
  "de",
  "la",
  "du",
  "da",
  "von",
  "van",
  "der",
  "den",
  "el",
  "al",
]);

// Title-case a single title word, keeping connectors lowercase and capitalising
// each part of a hyphenated compound ("life-sucke" -> "Life-Sucke").
function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  if (TITLE_CONNECTORS.has(lower)) return lower;
  return lower.replace(
    /(^|[-'’])([a-z])/g,
    (_, sep, c) => sep + c.toUpperCase(),
  );
}

// Title-case a whole group title: connectors stay lowercase, hyphenated
// compounds keep each part capitalised, and parenthetical spacing is tightened
// ("( NYC)" -> "(Nyc)"). Punctuation around a word (parens, commas) is preserved.
function titleCaseTitle(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const lead = tok.match(/^[^A-Za-z]*/)?.[0] ?? "";
      const trail = tok.match(/[^A-Za-z]*$/)?.[0] ?? "";
      const word = tok.slice(lead.length, tok.length - trail.length);
      if (!word) return tok; // an all-punctuation token such as "("
      return lead + titleCaseWord(word) + trail;
    })
    .join(" ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

// The group title that precedes the column-label row. Walk back from the labels
// to the start of the title — stopping at a boilerplate word (AVERAGE, KEEPER…),
// a value/stat token, or a sentence end — then clean the recovered phrase:
//  - keep a disambiguating "(region)" qualifier but drop any boilerplate
//    subtitle that follows it ("Bloody Tongue Cultists (NYC) Assorted Thugs"
//    -> "Bloody Tongue Cultists (NYC)");
//  - drop commas and a lone trailing squad letter already carried by the labels
//    ("Cultist Squad A" -> "Cultist Squad").
function groupNameFromPrefix(prefix: string): string {
  const tokens = prefix.trim().split(/\s+/).filter(Boolean);
  let start = tokens.length;
  for (let i = tokens.length - 1; i >= 0 && tokens.length - i <= 12; i--) {
    const token = tokens[i];
    if (/\.$/.test(token)) break; // sentence end
    const letters = token.replace(/[^A-Za-z]/g, "");
    if (!letters) {
      // A value-like fragment ("(17/7)", dice) means we have walked back past the
      // title into the previous block's stats. Bare punctuation ("(") is part of
      // the region qualifier, so keep scanning through it.
      if (/\d/.test(token)) break;
      start = i;
      continue;
    }
    if (GROUP_NAME_STOP.has(letters.toUpperCase())) break;
    if (!/^[A-Z(]/.test(token)) break; // lowercase prose word
    start = i;
  }
  if (start >= tokens.length) return "";

  let title = tokens.slice(start).join(" ");
  const open = title.indexOf("(");
  if (open >= 0) {
    const close = title.indexOf(")", open);
    if (close >= 0) title = title.slice(0, close + 1); // drop post-region subtitle
  }
  title = title
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s[A-Z]$/, "") // lone squad letter already carried by the labels
    .trim();
  return titleCaseTitle(title);
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

// Text of a labelled section, from the label to the next section label.
// Whether a block body carries any section of its own (a section heading, an
// attack profile, an "Attacks per round" line, or a Sanity loss) rather than
// only characteristics. A bare stat line inherits the shared section of the set
// it belongs to; a body with sections keeps its own.
function bodyHasSections(body: string): boolean {
  const masked = maskParens(body);
  for (const label of SECTION_LABELS) {
    if (findLabel(masked, label) >= 0) return true;
  }
  return (
    /\d{1,3}\s*%\s*\(\s*\d/.test(body) || // "40% (20/8)" attack profile
    /Sanity\s+Loss\s*:/i.test(body) ||
    /Attacks?\s+per\s+round/i.test(body)
  );
}

function sectionBody(
  body: string,
  label: string,
  extraExclude: string[] = [],
): string {
  const maskedBody = maskParens(body);
  const startIdx = findLabel(maskedBody, label);
  if (startIdx < 0) return "";

  const start = startIdx + label.length;
  const rest = body.slice(start);
  const end = nextSectionLabel(maskParens(rest), [label, ...extraExclude]);
  return clean(rest.slice(0, end));
}

// The combat text for a stat block. Most blocks carry a "Combat" heading; some
// creatures (e.g. large Mythos monsters) omit it, leading instead with "Special
// Powers" and then "Attacks per round". When there is no "Combat" section, fall
// back to the region beginning at "Attacks per round" so the profiles that
// follow the attack prose ("Fighting 80% (40/16), damage 3D6 ...") are still
// found. Returns "" when neither anchor is present.
//
// "Special" / "Powers" / "Sanity Loss" do not bound the combat text: a monster's
// attack lines are often preceded by inline notes ("Special: ...", or a Howl that
// "inflicts 1 point of Sanity loss ..."), with the real profiles after them.
// parseCombat only extracts "NN% (h/f)" rows, so reading past such a note is safe
// — a genuine Special Powers / Sanity Loss section carries prose, not profiles,
// and parseSanityLoss finds the real Sanity line independently — while
// Skills/Spells/Languages/Armor still stop the section.
const COMBAT_SKIP = ["Combat", "Special", "Powers", "Sanity Loss"];
function combatSection(body: string): string {
  const labelled = sectionBody(body, "Combat", ["Special", "Powers", "Sanity Loss"]);
  if (labelled) return labelled;

  const match = /Attacks\s+per\s+round/i.exec(maskParens(body));
  if (!match) return "";

  const rest = body.slice(match.index);
  // min 1 so the leading "Attacks per round" match itself isn't a boundary.
  const end = nextSectionLabel(maskParens(rest), COMBAT_SKIP, 1);
  return clean(rest.slice(0, end));
}

// A spell list. Two layouts occur:
//  - comma-separated names ("Call the Black Sphinx*, Contact Nyarlathotep, ...")
//  - named entries with descriptions ("DOMINATE (Corbitt's variant): ...")
// Returns the spell names in either case.
function parseSpells(text: string): string[] {
  if (!text) return [];

  const colon = text.indexOf(":");
  const comma = text.indexOf(",");
  const descriptive = colon >= 0 && (comma < 0 || colon < comma);

  if (descriptive) {
    // "<Name> (variant): description. <Name2>: description. ..."
    const names: string[] = [];
    const re = /(?:^|[.;]\s+)([A-Z][A-Za-z0-9'\- ]*(?:\s*\([^)]*\))?)\s*:/g;
    for (const m of text.matchAll(re)) {
      const name = clean(m[1]);
      if (name) names.push(name);
    }
    return names;
  }

  // Comma-separated names. The list ends at the first sentence period (anything
  // after it, e.g. "Magical Artifact: ...", is not part of the list).
  const sentenceEnd = text.search(/\.\s/);
  const list = sentenceEnd >= 0 ? text.slice(0, sentenceEnd) : text;

  // Parentheticals may contain commas ("(see ... box, nearby)"), so strip them
  // before splitting; drop trailing prose like "and others as the Keeper wishes".
  return list
    .replace(/\([^)]*\)/g, " ")
    .split(/\s*,\s*/)
    .map((s) => clean(s.replace(/[*✝‡†●]/g, ""))) // drop "see description" markers
    .filter(
      (s) =>
        s.length > 0 &&
        /^[A-Z]/.test(s) &&
        !/^(?:and|or)\b/i.test(s) &&
        !/^none$/i.test(s),
    );
}

// The "Sanity loss" statement (monsters only), e.g. "0/1D6 Sanity points to
// see a kharisiri", "none", or "special (see text)". Returns null when absent
// (ordinary human NPCs have no Sanity loss line).
function parseSanityLoss(body: string): string | null {
  // Require a colon so prose mentions ("reduce the Sanity loss to 0/1D3") don't
  // match — only the labelled stat line does.
  const match = /Sanity\s+Loss\s*:\s*/i.exec(maskParens(body));
  if (!match) return null;

  const rest = body.slice(match.index + match[0].length);

  // Bound at the next section label, then at a sentence end or a bullet (books
  // that list Sanity Loss as one item in a bulleted rewards list).
  let end = nextSectionLabel(maskParens(rest), "Sanity Loss");
  const cut = rest.slice(0, end).search(/\.(?:\s|$)|[•●⁃|]/);
  if (cut >= 0) end = cut;

  let value = clean(rest.slice(0, end));
  if (value.length > 120) {
    const space = value.lastIndexOf(" ", 120);
    value = value.slice(0, space > 0 ? space : 120);
  }
  return value || null;
}

// Derive a creature name from its Sanity loss line, e.g. "1/1D6 Sanity points
// to see the Abomination (reduce ...)" -> "Abomination". Bounds the name at a
// qualifier ("in ...", "which ...", "(", ",") so long descriptions don't leak.
function nameFromSanityLoss(sanityLoss: string | null): string | null {
  if (!sanityLoss) return null;
  const m =
    /(?:to see|for seeing|seeing|see)\s+(?:the |a |an )?([A-Za-z][A-Za-z'\- ]*?)(?:\s+in\b|\s+which\b|\s*\(|,|$)/i.exec(
      sanityLoss,
    );
  if (!m) return null;
  const name = clean(m[1]);
  // A creature name is a short noun phrase; longer captures are prose.
  if (name.length < 2 || name.split(/\s+/).length > 4) return null;
  return name[0].toUpperCase() + name.slice(1);
}

// The "Attacks per round" value from a Combat section, e.g. "1" or
// "up to 4 (1D4 tendril lash or 1 consume)". Returns null when absent.
function parseAttacksPerRound(combatText: string): string | null {
  const match =
    /Attacks per round\s*:?\s*((?:up to\s+)?\d+(?:\s*\([^)]*\))?)/i.exec(
      combatText,
    );
  return match ? clean(match[1]) : null;
}

function parseCombat(text: string): CombatEntry[] {
  if (!text) return [];

  // Tighten a spaced "+" between numbers in a dice expression ("1D10 + 2" ->
  // "1D10+2") so the trailing operand isn't read as the start of the next attack.
  text = text.replace(/(\d)\s*\+\s*(\d)/g, "$1+$2");

  // Some books label the half/fifth values, with or without % signs and spaces:
  // "(Hard 20/Extreme 8)" or "(Hard 25%/Extreme10%)" -> "(20/8)" / "(25/10)".
  text = text.replace(
    /\(\s*Hard\s*(\d+)%?\s*\/\s*Extreme\s*(\d+)%?\s*\)/gi,
    "($1/$2)",
  );

  // Drop the "Attacks per round" preamble (and any "up to N (...)" clause).
  text = text
    .replace(
      /Attacks per round\s*:?\s*(?:up to\s+\d+\s*\([^)]*\)\.?|\d+\.?)\s*/i,
      "",
    )
    .trim();

  // An attack name: an optional honorific ("Mrs. Carruthers (elephant gun)"),
  // an optional caliber dot, then a capital/digit start, then a run of name
  // characters. Internal periods are allowed only as an honorific or a caliber
  // (a dot followed by a digit, e.g. "Colt .38 revolver") so a sentence-ending
  // period still can't be swallowed. Also NOT a bare dice token (e.g. the "1D4"
  // in a "1D3 + 1D4" damage bonus).
  // Also not the damage-bonus "DB", which trails a "+" in damage ("1D3 + DB Grab
  // (mnvr)") and must not be swallowed into the following attack's name.
  const honorific = String.raw`(?:(?:Mrs?|Ms|Dr|Mme|Mlle|Miss|Sgt|Capt|Col|Lt|St|Fr)\.\s+)?`;
  // Parentheses inside a name must be a short, comma-free balanced group
  // ("(mnvr)", "(thrown)", "(elephant gun)"), never a lone bracket or a
  // comma-laden prose clause. A lone ")" would otherwise let a name swallow an
  // effect clause up to the next "%" ("... failed) Hatchet (thrown) 40%"),
  // truncating the current attack's damage; a comma-laden "(...)" would absorb a
  // description ("(lashing out..., kicking..., or goring...) Fighting 40%").
  const attackName = String.raw`${honorific}(?!\d+[dD]\d+\b)(?!DB\b)\.?[A-Z0-9](?:[A-Za-z0-9 /'"+#*-]|\([^),]*\)|\.\d)*?`;
  // The start of the next attack, used only to bound the damage of this one. An
  // attack profile is a value followed by a "(half/fifth)" or ", damage". The %
  // is optional (some Dodges read "Dodge 27 (13/5)") and a comma may sit before
  // the "(half/fifth)" ("40%, (20/8)"); "Panga 45%, damage 1D8" omits the paren.
  const profile = String.raw`\d{1,3}\s*%?\s*,?\s*(?:\(\s*\d|damage)`;
  const nextAttack = String.raw`${attackName}\s+${profile}`;
  // Damage runs until the next attack profile, a "Dodge" entry (often written
  // without a % — "Dodge n/a", "Dodge do not dodge"), a sentence end, a comma
  // starting a prose clause, or the end of the combat text. Kept permissive
  // otherwise so verbose damage ("1D3 + damage bonus(1D4)") survives intact.
  const proseComma = String.raw`,\s+(?:if|when|this|these|then|but|following|followed|each|plus|note|see)\b`;
  const damage = String.raw`(.+?)(?=\s+${nextAttack}|\s+Dodge\b|\.(?:\s|$)|${proseComma}|$)`;
  // A maneuver profile carries a prose effect instead of "damage X" after its
  // "(half/fifth)" ("Garrote 45% (22/9), mnvr. to escape or suffer 1D6 damage
  // per round"). Capture that clause as the note. It runs to the next attack /
  // Dodge / end — not to a sentence period, since it can hold an abbreviation
  // ("mnvr.").
  const maneuverNote = String.raw`(?!damage\b)(.+?)(?=\s+${nextAttack}|\s+Dodge\b|$)`;

  // An attack is either:
  //  - "NN% (half/fifth)" with optional ", damage X" or ", <maneuver note>",
  //  - "NN%, damage X" with the (half/fifth) omitted, or
  //  - a bare "damage X" maneuver with no percentage (damage must start with a
  //    dice/number so effect prose like "Latch damage each round" is not read
  //    as an attack).
  const re = new RegExp(
    String.raw`(${attackName})\s+(?:(\d{1,3})\s*%?\s*,?\s*(?:\(\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\)(?:\s*,?\s*damage\s+${damage}|\s*,\s*${maneuverNote})?|damage\s+${damage})|damage\s+(?=\d)${damage})`,
    "g",
  );

  const out: CombatEntry[] = [];
  for (const match of text.matchAll(re)) {
    const value = match[2] !== undefined ? Number(match[2]) : null;
    let half = match[3] !== undefined ? Number(match[3]) : null;
    let fifth = match[4] !== undefined ? Number(match[4]) : null;
    // Derive the half/fifth thresholds when the source omits them.
    if (value !== null && half === null) {
      half = Math.floor(value / 2);
      fifth = Math.floor(value / 5);
    }
    const { damage, note } = splitDamageNote(match[5] ?? match[7] ?? match[8]);
    const maneuver = match[6] ? clean(match[6]) : null;
    out.push({
      name: cleanCombatName(match[1]),
      value,
      half,
      fifth,
      damage,
      note: note ?? maneuver,
    });
  }
  return out.flatMap(splitWeaponAlternatives);
}

// A Brawl/Fighting attack often lists weapon alternatives inline in its damage:
//   "1D3+1D4 or blackjack 1D8+1D4"        -> Brawl 1D3+1D4, Blackjack 1D8+1D4
//   "1D3, knife 1D4, or club 1D6"         -> Brawl 1D3, Knife 1D4, Club 1D6
//   "1D3+1D4 or weapon" / "1D3 or by weapon" -> Brawl 1D3+1D4 / 1D3 (the bare
//     "or weapon" is fully redundant with the brawl damage, so it's dropped)
// Each named alternative becomes its own combat entry sharing the brawl skill's
// value, and its name is capitalized. If any alternative is neither a named
// weapon (with damage) nor a bare "or weapon" — e.g. prose like "9D6 or it can
// choose to engulf the target" — the entry is left untouched.
const BASE_DICE = String.raw`\d+[dD]\d+(?:\s*[+\-]\s*(?:\d+[dD]\d+|DB|\d+))*`;

function splitWeaponAlternatives(entry: CombatEntry): CombatEntry[] {
  if (!entry.damage || !/\b(?:brawl|fighting)\b/i.test(entry.name))
    return [entry];
  const m = new RegExp(String.raw`^(${BASE_DICE})\s*(.*)$`).exec(entry.damage);
  if (!m) return [entry];
  const base = m[1];
  // Strip the separator that introduces the alternatives (",", "or", ", or"),
  // tolerating leading footnote markers ("1D3+1D6** or fighting knife ...").
  const rest = m[2].trim().replace(/^[\s*]*,?\s*(?:or\s+)?/i, "");
  if (!rest) return [entry];

  const weapons: CombatEntry[] = [];
  for (const chunk of rest.split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)) {
    const alt = chunk.trim();
    if (!alt) continue;
    if (/^(?:by\s+)?weapons?$/i.test(alt)) continue; // redundant "or weapon"
    const wm = /^(.*?\S)\s+(\d+[dD]\d+.*)$/.exec(alt);
    if (!wm) return [entry]; // unrecognized prose -> leave the entry as-is
    const { damage, note } = splitDamageNote(wm[2]);
    weapons.push({
      name: wm[1].charAt(0).toUpperCase() + wm[1].slice(1),
      value: entry.value,
      half: entry.half,
      fifth: entry.fifth,
      damage,
      note,
    });
  }
  return [{ ...entry, damage: base }, ...weapons];
}

// Split prose parentheticals off the damage string into a separate note, e.g.
// "1D6 (not on person, in cash register)" -> { damage: "1D6",
// note: "not on person, in cash register" }. Dice/number parentheticals like
// "(1D4)" are kept inline as part of the damage.
function splitDamageNote(raw: string | undefined): {
  damage: string | null;
  note: string | null;
} {
  if (!raw) return { damage: null, note: null };

  const parts: string[] = [];
  const damage = clean(
    raw.replace(/\(([^)]*)\)/g, (whole: string, inner: string) => {
      if (/^[\s\d+\-*/xX.dD]+$/.test(inner)) return whole; // dice/number: keep inline
      parts.push(clean(inner));
      return " ";
    }),
  );

  return {
    damage: damage || null,
    note: parts.length ? parts.join("; ") : null,
  };
}

// Prose words that never appear in a real attack name; when a name has picked
// up an effect-description prefix ("... until removed with Hard STR roll
// Projectile Needle"), everything up to and including the last such word is
// dropped, leaving just the attack name.
const ATTACK_NAME_STOPWORDS = new Set([
  "damage",
  "each",
  "round",
  "rounds",
  "thereafter",
  "until",
  "removed",
  "with",
  "roll",
  "test",
  "success",
  "followed",
  "this",
  "is",
  "are",
  "by",
  "per",
  "points",
  "point",
  "see",
  "description",
  "above",
  "below",
  "if",
  "when",
  "then",
  "STR",
  "CON",
  "SIZ",
  "DEX",
  "INT",
  "POW",
  "EDU",
  "APP",
  // effect / range / prose words that mark the boundary before a real name
  "attacks",
  "attack",
  "form",
  "held",
  "once",
  "victim",
  "yards",
  "feet",
  "range",
  "jaws",
  "escape",
  "target",
]);

// A leaked prose prefix can end in a dangling ")" — a close paren whose "(" was
// consumed by the previous attack's damage ("...CON roll failed) Hatchet"). Drop
// everything up to and including the last such unmatched ")".
function stripDanglingCloseParen(s: string): string {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      if (depth === 0) cut = i;
      else depth--;
    }
  }
  return cut >= 0 ? s.slice(cut + 1) : s;
}

// An attacks-per-round count that bled into a name ("1)", "2", "30").
const isCountToken = (t: string): boolean => /^\d+\)?$/.test(t);

// Recover the attack name from a capture that may carry a leaked prose prefix
// (effect text, a range, or an attacks-per-round clause from the preceding
// attack). Walk back over the trailing name tokens, stopping at a prose/stat
// stopword or a stray count, while staying inside any balanced name parenthetical
// so "(mnvr)" / "(fighting maneuver)" survive. Preserves a leading caliber dot
// (".45 revolver").
function cleanCombatName(value: string): string {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\*/g, "") // drop footnote markers (".22 revolver*")
    .replace(/^[,;:\s]+/, "")
    .replace(/[,.;:\s]+$/, "")
    .trim();
  if (!cleaned) return "";

  const tokens = stripDanglingCloseParen(cleaned).trim().split(" ").filter(Boolean);
  const name: string[] = [];
  let depth = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (depth === 0) {
      const letters = tok.replace(/[^A-Za-z]/g, "");
      if (
        ATTACK_NAME_STOPWORDS.has(letters) ||
        ATTACK_NAME_STOPWORDS.has(letters.toLowerCase()) ||
        isCountToken(tok)
      )
        break;
    }
    name.unshift(tok);
    depth += (tok.match(/\)/g)?.length ?? 0) - (tok.match(/\(/g)?.length ?? 0);
    if (depth < 0) depth = 0;
  }

  // A leading prose parenthetical can survive the walk ("(target may Dodge) Dodge").
  const result = name.join(" ").replace(/^(?:\([^)]*\)\s*)+/, "").trim();
  return result || cleaned;
}

// A comma-separated "Name NN%" list (used for both Skills and Languages).
// The list ends at the first "NN%." (percent immediately followed by the
// sentence-ending period) so trailing narrative prose is excluded.
function parseKeyedList(text: string): Skills {
  if (!text) return {};

  // Drop a leading qualifier in parentheses so its prose and percentages are not
  // read as entries: "(human) Climb 75% ..." -> "Climb 75% ...", and
  // "(Varies, own at 60%, others at 20% or 30%) Arabic, English ..." (bare
  // language names with no per-entry %) -> just the names, which yield nothing.
  text = text.replace(/^\s*\([^)]*\)\s*/, "");

  const listEnd = text.search(/\d{1,3}\s*%\s*\./);
  if (listEnd >= 0) {
    text = text.slice(0, text.indexOf("%", listEnd) + 1);
  }

  const out: Skills = {};
  // ":" is allowed so a nested specialisation survives ("Lore (Theology: Methodism)").
  const entryRe = /([A-Za-z][A-Za-z0-9 .()/'&:-]*?)\s+(\d{1,3})\s*%/g;
  for (const match of text.matchAll(entryRe)) {
    const name = cleanEntryName(match[1]);
    if (name) out[name] = Number(match[2]);
  }
  return out;
}

// Clean a skill/language entry name. Real skills/languages are capitalised, so
// drop a leading prose prefix by starting at the first capitalised word
// ("Varies, assume Arabic" -> "Arabic"); then trim an unbalanced parenthetical
// fragment left when a ":"/"," inside a specialisation broke the match
// ("Lore (Theology: Methodism)" -> "Methodism", "Sciences (Biology" -> "Sciences").
function cleanEntryName(raw: string): string {
  let s = clean(raw);
  const cap = s.search(/[A-Z]/);
  if (cap < 0) return ""; // no capitalised word — prose ("etc", "thus making up")
  if (cap > 0) s = s.slice(cap);
  const open = (s.match(/\(/g) ?? []).length;
  const close = (s.match(/\)/g) ?? []).length;
  if (open > close) s = clean(s.slice(0, s.lastIndexOf("(")));
  else if (close > open) s = clean(s.replace(/\)[^)]*$/, ""));
  return s;
}

// A parenthetical/asterisked note that sometimes sits between MP and Combat.
function parseNoteBeforeCombat(body: string): string {
  const combatMatch = /\bCombat\b/i.exec(body);
  const preCombat = combatMatch ? body.slice(0, combatMatch.index) : body;

  // Note begins at an "*(" or standalone "*..." after the last derived value.
  const noteMatch = /\*\s*\(([^)]*)\)/.exec(preCombat);
  if (noteMatch) return clean(noteMatch[1]);

  return "";
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return String(text)
    .replace(/\u001f/g, "fi") // a "fi" ligature this font emits as U+001F ("Zombified")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") // strip stray C0 controls
    .replace(/ /g, " ")
    .replace(/[‒–—―−]/g, "-") // en/em/minus dashes -> -
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalise spelled-out derived-stat labels (Quick-Start style) to the
// abbreviations the tokenizer understands, but only when used as a label (i.e.
// followed by a colon) so prose like "damage bonus(1D4)" is left intact.
// Applied per stat block rather than globally so page offsets stay stable.
function normalizeLabels(text: string): string {
  return text
    .replace(/\bAverage\s+Damage\s+Bonus(?=\s*:)/gi, "DB")
    .replace(/\bDamage\s+Bonus(?=\s*:)/gi, "DB")
    .replace(/\bAverage\s+Build(?=\s*:)/gi, "Build")
    .replace(/\bMove\s+Rate(?=\s*:)/gi, "Move")
    .replace(/\bMagic\s+Points?(?=\s*:)/gi, "MP")
    .replace(/\bHit\s+Points?(?=\s*:)/gi, "HP");
}

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\s]+/, "")
    .replace(/[,.;:\s]+$/, "")
    .trim();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

interface RawItem {
  str: string;
  font: string;
  height: number;
  eol: boolean;
}

async function processPage(
  pdf: pdfjs.PDFDocumentProxy,
  i: number,
): Promise<RawItem[]> {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  return content.items.map((raw) => {
    const item = raw as {
      str?: string;
      fontName?: string;
      height?: number;
      hasEOL?: boolean;
    };
    return {
      str: item.str ?? "",
      font: item.fontName ?? "",
      height: Math.round((item.height ?? 0) * 10) / 10,
      eol: item.hasEOL ?? false,
    };
  });
}

// Extraction keeps the font size (height) of each run of text. Body text, NPC
// name headings, and section headings sit at distinct heights in these books,
// which lets us recover the character name even when it is far from the stats.
export async function processPDF(data: Uint8Array): Promise<CocCharacter[]> {
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: Promise<RawItem[]>[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    pages.push(processPage(pdf, i));
  }
  const pageItems = await Promise.all(pages);

  // Merge consecutive same-(font, height) items into runs, but start a new run
  // at each line break (hasEOL) or page boundary, recording whether the run
  // begins a new line. This keeps a same-font heading on its own line (e.g. a
  // group title) separate from the NPC name on the next line.
  const runs: {
    font: string;
    height: number;
    text: string;
    newline: boolean;
  }[] = [];
  let newline = true;
  for (const items of pageItems) {
    for (const it of items) {
      const text = normalizeText(it.str);
      if (text) {
        const last = runs[runs.length - 1];
        if (
          !newline &&
          last &&
          last.font === it.font &&
          last.height === it.height
        ) {
          last.text += " " + text;
        } else {
          runs.push({ font: it.font, height: it.height, text, newline });
        }
        newline = false;
      }
      if (it.eol) newline = true;
    }
    newline = true; // page boundary
  }

  // Identify page furniture (running headers/footers, side titles): non-body
  // runs whose exact text repeats across many pages. Genuine headings — even
  // group titles — appear once, so they are kept.
  const bodyHeight = mostCommonHeight(runs);
  const repeats = new Map<string, number>();
  for (const run of runs) {
    if (run.height !== bodyHeight)
      repeats.set(run.text, (repeats.get(run.text) ?? 0) + 1);
  }
  const isFurniture = (run: { text: string; height: number }) =>
    run.height !== bodyHeight &&
    ((repeats.get(run.text) ?? 0) >= 8 || /^[\d ]+$/.test(run.text)); // repeats or page numbers

  // Build the concatenated text and the parallel chunk list with offsets.
  const chunks: TextChunk[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const run of runs) {
    if (isFurniture(run)) continue;
    if (parts.length) {
      parts.push(" ");
      offset += 1;
    }
    const start = offset;
    parts.push(run.text);
    offset += run.text.length;
    chunks.push({
      text: run.text,
      height: run.height,
      start,
      end: offset,
      newline: run.newline,
    });
  }

  return parseCocCharacters(parts.join(""), chunks);
}
