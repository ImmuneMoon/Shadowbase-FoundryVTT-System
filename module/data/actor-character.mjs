// module/data/actor-character.mjs
//
// CharacterData - the one Actor type (docs/ARCHITECTURE.md §4.1). Droids are
// characters with `isDroid: true`, as on the website.
//
// The schema is GENERATED (module/data/actor-schema.generated.mjs, from the
// bundle's characterSheetSchema by tools/gen-actor-schema.mjs); this class adds
// only behaviour. prepareDerivedData() is where the engine runs: it composes
// the website sheet from the actor, its Items and its ActiveEffects
// (module/adapter.mjs) and hands it to getCalculatedStats - the same function
// the website calls on every render - then publishes the result on `derived`
// and the token-facing pools on `resources`. Nothing derived is ever written
// to `_source` (check:derived-not-stored).
//
// Ordering (Foundry's ClientDocument#prepareData): items prepare BEFORE this
// runs, so a family whose derivation reads the owner's stats (melee) cannot
// derive on the first pass. After the first getCalculatedStats those items are
// re-run and, because the engine reads their persisted figures (finalWeight,
// finalCost), the stats are computed once more - two passes, bounded, and
// only when such an item exists.

import { engine } from '../engine.mjs';
import { actorToSheet } from '../adapter.mjs';
import { getSetting } from '../settings.mjs';
import { defineActorSchema, NULLABLE_NUMBER_FIELDS, SCHEMA_KEYS } from './actor-schema.generated.mjs';

/** Actors whose engine failure has already been logged (cleared on the next success). */
const failed = new WeakSet();

export class CharacterData extends foundry.abstract.TypeDataModel {
  /** Number fields whose blank input means null (the website's blankToNull), for the sheet's form processing. */
  static NULLABLE_NUMBER_FIELDS = NULLABLE_NUMBER_FIELDS;
  static SCHEMA_KEYS = SCHEMA_KEYS;

  static defineSchema() {
    return defineActorSchema(foundry.data.fields);
  }

  /** Nothing that reads items (ARCHITECTURE.md §4.1). */
  prepareBaseData() {
    this.derived = null;
    this.sheetCache = null;
    this.resources = null;
    this.initiative = 0;
    this.engineError = null;
  }

  prepareDerivedData() {
    const actor = this.parent;
    let sheet = null;
    let stats = null;
    try {
      // Ch9 posture and elevation are client preferences on the website (passed as
      // getCalculatedStats options, not read off the sheet); a GM's Foundry setting
      // is authoritative the same way. getSetting answers the declared default (both
      // true) when settings are unregistered, so headless derivation is unchanged.
      const opts = { applyPosture: getSetting('applyPosture'), trackElevation: getSetting('trackElevation') };
      sheet = actorToSheet(actor);
      stats = engine.getCalculatedStats(sheet, opts);
      // Second pass for items whose derivation reads the owner's stats.
      if (this._rerunOwnerStatItems(stats)) {
        sheet = actorToSheet(actor);
        stats = engine.getCalculatedStats(sheet, opts);
      }
      failed.delete(actor);
    } catch (err) {
      // A failure inside the engine must not break the actor (its sheet, its
      // token, the sidebar); it is logged once per actor and derived stays null.
      if (!failed.has(actor)) {
        failed.add(actor);
        console.error(`shadowbase | engine failed for actor "${actor?.name}" (${actor?.id}); derived stats unavailable until the data is repaired`, err);
      }
      this.derived = null;
      this.sheetCache = sheet;
      this.engineError = err?.message ?? String(err);
      this.resources = this._resourcesFrom(sheet, null);
      this.initiative = 0;
      return;
    }
    this.derived = stats;
    this.sheetCache = sheet;
    this.resources = this._resourcesFrom(sheet, stats);
    // Basic Speed with DX in the hundredths as the tie-break (ARCHITECTURE.md §5.2: never rolled).
    this.initiative = stats.currentValues.basicSpeed + stats.primaryAttributes.effectiveDexterity / 100;
  }

  /**
   * Re-derive the items that read the owner's stats now that a first pass exists.
   * @param {object} stats the first-pass result
   * @returns {boolean} whether any such item was re-run
   */
  _rerunOwnerStatItems(stats) {
    const actor = this.parent;
    if (!actor?.items) return false;
    this.derived = stats; // so the items see the first pass
    let reran = false;
    for (const item of actor.items) {
      const model = item.system;
      if (!model?.constructor?.DERIVES_FROM_OWNER_STATS) continue;
      model.prepareDerivedData();
      reran = true;
    }
    return reran;
  }

  /**
   * The token-facing pools (ARCHITECTURE.md §4.1). Null on a current pool means
   * FULL (lib/resource-pools.ts: "NULL MEANS FULL, and it is a sentinel").
   */
  _resourcesFrom(sheet, stats) {
    const cv = stats?.currentValues ?? {};
    const hpMax = cv.hitPoints ?? 0;
    const epMax = cv.endurancePoints ?? 0;
    const fpMax = cv.maxForcePoints ?? 0;
    const ppMax = cv.maxPowerPoints ?? 0;
    return {
      hp: { value: sheet?.currentHitPoints ?? hpMax, max: hpMax },
      ep: { value: sheet?.currentEndurancePoints ?? epMax, max: epMax },
      fp: { value: sheet?.currentForcePoints ?? fpMax, max: fpMax },
      pp: { value: this.powerPoints ?? ppMax, max: ppMax },
    };
  }
}

export default CharacterData;
