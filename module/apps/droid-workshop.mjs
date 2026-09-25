// module/apps/droid-workshop.mjs
//
// DroidWorkshop (docs/ARCHITECTURE.md §6.5): the website's
// src/components/character-sheet/components/droid-workshop.tsx as an
// ApplicationV2 window over `system.droidBuild`. Every rule comes from the
// bundle:
//
//   droidData            the eleven DROID_* catalogs, EXPANDED_PROCESSOR_HOUSING_ID
//   droidWorkshopRows    workshopSlotRows (the rows the pricing walker charges), BACKUP_POWER_INDEX (99)
//   calculateDroidHardwarePoints / calculateDroidHardwareWeightLb   hardware CP and weight
//   droidAnatomy         droidAnatomy + reconcileDroidAnatomy (the derived T20 anatomy the engine reads)
//   droidModification    droidMalfunction / droidMalfunctionApplication (Ch17's two 1d6 tables)
//   droidDr              droidHardwareDr (the plating figure)
//   partAcquisition      acquirablePartsFor('droid') / buildAcquiredRow (Buy Droid Components)
//   blueprints / blueprintFlow / craftingMaterials   the Ch10 signals a swap run hands back
//
// THE ONE FOUNDRY RULE THIS FILE EXISTS FOR (ARCHITECTURE §6.5 / §9.1, review
// finding M5): a slot change writes the WHOLE droidBuild, its sparse arrays
// materialised to full length with `null` holes - never a per-index dotted key
// (`system.droidBuild.chassisMods.internalIds.3` would become a plain object
// under expandObject and replace the array) and never compacted (index IS the
// slot; the Backup Power Array lives at internalIds[99]).
//
// Ch17's modification procedure (droid-workshop.tsx:333-527): in Design mode a
// change is immediate; on a BUILT droid it is a swap (30 min/part) or an
// uninstall, rolled through CraftingApp with DROID_PART_SWAP's category, and a
// failure lands on the 1d6 tables - applied, not toasted (2026-08-29): a crit
// ruins the worked component, the deeper rows drain 20 PP or deal 1d HP, a 5-6
// warps the slot (no installs until Structural Repair), the flaw rows persist
// as a status-effect row until Ch17's repair rules clear it. Parts are consumed
// from and returned to equipment rows BY NAME, as the website does.

import { engine } from '../engine.mjs';
import { rolls } from '../rolls.mjs';
import { effects } from '../effects.mjs';
import { CraftingApp } from './crafting.mjs';
import { ActorSubApp, TEMPLATE_ROOT, loc, fmt, notify, num, text, sheetOf, statsOf, storedRows, syncRows, writeWholeArray, materialise, clone, confirmDialog, formDialog, readField, esc } from './sub-app.mjs';

const D = engine.droidData;
export const NONE_VALUE = '_NONE_';
export const BACKUP_POWER_INDEX = engine.droidWorkshopRows.BACKUP_POWER_INDEX;

/** droid-workshop.tsx:53-58 - the upgrades the Internal / External / Utility selects offer. */
export const UTILITY_REGISTRY_IDS = Object.freeze(['spec-suite', 'motion-spec', 'integ-blaster', 'shield-proj', 'art-manip', 'manip-custom', 'tool-mount-std', 'tool-mount-s6', 'wpn-mount-std', 'micro-jets', 'proc-housing']);

/**
 * The seven named equipment groups (src/lib/equipment-panes.ts EQUIPMENT_CATEGORIES;
 * droid-workshop.tsx:306 files a removed part under its own category only when it
 * is one of these, else under 'Utility & Miscellaneous' with the category as the
 * sub-category). Restated here because the entry does not export equipmentPanes
 * (docs/REQUESTS.md, U06's row); the day it does, read it from the bundle.
 */
export const EQUIPMENT_CATEGORIES = Object.freeze(['Currencies', 'Medical & Pharmaceuticals', 'Survival Gear', 'Communication & Data', 'Tools & Electronics', 'Restraints & Security', 'Utility & Miscellaneous']);

