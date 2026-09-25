// module/apps/item-sheets/builders.mjs
//
// The builder rules every item sheet shares (docs/ARCHITECTURE.md §6.4;
// digest B "builders-customization"), each one a thin call into the engine
// bundle with the website component it was moved from named beside it:
//
//   slotOptions()        a slot's dropdown: the OWNED rows that fit, then the
//                        catalog under Direct Library Access - the scope rule is
//                        engine.partAcquisition.slotScope (part-acquisition.ts,
//                        the one home of "owned in campaign, the book under free
//                        placement"); this file only shapes its answer into
//                        <optgroup>s;
//   decodeChoice()       the select's value grammar: '' none, 'inv:<rowId>' an
//                        owned row, 'lib:<templateKey>' a catalog pick (the
//                        website's NONE_VALUE / LIB_PREFIX, BlasterBaseInfo.tsx);
//   rebindOwnedRow()     the owned-row-wins bookkeeping a slot change performs:
//                        the released row loses isInstalled / installedIn*Id /
//                        equipped, the fitted one gains them (BlasterBaseInfo.tsx
//                        handlePartSelection, customized-melee-weapon-item.tsx
//                        PieceSelector.handleSelect, lightsaber-item.tsx
//                        handleInternalPartSelect, ArmorComponentSelector.tsx rebind);
//   applyBuild()         Confirm Construction's two routes: 'placed' under Direct
//                        Library Access (nothing consumed), 'built' through
//                        consumeForWeaponBuild / consumeForBuild (weapon-build.ts,
//                        armor-build.ts) - the owned rows stay in inventory,
//                        marked installed, never deleted;
//   releaseBuild()       the inverse: every fitted owned row goes back to stock
//                        and the item is a design again (the crafting dialog's
//                        deconstruct success path keeps the rows;
//                        customized-blaster-item.tsx:300-400);
//   conditionView()      condition badge + durability track + the Ch7 stress /
//                        field-repair affordances (BlasterFinalStats.tsx:365-425,
//                        customized-melee-weapon-item.tsx:680-706, lightsaber-item.tsx:1190-1250);
//   provenanceView()     FINALIZED / DESIGN PENDING · PLACED / BUILT (the
//                        "Weapon Assembly" strip of every card).
//
// Nothing here prices, weighs or classifies anything: the figures come from
// item.derived (module/data/item-base.mjs) and the catalogs from the bundle.

import { engine } from '../../engine.mjs';
import { rowsOf, rowWithDerived } from '../../adapter.mjs';
import { WEAPON_PART_FAMILIES } from '../../config.mjs';

export const SYSTEM_ID = 'shadowbase';

export const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
export const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
export const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };
export const text = (v) => (v === null || v === undefined ? '' : String(v));
export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
/** Figures print the way the website prints them: at most `digits` decimals, no trailing zeros. */
export const fig = (v, digits = 2) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : String(Number(Number(v).toFixed(digits))));
export const money = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString('en-US') : '');
export const signed = (n) => (Number(n) > 0 ? `+${Number(n)}` : `${Number(n) || 0}`);
export const clone = (v) => (globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(v) : structuredClone(v));

/** The select value grammar (the website's NONE_VALUE / LIB_PREFIX in one place). */
export const NONE = '';
export const INV = 'inv:';
export const LIB = 'lib:';
export const invValue = (id) => (id ? `${INV}${id}` : NONE);
export const libValue = (key) => (key ? `${LIB}${key}` : NONE);

/**
 * Decode a slot select's value.
 * @returns {{ kind: 'none'|'inv'|'lib', id: string|null }}
 */
export function decodeChoice(value) {
  const v = text(value);
  if (!v || v === NONE) return { kind: 'none', id: null };
  if (v.startsWith(INV)) return { kind: 'inv', id: v.slice(INV.length) };
  if (v.startsWith(LIB)) return { kind: 'lib', id: v.slice(LIB.length) };
  // A bare id is an owned row (the website's selects carry the row id bare).
  return { kind: 'inv', id: v };
}

