// module/apps/item-sheets/cybernetic.mjs
//
// Implant / cybernetic limb / hardware upgrade (implants-cybernetics-section.tsx):
//   - the body link is REVERSE (schema-inventory fact 15): the hit location's
//     `installedHardwareIds` names the row; the row carries `installed: true`.
//     The Install select writes the WHOLE hitLocations array on the actor
//     (ARCHITECTURE §6.5: never a per-index dotted key) and the row's flag
//     (handleInstall :264-370, the uninstall :247-260);
//   - an upgrade is held in a limb's own `upgrades[]` as a COPY and its row is
//     flagged equipped (:760-785; PART_LISTS / limbAttachmentIds);
//   - Ch14's mandatory flaws (cyberneticMandatoryFlaws.missingMandatoryFlaws,
//     :134) are listed with an Add button that creates the disadvantage rows;
//     the quirk is a choice (quirkChoicesFor) and stays the player's;
//   - a limb's fit is SM-exact (prostheticBuild.installProblems); an implant's
//     bag is implantEffects.implantModifiers and its CP charge implantCpCharges.

import { engine } from '../../engine.mjs';
import { rowsOf, rowToItemData, nextSort } from '../../adapter.mjs';
import { traitLibraryEntry, modifierBadges } from '../actor-sheet-tabs.mjs';
import { ShadowBaseItemSheet, loc, fmt, notify, text, num, fig, money } from './base.mjs';
import * as B from './builders.mjs';

const TAB_IDS = ['main', 'notes'];

