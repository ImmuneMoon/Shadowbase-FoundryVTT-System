// module/apps/item-sheets/lightsaber.mjs
//
// Lightsaber (lightsaber-item.tsx):
//   main       Tactical Analysis (:1684-1930): Class Type (the specialty the
//              weapon rolls, lightsaberClassType), blade damage (Model B:
//              calculatedDamage / calculatedDamageTwo), Parry, energy
//              resistance, a condition and Durability track PER BLADE with
//              Apply Stress and Field Repair, the hidden-flaw / unattuned /
//              crystal-penalty badges, blade length, the cell's charge, the
//              Skill Check line (module/rolls.mjs);
//   build      Hilt Construction (:1542-1660): the hilt slots this build has
//              (lightsaberAssembly.lightsaberSlotsFor - a fitted Shared Coupler
//              makes it a staff and opens the second blade's slots, the pommel
//              is required only on a single hilt), each with its material and,
//              on a sleeve, its wrap; the Weapon Assembly strip and the plan
//              (weaponBuild.planSaberBuild);
//   internals  the seven fitted goods (fittedGoods.LIGHTSABER_INTERNAL_SLOTS,
//              the second blade's two only on a staff), tallied by
//              tallySaberInternals.
// Figures come from item.derived (calculateLightsaberStats).

import { engine } from '../../engine.mjs';
import { ShadowBaseItemSheet, statTile, loc, text, num, fig, money, signed } from './base.mjs';
import * as B from './builders.mjs';

const TAB_IDS = ['main', 'build', 'internals', 'notes'];
const SOURCE = 'lightsaberModifications';
const HOST = 'installedInSaberId';

export class LightsaberSheet extends ShadowBaseItemSheet {
  static FAMILY = 'lightsaber';
  static BUILD_FAMILY = 'saber';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('lightsaber', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    position: { width: 760, height: 840 },
  };

