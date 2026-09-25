// module/data/item-base.mjs
//
// ShadowBaseItemData - the TypeDataModel every one of the 21 Item types shares
// (docs/ARCHITECTURE.md §4.2). The website row is stored VERBATIM under
// `row`; `source` names the website array it came from; the rest is
// compendium bookkeeping.
//
// prepareDerivedData() runs the family's derivation THROUGH THE BUNDLE and
// stores the result on `this.derived` - never on `row`, never in `_source`
// (check:derived-not-stored). `derived.persistedFields` is the exact set of
// keys the website's card hook writes back onto the row on mount, so that
// module/adapter.mjs can lay them over the row before the engine reads it:
//
//   blaster     use-blaster-calculations.ts   every key of calculateBlasterStats(), plus
//                                             `durability` (trackedDurability) and the
//                                             `baseType`/`baseSkill` reclassification
//   armor       use-armor-calculations.ts     finalDRValue, finalWeight, finalCost,
//                                             finalMovePenalty, finalDXPenalty, notesAndEffects,
//                                             condition, and the power-cell charge coordination
//   starship    use-starship-calculations.ts  finalHandling, finalSpeed, finalHp, finalDr,
//                                             finalHyperdrive, finalCost, finalNotesAndEffects,
//                                             systems (initial/merge), armaments
//   melee       (unit U01) calculateMeleeWeaponStats  - guarded until the export lands
//   lightsaber  (unit U01) calculateLightsaberStats   - guarded until the export lands
//
// Melee needs the OWNER's stats (effective ST and the ST specialisation levels
// - the hook's own parameters, use-melee-weapon-calculations.ts), which do not
// exist yet when items prepare; the actor model re-runs these items after its
// first pass (module/data/actor-character.mjs) - see DERIVES_FROM_OWNER_STATS.

import { engine } from '../engine.mjs';
import { ITEM_TYPES, WEAPON_PART_FAMILIES } from '../config.mjs';
import { rowsOf, itemToRow } from '../adapter.mjs';

/**
 * Keys the lightsaber hook writes back (use-lightsaber-item.ts `coreKeys`; the
 * website exports the same list as LIGHTSABER_CORE_KEYS from lightsaber-stats.ts).
 * Informational: calculateLightsaberStats returns exactly these plus the tracked
 * durabilities, and _deriveLightsaber persists whatever it returns.
 */
export const LIGHTSABER_PERSISTED_KEYS = Object.freeze([
  'calculatedDamage', 'calculatedDamageTwo', 'totalCost', 'finalWeight', 'finalParryMod', 'energyRes', 'energyResTwo',
  'classType', 'combinedEffects', 'condition', 'conditionTwo', 'maxDurability', 'maxDurabilityTwo', 'crystalAttackPenalty', 'powerCellMaxCharge',
]);

/** Keys the armor hook writes back (use-armor-calculations.ts `syncMap`). */
export const ARMOR_PERSISTED_KEYS = Object.freeze(['finalDRValue', 'finalWeight', 'finalCost', 'finalMovePenalty', 'finalDXPenalty', 'notesAndEffects', 'condition']);

/** Keys the starship hook writes back (use-starship-calculations.ts). */
export const STARSHIP_PERSISTED_KEYS = Object.freeze(['finalHandling', 'finalSpeed', 'finalHp', 'finalDr', 'finalHyperdrive', 'finalCost', 'finalNotesAndEffects', 'systems', 'armaments']);

const warned = new Set();
/** Warn once per message (a missing U01 export would otherwise log on every prepare of every actor). */
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`shadowbase | ${message}`);
}

export class ShadowBaseItemData extends foundry.abstract.TypeDataModel {
  /** The Item type this model backs; subclasses set it (module/data/item-types.mjs). */
  static TYPE = null;

  static get CONFIG() {
    const cfg = ITEM_TYPES[this.TYPE];
    if (!cfg) throw new Error(`${this.name}: TYPE "${this.TYPE}" is not in CONFIG.SHADOWBASE.ITEM_TYPES`);
    return cfg;
  }

