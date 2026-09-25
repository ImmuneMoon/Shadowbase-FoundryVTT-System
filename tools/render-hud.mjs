#!/usr/bin/env node
// tools/render-hud.mjs
//
// Render the Tactical HUD headlessly to a standalone HTML file a human can
// open in a browser (ARCHITECTURE.md §9: rendering itself cannot be verified
// here, but what the templates produce over the REAL _prepareContext of
// module/apps/hud.mjs over a shim-built actor can be looked at). The CSS is
// inlined (styles/variables.css, components.css, hud.css).
//
//   node tools/render-hud.mjs rokarr                # one template key (characterTemplateStore) or fixtures/<file>.json
//   node tools/render-hud.mjs --all                 # Rokarr, Kaelen Rarr, Assassin Droid
//   node tools/render-hud.mjs kaelenRarr --scenario # the Damage Processor open on the Torso, the Handbook at
//                                                   # Ch7 "Hit Locations", a stimulant with phases, a roll history
//   node tools/render-hud.mjs rokarr --out <dir>    # default: <tmp>/shadowbase-preview
//
// The environment (installHudEnvironment) is what scripts/check-hud.mjs uses
// too: the shim proper (tools/foundry-shim.mjs installs unit U05's
// ApplicationV2 / Handlebars layer, tools/foundry-shim-apps.mjs), the system's
// helpers registered on that Handlebars, the HUD's own templates loaded as
// partials, a disk-backed `fetch` for systems/shadowbase/handbook/*, and the
// i18n keys still parked in docs/REQUESTS.md. Unit U05's tools/render-preview.mjs
// (the sheet) is the natural home for this as `--hud` (docs/REQUESTS.md).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installSystem, ROOT, loadCorpus } from '../scripts/lib/harness.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const positional = argv.filter((a) => !a.startsWith('--') && a !== value('--out', null));
const OUT = resolve(value('--out', process.env.SHADOWBASE_PREVIEW_DIR ?? join(tmpdir(), 'shadowbase-preview')));
const SCENARIO = flag('--scenario');
const ALL = flag('--all');

/** A `fetch` that answers `systems/shadowbase/...` from this repo (the handbook JSON). */
export function installDiskFetch(root = ROOT) {
  globalThis.fetch = async (input) => {
    const path = String(input).replace(/\?.*$/, '').replace(/^\/?systems\/shadowbase\//, '');
    const file = join(root, path);
    if (!existsSync(file)) return { ok: false, status: 404, statusText: 'Not Found', json: async () => { throw new Error(`404 ${path}`); }, text: async () => '' };
    const text = readFileSync(file, 'utf8');
    return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(text), text: async () => text };
  };
}

/** The u07-i18n block still parked in docs/REQUESTS.md (until lang/en.json's owner folds it), flattened. */
export function requestBlockTranslations() {
  const file = join(ROOT, 'docs', 'REQUESTS.md');
  if (!existsSync(file)) return {};
  const m = /```json u07-i18n\s*\n([\s\S]*?)\n```/.exec(readFileSync(file, 'utf8'));
  if (!m) return {};
  const flat = (obj, prefix = '') => Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(acc, flat(v, key)); else acc[key] = v;
    return acc;
  }, {});
  return flat(JSON.parse(m[1]));
}

let environment = null;

/**
 * Install everything the HUD needs headlessly; returns the modules. Idempotent.
 *
 * Two adjustments to the layer the shim installs (both recorded in docs/REQUESTS.md):
 *   - templates/chat/* are compiled NON-strict: unit U04's cards omit keys such as `advisories`
 *     on rolls that carry none (check:rolls renders them non-strict too), and a strict compile
 *     would fail an attribute roll's card in the middle of a HUD smoke;
 *   - the HUD's templates are registered as partials by path, as Foundry's loadTemplates does
 *     (the layer's `part.templates` only compiles them).
 */
