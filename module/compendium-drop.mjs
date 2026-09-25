// module/compendium-drop.mjs
//
// What happens when a ShadowBase compendium document lands on an actor
// (docs/ARCHITECTURE.md §7 "Compendium drop"). Every path here is the
// website's own "Add from library" path, run through the bundle:
//
//   kit (ranged / melee weapon, lightsaber)   the weapon + its part rows, re-keyed and
//                                             rebound the way itemTransfer.parseImport
//                                             re-keys an imported item envelope (fresh
//                                             uuids, host references rebound);
//   per-name power / technique / form         the Level 1 row (system.row); the sheet's
//                                             level control re-reads system.levels;
//   skill                                     the row with `level` seeded at the charging
//                                             level (baseChargedLevelForSkill over the
//                                             OWNER's skillPricingAttributes - the
//                                             compendium row cannot know them);
//   armor (catalog 'armor')                   re-projected from ARMOR_DATA by name with the
//                                             actor's anatomy and SM, so a Gauntlets or
//                                             Boots row splits per limb (profileToArmorItem);
//   armor (catalog 'armor-pieces')            rebuilt from ARMOR_PIECES by pieceId for the
//                                             actor's SM and anatomy (armorItemFromPiece +
//                                             ensureCompleteArmorItem);
//   implants / limbs / upgrades               `installed: false` / `equipped: false` and the
//                                             wearer's itemSizeModifier, as the section does;
//   everything else                           itemTransfer.sanitiseForImport (fresh id,
//                                             placement cleared);
//   a template Actor                          the whole sheet through actor.importSheet
//                                             (applyLoadMigrations, then the adapter).
//
// Two entry points, both the sheet's own. `handleItemDrop(actor, item)` /
// `handleActorDrop(actor, droppedActor)` are what the actor sheet (unit U05)
// calls from its own _onDropItem / _onDropActor - the v13 ApplicationV2 drop
// route (module/apps/actor-sheet.mjs). There is deliberately NO
// `dropActorSheetData` hook: that hook is Application-V1 only and a v13
// ActorSheetV2 never fires it (it routes drops through _onDrop* instead), so a
// registration would be dead code; the character sheet is the only actor sheet
// this system ships and it handles every catalog / kit / template drop through
// _onDrop* directly. A world Item that is not a catalog item still takes
// Foundry's default drop path inside those handlers.
//
// Nothing here writes a rule: dedupe is the website's (advantageAllowsDuplicates,
// conflictingNamesFor, isQuirkLimitExceeded), levels are the catalog's, prices
// were fixed when the pack was built.

import { engine } from './engine.mjs';
import { actorToSheet, rowToItemData, nextSort, itemNameFor } from './adapter.mjs';
import { ITEM_TYPES, WEAPON_PART_FAMILIES } from './config.mjs';

/** Catalogs whose documents are browse-only (catalog picks, not inventory rows); see tools/pack-manifest.mjs. */
export const REFERENCE_ONLY_CATALOGS = Object.freeze(new Set(['starship-mods', 'starship-weapons']));

/** Item type -> the item-transfer kind whose parts closure parseImport rebinds (item-transfer.ts PARTS_SOURCES). */
export const KIT_KINDS = Object.freeze({ blaster: 'customBlaster', meleeWeapon: 'customMeleeWeapon', lightsaber: 'lightsaber' });
/** Kit parts live in the weapon family's modification array (ARCHITECTURE §4.2). */
const KIT_PART_SOURCE = Object.freeze({ blaster: WEAPON_PART_FAMILIES.weapon, meleeWeapon: WEAPON_PART_FAMILIES.weapon, lightsaber: WEAPON_PART_FAMILIES.lightsaber });

const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const notify = (level, key, data) => globalThis.ui?.notifications?.[level]?.(loc(key, data));
const clone = (v) => foundry.utils.deepClone(v);

/** True for a drop payload that names a ShadowBase compendium document. */
export function isCompendiumUuid(uuid) {
  return typeof uuid === 'string' && uuid.startsWith(`Compendium.${game.system.id}.`);
}

/** A ShadowBase catalog item: it came from one of our packs (or was copied from one). */
export function isCatalogItem(item) {
  return !!(item?.system && (item.system.catalog || item.system.kit || (Array.isArray(item.system.levels) && item.system.levels.length)));
}

/** The actor's current row names for a source (dedupe reads names, as the website's sections do). */
const namesOf = (actor, source) => new Set(actor.rowsOf(source).map((i) => i.system?.row?.name).filter(Boolean));

/**
 * Plan the Item creation data for one dropped catalog Item. Pure: reads the
 * actor and the item, returns { items: [creation data], notices: [i18n key] }.
 * A plan with no items and a notice is a refusal the caller should show.
 * @param {object} actor a ShadowBaseActor
 * @param {object} item the dropped Item document (compendium or world)
 */
