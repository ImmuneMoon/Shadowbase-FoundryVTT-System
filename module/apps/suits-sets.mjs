// module/apps/suits-sets.mjs
//
// SuitsAndSets (docs/ARCHITECTURE.md §6.5): two website components in one
// ApplicationV2 window over the actor's armor rows -
//
//   preset-suit-dialog.tsx   the Ch13 set picker: Preset Suits (Ch13 Pieces, dealt
//                            by armorPieceItem.presetSuitItems - the ONE builder that
//                            names each piece the way the suit table does, stamps the
//                            setId, honours the suit's Sealed flags and deals per-limb
//                            gear one row per limb), Specialty Armor Sets and
//                            Coordinated Clothing Sets (flat library rows through
//                            armorProfileItem.profileToArmorItem);
//   gear-set-panel.tsx       the outfits panel: handbook sets recognised from
//                            inventory (gearSets.recogniseSets), custom sets from
//                            system.gearSets (resolveCustomSet), the leftover worn kit
//                            (unmatchedWornGear), Equip all / Unequip all through
//                            applySetEquip (Ch13's one base layer per location), the
//                            set bonuses while earned (activeSetBonuses), and the
//                            custom-set editor (gear-set-editor-dialog.tsx) as a DialogV2.
//
// The set LISTING is composed here from the catalogs exactly as the dialog
// composes it (resolvePreset / resolveGearSet, cited) - a display projection,
// not a rule; every figure it prints is the catalog's. Custom sets are the
// only thing stored (`system.gearSets`, written whole).

import { engine } from '../engine.mjs';
import { ActorSubApp, TEMPLATE_ROOT, loc, fmt, notify, num, text, sheetOf, storedRows, syncRows, writeWholeArray, itemByRowId, formDialog, readField, esc } from './sub-app.mjs';

const P = engine.armorPiecesData;
const pieceById = (id) => P.ARMOR_PIECES.find((p) => p.id === id);
const materialName = (id) => P.ARMOR_MATERIALS.find((m) => m.id === id)?.name ?? id;
const profileByName = () => new Map(engine.armorData.ARMOR_DATA.map((p) => [p.name, p]));
/** preset-suit-dialog.tsx:60-63 - set rows that live in the inventory, not the armour list. */
const outOfSlotNames = () => new Set([...P.FACE_GADGETS.map((g) => g.name), ...P.BELTS.map((b) => b.name)]);
/** preset-suit-dialog.tsx:196 - the slots the sheet deals into. */
export const ARMOR_SLOTS = Object.freeze(new Set(['Head', 'Torso', 'Legs', 'Hands', 'Feet']));
export const GROUP_ORDER = Object.freeze(['Preset Suits', 'Specialty Armor Sets', 'Coordinated Clothing Sets']);
/** gear-set-panel.tsx:29-35. */
const KIND_LABEL = Object.freeze({ 'Preset Suit': 'PresetSuit', 'Specialty Armor': 'SpecialtyArmor', 'Coordinated Clothing': 'ClothingSet', Custom: 'Custom', Worn: 'Worn' });

/** preset-suit-dialog.tsx:104-149 resolvePreset. */
export function resolvePreset(suit) {
  const rows = [];
  const unresolved = [];
  for (const entry of suit.pieces) {
    const piece = pieceById(entry.pieceId);
    if (!piece) { unresolved.push(entry.pieceId); continue; }
    rows.push({ key: `${entry.location}-${entry.pieceId}`, location: String(entry.location), name: entry.name ?? piece.name, dr: String(piece.dr), weight: piece.weight, cost: piece.cost, sealed: !!entry.sealed, sleeveless: !!entry.sleeveless, quantity: entry.quantity ?? 1, piece });
  }
  const first = rows[0]?.piece;
  const tier = engine.armorTier.suitTier(rows.map((r) => r.piece));
  return {
    id: suit.id, name: suit.name, group: 'Preset Suits',
    subtitle: first ? `${materialName(first.materialId)} · ${tier ? `${tier} tier` : 'mixed classes'}` : '',
    note: 'Each location keeps its own DR; they are not summed.',
    rows, unresolved, tier,
    weight: rows.reduce((s, r) => s + r.weight * r.quantity, 0),
    cost: rows.reduce((s, r) => s + r.cost * r.quantity, 0),
  };
}

