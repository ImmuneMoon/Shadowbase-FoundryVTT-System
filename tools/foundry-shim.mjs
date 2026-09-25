// tools/foundry-shim.mjs
//
// A HEADLESS STAND-IN for the Foundry VTT v13 globals the data layer touches
// (ARCHITECTURE.md §9). No Foundry is installed on this machine, so every
// check and smoke that builds an actor runs through this file. It is honest
// about its limits: the surface is DECLARED, and every namespace is wrapped in
// a Proxy that throws on an undeclared member, so a module that reaches for a
// Foundry API this shim does not model fails loudly here instead of silently
// passing a check and failing in the browser.
//
// Where Foundry's exact semantics could not be verified against its source
// (nothing local to read; the phase-1 foundry-v13-api.md report is gone), the
// behaviour is marked UNVERIFIED in a comment beside it, with the closest
// documented reference. `FOUNDRY_APP_PATH` support (mounting Foundry's own
// resources/app/common/) is a later unit's job; this file is the fallback.
//
// Self-test (run on every install unless { selfTest: false }): the field
// cleaning that the data layer depends on -
//   - SchemaField drops an undeclared key;
//   - a non-nullable NumberField cleans null to its initial and REJECTS null on validation;
//   - NumberField coerces numeric strings and rejects non-numeric ones;
//   - BooleanField coerces "true"/"false";
//   - StringField choices are enforced;
//   - updateSource applies dotted keys and `-=` deletions;
//   - sparse arrays inside an ObjectField survive toObject (droid slot arrays).
// Mutations fired while writing it (each turned the self-test red, then was restored):
//   - SchemaField._cleanType keeping undeclared keys -> "undeclared key survived";
//   - NumberField._cast returning value unchanged -> "'12' was not coerced";
//   - DataField.clean returning null for non-nullable -> "null survived a non-nullable field".

import { webcrypto } from 'node:crypto';
// The ApplicationV2 / Handlebars layer (unit U05): foundry.applications.*, foundry.documents.collections,
// the Handlebars global and fromUuid. Kept in its own file; installed by installFoundryShim below.
import { installApplicationsLayer } from './foundry-shim-apps.mjs';

// ---------------------------------------------------------------------------
// utils (foundry.utils)
// ---------------------------------------------------------------------------

/** Foundry's getType: the constructor name for objects, typeof otherwise. */
export function getType(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t !== 'object') return t;
  if (Array.isArray(value)) return 'Array';
  if (value instanceof Set) return 'Set';
  if (value instanceof Map) return 'Map';
  if (value instanceof Date) return 'Date';
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) return 'Object';
  return value.constructor?.name ?? 'Object';
}

export function deepClone(original) {
  if (typeof original !== 'object' || original === null) return original;
  if (Array.isArray(original)) return original.map(deepClone);
  if (original instanceof Date) return new Date(original);
  if (original instanceof Set) return new Set([...original].map(deepClone));
  if (original instanceof Map) return new Map([...original].map(([k, v]) => [k, deepClone(v)]));
  if (getType(original) !== 'Object') return original;
  const clone = {};
  for (const k of Object.keys(original)) clone[k] = deepClone(original[k]);
  return clone;
}

export function duplicate(original) { return JSON.parse(JSON.stringify(original)); }

export function isEmpty(value) {
  const t = getType(value);
  switch (t) {
    case 'undefined': case 'null': return true;
    case 'string': return !value.length;
    case 'Object': return !Object.keys(value).length;
    case 'Array': return !value.length;
    case 'Set': case 'Map': return !value.size;
    default: return false;
  }
}

export function getProperty(object, key) {
  if (!key || !object) return undefined;
  if (key in object) return object[key];
  let target = object;
  for (const p of key.split('.')) {
    if (!(typeof target === 'object' && target !== null) && typeof target !== 'function') return undefined;
    if (p in target) target = target[p];
    else return undefined;
  }
  return target;
}

export function hasProperty(object, key) { return getProperty(object, key) !== undefined; }

export function setProperty(object, key, value) {
  let target = object;
  const parts = key.split('.');
  const last = parts.pop();
  for (const p of parts) {
    if (!(p in target) || target[p] === null || typeof target[p] !== 'object') target[p] = {};
    target = target[p];
  }
  const changed = target[last] !== value;
  target[last] = value;
  return changed;
}

export function expandObject(obj) {
  const expanded = {};
  for (const [k, v] of Object.entries(obj)) {
    const value = getType(v) === 'Object' ? expandObject(v) : v;
    setProperty(expanded, k, value);
  }
  return expanded;
}