/** The plain rows of one of the owner's arrays (empty for an unowned item). */
export function ownerRows(item, source) {
  const actor = item?.actor ?? null;
  return actor ? rowsOf(actor, source).map((i) => i.system.row) : [];
}

/** The owner's Items of one array. */
export function ownerItems(item, source) {
  const actor = item?.actor ?? null;
  return actor ? rowsOf(actor, source) : [];
}

/** The owner's Item whose row carries this uuid, or null. */
export function ownerItemByRowId(item, rowId) {
  const actor = item?.actor ?? null;
  if (!actor || !rowId) return null;
  return actor.items.find((i) => i.system?.row?.id === rowId) ?? null;
}

/**
 * The dropdown of one slot: owned rows first (the physical objects), the
 * catalog under Direct Library Access - engine.partAcquisition.slotScope
 * decides the scope; `keep` keeps the slot's own current template listed so a
 * design placed under the switch still reads its choice with it off.
 *
 * @param {object} spec
 * @param {object[]} spec.owned       rows that fit this slot (already filtered by category / host)
 * @param {object[]} spec.catalog     the templates legal for the slot
 * @param {boolean} spec.libraryAccess
 * @param {{ inventoryId?: string|null, partId?: string|null }} spec.current
 * @param {(t: object) => string} [spec.keyOf]      the template key the select carries (id by default)
 * @param {(t: object) => string} [spec.labelOf]    the template's label (name by default)
 * @param {(r: object) => string} [spec.rowLabelOf] the owned row's label (name by default)
 * @param {object|null} [spec.keep]                 the template the slot names now (kept in the list)
 */
export function slotOptions({ owned, catalog, libraryAccess, current, keyOf = (t) => text(t?.id ?? t?.name), labelOf = (t) => text(t?.name), rowLabelOf = (r) => text(r?.name), keep = null }) {
  const scope = engine.partAcquisition.slotScope(catalog ?? [], (owned ?? []).length, !!libraryAccess, keep ?? null, keyOf);
  const invId = text(current?.inventoryId);
  const partId = text(current?.partId);
  const value = invId ? invValue(invId) : partId ? libValue(partId) : NONE;
  const groups = [];
  if ((owned ?? []).length) {
    groups.push({ label: loc('SHADOWBASE.Item.Slot.InInventory'), options: owned.map((r) => ({ value: invValue(r.id), label: rowLabelOf(r), selected: invValue(r.id) === value })) });
  }
  if (scope.catalog.length) {
    groups.push({ label: loc('SHADOWBASE.Item.Slot.Catalog'), options: scope.catalog.map((t) => ({ value: libValue(keyOf(t)), label: labelOf(t), selected: libValue(keyOf(t)) === value })) });
  }
  return { value, groups, emptyReason: scope.emptyReason, isNone: value === NONE, chosenNotOwned: !invId && !!partId };
}

/**
 * Release the previously fitted owned row and claim the next one - the
 * website writes `isInstalled` / `installedIn<Host>Id` / `equipped` on the
 * part row itself; the host only names the row (schema-inventory fact 4).
 * @param {object} actor
 * @param {object} spec
 * @param {string} spec.source     'weaponModifications' | 'lightsaberModifications' | 'armorModifications' | 'equipment' | 'ammunition'
 * @param {string} spec.hostField  'installedInBlasterId' | 'installedInMeleeId' | 'installedInSaberId' | 'installedInArmorId'
 * @param {string} spec.hostId     the host row's uuid
 * @param {string|null} spec.previousId
 * @param {string|null} spec.nextId
 * @param {boolean} [spec.equips]  weapons flag the row equipped too (armor does not: consumeForBuild)
 */
