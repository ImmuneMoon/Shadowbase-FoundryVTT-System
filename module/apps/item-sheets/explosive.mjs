// module/apps/item-sheets/explosive.mjs
//
// Explosive (customized-explosive-item.tsx): the base explosive is a catalog
// pick (ALL_EXPLOSIVES_DATA by name - the select at :188-200) whose figures
// ride onto the row (type, baseSkill, finalDamageEffect, finalWeight,
// finalCost, finalLegalityClass); quantity; the default attribute the throw
// falls back to (DX / IQ, :309-315); the throw target through the Ch3 ladder
// (module/rolls.mjs skillTargetFor over the row's baseSkill, :112-118) and the
// blast damage line.

import { engine } from '../../engine.mjs';
import { ShadowBaseItemSheet, loc, notify, text, num } from './base.mjs';

const TAB_IDS = ['main', 'notes'];

export class ExplosiveSheet extends ShadowBaseItemSheet {
  static FAMILY = 'explosive';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('explosive', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    actions: { 'roll-throw': ExplosiveSheet.#onRollThrow, 'roll-explosive-damage': ExplosiveSheet.#onRollExplosiveDamage },
  };

  /** The catalog entry for a base explosive name. */
  static catalogEntry(name) { return engine.explosiveData.ALL_EXPLOSIVES_DATA.find((e) => e.name === name) ?? null; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const row = context.row;
    const actor = this.actor;
    const rolls = globalThis.game?.shadowbase?.rolls;
    const base = ExplosiveSheet.catalogEntry(text(row.baseExplosiveName));
    const skill = text(row.baseSkill || base?.baseSkill);
    const target = actor && skill && rolls?.skillTargetFor ? rolls.skillTargetFor(actor, skill) : null;
    const damage = text(row.finalDamageEffect || base?.damageEffect);
    const attr = text(row.preferredDefaultAttr) || 'IQ';
    context.main = {
      options: engine.explosiveData.ALL_EXPLOSIVES_DATA.map((e) => ({ value: e.name, label: `${e.name} (${e.type})`, selected: e.name === row.baseExplosiveName })),
      inCatalog: !!base,
      type: text(row.type || base?.type),
      isGrenade: (row.type || base?.type) === 'Grenade',
      skill,
      damage,
      legality: text(row.finalLegalityClass ?? base?.legalityClass),
      catalogNotes: text(base?.notes),
      quantity: num(row.quantity, 1) || 1,
      attrOptions: ['DX', 'IQ'].map((a) => ({ value: a, label: a, selected: a === attr })),
      target: target?.target ?? null,
      describe: text(target?.describe),
      canThrow: !!actor && target?.target != null,
      canDamage: !!actor && !!damage,
    };
    return context;
  }

  /** `system.row.baseExplosiveName` is the header's select; a change copies the catalog figures (:188-200 onValueChange). */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const next = submitData.system?.row?.baseExplosiveName;
    if (next !== undefined && next !== this.item.system?.row?.baseExplosiveName) {
      const base = ExplosiveSheet.catalogEntry(text(next));
      if (base) this._mergeRow(submitData, { type: base.type, baseSkill: base.baseSkill, finalDamageEffect: base.damageEffect, finalWeight: num(base.weight), finalCost: num(base.cost), finalLegalityClass: text(base.legalityClass) });
    }
    return after;
  }

  static async #onRollThrow() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    const skill = text(this.item.system?.row?.baseSkill);
    if (!this.actor || !rolls?.rollSkill || !skill) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.rollSkill(this.actor, skill);
  }
  static async #onRollExplosiveDamage() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    const row = this.item.system?.row ?? {};
    const formula = text(row.finalDamageEffect || ExplosiveSheet.catalogEntry(text(row.baseExplosiveName))?.damageEffect);
    if (!this.actor || !rolls?.rollDamage || !formula) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.rollDamage(this.actor, { label: this.item.displayName ?? this.item.name, formula });
  }
}

export default ExplosiveSheet;