export function flattenObject(obj, _d = 0) {
  const flat = {};
  if (_d > 100) throw new Error('Maximum depth exceeded');
  for (const [k, v] of Object.entries(obj)) {
    if (getType(v) === 'Object' && !isEmpty(v)) {
      for (const [ik, iv] of Object.entries(flattenObject(v, _d + 1))) flat[`${k}.${ik}`] = iv;
    } else flat[k] = v;
  }
  return flat;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function randomID(length = 16) {
  const bytes = webcrypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += ID_CHARS[b % ID_CHARS.length];
  return out;
}

/**
 * Foundry's mergeObject, including `-=key` deletions when performDeletions is set.
 * Arrays are replaced, never merged (as in Foundry).
 */
export function mergeObject(original, other = {}, {
  insertKeys = true, insertValues = true, overwrite = true, recursive = true, inplace = true, enforceTypes = false, performDeletions = false,
} = {}, _d = 0) {
  other = other || {};
  if (getType(original) !== 'Object' || getType(other) !== 'Object') throw new Error('One of original or other are not Objects!');
  const options = { insertKeys, insertValues, overwrite, recursive, inplace, enforceTypes, performDeletions };
  if (_d === 0) {
    if (Object.keys(other).some((k) => /\./.test(k))) other = expandObject(other);
    if (Object.keys(original).some((k) => /\./.test(k))) {
      const expanded = expandObject(original);
      if (inplace) { for (const k of Object.keys(original)) delete original[k]; Object.assign(original, expanded); }
      else original = expanded;
    } else if (!inplace) original = deepClone(original);
  }
  for (const k of Object.keys(other)) {
    const v = other[k];
    if (Object.prototype.hasOwnProperty.call(original, k)) _mergeUpdate(original, k, v, options, _d + 1);
    else _mergeInsert(original, k, v, options, _d + 1);
  }
  return original;
}
function _mergeInsert(original, k, v, { insertKeys, insertValues, performDeletions }, _d) {
  if (k.startsWith('-=') && performDeletions) { delete original[k.slice(2)]; return; }
  const canInsert = (_d <= 1 && insertKeys) || (_d > 1 && insertValues);
  if (!canInsert) return;
  if (getType(v) === 'Object') { original[k] = mergeObject({}, v, { insertKeys: true, inplace: true, performDeletions }); return; }
  original[k] = v;
}
function _mergeUpdate(original, k, v, { insertKeys, insertValues, enforceTypes, overwrite, recursive, performDeletions }, _d) {
  const x = original[k];
  const tv = getType(v);
  const tx = getType(x);
  if (tv === 'Object' && tx === 'Object' && recursive) { mergeObject(x, v, { insertKeys, insertValues, overwrite, enforceTypes, performDeletions, inplace: true }, _d); return; }
  if (overwrite) {
    if (tx !== 'undefined' && tv !== tx && enforceTypes) throw new Error('Mismatched data types encountered during object merge.');
    original[k] = v;
  }
}

export function diffObject(original, other, { inner = false, deletionKeys = false } = {}) {
  const diff = {};
  for (const [k, v] of Object.entries(other)) {
    const isDeletion = k.startsWith('-=');
    if (isDeletion && deletionKeys) { diff[k] = v; continue; }
    const t0 = getType(original[k]);
    const t1 = getType(v);
    if (!(k in original)) { if (!inner) diff[k] = v; continue; }
    if (t0 !== t1) { diff[k] = v; continue; }
    if (t0 === 'Object') { const d = diffObject(original[k], v, { inner, deletionKeys }); if (!isEmpty(d)) diff[k] = d; continue; }
    if (t0 === 'Array') { if (JSON.stringify(original[k]) !== JSON.stringify(v)) diff[k] = v; continue; }
    if (original[k] !== v) diff[k] = v;
  }
  return diff;
}

export class Collection extends Map {
  get contents() { return [...this.values()]; }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  find(fn) { return this.contents.find(fn); }
  some(fn) { return this.contents.some(fn); }
  every(fn) { return this.contents.every(fn); }
  reduce(fn, init) { return this.contents.reduce(fn, init); }
  getName(name) { return this.find((d) => d.name === name); }
  toJSON() { return this.contents.map((d) => (d.toObject ? d.toObject() : d)); }
  [Symbol.iterator]() { return this.values(); }
}

/**
 * game.users: the user collection with Foundry's `activeGM` - the ACTIVE GM
 * user with the lowest id, or null when no GM is connected (Users#activeGM,
 * UNVERIFIED wording: documented as "the active GM user with the lowest id").
 * A check that wants to be "a player" swaps `game.user`/`game.userId` and adds
 * a GM entry here; `gm === game.user` is then false on the player's client.
 */
export class Users extends Collection {
  get activeGM() {
    const gms = this.contents.filter((u) => u?.isGM && u.active !== false);
    gms.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return gms[0] ?? null;
  }
}

// ---------------------------------------------------------------------------
// fields (foundry.data.fields)
// ---------------------------------------------------------------------------

export class DataModelValidationError extends Error {
  constructor(failures) {
    const list = Array.isArray(failures) ? failures : [failures];
    super(`DataModel validation failed:\n  ${list.map((f) => `${f.path}: ${f.message} (value: ${JSON.stringify(f.value)?.slice?.(0, 80)})`).join('\n  ')}`);
    this.failures = list;
  }
}

/** A thrown marker for "this value is valid as a special case, skip type validation". */
const VALID_SPECIAL = Symbol('valid-special');

export class DataField {
  static get _defaults() {
    return { required: false, nullable: false, initial: undefined, readonly: false, gmOnly: false, label: '', hint: '', validationError: 'is not a valid value' };
  }

  constructor(options = {}, { name, parent } = {}) {
    this.name = name;
    this.parent = parent;
    this.options = options;
    Object.assign(this, this.constructor._defaults, options);
  }

  get fieldPath() {
    // The root SchemaField (no parent) is not part of the path, as in Foundry's failure paths.
    const parts = [];
    let f = this;
    while (f) { if (f.parent && f.name !== undefined && f.name !== null) parts.unshift(f.name); f = f.parent; }
    return parts.join('.');
  }

  getInitialValue(data) {
    return typeof this.initial === 'function' ? this.initial(data) : deepClone(this.initial);
  }

  /**
   * Foundry's DataField#clean: null passes through a nullable field, is treated
   * as undefined otherwise; undefined takes the initial; anything else is cast
   * then type-cleaned.
   */
  clean(value, options = {}) {
    if (value === null) {
      if (this.nullable) return value;
      value = undefined;
    }
    if (value === undefined) return this.getInitialValue(options.source);
    value = this._cast(value);
    return this._cleanType(value, options);
  }

  _cast(value) { return value; }
  _cleanType(value, _options) { return value; }

  /**
   * Returns undefined when valid, otherwise a failure { path, message, value }.
   * Special cases (undefined/null) are decided by required/nullable before the type runs.
   */
  validate(value, options = {}) {
    try {
      const special = this._validateSpecial(value);
      if (special === VALID_SPECIAL) return undefined;
      this._validateType(value, options);
      return undefined;
    } catch (err) {
      if (err instanceof DataModelValidationError) return err.failures;
      return [{ path: this.fieldPath, message: err.message, value }];
    }
  }

  _validateSpecial(value) {
    if (value === undefined) {
      if (this.required) throw new Error('may not be undefined');
      return VALID_SPECIAL;
    }
    if (value === null) {
      if (this.nullable) return VALID_SPECIAL;
      throw new Error('may not be null');
    }
    return undefined;
  }

  _validateType(_value, _options) {}

  initialize(value, _model, _options) { return value; }
  toObject(value) { return value; }

  /** Apply one change to `source[key]`, recording it in `difference`. Default: replace. */
  _updateDiff(source, key, value, difference, options = {}) {
    const current = source[key];
    if (JSON.stringify(current ?? null) === JSON.stringify(value ?? null)) return;
    source[key] = value;
    difference[key] = value;
  }
}

export class BooleanField extends DataField {
  static get _defaults() { return { ...super._defaults, required: true, nullable: false, initial: false }; }
  // UNVERIFIED against v13 source: v12's BooleanField._cast reads "true"/"false" strings and treats objects as false.
  _cast(value) {
    if (typeof value === 'string') return value === 'true';
    if (typeof value === 'object') return false;
    return Boolean(value);
  }
  _validateType(value) { if (typeof value !== 'boolean') throw new Error('must be a boolean'); }
}

export class NumberField extends DataField {
  static get _defaults() { return { ...super._defaults, initial: null, nullable: true, min: undefined, max: undefined, step: undefined, integer: false, positive: false, choices: undefined }; }
  _cast(value) { return Number(value); }
  // UNVERIFIED against v13 source: v12 rounds integers and clamps to min/max during cleaning.
  _cleanType(value, options) {
    value = super._cleanType(value, options);
    if (typeof value !== 'number') return value;
    if (this.integer) value = Math.round(value);
    if (Number.isFinite(this.min)) value = Math.max(value, this.min);
    if (Number.isFinite(this.max)) value = Math.min(value, this.max);
    return value;
  }
  _validateType(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('must be a number');
    if (this.integer && !Number.isInteger(value)) throw new Error('must be an integer');
    if (this.positive && value <= 0) throw new Error('must be a positive number');
    if (Number.isFinite(this.min) && value < this.min) throw new Error(`must be at least ${this.min}`);
    if (Number.isFinite(this.max) && value > this.max) throw new Error(`must be at most ${this.max}`);
    if (this.choices && !this._isChoice(value)) throw new Error('is not one of the permitted choices');
  }
  _isChoice(value) {
    const c = typeof this.choices === 'function' ? this.choices() : this.choices;
    return Array.isArray(c) ? c.includes(value) : value in c;
  }
}

export class StringField extends DataField {
  // UNVERIFIED against v13 source: v12 seeds initial "" for a blank-allowed StringField and
  // makes a choices field neither blank nor nullable unless told otherwise.
  static get _defaults() { return { ...super._defaults, blank: true, trim: true, nullable: false, initial: undefined, choices: undefined, textSearch: false }; }
  constructor(options = {}, context = {}) {
    super(options, context);
    if (this.choices !== undefined) {
      this.nullable = options.nullable ?? false;
      this.blank = options.blank ?? false;
    }
    if (this.initial === undefined && this.blank && !this.nullable) this.initial = '';
  }
  clean(value, options) {
    if (typeof value === 'string' && this.trim) value = value.trim();
    return super.clean(value, options);
  }
  _cast(value) { return String(value); }
  _validateSpecial(value) {
    if (value === '') {
      if (this.blank) return VALID_SPECIAL;
      throw new Error('may not be a blank string');
    }
    return super._validateSpecial(value);
  }
  _validateType(value) {
    if (typeof value !== 'string') throw new Error('must be a string');
    if (this.choices !== undefined && !this._isChoice(value)) throw new Error(`"${value}" is not a valid choice`);
  }
  _isChoice(value) {
    const c = typeof this.choices === 'function' ? this.choices() : this.choices;
    return Array.isArray(c) ? c.includes(value) : value in c;
  }
}

export class HTMLField extends StringField {
  static get _defaults() { return { ...super._defaults, required: true, blank: true }; }
}

export class FilePathField extends StringField {
  // The real field validates the extension against `categories`; the shim accepts any string
  // (the data layer never stores a data URL here - ARCHITECTURE.md §4.1 characterPortrait).
  static get _defaults() { return { ...super._defaults, categories: [], base64: false, wildcard: false, nullable: true, blank: false, initial: null }; }
}

export class DocumentIdField extends StringField {
  static get _defaults() { return { ...super._defaults, required: true, blank: false, nullable: true, initial: null, readonly: true }; }
  _cast(value) { return typeof value === 'object' && value?.id ? value.id : String(value); }
}

export class ObjectField extends DataField {
  static get _defaults() { return { ...super._defaults, required: true, nullable: false, initial: () => ({}) }; }
  // UNVERIFIED against v13 source: v12's ObjectField._cast returns {} for anything that is not a plain Object.
  _cast(value) { return getType(value) === 'Object' ? value : {}; }
  _validateType(value) { if (getType(value) !== 'Object') throw new Error('must be an object'); }
  initialize(value) { return value == null ? value : deepClone(value); }
  toObject(value) { return value == null ? value : deepClone(value); }
  /** Changes MERGE into an ObjectField (recursive, with -= deletions), unless recursive === false. */
  _updateDiff(source, key, value, difference, options = {}) {
    const current = source[key];
    if (getType(value) !== 'Object' || getType(current) !== 'Object' || options.recursive === false) {
      return super._updateDiff(source, key, value, difference, options);
    }
    const before = JSON.stringify(current);
    mergeObject(current, value, { inplace: true, performDeletions: true });
    if (JSON.stringify(current) !== before) difference[key] = deepClone(value);
  }
}

export class ArrayField extends DataField {
  static get _defaults() { return { ...super._defaults, required: true, nullable: false, empty: true, exact: undefined, initial: () => [] }; }
  constructor(element, options = {}, context = {}) {
    super(options, context);
    if (!(element instanceof DataField)) throw new Error('ArrayField requires a DataField element');
    this.element = element;
    element.parent = this;
    element.name = element.name ?? 'element';
  }
  // UNVERIFIED against v13 source: v12 accepts an index-keyed Object (form data) as an array.
  _cast(value) {
    const t = getType(value);
    if (t === 'Object') {
      const arr = [];
      for (const [k, v] of Object.entries(value)) { const i = Number(k); if (Number.isInteger(i) && i >= 0) arr[i] = v; }
      return arr;
    }
    if (t === 'Set') return Array.from(value);
    return Array.isArray(value) ? value : [value];
  }
  _cleanType(value, options) { return value.map((v) => this.element.clean(v, options)); }
  _validateType(value, options) {
    if (!Array.isArray(value)) throw new Error('must be an array');
    if (!this.empty && !value.length) throw new Error('must not be empty');
    const failures = [];
    value.forEach((v, i) => {
      const f = this.element.validate(v, options);
      if (f) for (const x of f) failures.push({ ...x, path: `${this.fieldPath}.${i}` });
    });
    if (failures.length) throw new DataModelValidationError(failures);
  }
  initialize(value, model, options) { return value == null ? value : value.map((v) => this.element.initialize(v, model, options)); }
  toObject(value) { return value == null ? value : value.map((v) => this.element.toObject(v)); }
}

export class SetField extends ArrayField {
  _cast(value) { return value instanceof Set ? Array.from(value) : super._cast(value); }
  _cleanType(value, options) { return [...new Set(super._cleanType(value, options))]; }
  initialize(value, model, options) { return value == null ? value : new Set(super.initialize(value, model, options)); }
  toObject(value) { return value == null ? value : Array.from(value); }
  _updateDiff(source, key, value, difference, options) { return super._updateDiff(source, key, value instanceof Set ? Array.from(value) : value, difference, options); }
}

export class SchemaField extends DataField {
  static get _defaults() { return { ...super._defaults, required: true, nullable: false }; }
  constructor(fields, options = {}, context = {}) {
    super(options, context);
    this.fields = {};
    for (const [name, field] of Object.entries(fields)) {
      if (!(field instanceof DataField)) throw new Error(`SchemaField "${name}" is not a DataField`);
      field.name = name;
      field.parent = this;
      this.fields[name] = field;
    }
    if (this.initial === undefined) this.initial = () => this.clean({});
  }
  keys() { return Object.keys(this.fields); }
  values() { return Object.values(this.fields); }
  entries() { return Object.entries(this.fields); }
  has(name) { return name in this.fields; }
  get(name) { return this.fields[name]; }

  _cast(value) { return getType(value) === 'Object' ? value : {}; }

  /**
   * Foundry's SchemaField._cleanType: every declared field is cleaned (absent
   * ones skipped when partial), and EVERY UNDECLARED KEY IS DELETED.
   */
  _cleanType(data, options = {}) {
    options.source = options.source || data;
    for (const [name, field] of this.entries()) {
      if (!(name in data) && options.partial) continue;
      data[name] = field.clean(data[name], options);
      if (data[name] === undefined) delete data[name];
    }
    for (const k of Object.keys(data)) if (!this.has(k)) delete data[k];
    return data;
  }

  _validateType(data, options = {}) {
    if (getType(data) !== 'Object') throw new Error('must be an object');
    const failures = [];
    for (const [name, field] of this.entries()) {
      if (options.partial && !(name in data)) continue;
      const f = field.validate(data[name], options);
      if (f) failures.push(...f);
    }
    if (failures.length) throw new DataModelValidationError(failures);
  }

  initialize(value, model, options = {}) {
    if (!value) return value;
    const data = {};
    for (const [name, field] of this.entries()) data[name] = field.initialize(value[name], model, options);
    return data;
  }

  toObject(value) {
    if (value == null) return value;
    const data = {};
    for (const [name, field] of this.entries()) data[name] = field.toObject(value[name]);
    return data;
  }

  /** Apply an object of changes to `source`, field by field, honouring -= deletions. */
  _updateDiff(source, key, value, difference, options = {}) {
    if (key !== undefined) {
      // A nested SchemaField: recurse into its own source object.
      if (getType(value) !== 'Object') return super._updateDiff(source, key, value, difference, options);
      source[key] ??= {};
      const sub = {};
      this._updateDiff(source[key], undefined, value, sub, options);
      if (!isEmpty(sub)) difference[key] = sub;
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('-=')) {
        const name = k.slice(2);
        if (name in source) { delete source[name]; difference[k] = null; }
        continue;
      }
      const field = this.fields[k];
      if (!field) continue; // undeclared keys are dropped, as cleaning drops them
      field._updateDiff(source, k, field.clean(v, { partial: true, source }), difference, options);
    }
  }
}