export async function rebindOwnedRow(actor, { source, hostField, hostId, previousId, nextId, equips = true }) {
  if (!actor) return [];
  const updates = [];
  const byRow = (id) => (id ? rowsOf(actor, source).find((i) => i.system?.row?.id === id) ?? null : null);
  if (previousId && previousId !== nextId) {
    const prev = byRow(previousId);
    if (prev) updates.push({ _id: prev.id, 'system.row.isInstalled': false, [`system.row.${hostField}`]: null, ...(equips ? { 'system.row.equipped': false } : {}) });
  }
  if (nextId) {
    const next = byRow(nextId);
    if (next) updates.push({ _id: next.id, 'system.row.isInstalled': true, [`system.row.${hostField}`]: hostId, ...(equips ? { 'system.row.equipped': true } : {}) });
  }
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  return updates;
}

/** The host-reference field a family's fitted rows carry. */
export const HOST_FIELD = Object.freeze({ blaster: 'installedInBlasterId', melee: 'installedInMeleeId', saber: 'installedInSaberId', armor: 'installedInArmorId' });
/** The website array a family's parts live in. */
export const PART_SOURCE = Object.freeze({ blaster: WEAPON_PART_FAMILIES.weapon, melee: WEAPON_PART_FAMILIES.weapon, saber: WEAPON_PART_FAMILIES.lightsaber, armor: 'armorModifications' });

/**
 * Confirm Construction. Under Direct Library Access the design is materialised
 * as-is and stamped 'placed' (customized-blaster-item.tsx:515-529); otherwise
 * the owned rows the plan consumes are marked installed through the engine's
 * consume helper and the item is stamped 'built' (the crafting dialog's forge
 * success, weapon-build.ts consumeForWeaponBuild / armor-build.ts consumeForBuild).
 * The Chapter rolls themselves are the CraftingApp's (unit U09); this is the
 * write the app makes on success, exposed so it makes the SAME one.
 * @param {object} item the host Item
 * @param {{ family: 'blaster'|'melee'|'saber'|'armor', plan: object, libraryAccess: boolean }} spec
 */
export async function applyBuild(item, { family, plan, libraryAccess }) {
  const row = item.system.row;
  const patch = { isConstructed: true };
  if (!row.buildProvenance) patch.buildProvenance = libraryAccess ? 'placed' : 'built';
  if (!libraryAccess) {
    if (!plan?.canBuild) return { ok: false, reason: plan?.blockedBy?.[0] ?? loc('SHADOWBASE.Item.Build.Incomplete') };
    const actor = item.actor;
    if (actor && plan.consumes?.length) {
      const source = PART_SOURCE[family];
      const items = rowsOf(actor, source);
      const rows = items.map((i) => i.system.row);
      const next = family === 'armor'
        ? engine.armorBuild.consumeForBuild(rows, plan.consumes, row.id)
        : engine.weaponBuild.consumeForWeaponBuild(rows, plan.consumes, row.id, family);
      const updates = [];
      next.forEach((r, i) => {
        if (r === rows[i]) return;
        const changes = { _id: items[i].id };
        for (const k of ['isInstalled', 'equipped', HOST_FIELD[family]]) if (k in r && r[k] !== rows[i][k]) changes[`system.row.${k}`] = r[k];
        if (Object.keys(changes).length > 1) updates.push(changes);
      });
      if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    }
  }
  await item.updateRow(patch);
  return { ok: true, provenance: patch.buildProvenance ?? row.buildProvenance };
}

/**
 * Take a built item back to a design: every owned row it names goes back to
 * stock (installedAttachments.weaponAttachmentIds / armorAttachmentIds lists
 * them) and isConstructed clears. The rows are KEPT - Ch11/Ch12 let a weapon
 * be taken down to its components and the strip flow puts the same rows back
 * (weapon-build.ts consumeForWeaponBuild's header).
 */
export async function releaseBuild(item, { family }) {
  const actor = item.actor;
  const row = item.system.row;
  if (actor) {
    const ids = family === 'armor' ? engine.installedAttachments.armorAttachmentIds(row) : engine.installedAttachments.weaponAttachmentIds(row);
    const held = new Set(ids.map(String));
    const updates = [];
    for (const source of new Set(Object.values(PART_SOURCE))) {
      for (const part of rowsOf(actor, source)) {
        const r = part.system.row;
        if (!held.has(String(r.id)) && r[HOST_FIELD[family]] !== row.id) continue;
        updates.push({ _id: part.id, 'system.row.isInstalled': false, 'system.row.equipped': false, [`system.row.${HOST_FIELD[family]}`]: null });
      }
    }
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  }
  await item.updateRow({ isConstructed: false });
  return true;
}

