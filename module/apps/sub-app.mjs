// module/apps/sub-app.mjs
//
// The base every actor-bound sub-app shares (docs/ARCHITECTURE.md §6.5, unit
// U09): DroidWorkshop, AnatomyWorkshop, BodyLoadout, SuitsAndSets, CraftingApp.
// One ApplicationV2 + Handlebars window per actor, registered on the actor's
// `apps` so every actor / Item / ActiveEffect update re-renders it (the same
// channel a DocumentSheet uses), a submitOnChange form whose fields route by
// prefix (`system.*` to the actor, `items.<id>.row.<key>` to the Item, the
// app's own prefix to the subclass), and the two write primitives every app
// needs and none may re-implement:
//
//   writeWholeArray(actor, path, array)   a stored array written WHOLE (never a
//                                          per-index dotted key - Foundry's expandObject
//                                          turns `internalIds.3` into a plain object and
//                                          updateSource replaces the array with it,
//                                          ARCHITECTURE §6.5 / §9.1 review finding M5)
//   syncRows(actor, source, nextRows)      a website row array written back as Items:
//                                          rows diffed by their own uuid `id`; changed
//                                          rows replaced (recursive: false, so a deleted
//                                          key does not survive an ObjectField merge),
//                                          missing rows deleted, new rows created in order.
//
// Nothing here decides a rule. The subclasses read the engine and write what
// the website's components write; this file only carries the plumbing.

import { engine } from '../engine.mjs';
import { rowsOf, rowToItemData, nextSort } from '../adapter.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const SYSTEM_ID = 'shadowbase';
export const TEMPLATE_ROOT = `systems/${SYSTEM_ID}/templates/apps`;

export const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
export const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
export const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** The composed sheet and the engine result, as module/rolls.mjs reads them. */
export const sheetOf = (actor) => actor?.sheetData ?? actor?.system?.sheetCache ?? null;
export const statsOf = (actor) => actor?.stats ?? actor?.system?.derived ?? null;
/** Ownership gates the controls; a shim actor (no isOwner getter) is editable. */
export const editableOf = (actor) => actor?.isOwner !== false;

/** foundry.applications.api.DialogV2, resolved late and through `in` guards (the headless shim's proxy throws on an undeclared member). */
export function dialogV2() {
  const apps = globalThis.foundry?.applications;
  const api = apps && ('api' in apps) ? apps.api : null;
  return api && ('DialogV2' in api) ? api.DialogV2 : null;
}

/** DialogV2.confirm; without a DialogV2 (an old client) the answer is yes. */
export async function confirmDialog({ title, content, yes, no }) {
  const DialogV2 = dialogV2();
  if (typeof DialogV2?.confirm !== 'function') return true;
  return DialogV2.confirm({
    window: { title },
    content,
    yes: yes ? { label: yes } : undefined,
    no: no ? { label: no } : undefined,
    rejectClose: false, modal: true,
  });
}

/** DialogV2.wait with a form: the default button's callback returns the form's values (button.form). */
export async function formDialog({ title, icon, content, okLabel, cancelLabel, read }) {
  const DialogV2 = dialogV2();
  if (typeof DialogV2?.wait !== 'function') return null;
  const answer = await DialogV2.wait({
    window: { title, icon },
    classes: [SYSTEM_ID, 'sb-app-dialog'],
    content,
    buttons: [
      { action: 'ok', label: okLabel ?? loc('SHADOWBASE.Apps.Common.Confirm'), icon: 'fa-solid fa-check', default: true, callback: (ev, button) => read(button.form) },
      { action: 'cancel', label: cancelLabel ?? loc('Cancel'), icon: 'fa-solid fa-xmark', callback: () => null },
    ],
    rejectClose: false,
  });
  return answer && typeof answer === 'object' ? answer : null;
}

/** Read a form element (or a plain name -> value map) by field name; checkboxes give booleans. */
export function readField(form, name) {
  const el = form?.elements ?? form ?? {};
  const f = el[name];
  if (f === undefined || f === null) return undefined;
  if (typeof f === 'object' && (f.type === 'checkbox' || 'checked' in f)) return !!f.checked;
  return typeof f === 'object' && 'value' in f ? f.value : f;
}

// ---------------------------------------------------------------------------
// The write primitives
// ---------------------------------------------------------------------------

