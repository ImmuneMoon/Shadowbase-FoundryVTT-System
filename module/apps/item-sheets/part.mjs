// module/apps/item-sheets/part.mjs
//
// Weapon part / lightsaber part / armor part (ammunition-and-modifications-
// section.tsx: Melee & Ranged Structural Components, Customization Mods,
// Lightsaber Parts, Armor Structural Components and Mods): the row's identity
// (family, category, the catalog template it was milled from, its material,
// a sleeve's wrap), its shelf figures, its effect text, the host it sits in
// and its fracture / condition state. A material change on a milled Ch11 /
// Ch12 / Ch13 part re-prices the row through partAcquisition.pricePart (the
// parts shop's own arithmetic - never restated); a wrap applied to an owned
// sleeve goes through lightsaberAssembly.planWrapApplication.

import { engine } from '../../engine.mjs';
import { WEAPON_PART_FAMILIES } from '../../config.mjs';
import { ShadowBaseItemSheet, loc, fmt, notify, text, num, fig, money } from './base.mjs';
import * as B from './builders.mjs';

const TAB_IDS = ['main', 'notes'];
const CONDITIONS = () => engine.inventorySchemas.EQUIPMENT_CONDITION ?? ['Fine', 'Damaged', 'Broken', 'Destroyed'];

/** The parts-shop family a category belongs to (part-acquisition.ts PartFamily), or null for a finished good. */
function shopFamily(type, category) {
  const c = text(category);
  if (type === 'armorPart') return c.startsWith('Armor ') ? 'armor' : null;
  if (/^Ranged |^Power Unit$/.test(c)) return 'ranged';
  if (/^Melee /.test(c)) return 'melee';
  return null;
}

/** Every catalog template that carries a category (the partId select's options). */
function catalogFor(type, family, category) {
  const c = text(category);
  if (type === 'armorPart') {
    if (c.startsWith('Armor ')) return engine.armorPartsData.armorPartsFor(c, null);
    return engine.armorMods.ARMOR_MOD_DATA.filter((m) => m.category === c).map((m, i) => ({ id: m.name, name: m.name }));
  }
  if (family === 'lightsaber') {
    if (/ Part$/.test(c)) return engine.lightsaberAssembly.hiltPartsFor(c);
    return engine.fittedGoods.lightsaberInternalsCatalog(c);
  }
  if (/^Ranged |^Power Unit$/.test(c)) return engine.rangedAssembly.rangedPartsFor(c, null);
  if (/^Melee /.test(c)) return engine.meleeAssembly.meleePartsFor(c);
  return engine.weaponModData.WEAPON_MOD_DATA.filter((m) => m.category === c).map((m) => ({ id: m.name, name: m.name }));
}

