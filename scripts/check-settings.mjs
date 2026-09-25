#!/usr/bin/env node
// check:settings
//
// SUBJECT: module/settings.mjs (docs/ARCHITECTURE.md §6.7 "SHADOWBASE.Settings.*",
// unit U10) and the three readers it feeds: module/rolls.mjs#rollHistoryDepth,
// module/apps/hud.mjs#notificationDepth / the settings gear, and
// module/apps/actor-sheet.mjs#sheetPrefs / the preferences dialog / the root
// attributes - all driven headlessly through tools/foundry-shim.mjs (whose
// `game.settings` keeps a registration table and throws on an unregistered
// read, as Foundry does) over shim-built actors.
//
// Pinned, each against the code path it protects:
//   - DECLARATIONS: registered at init (installSystem -> registerDataLayer ->
//     registerSettings): the three world keys (enforceEconomy reserved off,
//     npcDefaultHidden on, tokenRotationSync off) and the nine client
//     preferences; every client default and both depth lists EQUAL the
//     website's use-sheet-preferences.ts DEFAULTS / ROLL_HISTORY_DEPTHS /
//     NOTIFICATION_DEPTHS, read from the website SOURCE (the rejected
//     alternative - a Foundry default typed from memory - is how a player's
//     roll log would keep a different depth on each client); registration is
//     idempotent (Foundry throws on a duplicate; the harness calls init twice);
//   - i18n: every Name / Hint key is in lang/en.json and every
//     SHADOWBASE.Settings.* key there is a declaration's (or the directory
//     entry) - no dead keys;
//   - READS: rolls.rollHistoryDepth() answers the setting (10, then 25 once
//     written) and falls back to 10 for a value off the list; the HUD's
//     notificationDepth() follows (12 -> 25) and its pin cap is depth - 1; the
//     guarded readers never throw;
//   - ROOT ATTRIBUTES (use-sheet-preferences.ts syncRootAttributes, widened):
//     the sheet's root carries data-compact-rows / data-reduce-motion /
//     data-point-costs / data-handbook-chips / data-sticky-headers /
//     data-remember-sections after render, and follows a changed setting on
//     the next render; sheetPrefs() lets the SETTING win over a stale user
//     flag; the preferences dialog (open-preferences with a queued DialogV2
//     answer) writes game.settings, keeps the pins on the flag, and
//     setPreferences writes only the keys that changed;
//   - TOKEN ROTATION (world setting off by default): a facing change writes
//     nothing while off; on, facing 2 turns the actor's tokens to 120 degrees
//     and a repeat writes nothing (idempotent); a token turned to 300 writes
//     facing 5 back, 305 rounds to the same hexside and writes nothing, the
//     mirror's own option skips, another client's update skips; the two hooks
//     are installed by registerSettingsHooks (dispatched through Hooks);
//   - IMPORTER: module/apps/dossier-importer.mjs gates its hidden-ownership pin
//     on npcDefaultHidden() (pinned by source; check:apps drives the write);
//   - SOURCE: module/shadowbase.mjs carries no TODO(U10), calls
//     registerSettings() from registerDataLayer and registerSettingsHooks()
//     from registerHooks, hangs game.shadowbase.settings; rolls.mjs and hud.mjs
//     keep their try/catch reads.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - module/settings.mjs: rollHistoryDepth default 10 -> 20 -> "client defaults equal the website's"
//     AND "rollHistoryDepth() is 10 by default"
//   - module/settings.mjs: registerSettingsHooks without the updateToken hook -> "a token turned by hand
//     writes the nearest hexside back (dispatched through Hooks)"
//   - module/settings.mjs: applyPreferenceAttributes skipping data-compact-rows -> "the sheet root follows
//     compactRows on the next render"
//
//   node scripts/check-settings.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, ROOT, WEB, installSystem, loadTranslations } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:settings');

const env = await installSystem({ selfTest: false });
const { sys, engine, adapter, shim } = env;
sys.registerSheets();
await sys.registerTemplates();
const settingsMod = await import(pathToFileURL(join(ROOT, 'module', 'settings.mjs')).href);
const { settings, SETTINGS, SETTING_KEYS, PREFERENCE_KEYS, PREFERENCE_ATTRIBUTES, SYNC_OPTION } = settingsMod;
const rolls = await import(pathToFileURL(join(ROOT, 'module', 'rolls.mjs')).href);
const hud = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'hud.mjs')).href);
const sheetMod = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'actor-sheet.mjs')).href);
const shimApps = await import(pathToFileURL(join(ROOT, 'tools', 'foundry-shim-apps.mjs')).href);
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const gs = globalThis.game.settings;
const get = (k) => gs.get('shadowbase', k);
const set = (k, v) => gs.set('shadowbase', k, v);

