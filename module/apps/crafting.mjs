// module/apps/crafting.mjs
//
// CraftingApp (docs/ARCHITECTURE.md §6.5): the website's
// src/components/character-sheet/components/inventory/crafting-dialog.tsx as
// an ApplicationV2 window bound to an actor. The dialog's whole
// stage-selection tree, its per-roll branching and the CraftingResultMeta it
// hands back are ported LINE FOR LINE (each block cites the tsx lines); every
// rule it applies is the bundle's:
//
//   craftingRules        CRAFTING_DEFINITIONS / DECONSTRUCT / SWAP / the saber lists, the
//                        blueprint stages, stagesForSilicon / stagesForPowerUnit, the clock,
//                        materialLossFraction, runUnits, computeYield ...
//   craftingSkillChoice  stageSkillChoice (the roll target AND the pricing route),
//                        stagesAsCrafted (the markup panel), criticalFailureOutcome (Ch14)
//   armstechSpecialty    withArmstechSpecialty
//   ammunitionCrafting   ammoStages, routeMinutes, effectiveWorkspaceMod, routeEffect
//   blueprints / blueprintFlow / blueprintCatalog / blueprintBuild   the Ch10 gate, the
//                        build bonus, the declared card, planBlueprintBuild for a design
//   functionFirmware     firmwareCardOptions, flashingPenaltyFor (the two-card rule)
//   constructionMarkup   markupSteps (the Construction Markup panel)
//   prostheticQuality    prostheticQuality, installationOutcome (Ch14 Phase 4)
//   craftingMaterials    scaleMaterials, spendRawMaterials
//   crafterDamage        applyCrafterDamage
//   salvageRecovery      applyRecovery / applyDeconstruction (the teardown payout)
//   componentRuin        ruinRandomComponent (Ch10 [112]'s reforge class)
//
// Rolls go through module/rolls.mjs (rollCustom for a stage against its
// resolved target with the run's stacked modifier; rollDamage for the
// "1d-3" mishaps) so every card is the system's and the roll history sees them.
//
// A run is either started by a CALLER with a job (the Droid Workshop's swap /
// uninstall, a later item sheet's forge) and hands the result to the caller's
// `onComplete(success, waste, meta)` - exactly the dialog's contract - or
// started from the app's own picker (a design from the Blueprint catalog to
// forge, an owned item to deconstruct / salvage), in which case the app applies
// the outcome itself the way the website's equipment section does
// (equipment-section.tsx handleBuildComplete, fabrication.tsx onComplete).

import { engine } from '../engine.mjs';
import { rolls } from '../rolls.mjs';
import { rowsOf, rowWithDerived } from '../adapter.mjs';
import { ActorSubApp, TEMPLATE_ROOT, loc, fmt, notify, num, text, signed, sheetOf, statsOf, storedRows, syncRows, itemByRowId } from './sub-app.mjs';

const CR = engine.craftingRules;
const SC = engine.craftingSkillChoice;

/** crafting-dialog.tsx:65 - the seven modes. */
export const CRAFTING_MODES = Object.freeze(['forge', 'disassemble', 'deconstruct', 'salvage', 'swap', 'swapComponent', 'standard']);
const BUILD_MODES = new Set(['forge', 'standard']);
const TEARDOWN_MODES = new Set(['deconstruct', 'salvage', 'disassemble']);

/** crafting-dialog.tsx:218-221 - the workspace select's labels carry the signed figure. */
export const WORKSPACE_OPTIONS = Object.freeze(CR.WORKSPACE_MODS.map((w) => ({ value: w.mod, label: `${w.label} (${w.mod > 0 ? '+' : ''}${w.mod})` })));

const rollAttrsOf = (actor) => { const stats = statsOf(actor); return stats ? engine.rollTargets.rollAttributes(stats) : null; };

/**
 * The stage list for a job (crafting-dialog.tsx:409-577 rawStages + withArmstechSpecialty).
 * PURE: the same function the check calls over every family and mode.
 * @param {object} job { item, category, mode, swapLayers, weaponCarriesSilicon, blueprintWrite, designPhase }
 * @param {object} state { writeBlueprint, buildBlueprintId, designOriginal }
 */
export function stagesFor(job, state = {}) {
  const { item, category = '', mode = 'standard', swapLayers = [], weaponCarriesSilicon, blueprintWrite, designPhase } = job;
  const withBlueprintWrite = (list) => (state.writeBlueprint && blueprintWrite?.available ? [...list, CR.BLUEPRINT_WRITE_STAGE] : list);
  const withBlueprintRead = (list) => {
    if (mode !== 'forge' && mode !== 'standard') return list;
    // :421-431 - one origin per build: an Original Design prepends Phase 0 + the write; a declared card prepends its read.
    if (state.designOriginal && designPhase?.available) return [CR.designPhaseStageFor(category, list[0]?.skill ?? 'Machinist'), CR.BLUEPRINT_WRITE_STAGE, ...list];
    return state.buildBlueprintId ? [CR.BLUEPRINT_READ_STAGE, ...list] : list;
  };
  const raw = (() => {
    if (category === 'Lightsaber Forge') {
      if (mode === 'forge') return withBlueprintRead(CR.LIGHTSABER_FORGE_STAGES);
      if (mode === 'disassemble') return withBlueprintWrite(CR.LIGHTSABER_DISASSEMBLY_STAGES);
      if (mode === 'salvage') return CR.lightsaberSalvageStagesFor(category) ?? CR.LIGHTSABER_SALVAGE_STAGES;
      if (mode === 'swap') {
        const s = ['hardware', 'internal', 'crystal'].filter((layer) => swapLayers.includes(layer)).map((layer) => CR.LIGHTSABER_SWAP_STAGES[layer]);
        return s.length > 0 ? s : CR.LIGHTSABER_SWAP_FALLBACK;
      }
    }
    // :466-469 - Ch12's COMPONENT salvage (a loose emitter, a handgrip) has its own procedures.
    if (mode === 'salvage') { const componentSalvage = CR.lightsaberSalvageStagesFor(category); if (componentSalvage) return componentSalvage; }
    let lookup = category;
    if (category.includes('Pistols') || category.includes('Rifles') || category.includes('Heavy Weapons')) lookup = 'Blasters';
    if (mode === 'deconstruct') return withBlueprintWrite(CR.DECONSTRUCT_DEFINITIONS[lookup] || CR.GENERIC_DECONSTRUCT_FALLBACK);
    // :479-496 - uninstalling is a teardown too, where a family defines one.
    if (mode === 'disassemble' && CR.DECONSTRUCT_DEFINITIONS[lookup]) return withBlueprintWrite(CR.DECONSTRUCT_DEFINITIONS[lookup]);
    if (mode === 'swapComponent') return CR.PROSTHETIC_COMPONENT_SWAP_STAGES;
    if (mode === 'swap' && CR.SWAP_DEFINITIONS[lookup]) {
      if (lookup === 'Blasters') return CR.stagesForSilicon(CR.SWAP_DEFINITIONS[lookup], weaponCarriesSilicon);
      return CR.SWAP_DEFINITIONS[lookup];
    }
    const defined = CR.CRAFTING_DEFINITIONS[lookup] || CR.GENERIC_CRAFT_FALLBACK;
    // :522-525 - read off the weapon: a melee weapon with a fitted utility part carries a power unit.
    const utility = item?.utilityParts;
    const meleeHasPowerUnit = Array.isArray(utility) ? utility.some((e) => e?.partId || e?.inventoryId) : undefined;
    if (lookup === 'Ammunition') return withBlueprintRead(engine.ammunitionCrafting.ammoStages(defined, item));
    if (lookup === 'Blasters' && BUILD_MODES.has(mode)) return withBlueprintRead(CR.stagesForSilicon(defined, weaponCarriesSilicon));
    if (lookup === 'Melee Weapons' && BUILD_MODES.has(mode)) return withBlueprintRead(CR.stagesForPowerUnit(defined, meleeHasPowerUnit));
    return withBlueprintRead(defined);
  })();
  // :574-577 - Ch3's flattened Armstech, resolved against the thing being built.
  return engine.armstechSpecialty.withArmstechSpecialty(raw, item);
}