  /** The website array this type's rows live in. */
  static get SOURCE() { return this.CONFIG.source; }
  /** Every array this type may carry (weaponPart: two). */
  static get SOURCES() { return this.CONFIG.sources; }
  /** The bundle derivation family, or null. */
  static get FAMILY() { return this.CONFIG.family; }
  /** True when the derivation reads the owner's calculated stats (melee weapons). */
  static get DERIVES_FROM_OWNER_STATS() { return this.CONFIG.family === 'melee'; }

  static defineSchema() {
    const f = foundry.data.fields;
    return {
      row: new f.ObjectField({ required: true, nullable: false, initial: () => ({}) }),
      source: new f.StringField({ required: true, nullable: false, blank: false, initial: this.SOURCE, choices: [...this.SOURCES] }),
      // weaponPart only: which export array a part belongs to. Declared on every type so the
      // schema is one shape; null everywhere else.
      family: new f.StringField({ required: true, nullable: true, blank: false, initial: null, choices: Object.keys(WEAPON_PART_FAMILIES) }),
      // Compendium kits only ({ weapon, parts[], ammunition[] } from blasterCommon.buildTemplateBlaster & co).
      kit: new f.ObjectField({ required: true, nullable: true, initial: null }),
      // Compendium powers/techniques/forms only: the catalog's per-level rows for this NAME.
      levels: new f.ArrayField(new f.ObjectField({ required: true, nullable: false }), { required: true, nullable: false, initial: [] }),
      // The pack/catalog a compendium item came from.
      catalog: new f.StringField({ required: true, nullable: true, blank: false, initial: null }),
    };
  }

  /** The owning actor, or null for a world/compendium item. */
  get owner() {
    const item = this.parent;
    return item?.actor ?? (item?.parent?.documentName === 'Actor' ? item.parent : null) ?? null;
  }

  /** Plain rows of one of the owner's arrays (empty for an unowned item, ARCHITECTURE.md §4.2). */
  ownerRows(source) {
    const owner = this.owner;
    return owner ? rowsOf(owner, source).map(itemToRow) : [];
  }

  prepareBaseData() {
    // weaponPart: `source` follows `family` (the family is what the sheet edits).
    if (this.constructor.TYPE === 'weaponPart') {
      if (this.family && WEAPON_PART_FAMILIES[this.family]) this.source = WEAPON_PART_FAMILIES[this.family];
      else this.family = this.source === WEAPON_PART_FAMILIES.lightsaber ? 'lightsaber' : 'weapon';
    }
    this.derived = null;
    this.derivedError = null;
  }

  prepareDerivedData() {
    try {
      this.derived = this._derive();
    } catch (err) {
      this.derived = null;
      this.derivedError = err.message;
      warnOnce(`derive:${this.constructor.TYPE}:${err.message}`, `${this.constructor.TYPE} derivation failed for "${this.parent?.name}": ${err.message}`);
    }
  }

  /** @returns {object|null} the family's derived stats with a `persistedFields` bag, or null */
  _derive() {
    switch (this.constructor.FAMILY) {
      case 'blaster': return this._deriveBlaster();
      case 'armor': return this._deriveArmor();
      case 'starship': return this._deriveStarship();
      case 'melee': return this._deriveMelee();
      case 'lightsaber': return this._deriveLightsaber();
      default: return null;
    }
  }

  _deriveBlaster() {
    const row = this.row;
    const mods = this.ownerRows('weaponModifications');
    const result = engine.calculateBlasterStats(row, mods);
    if (!result) return null;
    // The hook writes EVERY returned key when it differs (use-blaster-calculations.ts).
    const persistedFields = { ...result };
    // Then the first measurement / tracked maximum (durability-tracking.ts holds the rule for all three families).
    const targetMax = result.maxDurability ?? row.maxDurability ?? 0;
    const nextDur = engine.durabilityTracking.trackedDurability(row.durability, targetMax, row.isConstructed);
    if (nextDur !== undefined) persistedFields.durability = nextDur;
    // Then family and skill follow the fitted parts (ruled 2026-08-28; null when they already agree).
    const reclass = engine.rangedAssembly.rangedReclassification(row, mods);
    if (reclass) { persistedFields.baseType = reclass.family; persistedFields.baseSkill = reclass.skill; }
    return { ...result, persistedFields };
  }

