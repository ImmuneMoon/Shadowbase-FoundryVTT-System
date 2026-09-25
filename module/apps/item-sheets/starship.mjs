// module/apps/item-sheets/starship.mjs
//
// Starship (customized-starship-item.tsx, starship-system-damage.tsx):
//   build  the Base Chassis (STARSHIP_CHASSIS_DATA; changing it copies the
//          chassis's printed figures onto the base* fields - handleChassisChange
//          :48-62), the Modifications (starshipMods.starshipSlotOptions per
//          slot, priced on THIS hull, a duplicate greyed with its reason; an
//          Offensive slot's Additional Weapon Mount opens two weapon mounts),
//          the design-point fields the DP builder writes (app-own, no book
//          citation - digest B fact 8);
//   main   Final Analysis (the derived readouts - starshipDerivation through
//          item.derived), Total Construction Value, the Damage Control Matrix
//          (the nine tracked systems: HP / status / notes edited here and
//          written as the WHOLE array), the armaments with damage rolls, the
//          crew assignment fields the row carries.

import { engine } from '../../engine.mjs';
import { CREW_POSITIONS } from '../actor-sheet-tabs.mjs';
import { ShadowBaseItemSheet, statTile, loc, notify, text, num, money } from './base.mjs';

const TAB_IDS = ['main', 'build', 'notes'];
const SYSTEM_STATUSES = Object.freeze(['Nominal', 'Damaged', 'Disabled']);
const MOD_SLOTS = Object.freeze([
  { field: 'performanceMod', label: 'SHADOWBASE.Item.Starship.PerformanceMod', category: 'Performance' },
  { field: 'defensiveMod1', label: 'SHADOWBASE.Item.Starship.DefensiveMod1', category: 'Defensive' },
  { field: 'defensiveMod2', label: 'SHADOWBASE.Item.Starship.DefensiveMod2', category: 'Defensive' },
  { field: 'offensiveMod1', label: 'SHADOWBASE.Item.Starship.OffensiveMod1', category: 'Offensive', mounts: ['offensiveMod1Mount1', 'offensiveMod1Mount2'] },
  { field: 'offensiveMod2', label: 'SHADOWBASE.Item.Starship.OffensiveMod2', category: 'Offensive', mounts: ['offensiveMod2Mount1', 'offensiveMod2Mount2'] },
  { field: 'utilityMod1', label: 'SHADOWBASE.Item.Starship.UtilityMod1', category: 'Utility' },
  { field: 'utilityMod2', label: 'SHADOWBASE.Item.Starship.UtilityMod2', category: 'Utility' },
]);
const DP_NUMBERS = Object.freeze(['dpHandlingMod', 'dpSpeedMod', 'dpAccelMod', 'dpHpMod', 'dpDrMod', 'dpHyperdriveMod', 'dpCargoMod', 'dpPassengerMod', 'dpQuirkPoints', 'dpWeaponHardpoints']);
const DP_MOUNTS = Object.freeze(['dpWeaponMount1', 'dpWeaponMount2', 'dpWeaponMount3', 'dpWeaponMount4']);