/** crafting-dialog.tsx:732-824 targetInfo - the stage's roll target through stageSkillChoice; null target = a refusal. */
export function stageTarget(stage, userSkills, rollAttrs) {
  if (!stage) return null;
  const choice = SC.stageSkillChoice(stage, userSkills, rollAttrs);
  const { resolved, peer, peerLevel } = choice;
  const describe = engine.skillDefaults.describeResolution;
  if (choice.usedFallback && peer) {
    return { target: peerLevel, isDefault: peer.source !== 'trained', label: peer.source === 'trained' ? `Fallback: ${peerLevel} (${stage.fallbackSkill})` : `${describe(peer)}: ${peerLevel} (${stage.fallbackSkill})`, usedSkill: stage.fallbackSkill, isFallback: true, cannotAttempt: false };
  }
  // A chapter-stated substitute that beat both (crafting-skill-choice.ts substituteLevel): the roll moves, the tier does not.
  if (choice.substituteLevel != null) {
    return { target: choice.substituteLevel, isDefault: true, label: `${choice.skill} (substitute): ${choice.substituteLevel}`, usedSkill: choice.skill, isFallback: false, cannotAttempt: false };
  }
  if (resolved.level != null) {
    return { target: resolved.level, isDefault: resolved.source !== 'trained', label: resolved.source === 'trained' ? `Trained: ${resolved.level}` : `${describe(resolved)}: ${resolved.level}`, usedSkill: stage.skill, isFallback: false, cannotAttempt: false };
  }
  return { target: null, isDefault: true, cannotAttempt: true, label: fmt('SHADOWBASE.Apps.Crafting.NoDefault', { skill: stage.skill }), usedSkill: stage.skill, isFallback: false };
}

/** The dialog's title (:1231-1237) and its description line (:1269-1283). */
export function jobTitle(job) {
  const isLS = String(job.category ?? '').includes('Lightsaber');
  const mode = job.mode ?? 'standard';
  const key = isLS && mode === 'forge' ? 'LightsaberConstruction' : mode === 'disassemble' ? 'Disassembly' : mode === 'deconstruct' ? 'Deconstruction' : mode === 'salvage' ? 'Salvage' : mode === 'swapComponent' ? 'ComponentSurgery' : mode === 'swap' ? 'Modification' : 'Crafting';
  const title = `${loc(`SHADOWBASE.Apps.Crafting.Title.${key}`)}${isLS ? '' : ` ${loc('SHADOWBASE.Apps.Crafting.Protocol')}`}`;
  const route = job.category === 'Ammunition' ? (job.ammoRoute ?? 'standard') : 'standard';
  const dKey = isLS ? (mode === 'forge' ? 'SaberForge' : mode === 'salvage' ? 'SaberSalvage' : 'SaberTeardown')
    : BUILD_MODES.has(mode) ? (route === 'handloaded' ? 'Handloaded' : route === 'improvised' ? 'Improvised' : 'Build')
      : mode === 'salvage' ? 'Salvage' : mode === 'swap' ? 'Swap' : 'Deconstruct';
  return { title, description: loc(`SHADOWBASE.Apps.Crafting.Description.${dKey}`), isLS };
}

/** A fresh run state (the dialog's useState block, :343-356 and :579-632). */
export function freshRun() {
  return {
    stageIdx: 0, workspaceMod: 0, extraTimeIdx: 0, logs: [], finished: false, failed: false,
    sawCriticalSuccess: false, sawCriticalFailure: false, restartWaste: [], componentRuinedStage: null,
    lowestMargin: null, stageMargins: {}, forcedPrimaryMethod: false, consumedByFailure: [],
    overloaded: false, unattuned: false, fracturedCrystal: false, saberRuin: null, saberForgeRuin: null, crafterDamage: 0,
    writeBlueprint: false, blueprintWritten: false, blueprintCardBricked: false, buildBlueprintId: '', readBrickedId: '',
    designOriginal: false, designGhostGlitch: false, firmwareCardId: '',
  };
}

const lower = (s) => String(s ?? '').trim().toLowerCase();

export class CraftingApp extends ActorSubApp {
  static APP_NAME = 'crafting';
  static TITLE_KEY = 'SHADOWBASE.Apps.Crafting.WindowTitle';
  static FIELD_PREFIX = 'craft.';

  static DEFAULT_OPTIONS = {
    window: { title: 'SHADOWBASE.Apps.Crafting.WindowTitle', icon: 'fa-solid fa-hammer', resizable: true },
    position: { width: 560, height: 760 },
    actions: {
      'roll-stage': CraftingApp.onRollStage,
      'finalize': CraftingApp.onFinalize,
      'abort': CraftingApp.onAbort,
      'start-design': CraftingApp.onStartDesign,
      'start-teardown': CraftingApp.onStartTeardown,
    },
  };

  static PARTS = { crafting: { template: `${TEMPLATE_ROOT}/crafting.hbs`, scrollable: [''] } };

  /** The current job (null = the picker) and its run state. */
  job = null;
  run = freshRun();
  /** The picker's own state. */
  pick = { section: '', designName: '', mode: 'deconstruct', itemId: '', quantity: 1 };

  constructor(options = {}) {
    super(options);
    this.configure(options);
  }

  /** Accept a job (the dialog's props, :174-215) plus the caller's onComplete; without an item the app opens on its picker. */
  configure(options = {}) {
    if (!options.item) return;
    const { item, category = '', mode = 'standard', swapLayers = [], ammoRoute = 'standard', weaponCarriesSilicon, blueprintWrite, designPhase, declaredBlueprintId, onComplete = null, apply = null } = options;
    const equipment = storedRows(this.actor, 'equipment');
    const blank = !!engine.blueprints.findBlankDatacard(equipment);
    this.job = {
      item, category, mode, swapLayers, ammoRoute, weaponCarriesSilicon,
      // The Droid Workshop passes both from findBlankDatacard (droid-workshop.tsx:1013-1014); a picker job does the same.
      blueprintWrite: blueprintWrite ?? { available: blank },
      designPhase: designPhase ?? { available: blank },
      declaredBlueprintId: declaredBlueprintId ?? '',
      onComplete, apply,
    };
    this.run = freshRun();
    this.run.buildBlueprintId = this.job.declaredBlueprintId;
    this.#autoDeclareBlueprint();
  }

