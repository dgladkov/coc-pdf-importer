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
import type {
  OldWestItem,
  OldWestOccupation,
  OldWestSkill,
  OldWestWeapon,
  OldWestSpell,
} from "./oldwest.ts";

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

// Hybrid spell: castingTime + legacy costs; body in description; empty
// costList. Shared by Chaosium-appendix spells (AppendixSpell) and Down Darker
// Trails' differently-sectioned but identically-shaped spells (OldWestSpell) —
// both files use only the fields read here.
function spellDoc(s: AppendixSpell | OldWestSpell, source: string): any {
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

// --- Down Darker Trails: occupations, altered/new skills, weapons ----------

const OCCUPATION_CHARS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu"];

// A CoC7 "occupation" item document. Every characteristic slot must be present
// (the sheet toggles them individually), so the parsed sparse map is expanded
// over the full set, unselected/unmarked by default.
function occupationDoc(o: OldWestOccupation, source: string): any {
  const occupationSkillPoints = Object.fromEntries(
    OCCUPATION_CHARS.map((c) => [
      c,
      o.occupationSkillPoints[c]
        ? { multiplier: o.occupationSkillPoints[c].multiplier, selected: true, optional: o.occupationSkillPoints[c].optional }
        : { multiplier: null, selected: false, optional: false },
    ]),
  );
  const description = o.special
    ? paragraphs([o.description, `Special: ${o.special}`])
    : paragraphs([o.description]);
  return {
    name: o.name,
    type: "occupation",
    system: {
      description: { value: description, keeper: "" },
      source,
      type: { classic: false, lovecraftian: false, modern: false, pulp: true },
      occupationSkillPoints,
      creditRating: { min: o.creditRating.min, max: o.creditRating.max },
      itemDocuments: [],
      itemKeys: o.skills.map(skillCocid),
      groups: o.groups.map((g) => ({
        options: g.options,
        itemDocuments: [],
        itemKeys: g.skills.map(skillCocid),
      })),
      personal: o.personal,
      personalText: o.personalText,
    },
  };
}

// A CoC7 "skill" item document for one of the book's altered/new skill
// write-ups (its plain, unchanged base-percentage list is not imported — that
// just restates skills already in the system's own compendium).
function oldWestSkillDoc(s: OldWestSkill): any {
  return {
    name: s.name,
    type: "skill",
    system: {
      skillName: s.name,
      specialization: "",
      description: { value: paragraphs([s.description]), keeper: "" },
      base: normalizeSkillBase(s.base),
      adjustments: { base: 0 },
      properties: {},
    },
  };
}

// "10%" -> "10"; "EDU%"/"EDU" -> "@EDU"; "half DEX" -> "@DEX/2"; anything else
// (a formula the sheet wouldn't recognise) falls back to "0".
function normalizeSkillBase(base: string): string {
  const pct = base.match(/^(\d+)%?$/);
  if (pct) return String(Number(pct[1]));
  if (/^EDU%?$/i.test(base)) return "@EDU";
  const half = base.match(/^half\s+([A-Z]{3})$/i);
  if (half) return `@${half[1].toUpperCase()}/2`;
  return "0";
}

// The book prints damage with a literal "+DB"/"+half DB" suffix rather than a
// number (it's the same for every wielder); split it into the CoC7 add-DB
// flags, matching how the system's own weapons store damage.
function splitWeaponDamage(raw: string): { damage: string; addb: boolean; ahdb: boolean } {
  if (/\+half\s+DB$/i.test(raw)) {
    return { damage: raw.replace(/\+half\s+DB$/i, ""), addb: false, ahdb: true };
  }
  if (/\+DB$/i.test(raw)) {
    return { damage: raw.replace(/\+DB$/i, ""), addb: true, ahdb: false };
  }
  return { damage: raw, addb: false, ahdb: false };
}

// "1 (3)" -> normal "1", max "3" (fires once without penalty, up to 3 with
// one); "Full Auto" / "1/4" pass through as-is (the system's own uses-per-round
// field is free text for those cases too).
function splitUsesPerRound(raw: string): { normal: string; max: string | null } {
  const m = raw.match(/^(\S+)\s*\((\d+)\)$/);
  return m ? { normal: m[1], max: m[2] } : { normal: raw, max: null };
}

// "Touch" -> 0 yards; a leading number ("30 yards", "80 (50)") is kept, its
// parenthetical alt-mode note dropped; anything else defaults to melee range.
function normalizeRangeValue(raw: string): string {
  if (/^touch\b/i.test(raw)) return "0";
  const m = raw.match(/^(\d+)/);
  return m ? m[1] : "0";
}

// A book-printed weapon (Revolvers/Rifles/.../Melee Weapons table) as a
// standalone reference "weapon" item — its skill is named but not linked to an
// actor's skill (the system falls back to displaying the name; see CoC7
// weapon-system.js #getChatDataSkill), same as a compendium weapon would be
// before an actor's own skill is resolved for it.
function weaponDoc(w: OldWestWeapon, source: string): any {
  const { damage, addb, ahdb } = splitWeaponDamage(
    w.damage.replace(/\s*\([^)]*\)\s*$/, ""),
  );
  const damageParts = damage.split("/");
  const { normal: usesNormal, max: usesMax } = splitUsesPerRound(w.usesPerRound);
  return {
    name: w.name,
    type: "weapon",
    system: {
      description: { value: "", special: "", keeper: "" },
      skill: {
        main: { name: w.skill, id: "" },
        alternativ: { name: "", id: "" },
      },
      range: {
        normal: { value: normalizeRangeValue(w.baseRange), damage: damageParts[0] ?? "" },
        long: { value: "0", damage: damageParts[1] ?? "" },
        extreme: { value: "0", damage: damageParts[2] ?? "" },
      },
      usesPerRound: { normal: usesNormal, max: usesMax, burst: null },
      bullets: w.bullets,
      ammo: w.bullets ?? 0,
      malfunction: w.malfunction,
      blastRadius: null,
      properties: {
        rngd: w.ranged,
        mnvr: false,
        thrown: w.thrown,
        shotgun: false,
        dbrl: false,
        impl: w.impale,
        brst: false,
        auto: w.auto,
        ahdb,
        addb,
        slnt: false,
        spcl: false,
        mont: false,
        blst: false,
        stun: false,
        rare: /^(?:R|VR)$/.test(w.availability),
        burn: /burn/i.test(w.damage),
      },
      price: { downDarkerTrails: w.cost },
    },
  };
}

