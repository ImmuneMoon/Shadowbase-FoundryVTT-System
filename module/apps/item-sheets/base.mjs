// module/apps/item-sheets/base.mjs
//
// ShadowBaseItemSheet (docs/ARCHITECTURE.md §6.4; unit U08): ApplicationV2 +
// HandlebarsApplicationMixin over ItemSheetV2, one subclass per family
// (module/apps/item-sheets/<family>.mjs, registered by index.mjs).
//
// What the base decides, and every family inherits:
//   - PARTS header / tabs / one part per tab id / notes, TABS group `primary`;
//   - the common header (the website's card header: name or customName,
//     quantity, weight and cost as the derived figure over the stored one,
//     equipped / active / installed, the storage box, the condition badge, the
//     item-file transfer button - customized-blaster-item.tsx:430-480,
//     customized-melee-weapon-item.tsx:1020-1080, armor-item-card.tsx:585-680);
//   - the form pipeline: inputs bound to `system.row.<key>` reach the Item
//     update untouched (Foundry's ObjectField MERGES, so an input carries one
//     row key); every input named anything else is an EDIT the family
//     interprets (`_applyEdits`) - a slot select, a material, a DR entry, a
//     ship system, a level - because those write structured values or touch
//     OTHER documents (the owned part rows a slot claims and releases);
//   - Direct Library Access: a per-window toggle a GM may flip (ASSUMPTION
//     Q, ARCHITECTURE §6.4); it decides every slot's scope through
//     engine.partAcquisition.slotScope and is never stored on the item.
//
// Nothing here prices, weighs or classifies anything: every figure on a sheet
// is read off `item.derived` (module/data/item-base.mjs, the bundle's own
// per-family derivation) or asked of an engine namespace by name.

import { engine } from '../../engine.mjs';
import { ITEM_TYPES, ICONS, LUCIDE_FA } from '../../config.mjs';
import { rowsOf, rowWithDerived } from '../../adapter.mjs';
import { transferKindFor, exportItemEnvelope } from '../../import-export.mjs';
import { levelChangePatch } from '../actor-sheet-tabs.mjs';
import * as B from './builders.mjs';

export const SYSTEM_ID = 'shadowbase';
export const TEMPLATES = `systems/${SYSTEM_ID}/templates/items`;

const { loc, fmt, notify, text, num, fig, money, signed } = B;
const utils = () => globalThis.foundry?.utils;

/** foundry.applications.* resolved LATE so the module loads headlessly only after the shim's AppV2 layer is installed. */
function appsApi() {
  const apps = globalThis.foundry?.applications;
  if (!apps) throw new Error('shadowbase item-sheets: foundry.applications is not available (install tools/foundry-shim.mjs first)');
  return apps;
}
const BaseSheet = (() => {
  const apps = appsApi();
  const mixin = apps.api?.HandlebarsApplicationMixin;
  const ItemSheetV2 = apps.sheets?.ItemSheetV2;
  if (typeof mixin !== 'function' || typeof ItemSheetV2 !== 'function') {
    throw new Error('shadowbase item-sheets: foundry.applications.api.HandlebarsApplicationMixin / foundry.applications.sheets.ItemSheetV2 are required (Foundry v13)');
  }
  return mixin(ItemSheetV2);
})();

/** Tab ids -> label keys and icons (the website's card sections, docs/STYLE-SPEC.md §3.3 N4-N7, V2). */
export const TAB_DEFS = Object.freeze({
  main: { label: 'SHADOWBASE.Item.Tab.Main', icon: LUCIDE_FA.Target },
  build: { label: 'SHADOWBASE.Item.Tab.Build', icon: LUCIDE_FA.Combine },
  mods: { label: 'SHADOWBASE.Item.Tab.Mods', icon: LUCIDE_FA.Settings2 },
  internals: { label: 'SHADOWBASE.Item.Tab.Internals', icon: LUCIDE_FA.Zap },
  systems: { label: 'SHADOWBASE.Item.Tab.Systems', icon: LUCIDE_FA.Wrench },
  notes: { label: 'SHADOWBASE.Item.Tab.Notes', icon: LUCIDE_FA.PenLine },
});

