// module/apps/item-sheets/melee.mjs
//
// Melee weapon (customized-melee-weapon-item.tsx):
//   main   Tactical Stats (:1351-1560): the damage modes (a select over the
//          weapon's own modes, selectedDamageMode), Reach, Parry / ST, the ST
//          landmarks (weaponHandling.handlingSummary), Durability with Apply
//          Stress and Field Repair, the ◊ unready gate and Ready, the Skill
//          Check line (module/rolls.mjs), the power cell's charges;
//   build  the four Ch12 component LISTS (meleeAssembly.MELEE_SLOTS: a slot
//          holds entries with a quantity - 19 of 37 profiles carry two
//          components in one slot), the Weapon Assembly strip and the
//          Construction plan (weaponBuild.planMeleeBuild);
//   mods   the three Ch12 treatments (weaponModData.MELEE_MOD_CATEGORIES:
//          hiltGripModId / bladeHeadModId / edgeAccentModId - the row holds
//          the owned mod row's uuid, no catalog companion; a catalog pick under
//          Direct Library Access creates the owned row, as the armor mod
//          selector does).
// Figures come from item.derived (calculateMeleeWeaponStats over the owner's
// ST, module/data/item-base.mjs second pass).

import { engine } from '../../engine.mjs';
import { rowsOf, rowToItemData, nextSort } from '../../adapter.mjs';
import { ShadowBaseItemSheet, statTile, loc, fmt, notify, text, num, fig, money, signed } from './base.mjs';
import * as B from './builders.mjs';

const TAB_IDS = ['main', 'build', 'mods', 'notes'];
const SOURCE = 'weaponModifications';
const HOST = 'installedInMeleeId';
const TREATMENTS = Object.freeze([
  { field: 'hiltGripModId', category: 'hiltGripMod', label: 'SHADOWBASE.Item.Melee.HiltGripMod' },
  { field: 'bladeHeadModId', category: 'bladeHeadMod', label: 'SHADOWBASE.Item.Melee.BladeHeadMod' },
  { field: 'edgeAccentModId', category: 'edgeAccentMod', label: 'SHADOWBASE.Item.Melee.EdgeAccentMod' },
]);