/** The FINALIZED / DESIGN PENDING strip of every builder card. */
export function provenanceView(row, { designMode = false } = {}) {
  const constructed = row.isConstructed !== false && !!row.isConstructed;
  const provenance = text(row.buildProvenance);
  return {
    constructed,
    designMode,
    state: constructed && !designMode ? loc('SHADOWBASE.Item.Build.Finalized') : loc('SHADOWBASE.Item.Build.DesignPending'),
    provenance,
    provenanceLabel: provenance ? loc(`SHADOWBASE.Item.Build.Provenance.${provenance}`) : '',
    locked: constructed && !designMode,
  };
}

/** A plan (planBlasterBuild / planMeleeBuild / planSaberBuild / planArmorBuild) as the card's Construction panel. */
export function planView(plan, { chapter, libraryAccess }) {
  if (!plan) return null;
  const list = (plan.shoppingList ?? []).map((s) => ({ label: text(s.label), partName: text(s.partName ?? s.part?.name), cost: money(s.cost), priced: s.priced !== false }));
  return {
    show: !libraryAccess && plan.started === true,
    started: !!plan.started,
    canBuild: !!plan.canBuild,
    status: plan.canBuild ? loc('SHADOWBASE.Item.Build.Ready') : loc('SHADOWBASE.Item.Build.Incomplete'),
    blockedBy: (plan.blockedBy ?? []).map(text),
    shoppingList: list,
    shoppingCost: money(plan.shoppingCost),
    consumes: (plan.consumes ?? []).length,
    phases: (plan.phases ?? []).map((p) => `${p.name} (${p.skill})`).join(', '),
    phaseCount: (plan.phases ?? []).length,
    chapter,
  };
}

/**
 * Condition badge + durability track + Ch7 stress / repair (the OWNED state:
 * a design cannot be dented, so the controls are gated on isConstructed the
 * way the three weapon cards gate them).
 * @param {object} merged the row with its derived figures laid over it
 * @param {{ two?: boolean }} [options] the second blade of a staff
 */
export function conditionView(merged, { two = false } = {}) {
  const durKey = two ? 'durabilityTwo' : 'durability';
  const maxKey = two ? 'maxDurabilityTwo' : 'maxDurability';
  const condKey = two ? 'conditionTwo' : 'condition';
  const max = merged[maxKey];
  const measured = engine.malfunction.hasBeenMeasured(max);
  const current = merged[durKey];
  const condition = text(merged[condKey] || (measured ? engine.malfunction.conditionFromDurability(current, max) : 'Fine')) || 'Fine';
  const constructed = merged.isConstructed !== false && !!merged.isConstructed;
  return {
    key: durKey,
    condition,
    conditionLabel: loc(`SHADOWBASE.Item.Condition.${condition}`),
    fine: condition === 'Fine',
    damaged: condition === 'Damaged',
    broken: condition === 'Broken' || condition === 'Destroyed',
    measured,
    current: measured ? (current ?? max) : null,
    max: measured ? max : null,
    editable: constructed && measured,
    canRepair: constructed && (condition === 'Damaged' || condition === 'Broken'),
    canStress: constructed && measured,
    energyRes: num(two ? merged.energyResTwo : merged.energyRes),
  };
}

/** Malf shown the way the HUD shows it: the derived figure, amber below 17. */
export function malfView(threshold) {
  const m = Number(threshold);
  return { value: Number.isFinite(m) ? m : null, degraded: Number.isFinite(m) && m < engine.malfunction.BASE_MALFUNCTION };
}

/** The condition badge for a row that has one but no durability track (equipment, parts, ammunition). */
export function conditionBadge(condition) {
  const c = text(condition) || 'Fine';
  return { text: loc(`SHADOWBASE.Item.Condition.${c}`), fine: c === 'Fine', value: c };
}

