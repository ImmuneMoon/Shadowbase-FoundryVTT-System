// module/documents/actor.mjs
//
// ShadowBaseActor (docs/ARCHITECTURE.md §4.1). Accessors over the data model,
// the token-bar mapping, roll data, row lookups and the sheet import/export
// primitives. No sheet UI here (units U05-U07); no effect operations (U02b).

import { engine } from '../engine.mjs';
import { actorToSheet, sheetToActorData, rowsOf, nextSort, effectToStatusEffect, isStatusEffect } from '../adapter.mjs';

const BaseActor = globalThis.foundry?.documents?.Actor ?? globalThis.Actor;

/**
 * Token bar attribute -> the stored field it edits (ARCHITECTURE.md §4.1).
 * `resources.*` themselves are derived (never in _source), so a bar edit has to
 * land on the website's own current-pool field.
 */
const BAR_FIELDS = Object.freeze({
  'resources.hp': 'currentHitPoints',
  'resources.ep': 'currentEndurancePoints',
  'resources.fp': 'currentForcePoints',
  'resources.pp': 'powerPoints',
});

/** Pools that cannot go below zero. HP is not one of them: Ch7 injury takes HP negative and the death checks read it. */
const FLOOR_AT_ZERO = new Set(['resources.ep', 'resources.fp', 'resources.pp']);

export class ShadowBaseActor extends BaseActor {
  /** The composed website sheet the engine last read (CharacterFormValues). */
  get sheetData() { return this.system?.sheetCache ?? null; }

  /** The engine's CalculatedStatsResult, or null when the engine failed (see system.engineError). */
  get stats() { return this.system?.derived ?? null; }

  /** Items of one website array, in sheet order. */
  rowsOf(source) { return rowsOf(this, source); }

  /** The `sort` a new row appended to `source` gets. */
  nextSort(source) { return nextSort(this, source); }

  /** The Item whose stored row carries this uuid, or null. */
  itemByRowId(uuid) {
    if (!uuid) return null;
    return this.items.find((i) => i.system?.row?.id === uuid) ?? null;
  }

  /** The stored status-effect rows, as the engine reads them. */
  effectsAsStatusEffects() {
    return this.effects.filter(isStatusEffect).map(effectToStatusEffect);
  }

  /** The ActiveEffect carrying the status-effect row with this id, or null. */
  effectByRowId(id) {
    if (!id) return null;
    return this.effects.find((e) => e.flags?.shadowbase?.statusEffect?.id === id) ?? null;
  }