/** The `system` field of a document: cleans and initializes through the registered TypeDataModel. */
export class TypeDataField extends ObjectField {
  constructor(document, options = {}, context = {}) {
    super(options, context);
    this.document = document;
  }
  getModelForType(type) {
    const cfg = globalThis.CONFIG?.[this.document.documentName];
    return cfg?.dataModels?.[type] ?? null;
  }
  getInitialValue(data) {
    const cls = this.getModelForType(data?.type);
    return cls ? cls.cleanData({}) : {};
  }
  clean(value, options = {}) {
    const cls = this.getModelForType(options.source?.type);
    if (!cls) return super.clean(value, options);
    if (value === undefined || value === null) value = {};
    return cls.cleanData(value, options);
  }
  _validateType(value, options = {}) {
    super._validateType(value, options);
    const cls = this.getModelForType(options.source?.type);
    if (!cls) return;
    const failures = cls.schema.validate(value, options);
    if (failures) throw new DataModelValidationError(failures.map((f) => ({ ...f, path: `system.${f.path}` })));
  }
  initialize(value, model, options = {}) {
    const cls = this.getModelForType(model._source?.type ?? model.type);
    if (!cls) return deepClone(value);
    return new cls(value, { parent: model, ...options });
  }
  toObject(value) { return value instanceof DataModel ? value.toObject() : deepClone(value); }
  _updateDiff(source, key, value, difference, options = {}) {
    const cls = this.getModelForType(source.type);
    if (!cls) return super._updateDiff(source, key, value, difference, options);
    const sub = {};
    cls.schema._updateDiff(source[key], undefined, value, sub, options);
    if (!isEmpty(sub)) difference[key] = sub;
  }
}

/** An embedded collection: `_source[name]` is an array of plain sources; the document exposes a Collection. */
export class EmbeddedCollectionField extends ArrayField {
  constructor(documentClass, options = {}, context = {}) {
    super(new ObjectField(), { ...options, required: true, nullable: false, initial: () => [] }, context);
    this.documentClass = documentClass;
  }
  _cleanType(value, options) {
    // Each embedded source is cleaned by its own document schema.
    return value.map((v) => (v instanceof Document ? v.toObject() : this.documentClass.cleanData(v ?? {}, { source: v })));
  }
  _validateType(value) {
    if (!Array.isArray(value)) throw new Error('must be an array');
    const failures = [];
    value.forEach((v, i) => { const f = this.documentClass.schema.validate(v); if (f) failures.push(...f.map((x) => ({ ...x, path: `${this.fieldPath}.${i}.${x.path}` }))); });
    if (failures.length) throw new DataModelValidationError(failures);
  }
  /**
   * Build the collection through the REGISTERED document class (Foundry's
   * EmbeddedCollection uses CONFIG.<Document>.documentClass), and keep the
   * identity of an embedded document whose source is still in the array - in
   * Foundry an update never replaces the Item instances an actor holds.
   */
  initialize(value, model) {
    const docName = this.documentClass.documentName;
    const cls = globalThis.CONFIG?.[docName]?.documentClass ?? this.documentClass;
    const prev = model?.[this.name] instanceof Collection ? model[this.name] : null;
    const collection = new Collection();
    for (const source of value ?? []) {
      let doc = prev?.get(source?._id);
      if (doc && doc._source === source && doc.constructor === cls) doc.reset();
      else doc = new cls(source, { parent: model });
      collection.set(doc.id, doc);
    }
    return collection;
  }
  toObject(value) { return value instanceof Collection ? value.contents.map((d) => d.toObject()) : deepClone(value); }
}

