// module/apps/item-sheets/blaster.mjs
//
// Ranged weapon (customized-blaster-item.tsx + customized-blaster-item/*):
//   main   BlasterFinalStats.tsx Tactical Stats (Type / Damage / Acc / Range /
//          RoF / ST / Bulk / Malfunction / Gas Grade), the condition and
//          durability track with Field Repair and Apply Stress, the Stun toggle,
//          the Skill Check line (module/rolls.mjs attackTargetFor, the HUD's
//          composition), the ammunition and power systems
//          (BlasterAmmunition.tsx handlePowerCellChange :209-262, ported);
//   build  BlasterBaseInfo.tsx Structural Matrix: the five Ch11 slots
//          (rangedAssembly.RANGED_SLOTS, resolved owned-row-first) with their
//          materials, the Weapon Assembly strip and the Construction plan
//          (weaponBuild.planBlasterBuild);
//   mods   BlasterModifications.tsx: the weapon class's Ch11 mod slots
//          (weaponModData.rangedModSlotsFor) as fitted goods
//          (fittedGoods.RANGED_MOD_SLOT_FIELDS), tallied by tallyRangedMods.
// Every figure comes from item.derived (calculateBlasterStats through
// module/data/item-base.mjs); this file only lays it out and interprets edits.

import { engine } from '../../engine.mjs';
import { rowsOf, rowToItemData, nextSort } from '../../adapter.mjs';
import { ShadowBaseItemSheet, statTile, loc, fmt, notify, text, num, fig, money, signed } from './base.mjs';
import * as B from './builders.mjs';

const TAB_IDS = ['main', 'build', 'mods', 'notes'];
const SOURCE = 'weaponModifications';
const HOST = 'installedInBlasterId';

export class BlasterSheet extends ShadowBaseItemSheet {
  static FAMILY = 'blaster';
  static BUILD_FAMILY = 'blaster';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('blaster', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    position: { width: 760, height: 820 },
  };

  /** The Ch11 profile this weapon was bought as (its category decides the mod-slot class and the ammunition). */
  profile() { return engine.rangedWeaponProfiles.RANGED_WEAPON_PROFILES.find((p) => p.name === this.item.system?.row?.baseType) ?? null; }
  category() { return this.profile()?.category ?? null; }
  /** Ch11's compatibility key for the part catalogs (rangedPartsFor). */
  weaponType() { const row = this.item.system?.row ?? {}; return engine.rangedAssembly.rangedFamilyOfProfileName(row.baseType) ?? engine.rangedAssembly.rangedFamilyFromTypeString(row.baseType); }
  craftingCategory() { return this.category() ?? engine.weaponBuild.RANGED_CRAFTING_FAMILY; }
  _carriesSilicon() { return !!engine.weaponPricing.blasterBuildCarriesSilicon?.(this.item.system?.row ?? {}, this.partRows()); }
  partRows() { return B.ownerRows(this.item, SOURCE); }
  _buildPlan() { return engine.weaponBuild.planBlasterBuild(this.item.system?.row ?? {}, this.partRows(), this.category()); }

  /**
   * The ammunition this receiver takes (BlasterAmmunition.tsx:60-75
   * getRequiredAmmoType): the fitted receiver's ammoType, else the family
   * inferred from the base type.
   */
  requiredAmmo() {
    const row = this.item.system?.row ?? {};
    const receiver = engine.rangedAssembly.resolveRangedSlot(row.receiverPart, this.partRows()).template;
    if (receiver?.ammoType) return String(receiver.ammoType);
    const bt = String(row.baseType ?? '');
    if (bt.includes('Pistol') && !bt.includes('Heavy')) return 'Standard Power Pack';
    if (bt.includes('Heavy Pistol')) return 'Heavy Power Pack';
    if (bt.includes('Carbine') || bt.includes('Rifle') || bt.includes('Bowcaster')) return 'Rifle Power Pack';
    if (bt.includes('Heavy') && !bt.includes('Pistol')) return 'Heavy Power Pack';
    if (bt.includes('Flamethrower')) return 'Fuel Canister';
    if (bt.includes('Stinger') || bt.includes('Gauntlet')) return 'Dart Magazine';
    return 'Standard Power Pack';
  }