  /**
   * Token bar edits (ARCHITECTURE.md §4.1): `resources.hp/ep/fp` write the
   * website's current-pool fields, `resources.pp` writes powerPoints; bars are
   * clamped to their max. Anything else falls through to Foundry's default.
   */
  async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
    const field = BAR_FIELDS[attribute];
    if (!field) return super.modifyTokenAttribute(attribute, value, isDelta, isBar);
    const pool = foundry.utils.getProperty(this.system, attribute) ?? { value: 0, max: 0 };
    let next = isDelta ? (Number(pool.value) || 0) + Number(value) : Number(value);
    if (!Number.isFinite(next)) return this;
    if (isBar && Number.isFinite(pool.max)) next = Math.min(next, pool.max);
    if (FLOOR_AT_ZERO.has(attribute)) next = Math.max(0, next);
    next = Math.round(next);
    const updates = { [`system.${field}`]: next };
    const allowed = Hooks.call('modifyTokenAttribute', { attribute, value: next, isDelta, isBar }, updates);
    return allowed !== false ? this.update(updates) : this;
  }

  /** Roll data: the engine's current values plus the initiative figure (ARCHITECTURE.md §4.1). */
  getRollData() {
    const stats = this.stats;
    return { ...(stats?.currentValues ?? {}), initiative: this.system?.initiative ?? 0 };
  }

  /**
   * The website's character JSON for this actor (convertSheetToJson, the same
   * function Export JSON runs). The exporter reads three echo fields off the
   * sheet that Foundry never stores (damageThrust, damageSwing, basicLift -
   * module/adapter.mjs DEAD_ECHO_FIELDS); they are filled from the live stats
   * here so the file carries what the website's would.
   * @returns {object}
   */
  exportSheet() {
    const sheet = this.sheetData ?? actorToSheet(this);
    const stats = this.stats ?? engine.getCalculatedStats(sheet);
    const filled = { ...sheet, damageThrust: stats.damageThrust, damageSwing: stats.damageSwing, basicLift: stats.basicLift };
    return engine.convertSheetToJson(filled, stats);
  }

  /**
   * Replace this actor's data from a website character JSON (or an already
   * converted sheet) through the website's own load path: convertJsonToSheet,
   * spread over the blank sheet, applyLoadMigrations (unit U01 - a clear error
   * until it lands), then sheetToActorData.
   * @param {object|string} jsonOrSheet a character file (parsed or text) or a CharacterFormValues
   * @param {{ mode?: 'replace', keepName?: boolean }} [options]
   * @returns {Promise<{ notices: string[] }>}
   */
  async importSheet(jsonOrSheet, { mode = 'replace', keepName = false } = {}) {
    if (mode !== 'replace') throw new Error(game.i18n.format('SHADOWBASE.Import.UnknownMode', { mode }));
    let input = jsonOrSheet;
    if (typeof input === 'string') {
      try { input = JSON.parse(input); } catch (err) { throw new Error(game.i18n.format('SHADOWBASE.Import.InvalidJson', { error: err.message })); }
    }
    if (!input || typeof input !== 'object') throw new Error(game.i18n.format('SHADOWBASE.Import.InvalidJson', { error: 'not an object' }));
    const isCharacterFile = input.type === 'character' || 'investment' in input || 'traits' in input;
    // applyLoadMigrations mutates nested rows of what it is given (it came from the
    // website's load hook); a caller's sheet object must survive, so it gets a clone.
    const converted = isCharacterFile ? engine.convertJsonToSheet(input) : foundry.utils.deepClone(input);
    const applyLoadMigrations = engine.requireExport('applyLoadMigrations');
    const { data, notices = [] } = applyLoadMigrations({ ...engine.blank(), ...converted }, engine.blankSheetData);
    const actorData = sheetToActorData(data, { actorName: keepName ? this.name : undefined });
    await this.deleteEmbeddedDocuments('Item', this.items.map((i) => i.id));
    await this.deleteEmbeddedDocuments('ActiveEffect', this.effects.map((e) => e.id));
    // Replace the system wholesale: recursive false so an import cannot leave a stale key behind.
    await this.update({ name: actorData.name, system: actorData.system }, { recursive: false, diff: false });
    if (actorData.items.length) await this.createEmbeddedDocuments('Item', actorData.items);
    if (actorData.effects.length) await this.createEmbeddedDocuments('ActiveEffect', actorData.effects);
    return { notices };
  }

  /**
   * The per-turn sweep (ARCHITECTURE.md §5.2): the free facing change comes
   * back, the Multiple Parries tally resets, expired effects go. Never touches
   * isUnready, lastAttackTurn, pendingHits or stunType (as on the website).
   * The effect sweep itself is module/effects.mjs (unit U02b); until it
   * registers on game.shadowbase.effects the expired effects are removed here
   * by the same rule (expiresAfterTurn < turn).
   * @param {number} turn
   * @returns {Promise<string[]>} names of the effects removed
   */
  async sweepTurn(turn) {
    await this.update({ 'system.facingChangeUsed': false, 'system.parriesThisTurn': 0 });
    const sweep = globalThis.game?.shadowbase?.effects?.sweepExpired;
    if (typeof sweep === 'function') return sweep(this, turn);
    const expired = this.effects.filter((e) => isStatusEffect(e) && typeof e.isExpiredAt === 'function' && e.isExpiredAt(turn));
    if (expired.length) await this.deleteEmbeddedDocuments('ActiveEffect', expired.map((e) => e.id));
    return expired.map((e) => e.name);
  }
}

export default ShadowBaseActor;
