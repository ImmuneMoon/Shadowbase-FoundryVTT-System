// module/engine.mjs
//
// THE ONLY MODULE THAT IMPORTS THE ENGINE BUNDLE (docs/ARCHITECTURE.md §2).
//
// engine/shadowbase-engine.mjs is the website's own engine, bundled by esbuild
// from tools/engine-entry.ts. Every rule, catalog, migration and roll outcome
// the system uses comes through this module; nothing on the Foundry side
// re-implements one. Every other module imports `engine` from here and never
// touches the bundle path, so a bundle rename or a release `--minify` build is
// a one-line change.
//
// Why the polyfill comes BEFORE the import: the website's blank sheet
// (src/lib/templates/custom/blank-sheet-template.ts) mints uuids for its Credit
// Chip and its twelve anatomy rows with `crypto.randomUUID()` at module
// evaluation, and every template spreads that blank sheet. Foundry's browser
// always has `crypto.randomUUID`; a headless Node check (tools/smoke-data-layer
// .mjs) or an older WebView may not, and a bundle that throws on line one is
// indistinguishable from a system that failed to load.

// No Node import here: this file ships to the browser as-is. Node 19+ and every
// secure browser context already expose `globalThis.crypto.randomUUID`; the
// fallback below only fires where `getRandomValues` exists without it.
if (!globalThis.crypto?.randomUUID) {
  const impl = globalThis.crypto;
  // RFC 4122 v4 from getRandomValues, the same shape the website's ids have.
  const rnd = (impl && typeof impl.getRandomValues === 'function')
    ? impl.getRandomValues.bind(impl)
    : (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; };
  const randomUUID = () => {
    const b = rnd(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  Object.defineProperty(globalThis, 'crypto', {
    value: Object.assign(Object.create(impl ?? null), { getRandomValues: rnd, randomUUID }),
    configurable: true, writable: true,
  });
}

const bundle = await import('../engine/shadowbase-engine.mjs');

/**
 * A fresh row id, the way the website mints them (`crypto.randomUUID()`;
 * every inventory row, anatomy row and storage box carries one - see
 * docs/CHARACTER_JSON_FORMAT.md §2.14 "id").
 * @returns {string}
 */
export function rowId() {
  return globalThis.crypto.randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Walk a value and give every `id` that is a uuid a FRESH uuid, keeping every
 * cross-reference in step (a row that named another row's id by any key still
 * names it after the remint). Anatomy rows are referenced by
 * `installedHardwareIds`, the Credit Chip by `storageLocationId`/host ids, so
 * remapping by a shared table rather than per row is the only correct shape.
 * @param {any} value
 * @param {Map<string,string>} map
 */
function remintIds(value, map) {
  if (Array.isArray(value)) return value.map((v) => remintIds(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = remintIds(v, map);
    return out;
  }
  if (typeof value === 'string' && UUID_RE.test(value)) {
    if (!map.has(value)) map.set(value, rowId());
    return map.get(value);
  }
  return value;
}

/**
 * A deep clone of the website's `blankSheetData` with FRESH uuids for every id
 * the blank minted at module evaluation (the Credit Chip equipment row and the
 * twelve STANDARD_HUMANOID_ANATOMY rows). Two actors created from the same
 * bundle must never share a row id, which they would if the blank were handed
 * out by reference: the website re-evaluates the module per page load, Foundry
 * loads the bundle once per session.
 * @returns {import('../engine/shadowbase-engine.mjs').CharacterFormValues}
 */
export function blank() {
  return remintIds(bundle.blankSheetData, new Map());
}

/**
 * A catalog namespace by its entry-point name (`catalog('forcePowers')` is
 * `engine.forcePowers`). Exists so callers that take a catalog NAME (the pack
 * manifest, the sheet's library pickers) fail loudly on a wrong name instead
 * of reading `undefined` as an empty catalog.
 * @param {string} name
 * @returns {object}
 */
export function catalog(name) {
  const ns = bundle[name];
  if (ns === undefined || ns === null || typeof ns !== 'object') {
    throw new Error(`shadowbase engine: no catalog namespace named "${name}" (ARCHITECTURE.md §2 lists the namespaces)`);
  }
  return ns;
}

/**
 * Names of the three flat exports that land with unit U01 (ARCHITECTURE.md
 * §2.1) and are absent from the interim bundle. `requireExport` turns a
 * missing one into a clear error at the CALL SITE rather than a
 * "x is not a function" from inside prepareData.
 */
export const U01_EXPORTS = Object.freeze(['applyLoadMigrations', 'calculateMeleeWeaponStats', 'calculateLightsaberStats']);

/**
 * @param {string} name a flat export name
 * @returns {Function}
 */
export function requireExport(name) {
  const fn = bundle[name];
  if (typeof fn !== 'function') {
    const hint = U01_EXPORTS.includes(name) ? ' (arrives with unit U01; rebuild the engine bundle after the website extraction lands)' : '';
    throw new Error(`shadowbase engine: export "${name}" is missing from engine/shadowbase-engine.mjs${hint}`);
  }
  return fn;
}

/** @param {string} name */
export function hasExport(name) {
  return typeof bundle[name] === 'function';
}

/**
 * The bundle plus the four helpers above, as one object. `engine.getCalculatedStats(sheet)`
 * reads exactly like the website's `getCalculatedStats(values)`.
 */
export const engine = Object.freeze(Object.assign(Object.create(null), bundle, { rowId, blank, catalog, requireExport, hasExport, U01_EXPORTS }));

export default engine;
export * from '../engine/shadowbase-engine.mjs';
