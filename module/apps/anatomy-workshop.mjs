// module/apps/anatomy-workshop.mjs
//
// AnatomyWorkshop (docs/ARCHITECTURE.md §6.5): the website's
// src/components/character-sheet/components/anatomy-workshop.tsx as an
// ApplicationV2 window over `system.hitLocations` - the actor-level row array
// (ARCHITECTURE §9.1: hit locations are an actor field, not Items). Every
// edit writes the WHOLE array (never a per-index dotted key, §6.5).
//
// Rules from the bundle: hitLocations.STANDARD_HUMANOID_ANATOMY (Reset
// Bio-Plan) and nonStandardLocationIds (which rows are off the plan),
// anatomy.sideOf / amputationCascade (a hand does not survive its arm),
// inventorySchemas.HIT_LOCATION_TYPES / BODY_SIDES (the selects),
// implantEffects.implantCpCharges (the CP an installed implant charges),
// droidAnatomy (a droid's rows are DERIVED from its build and reconciled
// with the stored state - the frame is locked, only status / degradation /
// hardware links are the player's; the engine ignores a droid's stored rows,
// engine-load-path digest fact 16).
//
// Hardware links are REVERSE (schema-inventory digest fact 15): the location
// row names the implant / limb ids in `installedHardwareIds`; the hardware row
// carries only `installed: true`. Linking writes both, the way
// handleToggleHardware does (anatomy-workshop.tsx:151-182).

import { engine } from '../engine.mjs';
import { ActorSubApp, TEMPLATE_ROOT, loc, fmt, notify, num, text, statsOf, storedRows, writeWholeArray, clone, itemByRowId } from './sub-app.mjs';
import { reconciledAnatomy, anatomyInSync } from './droid-workshop.mjs';

export const HIT_LOCATION_TYPES = engine.inventorySchemas.HIT_LOCATION_TYPES;
export const BODY_SIDES = engine.inventorySchemas.BODY_SIDES;
export const LOCATION_STATUSES = Object.freeze(['Healthy', 'Crippled', 'Destroyed', 'Corrupted']);
/** anatomy-workshop.tsx:240-241 - the utility implant capacity of a location type. */
export function maxUtilityFor(type) {
  if (!['Head', 'Torso', 'Arm', 'Leg', 'Upper Torso'].includes(type)) return 0;
  return type === 'Torso' ? 2 : 1;
}
/** anatomy-workshop.tsx:249-263 - which implants a location can take. */
export function implantFits(implant, type, isProsthetic) {
  if (isProsthetic) return false;
  if (implant.slotType === 'Neural') return type === 'Head' || type === 'Processor';
  if (implant.slotType === 'Eye' || implant.slotType === 'Ear') return type === 'Face';
  if (implant.slotType === 'Utility') {
    if (implant.location === 'Torso') return type === 'Torso' || type === 'Upper Torso';
    return ['Head', 'Torso', 'Arm', 'Leg'].includes(type);
  }
  return false;
}

/** The website's new-row literal (anatomy-workshop.tsx:106-120). */
export function newLocation(isDroid) {
  return { id: engine.rowId(), name: 'New Appendage', type: 'Arm', relativeSM: 0, isOrganic: !isDroid, status: 'Healthy', innateDR: 0, currentDegradation: 0, isAmputated: false, installedHardwareIds: [], parentRoll: null };
}

export class AnatomyWorkshop extends ActorSubApp {
  static APP_NAME = 'anatomy-workshop';
  static TITLE_KEY = 'SHADOWBASE.Apps.Anatomy.WindowTitle';
  static FIELD_PREFIX = 'anatomy.';

  static DEFAULT_OPTIONS = {
    window: { title: 'SHADOWBASE.Apps.Anatomy.WindowTitle', icon: 'fa-solid fa-diagram-project', resizable: true },
    position: { width: 700, height: 760 },
    actions: {
      'add-location': AnatomyWorkshop.onAddLocation,
      'reset-bio-plan': AnatomyWorkshop.onResetBioPlan,
      'amputate': AnatomyWorkshop.onAmputate,
      'discard-location': AnatomyWorkshop.onDiscardLocation,
      'unlink-hardware': AnatomyWorkshop.onUnlinkHardware,
      'sync-droid-anatomy': AnatomyWorkshop.onSyncDroidAnatomy,
    },
  };