  _deriveArmor() {
    const row = this.row;
    const owner = this.owner;
    const mods = this.ownerRows('armorModifications');
    const sm = owner?.system?.sizeModifier ?? 0;
    const hitLocations = owner?.system?.hitLocations ?? [];
    const result = engine.calculateModifiedArmor(row, mods, sm, hitLocations);
    if (!result) return null;
    const persistedFields = {
      finalDRValue: result.finalDRValue,
      finalWeight: result.finalWeight,
      finalCost: result.finalCost,
      finalMovePenalty: result.finalMovePenalty,
      finalDXPenalty: result.finalDXPenalty,
      notesAndEffects: result.notesAndEffects,
      condition: result.derivedCondition,
    };
    // Power-cell charge coordination (use-armor-calculations.ts): only meaningful with an owner's equipment to read.
    if (owner) {
      if (row.loadedPowerCellId) {
        const cell = this.ownerRows('equipment').find((e) => e?.id === row.loadedPowerCellId);
        if (cell) {
          persistedFields.currentCharges = cell.currentCharges ?? 100;
          persistedFields.maxCharges = cell.maxCharges ?? 100;
        }
      } else {
        persistedFields.currentCharges = 0;
      }
    }
    return { ...result, persistedFields };
  }

  _deriveStarship() {
    const row = this.row;
    const sd = engine.starshipDerivation;
    const d = sd.deriveStarship(row);
    if (!d) return null;
    const readouts = sd.formatStarshipReadouts(d);
    const existing = row.systems;
    const systems = (!Array.isArray(existing) || existing.length === 0)
      ? sd.initialSystems(d.finalHp, d.finalDr)
      : sd.mergeSystems(existing, d.finalHp, d.finalDr);
    const persistedFields = { ...readouts, systems, armaments: d.armaments };
    return { ...d, readouts, persistedFields };
  }

  _deriveMelee() {
    if (!engine.hasExport('calculateMeleeWeaponStats')) {
      warnOnce('missing:calculateMeleeWeaponStats', 'calculateMeleeWeaponStats is not in the engine bundle yet (unit U01); melee weapons keep their stored figures');
      return null;
    }
    const owner = this.owner;
    const stats = owner?.system?.derived;
    // Before the owner's first pass there are no stats to derive against; the actor re-runs us after it.
    if (owner && !stats) return null;
    const st = stats
      ? {
        effectiveStrength: stats.primaryAttributes.effectiveStrength,
        damageStLevels: stats.primaryAttributes.damageStLevels,
        twoHandedStLevels: stats.primaryAttributes.twoHandedStLevels,
        useStrikingST: owner.system.useStrikingST ?? true,
      }
      : { effectiveStrength: engine.coreStats.BASE_ATTRIBUTE_VALUE, damageStLevels: 0, twoHandedStLevels: 0, useStrikingST: true };
    const result = engine.requireExport('calculateMeleeWeaponStats')(this.row, this.ownerRows('weaponModifications'), st);
    if (!result) return null;
    // U01's contract (docs/REQUESTS.md): the return IS the hook's `updates` bag with the
    // no-components deletions applied - a key ABSENT means the card did not write it.
    const persistedFields = { ...result };
    return { ...result, persistedFields };
  }

  _deriveLightsaber() {
    if (!engine.hasExport('calculateLightsaberStats')) {
      warnOnce('missing:calculateLightsaberStats', 'calculateLightsaberStats is not in the engine bundle yet (unit U01); lightsabers keep their stored figures');
      return null;
    }
    const row = this.row;
    const result = engine.requireExport('calculateLightsaberStats')(row, this.ownerRows('lightsaberModifications'));
    if (!result) return null;
    // U01's contract (docs/REQUESTS.md): the return IS the hook's write-back - the 15
    // core keys plus durability/durabilityTwo only when tracking moved them. Every
    // returned key is persisted; nothing is re-tracked here.
    const persistedFields = { ...result };
    return { ...result, persistedFields };
  }
}

export default ShadowBaseItemData;
