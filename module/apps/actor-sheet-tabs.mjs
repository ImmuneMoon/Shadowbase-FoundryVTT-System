// module/apps/actor-sheet-tabs.mjs
//
// The actor sheet's Body, Abilities, Inventory and Vehicles tabs (unit U06;
// docs/ARCHITECTURE.md §6.1). Unit U05 builds the sheet class itself
// (module/apps/actor-sheet.mjs: header, tab strip, Info tab, form pipeline);
// this module is what that class MERGES for the other four tabs:
//
//   bodyContext(actor) / abilitiesContext(actor) / inventoryContext(actor) /
//   vehiclesContext(actor)   the part contexts (`_preparePartContext` returns
//                            `{ ...context, ...bodyContext(this.document) }`);
//   TAB_TEMPLATES            the PARTS templates and the partials to register
//                            with foundry.applications.handlebars.loadTemplates;
//   TAB_ACTIONS              the `data-action` handlers, static-style
//                            `(event, target)` functions whose `this` is the
//                            sheet (`static actions = { ...TAB_ACTIONS }`);
//   extractTabSubmitData / applyItemUpdates
//                            the form-pipeline hook: item-row inputs
//                            (`items.<id>.row.<key>`), whole-array fields
//                            (`hitLocations.<id>.<key>`, `storageBoxes.<id>.<key>`,
//                            `starshipSystems.<itemId>.<sysId>.<key>`) and the
//                            catalog re-read a level change implies.
//
// Every figure shown comes out of the engine bundle or the actor's prepared
// data (actor.stats = getCalculatedStats, item.derived = the family's
// calculate*Stats); nothing here re-implements a rule. Where the website
// composes a figure inline in a component the line is cited so the port can
// be checked against it. The section inventory of each tab is the website's
// (character-form.tsx 578-740, character-inventory.tsx, vehicles-and-
// starships-section.tsx, form-groups/character-abilities.tsx); U05's
// docs/STYLE-SPEC.md / templates/README.md is the checklist once it lands.
//
// Whole-array writes: `system.hitLocations`, `system.storageBoxes` and a
// starship row's `systems` are arrays inside ObjectField/ArrayField(ObjectField)
// storage. A dotted per-index key (`system.hitLocations.3.innateDR`) is
// expanded by Foundry into `{ 3: {...} }` and the array is REPLACED by that
// object (ARCHITECTURE.md §6.5, review finding M5), so the templates bind
// those inputs under a private prefix and extractTabSubmitData rewrites the
// whole array.

import { engine } from '../engine.mjs';
import { rowsOf, rowWithDerived, rowToItemData, nextSort, itemNameFor } from '../adapter.mjs';
import { ITEM_TYPES, SOURCE_TO_TYPE } from '../config.mjs';
import { rolls } from '../rolls.mjs';
import { exportJson, importFromFilePicker, exportItemEnvelope, importItemFromFilePicker, transferKindFor } from '../import-export.mjs';

export const SYSTEM_ID = 'shadowbase';
const TEMPLATE_ROOT = 'systems/shadowbase/templates/actor';