  /**
   * The packs and cells this weapon may load (BlasterAmmunition.tsx:83-158,
   * availablePowerSources + availableAmmo). The website's alias table
   * (RECEIVER_AMMO_ALIASES / MAGAZINE_CALIBER) is not exported by the bundle,
   * so the match here is by name needle, then by type family, then every
   * ammunition row when nothing matches (UNVERIFIED against the alias table).
   */
  loadableAmmo() {
    const item = this.item;
    const actor = this.actor;
    if (!actor) return { ammo: [], cells: [] };
    const needed = this.requiredAmmo();
    const family = /Fuel/.test(needed) ? 'Fuel Canister' : /Dart/.test(needed) ? 'Dart Magazine' : /Magazine|Clip|Round/.test(needed) ? 'Magazine' : needed === 'Missile' ? 'Missile' : needed === 'Grenade' ? 'Grenade' : 'Power Packs';
    const all = rowsOf(actor, 'ammunition').map((i) => i.system.row).filter((a) => (num(a.quantity, 1) || 1) > 0);
    let ammo = all.filter((a) => text(a.name).includes(needed) || text(a.type) === family || (family === 'Power Packs' && text(a.type) === 'Power Cell'));
    if (!ammo.length) ammo = all;
    const cells = family === 'Power Packs' || family === 'Grenade' || family === 'Missile'
      ? rowsOf(actor, 'equipment').map((i) => i.system.row).filter((e) => (e.name === 'Power Cell' || text(e.name).includes('Power Pack')) && (num(e.quantity, 1) || 1) > 0 && (!e.installedInBlasterId || e.installedInBlasterId === item.system?.row?.id))
      : [];
    return { ammo, cells, needed, family };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = this.actor;
    const row = context.row;
    const merged = context.merged;
    const rolls = globalThis.game?.shadowbase?.rolls;
    const rows = this.partRows();
    const libraryAccess = context.libraryAccess;
    const category = this.category();
    const provenance = B.provenanceView(row);
    const locked = provenance.locked;

    // ---- main -------------------------------------------------------------------------------------
    const attack = actor && rolls?.attackTargetFor ? rolls.attackTargetFor(actor, item) : null;
    const blocked = actor && rolls?.attackBlockedReason ? rolls.attackBlockedReason(actor, item) : null;
    const damage = actor && rolls?.damageFormulaFor ? rolls.damageFormulaFor(actor, item) : null;
    const malf = B.malfView(rolls?.malfunctionThresholdFor ? rolls.malfunctionThresholdFor(item) : merged.malfunction);
    const loaded = row.loadedAmmunitionData ?? null;
    const grade = engine.blasterGasGrades.getGasGrade(loaded?.gasGrade);
    const condition = B.conditionView({ ...merged, isConstructed: row.isConstructed });
    const { ammo, cells, needed } = this.loadableAmmo();
    const loadedValue = text(row.loadedAmmunitionId);
    context.main = {
      tiles: [
        statTile(loc('SHADOWBASE.Item.Blaster.Type'), text(row.baseType), { mono: false }),
        statTile(loc('SHADOWBASE.Item.Blaster.Damage'), merged.finalDamage ? `${merged.finalDamage} ${text(merged.finalDamageType)}`.trim() : ''),
        statTile(loc('SHADOWBASE.Item.Blaster.Acc'), merged.finalAccuracy),
        statTile(loc('SHADOWBASE.Item.Blaster.Range'), merged.finalHalfDamageRange),
        statTile(loc('SHADOWBASE.Item.Blaster.RoF'), merged.finalRateOfFire),
        statTile(loc('SHADOWBASE.Item.Blaster.Shots'), merged.finalShots ?? (row.maxCharges ? `${num(row.currentCharges)}/${num(row.maxCharges)}` : '')),
        statTile(loc('SHADOWBASE.Item.Blaster.ST'), merged.finalST),
        statTile(loc('SHADOWBASE.Item.Blaster.Bulk'), merged.finalBulk),
        statTile(loc('SHADOWBASE.Item.Blaster.Rcl'), merged.finalRecoil),
        statTile(loc('SHADOWBASE.Item.Blaster.Malf'), malf.value, { tone: malf.degraded ? 'warn' : '' }),
        statTile(loc('SHADOWBASE.Item.Blaster.EnergyRes'), merged.energyRes),
      ],
      gasGrade: grade ? { label: text(grade.label), color: text(grade.boltHex), effect: text(grade.effect) } : null,
      condition,
      stunMode: !!row.stunMode,
      skill: { name: text(attack?.skillName ?? row.baseSkill), target: attack ? attack.target + attack.hitBonus : null, base: attack?.target ?? null, bonus: attack ? signed(num(attack.hitBonus)) : '', note: text(attack?.note), blocked: text(blocked) },
      canAttack: !!actor && !!attack && !blocked,
      damage: text(damage?.formula ?? merged.finalDamage),
      pendingHits: num(damage?.pendingHits),
      canDamage: !!actor && num(damage?.pendingHits) > 0,
      isVolley: !!damage?.volley,
      ammo: {
        needed,
        loadedName: text(loaded?.name),
        loadedType: text(loaded?.type),
        fromEquipment: !!loaded?._isEquipSource,
        current: num(row.currentCharges),
        max: num(row.maxCharges),
        chargesPerShot: num(row.chargesPerShot, 1) || 1,
        options: [{ value: '', label: loc('SHADOWBASE.Item.Blaster.NoAmmo'), selected: !loadedValue },
          ...ammo.map((a) => ({ value: text(a.id), label: `${text(a.name)} (x${num(a.quantity, 1) || 1}${a.gasGrade ? `, ${text(engine.blasterGasGrades.getGasGrade(a.gasGrade)?.label)}` : ''})`, selected: text(a.id) === loadedValue })),
          ...cells.map((e) => ({ value: text(e.id), label: `${text(e.name)} (${loc('SHADOWBASE.Item.Blaster.EquipmentSource')})`, selected: text(e.id) === loadedValue })),
          ...(loadedValue && !ammo.some((a) => text(a.id) === loadedValue) && !cells.some((e) => text(e.id) === loadedValue) ? [{ value: loadedValue, label: text(loaded?.name) || loadedValue, selected: true }] : [])],
        contents: Array.isArray(loaded?.contents) ? loaded.contents.length : 0,
        firedRounds: num(row.firedRounds),
        lastVolley: Array.isArray(row.lastVolley) ? row.lastVolley.length : 0,
      },
      flags: { isConstructed: row.isConstructed !== false, flawed: row.flawedBuild === true, unready: !!row.isUnready },
      twoHanded: !!actor && engine.isWeaponTwoHanded(merged, rows),
      handling: text(engine.weaponHandling.handlingSummary({ minSt: engine.weaponHandling.rangedMinSt?.(merged) ?? merged.finalST, effectiveSt: actor?.stats?.primaryAttributes?.effectiveStrength ?? 10 }).join(' · ')),
      totalUpgradesCost: money(merged.totalUpgradesCost),
    };

    // ---- build ------------------------------------------------------------------------------------
    const ra = engine.rangedAssembly;
    const weaponType = this.weaponType();
    const defs = ra.rangedSlotEntries(row, rows).length ? ra.rangedSlotEntries(row, rows) : ra.RANGED_SLOTS.filter((s) => s.key !== 'powerUnitPart' || ra.takesPowerUnit(category)).map((slot) => ({ slot, entry: row[slot.key] ?? {}, resolved: ra.resolveRangedSlot(row[slot.key], rows) }));
    const slots = defs.map(({ slot, entry, resolved }) => B.slotView({
      key: slot.key, label: slot.label, required: slot.required, takesMaterial: slot.takesMaterial, entry, resolved,
      owned: B.ownedPartsFor(item, SOURCE, slot.category, HOST), catalog: ra.rangedPartsFor(slot.category, weaponType), libraryAccess, materialFamily: 'ranged', locked,
    }));
    const plan = this._buildPlan();
    const reclass = ra.rangedReclassification(row, rows);
    context.build = {
      provenance,
      slots,
      plan: B.planView(plan, { chapter: engine.partAcquisition.PART_CHAPTER.ranged, libraryAccess }),
      started: !!plan.started,
      family: text(ra.deriveRangedClassification?.(row, rows)?.family ?? weaponType),
      reclass: reclass ? { family: text(reclass.family), skill: text(reclass.skill) } : null,
      category: text(category),
      phases: engine.weaponBuild.rangedCraftingPhases(engine.weaponPricing.blasterBuildCarriesSilicon?.(row, rows) ?? false).map((p) => `${p.name} (${p.skill})`).join(' · '),
    };

    // ---- mods -------------------------------------------------------------------------------------
    const fg = engine.fittedGoods;
    const slotCategories = engine.weaponModData.rangedModSlotsFor(category, row.baseSkill);
    const weaponClass = engine.weaponModData.rangedWeaponClass(category, row.baseSkill);
    const modRows = rows;
    const mods = slotCategories.map((cat) => {
      const slot = fg.rangedModSlot(cat);
      if (!slot) return null;
      const current = text(row[slot.idField]);
      const owned = modRows.filter((m) => text(m.category) === cat && ((!m.equipped && !m.isInstalled) || text(m.id) === current || m[HOST] === row.id));
      return B.fittedView({ slot, item, owned, catalog: fg.rangedModsFor(cat).map((m) => ({ ...m, id: m.name })), libraryAccess, byKey: fg.rangedModByKey, locked: false });
    }).filter(Boolean);
    const tally = fg.tallyRangedMods(row, modRows);
    context.mods = {
      weaponClass: text(weaponClass),
      slots: mods,
      count: mods.length,
      tally: { weight: fig(tally.weight), value: money(tally.value), energyResBonus: num(tally.energyResBonus), damageBonus: num(tally.damageBonus), accuracyBonus: num(tally.accuracyBonus), notes: (tally.notes ?? []).map(text), chosenNotOwned: (tally.chosenNotOwned ?? []).map((c) => text(c?.name ?? c)) },
    };
    return context;
  }

