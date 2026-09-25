// module/apps/item-sheets/equipment.mjs
//
// General Equipment (equipment-section.tsx EquipmentItemCard :1080-1300):
// name, category, quantity, weight (typed only where weight-editability.ts
// says so; the Weightless switch), cost, condition, the skill it rolls, a
// currency row's Stored Value / denomination (Credit Chips and Aurodium,
// character-inventory.tsx), a power cell's charges, the modifier bag as
// badges, and the Blueprint (Ch10) / firmware datacard panels
// (blueprints.ts blueprintDescription, blueprint-build.ts blueprintBuildSummary,
// function-firmware.ts). The build / copy / brick ROLLS are the CraftingApp's
// (U09); the panel states the card's facts.

import { engine } from '../../engine.mjs';
import { modifierBadges } from '../actor-sheet-tabs.mjs';
import { ShadowBaseItemSheet, loc, text, num, money, fig } from './base.mjs';

const TAB_IDS = ['main', 'notes'];
const CONDITIONS = () => engine.inventorySchemas.EQUIPMENT_CONDITION ?? ['Fine', 'Damaged', 'Broken', 'Destroyed'];

export class EquipmentSheet extends ShadowBaseItemSheet {
  static FAMILY = 'equipment';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('equipment', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const row = context.row;
    const qty = num(row.quantity, 1) || 1;
    const isCurrency = row.category === 'Currencies';
    const isChip = isCurrency && row.storedValue !== undefined && row.storedValue !== null;
    const isAurodium = isCurrency && row.denominationValue !== undefined && row.denominationValue !== null;
    const isBlueprint = engine.blueprints.isBlueprint(row);
    const isFirmware = engine.functionFirmware.isFirmwareCard(row);
    const categories = [...new Set(engine.equipmentData.equipmentData.map((r) => r.category))].sort();
    const category = text(row.category);
    if (category && !categories.includes(category)) categories.push(category);
    const catalog = engine.equipmentData.equipmentData.find((r) => r.name === row.name) ?? null;
    const weightSource = engine.weightEditability.equipmentWeightSource(row);
    const hasCharges = row.currentCharges !== undefined && row.currentCharges !== null || row.maxCharges !== undefined && row.maxCharges !== null;
    const blueprint = isBlueprint ? {
      of: text(row.blueprintOf),
      generation: num(row.blueprintGeneration),
      proven: row.blueprintProven !== false,
      locked: !!row.blueprintLocked,
      flawed: !!row.blueprintFlawed,
      bricked: !!row.blueprintBricked || engine.blueprintFlow.isBrickedBlueprint(row),
      origin: text(row.blueprintOrigin) || 'catalog',
      markup: num(row.blueprintMarkup),
      family: text(row.blueprintFamily),
      parts: Array.isArray(row.blueprintParts) ? row.blueprintParts.length : 0,
      description: text(engine.blueprints.blueprintDescription({ generation: num(row.blueprintGeneration), proven: row.blueprintProven !== false, locked: !!row.blueprintLocked, origin: text(row.blueprintOrigin) || 'catalog' })),
      buildSummary: text(engine.blueprintBuild.blueprintBuildSummary(row)),
      buildBonus: engine.blueprints.blueprintBuildBonus(num(row.blueprintGeneration), row.blueprintProven !== false),
    } : null;
    const firmware = isFirmware ? {
      generation: num(row.firmwareGeneration),
      encoded: !!row.firmwareEncoded,
      fee: money(row.firmwareFee),
      band: text(engine.functionFirmware.bandForFee?.(num(row.firmwareFee))?.label ?? engine.functionFirmware.bandForFee?.(num(row.firmwareFee))?.name),
    } : null;
    context.main = {
      categories: categories.map((c) => ({ value: c, label: c, selected: c === category })),
      subCategory: text(row.subCategory),
      quantity: qty,
      weight: row.weight ?? null,
      weightEditable: engine.weightEditability.isWeightEditable(weightSource),
      weightSource: text(engine.weightEditability.describeWeightSource(weightSource)),
      weightless: !!row.weightless,
      totalWeight: fig(num(row.weight) * qty),
      cost: row.cost ?? null,
      totalCost: money(num(row.cost) * qty),
      conditions: CONDITIONS().map((c) => ({ value: c, label: loc(`SHADOWBASE.Item.Condition.${c}`), selected: (text(row.condition) || 'Fine') === c })),
      isUtility: !!engine.utilityCondition.isUtilityDevice?.(row),
      skill: text(row.skill),
      dr: row.dr ?? null,
      damage: text(row.damage),
      modifier: text(row.modifier),
      isCurrency, isChip, isAurodium,
      storedValue: row.storedValue ?? null,
      denominationValue: row.denominationValue ?? null,
      currencyTotal: isChip ? money(num(row.storedValue) * qty) : isAurodium ? money(num(row.denominationValue) * qty) : '',
      hasCharges,
      currentCharges: row.currentCharges ?? null,
      maxCharges: row.maxCharges ?? null,
      modifiers: modifierBadges(row.modifiers ?? null),
      hasBag: engine.hasAnyModifier(row.modifiers ?? engine.NO_MODIFIERS),
      inCatalog: !!catalog,
      catalogDescription: text(catalog?.description),
      isBlueprint, blueprint,
      isFirmware, firmware,
      installed: !!row.isInstalled,
      flawed: row.flawedBuild === true,
    };
    return context;
  }
}

export default EquipmentSheet;