export class MeleeSheet extends ShadowBaseItemSheet {
  static FAMILY = 'melee';
  static BUILD_FAMILY = 'melee';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('melee', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    position: { width: 760, height: 820 },
    actions: { 'add-entry': MeleeSheet.#onAddEntry, 'remove-entry': MeleeSheet.#onRemoveEntry },
  };

  craftingCategory() { return engine.weaponBuild.MELEE_CRAFTING_FAMILY; }
  partRows() { return B.ownerRows(this.item, SOURCE); }
  _buildPlan() { return engine.weaponBuild.planMeleeBuild(this.item.system?.row ?? {}, this.partRows()); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = this.actor;
    const row = context.row;
    const merged = context.merged;
    const rolls = globalThis.game?.shadowbase?.rolls;
    const rows = this.partRows();
    const libraryAccess = context.libraryAccess;
    const provenance = B.provenanceView(row);
    const locked = provenance.locked;
    const ma = engine.meleeAssembly;

    // ---- main -------------------------------------------------------------------------------------
    const attack = actor && rolls?.attackTargetFor ? rolls.attackTargetFor(actor, item) : null;
    const blocked = actor && rolls?.attackBlockedReason ? rolls.attackBlockedReason(actor, item) : null;
    const damage = actor && rolls?.damageFormulaFor ? rolls.damageFormulaFor(actor, item) : null;
    const modes = Array.isArray(merged.damageModes) ? merged.damageModes : [];
    const selectedMode = num(row.selectedDamageMode, 0);
    const effectiveSt = actor?.stats?.primaryAttributes?.effectiveStrength ?? engine.coreStats.BASE_ATTRIBUTE_VALUE;
    const minSt = num(merged.finalStRequirement);
    const condition = B.conditionView({ ...merged, isConstructed: row.isConstructed });
    const turn = num(actor?.system?.turnCounter);
    context.main = {
      tiles: [
        statTile(loc('SHADOWBASE.Item.Melee.Damage'), merged.finalDamage ? `${merged.finalDamage} ${text(merged.finalDamageType)}`.trim() : ''),
        statTile(loc('SHADOWBASE.Item.Melee.Reach'), merged.finalReach ?? merged.baseReach),
        statTile(loc('SHADOWBASE.Item.Melee.Parry'), Number.isFinite(Number(merged.finalParryMod)) ? signed(num(merged.finalParryMod)) : ''),
        statTile(loc('SHADOWBASE.Item.Melee.MinST'), merged.finalStRequirement),
        statTile(loc('SHADOWBASE.Item.Melee.Malf'), B.malfView(rolls?.malfunctionThresholdFor ? rolls.malfunctionThresholdFor(item) : merged.malfunction).value),
        statTile(loc('SHADOWBASE.Item.Melee.EnergyRes'), merged.energyRes),
      ],
      modes: modes.map((m, i) => ({ value: i, label: `${text(m.label)}: ${text(m.stType)}${m.bonusDice ? `+${m.bonusDice}d` : ''}${m.bonus ? signed(num(m.bonus)) : ''} ${text(m.type)}`.trim(), selected: i === selectedMode })),
      hasModes: modes.length > 0,
      unbalanced: !!merged.isUnbalanced,
      canParryWhileAttacking: merged.canParryWhileAttacking !== false,
      handling: engine.weaponHandling.handlingSummary({ minSt, effectiveSt }).map(text),
      attackedThisTurn: !!actor && num(row.lastAttackTurn, -1) === turn && row.lastAttackTurn !== null && row.lastAttackTurn !== undefined,
      isUnready: !!row.isUnready,
      lastAttackTurn: row.lastAttackTurn ?? null,
      condition,
      skill: { name: text(attack?.skillName ?? row.baseSkill), target: attack ? attack.target + attack.hitBonus : null, base: attack?.target ?? null, bonus: attack ? signed(num(attack.hitBonus)) : '', note: text(attack?.note), blocked: text(blocked) },
      canAttack: !!actor && !!attack && !blocked,
      damage: text(damage?.formula ?? merged.finalDamage),
      pendingHits: num(damage?.pendingHits),
      canDamage: !!actor && num(damage?.pendingHits) > 0,
      hasCharges: row.maxCharges !== undefined && row.maxCharges !== null,
      currentCharges: row.currentCharges ?? null,
      maxCharges: row.maxCharges ?? null,
      twoHanded: !!actor && engine.isWeaponTwoHanded(merged, rows),
      flags: { isConstructed: row.isConstructed !== false, flawed: row.flawedBuild === true },
    };

    // ---- build ------------------------------------------------------------------------------------
    const slots = ma.MELEE_SLOTS.map((def) => {
      const entries = Array.isArray(row[def.key]) ? row[def.key] : [];
      const owned = B.ownedPartsFor(item, SOURCE, def.category, HOST);
      const catalog = ma.meleePartsFor(def.category);
      return {
        key: def.key, label: text(def.label), required: !!def.required, takesMaterial: !!def.takesMaterial, locked,
        entries: entries.map((entry, index) => ({
          index,
          ...B.slotView({ key: `${def.key}.${index}`, label: `${text(def.label)} ${index + 1}`, required: def.required && index === 0, takesMaterial: def.takesMaterial, entry, resolved: ma.resolveMeleeEntry(entry, rows), owned, catalog, libraryAccess, materialFamily: 'melee', locked, quantity: Math.max(1, num(entry?.quantity, 1) || 1) }),
        })),
        canAdd: !locked,
        empty: entries.length === 0,
      };
    });
    const plan = this._buildPlan();
    const hasPowerUnit = (row.utilityParts ?? []).some((e) => e?.partId || e?.inventoryId);
    context.build = {
      provenance,
      slots,
      plan: B.planView(plan, { chapter: engine.partAcquisition.PART_CHAPTER.melee, libraryAccess }),
      started: !!plan.started,
      phases: engine.weaponBuild.meleeCraftingPhases(hasPowerUnit).map((p) => `${p.name} (${p.skill})`).join(' · '),
      assemblyMinutes: text(engine.craftingRules.meleeAssemblyMinutes?.(row) ?? ''),
    };

    // ---- mods -------------------------------------------------------------------------------------
    const treatments = TREATMENTS.map((t) => {
      const current = text(row[t.field]);
      const owned = rows.filter((m) => text(m.category) === t.category && ((!m.equipped && !m.isInstalled) || text(m.id) === current || m[HOST] === row.id));
      const catalog = engine.weaponModData.WEAPON_MOD_DATA.filter((m) => m.category === t.category).map((m, i) => ({ ...m, id: `${t.category}:${engine.weaponModData.WEAPON_MOD_DATA.indexOf(m)}` }));
      const select = B.slotOptions({ owned, catalog, libraryAccess, current: { inventoryId: current || null, partId: null }, keyOf: (m) => text(m.id), labelOf: (m) => `${text(m.name)} (${money(m.cost)} cr)` });
      const fitted = current ? owned.find((m) => text(m.id) === current) ?? null : null;
      return { field: t.field, label: loc(t.label), category: t.category, select, isNone: select.isNone, fitted: fitted ? { name: text(fitted.name), effect: text(fitted.notes ?? fitted.effect), energyResBonus: num(fitted.energyResBonus) } : null, emptyReason: text(select.emptyReason) };
    });
    const fittedNames = treatments.filter((t) => t.fitted).map((t) => t.fitted.name);
    context.mods = { treatments, fittedCount: fittedNames.length, powerUnitId: text(row.powerUnitId), powerCellId: text(row.powerCellId), limits: engine.craftingRules.MELEE_MOD_LIMITS ?? null };
    return context;
  }

  /**
   * Edits: `entry.<key>.<i>` (a component entry's part), `entryMaterial.<key>.<i>`,
   * `entryQty.<key>.<i>`, `mod.<field>` (a treatment).
   */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const item = this.item;
    const actor = this.actor;
    const row = item.system?.row ?? {};
    const rows = this.partRows();
    const lists = {};
    const listOf = (key) => (lists[key] ??= (Array.isArray(row[key]) ? row[key].map((e) => ({ ...(e ?? {}) })) : []));
    const rebinds = [];
    const creates = [];
    const patch = {};
    for (const [key, value] of Object.entries(edits)) {
      let m;
      if ((m = /^entry\.([A-Za-z]+)\.(\d+)$/.exec(key))) {
        const list = listOf(m[1]);
        const i = Number(m[2]);
        if (!list[i]) continue;
        const entry = list[i];
        const current = entry.inventoryId ? B.invValue(entry.inventoryId) : entry.partId ? B.libValue(entry.partId) : '';
        if (text(value) === current) continue;
        const edit = B.slotEdit({ value, entry, ownedRows: rows, templateIdOf: (r) => text(r.partId) || text(engine.meleeAssembly.meleePartByName(r.name)?.id) || null });
        list[i] = { ...edit.patch, quantity: Math.max(1, num(entry.quantity, 1) || 1) };
        if (edit.previousId !== edit.nextId) rebinds.push({ previousId: edit.previousId, nextId: edit.nextId });
      } else if ((m = /^entryMaterial\.([A-Za-z]+)\.(\d+)$/.exec(key))) {
        const list = listOf(m[1]);
        const i = Number(m[2]);
        if (!list[i] || text(list[i].materialId) === text(value)) continue;
        list[i] = { ...list[i], materialId: text(value) || null };
      } else if ((m = /^entryQty\.([A-Za-z]+)\.(\d+)$/.exec(key))) {
        const list = listOf(m[1]);
        const i = Number(m[2]);
        const qty = Math.max(1, Math.floor(num(value, 1) || 1));
        if (!list[i] || (num(list[i].quantity, 1) || 1) === qty) continue;
        list[i] = { ...list[i], quantity: qty };
      } else if ((m = /^mod\.([A-Za-z]+)$/.exec(key))) {
        const t = TREATMENTS.find((x) => x.field === m[1]);
        if (!t) continue;
        const current = text(row[t.field]) || null;
        const choice = B.decodeChoice(value);
        if ((choice.kind === 'none' && !current) || (choice.kind === 'inv' && choice.id === current)) continue;
        if (choice.kind === 'none') { patch[t.field] = null; rebinds.push({ previousId: current, nextId: null }); continue; }
        if (choice.kind === 'inv') { patch[t.field] = choice.id; rebinds.push({ previousId: current, nextId: choice.id }); continue; }
        // A catalog treatment materialises an owned mod row and binds it (ArmorModSelector.tsx:149-170's shape; the melee card has no companion field).
        const index = Number(choice.id.split(':').pop());
        const template = engine.weaponModData.WEAPON_MOD_DATA[index];
        if (!template || !actor) continue;
        const id = engine.rowId();
        creates.push(rowToItemData({ id, name: template.name, category: template.category, cost: num(template.cost), weight: num(template.weight), notes: text(template.notes), energyResBonus: template.energyResBonus ?? null, materials: template.materials ?? [], equipped: true, quantity: 1, isInstalled: true, [HOST]: row.id }, SOURCE, nextSort(actor, SOURCE)));
        patch[t.field] = id;
        if (current) rebinds.push({ previousId: current, nextId: null });
      }
    }
    for (const [key, list] of Object.entries(lists)) patch[key] = list;
    if (Object.keys(patch).length) this._mergeRow(submitData, patch);
    if (!actor || (!rebinds.length && !creates.length)) return after;
    return async () => {
      if (typeof after === 'function') await after();
      if (creates.length) await actor.createEmbeddedDocuments('Item', creates);
      for (const r of rebinds) await B.rebindOwnedRow(actor, { source: SOURCE, hostField: HOST, hostId: row.id, previousId: r.previousId, nextId: r.nextId, equips: true });
    };
  }