// ---------------------------------------------------------------------------
// DataModel / TypeDataModel / Document (foundry.abstract)
// ---------------------------------------------------------------------------

export class DataModel {
  static defineSchema() { throw new Error(`${this.name} must implement static defineSchema()`); }

  static get schema() {
    if (!Object.prototype.hasOwnProperty.call(this, '_schema')) {
      const schema = new SchemaField(this.defineSchema());
      schema.name = 'this';
      Object.defineProperty(this, '_schema', { value: schema, configurable: true });
    }
    return this._schema;
  }

  get schema() { return this.constructor.schema; }

  constructor(data = {}, { parent = null, strict = true, ...options } = {}) {
    Object.defineProperty(this, 'parent', { value: parent, writable: true, enumerable: false, configurable: true });
    Object.defineProperty(this, '_source', { value: undefined, writable: true, enumerable: false, configurable: true });
    this._source = this._initializeSource(data, { strict, ...options });
    this._initialize({ strict, ...options });
  }

  /**
   * As in Foundry, the source object handed in is cleaned IN PLACE and kept
   * (a document's `_source.system` IS its system model's `_source`); callers
   * that must not have their input mutated clone first (buildActor does).
   */
  _initializeSource(data, options = {}) {
    if (data instanceof DataModel) data = data.toObject();
    const source = this.constructor.cleanData(data, options);
    const failures = this.schema.validate(source, options);
    if (failures) {
      if (options.strict !== false) throw new DataModelValidationError(failures);
      // Fallback: replace each failing top-level field with its initial (UNVERIFIED: Foundry's fallback is per failing leaf).
      for (const f of failures) {
        const top = f.path.split('.')[0];
        const field = this.schema.get(top);
        if (field) source[top] = field.getInitialValue(source);
      }
    }
    return source;
  }

  _initialize(options = {}) {
    const data = this.schema.initialize(this._source, this, options);
    for (const [k, v] of Object.entries(data)) {
      Object.defineProperty(this, k, { value: v, writable: true, enumerable: true, configurable: true });
    }
  }

  reset() { this._initialize(); }

  static cleanData(source = {}, options = {}) { return this.schema.clean(source, options); }

  validate({ changes, strict = false } = {}) {
    const failures = this.schema.validate(changes ?? this._source);
    if (failures && strict) throw new DataModelValidationError(failures);
    return !failures;
  }

  /**
   * Apply changes to the source (dotted keys expanded, `-=` deletions honoured),
   * validate the whole, re-initialize, and return the diff that was applied.
   * UNVERIFIED detail: whether Foundry re-initializes inside updateSource or
   * leaves it to the document's update path; the shim re-initializes here so
   * `model.field` reflects `_source` immediately, which is what every caller observes.
   */
  updateSource(changes = {}, options = {}) {
    if (Object.keys(changes).some((k) => k.includes('.'))) changes = expandObject(changes);
    const backup = deepClone(this._source);
    const diff = {};
    try {
      this.schema._updateDiff(this._source, undefined, changes, diff, options);
      const failures = this.schema.validate(this._source);
      if (failures) throw new DataModelValidationError(failures);
    } catch (err) {
      for (const k of Object.keys(this._source)) delete this._source[k];
      Object.assign(this._source, backup);
      throw err;
    }
    if (!options.dryRun) this._initialize(options);
    return diff;
  }

  toObject(source = true) { return source ? deepClone(this._source) : this.schema.toObject(this); }
  toJSON() { return this.toObject(true); }
}

export class TypeDataModel extends DataModel {
  static LOCALIZATION_PREFIXES = [];
  prepareBaseData() {}
  prepareDerivedData() {}
}

let _hookUser = 'shim-user';

export class Document extends DataModel {
  static documentName = 'Document';
  static metadata = { embedded: {} };
  static get schema() { return super.schema; }

  get documentName() { return this.constructor.documentName; }
  get id() { return this._id; }
  get uuid() { return this.parent ? `${this.parent.uuid}.${this.documentName}.${this.id}` : `${this.documentName}.${this.id}`; }
  get isEmbedded() { return !!this.parent; }
  get collectionName() { return this.constructor.metadata.collection ?? `${this.documentName.toLowerCase()}s`; }

  constructor(data = {}, context = {}) {
    if (!data._id) data._id = randomID();
    super(data, context);
  }

  getFlag(scope, key) { return getProperty(this.flags ?? {}, `${scope}.${key}`); }
  async setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); }
  async unsetFlag(scope, key) { return this.update({ [`flags.${scope}.-=${key}`]: null }); }

  getEmbeddedCollection(name) {
    const key = this.constructor.metadata.embedded[name];
    if (!key) throw new Error(`${this.documentName} has no embedded collection "${name}"`);
    return this[key];
  }

  // ---- ClientDocument-style prepareData -----------------------------------
  /** Foundry's order: system base, document base, embedded docs, system derived, document derived. */
  prepareData() {
    const isTypeData = this.system instanceof TypeDataModel;
    if (isTypeData) this.system.prepareBaseData();
    this.prepareBaseData();
    this.prepareEmbeddedDocuments();
    if (isTypeData) this.system.prepareDerivedData();
    this.prepareDerivedData();
  }
  prepareBaseData() {}
  prepareEmbeddedDocuments() {
    for (const key of Object.values(this.constructor.metadata.embedded)) {
      const collection = this[key];
      if (!(collection instanceof Collection)) continue;
      for (const doc of collection) doc.prepareData();
    }
  }
  prepareDerivedData() {}

  // ---- CRUD (applied to _source, then prepareData; the parent re-prepares) --
  _root() { let d = this; while (d.parent) d = d.parent; return d; }

  async update(data = {}, options = {}) {
    const changes = expandObject(deepClone(data));
    const go = Hooks.call(`preUpdate${this.documentName}`, this, changes, options, _hookUser);
    if (go === false) return this;
    const diff = this.updateSource(changes, options);
    this._root().prepareData();
    Hooks.callAll(`update${this.documentName}`, this, diff, options, _hookUser);
    _log.push({ op: 'update', document: this.documentName, id: this.id, changes: diff });
    return this;
  }

  async delete(options = {}) {
    if (!this.parent) { game.actors?.delete(this.id); return this; }
    await this.parent.deleteEmbeddedDocuments(this.documentName, [this.id], options);
    return this;
  }

  async createEmbeddedDocuments(embeddedName, dataArray = [], options = {}) {
    const key = this.constructor.metadata.embedded[embeddedName];
    if (!key) throw new Error(`${this.documentName} cannot embed ${embeddedName}`);
    const cls = CONFIG[embeddedName].documentClass;
    const created = [];
    for (const datum of dataArray) {
      // The hook sees the creation data AS GIVEN (Foundry passes the caller's data,
      // not the cleaned source); the document cleans its own copy.
      const raw = deepClone(datum);
      const source = deepClone(datum);
      source._id ??= randomID();
      const doc = new cls(source, { parent: this });
      const go = Hooks.call(`preCreate${embeddedName}`, doc, raw, options, _hookUser);
      if (go === false) continue;
      this._source[key].push(doc._source);
      this[key].set(doc.id, doc);
      created.push(doc);
    }
    this._root().prepareData();
    for (const doc of created) Hooks.callAll(`create${embeddedName}`, doc, options, _hookUser);
    _log.push({ op: 'create', document: embeddedName, parent: this.id, ids: created.map((d) => d.id) });
    return created;
  }

  async updateEmbeddedDocuments(embeddedName, updates = [], options = {}) {
    const key = this.constructor.metadata.embedded[embeddedName];
    if (!key) throw new Error(`${this.documentName} cannot embed ${embeddedName}`);
    const updated = [];
    for (const { _id, ...changes } of updates) {
      const doc = this[key].get(_id);
      if (!doc) throw new Error(`${embeddedName} ${_id} not found on ${this.documentName} ${this.id}`);
      const expanded = expandObject(deepClone(changes));
      const go = Hooks.call(`preUpdate${embeddedName}`, doc, expanded, options, _hookUser);
      if (go === false) continue;
      doc.updateSource(expanded, options);
      updated.push([doc, expanded]);
    }
    this._root().prepareData();
    for (const [doc, changes] of updated) Hooks.callAll(`update${embeddedName}`, doc, changes, options, _hookUser);
    _log.push({ op: 'updateEmbedded', document: embeddedName, parent: this.id, ids: updated.map(([d]) => d.id) });
    return updated.map(([d]) => d);
  }

  async deleteEmbeddedDocuments(embeddedName, ids = [], options = {}) {
    const key = this.constructor.metadata.embedded[embeddedName];
    if (!key) throw new Error(`${this.documentName} cannot embed ${embeddedName}`);
    const deleted = [];
    for (const id of ids) {
      const doc = this[key].get(id);
      if (!doc) continue;
      const go = Hooks.call(`preDelete${embeddedName}`, doc, options, _hookUser);
      if (go === false) continue;
      const i = this._source[key].findIndex((s) => s._id === id);
      if (i >= 0) this._source[key].splice(i, 1);
      this[key].delete(id);
      deleted.push(doc);
    }
    this._root().prepareData();
    for (const doc of deleted) Hooks.callAll(`delete${embeddedName}`, doc, options, _hookUser);
    _log.push({ op: 'delete', document: embeddedName, parent: this.id, ids: deleted.map((d) => d.id) });
    return deleted;
  }

  static async create(data = {}, options = {}) {
    const raw = deepClone(data);
    const source = deepClone(data);
    const cls = CONFIG[this.documentName]?.documentClass ?? this;
    const doc = new cls(source, options);
    // UNVERIFIED detail: Foundry hands preCreate hooks the creation data as the caller gave it; the shim does the same.
    const go = Hooks.call(`preCreate${this.documentName}`, doc, raw, options, _hookUser);
    if (go === false) return undefined;
    // preCreate hooks may have called updateSource; re-prepare with the final source.
    doc.prepareData();
    if (this.documentName === 'Actor') game.actors.set(doc.id, doc);
    if (this.documentName === 'Item') game.items.set(doc.id, doc);
    Hooks.callAll(`create${this.documentName}`, doc, options, _hookUser);
    return doc;
  }
}

