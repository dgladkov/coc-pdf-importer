import type {
  BackgroundSection,
  CocCharacter,
  CombatEntry,
} from "./process.ts";

// Foundry globals (game, ui, Actor, Folder) are declared in ./foundry.d.ts.

// "character" is a full Investigator; "npc" a plain NPC; "creature" a Mythos
// monster. Pre-gen investigators (with a background block) import as "character".
type EntityType = "npc" | "creature" | "character";

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

  // Look up the system's skill/weapon/spell compendia once for the whole batch,
  // so imported items adopt the real compendium item (CoCID, icon, properties,
  // damage) where one exists.
  const indexes = await loadIndexes();

  for (const character of characters) {
    try {
      const actor = await importCharacter(
        character,
        folder,
        options.entity ?? "auto",
        indexes,
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
  indexes: CompendiumIndexes,
): Promise<any> {
  const type = entity === "auto" ? guessEntityType(character) : entity;

  const actor = await Actor.create({
    name: character.name || "Unknown",
    type,
    folder: folder?.id ?? null,
    system: buildActorSystem(character, type),
  });

  const items = buildItems(character, indexes);
  if (items.length) {
    await actor.createEmbeddedDocuments("Item", items, { renderSheet: false });
  }

  await applyDerivedOverrides(actor, character);
  return actor;
}

// ---------------------------------------------------------------------------
// Entity type / actor system data
// ---------------------------------------------------------------------------

// The background sections that bind a playable investigator to the world. A
// pre-gen player character fills these in; scenario NPCs and Pulp villains built
// on the same human stat block get at most a description + traits blurb.
const TIE_SECTIONS = new Set([
  "Significant People",
  "Meaningful Locations",
  "Treasured Possession",
]);

// A real pre-gen investigator fills in at least one "ties to the world" section
// AND is a fully realized playable character — it records an age and/or carries
// a carried-gear list (from a bare "Possessions"/"Equipment" section; every
// pregen in the sample has one, no NPC/villain does). The ties requirement
// rejects scenario NPCs and villains built on a human stat block (a description +
// traits blurb, or a stray equipment line, is not enough).
function isInvestigator(character: CocCharacter): boolean {
  const hasTies = character.background.some((s) => TIE_SECTIONS.has(s.title));
  return hasTies && (character.age != null || character.items.length > 0);
}

// An investigator becomes a "character"; a Sanity loss line marks a Mythos
// creature; everyone else is an NPC.
function guessEntityType(character: CocCharacter): EntityType {
  if (isInvestigator(character)) return "character";
  return character.sanityLoss ? "creature" : "npc";
}

function buildActorSystem(
  character: CocCharacter,
  type: EntityType,
): Record<string, unknown> {
  const system: any = {
    characteristics: {},
    attribs: {},
    infos: {},
    description: { keeper: notesToHtml(character, type) },
  };
  // "special" (sanLoss / attacksPerRound) exists on npc/creature only, not on the
  // Investigator "character" type.
  if (type !== "character") system.special = {};

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

  if (system.special) {
    const sanLoss = parseSanLoss(character.sanityLoss);
    if (sanLoss) system.special.sanLoss = sanLoss;
    const apr = parseAttacksPerRound(character.attacksPerRound);
    if (apr != null) system.special.attacksPerRound = apr;
  }

  const armor = armorAttrib(character.armor);
  if (armor) system.attribs.armor = armor;

  // Investigator background -> the character sheet's backstory (a single HTML
  // block) and biography (per-section {title, value} rows the sheet renders).
  if (type === "character" && character.background.length) {
    system.backstory = backstoryHtml(character.background);
    system.biography = character.background.map((s) => ({
      title: s.title,
      value: `<p>${escapeHtml(s.text)}</p>`,
    }));
  }

  return system;
}

// Combine the background sections into the single HTML block stored in
// system.backstory, matching the layout the CoC7 Dhole House importer produces.
function backstoryHtml(sections: BackgroundSection[]): string {
  const block = sections
    .map(
      (s) =>
        `<h3>${escapeHtml(s.title)}</h3>\n<div>\n${escapeHtml(s.text)}\n</div>`,
    )
    .join("\n");
  return `<h2>Backstory</h2>\n${block}`;
}

// Map a parsed armor descriptor to the CoC7 armor attrib: the leading "N-point"
// number becomes the armor value (0 for "none"/prose), and the full text is kept
// as the armor notes. `auto: false` stops the sheet re-deriving it from items.
function armorAttrib(
  armor: string | null,
): { value: number; auto: boolean; notes: string } | null {
  if (!armor) return null;
  const points = /(\d+)\s*-?\s*point/i.exec(armor);
  return { value: points ? Number(points[1]) : 0, auto: false, notes: armor };
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

// A lowercase name -or- CoCID -> compendium item (plain data) lookup.
type ItemIndex = Map<string, any>;
interface CompendiumIndexes {
  skill: ItemIndex;
  weapon: ItemIndex;
  spell: ItemIndex;
}

// Fetch the system's skill/weapon/spell compendia once (world + packs, best per
// era/language) and index each by lowercase name and CoCID. Degrades gracefully
// to empty indexes when the CoC7 API is absent (unit tests, non-CoC7 world), in
// which case items are built from the parsed data alone.
async function loadIndexes(): Promise<CompendiumIndexes> {
  const [skill, weapon, spell] = await Promise.all([
    loadSkillIndex(),
    loadCocidIndex(/^i\.weapon\./),
    loadCocidIndex(/^i\.spell\./),
  ]);
  return { skill, weapon, spell };
}

// Skills come from the system's dedicated (cached) skill list.
async function loadSkillIndex(): Promise<ItemIndex> {
  const index: ItemIndex = new Map();
  try {
    const list = await game.CoC7?.skillNames?.getList?.();
    if (list) indexDocuments(index, Object.values(list));
  } catch (err) {
    console.warn("coc-pdf-importer: skill compendium lookup unavailable", err);
  }
  return index;
}

// Weapons/spells come from a CoCID-regex query over world + packs.
async function loadCocidIndex(cocidRegExp: RegExp): Promise<ItemIndex> {
  const index: ItemIndex = new Map();
  try {
    const docs = await game.CoC7?.cocid?.fromCoCIDRegexBest?.({
      cocidRegExp,
      type: "i",
    });
    if (docs) indexDocuments(index, docs);
  } catch (err) {
    console.warn("coc-pdf-importer: compendium lookup unavailable", err);
  }
  return index;
}

function indexDocuments(index: ItemIndex, docs: any[]): void {
  for (const doc of docs) {
    const data = doc?.toObject ? doc.toObject() : doc;
    if (!data) continue;
    if (data.name) index.set(String(data.name).toLowerCase(), data);
    const cocid = data.flags?.CoC7?.cocidFlag?.id;
    if (cocid) index.set(String(cocid).toLowerCase(), data);
  }
}

// Find a compendium item by full name or CoCID. A specialized skill with no exact
// entry falls back to its generic "(Any)" template ("Science (Biology)" ->
// "Science (Any)"); weapons reference their backing skill by CoCID.
function findCompendiumItem(ref: string, index: ItemIndex): any | null {
  const direct = index.get(ref.toLowerCase());
  if (direct) return direct;
  const m = ref.match(/^([^(]+)\(.+\)\s*$/);
  if (m) {
    const any = index.get(`${m[1].trim()} (Any)`.toLowerCase());
    if (any) return any;
  }
  return null;
}

// Kebab-case a name for a CoCID (matches CoC7Utilities.toKebabCase).
function toKebabCase(s: string): string {
  const m = (s ?? "").match(
    /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
  );
  return m ? m.join("-").toLowerCase() : "";
}

// Stamp the CoCID flag ("i.skill.spot-hidden") the system uses to recognise an
// item, derived from its final name.
function setCocid(data: any, type: string): void {
  const id = `i.${type}.${toKebabCase(data.name ?? "")}`;
  data.flags = data.flags ?? {};
  data.flags.CoC7 = data.flags.CoC7 ?? {};
  data.flags.CoC7.cocidFlag = { ...(data.flags.CoC7.cocidFlag ?? {}), id };
}

function buildItems(character: CocCharacter, indexes: CompendiumIndexes): any[] {
  const items: any[] = [];
  const skillNames = new Set<string>();

  const addSkill = (item: any) => {
    if (skillNames.has(item.name)) return;
    skillNames.add(item.name);
    items.push(item);
  };

  // Skills (languages are included, already named "Language (X)").
  for (const [name, value] of Object.entries(character.skills)) {
    addSkill(skillItem(name, value, {}, indexes.skill));
  }

  // Combat: Dodge is a skill; everything else is a weapon backed by a skill.
  for (const attack of character.combat) {
    if (/^dodge$/i.test(attack.name)) {
      addSkill(skillItem("Dodge", attack.value ?? 0, {}, indexes.skill));
      continue;
    }
    const { weapon, skills } = weaponFromAttack(attack, indexes);
    for (const skill of skills) addSkill(skill);
    items.push(weapon);
  }

  // Spells.
  for (const name of character.spells) {
    items.push(spellItem(name, indexes.spell));
  }

  // Carried gear (a pre-gen's "Possessions"/"Equipment" list) -> generic item
  // documents; the CoC7 "item" type defaults quantity to 1.
  for (const name of character.items) {
    items.push({ type: "item", name, system: {} });
  }

  return items;
}

const FIREARM_RE =
  /\b(revolver|pistol|rifle|shotgun|gun|firearm|automatic|carbine|derringer|colt|luger|mauser|musket|needle|bow|sling)\b|\.\d{2}\b/i;

function weaponFromAttack(
  attack: CombatEntry,
  indexes: CompendiumIndexes,
): { weapon: any; skills: any[] } {
  // Prefer the real compendium weapon: it carries the correct damage, range,
  // malfunction, and backing-skill reference. Add the skill(s) it references
  // (by CoCID), setting the main one's base to the attack's skill %.
  const found = findCompendiumItem(attack.name, indexes.weapon);
  if (found) {
    const weapon = structuredClone(found);
    delete weapon._id;
    const skills: any[] = [];
    const refs = [
      { ref: weapon.system?.skill?.main?.name, value: attack.value ?? 0 },
      { ref: weapon.system?.skill?.alternativ?.name, value: 0 },
    ];
    for (const { ref, value } of refs) {
      const skill = ref ? skillFromRef(ref, value, indexes.skill) : null;
      if (skill) skills.push(skill);
    }
    return { weapon, skills };
  }

  // Fallback: build the weapon and its backing skill from the parsed attack.
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
      ? skillItem(
          skillFullName,
          attack.value,
          {
            special: true,
            fighting: !ranged,
            firearm: ranged,
            ranged,
          },
          indexes.skill,
        )
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

  return { weapon, skills: skill ? [skill] : [] };
}

// Clone a compendium skill referenced by a weapon (by CoCID or name), setting its
// base to `value`. Returns null when the skill is not in the compendium (the
// weapon still references it by name and the sheet resolves it).
function skillFromRef(
  ref: string,
  value: number,
  skillIndex: ItemIndex,
): any | null {
  const found = findCompendiumItem(ref, skillIndex);
  if (!found) return null;
  const base = Math.max(0, Math.round(Number(value) || 0));
  const data = structuredClone(found);
  delete data._id;
  data.system = data.system ?? {};
  data.system.base = String(base);
  data.system.adjustments = { ...(data.system.adjustments ?? {}), base };
  if (data.system.properties) {
    data.system.properties.requiresname = false;
    data.system.properties.picknameonly = false;
  }
  setCocid(data, "skill");
  return data;
}

// A spell item: the compendium spell (with its description/era config) when one
// matches, otherwise a bare spell. Always stamped with its CoCID.
function spellItem(name: string, spellIndex: ItemIndex): any {
  const found = findCompendiumItem(name, spellIndex);
  let data: any;
  if (found) {
    data = structuredClone(found);
    delete data._id;
    data.name = name;
  } else {
    data = { type: "spell", name, system: {} };
  }
  setCocid(data, "spell");
  return data;
}

// Build a CoC7 skill item. A name of the form "Spec (Name)" is split into its
// specialization + skillName; the percentage is stored as the base adjustment.
// When the skill (or its generic "(Any)" template) exists in the compendium, the
// real item is cloned so it keeps its CoCID, icon, and properties — only the base
// value (and, for a filled-in specialization, the name) is overridden.
function skillItem(
  fullName: string,
  value: number,
  extraProps: Record<string, boolean> = {},
  skillIndex?: ItemIndex,
): any {
  const match = fullName.match(/^([^(]+)\s*\((.+)\)$/);
  const specialization = match ? match[1].trim() : "";
  const skillName = match ? match[2].trim() : fullName;
  const name = specialization ? `${specialization} (${skillName})` : skillName;
  const base = Math.max(0, Math.round(Number(value) || 0));

  const found = skillIndex ? findCompendiumItem(name, skillIndex) : null;
  let data: any;
  if (found) {
    data = structuredClone(found);
    delete data._id;
    data.name = name;
    data.system = data.system ?? {};
    data.system.skillName = skillName;
    data.system.specialization = specialization;
    data.system.base = String(base);
    data.system.adjustments = { ...(data.system.adjustments ?? {}), base };
    // A cloned "(Any)" template must not re-prompt for a specialization name.
    if (data.system.properties) {
      data.system.properties.requiresname = false;
      data.system.properties.picknameonly = false;
      for (const [k, v] of Object.entries(extraProps))
        data.system.properties[k] = v;
    }
  } else {
    data = {
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
  setCocid(data, "skill");
  return data;
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

function notesToHtml(character: CocCharacter, type: EntityType): string {
  const parts: string[] = [];
  if (character.sanityLoss) parts.push(`Sanity loss: ${character.sanityLoss}`);
  for (const note of character.notes) parts.push(note);
  let html = parts
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  // A non-investigator (NPC/creature) has no backstory/biography on its sheet,
  // so its background sections would otherwise be dropped. Keep them in the
  // Keeper notes instead. (Investigators get them as backstory/biography.)
  if (type !== "character" && character.background.length) {
    html += backstoryHtml(character.background);
  }
  return html;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
