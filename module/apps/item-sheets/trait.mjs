// module/apps/item-sheets/trait.mjs
//
// Advantage / Disadvantage / Quirk (advantages-section.tsx:125-222,
// disadvantages-section.tsx, quirks-section.tsx): the library entry the row
// names, the level ladder (points ride with the level - handleLevelSelection,
// advantages-section.tsx:63-70), the points the row charges
// (grantedRows.chargeForAdvantageRow: a granted row cannot be sold back, size
// discount on Striking/Lifting/Arm ST), the modifier bag resolved through
// traitModifiersFor (library level bag, library flat bag, then the stored row
// bag - trait-level-modifiers.ts), and the specifier prompt
// (disadvantage-selection-dialog.tsx:171-174 through engine.traitSpecifier).

import { engine } from '../../engine.mjs';
import { ITEM_TYPES } from '../../config.mjs';
import { traitLibraryEntry, modifierBadges } from '../actor-sheet-tabs.mjs';
import { ShadowBaseItemSheet, loc, fmt, notify, text, num } from './base.mjs';
import * as B from './builders.mjs';

const TAB_IDS = ['main', 'notes'];

export class TraitSheet extends ShadowBaseItemSheet {
  static FAMILY = 'trait';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('trait', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    actions: { 'apply-specifier': TraitSheet.#onApplySpecifier },
  };

  /** The library entry: exact name, else the entry this row is a specified instance of ("Code of Honor (Jedi)"). */
  static libraryEntry(source, name) {
    const exact = traitLibraryEntry(source, name);
    if (exact) return exact;
    const lib = source === 'advantages' ? engine.advantages.advantagesLibrary : source === 'disadvantages' ? engine.disadvantages.disadvantagesLibrary : engine.quirks.allQuirksList;
    return lib.find((e) => e.specifierPrompt && engine.traitSpecifier.isSpecifiedInstanceOf(e.name, name)) ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const row = context.row;
    const source = ITEM_TYPES[item.type].source;
    const entry = TraitSheet.libraryEntry(source, text(row.name));
    const points = num(row.points);
    const baseline = num(row.baselinePoints);
    const sm = this.actor?.system?.sizeModifier ?? 0;
    // advantages-section.tsx:135-137: a budget-granting trait shows 0 with the grant named; grantedRows prices the rest.
    const budgetGrant = num(entry?.grantsBudget);
    // Disadvantages and quirks charge points - baselinePoints UNCLAMPED (calculateTraitPoints; digest A schema-core fact 9).
    const effective = budgetGrant > 0 ? 0 : item.type === 'advantage' ? num(engine.grantedRows.chargeForAdvantageRow(row, sm)) : points - baseline;
    const levels = Array.isArray(entry?.levels) ? entry.levels : null;
    // advantages-section.tsx:156-163: the select resolves by POINTS where a ladder entry matches, else the stored level.
    const selectedLevel = levels ? (levels.find((l) => l.points === points)?.level ?? row.level ?? null) : null;
    const quirks = this.actor ? B.ownerRows(item, 'quirks') : [];
    context.main = {
      source,
      isAdvantage: item.type === 'advantage',
      isQuirk: item.type === 'quirk',
      inLibrary: !!entry,
      entryName: text(entry?.name),
      category: text(row.category || entry?.category),
      points,
      baselinePoints: baseline,
      effective,
      granted: baseline > 0,
      budgetGrant,
      hasLevels: !!levels,
      level: row.level ?? null,
      levels: (levels ?? []).map((l) => ({ value: l.level, label: `${l.label ?? l.description ?? `${loc('SHADOWBASE.Item.Trait.Level')} ${l.level}`} (${l.points} ${loc('SHADOWBASE.Item.Trait.PtsShort')})`, selected: l.level === selectedLevel })),
      libraryDescription: text(entry?.description),
      specifierPrompt: text(entry?.specifierPrompt),
      fromSpecies: !!row.fromSpecies,
      fromDroidBaseline: !!row.fromDroidBaseline,
      fromMissingExtremity: !!row.fromMissingExtremity,
      fromCyberneticHardware: !!row.fromCyberneticHardware,
      specialNote: text(row.specialNote),
      modifiers: modifierBadges(engine.traitModifiersFor(row) ?? row.modifiers ?? null),
      hasBag: engine.hasAnyModifier(row.modifiers ?? engine.NO_MODIFIERS),
      quirkLimit: engine.quirks.MAX_QUIRKS,
      quirkOverLimit: item.type === 'quirk' && quirks.length > engine.quirks.MAX_QUIRKS,
      quirkCount: quirks.length,
    };
    return context;
  }

  /**
   * The specifier prompt: "Code of Honor (Other)" asks "Which code?" and the
   * row is renamed to the specified instance; a specifier that names a library
   * entry of its own is refused (specifierCollides), as the dialog refuses it.
   */
  static async #onApplySpecifier() {
    const item = this.item;
    const source = ITEM_TYPES[item.type].source;
    const entry = TraitSheet.libraryEntry(source, text(item.system?.row?.name));
    if (!entry?.specifierPrompt) return;
    const ts = engine.traitSpecifier;
    const answer = await B.promptText({ title: text(entry.name), label: text(entry.specifierPrompt), placeholder: ts.SPECIFIER_PLACEHOLDER });
    if (answer === null) return;
    const cleaned = ts.cleanSpecifier(answer);
    if (!cleaned) return notify('warn', loc('SHADOWBASE.Item.Trait.SpecifierEmpty'));
    const lib = source === 'advantages' ? engine.advantages.advantagesLibrary : engine.disadvantages.disadvantagesLibrary;
    if (ts.specifierCollides(entry.name, cleaned, lib.map((e) => e.name))) return notify('warn', fmt('SHADOWBASE.Item.Trait.SpecifierTaken', { specifier: cleaned }));
    const name = ts.specifiedTraitName(entry.name, cleaned);
    if (!name) return;
    return item.updateRow({ name });
  }
}

export default TraitSheet;
