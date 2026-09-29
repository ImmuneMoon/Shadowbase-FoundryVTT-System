#!/usr/bin/env node
// tools/render-tabs-preview.mjs
//
// Render the actor sheet's Body / Abilities / Inventory / Vehicles tabs
// (unit U06) headlessly: a shim-built actor from the corpus, the REAL context
// builders of module/apps/actor-sheet-tabs.mjs, the REAL templates compiled
// with Handlebars in strict + knownHelpersOnly mode (an unregistered helper or
// a missing context key throws instead of rendering blank), the partials
// registered under the paths Foundry's loadTemplates would register them
// under, and the stylesheet inlined so the HTML opens in a browser as-is.
//
// Unit U05's tools/render-preview.mjs renders the whole sheet; until it lands
// this is the tab-level renderer (its `renderTabs` export is meant to be
// folded into that file - the helpers below are the core Foundry helpers the
// templates rely on, with Foundry's own semantics).
//
//   node tools/render-tabs-preview.mjs                       # rokarr, vexKorta, kaelenRarr, assassinDroid, vesselOwnerFixture, sahrhie
//   node tools/render-tabs-preview.mjs --actor vexKorta      # one template key
//   node tools/render-tabs-preview.mjs --fixture export-sahrhie-vosst-2026-09-06   # one fixtures/*.json
//   node tools/render-tabs-preview.mjs --tab inventory       # one tab
//   node tools/render-tabs-preview.mjs --out preview         # output directory (default: preview/ - git-ignore it)
//
// Foundry semantics assumed here and NOT verifiable without a client
// (UNVERIFIED): that HandlebarsApplicationMixin compiles PARTS with Foundry's
// helper set (localize with hash = game.i18n.format; eq/ne/gt/lt/and/or/not;
// checked/disabled emitting the bare attribute) and registers loadTemplates
// paths as partial names verbatim.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);
const Handlebars = require('handlebars');

/** The helpers the tab templates use (a subset of Foundry's HandlebarsHelpers + core Handlebars), with Foundry's semantics. */
export const KNOWN_HELPERS = Object.freeze({ localize: true, eq: true, ne: true, gt: true, lt: true, and: true, or: true, not: true, checked: true, disabled: true });

export function registerHelpers(hb, i18n) {
  hb.registerHelper('localize', function (key, options) {
    const data = options?.hash ?? {};
    return Object.keys(data).length ? i18n.format(key, data) : i18n.localize(key);
  });
  hb.registerHelper('eq', (a, b) => a === b);
  hb.registerHelper('ne', (a, b) => a !== b);
  hb.registerHelper('gt', (a, b) => a > b);
  hb.registerHelper('lt', (a, b) => a < b);
  hb.registerHelper('and', (...args) => args.slice(0, -1).every(Boolean));
  hb.registerHelper('or', (...args) => args.slice(0, -1).some(Boolean));
  hb.registerHelper('not', (v) => !v);
  hb.registerHelper('checked', (v) => (v ? 'checked' : ''));
  hb.registerHelper('disabled', (v) => (v ? 'disabled' : ''));
}

/**
 * The u06 i18n strings while they live in docs/REQUESTS.md (the `u06-i18n`
 * block U05 pastes into lang/en.json). Flattened to dotted keys.
 */