export class CyberneticSheet extends ShadowBaseItemSheet {
  static FAMILY = 'cybernetic';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('cybernetic', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    actions: { 'add-flaws': CyberneticSheet.#onAddFlaws, 'add-quirk': CyberneticSheet.#onAddQuirk, 'remove-upgrade': CyberneticSheet.#onRemoveUpgrade, 'uninstall': CyberneticSheet.#onUninstall },
  };

  liveLocations() { return engine.anatomy.liveLocations(this.actor?.system?.hitLocations ?? []); }
  /** The location(s) whose installedHardwareIds name this row. */
  linkedLocations() { const id = this.item.system?.row?.id; return (this.actor?.system?.hitLocations ?? []).filter((l) => (l.installedHardwareIds ?? []).includes(id)); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = this.actor;
    const row = context.row;
    const type = item.type;
    const isImplant = type === 'implant';
    const isLimb = type === 'cyberneticLimb';
    const isUpgrade = type === 'cyberneticUpgrade';
    const linked = this.linkedLocations();
    const live = this.liveLocations();
    const disadvantages = actor ? B.ownerRows(item, 'disadvantages') : [];
    const hasImplants = !!actor && B.ownerRows(item, 'implants').some((r) => r.installed);
    const hasLimbs = !!actor && B.ownerRows(item, 'cybernetics').some((r) => r.installed);
    const flawScope = { hasImplants: hasImplants || (isImplant && !!row.installed), hasLimbs: hasLimbs || (isLimb && !!row.installed) };
    const missing = actor && !isUpgrade ? engine.cyberneticMandatoryFlaws.missingMandatoryFlaws(disadvantages, flawScope) : [];
    const required = engine.cyberneticMandatoryFlaws.requiredMandatoryFlaws(flawScope);
    const quirks = engine.cyberneticMandatoryFlaws.quirkChoicesFor(flawScope);
    const ownQuirks = actor ? B.ownerRows(item, 'quirks').map((q) => text(q.name)) : [];
    const main = {
      isImplant, isLimb, isUpgrade,
      installed: isUpgrade ? !!row.equipped : !!row.installed,
      linked: linked.map((l) => ({ id: text(l.id), name: text(l.name) })),
      install: { current: text(linked[0]?.id), options: [{ value: '', label: loc('SHADOWBASE.Item.Cyber.NotInstalled'), selected: !linked.length }, ...live.map((l) => ({ value: text(l.id), label: `${text(l.name)}${l.isOrganic === false ? ` (${loc('SHADOWBASE.Item.Cyber.Prosthetic')})` : ''}`, selected: text(l.id) === text(linked[0]?.id) }))], available: !!actor && live.length > 0 },
      cost: row.cost ?? null,
      weight: row.weight ?? null,
      quantity: num(row.quantity, 1) || 1,
      itemSizeModifier: row.itemSizeModifier ?? null,
      effect: text(row.effect),
      flaws: { required: required.map((f) => ({ name: text(f.name), points: num(f.points), description: text(f.description), missing: missing.some((x) => x.name === f.name) })), missing: missing.length, quirks: quirks.map((q) => ({ name: q, held: ownQuirks.includes(q) })), hasQuirk: quirks.some((q) => ownQuirks.includes(q)) },
    };
    if (isImplant) {
      const profile = engine.implantEffects.implantProfileFor(row) ?? null;
      const charges = actor ? engine.implantEffects.implantCpCharges([row], B.ownerRows(item, 'advantages'))[0] : null;
      Object.assign(main, {
        category: text(row.category), slotType: text(row.slotType), location: text(row.location),
        pathways: Array.isArray(row.pathways) ? row.pathways.map(text) : [],
        pathwaysText: Array.isArray(row.pathways) ? row.pathways.join(', ') : text(row.pathways),
        baseCp: row.baseCp ?? null, finalCp: row.finalCp ?? profile?.finalCp ?? null,
        cpCharged: charges ? num(charges.cp ?? charges.charged ?? charges.points) : null,
        modifiers: modifierBadges(engine.implantEffects.implantModifiers(row)),
        granted: engine.implantEffects.grantedTraitsFor(row).map(text),
        inCatalog: !!profile,
        profileNotes: text(profile?.notes ?? profile?.description),
      });
    }
    if (isLimb) {
      const limbType = text(row.type) || text(engine.cyberneticsData.CYBERNETIC_LIMBS.find((l) => l.name === row.name)?.type);
      const capacity = engine.cyberneticsData.MODULE_CAPACITY?.[limbType] ?? null;
      const upgrades = Array.isArray(row.upgrades) ? row.upgrades : [];
      const owned = actor ? B.ownerRows(item, 'cyberneticUpgrades') : [];
      const inLimbs = new Set(rowsOf(actor ?? { items: [] }, 'cybernetics').flatMap((l) => (l.system?.row?.upgrades ?? []).map((u) => text(u?.id))));
      const compatible = owned.filter((u) => !inLimbs.has(text(u.id)) && (!u.requiresType || u.requiresType === limbType) && (!u.requiresExtent || u.requiresExtent === 'Any' || u.requiresExtent === row.extent));
      const characterSm = actor?.system?.sizeModifier ?? 0;
      Object.assign(main, {
        location: text(row.location),
        locations: [{ value: '', label: loc('SHADOWBASE.Item.Cyber.NoLocation'), selected: !row.location }, ...live.filter((l) => !limbType || String(l.type) === limbType).map((l) => ({ value: text(l.name), label: text(l.name), selected: text(l.name) === text(row.location) }))],
        limbType, extent: text(row.extent), material: text(row.material),
        types: engine.prostheticBuild.LIMB_SCOPES.map((t) => ({ value: t, label: t, selected: t === limbType })),
        dr: row.dr ?? null, currentDr: row.currentDr ?? null, hasSynthskin: !!row.hasSynthskin,
        capacity,
        upgrades: upgrades.map((u, index) => ({ index, id: text(u?.id), name: text(u?.name), effect: text(u?.effect) })),
        overCapacity: capacity !== null && upgrades.length > capacity,
        canAddUpgrade: !!actor && (capacity === null || upgrades.length < capacity),
        upgradeOptions: [{ value: '', label: loc('SHADOWBASE.Item.Cyber.InstallUpgrade'), selected: true }, ...compatible.map((u) => ({ value: text(u.id), label: `${text(u.name)} (${money(u.cost)} cr)`, selected: false }))],
        fitProblems: engine.prostheticBuild.installProblems(row.itemSizeModifier ?? 0, characterSm).map(text),
        baselinePoints: num(row.baselinePoints),
      });
    }
    if (isUpgrade) {
      const limbs = actor ? rowsOf(actor, 'cybernetics') : [];
      const host = limbs.find((l) => (l.system?.row?.upgrades ?? []).some((u) => text(u?.id) === text(row.id))) ?? null;
      Object.assign(main, {
        requiresType: text(row.requiresType), requiresExtent: text(row.requiresExtent),
        limbName: host ? (host.displayName ?? host.name) : '',
        limbOptions: [{ value: '', label: loc('SHADOWBASE.Item.Cyber.NotInLimb'), selected: !host }, ...limbs.map((l) => ({ value: text(l.system?.row?.id), label: l.displayName ?? l.name, selected: !!host && l.id === host.id }))],
      });
    }
    context.main = main;
    return context;
  }

  /** Edits: `install` (a hit location id), `limb` (an upgrade's host limb), `addUpgrade` (a limb takes an owned upgrade), `pathways` (an implant's list). */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const item = this.item;
    const actor = this.actor;
    const row = item.system?.row ?? {};
    const patch = {};
    const later = [];
    if ('pathways' in edits) patch.pathways = String(edits.pathways ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if ('install' in edits && actor) {
      const target = text(edits.install);
      const current = text(this.linkedLocations()[0]?.id);
      if (target !== current) {
        const locations = (actor.system?.hitLocations ?? []).map((l) => ({ ...l, installedHardwareIds: (l.installedHardwareIds ?? []).filter((id) => id !== row.id) }));
        const dest = target ? locations.find((l) => text(l.id) === target) : null;
        if (dest) dest.installedHardwareIds = [...dest.installedHardwareIds, row.id];
        patch.installed = !!dest;
        if (dest && item.type === 'cyberneticLimb') patch.location = text(dest.name);
        later.push(() => actor.update({ 'system.hitLocations': locations }));
      }
    }
    if ('limb' in edits && actor && item.type === 'cyberneticUpgrade') {
      const limbs = rowsOf(actor, 'cybernetics');
      const target = text(edits.limb);
      const host = limbs.find((l) => (l.system?.row?.upgrades ?? []).some((u) => text(u?.id) === text(row.id))) ?? null;
      if (text(host?.system?.row?.id) !== target) {
        const updates = [];
        if (host) updates.push({ _id: host.id, 'system.row.upgrades': (host.system.row.upgrades ?? []).filter((u) => text(u?.id) !== text(row.id)) });
        const next = target ? limbs.find((l) => text(l.system?.row?.id) === target) : null;
        if (next) updates.push({ _id: next.id, 'system.row.upgrades': [...(next.system.row.upgrades ?? []), { ...row }] });
        patch.equipped = !!next;
        if (updates.length) later.push(() => actor.updateEmbeddedDocuments('Item', updates));
      }
    }
    if ('addUpgrade' in edits && actor && item.type === 'cyberneticLimb' && text(edits.addUpgrade)) {
      const upgrade = B.ownerItemByRowId(item, text(edits.addUpgrade));
      if (upgrade) {
        patch.upgrades = [...(row.upgrades ?? []), { ...upgrade.system.row }];
        later.push(() => upgrade.updateRow({ equipped: true }));
      }
    }
    if (Object.keys(patch).length) this._mergeRow(submitData, patch);
    if (!later.length) return after;
    return async () => { if (typeof after === 'function') await after(); for (const fn of later) await fn(); };
  }

  /** Ch14's missing mandatory flaws become disadvantage rows (the library's own points and text). */
  static async #onAddFlaws() {
    const actor = this.actor;
    if (!actor) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    const item = this.item;
    const scope = { hasImplants: B.ownerRows(item, 'implants').some((r) => r.installed) || (item.type === 'implant' && !!item.system.row.installed), hasLimbs: B.ownerRows(item, 'cybernetics').some((r) => r.installed) || (item.type === 'cyberneticLimb' && !!item.system.row.installed) };
    const missing = engine.cyberneticMandatoryFlaws.missingMandatoryFlaws(B.ownerRows(item, 'disadvantages'), scope);
    if (!missing.length) return notify('info', loc('SHADOWBASE.Item.Cyber.NoFlawsMissing'));
    const rows = missing.map((f) => {
      const entry = traitLibraryEntry('disadvantages', f.name);
      return { name: f.name, points: num(f.points), level: null, description: text(entry?.description ?? f.description), baselinePoints: 0, category: text(entry?.category), fromCyberneticHardware: true, modifiers: { ...engine.NO_MODIFIERS } };
    });
    await actor.createEmbeddedDocuments('Item', rows.map((r, i) => rowToItemData(r, 'disadvantages', nextSort(actor, 'disadvantages') + i)));
    return notify('info', fmt('SHADOWBASE.Item.Cyber.FlawsAdded', { names: rows.map((r) => r.name).join(', ') }));
  }

