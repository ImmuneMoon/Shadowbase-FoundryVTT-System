// module/apps/item-sheets/power.mjs
//
// Force Power / Combat Technique / Lightsaber Form (force-powers-section.tsx
// :180-262, combat-techniques-section.tsx, lightsaber-forms-section.tsx). The
// level select re-reads the catalog by NAME + level (a compendium Item carries
// the catalog's rows for its name in system.levels; a hand-made one falls back
// to the bundle's catalog): the base class's `level` edit runs
// levelChangePatch, the port of handleLevelSelection / handleLevelChange /
// handleTechniqueChange. Costs: forceFpCost.calculateAdjustedFPCost through
// module/rolls.mjs forcePowerCostsFor (the alignment-adjusted FP), a
// technique's own epCost / fpCost; the Form's applies / conditional read from
// lightsaberForms.getFormDetails. Custom rows (customTiers) edit one effect per
// tier.

import { engine } from '../../engine.mjs';
import { rowsOf } from '../../adapter.mjs';
import { ShadowBaseItemSheet, loc, fmt, notify, text, num, signed } from './base.mjs';

const TAB_IDS = ['main', 'notes'];
const TECHNIQUE_CATEGORIES = Object.freeze(['Universal', 'Melee', 'Unarmed', 'Ranged']);
const ALIGNMENTS = Object.freeze(['LS', 'DS', 'Grey']);

export class PowerSheet extends ShadowBaseItemSheet {
  static FAMILY = 'power';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('power', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    actions: {
      'roll-power': PowerSheet.#onRollPower,
      'apply-power-costs': PowerSheet.#onApplyPowerCosts,
      'roll-technique': PowerSheet.#onRollTechnique,
      'apply-technique-costs': PowerSheet.#onApplyTechniqueCosts,
      'toggle-active-form': PowerSheet.#onToggleActiveForm,
    },
  };

  /** The catalog rows for this name: the compendium Item's own `levels`, else the bundle catalog by name. */
  catalogRows() {
    const item = this.item;
    const own = Array.isArray(item.system?.levels) && item.system.levels.length ? item.system.levels : null;
    if (own) return own;
    const name = text(item.system?.row?.name);
    if (!name) return [];
    if (item.type === 'forcePower') return engine.forcePowers.forcePowersData.filter((p) => p.name === name);
    if (item.type === 'combatTechnique') return engine.techniques.allCombatTechniques.filter((t) => t.name === name);
    const form = engine.lightsaberForms.lightsaberForms.find((f) => f.name === name);
    return form ? form.levels.map((l) => ({ ...l, name: form.name, baseSkill: form.baseSkill, description: form.description })) : [];
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const row = context.row;
    const actor = this.actor;
    const rolls = globalThis.game?.shadowbase?.rolls;
    const type = item.type;
    const name = text(row.name);
    const catalog = this.catalogRows();
    const isCustom = !!row.custom;
    // force-powers-section.tsx:118-121: catalog levels, else 1-4 for a custom (or unknown) row; forms always 1-4.
    const available = type === 'lightsaberForm' || isCustom || (name && catalog.length === 0) ? [1, 2, 3, 4] : catalog.map((p) => p.level);
    const level = num(row.level, 0) || null;
    const selected = catalog.find((p) => p.level === level) ?? null;
    const cp = num(row.cpCost ?? selected?.cpCost);
    const baseline = num(row.baselinePoints);
    const main = {
      isPower: type === 'forcePower',
      isTechnique: type === 'combatTechnique',
      isForm: type === 'lightsaberForm',
      isCustom,
      inCatalog: catalog.length > 0,
      level,
      levels: available.map((l) => ({ value: l, label: type === 'combatTechnique' ? `${loc('SHADOWBASE.Item.Power.Tier')} ${l}` : `${loc('SHADOWBASE.Item.Power.Level')} ${l}`, selected: l === level })),
      tier: text(row.characterTier ?? selected?.characterTier ?? engine.customTiers.CUSTOM_TIER_NAMES?.[level]),
      category: text(row.category ?? selected?.category),
      baseSkill: text(row.baseSkill ?? selected?.baseSkill),
      requirements: text(row.requirements ?? selected?.requirements),
      cpCost: cp,
      baselinePoints: baseline,
      effective: Math.max(0, cp - baseline),
      epCost: num(row.epCost ?? selected?.epCost),
      fpCost: num(row.fpCost ?? selected?.fpCost),
      effect: text(row.effect ?? selected?.effect),
      description: text(row.description ?? selected?.description),
      confirmed: row.confirmed !== false,
      tierEffects: isCustom ? [1, 2, 3, 4].map((l) => ({ level: l, name: engine.customTiers.CUSTOM_TIER_NAMES?.[l] ?? String(l), effect: engine.customTiers.effectForTier(row.tierEffects, l) })) : [],
    };
    if (type === 'forcePower') {
      const costs = actor && rolls?.forcePowerCostsFor ? rolls.forcePowerCostsFor(actor, item) : null;
      const target = actor && rolls?.forcePowerTargetFor ? rolls.forcePowerTargetFor(actor, item) : null;
      Object.assign(main, {
        alignment: text(row.alignment ?? selected?.alignment),
        alignments: ALIGNMENTS.map((a) => ({ value: a, label: loc(`SHADOWBASE.Item.Power.Alignment.${a}`), selected: (row.alignment ?? selected?.alignment) === a })),
        adjustedFp: costs ? num(costs.fp) : null,
        adjustedEp: costs ? num(costs.ep) : null,
        target: target?.level ?? null,
        targetSkill: text(target?.name),
        describe: text(target?.describe),
        gate: actor ? text(engine.learningGates.powerGateWarning(row, actor.sheetData?.advantages ?? [])) : '',
      });
    }
    if (type === 'combatTechnique') {
      const readied = actor && rolls?.equippedWeapons ? rolls.equippedWeapons(actor) : [];
      const weaponItem = readied.find((w) => w.system?.row?.id === row.selectedWeaponId) ?? null;
      const target = actor && rolls?.techniqueTargetFor ? rolls.techniqueTargetFor(actor, item, { weaponItem }) : null;
      const category = text(row.category) || 'Universal';
      Object.assign(main, {
        category,
        categories: TECHNIQUE_CATEGORIES.map((c) => ({ value: c, label: loc(`SHADOWBASE.Sheet.Abilities.Technique.${c}`), selected: c === category })),
        isUnarmed: category === 'Unarmed',
        damageBonus: text(row.damageBonus),
        skillBonus: num(row.skillBonus),
        skillPenalty: num(row.skillPenalty),
        selectedWeaponId: text(row.selectedWeaponId),
        weapons: [{ value: '', label: loc('SHADOWBASE.Sheet.Abilities.SelectWeapon'), selected: !row.selectedWeaponId }, ...readied.map((w) => ({ value: text(w.system?.row?.id), label: w.displayName ?? w.name, selected: w.system?.row?.id === row.selectedWeaponId }))],
        target: target?.target ?? null,
        targetSkill: text(target?.skillName),
      });
    }
    if (type === 'lightsaberForm') {
      const details = name && level ? engine.lightsaberForms.getFormDetails(name, level) : null;
      const isActive = !!actor && !!name && actor.system?.activeLightsaberForm === name;
      const effect = level ? engine.lightsaberForms.activeFormEffect(name, level) : engine.lightsaberForms.NO_FORM_EFFECT;
      Object.assign(main, {
        forms: engine.lightsaberForms.lightsaberForms.map((f) => ({ value: f.name, label: f.name, selected: f.name === name })),
        applies: Object.entries(details?.applies ?? {}).map(([k, v]) => ({ label: loc(`SHADOWBASE.Item.Power.Applies.${k}`), value: signed(num(v)) })),
        // lightsaber-forms.ts conditional: { target, value, when } ("+1 attack against any opponent who parries your attack").
        conditional: (details?.conditional ?? []).map((c) => (typeof c === 'string' ? c : `${signed(num(c.value))} ${loc(`SHADOWBASE.Item.Power.Applies.${text(c.target)}`)} ${text(c.when)}`.trim())),
        bonuses: { attack: num(effect.attack), parry: num(effect.parry), dodge: num(effect.dodge), block: num(effect.block), basicMove: num(effect.basicMove) },
        isActive,
        cpCost: num(details?.cpCost ?? row.cpCost),
        effective: Math.max(0, num(details?.cpCost ?? row.cpCost) - baseline),
        tier: text(details?.characterTier ?? row.characterTier),
        effect: text(row.effect ?? details?.effect),
        gate: actor ? text(engine.learningGates.formGateWarning(actor.sheetData ?? {})) : '',
      });
    }
    context.main = main;
    return context;
  }