export function pendingU06Translations() {
  const path = join(ROOT, 'docs', 'REQUESTS.md');
  if (!existsSync(path)) return {};
  const md = readFileSync(path, 'utf8');
  // The fence carries the unit id (```json u06-i18n), the convention scripts/check-i18n.mjs and check-templates.mjs read.
  const m = /<!-- u06-i18n:begin -->[\s\S]*?```json[^\n]*\n([\s\S]*?)```[\s\S]*?<!-- u06-i18n:end -->/.exec(md);
  if (!m) return {};
  const flat = {};
  const walk = (o, p) => { for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object') walk(v, key); else flat[key] = v; } };
  try { walk(JSON.parse(m[1]), ''); } catch (err) { throw new Error(`docs/REQUESTS.md u06-i18n block is not valid JSON: ${err.message}`); }
  return flat;
}

/**
 * The sheet's own helper module and named partials (module/helpers/handlebars.mjs, unit U05), when present: the tab
 * templates call `shadowbase.section` / `shadowbase.empty` and `sbIcon`, so the strict render uses the REAL helper set.
 */
export async function sheetHelpers() {
  const path = join(ROOT, 'module', 'helpers', 'handlebars.mjs');
  if (!existsSync(path)) return null;
  return import(pathToFileURL(path).href);
}

/** Compile every tab template and partial in strict mode; returns { templates: { body, abilities, inventory, vehicles }, hb }. */
export async function compileTabTemplates(i18n, tabTemplates) {
  const hb = Handlebars.create();
  registerHelpers(hb, i18n);
  const helpers = await sheetHelpers();
  const known = { ...KNOWN_HELPERS, lookup: true };
  if (helpers) {
    helpers.registerHelpers(hb);
    for (const name of helpers.HELPER_NAMES ?? []) known[name] = true;
  } else {
    // Without U05's module: the two helpers the section heads need, in their documented shape.
    hb.registerHelper('sbIcon', (name) => (typeof name === 'string' && name.startsWith('fa-') ? name : `fa-solid fa-circle`));
    known.sbIcon = true;
  }
  const opts = { strict: true, knownHelpersOnly: true, knownHelpers: known };
  const read = (foundryPath) => readFileSync(join(ROOT, foundryPath.replace(/^systems\/shadowbase\//, '')), 'utf8');
  for (const [name, path] of Object.entries(helpers?.PARTIALS ?? {})) if (existsSync(join(ROOT, path.replace(/^systems\/shadowbase\//, '')))) hb.registerPartial(name, hb.compile(read(path), opts));
  for (const partial of tabTemplates.partials) hb.registerPartial(partial, hb.compile(read(partial), opts));
  const templates = {};
  for (const [tab, path] of Object.entries(tabTemplates.parts)) templates[tab] = hb.compile(read(path), opts);
  return { templates, hb };
}

/**
 * Render the four tabs for a prepared actor. `tabs` is the actor-sheet-tabs module.
 * @returns {Record<'body'|'abilities'|'inventory'|'vehicles', { html: string, context: object }>}
 */
export function renderTabs(actor, tabs, compiled, { only = null } = {}) {
  const builders = { body: tabs.bodyContext, abilities: tabs.abilitiesContext, inventory: tabs.inventoryContext, vehicles: tabs.vehiclesContext };
  const out = {};
  for (const [tab, build] of Object.entries(builders)) {
    if (only && tab !== only) continue;
    // The part context the sheet (U05) merges ours over: ApplicationV2's `tab` entry from _prepareTabs.
    const context = { tab: { id: tab, group: 'primary', cssClass: 'active', active: true }, ...build(actor) };
    out[tab] = { html: compiled.templates[tab](context), context };
  }
  return out;
}

/** A standalone HTML document: the system's stylesheets inlined, dark ground, one tab panel. */
export function wrapDocument(title, bodyHtml) {
  const css = ['variables.css', 'components.css', 'sheet.css', 'sheet-tabs.css'].map((f) => { const p = join(ROOT, 'styles', f); return existsSync(p) ? `/* ${f} */\n${readFileSync(p, 'utf8')}` : ''; }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 1rem; background: #1a1a1a; color: #eee; font: 14px Inter, system-ui, sans-serif; }
/* Fallback tokens so the preview reads before U05's variables.css lands (the website's HSL triplets). */
.shadowbase { --background: 0 0% 10%; --foreground: 0 0% 93%; --card: 0 0% 13%; --primary: 190 90% 55%; --accent: 43 96% 56%; --muted: 0 0% 20%; --muted-foreground: 0 0% 63%; --border: 0 0% 25%; --destructive: 0 84% 60%; --radius: 0.375rem; }
.shadowbase input, .shadowbase select, .shadowbase textarea, .shadowbase button { font: inherit; color: inherit; background: hsl(var(--background) / 0.6); border: 1px solid hsl(var(--border)); border-radius: var(--radius); padding: 0.15rem 0.4rem; }
.shadowbase .sb-btn { cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem; }
.shadowbase .sb-btn-default { background: hsl(var(--primary) / 0.25); border-color: hsl(var(--primary)); }
.shadowbase .sb-btn-destructive { background: hsl(var(--destructive) / 0.2); border-color: hsl(var(--destructive) / 0.6); }
.shadowbase .sb-btn-ghost { background: transparent; border-color: transparent; }
.shadowbase .sb-btn-icon { padding: 0.15rem 0.3rem; }
.shadowbase .sb-badge { display: inline-flex; align-items: center; gap: 0.2rem; padding: 0.05rem 0.4rem; border-radius: 999px; font-size: 0.68rem; font-weight: 600; border: 1px solid hsl(var(--border)); }
.shadowbase .sb-badge-secondary { background: hsl(var(--muted) / 0.6); }
.shadowbase .sb-badge-destructive { border-color: hsl(var(--destructive) / 0.6); color: hsl(var(--destructive)); }
.shadowbase .sb-card { border: 1px solid hsl(var(--border)); border-radius: var(--radius); background: hsl(var(--card)); }
${css}
</style></head><body><div class="shadowbase application">${bodyHtml}</div></body></html>`;
}

/** The corpus entries the unit brief names, by CLI selector. */
export async function defaultCorpus(engine, harness) {
  const list = harness.loadCorpus(engine);
  const want = new Map([
    ['template:rokarr', 'rokarr'], ['template:vexKorta', 'vexKorta'], ['template:kaelenRarr', 'kaelenRarr'], ['template:assassinDroid', 'assassinDroid'],
    ['coverage:vesselOwnerFixture', 'vesselOwnerFixture'], ['export:export-sahrhie-vosst-2026-09-06', 'sahrhie'],
  ]);
  return list.filter((e) => want.has(e.name)).map((e) => ({ ...e, key: want.get(e.name) }));
}

/** The CLI entry; exported so tools/render-preview.mjs --tabs (U05) can delegate to it. */
export async function main() {
  const argv = process.argv.slice(2);
  const value = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
  const outDir = resolve(ROOT, value('--out') ?? 'preview');
  const only = value('--tab');
  const harness = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'harness.mjs')).href);
  const { shim, engine, adapter, translations } = await harness.installSystem({ selfTest: false });
  const pending = pendingU06Translations();
  shim.installFoundryShim({ translations: pending });
  const i18n = globalThis.game.i18n;
  const tabs = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'actor-sheet-tabs.mjs')).href);
  const compiled = await compileTabTemplates(i18n, tabs.TAB_TEMPLATES);
  let entries = await defaultCorpus(engine, harness);
  const actorKey = value('--actor');
  const fixture = value('--fixture');
  if (actorKey) entries = [{ key: actorKey, name: `template:${actorKey}`, sheet: harness.unwrap(engine.characterTemplateStore[actorKey]) }];
  if (fixture) {
    const raw = JSON.parse(readFileSync(join(ROOT, 'fixtures', `${fixture.replace(/\.json$/, '')}.json`), 'utf8'));
    const loaded = engine.loadIncomingSheet(engine.convertJsonToSheet(raw));
    entries = [{ key: basename(fixture, '.json'), name: `export:${fixture}`, sheet: loaded.data }];
  }
  mkdirSync(outDir, { recursive: true });
  const index = [];
  for (const entry of entries) {
    const actor = shim.buildActor(adapter.sheetToActorData(entry.sheet));
    const rendered = renderTabs(actor, tabs, compiled, { only });
    for (const [tab, { html }] of Object.entries(rendered)) {
      const file = `${entry.key}-${tab}.html`;
      writeFileSync(join(outDir, file), wrapDocument(`${actor.name} - ${tab}`, html), 'utf8');
      index.push({ actor: actor.name, tab, file, bytes: html.length });
    }
  }
  writeFileSync(join(outDir, 'index.html'), wrapDocument('ShadowBase tab previews', `<h1>Tab previews</h1><ul>${index.map((i) => `<li><a href="${i.file}">${i.actor} - ${i.tab}</a> <small>(${i.bytes} bytes)</small></li>`).join('')}</ul>`), 'utf8');
  for (const i of index) console.log(`${i.file}: ${i.bytes} bytes`);
  console.log(`wrote ${index.length} previews to ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