export function planItemDrop(actor, item) {
  const type = item.type;
  const cfg = ITEM_TYPES[type];
  if (!cfg) return { items: [], notices: [] };
  const sys = item.system ?? {};
  const row = clone(sys.row ?? {});
  const catalog = sys.catalog ?? null;
  const sm = Number(actor.system?.sizeModifier ?? 0) || 0;
  const hitLocations = actor.system?.hitLocations ?? [];
  const IT = engine.itemTransfer;
  const out = [];
  const notices = [];
  const push = (r, source, extra = {}) => {
    // rowToItemData names the datum through adapter.itemNameFor (customName / name / baseExplosiveName ...).
    const datum = rowToItemData(r, source, nextSort(actor, source) + out.length);
    if (catalog) datum.system.catalog = catalog;
    Object.assign(datum.system, extra);
    out.push(datum);
  };

  if (catalog && REFERENCE_ONLY_CATALOGS.has(catalog)) {
    return { items: [], notices: [['SHADOWBASE.Drop.ReferenceOnly', { name: item.name }]] };
  }

  // ---- kits: the website's item-envelope import re-keys and rebinds the closure ----------------------
  if (sys.kit && KIT_KINDS[type]) {
    const kind = KIT_KINDS[type];
    const partSource = KIT_PART_SOURCE[type];
    const kit = clone(sys.kit);
    const oldHostId = String(kit.weapon?.id ?? '');
    const envelope = IT.buildEnvelope(kind, kit.weapon, undefined, { [partSource]: kit.parts ?? [], ...(kit.ammunition?.length ? { ammunition: kit.ammunition } : {}) });
    const result = IT.parseImport(JSON.stringify(envelope), kind);
    if (!result.ok) return { items: [], notices: [['SHADOWBASE.Drop.KitFailed', { name: item.name, reason: result.message }]] };
    const weapon = result.item;
    // A launcher's pre-installed Power Cell is a general-equipment row the envelope does not carry
    // (item-transfer.ts PARTS_SOURCES lists weaponModifications and ammunition only); rebind it by hand.
    const equipment = (kit.equipment ?? []).map((cell) => {
      const id = engine.rowId();
      if (weapon.loadedAmmunitionId === cell.id) {
        weapon.loadedAmmunitionId = id;
        if (weapon.loadedAmmunitionData?.id === cell.id) weapon.loadedAmmunitionData = { ...weapon.loadedAmmunitionData, id };
      }
      return { ...cell, id, installedInBlasterId: cell.installedInBlasterId === oldHostId ? weapon.id : cell.installedInBlasterId };
    });
    push(weapon, cfg.source);
    for (const [field, rows] of Object.entries(result.parts ?? {})) for (const part of rows) push(part, field);
    for (const cell of equipment) push(cell, 'equipment');
    if (result.partsMissing) notices.push(['SHADOWBASE.Drop.KitPartsMissing', { name: item.name }]);
    return { items: out, notices };
  }

  // ---- per-name abilities: the Level 1 row; the sheet's level control reads system.levels ---------------
  if (cfg.perName) {
    const key = type === 'combatTechnique' ? `${row.category}-${row.name}` : row.name;
    const existing = type === 'combatTechnique'
      ? new Set(actor.rowsOf(cfg.source).map((i) => `${i.system?.row?.category}-${i.system?.row?.name}`))
      : namesOf(actor, cfg.source);
    if (existing.has(key)) return { items: [], notices: [['SHADOWBASE.Drop.AlreadyKnown', { name: item.name }]] };
    push({ ...row, baselinePoints: row.baselinePoints ?? 0 }, cfg.source, { levels: clone(sys.levels ?? []) });
    return { items: out, notices };
  }

  switch (type) {
    case 'skill': {
      const held = actor.rowsOf('skills').map((i) => i.system?.row?.name).filter(Boolean);
      if (held.includes(row.name)) return { items: [], notices: [['SHADOWBASE.Drop.AlreadyKnown', { name: item.name }]] };
      // Ch3's "one name or the other, never both" (melee-weapon-equivalence.ts), as the section refuses.
      if (engine.meleeWeaponEquivalence.conflictingNamesFor(row.name, held).length > 0) return { items: [], notices: [['SHADOWBASE.Drop.SkillConflict', { name: item.name }]] };
      const pricing = actor.stats?.skillPricingAttributes;
      const charged = pricing ? engine.baseChargedLevelForSkill(row.relativeLevel, pricing) : null;
      push({ ...row, level: String(charged ?? ''), points: row.points ?? null, notes: row.notes ?? '', baselinePoints: 0 }, 'skills');
      return { items: out, notices };
    }
    case 'advantage': {
      if (namesOf(actor, 'advantages').has(row.name) && !engine.enhancedDefenses.advantageAllowsDuplicates(row.name)) return { items: [], notices: [['SHADOWBASE.Drop.AlreadyKnown', { name: item.name }]] };
      push({ ...row, baselinePoints: 0 }, 'advantages');
      return { items: out, notices };
    }
    case 'disadvantage': {
      if (namesOf(actor, 'disadvantages').has(row.name)) return { items: [], notices: [['SHADOWBASE.Drop.AlreadyKnown', { name: item.name }]] };
      push({ ...row, baselinePoints: 0 }, 'disadvantages');
      return { items: out, notices };
    }
    case 'quirk': {
      if (namesOf(actor, 'quirks').has(row.name)) return { items: [], notices: [['SHADOWBASE.Drop.AlreadyKnown', { name: item.name }]] };
      // Ch6's cap counts rows (quirks/index.ts isQuirkLimitExceeded(rows)); the row about to land is counted.
      const quirks = actor.rowsOf('quirks').map((i) => i.system?.row);
      if (engine.quirks.isQuirkLimitExceeded([...quirks, row])) return { items: [], notices: [['SHADOWBASE.Drop.QuirkLimit', { max: engine.quirks.MAX_QUIRKS }]] };
      push({ ...row, baselinePoints: 0 }, 'quirks');
      return { items: out, notices };
    }
    case 'armor': {
      // The CATALOG decides the path, not the row's pieceId: ARMOR_DATA's preset-suit rows carry a
      // pieceId too (armor-profile-item.ts "The preset-suit rows in this library ARE Chapter 13
      // Pieces"), and rebuilding one from its Piece renames it ("Heavy Hand Plate (Beskar)") and
      // loses the per-limb split the profile path performs (check:packs pins the two rows).
      const byPiece = () => {
        const piece = engine.armorPiecesData.ARMOR_PIECES.find((p) => p.id === row.pieceId);
        if (!piece) return false;
        push(engine.ensureCompleteArmorItem(engine.armorPieceItem.armorItemFromPiece(piece, { itemSizeModifier: sm }), hitLocations), 'armor');
        return true;
      };
      const byProfile = () => {
        const profile = engine.armorData.ARMOR_DATA.find((p) => p.name === row.name);
        if (!profile) return false;
        for (const r of engine.armorProfileItem.profileToArmorItem(profile, 1, hitLocations, sm)) push(r, 'armor');
        return true;
      };
      if (catalog === 'armor-pieces' ? (byPiece() || byProfile()) : (byProfile() || byPiece())) return { items: out, notices };
      // Not a catalog profile (a renamed world item): keep the row, cut it to the wearer.
      push({ ...IT.sanitiseForImport(row), itemSizeModifier: sm }, 'armor');
      return { items: out, notices };
    }
    case 'implant':
      push({ ...IT.sanitiseForImport(row), installed: false, itemSizeModifier: sm }, 'implants');
      return { items: out, notices };
    case 'cyberneticLimb':
      push({ ...IT.sanitiseForImport(row), installed: false, itemSizeModifier: sm }, 'cybernetics');
      return { items: out, notices };
    case 'cyberneticUpgrade':
      push({ ...IT.sanitiseForImport(row), equipped: false, itemSizeModifier: sm }, 'cyberneticUpgrades');
      return { items: out, notices };
    case 'weaponPart': {
      const source = sys.family && WEAPON_PART_FAMILIES[sys.family] ? WEAPON_PART_FAMILIES[sys.family] : (sys.source ?? cfg.source);
      push(IT.sanitiseForImport(row), source);
      return { items: out, notices };
    }
    default:
      // equipment (incl. blueprints, droid parts, materials), ammunition, explosive, armorPart, starship, vehicle
      push(IT.sanitiseForImport(row), sys.source ?? cfg.source);
      return { items: out, notices };
  }
}

