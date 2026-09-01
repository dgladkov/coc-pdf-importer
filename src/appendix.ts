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
  /** Campaign chapter banner when present (Peru, Egypt, …). */
  region: string;
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
  /** Campaign chapter banner (Peru, England, …) for Item subfolders. */
  region: string;
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
  // A page number printed twice at the page head ("631 631"), and Innsmouth's
  // "Appendices 242" footer. (Lone digits are kept — Cost/Study stats.)
  /\b(\d{1,3})\s+\1\b(?!\s*[-–]\s*\d)/g,
  /\bAppendices\s+\d{1,3}\b/g,
];

function stripFurniture(s: string): string {
  let out = normalizeAppendixBullets(s);
  for (const re of FURNITURE) {
    re.lastIndex = 0;
    out = out.replace(re, " ");
  }
  return cleanSpaces(out);
}

// Innsmouth (and some fonts) map the bullet glyph to a lone "M". Rewrite known
// labelled bullets so Cost/Link/Appearance probes stay •-based.
function normalizeAppendixBullets(s: string): string {
  return s
    .replace(/\bM\s+(Cost:)/g, "• $1")
    .replace(/\bM\s+(Casting time:)/g, "• $1")
    .replace(/\bM\s+(Appearance in the campaign:)/g, "• $1")
    .replace(/\bM\s+(Link:)/g, "• $1")
    .replace(/\bM\s+(Sanity Loss:)/g, "• $1")
    .replace(/\bM\s+(Cthulhu Mythos:)/g, "• $1")
    .replace(/\bM\s+(Mythos Rating:)/g, "• $1")
    .replace(/\bM\s+(Study:)/g, "• $1")
    .replace(/\bM\s+(Spells:)/g, "• $1");
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

// Real Masks appendices sit at the end of the book. Running headers and
// "see APPENDIX D" cross-refs also match those strings, so we score *local*
// content in a short window after each candidate — not a long lookahead that
// would credit later real sections to an early false marker.

function localScore(text: string, at: number, probe: RegExp, window = 5000): number {
  return (text.slice(at, at + window).match(new RegExp(probe.source, "gi")) || [])
    .length;
}

function nextBound(start: number, ...candidates: number[]): number {
  let end = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (c > start && c < end) end = c;
  }
  return end === Number.POSITIVE_INFINITY ? -1 : end;
}

/** Start index of the artefacts appendix (APPENDIX D / ARTIFACTS / …). */
function findArtefactsStart(text: string): number {
  const raw = normalizeAppendixBullets(text);
  // Case-sensitive ARTIFACTS — lowercase "artifacts" in prose must not match.
  const re =
    /APPENDIX\s+D\b|\bARTIFACTS\b|\bARTEFACTS\b|\bDEEP ONE ARTIFACTS\b|\bNEW ARTIFACTS\b/g;
  let best = -1;
  let bestScore = 0;
  let m: RegExpExecArray | null;
  const lateFrom = Math.floor(raw.length * 0.7);
  while ((m = re.exec(raw))) {
    const at = m.index;
    if (raw.length >= 20000 && at < lateFrom) continue;
    const links = localScore(raw, at, /•\s*(?:Link|Appearance in the campaign):/, 8000);
    const regions = localScore(
      raw,
      at,
      /\b(?:PERU|AMERICA|ENGLAND|EGYPT|KENYA|AUSTRALIA|CHINA|OKLAHOMA|BOLIVIA)\b/,
      8000,
    );
    const named =
      localScore(raw, at, /Idols from|Jewelry from|Mapulos|Trident or Spear/, 4000);
    // Masks/2HS have Link/Appearance; Innsmouth uses named headings.
    if (links < 2 && named < 1 && raw.length >= 20000) continue;
    const score = links * 2 + regions * 3 + named * 5;
    const minScore = raw.length < 20000 ? 2 : named >= 1 ? 5 : 10;
    if (score > bestScore || (score === bestScore && (best < 0 || at < best))) {
      if (score >= minScore) {
        bestScore = score;
        best = at;
      }
    }
  }
  return best;
}

