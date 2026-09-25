// module/apps/item-sheets/index.mjs
//
// The item sheets by Item type (docs/ARCHITECTURE.md §6.4) and their
// registration (foundry.documents.collections.Items.registerSheet, one call
// per family with the types it serves - Foundry v13.341+ registers no default
// Item sheet, so every type needs one). module/shadowbase.mjs calls
// registerItemSheets() from registerSheets(); the headless checks call the
// same function and read the recorded registrations back.

import { ITEM_TYPE_NAMES } from '../../config.mjs';
import { ShadowBaseItemSheet } from './base.mjs';
import { TraitSheet } from './trait.mjs';
import { SkillSheet } from './skill.mjs';
import { PowerSheet } from './power.mjs';
import { EquipmentSheet } from './equipment.mjs';
import { ArmorSheet } from './armor.mjs';
import { BlasterSheet } from './blaster.mjs';
import { MeleeSheet } from './melee.mjs';
import { LightsaberSheet } from './lightsaber.mjs';
import { ExplosiveSheet } from './explosive.mjs';
import { AmmunitionSheet } from './ammunition.mjs';
import { PartSheet } from './part.mjs';
import { CyberneticSheet } from './cybernetic.mjs';
import { StarshipSheet } from './starship.mjs';
import { VehicleSheet } from './vehicle.mjs';
import * as builders from './builders.mjs';

export const SYSTEM_ID = 'shadowbase';

/** Item type -> sheet class (every one of the 21 types; index.mjs throws at import when one is missing). */
export const ITEM_SHEETS = Object.freeze({
  advantage: TraitSheet, disadvantage: TraitSheet, quirk: TraitSheet,
  skill: SkillSheet,
  forcePower: PowerSheet, combatTechnique: PowerSheet, lightsaberForm: PowerSheet,
  equipment: EquipmentSheet,
  armor: ArmorSheet,
  blaster: BlasterSheet,
  meleeWeapon: MeleeSheet,
  lightsaber: LightsaberSheet,
  explosive: ExplosiveSheet,
  ammunition: AmmunitionSheet,
  weaponPart: PartSheet, armorPart: PartSheet,
  implant: CyberneticSheet, cyberneticLimb: CyberneticSheet, cyberneticUpgrade: CyberneticSheet,
  starship: StarshipSheet,
  vehicle: VehicleSheet,
});

{
  const missing = ITEM_TYPE_NAMES.filter((t) => typeof ITEM_SHEETS[t] !== 'function');
  if (missing.length) throw new Error(`item-sheets/index.mjs: no sheet for Item type(s) ${missing.join(', ')}`);
}

/** The sheet classes by family name (for game.shadowbase.apps and the renderer). */
export const ITEM_SHEET_CLASSES = Object.freeze({
  ShadowBaseItemSheet, TraitSheet, SkillSheet, PowerSheet, EquipmentSheet, ArmorSheet, BlasterSheet, MeleeSheet, LightsaberSheet, ExplosiveSheet, AmmunitionSheet, PartSheet, CyberneticSheet, StarshipSheet, VehicleSheet,
});

/**
 * Register one sheet per family for the types it serves.
 * @param {object} [collections] foundry.documents.collections (resolved late for the headless shim)
 * @returns {Array<{ cls: Function, types: string[] }>} what was registered
 */
export function registerItemSheets(collections = globalThis.foundry?.documents?.collections) {
  const Items = collections?.Items;
  if (!Items || typeof Items.registerSheet !== 'function') throw new Error('registerItemSheets: foundry.documents.collections.Items.registerSheet is not available');
  const byClass = new Map();
  for (const type of ITEM_TYPE_NAMES) {
    const cls = ITEM_SHEETS[type];
    (byClass.get(cls) ?? byClass.set(cls, []).get(cls)).push(type);
  }
  const registered = [];
  for (const [cls, types] of byClass) {
    Items.registerSheet(SYSTEM_ID, cls, { types, makeDefault: true, label: `SHADOWBASE.Item.Sheet.${cls.FAMILY}` });
    registered.push({ cls, types });
  }
  return registered;
}

export { builders };
export default { ITEM_SHEETS, ITEM_SHEET_CLASSES, registerItemSheets, builders };