/**
 * A sparse array materialised to its full length with `null` holes (the
 * website's sanitizeDataForFirestore does the same on save; the Backup Power
 * Array at internalIds[99] makes the array 100 long - never compact it:
 * index IS the slot identity, schema-core digest fact 19).
 */
export function materialise(array) {
  const list = Array.isArray(array) ? array : [];
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) out[i] = list[i] === undefined ? null : list[i];
  return out;
}

/** A deep clone of a stored value (a document's model property is already a clone; this guards a caller that reads _source). */
export function clone(value) {
  const utils = globalThis.foundry?.utils;
  return utils && ('deepClone' in utils) ? utils.deepClone(value) : structuredClone(value);
}

/**
 * Write a stored array (or object) WHOLE. `path` is dotted from `system`
 * (`hitLocations`, `droidBuild`, `gearSets`); the value replaces the stored
 * one - an ObjectField merges plain objects and REPLACES arrays, so every
 * array inside `droidBuild` arrives whole, holes as null (ARCHITECTURE §6.5).
 */
export async function writeWholeArray(actor, path, value) {
  return actor.update({ [`system.${path}`]: value });
}

/** The stored rows of one website array (verbatim, no derived figures), keyed by their uuid. */
export function storedRows(actor, source) {
  return rowsOf(actor, source).map((i) => i.system.row);
}

/** The Item carrying the row with this uuid on this actor, or null. */
export function itemByRowId(actor, rowId) {
  if (!rowId) return null;
  if (typeof actor?.itemByRowId === 'function') return actor.itemByRowId(rowId);
  return actor?.items?.find?.((i) => i.system?.row?.id === rowId) ?? null;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Write a whole website row array back as Items (see the header). Rows without
 * an id get one minted (the website mints on creation - the caller normally
 * did already). Returns { updated, created, deleted } counts.
 * @param {object} actor
 * @param {string} source a CHARACTER_FORM_ARRAY_KEYS item array ('equipment', 'armor', ...)
 * @param {object[]} nextRows the array as the website's setValue would store it
 */
export async function syncRows(actor, source, nextRows) {
  const current = rowsOf(actor, source);
  const byId = new Map(current.map((i) => [i.system.row?.id, i]));
  const keep = new Set();
  const updates = [];
  const creations = [];
  let sort = nextSort(actor, source);
  for (const raw of nextRows ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = { ...raw };
    if (!row.id) row.id = engine.rowId();
    const own = byId.get(row.id);
    if (own) {
      keep.add(own.id);
      if (!same(own.system.row, row)) updates.push({ _id: own.id, 'system.row': row });
    } else {
      creations.push(rowToItemData(row, source, sort));
      sort += (globalThis.CONST?.SORT_INTEGER_DENSITY ?? 100000);
    }
  }
  const deletions = current.filter((i) => !keep.has(i.id)).map((i) => i.id);
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates, { recursive: false });
  if (deletions.length) await actor.deleteEmbeddedDocuments('Item', deletions);
  if (creations.length) await actor.createEmbeddedDocuments('Item', creations);
  return { updated: updates.length, created: creations.length, deleted: deletions.length };
}

// ---------------------------------------------------------------------------
// The base class
// ---------------------------------------------------------------------------

