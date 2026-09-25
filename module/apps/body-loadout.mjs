// module/apps/body-loadout.mjs
//
// BodyLoadout (docs/ARCHITECTURE.md §6.5): the website's
// src/components/character-sheet/components/body-loadout-panel.tsx as an
// ApplicationV2 window - what each part of the body is wearing and holding,
// one row per hit location, whatever the anatomy. Rules from the bundle:
//
//   bodyLoadout      resolveBodyLoadout / readiedWeapons / isWornOn / isWorn / WEAPON_FIELD
//   armorLayering    enforceBaseLayer (Ch13's one base layer per location, with the
//                    item the player just equipped preferred) - the equip path
//   armorFit         armorFit (|ΔSM| ≥ 1 Ill-Fitting, ≥ 2 Unwearable) per worn item
//   gearSets         activeSetBonuses (Ch13's set bonuses while earned)
//   droidDr          droidHardwareDr (the Shield Projector's field) + SHIELD_DRAIN_PP_PER_MIN
//   shieldRules      shieldProfileForItem / shieldActiveDR (a belt energy shield's isActive)
//   wornWeapons / isWeaponTwoHanded   the spares' hand needs
//
// Writes: armor equipped flags per Item (the layering enforced over the whole
// armor list first); a weapon's equipped / equippedAt / heldLocationIds on its
// Item (body-loadout-panel.tsx:284-344 - written whole, never a nested path);
// the deflector state on droidBuild.chassisMods (written as the whole build,
// §6.5); the energy shield's isActive on its Item (armor-item-card.tsx:653-660).

import { engine } from '../engine.mjs';
import { rowsOf } from '../adapter.mjs';
import { ActorSubApp, TEMPLATE_ROOT, loc, fmt, notify, num, text, sheetOf, statsOf, storedRows, itemByRowId } from './sub-app.mjs';
import { buildOf } from './droid-workshop.mjs';

const BL = engine.bodyLoadout;
/** The item source for a readied weapon's kind (body-loadout.ts WEAPON_FIELD). */
const KIND_SOURCE = BL.WEAPON_FIELD;

export class BodyLoadout extends ActorSubApp {
  static APP_NAME = 'body-loadout';
  static TITLE_KEY = 'SHADOWBASE.Apps.Loadout.WindowTitle';
  static FIELD_PREFIX = 'loadout.';

  static DEFAULT_OPTIONS = {
    window: { title: 'SHADOWBASE.Apps.Loadout.WindowTitle', icon: 'fa-solid fa-shirt', resizable: true },
    position: { width: 680, height: 720 },
    actions: {
      'unwear': BodyLoadout.onUnwear,
      'unready': BodyLoadout.onUnready,
      'clear-pin': BodyLoadout.onClearPin,
      'toggle-shield': BodyLoadout.onToggleShield,
      'set-emitter': BodyLoadout.onSetEmitter,
      'tick-shield': BodyLoadout.onTickShield,
      'toggle-energy-shield': BodyLoadout.onToggleEnergyShield,
    },
  };

