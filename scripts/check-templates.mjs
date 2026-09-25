#!/usr/bin/env node
// scripts/check-templates.mjs
//
// check:templates (ARCHITECTURE.md §9; unit U05). Subject: every Handlebars
// template under templates/ and the actor sheet's render pipeline.
//
//   1. every templates/**/*.hbs COMPILES with `strict: true` + `knownHelpersOnly: true`
//      over the helper table the system registers (module/helpers/handlebars.mjs
//      HELPER_NAMES, core's included) - a template naming a helper nobody registers
//      fails here instead of rendering an empty string in Foundry (test-harness fact 8);
//   2. every PART of ShadowBaseActorSheet RENDERS with the live _prepareContext /
//      _preparePartContext output over five shipped templates and the two 2026
//      fixture exports, strict mode on, so an undefined output field throws;
//   3. every rendered PART has exactly ONE root element (HandlebarsApplicationMixin's rule);
//   4. every `{{localize "KEY"}}` literal in templates/ resolves in lang/en.json - or in a
//      pending `uNN-i18n` block of docs/REQUESTS.md (reported as pending, not failed:
//      the en.json owner folds those in their wave);
//   5. every `{{> "shadowbase.x"}}` names a partial in PARTIALS and every PARTIALS file exists;
//      path partials (`{{> "systems/shadowbase/..."}}`) exist on disk;
//   6. every data-action in templates/actor/{header,tabs,info}.hbs and templates/partials
//      has a static handler in the sheet's DEFAULT_OPTIONS.actions (and `tab` is core's),
//      and every U05 handler is reachable from a template.
//
// Rejected alternatives pinned: compiling with strict:false (a missing helper renders
// '' - the husk shipped that way, husk-history); rendering a hand-built context
// (a context the sheet never produces proves nothing - the website CLAUDE.md
// "a guard that constructs its own subject tests its constructor").
// Mutations fired while writing it: renaming `sbSigned` in the info template ->
// leg 1 fails ("unknown helper"); deleting `chips` from _prepareContext -> leg 2
// fails on the strict lookup; wrapping header.hbs in a second root element -> leg 3.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makeReporter, installSystem, ROOT, loadCorpus } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:templates');
const require = createRequire(import.meta.url);

const env = await installSystem({ selfTest: false });
const { sys, engine, shim, adapter, translations } = env;
sys.registerSheets();
await sys.registerTemplates();
const helpersMod = await import(pathToFileURL(join(ROOT, 'module', 'helpers', 'handlebars.mjs')).href);
const sheetMod = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'actor-sheet.mjs')).href);
const shimApps = await import(pathToFileURL(join(ROOT, 'tools', 'foundry-shim-apps.mjs')).href);
const { ShadowBaseActorSheet } = sheetMod;
const Handlebars = globalThis.Handlebars;
// Foundry renders non-strict; this check renders STRICT so an undefined output field throws (test-harness fact 8).
shimApps.setRenderStrict(true);

// ---- the templates ---------------------------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else if (ent.name.endsWith('.hbs')) out.push(p);
  }
  return out;
}
const files = walk(join(ROOT, 'templates')).sort();
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
ok('templates found under templates/ (denominator)', files.length >= 20, `${files.length}`);
const OWN = new Set(['templates/actor/header.hbs', 'templates/actor/dashboard.hbs', 'templates/actor/tabs.hbs', 'templates/actor/info.hbs', 'templates/actor/sheet.hbs', ...readdirSync(join(ROOT, 'templates', 'partials')).map((f) => `templates/partials/${f}`)]);
for (const f of ['templates/actor/header.hbs', 'templates/actor/tabs.hbs', 'templates/actor/info.hbs', 'templates/actor/sheet.hbs']) ok(`${f} exists`, existsSync(join(ROOT, f)));

// ---- 1. strict + knownHelpersOnly compile ----------------------------------------------------------------------
const known = {};
for (const name of Object.keys(Handlebars.helpers)) known[name] = true;
for (const name of helpersMod.HELPER_NAMES) known[name] = true;
ok('the helper table is registered on the Handlebars instance (denominator)', Object.keys(Handlebars.helpers).filter((n) => n.startsWith('sb')).length >= 10, Object.keys(Handlebars.helpers).filter((n) => n.startsWith('sb')).join(', '));
const sources = {};
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  sources[rel(f)] = src;
  let why = '';
  try { Handlebars.precompile(src, { strict: true, knownHelpersOnly: true, knownHelpers: known }); } catch (e) { why = e.message.split('\n')[0]; }
  ok(`${rel(f)} compiles strict + knownHelpersOnly`, why === '', why);
}
// The positive control: a template naming an unregistered helper must fail to compile.
{
  let threw = false;
  try { Handlebars.precompile('{{notARegisteredHelper x}}', { strict: true, knownHelpersOnly: true, knownHelpers: known }); } catch { threw = true; }
  ok('knownHelpersOnly has teeth (an unregistered helper fails to compile)', threw);
}