const upgrades = (pred) => D.DROID_UPGRADES.filter(pred);
const CATALOGS = Object.freeze({
  chassis: { lib: () => D.DROID_CHASSIS, category: 'Droid Chassis', slot: 'Base' },
  powerCore: { lib: () => D.DROID_POWER_CORES, category: 'Droid Power', slot: 'Power Core' },
  head: { lib: () => D.DROID_HEADS, category: 'Droid Head', slot: 'Head' },
  processor: { lib: () => D.DROID_PROCESSORS, category: 'Droid Processor', slot: 'Processor' },
  memory: { lib: () => D.DROID_MEMORY_CORES, category: 'Droid Memory Core', slot: 'Memory Core' },
  sensor: { lib: () => D.DROID_SENSORS, category: 'Droid Sensor', slot: 'Sensor' },
  internal: { lib: () => upgrades((u) => u.slotType === 'Internal' && UTILITY_REGISTRY_IDS.includes(u.id)), category: 'Droid Internal', slot: 'Internal' },
  external: { lib: () => upgrades((u) => u.slotType === 'External' && UTILITY_REGISTRY_IDS.includes(u.id)), category: 'Droid Hardpoint', slot: 'External' },
  utility: { lib: () => upgrades((u) => u.slotType === 'Utility' && UTILITY_REGISTRY_IDS.includes(u.id)), category: 'Droid Utility', slot: 'Utility' },
  motiveMount: { lib: () => D.DROID_MOTIVE_MOUNTS, category: 'Droid Locomotion', slot: 'Motive' },
  arm: { lib: () => D.DROID_ARMS, category: 'Droid Arm', slot: 'Arm' },
  manipulator: { lib: () => D.DROID_MANIPULATORS, category: 'Droid Manipulator', slot: 'Hand' },
  strut: { lib: () => D.DROID_MOTIVE_STRUTS, category: 'Droid Motive', slot: 'Leg' },
  actuator: { lib: () => upgrades((u) => u.category === 'Actuator'), category: 'Droid Actuator', slot: 'Actuator' },
  wiring: { lib: () => upgrades((u) => u.category === 'Wiring'), category: 'Droid Wiring', slot: 'Reflex Wiring' },
  reinforcement: { lib: () => upgrades((u) => u.category === 'Reinforcement'), category: 'Droid Reinforcement', slot: 'Reinforcement' },
  armor: { lib: () => upgrades((u) => u.category === 'Armor'), category: 'Droid Armor', slot: 'External' },
  motivator: { lib: () => upgrades((u) => u.category === 'Motivator'), category: 'Droid Motivator', slot: 'Auxiliary' },
  backupPower: { lib: () => upgrades((u) => u.category === 'Power' && u.slotType === 'Internal'), category: 'Droid Power', slot: 'Internal' },
});

