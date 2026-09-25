// tools/foundry-shim-apps.mjs
//
// The HEADLESS ApplicationV2 / Handlebars layer of tools/foundry-shim.mjs
// (ARCHITECTURE.md §9; unit U05). Installed by installFoundryShim() into the
// declared `foundry.applications` namespace so module/apps/*.mjs can be
// imported and their `_prepareContext` / `_preparePartContext` / template
// pipeline exercised without a Foundry client:
//
//   foundry.applications.api        ApplicationV2, HandlebarsApplicationMixin, DocumentSheetV2, DialogV2
//   foundry.applications.sheets     ActorSheetV2, ItemSheetV2
//   foundry.applications.handlebars renderTemplate, loadTemplates, getTemplate (the node `handlebars` package,
//                                   compiled STRICT with knownHelpersOnly over the registered helper table)
//   foundry.applications.ux         DragDrop, TextEditor, FormDataExtended
//   foundry.applications.apps       FilePicker.implementation
//   foundry.documents.collections   Actors / Items with registerSheet / unregisterSheet (recorded, not applied)
//   globalThis.Handlebars           the node package instance (helpers register on it exactly as in the browser)
//   globalThis.fromUuid             resolves Actor.<id> / Item.<id> / <Actor.id>.Item.<id> from the shim's collections
//
// What is UNVERIFIED against Foundry's own source (no local install), and
// therefore modelled after the v13 API documentation and the systems that
// build on it:
//   - DEFAULT_OPTIONS are merged up the inheritance chain with mergeObject
//     semantics (arrays replaced, objects merged);
//   - `_prepareTabs(group)` returns `{ [id]: { id, group, icon, label (localized), active, cssClass } }`
//     with cssClass 'active' for the active tab, '' otherwise;
//   - `FormDataExtended` casts `data-dtype="Number"` with blank -> null (the
//     system's _processFormData applies its own blank -> null rule regardless);
//   - `_onRender` receives the app's root element; here it receives a stand-in
//     element that records setAttribute calls and answers querySelectorAll with [];
//   - `render()` here renders every PART to HTML with the real _prepareContext /
//     _preparePartContext pipeline and stores the strings on `app.parts` - Foundry
//     mounts DOM instead. DialogV2's statics resolve from an injectable queue
//     (DialogV2.queueResponses) and default to confirm -> true, wait/input -> null.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);
const Handlebars = require('handlebars');

const templatePath = (p) => {
  const rel = String(p).replace(/^systems\/shadowbase\//, '');
  return join(ROOT, rel);
};

/** Helpers known to the compiler: everything registered on the instance at compile time. */
function knownHelpers() {
  const known = {};
  for (const name of Object.keys(Handlebars.helpers)) known[name] = true;
  return known;
}

const compiled = new Map();
export const renderLog = [];

/**
 * Compile strictness. Foundry compiles templates NON-strict (a missing field
 * renders as ''), and that is the default here so a peer's templates behave as
 * they would in the client. check:templates switches strict ON around its own
 * renders (setRenderStrict(true)) so an undefined output field throws there.
 */
let renderStrict = false;
export function setRenderStrict(value) { renderStrict = !!value; compiled.clear(); return renderStrict; }
export function isRenderStrict() { return renderStrict; }

/** Compile a template file knownHelpersOnly (+ strict when enabled); cached per path, dropped when a helper is added. */
export function getTemplate(path) {
  const file = templatePath(path);
  if (!existsSync(file)) throw new Error(`foundry shim: template not found: ${path} (${file})`);
  const key = `${file}::${Object.keys(Handlebars.helpers).length}::${renderStrict}`;
  if (!compiled.has(key)) {
    compiled.set(key, Handlebars.compile(readFileSync(file, 'utf8'), { strict: renderStrict, knownHelpersOnly: true, knownHelpers: knownHelpers(), preventIndent: true }));
  }
  return compiled.get(key);
}

/** Foundry's runtime options: templates may read prototype members (`actor.id`, `item.name` are getters). */
export const RUNTIME_OPTIONS = Object.freeze({ allowProtoMethodsByDefault: true, allowProtoPropertiesByDefault: true });

export async function renderTemplate(path, data) {
  const html = getTemplate(path)(data ?? {}, RUNTIME_OPTIONS);
  renderLog.push({ path, html });
  return html;
}

/**
 * Foundry's loadTemplates: an ARRAY registers each path as a partial under
 * its own path; an OBJECT registers each key as a partial name for its path.
 */
export async function loadTemplates(paths) {
  const entries = Array.isArray(paths) ? paths.map((p) => [p, p]) : Object.entries(paths ?? {});
  for (const [name, path] of entries) {
    const file = templatePath(path);
    if (!existsSync(file)) throw new Error(`foundry shim: partial not found: ${name} -> ${path}`);
    Handlebars.registerPartial(name, readFileSync(file, 'utf8'));
  }
  return entries.map(([name]) => name);
}

// ---------------------------------------------------------------------------
// utils the layer needs (kept local so this file has no dependency on the shim's export order)
// ---------------------------------------------------------------------------

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source ?? {})) {
    if (isPlain(v) && isPlain(target[k])) deepMerge(target[k], v);
    else if (isPlain(v)) target[k] = deepMerge({}, v);
    else target[k] = v;
  }
  return target;
}
function expandObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const parts = k.split('.');
    let t = out;
    for (let i = 0; i < parts.length - 1; i++) { if (!isPlain(t[parts[i]])) t[parts[i]] = {}; t = t[parts[i]]; }
    t[parts[parts.length - 1]] = isPlain(v) ? expandObject(v) : v;
  }
  return out;
}
const localize = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** The stand-in root element `_onRender` receives. */
export class ShimElement {
  constructor(html = '') { this.innerHTML = html; this.attributes = {}; this.dataset = {}; this.listeners = []; this.classList = { add() {}, remove() {}, contains() { return false; } }; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener(type, fn) { this.listeners.push({ type, fn }); }
  closest() { return null; }
}

// ---------------------------------------------------------------------------
// ApplicationV2 and the mixin
// ---------------------------------------------------------------------------

export class ApplicationV2 {
  static DEFAULT_OPTIONS = { id: '{id}', classes: [], tag: 'div', window: { frame: true, positioned: true, title: '', icon: '', controls: [], minimizable: true, resizable: false }, actions: {}, form: { handler: undefined, submitOnChange: false, closeOnSubmit: false }, position: {} };
  static TABS = {};
  static _count = 0;

