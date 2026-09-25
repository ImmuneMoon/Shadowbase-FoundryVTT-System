// module/apps/item-sheets/armor.mjs
//
// Armor & Clothing (armor-item-card.tsx + customized-armor-item/*):
//   main   the Piece's identity (type, slot, tier, sealed, the fit against the
//          wearer's SM - armorFit), the DR table PER LOCATION (drEntries IS the
//          tracked current DR, edited here; the listed figure beside it is
//          listedArmorDrAt - armor-item-card.tsx:759-790), the derived DR /
//          weight / cost / penalties (calculateModifiedArmor through
//          item.derived), the condition read off DR with the Maintenance
//          Protocol repair, the limb it is worn on (armorLimbAssignment.eligibleLimbs),
//          an energy shield's active state and its power cell;
//   build  Hardware Assembly (:881-1060): the catalog Piece (ARMOR_PIECES) under
//          Direct Library Access or on a custom build, the five Ch13 component
//          slots (armorAssembly.armorBuildFromParts / resolveSlotPart, the
//          ArmorComponentSelector rebind), the Frame's mod slots
//          (armorModSlots.armorModSlots) with the four mod selects
//          (ArmorModSelector: an owned row by uuid, no companion; a catalog pick
//          materialises the row; modFitProblem gates powered mods on a Wired
//          Backing), the plan (armorBuild.planArmorBuild).

import { engine } from '../../engine.mjs';
import { rowsOf, rowToItemData, nextSort } from '../../adapter.mjs';
import { modifierBadges } from '../actor-sheet-tabs.mjs';
import { ShadowBaseItemSheet, statTile, loc, fmt, notify, text, num, fig, money, signed } from './base.mjs';
import * as B from './builders.mjs';

const TAB_IDS = ['main', 'build', 'notes'];
const SOURCE = 'armorModifications';
const HOST = 'installedInArmorId';