export class PartSheet extends ShadowBaseItemSheet {
  static FAMILY = 'part';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('part', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const row = context.row;
    const isArmor = item.type === 'armorPart';
    const family = isArmor ? 'armor' : (item.system?.family ?? 'weapon');
    const categories = isArmor ? engine.inventorySchemas.ARMOR_MOD_CATEGORIES : family === 'lightsaber' ? engine.inventorySchemas.LIGHTSABER_MOD_CATEGORIES : engine.inventorySchemas.WEAPON_MOD_CATEGORIES;
    const category = text(row.category);
    const catalog = catalogFor(item.type, family, category);
    const template = catalog.find((t) => text(t.id) === text(row.partId)) ?? catalog.find((t) => t.name === row.name) ?? null;
    const shop = shopFamily(item.type, category);
    const materials = shop ? engine.partAcquisition.materialsFor(shop) : family === 'lightsaber' && / Part$/.test(category) ? engine.lightsaberParts.LIGHTSABER_MATERIALS : [];
    const takesMaterial = materials.length > 0 && (template ? template.volume != null : row.materialId != null);
    const isSleeve = family === 'lightsaber' && category === engine.lightsaberAssembly.WRAPPABLE_HILT_CATEGORY;
    const priced = shop && row.partId ? engine.partAcquisition.pricePart(shop, row.partId, row.materialId) : null;
    context.main = {
      isArmor,
      isWeaponPart: item.type === 'weaponPart',
      family,
      families: Object.keys(WEAPON_PART_FAMILIES).map((f) => ({ value: f, label: loc(`SHADOWBASE.Item.Part.Family.${f}`), selected: f === family })),
      categories: [...categories, ...(category && !categories.includes(category) ? [category] : [])].map((c) => ({ value: c, label: c, selected: c === category })),
      templates: [{ value: '', label: loc('SHADOWBASE.Item.Part.NoTemplate'), selected: !row.partId }, ...catalog.map((t) => ({ value: text(t.id), label: text(t.name), selected: text(t.id) === text(row.partId) }))],
      inCatalog: !!template,
      templateNotes: text(template?.notes ?? template?.effect ?? template?.gurpsEffect),
      takesMaterial,
      materials: [{ value: '', label: loc('SHADOWBASE.Item.Slot.ChooseMaterial'), selected: !row.materialId }, ...materials.map((m) => ({ value: text(m.id), label: `${m.name} (${money(m.costPerLb)} CR/lb)`, selected: text(m.id) === text(row.materialId) }))],
      materialName: text(materials.find((m) => text(m.id) === text(row.materialId))?.name),
      isSleeve,
      wraps: isSleeve ? [{ value: '', label: loc('SHADOWBASE.Item.Slot.NoWrap'), selected: !row.wrapId }, ...engine.lightsaberParts.LIGHTSABER_WRAPS.map((w) => ({ value: text(w.id), label: `${w.name} (${money(w.costPerLb)} CR/lb)`, selected: text(w.id) === text(row.wrapId) }))] : [],
      priced: priced ? { cost: money(priced.cost), weight: fig(priced.weight), value: priced.value === null ? '' : money(priced.value), priced: !!priced.priced } : null,
      cost: row.cost ?? null,
      weight: row.weight ?? null,
      quantity: num(row.quantity, 1) || 1,
      volume: row.volume ?? null,
      density: row.density ?? null,
      durMod: row.durMod ?? null,
      componentClass: text(row.componentClass),
      energyResBonus: row.energyResBonus ?? null,
      isFractured: !!row.isFractured,
      drBonus: row.drBonus ?? null,
      validSlots: Array.isArray(row.validSlots) ? row.validSlots.map(text) : [],
      conditions: CONDITIONS().map((c) => ({ value: c, label: loc(`SHADOWBASE.Item.Condition.${c}`), selected: (text(row.condition) || 'Fine') === c })),
      installed: !!row.isInstalled,
      equipped: !!row.equipped,
      host: this._hostOf(row),
      effect: text(row.effect ?? row.notes),
      materials: (Array.isArray(row.materials) ? row.materials : []).map((m) => `${text(m.name)} ${fig(m.amount)} lb`),
      materialOptions: undefined,
    };
    // `materials` above is the raw-materials list; the select is `materialOptions`.
    context.main.materialOptions = [{ value: '', label: loc('SHADOWBASE.Item.Slot.ChooseMaterial'), selected: !row.materialId }, ...materials.map((m) => ({ value: text(m.id), label: `${m.name} (${money(m.costPerLb)} CR/lb)`, selected: text(m.id) === text(row.materialId) }))];
    return context;
  }

  /** Edits: `template` (partId), `material` (re-mill: pricePart re-prices), `wrap` (planWrapApplication). */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const item = this.item;
    const row = item.system?.row ?? {};
    const next = { ...row, ...(submitData.system?.row ?? {}) };
    const patch = {};
    if ('template' in edits && text(edits.template) !== text(row.partId)) {
      patch.partId = text(edits.template) || null;
      next.partId = patch.partId;
      const tpl = catalogFor(item.type, item.type === 'armorPart' ? 'armor' : (submitData.system?.family ?? item.system?.family ?? 'weapon'), next.category).find((t) => text(t.id) === patch.partId);
      if (tpl) { patch.name = text(tpl.name); if (tpl.volume != null) patch.volume = tpl.volume; if (tpl.durMod != null) patch.durMod = tpl.durMod; if (tpl.componentClass) patch.componentClass = tpl.componentClass; }
    }
    if ('material' in edits && text(edits.material) !== text(row.materialId)) { patch.materialId = text(edits.material) || null; next.materialId = patch.materialId; }
    if ('material' in edits || 'template' in edits) {
      const shop = shopFamily(item.type, next.category);
      const priced = shop && next.partId ? engine.partAcquisition.pricePart(shop, next.partId, next.materialId) : null;
      if (priced?.priced) { patch.cost = num(priced.cost); patch.weight = num(priced.weight); patch.name = text(priced.name); if (priced.materialId) patch.materialId = priced.materialId; }
    }
    if ('wrap' in edits && text(edits.wrap) !== text(row.wrapId)) {
      const plan = engine.lightsaberAssembly.planWrapApplication(next, text(edits.wrap) || null);
      if (typeof plan === 'string') notify('warn', plan);
      else if (plan?.rowPatch) Object.assign(patch, plan.rowPatch);
      else if (!edits.wrap) patch.wrapId = null;
    }
    if (Object.keys(patch).length) this._mergeRow(submitData, patch);
    return after;
  }
}

export default PartSheet;