  /** Every class from ApplicationV2 down to `this`, base first. */
  static inheritanceChain() {
    const chain = [];
    let cls = this;
    while (cls && cls !== Function.prototype && cls.name !== undefined) { chain.unshift(cls); if (cls === ApplicationV2) break; cls = Object.getPrototypeOf(cls); }
    return chain;
  }

  constructor(options = {}) {
    const merged = {};
    for (const cls of this.constructor.inheritanceChain()) {
      if (Object.prototype.hasOwnProperty.call(cls, 'DEFAULT_OPTIONS')) deepMerge(merged, cls.DEFAULT_OPTIONS);
    }
    deepMerge(merged, options);
    this.options = merged;
    this.id = String(merged.id ?? '{id}').replace('{id}', `app-${++ApplicationV2._count}`);
    this.tabGroups = {};
    for (const [group, cfg] of Object.entries(this.constructor.TABS ?? {})) this.tabGroups[group] = cfg.initial ?? cfg.tabs?.[0]?.id ?? null;
    this.element = null;
    this.rendered = false;
    this.parts = {};
  }

  get title() { return localize(this.options.window?.title ?? ''); }
  get classList() { return this.options.classes; }

  _prepareTabs(group) {
    const cfg = this.constructor.TABS?.[group];
    if (!cfg) return {};
    const out = {};
    for (const t of cfg.tabs ?? []) {
      const active = this.tabGroups[group] === t.id;
      const label = cfg.labelPrefix ? `${cfg.labelPrefix}.${t.id}` : t.label;
      out[t.id] = { ...t, group, label: localize(label ?? ''), active, cssClass: active ? 'active' : '' };
    }
    return out;
  }

  changeTab(tab, group = 'primary') { this.tabGroups[group] = tab; return this; }

  async _prepareContext(options) { return { tabs: {}, options }; }
  async _preparePartContext(partId, context) { return context; }
  _onRender() {}
  _onFirstRender() {}

  /** Render every PART (HandlebarsApplicationMixin overrides with the template pipeline). */
  async render(options = {}) {
    const context = await this._prepareContext(options);
    this.element = new ShimElement('');
    this.element.parts = this.parts;
    this.rendered = true;
    this._onRender(context, options);
    return this;
  }
  async close() { this.rendered = false; return this; }
  async submit() { return this; }