  /** crafting-rules.ts LIGHTSABER_FORGE_STAGES: the whole-saber job the CraftingApp keys on the 'Lightsaber Forge' category (module/apps/crafting.mjs stagesFor). */
  craftingCategory() { return 'Lightsaber Forge'; }
  partRows() { return B.ownerRows(this.item, SOURCE); }
  _buildPlan() { return engine.weaponBuild.planSaberBuild(this.item.system?.row ?? {}, this.partRows()); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = this.actor;
    const row = context.row;
    const merged = context.merged;
    const rolls = globalThis.game?.shadowbase?.rolls;
    const rows = this.partRows();
    const libraryAccess = context.libraryAccess;
    const la = engine.lightsaberAssembly;
    const fg = engine.fittedGoods;
    const isStaff = la.isStaffHilt(row);
    const provenance = B.provenanceView(row);
    const locked = provenance.locked;

    // ---- main -------------------------------------------------------------------------------------
    const attack = actor && rolls?.attackTargetFor ? rolls.attackTargetFor(actor, item) : null;
    const blocked = actor && rolls?.attackBlockedReason ? rolls.attackBlockedReason(actor, item) : null;
    const damage = actor && rolls?.damageFormulaFor ? rolls.damageFormulaFor(actor, item) : null;
    const classType = text(merged.classType) || engine.lightsaberClassType.DEFAULT_CLASS_TYPE;
    context.main = {
      tiles: [
        statTile(loc('SHADOWBASE.Item.Saber.ClassType'), classType, { mono: false }),
        statTile(loc('SHADOWBASE.Item.Saber.Damage'), merged.calculatedDamage),
        ...(isStaff ? [statTile(loc('SHADOWBASE.Item.Saber.DamageTwo'), merged.calculatedDamageTwo)] : []),
        statTile(loc('SHADOWBASE.Item.Saber.Parry'), Number.isFinite(Number(merged.finalParryMod)) ? signed(num(merged.finalParryMod)) : ''),
        statTile(loc('SHADOWBASE.Item.Saber.EnergyRes'), isStaff ? `${num(merged.energyRes)} / ${num(merged.energyResTwo)}` : merged.energyRes),
        statTile(loc('SHADOWBASE.Item.Saber.Malf'), B.malfView(rolls?.malfunctionThresholdFor ? rolls.malfunctionThresholdFor(item) : merged.malfunction).value),
        statTile(loc('SHADOWBASE.Item.Saber.Value'), money(merged.totalCost)),
      ],
      isStaff,
      skillName: engine.lightsaberClassType.lightsaberCombatSkill(classType),
      condition: B.conditionView({ ...merged, isConstructed: row.isConstructed }),
      conditionLabel: loc(isStaff ? 'SHADOWBASE.Item.Saber.BladeOne' : 'SHADOWBASE.Item.Condition.Title'),
      conditionTwo: isStaff ? B.conditionView({ ...merged, isConstructed: row.isConstructed }, { two: true }) : null,
      crystalAttackPenalty: num(merged.crystalAttackPenalty),
      hasHiddenFlaw: !!row.hasHiddenFlaw,
      isUnattuned: !!row.isUnattuned,
      isSplit: !!row.isSplit,
      bladeLength: row.bladeLength ?? null,
      cell: { current: row.powerCellCurrentCharge ?? null, max: merged.powerCellMaxCharge ?? row.powerCellMaxCharge ?? null },
      skill: { name: text(attack?.skillName ?? engine.lightsaberClassType.lightsaberCombatSkill(classType)), target: attack ? attack.target + attack.hitBonus : null, base: attack?.target ?? null, bonus: attack ? signed(num(attack.hitBonus)) : '', note: text(attack?.note), blocked: text(blocked) },
      canAttack: !!actor && !!attack && !blocked,
      damage: text(damage?.formula ?? merged.calculatedDamage),
      pendingHits: num(damage?.pendingHits),
      canDamage: !!actor && num(damage?.pendingHits) > 0,
      twoHanded: !!actor && engine.isWeaponTwoHanded(merged, rows),
      flags: { isConstructed: row.isConstructed !== false, flawed: row.flawedBuild === true },
      gate: actor ? text(engine.learningGates.constructionGateWarning(actor.sheetData ?? {})) : '',
    };

    // ---- build ------------------------------------------------------------------------------------
    const slots = la.lightsaberSlotEntries(row, rows).map(({ slot, value, resolved }) => ({
      ...B.slotView({
        key: slot.key, label: text(slot.label), required: !!slot.required, takesMaterial: true, takesWrap: slot.category === la.WRAPPABLE_HILT_CATEGORY, entry: value, resolved,
        owned: B.ownedPartsFor(item, SOURCE, slot.category, HOST), catalog: la.hiltPartsFor(slot.category), libraryAccess, materialFamily: 'saber',
        // couplerTwo is the far end of the shared coupler, written from the coupler's own selection (lightsaber-assembly.ts LIGHTSABER_SLOTS).
        locked: locked || slot.key === 'couplerTwo',
      }),
      staffOnly: !!slot.staffOnly,
      componentClass: text(resolved?.template?.componentClass),
      price: resolved?.template ? money(la.hiltSlotPrice(resolved)) : '',
      weight: resolved?.template ? fig(la.hiltSlotWeight(resolved, rows)) : '',
      durability: resolved?.template ? num(la.hiltSlotDurability(resolved)) : null,
    }));
    const plan = this._buildPlan();
    context.build = {
      provenance,
      isStaff,
      slots,
      plan: B.planView(plan, { chapter: engine.partAcquisition.PART_CHAPTER.melee, libraryAccess }),
      started: !!plan.started,
      phases: engine.weaponBuild.lightsaberCraftingPhases().map((p) => `${p.name} (${p.skill})`).join(' · '),
      assembled: { weight: fig(la.assembledSaberWeight?.(row, rows)), parry: signed(num(la.assembledSaberParryMod?.(row, rows))), durability: num(la.assembledSaberDurability?.(row, rows)) },
    };

    // ---- internals --------------------------------------------------------------------------------
    const internals = fg.lightsaberInternalsFor(isStaff).map((slot) => {
      const current = text(row[slot.idField]);
      const owned = rows.filter((m) => text(m.category) === slot.category && (!m.isInstalled || m[HOST] === row.id || text(m.id) === current));
      return { ...B.fittedView({ slot, item, owned, catalog: fg.lightsaberInternalsCatalog(slot.category), libraryAccess, byKey: fg.lightsaberInternalByKey, locked }), splitPerBlade: fg.internalIsSplitPerBlade(slot) };
    });
    const tally = fg.tallySaberInternals(row, rows, isStaff);
    context.internals = {
      slots: internals,
      isStaff,
      tally: { weight: fig(tally.weight), value: money(tally.value), effects: (tally.effects ?? []).map(text), energyRes: Array.isArray(tally.energyRes) ? tally.energyRes.map(num) : [0, 0], chosenNotOwned: (tally.chosenNotOwned ?? []).map((c) => text(c?.name ?? c)) },
      damageText: text(engine.lightsaberDamage.bladeDamageText(engine.lightsaberDamage.saberDamageInputs(row, rows, 1))),
      damageTextTwo: isStaff ? text(engine.lightsaberDamage.bladeDamageText(engine.lightsaberDamage.saberDamageInputs(row, rows, 2))) : '',
    };
    return context;
  }