/** preset-suit-dialog.tsx:152-188 resolveGearSet. */
export function resolveGearSet(set) {
  const profiles = profileByName();
  const skip = outOfSlotNames();
  const rows = [];
  const unresolved = [];
  for (const p of set.pieces) {
    const profile = profiles.get(p.name);
    if (!profile && !skip.has(p.name)) { unresolved.push(p.name); continue; }
    rows.push({ key: `${p.slot}-${p.name}`, location: p.slot, name: p.name, dr: p.dr ?? '—', weight: p.weight, cost: p.cost, quantity: 1, sealed: false, sleeveless: false, profile });
  }
  return {
    id: set.id, name: set.name, group: set.kind === 'Armor' ? 'Specialty Armor Sets' : 'Coordinated Clothing Sets',
    subtitle: set.tier ? `${set.material} · ${set.tier} tier` : '', note: set.note ?? '',
    rows, unresolved, tier: engine.armorTier.ARMOR_TIER_ORDER.includes(set.tier) ? set.tier : null,
    weight: set.totalWeight, cost: set.totalCost,
  };
}

/** Every set the picker lists (:223-230). */
export function resolvedSets() {
  return [...P.PRESET_SUITS.map(resolvePreset), ...P.SPECIALTY_ARMOR_SETS.map(resolveGearSet), ...P.COORDINATED_CLOTHING_SETS.map(resolveGearSet)];
}

/**
 * The armor rows a set deals out (:305-334 handleAdd): a Preset Suit through
 * presetSuitItems + ensureCompleteArmorItem, a library set through profileToArmorItem.
 * PURE - the check pins the Combat Suit's seven names against the chapter's.
 */
export function itemsForSet(set, { equipped = true, wearerSM = 0, hitLocations = [] } = {}) {
  if (set.group === 'Preset Suits') {
    return engine.armorPieceItem.presetSuitItems(set.id, { equipped, itemSizeModifier: wearerSM, hitLocations, omit: set.rows.filter((r) => !ARMOR_SLOTS.has(r.location)).map((r) => r.location) })
      .map((item) => engine.ensureCompleteArmorItem(item, hitLocations));
  }
  return set.rows.flatMap((row) => {
    if (!ARMOR_SLOTS.has(row.location) || !row.profile) return [];
    return engine.armorProfileItem.profileToArmorItem(row.profile, 1, hitLocations, wearerSM).map((item) => ({ ...item, equipped }));
  });
}

/** gear-set-panel.tsx:42-43 - the leftover group is recomputed, not stored. */
const isStoredCustom = (set) => set.source === 'custom' && set.id !== engine.gearSets.WORN_GEAR_SET_ID;
const isItemWorn = (item) => !!item.equipped && !item.isInstalled && !item.storageLocationId;
/** gear-set-panel.tsx:399-403 limbLabel. */
const limbLabel = (item, expectedName) => { const m = String(item.name ?? '').match(/\(([^)]+)\)\s*$/); if (m) return m[1]; return String(item.name ?? '').replace(expectedName, '').trim() || item.name; };

export class SuitsAndSets extends ActorSubApp {
  static APP_NAME = 'suits-sets';
  static TITLE_KEY = 'SHADOWBASE.Apps.Suits.WindowTitle';
  static FIELD_PREFIX = 'suits.';

  static DEFAULT_OPTIONS = {
    window: { title: 'SHADOWBASE.Apps.Suits.WindowTitle', icon: 'fa-solid fa-layer-group', resizable: true },
    position: { width: 720, height: 780 },
    actions: {
      'select-set': SuitsAndSets.onSelectSet,
      'set-tier': SuitsAndSets.onSetTier,
      'add-set': SuitsAndSets.onAddSet,
      'equip-set': SuitsAndSets.onEquipSet,
      'unequip-set': SuitsAndSets.onUnequipSet,
      'toggle-piece': SuitsAndSets.onTogglePiece,
      'toggle-item': SuitsAndSets.onToggleItem,
      'new-set': SuitsAndSets.onNewSet,
      'edit-set': SuitsAndSets.onEditSet,
      'delete-set': SuitsAndSets.onDeleteSet,
    },
  };

