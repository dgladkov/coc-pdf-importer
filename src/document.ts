// The Foundry world-import layer. process.ts turns a PDF into { actors, items }
// without touching Foundry, where items are internal PulpItem structures. This
// module maps those to Foundry item documents — resolving skill names to CoCIDs
// and shaping the system data — and creates them (actors go via importer.ts).
// importDocument ties the two together so callers (the UI, the dump tool) deal
// with a single call.
import { processPDF } from "./process.ts";
import { importCharacters } from "./importer.ts";
import type { ImportResult } from "./importer.ts";
import type { PulpItem, PulpTalent, PulpArchetype } from "./pulp.ts";

// --- Foundry item documents from parsed items ------------------------------

// The talent item's category flags (basic/insane/other exist in the schema but
// are left false for player talents).
const TALENT_TYPE_FLAGS = [
  "physical", "mental", "combat", "miscellaneous", "basic", "insane", "other",
] as const;
const CORE_CHARS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu"];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Resolve a skill name to its CoCID, mirroring CoC7Utilities.toKebabCase so
// "Fighting (Brawl)" -> "i.skill.fighting-brawl" matches what the system stores.
function skillCocid(name: string): string {
  const m = (name ?? "").match(
    /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
  );
  return "i.skill." + (m ? m.join("-").toLowerCase() : "");
}

// A CoC7 "talent" item document (schema per E:/export_trait.json). No `img`: the
// icon isn't source data, so it's assigned at creation. The description carries
// only the (escaped) source text, unwrapped — as the actor importer does.
function talentDoc(t: PulpTalent, source: string): any {
  const type = Object.fromEntries(
    TALENT_TYPE_FLAGS.map((flag) => [flag, flag === t.category]),
  );
  return {
    name: t.name,
    type: "talent",
    system: {
      source,
      description: { value: escapeHtml(t.description), notes: "", keeper: "" },
      type,
      adjustments: [],
    },
  };
}

// A CoC7 "archetype" item document (schema per E:/export_archetype.json). The
// bonus-point skill names are resolved to CoCID itemKeys here, at import.
function archetypeDoc(a: PulpArchetype, source: string): any {
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
      suggestedOccupations: escapeHtml(a.suggestedOccupations.join(", ")),
      suggestedTraits: escapeHtml(a.suggestedTraits.join(", ")),
      talents: a.talents,
      itemDocuments: [],
      itemKeys: a.skills.map(skillCocid),
    },
  };
}

// Build the Foundry item document for a parsed pulp item.
export function pulpItemDoc(item: PulpItem, source: string): any {
  return item.kind === "talent"
    ? talentDoc(item, source)
    : archetypeDoc(item, source);
}

// --- world creation --------------------------------------------------------

// The subfolder each item kind is filed under, within the document's Item folder.
const ITEM_TYPE_FOLDERS: Record<string, string> = {
  talent: "Talents",
  archetype: "Archetypes",
};

// The icon each item kind gets at creation time (not part of the parsed source
// data). A kind with no entry keeps Foundry's default icon for that item type.
const ITEM_TYPE_ICONS: Record<string, string> = {
  talent: "systems/CoC7/assets/icons/skills.svg",
  archetype: "systems/CoC7/assets/icons/skills.svg",
};

export interface CreatePulpItemsOptions {
  /** Name of the parent Item folder — typically the source document's name. */
  folderName?: string;
  /** The `system.source` stamped on each item. */
  source?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface CreatePulpItemsResult {
  created: number;
  items: any[];
}

// Build and create pulp item documents in the world under a "<folderName>" Item
// folder, one subfolder per item kind ("Talents", "Archetypes", ...). Idempotent
// per subfolder: a re-import replaces same-named items rather than duplicating.
// (Actors are created separately, at the top level of their own Actor folder —
// see importDocument.)
export async function createPulpItems(
  items: PulpItem[],
  options: CreatePulpItemsOptions = {},
): Promise<CreatePulpItemsResult> {
  const result: CreatePulpItemsResult = { created: 0, items: [] };
  if (items.length === 0) return result;

  const source = options.source ?? "Pulp Cthulhu";
  const parent = await ensureItemFolder(
    options.folderName ?? "Pulp Cthulhu",
    null,
  );

  // Group by kind so each kind lands in its own subfolder.
  const byKind = new Map<string, PulpItem[]>();
  for (const item of items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }

  for (const [kind, group] of byKind) {
    const folder = await ensureItemFolder(
      ITEM_TYPE_FOLDERS[kind] ?? kind,
      parent?.id ?? null,
    );
    const img = ITEM_TYPE_ICONS[kind];
    const docs = group.map((item) => pulpItemDoc(item, source));
    await removeReplacedItems(folder, docs);
    for (const doc of docs) {
      try {
        const created = await Item.create({
          ...doc,
          ...(img ? { img } : {}),
          folder: folder?.id ?? null,
        });
        result.items.push(created);
        result.created++;
      } catch (err) {
        console.error(
          `coc-pdf-importer: failed to create ${kind} "${doc.name}"`,
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

// --- orchestration ---------------------------------------------------------

export interface ImportDocumentOptions {
  /** Folder name for both the Actor folder and the parent Item folder. */
  folderName?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface ImportDocumentResult {
  actors: ImportResult;
  items: CreatePulpItemsResult;
}

// Import a document's actors and items in one call. Actors are created at the top
// level of a "<folderName>" Actor folder (unchanged, for compatibility); items go
// into typed subfolders of a same-named Item folder (see createPulpItems).
export async function importDocument(
  data: Uint8Array,
  options: ImportDocumentOptions = {},
): Promise<ImportDocumentResult> {
  const { actors, items } = await processPDF(data);
  const folderName = options.folderName ?? "PDF Import";
  const actorResult = await importCharacters(actors, {
    folderName,
    notify: false,
  });
  const itemResult = await createPulpItems(items, {
    folderName,
    notify: false,
  });
  if (options.notify !== false) {
    ui.notifications.info(
      `Imported ${actorResult.created} actors and ${itemResult.created} items.`,
    );
  }
  return { actors: actorResult, items: itemResult };
}