/** Start index of the tomes appendix (APPENDIX C / TOMES). */
function findTomesStart(text: string): number {
  const raw = normalizeAppendixBullets(text);
  const lateFrom = Math.floor(raw.length * 0.7);
  const re =
    /APPENDIX\s+C\b|\bTHE DEEP ONES IN TOMES\b|\bTOMES\b/gi;
  let best = -1;
  let bestScore = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    // Skip running headers / prose "tomes" without nearby Sanity Loss stats.
    if (raw.length >= 20000 && start < lateFrom && !/DEEP ONES IN TOMES/i.test(m[0])) {
      continue;
    }
    const spanScore = (
      raw.slice(start, start + 20000).match(/•\s*Sanity Loss:/gi) || []
    ).length;
    // Running headers like "Appendix C 257" mid-prose have no Sanity Loss —
    // never treat them as the tomes appendix opener.
    if (spanScore < 1 && !/DEEP ONES IN TOMES/i.test(m[0])) continue;
    let score = spanScore;
    if (/DEEP ONES IN TOMES/i.test(m[0])) score += 5;
    if (/APPENDIX\s+C/i.test(m[0])) score += 2;
    if (score < 1) continue;
    if (score > bestScore || (score === bestScore && (best < 0 || start < best))) {
      bestScore = score;
      best = start;
    }
  }
  return bestScore >= 1 ? best : -1;
}

/** Start index of the spells appendix (APPENDIX B / SPELLS / Marine Magic). */
function findSpellsStart(text: string): number {
  const raw = normalizeAppendixBullets(text);
  const lateFrom = Math.floor(raw.length * 0.7);
  const re =
    /APPENDIX\s+B\b|\bNEW SPELLS\b|\bMarine Magic(?:\s*&\s*Artifacts?)?\b|\bSPELLS\b/gi;
  let best = -1;
  let bestScore = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const isNamed = /NEW SPELLS|Marine Magic\s*&/i.test(m[0]);
    // Cross-refs like "Marine Magic, page 252" are not section starts.
    if (/Marine Magic/i.test(m[0]) && !/Marine Magic\s*&/i.test(m[0])) continue;
    if (raw.length >= 20000 && start < lateFrom && !isNamed) continue;
    // Prefer Costs that sit close after the banner (real section openers).
    const near = (raw.slice(start, start + 2500).match(/•\s*Cost:/gi) || [])
      .length;
    const far = (raw.slice(start, start + 12000).match(/•\s*Cost:/gi) || [])
      .length;
    if (far < 1) continue;
    let score = near * 3 + far;
    if (isNamed) score += 10;
    if (/APPENDIX\s+B/i.test(m[0])) score += 2;
    if (score > bestScore || (score === bestScore && start > best)) {
      bestScore = score;
      best = start;
    }
  }
  return bestScore >= 1 ? best : -1;
}

function sliceAppendix(
  text: string,
  letter: string,
  _title: RegExp,
  _nextLetter: string | null,
  _nextTitle: RegExp | null,
  _contentProbe: RegExp,
): string {
  const raw = normalizeAppendixBullets(text);
  const artefactsStart = findArtefactsStart(raw);
  const tomesStart = findTomesStart(raw);
  const spellsStart = findSpellsStart(raw);

  if (letter === "B") {
    if (spellsStart < 0) return "";
    const end = nextBound(spellsStart, tomesStart, artefactsStart);
    return raw.slice(spellsStart, end > 0 ? end : raw.length);
  }
  if (letter === "C") {
    if (tomesStart < 0) return "";
    const end = nextBound(tomesStart, artefactsStart, spellsStart);
    return raw.slice(tomesStart, end > 0 ? end : raw.length);
  }
  if (letter === "D") {
    if (artefactsStart < 0) return "";
    const end = nextBound(artefactsStart, tomesStart, spellsStart);
    return raw.slice(artefactsStart, end > 0 ? end : raw.length);
  }
  return "";
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
      /^(all remaining|[\dDd+\-]+|variable|\d+\+)\s+magic\s+points?(?:\s+per\s+\w+)?$/i,
    );
    if (mp) {
      costs.magicPoints = normalizeDice(mp[1]);
      if (/\bper\s+\w+$/i.test(part)) {
        costs.others = cleanSpaces(
          [costs.others, part.replace(/^.*?(per\s+\w+)$/i, "$1")]
            .filter(Boolean)
            .join("; "),
        );
      }
      continue;
    }
    const san = part.match(
      /^(all remaining|[\dDd+\-]+)\s+Sanity\s+points?$/i,
    );
    if (san) {
      costs.sanity = normalizeDice(san[1]);
      continue;
    }
    const pow = part.match(/^(all remaining|[\dDd+\-]+)\s+POW$/i);
    if (pow) {
      costs.power = normalizeDice(pow[1]);
      continue;
    }
    const hp = part.match(/^(all remaining|[\dDd+\-]+)\s+hit\s+points?$/i);
    if (hp) {
      costs.hitPoints = normalizeDice(hp[1]);
      continue;
    }
    leftover.push(part);
  }
  costs.others = cleanSpaces(
    [costs.others, leftover.join("; ")].filter(Boolean).join("; "),
  );
  return costs;
}

