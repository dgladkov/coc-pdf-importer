// Parsers for Chaosium appendix reference sections — Spells (APPENDIX B),
// Tomes (APPENDIX C), and Artefacts/Artifacts (APPENDIX D). Pure text →
// internal structures; no pdf.js or Foundry. Wired into processPDF alongside
// pulp items; Foundry shaping lives in document.ts.
//
// Masks of Nyarlathotep (and similar Keeper books) print these as two-column
// red-header entries. pdf.js reads left column then right, so a flat join is
// enough — we do not need column reconstruction.

export interface SpellCosts {
  magicPoints: string;
  sanity: string;
  power: string;
  hitPoints: string;
  others: string;
}

export interface AppendixSpell {
  name: string;
  castingTime: string;
  costs: SpellCosts;
  /** Optional Note: line that sits between title and Cost. */
  note: string;
  description: string;
}

export interface AppendixTome {
  name: string;
  language: string;
  author: string;
  date: string;
  /** Bibliographic / physical description after the date. */
  physical: string;
  link: string;
  description: string;
  relevance: string;
  sanityLoss: string;
  /** Initial / final Cthulhu Mythos percentiles from "+N/+M". */
  cthulhuMythos: { initial: number; final: number };
  mythosRating: number;
  study: { necessary: number; units: string };
  spells: string;
}

export interface AppendixArtefact {
  name: string;
  link: string;
  /** Short player-facing physical blurb when a clean first-sentence split works. */
  description: string;
  /** Full mechanics / lore (always filled). */
  keeper: string;
  /** True when body looks like a combat weapon. */
  isWeapon: boolean;
}

export type AppendixItem =
  | ({ kind: "spell" } & AppendixSpell)
  | ({ kind: "tome" } & AppendixTome)
  | ({ kind: "artefact" } & AppendixArtefact);

// --- furniture -------------------------------------------------------------

// Letter-spaced running headers ("S E R P E N T O F Y I G") and APPENDIX /
// section banners. Do NOT strip bare digits — those appear in Cost/Study stats.
const FURNITURE = [
  /\bAPPENDIX\s+[A-Z]\b/gi,
  /\b(?:SPELLS|TOMES|ARTIFACTS|ARTEFACTS)\b/g,
  // 4+ single letters separated by spaces (running header / footer).
  /(?:^|\s)(?:[A-Za-z]\s){4,}[A-Za-z](?=\s|$)/g,
];

function stripFurniture(s: string): string {
  let out = s;
  for (const re of FURNITURE) out = out.replace(re, " ");
  return cleanSpaces(out);
}

