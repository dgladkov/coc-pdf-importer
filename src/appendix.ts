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

// TOC and cross-refs also say "APPENDIX B". Prefer candidates in the last
// quarter of the book (where Masks-style appendices live) and score by a
// content probe (Cost: / Sanity Loss: / Link:).
function sliceAppendix(
  text: string,
  letter: string,
  title: RegExp,
  nextLetter: string | null,
  nextTitle: RegExp | null,
  contentProbe: RegExp,
): string {
  const minStart = Math.floor(text.length * 0.7);
  const starts: number[] = [];
  const startRe = new RegExp(`APPENDIX\\s+${letter}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(text))) {
    const s = m.index + m[0].length;
    if (s >= minStart) starts.push(s);
  }
  const titleRe = new RegExp(
    title.source,
    title.flags.includes("g") ? title.flags : title.flags + "g",
  );
  while ((m = titleRe.exec(text))) {
    const s = m.index + m[0].length;
    if (s >= minStart) starts.push(s);
  }
  // Fall back to whole-book starts if the late-book window found nothing.
  if (starts.length === 0) {
    startRe.lastIndex = 0;
    while ((m = startRe.exec(text))) starts.push(m.index + m[0].length);
    titleRe.lastIndex = 0;
    while ((m = titleRe.exec(text))) starts.push(m.index + m[0].length);
  }

  let best = "";
  let bestScore = 0;
  for (const start of starts) {
    let end = text.length;
    if (nextLetter) {
      const n = new RegExp(`APPENDIX\\s+${nextLetter}\\b`, "gi");
      n.lastIndex = start;
      let nm: RegExpExecArray | null;
      let bestNext = -1;
      let bestNextScore = -1;
      while ((nm = n.exec(text))) {
        if (nm.index < start) continue;
        if (nm.index < minStart && start >= minStart) continue;
        const nextSlice = text.slice(nm.index, Math.min(text.length, nm.index + 12000));
        const nextProbe =
          nextLetter === "C"
            ? /•\s*Sanity Loss:/gi
            : nextLetter === "D"
              ? /•\s*Link:/gi
              : contentProbe;
        const sc = (nextSlice.match(nextProbe) || []).length;
        if (sc > bestNextScore) {
          bestNextScore = sc;
          bestNext = nm.index;
        }
        if (sc >= 3 && nm.index >= minStart) break;
      }
      if (bestNext >= 0) end = bestNext;
    }
    if (nextTitle) {
      const n = new RegExp(
        nextTitle.source,
        nextTitle.flags.includes("g") ? nextTitle.flags : nextTitle.flags + "g",
      );
      n.lastIndex = start;
      let nm: RegExpExecArray | null;
      while ((nm = n.exec(text))) {
        if (nm.index < start) continue;
        if (nm.index >= minStart || start < minStart) {
          // Only tighten end if this title sits before our current end and
          // the gap still has our content (avoid cutting at early TOC words).
          const gap = text.slice(start, nm.index);
          const gapScore = (gap.match(new RegExp(contentProbe.source, "gi")) || [])
            .length;
          if (gapScore >= 2 && nm.index < end) end = nm.index;
          break;
        }
      }
    }
    const slice = text.slice(start, end);
    const score = (slice.match(new RegExp(contentProbe.source, "gi")) || [])
      .length;
    // Prefer denser late slices: slight bias for later starts.
    const biased = score + (start >= minStart ? score * 0.1 : 0);
    if (biased > bestScore) {
      bestScore = biased;
      best = slice;
    }
  }
  return bestScore >= 1 ? best : "";
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
  /((?:[A-Z][A-Za-z\u2019'/.-]+(?:\s+(?:of|the|a|an|to|and|from|for|with|in|[A-Z][A-Za-z\u2019'/.-]+))+|[A-Z][A-Za-z\u2019'/.-]+)(?:\s*\([^)]+\))?)\s*$/;

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
    sliceAppendix(text, "B", /\bSPELLS\b/, "C", /\bTOMES\b/, /•\s*Cost:/),
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

const TOME_LANG =
  "English|Latin|Arabic|French|Greek|German|Spanish|Chinese|Japanese|Italian|Portuguese|Hebrew|Egyptian|Dutch|Russian|Swedish|Turkish|Hindi|Welsh|Gaelic|Akkadian|Coptic";

const TOME_REGION =
  /\b(?:PERU|AMERICA|ENGLAND|EGYPT|KENYA|AUSTRALIA|CHINA|INDIA)\b/gi;

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
  // "English, by Nigel Blackwell, 1920. ..."
  // "Latin, translated by Olaus Wormius, 1228. ..."
  // "Spanish, written by Gaspar Figueroa, 1543. ..."
  // "English, James Woodville, 17th century. ..."
  // "Arabic, by Abdul al-Hazrad (Abd al-Azrad), c. 730. ..."
  const m = meta.match(
    new RegExp(
      String.raw`^(${TOME_LANG})(?:\s+\w+)?,\s*(?:(?:(?:translated|written)\s+)?by\s+|author[^,]*,\s*)?(.+?),\s*((?:c\.\s*)?\d{3,4}|[^.]{0,40}?century)\.(.*)$`,
      "i",
    ),
  );
  if (m) {
    return {
      language: cleanSpaces(m[1]),
      author: cleanSpaces(m[2]),
      date: cleanSpaces(m[3]),
      physical: cleanSpaces(m[4]),
    };
  }
  const langOnly = meta.match(new RegExp(String.raw`^(${TOME_LANG})\b`, "i"));
  return {
    language: langOnly ? langOnly[1] : "",
    author: "",
    date: "",
    physical: cleanSpaces(meta),
  };
}

/** Clean a raw title run sitting before a language metadata line. */
function cleanTomeTitle(raw: string): string {
  let s = cleanSpaces(raw);
  s = s.replace(/^.*\bnone\s+/i, "");
  s = s.replace(/^.*\)\s+/, "");
  // Prefer text after the last sentence end when spells prose bleeds in.
  const period = s.lastIndexOf(". ");
  if (period >= 0 && period > s.length - 80) s = s.slice(period + 2);
  s = s.replace(TOME_REGION, " ");
  s = s.replace(/\s+Classical$/i, "");
  s = cleanSpaces(s);
  // If "The Necronomicon"-style title is buried after a spell name, prefer
  // the last "The …" / "A …" run.
  const the = s.match(/\b((?:The|A|An)\s+[A-Z][A-Za-z'/’.-]+(?:\s+[A-Z][A-Za-z'/’.-]+)*)\s*$/);
  if (the && the[1].split(/\s+/).length >= 2) return cleanSpaces(the[1]);
  const tm = s.match(TITLE_AT_END);
  if (tm) return cleanSpaces(tm[1]);
  // Drop leading comma-list remnant ("Bolt, Beta Ward Title")
  const afterComma = s.match(/,\s*([^,]+)$/);
  if (afterComma) {
    const cand = cleanSpaces(afterComma[1]);
    const tm2 = cand.match(TITLE_AT_END);
    if (tm2) return cleanSpaces(tm2[1]);
  }
  return s.slice(-60);
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
  const text = cleanSpaces(before);
  const langRe = new RegExp(
    String.raw`\b(${TOME_LANG})(?:\s+\w+)?,\s*(?:(?:(?:translated|written)\s+)?by\s+|author[^,]*,\s*)?`,
    "gi",
  );
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = langRe.exec(text))) last = m;
  if (!last) {
    return {
      name: "",
      language: "",
      author: "",
      date: "",
      physical: "",
      link: "",
      description: text,
      relevance: "",
    };
  }

  const name = cleanTomeTitle(text.slice(0, last.index));
  let rest = text.slice(last.index);
  // Meta runs until Link / Relevance / end — take through first "sentence" of
  // bibliographic line (first period that ends the date clause) plus physical.
  const metaEnd = rest.search(/\s+•\s*Link:|\s+Relevance\s*:/i);
  const meta = metaEnd >= 0 ? rest.slice(0, metaEnd) : rest;
  rest = metaEnd >= 0 ? rest.slice(metaEnd) : "";

  const { language, author, date, physical } = parseTomeMetadata(meta);

  let link = "";
  const linkM = rest.match(/•\s*Link:\s*(.+?(?:page\s+\d+[^.]*\.?))/i);
  if (linkM) {
    link = cleanSpaces(linkM[1]);
    rest = cleanSpaces(rest.slice(linkM.index! + linkM[0].length));
  }

  let relevance = "";
  const relM = rest.match(/Relevance\s*:\s*([\s\S]+)$/i);
  if (relM) {
    relevance = cleanSpaces(relM[1]);
    rest = cleanSpaces(rest.slice(0, relM.index));
  }

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

export function parseAppendixTomes(text: string): AppendixTome[] {
  const section = stripFurniture(
    sliceAppendix(
      text,
      "C",
      /\bTOMES\b/,
      "D",
      /\bART[EI]FACTS\b/,
      /•\s*Sanity Loss:/,
    ),
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
      i === 0 ? 0 : findNextTomeTitleIndex(section, anchors[i - 1].spellsStart, a.index);
    const before = section.slice(entryStart, a.index);
    const spellsEnd =
      i + 1 < anchors.length
        ? findNextTomeTitleIndex(section, a.spellsStart, anchors[i + 1].index)
        : section.length;
    const spells = cleanSpaces(section.slice(a.spellsStart, spellsEnd));
    const parsed = splitTomePreamble(before);
    if (!parsed.name || parsed.name.length < 2) continue;
    // Drop titles that are clearly prose fragments.
    if (/\.$/.test(parsed.name) || parsed.name.split(/\s+/).length > 10) continue;
    if (
      /\b(?:devoted|translated|commentaries|likely|written|chapters|members)\b/i.test(
        parsed.name,
      )
    ) {
      continue;
    }
    if (/^\d/.test(parsed.name)) continue;

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

// Index where the next tome title begins (end of previous spells list).
function findNextTomeTitleIndex(
  section: string,
  from: number,
  statsIndex: number,
): number {
  const chunk = section.slice(from, statsIndex);
  const meta = new RegExp(
    String.raw`(?:${TOME_LANG})(?:\s+\w+)?,\s*(?:(?:(?:translated|written)\s+)?by\s+|author[^,]*,\s*)?`,
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
  const name = cleanTomeTitle(probe);
  if (name) {
    const local = before.lastIndexOf(name);
    if (local >= 0) return from + local;
  }
  return from + m.index;
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
      /•\s*Link:/,
    ),
  );
  if (!section) return [];
  // Prefer starting at the last late-book ARTIFACTS banner inside the slice.
  const artBanners = [...section.matchAll(/\bART[EI]FACTS\b/gi)];
  if (artBanners.length > 0) {
    const last = artBanners[artBanners.length - 1];
    const after = section.slice(last.index! + last[0].length);
    if ((after.match(/•\s*Link:/g) || []).length >= 3) {
      section = after;
    }
  }
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
    if (!isPlausibleArtefactName(name)) continue;
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
    if (!keeper || keeper.length < 20) continue;
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

function isPlausibleArtefactName(name: string): boolean {
  if (!name || name.length < 3) return false;
  if (REGION_HEADERS.test(name)) return false;
  if (name.split(/\s+/).length > 8) return false;
  if (/\.$/.test(name)) return false;
  // Chapter / handout banners are often ALL CAPS.
  if (name === name.toUpperCase() && name.length > 3) return false;
  // Reject leading prose glue ("Meeting Robert Mackenzie").
  if (/^(?:Meeting|The|A|An)\s+[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(name) &&
      !/^(?:The|A|An)\s+(?:Golden|Ward|Mask|Mirror|Crown|Girdle|Necklace|Amulet|Circlet|Token|Ring|Fly)/i.test(name)) {
    // Allow "The Golden Mirror" etc.; reject "Meeting Robert Mackenzie".
    if (/^Meeting\b/i.test(name)) return false;
  }
  if (/^Meeting\b/i.test(name)) return false;
  if (/\b(?:Road|Street|Club|Navy|Expedition)\b/i.test(name) && !/\b(?:Mirror|Ward|Mask|Crown|Ring|Scepter)/i.test(name)) {
    return false;
  }
  if (/^(?:Imperial|Carlyle|Seamen|Lantern|Cat-Demon|Elder Sign|New|MR\.|Prospero|Smith)\b/i.test(name)) {
    return false;
  }
  // Trailing section headers like bare "Mirrors".
  if (/^(?:Mirrors|Artifacts|Artefacts)$/i.test(name)) return false;
  return true;
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
