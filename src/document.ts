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
import type {
  AppendixSpell,
  AppendixTome,
  AppendixArtefact,
} from "./appendix.ts";

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

function paragraphs(parts: string[]): string {
  return parts
    .filter((p) => p && p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("");
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

// Hybrid spell: castingTime + legacy costs; body in description; empty costList.
function spellDoc(s: AppendixSpell, source: string): any {
  return {
    name: s.name,
    type: "spell",
    system: {
      description: {
        value: paragraphs([s.description]),
        keeper: "",
        alternativeNames: "",
      },
      castingTime: s.castingTime,
      costs: {
        hitPoints: s.costs.hitPoints,
        magicPoints: s.costs.magicPoints,
        others: s.costs.others,
        sanity: s.costs.sanity,
        power: s.costs.power,
      },
      costList: [],
      source,
      type: {
        bind: false,
        call: false,
        combat: false,
        contact: false,
        dismiss: false,
        enchantment: false,
        gate: false,
        summon: false,
      },
    },
  };
}

function bookDoc(t: AppendixTome, source: string): any {
  const biblio = [t.language, t.author && `by ${t.author}`, t.date]
    .filter(Boolean)
    .join(", ");
  const valueParts = [
    [biblio, t.physical].filter(Boolean).join(". ").replace(/\.\./g, "."),
    t.description,
  ];
  const keeperParts = [
    t.link && `Link: ${t.link}`,
    t.relevance && `Relevance: ${t.relevance}`,
    t.spells && `Spells: ${t.spells}`,
  ].filter(Boolean) as string[];
  const mythos =
    t.mythosRating > 0 ||
    t.cthulhuMythos.initial > 0 ||
    t.cthulhuMythos.final > 0;
  return {
    name: t.name,
    type: "book",
    system: {
      author: t.author,
      content: "",
      date: t.date,
      description: {
        value: paragraphs(valueParts),
        keeper: paragraphs(keeperParts),
      },
      difficultyLevel: "regular",
      gains: {
        cthulhuMythos: {
          initial: t.cthulhuMythos.initial,
          final: t.cthulhuMythos.final,
        },
        occult: 0,
        others: [],
      },
      language: t.language,
      mythosRating: t.mythosRating,
      sanityLoss: t.sanityLoss.toLowerCase(),
      study: {
        necessary: t.study.necessary,
        units: t.study.units,
      },
      type: { mythos, occult: false, other: !mythos },
      itemDocuments: [],
      itemKeys: [],
    },
  };
}

function artefactDoc(a: AppendixArtefact, _source: string): any {
  if (a.isWeapon) {
    return {
      name: a.name,
      type: "weapon",
      system: {
        description: {
          value: paragraphs([a.description]),
          special: "",
          keeper: paragraphs([a.keeper]),
        },
        skill: {
          main: { name: "", id: "" },
          alternativ: { name: "", id: "" },
        },
        range: {
          normal: { value: "0", damage: "" },
          long: { value: "0", damage: "" },
          extreme: { value: "0", damage: "" },
        },
        usesPerRound: { normal: "1", max: "", burst: null },
        bullets: null,
        ammo: 0,
        malfunction: null,
        blastRadius: null,
        properties: {
          rngd: false,
          mnvr: false,
          thrown: false,
          shotgun: false,
          dbrl: false,
          impl: false,
          brst: false,
          auto: false,
          ahdb: false,
          addb: false,
          slnt: false,
          spcl: true,
          mont: false,
          blst: false,
          stun: false,
          rare: false,
          burn: false,
        },
        price: {},
      },
    };
  }
  return {
    name: a.name,
    type: "item",
    system: {
      description: {
        value: paragraphs([a.description]),
        keeper: paragraphs([a.keeper]),
      },
      quantity: 1,
      weight: 0,
      price: {},
    },
  };
}

// Build the Foundry item document for a parsed world item.
export function pulpItemDoc(item: PulpItem, source: string): any {
  switch (item.kind) {
    case "talent":
      return talentDoc(item, source);
    case "archetype":
      return archetypeDoc(item, source);
    case "spell":
      return spellDoc(item, source);
    case "tome":
      return bookDoc(item, source);
    case "artefact":
      return artefactDoc(item, source);
  }
}

// --- world creation --------------------------------------------------------

// The subfolder each item kind is filed under, within the document's Item folder.
const ITEM_TYPE_FOLDERS: Record<string, string> = {
  talent: "Talents",
  archetype: "Archetypes",
  spell: "Spells",
  tome: "Tomes",
  artefact: "Artefacts",
};

// The icon each item kind gets at creation time (not part of the parsed source
// data). A kind with no entry keeps Foundry's default icon for that item type.
const ITEM_TYPE_ICONS: Record<string, string> = {
  talent: "systems/CoC7/assets/icons/skills.svg",
  archetype: "systems/CoC7/assets/icons/skills.svg",
  spell: "systems/CoC7/assets/icons/pentagram-rose.svg",
  tome: "systems/CoC7/assets/icons/secret-book.svg",
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

// Build and create world item documents under a "<folderName>" Item folder, one
// subfolder per item kind ("Talents", "Spells", ...). Idempotent per subfolder:
// a re-import replaces same-named items rather than duplicating.
export async function createPulpItems(
  items: PulpItem[],
  options: CreatePulpItemsOptions = {},
): Promise<CreatePulpItemsResult> {
  const result: CreatePulpItemsResult = { created: 0, items: [] };
  if (items.length === 0) return result;

  const source = options.source ?? options.folderName ?? "PDF Import";
  const parent = await ensureItemFolder(
    options.folderName ?? "PDF Import",
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
    ui.notifications.info(`Imported ${result.created} items.`);
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