/** The row key each family's editable notes live in, and the derived text shown beside it (read-only). */
export const NOTES_FIELDS = Object.freeze({
  advantage: { notes: 'description' }, disadvantage: { notes: 'description' }, quirk: { notes: 'description' },
  skill: { notes: 'notes' },
  forcePower: { notes: 'description', effect: 'effect' }, combatTechnique: { notes: 'effect' }, lightsaberForm: { notes: 'effect' },
  equipment: { notes: 'description' },
  armor: { notes: 'notes', effect: 'notesAndEffects' },
  blaster: { notes: 'customNotes', effect: 'notesAndEffects' },
  meleeWeapon: { notes: 'customNotes', effect: 'notesAndEffects' },
  lightsaber: { notes: 'customNotes', effect: 'combinedEffects' },
  explosive: { notes: 'customNotes' },
  ammunition: { notes: 'notes' },
  weaponPart: { notes: 'notes', effect: 'effect' }, armorPart: { notes: 'notes' },
  implant: { notes: 'notes', effect: 'effect' }, cyberneticLimb: { notes: 'notes', effect: 'effect' }, cyberneticUpgrade: { notes: 'notes', effect: 'effect' },
  starship: { notes: 'customNotes', effect: 'finalNotesAndEffects' },
  vehicle: { notes: 'customNotes', effect: 'notes' },
});

/** Which row key names the item (the website's card header input). */
export const NAME_FIELDS = Object.freeze({ blaster: 'customName', meleeWeapon: 'customName', starship: 'customName', explosive: 'baseExplosiveName' });

const WEAPON_TYPES = new Set(['blaster', 'meleeWeapon', 'lightsaber']);
const PART_TYPES = new Set(['weaponPart', 'armorPart']);

/**
 * A stat tile `{ label, value, tone, hint }` (BlasterFinalStats.tsx:466-490 "Type / Damage / Acc / Range ..." columns,
 * the sb-stat-tile recipe). `value` prints '—' when nothing is derived, as the cards do.
 */
export function tile(label, value, { tone = '', hint = '', mono = true } = {}) {
  const v = value === null || value === undefined || value === '' ? '—' : String(value);
  return { label, value: v, tone, hint, mono, empty: v === '—' };
}

export class ShadowBaseItemSheet extends BaseSheet {
  /** The family's tab ids in order (subclasses override); every id has a template `<family>-<id>.hbs`. */
  static TAB_IDS = ['main', 'notes'];
  /** The template family prefix (subclasses override: 'trait', 'blaster' ...). */
  static FAMILY = 'generic';