const documentStats = () => new SchemaField({
  systemId: new StringField({ required: true, blank: false, nullable: true, initial: null }),
  systemVersion: new StringField({ required: true, blank: false, nullable: true, initial: null }),
  coreVersion: new StringField({ required: true, blank: false, nullable: true, initial: null }),
  createdTime: new NumberField(),
  modifiedTime: new NumberField(),
  lastModifiedBy: new StringField({ required: true, nullable: true, initial: null }),
});

export class BaseActiveEffect extends Document {
  static documentName = 'ActiveEffect';
  static metadata = { embedded: {}, collection: 'effects' };
  static defineSchema() {
    return {
      _id: new DocumentIdField(),
      name: new StringField({ required: true, blank: false }),
      img: new FilePathField({ categories: ['IMAGE'] }),
      type: new StringField({ required: true, blank: false, initial: 'base' }),
      system: new ObjectField(),
      changes: new ArrayField(new SchemaField({
        key: new StringField({ required: true }),
        value: new StringField({ required: true }),
        mode: new NumberField({ integer: true, initial: 2 }),
        priority: new NumberField(),
      })),
      disabled: new BooleanField(),
      duration: new SchemaField({
        startTime: new NumberField({ initial: null }),
        seconds: new NumberField({ integer: true, min: 0 }),
        combat: new StringField({ nullable: true, initial: null }),
        rounds: new NumberField({ integer: true, min: 0 }),
        turns: new NumberField({ integer: true, min: 0 }),
        startRound: new NumberField({ integer: true, min: 0 }),
        startTurn: new NumberField({ integer: true, min: 0 }),
      }),
      description: new HTMLField({ initial: '' }),
      origin: new StringField({ nullable: true, blank: false, initial: null }),
      tint: new StringField({ nullable: true, initial: '#ffffff' }),
      transfer: new BooleanField({ initial: true }),
      statuses: new SetField(new StringField({ required: true, blank: false })),
      sort: new NumberField({ integer: true, initial: 0, nullable: false }),
      flags: new ObjectField(),
      _stats: documentStats(),
    };
  }
  get isSuppressed() { return false; }
  get active() { return !this.disabled && !this.isSuppressed; }
  /** Minimal change application (ADD / OVERRIDE / MULTIPLY on the actor); §4.4 keeps changes empty. */
  apply(actor, change) {
    const current = getProperty(actor, change.key);
    const modes = CONST.ACTIVE_EFFECT_MODES;
    let value = change.value;
    const num = Number(value);
    switch (change.mode) {
      case modes.ADD: value = (Number(current) || 0) + num; break;
      case modes.MULTIPLY: value = (Number(current) || 0) * num; break;
      case modes.UPGRADE: value = Math.max(Number(current) || 0, num); break;
      case modes.DOWNGRADE: value = Math.min(Number(current) || 0, num); break;
      case modes.OVERRIDE: value = Number.isNaN(num) ? value : num; break;
      default: return null;
    }
    setProperty(actor, change.key, value);
    return value;
  }
}

export class BaseItem extends Document {
  static documentName = 'Item';
  static metadata = { embedded: { ActiveEffect: 'effects' }, collection: 'items' };
  static DEFAULT_ICON = 'icons/svg/item-bag.svg';
  static defineSchema() {
    return {
      _id: new DocumentIdField(),
      name: new StringField({ required: true, blank: false }),
      type: new StringField({ required: true, blank: false }),
      img: new FilePathField({ categories: ['IMAGE'], initial: () => this.DEFAULT_ICON }),
      system: new TypeDataField(this),
      effects: new EmbeddedCollectionField(BaseActiveEffect),
      folder: new StringField({ nullable: true, initial: null }),
      sort: new NumberField({ integer: true, initial: 0, nullable: false }),
      ownership: new ObjectField({ initial: () => ({ default: 0 }) }),
      flags: new ObjectField(),
      _stats: documentStats(),
    };
  }
  get actor() { return this.parent instanceof BaseActor ? this.parent : null; }
  get isOwned() { return this.actor !== null; }
  getRollData() { return this.system?.toObject ? this.system.toObject(false) : {}; }
}

export class BaseActor extends Document {
  static documentName = 'Actor';
  static metadata = { embedded: { Item: 'items', ActiveEffect: 'effects' }, collection: 'actors' };
  static DEFAULT_ICON = 'icons/svg/mystery-man.svg';
  static defineSchema() {
    return {
      _id: new DocumentIdField(),
      name: new StringField({ required: true, blank: false }),
      type: new StringField({ required: true, blank: false }),
      img: new FilePathField({ categories: ['IMAGE'], initial: () => this.DEFAULT_ICON }),
      system: new TypeDataField(this),
      prototypeToken: new ObjectField(),
      items: new EmbeddedCollectionField(BaseItem),
      effects: new EmbeddedCollectionField(BaseActiveEffect),
      folder: new StringField({ nullable: true, initial: null }),
      sort: new NumberField({ integer: true, initial: 0, nullable: false }),
      ownership: new ObjectField({ initial: () => ({ default: 0 }) }),
      flags: new ObjectField(),
      _stats: documentStats(),
    };
  }
  get isToken() { return false; }
  get itemTypes() {
    const out = {};
    for (const t of Object.keys(CONFIG.Item.dataModels ?? {})) out[t] = [];
    for (const item of this.items) (out[item.type] ??= []).push(item);
    return out;
  }
  *allApplicableEffects() { for (const e of this.effects) yield e; }
  /** Foundry's Actor#prepareEmbeddedDocuments: items and effects prepare, then effects apply and statuses collect. */
  prepareEmbeddedDocuments() {
    super.prepareEmbeddedDocuments();
    this.applyActiveEffects();
  }
  applyActiveEffects() {
    this.statuses = new Set();
    const changes = [];
    for (const effect of this.allApplicableEffects()) {
      if (!effect.active) continue;
      for (const s of effect.statuses) this.statuses.add(s);
      for (const c of effect.changes) changes.push({ ...c, effect, priority: c.priority ?? c.mode * 10 });
    }
    changes.sort((a, b) => a.priority - b.priority);
    this.overrides = {};
    for (const c of changes) {
      const v = c.effect.apply(this, c);
      if (v !== null) setProperty(this.overrides, c.key, v);
    }
  }
  /**
   * Foundry's default Actor#modifyTokenAttribute (UNVERIFIED wording, documented behaviour):
   * bars clamp deltas into [0, max] and write `system.<attribute>.value`; plain values write `system.<attribute>`.
   */
  async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
    const current = getProperty(this.system, attribute);
    let updates;
    if (isBar) {
      if (isDelta) value = Math.min(Math.max((current?.value ?? 0) + value, 0), current?.max ?? Infinity);
      updates = { [`system.${attribute}.value`]: value };
    } else {
      if (isDelta) value = (current ?? 0) + value;
      updates = { [`system.${attribute}`]: value };
    }
    const allowed = Hooks.call('modifyTokenAttribute', { attribute, value, isDelta, isBar }, updates);
    return allowed !== false ? this.update(updates) : this;
  }
  getRollData() { return this.system?.toObject ? this.system.toObject(false) : {}; }
}