  /**
   * Submit a name -> value object the way the form would: through `options.form.handler`
   * (a plain AppV2 form, e.g. the HUD) or the DocumentSheetV2 pipeline (`submit`).
   */
  async submitForm(object = {}, { event = null, form = null } = {}) {
    const formData = object instanceof FormDataExtended ? object : new FormDataExtended(object);
    const handler = this.options.form?.handler;
    const fakeEvent = event ?? { preventDefault() {}, stopPropagation() {}, type: 'submit', target: form, currentTarget: form };
    if (typeof handler === 'function') return handler.call(this, fakeEvent, form, formData);
    if (this.document && typeof this._prepareSubmitData === 'function') {
      const submitData = this._prepareSubmitData(fakeEvent, form, formData, null);
      await this._processSubmitData(fakeEvent, form, submitData, {});
      return submitData;
    }
    return null;
  }

  /**
   * Dispatch a data-action the way a click would: the static handler from the
   * merged `options.actions` with `this` = the app, a synthetic event and a
   * target whose `dataset` is the given one (the peers' checks drive the HUD
   * and the sheet through this).
   */
  async invokeAction(action, dataset = {}, { event = null, target = null } = {}) {
    const handler = this.options.actions?.[action];
    if (typeof handler !== 'function') throw new Error(`shim: no data-action handler "${action}" on ${this.constructor.name}`);
    const fakeTarget = target ?? { dataset: { ...dataset }, closest: () => null, getAttribute: (k) => (k.startsWith('data-') ? dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null : null), value: dataset.value, form: null };
    const fakeEvent = event ?? { preventDefault() {}, stopPropagation() {}, target: fakeTarget, currentTarget: fakeTarget, type: 'click' };
    return handler.call(this, fakeEvent, fakeTarget);
  }
}

export function HandlebarsApplicationMixin(Base) {
  return class HandlebarsApplication extends Base {
    static PARTS = {};
    async render(options = {}) {
      const context = await this._prepareContext(options);
      const html = [];
      const partIds = Array.isArray(options.parts) ? options.parts : Object.keys(this.constructor.PARTS);
      for (const partId of partIds) {
        const part = this.constructor.PARTS[partId];
        if (!part?.template) throw new Error(`shim: PART "${partId}" has no template`);
        // Foundry's _configureRenderParts: a part's template and its `templates` are loaded AND registered as
        // partials under their own paths (a part may `{{> "systems/.../x.hbs"}}` one of its `templates`).
        await loadTemplates([part.template, ...(part.templates ?? [])]);
        const partContext = await this._preparePartContext(partId, { ...context, partId }, options);
        const rendered = await renderTemplate(part.template, partContext);
        this.parts[partId] = rendered;
        html.push(rendered);
      }
      const first = !this.rendered;
      this.element = new ShimElement(html.join('\n'));
      this.element.parts = this.parts;
      this.rendered = true;
      if (first) this._onFirstRender(context, options);
      this._onRender(context, options);
      return this;
    }
  };
}

// ---------------------------------------------------------------------------
// Document sheets
// ---------------------------------------------------------------------------

export class FormDataExtended {
  /**
   * `source` is a plain object of name -> value (the headless stand-in for a form), an
   * object with `.object`, or a stand-in form `{ elements: [{ name, value, type, checked, dataset }] }`.
   */
  constructor(source = {}, { dtypes = {} } = {}) {
    let object = {};
    if (Array.isArray(source?.elements)) {
      for (const el of source.elements) {
        if (!el?.name) continue;
        let value = el.type === 'checkbox' ? !!el.checked : el.value;
        const dtype = el.dataset?.dtype ?? dtypes[el.name];
        object[el.name] = FormDataExtended.castType(value, dtype);
      }
    } else if (source && typeof source === 'object' && 'object' in source && isPlain(source.object)) {
      object = { ...source.object };
    } else if (isPlain(source)) {
      for (const [k, v] of Object.entries(source)) object[k] = FormDataExtended.castType(v, dtypes[k]);
    }
    this.object = object;
  }
  /** UNVERIFIED detail: blank -> null for Number, as the documented dtype cast implies. */
  static castType(value, dtype) {
    if (!dtype) return value;
    if (dtype === 'Number') return value === '' || value === null || value === undefined ? null : Number(value);
    if (dtype === 'Boolean') return value === true || value === 'true' || value === 'on';
    if (dtype === 'JSON') { try { return JSON.parse(value); } catch { return value; } }
    return value;
  }
}

export class DocumentSheetV2 extends ApplicationV2 {
  static DEFAULT_OPTIONS = { tag: 'form', classes: ['sheet'], form: { handler: undefined, submitOnChange: false, closeOnSubmit: false }, sheetConfig: true, viewPermission: 1, editPermission: 3 };
  constructor(options = {}) {
    super(options);
    this.document = options.document;
    if (!this.document) throw new Error('DocumentSheetV2: options.document is required');
  }
  get isVisible() { return true; }
  get isEditable() { return this.options.editable ?? true; }
  get title() { return this.document.name ?? super.title; }
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, document: this.document, source: this.document._source, fields: this.document.schema?.fields ?? {}, editable: this.isEditable, user: globalThis.game?.user ?? null, rootId: this.id };
  }
  _processFormData(event, form, formData) { return expandObject(formData?.object ?? formData ?? {}); }
  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = this._processFormData(event, form, formData);
    if (updateData) deepMerge(submitData, updateData);
    return submitData;
  }
  async _processSubmitData(event, form, submitData, options) { return this.document.update(submitData, options); }
  /** The headless submit: hand a name -> value object (or a FormDataExtended) straight down the pipeline. */
  async submit(formDataOrObject = {}, { updateData = null, form = null, event = null, ...options } = {}) {
    const formData = formDataOrObject instanceof FormDataExtended ? formDataOrObject : new FormDataExtended(formDataOrObject);
    const submitData = this._prepareSubmitData(event, form, formData, updateData);
    await this._processSubmitData(event, form, submitData, options);
    return submitData;
  }
  async _onDrop() { return false; }
}