  /**
   * Edits: `slot.<key>` (a structural slot), `material.<key>`, `mod.<idField>`
   * (a Ch11 mod slot), `ammo.loaded` (the pack or cell to load).
   */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const item = this.item;
    const actor = this.actor;
    const row = item.system?.row ?? {};
    const rows = this.partRows();
    const rebinds = [];
    const patch = {};
    for (const [key, value] of Object.entries(edits)) {
      let m;
      if ((m = /^slot\.([A-Za-z]+)$/.exec(key))) {
        const slotKey = m[1];
        const entry = { ...(row[slotKey] ?? {}), ...(patch[slotKey] ?? {}) };
        const current = entry.inventoryId ? B.invValue(entry.inventoryId) : entry.partId ? B.libValue(entry.partId) : '';
        if (text(value) === current) continue;
        const edit = B.slotEdit({ value, entry, ownedRows: rows, templateIdOf: (r) => text(r.partId) || text(engine.rangedAssembly.rangedPartByName(r.name)?.id) || null });
        patch[slotKey] = edit.patch;
        if (edit.previousId !== edit.nextId) rebinds.push({ previousId: edit.previousId, nextId: edit.nextId });
      } else if ((m = /^material\.([A-Za-z]+)$/.exec(key))) {
        const slotKey = m[1];
        const entry = { ...(row[slotKey] ?? {}), ...(patch[slotKey] ?? {}) };
        if (text(entry.materialId) === text(value)) continue;
        patch[slotKey] = { ...entry, materialId: text(value) || null };
      } else if ((m = /^mod\.([A-Za-z]+)$/.exec(key))) {
        const slot = Object.values(engine.fittedGoods.RANGED_MOD_SLOT_FIELDS).find((f) => f.idField === m[1]);
        if (!slot) continue;
        const current = row[slot.idField] ? B.invValue(row[slot.idField]) : row[slot.partIdField] ? B.libValue(row[slot.partIdField]) : '';
        if (text(value) === current) continue;
        const edit = B.fittedEdit({ value, slot, item, ownedRows: rows, byKey: engine.fittedGoods.rangedModByKey });
        Object.assign(patch, edit.patch);
        if (edit.previousId !== edit.nextId) rebinds.push({ previousId: edit.previousId, nextId: edit.nextId, mod: true });
      } else if (key === 'ammo.loaded') {
        if (text(value) !== text(row.loadedAmmunitionId)) Object.assign(patch, await this.#loadAmmunition(text(value)));
      }
    }
    if (Object.keys(patch).length) this._mergeRow(submitData, patch);
    if (!rebinds.length || !actor) return after;
    return async () => {
      if (typeof after === 'function') await after();
      for (const r of rebinds) await B.rebindOwnedRow(actor, { source: SOURCE, hostField: HOST, hostId: row.id, previousId: r.previousId, nextId: r.nextId, equips: true });
    };
  }