/** Storage-box options for the header's storage select (send-to-storage-menu.tsx). */
export function storageOptions(item) {
  const actor = item?.actor ?? null;
  const boxes = Array.isArray(actor?.system?.storageBoxes) ? actor.system.storageBoxes : [];
  const current = text(item?.system?.row?.storageLocationId);
  return {
    show: !!actor && boxes.length > 0,
    options: [{ value: '', label: loc('SHADOWBASE.Item.Header.Carried'), selected: !current }, ...boxes.map((b) => ({ value: text(b.id), label: text(b.name) || loc('SHADOWBASE.Sheet.Inventory.UnnamedBox'), selected: current === text(b.id) }))],
    boxed: !!current,
  };
}

/** The candidate owned rows for a part slot: right category, loose or already in THIS host. */
export function ownedPartsFor(item, source, category, hostField) {
  const hostId = item?.system?.row?.id;
  return ownerRows(item, source).filter((r) => text(r.category) === category && (!r.isInstalled || r[hostField] === hostId));
}

/** Material options for a milled part (part-acquisition.ts materialsFor). */
export function materialOptions(family, currentId) {
  const list = engine.partAcquisition.materialsFor(family) ?? [];
  return [{ value: '', label: loc('SHADOWBASE.Item.Slot.ChooseMaterial'), selected: !currentId }, ...list.map((m) => ({ value: text(m.id), label: `${m.name} (${money(m.costPerLb)} CR/lb)`, selected: text(m.id) === text(currentId) }))];
}

/** The merged row (stored + derived) of an Item. */
export const mergedRow = (item) => rowWithDerived(item);

/** DialogV2 when the client has it, else null (headless callers pass explicit answers or skip prompts). */
export function dialogV2() {
  const apps = globalThis.foundry?.applications;
  const api = apps && ('api' in apps) ? apps.api : null;
  return api && ('DialogV2' in api) ? api.DialogV2 : null;
}

/** A confirm that answers yes headlessly (no DialogV2). */
export async function confirmDialog({ title, content }) {
  const DialogV2 = dialogV2();
  if (typeof DialogV2?.confirm !== 'function') return true;
  return DialogV2.confirm({ window: { title }, content, rejectClose: false, modal: true });
}

/**
 * A one-line text prompt (the trait specifier, the stress damage). Resolves
 * the typed string, or null when cancelled / headless without a queued answer.
 */
export async function promptText({ title, label, placeholder = '', initial = '', type = 'text' }) {
  const DialogV2 = dialogV2();
  if (typeof DialogV2?.input !== 'function') return null;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const answer = await DialogV2.input({
    window: { title },
    classes: [SYSTEM_ID, 'sb-item-prompt'],
    content: `<div class="shadowbase sb-item-prompt"><div class="form-group"><label for="sb-prompt-value">${esc(label)}</label><input type="${type}" id="sb-prompt-value" name="value" value="${esc(initial)}" placeholder="${esc(placeholder)}" autofocus></div></div>`,
    ok: { label: loc('SHADOWBASE.Item.Prompt.Ok') },
    rejectClose: false,
  });
  if (!answer || typeof answer !== 'object') return null;
  return 'value' in answer ? String(answer.value ?? '') : null;
}

// ---------------------------------------------------------------------------
// Structural slots and fitted goods: the select's context and the edit it means
// ---------------------------------------------------------------------------

