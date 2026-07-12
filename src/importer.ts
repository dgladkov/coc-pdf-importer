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

  const { base, customWeapons } = buildItems(character, indexes);
  if (base.length) {
    await actor.createEmbeddedDocuments("Item", base, { renderSheet: false });
  }
  // Weapons not found in a compendium need a backing skill created and linked by
  // id (the system can't resolve them, which pops a "select weapon skill" modal).
  // Done after the base items so their skills — including ones the compendium
  // weapons created — can be reused.
  await attachCustomWeapons(actor, customWeapons, indexes);

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

// ---------------------------------------------------------------------------
// Weapon matching: stat blocks abbreviate weapon names ("​.38 revolver",
// "12-g shotgun", "Knife"); map those to the canonical compendium item. Each
// candidate lists the core (preferred) name first and a wiki (fallback) name
// second, so matchWeapon resolves against whichever pack is installed, falling
// back to a custom weapon when neither has it.
// ---------------------------------------------------------------------------

const KNIFE_BY_SIZE: Record<string, string[]> = {
  Small: ["Knife, Small (switchblade, etc.)", "Knife, Small"],
  Medium: ["Knife, Medium (carving knife, etc.)", "Knife, Medium"],
  Large: ["Knife, Large (machete, etc.)", "Knife, Large"],
};
const CLUB_BY_SIZE: Record<string, string[]> = {
  Small: ["Club, small (nightstick)", "Club, Small"],
  Large: ["Club, large (baseball, cricket bat, poker)", "Club, Large"],
};

// Knives and clubs come in sizes the stat block only distinguishes by damage:
// small club 1D6 / large club 1D8; small knife 1D4, medium 1D4+2, large 1D8.
// The weapon's own damage is the *leading* term — a trailing damage bonus
// ("+DB", or a die like "+1D6") is ignored by anchoring the checks at the start.
function meleeCandidates(attack: CombatEntry): string[] {
  const name = attack.name.toLowerCase();
  const dmg = (attack.damage ?? "").toLowerCase().replace(/\s+/g, "");
  if (/cosh|blackjack/.test(name))
    return ["Blackjack (Cosh, life-preserver)", "Blackjack"];
  if (/\bknife\b|\bdagger\b|switchblade|straight razor|\bmachete\b/.test(name)) {
    const size = /^1d8\b/.test(dmg)
      ? "Large"
      : /^1d4\+2\b/.test(dmg)
        ? "Medium"
        : /^1d4\b/.test(dmg)
          ? "Small"
          : "Medium";
    return KNIFE_BY_SIZE[size];
  }
  if (/\bclub\b|nightstick|truncheon|cudgel/.test(name)) {
    const size = /^1d8\b/.test(dmg)
      ? "Large"
      : /^1d6\b/.test(dmg)
        ? "Small"
        : /nightstick/.test(name)
          ? "Small"
          : "Large";
    return CLUB_BY_SIZE[size];
  }
  return [];
}

// Name-pattern aliases for firearms (and the Thompson). "handgun" rules do not
// apply to rifle names (".45 Martini-Henry Rifle" is not a .45 pistol).
const WEAPON_ALIASES: {
  re: RegExp;
  names: string[];
  handgun?: boolean;
}[] = [
  { re: /\bthompson\b/i, names: ["Thompson (50 mag)", "Thompson"] },
  // handgun automatics (before the caliber default)
  { re: /\.45\b.*\b(auto|automatic|pistol)\b/i, names: [".45 Automatic"], handgun: true },
  { re: /\.38\b.*\b(auto|automatic|pistol)\b/i, names: [".38 Automatic"], handgun: true },
  { re: /\.32\b.*\b(auto|automatic|pistol)\b/i, names: [".32 or 7.65mm Automatic"], handgun: true },
  { re: /\.22\b.*\b(auto|automatic)\b/i, names: [".22 Short Automatic"], handgun: true },
  // handgun revolvers / caliber defaults
  { re: /\.45\b.*revolver/i, names: [".45 Revolver"], handgun: true },
  { re: /\.45\b/i, names: [".45 Automatic"], handgun: true },
  { re: /\.38\b/i, names: [".38 or 9mm Revolver"], handgun: true },
  { re: /\.32\b/i, names: [".32 or 7.65mm Revolver"], handgun: true },
  { re: /\.357\b/i, names: [".357 Magnum Revolver"], handgun: true },
  { re: /\.44\b/i, names: [".44 Magnum Revolver"], handgun: true },
  { re: /\.41\b/i, names: [".41 Revolver"], handgun: true },
  { re: /\.25\b.*derringer/i, names: [".25 Derringer (1B)"], handgun: true },
  // rifles
  { re: /\.30-06\b/i, names: [".30-06 Bolt-Action Rifle"] },
  { re: /\.303\b/i, names: [".303 Lee-Enfield"] },
  // shotguns
  { re: /\b12[\s-]?(?:g|ga|gauge|gage)\b/i, names: ["12-gauge Shotgun (2B)"] },
  { re: /\b20[\s-]?(?:g|ga|gauge|gage)\b/i, names: ["20-gauge Shotgun (2B)"] },
];