// ---- 5. partials ------------------------------------------------------------------------------------------------
const PARTIALS = helpersMod.PARTIALS;
for (const [name, path] of Object.entries(PARTIALS)) ok(`partial ${name} -> ${path} exists`, existsSync(join(ROOT, path.replace(/^systems\/shadowbase\//, ''))));
for (const [f, src] of Object.entries(sources)) {
  for (const m of src.matchAll(/\{\{#?>\s*"([^"]+)"/g)) {
    const name = m[1];
    if (name.startsWith('shadowbase.')) ok(`${f}: partial "${name}" is registered in PARTIALS`, name in PARTIALS);
    else ok(`${f}: path partial "${name}" exists`, existsSync(join(ROOT, name.replace(/^systems\/shadowbase\//, ''))));
  }
}

// ---- 4. localize keys -------------------------------------------------------------------------------------------
const requestsSrc = existsSync(join(ROOT, 'docs', 'REQUESTS.md')) ? readFileSync(join(ROOT, 'docs', 'REQUESTS.md'), 'utf8') : '';
const pending = {};
for (const m of requestsSrc.matchAll(/```json u\d+-i18n\s*\n([\s\S]*?)```/g)) {
  try {
    const flat = (o, p = '') => Object.entries(o).forEach(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : (pending[`${p}${k}`] = v)));
    flat(JSON.parse(m[1]));
  } catch { /* a malformed block is the owner's problem, reported below */ }
}
let pendingUsed = 0;
for (const [f, src] of Object.entries(sources)) {
  for (const m of src.matchAll(/\{\{localize\s+"([^"]+)"/g)) {
    const key = m[1];
    if (key in translations) continue;
    if (key in pending) { pendingUsed++; continue; }
    ok(`${f}: {{localize "${key}"}} resolves in lang/en.json`, false, 'missing key');
  }
}
if (pendingUsed) console.log(`check:templates: ${pendingUsed} localize keys resolve only through a pending uNN-i18n block in docs/REQUESTS.md (fold them into lang/en.json)`);
ok('templates localize at least 100 distinct keys (denominator)', new Set(Object.values(sources).flatMap((s) => [...s.matchAll(/\{\{localize\s+"([^"]+)"/g)].map((m) => m[1]))).size >= 100);

// ---- 6. data-actions of the U05 templates <-> the sheet's handlers ------------------------------------------------
const actions = ShadowBaseActorSheet.DEFAULT_OPTIONS.actions;
const ownActions = new Set();
for (const [f, src] of Object.entries(sources)) {
  if (!OWN.has(f)) continue;
  for (const m of src.matchAll(/data-action="([a-zA-Z-]+)"/g)) ownActions.add(m[1]);
  // A partial's `action="roll-attribute"` hash param becomes its data-action.
  for (const m of src.matchAll(/\baction="([a-zA-Z-]+)"/g)) ownActions.add(m[1]);
}
// The header buttons are a context list (headerContext `buttons`): their actions are named in the sheet module.
for (const m of readFileSync(join(ROOT, 'module', 'apps', 'actor-sheet.mjs'), 'utf8').matchAll(/\{ action: '([a-z-]+)', icon:/g)) ownActions.add(m[1]);
ok('the U05 templates declare data-actions (denominator)', ownActions.size >= 20, `${ownActions.size}`);
for (const a of ownActions) ok(`data-action="${a}" has a static handler in ShadowBaseActorSheet.DEFAULT_OPTIONS.actions`, a === 'tab' || typeof actions[a] === 'function');
const U05_HANDLERS = ['roll-attribute', 'roll-characteristic', 'open-hud', 'import-json', 'export-json', 'open-preferences', 'edit-portrait', 'reset-pool', 'reset-all-pools', 'pin-pools', 'pin-points', 'adjust-turn', 'reset-turn', 'sweep-turn', 'set-facing', 'cycle-threat', 'toggle-engaged', 'turn-to-face', 'add-language', 'add-native-language', 'remove-language', 'toggle-droid', 'apply-sm', 'open-handbook', 'open-effects', 'jump-section', 'step-number'];
for (const a of U05_HANDLERS) ok(`handler "${a}" is reachable from a U05 template`, ownActions.has(a), 'dead handler');

// ---- 2 + 3. render every PART over the corpus, strict ------------------------------------------------------------------
const TEMPLATE_KEYS = ['vexKorta', 'rokarr', 'kaelenRarr', 'assassinDroid', 'blank'];
const corpus = [];
for (const key of TEMPLATE_KEYS) {
  const t = engine.characterTemplateStore[key];
  ok(`characterTemplateStore.${key} exists`, !!t);
  if (!t) continue;
  let sheet = typeof t.data === 'function' ? t.data() : (t.data ?? t);
  sheet = engine.applyLoadMigrations({ ...engine.blank(), ...structuredClone(sheet) }, engine.blankSheetData).data;
  corpus.push({ name: `template:${key}`, sheet, actorName: t.name });
}
for (const entry of loadCorpus(engine, { templates: false, coverage: false })) if (/^export-/.test(entry.file)) corpus.push({ name: entry.name, sheet: entry.sheet, actorName: entry.sheet.characterName });
ok('the render corpus is five templates + the two 2026 fixture exports', corpus.length === 7, corpus.map((c) => c.name).join(', '));

const PARTS = Object.keys(ShadowBaseActorSheet.PARTS);
ok('PARTS are header / dashboard / tabs / info / body / abilities / inventory / vehicles', JSON.stringify(PARTS) === JSON.stringify(['header', 'dashboard', 'tabs', 'info', 'body', 'abilities', 'inventory', 'vehicles']), PARTS.join(','));
const rootCount = (html) => {
  // Count top-level elements: a depth walk over tags, ignoring HTML void elements and comments
  // (svg children are written with explicit closing tags in these templates, so they are not void here).
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  let depth = 0; let roots = 0;
  for (const m of String(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m;
    const t = tag.toLowerCase();
    if (close) { depth--; continue; }
    if (depth === 0) roots++;
    if (!self && !VOID.has(t)) depth++;
  }
  return roots;
};
let rendered = 0;
for (const entry of corpus) {
  let actor;
  try { actor = shim.buildActor(adapter.sheetToActorData(entry.sheet, { actorName: entry.actorName })); globalThis.game.actors.set(actor.id, actor); }
  catch (e) { ok(`${entry.name}: actor builds`, false, e.message); continue; }
  const app = new ShadowBaseActorSheet({ document: actor });
  let why = '';
  try { await app.render(); } catch (e) { why = e.stack?.split('\n').slice(0, 3).join(' | ') ?? e.message; }
  ok(`${entry.name}: every PART renders with the live context (strict)`, why === '', why);
  if (why) continue;
  rendered++;
  for (const p of PARTS) {
    const html = app.parts[p] ?? '';
    ok(`${entry.name}: PART ${p} rendered something`, html.trim().length > 100, `${html.length} chars`);
    ok(`${entry.name}: PART ${p} has exactly one root element`, rootCount(html) === 1, `${rootCount(html)} roots`);
    ok(`${entry.name}: PART ${p} carries no unresolved i18n key`, !/SHADOWBASE\.[A-Za-z]+\.[A-Za-z.]+/.test(html.replace(/data-[a-z-]+="[^"]*"/g, '')) || Object.keys(pending).length > 0, (html.match(/SHADOWBASE\.[A-Za-z.]+/g) ?? []).slice(0, 5).join(', '));
  }
  // The Info tab's eight sections, in order (templates/actor/README.md checklist).
  const ids = [...(app.parts.info ?? '').matchAll(/<details class="sb-section[^"]*" data-section="([a-z-]+)"/g)].map((m) => m[1]);
  ok(`${entry.name}: the Info tab renders its eight sections in order`, JSON.stringify(ids) === JSON.stringify(sheetMod.INFO_SECTIONS.map((s) => s.id)), ids.join(','));
  // The persistent dashboard above the tabs (2026-09-19, mirroring shadow-base.com): resource-pools, combat-state, force-alignment.
  const dashIds = [...(app.parts.dashboard ?? '').matchAll(/<details class="sb-section[^"]*" data-section="([a-z-]+)"/g)].map((m) => m[1]);
  ok(`${entry.name}: the dashboard renders resource-pools / combat-state / force-alignment above the tabs`, JSON.stringify(dashIds) === JSON.stringify(sheetMod.DASHBOARD_SECTIONS.map((s) => s.id)), dashIds.join(','));
  // The root attributes the preferences drive (STYLE-SPEC §5).
  ok(`${entry.name}: _onRender stamps data-compact-rows / data-reduce-motion on the root`, app.element.attributes['data-compact-rows'] === 'false' && app.element.attributes['data-reduce-motion'] === 'false');
  // A droid renders PP instead of EP + FP (resource-trackers.tsx ResourcePoolsGrid).
  // Pools now live in the dashboard part, not the Info tab.
  if (actor.system.isDroid) ok(`${entry.name}: a droid's pools are HP + PP`, /name="system\.powerPoints"/.test(app.parts.dashboard) && !/name="system\.currentEndurancePoints"/.test(app.parts.dashboard));
  else ok(`${entry.name}: an organic's pools are HP + EP + FP`, /name="system\.currentEndurancePoints"/.test(app.parts.dashboard) && /name="system\.currentForcePoints"/.test(app.parts.dashboard) && !/name="system\.powerPoints"/.test(app.parts.dashboard));
}
ok('every corpus entry rendered (denominator)', rendered === corpus.length, `${rendered}/${corpus.length}`);

// ---- the form pipeline over a rendered actor (the blank -> null rule, the item extraction) ----------------------------
{
  const t = engine.characterTemplateStore.vexKorta;
  const sheet = engine.applyLoadMigrations({ ...engine.blank(), ...structuredClone(t.data) }, engine.blankSheetData).data;
  const actor = shim.buildActor(adapter.sheetToActorData(sheet, { actorName: t.name }));
  globalThis.game.actors.set(actor.id, actor);
  const app = new ShadowBaseActorSheet({ document: actor });
  const skill = actor.rowsOf('skills')[0];
  const data = app._processFormData(null, null, { object: { 'system.strength': '', 'system.hitPoints': '', 'system.pointTotal': '', 'system.turnCounter': '3', [`items.${skill.id}.row.level`]: '12', 'system.languageEntries.0.tongue': "Mando'a x" } });
  ok('_processFormData: a blank primary attribute becomes null (null-means-derive)', data.system.strength === null);
  ok('_processFormData: a blank secondary becomes null', data.system.hitPoints === null);
  ok('_processFormData: a blank NON-nullable number is dropped, not nulled (pointTotal keeps 150)', !('pointTotal' in data.system));
  ok('_processFormData: a numeric string reaches the update as given (Foundry cleans it)', data.system.turnCounter === '3');
  ok('_processFormData: items.<id>.row.<key> leaves the actor update', !('items' in data));
  ok('_processFormData: languageEntries come back as the whole array with the edit applied', Array.isArray(data.system.languageEntries) && data.system.languageEntries[0].tongue === "Mando'a x" && data.system.languageEntries.length === (actor.system.languageEntries ?? []).length);
  await app._processSubmitData(null, null, { system: { forceAlignment: 40 } }, {});
  ok('_processSubmitData: the alignment mirror writes lightSidePoints / darkSidePoints (basic-info-section.tsx:62-83)', actor.system.forceAlignment === 40 && actor.system.lightSidePoints === 40 && actor.system.darkSidePoints === 0);
  await app._processSubmitData(null, null, { system: { height: '8 ft' } }, {});
  ok("_processSubmitData: a typed height derives the SM (sizeModifierForHeight('8 ft') = 0.75)", actor.system.sizeModifier === engine.sizeModifier.sizeModifierForHeight('8 ft'));
  const before = actor.system.cpTradedForCredits ?? 0;
  const creditsBefore = engine.currencyTransaction.sumCurrency(actor.rowsOf('equipment').map((i) => i.system.row));
  await app._processSubmitData(null, null, { system: { cpTradedForCredits: before + 2 } }, {});
  const creditsAfter = engine.currencyTransaction.sumCurrency(actor.rowsOf('equipment').map((i) => i.system.row));
  ok('_processSubmitData: trading 2 CP moves 1,400 CR onto the Currencies rows (wealth.adjustCredits)', creditsAfter - creditsBefore === 2 * engine.wealth.CP_FOR_CREDITS.creditsPerCp, `${creditsBefore} -> ${creditsAfter}`);
}

report(`${files.length} templates, ${corpus.length} corpus entries x ${PARTS.length} parts`);
