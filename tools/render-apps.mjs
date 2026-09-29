#!/usr/bin/env node
// tools/render-apps.mjs
//
// Render the sub-apps (unit U09: DroidWorkshop, AnatomyWorkshop, BodyLoadout,
// SuitsAndSets, CraftingApp, DossierImporter) headlessly to standalone HTML
// files a human can open in a browser (ARCHITECTURE.md §9: rendering cannot be
// verified without Foundry, so this is the next best thing - the real classes,
// their real _prepareContext, the real templates and partials, over a
// shim-built actor). The CSS is inlined in system.json order.
//
//   node tools/render-apps.mjs --app droid-workshop --template assassinDroid
//   node tools/render-apps.mjs --app body-loadout --template rokarr
//   node tools/render-apps.mjs --all                # every app over its matching template
//   node tools/render-apps.mjs --app crafting --scenario   # a Blasters forge mid-run (rolls queued)
//   node tools/render-preview.mjs --app <name>       # delegates here (unit U05's renderer)
//
// The environment (installAppsEnvironment) is what scripts/check-apps.mjs uses
// too: the shim proper (tools/foundry-shim.mjs installs the AppV2 / Handlebars
// layer), the system's helpers and partials registered, the app modules
// imported after the globals exist, and the i18n keys still parked in
// docs/REQUESTS.md (the u09-i18n block) laid over lang/en.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installSystem, ROOT, loadCorpus } from '../scripts/lib/harness.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = resolve(value('--out', process.env.SHADOWBASE_PREVIEW_DIR ?? join(tmpdir(), 'shadowbase-preview')));

/** The app name -> { module, export, template key of characterTemplateStore that shows it best }. */
export const APPS = Object.freeze({
  'droid-workshop': { file: 'droid-workshop.mjs', cls: 'DroidWorkshop', template: 'assassinDroid', part: 'workshop' },
  'anatomy-workshop': { file: 'anatomy-workshop.mjs', cls: 'AnatomyWorkshop', template: 'rokarr', part: 'anatomy' },
  'body-loadout': { file: 'body-loadout.mjs', cls: 'BodyLoadout', template: 'rokarr', part: 'loadout' },
  'suits-sets': { file: 'suits-sets.mjs', cls: 'SuitsAndSets', template: 'rokarr', part: 'suits' },
  'crafting': { file: 'crafting.mjs', cls: 'CraftingApp', template: 'kaelenRarr', part: 'crafting' },
  'dossier-importer': { file: 'dossier-importer.mjs', cls: 'DossierImporter', template: null, part: 'dossier' },
});

/** The u09-i18n block still parked in docs/REQUESTS.md (until lang/en.json's owner folds it), flattened. */
export function requestBlockTranslations() {
  const file = join(ROOT, 'docs', 'REQUESTS.md');
  if (!existsSync(file)) return {};
  const m = /```json u09-i18n\s*\n([\s\S]*?)\n```/.exec(readFileSync(file, 'utf8'));
  if (!m) return {};
  const flat = (obj, prefix = '') => Object.entries(obj).reduce((acc, [k, v]) => { const key = prefix ? `${prefix}.${k}` : k; if (v && typeof v === 'object') Object.assign(acc, flat(v, key)); else acc[key] = v; return acc; }, {});
  try { return flat(JSON.parse(m[1])); } catch { return {}; }
}

let environment = null;