export class ActorSheetV2 extends DocumentSheetV2 {
  static DEFAULT_OPTIONS = { classes: ['actor'], position: { width: 600, height: 'auto' }, dragDrop: [] };
  get actor() { return this.document; }
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, actor: this.document, items: this.document.items?.contents ?? [], effects: this.document.effects?.contents ?? [] };
  }
  async _onDropItem() { return false; }
  async _onDropActor() { return false; }
  async _onDropActiveEffect() { return false; }
  async _onDropFolder() { return false; }
}

export class ItemSheetV2 extends DocumentSheetV2 {
  static DEFAULT_OPTIONS = { classes: ['item'], position: { width: 520, height: 'auto' } };
  get item() { return this.document; }
  async _prepareContext(options) { const context = await super._prepareContext(options); return { ...context, item: this.document }; }
}

/**
 * DialogV2 statics with an injectable answer queue: DialogV2.queueAnswer(fn) queues a
 * callback that receives the dialog's config and returns the answer (U07's checks
 * drive the roll prompt and the settings dialog this way); DialogV2.queueResponses([...])
 * queues literal answers. Defaults: confirm/prompt -> true, wait/input -> null.
 */
export class DialogV2 extends ApplicationV2 {
  static _queue = [];
  static log = [];
  static queueResponses(list) { this._queue.push(...list); }
  static queueAnswer(fn) { this._queue.push(fn); }
  static _next(config, fallback) {
    if (!this._queue.length) return fallback;
    const next = this._queue.shift();
    return typeof next === 'function' ? next(config) : next;
  }
  static async confirm(config = {}) { this.log.push({ kind: 'confirm', config }); return this._next(config, true); }
  static async prompt(config = {}) { this.log.push({ kind: 'prompt', config }); return this._next(config, true); }
  static async input(config = {}) { this.log.push({ kind: 'input', config }); return this._next(config, null); }
  static async wait(config = {}) { this.log.push({ kind: 'wait', config }); return this._next(config, null); }
}

export class DragDrop {
  constructor(config = {}) { this.config = config; }
  bind() { return this; }
  static createDragImage() { return null; }
}

export class FilePickerShim {
  constructor(options = {}) { this.options = options; FilePickerShim.log.push(options); }
  static log = [];
  async browse() { return null; }
  async render() { return this; }
}

/** Sheet registrations, recorded (module/shadowbase.mjs registers the actor sheet through this). */
function makeSheetCollection(name) {
  const registered = [];
  const unregistered = [];
  return {
    name,
    registered,
    unregistered,
    registerSheet(scope, cls, options = {}) { registered.push({ scope, cls, options }); },
    unregisterSheet(scope, cls, options = {}) { unregistered.push({ scope, cls, options }); },
  };
}

export async function fromUuid(uuid) {
  const game = globalThis.game;
  if (!game || typeof uuid !== 'string') return null;
  const parts = uuid.split('.');
  if (parts[0] === 'Compendium') return null;
  let doc = null;
  if (parts[0] === 'Actor') doc = game.actors?.get(parts[1]) ?? null;
  else if (parts[0] === 'Item') doc = game.items?.get(parts[1]) ?? null;
  for (let i = 2; doc && i + 1 < parts.length; i += 2) {
    const key = parts[i] === 'Item' ? 'items' : parts[i] === 'ActiveEffect' ? 'effects' : null;
    doc = key ? (doc[key]?.get(parts[i + 1]) ?? null) : null;
  }
  return doc;
}