const RIFLE_RE =
  /\b(rifle|carbine|enfield|springfield|garand|mauser|winchester|musket)\b|-action\b/i;

// Ordered candidate canonical names for an attack: exact name, damage-based melee
// size, then firearm aliases (core name before its wiki fallback within each).
function weaponCandidates(attack: CombatEntry): string[] {
  const out: string[] = [attack.name];
  out.push(...meleeCandidates(attack));
  const isRifle = RIFLE_RE.test(attack.name);
  for (const rule of WEAPON_ALIASES) {
    if (rule.handgun && isRifle) continue;
    if (rule.re.test(attack.name)) out.push(...rule.names);
  }
  return out;
}

// Resolve an attack to a compendium weapon: the first candidate present in the
// weapon index wins (core preferred, wiki fallback). Null -> a custom weapon.
function matchWeapon(attack: CombatEntry, weaponIndex: ItemIndex): any | null {
  for (const cand of weaponCandidates(attack)) {
    const hit = weaponIndex.get(cand.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

// A "custom" weapon is one with no compendium match; its backing skill is
// resolved and attached in a second pass (attachCustomWeapons).
interface CustomWeapon {
  weapon: any;
  value: number | null;
  ranged: boolean;
}

function buildItems(
  character: CocCharacter,
  indexes: CompendiumIndexes,
): { base: any[]; customWeapons: CustomWeapon[] } {
  const base: any[] = [];
  const customWeapons: CustomWeapon[] = [];
  const skillNames = new Set<string>();

  const addSkill = (item: any) => {
    if (skillNames.has(item.name)) return;
    skillNames.add(item.name);
    base.push(item);
  };

  // Skills, with languages handled specially (own vs other; see languageItem).
  const langEntries: [string, number][] = [];
  for (const [name, value] of Object.entries(character.skills)) {
    if (isLanguageSkill(name)) langEntries.push([name, value]);
    else addSkill(skillItem(name, value, {}, indexes.skill));
  }
  // A language whose value equals EDU is the character's own (native) language;
  // its base is pinned to EDU ("@EDU"). Any other value — a foreign language, or
  // an own language with extra points invested (an English professor above EDU) —
  // is imported as an "other" language with its concrete value. That is both
  // simpler and more correct: pinning to EDU would drop those extra points, or
  // inflate a below-EDU value.
  const edu = character.characteristics.EDU?.value ?? null;
  for (const [name, value] of langEntries) {
    addSkill(languageItem(name, value, edu != null && value === edu, indexes.skill));
  }

  // Combat: Dodge is a skill; a compendium weapon carries its own skill ref (add
  // its backing skill here); anything else is a custom weapon resolved later.
  for (const attack of character.combat) {
    if (/^dodge$/i.test(attack.name)) {
      addSkill(skillItem("Dodge", attack.value ?? 0, {}, indexes.skill));
      continue;
    }
    const found = matchWeapon(attack, indexes.weapon);
    if (found) {
      const weapon = structuredClone(found);
      delete weapon._id;
      // Keep the stat block's own name (so the keeper can cross-check against the
      // book) while taking the compendium weapon's stats, icon, and CoCID.
      weapon.name = attack.name;
      const ranged = !!weapon.system?.properties?.rngd;
      const refs = [
        { ref: weapon.system?.skill?.main?.name, value: attack.value ?? 0 },
        { ref: weapon.system?.skill?.alternativ?.name, value: 0 },
      ];
      for (const { ref, value } of refs) {
        const skill = ref ? weaponSkillItem(ref, value, ranged, indexes.skill) : null;
        if (skill) addSkill(skill);
      }
      base.push(weapon);
    } else {
      const ranged = FIREARM_RE.test(attack.name);
      customWeapons.push({
        weapon: customWeaponData(attack, ranged, character.derived.DB),
        value: attack.value,
        ranged,
      });
    }
  }

  // Spells.
  for (const name of character.spells) {
    base.push(spellItem(name, indexes.spell));
  }

  // Carried gear (a pre-gen's "Possessions"/"Equipment" list) -> generic item
  // documents; the CoC7 "item" type defaults quantity to 1.
  for (const name of character.items) {
    base.push({ type: "item", name, system: {} });
  }

  return { base, customWeapons };
}

const FIREARM_RE =
  /\b(revolver|pistol|rifle|shotgun|gun|firearm|automatic|carbine|derringer|colt|luger|mauser|musket|needle|bow|sling)\b|\.\d{2}\b/i;

// Half of a damage bonus, matching CoC7Utilities.halfDB: halve each die's sides
// ("+1D6" -> "+1D3", "+2D6" -> "+2D3") and each flat term. Thrown weapons add it.
function halfDamageBonus(db: string): string {
  let f = db.replace(/\s+/g, "");
  if (!/^[+-]/.test(f)) f = "+" + f;
  return f.replace(/([+-])(\d+)(?:[dD](\d+))?/g, (_m, sign, n, sides) => {
    if (sides === undefined) {
      const v = sign === "-" ? Math.ceil(Number(n) / 2) : Math.floor(Number(n) / 2);
      return sign + v;
    }
    const half = sign === "-" ? Math.ceil(Number(sides) / 2) : Math.floor(Number(sides) / 2);
    return sign + n + "D" + half;
  });
}

// Normalise a weapon damage that inlines this actor's damage bonus. A stat block
// often writes the exact value ("1D4+1D6") instead of "+DB"; when the damage ends
// with the actor's DB, strip that trailing term and flag `addb` so the sheet adds
// the bonus itself — matching how the compendium (and the system's own importers)
// store it. A thrown weapon adds *half* the DB, so a trailing half-DB sets `ahdb`
// instead. Otherwise the damage is left untouched.
function normalizeWeaponDamage(
  damage: string | null,
  db: string | null,
): { damage: string; addb: boolean; ahdb: boolean } {
  const d = (damage ?? "").replace(/\s+/g, "");
  const none = { damage: damage ?? "", addb: false, ahdb: false };
  if (!d) return { damage: "", addb: false, ahdb: false };
  if (/\+DB$/i.test(d))
    return { damage: d.replace(/\+DB$/i, ""), addb: true, ahdb: false };
  const raw = (db ?? "").trim();
  if (!raw || raw === "0" || raw === "+0") return none;
  const full = (/^[+-]/.test(raw) ? raw : "+" + raw).replace(/\s+/g, "");
  const half = halfDamageBonus(full);
  const D = d.toUpperCase();
  if (D.endsWith(full.toUpperCase()))
    return { damage: d.slice(0, d.length - full.length), addb: true, ahdb: false };
  if (half.toUpperCase() !== full.toUpperCase() && D.endsWith(half.toUpperCase()))
    return { damage: d.slice(0, d.length - half.length), addb: false, ahdb: true };
  return none;
}

// Weapon document for a custom (non-compendium) attack. Its backing skill is
// filled in later by attachCustomWeapons (skill.main starts empty).
function customWeaponData(
  attack: CombatEntry,
  ranged: boolean,
  db: string | null,
): any {
  const maneuver = /\bman(?:oeuv|euv)re?\b|\bmnvr\b/i.test(attack.name);
  const { damage, addb, ahdb } = normalizeWeaponDamage(attack.damage, db);
  return {
    name: attack.name,
    type: "weapon",
    system: {
      skill: { main: { name: "", id: "" } },
      range: { normal: { value: "", damage } },
      properties: { rngd: ranged, mnvr: maneuver, addb, ahdb },
      description: {
        value: attack.note ? `<p>${escapeHtml(attack.note)}</p>` : "",
      },
    },
  };
}

// Resolve and attach a backing skill to each custom weapon, then create them.
// Algorithm (per the system's own weapon-skill behaviour):
//   1. Reuse an already-present Fighting/Firearms skill whose value matches the
//      weapon's — most likely the same underlying skill (e.g. a second handgun).
//   2. Otherwise create a "Fighting (weapon)" / "Firearms (weapon)" skill (from
//      the "(Any)" template) at the weapon's value, reusing it for later weapons.
//   3. Link the weapon to that skill by id, so the sheet doesn't prompt.
async function attachCustomWeapons(
  actor: any,
  customWeapons: CustomWeapon[],
  indexes: CompendiumIndexes,
): Promise<void> {
  if (!customWeapons.length) return;

  const specFor = (ranged: boolean) =>
    localize(
      ranged
        ? "CoC7.FirearmSpecializationName"
        : "CoC7.FightingSpecializationName",
      ranged ? "Firearms" : "Fighting",
    );
  const specOf = (s: any) => s?.system?.specialization ?? "";
  const baseOf = (s: any) =>
    Number(s?.system?.adjustments?.base ?? s?.system?.base);

  // Skills already on the actor after the base pass (includes any the compendium
  // weapons created), plus new skills we create in this pass.
  const existing = Array.from(actor.items ?? []).filter(
    (i: any) => i.type === "skill",
  );
  const newSkills: any[] = [];
  const resolved: { weapon: any; skill: any | null }[] = [];

  for (const { weapon, value, ranged } of customWeapons) {
    if (value == null) {
      resolved.push({ weapon, skill: null });
      continue;
    }
    const spec = specFor(ranged);
    const v = Math.max(0, Math.round(value));
    let skill =
      existing.find((s: any) => specOf(s) === spec && baseOf(s) === v) ??
      newSkills.find((s: any) => specOf(s) === spec && baseOf(s) === v);
    if (!skill) {
      skill = skillItem(
        specName(spec, weapon.name),
        v,
        { special: true, fighting: !ranged, firearm: ranged, ranged },
        indexes.skill,
      );
      newSkills.push(skill);
    }
    resolved.push({ weapon, skill });
  }

  const createdSkills = newSkills.length
    ? ((await actor.createEmbeddedDocuments("Item", newSkills, {
        renderSheet: false,
      })) ?? [])
    : [];
  const createdByName = new Map(
    createdSkills.map((d: any) => [d.name, d]),
  );

  const weapons = resolved.map(({ weapon, skill }) => {
    if (skill) {
      const doc = skill.id ?? skill._id ? skill : createdByName.get(skill.name);
      if (doc)
        weapon.system.skill.main = {
          id: doc.id ?? doc._id ?? "",
          name: doc.name,
        };
    }
    return weapon;
  });
  await actor.createEmbeddedDocuments("Item", weapons, { renderSheet: false });
}

// Resolve the backing skill a compendium weapon references. A CoCID reference is
// cloned from the exact skill it names. A plain skill *name* is cloned if it
// exists, otherwise built as a concrete named skill from the "(Any)" template —
// so a weapon whose skill ("Firearms (Lightning Gun)") doesn't exist in the world
// still gets that exact skill attached, instead of the system folding it into
// "(Any)" and prompting for a specialization.
function weaponSkillItem(
  ref: string,
  value: number,
  ranged: boolean,
  skillIndex: ItemIndex,
): any | null {
  if (/^i\.skill\./i.test(ref)) return skillFromRef(ref, value, skillIndex);
  return skillItem(
    ref,
    value,
    { special: true, fighting: !ranged, firearm: ranged, ranged },
    skillIndex,
  );
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

const LANGUAGE_ICON = "systems/CoC7/assets/icons/skills/language.svg";

// A language skill is our canonical "Language (X)" form (Own/Other/Any or a
// specific language).
function isLanguageSkill(name: string): boolean {
  return /^\s*language\s*\(/i.test(name);
}

// Build a language skill by cloning the own/other template — never the specific
// "Language (English)" item, which is ambiguous (it says nothing about whether
// the language is the character's own or another). The character's own (native)
// language clones "Language (Own)"; every other language clones "Language
// (Other)", falling back to "Language (Any)" when the module that provides
// "Other" is absent. The specific language name and value are then applied. With
// no compendium, a bare language skill carries the system icon.
function languageItem(
  name: string,
  value: number,
  isOwn: boolean,
  skillIndex: ItemIndex,
): any {
  const template =
    (isOwn ? skillIndex.get("language (own)") : undefined) ??
    skillIndex.get("language (other)") ??
    skillIndex.get("language (any)");

  let data: any;
  if (template) {
    data = structuredClone(template);
    delete data._id;
  } else {
    data = { type: "skill", img: LANGUAGE_ICON, system: { properties: {} } };
  }

  const m = name.match(/^([^(]+)\s*\((.+)\)$/);
  const specialization = m ? m[1].trim() : "Language";
  const skillName = m ? m[2].trim() : name;
  const base = Math.max(0, Math.round(Number(value) || 0));

  data.name = name;
  data.system = data.system ?? {};
  data.system.skillName = skillName;
  data.system.specialization = specialization;
  // The own (native) language tracks EDU via the CoC7 "@EDU" formula (as the
  // "Language (Own)" template does); every other language takes its parsed value.
  if (isOwn) {
    data.system.base = "@EDU";
  } else {
    data.system.base = String(base);
    data.system.adjustments = { ...(data.system.adjustments ?? {}), base };
  }
  data.system.properties = data.system.properties ?? {};
  data.system.properties.special = true;
  // We've named the specific language, so the sheet must not re-prompt for it.
  data.system.properties.requiresname = false;
  data.system.properties.picknameonly = false;
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