  // ---------------------------------------------------------------------------
  // Derived state (the dialog's memos)
  // ---------------------------------------------------------------------------

  get stages() { return this.job ? stagesFor(this.job, this.run) : []; }
  get currentStage() { return this.stages[this.run.stageIdx] ?? null; }
  get isBuildFlow() { return !!this.job && BUILD_MODES.has(this.job.mode); }
  /** :377-378 - assembling a lightsaber and attuning its crystal are the two blueprint-exempt builds. */
  get blueprintGateApplies() { return this.isBuildFlow && !(this.job.category === 'Lightsaber Forge' || this.job.category === 'Lightsaber Primary Crystal'); }
  get matchingBlueprints() { return this.job ? engine.blueprintFlow.matchingBuildBlueprints(storedRows(this.actor, 'equipment'), this.job.item?.name) : []; }
  get activeBlueprint() { return this.matchingBlueprints.find((b) => b.id === this.run.buildBlueprintId) ?? null; }
  get firmwareCards() { return engine.functionFirmware.firmwareCardOptions(storedRows(this.actor, 'equipment')); }
  get activeFirmwareCard() { return this.firmwareCards.find((c) => c.id === this.run.firmwareCardId) ?? null; }
  /** :837-843 - Ch10's neutralized ladder rides every phase of a declared build (not the read roll). */
  get blueprintBonus() {
    if (!this.isBuildFlow) return 0;
    if (this.run.designOriginal && this.job.designPhase?.available) return -1;
    const bp = this.activeBlueprint;
    return bp ? engine.blueprints.blueprintBuildBonus(bp.generation, bp.proven) : 0;
  }
  get needsFirmwareCard() { return this.isBuildFlow && this.stages.some((s) => s.flashesFirmware === true); }
  get blueprintGateSatisfied() { return !this.blueprintGateApplies || (this.run.designOriginal && this.job.designPhase?.available === true) || this.activeBlueprint != null; }
  get firmwareGateSatisfied() { return !this.needsFirmwareCard || this.activeFirmwareCard != null; }
  get buildGateSatisfied() { return this.blueprintGateSatisfied && this.firmwareGateSatisfied; }
  get route() { return this.job?.category === 'Ammunition' ? (this.job.ammoRoute ?? 'standard') : 'standard'; }
  get appliedWorkspaceMod() { return engine.ammunitionCrafting.effectiveWorkspaceMod(this.run.workspaceMod, this.route); }
  get timeAllowsBonus() { return CR.extraTimeAllowed(this.job?.mode ?? 'standard', this.appliedWorkspaceMod); }
  get extraTime() { return CR.EXTRA_TIME_STEPS[this.run.extraTimeIdx] ?? CR.EXTRA_TIME_STEPS[0]; }
  get extraTimeBonus() { return this.timeAllowsBonus ? this.extraTime.bonus : 0; }
  get totalMod() { return this.appliedWorkspaceMod + this.extraTimeBonus; }
  get userSkills() { return sheetOf(this.actor)?.skills ?? []; }
  get targetInfo() { return stageTarget(this.currentStage, this.userSkills, rollAttrsOf(this.actor)); }