/**
 * Combatant / Combat (foundry.documents.Combatant / Combat): the tracker
 * documents module/combat.mjs subclasses. Minimal schemas - the fields the
 * system reads (round, combatants, a combatant's actor) and nothing that
 * needs a canvas. `Combatant#actor` resolves the world actor by actorId
 * (Foundry resolves the token's actor first; the shim has no tokens).
 */
export class BaseCombatant extends Document {
  static documentName = 'Combatant';
  static metadata = { embedded: {}, collection: 'combatants' };
  static defineSchema() {
    return {
      _id: new DocumentIdField(),
      type: new StringField({ required: true, blank: false, initial: 'base' }),
      system: new ObjectField(),
      actorId: new StringField({ nullable: true, initial: null }),
      tokenId: new StringField({ nullable: true, initial: null }),
      sceneId: new StringField({ nullable: true, initial: null }),
      name: new StringField({ nullable: true, initial: null }),
      img: new StringField({ nullable: true, initial: null }),
      initiative: new NumberField({ nullable: true, initial: null }),
      hidden: new BooleanField(),
      defeated: new BooleanField(),
      group: new StringField({ nullable: true, initial: null }),
      sort: new NumberField({ integer: true, initial: 0, nullable: false }),
      flags: new ObjectField(),
      _stats: documentStats(),
    };
  }
  get actor() { return this.actorId ? (globalThis.game?.actors?.get(this.actorId) ?? null) : null; }
  get combat() { return this.parent ?? null; }
  /** Foundry's default: CONFIG.Combat.initiative.formula (a subclass may return its own). */
  _getInitiativeFormula() { return globalThis.CONFIG?.Combat?.initiative?.formula ?? null; }
}

export class BaseCombat extends Document {
  static documentName = 'Combat';
  static metadata = { embedded: { Combatant: 'combatants' }, collection: 'combats' };
  static defineSchema() {
    return {
      _id: new DocumentIdField(),
      type: new StringField({ required: true, blank: false, initial: 'base' }),
      system: new ObjectField(),
      scene: new StringField({ nullable: true, initial: null }),
      combatants: new EmbeddedCollectionField(BaseCombatant),
      active: new BooleanField(),
      round: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      turn: new NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null }),
      sort: new NumberField({ integer: true, initial: 0, nullable: false }),
      flags: new ObjectField(),
      _stats: documentStats(),
    };
  }
  get started() { return this.round > 0; }
}

// ---------------------------------------------------------------------------
// Hooks, ui, game, CONST, CONFIG, Roll, ChatMessage
// ---------------------------------------------------------------------------

const _log = [];

export const Hooks = {
  events: {},
  calls: [],
  _id: 0,
  on(hook, fn, { once = false } = {}) {
    const id = ++this._id;
    (this.events[hook] ??= []).push({ id, fn, once });
    return id;
  },
  once(hook, fn) { return this.on(hook, fn, { once: true }); },
  off(hook, id) { const list = this.events[hook] ?? []; const i = list.findIndex((h) => h.id === id || h.fn === id); if (i >= 0) list.splice(i, 1); },
  /** Calls until a handler returns false; returns false in that case. */
  call(hook, ...args) {
    this.calls.push({ hook, args });
    for (const h of [...(this.events[hook] ?? [])]) {
      if (h.once) this.off(hook, h.id);
      const r = h.fn(...args);
      if (r === false) return false;
    }
    return true;
  },
  callAll(hook, ...args) {
    this.calls.push({ hook, args });
    for (const h of [...(this.events[hook] ?? [])]) {
      if (h.once) this.off(hook, h.id);
      h.fn(...args);
    }
    return true;
  },
};

export const ui = {
  notifications: {
    log: [],
    info(message, options = {}) { this.log.push({ level: 'info', message, options }); return message; },
    warn(message, options = {}) { this.log.push({ level: 'warn', message, options }); return message; },
    error(message, options = {}) { this.log.push({ level: 'error', message, options }); return message; },
  },
};

const i18n = {
  translations: {},
  has(key) { return key in this.translations; },
  /** Identity by default (the key comes back), or the registered string when lang/en.json was loaded. */
  localize(key) { return this.translations[key] ?? key; },
  format(key, data = {}) { return this.localize(key).replace(/\{(\w+)\}/g, (_, k) => (k in data ? String(data[k]) : `{${k}}`)); },
};

export const CONST = Object.freeze({
  SORT_INTEGER_DENSITY: 100000,
  ACTIVE_EFFECT_MODES: Object.freeze({ CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 }),
  CHAT_MESSAGE_STYLES: Object.freeze({ OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 }),
  DOCUMENT_OWNERSHIP_LEVELS: Object.freeze({ INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }),
  DICE_ROLL_MODES: Object.freeze({ PUBLIC: 'publicroll', PRIVATE: 'gmroll', BLIND: 'blindroll', SELF: 'selfroll' }),
});

/**
 * A Roll whose totals can be injected: Roll.queueResults([10, 11]) feeds the
 * next evaluations. The grammar is the subset module/rolls.mjs emits
 * (toFoundryFormula): `expr := term (('+'|'-') term)*; term := factor ('*' factor)*;
 * factor := NdF | integer` - so "3d6-1", "5d6+3d6", "2d6*3" and "1d6+2+1d6+1"
 * all evaluate, each NdF term contributing one entry to `dice`. Foundry's
 * own parser accepts far more; anything outside this subset throws here so a
 * formula the module never emits cannot pass a check by accident.
 */
export class Roll {
  static _queue = [];
  static queueResults(totals) { this._queue.push(...totals); }
  constructor(formula, data = {}) { this.formula = formula; this.data = data; this.total = undefined; this.dice = []; this._evaluated = false; }
  async evaluate() {
    const dice = [];
    const total = evaluateFormula(this.formula, dice);
    if (Roll._queue.length) {
      // An injected total: the die results are not meaningful, but the shape is ([{ results }] with the total on the last die).
      this.total = Roll._queue.shift();
      this.dice = dice.length ? dice : [{ faces: 6, number: 3, results: [{ result: this.total, active: true }] }];
    } else { this.total = total; this.dice = dice; }
    this._evaluated = true;
    return this;
  }
  toJSON() { return { formula: this.formula, total: this.total }; }
}

/** Evaluate the Roll grammar subset; pushes one `{ faces, number, results }` per NdF term onto `dice`. */
function evaluateFormula(formula, dice) {
  const src = String(formula ?? '').replace(/\s+/g, '');
  const toks = src.match(/\d+d\d+|\d+(?:\.\d+)?|[+\-*]/g) ?? [];
  if (!src || toks.join('') !== src) throw new Error(`shim Roll cannot evaluate "${formula}" (grammar: NdF | integer, joined by + - and the * multiplier)`);
  let i = 0;
  const factor = () => {
    const t = toks[i++];
    if (t === undefined) throw new Error(`shim Roll: unexpected end of "${formula}"`);
    const d = /^(\d+)d(\d+)$/.exec(t);
    if (d) {
      const n = Number(d[1]); const f = Number(d[2]);
      const results = []; let sum = 0;
      for (let k = 0; k < n; k++) { const r = 1 + Math.floor(Math.random() * f); results.push({ result: r, active: true }); sum += r; }
      dice.push({ faces: f, number: n, results });
      return sum;
    }
    if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
    throw new Error(`shim Roll: unexpected token "${t}" in "${formula}"`);
  };
  const term = () => { let a = factor(); while (toks[i] === '*') { i++; a *= factor(); } return a; };
  let acc = toks[i] === '-' ? (i++, -term()) : term();
  while (i < toks.length) {
    const op = toks[i++];
    const b = term();
    if (op === '+') acc += b; else if (op === '-') acc -= b; else throw new Error(`shim Roll: unexpected operator "${op}" in "${formula}"`);
  }
  return acc;
}

