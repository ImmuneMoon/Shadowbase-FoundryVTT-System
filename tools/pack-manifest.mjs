// tools/pack-manifest.mjs
//
// THE ONE DECLARATION of every compendium pack (docs/ARCHITECTURE.md §7).
// tools/build-packs.mjs writes packs-src/<pack>/ from it, system.json's
// packs[] / packFolders[] are generated from it, and scripts/check-packs.mjs
// reads it as the SUBJECT of every pin - nothing about a pack is decided in
// two places.
//
// Each pack: { name, label: { key, en }, type, itemType?, packFolder,
//   consumes: [bundle tables this pack is built from - 'ns.export' strings],
//   source(engine) -> rows, key(row) -> stable string, docName(row, engine),
//   folderPlan(row, engine) -> folder path (string[]), schema(engine) -> the
//   website zod schema the stored ROW must satisfy, project(row, ctx) -> the
//   document body (name/img/system for Items; a full actor datum for Actors) }.
//
// PROJECTIONS ARE THE WEBSITE'S OWN. Every row stored in a pack is built the
// way the website's library dialog builds it when a player clicks "Add" -
// the same fields, the same defaults, the same builder functions from the
// bundle (buildTemplateBlaster, buildTemplateMeleeWeapon, profileToArmorItem,
// armorItemFromPiece, makeBlueprintItem, buildAcquiredRow, ...). Where a
// dialog builds its row inline (the preconstructed lightsabers, the starship
// chassis, the implants/limbs/upgrades), the projection is a port of those
// lines, cited beside the code, and a REQUESTS.md row asks the website for an
// extraction so the port can be deleted. Rows a dialog mints an id for at
// "Add" time keep a DETERMINISTIC uuid here (tools/build-packs.mjs remaps
// every uuid from the pack:key seed) and module/compendium-drop.mjs re-mints
// on drop through itemTransfer.sanitiseForImport / parseImport, exactly as an
// imported item envelope is re-keyed on the website.
//
// Deterministic ids: _id = base62(sha256(`${pack}:${key}`)).slice(0, 16), so
// two builds of the same bundle produce byte-identical packs-src/ and a row
// that moves in its catalog keeps its id (a Foundry world that references
// `Compendium.shadowbase.advantages.Item.<id>` survives a rebuild).
//
// Milled weapon parts (Ch11 grips/receivers/barrels, Ch12 grips/heads/guards)
// are priced from a MATERIAL the buyer chooses on the website; a compendium
// row has no buyer, so these are built in Durasteel - Ch12's baseline stock
// (a Standard Hilt at 24.5 -> 25 -> 50 is the Durasteel figure the chapter
// prints), Ch13's "Durasteel yields exactly the Base DR shown", and the
// lightsaber hilt picker's own default (lightsaber-hilt-selection-dialog.tsx
// line 89). DEFAULT_MILL_MATERIAL_ID names it once.

import { createHash } from 'node:crypto';
import { engine as defaultEngine } from '../module/engine.mjs';
import { sheetToActorData } from '../module/adapter.mjs';
import { ITEM_TYPES, WEAPON_PART_FAMILIES } from '../module/config.mjs';

export const SYSTEM_ID = 'shadowbase';
export const SYSTEM_VERSION = '2.0.0';
/** CONST.SORT_INTEGER_DENSITY: the gap between consecutive `sort` values. */
export const SORT_DENSITY = 100000;
export const DEFAULT_MILL_MATERIAL_ID = 'durasteel';

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** base62 of a byte buffer (big-endian integer), no padding. */
export function base62(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  if (n === 0n) return '0';
  let out = '';
  while (n > 0n) { out = BASE62[Number(n % 62n)] + out; n /= 62n; }
  return out;
}

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest();

/** A Foundry document id (16 chars of [A-Za-z0-9]) for `${pack}:${key}`. */
export function documentId(pack, key) {
  const id = base62(sha256(`${pack}:${key}`)).slice(0, 16);
  if (!/^[A-Za-z0-9]{16}$/.test(id)) throw new Error(`pack-manifest: bad id ${id} for ${pack}:${key}`);
  return id;
}
export const folderId = (pack, path) => documentId(pack, `folder:${path.join('/')}`);
export const embeddedId = (pack, key, collection, index) => documentId(pack, `${key}:${collection}:${index}`);
export const pageId = (pack, chapterId, index) => documentId(pack, `${chapterId}:page:${index}`);