  /** One Ch14 mandatory quirk, chosen by the player (data-name). */
  static async #onAddQuirk(event, target) {
    const actor = this.actor;
    const name = text(target?.dataset?.name);
    if (!actor || !name) return;
    if (B.ownerRows(this.item, 'quirks').some((q) => q.name === name)) return notify('info', fmt('SHADOWBASE.Drop.AlreadyKnown', { name }));
    let row;
    try { row = engine.quirks.quirkFromLibrary(name); } catch { row = { name, points: engine.quirks.QUIRK_POINT_COST ?? -1, description: '', baselinePoints: 0 }; }
    await actor.createEmbeddedDocuments('Item', [rowToItemData(row, 'quirks', nextSort(actor, 'quirks'))]);
    return notify('info', fmt('SHADOWBASE.Drop.Added', { name, count: 1 }));
  }

  /** Take an upgrade out of this limb (the copy goes; the row is unequipped). */
  static async #onRemoveUpgrade(event, target) {
    const index = Number(target?.dataset?.index);
    const upgrades = Array.isArray(this.item.system?.row?.upgrades) ? [...this.item.system.row.upgrades] : [];
    if (!upgrades[index]) return;
    const [removed] = upgrades.splice(index, 1);
    await this.item.updateRow({ upgrades });
    const row = removed?.id ? B.ownerItemByRowId(this.item, text(removed.id)) : null;
    if (row) await row.updateRow({ equipped: false });
  }

  /** Remove this hardware from every location (implants-cybernetics-section.tsx:247-260). */
  static async #onUninstall() {
    const actor = this.actor;
    const row = this.item.system?.row ?? {};
    if (actor) {
      const locations = (actor.system?.hitLocations ?? []).map((l) => ({ ...l, installedHardwareIds: (l.installedHardwareIds ?? []).filter((id) => id !== row.id) }));
      await actor.update({ 'system.hitLocations': locations });
    }
    return this.item.updateRow(this.item.type === 'cyberneticUpgrade' ? { equipped: false } : { installed: false });
  }
}

export default CyberneticSheet;