export class ArmorSheet extends ShadowBaseItemSheet {
  static FAMILY = 'armor';
  static BUILD_FAMILY = 'armor';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('armor', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    position: { width: 760, height: 820 },
    actions: { 'reset-dr-entries': ArmorSheet.#onResetDrEntries },
  };

  craftingCategory() { return engine.armorBuild.ARMOR_CRAFTING_FAMILY; }
  partRows() { return B.ownerRows(this.item, SOURCE); }
  _buildPlan() { return engine.armorBuild.planArmorBuild(this.item.system?.row ?? {}, this.partRows()); }
  hitLocations() { return this.actor?.stats?.dynamicHitLocations ?? this.actor?.system?.hitLocations ?? []; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = this.actor;
    const row = context.row;
    const merged = context.merged;
    const d = context.derived;
    const rows = this.partRows();
    const libraryAccess = context.libraryAccess;
    const hitLocations = this.hitLocations();
    const locationName = new Map(hitLocations.map((l) => [l.id, l.name]));
    const apd = engine.armorPartsData;
    const ams = engine.armorModSlots;
    const provenance = B.provenanceView(row);
    const locked = provenance.locked;

    // ---- main -------------------------------------------------------------------------------------
    const types = [...new Set(engine.armorData.ARMOR_DATA.map((a) => a.type))];
    const slotsList = [...new Set(engine.armorData.ARMOR_DATA.map((a) => a.slot))];
    const wearerSm = actor?.system?.sizeModifier ?? 0;
    const fit = engine.armorFit.armorFit(row.itemSizeModifier ?? 0, wearerSm);
    let shield = null;
    try { shield = engine.shieldRules.shieldProfileForItem(row); } catch { shield = null; }
    const isShield = !!shield || row.type === 'Energy Shield';
    const drEntries = (Array.isArray(merged.drEntries) ? merged.drEntries : []).map((e) => {
      const listed = engine.listedArmorDrAt(merged, e.locationId, hitLocations);
      return { locationId: text(e.locationId), name: locationName.get(e.locationId) ?? text(e.locationId), dr: e.dr ?? null, listed, degraded: num(e.dr) < listed };
    });
    const worn = engine.armorLimbAssignment.eligibleLimbs(row.slot, hitLocations);
    const cells = actor ? rowsOf(actor, 'equipment').map((i) => i.system.row).filter((e) => (e.name === 'Power Cell' || text(e.name).includes('Power Pack') || e.maxCharges != null) && (!e.installedInArmorId || e.installedInArmorId === row.id)) : [];
    context.main = {
      types: types.map((t) => ({ value: t, label: t, selected: t === row.type })),
      slots: slotsList.map((s) => ({ value: s, label: s, selected: s === row.slot })),
      tiers: [{ value: '', label: loc('SHADOWBASE.Item.Armor.NoTier'), selected: !row.tier }, ...apd.ARMOR_TIERS.map((t) => ({ value: t, label: t, selected: t === row.tier }))],
      sealed: !!row.sealed,
      faceCoverage: text(row.faceCoverage),
      sleeveless: !!row.sleeveless,
      itemSizeModifier: row.itemSizeModifier ?? 0,
      wearerSm,
      fit: { label: loc(`SHADOWBASE.Item.Armor.Fit.${fit.replace('-', '')}`), ok: fit === 'Fitted', bad: fit === 'Unwearable' },
      tiles: [
        statTile(loc('SHADOWBASE.Item.Armor.DR'), d ? engine.typedResistance.formatTypedDR(d.finalDRValue ?? 0, d.typedDR ?? []) : merged.finalDRValue),
        statTile(loc('SHADOWBASE.Item.Armor.Weight'), fig(merged.finalWeight ?? row.weight)),
        statTile(loc('SHADOWBASE.Item.Armor.Cost'), money(merged.finalCost ?? row.cost)),
        statTile(loc('SHADOWBASE.Item.Armor.MovePenalty'), signed(num(merged.finalMovePenalty))),
        statTile(loc('SHADOWBASE.Item.Armor.DxPenalty'), signed(num(merged.finalDXPenalty))),
      ],
      drNotes: text(d?.finalDRNotes),
      drEntries,
      hasDrEntries: drEntries.length > 0,
      baseDR: merged.baseDRValue ?? null,
      condition: B.conditionBadge(d?.derivedCondition ?? merged.condition),
      canRepair: drEntries.some((e) => e.degraded),
      isClothing: row.type === 'Clothing',
      durability: row.durability ?? null,
      wornLocation: { current: text(row.wornLocationId), options: [{ value: '', label: loc('SHADOWBASE.Item.Armor.NoLimb'), selected: !row.wornLocationId }, ...worn.map((l) => ({ value: text(l.id), label: text(l.name), selected: text(l.id) === text(row.wornLocationId) }))], available: worn.length > 0 },
      coverage: (row.coveredLocationIds ?? []).map((id) => locationName.get(id) ?? text(id)),
      setId: text(row.setId),
      isShield,
      shield: shield ? { dr: num(shield.dr), activeDr: num(engine.shieldRules.shieldActiveDR(row)), note: text(shield.note ?? shield.effect) } : null,
      isActive: !!row.isActive,
      utilityId: text(row.utilityId),
      cell: { current: row.loadedPowerCellId ? text(row.loadedPowerCellId) : '', options: [{ value: '', label: loc('SHADOWBASE.Item.Armor.NoCell'), selected: !row.loadedPowerCellId }, ...cells.map((c) => ({ value: text(c.id), label: `${text(c.name)} (${num(c.currentCharges)}/${num(c.maxCharges)})`, selected: text(c.id) === text(row.loadedPowerCellId) }))], currentCharges: merged.currentCharges ?? null, maxCharges: merged.maxCharges ?? null },
      modifiers: modifierBadges(row.modifiers ?? null),
      hasBag: engine.hasAnyModifier(row.modifiers ?? engine.NO_MODIFIERS),
      flags: { isConstructed: row.isConstructed !== false, flawed: row.flawedBuild === true, isCustomBuild: !!row.isCustomBuild, isSeveredRemnant: !!row.isSeveredRemnant, modifiedForAnatomy: !!row.modifiedForAnatomy },
      penalties: text(row.penalties),
      effects: text(row.effects),
      inCatalog: engine.armorData.ARMOR_DATA.some((a) => a.name === row.name),
      weightEditable: engine.weightEditability.isWeightEditable(engine.weightEditability.armorWeightSource(row)),
    };

    // ---- build ------------------------------------------------------------------------------------
    const aa = engine.armorAssembly;
    const build = aa.armorBuildFromParts(row, rows);
    const location = build.location ?? (apd.ARMOR_LOCATIONS.includes(row.slot) ? row.slot : null);
    const partSlots = apd.ARMOR_PART_CATEGORIES.map((category) => {
      const field = apd.PART_SLOT_FIELD[category];
      const entry = row[field] ?? {};
      const resolved = aa.resolveSlotPart(entry, rows);
      const owned = rows.filter((r) => text(r.category) === category && (!r.isInstalled || r[HOST] === row.id));
      const catalog = apd.armorPartsFor(category, location, { tier: category === 'Armor Shell' ? (row.tier ?? null) : null, materialId: category === 'Armor Visor' ? (build.materialId ?? row.materialId ?? null) : null });
      const view = B.slotView({ key: field, label: text(aa.PART_SLOT_LABEL[category]), required: aa.REQUIRED_PART_CATEGORIES.includes(category), takesMaterial: false, entry: { partId: entry.partId ?? null, inventoryId: entry.inventoryId ?? null }, resolved: { template: resolved.part ?? null, material: null, ownedRowId: resolved.inventoryId, chosenNotOwned: !resolved.inventoryId && !!resolved.part }, owned, catalog, libraryAccess, locked });
      return { ...view, category, part: resolved.part ? { name: text(resolved.part.name), dr: resolved.part.dr ?? null, weight: fig(resolved.part.weight), cost: money(resolved.part.cost), notes: text(resolved.part.notes) } : null };
    });
    const modSlots = ams.armorModSlots(row);
    const hostsPowered = ams.hostsPoweredMods(row);
    const mods = modSlots.types.map((type) => {
      const field = ams.FIELD_BY_SLOT_TYPE[type];
      const category = ams.CATEGORY_BY_SLOT_TYPE[type];
      const current = text(row[field]);
      const owned = rows.filter((m) => text(m.category) === category && (!m.equipped && !m.isInstalled || text(m.id) === current || m[HOST] === row.id) && (!Array.isArray(m.validSlots) || !m.validSlots.length || m.validSlots.includes(row.slot)));
      const catalog = engine.armorMods.ARMOR_MOD_DATA.map((m, i) => ({ ...m, id: `${i}` })).filter((m) => m.category === category && (m.validSlots ?? []).includes(row.slot));
      const select = B.slotOptions({ owned, catalog, libraryAccess, current: { inventoryId: current || null, partId: null }, keyOf: (m) => text(m.id), labelOf: (m) => `${text(m.name)} (${money(m.cost)} cr)${ams.modFitProblem(row, m) ? ` - ${ams.modFitProblem(row, m)}` : ''}`, rowLabelOf: (m) => `${text(m.name)}${ams.modFitProblem(row, m) ? ` - ${ams.modFitProblem(row, m)}` : ''}` });
      const fitted = current ? rows.find((m) => text(m.id) === current) ?? null : null;
      return { type, field, category, label: loc(`SHADOWBASE.Item.Armor.ModSlot.${type}`), select, isNone: select.isNone, fitted: fitted ? { name: text(fitted.name), effect: text(fitted.notes), drBonus: fitted.drBonus ?? null } : null, emptyReason: text(select.emptyReason), free: ams.canFitMod(row, type) };
    });
    const plan = this._buildPlan();
    const piece = row.pieceId ? engine.armorPiecesData.armorPieceById(row.pieceId) : null;
    const pieces = engine.armorPiecesData.ARMOR_PIECES.filter((p) => !location || p.location === location);
    context.build = {
      provenance,
      canChoosePiece: !!row.isCustomBuild || libraryAccess,
      piece: piece ? { name: text(piece.name), tier: text(piece.tier), frame: text(piece.frame), dr: piece.dr ?? null, modSlots: piece.modSlots ?? null, sealed: !!piece.sealed } : null,
      pieces: [{ value: '', label: loc('SHADOWBASE.Item.Armor.NoPiece'), selected: !row.pieceId }, ...pieces.map((p) => ({ value: text(p.id), label: `${text(p.name)} (${money(p.cost)} cr)`, selected: text(p.id) === text(row.pieceId) }))],
      partSlots,
      buildState: { location: text(build.location), tier: text(build.tier), material: text(engine.armorPiecesData.armorMaterialById?.(build.materialId)?.name ?? build.materialId), frame: text(build.frame), sealed: !!build.sealed, missing: (build.missing ?? []).map((c) => text(aa.PART_SLOT_LABEL[c] ?? c)), partsSpend: money(build.partsSpend), partsWeight: fig(build.partsWeight), derived: build.derived ? { dr: build.derived.dr ?? null, weight: fig(build.derived.weight), cost: money(build.derived.marketCost ?? build.derived.cost), modSlots: build.derived.modSlots ?? null } : null, warnings: (build.warnings ?? []).map(text) },
      modSlots: { total: modSlots.total, fromPiece: !!modSlots.fromPiece, frame: text(modSlots.frame), tier: text(modSlots.tier), hostsPowered },
      mods,
      plan: B.planView({ ...plan, started: plan.started ?? (build.fitted?.length > 0) }, { chapter: engine.partAcquisition.PART_CHAPTER.armor, libraryAccess }),
      phases: engine.armorBuild.armorCraftingPhases().map((p) => `${p.name} (${p.skill})`).join(' · '),
    };
    return context;
  }

  /**
   * Edits: `armorSlot.<field>` (a Ch13 component slot), `armorMod.<field>` (a
   * mod slot), `dr.<locationId>` (the tracked current DR of one entry), `piece`
   * (the catalog Piece), `cell` (the power cell an energy shield draws from).
   */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const item = this.item;
    const actor = this.actor;
    const row = item.system?.row ?? {};
    const rows = this.partRows();
    const apd = engine.armorPartsData;
    const ams = engine.armorModSlots;
    const rebinds = [];
    const creates = [];
    const patch = {};
    let drEntries = null;
    for (const [key, value] of Object.entries(edits)) {
      let m;
      if ((m = /^armorSlot\.([A-Za-z]+)$/.exec(key))) {
        const field = m[1];
        if (!Object.values(apd.PART_SLOT_FIELD).includes(field)) continue;
        const entry = { ...(row[field] ?? {}) };
        const current = entry.inventoryId ? B.invValue(entry.inventoryId) : entry.partId ? B.libValue(entry.partId) : '';
        if (text(value) === current) continue;
        const edit = B.slotEdit({ value, entry, ownedRows: rows, templateIdOf: (r) => text(r.partId) || null });
        // Ch13 component slots carry { partId, inventoryId } only (armorComponentSlotSchema).
        patch[field] = { partId: edit.patch.partId ?? null, inventoryId: edit.patch.inventoryId ?? null };
        if (edit.previousId !== edit.nextId) rebinds.push({ previousId: edit.previousId, nextId: edit.nextId });
      } else if ((m = /^armorMod\.([A-Za-z]+)$/.exec(key))) {
        const field = m[1];
        const type = Object.keys(ams.FIELD_BY_SLOT_TYPE).find((t) => ams.FIELD_BY_SLOT_TYPE[t] === field);
        if (!type) continue;
        const current = text(row[field]) || null;
        const choice = B.decodeChoice(value);
        if ((choice.kind === 'none' && !current) || (choice.kind === 'inv' && choice.id === current)) continue;
        if (choice.kind === 'none') { patch[field] = null; rebinds.push({ previousId: current, nextId: null, mod: true }); continue; }
        if (choice.kind === 'inv') {
          const owned = rows.find((r) => text(r.id) === choice.id);
          const problem = owned ? ams.modFitProblem(row, owned) : null;
          if (problem) { notify('warn', problem); continue; }
          patch[field] = choice.id; rebinds.push({ previousId: current, nextId: choice.id, mod: true }); continue;
        }
        // ArmorModSelector.tsx:149-170: a catalog mod becomes a real armorModifications row, then the slot binds it.
        const template = engine.armorMods.ARMOR_MOD_DATA[Number(choice.id)];
        if (!template || !actor) continue;
        const problem = ams.modFitProblem(row, template);
        if (problem) { notify('warn', problem); continue; }
        const id = engine.rowId();
        creates.push(rowToItemData({ id, name: template.name, category: template.category, cost: num(template.cost), weight: num(template.weight), notes: text(template.gurpsEffect), drBonus: template.drBonus ?? null, validSlots: template.validSlots ?? [], equipped: true, quantity: 1, isInstalled: true, [HOST]: row.id }, SOURCE, nextSort(actor, SOURCE)));
        patch[field] = id;
        if (current) rebinds.push({ previousId: current, nextId: null, mod: true });
      } else if ((m = /^dr\.(.+)$/.exec(key))) {
        drEntries ??= (Array.isArray(row.drEntries) ? row.drEntries : []).map((e) => ({ ...e }));
        const entry = drEntries.find((e) => text(e.locationId) === m[1]);
        if (!entry) continue;
        const dr = value === '' || value === null ? 0 : Math.max(0, num(value));
        if (num(entry.dr) !== dr) entry.dr = dr;
      } else if (key === 'piece') {
        if (text(value) === text(row.pieceId)) continue;
        const piece = value ? engine.armorPiecesData.armorPieceById(text(value)) : null;
        if (!piece) { patch.pieceId = null; continue; }
        // ArmorBaseInfo.tsx: choosing a catalog Piece re-Pieces the item - its tier, material, frame, seal and listed DR follow.
        Object.assign(patch, { pieceId: piece.id, tier: piece.tier, materialId: piece.materialId, frame: piece.frame, sealed: !!piece.sealed, baseDRValue: piece.dr, weight: num(piece.weight), cost: num(piece.cost) });
      } else if (key === 'cell') {
        if (text(value) === text(row.loadedPowerCellId)) continue;
        const prev = row.loadedPowerCellId ? B.ownerItemByRowId(item, row.loadedPowerCellId) : null;
        const next = value ? B.ownerItemByRowId(item, text(value)) : null;
        patch.loadedPowerCellId = next ? text(value) : null;
        patch.loadedPowerCellData = next ? { ...next.system.row } : null;
        if (actor) {
          const updates = [];
          if (prev) updates.push({ _id: prev.id, 'system.row.isInstalled': false, 'system.row.installedInArmorId': null });
          if (next) updates.push({ _id: next.id, 'system.row.isInstalled': true, 'system.row.installedInArmorId': row.id });
          if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
        }
      }
    }
    if (drEntries) patch.drEntries = drEntries;
    if (Object.keys(patch).length) this._mergeRow(submitData, patch);
    if (!actor || (!rebinds.length && !creates.length)) return after;
    return async () => {
      if (typeof after === 'function') await after();
      if (creates.length) await actor.createEmbeddedDocuments('Item', creates);
      // Component slots install without equipping (armor-build.ts consumeForBuild); mods equip too (ArmorModSelector handleModChange).
      for (const r of rebinds) await B.rebindOwnedRow(actor, { source: SOURCE, hostField: HOST, hostId: row.id, previousId: r.previousId, nextId: r.nextId, equips: !!r.mod });
    };
  }

  /** Regenerate the per-location DR entries from the wearer's anatomy (character-sheet-helpers generateDefaultDrEntries). */
  static async #onResetDrEntries() {
    const hitLocations = this.actor?.system?.hitLocations ?? [];
    if (!hitLocations.length) return notify('warn', loc('SHADOWBASE.Item.Armor.NoAnatomy'));
    const entries = engine.sheetHelpers.generateDefaultDrEntries(this.item.system?.row ?? {}, hitLocations);
    await this.item.updateRow({ drEntries: entries, coveredLocationIds: entries.map((e) => e.locationId) });
    return notify('info', fmt('SHADOWBASE.Item.Armor.DrEntriesReset', { count: entries.length }));
  }
}

export default ArmorSheet;
