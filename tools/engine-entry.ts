// Entry point of the ShadowBase engine bundle (built by tools/build-engine.mjs).
//
// Everything the Foundry system needs from the website is re-exported here and
// NOTHING is re-implemented on the Foundry side. Two styles:
//   - flat exports for the handful of functions the system calls on every
//     render or roll (the engine, the load path, the roll table, the adapters'
//     helpers);
//   - namespace exports (one per website module) for catalogs, builders and
//     rule helpers, so a name collision between two website modules can never
//     silently drop an export the way `export *` would.
//
// Modules that touch window/localStorage/document at import time (UI state,
// toasts, roll history, sheet preferences, sheet navigation) are deliberately
// absent. If a build starts pulling one in, the entry is wrong, not the stub.

// ---- The engine and its load path ------------------------------------------
export { getCalculatedStats, isWeaponTwoHanded } from '@/hooks/use-character-calculations';
export * from '@/hooks/calculation-helpers';
export { applyLoadMigrations } from '@/lib/load-sheet';
export { convertJsonToSheet } from '@/lib/utils/character-json-importer';
export { convertSheetToJson } from '@/lib/utils/character-json-exporter';
export { blankSheetData } from '@/lib/templates/custom/blank-sheet-template';
export { characterTemplateStore } from '@/lib/character-templates';

// ---- Schemas (validation at the import/export boundary) --------------------
export * as schemas from '@/components/character-sheet/schemas/character-form-schema';
export * as traitSchemas from '@/components/character-sheet/schemas/advantages-disadvantages';
export * as abilitySchemas from '@/components/character-sheet/schemas/skills-techniques-powers';
export * as inventorySchemas from '@/components/character-sheet/schemas/equipment-and-weapons';
export * as coreStats from '@/components/character-sheet/schemas/core-stats-and-calculated';
export { characterSheetSchema, statusEffectSchema, CHARACTER_FORM_ARRAY_KEYS } from '@/components/character-sheet/schemas/character-form-schema';

// ---- Rolls -----------------------------------------------------------------
export { resolveRollOutcome } from '@/lib/roll-outcome';
export * as rollTargets from '@/lib/roll-targets';
export { rollAttributes, bestSkillTarget, forcePowerTarget } from '@/lib/roll-targets';
export * as skillDefaults from '@/lib/skill-defaults';
export * as attackSkills from '@/lib/attack-skills';
export * as weaponAttackSkill from '@/lib/weapon-attack-skill';
export * as unarmedStrikes from '@/lib/unarmed-strikes';
export * as forceFpCost from '@/lib/force-fp-cost';
export * as stunRules from '@/lib/stun-rules';
export * as facingRules from '@/lib/facing-rules';
export * as postureRules from '@/lib/posture-rules';
export * as combatEconomy from '@/lib/combat-economy';
export * as malfunction from '@/lib/malfunction';
export * as ammunitionDepletion from '@/lib/ammunition-depletion';
export * as alignment from '@/lib/alignment';
export * as socialRolls from '@/lib/social-rolls';
export * as defenseSkills from '@/lib/defense-skills';
export * as shipStations from '@/lib/ship-stations';
export * as stimulantCrash from '@/lib/stimulant-crash';

// ---- Modifiers, traits, effects --------------------------------------------
export * as modifierChannels from '@/lib/modifier-channels';
export { NO_MODIFIERS, accumulateModifiers, hasAnyModifier } from '@/lib/modifier-channels';
export * as traitLevelModifiers from '@/lib/trait-level-modifiers';
export { traitModifiersFor } from '@/lib/trait-level-modifiers';
export * as grantedRows from '@/lib/granted-rows';
export * as skillBonuses from '@/lib/skill-bonuses';
export * as conditionalBonuses from '@/lib/conditional-bonuses';
export * as typedResistance from '@/lib/typed-resistance';
export * as enhancedDefenses from '@/lib/enhanced-defenses';
export * as moveMultipliers from '@/lib/move-multipliers';
export * as utilityCondition from '@/lib/utility-condition';
export * as implantEffects from '@/lib/implant-effects';
export * as advantageSkillBonuses from '@/lib/advantage-skill-bonuses';
export * as languageRows from '@/lib/language-rows';
export * as resourcePools from '@/lib/resource-pools';
export * as forcePointCeiling from '@/lib/force-point-ceiling';
export * as sizeDiscount from '@/lib/size-discount';
export * as sizeModifier from '@/lib/size-modifier';
export * as smScaling from '@/lib/sm-scaling';
export * as qualifiedSt from '@/lib/qualified-st';
export * as jumping from '@/lib/jumping';
export * as hitLocations from '@/lib/hit-locations';
export * as anatomy from '@/lib/anatomy';
export * as wealth from '@/lib/wealth';
export * as parsing from '@/lib/utils/parsing';
export * as damageTable from '@/lib/utils/damage-table';

