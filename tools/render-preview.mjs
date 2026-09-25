#!/usr/bin/env node
// tools/render-preview.mjs
//
// Render the WHOLE actor sheet headlessly to one standalone HTML file a human
// can open in a browser (ARCHITECTURE.md §9: rendering cannot be verified
// without Foundry, so this is the next best thing - the real
// ShadowBaseActorSheet class, its real _prepareContext / _preparePartContext,
// the real templates and partials, over a shim-built actor).
//
//   node tools/render-preview.mjs                       # vexKorta
//   node tools/render-preview.mjs --template rokarr     # any characterTemplateStore key
//   node tools/render-preview.mjs --fixture export-sahrhie-vosst-2026-09-06.json
//   node tools/render-preview.mjs --hud                 # delegates to tools/render-hud.mjs (U07) when present
//   node tools/render-preview.mjs --tabs                # delegates to tools/render-tabs-preview.mjs (U06) when present
//   node tools/render-preview.mjs --item blaster        # U08: one item sheet of that type (every tab stacked)
//   node tools/render-preview.mjs --item all            # every Item type, one page each (owned rows first, else a pack document)
//   node tools/render-preview.mjs --item armor --template kaelenRarr --index 1   # the owner's second armor row
//   node tools/render-preview.mjs --settings            # U10: the settings panel as Foundry lists it + the root attributes
//   node tools/render-preview.mjs --out <dir>           # default: <repo>/preview/ (git-ignored; SHADOWBASE_PREVIEW_DIR overrides)
//
// The page inlines every stylesheet system.json lists (in order, so the
// cascade is the one Foundry applies) and links Font Awesome 6 Free from cdnjs
// for the glyphs. Prints the output path and each PART's rendered size.
// --app delegates to tools/render-apps.mjs (unit U09).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installSystem, ROOT, loadCorpus } from '../scripts/lib/harness.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };

export const OUT_DIR = resolve(value('--out', process.env.SHADOWBASE_PREVIEW_DIR ?? join(ROOT, 'preview')));
const FA_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';

/** Build a prepared shim actor from a characterTemplateStore key or a fixtures/*.json file (through applyLoadMigrations, as the app loads). */
export function buildActorFrom(env, { template, fixture }) {
  const { engine, shim, adapter } = env;
  let sheet;
  let name;
  if (fixture) {
    const entry = loadCorpus(engine, { templates: false, coverage: false }).find((c) => c.file === fixture || c.file === `${fixture}.json` || c.name === fixture);
    if (!entry) throw new Error(`render-preview: no fixtures/${fixture}`);
    sheet = entry.sheet;
    name = sheet.characterName ?? fixture;
  } else {
    const t = engine.characterTemplateStore[template];
    if (!t) throw new Error(`render-preview: "${template}" is not a characterTemplateStore key (${Object.keys(engine.characterTemplateStore).slice(0, 8).join(', ')} ...)`);
    sheet = typeof t.data === 'function' ? t.data() : (t.data ?? t);
    name = t.name ?? sheet.characterName ?? template;
    if (engine.hasExport('applyLoadMigrations')) sheet = engine.applyLoadMigrations({ ...engine.blank(), ...structuredClone(sheet) }, engine.blankSheetData).data;
  }
  const actor = shim.buildActor(adapter.sheetToActorData(sheet, { actorName: name }));
  globalThis.game.actors.set(actor.id, actor);
  return actor;
}

/** The system's stylesheets, inlined in system.json order. */
export function inlineStyles() {
  const sys = JSON.parse(readFileSync(join(ROOT, 'system.json'), 'utf8'));
  return (sys.styles ?? []).map((p) => {
    const file = join(ROOT, p);
    return existsSync(file) ? `/* ---- ${p} ---- */\n${readFileSync(file, 'utf8')}` : `/* ${p}: missing */`;
  }).join('\n\n');
}