  /**
   * BlasterAmmunition.tsx:209-262 handlePowerCellChange, ported: the pack that
   * was loaded goes back to stock (stacked by name, or re-created with a fresh
   * id; an equipment-sourced cell is released instead), then the chosen pack
   * moves INTO the weapon (its stock row decremented or deleted; an equipment
   * cell is flagged installed) and the weapon's charges follow it.
   * @returns {object} the row patch
   */
  async #loadAmmunition(value) {
    const item = this.item;
    const actor = this.actor;
    const row = item.system?.row ?? {};
    const old = row.loadedAmmunitionData ?? null;
    const patch = {};
    if (actor && old) {
      if (old._isEquipSource) {
        const cell = B.ownerItemByRowId(item, old.id);
        if (cell) await cell.updateRow({ isInstalled: false, installedInBlasterId: null });
      } else {
        const stack = rowsOf(actor, 'ammunition').find((i) => i.system.row?.name === old.name && !i.system.row?.isContainer) ?? null;
        if (stack) await stack.updateRow({ quantity: (num(stack.system.row.quantity, 1) || 1) + 1 });
        else await actor.createEmbeddedDocuments('Item', [rowToItemData({ ...old, quantity: 1, id: engine.rowId(), contents: [] }, 'ammunition', nextSort(actor, 'ammunition'))]);
      }
    }
    if (!value) return { loadedAmmunitionId: null, loadedAmmunitionData: null, currentCharges: 0, maxCharges: 0 };
    const ammoItem = actor ? rowsOf(actor, 'ammunition').find((i) => i.system.row?.id === value) ?? null : null;
    if (ammoItem) {
      const selected = ammoItem.system.row;
      Object.assign(patch, { loadedAmmunitionId: selected.id, loadedAmmunitionData: { ...selected, quantity: 1 }, currentCharges: selected.currentCharges ?? null, maxCharges: selected.maxCharges ?? null });
      const qty = num(selected.quantity, 1) || 1;
      if (qty > 1) await ammoItem.updateRow({ quantity: qty - 1 }); else await ammoItem.delete();
      return patch;
    }
    const cellItem = actor ? rowsOf(actor, 'equipment').find((i) => i.system.row?.id === value) ?? null : null;
    if (cellItem) {
      const selected = cellItem.system.row;
      await cellItem.updateRow({ isInstalled: true, installedInBlasterId: row.id });
      return { loadedAmmunitionId: selected.id, loadedAmmunitionData: { ...selected, _isEquipSource: true, contents: [], type: 'Power Cell' }, currentCharges: selected.currentCharges ?? 100, maxCharges: selected.maxCharges ?? 100 };
    }
    notify('warn', fmt('SHADOWBASE.Item.Blaster.AmmoNotFound', { id: value }));
    return {};
  }
}

export default BlasterSheet;