function normalizeDice(s: string): string {
  // CoC7 book examples use lowercase d ("2d10"); keep "variable"/"all remaining".
  if (/^variable$/i.test(s)) return "variable";
  if (/^all remaining$/i.test(s)) return "all remaining";
  return s.replace(/(\d)[Dd]/g, "$1d").replace(/^\+/g, "");
}

// --- spells ----------------------------------------------------------------

// A title is a run of capitalised words (accented letters allowed \u2014
// "S\u00e9lections de Livre D\u2019Ivon", "\u00c9quinoxe Divis\u00e9") joined by English or French
// connectors, optionally with a parenthetical.
// A title word may carry a French elision ("d\u2019Ivon", "l\u2019\u00c9toile") and must start
// at a word boundary \u2014 the "Ivon" inside "d\u2019Ivon" is not a title on its own.
const TITLE_WORD = String.raw`(?:[dl][\u2019'])?[A-Z\u00c0-\u00dd][A-Za-z\u00c0-\u00ff\u2019'/.-]+`;
const TITLE_AT_END = new RegExp(
  String.raw`(?<![A-Za-z\u00c0-\u00ff\u2019'])((?:${TITLE_WORD}(?:\s+(?:of|the|a|an|to|and|from|for|with|in|As|A|de|du|des|la|le|${TITLE_WORD}))+|${TITLE_WORD})(?:\s*\([^)]+\))?)\s*$`,
);

const BAD_SPELL_TITLES =
  /^(?:Keeper(?:\s+note)?|NEW SPELLS|SPELLS|TOMES|ARTIFACTS|ARTEFACTS|Note|Marine Magic.*)$/i;

