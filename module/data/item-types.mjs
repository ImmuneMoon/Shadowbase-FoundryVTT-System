// module/data/item-types.mjs
//
// The 21 Item data models (docs/ARCHITECTURE.md §4.2 table), one subclass of
// ShadowBaseItemData each. A subclass is only its TYPE: the website array it
// stores, its derivation family and its icon all come from the one registry in
// module/config.mjs (ITEM_TYPES), so a type cannot drift from its source.
//
// ITEM_DATA_MODELS is what module/shadowbase.mjs assigns to CONFIG.Item.dataModels.

import { ShadowBaseItemData } from './item-base.mjs';
import { ITEM_TYPE_NAMES } from '../config.mjs';

// ---- traits (row projected onto the trait schema on export) ----
export class AdvantageData extends ShadowBaseItemData { static TYPE = 'advantage'; }
export class DisadvantageData extends ShadowBaseItemData { static TYPE = 'disadvantage'; }
export class QuirkData extends ShadowBaseItemData { static TYPE = 'quirk'; }
// ---- skills (row.level is a STRING, as on the website) ----
export class SkillData extends ShadowBaseItemData { static TYPE = 'skill'; }
// ---- abilities (compendium items are per NAME with system.levels[]) ----
export class ForcePowerData extends ShadowBaseItemData { static TYPE = 'forcePower'; }
export class CombatTechniqueData extends ShadowBaseItemData { static TYPE = 'combatTechnique'; }
export class LightsaberFormData extends ShadowBaseItemData { static TYPE = 'lightsaberForm'; }
// ---- gear ----
export class EquipmentData extends ShadowBaseItemData { static TYPE = 'equipment'; }
export class ArmorData extends ShadowBaseItemData { static TYPE = 'armor'; }
export class BlasterData extends ShadowBaseItemData { static TYPE = 'blaster'; }
export class MeleeWeaponData extends ShadowBaseItemData { static TYPE = 'meleeWeapon'; }
export class LightsaberData extends ShadowBaseItemData { static TYPE = 'lightsaber'; }
export class ExplosiveData extends ShadowBaseItemData { static TYPE = 'explosive'; }
export class AmmunitionData extends ShadowBaseItemData { static TYPE = 'ammunition'; }
export class WeaponPartData extends ShadowBaseItemData { static TYPE = 'weaponPart'; }
export class ArmorPartData extends ShadowBaseItemData { static TYPE = 'armorPart'; }
// ---- cybernetics ----
export class ImplantData extends ShadowBaseItemData { static TYPE = 'implant'; }
export class CyberneticLimbData extends ShadowBaseItemData { static TYPE = 'cyberneticLimb'; }
export class CyberneticUpgradeData extends ShadowBaseItemData { static TYPE = 'cyberneticUpgrade'; }
// ---- vessels (both export into inventory.starships; a row with baseChassis is a starship) ----
export class StarshipData extends ShadowBaseItemData { static TYPE = 'starship'; }
export class VehicleData extends ShadowBaseItemData { static TYPE = 'vehicle'; }

/** type -> data model, for CONFIG.Item.dataModels. */
export const ITEM_DATA_MODELS = Object.freeze({
  advantage: AdvantageData,
  disadvantage: DisadvantageData,
  quirk: QuirkData,
  skill: SkillData,
  forcePower: ForcePowerData,
  combatTechnique: CombatTechniqueData,
  lightsaberForm: LightsaberFormData,
  equipment: EquipmentData,
  armor: ArmorData,
  blaster: BlasterData,
  meleeWeapon: MeleeWeaponData,
  lightsaber: LightsaberData,
  explosive: ExplosiveData,
  ammunition: AmmunitionData,
  weaponPart: WeaponPartData,
  armorPart: ArmorPartData,
  implant: ImplantData,
  cyberneticLimb: CyberneticLimbData,
  cyberneticUpgrade: CyberneticUpgradeData,
  starship: StarshipData,
  vehicle: VehicleData,
});

// The registry and the models must name the same 21 types; a mismatch is a load-time error, not a sheet bug.
{
  const models = Object.keys(ITEM_DATA_MODELS);
  const missing = ITEM_TYPE_NAMES.filter((t) => !models.includes(t));
  const extra = models.filter((t) => !ITEM_TYPE_NAMES.includes(t));
  if (missing.length || extra.length) throw new Error(`item-types.mjs: models and CONFIG.SHADOWBASE.ITEM_TYPES disagree (missing ${missing.join(',') || '-'}; extra ${extra.join(',') || '-'})`);
  for (const [type, Model] of Object.entries(ITEM_DATA_MODELS)) if (Model.TYPE !== type) throw new Error(`item-types.mjs: ${Model.name}.TYPE is "${Model.TYPE}", registered as "${type}"`);
}

export default ITEM_DATA_MODELS;