// ---- 1. declarations --------------------------------------------------------------------------------------
const EXPECTED = {
  enforceEconomy: { scope: 'world', type: Boolean, default: false },
  npcDefaultHidden: { scope: 'world', type: Boolean, default: true },
  tokenRotationSync: { scope: 'world', type: Boolean, default: false },
  showHandbookChips: { scope: 'client', type: Boolean, default: true },
  showPointCosts: { scope: 'client', type: Boolean, default: true },
  compactRows: { scope: 'client', type: Boolean, default: false },
  stickySectionHeaders: { scope: 'client', type: Boolean, default: true },
  reduceMotion: { scope: 'client', type: Boolean, default: false },
  rememberOpenSections: { scope: 'client', type: Boolean, default: false },
  applyPosture: { scope: 'client', type: Boolean, default: true },
  trackElevation: { scope: 'client', type: Boolean, default: true },
  keepRollHistory: { scope: 'client', type: Boolean, default: true },
  rollHistoryDepth: { scope: 'client', type: Number, default: 10, choices: [10, 25, 50, 100] },
  notificationDepth: { scope: 'client', type: Number, default: 12, choices: [12, 25, 50] },
};
ok('the fourteen settings are declared, in the panel order', SETTING_KEYS.join(',') === Object.keys(EXPECTED).join(','), SETTING_KEYS.join(','));
for (const [key, exp] of Object.entries(EXPECTED)) {
  const reg = gs._registered[`shadowbase.${key}`];
  ok(`${key} is registered at init with scope ${exp.scope}, type ${exp.type.name}, default ${exp.default}`, !!reg && reg.scope === exp.scope && reg.type === exp.type && reg.default === exp.default && reg.config === true && reg.name === SETTINGS[key].name && reg.hint === SETTINGS[key].hint, reg ? `${reg.scope}/${reg.type?.name}/${reg.default}` : 'unregistered');
  if (exp.choices) ok(`${key} offers the choices ${exp.choices.join('/')}`, reg && Object.keys(reg.choices ?? {}).join(',') === exp.choices.join(','), JSON.stringify(reg?.choices));
  else ok(`${key} offers no choices`, !reg?.choices);
  ok(`${key}: a preference declares an onChange, a world setting none`, exp.scope === 'client' ? typeof reg?.onChange === 'function' : reg?.onChange === undefined);
}
ok('enforceEconomy is marked reserved and nothing outside settings.mjs reads it', SETTINGS.enforceEconomy.reserved === true && !/enforceEconomy\(\)/.test(src('module/combat.mjs') + src('module/rolls.mjs') + src('module/apps/hud.mjs')));
const before = Object.keys(gs._registered).length;
settingsMod._resetRegistration();
settingsMod.registerSettings();
ok('registerSettings is idempotent (a second init registers nothing new)', Object.keys(gs._registered).length === before, `${before} -> ${Object.keys(gs._registered).length}`);

// the website source pin
const prefsFile = join(WEB, 'src', 'hooks', 'use-sheet-preferences.ts');
ok('the website preferences module exists (denominator)', existsSync(prefsFile), prefsFile);
const prefsSrc = existsSync(prefsFile) ? readFileSync(prefsFile, 'utf8') : '';
const defaultsBlock = /const DEFAULTS: SheetPreferences = \{([\s\S]*?)\};/.exec(prefsSrc)?.[1] ?? '';
const websiteDefaults = Object.fromEntries([...defaultsBlock.matchAll(/(\w+):\s*([^,\n]+),/g)].map((m) => [m[1], m[2].trim() === 'true' ? true : m[2].trim() === 'false' ? false : Number(m[2])]));
ok('the website DEFAULTS block parsed (12 keys)', Object.keys(websiteDefaults).length === 12, Object.keys(websiteDefaults).join(','));
for (const key of PREFERENCE_KEYS) ok(`client default ${key} equals the website's (${websiteDefaults[key]})`, key in websiteDefaults && SETTINGS[key].default === websiteDefaults[key], `${SETTINGS[key].default} vs ${websiteDefaults[key]}`);
ok('showFloatingHudButton is the one website preference NOT registered (no floating furniture in Foundry)', 'showFloatingHudButton' in websiteDefaults && !('showFloatingHudButton' in SETTINGS));
const depths = (name) => (new RegExp(`${name} = \\[([^\\]]+)\\]`).exec(prefsSrc)?.[1] ?? '').split(',').map((s) => Number(s.trim()));
ok("ROLL_HISTORY_DEPTHS equal the website's", depths('ROLL_HISTORY_DEPTHS').join(',') === settingsMod.ROLL_HISTORY_DEPTHS.join(','), depths('ROLL_HISTORY_DEPTHS').join(','));
ok("NOTIFICATION_DEPTHS equal the website's", depths('NOTIFICATION_DEPTHS').join(',') === settingsMod.NOTIFICATION_DEPTHS.join(','), depths('NOTIFICATION_DEPTHS').join(','));
ok("the HUD's own depth lists are the settings module's", hud.ROLL_HISTORY_DEPTHS.join(',') === settingsMod.ROLL_HISTORY_DEPTHS.join(',') && hud.NOTIFICATION_DEPTHS.join(',') === settingsMod.NOTIFICATION_DEPTHS.join(','));