export class StarshipSheet extends ShadowBaseItemSheet {
  static FAMILY = 'starship';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('starship', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);
  static DEFAULT_OPTIONS = {
    position: { width: 760, height: 800 },
    actions: { 'roll-armament': StarshipSheet.#onRollArmament },
  };

  chassis() { return engine.starshipChassisData.STARSHIP_CHASSIS_DATA.find((c) => c.name === this.item.system?.row?.baseChassis) ?? null; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = this.actor;
    const row = context.row;
    const merged = context.merged;
    const sm = engine.starshipMods;
    const chassis = this.chassis();
    const hullCost = chassis?.cost ?? 0;
    const fields = engine.starshipDerivation.STARSHIP_SLOT_FIELDS;
    const weapons = engine.starshipWeapons.STARSHIP_WEAPONS_LIBRARY.filter((w) => w.name !== 'None');
    const weaponSelect = (field) => ({ field, label: loc(`SHADOWBASE.Item.Starship.${field}`), options: [{ value: 'None', label: loc('SHADOWBASE.Item.Starship.NoWeapon'), selected: !row[field] || row[field] === 'None' }, ...weapons.map((w) => ({ value: w.name, label: `${w.name} (${money(w.cost)} cr)`, selected: row[field] === w.name }))] });
    const mods = MOD_SLOTS.map((slot) => {
      const fittedElsewhere = fields.filter((f) => f !== slot.field).map((f) => row[f]).filter((v) => typeof v === 'string');
      const opts = sm.starshipSlotOptions(slot.category, { hullCost }, fittedElsewhere);
      const current = text(row[slot.field]) || 'None';
      return {
        field: slot.field, label: loc(slot.label),
        options: opts.map((o) => ({ value: o.name, label: `${o.displayName} (${o.unavailableReason ?? o.costLabel})`, selected: o.name === current, disabled: !!o.unavailableReason, effect: text(o.effect) })),
        effect: text(opts.find((o) => o.name === current)?.effect),
        mounts: slot.mounts && row[slot.field] === 'Additional Weapon Mount' ? slot.mounts.map(weaponSelect) : [],
      };
    });
    const systems = (Array.isArray(merged.systems) ? merged.systems : []).map((s) => ({
      id: text(s.id), name: text(s.name), dr: s.dr ?? null, hp: s.hp ?? null, maxHp: s.maxHp ?? null, status: text(s.status) || 'Nominal', notes: text(s.notes),
      statusOptions: SYSTEM_STATUSES.map((v) => ({ value: v, label: loc(`SHADOWBASE.Sheet.Vehicles.Status.${v}`), selected: (text(s.status) || 'Nominal') === v })),
      tone: (text(s.status) || 'Nominal') === 'Nominal' ? 'ok' : text(s.status) === 'Damaged' ? 'warn' : 'bad',
    }));
    context.main = {
      tiles: [
        statTile(loc('SHADOWBASE.Sheet.Vehicles.Handling'), merged.finalHandling),
        statTile(loc('SHADOWBASE.Sheet.Vehicles.SublightSpeed'), merged.finalSpeed),
        statTile(loc('SHADOWBASE.Sheet.Vehicles.TotalHp'), merged.finalHp == null ? '' : money(merged.finalHp)),
        statTile(loc('SHADOWBASE.Sheet.Vehicles.StandardDr'), merged.finalDr == null ? '' : money(merged.finalDr)),
        statTile(loc('SHADOWBASE.Sheet.Vehicles.Hyperdrive'), merged.finalHyperdrive),
        statTile(loc('SHADOWBASE.Item.Starship.AccelDecel'), row.baseAccelDecel),
      ],
      constructionValue: money(merged.finalCost),
      crew: text(row.baseCrew), passengers: text(row.basePassengers), cargo: text(row.baseCargo),
      notes: text(merged.finalNotesAndEffects),
      systems,
      hasSystems: systems.length > 0,
      armaments: (Array.isArray(merged.armaments) ? merged.armaments : []).map((a) => ({ name: text(a.name), damage: text(a.damage), skill: text(a.skill), rollable: !!actor && !!a.damage })),
      quantity: num(row.quantity, 1) || 1,
      positions: [{ value: '', label: loc('SHADOWBASE.Sheet.Vehicles.SelectRole'), selected: !row.shipPosition }, ...CREW_POSITIONS.map((p) => ({ value: p, label: p, selected: row.shipPosition === p }))],
      stations: [{ value: '', label: loc('SHADOWBASE.Sheet.Vehicles.SelectStation'), selected: !row.assignedStation }, ...engine.shipStations.SHIP_STATIONS.map((s) => ({ value: s, label: s, selected: row.assignedStation === s }))],
    };
    context.build = {
      chassis: [{ value: '', label: loc('SHADOWBASE.Item.Starship.SelectChassis'), selected: !row.baseChassis }, ...engine.starshipChassisData.STARSHIP_CHASSIS_DATA.map((c) => ({ value: c.name, label: `${c.name} (${c.type}, ${money(c.cost)} cr)`, selected: c.name === row.baseChassis }))],
      chassisNotes: text(chassis?.notes),
      hullCost: money(hullCost),
      base: { handling: text(row.baseHandling), speed: text(row.baseSpeed), accel: text(row.baseAccelDecel), hp: row.baseHp ?? null, dr: row.baseDr ?? null, weapons: text(row.baseWeapons), weaponSkill: text(row.baseWeaponSkill), hyperdrive: text(row.baseHyperdrive), cost: money(row.baseCost) },
      mods,
      dp: DP_NUMBERS.map((f) => ({ field: f, label: loc(`SHADOWBASE.Item.Starship.${f}`), value: row[f] ?? null })),
      dpMounts: DP_MOUNTS.map(weaponSelect),
      dpSystemQuirks: text(row.dpSystemQuirks),
      modLimitNote: loc('SHADOWBASE.Item.Starship.ModLimitNote'),
    };
    return context;
  }

  /**
   * Edits: `sys.<id>.<hp|status|notes>` (the whole systems array rewritten);
   * a `system.row.baseChassis` change copies the chassis figures (:48-62).
   */
  async _applyEdits(edits, submitData) {
    const after = await super._applyEdits(edits, submitData);
    const row = this.item.system?.row ?? {};
    const merged = this.item.rowWithDerived?.() ?? row;
    const per = new Map();
    for (const [key, value] of Object.entries(edits)) {
      const m = /^sys\.([^.]+)\.(hp|status|notes)$/.exec(key);
      if (!m) continue;
      (per.get(m[1]) ?? per.set(m[1], {}).get(m[1]))[m[2]] = value;
    }
    if (per.size) {
      const systems = (Array.isArray(merged.systems) ? merged.systems : []).map((s) => {
        const patch = per.get(text(s?.id));
        if (!patch) return s;
        const out = { ...s };
        for (const [k, v] of Object.entries(patch)) out[k] = k === 'hp' ? num(v) : text(v);
        return out;
      });
      this._mergeRow(submitData, { systems });
    }
    const nextChassis = submitData.system?.row?.baseChassis;
    if (nextChassis !== undefined && nextChassis !== row.baseChassis) {
      const c = engine.starshipChassisData.STARSHIP_CHASSIS_DATA.find((x) => x.name === nextChassis);
      if (c) this._mergeRow(submitData, { baseHandling: c.handling, baseSpeed: c.speed, baseAccelDecel: c.accelDecel, baseHp: c.hp, baseDr: c.dr, baseCrew: c.crew, basePassengers: c.passengers, baseCargo: c.cargo, baseCost: c.cost, baseWeapons: c.weapons, baseWeaponSkill: c.weaponSkill, baseHyperdrive: c.hyperdrive });
    }
    return after;
  }

  /** An armament's damage line (data-formula, data-label) through module/rolls.mjs. */
  static async #onRollArmament(event, target) {
    const rolls = globalThis.game?.shadowbase?.rolls;
    const formula = target?.dataset?.formula;
    if (!this.actor || !rolls?.rollDamage || !formula) return notify('warn', loc('SHADOWBASE.Item.Roll.NeedsOwner'));
    return rolls.rollDamage(this.actor, { label: target.dataset.label ?? formula, formula });
  }
}

export default StarshipSheet;