export class ChatMessage {
  static log = [];
  static async create(data = {}) { const msg = { _id: randomID(), ...data }; this.log.push(msg); return msg; }
  static getSpeaker({ actor } = {}) { return { actor: actor?.id ?? null, alias: actor?.name ?? null }; }
  /** The world actor a speaker names (Foundry resolves the token's actor first; the shim has no tokens). */
  static getSpeakerActor(speaker = {}) { return speaker?.actor ? (globalThis.game?.actors?.get(speaker.actor) ?? null) : null; }
  /**
   * Foundry's ChatMessage.applyRollMode (UNVERIFIED against the v13 source; documented behaviour):
   * gmroll/blindroll whisper to the GM users, blindroll also sets blind, selfroll whispers to the author,
   * publicroll leaves the data alone. Returns the data it was given.
   */
  static applyRollMode(data, rollMode) {
    const modes = CONST.DICE_ROLL_MODES;
    const gmIds = (globalThis.game?.users?.contents ?? []).filter((u) => u?.isGM).map((u) => u.id);
    if (rollMode === modes.PRIVATE || rollMode === modes.BLIND) data.whisper = gmIds;
    if (rollMode === modes.BLIND) data.blind = true;
    if (rollMode === modes.SELF) data.whisper = [globalThis.game?.userId].filter(Boolean);
    return data;
  }
  /**
   * v14's replacement for applyRollMode. Mode keys are the CONFIG.ChatMessage.modes ids
   * (public/gm/blind/self); gm/blind whisper to the GMs, blind also sets blind, self
   * whispers to the author, public leaves the data alone.
   */
  static applyMode(data, mode) {
    const gmIds = (globalThis.game?.users?.contents ?? []).filter((u) => u?.isGM).map((u) => u.id);
    if (mode === 'gm' || mode === 'blind') data.whisper = gmIds;
    if (mode === 'blind') data.blind = true;
    if (mode === 'self') data.whisper = [globalThis.game?.userId].filter(Boolean);
    return data;
  }
}

// ---------------------------------------------------------------------------
// The declared surface, behind throwing proxies
// ---------------------------------------------------------------------------

const PASSTHROUGH = new Set(['then', 'toJSON', 'constructor', 'valueOf', 'toString', 'inspect', 'prototype', 'name', 'length', 'hasOwnProperty', '__proto__', '$$typeof', 'asymmetricMatch', 'nodeType', 'Symbol(Symbol.toStringTag)']);

/** Wrap a namespace so reading an undeclared member throws instead of yielding undefined. */
export function declared(target, path) {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol' || PASSTHROUGH.has(prop) || prop in t) return Reflect.get(t, prop, receiver);
      throw new ReferenceError(`foundry shim: ${path}.${String(prop)} is not declared (add it to tools/foundry-shim.mjs if Foundry v13 has it)`);
    },
    set(t, prop, value) { t[prop] = value; return true; },
    has(t, prop) { return prop in t; },
  });
}

let installed = null;

/**
 * Install the shim's globals. Idempotent: returns the same handle on repeat calls.
 * @param {{ selfTest?: boolean, translations?: Record<string,string> }} [options]
 */
export function installFoundryShim({ selfTest = true, translations } = {}) {
  if (installed) { if (translations) Object.assign(i18n.translations, translations); return installed; }
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
  if (translations) Object.assign(i18n.translations, translations);

  const utils = declared({ mergeObject, deepClone, getProperty, setProperty, hasProperty, expandObject, flattenObject, randomID, isEmpty, duplicate, getType, diffObject, Collection }, 'foundry.utils');
  const fields = declared({ DataField, SchemaField, NumberField, StringField, BooleanField, ArrayField, SetField, ObjectField, HTMLField, DocumentIdField, FilePathField, TypeDataField, EmbeddedCollectionField }, 'foundry.data.fields');
  const abstract = declared({ DataModel, TypeDataModel, Document, DataModelValidationError }, 'foundry.abstract');
  const documents = declared({
    BaseActor, BaseItem, BaseActiveEffect, BaseCombat, BaseCombatant,
    Actor: BaseActor, Item: BaseItem, ActiveEffect: BaseActiveEffect, Combat: BaseCombat, Combatant: BaseCombatant,
  }, 'foundry.documents');
  const foundry = declared({
    utils,
    data: declared({ fields, validation: declared({ DataModelValidationError }, 'foundry.data.validation') }, 'foundry.data'),
    abstract,
    documents,
    applications: declared({}, 'foundry.applications'),
    CONST,
  }, 'foundry');

  const CONFIG = declared({
    Actor: { documentClass: BaseActor, dataModels: {}, trackableAttributes: {}, typeLabels: {} },
    Item: { documentClass: BaseItem, dataModels: {}, typeLabels: {} },
    ActiveEffect: { documentClass: BaseActiveEffect, dataModels: {}, legacyTransferral: false },
    Combat: { documentClass: BaseCombat, dataModels: {}, initiative: { formula: null, decimals: 2 } },
    Combatant: { documentClass: BaseCombatant, dataModels: {} },
    // v14: chat/roll visibility modes moved here from CONFIG.Dice.rollModes; keys are
    // public/gm/blind/self/ic (v13 used publicroll/gmroll/blindroll/selfroll). module/apps/roll-dialog.mjs
    // reads this to build the roll-mode select.
    ChatMessage: { modes: {
      public: { label: 'CHAT.MODES.public' },
      gm: { label: 'CHAT.MODES.gm' },
      blind: { label: 'CHAT.MODES.blind' },
      self: { label: 'CHAT.MODES.self' },
      ic: { label: 'CHAT.MODES.ic' },
    } },
    statusEffects: [],
    specialStatusEffects: { DEFEATED: 'dead', INVISIBLE: 'invisible', BLIND: 'blind', BURROW: 'burrow', HOVER: 'hover', FLY: 'fly' },
    Dice: {},
    debug: {},
  }, 'CONFIG');

  const shimUser = { id: 'shim-user', name: 'Shim', isGM: true, active: true };
  const users = new Users();
  users.set(shimUser.id, shimUser);
  const game = declared({
    i18n,
    user: shimUser,
    userId: shimUser.id,
    // game.users.activeGM === game.user on this client: the shim is the one connected GM (module/combat.mjs gates on it).
    users,
    actors: new Collection(),
    combats: new Collection(),
    items: new Collection(),
    packs: new Collection(),
    system: { id: 'shadowbase', version: '2.0.0' },
    settings: {
      _values: {}, _registered: {},
      register(namespace, key, config) { this._registered[`${namespace}.${key}`] = config; },
      get(namespace, key) { const k = `${namespace}.${key}`; if (!(k in this._registered)) throw new Error(`setting ${k} is not registered`); return this._values[k] ?? this._registered[k].default; },
      async set(namespace, key, value) { this._values[`${namespace}.${key}`] = value; return value; },
    },
    ready: false,
  }, 'game');

  Object.assign(globalThis, { foundry, CONFIG, CONST, game, Hooks, ui, Actor: BaseActor, Item: BaseItem, ActiveEffect: BaseActiveEffect, Combat: BaseCombat, Combatant: BaseCombatant, Collection, Roll, ChatMessage });
  // AppV2 + Handlebars (tools/foundry-shim-apps.mjs): module/apps/*.mjs resolve their base classes at import time.
  const applications = installApplicationsLayer({ foundry, declared });
  installed = { foundry, CONFIG, game, Hooks, ui, log: _log, fields, utils, applications };
  if (selfTest) runSelfTest();
  return installed;
}

/**
 * Build a PREPARED actor from `{ name, type, system, items, effects }` through the
 * registered CONFIG.Actor.documentClass. The input is cloned first, so the
 * caller's object is never mutated by cleaning.
 */