/**
 * A structural slot (a blaster's grip, a saber's emitter, a melee entry, an
 * armor Shell) as the slot-select partial renders it: the owned-rows-first
 * dropdown, the resolved template / material / wrap names, the material and
 * wrap selects a milled part takes, and the chosen-not-owned caption.
 * @param {object} spec
 * @param {string} spec.key                 the row field (or `<key>.<index>` for a melee list entry)
 * @param {string} spec.label
 * @param {boolean} [spec.required]
 * @param {boolean} [spec.takesMaterial]
 * @param {boolean} [spec.takesWrap]
 * @param {object} spec.entry               the stored slot value { partId, materialId, inventoryId, wrapId?, quantity? }
 * @param {object} spec.resolved            the engine's resolve*Slot / resolve*Entry answer
 * @param {object[]} spec.owned             the owned rows that fit (ownedPartsFor)
 * @param {object[]} spec.catalog           the templates legal for the slot
 * @param {boolean} spec.libraryAccess
 * @param {string} [spec.materialFamily]    'melee' | 'ranged' for partAcquisition.materialsFor; 'saber' uses LIGHTSABER_MATERIALS
 * @param {boolean} [spec.locked]           a built weapon's slots are read-only until Swap Components
 * @param {string} [spec.emptyLabel]
 */
export function slotView({ key, label, required = false, takesMaterial = false, takesWrap = false, entry, resolved, owned, catalog, libraryAccess, materialFamily = null, locked = false, quantity = null }) {
  const e = entry ?? {};
  const keep = resolved?.template ?? null;
  const select = slotOptions({ owned, catalog, libraryAccess, current: { inventoryId: e.inventoryId, partId: e.partId }, keep, keyOf: (t) => text(t?.id), labelOf: (t) => text(t?.name), rowLabelOf: (r) => `${text(r?.name)}${r?.materialId ? '' : ''}` });
  const ownedRow = e.inventoryId ? (owned ?? []).find((r) => text(r.id) === text(e.inventoryId)) ?? null : null;
  const materials = takesMaterial ? (materialFamily === 'saber'
    ? [{ value: '', label: loc('SHADOWBASE.Item.Slot.ChooseMaterial'), selected: !e.materialId }, ...engine.lightsaberParts.LIGHTSABER_MATERIALS.map((m) => ({ value: text(m.id), label: `${m.name} (${money(m.costPerLb)} CR/lb)`, selected: text(m.id) === text(e.materialId) }))]
    : materialOptions(materialFamily ?? 'melee', e.materialId)) : [];
  const wraps = takesWrap ? [{ value: '', label: loc('SHADOWBASE.Item.Slot.NoWrap'), selected: !e.wrapId }, ...engine.lightsaberParts.LIGHTSABER_WRAPS.map((w) => ({ value: text(w.id), label: text(w.name), selected: text(w.id) === text(e.wrapId) }))] : [];
  return {
    key, label, required, takesMaterial, takesWrap, locked,
    select,
    isNone: select.isNone,
    ownedName: text(ownedRow?.name),
    templateName: text(resolved?.template?.name),
    materialName: text(resolved?.material?.name),
    wrapName: text(resolved?.wrap?.name),
    chosenNotOwned: !!resolved?.chosenNotOwned,
    materials,
    // An owned row's material is the metal it was milled from - the design's choice only applies to a chosen-not-owned part.
    materialEditable: takesMaterial && !ownedRow && !locked,
    wraps,
    wrapEditable: takesWrap && !ownedRow && !locked,
    quantity,
    hasQuantity: quantity !== null,
    emptyReason: text(select.emptyReason),
  };
}

/**
 * What a slot select's new value means for the row and for the owned part
 * rows (BlasterBaseInfo.tsx:121-175 handlePartSelection, the melee
 * PieceSelector.handleSelect, lightsaber-item.tsx hilt slots): none clears
 * the slot; a catalog pick records the template and leaves inventoryId null
 * (a CHOICE, not an acquisition); an owned row is bound by id, its own
 * partId / material riding along. The previous owned row is released.
 * @returns {{ patch: object, previousId: string|null, nextId: string|null }}
 */