function extractSpellTitle(before: string): string {
  let s = before.replace(/\s+/g, " ").trim();
  // Drop section banners and prior tome spell-lists that glue onto the title.
  s = s.replace(/\bNEW SPELLS\b/gi, " ");
  s = s.replace(/\bMarine Magic(?:\s*&\s*Artifacts?)?\b/gi, " ");
  // Keeper notes are prose, not titles — strip the note clause only.
  s = s.replace(/\bKeeper note:[^.]*\.?/gi, " ");
  s = s.replace(/^.*\bSpells:\s*/i, "");
  // Drop trailing body sentence fragments (end with ".") then match title.
  const lastPeriod = s.lastIndexOf(". ");
  if (lastPeriod >= 0) s = s.slice(lastPeriod + 2).trim();
  s = cleanSpaces(s);
  // Prefer a clean ALL-CAPS title immediately before Cost (2HS style).
  const caps = s.match(
    /\b((?:[A-Z][A-Z\u2019'/.-]+)(?:\s+(?:OF|THE|A|AN|TO|AND|FROM|FOR|WITH|IN|[A-Z][A-Z\u2019'/.-]+))*(?:\s*\([^)]+\))?)\s*$/,
  );
  if (caps && !BAD_SPELL_TITLES.test(caps[1])) {
    return cleanSpaces(caps[1]);
  }
  const m = s.match(TITLE_AT_END);
  const name = m ? cleanSpaces(m[1]) : cleanSpaces(s).slice(-80);
  if (!name || BAD_SPELL_TITLES.test(name)) return "";
  if (/\bNEW SPELLS\b/i.test(name) || /\bKeeper\b/i.test(name)) return "";
  return name;
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
    /(?:(?<![Kk]eeper\s)Note:\s*([^•]+?)\s+)?•\s*Cost:\s*([^•]+?)\s+•\s*Casting time:\s*/gi;
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
    // A boxed spell sidebar's own label ("SPELL:") can trail the body when the
    // next sidebar's title is what bounds it; it is not part of the text.
    const description = escapeForHtmlLater(
      section.slice(a.afterCast, bodyEnd).replace(/\s*\bSPELLS?\s*:\s*$/i, ""),
    );
    if (/\.$/.test(name) || name.split(/\s+/).length > 12) continue;
    // The last spell in a section has no next title to bound it at, falling
    // back to the section's own end (sliceAppendix, when this is the only
    // Cost/Casting-time pair found and no Tomes/Artefacts section closes it
    // either) — which can be the rest of the document. No genuine spell
    // write-up runs this long, so this is always a false-positive match on
    // some unrelated "Cost:"/"Casting time:" text, not a real spell.
    if (description.length > 6000) continue;
    spells.push({
      name: name.replace(/\*+$/, "").trim(), // footnote marker ("Ecstasy*")
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
  "English|Latin|Arabic|French|Greek|German|Spanish|Chinese|Japanese|Italian|Portuguese|Hebrew|Egyptian|Dutch|Russian|Swedish|Turkish|Hindi|Welsh|Gaelic|Akkadian|Coptic|Naacal";

const REGION_NAMES =
  "PERU|AMERICA|ENGLAND|EGYPT|KENYA|AUSTRALIA|CHINA|INDIA|HONG\\s+KONG|SHANGHAI|NEW\\s+YORK|LONDON";

const REGION_BANNER = new RegExp(String.raw`\b(${REGION_NAMES})\b`, "gi");

/** Title-case a region banner: PERU → Peru, HONG KONG → Hong Kong. */
export function formatRegion(raw: string): string {
  return cleanSpaces(raw)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

// Bibliographic line after the title. Requires a date-ish end so prose like
// "French merchant," or "written in classical Greek," does not match.
// The language may carry a qualifier before the comma — "hieroglyphs", or a
// short phrase ("French commentary on Latin original by Gaspar du Nord,") — and
// an "Original"/"Classical" prefix. A date may be a decade ("1920s").
const TOME_LANG_HEAD = String.raw`\b(?:Original\s+)?(?:Classical\s+)?(${TOME_LANG})(?:\s+(?:hieroglyphs|script|language))?(?:\s+[^,•.]{1,60}?)?,`;
const TOME_META = new RegExp(
  String.raw`${TOME_LANG_HEAD}\s*(?:(?:(?:translated|written)\s+)?by\s+|author(?:\s*\/\s*translation|\s+and\s+translator)?[^,]*,\s*)?[^•]{0,200}?(?:(?:c\.\s*)?\d{3,4}s?(?:\s*[–-]\s*\d{3,4})?|(?:\d{1,2}(?:st|nd|rd|th)\s+)?century|Dynasty[^•]{0,60}?BCE|BCE|CE|date unknown)\)?\.`,
  "gi",
);

function parseTomeMetadata(meta: string): {
  language: string;
  author: string;
  date: string;
  physical: string;
} {
  const m = meta.match(
    new RegExp(
      String.raw`^${TOME_LANG_HEAD.slice(2)}\s*(?:(?:(?:translated|written)\s+)?by\s+|(author(?:\s*\/\s*translation|\s+and\s+translator)?[^,]*),\s*)?(.+?),\s*((?:c\.\s*)?\d{3,4}s?|(?:[^.]{0,40}?century)|(?:c\.\s*)?[^.]{0,80}?(?:Dynasty|BCE|CE|date unknown)[^)]{0,20}?)\)?\.(.*)$`,
      "i",
    ),
  );
  if (m) {
    let author = cleanSpaces(m[3]);
    let date = cleanSpaces(m[4]);
    // "Chinese, author unknown, c. 300 BCE, with commentaries …, date unknown."
    // — an "author unknown" clause followed directly by the date leaves the
    // date in the author slot and the later clause as the date.
    if (m[2] && /^(?:c\.\s*)?\d|BCE|century/i.test(author)) {
      date = author;
      author = cleanSpaces(m[2]).replace(/^author(?:\s+and\s+translator)?\s+/i, "");
    }
    // "c. Thirteenth Dynasty Egypt (1786-1633 BCE)." — the closing paren was
    // consumed as the sentence end; restore it.
    if ((date.match(/\(/g) ?? []).length > (date.match(/\)/g) ?? []).length)
      date += ")";
    return {
      language: cleanSpaces(m[1]),
      author,
      date,
      physical: cleanSpaces(m[5]),
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

function regionBefore(text: string, at: number): string {
  const head = text.slice(Math.max(0, at - 200), at);
  let last = "";
  REGION_BANNER.lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(REGION_BANNER.source, "gi");
  while ((m = re.exec(head))) last = m[1];
  return last ? formatRegion(last) : "";
}

/** Clean title run immediately before a bibliographic language line. */
function cleanTomeTitle(raw: string): string {
  let s = cleanSpaces(raw);
  s = s.replace(/^.*\bnone\s+/i, "");
  s = s.replace(/^.*\)\s+/, "");
  // Drop region banner — title follows it.
  s = s.replace(new RegExp(String.raw`^.*\b(?:${REGION_NAMES})\s+`, "i"), "");
  const period = s.lastIndexOf(". ");
  if (period >= 0) s = s.slice(period + 2);
  s = s.replace(/\s+Classical$/i, "");
  s = cleanSpaces(s);
  // Prefer a full Title Case run (handles "Life As A God"). A previous tome's
  // spell list can glue onto the title ("…, Wither Limb The Necronomicon"); a
  // capitalised "The" inside the run starts the real title.
  const tm = s.match(TITLE_AT_END);
  if (tm) {
    const run = cleanSpaces(tm[1]);
    const the = run.search(/\sThe\s/);
    return the >= 0 ? run.slice(the + 1) : run;
  }
  // Spell-list remnant then "The Necronomicon".
  const the = s.match(
    /\b((?:The)\s+[A-Z\u2019'][A-Za-z\u2019'/.-]+(?:\s+[A-Z\u2019'][A-Za-z\u2019'/.-]+)*)\s*$/,
  );
  if (the && the[1].split(/\s+/).length >= 2) return cleanSpaces(the[1]);
  const afterComma = s.match(/,\s*([^,]+)$/);
  if (afterComma) {
    const cand = cleanSpaces(afterComma[1]);
    const tm2 = cand.match(TITLE_AT_END);
    if (tm2) return cleanSpaces(tm2[1]);
  }
  return s.slice(-80);
}

function lastTomeMeta(text: string): RegExpExecArray | null {
  const re = new RegExp(TOME_META.source, "gi");
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) last = m;
  return last;
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
  region: string;
} {
  const text = cleanSpaces(before);
  // Prefer metadata that sits before the Link/Appearance bullet (real biblio line).
  const linkAt = Math.max(
    text.lastIndexOf("• Link:"),
    text.lastIndexOf("• Appearance in the campaign:"),
  );
  const head = linkAt >= 0 ? text.slice(0, linkAt) : text;
  const metaMatch = lastTomeMeta(head) ?? lastTomeMeta(text);
  if (!metaMatch || metaMatch.index === undefined) {
    return {
      name: "",
      language: "",
      author: "",
      date: "",
      physical: "",
      link: "",
      description: text,
      relevance: "",
      region: "",
    };
  }

  const name = cleanTomeTitle(text.slice(0, metaMatch.index));
  const region = regionBefore(text, metaMatch.index);
  let rest = text.slice(metaMatch.index);
  const metaEnd = rest.search(
    /\s+•\s*(?:Link|Appearance in the campaign):|\s+Relevance\s*:/i,
  );
  const meta = metaEnd >= 0 ? rest.slice(0, metaEnd) : metaMatch[0];
  rest = metaEnd >= 0 ? rest.slice(metaEnd) : text.slice(metaMatch.index + metaMatch[0].length);

  const { language, author, date, physical } = parseTomeMetadata(meta);

  let link = "";
  const linkM = rest.match(
    /•\s*(?:Link|Appearance in the campaign):\s*(.+?(?:page\s+\d+[^.]*\.?|Chapter\s+\d+:\s*[^•]+?))/i,
  );
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
    region,
  };
}

function extractLooseTomeTitle(before: string): string {
  let s = cleanSpaces(before);
  // Drop trailing Appearance lines so the title sits at the end.
  s = s.replace(/\s+•\s*Appearance in the campaign:.*$/i, "");
  const lastPeriod = s.lastIndexOf(". ");
  if (lastPeriod >= 0) s = s.slice(lastPeriod + 2).trim();
  // ALL-CAPS title (2HS).
  const caps = s.match(
    /\b((?:[A-Z][A-Z\u2019'/.-]+)(?:\s+(?:OF|THE|A|AN|TO|AND|FROM|FOR|WITH|IN|[A-Z][A-Z\u2019'/.-]+)|(?:\s*\([^)]+\)))*)\s*$/,
  );
  if (caps) return cleanSpaces(caps[1]);
  // Prefer "… of Yig" / "The Inmost Night" style over glued prior spell names
  // ("Flesh Ward Gospel of Yig" → "Gospel of Yig").
  const ofTitle = s.match(
    /\b((?:The\s+)?[A-Z][A-Za-z\u2019'/.-]+(?:\s+of\s+[A-Z][A-Za-z\u2019'/.-]+)+)\s*$/,
  );
  if (ofTitle) return cleanSpaces(ofTitle[1]);
  // Title Case run at end ("Tier Two Briefing Pack").
  const tc = s.match(
    /\b((?:[A-Z][A-Za-z\u2019'/.-]+)(?:\s+(?:of|the|a|an|from|and|to|for|in|as|[A-Z][A-Za-z\u2019'/.-]+)){1,6})\s*$/,
  );
  if (tc) return cleanSpaces(tc[1]).replace(/\bBrief\s+ing\b/g, "Briefing");
  return "";
}

