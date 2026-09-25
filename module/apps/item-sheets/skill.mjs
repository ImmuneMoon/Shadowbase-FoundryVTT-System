// module/apps/item-sheets/skill.mjs
//
// Skill (skills-section.tsx:218-262 Skill Name / Relative Level / Level + roll /
// Points (Calculated); Gear Bonuses :337; notes :383). The level is a STRING on
// the website's row (the engine parseInts it), so its input carries no dtype;
// the cost is calculateCostForSkill against the owner's skillPricingAttributes
// (never the gear-inclusive set, skills-section.tsx:153-162); the roll target
// is the HUD's resolveSkillLevel through module/rolls.mjs skillTargetFor.

import { engine } from '../../engine.mjs';
import { ShadowBaseItemSheet, loc, notify, text, num, signed } from './base.mjs';

const TAB_IDS = ['main', 'notes'];

export class SkillSheet extends ShadowBaseItemSheet {
  static FAMILY = 'skill';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('skill', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    actions: { 'roll-skill': SkillSheet.#onRollSkill },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const row = context.row;
    const actor = this.actor;
    const stats = actor?.stats ?? null;
    const name = text(row.name);
    const split = name ? engine.skillDefaults.splitSpecialty(name) : { base: '', specialty: null };
    const library = name ? engine.skills.findLibrarySkill(name) ?? null : null;
    const cost = stats ? num(engine.calculateCostForSkill({ name, level: row.level, relativeLevel: row.relativeLevel }, stats.skillPricingAttributes)) : 0;
    const baseline = num(row.baselinePoints);
    const gear = stats ? engine.skillBonuses.skillBonusFor(stats.skillBonuses, name) : { flat: 0, situational: [] };
    const rolls = globalThis.game?.shadowbase?.rolls;
    const target = actor && rolls?.skillTargetFor ? rolls.skillTargetFor(actor, name) : null;
    context.main = {
      base: split.base,
      specialty: text(split.specialty),
      inLibrary: !!library,
      libraryNotes: text(library?.notes),
      libraryRelativeLevel: text(library?.relativeLevel),
      relativeLevel: text(row.relativeLevel),
      level: text(row.level),
      points: num(row.points),
      baselinePoints: baseline,
      cost,
      effective: Math.max(0, cost - baseline),
      hasStats: !!stats,
      gearFlat: num(gear.flat),
      gearFlatText: signed(num(gear.flat)),
      gearSituational: (gear.situational ?? []).map((s) => (typeof s === 'string' ? s : `${signed(num(s.bonus ?? s.value))} ${text(s.condition ?? s.label ?? '')}`.trim())),
      target: target?.target ?? null,
      describe: text(target?.describe),
      bareSpecialtyWarning: text(engine.specialtyRequired.bareSpecialtyWarning(name)),
      requiresSpecialty: !!engine.specialtyRequired.requiresSpecialty?.(name),
    };
    return context;
  }

  static async #onRollSkill() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!this.actor || !rolls?.rollSkill) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.rollSkill(this.actor, text(this.item.system?.row?.name));
  }
}

export default SkillSheet;