/** Install everything the apps need headlessly; returns the modules. Idempotent. */
export async function installAppsEnvironment() {
  if (environment) return environment;
  const sys = await installSystem({ selfTest: false });
  const parked = requestBlockTranslations();
  for (const [k, v] of Object.entries(parked)) if (!(k in globalThis.game.i18n.translations)) globalThis.game.i18n.translations[k] = v;
  sys.sys.registerSheets();
  await sys.sys.registerTemplates();
  const shimApps = await import(pathToFileURL(join(ROOT, 'tools', 'foundry-shim-apps.mjs')).href);
  shimApps.setRenderStrict?.(true);
  // The chat cards (unit U04) are non-strict by design: a roll fired from an app must not fail on its card.
  const Handlebars = globalThis.Handlebars;
  const hb = foundry.applications.handlebars;
  const strictRender = hb.renderTemplate;
  const lenient = new Map();
  hb.renderTemplate = async (path, data) => {
    if (!/\/templates\/chat\//.test(String(path))) return strictRender(path, data);
    if (!lenient.has(path)) lenient.set(path, Handlebars.compile(readFileSync(join(ROOT, String(path).replace(/^systems\/shadowbase\//, '')), 'utf8'), { strict: false, knownHelpersOnly: false }));
    return lenient.get(path)(data ?? {});
  };
  const modules = {};
  for (const [name, spec] of Object.entries(APPS)) modules[name] = await import(pathToFileURL(join(ROOT, 'module', 'apps', spec.file)).href);
  const subApp = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'sub-app.mjs')).href);
  const rollsMod = await import(pathToFileURL(join(ROOT, 'module', 'rolls.mjs')).href);
  const effectsMod = await import(pathToFileURL(join(ROOT, 'module', 'effects.mjs')).href);
  const importExport = await import(pathToFileURL(join(ROOT, 'module', 'import-export.mjs')).href);
  const classes = Object.fromEntries(Object.entries(APPS).map(([name, spec]) => [name, modules[name][spec.cls]]));
  // The tabs open the apps by these names (docs/REQUESTS.md U06 -> U09); module/shadowbase.mjs hangs them at init.
  globalThis.game.shadowbase.apps = { ...(globalThis.game.shadowbase.apps ?? {}), DroidWorkshop: classes['droid-workshop'], AnatomyWorkshop: classes['anatomy-workshop'], BodyLoadout: classes['body-loadout'], SuitsAndSets: classes['suits-sets'], CraftingApp: classes['crafting'], DossierImporter: classes['dossier-importer'] };
  environment = { ...sys, Handlebars, shimApps, modules, classes, subApp, rollsMod, effectsMod, importExport, DialogV2: foundry.applications.api.DialogV2, parked };
  return environment;
}

/** Build a prepared shim actor from a template key or a fixtures/*.json file (through applyLoadMigrations, as the app loads). */
export function buildFromKey(env, key) {
  const { engine, shim, adapter } = env;
  const unwrap = (t) => (typeof t?.data === 'function' ? t.data() : (t?.data ?? t));
  let sheet = null;
  let name = key;
  if (engine.characterTemplateStore[key]) {
    const t = engine.characterTemplateStore[key];
    sheet = unwrap(t);
    name = t.name ?? sheet.characterName ?? key;
    sheet = engine.loadIncomingSheet(structuredClone(sheet)).data;
  } else {
    const entry = loadCorpus(engine, { templates: false, coverage: false }).find((c) => c.file === key || c.file === `${key}.json` || c.name === key);
    if (!entry) throw new Error(`render-apps: "${key}" is neither a characterTemplateStore key nor a fixtures/*.json file`);
    sheet = entry.sheet;
    name = sheet.characterName ?? key;
  }
  const actor = shim.buildActor(adapter.sheetToActorData(sheet, { actorName: name }));
  globalThis.game.actors.set(actor.id, actor);
  return actor;
}

/** Open one app for an actor (the DossierImporter takes none). */
export async function openApp(env, name, actor, options = {}) {
  const Cls = env.classes[name];
  if (!Cls) throw new Error(`render-apps: unknown app "${name}" (${Object.keys(APPS).join(', ')})`);
  return name === 'dossier-importer' ? Cls.open(options) : Cls.open(actor, options);
}

/** A scenario worth looking at for each app (rolls answered deterministically). */
export async function applyScenario(env, name, app) {
  const { DialogV2 } = env;
  const queue = (...totals) => { Roll._queue.length = 0; Roll.queueResults(totals); };
  if (name === 'crafting') {
    // A Blasters forge from the picker needs a design in stock; the scenario runs a swap job instead: two phases, the first rolled.
    await env.classes.crafting.open(app.actor, { item: { name: 'Heuristic Processor', weight: 2, finalWeight: 2 }, category: 'Droid Processor', mode: 'swap' });
    queue(6);
    await app.rollStage();
  }
  if (name === 'suits-sets') { app.picker.selectedId = 'combat-suit'; await app.render(); }
  if (name === 'dossier-importer') {
    const t = env.engine.characterTemplateStore.vexKorta;
    await app.addFiles([{ name: 'vex-korta.json', text: JSON.stringify((() => { const sheet = { ...env.engine.blank(), ...t.data }; return env.engine.convertSheetToJson(sheet, env.engine.getCalculatedStats(sheet)); })()) }, { name: 'broken.json', text: '{ not json' }]);
    await app.planImport();
  }
  DialogV2.queueResponses([]);
}

/** The system's stylesheets, inlined in system.json order. */
export function inlineStyles() {
  const sys = JSON.parse(readFileSync(join(ROOT, 'system.json'), 'utf8'));
  return (sys.styles ?? []).map((p) => { const file = join(ROOT, p); return existsSync(file) ? `/* ---- ${p} ---- */\n${readFileSync(file, 'utf8')}` : `/* ${p}: missing */`; }).join('\n\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Wrap the rendered part in a page with the CSS inlined. */
export function pageHtml(name, app, { title }) {
  const parts = app.parts ?? {};
  const body = Object.values(parts).join('\n');
  const width = app.options?.position?.width ?? 640;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
html, body { margin: 0; background: #0b0b0b; color: #ddd; font-family: Inter, system-ui, sans-serif; }
.preview-note { padding: 0.5rem 1rem; font-size: 12px; color: #999; }
.preview-frame { width: ${width}px; margin: 1rem auto; border: 1px solid #333; border-radius: 6px; overflow: auto; resize: both; max-height: 90vh; }
${inlineStyles()}
</style></head>
<body>
<p class="preview-note">Headless render of ${esc(name)} (tools/render-apps.mjs) over "${esc(title)}". Buttons are inert; the selects do not submit.</p>
<form class="shadowbase sb-app sb-app--${esc(name)} preview-frame"><div class="sb-app__content">
${body}
</div></form>
<script>document.querySelectorAll('button').forEach((b) => b.addEventListener('click', (ev) => ev.preventDefault()));</script>
</body></html>`;
}

export async function main() {
  const env = await installAppsEnvironment();
  const names = flag('--all') ? Object.keys(APPS) : [value('--app', 'droid-workshop')];
  mkdirSync(OUT, { recursive: true });
  const outputs = [];
  for (const name of names) {
    const spec = APPS[name];
    if (!spec) { console.error(`render-apps: unknown app "${name}"`); process.exit(1); }
    const key = value('--template', null) ?? spec.template;
    const actor = key ? buildFromKey(env, key) : null;
    const app = await openApp(env, name, actor);
    if (flag('--scenario')) await applyScenario(env, name, app);
    const title = actor ? actor.name : 'Dossier Importer';
    const file = join(OUT, `app-${name}-${basename(String(key ?? 'gm'), '.json')}${flag('--scenario') ? '-scenario' : ''}.html`);
    writeFileSync(file, pageHtml(name, app, { title }), 'utf8');
    const sizes = Object.entries(app.parts).map(([p, h]) => `${p} ${h.length}`).join(', ');
    console.log(`${file}\n  ${title}: ${sizes}`);
    outputs.push(file);
  }
  return outputs;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