  /** A new empty entry in a component list (the card's "add component" row). */
  static async #onAddEntry(event, target) {
    const key = target?.dataset?.key;
    if (!engine.meleeAssembly.MELEE_SLOT_BY_KEY[key]) return;
    const list = Array.isArray(this.item.system?.row?.[key]) ? [...this.item.system.row[key]] : [];
    list.push({ partId: null, materialId: null, inventoryId: null, quantity: 1 });
    return this.item.updateRow({ [key]: list });
  }

  /** Remove an entry; an owned row it named goes back to stock. */
  static async #onRemoveEntry(event, target) {
    const key = target?.dataset?.key;
    const index = Number(target?.dataset?.index);
    const list = Array.isArray(this.item.system?.row?.[key]) ? [...this.item.system.row[key]] : [];
    if (!engine.meleeAssembly.MELEE_SLOT_BY_KEY[key] || !list[index]) return;
    const [removed] = list.splice(index, 1);
    await this.item.updateRow({ [key]: list });
    if (removed?.inventoryId && this.actor) await B.rebindOwnedRow(this.actor, { source: SOURCE, hostField: HOST, hostId: this.item.system.row.id, previousId: removed.inventoryId, nextId: null, equips: true });
    return notify('info', fmt('SHADOWBASE.Item.Melee.EntryRemoved', { slot: text(engine.meleeAssembly.MELEE_SLOT_BY_KEY[key].label) }));
  }
}

export default MeleeSheet;
