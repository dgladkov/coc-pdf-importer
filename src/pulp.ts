// Ad-hoc importer for Pulp Cthulhu rulebook reference content — currently the
// pulp talents. This is deliberately separate from the actor/stat-block parser
// in process.ts: it reads the book's fixed reference *tables*, not per-NPC stat
// blocks, so it gets its own extraction and parsing rather than complicating the
// general path. See E:/export_trait.json for the target "talent" item schema.
import * as pdfjs from "pdfjs-dist";

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
        description: cleanDescription(m[3]),
      });
    }
  }
  return talents;
}

// The full plain text of a PDF: every page's runs joined with spaces and
// whitespace collapsed. Enough for the reference tables (which are single-column
// and read in order); the actor parser's font/height run-merging is unnecessary
// here.
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdf = await pdfjs.getDocument({ data }).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out +=
      " " + (content.items as { str?: string }[]).map((it) => it.str ?? "").join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

// The talent item's category flags: exactly one of the four player categories is
// set (the schema also defines basic/insane/other, left false for player talents).
const TALENT_TYPE_FLAGS = [
  "physical",
  "mental",
  "combat",
  "miscellaneous",
  "basic",
  "insane",
  "other",
] as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The book lists talent descriptions as lowercase sentence fragments (they follow
// "Name : " in the table); upper-case the first letter so each reads as a sentence.
function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// A CoC7 "talent" item document for one parsed talent (schema per
// E:/export_trait.json). No `img`: the icon isn't source data, so it's assigned
// at creation time (see createPulpItems). The description carries only the
// (escaped) source text, unwrapped — as the actor importer does, not the
// Foundry-export "<p>...</p>" convention.
export function pulpTalentItem(talent: PulpTalent, source: string): any {
  const type = Object.fromEntries(
    TALENT_TYPE_FLAGS.map((flag) => [flag, flag === talent.category]),
  );
  return {
    name: talent.name,
    type: "talent",
    system: {
      source,
      description: {
        value: escapeHtml(capitalizeFirst(talent.description)),
        notes: "",
        keeper: "",
      },
      type,
      adjustments: [],
    },
  };
}

// Parse and build all pulp talent item documents from a rulebook's text.
export function buildPulpTalents(text: string, source: string): any[] {
  return parsePulpTalents(text).map((t) => pulpTalentItem(t, source));
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

export interface PulpArchetype {
  name: string;
  description: string;
  coreCharacteristics: string[]; // lowercase keys, e.g. ["con"] or ["dex","app"]
  bonusPoints: number;
  talents: number;
  skills: string[]; // skill names as printed, e.g. "Fighting (Brawl)"
  suggestedOccupations: string;
  suggestedTraits: string;
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

// Kebab-case a skill name for its CoCID, mirroring CoC7Utilities.toKebabCase so
// "Fighting (Brawl)" -> "i.skill.fighting-brawl" matches what the system stores.
function toKebabCase(s: string): string {
  const m = (s ?? "").match(
    /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
  );
  return m ? m.join("-").toLowerCase() : "";
}

// Drop page-running headers/footers and illustration credits that PDF extraction
// interleaves into the archetype prose.
function stripArchetypeArtifacts(text: string): string {
  return text
    .replace(/\s*\d+\s+CREATING PULP HEROES\s*/g, " ")
    .replace(/s h o o t i n g d e e p o n e s\s+\d+\s+CHAPTER \d+\s*/g, " ")
    .replace(/\s*Archetypes s by Chris Lackey\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanArchetypeDescription(d: string): string {
  d = d
    .replace(/\bPULP ARCHETYPES\b/g, " ")
    .replace(ARCH_MARGIN_RUN, " ") // strip margin-index name runs
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
    const description = cleanArchetypeDescription(text.slice(nameEnd, adj[i]));
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
    const skills = archField(body, /following skills:\s*([^•]*)/)
      .replace(/\.\s*$/, "")
      .split(/,\s*/)
      .map((s) => s.replace(/^and\s+/i, "").trim())
      .filter(Boolean);
    const suggestedOccupations = archField(
      body,
      /Suggested occupations:\s*([^•]*)/,
    ).replace(/\.\s*$/, "");
    const talents =
      TALENT_WORD_NUM[
        archField(body, /Talents:\s*(?:any\s+)?(\w+)/).toLowerCase()
      ] ?? 2;
    const suggestedTraits = archField(
      body,
      /Suggested traits:\s*([^•]*)/,
    ).replace(/\.\s*$/, "");

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

// A CoC7 "archetype" item document (schema per E:/export_archetype.json). The
// bonus-point skills become CoCID itemKeys; the icon is assigned at creation.
export function pulpArchetypeItem(a: PulpArchetype, source: string): any {
  const coreCharacteristics = Object.fromEntries(
    CORE_CHARS.map((c) => [c, a.coreCharacteristics.includes(c)]),
  );
  return {
    name: a.name,
    type: "archetype",
    system: {
      description: { value: escapeHtml(a.description), keeper: "" },
      source,
      bonusPoints: a.bonusPoints,
      coreCharacteristics,
      coreCharacteristicsFormula: { enabled: true, value: "(1D6+13)*5" },
      suggestedOccupations: escapeHtml(a.suggestedOccupations),
      suggestedTraits: escapeHtml(a.suggestedTraits),
      talents: a.talents,
      itemDocuments: [],
      itemKeys: a.skills.map((s) => "i.skill." + toKebabCase(s)),
    },
  };
}

export function buildPulpArchetypes(text: string, source: string): any[] {
  return parsePulpArchetypes(text).map((a) => pulpArchetypeItem(a, source));
}

// Build every pulp item document a rulebook's text yields. Each builder is
// guarded by its own specific section header/structure, so a document with none
// of them produces no items — that is how the importer decides a document "has
// items" without false positives.
export function buildPulpItems(text: string, source: string): any[] {
  return [
    ...buildPulpTalents(text, source),
    ...buildPulpArchetypes(text, source),
  ];
}

// The subfolder each item type is filed under, within the document's Item folder.
const ITEM_TYPE_FOLDERS: Record<string, string> = {
  talent: "Talents",
  archetype: "Archetypes",
};

// The icon each item type gets at creation time (not part of the parsed source
// data). A type with no entry keeps Foundry's default icon for that item type.
const ITEM_TYPE_ICONS: Record<string, string> = {
  talent: "systems/CoC7/assets/icons/skills.svg",
};

export interface CreatePulpItemsOptions {
  /** Name of the parent Item folder — typically the source document's name. */
  folderName?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface CreatePulpItemsResult {
  created: number;
  items: any[];
}

// Create pulp item documents in the world under a "<folderName>" Item folder,
// one subfolder per item type ("Talents", "Archetypes", ...). Idempotent per
// subfolder: a re-import replaces same-named items in that subfolder rather than
// duplicating. (Actors are created separately, at the top level of their own
// Actor folder — see importDocument.)
export async function createPulpItems(
  items: any[],
  options: CreatePulpItemsOptions = {},
): Promise<CreatePulpItemsResult> {
  const result: CreatePulpItemsResult = { created: 0, items: [] };
  if (items.length === 0) return result;

  const parent = await ensureItemFolder(
    options.folderName ?? "Pulp Cthulhu",
    null,
  );

  // Group by item type so each type lands in its own subfolder.
  const byType = new Map<string, any[]>();
  for (const item of items) {
    const list = byType.get(item.type) ?? [];
    list.push(item);
    byType.set(item.type, list);
  }

  for (const [type, group] of byType) {
    const folder = await ensureItemFolder(
      ITEM_TYPE_FOLDERS[type] ?? type,
      parent?.id ?? null,
    );
    const img = ITEM_TYPE_ICONS[type];
    await removeReplacedItems(folder, group);
    for (const data of group) {
      try {
        const item = await Item.create({
          ...data,
          ...(img ? { img } : {}),
          folder: folder?.id ?? null,
        });
        result.items.push(item);
        result.created++;
      } catch (err) {
        console.error(
          `coc-pdf-importer: failed to create ${type} "${data.name}"`,
          err,
        );
      }
    }
  }
  if (options.notify !== false) {
    ui.notifications.info(`Imported ${result.created} pulp items.`);
  }
  return result;
}

// Find (by name and parent) or create an Item folder.
async function ensureItemFolder(
  name: string,
  parentId: string | null,
): Promise<FoundryFolder | null> {
  const existing = game.folders?.find(
    (f: any) =>
      f.name === name &&
      f.type === "Item" &&
      (f.folder?.id ?? f.folder ?? null) === parentId,
  );
  if (existing) return existing;
  try {
    return await Folder.create({ name, type: "Item", folder: parentId });
  } catch {
    return null;
  }
}

// Delete items already in `folder` whose name matches one about to be imported,
// so a re-import refreshes them instead of piling up duplicates.
async function removeReplacedItems(
  folder: FoundryFolder | null,
  items: any[],
): Promise<void> {
  if (!folder?.id) return;
  const names = new Set(items.map((i) => i.name));
  const existing =
    game.items?.filter(
      (i) =>
        ((i.folder as any)?.id ?? i.folder ?? null) === folder.id &&
        names.has(i.name ?? ""),
    ) ?? [];
  for (const item of existing) {
    try {
      await item.delete();
    } catch (err) {
      console.error(
        `coc-pdf-importer: failed to replace existing item "${item.name}"`,
        err,
      );
    }
  }
}