// Build the Foundry item document for a parsed world item.
export function pulpItemDoc(item: PulpItem | OldWestItem, source: string): any {
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
    case "occupation":
      return occupationDoc(item, source);
    case "oldWestSkill":
      return oldWestSkillDoc(item);
    case "oldWestWeapon":
      return weaponDoc(item, source);
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
  occupation: "Occupations",
  oldWestSkill: "Skills",
  oldWestWeapon: "Weapons",
};

// The icon each item kind gets at creation time (not part of the parsed source
// data). A kind with no entry keeps Foundry's default icon for that item type.
const ITEM_TYPE_ICONS: Record<string, string> = {
  talent: "systems/CoC7/assets/icons/skills.svg",
  archetype: "systems/CoC7/assets/icons/skills.svg",
  spell: "systems/CoC7/assets/icons/pentagram-rose.svg",
  tome: "systems/CoC7/assets/icons/secret-book.svg",
  occupation: "systems/CoC7/assets/icons/skills.svg",
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
// subfolder per item kind ("Talents", "Spells", ...). Artefacts nest further
// under a region folder when the appendix printed one (Artefacts/Peru/...).
// Idempotent per leaf folder: a re-import replaces same-named items.
export async function createPulpItems(
  items: (PulpItem | OldWestItem)[],
  options: CreatePulpItemsOptions = {},
): Promise<CreatePulpItemsResult> {
  const result: CreatePulpItemsResult = { created: 0, items: [] };
  if (items.length === 0) return result;

  const source = options.source ?? options.folderName ?? "PDF Import";
  const parent = await ensureItemFolder(
    options.folderName ?? "PDF Import",
    null,
  );

  // Group by kind, then (for artefacts) by region, so each leaf folder is filled
  // in one pass and re-import replace stays scoped to that folder.
  type Leaf = { folderPath: string[]; group: (PulpItem | OldWestItem)[] };
  const leaves: Leaf[] = [];
  const byKind = new Map<string, (PulpItem | OldWestItem)[]>();
  for (const item of items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }

  for (const [kind, group] of byKind) {
    const typeFolder = ITEM_TYPE_FOLDERS[kind] ?? kind;
    if (kind === "artefact") {
      const byRegion = new Map<string, (PulpItem | OldWestItem)[]>();
      for (const item of group) {
        const region =
          item.kind === "artefact" && item.region ? item.region : "";
        const list = byRegion.get(region) ?? [];
        list.push(item);
        byRegion.set(region, list);
      }
      for (const [region, regionGroup] of byRegion) {
        leaves.push({
          folderPath: region ? [typeFolder, region] : [typeFolder],
          group: regionGroup,
        });
      }
    } else if (kind === "tome") {
      // Optional region nesting for tomes (same appendix banners).
      const byRegion = new Map<string, (PulpItem | OldWestItem)[]>();
      for (const item of group) {
        const region = item.kind === "tome" && item.region ? item.region : "";
        const list = byRegion.get(region) ?? [];
        list.push(item);
        byRegion.set(region, list);
      }
      for (const [region, regionGroup] of byRegion) {
        leaves.push({
          folderPath: region ? [typeFolder, region] : [typeFolder],
          group: regionGroup,
        });
      }
    } else {
      leaves.push({ folderPath: [typeFolder], group });
    }
  }

  for (const leaf of leaves) {
    let folder = parent;
    for (const name of leaf.folderPath) {
      folder = await ensureItemFolder(name, folder?.id ?? null);
    }
    const kind = leaf.group[0]?.kind ?? "";
    const img = ITEM_TYPE_ICONS[kind];
    const docs = leaf.group.map((item) => pulpItemDoc(item, source));
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