function findNextTomeTitleIndex(
  section: string,
  from: number,
  statsIndex: number,
): number {
  const chunk = section.slice(from, statsIndex);
  const linkAt = Math.max(
    chunk.lastIndexOf("• Link:"),
    chunk.lastIndexOf("• Appearance in the campaign:"),
  );
  const head = linkAt >= 0 ? chunk.slice(0, linkAt) : chunk;
  const meta = lastTomeMeta(head) ?? lastTomeMeta(chunk);
  if (!meta || meta.index === undefined) {
    const loose = extractLooseTomeTitle(head);
    if (loose) {
      const local = head.lastIndexOf(loose);
      if (local >= 0) return from + local;
      // PDF may have split "Briefing" etc. — search last word of title.
      const words = loose.split(/\s+/);
      const last = words[words.length - 1];
      const li = head.lastIndexOf(last);
      if (li >= 0) return from + Math.max(0, li - (loose.length - last.length));
    }
    return statsIndex;
  }
  const before = chunk.slice(0, meta.index);
  const name = cleanTomeTitle(before) || extractLooseTomeTitle(before);
  if (name) {
    const local = before.lastIndexOf(name);
    if (local >= 0) {
      let start = from + local;
      // Pull in a chapter banner immediately before the title (PERU Title…).
      const pre = section.slice(Math.max(from, start - 24), start);
      const rm = pre.match(
        new RegExp(String.raw`\b(${REGION_NAMES})\s*$`, "i"),
      );
      if (rm) start -= rm[0].length;
      return start;
    }
  }
  return from + meta.index;
}