  static PARTS = { anatomy: { template: `${TEMPLATE_ROOT}/anatomy-workshop.hbs`, scrollable: [''] } };

  get isDroid() { return !!this.actor.system?.isDroid; }
  /** The rows the workshop edits: the stored array (organic) or the derived anatomy reconciled with it (droid). */
  get rows() { return this.isDroid ? reconciledAnatomy(this.actor).map((l) => ({ ...l })) : clone(this.actor.system?.hitLocations ?? []); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const isDroid = this.isDroid;
    const stats = statsOf(actor);
    const rows = this.rows;
    const cybernetics = storedRows(actor, 'cybernetics');
    const implants = storedRows(actor, 'implants');
    const advantages = storedRows(actor, 'advantages');
    const charges = new Map(engine.implantEffects.implantCpCharges(implants, advantages).map((c) => [c.id, c]));
    const offPlan = engine.hitLocations.nonStandardLocationIds(rows);
    const dynamic = stats?.dynamicHitLocations ?? [];
    const characterSM = num(actor.system?.sizeModifier);
    const unitOf = (id) => cybernetics.find((c) => c.id === id) ?? implants.find((i) => i.id === id) ?? null;

    const locations = rows.map((entry, index) => {
      const dyn = dynamic.find((l) => l.id === entry.id) ?? entry;
      const installed = Array.isArray(entry.installedHardwareIds) ? entry.installedHardwareIds : [];
      const isProsthetic = !!dyn.isProsthetic;
      const isAmputated = !!entry.isAmputated;
      const type = text(dyn.type ?? entry.type);
      const limb = dyn.limbData ?? cybernetics.find((c) => installed.includes(c.id)) ?? null;
      const usedUtility = implants.filter((i) => installed.includes(i.id) && i.slotType === 'Utility').length;
      const usedEye = implants.filter((i) => installed.includes(i.id) && i.slotType === 'Eye').length;
      const usedEar = implants.filter((i) => installed.includes(i.id) && i.slotType === 'Ear').length;
      const maxUtility = maxUtilityFor(type);
      const availableHardware = cybernetics.filter((c) => (!c.installed || installed.includes(c.id)) && c.location === entry.name);
      const availableImplants = implants.filter((i) => (!i.installed || installed.includes(i.id)) && implantFits(i, type, isProsthetic));
      const canAcceptHardware = !isDroid && (!dyn.isOrganic || isAmputated || ['Head', 'Processor', 'Face', 'Torso', 'Upper Torso', 'Arm', 'Leg'].includes(type));
      const linkable = [
        ...availableHardware.filter((h) => !installed.includes(h.id)).map((h) => ({ value: h.id, label: `${h.name} (${h.material ?? loc('SHADOWBASE.Apps.Anatomy.Limb')})` })),
        ...(isProsthetic ? [] : availableImplants.filter((i) => !installed.includes(i.id)).map((i) => ({ value: i.id, label: `${i.name} (${i.slotType || i.category || loc('SHADOWBASE.Apps.Anatomy.Implant')})` }))),
      ];
      return {
        index, id: entry.id, name: text(dyn.name ?? entry.name) || loc('SHADOWBASE.Apps.Anatomy.UnnamedPart'), rawName: text(entry.name),
        type, side: text(entry.side ?? engine.anatomy.sideOf(entry)),
        isOrganic: !!entry.isOrganic, isProsthetic, isAmputated, status: text(entry.status) || 'Healthy',
        innateDR: num(entry.innateDR), degradation: num(entry.currentDegradation), locationNote: text(entry.locationNote),
        showPlacementNote: isDroid || offPlan.has(entry.id),
        placementPlaceholder: loc(isDroid ? 'SHADOWBASE.Apps.Anatomy.PlacementDroid' : 'SHADOWBASE.Apps.Anatomy.PlacementOrganic'),
        locked: isDroid || isProsthetic,
        typeOptions: HIT_LOCATION_TYPES.map((t) => ({ value: t, label: t, selected: t === text(entry.type) })),
        sideOptions: BODY_SIDES.map((s) => ({ value: s, label: loc(`SHADOWBASE.Apps.Anatomy.Side.${s}`), selected: s === text(entry.side ?? engine.anatomy.sideOf(entry)) })),
        statusOptions: LOCATION_STATUSES.map((s) => ({ value: s, label: loc(`SHADOWBASE.Apps.Anatomy.Status.${s}`), selected: s === (text(entry.status) || 'Healthy') })),
        showOrganicSwitch: installed.length === 0 && !isDroid && !isProsthetic,
        badges: { utility: maxUtility > 0 ? { used: usedUtility, max: maxUtility, over: usedUtility > maxUtility } : null, face: type === 'Face' ? { eyes: usedEye, ears: usedEar, eyesOver: usedEye > 2, earsOver: usedEar > 2 } : null },
        integrationLabel: loc(isProsthetic ? 'SHADOWBASE.Apps.Anatomy.ChassisLink' : 'SHADOWBASE.Apps.Anatomy.SurgicalPoint'),
        hardware: installed.map((id) => { const unit = unitOf(id); const charge = charges.get(id); return unit ? { id, name: unit.name, detail: [unit.material ? `${unit.material}` : null, unit.slotType ?? unit.category ?? null].filter(Boolean).join(' · '), cp: charge ? num(charge.cp ?? charge.points ?? charge.charge) : null, isLimb: cybernetics.some((c) => c.id === id) } : { id, name: id, detail: '', cp: null, isLimb: false }; }),
        hasHardware: installed.length > 0,
        linkable, canLink: linkable.length > 0 && (canAcceptHardware || isProsthetic) && !isDroid,
        linkLabel: loc(isDroid ? 'SHADOWBASE.Apps.Anatomy.FrameLocked' : installed.length > 0 ? 'SHADOWBASE.Apps.Anatomy.LinkMore' : 'SHADOWBASE.Apps.Anatomy.LinkUnits'),
        limbDr: isProsthetic && limb ? { name: limb.name, material: text(limb.material), extent: text(limb.extent), current: num(limb.currentDr ?? limb.dr), max: num(limb.dr), tone: num(limb.currentDr ?? limb.dr ?? 0) <= 0 ? 'broken' : num(limb.currentDr ?? 0) < num(limb.dr ?? 0) ? 'worn' : 'fine' } : null,
        showInnateInput: !isProsthetic && !isDroid,
        amputateLabel: loc(isAmputated ? 'SHADOWBASE.Apps.Anatomy.ResetSite' : 'SHADOWBASE.Apps.Anatomy.Amputate'),
        characterSM,
      };
    });

    context.anatomy = {
      isDroid, editable: this.editable, locations, count: locations.length,
      inSync: isDroid ? anatomyInSync(actor) : true,
      hardwareCount: cybernetics.length + implants.length,
    };
    return context;
  }

