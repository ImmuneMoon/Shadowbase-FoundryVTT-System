// module/documents/item.mjs
//
// ShadowBaseItem (docs/ARCHITECTURE.md §4.2). Behaviour only; the data lives in
// module/data/item-base.mjs. No sheet UI here.

import { rowWithDerived, itemToRow } from '../adapter.mjs';

const BaseItem = globalThis.foundry?.documents?.Item ?? globalThis.Item;

export class ShadowBaseItem extends BaseItem {
  /** The website row, verbatim. */
  get row() { return this.system?.row ?? null; }

  /** The website array this row lives in. */
  get source() { return this.system?.source ?? null; }

  /** The row's own uuid (the key every cross-reference between rows uses). */
  get rowId() { return this.system?.row?.id ?? null; }

  /** The family's derived stats (module/data/item-base.mjs), or null. */
  get derived() { return this.system?.derived ?? null; }

  /** The derived figures the website would have written back onto the row. */
  get persistedFields() { return this.system?.derived?.persistedFields ?? null; }

  /** The name the website shows: customName when set, else name. */
  get displayName() {
    const r = this.row ?? {};
    return (typeof r.customName === 'string' && r.customName.trim()) || (typeof r.name === 'string' && r.name.trim()) || this.name;
  }

  /** The row the engine reads (stored row + persisted derived figures). */
  rowWithDerived() { return rowWithDerived(this); }

  /** The stored row (no derived figures). */
  toRow() { return itemToRow(this); }

  /**
   * Update fields of the stored row. Changes MERGE into the row (Foundry's
   * ObjectField semantics), so `{ quantity: 2 }` leaves every other key alone;
   * pass `'-=key': null` to delete a key.
   * @param {object} changes
   * @param {object} [options]
   */
  async updateRow(changes, options = {}) {
    const data = {};
    for (const [k, v] of Object.entries(changes)) data[`system.row.${k}`] = v;
    return this.update(data, options);
  }

  getRollData() {
    return { ...(this.row ?? {}), ...(this.persistedFields ?? {}), actor: this.actor?.getRollData?.() ?? {} };
  }
}

export default ShadowBaseItem;