// ---- 2. i18n ------------------------------------------------------------------------------------------------
const translations = loadTranslations();
for (const key of SETTING_KEYS) {
  ok(`${key}: Name and Hint are in lang/en.json`, typeof translations[SETTINGS[key].name] === 'string' && typeof translations[SETTINGS[key].hint] === 'string' && translations[SETTINGS[key].hint].length > 20);
}
const declaredKeys = new Set(SETTING_KEYS.flatMap((k) => [SETTINGS[k].name, SETTINGS[k].hint]).concat(['SHADOWBASE.Settings.OpenHud']));
const dead = Object.keys(translations).filter((k) => k.startsWith('SHADOWBASE.Settings.') && !declaredKeys.has(k));
ok('no dead SHADOWBASE.Settings.* key in en.json', dead.length === 0, dead.join(', '));

// ---- 3. reads ------------------------------------------------------------------------------------------------
ok('rollHistoryDepth() is 10 by default', rolls.rollHistoryDepth() === 10 && settings.rollHistoryDepth() === 10);
await set('rollHistoryDepth', 25);
ok('rollHistoryDepth() follows the setting (25)', rolls.rollHistoryDepth() === 25 && settings.rollHistoryDepth() === 25);
await set('rollHistoryDepth', 7);
ok('a depth off the list falls back to the default (7 -> 10 through coerce)', settings.rollHistoryDepth() === 10);
await set('rollHistoryDepth', 10);
ok('notificationDepth() is 12 by default and the pin cap 11', hud.notificationDepth() === 12 && hud.maxPinned() === 11 && settings.notificationDepth() === 12);
await set('notificationDepth', 25);
ok('notificationDepth() follows the setting (25) and the cap is 24', hud.notificationDepth() === 25 && hud.maxPinned() === 24);
await set('notificationDepth', 12);
ok('the world defaults read back: enforceEconomy false, npcDefaultHidden true, tokenRotationSync false, keepRollHistory true', settings.enforceEconomy() === false && settings.npcDefaultHidden() === true && settings.tokenRotationSync() === false && settings.keepRollHistory() === true);
ok('coerce: booleans from "on"/"true"/1, a listed depth as a number, an unknown string as the default', settingsMod.coerce(SETTINGS.compactRows, 'on') === true && settingsMod.coerce(SETTINGS.compactRows, 'false') === false && settingsMod.coerce(SETTINGS.rollHistoryDepth, '50') === 50 && settingsMod.coerce(SETTINGS.rollHistoryDepth, 'lots') === 10);
{
  // the guarded readers under a game without settings
  const saved = globalThis.game.settings;
  globalThis.game.settings = undefined;
  let threw = false;
  let a, b, c;
  try { a = rolls.rollHistoryDepth(); b = hud.notificationDepth(); c = settings.npcDefaultHidden(); } catch { threw = true; }
  globalThis.game.settings = saved;
  ok('the readers never throw without game.settings and answer the declared defaults', !threw && a === 10 && b === 12 && c === true);
}