  // ---------------------------------------------------------------------------
  // Whole-array writes
  // ---------------------------------------------------------------------------

  async writeRows(rows) { return writeWholeArray(this.actor, 'hitLocations', rows); }

  /** A field of one row changed (`anatomy.<index>.<key>`); `link` is the picker's select. */
  async _onOwnField(field, value) {
    const m = /^(\d+)\.(\w+)$/.exec(field);
    if (!m) return false;
    const index = Number(m[1]);
    const key = m[2];
    const rows = this.rows;
    const row = rows[index];
    if (!row) return false;
    if (key === 'link') { if (!value) return false; await this.toggleHardware(index, String(value)); return true; }
    if (this.isDroid && !['status', 'currentDegradation', 'locationNote'].includes(key)) return false;
    let next = value;
    if (key === 'innateDR' || key === 'currentDegradation' || key === 'relativeSM') next = Number.parseInt(String(value ?? '0'), 10) || 0;
    else if (key === 'isOrganic') next = value === true || value === 'true' || value === 'on';
    else if (key === 'name' || key === 'type' || key === 'side' || key === 'status' || key === 'locationNote') next = value == null ? '' : String(value);
    else return false;
    if (row[key] === next) return false;
    rows[index] = { ...row, [key]: next };
    await this.writeRows(rows);
    return true;
  }

