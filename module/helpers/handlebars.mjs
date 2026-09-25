// module/helpers/handlebars.mjs
//
// The system's Handlebars helpers and the partial preload list (ARCHITECTURE
// §6, unit U05). Two exports the init hook calls:
//
//   registerHelpers(hb)     registers every helper below on the given Handlebars
//                           (the browser global in Foundry; the node package in
//                           the headless checks - same registry, same names);
//   preloadTemplates()      foundry.applications.handlebars.loadTemplates over
//                           PARTIALS, so `{{> "shadowbase.field"}}` resolves.
//
// HELPER_NAMES is the whole helper vocabulary: check:templates compiles every
// template with `knownHelpers` = HELPER_NAMES + Foundry's core helpers and
// `knownHelpersOnly: true`, so a template that names a helper nobody registered
// fails the check instead of rendering an empty string in Foundry.
//
// No rule lives here. The badge list a modifier bag renders as comes from the
// engine's own formatter (engine.modifierChannels.formatModifierChannel - the
// function the website's Active Effects hub and PDF call); the helpers only
// format what they are handed.

import { engine } from '../engine.mjs';
import { ICONS, LUCIDE_FA } from '../config.mjs';

export const SYSTEM_ID = 'shadowbase';
const TEMPLATE_ROOT = `systems/${SYSTEM_ID}/templates`;

/**
 * Partials by NAME -> path. Every `{{> "name"}}` in templates/ names one of
 * these (check:templates pins both directions). Other units add theirs here
 * through docs/REQUESTS.md (U05 owns this file in wave 3; U08 in wave 4).
 */
export const PARTIALS = Object.freeze({
  'shadowbase.field': `${TEMPLATE_ROOT}/partials/field.hbs`,
  'shadowbase.qty': `${TEMPLATE_ROOT}/partials/qty.hbs`,
  'shadowbase.section': `${TEMPLATE_ROOT}/partials/section-head.hbs`,
  'shadowbase.chip': `${TEMPLATE_ROOT}/partials/chip.hbs`,
  'shadowbase.badges': `${TEMPLATE_ROOT}/partials/badges.hbs`,
  'shadowbase.pool': `${TEMPLATE_ROOT}/partials/pool.hbs`,
  'shadowbase.empty': `${TEMPLATE_ROOT}/partials/empty.hbs`,
  'shadowbase.facing-hex': `${TEMPLATE_ROOT}/partials/facing-hex.hbs`,
  'shadowbase.switch': `${TEMPLATE_ROOT}/partials/switch.hbs`,
  'shadowbase.roll-btn': `${TEMPLATE_ROOT}/partials/roll-btn.hbs`,
  // Unit U08 (wave 4 owner of this file): the item sheets' partials (templates/items/partials/*.hbs).
  'shadowbase.item.slot': `${TEMPLATE_ROOT}/items/partials/slot-select.hbs`,
  'shadowbase.item.fitted': `${TEMPLATE_ROOT}/items/partials/fitted-select.hbs`,
  'shadowbase.item.provenance': `${TEMPLATE_ROOT}/items/partials/provenance.hbs`,
  'shadowbase.item.plan': `${TEMPLATE_ROOT}/items/partials/plan.hbs`,
  'shadowbase.item.condition': `${TEMPLATE_ROOT}/items/partials/condition.hbs`,
  'shadowbase.item.tiles': `${TEMPLATE_ROOT}/items/partials/tiles.hbs`,
});

