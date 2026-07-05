import type { CocCharacter, CombatEntry } from "./process.ts";

// Foundry globals (game, ui, Actor, Folder) are declared in ./foundry.d.ts.

type EntityType = "npc" | "creature";

export interface ImportOptions {
  /** Force the actor type, or 'auto' to guess from the stat block. */
  entity?: EntityType | "auto";
  /** Name of the Actor folder to place imported characters in. */
  folderName?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface ImportResult {
  created: number;
  failed: number;
  actors: any[];
}

/**
 * Create Foundry CoC7 actors from parsed characters.
 */
export async function importCharacters(
  characters: CocCharacter[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const folder = await ensureActorFolder(options.folderName ?? "PDF Import");
  // The folder is named after the imported file, so a re-import should refresh
  // its contents: drop actors already in it that share a name with an incoming
  // one, rather than piling up duplicates.
  await removeReplacedActors(folder, characters);
  const result: ImportResult = { created: 0, failed: 0, actors: [] };

  for (const character of characters) {
    try {
      const actor = await importCharacter(
        character,
        folder,
        options.entity ?? "auto",
      );
      result.actors.push(actor);
      result.created++;
    } catch (err) {
      result.failed++;
      console.error(
        `coc-pdf-importer: failed to import "${character.name}"`,
        err,
      );
    }
  }
  let msg: string;
  if (!result.failed) {
    msg = game.i18n.format("coc-pdf-importer.ResultSuccess", {
      created: result.created,
    });
  } else {
    msg = game.i18n.format("coc-pdf-importer.ResultWithErrors", {
      created: result.created,
      failed: result.failed,
    });
  }
  if (options.notify !== false) ui.notifications.info(msg);
  return result;
}

async function importCharacter(
  character: CocCharacter,
  folder: any,
  entity: EntityType | "auto",
): Promise<any> {
  const type = entity === "auto" ? guessEntityType(character) : entity;

  const actor = await Actor.create({
    name: character.name || "Unknown",
    type,
    folder: folder?.id ?? null,
    system: buildActorSystem(character),
  });

  const items = buildItems(character);
  if (items.length) {
    await actor.createEmbeddedDocuments("Item", items, { renderSheet: false });
  }

  await applyDerivedOverrides(actor, character);
  return actor;
}

// ---------------------------------------------------------------------------
// Entity type / actor system data
// ---------------------------------------------------------------------------

// A Sanity loss line is the mark of a Mythos creature; everyone else is an NPC.
function guessEntityType(character: CocCharacter): EntityType {
  return character.sanityLoss ? "creature" : "npc";
}

function buildActorSystem(character: CocCharacter): Record<string, unknown> {
  const system: any = {
    characteristics: {},
    attribs: {},
    infos: {},
    special: {},
    description: { keeper: notesToHtml(character) },
  };

  // STR/CON/SIZ/DEX/INT/APP/POW/EDU are characteristics; SAN/HP are attribs.
  const charMap: Record<string, string> = {
    STR: "str",
    CON: "con",
    SIZ: "siz",
    DEX: "dex",
    INT: "int",
    APP: "app",
    POW: "pow",
    EDU: "edu",
  };
  for (const [src, dst] of Object.entries(charMap)) {
    const value =
      character.characteristics[src as keyof typeof character.characteristics]
        ?.value;
    if (value != null) system.characteristics[dst] = { value };
  }

  const san = character.characteristics.SAN?.value;
  const hp = character.characteristics.HP?.value;
  if (san != null) system.attribs.san = { value: san };
  if (hp != null) system.attribs.hp = { value: hp };
  if (character.derived.MP != null)
    system.attribs.mp = { value: character.derived.MP };
  if (character.derived.Move != null)
    system.attribs.mov = { value: character.derived.Move };
  if (character.derived.Build != null)
    system.attribs.build = { value: character.derived.Build };
  if (character.derived.Luck != null)
    system.attribs.lck = { value: character.derived.Luck };
  if (character.derived.DB != null)
    system.attribs.db = { value: normalizeDb(character.derived.DB) };

  if (character.age != null) system.infos.age = String(character.age);
  if (character.description) system.infos.occupation = character.description;

  const sanLoss = parseSanLoss(character.sanityLoss);
  if (sanLoss) system.special.sanLoss = sanLoss;
  const apr = parseAttacksPerRound(character.attacksPerRound);
  if (apr != null) system.special.attacksPerRound = apr;

  return system;
}

// After creation the system auto-derives HP/MP/MOV/build/DB from characteristics;
// where the imported value differs, turn off auto and set it explicitly.
async function applyDerivedOverrides(
  actor: any,
  character: CocCharacter,
): Promise<void> {
  const update: Record<string, unknown> = {};

  const override = (
    key: string,
    imported: number | null | undefined,
    computed: number,
    max = true,
  ) => {
    if (imported == null) return;
    const value = Math.max(0, Number(imported));
    if (Number.isNaN(value) || value === Number(computed)) return;
    update[`system.attribs.${key}.auto`] = false;
    update[`system.attribs.${key}.value`] = value;
    if (max) update[`system.attribs.${key}.max`] = value;
  };

  const attribs = actor.system?.attribs ?? {};
  override("hp", character.characteristics.HP?.value, attribs.hp?.max);
  override("mp", character.derived.MP, attribs.mp?.max);
  override("mov", character.derived.Move, attribs.mov?.value, false);
  override("build", character.derived.Build, attribs.build?.value, false);

  if (character.derived.DB != null) {
    const value = normalizeDb(character.derived.DB);
    if (value !== String(attribs.db?.value)) {
      update["system.attribs.db.auto"] = false;
      update["system.attribs.db.value"] = value;
    }
  }

  if (Object.keys(update).length) await actor.update(update);
}

// ---------------------------------------------------------------------------
// Items (skills, weapons + backing skills, languages, spells)
// ---------------------------------------------------------------------------

function buildItems(character: CocCharacter): any[] {
  const items: any[] = [];
  const skillNames = new Set<string>();

  const addSkill = (item: any) => {
    if (skillNames.has(item.name)) return;
    skillNames.add(item.name);
    items.push(item);
  };

  // Skills.
  for (const [name, value] of Object.entries(character.skills)) {
    addSkill(skillItem(name, value));
  }

  // Languages -> "Language (X)".
  const langSpec = localize("CoC7.LanguageSpecializationName", "Language");
  for (const [name, value] of Object.entries(character.languages)) {
    addSkill(skillItem(specName(langSpec, name), value));
  }

  // Combat: Dodge is a skill; everything else is a weapon backed by a skill.
  for (const attack of character.combat) {
    if (/^dodge$/i.test(attack.name)) {
      addSkill(skillItem("Dodge", attack.value ?? 0));
      continue;
    }
    const { weapon, skill } = weaponFromAttack(attack);
    if (skill) addSkill(skill);
    items.push(weapon);
  }

  // Spells.
  for (const name of character.spells) {
    items.push({ type: "spell", name, system: {} });
  }

  return items;
}

const FIREARM_RE =
  /\b(revolver|pistol|rifle|shotgun|gun|firearm|automatic|carbine|derringer|colt|luger|mauser|musket|needle|bow|sling)\b|\.\d{2}\b/i;

function weaponFromAttack(attack: CombatEntry): {
  weapon: any;
  skill: any | null;
} {
  const ranged = FIREARM_RE.test(attack.name);
  const maneuver = /\bman(?:oeuv|euv)re?\b|\bmnvr\b/i.test(attack.name);
  const spec = localize(
    ranged
      ? "CoC7.FirearmSpecializationName"
      : "CoC7.FightingSpecializationName",
    ranged ? "Firearms" : "Fighting",
  );
  const skillFullName = specName(spec, attack.name);

  const skill =
    attack.value != null
      ? skillItem(skillFullName, attack.value, {
          special: true,
          fighting: !ranged,
          firearm: ranged,
          ranged,
        })
      : null;

  const weapon = {
    name: attack.name,
    type: "weapon",
    system: {
      skill: { main: { name: skill ? skillFullName : "", id: "" } },
      range: { normal: { value: "", damage: attack.damage ?? "" } },
      properties: { rngd: ranged, mnvr: maneuver },
      description: {
        value: attack.note ? `<p>${escapeHtml(attack.note)}</p>` : "",
      },
    },
  };

  return { weapon, skill };
}

// Build a CoC7 skill item. A name of the form "Spec (Name)" is split into its
// specialization + skillName; the percentage is stored as the base adjustment.
function skillItem(
  fullName: string,
  value: number,
  extraProps: Record<string, boolean> = {},
): any {
  const match = fullName.match(/^([^(]+)\s*\((.+)\)$/);
  const specialization = match ? match[1].trim() : "";
  const skillName = match ? match[2].trim() : fullName;
  const name = specialization ? `${specialization} (${skillName})` : skillName;
  const base = Math.max(0, Math.round(Number(value) || 0));

  return {
    type: "skill",
    name,
    system: {
      skillName,
      specialization,
      base: String(base),
      adjustments: { base },
      properties: { special: !!match, ...extraProps },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureActorFolder(name: string): Promise<any> {
  const existing = game.folders?.find(
    (f: any) => f.name === name && f.type === "Actor",
  );
  if (existing) return existing;
  try {
    return await Folder.create({ name, type: "Actor" });
  } catch {
    return null;
  }
}

// Delete actors already in `folder` whose name matches one we are about to
// import, so a re-import replaces them instead of duplicating. Pre-existing
// actors are collected and removed up front (before any create) so that two
// incoming characters sharing a name don't delete each other.
async function removeReplacedActors(
  folder: FoundryFolder | null,
  characters: CocCharacter[],
): Promise<void> {
  if (!folder?.id) return;
  const names = new Set(characters.map((c) => c.name || "Unknown"));
  const existing =
    game.actors?.filter(
      (a) => a.folder?.id === folder.id && names.has(a.name ?? ""),
    ) ?? [];
  for (const actor of existing) {
    try {
      await actor.delete();
    } catch (err) {
      console.error(
        `coc-pdf-importer: failed to replace existing actor "${actor.name}"`,
        err,
      );
    }
  }
}

function localize(key: string, fallback: string): string {
  const value = game.i18n.localize(key);
  return !value || value === key ? fallback : value;
}

function specName(specialization: string, skillName: string): string {
  return `${specialization} (${skillName})`;
}

// Damage bonus for the actor sheet: strip a leading "+" ("+1D4" -> "1D4").
function normalizeDb(db: string): string {
  return String(db)
    .replace(/^\+\s*/, "")
    .trim();
}

// "1/1D6 Sanity points to see ..." -> { checkPassed: '1', checkFailled: '1D6' }.
function parseSanLoss(
  sanityLoss: string | null,
): { checkPassed: string; checkFailled: string } | null {
  if (!sanityLoss) return null;
  const match = sanityLoss.match(/^\s*([0-9dD+\-*/]+)\s*\/\s*([0-9dD+\-*/]+)/);
  if (!match) return null;
  return { checkPassed: match[1], checkFailled: match[2] };
}

// "1" / "up to 4 (...)" -> leading integer, or null.
function parseAttacksPerRound(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function notesToHtml(character: CocCharacter): string {
  const parts: string[] = [];
  if (character.sanityLoss) parts.push(`Sanity loss: ${character.sanityLoss}`);
  for (const note of character.notes) parts.push(note);
  return parts
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