// ---- Per-item derivations (pure) -------------------------------------------
export { calculateBlasterStats } from '@/hooks/use-blaster-calculations';
export { calculateMeleeWeaponStats } from '@/lib/melee-weapon-stats';
export { calculateLightsaberStats } from '@/lib/lightsaber-stats';
export * as sheetHelpers from '@/lib/utils/character-sheet-helpers';
export {
  ensureCompleteArmorItem, ensureCompleteStarshipItem, ensureCompleteBlaster,
  ensureCompleteMeleeWeapon, ensureCompleteLightsaber, calculateModifiedArmor, listedArmorDrAt,
} from '@/lib/utils/character-sheet-helpers';
export * as starshipDerivation from '@/lib/starship-derivation';
export * as weaponBuild from '@/lib/weapon-build';
export * as weaponPricing from '@/lib/weapon-pricing';
export * as weaponHandling from '@/lib/weapon-handling';
export * as weaponDurability from '@/lib/weapon-durability';
export * as durabilityTracking from '@/lib/durability-tracking';
export * as componentRuin from '@/lib/component-ruin';
export * as rangedAssembly from '@/lib/ranged-assembly';
export * as rangedProfilePricing from '@/lib/ranged-profile-pricing';
export * as meleeAssembly from '@/lib/melee-assembly';
export * as meleeProfilePricing from '@/lib/melee-profile-pricing';
export * as meleeWeaponEquivalence from '@/lib/melee-weapon-equivalence';
export * as lightsaberAssembly from '@/lib/lightsaber-assembly';
export * as lightsaberComposition from '@/lib/lightsaber-composition';
export * as lightsaberDamage from '@/lib/lightsaber-damage';
export * as lightsaberClassType from '@/lib/lightsaber-class-type';
export * as lightsaberForms from '@/lib/lightsaber-forms';
export * as armorAssembly from '@/lib/armor-assembly';
export * as armorBuild from '@/lib/armor-build';
export * as armorFit from '@/lib/armor-fit';
export * as armorLayering from '@/lib/armor-layering';
export * as armorLimbAssignment from '@/lib/armor-limb-assignment';
export * as armorLimbPricing from '@/lib/armor-limb-pricing';
export * as armorModSlots from '@/lib/armor-mod-slots';
export * as armorPieceItem from '@/lib/armor-piece-item';
export * as armorProfileItem from '@/lib/armor-profile-item';
export * as armorSkill from '@/lib/armor-skill';
export * as armorTier from '@/lib/armor-tier';
export * as armorDerivation from '@/lib/armor-derivation';
export * as armorConditionalBonuses from '@/lib/armor-conditional-bonuses';
export * as armorMigration from '@/lib/armor-migration';
export * as bodyLoadout from '@/lib/body-loadout';
export * as bodyWeight from '@/lib/body-weight';
export * as wornWeapons from '@/lib/worn-weapons';
export * as fittedGoods from '@/lib/fitted-goods';
export * as installedAttachments from '@/lib/installed-attachments';
export * as partAcquisition from '@/lib/part-acquisition';
export * as gearSets from '@/lib/gear-sets';
export * as itemTransfer from '@/lib/item-transfer';
export * as importCollision from '@/lib/import-collision';
export * as currencyTransaction from '@/lib/currency-transaction';
export * as creditTracking from '@/lib/credit-tracking';
export * as equippedDiscount from '@/lib/equipped-discount';
export * as shieldRules from '@/lib/shield-rules';
export * as speciesSwap from '@/lib/species-swap';
// SPECIES_PACKAGE_REVISION: the gate module/world-update.mjs compares a world actor against (2026-09-28).
export * as speciesPackageRevision from '@/lib/species-package-revision';
export * as missingSkills from '@/lib/missing-skills';
export * as learningGates from '@/lib/learning-gates';
export * as customTiers from '@/lib/custom-tiers';
export * as traitSpecifier from '@/lib/trait-specifier';
export * as specialtyRequired from '@/lib/specialty-required';

// ---- Droids ----------------------------------------------------------------
export * as droidWorkshopRows from '@/lib/droid-workshop-rows';
export * as droidAnatomy from '@/lib/droid-anatomy';
export * as droidDr from '@/lib/droid-dr';
export * as droidSize from '@/lib/droid-size';
export * as droidAttributes from '@/lib/droid-attributes';
export * as droidBaseline from '@/lib/droid-baseline';
export * as droidModification from '@/lib/droid-modification';
export * as forceDroidRules from '@/lib/force-droid-rules';
export * as functionFirmware from '@/lib/function-firmware';