export async function installHudEnvironment() {
  if (environment) return environment;
  const sys = await installSystem({ selfTest: false });
  // The HUD's keys live in docs/REQUESTS.md until lang/en.json's owner folds them (a key in en.json wins).
  const parked = requestBlockTranslations();
  for (const [k, v] of Object.entries(parked)) if (!(k in globalThis.game.i18n.translations)) globalThis.game.i18n.translations[k] = v;
  installDiskFetch();
  const helpers = await import(pathToFileURL(join(ROOT, 'module', 'helpers', 'handlebars.mjs')).href);
  const Handlebars = globalThis.Handlebars;
  helpers.registerHelpers(Handlebars);
  // The layer compiles non-strict by default (as Foundry does); the HUD's templates are held STRICT here
  // (test-harness digest fact 8), so a missing context key throws instead of rendering an empty string.
  const shimApps = await import(pathToFileURL(join(ROOT, 'tools', 'foundry-shim-apps.mjs')).href);
  shimApps.setRenderStrict?.(true);
  const hb = foundry.applications.handlebars;
  const strictRender = hb.renderTemplate;
  const lenient = new Map();
  hb.renderTemplate = async (path, data) => {
    if (!/\/templates\/chat\//.test(String(path))) return strictRender(path, data);
    if (!lenient.has(path)) lenient.set(path, Handlebars.compile(readFileSync(join(ROOT, String(path).replace(/^systems\/shadowbase\//, '')), 'utf8'), { strict: false, knownHelpersOnly: false }));
    return lenient.get(path)(data ?? {});
  };
  const hudMod = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'hud.mjs')).href);
  const hbMod = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'handbook-browser.mjs')).href);
  for (const path of Object.values(hudMod.HUD_TEMPLATES)) Handlebars.registerPartial(path, hb.getTemplate(path));
  const damageMod = await import(pathToFileURL(join(ROOT, 'module', 'damage.mjs')).href);
  const rollsMod = await import(pathToFileURL(join(ROOT, 'module', 'rolls.mjs')).href);
  environment = { ...sys, Handlebars, helpers, TacticalHud: hudMod.TacticalHud, hudMod, hbMod, damageMod, rollsMod, DialogV2: foundry.applications.api.DialogV2 };
  return environment;
}

/**
 * Dispatch a `data-action` the way Foundry's click listener does: the handler
 * in DEFAULT_OPTIONS.actions (a function, or { handler }) called with `this` =
 * the app and (event, target); `tab` switches the group.
 */
export async function invoke(app, action, dataset = {}) {
  const target = { dataset: { action, ...dataset }, closest: () => target, getAttribute: (k) => dataset[k.replace(/^data-/, '')] ?? null };
  const event = { type: 'click', target, currentTarget: target, preventDefault() {}, stopPropagation() {}, button: 0 };
  if (action === 'tab') { app.changeTab(dataset.tab, dataset.group ?? 'primary'); await app.render(); return { action, handled: 'tab' }; }
  let handler = app.options.actions?.[action];
  if (handler && typeof handler === 'object') handler = handler.handler;
  if (typeof handler !== 'function') return { action, handled: false };
  const result = await handler.call(app, event, target);
  return { action, handled: true, result };
}

/** The form pipeline (tag 'form' + form.handler): a name -> value object as FormDataExtended. */
export async function submit(app, object = {}) {
  const config = app.options.form ?? {};
  if (typeof config.handler !== 'function') throw new Error(`${app.constructor.name}: options.form.handler is not a function`);
  const FormDataExtended = foundry.applications.ux.FormDataExtended;
  const formData = new FormDataExtended({ object });
  const form = { elements: [], dataset: {} };
  const event = { type: 'submit', target: form, preventDefault() {} };
  await config.handler.call(app, event, form, formData);
  return formData.object;
}

/** Build a prepared shim actor from a template key or a fixtures/*.json file. */
export function buildFromKey(env, key) {
  const { engine, shim, adapter } = env;
  const unwrap = (t) => (typeof t?.data === 'function' ? t.data() : (t?.data ?? t));
  let sheet = null;
  let name = key;
  if (engine.characterTemplateStore[key]) {
    const t = engine.characterTemplateStore[key];
    sheet = unwrap(t);
    name = t.name ?? sheet.characterName ?? key;
    if (engine.hasExport('applyLoadMigrations')) sheet = engine.applyLoadMigrations({ ...engine.blank(), ...structuredClone(sheet) }, engine.blankSheetData).data;
  } else {
    const entry = loadCorpus(engine, { templates: false, coverage: false }).find((c) => c.file === key || c.file === `${key}.json` || c.name === key);
    if (!entry) throw new Error(`render-hud: "${key}" is neither a characterTemplateStore key nor a fixtures/*.json file`);
    sheet = entry.sheet;
    name = sheet.characterName ?? key;
  }
  const actor = shim.buildActor(adapter.sheetToActorData(sheet, { actorName: name }));
  globalThis.game.actors.set(actor.id, actor);
  return actor;
}