export function slotEdit({ value, entry, ownedRows, templateIdOf = (row) => text(row?.partId) || null, keepWrap = false }) {
  const e = entry ?? {};
  const choice = decodeChoice(value);
  const previousId = text(e.inventoryId) || null;
  const base = { partId: null, materialId: null, inventoryId: null, ...(keepWrap ? { wrapId: null } : {}) };
  if (choice.kind === 'none') return { patch: { ...e, ...base }, previousId, nextId: null };
  if (choice.kind === 'lib') return { patch: { ...e, ...base, partId: choice.id, materialId: e.materialId ?? null, wrapId: keepWrap ? (e.wrapId ?? null) : undefined }, previousId, nextId: null };
  const row = (ownedRows ?? []).find((r) => text(r.id) === choice.id) ?? null;
  if (!row) return { patch: { ...e, ...base }, previousId, nextId: null };
  const patch = { ...e, partId: templateIdOf(row), materialId: row.materialId ?? null, inventoryId: choice.id };
  if (keepWrap) patch.wrapId = row.wrapId ?? null;
  return { patch: stripUndefined(patch), previousId, nextId: choice.id };
}

const stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * A finished-good slot (a blaster's 13 Ch11 mod slots, a saber's 7 internals -
 * fitted-goods.ts RANGED_MOD_SLOT_FIELDS / LIGHTSABER_INTERNAL_SLOTS): the row
 * holds the owned row's uuid in `idField` and the catalog key in `partIdField`.
 */
export function fittedView({ slot, item, owned, catalog, libraryAccess, byKey, locked = false }) {
  const row = item.system?.row ?? {};
  const resolved = engine.fittedGoods.resolveFittedGood(row, slot, owned, byKey);
  const chosenKey = text(row[slot.partIdField]);
  const keep = chosenKey ? (catalog.find((t) => text(t?.id ?? t?.name) === chosenKey) ?? null) : null;
  const select = slotOptions({ owned, catalog, libraryAccess, current: { inventoryId: row[slot.idField], partId: chosenKey }, keep, keyOf: (t) => text(t?.id ?? t?.name), labelOf: (t) => `${text(t?.name)}${t?.cost != null ? ` (${money(t.cost)} cr)` : ''}` });
  const ownedRow = row[slot.idField] ? (owned ?? []).find((r) => text(r.id) === text(row[slot.idField])) ?? null : null;
  return {
    idField: slot.idField, partIdField: slot.partIdField,
    label: text(slot.label), category: text(slot.category), required: !!slot.required, locked,
    select, isNone: select.isNone,
    ownedName: text(ownedRow?.name),
    template: resolved.template ? { name: text(resolved.template.name), cost: money(resolved.template.cost), weight: fig(resolved.template.weight), notes: text(resolved.template.notes) } : null,
    chosenNotOwned: !!resolved.chosenNotOwned,
    emptyReason: text(select.emptyReason),
  };
}

/** What a fitted-good select means (lightsaber-item.tsx:1070-1120 handleInternalPartSelect; BlasterModifications.tsx:60-110 handleModChange). */
export function fittedEdit({ value, slot, item, ownedRows, byKey }) {
  const row = item.system?.row ?? {};
  const previousId = text(row[slot.idField]) || null;
  const choice = decodeChoice(value);
  if (choice.kind === 'none') return { patch: { [slot.idField]: null, [slot.partIdField]: null }, previousId, nextId: null };
  if (choice.kind === 'lib') return { patch: { [slot.idField]: null, [slot.partIdField]: choice.id }, previousId, nextId: null };
  const owned = (ownedRows ?? []).find((r) => text(r.id) === choice.id) ?? null;
  if (!owned) return { patch: { [slot.idField]: null, [slot.partIdField]: null }, previousId, nextId: null };
  const key = text(owned.partId) || text(byKey?.(owned.name)?.id) || text(owned.name);
  return { patch: { [slot.idField]: choice.id, [slot.partIdField]: key || null }, previousId, nextId: choice.id };
}

export default {
  slotOptions, decodeChoice, rebindOwnedRow, applyBuild, releaseBuild, provenanceView, planView, conditionView, malfView, conditionBadge,
  storageOptions, ownedPartsFor, materialOptions, ownerRows, ownerItems, ownerItemByRowId, mergedRow, dialogV2, confirmDialog, promptText,
  slotView, slotEdit, fittedView, fittedEdit,
  HOST_FIELD, PART_SOURCE, NONE, INV, LIB, invValue, libValue,
};