export function buildActor(actorData, { strict = true } = {}) {
  if (!installed) installFoundryShim();
  const cls = CONFIG.Actor.documentClass;
  const source = deepClone(actorData);
  source.type ??= 'character';
  const actor = new cls(source, { strict });
  actor.prepareData();
  return actor;
}

/** The shim's write log (update/create/delete ops), for checks that assert what a code path wrote. */
export function shimLog() { return _log; }

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function assert(cond, message) { if (!cond) throw new Error(`foundry-shim self-test FAILED: ${message}`); }

export function runSelfTest() {
  // SchemaField drops an undeclared key.
  const s = new SchemaField({ a: new NumberField({ required: true, nullable: false, initial: 1 }), b: new StringField({ required: true, nullable: true, initial: null, blank: true }) });
  const cleaned = s.clean({ a: '12', b: 'x', zzz: 1 });
  assert(!('zzz' in cleaned), 'undeclared key survived SchemaField cleaning');
  // NumberField coerces numeric strings.
  assert(cleaned.a === 12, `'12' was not coerced to 12 (got ${JSON.stringify(cleaned.a)})`);
  // A non-nullable NumberField cleans null to its initial and rejects null on validation.
  assert(s.clean({ a: null }).a === 1, 'null survived a non-nullable NumberField (clean should give the initial)');
  const nf = new NumberField({ required: true, nullable: false, initial: 0 });
  assert(nf.validate(null) !== undefined, 'a non-nullable NumberField accepted null on validation');
  assert(new NumberField({ required: true, nullable: true, initial: null }).clean(null) === null, 'null did not survive a nullable NumberField');
  // Non-numeric strings fail validation (NaN), which a strict model constructor turns into a throw.
  assert(nf.validate(nf.clean('abc')) !== undefined, 'a NaN passed NumberField validation');
  let threw = false;
  class M extends DataModel { static defineSchema() { return { a: new NumberField({ required: true, nullable: false, initial: 0 }) }; } }
  try { new M({ a: 'abc' }); } catch (e) { threw = e instanceof DataModelValidationError; }
  assert(threw, 'a strict DataModel accepted a NaN NumberField');
  assert(new M({ a: 'abc' }, { strict: false }).a === 0, 'non-strict fallback did not restore the initial');
  // BooleanField coerces strings.
  assert(new BooleanField().clean('true') === true && new BooleanField().clean('false') === false, 'BooleanField did not coerce "true"/"false"');
  // StringField choices are enforced; blank/null follow the flags.
  const sf = new StringField({ required: true, nullable: true, blank: false, initial: 'None', choices: ['None', 'Physical'] });
  assert(sf.validate('x') !== undefined && sf.validate('Physical') === undefined && sf.validate(null) === undefined, 'StringField choices/nullable misbehaved');
  assert(new StringField({ required: true, blank: false }).validate('') !== undefined, 'a blank string passed a blank:false StringField');
  // Integer rounding and min clamping during cleaning.
  assert(new NumberField({ integer: true, min: 1, nullable: false, initial: 10 }).clean(0.4) === 1, 'integer/min cleaning did not round-and-clamp');
  // updateSource: dotted keys, nested SchemaField, -= deletion, ObjectField merge.
  class N extends DataModel {
    static defineSchema() { return { n: new NumberField({ nullable: false, initial: 0 }), o: new ObjectField(), s: new SchemaField({ x: new NumberField({ nullable: false, initial: 0 }), y: new StringField({ initial: '' }) }) }; }
  }
  const n = new N({ o: { keep: 1, drop: 2, deep: { a: 1 } } });
  const diff = n.updateSource({ 'n': 5, 's.x': 3, 'o.-=drop': null, 'o.deep.b': 2, 'o.new': true });
  assert(n.n === 5 && n.s.x === 3 && n.s.y === '', `dotted updateSource failed (${JSON.stringify(n.toObject())})`);
  assert(!('drop' in n.o) && n.o.keep === 1 && n.o.deep.a === 1 && n.o.deep.b === 2 && n.o.new === true, `ObjectField merge/deletion failed (${JSON.stringify(n.o)})`);
  assert(diff.n === 5 && diff.s?.x === 3, `updateSource diff wrong (${JSON.stringify(diff)})`);
  assert(n._source.n === 5 && n._source.s.x === 3, '_source not updated');
  threw = false;
  try { n.updateSource({ n: 'abc' }); } catch (e) { threw = true; }
  assert(threw && n.n === 5, 'invalid updateSource did not throw and restore');
  // Sparse arrays inside an ObjectField survive toObject; arrays in ObjectField are replaced not merged.
  const sparse = []; sparse[2] = 'x';
  const m = new N({ o: { slots: sparse } });
  assert(m.toObject().o.slots.length === 3 && !(0 in m.toObject().o.slots), 'sparse array inside ObjectField was compacted');
  m.updateSource({ 'o.slots': ['a'] });
  assert(m.o.slots.length === 1 && m.o.slots[0] === 'a', 'array inside ObjectField was merged instead of replaced');
  // ArrayField cleans elements and rejects a non-array.
  const af = new ArrayField(new NumberField({ nullable: false, initial: 0 }));
  assert(JSON.stringify(af.clean(['1', 2])) === '[1,2]', 'ArrayField did not clean its elements');
  // The proxy throws on an undeclared member.
  let proxyThrew = false;
  try { void foundry.utils.notARealHelper; } catch (e) { proxyThrew = e instanceof ReferenceError; }
  assert(proxyThrew, 'the declared-surface proxy did not throw on an undeclared member');
}

/**
 * The document half of the self-test (embedded collections, prepareData order,
 * CRUD). Async because the CRUD methods are; the smoke awaits it after install.
 */
export async function runDocumentSelfTest() {
  const order = [];
  CONFIG.Actor.dataModels.__selftest = class extends TypeDataModel {
    static defineSchema() { return { hp: new NumberField({ nullable: false, initial: 3 }) }; }
    prepareBaseData() { order.push('sys.base'); }
    prepareDerivedData() { order.push('sys.derived'); this.items = this.parent.items.size; }
  };
  CONFIG.Item.dataModels.__selftest = class extends TypeDataModel {
    static defineSchema() { return { v: new NumberField({ nullable: false, initial: 1 }) }; }
    prepareDerivedData() { order.push('item.derived'); }
  };
  const actor = new BaseActor({ name: 'T', type: '__selftest', system: { hp: '7', junk: 1 }, items: [{ name: 'I', type: '__selftest', system: { v: '2' } }] });
  actor.prepareData();
  assert(actor.system.hp === 7 && !('junk' in actor.system), 'TypeDataField did not clean through the model');
  assert(actor.items.size === 1 && actor.items.contents[0].system.v === 2 && actor.items.contents[0].actor === actor, 'embedded items not built');
  assert(actor._source.system === actor.system._source, 'system model source is not the document source (Foundry shares them)');
  assert(order.join(',') === 'sys.base,item.derived,sys.derived', `prepareData order was ${order.join(',')}`);
  assert(actor.system.items === 1, 'system.prepareDerivedData could not see items');
  const [created] = await actor.createEmbeddedDocuments('Item', [{ name: 'J', type: '__selftest' }]);
  assert(actor.items.size === 2 && actor.system.items === 2 && actor._source.items.length === 2, 'createEmbeddedDocuments did not update source and re-prepare');
  await actor.updateEmbeddedDocuments('Item', [{ _id: created.id, 'system.v': 9 }]);
  assert(actor.items.get(created.id).system.v === 9 && actor._source.items.find((i) => i._id === created.id).system.v === 9, 'updateEmbeddedDocuments failed');
  await actor.deleteEmbeddedDocuments('Item', [created.id]);
  assert(actor.items.size === 1 && actor._source.items.length === 1, 'deleteEmbeddedDocuments failed');
  await actor.update({ 'system.hp': 1 });
  assert(actor.system.hp === 1 && actor.toObject().system.hp === 1, 'actor.update failed');
  // A hook returning false vetoes the write.
  const vetoId = Hooks.on('preUpdateActor', () => false);
  await actor.update({ 'system.hp': 99 });
  Hooks.off('preUpdateActor', vetoId);
  assert(actor.system.hp === 1, 'a preUpdateActor hook returning false did not veto the update');
  delete CONFIG.Actor.dataModels.__selftest;
  delete CONFIG.Item.dataModels.__selftest;
  return true;
}