// ---- 4. root attributes ------------------------------------------------------------------------------------------
const rokarr = engine.characterTemplateStore.rokarr;
const sheet = engine.applyLoadMigrations({ ...engine.blank(), ...structuredClone(rokarr.data) }, engine.blankSheetData).data;
const actor = shim.buildActor(adapter.sheetToActorData(sheet, { actorName: rokarr.name }));
globalThis.game.actors.set(actor.id, actor);
const ATTRS = ['data-compact-rows', 'data-reduce-motion', 'data-point-costs', 'data-handbook-chips', 'data-sticky-headers', 'data-remember-sections'];
ok('PREFERENCE_ATTRIBUTES maps the six CSS-read attributes (styles/sheet.css, components.css)', Object.values(PREFERENCE_ATTRIBUTES).sort().join(',') === [...ATTRS].sort().join(','), Object.values(PREFERENCE_ATTRIBUTES).join(','));
const cssSrc = src('styles/sheet.css') + src('styles/components.css');
for (const attr of ['data-compact-rows', 'data-reduce-motion', 'data-point-costs', 'data-handbook-chips', 'data-sticky-headers']) ok(`${attr} is read by a stylesheet under .shadowbase`, new RegExp(`\\.shadowbase\\[${attr}=`).test(cssSrc));
const defaults = settings.preferenceAttributes();
ok('the default attributes are the website defaults (compact false, motion false, costs true, chips true, sticky true, remember false)', defaults['data-compact-rows'] === 'false' && defaults['data-reduce-motion'] === 'false' && defaults['data-point-costs'] === 'true' && defaults['data-handbook-chips'] === 'true' && defaults['data-sticky-headers'] === 'true' && defaults['data-remember-sections'] === 'false', JSON.stringify(defaults));
const el = new shimApps.ShimElement('');
settings.applyPreferenceAttributes(el);
ok('applyPreferenceAttributes stamps all six on an element', ATTRS.every((a) => el.getAttribute(a) !== null));
const { ShadowBaseActorSheet, sheetPrefs } = sheetMod;
const app = new ShadowBaseActorSheet({ document: actor });
await app.render();
ok('the rendered sheet root carries the six attributes', ATTRS.every((a) => app.element?.getAttribute(a) !== null) && app.element.getAttribute('data-compact-rows') === 'false');
await set('compactRows', true);
await app.render();
ok('the sheet root follows compactRows on the next render', app.element.getAttribute('data-compact-rows') === 'true');
// a stale pre-wave-5 user flag must not win over the setting
globalThis.game.user.flags = { shadowbase: { sheetPrefs: { compactRows: false, showPointCosts: false, pinPools: true } } };
const merged = sheetPrefs();
ok('sheetPrefs(): the settings win over a stale flag; the pins come from the flag', merged.compactRows === true && merged.showPointCosts === true && merged.pinPools === true && merged.rememberOpenSections === false);
delete globalThis.game.user.flags;
await set('compactRows', false);
// the preferences dialog writes the settings
const DialogV2 = foundry.applications.api.DialogV2;
DialogV2.queueResponses([{ showHandbookChips: 'on', showPointCosts: false, compactRows: 'on', stickySectionHeaders: 'on', reduceMotion: 'on', rememberOpenSections: 'on' }]);
await app.invokeAction('open-preferences');
ok('the preferences dialog writes game.settings (compactRows / reduceMotion / rememberOpenSections on, showPointCosts off)', get('compactRows') === true && get('reduceMotion') === true && get('rememberOpenSections') === true && get('showPointCosts') === false && get('showHandbookChips') === true);
ok('and the re-rendered root shows it', app.element.getAttribute('data-compact-rows') === 'true' && app.element.getAttribute('data-point-costs') === 'false' && app.element.getAttribute('data-remember-sections') === 'true');
const wrote = await settings.setPreferences({ compactRows: true, reduceMotion: false, bogus: 1 });
ok('setPreferences writes only the keys that changed (reduceMotion), ignores unknown keys', wrote.join(',') === 'reduceMotion' && get('reduceMotion') === false);
for (const k of PREFERENCE_KEYS) await set(k, SETTINGS[k].default);
ok('openShadowbaseRoots is empty under the shim (no foundry.applications.instances) and refreshPreferenceRoots is a no-op', settings.openShadowbaseRoots().length === 0 && settings.refreshPreferenceRoots('compactRows') === 0);