/** Which catalog a build path selects from (the `renderUpgradeSelect` calls of droid-workshop.tsx, by path). */
export function catalogForPath(path) {
  if (path === 'chassisId') return CATALOGS.chassis;
  if (path === 'powerCoreId') return CATALOGS.powerCore;
  if (path === 'head.componentId') return CATALOGS.head;
  if (path === 'head.processorId' || path === 'head.coProcessorId') return CATALOGS.processor;
  if (path === 'head.memoryCoreId') return CATALOGS.memory;
  if (/^head\.sensorIds\.\d+$/.test(path)) return CATALOGS.sensor;
  if (path === `chassisMods.internalIds.${BACKUP_POWER_INDEX}`) return CATALOGS.backupPower;
  if (/^chassisMods\.internalIds\.\d+$/.test(path)) return CATALOGS.internal;
  if (/^chassisMods\.externalIds\.\d+$/.test(path)) return CATALOGS.external;
  if (/^chassisMods\.utilityIds\.\d+$/.test(path)) return CATALOGS.utility;
  if (/^chassisMods\.motiveMountIds\.\d+$/.test(path) || /^legs\.\d+\.motiveMountId$/.test(path)) return CATALOGS.motiveMount;
  if (/^arms\.\d+\.componentId$/.test(path)) return CATALOGS.arm;
  if (/^arms\.\d+\.manipulatorId$/.test(path)) return CATALOGS.manipulator;
  if (/^legs\.\d+\.componentId$/.test(path)) return CATALOGS.strut;
  if (/actuatorId$/.test(path)) return CATALOGS.actuator;
  if (/wiringId$/.test(path)) return CATALOGS.wiring;
  if (path === 'chassisMods.reinforcementId') return CATALOGS.reinforcement;
  if (path === 'chassisMods.armorId') return CATALOGS.armor;
  if (path === 'chassisMods.motivatorId') return CATALOGS.motivator;
  return null;
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * Set a value at a dotted path inside a cloned build, creating objects and
 * arrays on the way and materialising every array touched (holes -> null).
 * A numeric segment addresses an array index (the slot).
 */
export function setBuildPath(build, path, value) {
  const parts = path.split('.');
  let node = build;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (node[key] == null || typeof node[key] !== 'object') node[key] = nextIsIndex ? [] : {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(node)) { node[Number(last)] = value; const dense = materialise(node); node.length = 0; node.push(...dense); }
  else node[last] = value;
  return build;
}

/** The website's blank build shape for a droid that has none yet. */
export function emptyBuild() {
  return { chassisId: null, powerCoreId: null, head: { componentId: null, processorId: null, coProcessorId: null, memoryCoreId: null, sensorIds: [], externalModId: null }, arms: [], legs: [], chassisMods: { internalIds: [], externalIds: [], utilityIds: [], auxiliaryIds: [], motiveMountIds: [] }, warpedSlots: [] };
}

/** A clone of the stored build with every slot array materialised (null holes), ready to edit and write whole. */
export function buildOf(actor) {
  const stored = actor.system?.droidBuild;
  const build = stored && typeof stored === 'object' ? clone(stored) : emptyBuild();
  build.head ??= {}; build.chassisMods ??= {}; build.arms ??= []; build.legs ??= [];
  for (const key of ['sensorIds']) build.head[key] = materialise(build.head[key]);
  for (const key of ['internalIds', 'externalIds', 'utilityIds', 'auxiliaryIds', 'motiveMountIds']) build.chassisMods[key] = materialise(build.chassisMods[key]);
  build.warpedSlots = Array.isArray(build.warpedSlots) ? [...build.warpedSlots] : [];
  return build;
}

/** droid-workshop.tsx:171-172 - a filled slot. */
const filled = (ids) => (Array.isArray(ids) ? ids : []).filter((id) => id && id !== NONE_VALUE).length;

/** The derived anatomy reconciled with the stored rows (the engine's own read for a droid). */
export function reconciledAnatomy(actor) {
  const system = actor.system ?? {};
  const derived = engine.droidAnatomy.droidAnatomy({ isDroid: system.isDroid, droidBuild: system.droidBuild });
  return engine.droidAnatomy.reconcileDroidAnatomy(derived, system.hitLocations ?? []);
}

/** True when the stored hitLocations already carry the derived anatomy's names (in order). */
export function anatomyInSync(actor) {
  const stored = (actor.system?.hitLocations ?? []).map((l) => `${l?.name}|${l?.side ?? ''}`);
  const derived = reconciledAnatomy(actor).map((l) => `${l.name}|${l.side ?? ''}`);
  return JSON.stringify(stored) === JSON.stringify(derived);
}

export class DroidWorkshop extends ActorSubApp {
  static APP_NAME = 'droid-workshop';
  static TITLE_KEY = 'SHADOWBASE.Apps.Droid.WindowTitle';
  static FIELD_PREFIX = 'droid.';

  static DEFAULT_OPTIONS = {
    window: { title: 'SHADOWBASE.Apps.Droid.WindowTitle', icon: 'fa-solid fa-robot', resizable: true },
    position: { width: 720, height: 800 },
    actions: {
      'toggle-construction': DroidWorkshop.onToggleConstruction,
      'buy-parts': DroidWorkshop.onBuyParts,
      'add-arm': DroidWorkshop.onAddArm,
      'add-leg': DroidWorkshop.onAddLeg,
      'remove-limb': DroidWorkshop.onRemoveLimb,
      'structural-repair': DroidWorkshop.onStructuralRepair,
      'sync-anatomy': DroidWorkshop.onSyncAnatomy,
    },
  };

  // The two path partials are declared as the part's `templates` so Foundry (and the shim) register them by path.
  static PARTS = { workshop: { template: `${TEMPLATE_ROOT}/droid-workshop.hbs`, templates: [`${TEMPLATE_ROOT}/parts/droid-select.hbs`, `${TEMPLATE_ROOT}/parts/droid-limb.hbs`], scrollable: [''] } };

  /** The Ch17 job waiting on its roll (droid-workshop.tsx:157-160 pendingWork). */
  pendingWork = null;

  get isConstructed() { return this.actor.system?.isConstructed !== false; }
  get build() { return buildOf(this.actor); }
  get equipmentRows() { return storedRows(this.actor, 'equipment'); }

  // ---------------------------------------------------------------------------
  // Context (droid-workshop.tsx:575-1017)
  // ---------------------------------------------------------------------------

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const build = this.build;
    const stats = statsOf(actor);
    const sheet = sheetOf(actor);
    const isConstructed = this.isConstructed;
    const equipment = this.equipmentRows;
    const chassis = D.DROID_CHASSIS.find((c) => c.id === build.chassisId) ?? null;
    const powerCore = D.DROID_POWER_CORES.find((c) => c.id === build.powerCoreId) ?? null;
    const headDef = D.DROID_HEADS.find((h) => h.id === build.head?.componentId) ?? null;
    const slotRows = engine.droidWorkshopRows.workshopSlotRows(build, chassis, headDef);
    const hasProcessorHousing = (build.chassisMods.internalIds ?? []).includes(D.EXPANDED_PROCESSOR_HOUSING_ID);
    const warped = build.warpedSlots;
    const armCount = build.arms.length;
    const legCount = build.legs.length;

    // :174-179 the slot badges; :182-187 the first unmet prerequisite.
    const slots = [
      { key: 'Internal', used: filled(build.chassisMods.internalIds.filter((_, i) => i !== BACKUP_POWER_INDEX)), total: chassis?.internalSlots ?? 0 },
      { key: 'External', used: filled(build.chassisMods.externalIds), total: chassis?.externalSlots ?? 0 },
      { key: 'Utility', used: filled(build.chassisMods.utilityIds), total: chassis?.utilitySlots ?? 0 },
      { key: 'Sensors', used: filled(build.head.sensorIds), total: headDef?.slots?.sensors ?? 0 },
    ].filter((s) => s.total > 0).map((s) => ({ ...s, label: loc(`SHADOWBASE.Apps.Droid.Slot.${s.key}`), tone: s.used > s.total ? 'over' : s.used === s.total ? 'full' : 'free' }));
    const nextStep = !build.chassisId ? 'Chassis' : !build.powerCoreId ? 'PowerCore' : !build.head?.componentId ? 'Head' : !build.head?.processorId ? 'Processor' : (armCount === 0 && legCount === 0) ? 'Limb' : null;

    const select = (path, labelKey, catalogKey, { options = null, exclude = null } = {}) => {
      const cat = CATALOGS[catalogKey];
      const current = getPath(build, path);
      const currentId = current && current !== NONE_VALUE ? current : '';
      const list = (options ?? cat.lib()).filter((o) => !exclude || o.id !== exclude);
      // :532 - on a built droid the options are what is in stock (plus the fitted part).
      const filtered = isConstructed ? list.filter((o) => currentId === o.id || equipment.some((e) => e.name === o.name && !e.storageLocationId)) : list;
      const part = list.find((o) => o.id === currentId) ?? cat.lib().find((o) => o.id === currentId) ?? null;
      return {
        path, name: `droid.${path}`, label: loc(labelKey), slotLabel: cat.slot, warped: warped.includes(path), current: currentId,
        options: [{ value: '', label: loc('SHADOWBASE.Apps.Droid.None'), selected: !currentId }, ...filtered.map((o) => ({ value: o.id, label: `${o.name} (${isConstructed ? `${o.costCr} cr` : `${o.costCp} CP`})`, selected: o.id === currentId }))],
        part: part ? { effect: text(part.effect || part.traits) || loc('SHADOWBASE.Apps.Droid.StandardIntegration'), notes: text(part.notes || part.description), weight: num(part.weight), costCr: num(part.costCr) } : null,
      };
    };

    const limbs = (kind) => build[kind].map((limb, index) => {
      const def = (kind === 'arms' ? D.DROID_ARMS : D.DROID_MOTIVE_STRUTS).find((x) => x.id === limb?.componentId) ?? null;
      const sides = kind === 'arms' ? ['Right', 'Left', 'Independent', 'Auxiliary'] : ['Right', 'Left', 'Motive', 'Independent'];
      return {
        index, id: limb?.id ?? '', kind,
        title: fmt(kind === 'arms' ? 'SHADOWBASE.Apps.Droid.ArmUnit' : 'SHADOWBASE.Apps.Droid.StrutUnit', { n: index + 1 }),
        side: { name: `droid.${kind}.${index}.side`, options: sides.map((s) => ({ value: s, label: loc(`SHADOWBASE.Apps.Droid.Side.${s}`), selected: (limb?.side || 'Right') === s })) },
        component: select(`${kind}.${index}.componentId`, kind === 'arms' ? 'SHADOWBASE.Apps.Droid.ArmModel' : 'SHADOWBASE.Apps.Droid.StrutModel', kind === 'arms' ? 'arm' : 'strut'),
        hasDef: !!def,
        manipulator: kind === 'arms' && def && def.slots?.manipulator > 0 ? select(`arms.${index}.manipulatorId`, 'SHADOWBASE.Apps.Droid.Manipulator', 'manipulator') : null,
        motiveMount: kind === 'legs' && def && def.slots?.motive > 0 ? select(`legs.${index}.motiveMountId`, 'SHADOWBASE.Apps.Droid.MotiveMount', 'motiveMount') : null,
        actuator: def ? select(`${kind}.${index}.actuatorId`, 'SHADOWBASE.Apps.Droid.Actuator', 'actuator') : null,
        wiring: def ? select(`${kind}.${index}.wiringId`, 'SHADOWBASE.Apps.Droid.ReflexWiring', 'wiring') : null,
      };
    });

    const hardwareCp = sheet ? engine.calculateDroidHardwarePoints(sheet) : 0;
    const hardwareWeight = engine.calculateDroidHardwareWeightLb(build);
    const dr = stats ? engine.droidDr.droidHardwareDr(sheet, stats.dynamicHitLocations) : null;
    const torso = dr ? Object.values(dr.byLocationId)[0] ?? null : null;
    const anatomy = reconciledAnatomy(actor);

    context.workshop = {
      isConstructed, editable: this.editable,
      statusLine: loc(isConstructed ? 'SHADOWBASE.Apps.Droid.Locked' : 'SHADOWBASE.Apps.Droid.Design'),
      lockLabel: loc(isConstructed ? 'SHADOWBASE.Apps.Droid.EnterConstruction' : 'SHADOWBASE.Apps.Droid.LockBuild'),
      summary: [
        { label: loc('SHADOWBASE.Apps.Droid.Summary.Chassis'), value: chassis?.name ?? null },
        { label: loc('SHADOWBASE.Apps.Droid.Summary.Power'), value: powerCore?.name ?? null },
        { label: loc('SHADOWBASE.Apps.Droid.Summary.Head'), value: headDef?.name ?? null },
        { label: loc('SHADOWBASE.Apps.Droid.Summary.Arms'), value: armCount || null },
        { label: loc('SHADOWBASE.Apps.Droid.Summary.Legs'), value: legCount || null },
      ].map((s) => ({ ...s, text: s.value ?? loc('SHADOWBASE.Apps.Droid.NoneLower'), empty: s.value == null })),
      slots, hasSlots: slots.length > 0,
      nextStep: nextStep ? loc(`SHADOWBASE.Apps.Droid.Next.${nextStep}`) : '',
      hardware: { cp: hardwareCp, weight: Math.round(hardwareWeight * 100) / 100, pp: num(actor.system?.powerPoints), ppMax: stats?.currentValues?.maxPowerPoints ?? null },
      plating: torso ? { frame: torso.frame, plating: torso.plating, platingMax: torso.platingMax, current: build.chassisMods.armorCurrentDr ?? null } : null,
      phase1: { chassis: select('chassisId', 'SHADOWBASE.Apps.Droid.MainChassis', 'chassis'), powerCore: chassis ? select('powerCoreId', 'SHADOWBASE.Apps.Droid.PowerCore', 'powerCore') : null },
      phase2: powerCore ? {
        head: select('head.componentId', 'SHADOWBASE.Apps.Droid.HeadUnit', 'head'),
        showHeadChain: slotRows.showHeadChain,
        processor: select('head.processorId', 'SHADOWBASE.Apps.Droid.LogicProcessor', 'processor'),
        hasProcessor: !!build.head?.processorId,
        coProcessor: hasProcessorHousing ? select('head.coProcessorId', 'SHADOWBASE.Apps.Droid.SecondProcessor', 'processor', { exclude: build.head?.processorId }) : null,
        memory: select('head.memoryCoreId', 'SHADOWBASE.Apps.Droid.MemoryCore', 'memory'),
        sensors: slotRows.sensors.map((i) => select(`head.sensorIds.${i}`, 'SHADOWBASE.Apps.Droid.SensorUnit', 'sensor')).map((s, i) => ({ ...s, label: fmt('SHADOWBASE.Apps.Droid.SensorUnitN', { n: i + 1 }) })),
        hasMounts: !!chassis && ((chassis.utilitySlots ?? 0) > 0 || (chassis.externalSlots ?? 0) > 0 || (chassis.internalSlots ?? 0) > 0),
        internal: slotRows.internal.map((i) => ({ ...select(`chassisMods.internalIds.${i}`, 'SHADOWBASE.Apps.Droid.InternalBay', 'internal'), label: fmt('SHADOWBASE.Apps.Droid.InternalBayN', { n: i + 1 }) })),
        external: slotRows.external.map((i) => ({ ...select(`chassisMods.externalIds.${i}`, 'SHADOWBASE.Apps.Droid.ExternalHardpoint', 'external'), label: fmt('SHADOWBASE.Apps.Droid.ExternalHardpointN', { n: i + 1 }) })),
        utility: slotRows.utility.map((i) => ({ ...select(`chassisMods.utilityIds.${i}`, 'SHADOWBASE.Apps.Droid.UtilityMount', 'utility'), label: fmt('SHADOWBASE.Apps.Droid.UtilityMountN', { n: i + 1 }) })),
        hasMotive: !!chassis && (chassis.motiveMountSlots ?? 0) > 0,
        motive: Array.from({ length: chassis?.motiveMountSlots ?? 0 }, (_, i) => ({ ...select(`chassisMods.motiveMountIds.${i}`, 'SHADOWBASE.Apps.Droid.DirectMotive', 'motiveMount'), label: fmt('SHADOWBASE.Apps.Droid.DirectMotiveN', { n: i + 1 }) })),
        arms: limbs('arms'), legs: limbs('legs'),
      } : null,
      phase3: powerCore ? {
        actuator: select('chassisMods.actuatorId', 'SHADOWBASE.Apps.Droid.ActuatorUpgrades', 'actuator'),
        wiring: select('chassisMods.wiringId', 'SHADOWBASE.Apps.Droid.ReflexWiringDx', 'wiring'),
        reinforcement: select('chassisMods.reinforcementId', 'SHADOWBASE.Apps.Droid.Reinforcement', 'reinforcement'),
        armor: select('chassisMods.armorId', 'SHADOWBASE.Apps.Droid.ArmorPlating', 'armor'),
        motivator: select('chassisMods.motivatorId', 'SHADOWBASE.Apps.Droid.Motivators', 'motivator'),
        backupPower: select(`chassisMods.internalIds.${BACKUP_POWER_INDEX}`, 'SHADOWBASE.Apps.Droid.BackupPower', 'backupPower'),
      } : null,
      anatomy: { rows: anatomy.map((l) => ({ name: l.name, type: l.type, side: l.side ?? '', status: l.status, innateDR: l.innateDR, degradation: l.currentDegradation, penalty: l.targetPenalty, amputated: !!l.isAmputated })), count: anatomy.length, inSync: anatomyInSync(actor), storedCount: (actor.system?.hitLocations ?? []).length },
      pending: this.pendingWork ? { name: this.pendingWork.partName, mode: this.pendingWork.mode } : null,
      warpedCount: warped.length,
    };
    return context;
  }

  // ---------------------------------------------------------------------------
  // Field routing: droid.<path> selects and the limb side selects
  // ---------------------------------------------------------------------------

  async _onOwnField(field, value) {
    const v = value === '' || value === null || value === undefined ? null : String(value);
    if (/^(arms|legs)\.\d+\.side$/.test(field)) {
      const build = this.build;
      if (getPath(build, field) === v) return false;
      setBuildPath(build, field, v);
      await this.writeBuild(build);
      return true;
    }
    if (field === 'chassisMods.armorCurrentDr') {
      const build = this.build;
      const n = v === null ? null : Math.max(0, Math.floor(num(v)));
      if ((build.chassisMods.armorCurrentDr ?? null) === n) return false;
      build.chassisMods.armorCurrentDr = n;
      await this.writeBuild(build);
      return true;
    }
    if (!catalogForPath(field)) return false;
    const current = getPath(this.build, field);
    const currentId = current && current !== NONE_VALUE ? current : null;
    if (currentId === v) return false;
    await this.selectPart(field, v);
    return true;
  }

  /** Write the whole build (ARCHITECTURE §6.5). */
  async writeBuild(build) {
    const next = { ...build, head: { ...build.head, sensorIds: materialise(build.head.sensorIds) }, chassisMods: { ...build.chassisMods } };
    for (const key of ['internalIds', 'externalIds', 'utilityIds', 'auxiliaryIds', 'motiveMountIds']) next.chassisMods[key] = materialise(build.chassisMods[key]);
    await writeWholeArray(this.actor, 'droidBuild', next);
    await this.syncAnatomy({ silent: true });
    return next;
  }

  /**
   * Keep the stored hitLocations on the derived anatomy (the engine reads
   * droidAnatomy + reconcileDroidAnatomy for a droid, never the stored rows -
   * engine-load-path digest fact 16 - so the stored rows are kept to the same
   * names for the Anatomy Workshop's per-row state to carry across).
   */
  async syncAnatomy({ silent = false } = {}) {
    if (!this.actor.system?.isDroid) return false;
    if (anatomyInSync(this.actor)) return false;
    const rows = reconciledAnatomy(this.actor).map((l) => ({ ...l }));
    await writeWholeArray(this.actor, 'hitLocations', rows);
    if (!silent) notify('info', fmt('SHADOWBASE.Apps.Droid.AnatomySynced', { count: rows.length }));
    return true;
  }

  // ---------------------------------------------------------------------------
  // Part selection (droid-workshop.tsx:285-389)
  // ---------------------------------------------------------------------------

  /**
   * :346-389 handlePartSelection - the warped refusal, the design-mode shortcut,
   * the stock check, then the Ch17 job. Returns what happened.
   */
  async selectPart(path, partId) {
    const cat = catalogForPath(path);
    if (!cat) return { refused: 'unknown-path' };
    const build = this.build;
    const oldId = getPath(build, path) || NONE_VALUE;
    const target = partId || NONE_VALUE;
    if (target !== NONE_VALUE && build.warpedSlots.includes(path)) {
      notify('error', loc('SHADOWBASE.Apps.Droid.SlotWarped'));
      return { refused: 'warped' };
    }
    if (!this.isConstructed || oldId === target) return this.applyPartSelection(path, target, cat);
    const lib = cat.lib();
    if (target !== NONE_VALUE) {
      const part = lib.find((p) => p.id === target);
      const inStock = this.equipmentRows.some((e) => e.name === part?.name && !e.storageLocationId);
      if (!inStock) { notify('error', fmt('SHADOWBASE.Apps.Droid.HardwareMissing', { name: part?.name ?? '' })); return { refused: 'missing' }; }
    }
    const outgoing = lib.find((p) => p.id === oldId);
    const incoming = lib.find((p) => p.id === target);
    this.pendingWork = {
      path, partId: target, category: cat.category,
      mode: target === NONE_VALUE ? 'disassemble' : 'swap',
      partName: incoming?.name ?? outgoing?.name ?? 'Component',
      weight: (target === NONE_VALUE ? outgoing?.weight : incoming?.weight) ?? 0,
    };
    const job = this.pendingWork;
    const app = await CraftingApp.open(this.actor, {
      item: { name: job.partName, weight: job.weight, finalWeight: job.weight },
      category: job.category, mode: job.mode,
      onComplete: (success, waste, meta) => this.completeWork(success, waste, meta),
    });
    return { pending: job, crafting: app };
  }

  /**
   * :285-331 applyPartSelection - the inventory move and the slot write, no roll.
   * On a built droid the old part returns to inventory (quantity or a new row
   * filed under a known category) and the new one is consumed by name.
   */
  async applyPartSelection(path, partId, cat = catalogForPath(path)) {
    const build = this.build;
    const oldId = getPath(build, path);
    const lib = cat.lib();
    let equipment = [...this.equipmentRows];
    if (this.isConstructed) {
      if (oldId && oldId !== NONE_VALUE) {
        const oldPart = lib.find((p) => p.id === oldId);
        if (oldPart) {
          const idx = equipment.findIndex((e) => e.name === oldPart.name && !e.storageLocationId);
          if (idx > -1) equipment[idx] = { ...equipment[idx], quantity: num(equipment[idx].quantity) + 1 };
          else {
            const known = EQUIPMENT_CATEGORIES.includes(cat.category);
            equipment.push({ id: engine.rowId(), name: oldPart.name, category: known ? cat.category : 'Utility & Miscellaneous', ...(known ? {} : { subCategory: cat.category }), cost: oldPart.costCr || 0, weight: oldPart.weight || 0, quantity: 1, isInstalled: false, description: oldPart.effect || oldPart.traits || '' });
          }
        }
      }
      if (partId !== NONE_VALUE) {
        const part = lib.find((p) => p.id === partId);
        const idx = equipment.findIndex((e) => e.name === part?.name && !e.storageLocationId);
        if (idx === -1) { notify('error', fmt('SHADOWBASE.Apps.Droid.HardwareMissing', { name: part?.name ?? '' })); return { refused: 'missing' }; }
        if (num(equipment[idx].quantity) > 1) equipment[idx] = { ...equipment[idx], quantity: num(equipment[idx].quantity) - 1 };
        else equipment = equipment.filter((_, i) => i !== idx);
      }
      await syncRows(this.actor, 'equipment', equipment);
    }
    setBuildPath(build, path, partId === NONE_VALUE ? null : partId);
    // :189-194 - removing the housing must not leave an orphaned second processor behind.
    if (!(build.chassisMods.internalIds ?? []).includes(D.EXPANDED_PROCESSOR_HOUSING_ID) && build.head?.coProcessorId) build.head.coProcessorId = null;
    await this.writeBuild(build);
    return { applied: { path, partId: partId === NONE_VALUE ? null : partId } };
  }

  /**
   * :401-527 handleWorkComplete - the Ch10 signals, then the swap on success or
   * Ch17's tables on failure (APPLIED, not toasted).
   */
  async completeWork(success, waste, meta) {
    const actor = this.actor;
    const BF = engine.blueprintFlow;
    let equipment = [...this.equipmentRows];
    let touched = false;
    if (waste?.length) { equipment = engine.craftingMaterials.spendRawMaterials(equipment, waste); touched = true; }
    if (meta?.blueprintReadBrickedId) { equipment = BF.brickBlueprintCard(equipment, meta.blueprintReadBrickedId); touched = true; }
    if (meta?.blueprintWritten) {
      const withBp = BF.applyBlueprintWrite(equipment, { of: this.pendingWork?.partName || 'Droid Part', origin: 'original', proven: success, constructionMarkup: null });
      if (withBp) { equipment = withBp; touched = true; }
    } else if (meta?.blueprintCardBricked) {
      const withoutBlank = BF.applyBlueprintBrick(equipment);
      if (withoutBlank) { equipment = withoutBlank; touched = true; }
    }
    if (success && meta?.blueprintUsedId) { equipment = BF.markBlueprintProven(equipment, meta.blueprintUsedId); touched = true; }
    if (touched) await syncRows(actor, 'equipment', equipment);

    const job = this.pendingWork;
    this.pendingWork = null;
    if (!job) return null;
    if (success) {
      const r = await this.applyPartSelection(job.path, job.partId, catalogForPath(job.path));
      notify('info', loc(job.mode === 'swap' ? 'SHADOWBASE.Apps.Droid.SwapComplete' : 'SHADOWBASE.Apps.Droid.Uninstalled'));
      await this.render();
      return { success: true, ...r };
    }
    // :465-473 - the two 1d6 tables, keyed on the same die for the row and its writes.
    const kind = meta?.wasCriticalFailure ? 'criticalFailure' : 'failure';
    const die = await new Roll('1d6').evaluate();
    const d6 = die.total;
    const result = engine.droidModification.droidMalfunction(kind, d6);
    const pp = num(actor.system?.powerPoints);
    const applied = engine.droidModification.droidMalfunctionApplication(kind, d6, pp);
    const partName = job.partName;
    let rows = [...this.equipmentRows];
    if (applied.ruinPart || applied.damagePart) {
      const idx = rows.findIndex((e) => e?.name === partName && !e?.storageLocationId);
      if (idx !== -1) {
        rows = applied.ruinPart ? rows.filter((_, i) => i !== idx) : rows.map((e, i) => (i === idx ? { ...e, condition: 'Damaged' } : e));
        await syncRows(actor, 'equipment', rows);
      }
    }
    const updates = {};
    if (applied.ppLoss > 0) updates['system.powerPoints'] = Math.max(0, pp - applied.ppLoss);
    let hpHit = 0;
    if (applied.hpDice) {
      // :491-501 - the surge lands as 1d direct HP damage under 20 PP.
      const surge = await rolls.rollDamage(actor, { label: 'Power Surge', formula: applied.hpDice, modifier: 0 });
      hpHit = surge?.total ?? 0;
      if (hpHit > 0) {
        const stored = actor.system?.currentHitPoints;
        const base = stored != null && Number.isFinite(Number(stored)) ? Number(stored) : (num(statsOf(actor)?.currentValues?.hitPoints) || 10);
        updates['system.currentHitPoints'] = Math.max(0, base - hpHit);
      }
    }
    if (Object.keys(updates).length) await actor.update(updates);
    if (applied.warpSlot) {
      const build = this.build;
      if (!build.warpedSlots.includes(job.path)) { build.warpedSlots = [...build.warpedSlots, job.path]; await this.writeBuild(build); }
    }
    if (applied.persistEffect) {
      // :509-520 - the flaw rows persist as a status-effect row (the website's literal row shape; it is exported).
      await effects.addEffect(actor, {
        id: engine.rowId(), name: `${result.name} (${partName})`, type: 'debuff', source: 'Droid Malfunction',
        description: `${result.effect} Repair per Ch17's Droid Repair Rules; remove this effect when repaired.`,
        isManual: true, modifiers: { ...engine.NO_MODIFIERS },
      });
    }
    const tail = `${applied.ruinPart ? ` ${fmt('SHADOWBASE.Apps.Droid.Fail.Destroyed', { name: partName })}` : ''}${applied.damagePart ? ` ${fmt('SHADOWBASE.Apps.Droid.Fail.Damaged', { name: partName })}` : ''}${applied.ppLoss ? ` ${fmt('SHADOWBASE.Apps.Droid.Fail.PpLost', { pp: applied.ppLoss })}` : ''}${hpHit ? ` ${fmt('SHADOWBASE.Apps.Droid.Fail.HpHit', { hp: hpHit })}` : ''}${applied.warpSlot ? ` ${loc('SHADOWBASE.Apps.Droid.Fail.Warped')}` : ''}`;
    notify('error', `${loc(kind === 'criticalFailure' ? 'SHADOWBASE.Apps.Droid.Fail.Critical' : 'SHADOWBASE.Apps.Droid.Fail.Failure')}: ${result.name} - ${result.effect}${tail}`);
    await this.render();
    return { success: false, kind, d6, result, applied, hpHit };
  }

  /** :101-115 attemptStructuralRepair - a Mechanic (Droids) roll trues the warped mounting. */
  async structuralRepair(path, opts = {}) {
    const build = this.build;
    if (!build.warpedSlots.includes(path)) return null;
    const target = rolls.skillTargetFor(this.actor, 'Mechanic (Droids)');
    if (target?.target == null) { notify('error', loc('SHADOWBASE.Apps.Droid.NoMechanicRoute')); return null; }
    const r = await rolls.rollSkill(this.actor, 'Mechanic (Droids)', opts);
    if (!r) return null;
    if (r.outcome.success) {
      build.warpedSlots = build.warpedSlots.filter((p) => p !== path);
      await this.writeBuild(build);
      notify('info', loc('SHADOWBASE.Apps.Droid.SlotRepaired'));
    } else notify('error', loc('SHADOWBASE.Apps.Droid.RepairFailed'));
    await this.render();
    return r;
  }

  /** :599-661 Buy Droid Components - the buy path the "Hardware Missing" refusal points at. */
  async buyParts({ partId, quantity } = {}) {
    const parts = engine.partAcquisition.acquirablePartsFor('droid');
    let pick = partId ? { partId, quantity: Math.max(1, Math.floor(num(quantity, 1))) } : null;
    if (!pick) {
      const groups = engine.partAcquisition.partCategoriesFor('droid');
      const options = groups.map((g) => `<optgroup label="${esc(g)}">${parts.filter((p) => p.category === g).map((p) => { const priced = engine.partAcquisition.pricePart('droid', p.id, null); return `<option value="${esc(p.id)}">${esc(p.name)} (${esc(priced?.cost ?? '?')} cr)</option>`; }).join('')}</optgroup>`).join('');
      pick = await formDialog({
        title: loc('SHADOWBASE.Apps.Droid.BuyParts'), icon: 'fa-solid fa-book',
        content: `<div class="shadowbase sb-app-dialog__body"><div class="form-group"><label>${esc(loc('SHADOWBASE.Apps.Droid.Component'))}</label><select name="partId">${options}</select></div><div class="form-group"><label>${esc(loc('SHADOWBASE.Apps.Common.Quantity'))}</label><input type="number" name="quantity" value="1" min="1" step="1"></div><p class="sb-muted-p">${esc(loc('SHADOWBASE.Apps.Droid.BuyHint'))}</p></div>`,
        okLabel: loc('SHADOWBASE.Apps.Droid.Acquire'),
        read: (form) => ({ partId: String(readField(form, 'partId') ?? ''), quantity: Math.max(1, Math.floor(num(readField(form, 'quantity'), 1))) }),
      });
    }
    if (!pick?.partId) return null;
    const row = engine.partAcquisition.buildAcquiredRow('droid', pick.partId, null, pick.quantity, engine.rowId());
    if (!row) { notify('warn', loc('SHADOWBASE.Apps.Droid.NoSuchPart')); return null; }
    await syncRows(this.actor, 'equipment', [...this.equipmentRows, row]);
    notify('info', fmt('SHADOWBASE.Apps.Droid.ComponentsAcquired', { count: pick.quantity, name: row.name }));
    await this.render();
    return row;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** :602-635 - locking a design needs no prompt; UNLOCKING a built unit states the rule and asks. */
  static async onToggleConstruction(event) {
    event?.preventDefault?.();
    if (this.isConstructed) {
      const ok = await confirmDialog({ title: loc('SHADOWBASE.Apps.Droid.UnlockTitle'), content: `<p>${loc('SHADOWBASE.Apps.Droid.UnlockBody')}</p>`, yes: loc('SHADOWBASE.Apps.Droid.UnlockYes') });
      if (!ok) return false;
      await this.actor.update({ 'system.isConstructed': false });
    } else await this.actor.update({ 'system.isConstructed': true });
    return true;
  }
  static async onBuyParts(event) { event?.preventDefault?.(); return this.buyParts(); }
  static async onAddArm(event) { event?.preventDefault?.(); const b = this.build; b.arms = [...b.arms, { id: engine.rowId(), componentId: '', side: 'Right' }]; await this.writeBuild(b); return b.arms.length; }
  static async onAddLeg(event) { event?.preventDefault?.(); const b = this.build; b.legs = [...b.legs, { id: engine.rowId(), componentId: '', side: 'Right' }]; await this.writeBuild(b); return b.legs.length; }
  static async onRemoveLimb(event, target) {
    event?.preventDefault?.();
    const kind = target?.dataset?.kind; const index = Number(target?.dataset?.index);
    if (!['arms', 'legs'].includes(kind) || !Number.isInteger(index)) return false;
    const b = this.build; b[kind] = b[kind].filter((_, i) => i !== index); await this.writeBuild(b); return true;
  }
  static async onStructuralRepair(event, target) { event?.preventDefault?.(); return this.structuralRepair(target?.dataset?.path); }
  static async onSyncAnatomy(event) { event?.preventDefault?.(); return this.syncAnatomy(); }
}

export default DroidWorkshop;