function cleanSpaces(s: string): string {
  return s
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeForHtmlLater(s: string): string {
  // Parser keeps plain text; document.ts escapes for Foundry HTML.
  return cleanSpaces(s);
}

// --- section slices --------------------------------------------------------

// Prefer APPENDIX letter markers; fall back to section title words.
function sliceAppendix(
  text: string,
  letter: string,
  title: RegExp,
  nextLetter: string | null,
  nextTitle: RegExp | null,
): string {
  const upper = text; // already mixed; match case-insensitive
  const startRe = new RegExp(`APPENDIX\\s+${letter}\\b`, "i");
  let start = -1;
  const m = startRe.exec(upper);
  if (m) start = m.index + m[0].length;
  else {
    const t = title.exec(upper);
    if (t) start = t.index + t[0].length;
  }
  if (start < 0) return "";

  let end = upper.length;
  if (nextLetter) {
    const n = new RegExp(`APPENDIX\\s+${nextLetter}\\b`, "i").exec(
      upper.slice(start),
    );
    if (n) end = start + n.index;
  }
  if (nextTitle && end === upper.length) {
    const n = nextTitle.exec(upper.slice(start));
    if (n) end = start + n.index;
  }
  return upper.slice(start, end);
}

// --- costs -----------------------------------------------------------------

const EMPTY_COSTS: SpellCosts = {
  magicPoints: "",
  sanity: "",
  power: "",
  hitPoints: "",
  others: "",
};

/** Parse a Cost line into legacy CoC7 spell cost fields. */
export function parseSpellCosts(raw: string): SpellCosts {
  const costs: SpellCosts = { ...EMPTY_COSTS };
  const parts = raw
    .split(/;/)
    .map((p) => p.trim())
    .filter(Boolean);
  const leftover: string[] = [];
  for (const part of parts) {
    const mp = part.match(
      /^([\dDd+\-]+|variable|\d+\+)\s+magic\s+points?$/i,
    );
    if (mp) {
      costs.magicPoints = normalizeDice(mp[1]);
      continue;
    }
    const san = part.match(
      /^([\dDd+\-]+)\s+Sanity\s+points?$/i,
    );
    if (san) {
      costs.sanity = normalizeDice(san[1]);
      continue;
    }
    const pow = part.match(/^([\dDd+\-]+)\s+POW$/i);
    if (pow) {
      costs.power = normalizeDice(pow[1]);
      continue;
    }
    const hp = part.match(/^([\dDd+\-]+)\s+hit\s+points?$/i);
    if (hp) {
      costs.hitPoints = normalizeDice(hp[1]);
      continue;
    }
    leftover.push(part);
  }
  costs.others = leftover.join("; ");
  return costs;
}

function normalizeDice(s: string): string {
  // CoC7 book examples use lowercase d ("2d10"); keep "variable" as-is.
  if (/^variable$/i.test(s)) return "variable";
  return s.replace(/(\d)[Dd]/g, "$1d").replace(/^\+/g, "");
}

// --- spells ----------------------------------------------------------------

const TITLE_AT_END =
  /((?:[A-Z][A-Za-z'/.-]+(?:\s+(?:of|the|a|an|to|and|from|for|with|in|[A-Z][A-Za-z'/.-]+))+|[A-Z][A-Za-z'/.-]+)(?:\s*\([^)]+\))?)\s*$/;

function extractSpellTitle(before: string): string {
  // Drop trailing body sentence fragments (end with ".") then match title.
  let s = before.replace(/\s+/g, " ").trim();
  const lastPeriod = s.lastIndexOf(". ");
  if (lastPeriod >= 0) s = s.slice(lastPeriod + 2).trim();
  const m = s.match(TITLE_AT_END);
  return m ? cleanSpaces(m[1]) : cleanSpaces(s).slice(-80);
}

function parseCastingTime(rest: string): { castingTime: string; length: number } {
  const short = rest.match(
    /^((?:instantaneous|\d[\dDd+\-\s/]*(?:minutes?|rounds?|days?|hours?)(?:\s+per\s+[^,]+)?(?:,\s*[^.]+)?|[^\.]{1,80}?))(?=\s+[A-Z])/,
  );
  if (short) {
    return {
      castingTime: cleanSpaces(short[1]),
      length: short[0].length,
    };
  }
  const timeMatch = rest.match(/^(.+?)(?=\s+[A-Z][a-z]|\s*$)/);
  if (timeMatch) {
    return {
      castingTime: cleanSpaces(timeMatch[1]),
      length: timeMatch[0].length,
    };
  }
  const fallback = cleanSpaces(rest.slice(0, 40));
  return { castingTime: fallback, length: fallback.length };
}

export function parseAppendixSpells(text: string): AppendixSpell[] {
  const section = stripFurniture(
    sliceAppendix(text, "B", /\bSPELLS\b/, "C", /\bTOMES\b/),
  );
  if (!section) return [];

  const spells: AppendixSpell[] = [];
  const anchors: {
    index: number;
    note: string;
    cost: string;
    castingTime: string;
    afterCast: number;
  }[] = [];

  const costFind =
    /(?:Note:\s*([^•]+?)\s+)?•\s*Cost:\s*([^•]+?)\s+•\s*Casting time:\s*/gi;
  let cm: RegExpExecArray | null;
  while ((cm = costFind.exec(section))) {
    const castingStart = cm.index + cm[0].length;
    const { castingTime, length } = parseCastingTime(
      section.slice(castingStart),
    );
    anchors.push({
      index: cm.index,
      note: cleanSpaces(cm[1] ?? ""),
      cost: cleanSpaces(cm[2] ?? ""),
      castingTime,
      afterCast: castingStart + length,
    });
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const prevEnd = i === 0 ? 0 : anchors[i - 1].afterCast;
    const before = section.slice(prevEnd, a.index);
    const name = extractSpellTitle(before);
    if (!name || name.length < 2) continue;
    let bodyEnd = section.length;
    if (i + 1 < anchors.length) {
      const nextBefore = section.slice(a.afterCast, anchors[i + 1].index);
      const title = extractSpellTitle(nextBefore);
      if (title) {
        const ti = nextBefore.lastIndexOf(title);
        if (ti >= 0) bodyEnd = a.afterCast + ti;
      } else {
        bodyEnd = anchors[i + 1].index;
      }
    }
    const description = escapeForHtmlLater(
      section.slice(a.afterCast, bodyEnd),
    );
    if (/\.$/.test(name) || name.split(/\s+/).length > 12) continue;
    spells.push({
      name,
      castingTime: a.castingTime,
      costs: parseSpellCosts(a.cost),
      note: a.note,
      description: a.note
        ? escapeForHtmlLater(`Note: ${a.note} ${description}`)
        : description,
    });
  }
  return spells;
}

// --- tomes -----------------------------------------------------------------

export function parseStudyUnits(unit: string): string {
  const u = unit.toLowerCase().replace(/s$/, "");
  const map: Record<string, string> = {
    week: "CoC7.weeks",
    day: "CoC7.days",
    month: "CoC7.months",
    hour: "CoC7.hours",
  };
  return map[u] ?? "CoC7.weeks";
}

function parseTomeMetadata(meta: string): {
  language: string;
  author: string;
  date: string;
  physical: string;
} {
  // "English, by Nigel Blackwell, 1920. Sextodecimo, ..."
  // "Latin, translated by Olaus Wormius, 1228. Spanish black letter..."
  // "Arabic, by Abdul al-Hazrad (Abd al-Azrad), c. 730.Ten scrolls,..."
  const m = meta.match(
    /^([^,]+),\s*(?:(?:translated\s+)?by\s+)?(.+?),\s*((?:c\.\s*)?\d{3,4})\.(.*)$/i,
  );
  if (m) {
    return {
      language: cleanSpaces(m[1]),
      author: cleanSpaces(m[2]),
      date: cleanSpaces(m[3]),
      physical: cleanSpaces(m[4]),
    };
  }
  return { language: "", author: "", date: "", physical: cleanSpaces(meta) };
}

export function parseAppendixTomes(text: string): AppendixTome[] {
  const section = stripFurniture(
    sliceAppendix(text, "C", /\bTOMES\b/, "D", /\bART[EI]FACTS\b/),
  );
  if (!section) return [];

  const tomes: AppendixTome[] = [];
  const statsRe =
    /•\s*Sanity Loss:\s*([^\•]+?)\s+•\s*Cthulhu Mythos:\s*\+?(\d+)\s*\/\s*\+?(\d+)\s*percentiles?\s+•\s*Mythos Rating:\s*(\d+)\s+•\s*Study:\s*(\d+)\s*(weeks?|days?|months?|hours?)\s+•\s*Spells:\s*/gi;

  const anchors: {
    index: number;
    sanityLoss: string;
    initial: number;
    final: number;
    mythosRating: number;
    studyN: number;
    studyUnit: string;
    spellsStart: number;
  }[] = [];

  let sm: RegExpExecArray | null;
  while ((sm = statsRe.exec(section))) {
    anchors.push({
      index: sm.index,
      sanityLoss: cleanSpaces(sm[1]),
      initial: Number(sm[2]),
      final: Number(sm[3]),
      mythosRating: Number(sm[4]),
      studyN: Number(sm[5]),
      studyUnit: parseStudyUnits(sm[6]),
      spellsStart: sm.index + sm[0].length,
    });
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const entryStart =
      i === 0
        ? 0
        : findNextTomeTitleIndex(
            section,
            anchors[i - 1].spellsStart,
            a.index,
          );
    const before = section.slice(entryStart, a.index);

    const spellsEnd =
      i + 1 < anchors.length
        ? findNextTomeTitleIndex(
            section,
            a.spellsStart,
            anchors[i + 1].index,
          )
        : section.length;
    const spells = cleanSpaces(section.slice(a.spellsStart, spellsEnd));

    const parsed = splitTomePreamble(before);
    if (!parsed.name) continue;

    tomes.push({
      name: parsed.name,
      language: parsed.language,
      author: parsed.author,
      date: parsed.date,
      physical: parsed.physical,
      link: parsed.link,
      description: parsed.description,
      relevance: parsed.relevance,
      sanityLoss: a.sanityLoss.replace(/\s+/g, ""),
      cthulhuMythos: { initial: a.initial, final: a.final },
      mythosRating: a.mythosRating,
      study: { necessary: a.studyN, units: a.studyUnit },
      spells,
    });
  }
  return tomes;
}

const TOME_LANG =
  "English|Latin|Arabic|French|Greek|German|Spanish|Chinese|Japanese|Italian|Portuguese|Hebrew|Egyptian|Dutch|Russian|Swedish|Turkish|Hindi|Welsh|Gaelic|Akkadian|Coptic";

// Index where the next tome title begins (end of previous spells list).
function findNextTomeTitleIndex(
  section: string,
  from: number,
  statsIndex: number,
): number {
  const chunk = section.slice(from, statsIndex);
  // Require "by" / "translated by" so spell names are not mistaken for languages.
  const meta = new RegExp(
    String.raw`(?:${TOME_LANG}),\s*(?:(?:translated\s+)?by\s+)`,
    "i",
  );
  const m = meta.exec(chunk);
  if (!m || m.index === undefined) return statsIndex;

  const before = chunk.slice(0, m.index);
  let probe = before;
  const noneAt = before.toLowerCase().lastIndexOf("none");
  const parenAt = before.lastIndexOf(") ");
  const periodAt = before.lastIndexOf(". ");
  const cut = Math.max(noneAt, parenAt, periodAt);
  if (cut >= 0) {
    if (cut === noneAt) probe = before.slice(noneAt + 4);
    else if (cut === parenAt) probe = before.slice(parenAt + 1);
    else probe = before.slice(periodAt + 1);
  }
  const tm = probe.match(TITLE_AT_END);
  if (tm) {
    const name = tm[1];
    const local = before.lastIndexOf(name);
    if (local >= 0) return from + local;
  }
  return from + m.index;
}

function splitTomePreamble(before: string): {
  name: string;
  language: string;
  author: string;
  date: string;
  physical: string;
  link: string;
  description: string;
  relevance: string;
} {
  let text = cleanSpaces(before);
  // Strip leading leftover from previous spells list (often ends mid-list).
  // Title: first Title-Case run that is followed by a language-like metadata line.
  const metaRe = new RegExp(
    String.raw`((?:[A-Z][A-Za-z'/’.-]+(?:\s+(?:of|the|a|an|to|and|from|for|with|in|As|A|d['’][A-Z][A-Za-z'/’.-]+|[A-Z][A-Za-z'/’.-]+))+|[A-Z][A-Za-z'/’.-]+))\s+((?:${TOME_LANG}),\s*(?:(?:translated\s+)?by\s+)?.+?\.\s*.*?)(?=\s+•\s*Link:|\s+Relevance:|$)`,
    "i",
  );
  const m = text.match(metaRe);
  let name = "";
  let meta = "";
  let rest = text;
  if (m && m.index !== undefined) {
    name = cleanSpaces(m[1]);
    meta = cleanSpaces(m[2]);
    rest = cleanSpaces(text.slice(m.index + m[0].length));
  } else {
    // Fallback: last Title-ish words before Link/Relevance.
    const fb = text.match(
      /((?:[A-Z][A-Za-z'/’.-]+(?:\s+[A-Za-z'/’.-]+){0,8}))\s+(•\s*Link:|Relevance:)/,
    );
    if (fb && fb.index !== undefined) {
      name = cleanSpaces(fb[1]);
      rest = cleanSpaces(text.slice(fb.index + name.length));
    }
  }

  let link = "";
  const linkM = rest.match(/•\s*Link:\s*(.+?)(?=\s+Relevance:|\s+[A-Z][a-z]|$)/);
  // Link often followed by prose starting with capital — take until sentence
  // that doesn't look like "Page N" location.
  const linkM2 = rest.match(
    /•\s*Link:\s*(.+?(?:page\s+\d+[^.]*\.?))/i,
  );
  if (linkM2) {
    link = cleanSpaces(linkM2[1]);
    rest = cleanSpaces(rest.slice(linkM2.index! + linkM2[0].length));
  } else if (linkM) {
    link = cleanSpaces(linkM[1]);
    rest = cleanSpaces(rest.slice(linkM.index! + linkM[0].length));
  }

  let relevance = "";
  const relM = rest.match(/Relevance:\s*([\s\S]+)$/i);
  if (relM) {
    relevance = cleanSpaces(relM[1]);
    rest = cleanSpaces(rest.slice(0, relM.index));
  }

  const { language, author, date, physical } = parseTomeMetadata(meta);
  return {
    name,
    language,
    author,
    date,
    physical,
    link,
    description: rest,
    relevance,
  };
}

// --- artefacts -------------------------------------------------------------

const REGION_HEADERS =
  /^(?:PERU|AMERICA|ENGLAND|EGYPT|KENYA|AUSTRALIA|CHINA|INDIA|HONG\s+KONG|SHANGHAI|NEW\s+YORK|LONDON)$/i;

const WEAPON_CUES =
  /\b(?:weapon|Fighting\s*\(|deals?\s+\d|\d+D\d+\s*(?:\+\s*\d+)?\s*damage|attack(?:s|ing)?\s+(?:with|as)|damage\s+to\s+(?:supernatural|mundane)|impale)\b/i;

export function isArtefactWeapon(body: string): boolean {
  return WEAPON_CUES.test(body);
}

/** First sentence → description when it looks physical; else empty. */
export function splitArtefactBlurb(body: string): {
  description: string;
  keeper: string;
} {
  const text = cleanSpaces(body);
  const m = text.match(/^(.+?[.!?])\s+([A-Z].*)$/);
  if (!m) return { description: "", keeper: text };
  const first = m[1];
  // Prefer short physical blurbs (under ~200 chars, no heavy mechanics).
  if (
    first.length <= 200 &&
    !/\b(?:magic points?|Sanity|POW roll|damage)\b/i.test(first)
  ) {
    return { description: first, keeper: text };
  }
  return { description: "", keeper: text };
}

export function parseAppendixArtefacts(text: string): AppendixArtefact[] {
  let section = stripFurniture(
    sliceAppendix(
      text,
      "D",
      /\bART[EI]FACTS\b/,
      "E",
      /\bAPPENDIX\s+E\b/,
    ),
  );
  if (!section) return [];
  // Chapter geography banners are not artefact titles.
  section = section.replace(
    /\b(?:PERU|AMERICA|ENGLAND|EGYPT|KENYA|AUSTRALIA|CHINA|INDIA|HONG\s+KONG|SHANGHAI|NEW\s+YORK|LONDON)\b/gi,
    " ",
  );
  section = cleanSpaces(section);

  // Entries: Title + • Link: + body until next Title+Link.
  const entryRe =
    /((?:[A-Z][A-Za-z'/’.-]+(?:\s+(?:of|the|a|an|to|and|from|for|with|in|[A-Z][A-Za-z'/’.-]+))+|[A-Z][A-Za-z'/’.-]+))\s+(•\s*Link:)/g;

  const starts: { name: string; index: number; linkAt: number }[] = [];
  let em: RegExpExecArray | null;
  while ((em = entryRe.exec(section))) {
    const name = cleanSpaces(em[1]);
    if (REGION_HEADERS.test(name)) continue;
    if (name.split(/\s+/).length > 10) continue;
    starts.push({
      name,
      index: em.index,
      linkAt: em.index + em[1].length,
    });
  }

  const artefacts: AppendixArtefact[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : section.length;
    const chunk = section.slice(s.linkAt, end);
    let link = "";
    let body = chunk;
    const lm = chunk.match(/•\s*Link:\s*(.+?(?:page\s+\d+[^.]*\.?))/i);
    if (lm) {
      link = cleanSpaces(lm[1]);
      body = cleanSpaces(chunk.slice(lm.index! + lm[0].length));
    } else {
      const lm2 = chunk.match(/•\s*Link:\s*(.+?)(?=\s+[A-Z])/);
      if (lm2) {
        link = cleanSpaces(lm2[1]);
        body = cleanSpaces(chunk.slice(lm2.index! + lm2[0].length));
      }
    }
    // Drop trailing table / pulp sidebar junk.
    body = body.replace(/\bTABLE:[\s\S]*$/i, "").trim();
    body = body.replace(/\bPULP:[\s\S]*$/i, "").trim();
    const { description, keeper } = splitArtefactBlurb(body);
    if (!keeper) continue;
    artefacts.push({
      name: s.name,
      link,
      description,
      keeper: link ? cleanSpaces(`Link: ${link} ${keeper}`) : keeper,
      isWeapon: isArtefactWeapon(keeper),
    });
  }
  return artefacts;
}

// --- public entry ----------------------------------------------------------

export function parseAppendixItems(text: string): AppendixItem[] {
  return [
    ...parseAppendixSpells(text).map((s) => ({
      kind: "spell" as const,
      ...s,
    })),
    ...parseAppendixTomes(text).map((t) => ({
      kind: "tome" as const,
      ...t,
    })),
    ...parseAppendixArtefacts(text).map((a) => ({
      kind: "artefact" as const,
      ...a,
    })),
  ];
}
