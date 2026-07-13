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

// Build every pulp item document a rulebook's text yields (talents now;
// archetypes to follow). Each builder is guarded by its own specific section
// header, so a document with no pulp reference tables produces no items — that
// is how the importer decides a document "has items" without false positives.
export function buildPulpItems(text: string, source: string): any[] {
  return [...buildPulpTalents(text, source)];
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