/** Foundry core helpers a template may use (v13 client/apps/handlebars.mjs; the block helpers are Handlebars' own). */
export const CORE_HELPER_NAMES = Object.freeze([
  'localize', 'selectOptions', 'formGroup', 'formInput', 'formField', 'numberFormat', 'timeSince', 'filePicker',
  'concat', 'eq', 'ne', 'lt', 'gt', 'lte', 'gte', 'and', 'or', 'not', 'ifThen', 'checked', 'disabled', 'colorPicker',
  'editor', 'radioBoxes', 'rangePicker', 'select', 'signedString', 'object', 'mergeObject', 'getProperty', 'sort',
  'if', 'unless', 'each', 'with', 'lookup', 'log', 'blockHelperMissing', 'helperMissing',
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Tailwind-style toLocaleString the website uses for figures (thousands separators, up to `dp` decimals). */
export function sbNumber(n, dp = 2) {
  const v = toNum(n);
  if (v === null || !Number.isFinite(v)) return '';
  const digits = isNum(dp) ? dp : 2;
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** "+3" / "-2" / "0" (the website's `sign(n)` in basic-info-section.tsx:457). */
export function sbSigned(n) {
  const v = toNum(n);
  if (v === null || !Number.isFinite(v)) return '';
  return v > 0 ? `+${v}` : String(v);
}

/** A website damage string shown as the sheet shows it ("2d-1"), plus the Foundry translation as a title. */
export function sbDice(str) {
  if (str === null || str === undefined) return '';
  return String(str);
}

/** The FA class for a semantic icon name, a lucide name, or a literal `fa-` class (passed through). */
export function sbIcon(name) {
  if (typeof name !== 'string' || !name) return ICONS.info_;
  if (name.startsWith('fa-')) return name;
  return ICONS[name] ?? LUCIDE_FA[name] ?? name;
}

/**
 * A modifier bag -> the badge list the Active Effects hub renders, through
 * the engine's formatter (modifier-channels.ts formatModifierChannel: numerics
 * signed and uppercased, booleans as their name, multipliers as "×N NAME",
 * identity values skipped). Returns [{ text, positive }] for the badges partial.
 */
export function sbChannel(bag) {
  if (!bag || typeof bag !== 'object') return [];
  const mc = engine.modifierChannels;
  const format = typeof mc?.formatModifierChannel === 'function' ? mc.formatModifierChannel : null;
  const numeric = Array.isArray(mc?.NUMERIC_MODIFIER_CHANNELS) ? mc.NUMERIC_MODIFIER_CHANNELS : Object.keys(engine.NO_MODIFIERS ?? {});
  const boolean = Array.isArray(mc?.BOOLEAN_MODIFIER_CHANNELS) ? mc.BOOLEAN_MODIFIER_CHANNELS : ['frightImmune'];
  const multiplier = Array.isArray(mc?.MULTIPLIER_MODIFIER_CHANNELS) ? mc.MULTIPLIER_MODIFIER_CHANNELS : ['moveMultiplier'];
  const out = [];
  for (const channel of [...numeric, ...boolean, ...multiplier]) {
    const value = bag[channel];
    if (value === undefined || value === null) continue;
    const text = format ? format(channel, value) : null;
    if (!text) continue;
    const positive = multiplier.includes(channel) ? Number(value) >= 1 : typeof value === 'boolean' ? value : Number(value) > 0;
    out.push({ channel, text, positive });
  }
  return out;
}

/** "Level 2" for a numeric level, the string itself otherwise (skill levels are strings on the website). */
export function sbLevelLabel(level) {
  if (level === null || level === undefined || level === '') return '';
  const n = Number(level);
  if (Number.isFinite(n) && String(level).trim() === String(n)) return `Level ${n}`;
  return String(level);
}

/** true when `list` (an array, a Set, or a delimited string) contains `value`. */
export function sbHas(list, value) {
  if (list === null || list === undefined) return false;
  if (Array.isArray(list)) return list.includes(value);
  if (list instanceof Set) return list.has(value);
  if (typeof list === 'string') return list.split(/[;,]/).map((s) => s.trim()).includes(String(value));
  if (typeof list === 'object') return value in list;
  return false;
}

/** The name an embedded row's input binds by: `items.<id>.row.<key>` (the sheet's _processFormData extracts it). */
export function sbRowField(item, key) {
  const id = item?.id ?? item?._id ?? '';
  return `items.${id}.row.${key}`;
}

/** JSON for a data attribute (double quotes escaped by Handlebars' own attribute escaping). */
export function sbJson(v) {
  try { return JSON.stringify(v ?? null); } catch { return 'null'; }
}

/** The helper table: name -> function. Comparison helpers are registered only where the host lacks them (Foundry v13 has eq/ne/gt/lt/and/or/not). */
export const HELPERS = Object.freeze({
  sbIcon,
  sbSigned,
  sbNumber,
  sbDice,
  sbChannel,
  sbLevelLabel,
  sbHas,
  sbRowField,
  sbJson,
  json: sbJson,
  /** default-value helper: {{sbOr a b}} -> the first non-nullish, non-empty-string argument */
  sbOr(...args) { const vals = args.slice(0, -1); return vals.find((v) => v !== null && v !== undefined && v !== '') ?? ''; },
  /** {{sbFixed n 2}} */
  sbFixed(n, dp) { const v = toNum(n); return v === null || !Number.isFinite(v) ? '' : v.toFixed(isNum(dp) ? dp : 2); },
  /** {{sbConcat a b c}} */
  sbConcat(...args) { return args.slice(0, -1).map((v) => (v === null || v === undefined ? '' : String(v))).join(''); },
  /** {{sbPct value min max}} -> 0..100 position on a scale (the alignment slider sits at (value + 100) / 2 %) */
  sbPct(value, min, max) { const v = toNum(value) ?? 0; const lo = toNum(min) ?? 0; const hi = toNum(max) ?? 100; if (hi === lo) return 0; return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)); },
  /** {{sbAdd a b}} for label arithmetic (hexside 0-5 shown as 1-6: facing-hex.tsx asLabel) */
  sbAdd(a, b) { return (toNum(a) ?? 0) + (toNum(b) ?? 0); },
  /** {{sbIsNull v}} - true for null/undefined/'' (a "derive" input) */
  sbIsNull(v) { return v === null || v === undefined || v === ''; },
  /** {{sbPlural n singular plural}} */
  sbPlural(n, singular, plural) { return Number(n) === 1 ? singular : plural; },
  /** {{sbCount list}} */
  sbCount(list) { return Array.isArray(list) ? list.length : list instanceof Set || list instanceof Map ? list.size : list && typeof list === 'object' ? Object.keys(list).length : 0; },
});

/**
 * Comparison/logic/core helpers a bare Handlebars lacks (registered only when
 * absent - Foundry v13 ships its own). A function of the Handlebars instance
 * because `selectOptions` returns a SafeString of THAT instance.
 * @param {typeof import('handlebars')} hb
 */
export const fallbackHelpers = (hb) => ({
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => Number(a) > Number(b),
  lt: (a, b) => Number(a) < Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  and: (...args) => args.slice(0, -1).every(Boolean),
  or: (...args) => args.slice(0, -1).some(Boolean),
  not: (a) => !a,
  concat: (...args) => args.slice(0, -1).join(''),
  localize: function (key, options) {
    const hash = options?.hash ?? {};
    const i18n = globalThis.game?.i18n;
    if (!i18n) return String(key);
    return Object.keys(hash).length ? i18n.format(key, hash) : i18n.localize(key);
  },
  selectOptions: function (choices, options) {
    const hash = options?.hash ?? {};
    const selected = hash.selected;
    const localize = !!hash.localize;
    const blank = hash.blank;
    const entries = Array.isArray(choices) ? choices.map((c) => (typeof c === 'object' && c !== null ? [c.value ?? c.key ?? c, c.label ?? c.value ?? c] : [c, c])) : Object.entries(choices ?? {});
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let html = blank !== undefined ? `<option value="">${esc(blank)}</option>` : '';
    for (const [value, label] of entries) {
      const text = localize ? (globalThis.game?.i18n?.localize?.(label) ?? label) : label;
      const isSel = Array.isArray(selected) ? selected.includes(value) : String(selected) === String(value);
      html += `<option value="${esc(value)}"${isSel ? ' selected' : ''}>${esc(text)}</option>`;
    }
    return new hb.SafeString(html);
  },
  signedString: (n) => sbSigned(n),
  numberFormat: (n, options) => { const dp = options?.hash?.decimals; const v = toNum(n); return v === null ? '' : (isNum(dp) ? v.toFixed(dp) : sbNumber(v)); },
  checked: (v) => (v ? 'checked' : ''),
  disabled: (v) => (v ? 'disabled' : ''),
});

/** The fallback helper names (for the checks' knownHelpers table). */
export const FALLBACK_HELPER_NAMES = Object.freeze(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'and', 'or', 'not', 'concat', 'localize', 'selectOptions', 'signedString', 'numberFormat', 'checked', 'disabled']);

/** Every helper name templates may use (the system's plus core's). */
export const HELPER_NAMES = Object.freeze([...new Set([...Object.keys(HELPERS), ...CORE_HELPER_NAMES, ...FALLBACK_HELPER_NAMES])]);

/**
 * Register the helpers on a Handlebars instance. In Foundry `globalThis.Handlebars`
 * is the browser build (helpers must be registered before the first render);
 * headless callers pass the node package. Idempotent.
 * @param {typeof import('handlebars')} [hb]
 */
export function registerHelpers(hb = globalThis.Handlebars) {
  if (!hb || typeof hb.registerHelper !== 'function') throw new Error('shadowbase: no Handlebars instance to register helpers on');
  for (const [name, fn] of Object.entries(HELPERS)) hb.registerHelper(name, fn);
  const have = hb.helpers ?? {};
  for (const [name, fn] of Object.entries(fallbackHelpers(hb))) if (!(name in have)) hb.registerHelper(name, fn);
  return hb;
}

/**
 * Preload every partial by name through foundry.applications.handlebars.loadTemplates
 * (a Record argument registers each key as a partial name - digest B fact 16).
 * Headless callers get the PARTIALS map back and register the files themselves.
 */
export async function preloadTemplates() {
  const apps = globalThis.foundry?.applications;
  if (apps && typeof apps.handlebars?.loadTemplates === 'function') await apps.handlebars.loadTemplates({ ...PARTIALS });
  return { ...PARTIALS };
}

export default { registerHelpers, preloadTemplates, HELPERS, fallbackHelpers, FALLBACK_HELPER_NAMES, HELPER_NAMES, PARTIALS, CORE_HELPER_NAMES };
