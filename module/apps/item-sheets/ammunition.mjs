// module/apps/item-sheets/ammunition.mjs
//
// Ammunition (ammunition-and-modifications-section.tsx:280-330): type
// (AMMUNITION_TYPES), the Blaster Gas Grade of a Power Pack (:306, GAS_GRADES;
// its Malf and damage effect read through blasterGasGrades.gasGradeEffect),
// charges, the full and casing figures with the depleted readouts
// (ammunition-depletion.ts: weight and cost of a part-empty magazine), a
// magazine's contents, and the blaster it is loaded in.

import { engine } from '../../engine.mjs';
import { ShadowBaseItemSheet, loc, text, num, fig, money } from './base.mjs';

const TAB_IDS = ['main', 'notes'];

export class AmmunitionSheet extends ShadowBaseItemSheet {
  static FAMILY = 'ammunition';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('ammunition', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    actions: { 'unload-round': AmmunitionSheet.#onUnloadRound },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const row = context.row;
    const types = engine.inventorySchemas.AMMUNITION_TYPES ?? [];
    const type = text(row.type);
    const isPowerPack = type === 'Power Packs' || type === 'Power Cell';
    const grade = engine.blasterGasGrades.getGasGrade(row.gasGrade);
    const contents = Array.isArray(row.contents) ? row.contents : [];
    const catalog = engine.ammunitionData.AMMUNITION_DATA.find((a) => a.name === engine.ammunitionCrafting.baseRoundName(text(row.name))) ?? null;
    context.main = {
      types: [...types, ...(type && !types.includes(type) ? [type] : [])].map((t) => ({ value: t, label: t, selected: t === type })),
      isPowerPack,
      gasGrades: [{ value: '', label: loc('SHADOWBASE.Item.Ammo.StandardGas'), selected: !row.gasGrade }, ...engine.blasterGasGrades.GAS_GRADES.map((g) => ({ value: g.id, label: `${g.label} (${g.boltColor})`, selected: g.id === row.gasGrade }))],
      grade: grade ? { label: text(grade.label), effect: text(grade.effect), malfMod: num(grade.malfMod), color: text(grade.boltHex), legality: text(grade.legalityClass) } : null,
      currentCharges: row.currentCharges ?? null,
      maxCharges: row.maxCharges ?? null,
      chargeRatio: Math.round(engine.ammunitionDepletion.chargeRatio(row) * 100),
      depletedCost: money(engine.ammunitionDepletion.depletedCost(row)),
      depletedWeight: fig(engine.ammunitionDepletion.depletedWeight(row)),
      baseCost: row.baseCost ?? null,
      baseWeight: row.baseWeight ?? null,
      weightEditable: engine.weightEditability.isWeightEditable(engine.weightEditability.ammunitionWeightSource(row)),
      quantity: num(row.quantity, 1) || 1,
      formula: text(row.formula),
      damageTypeOverride: text(row.damageTypeOverride),
      isContainer: !!row.isContainer,
      containerType: text(row.containerType),
      contents: contents.map((c, i) => ({ index: i, name: text(c?.name), formula: text(c?.formula) })),
      contentsCount: contents.length,
      inCatalog: !!catalog,
      catalogNotes: text(catalog?.notes),
      isLibraryItem: !!row.isLibraryItem,
    };
    return context;
  }

  /** Take the top round out of a magazine (BlasterAmmunition.tsx:268-286 handleUnloadTopRound, on the pack itself). */
  static async #onUnloadRound() {
    const row = this.item.system?.row ?? {};
    const contents = Array.isArray(row.contents) ? [...row.contents] : [];
    if (!contents.length) return;
    contents.pop();
    return this.item.updateRow({ contents, currentCharges: contents.length });
  }
}

export default AmmunitionSheet;