/** The LevelDB key prefix per primary document type (foundryvtt-cli TYPE_COLLECTION_MAP). */
export const KEY_PREFIX = Object.freeze({ Item: '!items!', Actor: '!actors!', JournalEntry: '!journal!', Folder: '!folders!' });
export const keyFor = (type, id) => `${KEY_PREFIX[type]}${id}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid-shaped string derived from a seed and an ordinal (RFC 4122 v4 layout, deterministic). */
export function seededUuid(seed, n) {
  const h = sha256(`${seed}:uuid:${n}`);
  const b = Uint8Array.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Replace every uuid in a value with a deterministic one, keeping cross
 * references in step (a part's installedInBlasterId still names its weapon).
 * The website's builders mint `crypto.randomUUID()` per call; without this a
 * rebuild would rewrite every packs-src file for no change in the bundle.
 */
export function remapUuids(value, seed, map = new Map()) {
  if (Array.isArray(value)) return value.map((v) => remapUuids(v, seed, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapUuids(v, seed, map);
    return out;
  }
  if (typeof value === 'string' && UUID_RE.test(value)) {
    if (!map.has(value)) map.set(value, seededUuid(seed, map.size + 1));
    return map.get(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Small helpers shared by the projections
// ---------------------------------------------------------------------------

const uuid = () => globalThis.crypto.randomUUID();
const clone = (v) => structuredClone(v);
const unwrap = (t) => (typeof t?.data === 'function' ? t.data() : (t?.data ?? t));
const byName = (arr, name) => arr.find((r) => r.name === name);
const group = (rows, keyOf) => {
  const m = new Map();
  for (const r of rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};

/** The Item document body every Item pack shares: name/type/img/system. */
function itemBody(type, row, { name, kit = null, levels = [], catalog, family = null, source }) {
  const cfg = ITEM_TYPES[type];
  if (!cfg) throw new Error(`pack-manifest: unknown Item type "${type}"`);
  return {
    name,
    type,
    img: cfg.img,
    system: { row, source: source ?? cfg.source, family, kit, levels, catalog },
  };
}

// ---------------------------------------------------------------------------
// Row projections (each cites the website code path it mirrors)
// ---------------------------------------------------------------------------

/** advantage-selection-dialog.tsx handleToggleAdvantage + advantages-section.tsx handleAddAdvantages (`baselinePoints: 0`). */
function advantageRow(lib) {
  const level1 = lib.levels?.[0];
  const row = {
    name: lib.name,
    points: level1 ? level1.points : (lib.points ?? 0),
    description: level1 ? level1.description : lib.description,
    category: lib.category,
    baselinePoints: 0,
  };
  // The dialog sets `level: undefined` for a flat trait; an undefined key is not stored.
  if (level1) row.level = level1.level;
  return row;
}

/** disadvantage-selection-dialog.tsx handleToggleDisadvantage (tier 1 seeds; flat keeps level null) + section append. */
function disadvantageRow(lib) {
  const tier1 = lib.levels?.[0];
  return {
    name: lib.name,
    points: tier1 ? tier1.points : (lib.points ?? 0),
    level: tier1 ? tier1.level : null,
    description: tier1 ? (tier1.description ?? lib.description) : lib.description,
    category: lib.category,
    baselinePoints: 0,
  };
}

/** quirk-selection-dialog.tsx handleToggleQuirk + quirks-section.tsx handleAddQuirks. */
const quirkRow = (q) => ({ name: q.name, points: q.pointCost, description: q.description, baselinePoints: 0 });

/**
 * skills-section.tsx handleAddSkills. `level` is seeded at the level that
 * CHARGES (Fulllion 2026-08-22) through baseChargedLevelForSkill(relativeLevel,
 * stats.skillPricingAttributes) - a figure of the OWNER's attributes, so the
 * compendium row carries the unpriced '' and module/compendium-drop.mjs seeds
 * it on drop through the same bundle export. `notes` is the player's own
 * field, deliberately not the catalog prose (the section says why).
 */
const skillRow = (s) => ({ name: s.name, level: '', points: null, relativeLevel: s.relativeLevel, notes: '', baselinePoints: 0 });

/** force-power-selection-dialog.tsx handleTogglePower (the Level 1 row) + force-powers-section.tsx append. */
const forcePowerRow = (p) => ({
  name: p.name, level: p.level, cpCost: p.cpCost, fpCost: p.fpCost, epCost: p.epCost, effect: p.effect,
  characterTier: p.characterTier, baseSkill: p.baseSkill, category: p.category, alignment: p.alignment, baselinePoints: 0,
});

/** combat-technique-selection-dialog.tsx (the Level 1 catalog row itself) + combat-techniques-section.tsx append. */
const techniqueRow = (t) => ({ ...clone(t), baselinePoints: 0 });

/** lightsaber-form-selection-dialog.tsx handleToggleForm + lightsaber-forms-section.tsx handleAddForms. */
const formRow = (f) => ({ name: f.name, level: 1, baselinePoints: 0 });

/** equipment-selection-dialog.tsx handleToggleItem (quantity 1; a Credit Chip is one row per chip). */
const equipmentRow = (item) => ({
  ...clone(item),
  id: uuid(),
  quantity: 1,
  weight: item.weight ?? 0,
  cost: item.cost ?? 0,
  condition: 'Fine',
  isInstalled: false,
  installedInDroidId: null,
  storageLocationId: null,
});

/** equipment-section.tsx handleAddBlueprints (a vendor's Generation 0 locked card). */
const blueprintRow = (design, engine) => engine.blueprints.makeBlueprintItem({
  of: design.name, origin: 'catalog', generation: 0, proven: true, locked: true, constructionMarkup: design.markup,
});

/**
 * armor-selection-dialog.tsx handleConfirm: profileToArmorItem(profile, 1,
 * hitLocations, wearerSM). A compendium item has no wearer, so anatomy [] and
 * SM 0; module/compendium-drop.mjs re-projects from ARMOR_DATA with the
 * actor's own anatomy and SM (the per-limb split needs both).
 */
const armorRow = (profile, engine) => engine.armorProfileItem.profileToArmorItem(profile, 1, [], 0)[0];

/** armor-piece-dialog.tsx handleConfirm: ensureCompleteArmorItem(armorItemFromPiece(piece, { itemSizeModifier }), hitLocations). */
const armorPieceRow = (piece, engine) => engine.ensureCompleteArmorItem(engine.armorPieceItem.armorItemFromPiece(piece, { itemSizeModifier: 0 }), []);

/** structural-part-selection-dialog.tsx handleConfirm -> part-acquisition.ts buildAcquiredRow (Ch13 parts carry their material). */
const armorPartRow = (part, engine) => engine.partAcquisition.buildAcquiredRow('armor', part.id, null, 1, uuid());

/** armor-modification-selection-dialog.tsx handleToggleItem (+ section: equipped false). */
const armorModRow = (mod) => ({
  id: uuid(), name: mod.name, category: mod.category, cost: mod.cost, weight: mod.weight ?? 0, notes: mod.gurpsEffect,
  equipped: false, quantity: 1, validSlots: mod.validSlots, drBonus: mod.drBonus,
});

/** Ch11 profile categories the blaster dialog files under "Explosive Launchers" (blaster-selection-dialog.tsx CATEGORY_MAP). */
const LAUNCHER_CATEGORIES = new Set(['Grenade Launchers', 'Missile Launchers']);

/**
 * blaster-selection-dialog.tsx handleConfirm: buildTemplateBlaster (parts,
 * mods, the bundled loaded pack) plus, for a launcher, the general-equipment
 * Power Cell the dialog pre-installs (lines 191-215). The kit carries that
 * cell under `equipment`; `ammunition` stays [] because the loaded pack is
 * embedded in the weapon's own loadedAmmunitionData ("NOT also an inventory
 * row", blaster-common.ts).
 */
function blasterKit(profile, engine) {
  const { blaster, parts } = engine.blasterCommon.buildTemplateBlaster({ profileName: profile.name, customName: profile.name, equipped: false });
  const equipment = [];
  if (LAUNCHER_CATEGORIES.has(profile.category)) {
    const cellTpl = byName(engine.equipmentData.equipmentData, 'Power Cell');
    if (!cellTpl) throw new Error('pack-manifest: the equipment catalog has no "Power Cell" row (launchers need one)');
    const cellId = uuid();
    equipment.push({ ...clone(cellTpl), id: cellId, isInstalled: true, installedInBlasterId: blaster.id, currentCharges: 100, maxCharges: 100, quantity: 1, condition: 'Fine' });
    blaster.loadedAmmunitionId = cellId;
    // `type` is required: loadedAmmunitionData is validated against the ammunition schema (the dialog's own note).
    blaster.loadedAmmunitionData = { ...clone(cellTpl), id: cellId, _isEquipSource: true, type: 'Power Cell' };
    blaster.currentCharges = 100;
    blaster.maxCharges = 100;
  }
  return { weapon: blaster, parts, ammunition: [], equipment };
}

/** melee-weapon-selection-dialog.tsx handleConfirm: buildTemplateMeleeWeapon per profile. */
function meleeKit(profile, engine) {
  const { weapon, parts } = engine.meleeCommon.buildTemplateMeleeWeapon({ profileName: profile.name, customName: profile.name });
  return { weapon, parts, ammunition: [], equipment: [] };
}

/**
 * PORT of lightsaber-selection-dialog.tsx handleConfirm lines 84-208 (the
 * website builds a preconstructed saber inline; buildTemplateLightsaber only
 * knows the two Ch12 hilt presets by catalog id, not a buildManifest with
 * couplers, second blades and wraps). REQUESTS.md asks for an extraction
 * (`buildPreconstructedLightsaber`) so this port can go; until then every
 * line mirrors the dialog and check:packs pins the kit's shape.
 */
function lightsaberKit(saber, engine) {
  const P = engine.lightsaberParts;
  const saberId = uuid();
  const parts = [];
  const saberParts = {};

  const provisionPart = (pieceKey, name, materialId, wrapId = null) => {
    const template = P.HILT_COMPONENT_TEMPLATES.find((t) => t.name === name);
    if (!template) return;
    const partId = uuid();
    // Cost and weight priced from the material (the dialog's note: a hilt part is a weapon modification and needs a numeric cost).
    const material = P.LIGHTSABER_MATERIALS.find((m) => m.id === materialId);
    const wrap = P.LIGHTSABER_WRAPS.find((w) => w.id === wrapId);
    let weight = template.volume * (material?.density ?? 490);
    let cost = weight * (material?.costPerLb ?? 25);
    if (wrap) {
      const wrapWeight = 0.0001 * wrap.density;
      weight += wrapWeight;
      cost += Math.max(1, wrapWeight * wrap.costPerLb);
    }
    parts.push({
      id: partId, name: template.name, category: template.category, cost: Math.round(cost), weight: parseFloat(weight.toFixed(3)),
      effect: template.effect, volume: template.volume, density: material?.density, materialId, wrapId,
      equipped: true, isInstalled: true, installedInSaberId: saberId, quantity: 1,
    });
    saberParts[pieceKey] = { inventoryId: partId, materialId, wrapId };
  };
  const provisionInternal = (pieceKey, lib, name) => {
    const template = lib.find((t) => t.name === name || t.id === name);
    if (!template) return;
    const partId = uuid();
    parts.push({ ...clone(template), id: partId, equipped: true, isInstalled: true, installedInSaberId: saberId, quantity: 1 });
    saberParts[pieceKey] = partId;
  };

  const m = saber.buildManifest;
  provisionPart('emitter', m.emitter.name, m.emitter.material);
  provisionPart('switch', m.switch.name, m.switch.material);
  provisionPart('sleeve', m.sleeve.name, m.sleeve.material, m.sleeve.wrap || null);
  if (m.pommel) provisionPart('pommel', m.pommel.name, m.pommel.material);
  if (m.coupler) {
    provisionPart('coupler', m.coupler.name, m.coupler.material);
    provisionPart('couplerTwo', m.coupler.name, m.coupler.material);
  }
  const isStaff = !!m.coupler;
  if (isStaff && m.emitterTwo) {
    provisionPart('emitterTwo', m.emitterTwo.name, m.emitterTwo.material);
    provisionPart('switchTwo', m.switchTwo.name, m.switchTwo.material);
    provisionPart('sleeveTwo', m.sleeveTwo.name, m.sleeveTwo.material, m.sleeveTwo.wrap || null);
  }
  provisionInternal('powerCell', P.powerCells, m.powerCell);
  provisionInternal('lens', P.lenses, m.lens);
  provisionInternal('emitterMatrix', P.emitters, m.matrix);
  provisionInternal('primaryCrystal', P.primaryCrystals, m.primaryCrystal);
  if (m.primaryCrystalTwo) provisionInternal('primaryCrystalTwo', P.primaryCrystals, m.primaryCrystalTwo);
  if (m.powerCrystal) provisionInternal('powerCrystal', P.powerCrystals, m.powerCrystal);

  // NOTHING ARRIVES FROM A LIBRARY DAMAGED: null = not measured yet; the card measures both sides from the parts.
  const lightsaber = { ...clone(saber), id: saberId, ...saberParts, durability: null, maxDurability: 0, durabilityTwo: null, maxDurabilityTwo: 0 };
  return { weapon: lightsaber, parts, ammunition: [], equipment: [] };
}

/** structural-part-selection-dialog.tsx -> buildAcquiredRow, in the baseline stock for a milled part (see the header). */
function milledPartRow(family, part, engine) {
  const takesMaterial = engine.partAcquisition.acquirablePartsFor(family).find((p) => p.id === part.id)?.takesMaterial ?? false;
  return engine.partAcquisition.buildAcquiredRow(family, part.id, takesMaterial ? DEFAULT_MILL_MATERIAL_ID : null, 1, uuid());
}
const milledPartName = (family, part, engine) => {
  const takesMaterial = engine.partAcquisition.acquirablePartsFor(family).find((p) => p.id === part.id)?.takesMaterial ?? false;
  return engine.partAcquisition.pricePart(family, part.id, takesMaterial ? DEFAULT_MILL_MATERIAL_ID : null)?.name ?? part.name;
};

/** weapon-modification-selection-dialog.tsx handleToggleItem / handleConfirm (one row per unit). */
const weaponModRow = (mod) => ({ ...clone(mod), id: uuid(), quantity: 1, equipped: false });

/**
 * ammunition-selection-dialog.tsx handleConfirm: a library round at full
 * charge; a CONTAINER (magazine, clip, fuel vessel) arrives EMPTY (the dialog's
 * "not full" branch: currentCharges 0, cost = baseCost) - filling it with a
 * chosen round is a buyer's choice the sheet's ammunition UI makes.
 */
function ammunitionRow(def) {
  const item = {
    ...clone(def),
    id: uuid(),
    quantity: 1,
    maxCharges: def.maxCharges,
    currentCharges: def.maxCharges,
    contents: [],
    isLibraryItem: true,
    baseCost: def.baseCost ?? def.cost,
    baseWeight: def.baseWeight ?? def.weight,
    containerType: def.containerType ?? 'None',
    isInstalled: false,
    installedInDroidId: null,
    storageLocationId: null,
    cost: def.cost,
    weight: def.weight,
  };
  if (def.isContainer) {
    item.currentCharges = 0;
    item.contents = [];
    item.cost = def.baseCost ?? def.cost;
  }
  return item;
}

/** explosive-selection-dialog.tsx handleToggleItem + handleConfirm. */
const explosiveRow = (def) => ({
  baseExplosiveName: def.name, quantity: 1, finalWeight: def.weight, finalCost: def.cost, preferredDefaultAttr: 'DX', id: uuid(),
});

/** The equipment catalog's Raw Materials row for a material name (every Ch11/Ch12 material is one; check:packs pins that). */
function materialRow(name, engine) {
  const entry = engine.equipmentData.equipmentData.find((e) => e.category === 'Raw Materials' && e.name === name);
  if (!entry) throw new Error(`pack-manifest: no Raw Materials equipment row named "${name}"`);
  return equipmentRow(entry);
}

/** lightsaber-hilt-selection-dialog.tsx handleConfirm (calculateHiltPartStats in Durasteel, no wrap - the picker's default). */
function hiltPartRow(template, engine) {
  const material = engine.lightsaberParts.LIGHTSABER_MATERIALS.find((m) => m.id === DEFAULT_MILL_MATERIAL_ID);
  const weight = template.volume * material.density;
  const cost = weight * material.costPerLb;
  return {
    name: `${material.name} ${template.name}`,
    category: template.category,
    effect: template.effect,
    weight: parseFloat(weight.toFixed(3)),
    // Ch12 rounds a finished component's price up to a whole credit (the dialog stores Math.ceil of the material value x markup).
    cost: Math.max(1, Math.ceil(cost)),
    id: uuid(),
    partId: template.id,
    quantity: 1,
    equipped: false,
    isInstalled: false,
    materialId: material.id,
    wrapId: null,
    volume: template.volume,
    density: material.density,
  };
}

/** lightsaber-internal-selection-dialog.tsx handleConfirm. */
const internalRow = (lib) => ({ ...clone(lib), id: uuid(), quantity: 1, equipped: false, isInstalled: false, notes: lib.effect || lib.traits || '' });

/** implant-selection-dialog.tsx handleToggleItem; implants-cybernetics-section.tsx adds installed:false + itemSizeModifier on drop. */
const implantRow = (profile, kind, engine) => ({
  id: uuid(),
  name: profile.name,
  cost: profile.cost,
  baseCp: profile.baseCp,
  finalCp: profile.finalCp,
  effect: profile.effect,
  category: kind,
  pathways: kind === 'Neural' ? profile.pathways : [],
  slotType: kind === 'Sensory' ? profile.slotType : 'Neural',
  installed: false,
  weight: profile.weight || 0.1,
  notes: engine.implantEffects.implantTraitPackageNote(profile),
});

/** cybernetic-limb-selection-dialog.tsx: the dialog's default placement per tab (right side; Arms/Legs are Full, Hands/Feet Partial). */
const LIMB_DEFAULTS = Object.freeze({ Arm: { location: 'Right Arm', extent: 'Full' }, Leg: { location: 'Right Leg', extent: 'Full' }, Hand: { location: 'Right Hand', extent: 'Partial' }, Foot: { location: 'Right Foot', extent: 'Partial' } });
function limbRow(profile) {
  const d = LIMB_DEFAULTS[profile.type];
  if (!d) throw new Error(`pack-manifest: cybernetic limb "${profile.name}" has an unknown type "${profile.type}"`);
  return {
    id: uuid(), name: profile.name, location: d.location, extent: d.extent, material: profile.material, cost: profile.cost, weight: profile.weight,
    dr: profile.dr, currentDr: profile.dr, effect: profile.effect, upgrades: [], hasSynthskin: false, installed: false, storageLocationId: null,
    quantity: 1, baselinePoints: 0, itemSizeModifier: 0,
  };
}

/** cybernetic-upgrade-selection-dialog.tsx handleToggleItem / handleConfirm. */
const upgradeRow = (profile) => ({
  id: uuid(), name: profile.name, cost: profile.cost, weight: profile.weight || 0, effect: profile.effect,
  requiresType: profile.requiresType || null, requiresExtent: profile.requiresExtent || 'Any', equipped: false, quantity: 1,
});

/** PORT of starship-selection-dialog.tsx chassisToStarship (lines 32-70); REQUESTS.md asks for an extraction. */
const starshipRow = (profile) => ({
  id: uuid(),
  customName: profile.name,
  baseChassis: profile.name,
  baseCost: profile.cost,
  finalCost: profile.cost,
  baseHp: profile.hp,
  baseDr: profile.dr,
  baseHandling: profile.handling,
  baseSpeed: profile.speed,
  baseAccelDecel: profile.accelDecel,
  baseCrew: profile.crew,
  basePassengers: profile.passengers,
  baseCargo: profile.cargo,
  baseWeapons: profile.weapons,
  baseWeaponSkill: profile.weaponSkill,
  baseHyperdrive: profile.hyperdrive,
  systems: [],
  armaments: [],
  dpHandlingMod: 0, dpSpeedMod: 0, dpAccelMod: 0, dpHpMod: 0, dpDrMod: 0,
  dpWeaponHardpoints: 0,
  dpWeaponMount1: 'None', dpWeaponMount2: 'None', dpWeaponMount3: 'None', dpWeaponMount4: 'None',
  dpHyperdriveMod: 0, dpCargoMod: 0, dpPassengerMod: 0, dpQuirkPoints: 0, dpSystemQuirks: '',
  performanceMod: null, defensiveMod1: null, defensiveMod2: null, offensiveMod1: null, offensiveMod2: null, utilityMod1: null, utilityMod2: null,
  offensiveMod1Mount1: null, offensiveMod1Mount2: null, offensiveMod2Mount1: null, offensiveMod2Mount2: null,
  finalHp: profile.hp,
  finalDr: profile.dr,
  quantity: 1,
});

/**
 * Starship mods and weapons are CATALOG PICKS on the website (names in a
 * starship row's mod/mount fields), never inventory rows. They ship as
 * browse-only equipment rows so a GM can read them in the sidebar; the drop
 * handler refuses them (REFERENCE_ONLY_CATALOGS) and points at the builder.
 */
const starshipModRow = (mod) => ({
  id: uuid(), name: mod.name, category: 'Utility & Miscellaneous', subCategory: 'Starship Modification', cost: 0, weight: 0, quantity: 1,
  description: `${mod.category} modification. ${mod.effect} Cost: ${mod.costPercent}% of the ${mod.costBasis} cost.`,
});
const starshipWeaponRow = (w) => ({
  id: uuid(), name: w.name, category: 'Utility & Miscellaneous', subCategory: 'Starship Weapon', cost: w.cost ?? 0, weight: 0, quantity: 1,
  description: `${w.damage}${w.damageType ? ` ${w.damageType}` : ''}. ${w.notes ?? ''}`.trim(),
});

/** vehicle-selection-dialog.tsx handleConfirm + *-vehicles-section.tsx handleAddVehicles (fresh id). */
const vehicleRow = (v) => ({ ...clone(v), id: uuid(), name: v.name, quantity: 1 });

/** structural-part-selection-dialog.tsx (family 'droid') -> buildAcquiredRow: an equipment row the Workshop consumes by name. */
const droidPartRow = (part, engine) => engine.partAcquisition.buildAcquiredRow('droid', part.id, null, 1, uuid());

/**
 * A template Actor: the website's own template load (use-character-form.ts
 * loadAndResetForm: applyLoadMigrations(template.data, blankSheetData)) then
 * the adapter (ARCHITECTURE §4.3). Without applyLoadMigrations the pools stay
 * at their null sentinels and the HUD bars would show them (U02b's request).
 */
function templateActor(entry, ctx) {
  const { engine, key } = ctx;
  const sheet = clone(unwrap(entry.template));
  let data = sheet;
  let notices = [];
  let migrated = false;
  if (engine.hasExport('applyLoadMigrations')) {
    const loaded = engine.applyLoadMigrations(sheet, engine.blankSheetData);
    data = loaded.data;
    notices = loaded.notices ?? [];
    migrated = true;
  }
  // Item names come from the adapter's itemNameFor (customName / name / baseExplosiveName ...):
  // Vex Korta's "Concussion Grenade" is named there, and check:packs pins it.
  const actor = sheetToActorData(data, { actorName: entry.template.name });
  const category = engine.templateCategories.templateCategory(key, entry.template);
  return {
    name: actor.name,
    type: 'character',
    img: 'icons/svg/mystery-man.svg',
    system: actor.system,
    prototypeToken: {
      name: actor.name,
      actorLink: true,
      displayName: 30,
      displayBars: 40,
      disposition: 1,
      bar1: { attribute: 'resources.hp' },
      bar2: { attribute: 'resources.ep' },
    },
    items: actor.items,
    effects: actor.effects,
    flags: { [SYSTEM_ID]: { template: { key, category, description: entry.template.description ?? null, migrated, notices: notices.map((n) => n.id ?? n.title ?? String(n)) } } },
  };
}

// ---------------------------------------------------------------------------
// The packs
// ---------------------------------------------------------------------------

const SKILL_CATEGORIES = Object.freeze([
  ['artisticSkills', 'Artistic'],
  ['combatSkills', 'Combat'],
  ['covertSubterfugeSkills', 'Covert & Subterfuge'],
  ['forceSpecificSkills', 'Force-Specific'],
  ['knowledgeMentalSkills', 'Knowledge & Mental'],
  ['physicalAthleticSkills', 'Physical & Athletic'],
  ['socialInfluenceSkills', 'Social & Influence'],
  ['technicalCraftingSkills', 'Technical & Crafting'],
]);

const DROID_ARRAYS = Object.freeze(['DROID_CHASSIS', 'DROID_HEADS', 'DROID_PROCESSORS', 'DROID_MEMORY_CORES', 'DROID_SENSORS', 'DROID_POWER_CORES', 'DROID_ARMS', 'DROID_MANIPULATORS', 'DROID_MOTIVE_STRUTS', 'DROID_MOTIVE_MOUNTS', 'DROID_UPGRADES']);

const item = (type) => (row, ctx, extra = {}) => itemBody(type, row, { catalog: ctx.pack, ...extra });

/** @type {Array<object>} */
export const PACKS = [
  // ---- traits ---------------------------------------------------------------
  {
    name: 'advantages', label: { key: 'SHADOWBASE.Pack.Advantages', en: 'Advantages' }, type: 'Item', itemType: 'advantage', packFolder: 'traits',
    consumes: ['advantages.advantagesLibrary'],
    source: (E) => E.advantages.advantagesLibrary,
    key: (r) => r.name,
    folderPlan: (r) => [r.category],
    schema: (E) => E.traitSchemas.advantageSchema,
    project: (lib, ctx) => item('advantage')(advantageRow(lib), ctx, { name: lib.name }),
  },
  {
    name: 'disadvantages', label: { key: 'SHADOWBASE.Pack.Disadvantages', en: 'Disadvantages' }, type: 'Item', itemType: 'disadvantage', packFolder: 'traits',
    consumes: ['disadvantages.disadvantagesLibrary'],
    source: (E) => E.disadvantages.disadvantagesLibrary,
    // "Overconfidence (Martial)" is listed under two categories (Mental and Cultural / Background); the name alone is not a key.
    key: (r) => `${r.name}|${r.category}`,
    folderPlan: (r) => [r.category],
    schema: (E) => E.traitSchemas.disadvantageSchema,
    project: (lib, ctx) => item('disadvantage')(disadvantageRow(lib), ctx, { name: lib.name }),
  },
  {
    name: 'quirks', label: { key: 'SHADOWBASE.Pack.Quirks', en: 'Quirks' }, type: 'Item', itemType: 'quirk', packFolder: 'traits',
    consumes: ['quirks.allQuirksList', 'quirks.standardQuirks', 'quirks.starWarsQuirks'],
    source: (E) => E.quirks.allQuirksList,
    key: (r) => r.name,
    folderPlan: (r, E) => [E.quirks.starWarsQuirks.includes(r) ? 'Star Wars' : 'Standard'],
    schema: (E) => E.traitSchemas.quirkSchema,
    project: (q, ctx) => item('quirk')(quirkRow(q), ctx, { name: q.name }),
  },
  // ---- skills & abilities -----------------------------------------------------
  {
    name: 'skills', label: { key: 'SHADOWBASE.Pack.Skills', en: 'Skills' }, type: 'Item', itemType: 'skill', packFolder: 'abilities',
    consumes: ['skills.allLibrarySkills', ...SKILL_CATEGORIES.map(([k]) => `skills.${k}`)],
    source: (E) => E.skills.allLibrarySkills,
    key: (r) => r.name,
    folderPlan: (r, E) => {
      const hit = SKILL_CATEGORIES.find(([k]) => E.skills[k].includes(r));
      if (!hit) throw new Error(`pack-manifest: skill "${r.name}" is in no category array`);
      return [hit[1]];
    },
    schema: (E) => E.abilitySchemas.skillSchema,
    project: (s, ctx) => item('skill')(skillRow(s), ctx, { name: s.name }),
  },
  {
    name: 'force-powers', label: { key: 'SHADOWBASE.Pack.ForcePowers', en: 'Force Powers' }, type: 'Item', itemType: 'forcePower', packFolder: 'abilities',
    perName: true,
    consumes: ['forcePowers.forcePowersData'],
    // One document per NAME; the row is the Level 1 catalog row, system.levels every level of that name.
    source: (E) => [...group(E.forcePowers.forcePowersData, (p) => p.name).entries()].map(([name, levels]) => ({ name, levels: [...levels].sort((a, b) => a.level - b.level) })),
    key: (r) => r.name,
    folderPlan: (r) => [r.levels[0].category],
    schema: (E) => E.abilitySchemas.forcePowerSchema,
    project: (r, ctx) => {
      const level1 = r.levels.find((l) => l.level === 1);
      if (!level1) throw new Error(`pack-manifest: force power "${r.name}" has no Level 1 row`);
      return item('forcePower')(forcePowerRow(level1), ctx, { name: r.name, levels: clone(r.levels) });
    },
  },
  {
    name: 'combat-techniques', label: { key: 'SHADOWBASE.Pack.CombatTechniques', en: 'Combat Techniques' }, type: 'Item', itemType: 'combatTechnique', packFolder: 'abilities',
    perName: true,
    // The four category arrays are subsets of allCombatTechniques (techniques.ts), the way the skill category arrays are.
    consumes: ['techniques.allCombatTechniques', 'combatTechniques.combatTechniquesList', 'techniques.meleeTechniques', 'techniques.rangedTechniques', 'techniques.unarmedTechniques', 'techniques.universalTechniques'],
    // The website keys techniques by `${category}-${name}` (combat-technique-selection-dialog.tsx); so does this pack.
    source: (E) => [...group(E.techniques.allCombatTechniques, (t) => `${t.category}|${t.name}`).entries()].map(([k, levels]) => ({ key: k, name: levels[0].name, category: levels[0].category, levels: [...levels].sort((a, b) => a.level - b.level) })),
    key: (r) => r.key,
    folderPlan: (r) => [r.category],
    schema: (E) => E.abilitySchemas.combatTechniqueSchema,
    project: (r, ctx) => {
      const level1 = r.levels.find((l) => l.level === 1);
      if (!level1) throw new Error(`pack-manifest: technique "${r.name}" has no Level 1 row`);
      return item('combatTechnique')(techniqueRow(level1), ctx, { name: r.name, levels: clone(r.levels) });
    },
  },
  {
    name: 'lightsaber-forms', label: { key: 'SHADOWBASE.Pack.LightsaberForms', en: 'Lightsaber Forms' }, type: 'Item', itemType: 'lightsaberForm', packFolder: 'abilities',
    perName: true,
    consumes: ['lightsaberForms.lightsaberForms'],
    source: (E) => E.lightsaberForms.lightsaberForms,
    key: (r) => r.name,
    folderPlan: () => [],
    schema: (E) => E.abilitySchemas.knownLightsaberFormSchema,
    project: (f, ctx) => item('lightsaberForm')(formRow(f), ctx, { name: f.name, levels: clone(f.levels) }),
  },
  // ---- gear -------------------------------------------------------------------
  {
    name: 'equipment', label: { key: 'SHADOWBASE.Pack.Equipment', en: 'Equipment' }, type: 'Item', itemType: 'equipment', packFolder: 'gear',
    consumes: ['equipmentData.equipmentData'],
    source: (E) => E.equipmentData.equipmentData,
    key: (r) => r.name,
    folderPlan: (r) => (r.subCategory ? [r.category, r.subCategory] : [r.category]),
    schema: (E) => E.inventorySchemas.generalEquipmentItemSchema,
    project: (e, ctx) => item('equipment')(equipmentRow(e), ctx, { name: e.name }),
  },
  {
    name: 'blueprints', label: { key: 'SHADOWBASE.Pack.Blueprints', en: 'Blueprints' }, type: 'Item', itemType: 'equipment', packFolder: 'gear',
    consumes: ['blueprintCatalog.craftableDesigns'],
    source: (E) => E.blueprintCatalog.craftableDesigns(),
    key: (d) => `${d.family}|${d.name}`,
    docName: (d) => `Blueprint: ${d.name}`,
    folderPlan: (d, E) => [E.blueprintCatalog.sectionForFamily(d.family), d.family],
    schema: (E) => E.inventorySchemas.generalEquipmentItemSchema,
    project: (d, ctx) => { const row = blueprintRow(d, ctx.engine); return item('equipment')(row, ctx, { name: row.name }); },
  },
  {
    name: 'ammunition', label: { key: 'SHADOWBASE.Pack.Ammunition', en: 'Ammunition' }, type: 'Item', itemType: 'ammunition', packFolder: 'gear',
    consumes: ['ammunitionData.AMMUNITION_DATA'],
    source: (E) => E.ammunitionData.AMMUNITION_DATA,
    key: (r) => r.name,
    folderPlan: (r) => [r.type],
    schema: (E) => E.inventorySchemas.ammunitionSchema,
    project: (a, ctx) => item('ammunition')(ammunitionRow(a), ctx, { name: a.name }),
  },
  {
    name: 'explosives', label: { key: 'SHADOWBASE.Pack.Explosives', en: 'Explosives' }, type: 'Item', itemType: 'explosive', packFolder: 'gear',
    consumes: ['explosiveData.ALL_EXPLOSIVES_DATA', 'explosiveData.GRENADES_DATA', 'explosiveData.MINES_DATA'],
    source: (E) => E.explosiveData.ALL_EXPLOSIVES_DATA,
    key: (r) => r.name,
    folderPlan: (r) => [r.type],
    schema: (E) => E.inventorySchemas.customExplosiveSchema,
    project: (x, ctx) => item('explosive')(explosiveRow(x), ctx, { name: x.name }),
  },
  // ---- armor ------------------------------------------------------------------
  {
    name: 'armor', label: { key: 'SHADOWBASE.Pack.Armor', en: 'Armor & Clothing' }, type: 'Item', itemType: 'armor', packFolder: 'armor',
    consumes: ['armorData.ARMOR_DATA'],
    source: (E) => E.armorData.ARMOR_DATA,
    key: (r) => r.name,
    folderPlan: (r) => [r.type],
    schema: (E) => E.inventorySchemas.armorItemSchema,
    project: (p, ctx) => item('armor')(armorRow(p, ctx.engine), ctx, { name: p.name }),
  },
  {
    name: 'armor-pieces', label: { key: 'SHADOWBASE.Pack.ArmorPieces', en: 'Armor Pieces (Ch13)' }, type: 'Item', itemType: 'armor', packFolder: 'armor',
    consumes: ['armorPiecesData.ARMOR_PIECES'],
    source: (E) => E.armorPiecesData.ARMOR_PIECES,
    key: (r) => r.id,
    folderPlan: (r) => [r.location],
    schema: (E) => E.inventorySchemas.armorItemSchema,
    project: (p, ctx) => item('armor')(armorPieceRow(p, ctx.engine), ctx, { name: p.name }),
  },
  {
    name: 'armor-parts', label: { key: 'SHADOWBASE.Pack.ArmorParts', en: 'Armor Components' }, type: 'Item', itemType: 'armorPart', packFolder: 'armor',
    consumes: ['armorPartsData.ARMOR_PARTS'],
    source: (E) => E.armorPartsData.ARMOR_PARTS,
    key: (r) => r.id,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.armorModificationSchema,
    project: (p, ctx) => item('armorPart')(armorPartRow(p, ctx.engine), ctx, { name: p.name }),
  },
  {
    name: 'armor-mods', label: { key: 'SHADOWBASE.Pack.ArmorMods', en: 'Armor Mods' }, type: 'Item', itemType: 'armorPart', packFolder: 'armor',
    consumes: ['armorMods.ARMOR_MOD_DATA'],
    source: (E) => E.armorMods.ARMOR_MOD_DATA,
    key: (r) => r.name,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.armorModificationSchema,
    project: (m, ctx) => item('armorPart')(armorModRow(m), ctx, { name: m.name }),
  },
  // ---- weapons ----------------------------------------------------------------
  {
    name: 'ranged-weapons', label: { key: 'SHADOWBASE.Pack.RangedWeapons', en: 'Ranged Weapons' }, type: 'Item', itemType: 'blaster', packFolder: 'weapons',
    kit: true,
    consumes: ['rangedWeaponProfiles.RANGED_WEAPON_PROFILES'],
    source: (E) => E.rangedWeaponProfiles.RANGED_WEAPON_PROFILES,
    key: (r) => r.name,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.customBlasterSchema,
    partsSchema: (E) => E.inventorySchemas.weaponModificationSchema,
    project: (p, ctx) => { const kit = blasterKit(p, ctx.engine); return item('blaster')(kit.weapon, ctx, { name: p.name, kit }); },
  },
  {
    name: 'ranged-parts', label: { key: 'SHADOWBASE.Pack.RangedParts', en: 'Blaster Components' }, type: 'Item', itemType: 'weaponPart', packFolder: 'weapons',
    consumes: ['rangedPartsData.allRangedLibraryParts', 'rangedPartsData.RANGED_GRIPS', 'rangedPartsData.RANGED_RECEIVERS', 'rangedPartsData.RANGED_BARRELS', 'rangedPartsData.RANGED_TARGETING', 'rangedPartsData.RANGED_POWER_UNITS'],
    source: (E) => E.rangedPartsData.allRangedLibraryParts,
    key: (r) => r.id,
    docName: (r, E) => milledPartName('ranged', r, E),
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.weaponModificationSchema,
    project: (p, ctx) => { const row = milledPartRow('ranged', p, ctx.engine); return item('weaponPart')(row, ctx, { name: row.name, family: 'weapon', source: WEAPON_PART_FAMILIES.weapon }); },
  },
  {
    name: 'weapon-mods', label: { key: 'SHADOWBASE.Pack.WeaponMods', en: 'Weapon Mods' }, type: 'Item', itemType: 'weaponPart', packFolder: 'weapons',
    consumes: ['weaponModData.WEAPON_MOD_DATA'],
    source: (E) => E.weaponModData.WEAPON_MOD_DATA,
    key: (r) => r.name,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.weaponModificationSchema,
    project: (m, ctx) => item('weaponPart')(weaponModRow(m), ctx, { name: m.name, family: 'weapon', source: WEAPON_PART_FAMILIES.weapon }),
  },
  {
    name: 'melee-weapons', label: { key: 'SHADOWBASE.Pack.MeleeWeapons', en: 'Melee Weapons' }, type: 'Item', itemType: 'meleeWeapon', packFolder: 'weapons',
    kit: true,
    consumes: ['meleeWeaponProfiles.MELEE_WEAPON_PROFILES'],
    source: (E) => E.meleeWeaponProfiles.MELEE_WEAPON_PROFILES,
    key: (r) => r.name,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.customMeleeWeaponSchema,
    partsSchema: (E) => E.inventorySchemas.weaponModificationSchema,
    project: (p, ctx) => { const kit = meleeKit(p, ctx.engine); return item('meleeWeapon')(kit.weapon, ctx, { name: p.name, kit }); },
  },
  {
    name: 'melee-parts', label: { key: 'SHADOWBASE.Pack.MeleeParts', en: 'Melee Components & Materials' }, type: 'Item', packFolder: 'weapons',
    consumes: ['meleePartsData.allMeleeLibraryParts', 'meleePartsData.MELEE_GRIPS', 'meleePartsData.MELEE_HEADS', 'meleePartsData.MELEE_GUARDS', 'meleePartsData.MELEE_POWER_UNITS', 'meleePartsData.MELEE_MATERIALS'],
    // 22 components plus every Ch12 material as its own Raw Materials row (one per NAME - "Plastoid" is listed twice, as stock and as a wrap).
    source: (E) => [
      ...E.meleePartsData.allMeleeLibraryParts.map((p) => ({ kind: 'part', part: p, name: p.name })),
      ...[...new Set(E.meleePartsData.MELEE_MATERIALS.map((m) => m.name))].map((name) => ({ kind: 'material', name })),
    ],
    key: (r) => (r.kind === 'part' ? `part:${r.part.id}` : `material:${r.name}`),
    docName: (r, E) => (r.kind === 'part' ? milledPartName('melee', r.part, E) : r.name),
    folderPlan: (r) => (r.kind === 'part' ? [r.part.category] : ['Materials']),
    itemTypeOf: (r) => (r.kind === 'part' ? 'weaponPart' : 'equipment'),
    schemaOf: (r, E) => (r.kind === 'part' ? E.inventorySchemas.weaponModificationSchema : E.inventorySchemas.generalEquipmentItemSchema),
    project: (r, ctx) => {
      if (r.kind === 'part') { const row = milledPartRow('melee', r.part, ctx.engine); return item('weaponPart')(row, ctx, { name: row.name, family: 'weapon', source: WEAPON_PART_FAMILIES.weapon }); }
      return item('equipment')(materialRow(r.name, ctx.engine), ctx, { name: r.name });
    },
  },
  {
    name: 'lightsabers', label: { key: 'SHADOWBASE.Pack.Lightsabers', en: 'Lightsabers' }, type: 'Item', itemType: 'lightsaber', packFolder: 'weapons',
    kit: true,
    consumes: ['lightsaberPreconstructed.PRECONSTRUCTED_LIGHTSABERS'],
    source: (E) => E.lightsaberPreconstructed.PRECONSTRUCTED_LIGHTSABERS,
    key: (r) => r.name,
    folderPlan: (r) => [r.category ?? 'Standard'],
    schema: (E) => E.inventorySchemas.lightsaberSchema,
    partsSchema: (E) => E.inventorySchemas.lightsaberModificationSchema,
    project: (s, ctx) => { const kit = lightsaberKit(s, ctx.engine); return item('lightsaber')(kit.weapon, ctx, { name: s.name, kit }); },
  },
  {
    name: 'lightsaber-parts', label: { key: 'SHADOWBASE.Pack.LightsaberParts', en: 'Lightsaber Components' }, type: 'Item', packFolder: 'weapons',
    consumes: ['lightsaberParts.HILT_COMPONENT_TEMPLATES', 'lightsaberParts.LIGHTSABER_WRAPS', 'lightsaberParts.LIGHTSABER_MATERIALS', 'lightsaberParts.allLibraryParts', 'lightsaberParts.powerCells', 'lightsaberParts.lenses', 'lightsaberParts.emitters', 'lightsaberParts.powerCrystals', 'lightsaberParts.primaryCrystals'],
    // 20 hilt templates + 3 wraps + 13 materials (both as their Raw Materials rows) + 58 internals.
    source: (E) => [
      ...E.lightsaberParts.HILT_COMPONENT_TEMPLATES.map((t) => ({ kind: 'hilt', part: t, name: t.name })),
      ...E.lightsaberParts.LIGHTSABER_WRAPS.map((w) => ({ kind: 'wrap', name: w.name })),
      ...E.lightsaberParts.LIGHTSABER_MATERIALS.map((m) => ({ kind: 'material', name: m.name })),
      ...E.lightsaberParts.allLibraryParts.map((p) => ({ kind: 'internal', part: p, name: p.name })),
    ],
    key: (r) => (r.kind === 'hilt' || r.kind === 'internal' ? `${r.kind}:${r.part.id}` : `${r.kind}:${r.name}`),
    docName: (r, E) => (r.kind === 'hilt' ? hiltPartRow(r.part, E).name : r.name),
    folderPlan: (r) => ({ hilt: ['Hilt Components', r.part?.category], wrap: ['Wraps'], material: ['Materials'], internal: ['Internals', r.part?.category] })[r.kind].filter(Boolean),
    itemTypeOf: (r) => (r.kind === 'hilt' || r.kind === 'internal' ? 'weaponPart' : 'equipment'),
    schemaOf: (r, E) => (r.kind === 'hilt' || r.kind === 'internal' ? E.inventorySchemas.lightsaberModificationSchema : E.inventorySchemas.generalEquipmentItemSchema),
    project: (r, ctx) => {
      if (r.kind === 'hilt') { const row = hiltPartRow(r.part, ctx.engine); return item('weaponPart')(row, ctx, { name: row.name, family: 'lightsaber', source: WEAPON_PART_FAMILIES.lightsaber }); }
      if (r.kind === 'internal') { const row = internalRow(r.part); return item('weaponPart')(row, ctx, { name: row.name, family: 'lightsaber', source: WEAPON_PART_FAMILIES.lightsaber }); }
      return item('equipment')(materialRow(r.name, ctx.engine), ctx, { name: r.name });
    },
  },
  // ---- cybernetics --------------------------------------------------------------
  {
    name: 'implants', label: { key: 'SHADOWBASE.Pack.Implants', en: 'Implants' }, type: 'Item', itemType: 'implant', packFolder: 'cybernetics',
    consumes: ['cyberneticsData.NEURAL_IMPLANTS', 'cyberneticsData.SENSORY_IMPLANTS'],
    source: (E) => [...E.cyberneticsData.NEURAL_IMPLANTS.map((p) => ({ kind: 'Neural', profile: p, name: p.name })), ...E.cyberneticsData.SENSORY_IMPLANTS.map((p) => ({ kind: 'Sensory', profile: p, name: p.name }))],
    key: (r) => `${r.kind}|${r.name}`,
    folderPlan: (r) => [r.kind],
    schema: (E) => E.inventorySchemas.neuralImplantSchema,
    project: (r, ctx) => item('implant')(implantRow(r.profile, r.kind, ctx.engine), ctx, { name: r.name }),
  },
  {
    name: 'cybernetic-limbs', label: { key: 'SHADOWBASE.Pack.CyberneticLimbs', en: 'Cybernetic Limbs' }, type: 'Item', itemType: 'cyberneticLimb', packFolder: 'cybernetics',
    consumes: ['cyberneticsData.CYBERNETIC_LIMBS', 'cyberneticsData.ARM_MODELS', 'cyberneticsData.LEG_MODELS', 'cyberneticsData.HAND_MODELS', 'cyberneticsData.FOOT_MODELS'],
    source: (E) => E.cyberneticsData.CYBERNETIC_LIMBS,
    key: (r) => `${r.type}|${r.name}`,
    folderPlan: (r) => [`${r.type}s`],
    schema: (E) => E.inventorySchemas.cyberneticLimbSchema,
    project: (p, ctx) => item('cyberneticLimb')(limbRow(p), ctx, { name: p.name }),
  },
  {
    name: 'cybernetic-upgrades', label: { key: 'SHADOWBASE.Pack.CyberneticUpgrades', en: 'Hardware Upgrades' }, type: 'Item', itemType: 'cyberneticUpgrade', packFolder: 'cybernetics',
    consumes: ['cyberneticsData.CYBERNETIC_UPGRADES', 'cyberneticsData.ENHANCEMENT_MODULES'],
    source: (E) => [...E.cyberneticsData.CYBERNETIC_UPGRADES.map((p) => ({ kind: 'Upgrades', profile: p, name: p.name })), ...E.cyberneticsData.ENHANCEMENT_MODULES.map((p) => ({ kind: 'Enhancement Modules', profile: p, name: p.name }))],
    key: (r) => `${r.kind}|${r.name}`,
    folderPlan: (r) => [r.kind],
    schema: (E) => E.inventorySchemas.cyberneticUpgradeSchema,
    project: (r, ctx) => item('cyberneticUpgrade')(upgradeRow(r.profile), ctx, { name: r.name }),
  },
  // ---- vessels ------------------------------------------------------------------
  {
    name: 'starships', label: { key: 'SHADOWBASE.Pack.Starships', en: 'Starships' }, type: 'Item', itemType: 'starship', packFolder: 'vessels',
    consumes: ['starshipChassisData.STARSHIP_CHASSIS_DATA'],
    source: (E) => E.starshipChassisData.STARSHIP_CHASSIS_DATA,
    key: (r) => r.name,
    folderPlan: (r) => [r.type],
    schema: (E) => E.inventorySchemas.customStarshipSchema,
    project: (p, ctx) => item('starship')(starshipRow(p), ctx, { name: p.name }),
  },
  {
    name: 'starship-mods', label: { key: 'SHADOWBASE.Pack.StarshipMods', en: 'Starship Modifications' }, type: 'Item', itemType: 'equipment', packFolder: 'vessels',
    referenceOnly: true,
    consumes: ['starshipMods.STARSHIP_MODS'],
    source: (E) => E.starshipMods.STARSHIP_MODS,
    key: (r) => r.name,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.generalEquipmentItemSchema,
    project: (m, ctx) => item('equipment')(starshipModRow(m), ctx, { name: m.name }),
  },
  {
    name: 'starship-weapons', label: { key: 'SHADOWBASE.Pack.StarshipWeapons', en: 'Starship Weapons' }, type: 'Item', itemType: 'equipment', packFolder: 'vessels',
    referenceOnly: true,
    consumes: ['starshipWeapons.STARSHIP_WEAPONS_LIBRARY'],
    source: (E) => E.starshipWeapons.STARSHIP_WEAPONS_LIBRARY,
    key: (r) => r.name,
    folderPlan: () => [],
    schema: (E) => E.inventorySchemas.generalEquipmentItemSchema,
    project: (w, ctx) => item('equipment')(starshipWeaponRow(w), ctx, { name: w.name }),
  },
  {
    name: 'vehicles', label: { key: 'SHADOWBASE.Pack.Vehicles', en: 'Vehicles' }, type: 'Item', itemType: 'vehicle', packFolder: 'vessels',
    consumes: ['vehicleData.VEHICLE_DATA'],
    source: (E) => E.vehicleData.VEHICLE_DATA,
    key: (r) => r.name,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.vehicleSchema,
    project: (v, ctx) => item('vehicle')(vehicleRow(v), ctx, { name: v.name }),
  },
  // ---- droids -------------------------------------------------------------------
  {
    name: 'droid-parts', label: { key: 'SHADOWBASE.Pack.DroidParts', en: 'Droid Components' }, type: 'Item', itemType: 'equipment', packFolder: 'droids',
    consumes: DROID_ARRAYS.map((k) => `droidData.${k}`),
    source: (E) => E.partAcquisition.acquirablePartsFor('droid'),
    key: (r) => r.id,
    folderPlan: (r) => [r.category],
    schema: (E) => E.inventorySchemas.generalEquipmentItemSchema,
    project: (p, ctx) => item('equipment')(droidPartRow(p, ctx.engine), ctx, { name: p.name }),
  },
  // ---- characters ---------------------------------------------------------------
  {
    name: 'templates', label: { key: 'SHADOWBASE.Pack.Templates', en: 'Character Templates' }, type: 'Actor', packFolder: 'characters',
    consumes: ['characterTemplateStore'],
    source: (E) => Object.entries(E.characterTemplateStore).map(([key, template]) => ({ key, template, name: template.name })),
    key: (r) => r.key,
    docName: (r) => r.template.name,
    // Ch18's own section names (template-categories.ts); the blank sheet sits at the root.
    folderPlan: (r, E) => { const c = E.templateCategories.templateCategory(r.key, r.template); return c === 'Blank' ? [] : [c]; },
    schema: (E) => E.characterSheetSchema,
    project: (r, ctx) => templateActor(r, ctx),
  },
  // ---- rules --------------------------------------------------------------------
  {
    name: 'handbook', label: { key: 'SHADOWBASE.Pack.Handbook', en: 'Handbook' }, type: 'JournalEntry', packFolder: 'rules',
    // Built by tools/build-handbook-pack.mjs from handbook/*.json (the website's public/handbook), not from a bundle table.
    builder: 'handbook',
    consumes: [],
    source: () => [],
    key: (r) => r.id,
    folderPlan: () => [],
    project: () => { throw new Error('pack-manifest: the handbook pack is built by tools/build-handbook-pack.mjs'); },
  },
];

export const packByName = (name) => PACKS.find((p) => p.name === name);
export const packNames = () => PACKS.map((p) => p.name);
/** Packs whose documents may not be dropped onto an actor (catalog picks, not inventory rows). */
export const REFERENCE_ONLY_CATALOGS = Object.freeze(PACKS.filter((p) => p.referenceOnly).map((p) => p.name));

/** Per-row Item type and zod schema (a few packs hold two kinds of row). */
export const itemTypeFor = (pack, row) => (pack.itemTypeOf ? pack.itemTypeOf(row) : pack.itemType);
export const schemaFor = (pack, row, E) => (pack.schemaOf ? pack.schemaOf(row, E) : pack.schema?.(E));
export const docNameFor = (pack, row, E) => (pack.docName ? pack.docName(row, E) : row.name);

// ---------------------------------------------------------------------------
// system.json packFolders (labels in en.json - keys requested from U05)
// ---------------------------------------------------------------------------

export const PACK_FOLDERS = Object.freeze([
  { id: 'traits', label: { key: 'SHADOWBASE.PackFolder.Traits', en: 'Traits' }, color: '#5b3a7a' },
  { id: 'abilities', label: { key: 'SHADOWBASE.PackFolder.Abilities', en: 'Skills & Abilities' }, color: '#2f5f8a' },
  { id: 'gear', label: { key: 'SHADOWBASE.PackFolder.Gear', en: 'Gear' }, color: '#6b5a2e' },
  { id: 'armor', label: { key: 'SHADOWBASE.PackFolder.Armor', en: 'Armor' }, color: '#4f5d6b' },
  { id: 'weapons', label: { key: 'SHADOWBASE.PackFolder.Weapons', en: 'Weapons' }, color: '#7a2f2f' },
  { id: 'cybernetics', label: { key: 'SHADOWBASE.PackFolder.Cybernetics', en: 'Cybernetics' }, color: '#2e6b5a' },
  { id: 'vessels', label: { key: 'SHADOWBASE.PackFolder.Vessels', en: 'Vehicles & Starships' }, color: '#3a5b7a' },
  { id: 'droids', label: { key: 'SHADOWBASE.PackFolder.Droids', en: 'Droids' }, color: '#5a5a5a' },
  { id: 'characters', label: { key: 'SHADOWBASE.PackFolder.Characters', en: 'Characters' }, color: '#7a5a2f' },
  { id: 'rules', label: { key: 'SHADOWBASE.PackFolder.Rules', en: 'Rules' }, color: '#2f7a4f' },
]);

/** The `packs` array system.json carries (English labels: Foundry shows pack labels verbatim). */
export function systemJsonPacks() {
  return PACKS.map((p) => ({
    name: p.name,
    label: p.label.en,
    path: `packs/${p.name}`,
    type: p.type,
    ...(p.type === 'JournalEntry' ? {} : { system: SYSTEM_ID }),
    ownership: { PLAYER: 'OBSERVER', ASSISTANT: 'OWNER' },
    flags: {},
  }));
}

/** The `packFolders` array system.json carries. */
export function systemJsonPackFolders() {
  return PACK_FOLDERS.map((f) => ({
    name: f.label.en,
    sorting: 'm',
    color: f.color,
    packs: PACKS.filter((p) => p.packFolder === f.id).map((p) => p.name),
  }));
}

// ---------------------------------------------------------------------------
// What is deliberately NOT a pack
// ---------------------------------------------------------------------------

/**
 * Bundle namespaces the pack sweep (check:packs) enumerates: every array-of-
 * objects export in these must be consumed by a pack or listed below. The
 * list is the "Catalogs" block of tools/engine-entry.ts plus the two catalogs
 * that live outside it (lightsaberForms, blueprintCatalog) and the gas grades.
 */
export const CATALOG_NAMESPACES = Object.freeze([
  'advantages', 'disadvantages', 'quirks', 'skills', 'forcePowers', 'combatTechniques', 'techniques', 'equipmentData', 'armorData',
  'armorPiecesData', 'armorPartsData', 'armorMods', 'rangedWeaponProfiles', 'rangedPartsData', 'meleeWeaponProfiles', 'meleePartsData',
  'lightsaberParts', 'lightsaberPreconstructed', 'ammunitionData', 'explosiveData', 'weaponModData', 'cyberneticsData', 'vehicleData',
  'starshipChassisData', 'starshipMods', 'starshipWeapons', 'droidData', 'speciesLanguages', 'templateCategories', 'readyToPlay',
  'blasterCommon', 'meleeCommon', 'lightsaberCommon', 'clothingCommon', 'lightsaberForms', 'blueprintCatalog', 'blasterGasGrades',
]);

/** `ns.export` -> why it is not a compendium. Every entry must exist in the bundle (check:packs). */
export const NOT_A_PACK = Object.freeze({
  'advantages.advantagesList': 'the per-level flattening of advantagesLibrary; the library (one entry per trait) is the pack source',
  'disadvantages.disadvantagesList': 'the per-level flattening of disadvantagesLibrary; the library is the pack source',
  'armorPiecesData.ARMOR_BASE_STATS': 'Ch13 derivation table (DR/volume per tier and location), a rule not an item',
  'armorPiecesData.ARMOR_CONDITION_STATES': 'condition ladder, a rule',
  'armorPiecesData.ARMOR_COVERAGE': 'hit-location coverage table, a rule',
  'armorPiecesData.ARMOR_MATERIALS': 'Ch13 materials feed armorItemFromPiece / the armor builder; the sellable stock is in equipment (Raw Materials)',
  'armorPiecesData.BELTS': 'flattened into ARMOR_DATA (type Utility) by the website generator - the armor pack carries them',
  'armorPiecesData.BELT_DATACARDS': 'belt datacards are component picks inside the belt builder',
  'armorPiecesData.BELT_HOUSINGS': 'belt housings are component picks inside the belt builder',
  'armorPiecesData.CARRY_FRAMES': 'carry frames are component picks inside the armor builder',
  'armorPiecesData.COORDINATED_CLOTHING_SETS': 'sets are dealt by the SuitsAndSets app (armorPieceItem / clothingCommon), not stored as items',
  'armorPiecesData.ENERGY_SHIELDS': 'flattened into ARMOR_DATA (type Energy Shield) - the armor pack carries them',
  'armorPiecesData.ENVIRONMENTAL_LAYERS': 'component picks inside the armor builder',
  'armorPiecesData.FACE_CLOTHING': 'flattened into ARMOR_DATA (Clothing, Face slot)',
  'armorPiecesData.FACE_DATACARDS': 'face-gadget component picks',
  'armorPiecesData.FACE_GADGETS': 'flattened into ARMOR_DATA (type Utility)',
  'armorPiecesData.FACE_MODIFICATIONS': 'face-gear construction picks',
  'armorPiecesData.FACE_PLATES': 'face-gear construction picks',
  'armorPiecesData.GEAR_SETS': 'sets are dealt by the SuitsAndSets app',
  'armorPiecesData.MECHANICAL_FACE_GEAR': 'flattened into ARMOR_DATA (type Utility)',
  'armorPiecesData.PRESET_SUITS': 'suits are dealt piece by piece by armorPieceItem.presetSuitItems (SuitsAndSets app)',
  'armorPiecesData.SHIELD_DATACARDS': 'energy-shield component picks',
  'armorPiecesData.SHIELD_HOUSINGS': 'energy-shield component picks',
  'armorPiecesData.SPECIALTY_ARMOR_SETS': 'sets are dealt by the SuitsAndSets app',
  'armorPiecesData.SPECIALTY_PIECES': 'flattened into ARMOR_DATA by the website generator',
  'armorPiecesData.UTILITY_GEAR': 'flattened into ARMOR_DATA (type Utility)',
  'armorPartsData.TRIM_MATERIALS': 'trim stock for the armor builder; not a sellable row',
  'cyberneticsData.PROSTHETIC_CHASSIS': 'prosthetic forge inputs (the built limbs are CYBERNETIC_LIMBS)',
  'cyberneticsData.PROSTHETIC_COMPONENTS': 'prosthetic forge inputs',
  'lightsaberParts.allLibraryParts': 'consumed as internals by lightsaber-parts (listed in consumes); kept here for the sweep denominator',
  'speciesLanguages.SPECIES_LANGUAGES': 'language rows are generated onto the sheet by languageRows from the species, never picked',
  'templateCategories.TEMPLATE_CATEGORY_ORDER': 'folder order for the templates pack, not documents',
  'blasterGasGrades.GAS_GRADES': 'a property of loaded ammunition (gasGrade), chosen per pack at reload, not an item',
  'weaponModData.MELEE_MOD_CATEGORIES': 'category names',
  'weaponModData.RANGED_MOD_CATEGORIES': 'category names',
  'armorPartsData.ARMOR_FRAMES': 'enumeration',
  'armorPartsData.ARMOR_LOCATIONS': 'enumeration',
  'armorPartsData.ARMOR_PART_CATEGORIES': 'enumeration',
  'armorPartsData.ARMOR_TIERS': 'enumeration',
});

export { defaultEngine as engine, unwrap };
export default PACKS;