  /** :388-391 - the best card is declared automatically while nothing is declared. */
  #autoDeclareBlueprint() {
    if (!this.job || !this.blueprintGateApplies || this.run.designOriginal || this.run.buildBlueprintId) return;
    const list = this.matchingBlueprints;
    if (list.length > 0) this.run.buildBlueprintId = list[0].id;
  }

  /** :654-660 - what a failed run destroys: derived from the failing phase, crit-aware. */
  get materialsLost() {
    if (!this.job || !this.run.failed || this.run.componentRuinedStage) return [];
    const units = CR.runUnits(this.job.category, this.job.item);
    const fraction = CR.materialLossFraction(this.currentStage, this.job.mode, this.run.sawCriticalFailure);
    return engine.craftingMaterials.scaleMaterials(this.job.item?.materials, units * fraction);
  }

  /** :680-728 - the clock. */
  get estimatedTime() {
    const { mode, category, item, swapLayers = [], weaponCarriesSilicon } = this.job;
    const building = BUILD_MODES.has(mode);
    const AC = engine.ammunitionCrafting;
    const perHalf = building && category === 'Ammunition' ? AC.ammoAssemblyMinutes(item) : null;
    const perUnit = category !== 'Ammunition' && CR.isPerUnitConsumable(item)
      ? (building ? CR.PER_UNIT_CONSUMABLE_MINUTES.forge : mode === 'salvage' ? CR.PER_UNIT_CONSUMABLE_MINUTES.salvage : null)
      : null;
    let base = perHalf ?? perUnit ?? CR.baseTimeMinutes(mode, category, item?.finalWeight || item?.weight || 0);
    if (base === null) return null;
    if (category === 'Lightsaber Forge' && mode === 'swap') base += 5 * Math.max(0, swapLayers.length - 1);
    const blasterFamily = category === 'Blasters' || category.includes('Pistols') || category.includes('Rifles') || category.includes('Heavy Weapons');
    if (blasterFamily && mode === 'swap' && weaponCarriesSilicon === false) base = 30;
    const forRoute = building ? AC.routeMinutes(base, this.route, item) : base;
    if (forRoute === null) return null;
    return CR.formatDuration(forRoute * CR.runUnits(category, item) * this.extraTime.multiplier);
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.hasJob = !!this.job;
    context.picker = this.job ? null : this.#pickerContext();
    context.run = this.job ? this.#runContext() : null;
    return context;
  }

  /** The picker: the Blueprint catalog's designs (by section) and the owned items a teardown can take. */
  #pickerContext() {
    const sections = engine.blueprintCatalog.craftableDesignsBySection();
    const sectionNames = sections.map((s) => s.section);
    const section = sectionNames.includes(this.pick.section) ? this.pick.section : (sectionNames[0] ?? '');
    const designs = (sections.find((s) => s.section === section)?.families ?? []).flatMap((f) => f.designs.map((d) => ({ ...d, familyName: f.family })));
    const equipment = storedRows(this.actor, 'equipment');
    const teardown = [];
    const push = (source, item, category) => teardown.push({ id: item.id, name: item.displayName ?? item.name, source, category });
    for (const it of rowsOf(this.actor, 'equipment')) {
      const r = it.system.row;
      if (r.category === 'Currencies' || r.category === 'Raw Materials' || engine.blueprints.isBlueprint(r)) continue;
      push('equipment', it, engine.equipmentCraftingFamily.equipmentCraftingFamily(r) ?? r.category ?? '');
    }
    for (const it of rowsOf(this.actor, 'armor')) push('armor', it, engine.armorCraftingFamily.armorCraftingFamily(it.system.row) ?? 'Armor');
    for (const it of rowsOf(this.actor, 'customBlasters')) push('customBlasters', it, 'Blasters');
    for (const it of rowsOf(this.actor, 'customMeleeWeapons')) push('customMeleeWeapons', it, 'Melee Weapons');
    for (const it of rowsOf(this.actor, 'lightsabers')) push('lightsabers', it, 'Lightsaber Forge');
    const stock = equipment.filter((e) => e?.category === 'Raw Materials');
    const design = designs.find((d) => d.name === this.pick.designName) ?? null;
    const plan = design ? engine.blueprintBuild.planBlueprintBuild({ blueprintOf: design.name, blueprintFamily: design.family }) : null;
    const need = plan?.row?.materials ?? [];
    const missing = need.filter((m) => (num(stock.find((s) => s?.name === m.name)?.quantity)) < num(m.amount));
    return {
      sections: sectionNames.map((s) => ({ value: s, label: s, selected: s === section })),
      designs: designs.map((d) => ({ value: d.name, label: `${d.name} (${d.familyName}, ${d.marketCost.toLocaleString()} cr)`, selected: d.name === this.pick.designName })),
      design: design ? { name: design.name, family: design.family, marketCost: design.marketCost, blueprintCost: design.blueprintCost, direct: plan?.kind === 'direct', where: plan?.where ?? '', need: need.map((m) => ({ name: m.name, amount: m.amount, short: missing.some((x) => x.name === m.name) })), missing: missing.length > 0 } : null,
      hasDesigns: designs.length > 0,
      teardown: teardown.map((t) => ({ ...t, selected: t.id === this.pick.itemId })),
      hasTeardown: teardown.length > 0,
      modes: ['deconstruct', 'salvage', 'disassemble'].map((m) => ({ value: m, label: loc(`SHADOWBASE.Apps.Crafting.Mode.${m}`), selected: m === this.pick.mode })),
      quantity: this.pick.quantity,
    };
  }

  #runContext() {
    const job = this.job;
    const run = this.run;
    const stages = this.stages;
    const stage = this.currentStage;
    const info = this.targetInfo;
    const { title, description, isLS } = jobTitle(job);
    const totalMod = this.totalMod;
    const AC = engine.ammunitionCrafting;
    const route = this.route;
    // :266-324 - the Construction Markup panel prices the route the crafter takes (stagesAsCrafted).
    const markup = this.isBuildFlow ? (() => {
      const steps = engine.constructionMarkup.markupSteps(SC.stagesAsCrafted(stages, this.userSkills, rollAttrsOf(this.actor)));
      if (!steps.length) return null;
      const total = steps.reduce((p, s) => p * s.multiplier, 1);
      return { total, steps: steps.map((s) => ({ stage: s.stage, skill: s.skill, difficulty: s.difficulty, multiplier: s.multiplier })), chapterRated: steps.some((s) => s.multiplier !== engine.constructionMarkup.MARKUP_BY_DIFFICULTY[s.difficulty]) };
    })() : null;
    const bp = this.activeBlueprint;
    const fw = this.activeFirmwareCard;
    const locked = run.logs.length > 0;
    const finishedTone = run.overloaded ? 'flawed' : run.fracturedCrystal ? 'rough' : 'clean';
    return {
      title, description, isLS, mode: job.mode, itemName: text(job.item?.name), category: job.category,
      estimatedTime: this.estimatedTime,
      phase: { current: Math.min(run.stageIdx + 1, stages.length), total: stages.length, pct: stages.length ? Math.round((run.stageIdx / stages.length) * 100) : 0 },
      stages: stages.map((s, i) => ({ name: s.name, skill: s.skill, done: i < run.stageIdx, active: i === run.stageIdx && !run.finished && !run.failed })),
      markup,
      active: !run.finished && !run.failed && !!stage,
      stage: stage ? {
        name: stage.name, description: text(stage.description), failureNote: text(stage.failureNote), criticalFailureNote: text(stage.criticalFailureNote),
        targetLabel: info?.label ?? '', cannotAttempt: !!info?.cannotAttempt, usedSkill: info?.usedSkill ?? stage.skill,
        rollLabel: fmt('SHADOWBASE.Apps.Crafting.RollSkill', { skill: String(info?.usedSkill ?? stage.skill).split(' ')[0] }),
        netMod: totalMod, netText: totalMod !== 0 ? `${loc('SHADOWBASE.Apps.Crafting.Net')} ${signed(totalMod)}` : '', netPositive: totalMod > 0,
      } : null,
      route: route !== 'standard' ? { label: AC.routeEffect(route).label, summary: AC.routeEffect(route).summary } : null,
      blueprintWrite: (job.mode === 'deconstruct' || job.mode === 'disassemble') && job.blueprintWrite ? { available: !!job.blueprintWrite.available, checked: run.writeBlueprint, locked } : null,
      designPhase: this.isBuildFlow && job.designPhase ? { available: !!job.designPhase.available, checked: run.designOriginal, locked } : null,
      blueprint: this.isBuildFlow && (this.blueprintGateApplies || this.matchingBlueprints.length > 0) ? {
        required: this.blueprintGateApplies, hasCards: this.matchingBlueprints.length > 0, locked: locked || run.designOriginal, designOriginal: run.designOriginal,
        options: [...(this.blueprintGateApplies ? [] : [{ value: '', label: loc('SHADOWBASE.Apps.Crafting.NoBlueprintDeclared'), selected: !run.buildBlueprintId }]),
          ...this.matchingBlueprints.map((b) => ({ value: b.id, label: `${b.label} (${fmt('SHADOWBASE.Apps.Crafting.Gen', { n: b.generation })}, ${loc(b.proven ? 'SHADOWBASE.Apps.Crafting.Proven' : 'SHADOWBASE.Apps.Crafting.Unproven')})`, selected: b.id === run.buildBlueprintId }))],
        bonusLine: bp ? (this.blueprintBonus === 0 ? loc('SHADOWBASE.Apps.Crafting.ProvenPlan') : fmt(bp.proven ? 'SHADOWBASE.Apps.Crafting.BonusLine' : 'SHADOWBASE.Apps.Crafting.BonusLineUnproven', { bonus: this.blueprintBonus })) : '',
        designName: text(job.item?.name),
      } : null,
      firmware: this.needsFirmwareCard ? {
        hasCards: this.firmwareCards.length > 0, locked,
        options: [{ value: '', label: loc('SHADOWBASE.Apps.Crafting.DeclareFirmware'), selected: !run.firmwareCardId }, ...this.firmwareCards.map((c) => ({ value: c.id, label: `${c.label} (${fmt('SHADOWBASE.Apps.Crafting.Gen', { n: c.generation })}${c.encoded ? `, ${loc('SHADOWBASE.Apps.Crafting.Encoded')}` : ''})`, selected: c.id === run.firmwareCardId }))],
        penaltyLine: fw && fw.generation > 0 ? fmt('SHADOWBASE.Apps.Crafting.FlashPenalty', { gen: fw.generation, penalty: engine.functionFirmware.flashingPenaltyFor(fw.generation) }) : '',
      } : null,
      workspace: { options: WORKSPACE_OPTIONS.map((o) => ({ ...o, selected: o.value === run.workspaceMod })), forced: this.appliedWorkspaceMod !== run.workspaceMod, applied: this.appliedWorkspaceMod, chosen: signed(run.workspaceMod) },
      extraTime: { options: CR.EXTRA_TIME_STEPS.map((s, i) => ({ value: i, label: s.label, selected: i === run.extraTimeIdx })), noBonus: !this.timeAllowsBonus && this.extraTime.bonus > 0 },
      logs: run.logs.map((l) => ({ text: l, tone: l.includes('SUCCESS') ? 'success' : l.includes('WARNING') ? 'warning' : 'failure' })),
      hasLogs: run.logs.length > 0,
      finished: run.finished ? {
        tone: finishedTone,
        title: loc(job.mode === 'forge' ? (run.overloaded ? 'SHADOWBASE.Apps.Crafting.Done.Flawed' : 'SHADOWBASE.Apps.Crafting.Done.Success') : (run.fracturedCrystal ? 'SHADOWBASE.Apps.Crafting.Done.Rough' : 'SHADOWBASE.Apps.Crafting.Done.Complete')),
        text: loc(job.mode === 'forge' ? (run.overloaded ? (isLS ? 'SHADOWBASE.Apps.Crafting.DoneText.SaberFlawed' : 'SHADOWBASE.Apps.Crafting.DoneText.Flawed') : (isLS ? 'SHADOWBASE.Apps.Crafting.DoneText.SaberClean' : 'SHADOWBASE.Apps.Crafting.DoneText.Clean')) : (run.fracturedCrystal ? 'SHADOWBASE.Apps.Crafting.DoneText.Rough' : 'SHADOWBASE.Apps.Crafting.DoneText.Processed')),
      } : null,
      failed: run.failed,
      canRoll: !run.finished && !run.failed && !!stage && this.buildGateSatisfied,
      gateTitle: !this.buildGateSatisfied ? loc(!this.blueprintGateSatisfied ? 'SHADOWBASE.Apps.Crafting.GateBlueprint' : 'SHADOWBASE.Apps.Crafting.GateFirmware') : '',
      showFinalize: run.finished || run.failed,
      finalizeLabel: loc(run.finished ? 'SHADOWBASE.Apps.Crafting.Finalize' : 'SHADOWBASE.Apps.Crafting.ConfirmResult'),
      materialsLost: this.materialsLost,
    };
  }

  // ---------------------------------------------------------------------------
  // Form fields (craft.*)
  // ---------------------------------------------------------------------------

  async _onOwnField(field, value) {
    const run = this.run;
    const locked = run.logs.length > 0;
    switch (field) {
      case 'workspaceMod': run.workspaceMod = Number.parseInt(String(value), 10) || 0; return true;
      case 'extraTimeIdx': run.extraTimeIdx = Number.parseInt(String(value), 10) || 0; return true;
      case 'writeBlueprint': if (locked) return false; run.writeBlueprint = value === true || value === 'true' || value === 'on'; return true;
      case 'designOriginal': {
        if (locked) return false;
        const on = value === true || value === 'true' || value === 'on';
        run.designOriginal = on;
        if (on) run.buildBlueprintId = ''; else this.#autoDeclareBlueprint();
        return true;
      }
      case 'buildBlueprintId': if (locked || run.designOriginal) return false; run.buildBlueprintId = String(value ?? ''); return true;
      case 'firmwareCardId': if (locked) return false; run.firmwareCardId = String(value ?? ''); return true;
      case 'pick.section': this.pick.section = String(value ?? ''); this.pick.designName = ''; return true;
      case 'pick.designName': this.pick.designName = String(value ?? ''); return true;
      case 'pick.mode': this.pick.mode = String(value ?? 'deconstruct'); return true;
      case 'pick.itemId': this.pick.itemId = String(value ?? ''); return true;
      case 'pick.quantity': this.pick.quantity = Math.max(1, Math.floor(num(value, 1))); return true;
      default: return false;
    }
  }

  // ---------------------------------------------------------------------------
  // The roll (crafting-dialog.tsx:859-1173 handleRoll)
  // ---------------------------------------------------------------------------

  /**
   * Roll the current stage. `opts` reaches module/rolls (rollMode; a caller may
   * pass `{ modifier }` on top of the run's own stacked modifier - the dialog
   * has no situational input, its workspace and extra-time selects ARE the
   * modifiers, so the prompt is skipped).
   * @returns {Promise<object|null>} the roll result, or null when refused
   */
  async rollStage(opts = {}) {
    const stage = this.currentStage;
    const info = this.targetInfo;
    const run = this.run;
    if (!info || !stage || run.finished || run.failed) return null;
    if (!this.buildGateSatisfied) {
      notify('error', !this.blueprintGateSatisfied ? fmt('SHADOWBASE.Apps.Crafting.NoBlueprintInHand', { name: text(this.job.item?.name) || loc('SHADOWBASE.Apps.Crafting.ThisDesign') }) : loc('SHADOWBASE.Apps.Crafting.NoFirmwareCard'));
      return null;
    }
    if (info.target == null) { notify('error', fmt('SHADOWBASE.Apps.Crafting.NoDefault', { skill: stage.skill })); return null; }
    const isBlueprintStage = stage.name === 'Blueprint Write' || stage.name === 'Blueprint Read';
    const fw = this.activeFirmwareCard;
    const flashPenalty = stage.flashesFirmware === true && fw ? engine.functionFirmware.flashingPenaltyFor(fw.generation) : 0;
    const stageMod = this.totalMod + (isBlueprintStage ? 0 : this.blueprintBonus) + flashPenalty + (Number(opts.modifier) || 0);
    const result = await rolls.rollCustom(this.actor, { label: stage.name, target: info.target, modifier: stageMod, rollMode: opts.rollMode });
    if (!result) return null;
    const { outcome, total, target } = result;
    const isCritSuccess = !!outcome.isCriticalSuccess;
    const isCritFail = !!outcome.isCriticalFailure;
    const success = !!outcome.success;
    const stages = this.stages;
    const log = (line) => run.logs.push(line);
    const advance = () => { if (run.stageIdx + 1 < stages.length) run.stageIdx += 1; else run.finished = true; };

    // :914-964 - the Blueprint stages ride the flow but fail on their own terms, outside the margin bookkeeping.
    if (stage.name === 'Design Phase') {
      if (success) { log('[SUCCESS] Design Phase: the schematic holds together. On to the write.'); advance(); }
      else if (isCritFail) { run.designGhostGlitch = true; log('[SUCCESS?] Design Phase: the schematic reads as sound.'); advance(); }
      else log('[FAILURE] Design Phase: the schematic is scrapped and must be redrawn - half the base time again, then a new roll.');
      await this.#rerender();
      return result;
    }
    if (stage.name === 'Blueprint Write') {
      if (success) { run.blueprintWritten = true; log('[SUCCESS] Blueprint Write: schematic recorded to the Datacard. Generation 0.'); advance(); }
      else if (isCritFail) { run.blueprintCardBricked = true; log('[CRITICAL FAILURE] Blueprint Write: the blank card is bricked pending a Computer Programming roll at -2 to unlock it.'); advance(); }
      else log("[FAILURE] Blueprint Write: the write doesn't take. The card is undamaged - another hour, then re-roll.");
      await this.#rerender();
      return result;
    }
    if (stage.name === 'Blueprint Read') {
      if (success) { log(`[SUCCESS] Blueprint Read: schematic loaded. ${this.blueprintBonus >= 0 ? '+' : ''}${this.blueprintBonus} to every phase roll of this build.`); advance(); }
      else if (isCritFail) { run.readBrickedId = run.buildBlueprintId; log('[CRITICAL FAILURE] Blueprint Read: the card is bricked pending a Computer Programming roll at -2 to unlock it.'); run.failed = true; }
      else log('[FAILURE] Blueprint Read: the schematic will not resolve. The card is undamaged - another hour, then re-roll.');
      await this.#rerender();
      return result;
    }

    if (isCritFail) run.sawCriticalFailure = true;
    const { category, mode } = this.job;

    if (success) {
      log(`[SUCCESS] ${stage.name}: alignment confirmed.`);
      const margin = Math.max(0, num(target) - num(total));
      run.lowestMargin = run.lowestMargin === null ? margin : Math.min(run.lowestMargin, margin);
      run.stageMargins[stage.name] = margin;
      if (isCritSuccess) run.sawCriticalSuccess = true;
      if (stage.type === 'Attunement' && (mode === 'forge' || mode === 'swap') && info.usedSkill !== 'Lightsaber Construction') {
        run.unattuned = true;
        log('[WARNING] Matrix integrated without Force focus. Attunement bonuses lost.');
      }
      advance();
    } else if (isCritFail && SC.criticalFailureOutcome(stage, { usedImportMethod: !!info.isFallback, alreadyForced: run.forcedPrimaryMethod, stages, currentIndex: run.stageIdx }).transition) {
      // :998-1029 - Ch14's four transitions, applied rather than decided here.
      const o = SC.criticalFailureOutcome(stage, { usedImportMethod: !!info.isFallback, alreadyForced: run.forcedPrimaryMethod, stages, currentIndex: run.stageIdx });
      run.logs.push(...o.logs);
      if (o.consumes) run.consumedByFailure.push(o.consumes);
      if (o.forcesPrimaryMethod) run.forcedPrimaryMethod = true;
      if (o.restartAtIndex >= 0) run.stageIdx = o.restartAtIndex;
    } else if (category === 'Lightsaber Forge') {
      await this.#saberFailure(stage, mode, isCritFail);
    } else {
      // :1144-1155 - Ch13 [785]: the Circuit-Wiring crit restarts the build on fresh Phase-1 materials.
      if (isCritFail && stage.critRestartsBuild) {
        log(`[CRITICAL FAILURE] ${stage.name}: ${stage.criticalFailureNote ?? 'Phase 1 must be redone from fresh materials.'}`);
        log(`[COST] Fresh Phase 1 materials charged (50% of the run's list). Back to ${stages[0]?.name ?? 'Phase 1'}.`);
        run.restartWaste.push(...engine.craftingMaterials.scaleMaterials(this.job.item?.materials, CR.runUnits(category, this.job.item) * 0.5));
        run.stageIdx = 0;
      } else if (isCritFail && stage.critRuinsComponent) {
        // :1163-1168 - Ch10 [112]'s reforge class: the CARD (the caller) ruins the component.
        run.componentRuinedStage = stage.name;
        log(`[CRITICAL FAILURE] ${stage.name}: ${stage.criticalFailureNote ?? 'A component is ruined.'}`);
        run.failed = true;
      } else {
        log(`[${isCritFail ? 'CRITICAL FAILURE' : 'FAILURE'}] ${stage.name}: Assembly failed.`);
        run.failed = true;
      }
    }
    await this.#rerender();
    return result;
  }

  /** :1031-1134 - the lightsaber's own failure rows per mode and stage type. */
  async #saberFailure(stage, mode, isCritFail) {
    const run = this.run;
    const log = (line) => run.logs.push(line);
    const burn = async (label) => {
      // "the crafter takes 1d-3" - rolled here so the log and the applied figure are one number (:1049-1050).
      const r = await rolls.rollDamage(this.actor, { label, formula: '1d-3', modifier: 0 });
      if (r) run.crafterDamage += r.total;
    };
    if (mode === 'forge' || mode === 'swap') {
      if (stage.type === 'Hardware') {
        const wasteMult = isCritFail ? 1.0 : 0.5;
        log(`[FAILURE] ${stage.name}: ${isCritFail ? 'CATASTROPHIC' : 'Structural'} failure. ${wasteMult * 100}% parts ruined.`);
        run.saberForgeRuin = isCritFail ? 'hardware-crit' : 'hardware';
        run.failed = true;
      } else if (stage.type === 'Integration') {
        if (isCritFail) { log(`[CRITICAL FAILURE] ${stage.name}: Matrix violent short! Internals destroyed. You take 1-3 burn damage.`); await burn('Plasma Backflow'); run.saberForgeRuin = 'internals-crit'; run.failed = true; }
        else log(`[FAILURE] ${stage.name}: Sync failed. 1 hour delay required.`);
      } else if (stage.type === 'Attunement') {
        if (isCritFail) { log(`[CRITICAL FLAW] ${stage.name}: Hidden structural flaw introduced. The weapon appears functional... for now.`); run.overloaded = true; run.finished = true; }
        else log(`[FAILURE] ${stage.name}: Link resisted. 1 hour delay.`);
      }
    } else if (mode === 'disassemble') {
      if (stage.type === 'Attunement') {
        if (isCritFail) { log(`[CRITICAL FAILURE] ${stage.name}: Crystal fractured! Permanent -1 to hit. You take 1-3 burn damage.`); run.fracturedCrystal = true; await burn('Plasma Burst'); run.stageIdx += 1; }
        else log(`[FAILURE] ${stage.name}: Attunement resists. 2x base time required.`);
      } else if (stage.type === 'Integration') {
        if (isCritFail) { log(`[CRITICAL FAILURE] ${stage.name}: Short circuit! Internals destroyed. You take 1-3 burn damage.`); await burn('Electronic Arc'); run.saberRuin = 'internals-destroyed'; run.failed = true; }
        else { log(`[FAILURE] ${stage.name}: Component ruined as scrap.`); run.saberRuin = 'internals-scrap'; run.failed = true; }
      } else if (isCritFail) { log(`[CRITICAL FAILURE] ${stage.name}: Casing warps or triggers trap! Parts ruined.`); run.saberRuin = 'chassis'; run.failed = true; }
      else log(`[FAILURE] ${stage.name}: Seized threads. 2x base time.`);
    } else if (mode === 'salvage') {
      if (stage.type === 'Hardware') {
        if (isCritFail) { log(`[CRITICAL FAILURE] ${stage.name}: Chassis violent warp! Outer parts ruined.`); run.failed = true; }
        else log(`[FAILURE] ${stage.name}: Casing jammed. 2x time.`);
      } else if (stage.type === 'Integration') {
        if (isCritFail) { log(`[CRITICAL FAILURE] ${stage.name}: Matrix discharge! Internals vaporized. You take 1-3 burn damage.`); await burn('Plasma Burst'); run.failed = true; }
        else { log(`[FAILURE] ${stage.name}: Internals fused. Zero yield.`); run.failed = true; }
      } else if (isCritFail) { log(`[CRITICAL FAILURE] ${stage.name}: Matrix collapse! Crystal pulverized.`); run.failed = true; }
      else { log(`[FAILURE] ${stage.name}: Rough extraction. Crystal fractured (-1 hit penalty).`); run.fracturedCrystal = true; run.finished = true; }
    }
  }

  async #rerender() { if (this.rendered) await this.render(); }

  // ---------------------------------------------------------------------------
  // Finalize (crafting-dialog.tsx:1175-1229 handleFinalize) and the outcome
  // ---------------------------------------------------------------------------

  /** The CraftingResultMeta the run produced (:1181-1228). */
  buildMeta() {
    const run = this.run;
    const stages = this.stages;
    const PQ = engine.prostheticQuality;
    const outcome = (!run.finished || run.failed) ? 'failure' : (run.sawCriticalSuccess ? 'critical' : 'success');
    return {
      isOverloaded: run.overloaded, isUnattuned: run.unattuned, isFractured: run.fracturedCrystal,
      saberForgeRuin: run.saberForgeRuin, crafterDamage: run.crafterDamage, outcome,
      marginOfSuccess: run.lowestMargin ?? 0,
      prostheticQuality: PQ.prostheticQuality({ hardwareMargin: run.stageMargins[PQ.QUALITY_SOURCE_PHASES[0]] ?? null, firmwareMargin: run.stageMargins[PQ.QUALITY_SOURCE_PHASES[1]] ?? null, criticalSuccess: run.sawCriticalSuccess }),
      installation: stages.some((s) => s.name === PQ.QUALITY_EXCLUDED_PHASES[1]) ? PQ.installationOutcome({ success: run.stageMargins[PQ.QUALITY_EXCLUDED_PHASES[1]] !== undefined, criticalFailure: run.sawCriticalFailure }) : null,
      consumedByFailure: [...run.consumedByFailure], wasCriticalFailure: run.sawCriticalFailure,
      componentRuinedStage: run.componentRuinedStage, saberDisassemblyRuin: run.saberRuin,
      blueprintWritten: run.blueprintWritten, blueprintCardBricked: run.blueprintCardBricked,
      blueprintUsedId: run.buildBlueprintId || undefined, blueprintReadBrickedId: run.readBrickedId || undefined,
      designGhostGlitch: run.designGhostGlitch, builtFromFlawedBlueprint: this.activeBlueprint?.flawed === true,
    };
  }

  /**
   * Finalize: hand `(success, waste, meta)` to the caller's onComplete, or apply
   * the picker job's outcome here. Returns what was handed over.
   */
  async finalize() {
    const run = this.run;
    const job = this.job;
    if (!job || !(run.finished || run.failed)) return null;
    const success = run.finished;
    // restartWaste rides the wasted pile even on a SUCCESS (:1179-1181).
    const waste = [...run.restartWaste, ...this.materialsLost];
    const meta = this.buildMeta();
    const result = { success, waste, meta };
    if (typeof job.onComplete === 'function') await job.onComplete(success, waste, meta, job);
    else await this.applyOutcome(job, success, waste, meta);
    this.job = null;
    this.run = freshRun();
    await this.#rerender();
    return result;
  }

  /**
   * The generic outcome the website's cards apply for a picker job:
   *   - every mode: the wasted materials (spendRawMaterials), the crafter damage
   *     (applyCrafterDamage onto currentHitPoints), the inputs a critical destroyed
   *     (consumedByFailure, removed by name), the Blueprint signals (applyBlueprintOutcome);
   *   - forge (direct design): on success the materials are spent and the catalog row is
   *     created in its list (equipment-section.tsx:769-793 handleBuildComplete);
   *   - deconstruct / salvage of an owned item: the payout through applyRecovery /
   *     applyDeconstruction (fabrication.tsx onComplete, salvage-recovery.ts) and the host
   *     removed; a componentRuinedStage on a weapon host ruins one fitted part
   *     (ruinRandomComponent, Ch10 [112]).
   */
  async applyOutcome(job, success, waste, meta) {
    const actor = this.actor;
    let equipment = engine.craftingMaterials.spendRawMaterials(storedRows(actor, 'equipment'), waste);
    const removeByName = (name) => { const i = equipment.findIndex((e) => e?.name === name); if (i >= 0) equipment = equipment.filter((_, k) => k !== i); };
    for (const name of meta.consumedByFailure ?? []) removeByName(name);

    if (job.plan?.kind === 'direct' && job.plan.row) {
      if (success) {
        const need = job.plan.row.materials ?? [];
        equipment = engine.craftingMaterials.spendRawMaterials(equipment, need);
        const built = { ...job.plan.row, id: engine.rowId(), quantity: job.quantity ?? 1, condition: 'Fine' };
        if (job.plan.list === 'armor') {
          const armor = [...storedRows(actor, 'armor'), engine.ensureCompleteArmorItem({ ...built, isConstructed: true }, actor.system?.hitLocations ?? [])];
          await syncRows(actor, 'armor', armor);
        } else equipment = [...equipment, built];
        // blueprintBuildSummary reads the CARD the build was declared from (equipment-section.tsx:793 passes the card).
        const card = equipment.find((e) => e?.id === meta.blueprintUsedId) ?? null;
        notify('info', fmt('SHADOWBASE.Apps.Crafting.BuiltFromBlueprint', { name: job.plan.of, summary: card ? engine.blueprintBuild.blueprintBuildSummary(card) : loc('SHADOWBASE.Apps.Crafting.OriginalDesign') }));
      }
      equipment = engine.blueprintFlow.applyBlueprintOutcome(equipment, meta, { of: job.plan.of, origin: 'catalog', constructionMarkup: num(job.plan.design?.markup) || null }, success);
    } else if (TEARDOWN_MODES.has(job.mode) && job.hostRowId) {
      const host = itemByRowId(actor, job.hostRowId);
      const hostRow = host ? rowWithDerived(host) : job.item;
      const parts = this.#partsOf(host);
      if (meta.componentRuinedStage && host && parts.length) {
        // Ch10 [112]: one random fitted component is destroyed instead of a material fraction.
        const d = await new Roll('1d6').evaluate();
        const ruin = engine.componentRuin.ruinRandomComponent(hostRow, parts.map((p) => p.system.row), d.total);
        if (ruin.ruinedId) {
          const gone = itemByRowId(actor, ruin.ruinedId);
          if (gone) await actor.deleteEmbeddedDocuments('Item', [gone.id]);
          const patch = {};
          for (const [slot, v] of Object.entries(ruin.slotPatch)) patch[slot] = v;
          if (Object.keys(patch).length) await host.updateRow(patch);
          notify('warn', fmt('SHADOWBASE.Apps.Crafting.ComponentRuined', { name: ruin.ruinedName }));
        }
      }
      const materials = this.#materialsOf(hostRow, parts);
      const outcome = meta.outcome;
      if (job.mode === 'deconstruct') {
        const r = engine.salvageRecovery.applyDeconstruction(equipment, parts.map((p) => p.system.row.id), materials, outcome, meta.marginOfSuccess ?? 0, engine.rowId);
        equipment = r.equipment;
        const lost = parts.filter((p) => r.lostIds.includes(p.system.row.id)).map((p) => p.id);
        const kept = parts.filter((p) => r.keptIds.includes(p.system.row.id));
        if (lost.length) await actor.deleteEmbeddedDocuments('Item', lost);
        // Intact components come out of the host and back into inventory as loose rows.
        if (kept.length) await actor.updateEmbeddedDocuments('Item', kept.map((p) => ({ _id: p.id, 'system.row.isInstalled': false, 'system.row.equipped': false, ...Object.fromEntries(['installedInSaberId', 'installedInMeleeId', 'installedInBlasterId', 'installedInArmorId'].filter((k) => k in p.system.row).map((k) => [`system.row.${k}`, null])) })));
        notify(outcome === 'failure' ? 'warn' : 'info', fmt('SHADOWBASE.Apps.Crafting.Deconstructed', { name: text(hostRow?.name ?? hostRow?.customName), kept: kept.length, pounds: r.totalPounds }));
      } else {
        const r = engine.salvageRecovery.applyRecovery(equipment, materials, job.mode === 'disassemble' ? 'deconstruct' : 'salvage', outcome, engine.rowId, job.category);
        equipment = r.equipment;
        if (parts.length) await actor.deleteEmbeddedDocuments('Item', parts.map((p) => p.id));
        notify(outcome === 'failure' ? 'warn' : 'info', fmt('SHADOWBASE.Apps.Crafting.Salvaged', { name: text(hostRow?.name ?? hostRow?.customName), pounds: r.totalPounds, rate: Math.round(r.rate * 100) }));
      }
      // The host itself is always consumed - a teardown is not a disassembly you can undo.
      if (host && job.hostSource !== 'equipment') await actor.deleteEmbeddedDocuments('Item', [host.id]);
      else if (host) equipment = equipment.filter((e) => e?.id !== job.hostRowId);
      equipment = engine.blueprintFlow.applyBlueprintOutcome(equipment, meta, { of: text(hostRow?.name ?? hostRow?.customName) || 'Design', origin: 'original', constructionMarkup: null }, success);
    } else {
      equipment = engine.blueprintFlow.applyBlueprintOutcome(equipment, meta, { of: text(job.item?.name) || 'Design', origin: 'original', constructionMarkup: null }, success);
    }

    if (meta.crafterDamage > 0) {
      const stats = statsOf(actor);
      const next = engine.crafterDamage.applyCrafterDamage(actor.system?.currentHitPoints, stats?.currentValues?.hitPoints ?? 0, meta.crafterDamage);
      await actor.update({ 'system.currentHitPoints': next });
      notify('warn', fmt('SHADOWBASE.Apps.Crafting.CrafterHurt', { damage: meta.crafterDamage }));
    }
    await syncRows(actor, 'equipment', equipment);
    return equipment;
  }

  /** The part Items fitted into a host weapon / armor (isInstalled + installedIn*Id === host.rowId). */
  #partsOf(host) {
    if (!host) return [];
    const id = host.system?.row?.id;
    const sources = host.type === 'lightsaber' ? ['lightsaberModifications'] : host.type === 'armor' ? ['armorModifications'] : ['weaponModifications', 'ammunition'];
    return sources.flatMap((s) => rowsOf(this.actor, s)).filter((p) => { const r = p.system.row; return r.isInstalled && [r.installedInSaberId, r.installedInMeleeId, r.installedInBlasterId, r.installedInArmorId].includes(id); });
  }

  /** The recoverable material of a host: its own list, else its parts' (materialsFromParts over the material catalogs). */
  #materialsOf(hostRow, parts) {
    const own = Array.isArray(hostRow?.materials) ? hostRow.materials.filter((m) => m?.name && num(m.amount) > 0) : [];
    if (own.length) return own;
    const catalog = [...(engine.meleePartsData.MELEE_MATERIALS ?? []), ...(engine.lightsaberParts.LIGHTSABER_MATERIALS ?? []), ...(engine.armorPiecesData.ARMOR_MATERIALS ?? [])].map((m) => ({ id: m.id, name: m.name }));
    return engine.salvageRecovery.materialsFromParts(parts.map((p) => p.system.row), catalog);
  }

  // ---------------------------------------------------------------------------
  // The picker's two starts
  // ---------------------------------------------------------------------------

  /** Start a forge of a catalog design (planBlueprintBuild; equipment-section.tsx:700-766 handleBuildFromCard's checks). */
  async startDesign(designName = this.pick.designName, quantity = this.pick.quantity) {
    const design = engine.blueprintCatalog.craftableDesigns().find((d) => lower(d.name) === lower(designName));
    if (!design) { notify('warn', loc('SHADOWBASE.Apps.Crafting.PickDesign')); return null; }
    const plan = engine.blueprintBuild.planBlueprintBuild({ blueprintOf: design.name, blueprintFamily: design.family });
    if (plan.kind !== 'direct' || !plan.row) { notify('warn', fmt('SHADOWBASE.Apps.Crafting.DesignerRoute', { name: design.name, where: plan.where ?? '' })); return null; }
    const need = plan.row.materials ?? [];
    const stock = storedRows(this.actor, 'equipment').filter((e) => e?.category === 'Raw Materials');
    const units = Math.max(1, Math.floor(num(quantity, 1)));
    const missing = need.filter((m) => num(stock.find((s) => s?.name === m.name)?.quantity) < num(m.amount) * units);
    if (missing.length) { notify('error', fmt('SHADOWBASE.Apps.Crafting.InsufficientMaterials', { name: plan.of, list: missing.map((m) => `${m.amount * units} ${m.name}`).join(', ') })); return null; }
    this.configure({ item: { ...plan.row, quantity: units }, category: plan.family ?? design.family, mode: 'forge' });
    this.job.plan = plan;
    this.job.quantity = units;
    await this.#rerender();
    return this.job;
  }

  /** Start a teardown of an owned item (fabrication.tsx: deconstruct / salvage; a saber's disassemble). */
  async startTeardown(itemId = this.pick.itemId, mode = this.pick.mode) {
    const item = this.actor.items.get(itemId);
    if (!item) { notify('warn', loc('SHADOWBASE.Apps.Crafting.PickItem')); return null; }
    const row = rowWithDerived(item);
    const source = item.system.source;
    const category = source === 'customBlasters' ? 'Blasters' : source === 'customMeleeWeapons' ? 'Melee Weapons' : source === 'lightsabers' ? 'Lightsaber Forge' : source === 'armor' ? (engine.armorCraftingFamily.armorCraftingFamily(row) ?? 'Armor') : (engine.equipmentCraftingFamily.equipmentCraftingFamily(row) ?? row.category ?? '');
    const useMode = CRAFTING_MODES.includes(mode) ? mode : 'deconstruct';
    this.configure({ item: { ...row, name: item.displayName ?? item.name }, category, mode: useMode === 'disassemble' && source !== 'lightsabers' ? 'deconstruct' : useMode });
    this.job.hostRowId = row.id;
    this.job.hostSource = source;
    await this.#rerender();
    return this.job;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  static async onRollStage(event) { event?.preventDefault?.(); return this.rollStage(); }
  static async onFinalize(event) { event?.preventDefault?.(); return this.finalize(); }
  /** :1632 - no aborting a run that already failed; the consequences apply on Confirm Result. */
  static async onAbort(event) {
    event?.preventDefault?.();
    if (this.run.failed) { notify('warn', loc('SHADOWBASE.Apps.Crafting.CannotAbort')); return false; }
    this.job = null; this.run = freshRun();
    await this.render();
    return true;
  }
  static async onStartDesign(event) { event?.preventDefault?.(); return this.startDesign(); }
  static async onStartTeardown(event) { event?.preventDefault?.(); return this.startTeardown(); }
}

export default CraftingApp;