function parseTomeStatBlock(
  section: string,
  at: number,
): {
  sanityLoss: string;
  initial: number;
  final: number;
  mythosRating: number;
  studyN: number;
  studyUnit: string;
  spellsStart: number;
} | null {
  const window = section.slice(at, at + 500);
  const san = window.match(/•\s*Sanity Loss:\s*([^\•]+?)(?=\s+•)/i);
  if (!san) return null;
  let initial = 0;
  let final = 0;
  const mythosPair = window.match(
    /•\s*Cthulhu Mythos:\s*\+?(\d+)\s*\/\s*\+?(\d+)\s*percentiles?/i,
  );
  if (mythosPair) {
    initial = Number(mythosPair[1]);
    final = Number(mythosPair[2]);
  } else {
    const init = window.match(
      /•\s*Cthulhu Mythos\s*\(Initial Reading\):\s*\+?(\d+)\s*%?/i,
    );
    const full = window.match(
      /•\s*Cthulhu Mythos\s*\(Full Study\):\s*\+?(\d+)\s*%?/i,
    );
    const single = window.match(
      /•\s*Cthulhu Mythos:\s*\+?(\d+)\s*(?:percentiles?|%)?/i,
    );
    if (init) initial = Number(init[1]);
    if (full) final = Number(full[1]);
    else if (single) {
      initial = Number(single[1]);
      final = Number(single[1]);
    }
  }
  const rating = window.match(/•\s*Mythos Rating:\s*(\d+)/i);
  const study = window.match(
    /•\s*Study:\s*(\d+)\s*(weeks?|days?|months?|hours?)/i,
  );
  const spells = window.match(/•\s*Spells:\s*/i);
  if (!rating || !study || !spells || spells.index === undefined) return null;
  return {
    sanityLoss: cleanSpaces(san[1]),
    initial,
    final,
    mythosRating: Number(rating[1]),
    studyN: Number(study[1]),
    studyUnit: parseStudyUnits(study[2]),
    spellsStart: at + spells.index + spells[0].length,
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

  const sanRe = /•\s*Sanity Loss:/gi;
  let sm: RegExpExecArray | null;
  while ((sm = sanRe.exec(section))) {
    const parsed = parseTomeStatBlock(section, sm.index);
    if (!parsed) continue;
    anchors.push({ index: sm.index, ...parsed });
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const entryStart =
      i === 0
        ? 0
        : findNextTomeTitleIndex(section, anchors[i - 1].spellsStart, a.index);
    const before = section.slice(entryStart, a.index);
    const spellsEnd =
      i + 1 < anchors.length
        ? findNextTomeTitleIndex(section, a.spellsStart, anchors[i + 1].index)
        : section.length;
    const spells = cleanSpaces(section.slice(a.spellsStart, spellsEnd));
    const parsed = splitTomePreamble(before);
    let name = parsed.name;
    if (!name) {
      name = extractLooseTomeTitle(before);
    }
    if (!name || name.length < 2) continue;
    if (/\.$/.test(name)) continue;
    if (name.split(/\s+/).length > 12) continue;
    // Reject clear prose leftovers only (keep long real titles).
    if (
      /\b(?:devoted|likely|members of the|was written|can be found|Oklahoma|apparently at random)\b/i.test(
        name,
      )
    ) {
      continue;
    }
    // Section banners / junk.
    if (/^(?:NEW|TOMES|SPELLS|ARTIFACTS|TECHNOLOGY)\b/i.test(name)) continue;

    tomes.push({
      name,
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
      region: parsed.region,
    });
  }
  return tomes;
}

// --- artefacts -------------------------------------------------------------

const REGION_HEADERS = new RegExp(
  String.raw`^(?:${REGION_NAMES})$`,
  "i",
);

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
      /•\s*(?:Link|Appearance in the campaign):/,
    ),
  );
  if (!section) return [];
  const artBanners = [
    ...section.matchAll(/\b(?:ART[EI]FACTS|DEEP ONE ARTIFACTS|NEW ARTIFACTS)\b/gi),
  ];
  if (artBanners.length > 0) {
    const last = artBanners[artBanners.length - 1];
    const after = section.slice(last.index! + last[0].length);
    const markers = (
      after.match(/•\s*(?:Link|Appearance in the campaign):/g) || []
    ).length;
    if (markers >= 2 || /Idols from|Jewelry from|Mapulos/i.test(after)) {
      section = after;
    }
  }
  section = cleanSpaces(section);

  // Masks / 2HS: region banners + Title + Link/Appearance.
  const tokenRe = new RegExp(
    String.raw`\b(${REGION_NAMES})\b|((?:[A-Z][A-Za-z\u2019'/,.-]+(?:\s+(?:of|the|a|an|to|and|from|for|with|in|[A-Z][A-Za-z\u2019'/,.-]+))+|[A-Z][A-Za-z\u2019'/,.-]+(?:\s*,\s*THE)?))\s+(•\s*(?:Link|Appearance in the campaign):)`,
    "g",
  );

  type Start = {
    name: string;
    index: number;
    linkAt: number;
    region: string;
  };
  const starts: Start[] = [];
  let currentRegion = "";
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(section))) {
    if (tm[1]) {
      currentRegion = formatRegion(tm[1]);
      continue;
    }
    const name = cleanSpaces(tm[2]);
    if (!isPlausibleArtefactName(name)) continue;
    // Strip a glued region prefix ("Egypt. Crown…" from extraction bleed).
    const cleaned = name
      .replace(new RegExp(String.raw`^(?:${REGION_NAMES})\.?\s+`, "i"), "")
      .trim();
    if (!isPlausibleArtefactName(cleaned)) continue;
    starts.push({
      name: cleaned,
      index: tm.index,
      linkAt: tm.index + tm[2].length,
      region: currentRegion,
    });
  }

  // Innsmouth: named headings without Link/Appearance bullets. Always merge —
  // don't skip when a Masks-style Link match already filled `starts`.
  {
    const namedRe =
      /\b(Idols from R[’']lyeh|Jewelry from the Deep|Mapulos\s*&\s*Shoggoth-Twsha|Trident or Spear of the Deep)\b/gi;
    let nm: RegExpExecArray | null;
    const seen = new Set(starts.map((s) => s.name.toLowerCase()));
    while ((nm = namedRe.exec(section))) {
      const name = cleanSpaces(nm[1]);
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      starts.push({
        name,
        index: nm.index,
        linkAt: nm.index + nm[0].length,
        region: "",
      });
    }
    starts.sort((a, b) => a.index - b.index);
  }

  const artefacts: AppendixArtefact[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : section.length;
    const chunk = section.slice(s.linkAt, end);
    let link = "";
    let body = chunk;
    const lm = chunk.match(
      /•\s*Link:\s*(.+?(?:page\s+\d+[^.]*\.?))/i,
    );
    const am = chunk.match(
      /•\s*Appearance in the campaign:\s*(Chapter\s+\d+:\s*[A-Z][A-Za-z\-]+|\S[^•]{0,80}?)(?=\s+[A-Z][a-z]|\s*$)/i,
    );
    if (lm) {
      link = cleanSpaces(lm[1]);
      body = cleanSpaces(chunk.slice(lm.index! + lm[0].length));
    } else if (am) {
      link = cleanSpaces(am[1]);
      body = cleanSpaces(chunk.slice(am.index! + am[0].length));
    } else {
      const lm2 = chunk.match(
        /•\s*(?:Link|Appearance in the campaign):\s*(.+?)(?=\s+[A-Z])/,
      );
      if (lm2) {
        link = cleanSpaces(lm2[1]);
        body = cleanSpaces(chunk.slice(lm2.index! + lm2[0].length));
      }
    }
    body = body.replace(/\bTABLE:[\s\S]*$/i, "").trim();
    body = body.replace(/\bPULP:[\s\S]*$/i, "").trim();
    // Drop a following region banner that leaked into body.
    body = body.replace(new RegExp(String.raw`\s+(?:${REGION_NAMES})\s*$`, "i"), "");
    const { description, keeper } = splitArtefactBlurb(body);
    if (!keeper || keeper.length < 20) continue;
    artefacts.push({
      name: s.name,
      link,
      description,
      keeper: link
        ? cleanSpaces(`Link: ${link} ${keeper}`)
        : keeper,
      isWeapon: isArtefactWeapon(keeper),
      region: s.region,
    });
  }
  return artefacts;
}

function isPlausibleArtefactName(name: string): boolean {
  if (!name || name.length < 3) return false;
  if (REGION_HEADERS.test(name)) return false;
  if (name.split(/\s+/).length > 10) return false;
  if (/\.$/.test(name)) return false;
  // 2HS prints artefact titles in ALL CAPS ("COBRA CROWN, THE") — allow those.
  if (/^Meeting\b/i.test(name)) return false;
  if (
    /\b(?:Road|Street|Club|Navy|Expedition)\b/i.test(name) &&
    !/\b(?:Mirror|Ward|Mask|Crown|Ring|Scepter|Viper|Whip|Venom)/i.test(name)
  ) {
    return false;
  }
  if (
    /^(?:Imperial|Carlyle|Seamen|Lantern|Cat-Demon|Elder Sign|New|MR\.|Prospero|Smith)\b/i.test(
      name,
    )
  ) {
    return false;
  }
  if (/^(?:Mirrors|Artifacts|Artefacts|NEW ARTIFACTS|TECHNOLOGY)$/i.test(name)) {
    return false;
  }
  if (/^TECHNOLOGY\b/i.test(name)) return false;
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
