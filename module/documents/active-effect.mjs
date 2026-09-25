// module/documents/active-effect.mjs
//
// ShadowBaseActiveEffect (docs/ARCHITECTURE.md §4.4): one ActiveEffect per
// STORED website status-effect row, the row itself under
// flags.shadowbase.statusEffect. `changes` is always empty - the engine sums
// every modifier bag when it reads the sheet (module/adapter.mjs
// actorToSheet), so a Foundry change would apply the bonus twice. The
// operations on effects (add / dismiss / advance phase / recover EP / sweep /
// stun sync) live in module/effects.mjs (unit U02b); this class is the row's
// accessors.

import { effectToStatusEffect, statusEffectToEffectData, isStatusEffect } from '../adapter.mjs';
import { isExpiredAt } from '../effects.mjs';

const BaseActiveEffect = globalThis.foundry?.documents?.ActiveEffect ?? globalThis.ActiveEffect;

export class ShadowBaseActiveEffect extends BaseActiveEffect {
  /** True when this effect carries a ShadowBase status-effect row. */
  get isStatusEffect() { return isStatusEffect(this); }

  /** The website row (statusEffectSchema), or null for a foreign effect. */
  get statusRow() { return this.flags?.shadowbase?.statusEffect ?? null; }

  /** The website row with its id guaranteed (the shape the engine reads). */
  toStatusEffect() { return effectToStatusEffect(this); }

  /** The row's modifier bag (every channel present; NO_MODIFIERS spread on write). */
  get modifiers() { return this.statusRow?.modifiers ?? null; }

  /** Which entry of `phases` comes next; 0 means none applied yet. */
  get phaseIndex() { return this.statusRow?.phaseIndex ?? 0; }

  /** The phases still ahead of this effect. */
  get phases() { return this.statusRow?.phases ?? []; }

  /** The last turn this effect is active on, or null when it does not expire by turn. */
  get expiresAfterTurn() { return this.statusRow?.expiresAfterTurn ?? null; }

  /**
   * True once the turn counter has passed expiresAfterTurn (the turn sweep
   * removes it). The one rule lives in module/effects.mjs (the website's own
   * `turn <= Number(expiresAfterTurn)` keep-predicate, which coerces); this
   * class only delegates so the document and the sweep cannot disagree.
   */
  isExpiredAt(turn) { return isExpiredAt(this.statusRow, turn); }

  get isManual() { return this.statusRow?.isManual === true; }
  get isGear() { return this.statusRow?.isGear === true; }

  /** ActiveEffect creation data for a website row (the inverse of toStatusEffect). */
  static fromStatusEffect(row) { return statusEffectToEffectData(row); }

  /**
   * Update fields of the stored row (merged, like ShadowBaseItem#updateRow).
   * @param {object} changes
   */
  async updateRow(changes, options = {}) {
    const data = {};
    for (const [k, v] of Object.entries(changes)) data[`flags.shadowbase.statusEffect.${k}`] = v;
    return this.update(data, options);
  }
}

export default ShadowBaseActiveEffect;