  static PARTS = { loadout: { template: `${TEMPLATE_ROOT}/body-loadout.hbs`, scrollable: [''] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sheet = sheetOf(actor);
    const stats = statsOf(actor);
    if (!sheet || !stats) { context.loadout = null; return context; }
    const loadout = BL.resolveBodyLoadout(sheet);
    const readied = BL.readiedWeapons(sheet);
    const hitLocations = sheet.hitLocations ?? [];
    const armor = sheet.armor ?? [];
    const characterSM = num(sheet.sizeModifier);
    const weaponMods = sheet.weaponModifications ?? [];
    // :238-257 - weapons that could be readied but are not (storage excluded: gear in a pack is not on the body).
    const spares = [];
    for (const [kind, source] of Object.entries(KIND_SOURCE)) {
      for (const w of sheet[source] ?? []) {
        if (!w || w.equipped || w.storageLocationId) continue;
        const worn = engine.wornWeapons.isWornWeapon(w);
        spares.push({ id: String(w.id), name: String(w.customName ?? w.name ?? loc('SHADOWBASE.Apps.Loadout.UnnamedWeapon')), kind, constructed: w.isConstructed !== false, worn, needs: worn ? 1 : engine.isWeaponTwoHanded(w, weaponMods) ? 2 : 1 });
      }
    }
    // :263-266 - armour they own but are not wearing.
    const spareArmor = armor.filter((item) => !BL.isWorn(item) && !item.isInstalled && !item.storageLocationId);
    const drAt = (id) => stats.dynamicHitLocations?.find((l) => l.id === id)?.totalDR ?? 0;
    const hands = hitLocations.filter((l) => !l.isAmputated && String(l.type) === 'Hand');
    const arms = hitLocations.filter((l) => !l.isAmputated && String(l.type) === 'Arm');
    const nameOf = (id) => hitLocations.find((l) => l.id === id)?.name ?? loc('SHADOWBASE.Apps.Loadout.Somewhere');
    const fitOf = (item) => { const fit = engine.armorFit.armorFit(item.itemSizeModifier, characterSM); return fit === 'Fitted' ? null : fit; };
    const armorChip = (item) => ({ id: item.id, name: item.name, fit: fitOf(item), fitLabel: fitOf(item) ? loc(`SHADOWBASE.Apps.Loadout.Fit.${fitOf(item) === 'Ill-Fitting' ? 'IllFitting' : 'Unwearable'}`) : '' });

    const rows = loadout.rows.map((row) => {
      const isHand = String(row.location.type) === 'Hand';
      const worn = row.worn.map(armorChip);
      const held = row.held.map((p) => {
        const w = p.weapon;
        const limbs = w.worn ? arms : hands;
        return {
          id: w.id, name: w.name, twoHanded: !!w.twoHanded, worn: !!w.worn, pinned: !!p.pinned, others: p.locationIds.length - 1, othersTitle: p.locationIds.map(nameOf).join(' + '),
          heading: loc(w.worn ? 'SHADOWBASE.Apps.Loadout.WornOn' : w.twoHanded ? 'SHADOWBASE.Apps.Loadout.HeldInTwo' : 'SHADOWBASE.Apps.Loadout.HeldIn'),
          limbs: limbs.map((l) => ({ id: l.id, name: l.name, checked: p.locationIds.includes(l.id), field: `loadout.pin.${w.id}.${l.id}` })), noLimbs: limbs.length === 0,
        };
      });
      const wearable = spareArmor.filter((item) => BL.isWornOn(item, row.location));
      const empty = row.worn.length === 0 && row.held.length === 0 && row.protectedBy.length === 0;
      const overloaded = row.held.filter((p) => !p.weapon.worn).length > 1;
      return {
        id: row.location.id, name: row.location.name, type: String(row.location.type), dr: drAt(row.location.id), isHand,
        worn, held, overloaded, empty: empty && !isHand && wearable.length === 0,
        protectedBy: row.protectedBy.map((p) => `+${p.dr} ${loc('SHADOWBASE.Apps.Loadout.From')} ${p.item.name}`).join(', '),
        wear: wearable.length ? { field: `loadout.wear.${row.location.id}`, label: loc(row.worn.length === 0 ? 'SHADOWBASE.Apps.Loadout.WearSomething' : 'SHADOWBASE.Apps.Loadout.Wear'), options: wearable.map((i) => ({ value: i.id, label: i.name })) } : null,
        ready: isHand && row.held.length === 0 ? { field: `loadout.ready.${row.location.id}`, disabled: !spares.some((s) => !s.worn), label: loc(spares.some((s) => !s.worn) ? 'SHADOWBASE.Apps.Loadout.EmptyReady' : 'SHADOWBASE.Apps.Loadout.Empty'), options: spares.filter((s) => !s.worn).map((s) => ({ value: s.id, label: `${s.name}${s.needs > 1 ? ' [2H]' : ''}${s.constructed ? '' : ` (${loc('SHADOWBASE.Apps.Loadout.Unbuilt')})`}` })) } : null,
      };
    });

    // The Shield Projector strip (:81-204) - only when the build fits one.
    const field = actor.system?.isDroid ? engine.droidDr.droidHardwareDr(sheet, stats.dynamicHitLocations).forceField : null;
    const mods = actor.system?.droidBuild?.chassisMods ?? {};
    const pp = actor.system?.powerPoints == null ? null : num(actor.system.powerPoints);
    const condition = text(mods.shieldEmitterCondition) || 'Fine';
    const shieldActive = !!mods.shieldActive;
    const deflector = field?.fitted ? {
      max: field.max, current: field.current, active: field.active, switched: shieldActive, condition, conditionBad: condition !== 'Fine',
      drain: engine.droidDr.SHIELD_DRAIN_PP_PER_MIN, minutesLeft: pp == null ? null : Math.floor(pp / engine.droidDr.SHIELD_DRAIN_PP_PER_MIN), hasPp: pp != null,
      wear: mods.shieldCurrentDr ?? field.max,
      collapsedLine: shieldActive && !field.active ? loc(pp != null && pp <= 0 ? 'SHADOWBASE.Apps.Loadout.FieldCollapsed' : condition === 'Broken' ? 'SHADOWBASE.Apps.Loadout.EmitterBroken' : 'SHADOWBASE.Apps.Loadout.FieldWornOut') : '',
      conditions: ['Fine', 'Damaged', 'Broken'].map((c) => ({ value: c, label: loc(`SHADOWBASE.Apps.Loadout.Emitter.${c}`), active: condition === c, bad: c !== 'Fine' })),
    } : null;
    // Belt energy shields (Ch13): the isActive toggle and the DR the profile grants while on.
    const shields = rowsOf(actor, 'armor').filter((i) => i.system.row?.type === 'Energy Shield').map((i) => {
      const r = i.system.row;
      const profile = engine.shieldRules.shieldProfileForItem(r);
      return { itemId: i.id, name: i.displayName ?? i.name, isActive: !!r.isActive, dr: profile?.dr ?? null, activeDR: engine.shieldRules.shieldActiveDR(r), effects: text(r.effects) };
    });
    const bonuses = engine.gearSets.activeSetBonuses(armor).map((b) => ({ id: b.id, setName: b.setName, reason: b.reason, description: b.description }));

    context.loadout = {
      editable: this.editable,
      readiedCount: readied.length, freeHands: loadout.freeHandIds.length, handCount: hands.length,
      rows, hasRows: rows.length > 0,
      unlocated: loadout.unlocated.map(armorChip), hasUnlocated: loadout.unlocated.length > 0,
      unplaced: loadout.unplaced.map((w) => ({ id: w.id, name: w.name, twoHanded: !!w.twoHanded, worn: !!w.worn, limb: loc(w.worn ? 'SHADOWBASE.Apps.Loadout.Arm' : 'SHADOWBASE.Apps.Loadout.Hand') })),
      deflector, shields, hasShields: shields.length > 0, bonuses, hasBonuses: bonuses.length > 0,
    };
    return context;
  }

  // ---------------------------------------------------------------------------
  // Fields: the wear / ready selects and the pin checkboxes
  // ---------------------------------------------------------------------------

  async _onOwnField(field, value) {
    let m;
    if ((m = /^wear\.(.+)$/.exec(field))) { if (!value) return false; await this.wearArmor(String(value), true); return true; }
    if ((m = /^ready\.(.+)$/.exec(field))) { if (!value) return false; await this.readyInto(String(value), m[1]); return true; }
    if ((m = /^pin\.([^.]+)\.(.+)$/.exec(field))) { await this.togglePin(m[1], m[2]); return true; }
    if (field === 'shieldCurrentDr') {
      const n = Number.parseInt(String(value ?? ''), 10);
      const build = buildOf(this.actor);
      const max = engine.droidDr.droidHardwareDr(sheetOf(this.actor), statsOf(this.actor)?.dynamicHitLocations ?? []).forceField.max;
      const next = Number.isNaN(n) ? null : Math.max(0, Math.min(max, n));
      if ((build.chassisMods.shieldCurrentDr ?? null) === next) return false;
      await this.setShieldMod('shieldCurrentDr', next);
      return true;
    }
    return false;
  }

  /**
   * Wear or take off an armor row. Wearing runs Ch13's layering over the whole
   * armor list with this item preferred (armorLayering.enforceBaseLayer) and
   * writes every equipped flag it changed; the displaced pieces are named.
   * @param {string} rowId the armor row's uuid
   * @param {boolean} equip
   */
  async wearArmor(rowId, equip) {
    const actor = this.actor;
    const rows = storedRows(actor, 'armor').map((r) => ({ ...r }));
    const target = rows.find((r) => r.id === rowId);
    if (!target) { notify('warn', loc('SHADOWBASE.Apps.Loadout.NoSuchArmor')); return null; }
    const before = new Map(rows.map((r) => [r.id, !!r.equipped]));
    target.equipped = !!equip;
    if (equip && target.storageLocationId) target.storageLocationId = null;
    const changes = equip ? engine.armorLayering.enforceBaseLayer(rows, rowId) : [];
    const updates = [];
    for (const r of rows) {
      const own = itemByRowId(actor, r.id);
      if (!own) continue;
      if (before.get(r.id) !== !!r.equipped) updates.push({ _id: own.id, 'system.row.equipped': !!r.equipped, ...(r.id === rowId && equip ? { 'system.row.storageLocationId': null } : {}) });
    }
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    if (changes.length) notify('info', fmt('SHADOWBASE.Apps.Loadout.BaseLayerSwapped', { names: changes.map((c) => c.itemName).join(', ') }));
    return { equipped: !!equip, displaced: changes };
  }

  /** :293-297 - a weapon row patched on its Item (the array identity lesson is moot here: an Item update is a write). */
  async updateWeapon(rowId, patch) {
    const item = itemByRowId(this.actor, rowId);
    if (!item) return null;
    await item.updateRow(patch);
    return item;
  }

  /** :299-302 - putting a weapon away says nothing about which hand it came from. */
  async unready(rowId) { return this.updateWeapon(rowId, { equipped: false, equippedAt: null, heldLocationIds: [] }); }

  /** :304-329 - ready a spare into a hand; an unbuilt weapon is refused; a two-hander warns. */
  async readyInto(rowId, locationId) {
    const item = itemByRowId(this.actor, rowId);
    if (!item) return null;
    const row = item.system.row;
    if (row.isConstructed === false) { notify('error', loc('SHADOWBASE.Apps.Loadout.IncompleteWeapon')); return null; }
    await item.updateRow({ equipped: true, equippedAt: Date.now(), heldLocationIds: [locationId] });
    const needs = engine.wornWeapons.isWornWeapon(row) ? 1 : engine.isWeaponTwoHanded(row, sheetOf(this.actor)?.weaponModifications ?? []) ? 2 : 1;
    if (needs > 1) notify('info', fmt('SHADOWBASE.Apps.Loadout.TwoHanded', { name: item.displayName ?? item.name }));
    return item;
  }

  /** :336-342 - a toggle capped at what the weapon needs (a third hand for a two-hander drops the oldest). */
  async togglePin(rowId, locationId) {
    const sheet = sheetOf(this.actor);
    const w = BL.readiedWeapons(sheet).find((x) => x.id === rowId);
    if (!w) return null;
    const current = w.pinned;
    const next = current.includes(locationId) ? current.filter((id) => id !== locationId) : [...current, locationId].slice(-w.needs);
    return this.updateWeapon(rowId, { heldLocationIds: next });
  }

  async clearPin(rowId) { return this.updateWeapon(rowId, { heldLocationIds: [] }); }

  /** The deflector's state on droidBuild.chassisMods, written as the whole build (§6.5). */
  async setShieldMod(key, value) {
    const build = buildOf(this.actor);
    build.chassisMods[key] = value;
    await this.actor.update({ 'system.droidBuild': build });
    return build;
  }

  static async onUnwear(event, target) { event?.preventDefault?.(); const id = target?.dataset?.itemId; return id ? this.wearArmor(id, false) : null; }
  static async onUnready(event, target) { event?.preventDefault?.(); const id = target?.dataset?.itemId; return id ? this.unready(id) : null; }
  static async onClearPin(event, target) { event?.preventDefault?.(); const id = target?.dataset?.itemId; return id ? this.clearPin(id) : null; }
  static async onToggleShield(event) { event?.preventDefault?.(); const mods = this.actor.system?.droidBuild?.chassisMods ?? {}; return this.setShieldMod('shieldActive', !mods.shieldActive); }
  static async onSetEmitter(event, target) { event?.preventDefault?.(); const c = target?.dataset?.condition; return this.setShieldMod('shieldEmitterCondition', c === 'Fine' || !c ? null : c); }
  /** :189-200 - one minute of field uptime deducted from the core. */
  static async onTickShield(event) { event?.preventDefault?.(); const pp = num(this.actor.system?.powerPoints); return this.actor.update({ 'system.powerPoints': Math.max(0, pp - engine.droidDr.SHIELD_DRAIN_PP_PER_MIN) }); }
  static async onToggleEnergyShield(event, target) { event?.preventDefault?.(); const item = this.itemOf(target); if (!item) return null; await item.updateRow({ isActive: !item.system?.row?.isActive }); return item; }
}

export default BodyLoadout;