// ---- Implants, prosthetics, crafting, blueprints ---------------------------
export * as implantBuild from '@/lib/implant-build';
export * as prostheticBuild from '@/lib/prosthetic-build';
export * as prostheticQuality from '@/lib/prosthetic-quality';
export * as cyberneticMandatoryFlaws from '@/lib/cybernetic-mandatory-flaws';
export * as severedRemnant from '@/lib/severed-remnant';
export * as anatomyConformance from '@/lib/anatomy-conformance';
export * as craftingRules from '@/lib/crafting-rules';
export * as craftingSkillChoice from '@/lib/crafting-skill-choice';
export * as craftingMaterials from '@/lib/crafting-materials';
export * as crafterDamage from '@/lib/crafter-damage';
export * as constructionMarkup from '@/lib/construction-markup';
export * as salvageRecovery from '@/lib/salvage-recovery';
export * as ammunitionCrafting from '@/lib/ammunition-crafting';
export * as blueprints from '@/lib/blueprints';
export * as blueprintBuild from '@/lib/blueprint-build';
export * as blueprintCatalog from '@/lib/blueprint-catalog';
export * as blueprintComposition from '@/lib/blueprint-composition';
export * as blueprintFlow from '@/lib/blueprint-flow';
export * as armstechSpecialty from '@/lib/armstech-specialty';
export * as equipmentCraftingFamily from '@/lib/equipment-crafting-family';
export * as armorCraftingFamily from '@/lib/armor-crafting-family';
export * as medicalItems from '@/lib/medical-items';
export * as blasterGasGrades from '@/lib/blaster-gas-grades';

// ---- Catalogs (the compendia are generated from these) ---------------------
export * as advantages from '@/lib/advantages';
export * as disadvantages from '@/lib/disadvantages';
export * as quirks from '@/lib/quirks';
export * as skills from '@/lib/skills';
export * as forcePowers from '@/lib/force-powers-data';
export * as combatTechniques from '@/lib/combat-techniques';
export * as techniques from '@/lib/techniques';
export * as equipmentData from '@/lib/equipment-data';
export * as armorData from '@/lib/armor-data';
export * as armorPiecesData from '@/lib/armor-pieces-data';
export * as armorPartsData from '@/lib/armor-parts-data';
export * as armorMods from '@/lib/armor-mods';
export * as rangedWeaponProfiles from '@/lib/ranged-weapon-profiles';
export * as rangedPartsData from '@/lib/ranged-parts-data';
export * as meleeWeaponProfiles from '@/lib/melee-weapon-profiles';
export * as meleePartsData from '@/lib/melee-parts-data';
export * as lightsaberParts from '@/lib/lightsaber-parts';
export * as lightsaberPreconstructed from '@/lib/lightsaber-preconstructed';
export * as ammunitionData from '@/lib/ammunition-data';
export * as explosiveData from '@/lib/explosive-data';
export * as weaponModData from '@/lib/weapon-mod-data';
export * as cyberneticsData from '@/lib/cybernetics-data';
export * as vehicleData from '@/lib/vehicle-data';
export * as starshipChassisData from '@/lib/starship-chassis-data';
export * as starshipMods from '@/lib/starship-mods';
export * as starshipWeapons from '@/lib/starship-weapons';
export * as droidData from '@/lib/droid-data';
export * as speciesLanguages from '@/lib/species-languages';
export * as templateCategories from '@/lib/template-categories';
export * as readyToPlay from '@/lib/templates/ready-to-play';
export * as blasterCommon from '@/lib/templates/blaster-common';
export * as meleeCommon from '@/lib/templates/melee-common';
export * as lightsaberCommon from '@/lib/templates/lightsaber-common';
export * as clothingCommon from '@/lib/templates/clothing-common';

// ---- Migrations (also composed inside applyLoadMigrations) -----------------
export * as migrations from '@/lib/sanitizer-null-migration';
export * as skillNameMigration from '@/lib/skill-name-migration';
export * as traitNameMigration from '@/lib/trait-name-migration';
export * as speciesNameMigration from '@/lib/species-name-migration';
export * as racialTraitNameMigration from '@/lib/racial-trait-name-migration';
export * as languageMigration from '@/lib/language-migration';
export * as facingMigration from '@/lib/facing-migration';
export * as foldedBonusMigration from '@/lib/folded-bonus-migration';
export * as lightsaberDurabilityMigration from '@/lib/lightsaber-durability-migration';
export * as meleePowerCellMigration from '@/lib/melee-power-cell-migration';
export * as cyberneticNameMigration from '@/lib/cybernetic-name-migration';
export * as enhancedDefensesMigration from '@/lib/enhanced-defenses-migration';
export * as starshipModAliasMigration from '@/lib/starship-mod-alias-migration';

// ---- Handbook (loader aliased to tools/shims/handbook-loader.ts) -----------
export * as handbookSearch from '@/lib/handbook-search';
export * as handbookRegistry from '@/lib/handbook-registry';
export * as handbookLoader from '@/lib/handbook-loader';
export * as handbookFocus from '@/lib/handbook-focus';

// ---- Misc utilities --------------------------------------------------------
export * as utils from '@/lib/utils';
export * as characterSummary from '@/lib/character-summary';
export * as saveLimits from '@/lib/save-limits';
export * as saveAsCopy from '@/lib/save-as-copy';
export * as bulkImport from '@/lib/bulk-import';
export * as formDirty from '@/lib/form-dirty';
export * as weightUnits from '@/lib/weight-units';
export * as weightEditability from '@/lib/weight-editability';
export * as sheetSearch from '@/lib/sheet-search';