  /** Edits: `slot.<key>`, `material.<key>`, `wrap.<key>` (hilt), `internal.<idField>`. */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const item = this.item;
    const actor = this.actor;
    const row = item.system?.row ?? {};
    const rows = this.partRows();
    const la = engine.lightsaberAssembly;
    const fg = engine.fittedGoods;
    const rebinds = [];
    const patch = {};
    for (const [key, value] of Object.entries(edits)) {
      let m;
      if ((m = /^slot\.([A-Za-z]+)$/.exec(key))) {
        const slotKey = m[1];
        if (!la.LIGHTSABER_SLOT_BY_KEY[slotKey] || slotKey === 'couplerTwo') continue;
        const entry = { ...(row[slotKey] ?? {}), ...(patch[slotKey] ?? {}) };
        const current = entry.inventoryId ? B.invValue(entry.inventoryId) : entry.partId ? B.libValue(entry.partId) : '';
        if (text(value) === current) continue;
        const edit = B.slotEdit({ value, entry, ownedRows: rows, templateIdOf: (r) => text(la.hiltPartForRow(r)?.id) || text(r.partId) || null, keepWrap: true });
        patch[slotKey] = edit.patch;
        // The far end of a shared coupler follows the coupler (lightsaber-item.tsx writes couplerTwo from the coupler's selection).
        if (slotKey === 'coupler') patch.couplerTwo = { ...edit.patch };
        if (edit.previousId !== edit.nextId) rebinds.push({ previousId: edit.previousId, nextId: edit.nextId });
      } else if ((m = /^material\.([A-Za-z]+)$/.exec(key))) {
        const entry = { ...(row[m[1]] ?? {}), ...(patch[m[1]] ?? {}) };
        if (text(entry.materialId) === text(value)) continue;
        patch[m[1]] = { ...entry, materialId: text(value) || null };
      } else if ((m = /^wrap\.([A-Za-z]+)$/.exec(key))) {
        const entry = { ...(row[m[1]] ?? {}), ...(patch[m[1]] ?? {}) };
        if (text(entry.wrapId) === text(value)) continue;
        patch[m[1]] = { ...entry, wrapId: text(value) || null };
      } else if ((m = /^internal\.([A-Za-z]+)$/.exec(key))) {
        const slot = fg.LIGHTSABER_INTERNAL_BY_FIELD[m[1]];
        if (!slot) continue;
        const current = row[slot.idField] ? B.invValue(row[slot.idField]) : row[slot.partIdField] ? B.libValue(row[slot.partIdField]) : '';
        if (text(value) === current) continue;
        const edit = B.fittedEdit({ value, slot, item, ownedRows: rows, byKey: fg.lightsaberInternalByKey });
        Object.assign(patch, edit.patch);
        if (edit.previousId !== edit.nextId) rebinds.push({ previousId: edit.previousId, nextId: edit.nextId });
      }
    }
    if (Object.keys(patch).length) this._mergeRow(submitData, patch);
    if (!rebinds.length || !actor) return after;
    return async () => {
      if (typeof after === 'function') await after();
      for (const r of rebinds) await B.rebindOwnedRow(actor, { source: SOURCE, hostField: HOST, hostId: row.id, previousId: r.previousId, nextId: r.nextId, equips: true });
    };
  }
}

export default LightsaberSheet;
