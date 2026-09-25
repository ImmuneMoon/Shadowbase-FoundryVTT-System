# ShadowBase Foundry VTT system — architecture contract

Status: authoritative for the 2026-09 makeover. Every implementation unit in
`docs/WORKPLAN.md` builds to this document. Where this document is silent, the
phase-1 subsystem reports (see §0) and the website source decide; where it
conflicts with them, this document is a bug — fix it here, do not work around it.

## 0. Sources of truth, in order

1. The rulebook: `../ShadowBase Handbook/styled_chapters/*.docx` (converted copies under `../ShadowBase Handbook/chNN-*/`). Rules never live in this repo.
2. The website: `../ShadowBase Website/src/` — the reference implementation of every rule, catalog, migration and roll outcome. This system **imports** it (§2); it never re-implements it.
3. The phase-1 subsystem reports written for this makeover (read the ones your unit names; they are exhaustive and cite website lines):
   `<session scratchpad>/phase1/` —
   `schema-core.md`, `schema-inventory.md`, `engine-load-path.md`, `rolls-hud.md`, `effects-conditions.md`, `libraries-catalogs.md`, `builders-customization.md`, `ui-style.md`, `foundry-v13-api.md`, `husk-history.md`, `handbook-journal.md`, `test-harness.md`, `requirements-players.md`; and the settled decisions in `../decisions.md` (same folder's parent).
4. `docs/CHARACTER_JSON_FORMAT.md` in the website: the JSON contract at the import/export boundary.

Governing principles (from `../PROJECT-STATE.md` §4 and the website `CLAUDE.md`): items follow rules; derive from the files, never from a summary; rounding belongs to a quantity; a base is not a current value; modifier channels have one home; names are join keys (byte-identical to the catalogs); guards name the rejected alternative against the app's own code path and are mutation-tested; era guard (3964 BBY vocabulary, no Empire/Rebellion); Fulllion handles git and deployment — never commit, push or propose either.

## 1. Repository layout

```
system.json                    v13 manifest (§3)
package.json                   esbuild 0.28.2, @foundryvtt/foundryvtt-cli 3.0.4, handlebars 4.7.9; scripts build:*, check:*
README.md                      what this is, how to build, how to install
docs/ARCHITECTURE.md           this file
docs/WORKPLAN.md               unit plan and build log
docs/MANUAL-TEST.md            what cannot be verified headlessly + the in-Foundry script
docs/CHANGELOG.md
assets/shadowbase_icon.png     (kept from the old system; referenced with this exact case)
engine/shadowbase-engine.mjs   BUILT by tools/build-engine.mjs — the website engine (§2). Tracked in git so a checkout installs.
engine/BUILD-INFO.json         BUILT: website commit, bytes, packages, generatedAt
handbook/index.json, chNN-*.json, handbook-map.json   BUILT copies of the website's public/handbook + the chip map (§8)
packs-src/<pack>/*.json        BUILT compendium sources (deterministic ids); packs/ (compiled LevelDB) is git-ignored
module/                        ES modules (§4-§7)
templates/                     Handlebars (§6)
styles/                        plain CSS (§6.6)
lang/en.json                   every user-visible string (§6.7)
tools/                         build-engine.mjs, engine-entry.ts, stubs/, shims/, gen-actor-schema.mjs, pack-manifest.mjs, build-packs.mjs, build-handbook-pack.mjs, render-preview.mjs, foundry-shim.mjs
scripts/                       check-all.mjs + check-*.mjs (§9)
fixtures/                      character JSON exports used by checks (README explains provenance; never contains portraits over 512 px)
```

The old system's `template.json`, `scripts/*.js`, `templates/**` (old), `styles/sheet.css`, `database/`, `packs/*` and `TEST CHARACTERS/` are deleted by the husk-deletion unit; `TEST CHARACTERS/kaelen rarr_shadowbase.json` moves to `fixtures/legacy-2025-kaelen-rarr.json` (a legacy-import regression fixture).

## 2. The engine bundle

`tools/build-engine.mjs` bundles `tools/engine-entry.ts` from the website with esbuild (react, react/jsx-runtime, react-dom, react-hook-form, firebase/*, next/* aliased to `tools/stubs/`; `@/lib/handbook-loader` aliased to `tools/shims/handbook-loader.ts`). Output `engine/shadowbase-engine.mjs` (ESM, es2022, ~2.2 MB unminified; `--minify` for release). Allowed foreign packages: zod, clsx, tailwind-merge — anything else fails the build.

`module/engine.mjs` is the ONLY module that imports the bundle. It:
- polyfills `globalThis.crypto.randomUUID` before the import (templates mint uuids at module evaluation);
- re-exports everything; exposes `engine.rowId()` (= `crypto.randomUUID()`), `engine.blank()` (deep clone of `blankSheetData` with FRESH uuids for its anatomy and Credit Chip rows), and `engine.catalog(name)`.

Flat exports available (verified): `getCalculatedStats`, `isWeaponTwoHanded`, every `calculation-helpers` export (`getPrimaryAttributes`, `getCoreCharacteristics`, `calculateAttributePoints`, `calculateSkillsPoints`, `calculateTraitPoints`, `calculateSpecialAbilityPoints`, `calculateCombatStats`, `calculateEncumbranceDetails`, `calculateTotalEquipmentWeight`, `calculateTotalEquipmentCost`, `calculateDroidHardwarePoints`), `convertJsonToSheet`, `convertSheetToJson`, `blankSheetData`, `characterTemplateStore`, `characterSheetSchema`, `statusEffectSchema`, `CHARACTER_FORM_ARRAY_KEYS`, `resolveRollOutcome`, `rollAttributes`, `bestSkillTarget`, `forcePowerTarget`, `NO_MODIFIERS`, `accumulateModifiers`, `hasAnyModifier`, `traitModifiersFor`, `calculateBlasterStats`, `ensureCompleteArmorItem`, `ensureCompleteStarshipItem`, `ensureCompleteBlaster`, `ensureCompleteMeleeWeapon`, `ensureCompleteLightsaber`, `calculateModifiedArmor`, `listedArmorDrAt`; after the website extractions (§2.1): `applyLoadMigrations`, `calculateMeleeWeaponStats`, `calculateLightsaberStats`.
Namespaces (one per website module, names as in `tools/engine-entry.ts`): `schemas`, `traitSchemas`, `abilitySchemas`, `inventorySchemas`, `coreStats`, `rollTargets`, `skillDefaults`, `attackSkills`, `unarmedStrikes`, `forceFpCost`, `stunRules`, `facingRules`, `combatEconomy`, `malfunction`, `ammunitionDepletion`, `alignment`, `socialRolls`, `defenseSkills`, `shipStations`, `stimulantCrash`, `modifierChannels`, `traitLevelModifiers`, `grantedRows`, `skillBonuses`, `conditionalBonuses`, `typedResistance`, `enhancedDefenses`, `moveMultipliers`, `utilityCondition`, `implantEffects`, `advantageSkillBonuses`, `languageRows`, `resourcePools`, `forcePointCeiling`, `sizeDiscount`, `sizeModifier`, `smScaling`, `qualifiedSt`, `jumping`, `hitLocations`, `anatomy`, `wealth`, `parsing`, `damageTable`, `sheetHelpers`, `starshipDerivation`, `weaponBuild`, `weaponPricing`, `weaponHandling`, `weaponDurability`, `durabilityTracking`, `componentRuin`, `rangedAssembly`, `rangedProfilePricing`, `meleeAssembly`, `meleeProfilePricing`, `meleeWeaponEquivalence`, `lightsaberAssembly`, `lightsaberComposition`, `lightsaberDamage`, `lightsaberClassType`, `lightsaberForms`, `armorAssembly`, `armorBuild`, `armorFit`, `armorLayering`, `armorLimbAssignment`, `armorLimbPricing`, `armorModSlots`, `armorPieceItem`, `armorProfileItem`, `armorSkill`, `armorTier`, `armorDerivation`, `armorConditionalBonuses`, `armorMigration`, `bodyLoadout`, `bodyWeight`, `wornWeapons`, `fittedGoods`, `installedAttachments`, `partAcquisition`, `gearSets`, `itemTransfer`, `importCollision`, `currencyTransaction`, `creditTracking`, `equippedDiscount`, `shieldRules`, `speciesSwap`, `missingSkills`, `learningGates`, `customTiers`, `traitSpecifier`, `specialtyRequired`, `droidWorkshopRows`, `droidAnatomy`, `droidDr`, `droidSize`, `droidAttributes`, `droidBaseline`, `droidModification`, `forceDroidRules`, `functionFirmware`, `implantBuild`, `prostheticBuild`, `prostheticQuality`, `cyberneticMandatoryFlaws`, `severedRemnant`, `anatomyConformance`, `craftingRules`, `craftingSkillChoice`, `craftingMaterials`, `crafterDamage`, `constructionMarkup`, `salvageRecovery`, `ammunitionCrafting`, `blueprints`, `blueprintBuild`, `blueprintCatalog`, `blueprintComposition`, `blueprintFlow`, `armstechSpecialty`, `equipmentCraftingFamily`, `armorCraftingFamily`, `medicalItems`, `blasterGasGrades`, `advantages`, `disadvantages`, `quirks`, `skills`, `forcePowers`, `combatTechniques` (`combatTechniquesList`), `techniques` (`allCombatTechniques`), `equipmentData`, `armorData`, `armorPiecesData`, `armorPartsData`, `armorMods`, `rangedWeaponProfiles`, `rangedPartsData`, `meleeWeaponProfiles`, `meleePartsData`, `lightsaberParts`, `lightsaberPreconstructed`, `ammunitionData`, `explosiveData`, `weaponModData`, `cyberneticsData`, `vehicleData`, `starshipChassisData`, `starshipMods`, `starshipWeapons`, `droidData`, `speciesLanguages`, `templateCategories`, `readyToPlay`, `blasterCommon`, `meleeCommon`, `lightsaberCommon`, `clothingCommon`, the migration modules, `handbookSearch`, `handbookRegistry`, `handbookLoader`, `handbookFocus`, `utils`, `characterSummary`, `saveLimits`, `saveAsCopy`, `bulkImport`, `formDirty`, `weightUnits`, `weightEditability`, `sheetSearch`.
Always verify a name by running node against the bundle before citing it; a namespace export that is undefined is a wrong name, not a missing feature.

### 2.1 Website-side extractions (unit U01)

Three pure functions are extracted on the website (behaviour-preserving, hooks delegate, guarded by `check:pure-extractions`): `calculateMeleeWeaponStats(weapon, weaponModifications, st)`, `calculateLightsaberStats(saber, lightsaberModifications)`, `applyLoadMigrations(incoming, blankSheetData) -> { data, notices, loadedStats }`. Until they land, `module/items` may not derive melee/saber stats and `module/import-export` may not import; everything else builds without them.

## 3. system.json (v13)

```json
{
  "id": "shadowbase", "title": "ShadowBase — Shadows of the Mandalorian War", "version": "2.0.0",
  "description": "…", "authors": [{ "name": "Fulllion Creative Works" }],
  "compatibility": { "minimum": "13", "verified": "13.346" },
  "esmodules": ["module/shadowbase.mjs"],
  "styles": ["styles/variables.css", "styles/foundry-chrome.css", "styles/components.css", "styles/sheet.css", "styles/sheet-tabs.css", "styles/hud.css", "styles/items.css", "styles/chat.css", "styles/apps.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "documentTypes": { "Actor": { "character": {} }, "Item": { "<each of the 21 types>": {} } },
  "packs": [ … from tools/pack-manifest.mjs … ], "packFolders": [ … ],
  "grid": { "type": 4, "distance": 1, "units": "yd" },
  "primaryTokenAttribute": "resources.hp", "secondaryTokenAttribute": "resources.ep",
  "flags": { "hotReload": { "extensions": ["css", "hbs", "json"], "paths": ["styles", "templates", "lang"] } }
}
```
`grid.type` 4 = `CONST.GRID_TYPES.HEXODDQ`, hexagonal COLUMNS (flat-top), per the campaign's hex ruling (ASSUMPTION Q3); type 2 is HEXODDR, pointy-top rows — a review caught that mistake. Packs paths are `packs/<name>` (LevelDB directories), `system: "shadowbase"` on Actor/Item packs. `description`/`background`/`notes` are plain `StringField({ trim: false })` bound to `<textarea>` (the website binds textareas; an HTMLField would write `<p>` markup the website renders literally), so `htmlFields` stays empty. Every stylesheet listed exists from wave 2b on (empty stubs until its owner's wave; `check:manifest` requires each): `sheet-tabs.css` is the sheet's tab strip (U05), `apps.css` the sub-apps (U09).

## 4. Documents and data models

### 4.1 Actor `character` (`module/data/actor-character.mjs` + `module/data/actor-schema.generated.mjs`)

- One actor type. Droids are characters with `isDroid: true` (as on the website).
- `system` schema = every top-level key of the website's `characterSheetSchema` EXCEPT the 22 item row arrays (`CHARACTER_FORM_ARRAY_KEYS` minus `hitLocations`, which stays an actor field — §9.1), `characterName` (→ `actor.name`), `lastSaved`, `statusEffects` (§4.4) and the 13 dead-echo keys (below). The schema file is GENERATED by `tools/gen-actor-schema.mjs` from the bundle's `characterSheetSchema` (zod → `foundry.data.fields` table below) and pinned by `check:actor-schema` (regenerate → byte-identical). Hand exceptions are declared in the generator, never edited into the output.

  | zod shape (after unwrapping preprocess/optional/nullable/default) | field |
  |---|---|
  | number, nullable or preprocess-to-null, or optional with no default (pointsAttributes/pointsAdvantages/pointsDisadvantages) | `NumberField({ required: true, nullable: true, initial: null, integer where zod says int })` |
  | number with a default (pointTotal 150, powerPoints 100, sizeModifier 0, turnCounter 0, age 0, lightSide/darkSide 0, cpTradedForCredits 0, totalCredits 7000, every *Baseline, facing/incomingBearing 0, parriesThisTurn 0, forceAlignment 0) | `NumberField({ required: true, nullable: false, initial: <default>, integer where zod says int })` — EXCEPT the four primaries (strength/dexterity/iq/health), `nullable: true, initial: 10`: the importer stores null for "derive" and a droid derives from hardware |
  | number min/max (facing 0-5, forceAlignment -100..100) | add `min`/`max` |
  | boolean | `BooleanField({ initial: <zod default or false> })` (useLiftingST/useStrikingST/useArmST initial true) |
  | string | `StringField({ required: true, nullable: true, initial: null, blank: true, trim: false })` — every string is `trim: false`; `description`/`background`/`notes` → the same with `initial: ''` (plain textarea text, never `HTMLField`) |
  | enum (stunType, cpCreditsForm, incomingArc) | `StringField({ choices, initial, trim: false })`; `incomingArc` (nullable, no default) → `nullable: true, initial: null` |
  | array of primitives (additionalBearings) | `ArrayField(NumberField)` |
  | object / array of objects (droidBuild, hitLocations, languageEntries, storageBoxes, gearSets, pinnedNotifications) | `ObjectField` / `ArrayField(ObjectField)` — opaque, never cleaned, sparse arrays survive; `nullable: true` where zod is nullable (droidBuild, gearSets, storageBoxes, pinnedNotifications) |
  | `shipPosition` | `StringField({ nullable: true })` (the JSON doc's "object \| null" is stale) |
  | `statusEffects` | NOT a field — ActiveEffects (§4.4); the generator skips it |
  | dead-echo keys (`drHead`, `drTorso`, `parry`, `block`, root `flawedBuild`, root `currentValues`, `pointsSkills`, `basicLift`, `damageThrust`, `damageSwing`, `spentPoints`, `remainingPoints`, `trackPurchases`) | NOT fields — skipped by name (generator `DEAD_ECHO_KEYS`); the adapter never stores them and hands them back ABSENT, never null; `exportSheet` fills the three the exporter reads (`damageThrust`, `damageSwing`, `basicLift`) from the live stats |
  | `characterPortrait` | `StringField` (data URL; `actor.img` stays a file path — Foundry's FilePathField rejects base64) |
  | plus `legacy: ObjectField` | any unknown top-level key an import carries, kept for lossless export |

- `prepareBaseData()`: nothing that reads items. `prepareDerivedData()` (on the TypeDataModel, so it runs after items and ActiveEffects prepare): `const sheet = adapter.actorToSheet(this.parent); const stats = engine.getCalculatedStats(sheet); this.derived = stats;` then `this.resources = { hp: { value: sheet.currentHitPoints ?? stats.currentValues.hitPoints, max: stats.currentValues.hitPoints }, ep: {…endurancePoints}, fp: { value: sheet.currentForcePoints ?? stats.currentValues.maxForcePoints, max: stats.currentValues.maxForcePoints }, pp: { value: this.powerPoints, max: stats.currentValues.maxPowerPoints } }`; `this.initiative = stats.currentValues.basicSpeed + stats.primaryAttributes.effectiveDexterity / 100`; `this.sheetCache = sheet` (the composed CharacterFormValues, reused by sheets and rolls). Derived data is never written to `_source` (`check:derived-not-stored`).
- `ShadowBaseActor` (`module/documents/actor.mjs`): `get sheetData()` (→ `system.sheetCache`), `get stats()` (→ `system.derived`), `modifyTokenAttribute(attribute, value, isDelta, isBar)` mapping `resources.hp/ep/fp` to `currentHitPoints/currentEndurancePoints/currentForcePoints` and `resources.pp` to `powerPoints` (clamped to max for bars), `getRollData()` (`{ ...stats.currentValues, initiative }`), `importSheet(json | sheet, { mode })`, `exportSheet()`, `sweepTurn(newTurn)`, `rowsOf(source)` (items by source, sorted), `itemByRowId(uuid)`, `effectsAsStatusEffects()`.
- `CONFIG.Actor.trackableAttributes.character = { bar: ['resources.hp', 'resources.ep', 'resources.fp', 'resources.pp'], value: ['derived.currentEncumbrance.dodge', 'derived.currentValues.basicSpeed', 'derived.currentValues.basicMove', 'initiative'] }`.

### 4.2 Items (`module/data/item-base.mjs`, `module/data/item-types.mjs`, `module/documents/item.mjs`)

21 types, one `TypeDataModel` subclass each (sharing `ShadowBaseItemData`):

| Item type | website array (`system.source`) | notes |
|---|---|---|
| advantage, disadvantage, quirk | advantages, disadvantages, quirks | row projected onto the trait schema on export |
| skill | skills | `row.level` is a STRING |
| forcePower, combatTechnique, lightsaberForm | forcePowers, combatTechniques, lightsaberForms | compendium Items are per NAME with `system.levels[]` (catalog rows); the owned row carries `level` |
| equipment | equipment | general gear incl. currency rows, blueprints (`row.blueprintOf`), firmware datacards |
| armor | armor | rebuilt through `ensureCompleteArmorItem` on import |
| blaster | customBlasters | |
| meleeWeapon | customMeleeWeapons | |
| lightsaber | lightsabers | |
| explosive | customExplosives | |
| ammunition | ammunition | |
| weaponPart | weaponModifications OR lightsaberModifications | `system.family: 'weapon' | 'lightsaber'` decides the export array |
| armorPart | armorModifications | |
| implant | implants | |
| cyberneticLimb | cybernetics | |
| cyberneticUpgrade | cyberneticUpgrades | |
| starship | customStarships | exported into `inventory.starships` together with vehicles |
| vehicle | vehicles | |

Schema: `row: ObjectField({ required: true })` (the website row VERBATIM, including its uuid `id`; every field name the website uses, nothing renamed), `source: StringField({ choices: CHARACTER_FORM_ARRAY_KEYS })`, `family: StringField` (weaponPart only), `kit: ObjectField` (compendium kits only: `{ weapon, parts[], ammunition[] }` built by the website's `buildTemplateBlaster/MeleeWeapon/Lightsaber`), `levels: ArrayField(ObjectField)` (compendium powers/techniques/forms only), `catalog: StringField` (the pack/catalog a compendium item came from). Item `name` mirrors `row.name` (or `row.customName ?? row.name`); `img` from `CONFIG.SHADOWBASE.icons[type]`.

`prepareDerivedData()` on an OWNED item computes the family's derived stats through the bundle and stores them on `this.derived` (never on `row`): blaster → `calculateBlasterStats(row, owner.rowsOf('weaponModifications'))`; meleeWeapon → `calculateMeleeWeaponStats(row, mods, { effectiveStrength, damageStLevels, twoHandedStLevels, useStrikingST })` read from the OWNER's `derived` (see §4.3 ordering); lightsaber → `calculateLightsaberStats(row, owner.rowsOf('lightsaberModifications'))`; armor → `calculateModifiedArmor(row, owner.rowsOf('armorModifications'), owner.system.sizeModifier, owner.system.hitLocations)`; starship → `starshipDerivation.deriveStarship(row)`. Unowned (compendium) items derive against empty arrays.

### 4.3 The adapter (`module/adapter.mjs`)

`actorToSheet(actor)`:
1. `sheet = { ...engine.blank(), ...pickSchemaFields(actor.system) }` — every generated schema field copied by name; `characterName = actor.name`; `characterPortrait = system.characterPortrait || null`; `...system.legacy` spread FIRST so schema fields win.
2. For each `source` in `CHARACTER_FORM_ARRAY_KEYS`: `sheet[source] = actor.rowsOf(source).map(item => rowWithDerived(item))` where `rowWithDerived` returns `{ ...item.system.row, ...item.derived?.persistedFields }` — the engine READS stored `final*` fields the website's cards write back (`engine-load-path.md` fact 8), so the derived per-item figures (finalWeight/finalCost/finalST/finalMovePenalty/finalDXPenalty/totalCost/…, the exact write-back key list per family from `schema-inventory.md` fact 9) are injected here. `weaponModifications` = weaponPart items with family weapon; `lightsaberModifications` = family lightsaber.
3. `sheet.statusEffects = actor.effects.filter(e => e.flags.shadowbase?.statusEffect).map(effectToStatusEffect)`.
4. Return `sheet` (a plain object; the engine never mutates it).

Ordering: items sort by Foundry `sort` within a source; new rows get `sort = (max + 1) * CONST.SORT_INTEGER_DENSITY`.

`sheetToActorData(sheet, { actorName })` → `{ name, system, items[], effects[] }`: schema fields picked by name (unknown top-level keys → `system.legacy`; dead echo fields listed in `schema-core.md` fact 24 dropped), `items` = one Item datum per row per source (`{ name, type, img, sort, system: { row, source, family? } }`; rows missing `id` get `engine.rowId()`), `effects` = `statusEffects.map(statusEffectToEffectData)`.

Invariant (`check:adapter-round-trip`): for every template, coverage fixture and fixture export, `actorToSheet(build(sheetToActorData(sheet)))` deep-equals `sheet` (uuids masked where the blank sheet minted them) AND `getCalculatedStats` of both agree on all 31 keys. `build` runs through the headless Foundry shim (§9) so field cleaning is real.

### 4.4 Status effects as ActiveEffects (`module/documents/active-effect.mjs`, `module/effects.mjs`)

- One ActiveEffect per STORED website status-effect row. Document: `{ name: row.name, img: icon by type/source, description: row.description, disabled: false, transfer: false, changes: [] (ALWAYS empty — the engine sums every bag; changes would double-apply), duration: {} , flags: { shadowbase: { statusEffect: <row with NO_MODIFIERS spread under modifiers, phaseIndex default 0> } }, statuses: [<CONFIG status id when the row maps to one>] }`.
- `effectToStatusEffect(effect)` returns `flags.shadowbase.statusEffect` with `id` = the row's own id (string; the website uses non-uuid ids for stored effects — keep whatever it has, mint `engine.rowId()` when absent).
- Derived effects (`stats.activeStatusEffects` minus stored ones) are displayed only (HUD Status tab, sheet Combat State), never persisted.
- Operations (`module/effects.mjs`): `addManualEffect(actor, row)`, `dismissEffect(actor, effectId)` (dismissing the derived "stunned" card sets `stunType: 'None'`), `advancePhase(actor, effectId)` (uses `engine.stimulantCrash.applyCrashPhase` semantics: phase `endurancePoints` deducts from `currentEndurancePoints`, then rewrites the row from the phase and increments `phaseIndex`), `recoverEp(actor, effectId)`, `sweepExpired(actor, turn)` (removes effects whose `expiresAfterTurn < turn`; returns names), `syncStun(actor)` (stunType ↔ `stunned-physical`/`stunned-mental` statuses both ways via the `updateActor` (post-commit), `createActiveEffect` and `deleteActiveEffect` hooks — creating or deleting an embedded document from inside the parent's pre-update is not a documented v13 pattern). The token icon is a MIRROR ActiveEffect (`flags.shadowbase.stunMirror`, the status, NO status-effect row); both directions are idempotent (§9.1).
- `CONFIG.statusEffects` (v13 array) entries, each `{ id, name (i18n key), img (Foundry core icons/svg/*.svg), hud: true|false }`: `stunned-physical`, `stunned-mental` (toggling writes `stunType`), `shock`, `bleeding`, `nauseated`, `stimulated`, `crash`, `susceptible`, `pain-suppressed`, `encumbered` (derived, hud:false), `flanked` (derived), `unready`, `form-active`, `shield-active`, `critical-power`, `crippled`, `buff`, `debuff`. Toggling a non-stun status from the token HUD creates a manual stored effect with that name and no bag.

## 5. Table play

### 5.1 Rolls (`module/rolls.mjs`, `templates/chat/*.hbs`, `styles/chat.css`)

All target rolls: `await new Roll('3d6').evaluate()` → `engine.resolveRollOutcome(total, target, malfunctionThreshold)` → chat card `templates/chat/target-roll.hbs` with Skill / Target / Rolled [d,d,d] / Result / margin / malfunction / ghost-glitch lines exactly as `rolls-hud.md` fact 3 describes; `rollMode` from the dialog (Foundry's chooser; ASSUMPTION Q14 c). Exports (all `async`, all return the outcome object and the ChatMessage):

| function | target derivation (bundle) | side effects |
|---|---|---|
| `rollAttribute(actor, key, opts)` | `rollAttributes(stats)[key]` | — |
| `rollCharacteristic(actor, key, opts)` (will, perception, frightCheck, vision/hearing/taste/touch) | `stats.currentValues[key]` (fright: frightImmune short-circuits) | — |
| `rollSkill(actor, skillName, opts)` | `skillDefaults.resolveSkillLevel(name, sheet.skills, rollAttributes(stats))` (the HUD's derivation is canonical) + `stats.skillBonuses` flat | — |
| `rollAttack(actor, item, opts)` | target = `weaponAttackSkill.attackSkillFor(row, sheet.skills, attrs, 0, new Map()).skillTarget` + `minStShortfallPenalty`; modifier carries `attackHitBonus(...)` once (composition rule below); `malfunctionThreshold` = `item.derived.malfunction` (blaster: the family's `calculate*Stats` figure), else the stored row's, else Ch7's 17 — never `malfunctionOrBase(row.durability, …)` (14 on every kit weapon) | pendingHits/lastVolley/firedRounds on the row; charges/rounds/darts deducted inline the way the HUD does (composition rule below); melee: `lastAttackTurn = turnCounter`, `isUnready` when `weaponHandling.attackLeavesUnready`; blocked while stunned |
| `rollVolley(actor, item, shots, opts)` | as attack, one 3d6 per shot, stops at first malfunction | as above |
| `rollDamage(actor, { label, formula, damageType, item })` | formula translation `toFoundryFormula(website)`: `Nd±m` → `Nd6±m`, `xN`/`*N` → `*N`, type words stripped to flavor, armor divisors kept as flavor; result clamped to min 1 (`rolls-hud.md` fact 4) | clears pendingHits for that item |
| `rollUnarmed(actor, 'punch'|'kick', opts)` | `unarmedStrikes.unarmedStrikeTarget(...)`; damage from `stats.unarmedDamage` | — |
| `rollDefense(actor, 'dodge'|'parry'|'block', { weaponItem }, opts)` | dodge `stats.currentEncumbrance.dodge` (+ form dodge when a saber is readied); parry/block from `stats.parryOptions/blockOptions` or the per-weapon rebuild (`derived.finalParryMod`, form parry/block for sabers, stun -4, channels) gated by `stats.defenseAdjustments.*Available` | parry increments `parriesThisTurn`; multiple-parry advisory (warn only) |
| `rollForcePower(actor, item, opts)` / `applyForcePowerCosts(actor, item)` | `forcePowerTarget(row.baseSkill, …)`; costs `forceFpCost.calculateAdjustedFPCost(base, alignment tag, forceAlignment)` + `row.epCost` | pools deducted only by applyCosts |
| `rollTechnique(actor, item, { weaponItem })` / `applyTechniqueCosts` | `bestSkillTarget` over the technique's skills or the selected weapon's attack target + row skillBonus/skillPenalty | pools |
| `rollCrewAction(actor, station, action)` | `shipStations` action skill lists via `bestSkillTarget` | — |
| `rollStunRecovery(actor)` | HT (Physical) / IQ (Mental) via `stunRules.stunRecoveryAttribute` + `stats.modifiers.stunRecovery` (a deliberate, documented departure: the website declares the channel but has no button; ASSUMPTION) | success → `stunType: 'None'` |
| `rollCustom(actor, { label, target, modifier })` | as given | — |

Modifier composition — stated ONCE, because the website's own surfaces disagree and a careless port applies a bonus twice (review finding M3): for an attack, **target** = `weaponAttackSkill.attackSkillFor(row, sheet.skills, attrs, 0, new Map()).skillTarget` + `minStShortfallPenalty(minSt, effectiveStrength)` (the bare skill target, exactly what the HUD's readied-weapon matrix shows), and **modifier** = situational + `weaponAttackSkill.attackHitBonus(stats.modifiers.toHit, stats.skillBonuses, skillName)` − the row's skill penalty + off-hand (−4 attack / −1 parry-block when `stats.dualWielding.penalized` and the Off-Hand toggle is set). Never combine `attackSkillFor(...).target` (which already folds the hit bonus in) with an added to-hit. For skills: target = `resolveSkillLevel(...)`.level, modifier = situational + flat gear/effect bonus − penalty. A null target is refused with a notification (not coerced to 10). **Malfunction threshold** = `item.derived.malfunction` — the figure the family's `calculate*Stats` computes (blaster: durability ?? maxDurability, then the loaded gas grade's Malf modifier, min 4) — never `malfunctionOrBase(row.durability, …)`, which returns 14 for a kit-built weapon whose `durability` is the null "unmeasured" sentinel (review finding M4). Ammunition deduction is the HUD's inline logic (`roller-window.tsx` ~1340-1416): `currentCharges − shots × chargesPerShot` on the loaded pack, `firedRounds` for slugthrowers, `lastVolley` for stingers, `lastFiredExplosive` for launchers; `engine.ammunitionDepletion` only scales weight/cost of a part-empty magazine. Roll history: last N rolls per actor in `flags.shadowbase.rollHistory` (N from the client setting `rollHistoryDepth`, default 10).

### 5.2 Combat (`module/combat.mjs`)

- `CONFIG.Combat.initiative = { formula: '@initiative', decimals: 2 }`; initiative is never rolled by a die — the tracker shows Basic Speed (DX tie-break in the hundredths). Combatant `_getInitiativeFormula` returns the same; `rollInitiative` just evaluates it.
- `updateCombat` hook, gated on `game.users.activeGM === game.user` (every client receives the hook; only the active GM writes): when `round` changes, for every combatant actor with `flags.shadowbase.autoTurnCounter !== false`, `actor.update({ 'system.turnCounter': round })` (advancing or rewinding) and then `actor.sweepTurn(round)` (ASSUMPTION Q5 d). Manual: the sheet's Combat State panel and the HUD have a turn counter with ± and a **Sweep now** button. `sweepTurn(turn)`: `facingChangeUsed: false`, `parriesThisTurn: 0`, `effects.sweepExpired(actor, turn)` (notifies "Effects expired: …"). Never touches `isUnready`, `lastAttackTurn`, `pendingHits`, `stunType` (as on the website).
- Combat-economy flags (`combatEconomy.combatEconomyFlags`) are advisory: shown as amber chips in the HUD, never blocking (world setting `enforceEconomy` reserved, default off).

### 5.3 Damage processor (HUD Status tab, `module/apps/hud.mjs` + `module/damage.mjs`)

Ports the website's Tactical Damage Processor arithmetic from `hit-location-section.tsx` (cite lines in code comments): DR (location + typed DR by damage type), wounding multipliers (cut ×1.5, imp ×2, pi- ×0.5, pi+ ×1.5, pi++ ×2, head ×4 organic / ×2 droid, vitals ×3 vs imp/pi), cold/stun/ion(organic) to EP, shock/sonic bypass DR; writes HP/EP, degrades the covering armor's `drEntries[].dr`, creates a Shock effect (`dexterity/iq = −min(4, injury)`, `expiresAfterTurn = turnCounter + 1`), flags crippling/severing on the hit-location row, and only PROMPTS the HT rolls.

## 6. Applications

All ApplicationV2 + HandlebarsApplicationMixin; no jQuery, no Application v1, no `renderTemplate` global (use `foundry.applications.handlebars.renderTemplate`), no `CHAT_MESSAGE_TYPES`. Class names: `ShadowBaseActorSheet`, `TacticalHud`, `RollDialog`, `ShadowBaseItemSheet` (+ per-family subclasses), `DroidWorkshop`, `AnatomyWorkshop`, `BodyLoadout`, `SuitsAndSets`, `CraftingApp`, `HandbookBrowser`, `DossierImporter`. Every `data-action` handler is a static method in the class's `actions` map; every user-visible string is `{{localize}}`d from `lang/en.json` (`SHADOWBASE.<Area>.<Key>`).

### 6.1 Actor sheet (`module/apps/actor-sheet.mjs`, `templates/actor/*.hbs`)

PARTS: `header` (portrait — `system.characterPortrait` data URL if set else `actor.img`; name; player; species; homeworld; campaign; points ledger total/spent/remaining; pinned pools HP/EP/FP or PP with inline inputs; buttons Import / Export / HUD / Preferences), `tabs`, `info`, `body`, `abilities`, `inventory`, `vehicles`. TABS ids `info`, `body`, `abilities`, `inventory`, `vehicles` — the website's five tabs, with the sections of each tab in the website's order, titles and icons exactly as `ui-style.md` §3.3 lists them (that section is the section inventory; copy it into `templates/actor/README.md` as the checklist). Sections render as `<details class="sb-section" open>` accordions with the website's trigger styling. Inputs bind by full dotted name (`system.strength`, `system.currentHitPoints`) with `data-dtype="Number"`; blank number → null for the null-means-derive/null-means-full fields (`_processFormData` applies the website's `blankToNull` semantics for the field list the generator emits as `NULLABLE_NUMBER_FIELDS`); skill level inputs write strings. Item rows edit inline through `updateEmbeddedDocuments` (`_processSubmitData` extracts `items.<id>.row.<key>` entries). Drag/drop: Items (compendium drops go through `module/compendium-drop.mjs`), Actors from the template pack (§7), `.json` files (import). Context menu per row: Edit / Duplicate / Delete / Send to storage / Transfer (item envelope).

### 6.2 Tactical HUD (`module/apps/hud.mjs`, `templates/hud/*.hbs`, `styles/hud.css`)

Right-side window per actor (`id: shadowbase-hud-<actorId>`, resizable). Tabs Actions / Status / Handbook mirroring `rolls-hud.md` fact 20 and `ui-style.md` §3.4: Actions (Custom Roll, Unarmed Combat, Readied Weapons with attack/damage/defensive matrix, Core & Defenses with the turn order line, dodge, attribute grid, Combat Economy chips; Skills; Abilities & Forms; Ship Systems), Status (Resource Pools, Active Effects hub with add/advance/dismiss/recover, Dodge/Move/Encumbrance/Jump tiles, Anatomical DR + Damage Processor), Handbook (browser, §8). Footer: roll history (depth from settings), bell (pinned notifications → `system.pinnedNotifications`), settings gear.

### 6.3 Roll dialog (`module/apps/roll-dialog.mjs`)

`DialogV2.wait` form: label, target (read-only), situational modifier, off-hand toggle (when dual wielding), roll mode; Enter rolls.

### 6.4 Item sheets (`module/apps/item-sheets/*.mjs`, `templates/items/*.hbs`, `styles/items.css`)

One subclass per family. Common header (name/customName, quantity, weight, cost, equipped/isActive, storage box, condition badge, notes). Builders mirror `builders-customization.md`'s per-builder section (stored fields, catalogs, slotScope owned-rows-first with the **Direct Library Access** toggle GM-only [ASSUMPTION], provenance, durability/condition, derived stats panel from `item.derived`). Traits/skills/powers/techniques/forms: level select re-reading the catalog by name+level, points/baseline, description, modifier bag badges (resolved through `traitModifiersFor`).

### 6.5 Sub-apps

`DroidWorkshop` (droidBuild editor over the sparse slot arrays — on every slot change write the WHOLE array (`system.droidBuild.chassisMods.internalIds` materialised to full length with `null` holes; likewise `head.sensorIds`, `externalIds`, `utilityIds`, `auxiliaryIds`, `motiveMountIds`), never a per-index dotted key: Foundry's `expandObject` turns `internalIds.3` into a plain object and `updateSource` replaces the array with it (review finding M5); never compact; warped-slot refusal; swap procedure with the 1d6 tables via `droidModification`), `AnatomyWorkshop` (hitLocations: innate DR, status, installedHardwareIds), `BodyLoadout` (armor per location, layering through `armorLayering.enforceBaseLayer`), `SuitsAndSets` (`armorPieceItem.presetSuitItems`, gear sets), `CraftingApp` (stage list from `craftingRules.CRAFTING_DEFINITIONS`, rolls through §5.1, applies `CraftingResultMeta` the way the website cards do), `DossierImporter` (GM: many JSON files → Actors with Skip / Overwrite / Save as copy).

### 6.6 Styles (`styles/`)

`variables.css`: every website token under `.shadowbase, .application.shadowbase` with the website's names and HSL triplets (`--background: 0 0% 10%` …, `--radius: 0.375rem`, font stack `Inter, system-ui, sans-serif`), dark only. `foundry-chrome.css`: window frame, header, tab nav, scrollbars, inputs restyled within `.shadowbase` (never global). `components.css`: the recipes from `ui-style.md` §2 as `sb-card`, `sb-section` (details/summary accordion), `sb-badge[-secondary|-destructive|-outline]`, `sb-btn[-default|-secondary|-outline|-ghost|-destructive][-sm|-icon]`, `sb-tabs`/`sb-tab` (angular parallelogram tabs, `--tab-cut-size: 1rem`), `sb-input`, `sb-select`, `sb-switch`, `sb-table`, `sb-progress`, `sb-tooltip`, `sb-empty`, `sb-chip`, `sb-stat-tile`, `sb-pool`, `sb-alignment-spectrum`, `sb-facing-hex`. Icons: Font Awesome 6 Free via the lucide→FA map in `ui-style.md` §4 (`CONFIG.SHADOWBASE.icons`).

### 6.7 i18n (`lang/en.json`)

Keys `SHADOWBASE.Sheet.*`, `SHADOWBASE.Hud.*`, `SHADOWBASE.Item.*`, `SHADOWBASE.Roll.*`, `SHADOWBASE.Effect.*`, `SHADOWBASE.Status.*`, `SHADOWBASE.Settings.*`, `SHADOWBASE.Import.*`, `SHADOWBASE.Handbook.*`, `TYPES.Actor.character`, `TYPES.Item.<type>`. `check:i18n` holds templates ↔ keys both ways.

## 7. Compendia (`tools/pack-manifest.mjs`, `tools/build-packs.mjs`)

Every pack is declared once in the manifest: `{ name, label, type, folder, source: (engine) => rows[], key: row => stableKey, project: (row, ctx) => documentData }`. `_id` = first 16 chars of base62(sha256(`${pack}:${stableKey}`)); `_key` = `!items!<id>` / `!actors!<id>` / `!journal!<id>` / `!folders!<id>`. Build: refuse a stale bundle (BUILD-INFO older than website src), write `packs-src/<pack>/<id>.json` (whole documents; embedded pages/effects nested), compile with `compilePack`, write `packs-src/MANIFEST.json` (counts, hashes). Packs (labels in en.json):

traits: `advantages` (183, folders by category), `disadvantages` (191), `quirks` (45); `skills` (153, folders by category); `force-powers` (48 per name, `system.levels` = the 147 rows), `combat-techniques` (14 per name), `lightsaber-forms` (7 per name); `equipment` (128 by pane incl. currencies), `blueprints` (491 designs → equipment rows with `blueprintOf`), `armor` (ARMOR_DATA 152 by type), `armor-pieces` (75), `armor-parts` (101), `armor-mods` (33), `ranged-weapons` (51 profiles as KITS via `blasterCommon.buildTemplateBlaster`), `ranged-parts` (64), `weapon-mods` (53), `ammunition` (43), `explosives` (15), `melee-weapons` (37 kits via `meleeCommon.buildTemplateMeleeWeapon`), `melee-parts` (22 + materials as their own rows), `lightsabers` (11 preconstructed kits), `lightsaber-parts` (20 hilt + 3 wraps + 13 materials + 58 internals), `implants` (23), `cybernetic-limbs` (20), `cybernetic-upgrades` (4 + 3 modules), `starships` (6), `starship-mods` (17), `starship-weapons` (9), `vehicles` (9), `droid-parts` (98 by DROID_* array); `templates` (Actor pack: 65 templates in folders Example PCs / Archetypes / Species / Droids, each run through `applyLoadMigrations`, prototype token bars hp/ep); `handbook` (JournalEntry, §8). Names are byte-identical to the catalogs (`check:packs`). Compendium drop (`module/compendium-drop.mjs`): a kit deals the weapon + its part rows (fresh uuids, host references rebound) the way `itemTransfer.parseImport` rebinds; per-name powers/techniques/forms create the level-1 row; template Actors create a full actor via `sheetToActorData`.

## 8. Handbook (`tools/build-handbook-pack.mjs`, `handbook/`, `module/apps/handbook-browser.mjs`)

Layout B from `handbook-journal.md`: 24 JournalEntries (one per chapter), one text page per top-level h2 plus an Overview page = 169 pages, HTML rendered block by block (labeled-bold run-ins, lists, tables at their markers from `Object.values(row)` with `\n`→`<br>`, wide tables wrapped), deterministic ids, page-scoped ASCII slug anchors, `handbook/handbook-map.json` (`chapterId + heading → { entryId, pageId, anchor }`), "Chapter N" mentions enriched to `@UUID` links. The 25 JSON files are copied to `handbook/` unchanged for the in-sheet search (`handbookSearch.searchChapters` through the shim loader). Handbook chips on the sheet resolve through `handbookRegistry.HANDBOOK_CHIP_TARGETS` and open `page.parent.sheet.render(true, { pageId, anchor })`.

## 9. Verification (`scripts/`)

`node scripts/check-all.mjs` runs every `check:*` (pre-flight: website checkout with jiti, engine bundle, node_modules). Each check: subject from a declaration, the rejected alternative named against the app's code path, at least one mutation recorded in the file header. Headless Foundry: `tools/foundry-shim.mjs` — a declared surface (`foundry.utils`, `foundry.data.fields` with Foundry's cleaning/nullable semantics, `foundry.abstract.TypeDataModel`, `foundry.documents.*` stubs, `CONFIG`, `game.i18n`, `Hooks`, `ui.notifications`, `ChatMessage`, `Roll` with injectable results) behind a Proxy that throws on undeclared members; `FOUNDRY_APP_PATH` optionally mounts Foundry's own `resources/app/common/` instead.

Checks: `engine-parity` (exists), `engine-fresh`, `actor-schema` (generator output byte-identical; every non-row schema key present; nullable set matches zod), `adapter-round-trip`, `json-contract` (every key of `docs/CHARACTER_JSON_FORMAT.md` survives import→export through the adapter), `load-path` (order pinned against the website hook source), `packs` (manifest ↔ bundle both ways, counts, ids stable across two builds, names byte-identical, kits resolve), `handbook` (169 pages, 1459 headings mapped, 278 tables, chip targets resolve, era grep), `templates` (Handlebars compile `strict` + `knownHelpersOnly` over live `_prepareContext` outputs for every template), `esm` (`node --check` every module, import graph resolves, forbidden APIs absent), `i18n`, `css-tokens`, `manifest` (system.json packs/esmodules/styles/languages exist, documentTypes = registered models), `effects` (changes always empty, status ids ↔ CONFIG, sweep semantics), `rolls` (368-cell grid vs `resolveRollOutcome`, formula translation over every catalog damage string, fixed targets: Rokarr Guns (Blaster Pistol) 11, blank Dodge 8, Sahrhie 245/HP 12/Dodge 10/BS 6, Hshif 241/13/9/6), `derived-not-stored`, `transfer-envelope`, `fixtures`.

What cannot be verified here (no Foundry install): rendering, form binding, drag-drop, chat cards, token HUD, sockets. `docs/MANUAL-TEST.md` carries the in-Foundry script with expected figures.

## 9.1 Review corrections folded in (2026-09-10)

An adversarial review of this document (kept at the session scratchpad as `review-architecture.md`; its substance is recorded here) found the items below. Where the built code already does the right thing, this section records the fact; where it does not, the fix is owed by the unit named.

- **Hit locations are an actor field, not Items.** `CHARACTER_FORM_ARRAY_KEYS` has 23 entries and the 23rd is `hitLocations`; the generated schema splits `ITEM_ROW_ARRAY_KEYS` (22, one Item type each — weaponPart covers two) from `SYSTEM_ROW_ARRAY_KEYS` (`hitLocations`, kept on the actor as `ArrayField(ObjectField)`). Built that way in `module/data/actor-schema.generated.mjs` and `module/adapter.mjs`.
- **Ordering.** Items prepare BEFORE the actor's TypeDataModel, so melee/saber derivations that read the owner's stats cannot run in `Item#prepareDerivedData` on the first pass. Built as a two-pass in `module/data/actor-character.mjs`: `stats0 = getCalculatedStats(sheet)`, re-derive the stat-reading items from `stats0`, rebuild the sheet with the injected write-back keys, `stats = getCalculatedStats(sheet)`.
- **Round-trip comparison.** `check:adapter-round-trip` masks the minted uuids and the per-family write-back key set (blaster: the 16 keys of `calculateBlasterStats`; melee: `finalWeight, finalCost, finalParryMod, baseReach, finalDamage, finalDamageType, energyRes, notesAndEffects, maxDurability` (+ the durability/condition keys the hook writes); lightsaber: its coreKeys; armor: `finalDRValue, finalWeight, finalCost, finalMovePenalty, finalDXPenalty, notesAndEffects, condition`; starship: the readouts) and compares the rest; every generated string field is `trim: false` so notes keep their whitespace.
- **Generator rows** (done: U02c, 2026-09-10 — the §4.1 table now states them): `pointsAttributes/pointsAdvantages/pointsDisadvantages` (optional int → nullable NumberField, integer); `incomingArc` (nullable enum → `StringField({ choices, nullable: true, initial: null })`); nullable objects (`droidBuild`, `gearSets`, `storageBoxes`, `pinnedNotifications`) → `ObjectField`/`ArrayField({ nullable: true })`; the nullable-number row carries `integer: true` where zod says int; every string is `trim: false`; `description`/`background`/`notes` are `StringField({ initial: '' })`, not `HTMLField`, and `system.json` declares no `htmlFields`; `shipPosition` is `StringField({ nullable: true })` (the JSON doc's "object | null" is stale — fix it on the website); the 13 dead-echo fields (`drHead`, `drTorso`, `parry`, `block`, root `flawedBuild`, root `currentValues`, `pointsSkills`, `basicLift`, `damageThrust`, `damageSwing`, `spentPoints`, `remainingPoints`, `trackPurchases`; NOT `pointsOther` — a LIVE input — nor `activeFormWeaponId`, nor `incomingArc`) are skipped by the generator by name (`DEAD_ECHO_KEYS`, re-exported as the adapter's `DEAD_ECHO_FIELDS`), never stored, and handed back ABSENT rather than null; `check:actor-schema` pins the list both ways and `check:adapter-round-trip` proves each unread by the engine.
- **Stun sync** is idempotent: both directions are no-ops when the target state already matches, and the stun status effect carries NO `flags.shadowbase.statusEffect` row (the engine derives the stunned card from `stunType`). Built that way in `module/effects.mjs` (a replayed `updateActor`, a same-value update and a duplicate token toggle all leave exactly one mirror and write nothing; `check:effects` pins each, mutation-tested by U02c). The `updateCombat` hook acts on the active GM's client only (`game.users.activeGM === game.user`, `module/combat.mjs#isActingClient`; `check:rolls` calls the hook as a player, as a second GM and with no GM).
- **Polyfill order.** A static `import` is hoisted, so `module/engine.mjs` imports `./polyfills.mjs` FIRST (import order = evaluation order) or awaits a dynamic import after the polyfill; `check:esm` evaluates it under a `crypto` without `randomUUID`.
- **Kits.** `buildTemplateBlaster(spec)` returns `{ blaster, parts }` and `buildTemplateMeleeWeapon` returns `{ weapon, parts }`; the pack manifest's `project` normalises to `kit: { weapon, parts, ammunition }` and supplies ammunition from the profile's ammo type.
- **Templates.** `characterTemplateStore.<key>` is `{ name, description, data, portraitUrl }` — the sheet is `.data`; 65 entries including `blank` (category "Blank"), so the Actor pack has five folders or 64 entries plus the blank as the new-actor seed.
- **Handbook pages.** The Overview page exists only when a chapter has prose before its first h2 (22 of 24 chapters), which is how 24 + 147 h2 = 169 pages.
- **Ownership.** Every wave names one owner for `module/shadowbase.mjs`, `module/config.mjs`, `lang/en.json`, `system.json`, `package.json`; `scripts/check-all.mjs` discovers checks from BOTH `package.json` and `scripts/check-*.mjs` so an unregistered check still runs (reported as unregistered). `tools/engine-entry.ts` is the orchestrator's; a unit that needs a new export requests it.
- **Style stubs.** `system.json` lists stylesheets that later waves create; the manifest owner ships empty stubs so Foundry never 404s and `check:manifest` stays meaningful. Shipped by U02c (2026-09-10): the nine of §3, each a one-comment stub naming its owner; `check:manifest` now requires every listed sheet to exist and every sheet on disk to be listed.
- **Engine freshness.** `check:engine-parity` asserts `engine/BUILD-INFO.json`'s `entry` resolves to `tools/engine-entry.ts`, its `entryExports` equals the entry's export count today, the bundle is newer than the entry, and the bundle exports `applyLoadMigrations`, `calculateMeleeWeaponStats`, `calculateLightsaberStats` and the `weaponAttackSkill` namespace (U02c; the bundle was rebuilt 2026-09-10 with `weaponAttackSkill`, and `module/rolls.mjs` delegates `attackHitBonus` / `attackSkillFor` to it).
- **Fixtures.** `fixtures/export-sahrhie-vosst-2026-09-06.json` (245 CP, HP 12, Dodge 10, BS 6) and `fixtures/export-hshif-2026-09-05.json` (241, 13, 9, 6) are in the repo with portraits stripped; `fixtures/legacy-2025-kaelen-rarr.json` is the legacy-shape regression fixture.

## 9.2 Recorded as built (waves 3-5, 2026-09-10)

The architecture-owner rows of `docs/REQUESTS.md` from units U05-U09, folded here by U10 so the text matches the code.

- **§6.1 Info tab and header (U05).** The Info tab renders eleven sections in this order: Basic Info, Primary Attributes, Secondary Characteristics, Resource Pools, Combat State, Force Alignment, Languages, Encumbrance & Move, Character Details, Narrative, Point Ledger - Languages sits here (the website keeps it under Abilities) and the Encumbrance & Defenses summary stays atop Inventory (U06). The header shows name + portrait + a read-only identity line + the ledger figures + the buttons; the editable Player / Species / Homeworld / Campaign inputs live in Info › Basic Info so no input name binds twice on one form; pinned pools render in the header bar and the section's inputs become read-only while pinned; the species swap runs from the Species input on change through `applySpeciesSwap`. `check:css-tokens` accepts `sb-*` prefixed selectors as namespaced (chat cards, HUD and handbook tables render outside a `.shadowbase` ancestor).
- **§6.1 Body tab (U06).** Order: Droid status / Droid dossier + Workshop / Load-Out / Hit Locations (the Hit Locations & DR table) / Combat State. `check:json-contract` walks the quoted keys of the website's `docs/CHARACTER_JSON_FORMAT.md` and pins Foundry-route == website-route on the exporter's output, skipping the stale `shipPosition` row by name.
- **§6 class list (U08, U09).** Item sheets: `ShadowBaseItemSheet` + `TraitSheet` / `SkillSheet` / `PowerSheet` / `EquipmentSheet` / `ArmorSheet` / `BlasterSheet` / `MeleeSheet` / `LightsaberSheet` / `ExplosiveSheet` / `AmmunitionSheet` / `PartSheet` / `CyberneticSheet` / `StarshipSheet` / `VehicleSheet` (14 families for the 21 types, registered by `module/apps/item-sheets/index.mjs`). Sub-apps share `ActorSubApp` (`module/apps/sub-app.mjs`: one window per actor, the submitOnChange field router, `writeWholeArray`, `syncRows`). `game.shadowbase.itemBuilders` (`module/apps/item-sheets/builders.mjs`) is the one home of `applyBuild` / `releaseBuild` / `rebindOwnedRow` / `slotEdit` / `fittedEdit`.
- **§6.4 item-sheet form grammar (U08).** An input named `system.row.<key>` reaches the Item update untouched (ObjectField merge); everything else is an EDIT the family interprets in `_applyEdits` before the update and may follow with cross-document writes after it (`sel.<key>` a nullable select; `slot.` / `material.` / `wrap.` a structural slot; `entry.` / `entryMaterial.` / `entryQty.` a melee list entry; `mod.` / `internal.` a fitted good; `armorSlot.` / `armorMod.` / `dr.` / `piece` / `cell` armor; `sys.<id>.<field>` a ship system; `install` / `limb` / `addUpgrade` / `pathways` cybernetics; `ammo.loaded`; `level`; `tier.<n>`; `template` / `material` / `wrap` a part). Direct Library Access is a per-window GM toggle (`sheet.libraryAccess`), never stored on the item; it decides every slot's scope through `partAcquisition.slotScope`.
- **§6.5 droids and loadout (U09).** A droid's stored `hitLocations` are kept on the ENGINE's derived anatomy (`droidAnatomy` + `reconcileDroidAnatomy`, the rows `getCalculatedStats` reads for a droid): the Droid Workshop writes them after every build change and the Anatomy Workshop edits status / degradation / hardware links by name|side. The website's `droid-workshop.tsx` syncAnatomy effect writes its own row names that the engine then ignores; the Foundry port follows the engine (a deliberate, documented departure). Body Loadout equips a single piece through `armorLayering.enforceBaseLayer(rows, preferId)`; the set operations (Suits & Sets, the Inventory tab) go through `gearSets.applySetEquip` as the website's panels do.
- **§4.4 advancePhase on a null pool (U02b, still open).** `effects.advancePhase` resolves a never-recorded (null) EP pool to FULL before deducting, where the website's handler reads `Number(null) || 0` - its pools are always filled at load, so it never sees null; a Foundry actor built without `applyLoadMigrations` can. Template Actors and imports run the load path, so the case is reachable only through a hand-built actor.
- **§6.7 settings (U10).** `module/settings.mjs`: world `enforceEconomy` (Boolean, default false, RESERVED - nothing reads it), `npcDefaultHidden` (default true; the Dossier Importer's hidden-ownership pin), `tokenRotationSync` (default false; `system.facing` <-> `TokenDocument.rotation` as hexside x 60 degrees, the writing client only, idempotent both ways, the mirror marked by the update option `shadowbaseFacingSync`; the token art is ASSUMED to face up at rotation 0); client `showHandbookChips`, `showPointCosts`, `compactRows`, `stickySectionHeaders`, `reduceMotion`, `rememberOpenSections`, `keepRollHistory` (Booleans), `rollHistoryDepth` (10/25/50/100) and `notificationDepth` (12/25/50) - the website's `SheetPreferences` names and defaults (`showFloatingHudButton` has no Foundry counterpart). The six client display preferences are stamped as `data-*` attributes on every `.shadowbase` application root (`applyPreferenceAttributes`; the website stamps two of them on `<html>`), so one stylesheet rule acts on the sheet, the HUD, the item sheets and the sub-apps. `pinPools` / `pinPoints` / `hudPosition` / `closedSections` stay user flags.
- **§9 checks.** The suite is 19 checks: the §9 list plus `sheet-tabs`, `json-contract`, `hud`, `item-sheets`, `apps` and `settings`; `check-all` discovers unregistered `scripts/check-*.mjs` files too.

## 10. Assumptions to confirm with Fulllion

Q1 b, Q2 a, Q3 a (flat-top hex), Q4 c, Q5 d, Q6 b, Q7 c, Q9 c, Q10 a, Q11 a, Q12 b, Q13 b, Q14 c, Q15 a, Q16 b, Q17 b, Q18 a, Q20 a (see `decisions.md`); stun-recovery roll applying the declared `stunRecovery` channel; global to-hit applied to every attack; live Malf over stored; GM-only Direct Library Access; portrait kept as a data URL in `system.characterPortrait`.