/**
 * Foundry CORE's Handlebars helpers (client/apps/handlebars.mjs), the ones a system
 * template may use before the system registers its own: registered on the shim's
 * Handlebars at install, exactly as the client has them before `init`.
 */
export const CORE_HELPERS = Object.freeze({
  localize(key, options) {
    const hash = options?.hash ?? {};
    const i18n = globalThis.game?.i18n;
    if (!i18n) return String(key);
    return Object.keys(hash).length ? i18n.format(key, hash) : i18n.localize(key);
  },
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  and: (...args) => args.slice(0, -1).every(Boolean),
  or: (...args) => args.slice(0, -1).some(Boolean),
  not: (a) => !a,
  concat: (...args) => args.slice(0, -1).join(''),
  checked: (v) => (v ? 'checked' : ''),
  disabled: (v) => (v ? 'disabled' : ''),
  ifThen: (cond, a, b) => (cond ? a : b),
  signedString: (n) => { const v = Number(n); return Number.isFinite(v) ? (v > 0 ? `+${v}` : String(v)) : ''; },
  numberFormat: (n, options) => { const v = Number(n); if (!Number.isFinite(v)) return ''; const dp = options?.hash?.decimals; return typeof dp === 'number' ? v.toFixed(dp) : v.toLocaleString(); },
  selectOptions(choices, options) {
    const hash = options?.hash ?? {};
    const selected = hash.selected;
    const entries = Array.isArray(choices) ? choices.map((c) => (c && typeof c === 'object' ? [c.value ?? c.key, c.label ?? c.value] : [c, c])) : Object.entries(choices ?? {});
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let html = hash.blank !== undefined ? `<option value="">${esc(hash.blank)}</option>` : '';
    for (const [value, label] of entries) {
      const text = hash.localize ? (globalThis.game?.i18n?.localize?.(label) ?? label) : label;
      const isSel = Array.isArray(selected) ? selected.includes(value) : String(selected) === String(value);
      html += `<option value="${esc(value)}"${isSel ? ' selected' : ''}>${esc(text)}</option>`;
    }
    return new Handlebars.SafeString(html);
  },
  timeSince: (t) => String(t ?? ''),
});

export function registerCoreHelpers(hb = Handlebars) {
  for (const [name, fn] of Object.entries(CORE_HELPERS)) hb.registerHelper(name, fn);
  return hb;
}

let layer = null;

/**
 * Install the layer. `foundry` is the shim's declared root; `declared` its proxy
 * factory (so the new namespaces throw on an undeclared member too).
 */
export function installApplicationsLayer({ foundry, declared }) {
  if (layer && foundry.applications?.api) return layer;
  registerCoreHelpers(Handlebars);
  const api = declared({ ApplicationV2, HandlebarsApplicationMixin, DocumentSheetV2, DialogV2 }, 'foundry.applications.api');
  const sheets = declared({ ActorSheetV2, ItemSheetV2 }, 'foundry.applications.sheets');
  const handlebars = { renderTemplate, loadTemplates, getTemplate };
  const ux = declared({ DragDrop, FormDataExtended, TextEditor: { implementation: { enrichHTML: async (s) => String(s ?? '') } } }, 'foundry.applications.ux');
  const apps = declared({ FilePicker: { implementation: FilePickerShim } }, 'foundry.applications.apps');
  const applications = foundry.applications;
  applications.api = api;
  applications.sheets = sheets;
  applications.handlebars = handlebars;
  applications.ux = ux;
  applications.apps = apps;
  foundry.documents.collections = declared({ Actors: makeSheetCollection('Actors'), Items: makeSheetCollection('Items') }, 'foundry.documents.collections');
  globalThis.Handlebars = Handlebars;
  globalThis.fromUuid = fromUuid;
  layer = { api, sheets, handlebars, ux, apps, Handlebars, CORE_HELPERS };
  return layer;
}

/**
 * The layer over the ALREADY-INSTALLED shim (tools/foundry-shim.mjs installs it
 * itself; callers that installed the shim earlier get the same handle back).
 * Kept for the peers' checks and renderers that call it by this name.
 */
export async function installAppShim() {
  if (layer) return layer;
  const foundry = globalThis.foundry;
  if (!foundry) throw new Error('installAppShim: install tools/foundry-shim.mjs first (installFoundryShim)');
  const declared = (target) => target;
  return installApplicationsLayer({ foundry, declared });
}

export { Handlebars };
export default installApplicationsLayer;