/** PARTS templates (one per tab) and the partials every tab template references (register both with loadTemplates). */
export const TAB_TEMPLATES = Object.freeze({
  parts: Object.freeze({
    body: `${TEMPLATE_ROOT}/body.hbs`,
    abilities: `${TEMPLATE_ROOT}/abilities.hbs`,
    inventory: `${TEMPLATE_ROOT}/inventory.hbs`,
    vehicles: `${TEMPLATE_ROOT}/vehicles.hbs`,
  }),
  partials: Object.freeze([
    'trait-row', 'skill-row', 'power-row', 'technique-row', 'form-row',
    'equipment-row', 'armor-row', 'weapon-row', 'part-row', 'implant-row', 'storage-box',
    'hit-location-table', 'starship-card', 'vehicle-card', 'row-tools',
  ].map((n) => `${TEMPLATE_ROOT}/parts/${n}.hbs`)),
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
/** Figures print the way the website prints them: at most two decimals, no trailing zeros. */
const fig = (v, digits = 2) => (Number.isFinite(Number(v)) ? String(Number(Number(v).toFixed(digits))) : '');
const money = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString('en-US') : '');
const text = (v) => (v === null || v === undefined ? '' : String(v));

/** The engine's CalculatedStatsResult, or null when the engine failed on this actor. */
function statsOf(actor) { return actor?.stats ?? actor?.system?.derived ?? null; }
/** The composed website sheet the engine last read. */
function sheetOf(actor) { return actor?.sheetData ?? actor?.system?.sheetCache ?? null; }
/** Whether the sheet is editable (a shim actor has no ownership; a real one answers isOwner). */
function editableOf(actor) { return actor?.isOwner ?? true; }

/** The 23 numeric modifier channels as the website's badges spell them (`+2 DX`, `x0.5 MOVE`, `FRIGHT IMMUNE`). */
const CHANNEL_KEYS = Object.freeze({
  strength: 'ST', dexterity: 'DX', iq: 'IQ', health: 'HT', will: 'Will', perception: 'Per', move: 'Move', dodge: 'Dodge',
  dr: 'DR', carryCapacity: 'Carry', endurancePoints: 'EP', forcePoints: 'FP', toHit: 'ToHit', basicSpeed: 'BasicSpeed',
  hitPoints: 'HP', frightCheck: 'Fright', parry: 'Parry', block: 'Block', stunRecovery: 'StunRecovery', strikingSt: 'StrikingST',
  liftingSt: 'LiftingST', kickDamage: 'KickDamage', jumpDistance: 'Jump',
});

/**
 * Modifier-bag badges (status-effect display parity: per-channel `+2 DX`,
 * `FRIGHT IMMUNE`, `x0.5 MOVE`; green for a bonus, red for a penalty).
 * @param {object|null} bag a modifier bag (NO_MODIFIERS shape)
 */
export function modifierBadges(bag) {
  if (!bag || !engine.hasAnyModifier(bag)) return [];
  const out = [];
  for (const [key, label] of Object.entries(CHANNEL_KEYS)) {
    const v = Number(bag[key]) || 0;
    if (!v) continue;
    out.push({ key, text: `${signed(v)} ${loc(`SHADOWBASE.Sheet.Channel.${label}`)}`, positive: v > 0 });
  }
  if (bag.frightImmune) out.push({ key: 'frightImmune', text: loc('SHADOWBASE.Sheet.Channel.FrightImmune'), positive: true });
  const mult = Number(bag.moveMultiplier);
  if (Number.isFinite(mult) && mult !== 1) out.push({ key: 'moveMultiplier', text: fmt('SHADOWBASE.Sheet.Channel.MoveMultiplier', { mult }), positive: mult > 1 });
  return out;
}

/**
 * Handbook chip titles by registry id (the sheet's own chipTitle in module/apps/actor-sheet.mjs reads the same
 * registry); every tab context carries the map so the section partial's `(lookup @root.chips id)` resolves in strict mode.
 */
export function chipTitles() {
  const targets = engine.handbookRegistry?.HANDBOOK_CHIP_TARGETS ?? {};
  return Object.fromEntries(Object.entries(targets).map(([id, t]) => [id, t?.title ?? id]));
}

/** `{ id, rowId, name, type, img, typeLabel }` for a row Item. */
function ref(item) {
  return {
    id: item.id,
    rowId: item.rowId ?? item.system?.row?.id ?? null,
    name: item.displayName ?? item.name,
    type: item.type,
    img: item.img ?? ITEM_TYPES[item.type]?.img ?? '',
    typeLabel: loc(ITEM_TYPES[item.type]?.label ?? 'SHADOWBASE.Item.Unnamed'),
  };
}

/** The Item whose stored row has this uuid, or null. */
function byRowId(actor, uuid) {
  if (!uuid) return null;
  if (typeof actor.itemByRowId === 'function') return actor.itemByRowId(uuid);
  return actor.items?.find?.((i) => i.system?.row?.id === uuid) ?? null;
}

/** Storage-box options for a row's Send-to-storage select (blank = carried). */
function storageOptions(actor, current) {
  const boxes = Array.isArray(actor.system?.storageBoxes) ? actor.system.storageBoxes : [];
  return [{ value: '', label: loc('SHADOWBASE.Sheet.Inventory.Carried'), selected: !current },
    ...boxes.map((b) => ({ value: b.id, label: b.name || loc('SHADOWBASE.Sheet.Inventory.UnnamedBox'), selected: b.id === current }))];
}

/** Condition badge tone: Fine is neutral, everything else is destructive (armor-item-card.tsx:608). */
const conditionOf = (v) => { const c = text(v) || 'Fine'; return { text: c, fine: c === 'Fine' }; };

// ---------------------------------------------------------------------------
// BODY TAB (character-form.tsx 621-719: Droid PC status, Droid Tactical Dossier,
// Droid Character Workshop, Load-Out by Location, Anatomy Workshop; the
// Hit Locations & DR table is character-inventory.tsx 249-257 /
// hit-location-section.tsx, placed on Body here per the unit brief)
// ---------------------------------------------------------------------------

/**
 * @param {object} actor a prepared ShadowBaseActor (or shim actor)
 */
export function bodyContext(actor) {
  const stats = statsOf(actor);
  const sheet = sheetOf(actor) ?? {};
  const system = actor.system ?? {};
  const isDroid = !!system.isDroid;
  const anatomy = stats?.dynamicHitLocations ?? [];
  const drDisplay = stats?.hitLocationDRDisplay ?? {};
  const loadout = stats ? engine.bodyLoadout.resolveBodyLoadout(sheet) : { rows: [], unlocated: [], unplaced: [], freeHandIds: [] };
  const loadoutByLocation = new Map(loadout.rows.map((r) => [r.location.id, r]));
  const hardwareName = (id) => byRowId(actor, id)?.displayName ?? byRowId(actor, id)?.name ?? null;

  const locations = anatomy.map((l) => {
    const stored = (system.hitLocations ?? []).find((h) => h.id === l.id) ?? null;
    const lo = loadoutByLocation.get(l.id) ?? null;
    return {
      id: l.id,
      name: l.name,
      type: l.type,
      side: l.side ?? null,
      isOrganic: !!l.isOrganic,
      isProsthetic: !!l.isProsthetic,
      isAmputated: !!l.isAmputated,
      status: text(l.status) || 'Healthy',
      healthy: (text(l.status) || 'Healthy') === 'Healthy',
      isCrippled: !!l.isCrippled,
      cripplingThreshold: l.cripplingThreshold ?? null,
      targetPenalty: l.targetPenalty ?? null,
      // Total DR with the typed riders the website prints (formatTypedDR) - the same string hitLocationDRDisplay carries.
      drText: text(drDisplay[l.name] ?? engine.typedResistance.formatTypedDR(l.totalDR ?? 0, l.typedDR ?? [])),
      totalDR: l.totalDR ?? 0,
      // Innate DR is actor state (stored row); droids derive theirs from hardware and have no input (anatomy-workshop.tsx:571).
      innateDR: stored ? num(stored.innateDR) : num(l.innateDR),
      innateEditable: !isDroid && !!stored,
      degradation: num(l.currentDegradation),
      hardware: (l.installedHardwareIds ?? []).map((id) => ({ id, name: hardwareName(id) ?? id })),
      // What covers it: worn on the limb, or derived from another piece (Ch13 arm/face DR), or held in it.
      worn: (lo?.worn ?? []).map((a) => ({ id: a.id, name: a.name })),
      protectedBy: (lo?.protectedBy ?? []).map((p) => ({ id: p.item.id, name: p.item.name, dr: p.dr })),
      held: (lo?.held ?? []).map((p) => ({ id: p.weapon.id, name: p.weapon.name, twoHanded: !!p.weapon.twoHanded, worn: !!p.weapon.worn, pinned: !!p.pinned })),
    };
  });

  const apps = globalThis.game?.shadowbase?.apps ?? {};
  const facingArc = stats?.defenseAdjustments?.arc ?? null;
  const stunned = engine.stunRules.isStunned(system.stunType);
  return {
    chips: chipTitles(),
    isDroid,
    editable: editableOf(actor),
    locations,
    locationCount: locations.length,
    hitLocationsTitle: loc(isDroid ? 'SHADOWBASE.Sheet.Body.DroidHitLocations' : 'SHADOWBASE.Sheet.Body.HitLocations'),
    loadout: {
      readiedCount: engine.bodyLoadout.readiedWeapons(sheet).length,
      freeHands: loadout.freeHandIds.length,
      handCount: anatomy.filter((l) => !l.isAmputated && String(l.type) === 'Hand').length,
      unlocated: loadout.unlocated.map((a) => ({ id: a.id, name: a.name })),
      unplaced: loadout.unplaced.map((w) => ({ id: w.id, name: w.name, twoHanded: !!w.twoHanded, worn: !!w.worn })),
    },
    droid: isDroid && stats ? {
      st: stats.primaryAttributes.rawStrength,
      hp: stats.currentValues.hitPoints,
      dx: stats.primaryAttributes.effectiveDexterity,
      iq: stats.primaryAttributes.effectiveIQ,
      move: stats.currentEncumbrance.move,
      dodge: stats.currentEncumbrance.dodge,
      pp: num(system.powerPoints),
      ppMax: stats.currentValues.maxPowerPoints ?? null,
      hardwareCp: stats.points.droidHardware ?? 0,
      chassis: system.droidBuild?.chassisId ?? null,
      isConstructed: system.isConstructed !== false,
    } : null,
    state: {
      turnCounter: num(system.turnCounter),
      facing: num(system.facing),
      incomingBearing: num(system.incomingBearing),
      threatEngaged: !!system.threatEngaged,
      facingChangeUsed: !!system.facingChangeUsed,
      arc: facingArc,
      flanked: !!stats?.defenseAdjustments?.flanked,
      stunType: text(system.stunType) || 'None',
      stunOptions: ['None', 'Physical', 'Mental'].map((v) => ({ value: v, label: loc(`SHADOWBASE.Sheet.Body.Stun.${v}`), selected: (text(system.stunType) || 'None') === v })),
      stunned,
      dodge: stats?.currentEncumbrance?.dodge ?? null,
      parryAvailable: !!stats?.defenseAdjustments?.parryAvailable,
      blockAvailable: !!stats?.defenseAdjustments?.blockAvailable,
      dodgeAvailable: !!stats?.defenseAdjustments?.dodgeAvailable,
    },
    apps: {
      bodyLoadout: !!apps.BodyLoadout,
      anatomyWorkshop: !!apps.AnatomyWorkshop,
      droidWorkshop: !!apps.DroidWorkshop,
      hud: !!apps.TacticalHud,
    },
    engineError: actor.system?.engineError ?? null,
  };
}

// ---------------------------------------------------------------------------
// ABILITIES TAB (form-groups/character-abilities.tsx: Advantages & Perks,
// Disadvantages, Quirks, Skills, [Languages - Info tab, U05], Force Powers,
// Combat Techniques, Lightsaber Forms)
// ---------------------------------------------------------------------------

const TRAIT_SOURCES = Object.freeze({ advantages: 'advantage', disadvantages: 'disadvantage', quirks: 'quirk' });

/** The library entry a trait row names (byte-identical names are the join key). */
export function traitLibraryEntry(source, name) {
  if (!name) return null;
  if (source === 'advantages') return engine.advantages.advantagesLibrary.find((a) => a.name === name) ?? null;
  if (source === 'disadvantages') {
    const viaHelper = engine.disadvantages.libraryEntryForDisadvantage?.(name);
    return viaHelper ?? engine.disadvantages.disadvantagesLibrary.find((d) => d.name === name) ?? null;
  }
  return engine.quirks.allQuirksList.find((q) => q.name === name) ?? null;
}

function traitRow(actor, item, source) {
  const row = item.system?.row ?? {};
  const entry = traitLibraryEntry(source, row.name);
  const points = num(row.points);
  const baseline = num(row.baselinePoints);
  // advantages-section.tsx:135-137: a budget-granting trait (Versatility) shows 0 with the grant named.
  const budgetGrant = num(entry?.grantsBudget);
  const effective = budgetGrant > 0 ? 0 : points - baseline;
  const levels = Array.isArray(entry?.levels) ? entry.levels : null;
  // advantages-section.tsx:156-163: the select resolves by POINTS where a ladder entry matches, else the stored level.
  const selectedLevel = levels ? (levels.find((l) => l.points === points)?.level ?? row.level ?? null) : null;
  return {
    ...ref(item),
    source,
    rowName: text(row.name),
    points,
    baselinePoints: baseline,
    effective,
    budgetGrant,
    granted: baseline > 0,
    hasLevels: !!levels,
    level: row.level ?? null,
    levels: (levels ?? []).map((l) => ({ value: l.level, label: `${l.label ?? l.description ?? `${loc('SHADOWBASE.Sheet.Abilities.Level')} ${l.level}`} (${l.points} ${loc('SHADOWBASE.Sheet.Abilities.PtsShort')})`, selected: l.level === selectedLevel })),
    category: text(row.category || entry?.category),
    fromSpecies: text(row.fromSpecies),
    description: text(row.description),
    libraryDescription: text(entry?.description),
    inLibrary: !!entry,
    modifiers: modifierBadges(engine.traitModifiersFor(row)),
    specifier: text(entry?.specifierPrompt),
  };
}

function skillRow(actor, item, stats) {
  const row = item.system?.row ?? {};
  const name = text(row.name);
  const split = name ? engine.skillDefaults.splitSpecialty(name) : { base: '', specialty: null };
  // skills-section.tsx:153-162: priced off skillPricingAttributes, never the gear-inclusive set.
  const cost = stats ? num(engine.calculateCostForSkill({ name, level: row.level, relativeLevel: row.relativeLevel }, stats.skillPricingAttributes)) : 0;
  const baseline = num(row.baselinePoints);
  const gear = stats ? engine.skillBonuses.skillBonusFor(stats.skillBonuses, name) : { flat: 0, situational: [] };
  const level = text(row.level);
  const target = rolls.skillTargetFor(actor, name);
  return {
    ...ref(item),
    rowName: name,
    base: split.base,
    specialty: text(split.specialty),
    relativeLevel: text(row.relativeLevel),
    level,
    points: num(row.points),
    baselinePoints: baseline,
    cost,
    effective: Math.max(0, cost - baseline),
    gearFlat: num(gear.flat),
    gearSituational: (gear.situational ?? []).map((s) => (typeof s === 'string' ? s : `${signed(num(s.bonus ?? s.value))} ${text(s.condition ?? s.label ?? '')}`.trim())),
    target: target?.target ?? null,
    describe: text(target?.describe),
    notes: text(row.notes),
    bareSpecialtyWarning: text(engine.specialtyRequired.bareSpecialtyWarning(name)),
  };
}

function powerRow(actor, item) {
  const row = item.system?.row ?? {};
  const name = text(row.name);
  const catalog = engine.forcePowers.forcePowersData.filter((p) => p.name === name);
  const isCustom = !!row.custom;
  // force-powers-section.tsx:118-121: catalog levels, else 1-4 for a custom (or unknown) power.
  const available = (isCustom || (name && catalog.length === 0)) ? [1, 2, 3, 4] : catalog.map((p) => p.level);
  const level = num(row.level, 0) || null;
  const selected = catalog.find((p) => p.level === level) ?? null;
  const costs = rolls.forcePowerCostsFor(actor, item);
  const target = rolls.forcePowerTargetFor(actor, item);
  const cp = num(row.cpCost);
  const baseline = num(row.baselinePoints);
  return {
    ...ref(item),
    rowName: name,
    level,
    levels: available.map((l) => ({ value: l, label: String(l), selected: l === level })),
    tier: text(row.characterTier ?? selected?.characterTier),
    alignment: text(row.alignment ?? selected?.alignment),
    category: text(row.category ?? selected?.category),
    baseSkill: text(row.baseSkill ?? selected?.baseSkill),
    requirements: text(row.requirements ?? selected?.requirements),
    cpCost: cp,
    baselinePoints: baseline,
    effective: Math.max(0, cp - baseline),
    fpCost: num(costs?.fp),
    epCost: num(costs?.ep),
    target: target?.level ?? null,
    targetSkill: text(target?.name),
    describe: text(target?.describe),
    effect: text(row.effect ?? selected?.effect),
    description: text(row.description ?? selected?.description),
    isCustom,
    inCatalog: catalog.length > 0,
  };
}

const TECHNIQUE_CATEGORIES = Object.freeze(['Universal', 'Melee', 'Unarmed', 'Ranged']);

function techniqueRow(actor, item, readied) {
  const row = item.system?.row ?? {};
  const name = text(row.name);
  const catalog = engine.techniques.allCombatTechniques.filter((t) => t.name === name);
  const isCustom = !!row.custom;
  const available = (isCustom || (name && catalog.length === 0)) ? [1, 2, 3, 4] : catalog.map((t) => t.level);
  const level = num(row.level, 0) || null;
  const weaponItem = byRowId(actor, row.selectedWeaponId);
  const category = text(row.category) || 'Universal';
  const isUnarmed = category === 'Unarmed';
  const target = rolls.techniqueTargetFor(actor, item, { weaponItem });
  const cp = num(row.cpCost);
  const baseline = num(row.baselinePoints);
  return {
    ...ref(item),
    rowName: name,
    level,
    levels: available.map((l) => ({ value: l, label: `${loc('SHADOWBASE.Sheet.Abilities.Tier')} ${l}`, selected: l === level })),
    category,
    tier: text(row.characterTier),
    baseSkill: text(row.baseSkill),
    cpCost: cp,
    baselinePoints: baseline,
    effective: Math.max(0, cp - baseline),
    epCost: num(row.epCost),
    fpCost: num(row.fpCost),
    hasCosts: num(row.epCost) > 0 || num(row.fpCost) > 0,
    damageBonus: text(row.damageBonus),
    skillBonus: num(row.skillBonus),
    skillPenalty: num(row.skillPenalty),
    isUnarmed,
    needsWeapon: !isUnarmed,
    selectedWeaponId: text(row.selectedWeaponId),
    weapons: [{ value: '', label: loc('SHADOWBASE.Sheet.Abilities.SelectWeapon'), selected: !row.selectedWeaponId },
      ...readied.map((w) => ({ value: w.rowId ?? '', label: w.name, selected: w.rowId === row.selectedWeaponId }))],
    target: target?.target ?? null,
    targetSkill: text(target?.skillName),
    effect: text(row.effect),
    isCustom,
  };
}

function formRow(actor, item, activeFormName, boundSaber, readiedSabers) {
  const row = item.system?.row ?? {};
  const name = text(row.name);
  const level = num(row.level, 0) || null;
  const details = name && level ? engine.lightsaberForms.getFormDetails(name, level) : null;
  const isActive = !!name && activeFormName === name;
  const formEffect = isActive && level ? engine.lightsaberForms.activeFormEffect(name, level) : engine.lightsaberForms.NO_FORM_EFFECT;
  const cp = num(row.cpCost ?? details?.cpCost);
  const baseline = num(row.baselinePoints);
  // lightsaber-forms-section.tsx:88-99: with a saber the weapon's own attack skill; else the best Lightsaber Combat held.
  const attackInfo = boundSaber ? rolls.attackTargetFor(actor, boundSaber) : null;
  const attackTarget = attackInfo ? attackInfo.target + attackInfo.hitBonus + (formEffect.attack || 0) : null;
  const defense = (kind) => (isActive ? rolls.defenseTargetFor(actor, kind, { weaponItem: kind === 'dodge' ? null : boundSaber }) : null);
  const dodge = isActive ? defense('dodge') : null;
  const parry = isActive && boundSaber ? defense('parry') : null;
  const block = isActive && boundSaber ? defense('block') : null;
  return {
    ...ref(item),
    rowName: name,
    forms: engine.lightsaberForms.lightsaberForms.map((f) => ({ value: f.name, label: f.name, selected: f.name === name })),
    level,
    levels: [1, 2, 3, 4].map((l) => ({ value: l, label: `${loc('SHADOWBASE.Sheet.Abilities.Level')} ${l}`, selected: l === level })),
    tier: text(row.characterTier ?? details?.characterTier),
    cpCost: cp,
    baselinePoints: baseline,
    effective: Math.max(0, cp - baseline),
    effect: text(row.effect ?? details?.effect),
    isActive,
    hasSaber: !!boundSaber,
    saberName: boundSaber ? (boundSaber.displayName ?? boundSaber.name) : '',
    sabers: [{ value: '', label: loc('SHADOWBASE.Sheet.Abilities.SelectSaber'), selected: !boundSaber },
      ...readiedSabers.map((s) => ({ value: s.rowId ?? '', label: s.name, selected: !!boundSaber && s.id === boundSaber.id }))],
    bonuses: { attack: num(formEffect.attack), parry: num(formEffect.parry), dodge: num(formEffect.dodge), block: num(formEffect.block), basicMove: num(formEffect.basicMove) },
    attackTarget,
    dodgeTarget: dodge?.target ?? null,
    parryTarget: parry?.target ?? null,
    blockTarget: block?.target ?? null,
    damage: text(boundSaber ? rowWithDerived(boundSaber).calculatedDamage : ''),
    isCustom: !!row.custom,
  };
}

/**
 * @param {object} actor
 */
export function abilitiesContext(actor) {
  const stats = statsOf(actor);
  const system = actor.system ?? {};
  const readied = rolls.equippedWeapons(actor).map((w) => ({ ...ref(w), item: w }));
  const readiedSabers = readied.filter((w) => w.type === 'lightsaber');
  // lightsaber-forms-section.tsx:61-65: the bound saber, or the only readied one.
  const boundSaber = (system.activeFormWeaponId ? readiedSabers.find((s) => s.rowId === system.activeFormWeaponId)?.item : null)
    ?? (readiedSabers.length === 1 ? readiedSabers[0].item : null);
  const techniques = rowsOf(actor, 'combatTechniques').map((i) => techniqueRow(actor, i, readied));
  const quirks = rowsOf(actor, 'quirks');
  const zeroPoints = { attributes: 0, advantages: 0, disadvantages: 0, quirks: 0, skills: 0, other: 0, template: 0, spent: 0, remaining: 0, lightsaberForms: 0, forcePowers: 0, combatTechniques: 0, droidHardware: 0 };
  const activeForm = text(system.activeLightsaberForm);
  const points = stats?.points ?? zeroPoints;
  return {
    chips: chipTitles(),
    editable: editableOf(actor),
    points,
    formsMeta: `${fmt('SHADOWBASE.Sheet.Abilities.SectionPoints', { n: points.lightsaberForms })}${activeForm ? ` · ${fmt('SHADOWBASE.Sheet.Abilities.ActiveForm', { name: activeForm })}` : ''}`,
    advantages: rowsOf(actor, 'advantages').map((i) => traitRow(actor, i, 'advantages')),
    disadvantages: rowsOf(actor, 'disadvantages').map((i) => traitRow(actor, i, 'disadvantages')),
    quirks: quirks.map((i) => traitRow(actor, i, 'quirks')),
    quirkLimit: engine.quirks.MAX_QUIRKS,
    quirkLimitExceeded: quirks.length > engine.quirks.MAX_QUIRKS,
    skills: rowsOf(actor, 'skills').map((i) => skillRow(actor, i, stats)),
    forcePowers: rowsOf(actor, 'forcePowers').map((i) => powerRow(actor, i)),
    forceAlignment: num(system.forceAlignment),
    techniqueGroups: TECHNIQUE_CATEGORIES.map((category) => ({ category, label: loc(`SHADOWBASE.Sheet.Abilities.Technique.${category}`), hint: loc(`SHADOWBASE.Sheet.Abilities.Technique.${category}Hint`), rows: techniques.filter((t) => t.category === category) })),
    techniqueStrays: techniques.filter((t) => !TECHNIQUE_CATEGORIES.includes(t.category)),
    lightsaberForms: rowsOf(actor, 'lightsaberForms').map((i) => formRow(actor, i, text(system.activeLightsaberForm) || null, boundSaber, readiedSabers)),
    activeLightsaberForm: text(system.activeLightsaberForm),
    activeFormWeaponId: text(system.activeFormWeaponId),
    packs: { advantages: 'advantages', disadvantages: 'disadvantages', quirks: 'quirks', skills: 'skills', forcePowers: 'force-powers', combatTechniques: 'combat-techniques', lightsaberForms: 'lightsaber-forms' },
  };
}

// ---------------------------------------------------------------------------
// INVENTORY TAB (character-inventory.tsx: wallet card; Encumbrance & Defenses;
// General Equipment; Armor & Clothing (+ Suits & Sets, Gear Sets); Weapons -
// Melee / Ranged / Explosives / Lightsabers; Ammo, Mods & Parts; Implants &
// Cybernetics; Storage Boxes)
// ---------------------------------------------------------------------------

function equipmentRow(actor, item) {
  const row = item.system?.row ?? {};
  const qty = num(row.quantity, 1) || 1;
  const isCurrency = row.category === 'Currencies';
  const isChip = isCurrency && row.storedValue !== undefined && row.storedValue !== null;
  const isAurodium = isCurrency && row.denominationValue !== undefined && row.denominationValue !== null;
  const blueprint = engine.blueprints.isBlueprint(row);
  return {
    ...ref(item),
    rowName: text(row.name),
    quantity: qty,
    weight: fig(row.weight),
    totalWeight: fig(num(row.weight) * qty),
    cost: money(row.cost),
    totalCost: money(num(row.cost) * qty),
    condition: conditionOf(row.condition),
    category: text(row.category) || 'General',
    weightless: !!row.weightless,
    isBlueprint: blueprint,
    blueprintOf: text(row.blueprintOf),
    isFirmwareCard: row.isFirmwareCard === true,
    isCurrency,
    currencyText: isChip ? `${money(num(row.storedValue) * qty)} cr` : isAurodium ? `${money(num(row.denominationValue) * qty)} cr` : '',
    currencyDigital: isChip,
    description: text(row.description ?? row.notes),
    storage: storageOptions(actor, row.storageLocationId),
    boxed: !!row.storageLocationId,
    installed: !!row.isInstalled,
    kind: transferKindFor(item),
  };
}

function armorRow(actor, item, sets, locationNames) {
  const row = item.system?.row ?? {};
  const d = item.system?.derived ?? null;
  const merged = rowWithDerived(item);
  // Energy shields are the rows shieldProfileForItem recognises (shield-rules.ts); the type string is the fallback.
  let isShield = false;
  try { isShield = !!engine.shieldRules.shieldProfileForItem(row); } catch { isShield = false; }
  if (!isShield) isShield = row.type === 'Energy Shield';
  const set = sets.find((s) => s.memberIds.includes(row.id)) ?? null;
  return {
    ...ref(item),
    rowName: text(row.name),
    armorType: text(row.type),
    slot: text(row.slot),
    tier: text(row.tier),
    dr: d ? d.finalDRValue : num(merged.finalDRValue),
    drText: d ? engine.typedResistance.formatTypedDR(d.finalDRValue ?? 0, d.typedDR ?? []) : text(merged.finalDRValue),
    drNotes: text(d?.finalDRNotes),
    weight: fig(merged.finalWeight ?? row.weight),
    cost: money(merged.finalCost ?? row.cost),
    quantity: num(row.quantity, 1) || 1,
    equipped: !!row.equipped,
    isActive: !!row.isActive,
    isShield,
    sealed: !!row.sealed,
    condition: conditionOf(d?.derivedCondition ?? row.condition),
    movePenalty: num(merged.finalMovePenalty),
    dxPenalty: num(merged.finalDXPenalty),
    coverage: (row.coveredLocationIds ?? []).map((id) => locationNames.get(id) ?? '').filter(Boolean),
    wornAt: locationNames.get(row.wornLocationId) ?? '',
    setName: set ? set.name : '',
    setId: text(row.setId),
    installed: !!row.isInstalled,
    boxed: !!row.storageLocationId,
    storage: storageOptions(actor, row.storageLocationId),
    notesAndEffects: text(merged.notesAndEffects ?? row.notes),
    isConstructed: row.isConstructed !== false,
    kind: transferKindFor(item),
  };
}

/** The HUD's readied-weapon chips for a weapon row: what the card header shows for each family. */
function weaponChips(kind, r) {
  const chip = (key, value) => (value === '' || value === null || value === undefined ? null : { label: loc(`SHADOWBASE.Sheet.Weapon.${key}`), value: text(value) });
  const list = kind === 'explosive' ? [
    chip('Damage', r.finalDamageEffect || engine.explosiveData.ALL_EXPLOSIVES_DATA.find((e) => e.name === r.baseExplosiveName)?.damageEffect), chip('Skill', r.baseSkill), chip('Legality', r.finalLegalityClass),
  ] : kind === 'blaster' ? [
    chip('Damage', r.finalDamage ? `${r.finalDamage} ${text(r.finalDamageType)}`.trim() : ''), chip('Acc', r.finalAccuracy), chip('Range', r.finalHalfDamageRange),
    chip('RoF', r.finalRateOfFire), chip('ST', r.finalST), chip('Bulk', r.finalBulk), chip('Rcl', r.finalRecoil),
  ] : kind === 'melee' ? [
    chip('Damage', r.finalDamage ? `${r.finalDamage} ${text(r.finalDamageType)}`.trim() : ''), chip('Reach', r.baseReach), chip('Parry', Number.isFinite(Number(r.finalParryMod)) ? signed(num(r.finalParryMod)) : ''),
    chip('MinST', r.finalStRequirement), r.isUnbalanced ? chip('Unbalanced', loc('SHADOWBASE.Sheet.Weapon.UnbalancedMark')) : null,
  ] : kind === 'lightsaber' ? [
    chip('Damage', r.calculatedDamage), r.calculatedDamageTwo ? chip('DamageTwo', r.calculatedDamageTwo) : null, chip('ClassType', r.classType),
    chip('Parry', Number.isFinite(Number(r.finalParryMod)) ? signed(num(r.finalParryMod)) : ''), chip('EnergyRes', r.energyRes),
  ] : [];
  return list.filter(Boolean);
}

function weaponRow(actor, item, kind) {
  const row = item.system?.row ?? {};
  const r = rowWithDerived(item);
  const d = item.system?.derived ?? null;
  const isExplosive = kind === 'explosive';
  const attack = isExplosive ? null : rolls.attackTargetFor(actor, item);
  const blocked = isExplosive ? null : rolls.attackBlockedReason(actor, item);
  // customized-explosive-item.tsx:121: the stored effect, else the catalog's damageEffect for the base explosive (a
  // template row carries only baseExplosiveName / quantity / baseSkill / finalCost / finalWeight).
  const baseExplosive = isExplosive ? engine.explosiveData.ALL_EXPLOSIVES_DATA.find((e) => e.name === row.baseExplosiveName) ?? null : null;
  const damage = isExplosive ? { formula: text(r.finalDamageEffect || baseExplosive?.damageEffect), pendingHits: 0 } : rolls.damageFormulaFor(actor, item);
  const pending = num(damage?.pendingHits);
  const loaded = row.loadedAmmunitionData ?? null;
  const hasCharges = row.currentCharges !== undefined && row.currentCharges !== null;
  const throwSkill = isExplosive ? text(row.baseSkill) : '';
  const throwTarget = isExplosive && throwSkill ? rolls.skillTargetFor(actor, throwSkill)?.target ?? null : null;
  const maxDur = num(r.maxDurability);
  return {
    ...ref(item),
    kind,
    rowName: text(row.customName || row.name || row.baseExplosiveName || row.baseType),
    baseType: text(row.baseType ?? row.baseExplosiveName),
    chips: weaponChips(kind, r),
    readied: !!row.equipped && !row.storageLocationId,
    boxed: !!row.storageLocationId,
    storage: storageOptions(actor, row.storageLocationId),
    quantity: num(row.quantity, 1) || 1,
    weight: fig(r.finalWeight ?? row.weight),
    cost: money(r.totalCost ?? r.finalCost ?? row.cost),
    attackTarget: attack ? attack.target + attack.hitBonus : throwTarget,
    attackSkill: attack ? attack.skillName : throwSkill,
    attackNote: text(attack?.note),
    blocked: text(blocked),
    canAttack: isExplosive ? throwTarget !== null : !blocked && !!attack,
    pendingHits: pending,
    canDamage: isExplosive ? !!damage.formula : pending > 0,
    damage: text(damage?.formula ?? (damage?.volley ? loc('SHADOWBASE.Sheet.Weapon.Volley') : '')),
    ammo: hasCharges || loaded ? { current: num(row.currentCharges), max: num(row.maxCharges ?? loaded?.maxCharges), loadedName: text(loaded?.name), gasGrade: text(loaded?.gasGrade) } : null,
    malfunction: isExplosive ? null : rolls.malfunctionThresholdFor(item),
    condition: conditionOf(r.condition),
    durability: r.durability ?? null,
    maxDurability: maxDur || null,
    durabilityText: r.durability === null || r.durability === undefined ? '' : `${r.durability}/${maxDur}`,
    isUnready: !!row.isUnready,
    isConstructed: row.isConstructed !== false,
    flawed: row.flawedBuild === true,
    twoHanded: !isExplosive && engine.isWeaponTwoHanded(r, sheetOf(actor)?.weaponModifications ?? []),
    notes: text(r.notesAndEffects ?? r.combinedEffects ?? row.customNotes ?? row.notes),
    kindLabel: loc(`SHADOWBASE.Sheet.Weapon.Kind.${kind}`),
    derivedError: text(item.system?.derivedError),
    transferKind: transferKindFor(item),
  };
}

/** The host Item a part is installed in (installedIn*Id -> the weapon/armor/limb row). */
function hostOf(actor, row) {
  const id = row.installedInBlasterId || row.installedInMeleeId || row.installedInSaberId || row.installedInArmorId || row.installedInDroidId || null;
  if (!id) return null;
  if (id === 'PLAYER_DROID') return { id, name: loc('SHADOWBASE.Sheet.Inventory.PlayerDroid') };
  const host = byRowId(actor, id);
  return host ? { id: host.id, name: host.displayName ?? host.name } : { id, name: id };
}

function partRow(actor, item) {
  const row = item.system?.row ?? {};
  return {
    ...ref(item),
    rowName: text(row.customName || row.name),
    family: item.system?.family ?? null,
    familyLabel: loc(item.type === 'armorPart' ? 'SHADOWBASE.Sheet.Inventory.ArmorPart' : item.system?.family === 'lightsaber' ? 'SHADOWBASE.Sheet.Inventory.SaberPart' : 'SHADOWBASE.Sheet.Inventory.WeaponPart'),
    quantity: num(row.quantity, 1) || 1,
    weight: fig(row.weight),
    cost: money(row.cost),
    installed: !!row.isInstalled,
    equipped: !!row.equipped,
    host: hostOf(actor, row),
    slot: text(row.slot ?? row.category ?? row.type),
    effect: text(row.effect ?? row.description ?? row.notes),
    condition: conditionOf(row.condition),
    boxed: !!row.storageLocationId,
    storage: storageOptions(actor, row.storageLocationId),
    kind: transferKindFor(item),
  };
}

function ammoRow(actor, item) {
  const row = item.system?.row ?? {};
  const loadedIn = [...rowsOf(actor, 'customBlasters')].find((b) => b.system?.row?.loadedAmmunitionId === row.id) ?? null;
  return {
    ...ref(item),
    rowName: text(row.name),
    quantity: num(row.quantity, 1) || 1,
    current: row.currentCharges ?? null,
    max: row.maxCharges ?? null,
    chargesText: row.currentCharges === undefined || row.currentCharges === null ? '' : `${row.currentCharges}/${text(row.maxCharges)}`,
    gasGrade: text(row.gasGrade),
    containerType: text(row.containerType),
    contents: Array.isArray(row.contents) ? row.contents.length : 0,
    weight: fig(row.weight),
    cost: money(row.cost),
    loadedIn: loadedIn ? { id: loadedIn.id, name: loadedIn.displayName ?? loadedIn.name } : null,
    boxed: !!row.storageLocationId,
    storage: storageOptions(actor, row.storageLocationId),
    kind: transferKindFor(item),
  };
}

function implantRow(actor, item, locationNames) {
  const row = item.system?.row ?? {};
  const links = (actor.system?.hitLocations ?? []).filter((l) => (l.installedHardwareIds ?? []).includes(row.id)).map((l) => locationNames.get(l.id) ?? l.name);
  const upgradesInLimb = item.type === 'cyberneticLimb' ? (row.upgrades ?? []).length : 0;
  return {
    ...ref(item),
    rowName: text(row.name),
    installed: item.type === 'cyberneticUpgrade' ? !!row.equipped : !!row.installed,
    installedLabel: loc(item.type === 'cyberneticLimb' ? 'SHADOWBASE.Sheet.Inventory.Attached' : 'SHADOWBASE.Sheet.Inventory.Installed'),
    linkedTo: links,
    location: text(row.location),
    slotType: text(row.slotType),
    extent: text(row.extent),
    material: text(row.material),
    pathways: Array.isArray(row.pathways) ? row.pathways.map(text) : [],
    cp: row.finalCp ?? row.baseCp ?? null,
    dr: row.dr ?? null,
    currentDr: row.currentDr ?? null,
    upgrades: upgradesInLimb,
    weight: fig(row.weight),
    cost: money(row.cost),
    effect: text(row.effect ?? row.notes),
    modifiers: modifierBadges(row.modifiers ?? null),
    boxed: !!row.storageLocationId,
    storage: storageOptions(actor, row.storageLocationId),
    kind: transferKindFor(item),
  };
}

/** Everything filed in a storage box, across every row Item (storage-box-section.tsx:22-24 name/weight/category line). */
function boxedRows(actor, boxId) {
  const out = [];
  for (const item of actor.items ?? []) {
    const row = item.system?.row;
    if (!row || row.storageLocationId !== boxId) continue;
    const qty = num(row.quantity, 1) || 1;
    const merged = rowWithDerived(item);
    const weight = num(merged.finalWeight ?? row.weight) * qty;
    out.push({ ...ref(item), rowName: text(row.customName || row.name || row.baseExplosiveName || row.baseType), quantity: qty, weight: fig(weight), weightValue: weight, sourceLabel: loc(ITEM_TYPES[item.type]?.label ?? 'SHADOWBASE.Item.Unnamed') });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {object} actor
 */
export function inventoryContext(actor) {
  const stats = statsOf(actor);
  const sheet = sheetOf(actor) ?? {};
  const system = actor.system ?? {};
  const equipmentItems = rowsOf(actor, 'equipment');
  const equipmentRows = sheet.equipment ?? [];
  const locationNames = new Map((stats?.dynamicHitLocations ?? system.hitLocations ?? []).map((l) => [l.id, l.name]));

  // Wallet (character-inventory.tsx:77-96): loose currency rows, chips vs physical.
  const loose = equipmentRows.filter((r) => r?.category === 'Currencies' && !r.storageLocationId);
  const digital = loose.reduce((s, r) => s + (r.storedValue != null ? num(r.storedValue) * (num(r.quantity, 1) || 1) : 0), 0);
  const physical = loose.reduce((s, r) => s + (r.denominationValue != null ? num(r.denominationValue) * (num(r.quantity, 1) || 1) : 0), 0);
  const totalWeight = num(stats?.points?.totalWeight);
  const capacity = parseFloat(String(stats?.basicLift ?? '0')) || 0; // use-character-form.ts:579 totalCarryCapacity = basicLift
  const remaining = capacity - totalWeight;

  const equipment = equipmentItems.map((i) => equipmentRow(actor, i));
  const visible = (r) => !r.boxed && !r.installed;
  // equipment-panes.ts is not in the bundle's entry (docs/REQUESTS.md, U06 -> orchestrator); the list is restated below until it is.
  const categories = [...EQUIPMENT_CATEGORIES];
  const isStray = (c) => !categories.includes(c) && !DEDICATED_PANE_CATEGORIES.includes(c);
  const groups = categories.map((category) => ({ category, label: category, rows: equipment.filter((r) => visible(r) && !r.isBlueprint && r.category === category) }));
  const blueprints = equipment.filter((r) => visible(r) && r.isBlueprint);
  const strays = equipment.filter((r) => visible(r) && !r.isBlueprint && isStray(r.category));
  const materials = equipment.filter((r) => !r.boxed && r.category === 'Raw Materials');

  // Gear sets: the stored custom outfits plus the handbook sets the inventory recognises (gear-sets.ts).
  const armorRows = sheet.armor ?? [];
  const customSets = (Array.isArray(system.gearSets) ? system.gearSets : []).map((s) => ({ id: s.id, name: text(s.name), memberIds: s.memberIds ?? [], custom: true, members: (s.memberIds ?? []).map((id) => armorRows.find((a) => a.id === id)?.name ?? '').filter(Boolean) }));
  let recognised = [];
  try {
    recognised = engine.gearSets.recogniseSets(armorRows, system.hitLocations ?? []).map((s) => ({
      id: s.id, name: text(s.name), kind: text(s.kind), custom: false, memberIds: (s.pieces ?? []).map((p) => p.item?.id).filter(Boolean),
      members: (s.pieces ?? []).map((p) => `${p.label}: ${p.item ? p.item.name : loc('SHADOWBASE.Sheet.Inventory.Missing')}`),
      complete: (s.pieces ?? []).every((p) => !!p.item),
    }));
  } catch { recognised = []; }
  const sets = [...customSets, ...recognised];
  const setBonuses = (() => { try { return engine.gearSets.activeSetBonuses(armorRows).map((b) => ({ name: text(b.name ?? b.setName), text: text(b.description ?? b.effect ?? b.note) })); } catch { return []; } })();

  const armor = rowsOf(actor, 'armor').map((i) => armorRow(actor, i, sets, locationNames));
  const parts = rowsOf(actor, 'weaponModifications').concat(rowsOf(actor, 'lightsaberModifications')).map((i) => partRow(actor, i));
  const boxes = (Array.isArray(system.storageBoxes) ? system.storageBoxes : []).map((b) => {
    const rows = boxedRows(actor, b.id);
    return { id: b.id, name: text(b.name), description: text(b.description), rows, count: rows.length, totalWeight: fig(rows.reduce((s, r) => s + r.weightValue, 0)) };
  });
  const apps = globalThis.game?.shadowbase?.apps ?? {};
  const enc = stats?.encumbranceLevels ?? null;
  const levelRows = enc ? [['None', 'none'], ['Light', 'light'], ['Medium', 'medium'], ['Heavy', 'heavy'], ['X-Heavy', 'xheavy']].map(([label, key]) => ({
    label: loc(`SHADOWBASE.Sheet.Encumbrance.${key}`), weight: fig(enc[key].weight, 1), move: enc[key].move, dodge: enc[key].dodge, current: stats.currentEncumbrance.level === label,
  })) : [];

  return {
    chips: chipTitles(),
    editable: editableOf(actor),
    wallet: {
      totalWeight: fig(totalWeight), capacity: fig(capacity), remaining: fig(remaining), overloaded: remaining < 0,
      digital: money(digital), physical: money(physical), trackDigital: !!system.trackDigital, trackPhysical: !!system.trackPhysical,
      totalCredits: money(system.totalCredits), totalCost: money(stats?.points?.totalCost),
      encumbranceLevel: text(stats?.currentEncumbrance?.level) || 'None',
    },
    encumbrance: {
      basicLift: text(stats?.basicLift),
      level: text(stats?.currentEncumbrance?.level) || 'None',
      move: stats?.currentEncumbrance?.move ?? null,
      dodge: stats?.currentEncumbrance?.dodge ?? null,
      rows: levelRows,
      useLiftingST: system.useLiftingST !== false,
      jump: stats?.jumpDistances ?? null,
      activeEffects: (stats?.activeStatusEffects ?? []).map((e) => ({ id: e.id, name: text(e.name), duration: text(e.duration), debuff: e.type === 'debuff' })),
    },
    equipmentGroups: groups,
    blueprints,
    strays,
    equipmentCount: equipment.length,
    armor,
    armorCount: armor.length,
    sets,
    setBonuses,
    weapons: {
      melee: rowsOf(actor, 'customMeleeWeapons').map((i) => weaponRow(actor, i, 'melee')),
      blasters: rowsOf(actor, 'customBlasters').map((i) => weaponRow(actor, i, 'blaster')),
      explosives: rowsOf(actor, 'customExplosives').map((i) => weaponRow(actor, i, 'explosive')),
      lightsabers: rowsOf(actor, 'lightsabers').map((i) => weaponRow(actor, i, 'lightsaber')),
    },
    ammunition: rowsOf(actor, 'ammunition').map((i) => ammoRow(actor, i)),
    weaponParts: parts.filter((p) => p.family !== 'lightsaber'),
    saberParts: parts.filter((p) => p.family === 'lightsaber'),
    armorParts: rowsOf(actor, 'armorModifications').map((i) => partRow(actor, i)),
    implants: rowsOf(actor, 'implants').map((i) => implantRow(actor, i, locationNames)),
    limbs: rowsOf(actor, 'cybernetics').map((i) => implantRow(actor, i, locationNames)),
    upgrades: rowsOf(actor, 'cyberneticUpgrades').map((i) => implantRow(actor, i, locationNames)),
    materials,
    boxes,
    boxCount: boxes.length,
    apps: { suitsAndSets: !!apps.SuitsAndSets, crafting: !!apps.CraftingApp },
    packs: { equipment: 'equipment', blueprints: 'blueprints', armor: 'armor', armorPieces: 'armor-pieces', meleeWeapons: 'melee-weapons', rangedWeapons: 'ranged-weapons', explosives: 'explosives', lightsabers: 'lightsabers', ammunition: 'ammunition', weaponMods: 'weapon-mods', implants: 'implants', cyberneticLimbs: 'cybernetic-limbs', cyberneticUpgrades: 'cybernetic-upgrades' },
    dualWielding: stats?.dualWielding ?? null,
    hands: { used: stats?.handsUsed ?? null, available: stats?.availableHands ?? null },
    engineError: actor.system?.engineError ?? null,
  };
}

/** The website's named General Equipment panes (equipment-panes.ts) - copied here only as the fallback order when the bundle lacks the namespace. */
const EQUIPMENT_CATEGORIES = Object.freeze(['Currencies', 'Medical & Pharmaceuticals', 'Survival Gear', 'Communication & Data', 'Tools & Electronics', 'Restraints & Security', 'Utility & Miscellaneous']);
const DEDICATED_PANE_CATEGORIES = Object.freeze(['Raw Materials']);

// ---------------------------------------------------------------------------
// VEHICLES TAB (vehicles-and-starships-section.tsx: Ship Assignment, Starships,
// Atmospheric Vehicles, Terrestrial Vehicles)
// ---------------------------------------------------------------------------

/** ship-crew-position-section.tsx:16 - the crew roles offered. */
export const CREW_POSITIONS = Object.freeze(['Pilot', 'Gunner', 'Engineer', 'Systems Operator', 'Captain', "Ship's Hand"]);
const SYSTEM_STATUSES = Object.freeze(['Nominal', 'Damaged', 'Disabled']);

function starshipCard(actor, item) {
  const row = item.system?.row ?? {};
  const d = item.system?.derived ?? null;
  const merged = rowWithDerived(item);
  const systems = (merged.systems ?? []).map((s) => ({
    id: s.id, name: text(s.name), dr: s.dr ?? null, hp: s.hp ?? null, maxHp: s.maxHp ?? null, status: text(s.status) || 'Nominal', notes: text(s.notes),
    statusOptions: SYSTEM_STATUSES.map((v) => ({ value: v, label: loc(`SHADOWBASE.Sheet.Vehicles.Status.${v}`), selected: (text(s.status) || 'Nominal') === v })),
    tone: (text(s.status) || 'Nominal') === 'Nominal' ? 'ok' : (text(s.status) === 'Damaged' ? 'warn' : 'bad'),
  }));
  return {
    ...ref(item),
    rowName: text(row.customName || row.baseChassis),
    chassis: text(row.baseChassis),
    readouts: {
      handling: text(merged.finalHandling), speed: text(merged.finalSpeed), hp: money(merged.finalHp), dr: money(merged.finalDr),
      hyperdrive: text(merged.finalHyperdrive), cost: money(merged.finalCost), crew: text(row.baseCrew), passengers: text(row.basePassengers), cargo: text(row.baseCargo),
      notes: text(merged.finalNotesAndEffects),
    },
    systems,
    armaments: (merged.armaments ?? []).map((a) => ({ name: text(a.name), damage: text(a.damage), skill: text(a.skill), rollable: !!a.damage })),
    quantity: num(row.quantity, 1) || 1,
    boxed: !!row.storageLocationId,
    customNotes: text(row.customNotes),
    derivedError: text(item.system?.derivedError),
    kind: 'customStarship',
  };
}

/** terrestrial-vehicles-section.tsx:55-59: an explicit category wins, then the catalog profile, then the type. */
export function vehicleCategoryOf(row) {
  if (row.category === 'Terrestrial' || row.category === 'Atmospheric') return row.category;
  const profile = engine.vehicleData.VEHICLE_DATA.find((v) => v.name === row.name);
  if (profile?.category) return profile.category;
  return row.type === 'Groundcar' ? 'Terrestrial' : 'Atmospheric';
}

function vehicleCard(actor, item) {
  const row = item.system?.row ?? {};
  return {
    ...ref(item),
    rowName: text(row.name),
    vehicleType: text(row.type),
    category: vehicleCategoryOf(row),
    handling: text(row.handling), speed: text(row.speed), accelDecel: text(row.accelDecel), hp: row.hp ?? null, dr: row.dr ?? null,
    crew: text(row.crew), passengers: text(row.passengers), cargo: text(row.cargo), cost: row.cost ?? null, costText: money(row.cost),
    weapons: text(row.weapons), weaponSkill: text(row.weaponSkill), hyperdrive: text(row.hyperdrive), notes: text(row.notes), customNotes: text(row.customNotes),
    quantity: num(row.quantity, 1) || 1,
    boxed: !!row.storageLocationId,
    kind: 'vehicle',
  };
}

/**
 * @param {object} actor
 */
export function vehiclesContext(actor) {
  const system = actor.system ?? {};
  const station = text(system.assignedStation) || null;
  const actions = station ? rolls.crewActionsFor(actor, station) : [];
  const vehicles = rowsOf(actor, 'vehicles').map((i) => vehicleCard(actor, i));
  const starships = rowsOf(actor, 'customStarships').map((i) => starshipCard(actor, i));
  const weaponNames = engine.starshipWeapons.STARSHIP_WEAPONS_LIBRARY.filter((w) => w.name !== 'None').map((w) => w.name);
  return {
    chips: chipTitles(),
    editable: editableOf(actor),
    assignment: {
      shipPosition: text(system.shipPosition),
      positions: [{ value: '', label: loc('SHADOWBASE.Sheet.Vehicles.SelectRole'), selected: !system.shipPosition }, ...CREW_POSITIONS.map((p) => ({ value: p, label: p, selected: system.shipPosition === p }))],
      assignedStation: text(station),
      stations: [{ value: '', label: loc('SHADOWBASE.Sheet.Vehicles.SelectStation'), selected: !station }, ...engine.shipStations.SHIP_STATIONS.map((s) => ({ value: s, label: s, selected: station === s }))],
      actions: actions.map((a) => ({
        label: text(a.label), skills: (a.skills ?? []).join(' / '), modifier: num(a.modifier), modifierText: a.modifier ? signed(num(a.modifier)) : '',
        target: a.target ?? null, isDamage: !!a.isDamage, best: text(a.best?.name), describe: text(a.best?.describe),
      })),
      weaponNames,
    },
    starships,
    atmospheric: vehicles.filter((v) => v.category === 'Atmospheric'),
    terrestrial: vehicles.filter((v) => v.category === 'Terrestrial'),
    vesselCount: starships.length + vehicles.length,
    packs: { starships: 'starships', vehicles: 'vehicles' },
  };
}

// ---------------------------------------------------------------------------
// The form pipeline hook (ARCHITECTURE.md §6.1 `_processSubmitData` extracts
// `items.<id>.row.<key>` entries; the whole-array prefixes are this module's)
// ---------------------------------------------------------------------------

/** Row keys whose blank select value means null (a host reference, a storage box, a weapon binding). */
const NULL_WHEN_BLANK = new Set(['storageLocationId', 'selectedWeaponId', 'loadedAmmunitionId', 'loadedExplosiveId', 'wornLocationId', 'setId', 'level']);
/** Actor system keys whose blank select value means null. */
const SYSTEM_NULL_WHEN_BLANK = new Set(['activeLightsaberForm', 'activeFormWeaponId', 'assignedStation', 'shipPosition']);

const flattenFn = () => globalThis.foundry?.utils?.flattenObject ?? ((obj) => {
  const out = {};
  const walk = (o, p) => { for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length) walk(v, key); else out[key] = v; } };
  walk(obj, '');
  return out;
});
const expandFn = () => globalThis.foundry?.utils?.expandObject ?? ((flat) => {
  const out = {};
  for (const [k, v] of Object.entries(flat)) { let t = out; const parts = k.split('.'); const last = parts.pop(); for (const p of parts) t = (t[p] ??= {}); t[last] = v; }
  return out;
});

/**
 * What a level change implies for a catalog-backed row (the website's
 * handleLevelSelection / handleLevelChange / handleTechniqueChange, cited per
 * type): the sibling fields are re-read from the catalog by name + level so
 * the row carries that level's figures.
 * @param {object} item
 * @param {number} newLevel
 * @returns {object} row changes (`-=key: null` deletes)
 */
export function levelChangePatch(item, newLevel) {
  const row = item.system?.row ?? {};
  const level = Number(newLevel);
  const patch = { level: Number.isFinite(level) ? level : null };
  const name = text(row.name);
  switch (item.type) {
    case 'advantage': case 'disadvantage': case 'quirk': {
      // advantages-section.tsx:63-70: the ladder entry's points ride with the level.
      const entry = traitLibraryEntry(ITEM_TYPES[item.type].source, name);
      const ladder = entry?.levels?.find((l) => l.level === level);
      if (ladder) patch.points = ladder.points;
      return patch;
    }
    case 'forcePower': {
      // force-powers-section.tsx:90-96: the catalog row for name + level replaces the sheet row (name/level/baselinePoints kept).
      const data = engine.forcePowers.forcePowersData.find((p) => p.name === name && p.level === level);
      if (data) {
        const { name: _n, level: _l, ...rest } = data;
        Object.assign(patch, rest);
        const union = new Set(engine.forcePowers.forcePowersData.filter((p) => p.name === name).flatMap((p) => Object.keys(p)));
        for (const k of union) if (!(k in data) && k in row && !['name', 'level', 'baselinePoints', 'id'].includes(k)) patch[`-=${k}`] = null;
      } else if (row.custom) patch.effect = engine.customTiers.effectForTier(row.tierEffects, level);
      return patch;
    }
    case 'combatTechnique': {
      // combat-techniques-section.tsx:70-82: the listed fields, nulls where the level has none.
      if (row.custom) { patch.effect = engine.customTiers.effectForTier(row.tierEffects, level); return patch; }
      const data = engine.techniques.allCombatTechniques.find((t) => t.name === name && t.level === level);
      if (data) Object.assign(patch, { cpCost: data.cpCost, epCost: data.epCost, fpCost: data.fpCost ?? null, effect: data.effect, characterTier: data.characterTier, baseSkill: data.baseSkill, category: data.category, damageBonus: data.damageBonus || null, skillBonus: data.skillBonus || null, skillPenalty: data.skillPenalty || null });
      return patch;
    }
    case 'lightsaberForm': {
      // lightsaber-forms-section.tsx:28-38: a catalog form stores name/level/baselinePoints; a custom one resolves its tier text.
      if (row.custom) patch.effect = engine.customTiers.effectForTier(row.tierEffects, level);
      return patch;
    }
    default: return patch;
  }
}

/**
 * Split a sheet's submit data into what the actor update takes and what the
 * tab inputs mean. Accepts the flat `FormDataExtended.object` or the expanded
 * form. Returns `{ data, itemUpdates }`: `data` is the expanded remainder
 * (plus the whole-array actor fields) for the sheet's own `document.update`,
 * `itemUpdates` the `updateEmbeddedDocuments('Item', ...)` payload.
 * @param {object} actor
 * @param {object} submitData
 */
export function extractTabSubmitData(actor, submitData) {
  const flat = flattenFn()(submitData ?? {});
  const rest = {};
  const rowChanges = new Map(); // item id -> { key: value }
  const arrays = { hitLocations: new Map(), storageBoxes: new Map() };
  const shipSystems = new Map(); // item id -> Map(sysId -> changes)
  for (const [key, value] of Object.entries(flat)) {
    let m;
    if ((m = /^items\.([^.]+)\.row\.(.+)$/.exec(key))) {
      const [, id, field] = m;
      (rowChanges.get(id) ?? rowChanges.set(id, {}).get(id))[field] = value;
    } else if ((m = /^hitLocations\.([^.]+)\.(.+)$/.exec(key))) {
      (arrays.hitLocations.get(m[1]) ?? arrays.hitLocations.set(m[1], {}).get(m[1]))[m[2]] = value;
    } else if ((m = /^storageBoxes\.([^.]+)\.(.+)$/.exec(key))) {
      (arrays.storageBoxes.get(m[1]) ?? arrays.storageBoxes.set(m[1], {}).get(m[1]))[m[2]] = value;
    } else if ((m = /^starshipSystems\.([^.]+)\.([^.]+)\.(.+)$/.exec(key))) {
      const per = shipSystems.get(m[1]) ?? shipSystems.set(m[1], new Map()).get(m[1]);
      (per.get(m[2]) ?? per.set(m[2], {}).get(m[2]))[m[3]] = value;
    } else {
      let v = value;
      const sys = /^system\.(.+)$/.exec(key)?.[1];
      if (sys && SYSTEM_NULL_WHEN_BLANK.has(sys) && v === '') v = null;
      rest[key] = v;
    }
  }
  const data = expandFn()(rest);
  // Whole-array actor fields: rewrite the array with the edited members patched in.
  for (const [field, edits] of Object.entries(arrays)) {
    if (!edits.size) continue;
    const current = Array.isArray(actor.system?.[field]) ? actor.system[field] : [];
    const next = current.map((entry) => {
      const patch = edits.get(entry?.id);
      if (!patch) return entry;
      const out = { ...entry };
      for (const [k, v] of Object.entries(patch)) out[k] = (k === 'innateDR' || k === 'currentDegradation') ? num(v) : v;
      return out;
    });
    (data.system ??= {})[field] = next;
  }
  // Item rows.
  const itemUpdates = [];
  for (const [id, changes] of rowChanges) {
    const item = actor.items?.get?.(id) ?? actor.items?.find?.((i) => i.id === id);
    if (!item) continue;
    const update = { _id: id };
    let levelPatch = null;
    for (const [field, raw] of Object.entries(changes)) {
      let v = raw;
      if (NULL_WHEN_BLANK.has(field) && (v === '' || v === null)) v = null;
      if (field === 'level' && ['advantage', 'disadvantage', 'quirk', 'forcePower', 'combatTechnique', 'lightsaberForm'].includes(item.type)) {
        const current = item.system?.row?.level ?? null;
        if (v !== null && Number(v) !== Number(current)) { levelPatch = levelChangePatch(item, v); continue; }
      }
      update[`system.row.${field}`] = v;
    }
    if (levelPatch) for (const [k, v] of Object.entries(levelPatch)) update[`system.row.${k}`] = v;
    if (Object.keys(update).length > 1) itemUpdates.push(update);
  }
  // Starship systems: the tracked array on the row, rewritten whole (mergeSystems never overwrites hp - the row is the record).
  for (const [id, per] of shipSystems) {
    const item = actor.items?.get?.(id) ?? actor.items?.find?.((i) => i.id === id);
    if (!item) continue;
    const current = rowWithDerived(item).systems ?? [];
    const next = current.map((s) => {
      const patch = per.get(s?.id);
      if (!patch) return s;
      const out = { ...s };
      for (const [k, v] of Object.entries(patch)) out[k] = (k === 'hp' || k === 'maxHp' || k === 'dr') ? num(v) : v;
      return out;
    });
    const existing = itemUpdates.find((u) => u._id === id) ?? (itemUpdates.push({ _id: id }), itemUpdates[itemUpdates.length - 1]);
    existing['system.row.systems'] = next;
  }
  return { data, itemUpdates };
}

/** Apply the item half of extractTabSubmitData. */
export async function applyItemUpdates(actor, itemUpdates) {
  if (!itemUpdates?.length) return [];
  return actor.updateEmbeddedDocuments('Item', itemUpdates);
}

// ---------------------------------------------------------------------------
// Actions (static-style handlers; `this` is the sheet: `this.document` / `this.actor`)
// ---------------------------------------------------------------------------

const actorOf = (app) => app?.document ?? app?.actor ?? app;
/** foundry.applications.api.DialogV2, resolved late and through `in` guards (the headless shim's proxy throws on an undeclared member). */
function dialogV2() {
  const apps = globalThis.foundry?.applications;
  const api = apps && ('api' in apps) ? apps.api : null;
  return api && ('DialogV2' in api) ? api.DialogV2 : null;
}
const itemOf = (app, target) => {
  const id = target?.dataset?.itemId ?? target?.closest?.('[data-item-id]')?.dataset?.itemId;
  const actor = actorOf(app);
  return id ? (actor.items?.get?.(id) ?? actor.items?.find?.((i) => i.id === id) ?? null) : null;
};
const confirmDialog = async ({ title, content }) => {
  const DialogV2 = dialogV2();
  if (typeof DialogV2?.confirm !== 'function') return true; // headless: no prompt
  return DialogV2.confirm({ window: { title }, content, rejectClose: false, modal: true });
};

/** Blank rows for Add Custom, shaped the way the website's sections append them. */
const BLANK_ROWS = Object.freeze({
  advantages: () => ({ name: '', points: 0, level: null, description: '', baselinePoints: 0, category: '', modifiers: { ...engine.NO_MODIFIERS } }),
  disadvantages: () => ({ name: '', points: 0, level: null, description: '', baselinePoints: 0, category: '', modifiers: { ...engine.NO_MODIFIERS } }),
  quirks: () => ({ name: '', points: engine.quirks.QUIRK_POINT_COST ?? -1, description: '', baselinePoints: 0 }),
  skills: () => ({ name: '', level: '', relativeLevel: '', points: 0, notes: '', baselinePoints: 0 }),
  forcePowers: () => ({ name: '', level: 1, cpCost: 0, fpCost: 0, epCost: 0, alignment: 'Grey', baseSkill: '', characterTier: 'Apprentice', effect: '', category: '', description: '', baselinePoints: 0, custom: true, tierEffects: engine.customTiers.seedTierEffects?.() ?? {} }),
  combatTechniques: () => ({ name: '', level: 1, cpCost: 0, epCost: 0, effect: '', characterTier: 'Apprentice', baseSkill: '', category: 'Universal', baselinePoints: 0, custom: true, tierEffects: engine.customTiers.seedTierEffects?.() ?? {} }),
  lightsaberForms: () => ({ name: engine.lightsaberForms.lightsaberForms[0]?.name ?? '', level: 1, baselinePoints: 0 }),
  equipment: () => ({ id: engine.rowId(), name: loc('SHADOWBASE.Sheet.Inventory.NewItem'), weight: 0, cost: 0, quantity: 1, condition: 'Fine', category: 'Utility & Miscellaneous', description: '' }),
});

export const TAB_ACTIONS = Object.freeze({
  /** Open an Item's own sheet. */
  async openItem(event, target) { itemOf(this, target)?.sheet?.render?.(true); },

  /** Delete a row Item after confirmation (parts installed in it are left in place, as the website's detach does). */
  async deleteItem(event, target) {
    const item = itemOf(this, target);
    if (!item) return;
    const ok = await confirmDialog({ title: loc('SHADOWBASE.Sheet.DeleteTitle'), content: `<p>${fmt('SHADOWBASE.Sheet.DeleteBody', { name: item.displayName ?? item.name })}</p>` });
    if (ok) await item.delete();
  },

  /** Add a blank custom row of the given source array (data-source). */
  async addRow(event, target) {
    const actor = actorOf(this);
    const source = target?.dataset?.source;
    const make = BLANK_ROWS[source];
    if (!make) return;
    await actor.createEmbeddedDocuments('Item', [rowToItemData(make(), source, nextSort(actor, source))]);
  },

  /** Open a compendium browser for the pack named by data-pack (the website's Add From Library). */
  async browseCompendium(event, target) {
    const pack = globalThis.game?.packs?.get?.(`${SYSTEM_ID}.${target?.dataset?.pack}`);
    if (pack?.render) pack.render(true);
    else notify('warn', fmt('SHADOWBASE.Sheet.NoPack', { pack: target?.dataset?.pack ?? '' }));
  },

  // ---- rolls (module/rolls.mjs) ----
  async rollSkill(event, target) { const item = itemOf(this, target); if (item) return rolls.rollSkill(actorOf(this), item.system?.row?.name); },
  async rollAttack(event, target) { const item = itemOf(this, target); if (item) return rolls.rollAttack(actorOf(this), item); },
  async rollDamage(event, target) { const item = itemOf(this, target); if (item) return rolls.rollDamage(actorOf(this), { item }); },
  /** An explosive: a Thrown Weapon (Grenade) skill roll (explosive rows carry baseSkill). */
  async rollThrow(event, target) { const item = itemOf(this, target); if (item?.system?.row?.baseSkill) return rolls.rollSkill(actorOf(this), item.system.row.baseSkill); },
  async rollExplosiveDamage(event, target) {
    const item = itemOf(this, target);
    const formula = item ? rowWithDerived(item).finalDamageEffect : null;
    if (formula) return rolls.rollDamage(actorOf(this), { label: item.displayName ?? item.name, formula });
  },
  async rollPower(event, target) { const item = itemOf(this, target); if (item) return rolls.rollForcePower(actorOf(this), item); },
  async applyPowerCosts(event, target) { const item = itemOf(this, target); if (item) return rolls.applyForcePowerCosts(actorOf(this), item); },
  async rollTechnique(event, target) {
    const item = itemOf(this, target);
    if (!item) return;
    const actor = actorOf(this);
    return rolls.rollTechnique(actor, item, { weaponItem: byRowId(actor, item.system?.row?.selectedWeaponId) });
  },
  async applyTechniqueCosts(event, target) { const item = itemOf(this, target); if (item) return rolls.applyTechniqueCosts(actorOf(this), item); },
  /**
   * The Form's Attack line (lightsaber-forms-section.tsx:285): the bound saber's
   * attack. The Form's own attack bonus (activeFormEffect.attack) is not part
   * of rolls.attackTargetFor yet (docs/REQUESTS.md, U06 -> rolls owner); until
   * it is, a non-zero bonus is passed as the roll's modifier (no prompt).
   */
  async rollFormAttack(event, target) {
    const actor = actorOf(this);
    const saber = boundSaberOf(actor);
    if (!saber) return notify('warn', loc('SHADOWBASE.Sheet.Abilities.NoSaberBound'));
    const form = rolls.activeFormEffectFor(actor);
    return rolls.rollAttack(actor, saber, form.attack ? { modifier: form.attack } : {});
  },
  async rollFormDamage(event, target) { const actor = actorOf(this); const saber = boundSaberOf(actor); if (saber) return rolls.rollDamage(actor, { item: saber }); },
  /** Dodge / Parry / Block with the Form active (data-kind); parry and block go through the bound saber. */
  async rollFormDefense(event, target) {
    const actor = actorOf(this);
    const kind = target?.dataset?.kind;
    if (!['dodge', 'parry', 'block'].includes(kind)) return;
    return rolls.rollDefense(actor, kind, { weaponItem: kind === 'dodge' ? null : boundSaberOf(actor) });
  },
  async rollCrewAction(event, target) {
    const actor = actorOf(this);
    const action = target?.dataset?.crewAction;
    const weaponName = target?.closest?.('[data-armament]')?.dataset?.armament ?? this.element?.querySelector?.('[name="crewWeapon"]')?.value ?? undefined;
    return rolls.rollCrewAction(actor, { action, weaponName });
  },
  /** A starship armament's damage line (data-formula, data-label). */
  async rollArmamentDamage(event, target) {
    const formula = target?.dataset?.formula;
    if (formula) return rolls.rollDamage(actorOf(this), { label: target.dataset.label ?? formula, formula });
  },
  async rollStunRecovery() { return rolls.rollStunRecovery(actorOf(this)); },

  // ---- weapon and armor state ----
  /** Ready / unready a weapon (customized-blaster-item.tsx:448-476: equipped + equippedAt; unreadying clears equippedAt). */
  async toggleReadied(event, target) {
    const item = itemOf(this, target);
    if (!item) return;
    const equipped = !item.system?.row?.equipped;
    await item.updateRow({ equipped, equippedAt: equipped ? Date.now() : null });
  },
  /** Wear / take off armor through enforceBaseLayer, the way applySetEquip does (one base layer per location, Ch13). */
  async toggleEquipped(event, target) {
    const item = itemOf(this, target);
    if (!item) return;
    const actor = actorOf(this);
    const equip = !item.system?.row?.equipped;
    const rows = rowsOf(actor, 'armor').map((i) => i.system.row);
    const { armor, displaced } = engine.gearSets.applySetEquip(rows, [item.system.row.id], equip);
    const updates = [];
    for (const next of armor) {
      const own = byRowId(actor, next.id);
      if (!own) continue;
      const before = own.system.row;
      if (before.equipped !== next.equipped || before.isActive !== next.isActive) updates.push({ _id: own.id, 'system.row.equipped': !!next.equipped, ...(before.isActive !== next.isActive ? { 'system.row.isActive': !!next.isActive } : {}) });
    }
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    if (displaced?.length) notify('info', fmt('SHADOWBASE.Sheet.Inventory.BaseLayerSwapped', { names: displaced.map((d) => d.name ?? d.itemName).join(', ') }));
  },
  /** A shield's active state (armor-item-card.tsx:653-660). */
  async toggleActive(event, target) { const item = itemOf(this, target); if (item) await item.updateRow({ isActive: !item.system?.row?.isActive }); },
  /** Ch12's Ready maneuver clears ◊ unready (customized-melee-weapon-item.tsx:604). */
  async readyWeapon(event, target) { const item = itemOf(this, target); if (item) await item.updateRow({ isUnready: false }); },
  /** Activate / deactivate a lightsaber Form (lightsaber-forms-section.tsx:67-69). */
  async toggleActiveForm(event, target) {
    const item = itemOf(this, target);
    const actor = actorOf(this);
    const name = item?.system?.row?.name ?? null;
    const isActive = !!name && actor.system?.activeLightsaberForm === name;
    await actor.update({ 'system.activeLightsaberForm': isActive ? null : name });
  },

  // ---- wallet, storage ----
  /** Credit tracking toggles, mutually exclusive (character-inventory.tsx:104-119). */
  async toggleTracking(event, target) {
    const actor = actorOf(this);
    const form = target?.dataset?.form;
    if (form === 'digital') { const next = !actor.system?.trackDigital; await actor.update({ 'system.trackDigital': next, ...(next ? { 'system.trackPhysical': false } : {}) }); }
    if (form === 'physical') { const next = !actor.system?.trackPhysical; await actor.update({ 'system.trackPhysical': next, ...(next ? { 'system.trackDigital': false } : {}) }); }
  },
  async addStorageBox() {
    const actor = actorOf(this);
    const boxes = Array.isArray(actor.system?.storageBoxes) ? actor.system.storageBoxes : [];
    await actor.update({ 'system.storageBoxes': [...boxes, { id: engine.rowId(), name: fmt('SHADOWBASE.Sheet.Inventory.NewBoxName', { n: boxes.length + 1 }), description: '' }] });
  },
  /** Delete a box: everything filed in it is picked up first (storage-box-section.tsx:108-118). */
  async deleteStorageBox(event, target) {
    const actor = actorOf(this);
    const boxId = target?.dataset?.boxId;
    const boxes = Array.isArray(actor.system?.storageBoxes) ? actor.system.storageBoxes : [];
    const box = boxes.find((b) => b.id === boxId);
    if (!box) return;
    const ok = await confirmDialog({ title: loc('SHADOWBASE.Sheet.Inventory.PurgeBoxTitle'), content: `<p>${fmt('SHADOWBASE.Sheet.Inventory.PurgeBoxBody', { name: box.name })}</p>` });
    if (!ok) return;
    const updates = (actor.items?.filter?.((i) => i.system?.row?.storageLocationId === boxId) ?? []).map((i) => ({ _id: i.id, 'system.row.storageLocationId': null }));
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    await actor.update({ 'system.storageBoxes': boxes.filter((b) => b.id !== boxId) });
  },
  async pickUpItem(event, target) { const item = itemOf(this, target); if (item) await item.updateRow({ storageLocationId: null }); },

  // ---- sub-apps (guarded until their units land) ----
  async openBodyLoadout() { openApp(this, 'BodyLoadout'); },
  async openAnatomyWorkshop() { openApp(this, 'AnatomyWorkshop'); },
  async openDroidWorkshop() { openApp(this, 'DroidWorkshop'); },
  async openSuitsAndSets() { openApp(this, 'SuitsAndSets'); },
  async openCrafting() { openApp(this, 'CraftingApp'); },
  async openHudStatus() { openApp(this, 'TacticalHud', { tab: 'status' }); },

  // ---- import / export (module/import-export.mjs) ----
  async exportCharacter() { return exportJson(actorOf(this)); },
  async importCharacter() { return importFromFilePicker(actorOf(this)); },
  async exportItem(event, target) { const item = itemOf(this, target); if (item) return exportItemEnvelope(actorOf(this), item); },
  async importItem(event, target) { return importItemFromFilePicker(actorOf(this), { kind: target?.dataset?.kind ?? null }); },
});

/** The saber a Form is bound to (lightsaber-forms-section.tsx:61-65). */
function boundSaberOf(actor) {
  const readied = rolls.equippedWeapons(actor).filter((w) => w.type === 'lightsaber');
  const bound = actor.system?.activeFormWeaponId ? readied.find((s) => s.system?.row?.id === actor.system.activeFormWeaponId) : null;
  return bound ?? (readied.length === 1 ? readied[0] : null);
}

/** Open a registered sub-app (game.shadowbase.apps.<Name>) for the actor, or say it is not there yet. */
function openApp(app, name, options = {}) {
  const actor = actorOf(app);
  const Cls = globalThis.game?.shadowbase?.apps?.[name];
  if (typeof Cls !== 'function') return notify('warn', fmt('SHADOWBASE.Sheet.AppUnavailable', { app: loc(`SHADOWBASE.Sheet.App.${name}`) }));
  const instance = new Cls({ document: actor, actor, ...options });
  return instance.render(true);
}

export const actorSheetTabs = Object.freeze({
  bodyContext, abilitiesContext, inventoryContext, vehiclesContext,
  TAB_TEMPLATES, TAB_ACTIONS, extractTabSubmitData, applyItemUpdates, levelChangePatch,
  modifierBadges, traitLibraryEntry, vehicleCategoryOf, chipTitles, CREW_POSITIONS, SYSTEM_ID,
});

export default actorSheetTabs;