export class ActorSubApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** The id suffix and the CSS modifier (`sb-app--<name>`); subclasses set it. */
  static APP_NAME = 'sub-app';
  /** The window title key, formatted with { name }. */
  static TITLE_KEY = 'SHADOWBASE.Apps.Common.WindowTitle';
  /** The form-field prefix the subclass owns (`droid.`, `anatomy.` ...); fields under it go to _onOwnField. */
  static FIELD_PREFIX = 'app.';
  /** `${APP_NAME}:${actorId}` -> the open window (one per actor per app). */
  static instances = new Map();

  static DEFAULT_OPTIONS = {
    id: 'shadowbase-app-{id}',
    classes: ['shadowbase', 'sb-app'],
    tag: 'form',
    window: { title: 'SHADOWBASE.Apps.Common.WindowTitle', icon: 'fa-solid fa-wrench', resizable: true, contentClasses: ['sb-app__content'] },
    position: { width: 640, height: 720 },
    form: { handler: ActorSubApp.#onSubmitForm, submitOnChange: true, closeOnSubmit: false },
    actions: {},
  };

  #actor;

  /**
   * @param {{ actor?: object, document?: object } & object} options `actor` (or `document`, the sheet's
   *   spelling - the tabs open us as `new Cls({ document: actor, actor })`) is required.
   */
  constructor(options = {}) {
    const actor = options.actor ?? options.document;
    if (!actor) throw new Error(`${new.target.name}: options.actor is required`);
    const { document: _doc, actor: _actor, ...rest } = options;
    super({ ...rest, id: options.id ?? `shadowbase-${new.target.APP_NAME}-${actor.id}`, classes: ['shadowbase', 'sb-app', `sb-app--${new.target.APP_NAME}`] });
    this.#actor = actor;
    const key = `${new.target.APP_NAME}:${actor.id}`;
    if (!ActorSubApp.instances.has(key)) ActorSubApp.instances.set(key, this);
  }

  get actor() { return this.#actor; }
  get document() { return this.#actor; }
  get title() { return fmt(this.constructor.TITLE_KEY, { name: this.#actor.name }); }
  get editable() { return editableOf(this.#actor); }

  /** Open (or focus) the actor's window for this app. Subclasses may accept job options. */
  static async open(actor, options = {}) {
    const key = `${this.APP_NAME}:${actor.id}`;
    let app = ActorSubApp.instances.get(key);
    if (!app) { app = new this({ actor, ...options }); ActorSubApp.instances.set(key, app); }
    else if (typeof app.configure === 'function') app.configure(options);
    await app.render({ force: true });
    return app;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // The actor re-renders every app in its registry on its own, its Items' and its effects' updates.
    (this.#actor.apps ??= {})[this.id] = this;
  }

  _onClose(options) { super._onClose?.(options); this.#teardown(); }

  /** Foundry's close() calls _onClose; the headless base class does not, so the teardown is idempotent and runs from both. */
  async close(options = {}) { const r = await super.close(options); this.#teardown(); return r; }

  #teardown() {
    if (this.#actor.apps) delete this.#actor.apps[this.id];
    const key = `${this.constructor.APP_NAME}:${this.#actor.id}`;
    if (ActorSubApp.instances.get(key) === this) ActorSubApp.instances.delete(key);
  }

  async _prepareContext(options) {
    const actor = this.#actor;
    const sheet = sheetOf(actor);
    const stats = statsOf(actor);
    return {
      ...(await super._prepareContext(options)),
      actor: { id: actor.id, name: actor.name, img: actor.system?.characterPortrait || actor.img || '', isDroid: !!actor.system?.isDroid },
      editable: this.editable,
      engineOk: !!(sheet && stats),
      engineError: actor.system?.engineError ?? null,
      appName: this.constructor.APP_NAME,
    };
  }

  /**
   * The submitOnChange handler: every field routes by prefix. Only CHANGED
   * `system.*` values reach the actor (a select that did not move writes nothing);
   * the app's own prefix goes to _onOwnField(name, value) for the subclass.
   */
  static async #onSubmitForm(event, form, formData) {
    const data = formData?.object ?? {};
    const actorUpdates = {};
    const own = [];
    for (const [name, raw] of Object.entries(data)) {
      let value = raw;
      if (name.startsWith('system.')) {
        if (value === '') value = null;
        const current = foundry.utils.getProperty(this.actor, name);
        if (current !== value) actorUpdates[name] = value;
        continue;
      }
      if (name.startsWith('items.')) {
        const [, itemId, ...rest] = name.split('.');
        const key = rest.join('.').replace(/^row\./, '');
        const item = this.actor.items.get(itemId);
        if (item && key && item.system?.row?.[key] !== value) await item.updateRow({ [key]: value === '' ? null : value });
        continue;
      }
      if (name.startsWith(this.constructor.FIELD_PREFIX)) own.push([name.slice(this.constructor.FIELD_PREFIX.length), value]);
    }
    if (Object.keys(actorUpdates).length) await this.actor.update(actorUpdates);
    let rerender = false;
    for (const [field, value] of own) {
      const r = await this._onOwnField(field, value);
      if (r !== false) rerender = true;
    }
    if (rerender && this.rendered) await this.render();
    return { actorUpdates, own };
  }

  /** A field under FIELD_PREFIX changed. Return false to skip the re-render. Subclasses override. */
  async _onOwnField(_field, _value) { return false; }

  /** The Item a control names (data-item-id), or null. */
  itemOf(target) {
    const id = target?.dataset?.itemId;
    return id ? this.#actor.items.get(id) ?? null : null;
  }
}

export default ActorSubApp;