  static PARTS = { suits: { template: `${TEMPLATE_ROOT}/suits-sets.hbs`, scrollable: [''] } };

  /** The picker's state (:207-210). */
  picker = { selectedId: null, equipOnAdd: true, query: '', tier: null };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.suits = this.#pickerContext();
    context.sets = this.#setsContext();
    return context;
  }

  /** preset-suit-dialog.tsx:232-303. */
  #pickerContext() {
    const sets = resolvedSets();
    const query = this.picker.query.trim().toLowerCase();
    const byQuery = query ? sets.filter((s) => s.name.toLowerCase().includes(query) || s.group.toLowerCase().includes(query) || s.rows.some((r) => r.name.toLowerCase().includes(query))) : sets;
    const byClass = this.picker.tier ? byQuery.filter((s) => s.tier === this.picker.tier) : byQuery;
    const order = engine.armorTier.ARMOR_TIER_ORDER;
    const visible = [...byClass].sort((a, b) => (a.tier ? order.indexOf(a.tier) : order.length) - (b.tier ? order.indexOf(b.tier) : order.length));
    if (this.picker.selectedId && !visible.some((s) => s.id === this.picker.selectedId)) this.picker.selectedId = null;
    const selected = visible.find((s) => s.id === this.picker.selectedId) ?? null;
    const counts = { Light: 0, Medium: 0, Heavy: 0 };
    for (const s of sets) if (s.tier) counts[s.tier] += 1;
    const worn = storedRows(this.actor, 'armor');
    const occupied = new Set(worn.filter((i) => i.equipped && !i.isInstalled).map((i) => String(i.slot)));
    const conflicts = selected ? selected.rows.filter((r) => occupied.has(r.location)).map((r) => r.location) : [];
    const skipped = selected?.rows.filter((r) => !ARMOR_SLOTS.has(r.location)) ?? [];
    const groups = GROUP_ORDER.map((group) => ({ group, label: loc(`SHADOWBASE.Apps.Suits.Group.${group.replace(/\s/g, '')}`), items: visible.filter((s) => s.group === group).map((s) => ({
      id: s.id, name: s.name, tier: s.tier, tierClass: s.tier ? s.tier.toLowerCase() : '', selected: s.id === selected?.id,
      pieces: s.rows.reduce((n, r) => n + r.quantity, 0), weight: s.weight.toFixed(2), cost: s.cost.toLocaleString(),
      rows: s.rows.map((r) => ({ key: r.key, location: r.location, name: r.name, quantity: r.quantity, many: r.quantity > 1, sealed: r.sealed, sleeveless: r.sleeveless, dr: r.dr, weight: r.weight, cost: r.cost.toLocaleString() })),
      unresolved: s.unresolved.join(', '), footnote: [s.subtitle, s.note].filter(Boolean).join(' · '),
    })) })).filter((g) => g.items.length > 0);
    return {
      query: this.picker.query, equipOnAdd: this.picker.equipOnAdd,
      tiers: [{ value: '', label: loc('SHADOWBASE.Apps.Suits.All'), count: null, active: !this.picker.tier }, ...order.map((t) => ({ value: t, label: t, count: counts[t], active: this.picker.tier === t }))],
      tierNote: !!this.picker.tier,
      groups, hasGroups: groups.length > 0,
      selected: selected ? { id: selected.id, name: selected.name } : null,
      conflicts: conflicts.join(', '), hasConflicts: conflicts.length > 0,
      skipped: skipped.map((r) => r.name).join(', '), hasSkipped: skipped.length > 0, skippedOne: skipped.length === 1,
      addLabel: selected ? fmt('SHADOWBASE.Apps.Suits.AddNamed', { name: selected.name }) : loc('SHADOWBASE.Apps.Suits.AddSet'),
    };
  }

  /** gear-set-panel.tsx:51-103, 167-281. */
  #setsContext() {
    const sheet = sheetOf(this.actor);
    const armor = storedRows(this.actor, 'armor');
    const hitLocations = this.actor.system?.hitLocations ?? [];
    const customRecords = Array.isArray(this.actor.system?.gearSets) ? this.actor.system.gearSets : [];
    const characterSM = num(this.actor.system?.sizeModifier);
    const armorModifications = sheet?.armorModifications ?? storedRows(this.actor, 'armorModifications');
    // :65-74 - the same figures the equipment totals count (SM-scaled through calculateModifiedArmor).
    const scaled = (item) => { const m = engine.calculateModifiedArmor(item, armorModifications, characterSM, hitLocations); return { weight: m?.finalWeight ?? num(item.weight), cost: m?.finalCost ?? num(item.cost) }; };
    const G = engine.gearSets;
    const recognised = G.recogniseSets(armor, hitLocations, scaled);
    const custom = customRecords.map((r) => G.resolveCustomSet(r, armor, hitLocations, scaled));
    const named = [...custom, ...recognised];
    const leftovers = G.unmatchedWornGear(armor, hitLocations, named, scaled);
    const sets = leftovers ? [...named, leftovers] : named;
    const bonuses = G.activeSetBonuses(armor);
    const list = sets.map((set) => {
      // gear-set-panel.tsx:170 reads `p.item` (the first of a per-limb pair); Equip all here moves EVERY limb's item,
      // the intent its per-limb row comment states ("the parent toggle moves all of them at once").
      const memberIds = set.pieces.flatMap((p) => p.items.map((i) => i.id));
      const complete = set.kind !== 'Worn' && set.applicableCount > 0 && set.ownedCount === set.applicableCount;
      const allWorn = memberIds.length > 0 && set.equippedCount === set.applicableCount;
      const stored = isStoredCustom(set);
      return {
        id: set.id, name: set.name, kind: loc(`SHADOWBASE.Apps.Suits.Kind.${KIND_LABEL[set.kind] ?? 'Custom'}`), complete, allWorn, stored, isWorn: set.kind === 'Worn',
        equippedCount: set.equippedCount, applicableCount: set.applicableCount, weight: set.weight.toFixed(2), cost: set.cost.toLocaleString(),
        memberIds: memberIds.join(','), canEquipAll: memberIds.length > 0 && !allWorn, canUnequipAll: set.equippedCount > 0,
        missing: set.missingIds.length, missingOne: set.missingIds.length === 1,
        bonuses: bonuses.filter((b) => set.pieces.some((p) => p.item?.name?.startsWith(b.setName))).map((b) => ({ id: b.id, reason: b.reason, description: b.description })),
        note: text(set.note),
        editLabel: loc(stored ? 'SHADOWBASE.Apps.Suits.Edit' : set.kind === 'Worn' ? 'SHADOWBASE.Apps.Suits.SaveAsSet' : 'SHADOWBASE.Apps.Suits.Customise'),
        pieces: set.pieces.map((piece) => ({
          key: piece.key, slot: piece.slot, expectedName: piece.expectedName, notApplicable: !!piece.notApplicable, owned: !!piece.item,
          name: piece.item ? (piece.items.length > 1 ? `${piece.expectedName} (${piece.items.length})` : piece.item.name) : piece.expectedName,
          itemIds: piece.items.map((i) => i.id).join(','), equipped: !!piece.equipped, partial: !!piece.partiallyEquipped,
          toggleLabel: loc(piece.equipped ? 'SHADOWBASE.Apps.Suits.Worn' : piece.partiallyEquipped ? 'SHADOWBASE.Apps.Suits.Partial' : 'SHADOWBASE.Apps.Suits.Equip'),
          perLimb: piece.items.length > 1 ? piece.items.map((item) => ({ id: item.id, label: limbLabel(item, piece.expectedName), worn: isItemWorn(item), toggleLabel: loc(isItemWorn(item) ? 'SHADOWBASE.Apps.Suits.Worn' : 'SHADOWBASE.Apps.Suits.Equip') })) : [],
        })),
      };
    });
    return { list, hasSets: list.length > 0 };
  }

  async _onOwnField(field, value) {
    switch (field) {
      case 'query': this.picker.query = String(value ?? ''); return true;
      case 'equipOnAdd': this.picker.equipOnAdd = value === true || value === 'true' || value === 'on'; return false;
      case 'selected': this.picker.selectedId = value ? String(value) : null; return true;
      default: return false;
    }
  }

  // ---------------------------------------------------------------------------
  // The picker's Add (preset-suit-dialog.tsx:305-334)
  // ---------------------------------------------------------------------------

  /** Deal the selected set's rows onto the actor as armor Items. */
  async addSet(setId = this.picker.selectedId) {
    const set = resolvedSets().find((s) => s.id === setId);
    if (!set) { notify('warn', loc('SHADOWBASE.Apps.Suits.PickASet')); return null; }
    const wearerSM = num(this.actor.system?.sizeModifier);
    const hitLocations = this.actor.system?.hitLocations ?? [];
    const items = itemsForSet(set, { equipped: this.picker.equipOnAdd, wearerSM, hitLocations });
    if (!items.length) { notify('warn', fmt('SHADOWBASE.Apps.Suits.NothingToDeal', { name: set.name })); return null; }
    await syncRows(this.actor, 'armor', [...storedRows(this.actor, 'armor'), ...items]);
    notify('info', fmt('SHADOWBASE.Apps.Suits.Added', { name: set.name, count: items.length }));
    this.picker.selectedId = null;
    await this.render();
    return items;
  }

  // ---------------------------------------------------------------------------
  // The sets panel (gear-set-panel.tsx:109-152)
  // ---------------------------------------------------------------------------

  /** :109-120 setEquipped - applySetEquip over the whole armor list, the displaced pieces named. */
  async setEquipped(ids, equip) {
    const actor = this.actor;
    const rows = storedRows(actor, 'armor');
    const { armor, displaced } = engine.gearSets.applySetEquip(rows, ids, equip);
    const updates = [];
    for (const next of armor) {
      const own = itemByRowId(actor, next.id);
      if (!own) continue;
      const before = own.system.row;
      if (!!before.equipped !== !!next.equipped) updates.push({ _id: own.id, 'system.row.equipped': !!next.equipped });
    }
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    if (displaced.length) notify('info', fmt('SHADOWBASE.Apps.Loadout.BaseLayerSwapped', { names: displaced.map((d) => d.name).join(', ') }));
    return { updated: updates.length, displaced };
  }

  /** :122-129 saveSet - the whole gearSets array. */
  async saveSet(record) {
    const existing = Array.isArray(this.actor.system?.gearSets) ? this.actor.system.gearSets : [];
    const idx = existing.findIndex((s) => s.id === record.id);
    const next = idx > -1 ? existing.map((s) => (s.id === record.id ? record : s)) : [...existing, record];
    await writeWholeArray(this.actor, 'gearSets', next);
    return record;
  }

  async deleteSet(id) {
    const existing = Array.isArray(this.actor.system?.gearSets) ? this.actor.system.gearSets : [];
    await writeWholeArray(this.actor, 'gearSets', existing.filter((s) => s.id !== id));
    return true;
  }

  /**
   * :141-152 openEditor + gear-set-editor-dialog.tsx: a name and a checklist of
   * the wearable armor. Editing a recognised set FORKS a custom one seeded from
   * what the player has of it. `given` skips the dialog (the check's seam).
   */
  async editSet(setId = null, given = null) {
    const armor = storedRows(this.actor, 'armor');
    const hitLocations = this.actor.system?.hitLocations ?? [];
    const G = engine.gearSets;
    const customRecords = Array.isArray(this.actor.system?.gearSets) ? this.actor.system.gearSets : [];
    const all = [...customRecords.map((r) => G.resolveCustomSet(r, armor, hitLocations)), ...G.recogniseSets(armor, hitLocations)];
    const leftovers = G.unmatchedWornGear(armor, hitLocations, all);
    const set = setId ? [...all, ...(leftovers ? [leftovers] : [])].find((s) => s.id === setId) ?? null : null;
    const wornIds = armor.filter((a) => a.equipped && !a.isInstalled && !a.storageLocationId).map((a) => a.id);
    const seed = set
      ? { id: isStoredCustom(set) ? set.id : engine.rowId(), name: isStoredCustom(set) ? set.name : `${set.name} (Custom)`, memberIds: set.pieces.flatMap((p) => (p.item ? [p.item.id] : [])) }
      : { id: engine.rowId(), name: 'New Set', memberIds: wornIds };
    let answer = given;
    if (!answer) {
      const wearable = armor.filter((a) => !a.isInstalled && !a.storageLocationId);
      const list = wearable.map((a) => `<label class="sb-check-row"><input type="checkbox" name="member.${esc(a.id)}"${seed.memberIds.includes(a.id) ? ' checked' : ''}> <span>${esc(a.name)}</span> <span class="sb-badge sb-badge-outline">${esc(a.slot ?? '')}</span></label>`).join('');
      answer = await formDialog({
        title: loc('SHADOWBASE.Apps.Suits.EditorTitle'), icon: 'fa-solid fa-layer-group',
        content: `<div class="shadowbase sb-app-dialog__body"><div class="form-group"><label>${esc(loc('SHADOWBASE.Apps.Suits.SetName'))}</label><input type="text" name="name" value="${esc(seed.name)}"></div><p class="sb-muted-p">${esc(loc('SHADOWBASE.Apps.Suits.EditorHint'))}</p><div class="sb-app-dialog__list">${list || `<p class="sb-muted-p">${esc(loc('SHADOWBASE.Apps.Suits.NothingWearable'))}</p>`}</div></div>`,
        okLabel: loc('SHADOWBASE.Apps.Suits.SaveSet'),
        read: (form) => ({ name: String(readField(form, 'name') ?? '').trim(), memberIds: wearable.filter((a) => readField(form, `member.${a.id}`) === true).map((a) => a.id) }),
      });
    }
    if (!answer) return null;
    const record = { id: seed.id, name: answer.name || seed.name, memberIds: Array.isArray(answer.memberIds) ? answer.memberIds : seed.memberIds };
    await this.saveSet(record);
    await this.render();
    return record;
  }

  static async onSelectSet(event, target) { event?.preventDefault?.(); const id = target?.dataset?.setId; this.picker.selectedId = this.picker.selectedId === id ? null : id; await this.render(); return this.picker.selectedId; }
  static async onSetTier(event, target) { event?.preventDefault?.(); const t = target?.dataset?.tier || null; this.picker.tier = this.picker.tier === t ? null : t; await this.render(); return this.picker.tier; }
  static async onAddSet(event) { event?.preventDefault?.(); return this.addSet(); }
  static async onEquipSet(event, target) { event?.preventDefault?.(); const ids = String(target?.dataset?.itemIds ?? '').split(',').filter(Boolean); return this.setEquipped(ids, true); }
  static async onUnequipSet(event, target) { event?.preventDefault?.(); const ids = String(target?.dataset?.itemIds ?? '').split(',').filter(Boolean); return this.setEquipped(ids, false); }
  /** :215 - a row's toggle moves every limb's item at once. */
  static async onTogglePiece(event, target) { event?.preventDefault?.(); const ids = String(target?.dataset?.itemIds ?? '').split(',').filter(Boolean); if (!ids.length) return null; return this.setEquipped(ids, target?.dataset?.equipped !== 'true'); }
  static async onToggleItem(event, target) { event?.preventDefault?.(); const id = target?.dataset?.itemId; if (!id) return null; const row = storedRows(this.actor, 'armor').find((a) => a.id === id); return this.setEquipped([id], !(row && isItemWorn(row))); }
  static async onNewSet(event) { event?.preventDefault?.(); return this.editSet(null); }
  static async onEditSet(event, target) { event?.preventDefault?.(); return this.editSet(target?.dataset?.setId ?? null); }
  static async onDeleteSet(event, target) { event?.preventDefault?.(); const id = target?.dataset?.setId; return id ? this.deleteSet(id) : false; }
}

export default SuitsAndSets;