  static DEFAULT_OPTIONS = {
    classes: ['shadowbase', 'sheet', 'item', 'sb-item-sheet'],
    position: { width: 700, height: 760 },
    window: { resizable: true, controls: [] },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      'toggle-equipped': ShadowBaseItemSheet.#onToggleEquipped,
      'toggle-active': ShadowBaseItemSheet.#onToggleActive,
      'toggle-library-access': ShadowBaseItemSheet.#onToggleLibraryAccess,
      'transfer-item': ShadowBaseItemSheet.#onTransfer,
      'open-owner': ShadowBaseItemSheet.#onOpenOwner,
      'open-row': ShadowBaseItemSheet.#onOpenRow,
      'roll-attack': ShadowBaseItemSheet.#onRollAttack,
      'roll-damage': ShadowBaseItemSheet.#onRollDamage,
      'ready-weapon': ShadowBaseItemSheet.#onReadyWeapon,
      'confirm-build': ShadowBaseItemSheet.#onConfirmBuild,
      'release-build': ShadowBaseItemSheet.#onReleaseBuild,
      'field-repair': ShadowBaseItemSheet.#onFieldRepair,
      'apply-stress': ShadowBaseItemSheet.#onApplyStress,
      'step-number': ShadowBaseItemSheet.#onStepNumber,
      'open-crafting': ShadowBaseItemSheet.#onOpenCrafting,
    },
  };

  /**
   * The crafting family the CraftingApp (unit U09) takes for this item, or
   * null when the family has no crafting flow. Subclasses override:
   * weaponBuild.RANGED_CRAFTING_FAMILY / MELEE_CRAFTING_FAMILY,
   * armorBuild.ARMOR_CRAFTING_FAMILY, 'Lightsaber Forge' (crafting-rules.ts).
   */
  craftingCategory() { return null; }

  /** The Forge / Deconstruct / Salvage entries the provenance strip offers (customized-blaster-item.tsx:541-548). */
  _craftingContext(row) {
    const Cls = globalThis.game?.shadowbase?.apps?.CraftingApp;
    const category = this.craftingCategory();
    const available = typeof Cls?.open === 'function' && !!category && !!this.actor;
    const built = row.isConstructed !== false && !!row.isConstructed;
    const modes = !available ? [] : built
      ? [{ mode: 'deconstruct', label: loc('SHADOWBASE.Item.Build.Deconstruct') }, { mode: 'salvage', label: loc('SHADOWBASE.Item.Build.Salvage'), destructive: true }]
      : [{ mode: 'forge', label: loc('SHADOWBASE.Item.Build.Forge') }];
    return { available, category: text(category), modes };
  }

  /** PARTS for a family: header, tabs, one part per tab id (templates/items/<family>-<tab>.hbs). */
  static partsFor(family, tabIds) {
    const parts = { header: { template: `${TEMPLATES}/header.hbs` }, tabs: { template: `${TEMPLATES}/tabs.hbs` } };
    for (const id of tabIds) parts[id] = { template: id === 'notes' ? `${TEMPLATES}/notes.hbs` : `${TEMPLATES}/${family}-${id}.hbs`, scrollable: [''] };
    return parts;
  }

  /** TABS for a family (group `primary`, the first id initial). */
  static tabsFor(tabIds) {
    return { primary: { tabs: tabIds.map((id) => ({ id, icon: TAB_DEFS[id]?.icon ?? '', label: TAB_DEFS[id]?.label ?? id })), initial: tabIds[0] } };
  }

  static PARTS = ShadowBaseItemSheet.partsFor('generic', ShadowBaseItemSheet.TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(ShadowBaseItemSheet.TAB_IDS);

  /**
   * Direct Library Access, per window and never stored (the website's per-card
   * `isLibraryOverride` useState, customized-melee-weapon-item.tsx:1235). GM only.
   */
  libraryAccess = false;

  /** Edits extracted by _processFormData, consumed by _processSubmitData. */
  #pendingEdits = {};

  get item() { return this.document; }
  get actor() { return this.document?.actor ?? null; }
  get isGM() { return !!globalThis.game?.user?.isGM; }

  // ---- context ------------------------------------------------------------------------------------

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = this.actor;
    const row = item.system?.row ?? {};
    const merged = rowWithDerived(item);
    const editable = this.isEditable;
    const cfg = ITEM_TYPES[item.type] ?? {};
    const libraryAccess = this.isGM && this.libraryAccess;
    Object.assign(context, {
      item, actor, row, merged,
      derived: item.system?.derived ?? null,
      derivedError: text(item.system?.derivedError),
      owned: !!actor,
      editable,
      isGM: this.isGM,
      libraryAccess,
      canToggleLibrary: this.isGM && editable,
      icons: ICONS,
      lucide: LUCIDE_FA,
      typeLabel: loc(cfg.label ?? 'SHADOWBASE.Item.Unnamed'),
      typeIcon: cfg.fa ?? ICONS.info_,
      tabs: this._prepareTabs('primary'),
      header: this._headerContext(row, merged),
      notes: this._notesContext(row, merged),
      crafting: this._craftingContext(row),
    });
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  /** The common card header (see the file header). */
  _headerContext(row, merged) {
    const item = this.item;
    const actor = this.actor;
    const type = item.type;
    const nameField = NAME_FIELDS[type] ?? 'name';
    const isWeapon = WEAPON_TYPES.has(type);
    const isPart = PART_TYPES.has(type);
    const isArmor = type === 'armor';
    const qty = row.quantity;
    const hasQty = !['advantage', 'disadvantage', 'quirk', 'skill', 'forcePower', 'combatTechnique', 'lightsaberForm'].includes(type);
    const derivedWeight = merged.finalWeight ?? merged.totalWeight;
    const derivedCost = merged.totalCost ?? merged.finalCost;
    const kind = transferKindFor(item);
    const host = isPart || type === 'cyberneticUpgrade' || type === 'ammunition' ? this._hostOf(row) : null;
    let isShield = false;
    if (isArmor) { try { isShield = !!engine.shieldRules.shieldProfileForItem(row) || row.type === 'Energy Shield'; } catch { isShield = row.type === 'Energy Shield'; } }
    return {
      nameField: `system.row.${nameField}`,
      nameValue: text(row[nameField]),
      namePlaceholder: loc(`SHADOWBASE.Item.Header.Name.${nameField}`),
      nameIsSelect: nameField === 'baseExplosiveName',
      baseType: text(row.baseType ?? row.baseChassis ?? row.type ?? row.category),
      hasQty,
      quantity: hasQty ? (num(qty, 1) || 1) : null,
      weight: { value: fig(derivedWeight ?? row.weight), stored: row.weight ?? null, derived: derivedWeight !== undefined && derivedWeight !== null, editable: this._weightEditable(row) },
      cost: { value: money(derivedCost ?? row.cost), stored: row.cost ?? null, derived: derivedCost !== undefined && derivedCost !== null, editable: this._costEditable(row) },
      showEquipped: isWeapon || isArmor || isPart || type === 'cyberneticUpgrade',
      equipped: !!row.equipped,
      equippedLabel: loc(isWeapon ? (row.equipped ? 'SHADOWBASE.Item.Header.Readied' : 'SHADOWBASE.Item.Header.ReadyIt') : (row.equipped ? 'SHADOWBASE.Item.Header.Equipped' : 'SHADOWBASE.Item.Header.Equip')),
      showActive: isShield,
      isActive: !!row.isActive,
      installed: !!(row.isInstalled || row.installed),
      showInstalled: isPart || type === 'implant' || type === 'cyberneticLimb',
      host,
      storage: B.storageOptions(item),
      condition: this._conditionBadge(row, merged),
      transfer: kind ? { kind, label: text(engine.itemTransfer.kindDef(kind)?.label) } : null,
      ownerName: actor ? actor.name : '',
      isUnready: !!row.isUnready,
      flawed: row.flawedBuild === true,
      unbuilt: isWeapon && row.isConstructed === false,
      boxed: !!row.storageLocationId,
    };
  }

  /** The Notes part: the family's editable notes key and the derived effect text (read-only). */
  _notesContext(row, merged) {
    const fields = NOTES_FIELDS[this.item.type] ?? { notes: 'notes' };
    return {
      field: `system.row.${fields.notes}`,
      value: text(row[fields.notes]),
      effectLabel: fields.effect ? loc(`SHADOWBASE.Item.Notes.${fields.effect}`) : '',
      effect: fields.effect ? text(merged[fields.effect]) : '',
      hasEffect: !!fields.effect,
    };
  }

  /** Weight is a stored, typed figure only where the website lets it be (weight-editability.ts). */
  _weightEditable(row) {
    const we = engine.weightEditability;
    try {
      switch (this.item.type) {
        case 'equipment': return we.isWeightEditable(we.equipmentWeightSource(row));
        case 'armor': return we.isWeightEditable(we.armorWeightSource(row));
        case 'ammunition': return we.isWeightEditable(we.ammunitionWeightSource(row));
        case 'blaster': case 'meleeWeapon': case 'lightsaber': case 'starship': return false;
        default: return true;
      }
    } catch { return true; }
  }

  /** Cost follows weight: derived families never take a typed cost; currency rows carry a denomination instead. */
  _costEditable(row) {
    const type = this.item.type;
    if (['blaster', 'meleeWeapon', 'lightsaber', 'starship'].includes(type)) return false;
    if (type === 'equipment' && row.category === 'Currencies') return false;
    return true;
  }

  /** The condition badge (equipment / parts / ammunition carry a bare condition; weapons and armor derive it). */
  _conditionBadge(row, merged) {
    const d = this.item.system?.derived;
    return B.conditionBadge(d?.derivedCondition ?? merged.condition ?? row.condition);
  }

  /** The host Item a part / upgrade / magazine sits in (installedIn*Id, a limb's upgrades[], a blaster's loadedAmmunitionId). */
  _hostOf(row) {
    const actor = this.actor;
    if (!actor) return null;
    const id = row.installedInBlasterId || row.installedInMeleeId || row.installedInSaberId || row.installedInArmorId || row.installedInDroidId || null;
    if (id === 'PLAYER_DROID') return { id: null, name: loc('SHADOWBASE.Sheet.Inventory.PlayerDroid') };
    let host = id ? B.ownerItemByRowId(this.item, id) : null;
    if (!host && this.item.type === 'cyberneticUpgrade') host = rowsOf(actor, 'cybernetics').find((l) => (l.system?.row?.upgrades ?? []).some((u) => u?.id === row.id)) ?? null;
    if (!host && this.item.type === 'ammunition') host = rowsOf(actor, 'customBlasters').find((b) => b.system?.row?.loadedAmmunitionId === row.id) ?? null;
    return host ? { id: host.id, name: host.displayName ?? host.name } : (id ? { id: null, name: id } : null);
  }

  // ---- form pipeline ------------------------------------------------------------------------------

  /**
   * `name` / `img` / `system.*` inputs are the Item update; everything else is
   * an EDIT for the family (`_applyEdits`). A number input left blank arrives
   * as NaN from a valueAsNumber read or as null from FormDataExtended's cast
   * (UNVERIFIED which, headlessly) - both become null, never 0.
   */
  _processFormData(event, form, formData) {
    const raw = formData?.object ?? formData ?? {};
    const doc = {};
    const edits = {};
    for (const [key, value] of Object.entries(raw)) {
      const v = typeof value === 'number' && Number.isNaN(value) ? null : value;
      if (key === 'name' || key === 'img' || key.startsWith('system.')) doc[key] = v; else edits[key] = v;
    }
    this.#pendingEdits = edits;
    return utils()?.expandObject ? utils().expandObject(doc) : expandObject(doc);
  }

  /**
   * The family interprets its edits BEFORE the update (they may add row keys)
   * and runs its cross-document writes AFTER it (a slot's claim / release of
   * an owned part row, an install onto a hit location).
   */
  async _processSubmitData(event, form, submitData, options) {
    const edits = this.#pendingEdits;
    this.#pendingEdits = {};
    const after = await this._applyEdits(edits, submitData);
    await this.document.update(submitData, options);
    if (typeof after === 'function') await after();
  }

  /**
   * Interpret the non-document inputs. Returns nothing, or a function to run
   * after the Item update. The base handles the catalog-backed `level` select
   * (traits / powers / techniques / forms: levelChangePatch re-reads the
   * catalog by name + level, the website's handleLevelSelection).
   * @param {Record<string, any>} edits
   * @param {object} submitData the expanded Item update (mutable)
   */
  async _applyEdits(edits, submitData) {
    // `sel.<key>`: a select whose blank option means null on the row (a storage box, a limb, a tier, a host reference -
    // the website stores null, never '', and the zod schemas refuse '' where a field is nullable).
    for (const [key, value] of Object.entries(edits)) {
      const m = /^sel\.([A-Za-z]+)$/.exec(key);
      if (!m) continue;
      const current = this.item.system?.row?.[m[1]] ?? null;
      const next = value === '' || value === null || value === undefined ? null : value;
      if (next !== current) this._mergeRow(submitData, { [m[1]]: next });
    }
    if ('level' in edits) {
      const level = edits.level === '' || edits.level === null ? null : Number(edits.level);
      const current = this.item.system?.row?.level ?? null;
      if (level !== null && Number(level) !== Number(current)) {
        const patch = levelChangePatch(this.item, level);
        this._mergeRow(submitData, patch);
      } else if (level === null && current !== null) {
        this._mergeRow(submitData, { level: null });
      }
    }
    return null;
  }

  /** Merge row changes into an expanded submit object. */
  _mergeRow(submitData, patch) {
    submitData.system ??= {};
    submitData.system.row ??= {};
    Object.assign(submitData.system.row, patch);
    return submitData;
  }

  // ---- render -----------------------------------------------------------------------------------------

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root || typeof root.setAttribute !== 'function') return;
    root.setAttribute('data-item-type', this.item.type);
    root.setAttribute('data-library-access', String(!!(this.isGM && this.libraryAccess)));
  }

  // ---- actions (static; `this` is the sheet) -----------------------------------------------------------

  /**
   * Weapons ready / unready (customized-blaster-item.tsx:448-476: equipped +
   * equippedAt, unreadying clears the stamp); armor wears through
   * gearSets.applySetEquip (one base layer per location, Ch13 - the actor
   * sheet's toggleEquipped does the same); parts and upgrades flip the flag.
   */
  static async #onToggleEquipped() {
    const item = this.item;
    const row = item.system?.row ?? {};
    const equip = !row.equipped;
    if (WEAPON_TYPES.has(item.type)) return item.updateRow({ equipped: equip, equippedAt: equip ? Date.now() : null });
    if (item.type === 'armor' && this.actor) {
      const actor = this.actor;
      const rows = rowsOf(actor, 'armor').map((i) => i.system.row);
      const { armor, displaced } = engine.gearSets.applySetEquip(rows, [row.id], equip);
      const updates = [];
      for (const next of armor) {
        const own = B.ownerItemByRowId(item, next.id);
        if (!own) continue;
        const before = own.system.row;
        if (before.equipped !== next.equipped || before.isActive !== next.isActive) updates.push({ _id: own.id, 'system.row.equipped': !!next.equipped, ...(before.isActive !== next.isActive ? { 'system.row.isActive': !!next.isActive } : {}) });
      }
      if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
      if (displaced?.length) notify('info', fmt('SHADOWBASE.Sheet.Inventory.BaseLayerSwapped', { names: displaced.map((d) => d.name ?? d.itemName).join(', ') }));
      return;
    }
    return item.updateRow({ equipped: equip });
  }

  /** A shield's active state (armor-item-card.tsx:653-660). */
  static async #onToggleActive() { return this.item.updateRow({ isActive: !this.item.system?.row?.isActive }); }

  static async #onToggleLibraryAccess() {
    if (!this.isGM) return notify('warn', loc('SHADOWBASE.Item.Library.GmOnly'));
    this.libraryAccess = !this.libraryAccess;
    return this.render();
  }

  /** Export the item file (item-transfer-buttons.tsx ExportItemButton -> module/import-export.mjs exportItemEnvelope). */
  static async #onTransfer() {
    if (!this.actor) return notify('warn', loc('SHADOWBASE.Item.Header.TransferNeedsOwner'));
    return exportItemEnvelope(this.actor, this.item);
  }

  static async #onOpenOwner() { return this.actor?.sheet?.render?.(true); }

  /** Open another owned row's sheet (data-row-id: the row uuid). */
  static async #onOpenRow(event, target) {
    const other = B.ownerItemByRowId(this.item, target?.dataset?.rowId);
    return other?.sheet?.render?.(true);
  }

  static async #onRollAttack() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!this.actor || !rolls?.rollAttack) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.rollAttack(this.actor, this.item);
  }

  static async #onRollDamage() {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!this.actor || !rolls?.rollDamage) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.rollDamage(this.actor, { item: this.item });
  }

  /** Ch12's Ready maneuver clears ◊ unready (customized-melee-weapon-item.tsx:604). */
  static async #onReadyWeapon() { return this.item.updateRow({ isUnready: false }); }

  /** Confirm Construction (builders.applyBuild; the family names its plan through `_buildPlan()`). */
  static async #onConfirmBuild() {
    const family = this.constructor.BUILD_FAMILY;
    if (!family) return;
    const plan = this._buildPlan?.() ?? null;
    const result = await B.applyBuild(this.item, { family, plan, libraryAccess: this.isGM && this.libraryAccess });
    if (!result.ok) return notify('warn', fmt('SHADOWBASE.Item.Build.Blocked', { reason: result.reason }));
    notify('info', loc(result.provenance === 'placed' ? 'SHADOWBASE.Item.Build.PlacedNotice' : 'SHADOWBASE.Item.Build.BuiltNotice'));
  }

  /** Swap Components: back to a design; the owned rows go back to stock (builders.releaseBuild). */
  static async #onReleaseBuild() {
    const family = this.constructor.BUILD_FAMILY;
    if (!family) return;
    const ok = await B.confirmDialog({ title: loc('SHADOWBASE.Item.Build.ReleaseTitle'), content: `<p>${loc('SHADOWBASE.Item.Build.ReleaseBody')}</p>` });
    if (!ok) return;
    return B.releaseBuild(this.item, { family });
  }

  /**
   * Field Repair (BlasterFinalStats.tsx:449 handleFieldRepair; armor-item-card.tsx
   * Maintenance Protocol): a weapon's durability returns to its maximum and
   * its condition to Fine; a Piece's every DR entry returns to the listed DR.
   * The Ch7 repair ROLL itself is the CraftingApp's (U09); this is the write.
   */
  static async #onFieldRepair(event, target) {
    const item = this.item;
    const merged = rowWithDerived(item);
    if (item.type === 'armor') {
      const hitLocations = this.actor?.system?.hitLocations ?? [];
      const entries = (merged.drEntries ?? []).map((e) => ({ ...e, dr: engine.listedArmorDrAt(merged, e.locationId, hitLocations) || e.dr }));
      return item.updateRow({ drEntries: entries, condition: 'Fine' });
    }
    const two = target?.dataset?.blade === '2';
    const maxKey = two ? 'maxDurabilityTwo' : 'maxDurability';
    const max = merged[maxKey];
    if (!engine.malfunction.hasBeenMeasured(max)) return notify('warn', loc('SHADOWBASE.Item.Condition.NotMeasured'));
    return item.updateRow(two ? { durabilityTwo: max, conditionTwo: 'Fine' } : { durability: max, condition: 'Fine' });
  }

  /**
   * Apply Stress (customized-melee-weapon-item.tsx:1376-1378, lightsaber-item.tsx:1733-1756):
   * penetrating damage vs Durability through engine.malfunction.weaponStressFor.
   */
  static async #onApplyStress(event, target) {
    const item = this.item;
    const merged = rowWithDerived(item);
    const two = target?.dataset?.blade === '2';
    const durKey = two ? 'durabilityTwo' : 'durability';
    const condKey = two ? 'conditionTwo' : 'condition';
    const answer = await B.promptText({ title: loc('SHADOWBASE.Item.Condition.StressTitle'), label: loc('SHADOWBASE.Item.Condition.StressLabel'), type: 'number', initial: '' });
    if (answer === null || answer === '') return;
    const stress = engine.malfunction.weaponStressFor(Number(answer), merged[durKey] ?? merged[two ? 'maxDurabilityTwo' : 'maxDurability'], { canSever: item.type === 'lightsaber' || target?.dataset?.canSever !== 'false' });
    if (stress.outcome === 'None') return notify('info', stress.explanation);
    await item.updateRow({ [durKey]: stress.nextDurability, [condKey]: stress.outcome });
    return notify('warn', stress.explanation);
  }

  /**
   * Open the CraftingApp (unit U09) on this item the way the website's cards
   * mount the crafting dialog (docs/REQUESTS.md U09 -> U08): the job carries
   * the merged row, the family's crafting category and the mode (data-mode:
   * forge / deconstruct / salvage). The app applies the outcome itself.
   */
  static async #onOpenCrafting(event, target) {
    const Cls = globalThis.game?.shadowbase?.apps?.CraftingApp;
    const category = this.craftingCategory();
    if (typeof Cls?.open !== 'function' || !category) return notify('warn', fmt('SHADOWBASE.Sheet.AppUnavailable', { app: loc('SHADOWBASE.Sheet.App.CraftingApp') }));
    if (!this.actor) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    const mode = text(target?.dataset?.mode) || 'standard';
    return Cls.open(this.actor, { item: rowWithDerived(this.item), category, mode, weaponCarriesSilicon: this._carriesSilicon?.() ?? undefined });
  }

  /** quantity-input.tsx nudge: stepUp/stepDown then a real change event, so submitOnChange sees a genuine edit. */
  static async #onStepNumber(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const input = target.closest?.('.sb-qty')?.querySelector?.('input');
    if (!input || input.disabled || input.readOnly) return;
    try { if (Number(target.dataset.dir) < 0) input.stepDown(); else input.stepUp(); } catch { return; }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/** A minimal expandObject for hosts without foundry.utils (headless before the shim). */
function expandObject(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let t = out;
    for (let i = 0; i < parts.length - 1; i++) { if (!t[parts[i]] || typeof t[parts[i]] !== 'object') t[parts[i]] = {}; t = t[parts[i]]; }
    t[parts[parts.length - 1]] = v;
  }
  return out;
}

export { tile as statTile, text, num, fig, money, signed, loc, fmt, notify };
export default ShadowBaseItemSheet;