  /** Custom tiers: `tier.<n>` textareas write the row's tierEffects through customTiers.setTierEffect. */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    let tiers = null;
    for (const [key, value] of Object.entries(edits)) {
      const m = /^tier\.(\d)$/.exec(key);
      if (!m) continue;
      tiers = engine.customTiers.setTierEffect(tiers ?? (this.item.system?.row?.tierEffects ?? []), Number(m[1]), text(value));
    }
    if (tiers) {
      const level = num(submitData.system?.row?.level ?? this.item.system?.row?.level, 0);
      this._mergeRow(submitData, { tierEffects: tiers, effect: engine.customTiers.effectForTier(tiers, level) });
    }
    return after;
  }

  static async #onRollPower() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!this.actor || !rolls?.rollForcePower) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.rollForcePower(this.actor, this.item);
  }
  static async #onApplyPowerCosts() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!this.actor || !rolls?.applyForcePowerCosts) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.applyForcePowerCosts(this.actor, this.item);
  }
  static async #onRollTechnique() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!this.actor || !rolls?.rollTechnique) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    const weaponItem = this.actor.items.find((i) => i.system?.row?.id === this.item.system?.row?.selectedWeaponId) ?? null;
    return rolls.rollTechnique(this.actor, this.item, { weaponItem });
  }
  static async #onApplyTechniqueCosts() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!this.actor || !rolls?.applyTechniqueCosts) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.applyTechniqueCosts(this.actor, this.item);
  }
  /** Activate / deactivate the Form (lightsaber-forms-section.tsx:67-69). */
  static async #onToggleActiveForm() {
    const actor = this.actor;
    if (!actor) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    const name = text(this.item.system?.row?.name) || null;
    const isActive = !!name && actor.system?.activeLightsaberForm === name;
    await actor.update({ 'system.activeLightsaberForm': isActive ? null : name });
    notify('info', fmt(isActive ? 'SHADOWBASE.Item.Power.FormDeactivated' : 'SHADOWBASE.Item.Power.FormActivated', { name }));
    // The known forms on the sheet all show the active state; rowsOf keeps the actor's order.
    return rowsOf(actor, 'lightsaberForms').length;
  }
}

export default PowerSheet;