  /** anatomy-workshop.tsx:151-182 - link / unlink a unit; both the row and the hardware's `installed` flag move. */
  async toggleHardware(index, hardwareId) {
    const rows = this.rows;
    const row = rows[index];
    if (!row) return null;
    const current = Array.isArray(row.installedHardwareIds) ? row.installedHardwareIds : [];
    const linked = current.includes(hardwareId);
    const nextIds = linked ? current.filter((id) => id !== hardwareId) : [...current, hardwareId];
    const unit = itemByRowId(this.actor, hardwareId);
    if (unit) await unit.updateRow({ installed: !linked });
    rows[index] = { ...row, installedHardwareIds: nextIds };
    await this.writeRows(rows);
    return { linked: !linked, hardwareId };
  }

  /** :127-144 - amputating takes the dependent limb with it; restoring leaves it alone. */
  async amputate(index, amputate) {
    const rows = this.rows;
    if (!rows[index]) return null;
    rows[index] = { ...rows[index], isAmputated: !!amputate };
    let alsoLost = [];
    if (amputate) {
      alsoLost = engine.anatomy.amputationCascade(rows, rows[index].id);
      for (const id of alsoLost) { const i = rows.findIndex((l) => l.id === id); if (i > -1) rows[i] = { ...rows[i], isAmputated: true }; }
      if (alsoLost.length) notify('info', fmt('SHADOWBASE.Apps.Anatomy.AttachedLost', { names: alsoLost.map((id) => rows.find((l) => l.id === id)?.name).filter(Boolean).join(', ') }));
    }
    await this.writeRows(rows);
    return { alsoLost };
  }

  async addLocation() {
    if (this.isDroid) { notify('warn', loc('SHADOWBASE.Apps.Anatomy.FrameLocked')); return null; }
    const row = newLocation(this.isDroid);
    await this.writeRows([...this.rows, row]);
    return row;
  }

  async discardLocation(index) {
    if (this.isDroid) { notify('warn', loc('SHADOWBASE.Apps.Anatomy.FrameLocked')); return false; }
    const rows = this.rows;
    if (!rows[index]) return false;
    await this.writeRows(rows.filter((_, i) => i !== index));
    return true;
  }

  /** :146-149 - the standard twelve with fresh uuids and empty hardware links. */
  async resetBioPlan() {
    if (this.isDroid) { notify('warn', loc('SHADOWBASE.Apps.Anatomy.FrameLocked')); return null; }
    const rows = engine.hitLocations.STANDARD_HUMANOID_ANATOMY.map((l) => ({ ...clone(l), id: engine.rowId(), installedHardwareIds: [] }));
    await this.writeRows(rows);
    notify('info', loc('SHADOWBASE.Apps.Anatomy.Reset'));
    return rows;
  }

  /** A droid's stored rows brought to the derived anatomy (droid-workshop.mjs syncAnatomy). */
  async syncDroidAnatomy() {
    if (!this.isDroid) return false;
    if (anatomyInSync(this.actor)) return false;
    await this.writeRows(this.rows);
    return true;
  }

  static async onAddLocation(event) { event?.preventDefault?.(); return this.addLocation(); }
  static async onResetBioPlan(event) { event?.preventDefault?.(); return this.resetBioPlan(); }
  static async onAmputate(event, target) { event?.preventDefault?.(); return this.amputate(Number(target?.dataset?.index), target?.dataset?.amputate !== 'false'); }
  static async onDiscardLocation(event, target) { event?.preventDefault?.(); return this.discardLocation(Number(target?.dataset?.index)); }
  static async onUnlinkHardware(event, target) { event?.preventDefault?.(); return this.toggleHardware(Number(target?.dataset?.index), String(target?.dataset?.hardwareId ?? '')); }
  static async onSyncDroidAnatomy(event) { event?.preventDefault?.(); return this.syncDroidAnatomy(); }
}

export default AnatomyWorkshop;