/** Render every PART of the sheet and compose templates/actor/sheet.hbs around them. */
export async function renderSheetPage(env, actor, { title } = {}) {
  const { sys } = env;
  const { ShadowBaseActorSheet, sheetPrefs } = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'actor-sheet.mjs')).href);
  const app = new ShadowBaseActorSheet({ document: actor });
  await app.render();
  const hb = globalThis.foundry.applications.handlebars;
  const composed = await hb.renderTemplate('systems/shadowbase/templates/actor/sheet.hbs', { parts: app.parts, prefs: sheetPrefs() });
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title ?? actor.name)} - ShadowBase sheet preview</title>
<link rel="stylesheet" href="${FA_CDN}">
<style>
html, body { margin: 0; background: #0b0b0b; color: #ddd; font-family: Inter, system-ui, sans-serif; }
.preview-frame { max-width: 960px; margin: 1.5rem auto; }
.preview-note { max-width: 960px; margin: 0.5rem auto; font-size: 11px; color: #888; }
/* the tab panels are all shown here, stacked, since nothing switches them headlessly */
.preview-frame .sb-sheet .tab { display: block !important; overflow: visible; border-top: 2px dashed #333; }
.preview-frame .sb-sheet .tab::before { content: attr(data-tab); display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #666; margin-bottom: .5rem; }
${inlineStyles()}
</style>
</head>
<body>
<p class="preview-note">Headless render of module/apps/actor-sheet.mjs over "${escapeHtml(actor.name)}" (tools/render-preview.mjs). Every tab panel is stacked; in Foundry only the active one shows.</p>
<div class="preview-frame">
${composed}
</div>
</body>
</html>`;
  return { app, page, sizes: Object.fromEntries(Object.entries(app.parts).map(([p, h]) => [p, h.length])) };
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------------------------------------------------------------------------
// --item (unit U08): one item sheet, every PART stacked, over a real row
// ---------------------------------------------------------------------------

/**
 * The Item to render for a type: the owner's row of that type (the corpus actor of --template / --fixture, or the
 * first corpus actor that carries one), else a document of the type's compendium pack (packs-src/), created unowned.
 */
export async function findItemFor(env, type, { template, fixture, index = 0 } = {}) {
  const { engine, shim, adapter } = env;
  const { ITEM_TYPES } = await import(pathToFileURL(join(ROOT, 'module', 'config.mjs')).href);
  if (!ITEM_TYPES[type]) throw new Error(`render-preview: "${type}" is not an Item type (${Object.keys(ITEM_TYPES).join(', ')})`);
  const candidates = [];
  if (template || fixture) candidates.push({ template: template ?? undefined, fixture: fixture ?? undefined });
  candidates.push({ template: 'rokarr' }, { template: 'kaelenRarr' }, { template: 'vexKorta' }, { template: 'hkAssassinDroid' });
  for (const c of candidates) {
    let actor;
    try { actor = buildActorFrom(env, c); } catch { continue; }
    const items = actor.items.filter((i) => i.type === type);
    if (items[index]) return { item: items[index], actor, from: c.fixture ?? c.template };
  }
  // The coverage fixtures (starships, vehicles, implants, limbs, upgrades) through the harness.
  for (const entry of loadCorpus(engine, { templates: false, exports: false })) {
    const actor = shim.buildActor(adapter.sheetToActorData(entry.sheet, { actorName: entry.name }));
    globalThis.game.actors.set(actor.id, actor);
    const items = actor.items.filter((i) => i.type === type);
    if (items[index]) return { item: items[index], actor, from: entry.name };
  }
  // A pack document, unowned (the compendium view).
  const { readdirSync } = await import('node:fs');
  const packsDir = join(ROOT, 'packs-src');
  for (const pack of readdirSync(packsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(join(packsDir, pack.name)).filter((n) => n.endsWith('.json')).sort()) {
      const doc = JSON.parse(readFileSync(join(packsDir, pack.name, f), 'utf8'));
      if (!doc._key?.startsWith('!items!') || doc.type !== type) continue;
      const { _key, _id, ...data } = doc;
      const item = await globalThis.Item.create(data);
      return { item, actor: null, from: `pack:${pack.name}` };
    }
  }
  throw new Error(`render-preview: no ${type} row in the corpus and no ${type} document in packs-src`);
}

/** Render every PART of an item's sheet (the real class from module/apps/item-sheets) into one standalone page. */
export async function renderItemPage(env, item, { from = '' } = {}) {
  const { ITEM_SHEETS } = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'item-sheets', 'index.mjs')).href);
  const Cls = ITEM_SHEETS[item.type];
  const app = new Cls({ document: item });
  await app.render();
  const parts = Object.entries(app.parts).map(([id, html]) => html).join('\n');
  const title = `${item.name} (${item.type})`;
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - ShadowBase item sheet preview</title>
<link rel="stylesheet" href="${FA_CDN}">
<style>
html, body { margin: 0; background: #0b0b0b; color: #ddd; font-family: Inter, system-ui, sans-serif; }
.preview-frame { max-width: 760px; margin: 1.5rem auto; }
.preview-note { max-width: 760px; margin: 0.5rem auto; font-size: 11px; color: #888; }
/* every tab stacked, since nothing switches them headlessly */
.preview-frame .sb-item-tab { display: block !important; overflow: visible; border-top: 2px dashed #333; }
.preview-frame .sb-item-tab::before { content: attr(data-tab); display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #666; margin-bottom: .5rem; }
${inlineStyles()}
</style>
</head>
<body>
<p class="preview-note">Headless render of module/apps/item-sheets/${escapeHtml(Cls.FAMILY)}.mjs over "${escapeHtml(item.name)}" (${escapeHtml(item.type)}${from ? `, from ${escapeHtml(from)}` : ''}) - tools/render-preview.mjs --item. Every tab is stacked; in Foundry only the active one shows.</p>
<div class="preview-frame">
<div class="shadowbase sheet item sb-item-sheet themed theme-dark"><div class="window-content"><form>
${parts}
</form></div></div>
</div>
</body>
</html>`;
  return { app, page, sizes: Object.fromEntries(Object.entries(app.parts).map(([p, h]) => [p, h.length])) };
}

// ---------------------------------------------------------------------------
// --settings (unit U10): the settings panel over the real declarations
// ---------------------------------------------------------------------------

/**
 * One standalone page: every registered setting the way Foundry's Configure
 * Settings panel lists it (localized name and hint from lang/en.json, the
 * scope, the control with its default), then the root attributes the client
 * preferences stamp on every .shadowbase window (module/settings.mjs
 * preferenceAttributes) and the stylesheet rules that read them - so a human
 * can compare the panel and the attribute table against Foundry's.
 */
export async function renderSettingsPage(env) {
  const settingsMod = await import(pathToFileURL(join(ROOT, 'module', 'settings.mjs')).href);
  const { SETTINGS, SETTING_KEYS, PREFERENCE_ATTRIBUTES } = settingsMod;
  const loc = (k) => globalThis.game.i18n.localize(k);
  const registered = globalThis.game.settings._registered ?? {};
  const rows = SETTING_KEYS.map((key) => {
    const d = SETTINGS[key];
    const reg = registered[`shadowbase.${key}`];
    const control = d.choices
      ? `<select name="${key}" disabled>${Object.keys(d.choices).map((v) => `<option${Number(v) === d.default ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>`
      : `<input type="checkbox" name="${key}"${d.default ? ' checked' : ''} disabled>`;
    return `<div class="form-group sb-setting" data-scope="${d.scope}">
  <label>${escapeHtml(loc(d.name))}<span class="sb-badge-outline sb-setting__scope">${d.scope}${d.reserved ? ' · reserved' : ''}</span></label>
  <div class="form-fields">${control}</div>
  <p class="hint">${escapeHtml(loc(d.hint))}${reg ? '' : ' <em>(NOT registered)</em>'}</p>
</div>`;
  }).join('\n');
  const attrs = settingsMod.preferenceAttributes();
  const cssSrc = ['styles/sheet.css', 'styles/components.css'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const attrRows = Object.entries(PREFERENCE_ATTRIBUTES).map(([key, attr]) => {
    const rules = [...cssSrc.matchAll(new RegExp(`\\.shadowbase\\[${attr}="(true|false)"\\][^{]*`, 'g'))].map((m) => m[0].trim()).slice(0, 4);
    return `<tr><td><code>${key}</code></td><td><code>${attr}="${attrs[attr]}"</code></td><td>${rules.length ? rules.map((r) => `<code>${escapeHtml(r)}</code>`).join('<br>') : '<em>context only (Info tab / section memory)</em>'}</td></tr>`;
  }).join('\n');
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShadowBase settings - preview</title>
<link rel="stylesheet" href="${FA_CDN}">
<style>
html, body { margin: 0; background: #0b0b0b; color: #ddd; font-family: Inter, system-ui, sans-serif; }
.preview-frame { max-width: 760px; margin: 1.5rem auto; }
.preview-note { max-width: 760px; margin: 0.5rem auto; font-size: 11px; color: #888; }
.sb-setting { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 1rem; padding: 0.6rem 0; border-bottom: 1px solid #222; }
.sb-setting label { font-weight: 600; }
.sb-setting .form-fields { text-align: right; }
.sb-setting .hint { grid-column: 1 / -1; margin: 0; font-size: 12px; color: #999; }
.sb-setting__scope { margin-left: 0.5rem; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; padding: 0.1rem 0.4rem; border: 1px solid #444; border-radius: 3px; color: #aaa; }
.sb-setting[data-scope="world"] .sb-setting__scope { border-color: #7a5a2f; color: #d9b36c; }
table.sb-attrs { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 1rem; }
table.sb-attrs td, table.sb-attrs th { border-bottom: 1px solid #222; padding: 0.35rem 0.5rem; vertical-align: top; text-align: left; }
${inlineStyles()}
</style>
</head>
<body>
<p class="preview-note">Headless render of module/settings.mjs (tools/render-preview.mjs --settings): the ${SETTING_KEYS.length} declarations as Configure Settings lists them, then the root attributes every .shadowbase window carries.</p>
<div class="preview-frame shadowbase">
<h2>ShadowBase — Configure Settings</h2>
${rows}
<h3>Root preference attributes (defaults)</h3>
<table class="sb-attrs"><thead><tr><th>setting</th><th>attribute on every <code>.shadowbase</code> root</th><th>stylesheet rules that read it</th></tr></thead><tbody>
${attrRows}
</tbody></table>
</div>
</body>
</html>`;
  return { page, count: SETTING_KEYS.length };
}

async function renderItems(env, types, { template, fixture, index }) {
  mkdirSync(OUT_DIR, { recursive: true });
  const outs = [];
  for (const type of types) {
    const { item, from } = await findItemFor(env, type, { template, fixture, index });
    const { page, sizes } = await renderItemPage(env, item, { from });
    const out = join(OUT_DIR, `item-${type}.html`);
    writeFileSync(out, page, 'utf8');
    console.log(`${out}  (${from}: "${item.name}")`);
    console.log('  parts: ' + Object.entries(sizes).map(([p, n]) => `${p} ${n}`).join(', '));
    outs.push(out);
  }
  return outs;
}

export async function main() {
  if (flag('--hud')) {
    const file = join(ROOT, 'tools', 'render-hud.mjs');
    if (!existsSync(file)) { console.error('render-preview: --hud needs tools/render-hud.mjs (unit U07)'); process.exit(1); }
    const mod = await import(pathToFileURL(file).href);
    return typeof mod.main === 'function' ? mod.main() : null;
  }
  if (flag('--tabs')) {
    const file = join(ROOT, 'tools', 'render-tabs-preview.mjs');
    if (!existsSync(file)) { console.error('render-preview: --tabs needs tools/render-tabs-preview.mjs (unit U06)'); process.exit(1); }
    const mod = await import(pathToFileURL(file).href);
    return typeof mod.main === 'function' ? mod.main() : null;
  }
  if (flag('--app')) {
    // Unit U09's sub-apps (tools/render-apps.mjs reads --app <name> / --all / --template / --scenario / --out itself).
    const file = join(ROOT, 'tools', 'render-apps.mjs');
    if (!existsSync(file)) { console.error('render-preview: --app needs tools/render-apps.mjs (unit U09)'); process.exit(1); }
    const mod = await import(pathToFileURL(file).href);
    return typeof mod.main === 'function' ? mod.main() : null;
  }
  const env = await installSystem({ selfTest: false });
  env.sys.registerSheets();
  await env.sys.registerTemplates();
  if (flag('--settings')) {
    const { page, count } = await renderSettingsPage(env);
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, 'settings.html');
    writeFileSync(out, page, 'utf8');
    console.log(`${out}  (${count} settings)`);
    return out;
  }
  if (flag('--item')) {
    const which = value('--item', 'all');
    const { ITEM_TYPE_NAMES } = await import(pathToFileURL(join(ROOT, 'module', 'config.mjs')).href);
    const types = which === 'all' ? [...ITEM_TYPE_NAMES] : which.split(',');
    return renderItems(env, types, { template: value('--template', null), fixture: value('--fixture', null), index: Number(value('--index', 0)) || 0 });
  }
  const template = value('--template', 'vexKorta');
  const fixture = value('--fixture', null);
  const actor = buildActorFrom(env, { template, fixture });
  const { page, sizes } = await renderSheetPage(env, actor);
  mkdirSync(OUT_DIR, { recursive: true });
  const name = fixture ? basename(fixture, '.json') : template;
  const out = join(OUT_DIR, `${name}-sheet.html`);
  writeFileSync(out, page, 'utf8');
  console.log(out);
  console.log('parts: ' + Object.entries(sizes).map(([p, n]) => `${p} ${n}`).join(', '));
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