/** The scenario: something on every tab worth looking at. */
export async function applyScenario(env, hud) {
  const { engine, effects, DialogV2, damageMod } = env;
  const actor = hud.actor;
  // A stimulant with a crash phase on the Status tab (the website's Combat Stimulant shape).
  await effects.addEffect(actor, {
    id: engine.rowId(), name: 'Battle Stim', type: 'buff', source: 'Combat Stimulant', duration: '10 minutes', isManual: true, isGear: false,
    description: '+2 to all weapon skills while it lasts.', modifiers: { ...engine.NO_MODIFIERS, dexterity: 1, endurancePoints: -2 },
    phases: [{ name: 'Battle Stim Crash', type: 'debuff', description: 'The comedown: lose 3 EP now.', duration: 'Recovery Period', modifiers: { endurancePoints: -3, dexterity: -1 } }], phaseIndex: 0,
  });
  // A few rolls into the history and the bell (the prompt answered with modifier 0).
  for (const [action, dataset] of [['roll-dodge', {}], ['roll-attribute', { key: 'dx' }], ['roll-unarmed', { which: 'punch' }]]) {
    DialogV2.queueResponses([{ modifier: 0, offHand: false, rollMode: 'publicroll' }]);
    await invoke(hud, action, dataset);
  }
  // The Damage Processor open on the torso with 8 cutting typed in.
  const torso = damageMod.locationsOf(actor).find((l) => /torso/i.test(l.name)) ?? damageMod.locationsOf(actor)[0];
  if (torso) { hud.setLocalState('damage.locationId', torso.id); hud.setLocalState('damage.amount', 8); hud.setLocalState('damage.damageType', 'cut'); }
  await invoke(hud, 'toggle-history');
  await invoke(hud, 'toggle-bell');
  // The Handbook at Ch7 "Hit Locations" (the combat-damage chip's target).
  await hud.handbook.openAt('ch07-combat', 'Hit Locations', { fromChip: true });
  await hud.render();
}

/** Wrap the six rendered parts in a page with the CSS inlined. */
export function pageHtml(hud, { title }) {
  const css = ['styles/variables.css', 'styles/components.css', 'styles/hud.css'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const parts = hud.parts ?? {};
  const order = ['header', 'tabs', 'actions', 'status', 'handbook', 'footer'];
  const active = hud.tabGroups.primary;
  const body = order.map((p) => parts[p] ?? '').join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
html, body { margin: 0; background: #0b0b0b; color: #ddd; font-family: Inter, system-ui, sans-serif; }
.preview-note { padding: 0.5rem 1rem; font-size: 12px; color: #999; }
.preview-frame { width: 470px; height: 760px; margin: 1rem auto; display: flex; flex-direction: column; border: 1px solid #333; border-radius: 6px; overflow: hidden; resize: both; }
.preview-tabs-note { text-align: center; font-size: 11px; color: #777; }
${css}
</style></head>
<body>
<p class="preview-note">Headless render of the Tactical HUD (tools/render-hud.mjs) — active tab: <b>${active}</b>; click a tab to switch (preview-only script below). Nothing else is live.</p>
<form class="shadowbase sb-hud preview-frame" id="shadowbase-hud-preview">
<div class="sb-hud__content">
${body}
</div>
</form>
<script>
document.querySelectorAll('[data-action="tab"]').forEach((a) => a.addEventListener('click', (ev) => {
  ev.preventDefault();
  const tab = a.dataset.tab;
  document.querySelectorAll('[data-action="tab"]').forEach((x) => x.classList.toggle('active', x === a));
  document.querySelectorAll('.sb-hud__tab').forEach((s) => s.classList.toggle('active', s.dataset.tab === tab));
}));
document.querySelectorAll('button').forEach((b) => b.addEventListener('click', (ev) => ev.preventDefault()));
</script>
</body></html>`;
}

/** Exported so tools/render-preview.mjs --hud can delegate (it passes this file's own argv through). */
export async function main() {
  const env = await installHudEnvironment();
  const keys = ALL ? ['rokarr', 'kaelenRarr', 'assassinDroid'] : positional.length ? positional : ['rokarr'];
  mkdirSync(OUT, { recursive: true });
  for (const key of keys) {
    const actor = buildFromKey(env, key);
    const hud = await env.TacticalHud.open(actor);
    if (SCENARIO) await applyScenario(env, hud);
    const file = join(OUT, `hud-${basename(key, '.json')}${SCENARIO ? '-scenario' : ''}.html`);
    writeFileSync(file, pageHtml(hud, { title: `Tactical HUD — ${actor.name}` }));
    const sizes = Object.entries(hud.parts).map(([p, h]) => `${p} ${h.length}`).join(', ');
    console.log(`${file}\n  ${actor.name}: ${sizes}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
