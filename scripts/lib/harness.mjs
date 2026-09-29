// scripts/lib/harness.mjs
//
// What every check:* script needs and none should re-implement: the headless
// Foundry (tools/foundry-shim.mjs) installed with lang/en.json, the system
// registered exactly as its init hook registers it, the corpus loaded THROUGH
// the load-time transforms (the website CLAUDE.md: "read the corpus through
// the transform"), a stable serialiser that masks uuids, and the ok/report
// pair every check prints with.
//
// Nothing here asserts anything about the system; a check's subject and pins
// stay in the check.

import { createRequire } from 'node:module';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { WEB } from '../../tools/website-path.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
export { WEB };

/** Create the assertion pair for one check. `ok` counts every call; `report` exits. */
export function makeReporter(name) {
  const problems = [];
  let checked = 0;
  const ok = (label, cond, detail) => {
    checked++;
    if (!cond) problems.push(`${label}${detail ? ` - ${detail}` : ''}`);
    return !!cond;
  };
  const fail = (msg) => { console.error(`${name} FAILED - ${msg}`); process.exit(1); };
  const report = (summary) => {
    if (problems.length) {
      console.error(`${name} FAILED (${problems.length} of ${checked} assertions):`);
      for (const p of problems) console.error('  - ' + p);
      process.exit(1);
    }
    console.log(`${name} OK - ${checked} assertions${summary ? `, ${summary}` : ''}`);
  };
  return { ok, fail, report, problems, count: () => checked };
}

const flatten = (obj, prefix = '') => Object.entries(obj).reduce((acc, [k, v]) => {
  const key = prefix ? `${prefix}.${k}` : k;
  if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(acc, flatten(v, key)); else acc[key] = v;
  return acc;
}, {});

/** lang/en.json flattened to dotted keys (what game.i18n.localize resolves). */
export function loadTranslations() {
  return flatten(JSON.parse(readFileSync(join(ROOT, 'lang', 'en.json'), 'utf8')));
}

let installed = null;

/**
 * Install the shim and register the system the way module/shadowbase.mjs's
 * init hook does. Idempotent. Returns the shim module, the system modules and
 * the translations.
 */
export async function installSystem({ selfTest = true } = {}) {
  if (installed) return installed;
  const shim = await import(pathToFileURL(join(ROOT, 'tools', 'foundry-shim.mjs')).href);
  const translations = loadTranslations();
  shim.installFoundryShim({ translations, selfTest });
  const sys = await import(pathToFileURL(join(ROOT, 'module', 'shadowbase.mjs')).href);
  sys.registerDataLayer();
  sys.registerHooks();
  const { engine } = await import(pathToFileURL(join(ROOT, 'module', 'engine.mjs')).href);
  const adapter = await import(pathToFileURL(join(ROOT, 'module', 'adapter.mjs')).href);
  const effects = await import(pathToFileURL(join(ROOT, 'module', 'effects.mjs')).href);
  const config = await import(pathToFileURL(join(ROOT, 'module', 'config.mjs')).href);
  const generated = await import(pathToFileURL(join(ROOT, 'module', 'data', 'actor-schema.generated.mjs')).href);
  installed = { shim, sys, engine, adapter, effects, config, generated, translations };
  return installed;
}

/** A template store entry's sheet (the store holds `{ data }` wrappers on some builds). */
export const unwrap = (t) => (typeof t?.data === 'function' ? t.data() : (t?.data ?? t));

/** The website's jiti loader, the way scripts/check-engine-parity.mjs builds it. */
export function websiteJiti() {
  if (!existsSync(join(WEB, 'node_modules', 'jiti'))) return null;
  const require = createRequire(join(WEB, 'package.json'));
  return require('jiti')(join(WEB, 'package.json'), { alias: { '@': join(WEB, 'src') }, interopDefault: true, esmResolve: true });
}

/**
 * The corpus: the 65 shipped templates, the website's coverage fixtures
 * (scripts/fixtures/vessel-coverage.ts - the only sheets with starships,
 * vehicles, implants, limbs), and every fixtures/*.json of this repo imported
 * the way the website imports a file: convertJsonToSheet, spread over the
 * blank sheet, then applyLoadMigrations (when the bundle carries it - unit
 * U01). Each entry: { name, kind: 'template'|'coverage'|'export', sheet, raw?, file? }.
 */
export function loadCorpus(engine, { templates = true, coverage = true, exports = true } = {}) {
  const corpus = [];
  if (templates) {
    for (const key of Object.keys(engine.characterTemplateStore)) {
      corpus.push({ name: `template:${key}`, kind: 'template', sheet: unwrap(engine.characterTemplateStore[key]) });
    }
  }
  if (coverage) {
    const jiti = websiteJiti();
    const fixturePath = join(WEB, 'scripts', 'fixtures', 'vessel-coverage.ts');
    if (jiti && existsSync(fixturePath)) {
      const fx = jiti(fixturePath);
      for (const [key, entry] of Object.entries(fx)) {
        if (/Fixture$/.test(key) && entry && typeof entry === 'object' && !Array.isArray(entry)) {
          corpus.push({ name: `coverage:${key}`, kind: 'coverage', sheet: unwrap(entry) });
        }
      }
    }
  }
  if (exports) {
    const dir = join(ROOT, 'fixtures');
    if (existsSync(dir)) {
      const migrate = engine.hasExport?.('applyLoadMigrations') ? engine.applyLoadMigrations : null;
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        const converted = { ...engine.blankSheetData, ...engine.convertJsonToSheet(raw) };
        const loaded = migrate ? migrate(converted, engine.blankSheetData) : { data: converted, notices: [] };
        corpus.push({ name: `export:${basename(f, '.json')}`, kind: 'export', file: f, raw, sheet: loaded.data, notices: loaded.notices, migrated: !!migrate });
      }
    }
  }
  return corpus;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable, uuid-masked, key-sorted form of a value (Maps/Sets/NaN survive). */
export const stable = (v) => {
  if (v instanceof Map) return { __map: [...v.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, x]) => [k, stable(x)]) };
  if (v instanceof Set) return { __set: [...v].map(stable) };
  if (Array.isArray(v)) return Array.from(v, (x) => stable(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  if (typeof v === 'number' && Number.isNaN(v)) return '__NaN';
  if (typeof v === 'string' && UUID.test(v)) return '<uuid>';
  return v;
};
export const ser = (v) => JSON.stringify(stable(v));