// ---- 4b. applyPosture / trackElevation re-derive on change (the 2026-09-19 Ch9 feature) ----------------------------
// applyPosture and trackElevation are the ONLY two preferences read INSIDE prepareDerivedData (actor-character.mjs
// passes them to getCalculatedStats), so their effect is baked into the cached actor.system.derived. A bare
// re-render would paint the STALE cache; refreshPreferenceRoots must re-derive the actor first. Driven through a
// real ShadowBaseActorSheet registered in an injected foundry.applications.instances (the shim declares none by
// default - see the no-op assertion above). MUTATION: drop the `prepareData()` call from refreshPreferenceRoots
// (render-only, the reviewed bug) and the "Current Dodge is now fresh" pin below goes red.
{
  const postureActor = shim.buildActor(adapter.sheetToActorData({ ...sheet, posture: 'crawling' }, { actorName: 'Posture Probe' }));
  globalThis.game.actors.set(postureActor.id, postureActor);
  const dodgeOf = () => postureActor.system.derived?.currentEncumbrance?.dodge;
  await set('applyPosture', true);
  postureActor.prepareData();
  const applied = dodgeOf();
  await set('applyPosture', false);
  postureActor.prepareData();
  const unapplied = dodgeOf();
  await set('applyPosture', true);
  postureActor.prepareData();
  ok('crawling posture moves the derived Current Dodge when applyPosture is on vs off (a meaningful probe)', Number.isFinite(applied) && Number.isFinite(unapplied) && applied !== unapplied && dodgeOf() === applied, `${applied} (applied) vs ${unapplied} (unapplied)`);

  const postureApp = new ShadowBaseActorSheet({ document: postureActor });
  await postureApp.render();
  const savedInstances = 'instances' in foundry.applications ? foundry.applications.instances : undefined;
  foundry.applications.instances = new Map([[postureApp.id, postureApp]]);
  try {
    await set('applyPosture', false); // the setter alone does NOT re-derive (this is the reviewed bug scenario)
    ok('a setting flip alone leaves the cached Current Dodge stale (still the applied value)', dodgeOf() === applied);
    ok('openShadowbaseRoots now sees the injected .shadowbase actor sheet', settings.openShadowbaseRoots().length === 1);
    const touched = settings.refreshPreferenceRoots('applyPosture');
    await new Promise((r) => setTimeout(r, 0)); // let the (unawaited) render settle
    ok('refreshPreferenceRoots(applyPosture) re-derives before rendering, so Current Dodge is now the un-applied value, not the stale one', touched === 1 && dodgeOf() === unapplied, `dodge ${dodgeOf()}, expected ${unapplied}`);
    await set('applyPosture', true);
    settings.refreshPreferenceRoots('trackElevation'); // trackElevation takes the same re-derive path
    await new Promise((r) => setTimeout(r, 0));
    ok('refreshPreferenceRoots(trackElevation) also re-derives (applyPosture back on -> Current Dodge returns to the applied value)', dodgeOf() === applied);
  } finally {
    if (savedInstances === undefined) delete foundry.applications.instances; else foundry.applications.instances = savedInstances;
    await set('applyPosture', SETTINGS.applyPosture.default);
    globalThis.game.actors.delete(postureActor.id);
  }
}