/**
 * Create the planned Items on the actor and show the plan's notices.
 * @returns {Promise<object[]>} the created Item documents (empty when refused)
 */
export async function handleItemDrop(actor, item) {
  const plan = planItemDrop(actor, item);
  for (const [key, data] of plan.notices) notify(plan.items.length ? 'info' : 'warn', key, data);
  if (!plan.items.length) return [];
  const created = await actor.createEmbeddedDocuments('Item', plan.items);
  notify('info', 'SHADOWBASE.Drop.Added', { name: item.name, count: created.length });
  return created;
}

/**
 * A template Actor dropped onto an actor sheet replaces that actor's sheet
 * with the template (the website's "Template Applied"), after confirmation.
 * The template is a full Foundry actor; its sheet is composed back through
 * the adapter and loaded through importSheet (applyLoadMigrations).
 */
export async function handleActorDrop(actor, droppedActor, { confirm = true } = {}) {
  if (droppedActor?.type !== 'character' || droppedActor === actor) return false;
  if (confirm) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc('SHADOWBASE.Drop.TemplateConfirmTitle') },
      content: `<p>${loc('SHADOWBASE.Drop.TemplateConfirmBody', { template: droppedActor.name, actor: actor.name })}</p>`,
      rejectClose: false,
      modal: true,
    });
    if (!ok) return false;
  }
  const sheet = actorToSheet(droppedActor);
  const { notices } = await actor.importSheet(sheet, { mode: 'replace', keepName: true });
  notify('info', 'SHADOWBASE.Drop.TemplateApplied', { template: droppedActor.name, actor: actor.name });
  return { notices };
}

/** The display name a planned row will carry (for callers that list a plan before creating it). */
export const plannedName = (datum) => itemNameFor(datum.system?.row, datum.type);

export default { planItemDrop, handleItemDrop, handleActorDrop, isCompendiumUuid, isCatalogItem, REFERENCE_ONLY_CATALOGS, KIT_KINDS };