// ---- 5. token rotation ---------------------------------------------------------------------------------------------
ok('rotationForFacing: 0..5 -> 0..300, wraps, rejects a non-integer', [0, 1, 2, 3, 4, 5].map(settings.rotationForFacing).join(',') === '0,60,120,180,240,300' && settings.rotationForFacing(6) === 0 && settings.rotationForFacing(-1) === 300 && settings.rotationForFacing('x') === null);
ok('facingForRotation: nearest hexside, 30 degrees either side, wraps', [0, 29, 31, 120, 300, 329, 331, 359, 720].map(settings.facingForRotation).join(',') === '0,0,1,2,5,5,0,0,0' && settings.facingForRotation(NaN) === null);
const writes = [];
const tok = { rotation: 0, async update(data, options) { Object.assign(this, data); writes.push({ data, options }); return this; } };
actor.getActiveTokens = () => [tok];
await actor.update({ 'system.facing': 2 });
ok('tokenRotationSync off (default): a facing change writes no token', writes.length === 0 && actor.system.facing === 2);
await set('tokenRotationSync', true);
await actor.update({ 'system.facing': 1 });
ok('on: facing 1 turns the token to 60 degrees with the mirror option set', writes.length === 1 && tok.rotation === 60 && writes[0].options[SYNC_OPTION] === true);
await actor.update({ 'system.facing': 1 });
await actor.update({ 'system.turnCounter': 3 });
ok('a repeat of the same facing, or an unrelated update, writes nothing (idempotent)', writes.length === 1);
const turnedDirect = await settings.onUpdateActorFacing(actor, { system: { facing: 1 } }, { [SYNC_OPTION]: true }, globalThis.game.userId);
ok("the mirror's own option skips the actor hook", turnedDirect.length === 0);
const turnedOther = await settings.onUpdateActorFacing(actor, { system: { facing: 1 } }, {}, 'someone-else');
ok("another client's update skips the actor hook", turnedOther.length === 0);
// the reverse direction, dispatched through Hooks (registerSettingsHooks installed it in registerHooks)
const tokDoc = { rotation: 300, actor, async update() { throw new Error('the token must not be written in the reverse direction'); } };
ok('the updateToken hook is installed', (globalThis.Hooks.events.updateToken ?? []).length >= 1);
globalThis.Hooks.callAll('updateToken', tokDoc, { rotation: 300 }, {}, globalThis.game.userId);
await new Promise((r) => setTimeout(r, 0));
ok('a token turned by hand writes the nearest hexside back (dispatched through Hooks): 300 -> facing 5', actor.system.facing === 5);
ok('and the facing write carried the mirror option, so the token was not turned again', writes.length === 1);
tokDoc.rotation = 305;
ok('305 rounds to the same hexside and writes nothing', (await settings.onUpdateTokenRotation(tokDoc, { rotation: 305 }, {}, globalThis.game.userId)) === false && actor.system.facing === 5);
tokDoc.rotation = 0;
ok("the mirror's own option skips the token hook", (await settings.onUpdateTokenRotation(tokDoc, { rotation: 0 }, { [SYNC_OPTION]: true }, globalThis.game.userId)) === false && actor.system.facing === 5);
ok("another client's token update skips the token hook", (await settings.onUpdateTokenRotation(tokDoc, { rotation: 0 }, {}, 'someone-else')) === false && actor.system.facing === 5);
ok('a token without a character actor is ignored', (await settings.onUpdateTokenRotation({ rotation: 0, actor: null }, { rotation: 0 }, {}, globalThis.game.userId)) === false);
await set('tokenRotationSync', false);
ok('tokensToRotate: an unlinked token actor answers its own token; no getActiveTokens -> none', settings.tokensToRotate({ isToken: true, token: tok }).length === 1 && settings.tokensToRotate({}).length === 0);

// ---- 6. the importer ----------------------------------------------------------------------------------------------
const importerSrc = src('module/apps/dossier-importer.mjs');
ok('dossier-importer.mjs gates its hidden-ownership pin on npcDefaultHidden()', /import \{ npcDefaultHidden \} from '\.\.\/settings\.mjs'/.test(importerSrc) && /const hide = npcDefaultHidden\(\);/.test(importerSrc) && /if \(!hide\) break;/.test(importerSrc));
await set('npcDefaultHidden', false);
ok('npcDefaultHidden() follows the world setting', settings.npcDefaultHidden() === false);
await set('npcDefaultHidden', true);

// ---- 7. source ------------------------------------------------------------------------------------------------------
const bootSrc = src('module/shadowbase.mjs');
ok('module/shadowbase.mjs carries no TODO(U10)', !/TODO\(U10\)/.test(bootSrc) && !/TODO/.test(src('module/rolls.mjs')));
ok('registerDataLayer calls registerSettings(); registerHooks calls registerSettingsHooks(); game.shadowbase.settings is the module', /registerSettings\(\);/.test(bootSrc) && /registerSettingsHooks\(\);/.test(bootSrc) && globalThis.game.shadowbase.settings === settings);
ok('rolls.mjs and hud.mjs keep their guarded reads (try/catch around game.settings.get)', /try \{ n = globalThis\.game\?\.settings\?\.get\(SYSTEM_ID, 'rollHistoryDepth'\); \}/.test(src('module/rolls.mjs')) && /try \{ const v = globalThis\.game\?\.settings\?\.get\(SYSTEM_ID, key\)/.test(src('module/apps/hud.mjs')));
ok('the actor directory context entry names the Settings.OpenHud key and opens the HUD', /getActorContextOptions/.test(bootSrc) && /SHADOWBASE\.Settings\.OpenHud/.test(bootSrc) && /TacticalHud\.open\(actor\)/.test(bootSrc));

report(`${SETTING_KEYS.length} settings (3 world, ${PREFERENCE_KEYS.length} client), ${ATTRS.length} root attributes, website defaults pinned from ${prefsFile.replace(/\\/g, '/').split('/').slice(-3).join('/')}`);
