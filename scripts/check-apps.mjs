#!/usr/bin/env node
// check:apps
//
// SUBJECT: the six sub-apps (docs/ARCHITECTURE.md §6.5, unit U09): module/apps/
// {sub-app,droid-workshop,anatomy-workshop,body-loadout,suits-sets,crafting,
// dossier-importer}.mjs, templates/apps/**, styles/apps.css - driven headlessly
// through tools/foundry-shim.mjs over shim-built actors, in the environment
// tools/render-apps.mjs installs (the one the preview renderer uses).
//
// Pinned, each against the code path it protects:
//   - WIRING: every `data-action` in templates/apps/** has a static handler on its
//     app's DEFAULT_OPTIONS.actions and every handler is reachable from a template;
//     every button is type="button" (the roots are submitOnChange forms); the handlers
//     that the architecture routes to the engine CALL it (pinned by source: the droid
//     tables, the layering, the suit dealer, the stage rules, the roll module) and no
//     app re-implements a rule (no resolveRollOutcome / resolveSkillLevel /
//     getCalculatedStats call in module/apps/*.mjs of this unit);
//   - RENDER (strict + knownHelpersOnly over the live _prepareContext): every app for
//     its matching template, one root element, no unresolved mustache / leaked object,
//     every SHADOWBASE key resolved; the figures on them are the engine's;
//   - DROID WORKSHOP on the HK Assassin Droid: a slot select writes the WHOLE
//     droidBuild - the sparse array stays an ARRAY with null holes, index 99 holds the
//     Backup Power Array, nothing is compacted (the REJECTED alternative, a per-index
//     dotted key `system.droidBuild.chassisMods.internalIds.3`, is written through the
//     shim and shown to turn the array into a plain object - review finding M5);
//     a warped slot refuses a new part and Structural Repair clears it through
//     rolls.rollSkill; a built droid consumes the part from equipment BY NAME and
//     returns the old one; the swap runs through CraftingApp and a critical failure
//     lands on Ch17's table (droidMalfunctionApplication: the part destroyed, 20 PP
//     drained, the slot warped, a 'Droid Malfunction' effect stored); the stored
//     hitLocations follow droidAnatomy + reconcileDroidAnatomy;
//   - ANATOMY WORKSHOP: rows written whole; amputating an arm cascades to its hand
//     (amputationCascade); Reset Bio-Plan restores the twelve; linking an implant
//     writes both the location's installedHardwareIds and the implant's `installed`;
//     a droid's frame is locked but its status carries by name|side;
//   - BODY LOADOUT: wearing a second helmet takes the first off through
//     enforceBaseLayer (with the notice); Ready puts a spare into a hand and a
//     two-hander's pin is capped at two; an unbuilt weapon is refused; the deflector
//     toggle / emitter / tick write the whole build; a belt energy shield's isActive;
//   - SUITS & SETS: the Combat Suit deals SEVEN rows named by the chapter (Combat Suit
//     Helmet ... Gauntlet (Right Hand) ... Boot (Left Foot)), stamped setId
//     preset-combat-suit, and Outfits lists it as one Preset Suit; a library set deals
//     through profileToArmorItem; Equip all / Unequip all go through applySetEquip;
//     a custom set saves to system.gearSets whole and deletes;
//   - CRAFTING: the stage tree (silicon gate, power-unit gate, the saber lists, the
//     teardown lists, the blueprint read / write / design-phase prepends), the Ch10
//     gate (a build with no card cannot roll), a full run through rolls.rollCustom
//     with the meta shape the cards apply, a critical failure's material loss, the
//     crafter damage through applyCrafterDamage, the generic outcome (the built row,
//     the spent materials);
//   - DOSSIER IMPORTER: two files planned and imported under skip / copy / overwrite
//     through bulkImportFiles with per-file reasons, new actors hidden (ownership
//     NONE), the GM gate;
//   - I18N: every key the modules and templates name is in lang/en.json OR the
//     u09-i18n block parked in docs/REQUESTS.md, and every block key is named;
//   - CSS: styles/apps.css is no longer the stub, every rule is scoped under
//     .shadowbase, it reads the website's tokens, and it never redeclares a
//     components.css recipe at the sheet's level.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - sub-app.mjs materialise: returns the sparse array unchanged (holes stay holes; every build write
//     materialises through it, so this is the one place the guard lives) -> "a hole is filled with null"
//   - body-loadout.mjs wearArmor: `enforceBaseLayer` not called -> "the first helmet came off (displaced)"
//   - suits-sets.mjs itemsForSet: each row built from its Piece through armorItemFromPieceId (component names,
//     no setId, one row per pair - the website's own former defect, preset-suit-dialog.tsx:310-318)
//     -> "seven rows named by the chapter"
//   - crafting.mjs stagesFor: `stagesForSilicon` bypassed -> "a mechanical blaster skips Software Sync"
//   - dossier-importer.mjs runImport: the ownership pin removed and the shim's default changed -> "new actor hidden"
//
//   node scripts/check-apps.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, ROOT } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:apps');

// ---- environment ---------------------------------------------------------------------------------------------
const preview = await import(pathToFileURL(join(ROOT, 'tools', 'render-apps.mjs')).href);
const env = await preview.installAppsEnvironment();
const { engine, adapter, effects, translations: enJson, DialogV2, classes, modules, subApp, importExport, parked } = env;
const { DroidWorkshop } = modules['droid-workshop'];
const { AnatomyWorkshop } = modules['anatomy-workshop'];
const { BodyLoadout } = modules['body-loadout'];
const { SuitsAndSets } = modules['suits-sets'];
const { CraftingApp } = modules['crafting'];
const { DossierImporter } = modules['dossier-importer'];
const build = (key) => preview.buildFromKey(env, key);
const queue = (...totals) => { Roll._queue.length = 0; Roll.queueResults(totals); };
const lastNote = () => ui.notifications.log[ui.notifications.log.length - 1];
const notesSince = (n) => ui.notifications.log.slice(n);

const SRC = {};
for (const f of ['sub-app', 'droid-workshop', 'anatomy-workshop', 'body-loadout', 'suits-sets', 'crafting', 'dossier-importer']) SRC[f] = readFileSync(join(ROOT, 'module', 'apps', `${f}.mjs`), 'utf8');
const templateFiles = [
  ...readdirSync(join(ROOT, 'templates', 'apps')).filter((f) => f.endsWith('.hbs')).map((f) => join(ROOT, 'templates', 'apps', f)),
  ...readdirSync(join(ROOT, 'templates', 'apps', 'parts')).filter((f) => f.endsWith('.hbs')).map((f) => join(ROOT, 'templates', 'apps', 'parts', f)),
];
const TEMPLATES = Object.fromEntries(templateFiles.map((f) => [relative(ROOT, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]));
ok('templates found (denominator): six apps + two droid partials', Object.keys(TEMPLATES).length === 8, Object.keys(TEMPLATES).join(', '));

// ---- 1. wiring ------------------------------------------------------------------------------------------------------
const APP_TEMPLATES = {
  'droid-workshop': ['templates/apps/droid-workshop.hbs', 'templates/apps/parts/droid-select.hbs', 'templates/apps/parts/droid-limb.hbs'],
  'anatomy-workshop': ['templates/apps/anatomy-workshop.hbs'],
  'body-loadout': ['templates/apps/body-loadout.hbs'],
  'suits-sets': ['templates/apps/suits-sets.hbs'],
  'crafting': ['templates/apps/crafting.hbs'],
  'dossier-importer': ['templates/apps/dossier-importer.hbs'],
};
for (const [name, files] of Object.entries(APP_TEMPLATES)) {
  const Cls = classes[name];
  const actions = Cls.DEFAULT_OPTIONS.actions;
  const declared = new Set();
  for (const f of files) for (const m of TEMPLATES[f].matchAll(/data-action="([a-z-]+)"/g)) declared.add(m[1]);
  ok(`${name}: templates declare data-actions (denominator)`, declared.size >= 3, `${declared.size}`);
  for (const a of declared) ok(`${name}: data-action="${a}" has a static handler`, typeof actions[a] === 'function');
  for (const a of Object.keys(actions)) ok(`${name}: handler "${a}" is reachable from a template`, declared.has(a), 'dead handler');
  for (const f of files) ok(`${f}: every button is type="button"`, !/<button(?![^>]*type="button")/.test(TEMPLATES[f]));
  ok(`${name}: the root is a submitOnChange form with a handler`, Cls.DEFAULT_OPTIONS.form?.submitOnChange === true || Object.getPrototypeOf(Cls).DEFAULT_OPTIONS?.form?.submitOnChange === true || subApp.ActorSubApp.DEFAULT_OPTIONS.form.submitOnChange === true);
}
// The routes the architecture names, pinned by source (a handler quietly re-implementing a rule fails here).
const ROUTES = [
  ['droid-workshop', 'engine.droidWorkshopRows.workshopSlotRows('], ['droid-workshop', 'engine.calculateDroidHardwarePoints('], ['droid-workshop', 'engine.calculateDroidHardwareWeightLb('],
  ['droid-workshop', 'engine.droidAnatomy.droidAnatomy('], ['droid-workshop', 'engine.droidAnatomy.reconcileDroidAnatomy('], ['droid-workshop', 'engine.droidModification.droidMalfunction('], ['droid-workshop', 'engine.droidModification.droidMalfunctionApplication('],
  ['droid-workshop', 'rolls.rollSkill(this.actor, \'Mechanic (Droids)\''], ['droid-workshop', 'rolls.rollDamage('], ['droid-workshop', 'effects.addEffect('], ['droid-workshop', 'CraftingApp.open('], ['droid-workshop', 'engine.partAcquisition.buildAcquiredRow('],
  ['anatomy-workshop', 'engine.anatomy.amputationCascade('], ['anatomy-workshop', 'engine.hitLocations.STANDARD_HUMANOID_ANATOMY'], ['anatomy-workshop', 'engine.hitLocations.nonStandardLocationIds('], ['anatomy-workshop', 'engine.implantEffects.implantCpCharges('],
  ['body-loadout', 'engine.armorLayering.enforceBaseLayer('], ['body-loadout', 'engine.armorFit.armorFit('], ['body-loadout', 'engine.gearSets.activeSetBonuses('], ['body-loadout', 'engine.droidDr.droidHardwareDr('], ['body-loadout', 'engine.shieldRules.shieldActiveDR('], ['body-loadout', 'BL.resolveBodyLoadout('], ['body-loadout', 'BL.readiedWeapons('],
  ['suits-sets', 'engine.armorPieceItem.presetSuitItems('], ['suits-sets', 'engine.armorProfileItem.profileToArmorItem('], ['suits-sets', 'engine.gearSets.applySetEquip('], ['suits-sets', 'G.recogniseSets('], ['suits-sets', 'G.resolveCustomSet('], ['suits-sets', 'G.unmatchedWornGear('],
  ['crafting', 'rolls.rollCustom('], ['crafting', 'SC.stageSkillChoice('], ['crafting', 'SC.criticalFailureOutcome('], ['crafting', 'SC.stagesAsCrafted('], ['crafting', 'engine.armstechSpecialty.withArmstechSpecialty('], ['crafting', 'CR.stagesForSilicon('], ['crafting', 'CR.stagesForPowerUnit('], ['crafting', 'engine.crafterDamage.applyCrafterDamage('], ['crafting', 'engine.craftingMaterials.spendRawMaterials('], ['crafting', 'engine.blueprintFlow.applyBlueprintOutcome('], ['crafting', 'engine.salvageRecovery.applyRecovery('], ['crafting', 'engine.componentRuin.ruinRandomComponent('], ['crafting', 'engine.blueprintBuild.planBlueprintBuild('],
  ['dossier-importer', 'bulkImportFiles('],
];
for (const [file, needle] of ROUTES) ok(`${file}.mjs calls ${needle}`, SRC[file].includes(needle));
for (const [file, src] of Object.entries(SRC)) ok(`${file}.mjs never re-implements a target or the engine (no resolveRollOutcome / resolveSkillLevel / getCalculatedStats call)`, !/\b(resolveRollOutcome|resolveSkillLevel|getCalculatedStats)\s*\(/.test(src));
// Every build write is the whole `system.droidBuild`; a deeper dotted key (`system.droidBuild.chassisMods...`) is the rejected shape.
// Comments are stripped first: droid-workshop.mjs NAMES the rejected key in its header, which is not a write.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('no app writes a per-index dotted key into droidBuild (the rejected alternative, §6.5)', !/system\.droidBuild\.[A-Za-z]/.test(stripComments(SRC['droid-workshop'] + SRC['body-loadout'] + SRC['anatomy-workshop'])));
ok('sub-app.mjs syncRows replaces a changed row whole (recursive: false)', /updateEmbeddedDocuments\('Item', updates, \{ recursive: false \}\)/.test(SRC['sub-app']));

// ---- 2. i18n --------------------------------------------------------------------------------------------------------
const named = new Set();
for (const src of [...Object.values(SRC), ...Object.values(TEMPLATES)]) for (const m of src.matchAll(/SHADOWBASE\.Apps\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g)) named.add(m[0]);
const prefixes = new Set();
for (const src of Object.values(SRC)) for (const m of src.matchAll(/(SHADOWBASE\.Apps\.[A-Za-z0-9_.]*\.)\$\{/g)) prefixes.add(m[1]);
const known = { ...parked, ...enJson };
for (const key of named) {
  if ([...prefixes].some((p) => key + '.' === p)) continue;
  ok(`i18n key ${key} exists (lang/en.json or the u09-i18n block)`, key in known);
}
const appKeys = Object.keys(known).filter((k) => k.startsWith('SHADOWBASE.Apps.'));
ok('the Apps keys are parked in docs/REQUESTS.md or folded into lang/en.json (denominator)', appKeys.length >= 350, `${appKeys.length}`);
for (const key of appKeys) ok(`key ${key} is named by an app or a template (no dead keys)`, named.has(key) || [...prefixes].some((p) => key.startsWith(p)));
ok('the rendered strings resolve (localize returns the string, not the key)', game.i18n.localize('SHADOWBASE.Apps.Droid.ConstructionStatus') === 'Construction Status');

// ---- 3. CSS ---------------------------------------------------------------------------------------------------------
{
  const css = readFileSync(join(ROOT, 'styles', 'apps.css'), 'utf8');
  ok('styles/apps.css is no longer the stub', css.length > 5000 && !/EMPTY STUB/.test(css));
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((sel) => sel && !/^(\d+%|from|to)(\s*,\s*(\d+%|from|to))*$/.test(sel));
  const unscoped = selectors.filter((s) => !s.split(',').every((part) => /^\s*\.shadowbase/.test(part)));
  ok('every apps.css rule is scoped under .shadowbase', unscoped.length === 0, unscoped.slice(0, 5).join(' | '));
  for (const token of ['--background', '--foreground', '--primary', '--accent', '--destructive', '--border', '--muted-foreground', '--radius', '--font-mono', '--sb-green-400', '--sb-amber-500', '--sb-blue-400']) ok(`apps.css reads the website token ${token}`, css.includes(`var(${token}`));
  const sheetLevel = selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter((s) => /^\.shadowbase \.sb-(btn|badge|section|tabs|tab|input|select|table|chip|stat-tile|card|empty|field|grid|pool|row)(\b|-)/.test(s));
  ok('apps.css never redeclares a components.css recipe at the sheet level (.shadowbase .sb-btn ...)', sheetLevel.length === 0, sheetLevel.slice(0, 6).join(' | '));
}

// ---- 4. render every app over its template ---------------------------------------------------------------------------
const rootCount = (html) => {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  let depth = 0; let roots = 0;
  for (const m of String(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m; const t = tag.toLowerCase();
    if (close) { depth--; continue; }
    if (depth === 0) roots++;
    if (!self && !VOID.has(t)) depth++;
  }
  return roots;
};
const rendered = {};
for (const [name, spec] of Object.entries(preview.APPS)) {
  const actor = spec.template ? build(spec.template) : null;
  let app = null; let why = '';
  try { app = await preview.openApp(env, name, actor); } catch (e) { why = e.stack?.split('\n').slice(0, 3).join(' | ') ?? e.message; }
  ok(`${name}: renders with the live context (strict)`, why === '', why);
  if (!app) continue;
  rendered[name] = { app, actor };
  const html = app.parts[spec.part] ?? '';
  ok(`${name}: part ${spec.part} rendered something`, html.length > 500, `${html.length}`);
  ok(`${name}: exactly one root element`, rootCount(html) === 1, `${rootCount(html)}`);
  ok(`${name}: no unresolved mustache / leaked object / undefined`, !/\{\{|\[object Object\]|>undefined<|>NaN</.test(html));
  ok(`${name}: every SHADOWBASE key resolved`, !/SHADOWBASE\./.test(html));
  if (actor) ok(`${name}: one window per actor (open() returns the same instance)`, (await preview.openApp(env, name, actor)) === app);
}
{
  const html = rendered['droid-workshop'].app.parts.workshop;
  ok('droid workshop: the HK chassis is selected', /name="droid\.chassisId"[^>]*>[\s\S]*?<option value="hk-bipedal" selected>/.test(html));
  ok('droid workshop: the Backup Power Array select binds internalIds.99', html.includes('name="droid.chassisMods.internalIds.99"'));
  ok('droid workshop: the slot badges read the stored membership (Internal 2/2)', /Internal 2\/2/.test(html));
  const sheet = rendered['droid-workshop'].actor.sheetData;
  ok('droid workshop: the hardware CP figure is calculateDroidHardwarePoints', html.includes(`${engine.calculateDroidHardwarePoints(sheet)} CP`));
  const lo = rendered['body-loadout'].app.parts.loadout;
  ok('body loadout: Rokarr has twelve location rows', (lo.match(/class="sb-loadout__row/g) ?? []).length === 12);
  ok('body loadout: the Bowcaster is held with the 2H tag', /Bowcaster[\s\S]*?>2H</.test(lo));
  const su = rendered['suits-sets'].app.parts.suits;
  ok('suits & sets: the picker lists the six Preset Suits', engine.armorPiecesData.PRESET_SUITS.every((s) => su.includes(`data-set-id="${s.id}"`)));
  ok('suits & sets: Outfits recognises Rokarr\'s Republic Trooper Standard Armor', su.includes('Republic Trooper Standard Armor'));
  const an = rendered['anatomy-workshop'].app.parts.anatomy;
  ok('anatomy workshop: Rokarr has twelve location cards', (an.match(/class="sb-card sb-anatomy__loc/g) ?? []).length === 12);
  const cr = rendered['crafting'].app.parts.crafting;
  ok('crafting: the picker lists the catalog sections and Kaelen\'s lightsaber for a teardown', cr.includes('name="craft.pick.section"') && /Lightsaber Forge/.test(cr));
}

// ---- 5. Droid Workshop ----------------------------------------------------------------------------------------------
{
  const actor = build('assassinDroid');
  await actor.update({ 'system.isConstructed': false });
  const app = await DroidWorkshop.open(actor);
  const upgrade = engine.droidData.DROID_UPGRADES.find((u) => u.slotType === 'Internal' && u.id !== 'proc-housing' && modules['droid-workshop'].UTILITY_REGISTRY_IDS.includes(u.id));
  await app.submitForm({ 'droid.chassisMods.internalIds.3': upgrade.id });
  let ids = actor.system.droidBuild.chassisMods.internalIds;
  ok('a slot select writes the sparse array as an ARRAY', Array.isArray(ids));
  ok('the array is materialised to the slot (length 4)', ids.length === 4, `${ids.length}`);
  ok('a hole is filled with null, never compacted', ids[2] === null && (2 in ids) && ids[3] === upgrade.id, JSON.stringify(ids));
  ok('the stored source is the same array shape (toObject)', Array.isArray(actor.toObject().system.droidBuild.chassisMods.internalIds) && actor.toObject().system.droidBuild.chassisMods.internalIds[2] === null);
  const backup = engine.droidData.DROID_UPGRADES.find((u) => u.category === 'Power' && u.slotType === 'Internal');
  await app.submitForm({ [`droid.chassisMods.internalIds.${modules['droid-workshop'].BACKUP_POWER_INDEX}`]: backup.id });
  ids = actor.system.droidBuild.chassisMods.internalIds;
  ok('the Backup Power Array lands at index 99 with null holes before it', ids.length === 100 && ids[99] === backup.id && ids[50] === null && ids[3] === upgrade.id);
  const rows = engine.droidWorkshopRows.workshopSlotRows(actor.system.droidBuild, engine.droidData.DROID_CHASSIS.find((c) => c.id === actor.system.droidBuild.chassisId), null);
  ok('workshopSlotRows carves index 99 out of the internal rows', !rows.internal.includes(99) && rows.internal.includes(3));
  const html = (await app.render()).parts.workshop;
  ok('the rendered badge counts the internals without the Backup Power Array', /Internal 3\/2/.test(html));
  // The REJECTED alternative (§6.5 / §9.1 M5): a per-index dotted key turns the array into an object.
  const probe = build('assassinDroid');
  const quiet = console.error; console.error = () => {}; // the broken shape makes the engine throw on the probe actor - that IS the finding
  await probe.update({ 'system.droidBuild.chassisMods.internalIds.3': upgrade.id });
  console.error = quiet;
  ok('REJECTED ALTERNATIVE: a per-index dotted key leaves the stored slots as a plain object, not an array', !Array.isArray(probe.system.droidBuild.chassisMods.internalIds), JSON.stringify(probe.system.droidBuild.chassisMods.internalIds));
  // A limb: side and model, add / remove.
  const arms = actor.system.droidBuild.arms.length;
  await app.invokeAction('add-arm');
  ok('Add Arm appends a limb with a fresh uuid', actor.system.droidBuild.arms.length === arms + 1 && /^[0-9a-f-]{36}$/.test(actor.system.droidBuild.arms[arms].id));
  await app.submitForm({ [`droid.arms.${arms}.side`]: 'Auxiliary' });
  ok('the side select writes the limb', actor.system.droidBuild.arms[arms].side === 'Auxiliary');
  await app.invokeAction('remove-limb', { kind: 'arms', index: String(arms) });
  ok('Remove takes the limb out', actor.system.droidBuild.arms.length === arms);
  // Anatomy follows the build (droidAnatomy + reconcileDroidAnatomy).
  const derived = engine.droidAnatomy.reconcileDroidAnatomy(engine.droidAnatomy.droidAnatomy(actor.system), actor.system.hitLocations);
  ok('the stored hitLocations follow the derived T20 anatomy after a build write', JSON.stringify(actor.system.hitLocations.map((l) => l.name)) === JSON.stringify(derived.map((l) => l.name)) && modules['droid-workshop'].anatomyInSync(actor));
  // Warped refusal and Structural Repair.
  const path = 'chassisMods.internalIds.3';
  const b = modules['droid-workshop'].buildOf(actor); b.warpedSlots = [path]; await actor.update({ 'system.droidBuild': b });
  const other = engine.droidData.DROID_UPGRADES.find((u) => u.slotType === 'Internal' && u.id !== upgrade.id && modules['droid-workshop'].UTILITY_REGISTRY_IDS.includes(u.id));
  const before = ui.notifications.log.length;
  const refused = await app.selectPart(path, other.id);
  ok('a warped slot refuses a new part (the build unchanged, an error notification)', refused?.refused === 'warped' && actor.system.droidBuild.chassisMods.internalIds[3] === upgrade.id && lastNote()?.level === 'error' && ui.notifications.log.length === before + 1);
  ok('removal from a warped slot is allowed (pulling wreckage out is how repairs start)', (await app.selectPart(path, null))?.applied?.partId === null && actor.system.droidBuild.chassisMods.internalIds[3] === null);
  const skillTarget = env.rollsMod.skillTargetFor(actor, 'Mechanic (Droids)');
  ok('the droid reaches Mechanic (Droids) (trained or a default)', skillTarget?.target != null, JSON.stringify(skillTarget));
  queue(18);
  await app.structuralRepair(path, { modifier: 0 });
  ok('a failed Structural Repair leaves the slot warped', actor.system.droidBuild.warpedSlots.includes(path));
  queue(3);
  const repair = await app.structuralRepair(path, { modifier: 0 });
  ok('Structural Repair rolls Mechanic (Droids) through rolls.rollSkill and clears the warp on success', repair?.outcome?.success === true && !actor.system.droidBuild.warpedSlots.includes(path));
  // A BUILT droid: stock by name, the Ch17 job through CraftingApp.
  await actor.update({ 'system.isConstructed': true });
  const missing = await app.selectPart(path, other.id);
  ok('a built droid refuses a part that is not in stock (Hardware Missing)', missing?.refused === 'missing' && lastNote()?.level === 'error');
  await app.buyParts({ partId: other.id, quantity: 2 });
  const stock = actor.rowsOf('equipment').find((i) => i.system.row.name === other.name);
  ok('Buy Droid Components adds the part as an equipment row (buildAcquiredRow, quantity 2)', !!stock && stock.system.row.quantity === 2 && stock.system.row.partId === other.id);
  const job = await app.selectPart(path, other.id);
  ok('a built droid queues the swap as a CraftingApp job (mode swap, the part\'s category)', job?.pending?.mode === 'swap' && job.pending.category === 'Droid Internal' && job.crafting?.job?.mode === 'swap' && job.crafting.job.category === 'Droid Internal');
  const craft = job.crafting;
  const stages = craft.stages;
  ok('the swap job\'s stages come from the crafting rules (a droid category with no swap list falls to its build stages)', stages.length >= 1 && stages.every((s) => s.name && s.skill));
  queue(...stages.map(() => 5));
  for (let i = 0; i < stages.length; i++) await craft.rollStage({ modifier: 0 });
  ok('every phase succeeded through rolls.rollCustom', craft.run.finished && !craft.run.failed && craft.run.logs.every((l) => l.includes('SUCCESS')), craft.run.logs.join(' | '));
  const done = await craft.finalize();
  ok('finalize hands the caller (success, waste, meta) and the swap seats the part', done?.success === true && done.meta?.outcome === 'success' && actor.system.droidBuild.chassisMods.internalIds[3] === other.id);
  const left = actor.rowsOf('equipment').find((i) => i.system.row.name === other.name);
  ok('the new part was consumed from equipment BY NAME (quantity 2 -> 1)', left?.system.row.quantity === 1);
  // A critical failure on the next swap: Ch17's table, applied.
  const third = engine.droidData.DROID_UPGRADES.find((u) => u.slotType === 'Internal' && ![upgrade.id, other.id].includes(u.id) && modules['droid-workshop'].UTILITY_REGISTRY_IDS.includes(u.id));
  await app.buyParts({ partId: third.id, quantity: 1 });
  const pp0 = actor.system.powerPoints;
  const job2 = await app.selectPart(path, third.id);
  const craft2 = job2.crafting;
  queue(18, 6);
  await craft2.rollStage({ modifier: 0 });
  ok('an 18 is a critical failure that ends the run', craft2.run.failed && craft2.run.sawCriticalFailure);
  const effectsBefore = actor.effects.size;
  const fail = await craft2.finalize();
  ok('the failed run hands the caller wasCriticalFailure', fail?.success === false && fail.meta.wasCriticalFailure === true);
  ok('Ch17 crit 5-6 (d6 = 6): the worked part is destroyed', !actor.rowsOf('equipment').some((i) => i.system.row.name === third.name));
  ok('Ch17 crit 5-6: the slot is warped', actor.system.droidBuild.warpedSlots.includes(path));
  ok('Ch17 crit 3-6 with 20+ PP: 20 PP drained', pp0 >= 20 ? actor.system.powerPoints === pp0 - 20 : true, `${pp0} -> ${actor.system.powerPoints}`);
  ok('Ch17 crit 5-6: a Droid Malfunction effect row is stored', actor.effects.size === effectsBefore + 1 && actor.effects.contents.some((e) => e.flags?.shadowbase?.statusEffect?.source === 'Droid Malfunction'));
  ok('the old part stayed in the slot (a failure does not move the part)', actor.system.droidBuild.chassisMods.internalIds[3] === other.id);
  await app.close();
}

// ---- 6. Anatomy Workshop --------------------------------------------------------------------------------------------
{
  const actor = build('rokarr');
  const app = await AnatomyWorkshop.open(actor);
  const n = actor.system.hitLocations.length;
  await app.invokeAction('add-location');
  ok('Add Body Part appends the website\'s new row (whole array write)', actor.system.hitLocations.length === n + 1 && actor.system.hitLocations[n].name === 'New Appendage');
  await app.submitForm({ [`anatomy.${n}.name`]: 'Dorsal Tentacle', [`anatomy.${n}.type`]: 'Striker', [`anatomy.${n}.innateDR`]: '3' });
  const added = actor.system.hitLocations[n];
  ok('the row\'s fields write through (name, type, innate DR as a number)', added.name === 'Dorsal Tentacle' && added.type === 'Striker' && added.innateDR === 3);
  await app.invokeAction('discard-location', { index: String(n) });
  ok('Discard removes the row', actor.system.hitLocations.length === n);
  const arm = actor.system.hitLocations.findIndex((l) => l.name === 'Right Arm');
  const hand = actor.system.hitLocations.find((l) => l.name === 'Right Hand');
  const r = await app.amputate(arm, true);
  ok('amputating the Right Arm cascades to the Right Hand (amputationCascade)', r.alsoLost.includes(hand.id) && actor.system.hitLocations[arm].isAmputated && actor.system.hitLocations.find((l) => l.id === hand.id).isAmputated);
  await app.amputate(arm, false);
  ok('restoring the arm leaves the hand alone', !actor.system.hitLocations[arm].isAmputated && actor.system.hitLocations.find((l) => l.id === hand.id).isAmputated);
  await app.resetBioPlan();
  ok('Reset Bio-Plan restores the twelve standard rows with fresh ids and empty hardware links', actor.system.hitLocations.length === 12 && actor.system.hitLocations.every((l) => /^[0-9a-f-]{36}$/.test(l.id) && Array.isArray(l.installedHardwareIds) && l.installedHardwareIds.length === 0) && !actor.system.hitLocations.some((l) => l.isAmputated));
  // Link an implant: both the row and the implant move.
  // The catalog row carries no slotType; the implant dialog stamps it on the sheet row (neuralImplantSchema.slotType).
  const implant = engine.cyberneticsData.NEURAL_IMPLANTS[0];
  const [item] = await actor.createEmbeddedDocuments('Item', [adapter.rowToItemData({ ...implant, id: engine.rowId(), slotType: 'Neural', installed: false }, 'implants')]);
  const head = actor.system.hitLocations.findIndex((l) => l.type === 'Head');
  const ctx = await app._prepareContext({});
  ok('a Neural implant is offered on the Head', ctx.anatomy.locations[head].linkable.some((o) => o.value === item.system.row.id) && !ctx.anatomy.locations.find((l) => l.type === 'Torso').linkable.some((o) => o.value === item.system.row.id));
  await app.submitForm({ [`anatomy.${head}.link`]: item.system.row.id });
  ok('linking writes the location\'s installedHardwareIds AND the implant\'s installed flag', actor.system.hitLocations[head].installedHardwareIds.includes(item.system.row.id) && item.system.row.installed === true);
  await app.invokeAction('unlink-hardware', { index: String(head), hardwareId: item.system.row.id });
  ok('detaching reverses both', !actor.system.hitLocations[head].installedHardwareIds.includes(item.system.row.id) && item.system.row.installed === false);
  await app.close();
  // A droid: the frame is locked, status carries by name|side.
  const droid = build('assassinDroid');
  const dApp = await AnatomyWorkshop.open(droid);
  const rows = dApp.rows;
  ok('a droid\'s rows are the derived anatomy reconciled with the stored state', rows.length > 0 && rows[0].name === 'Torso (Chassis)');
  await dApp.submitForm({ 'anatomy.0.name': 'Renamed' });
  ok('a droid\'s frame is locked (a name edit is refused)', !droid.system.hitLocations.some((l) => l.name === 'Renamed'));
  await dApp.submitForm({ 'anatomy.0.status': 'Crippled' });
  ok('a droid\'s status writes and carries through reconcileDroidAnatomy', dApp.rows[0].status === 'Crippled' && droid.system.hitLocations[0].name === 'Torso (Chassis)');
  ok('Add / Reset are refused on a droid', (await dApp.addLocation()) === null && (await dApp.resetBioPlan()) === null);
  await dApp.close();
}

// ---- 7. Body Loadout ------------------------------------------------------------------------------------------------
{
  const actor = build('rokarr');
  const app = await BodyLoadout.open(actor);
  const helmet = actor.rowsOf('armor').find((i) => i.system.row.slot === 'Head' && i.system.row.equipped);
  ok('Rokarr wears a helmet (denominator)', !!helmet);
  await app.invokeAction('unwear', { itemId: helmet.system.row.id });
  ok('Take off clears equipped', helmet.system.row.equipped === false);
  const headLoc = actor.system.hitLocations.find((l) => l.type === 'Head');
  await app.submitForm({ [`loadout.wear.${headLoc.id}`]: helmet.system.row.id });
  ok('the wear picker equips the piece', helmet.system.row.equipped === true);
  const second = { ...helmet.system.row, id: engine.rowId(), name: 'Spare Helmet', equipped: false };
  const [spare] = await actor.createEmbeddedDocuments('Item', [adapter.rowToItemData(second, 'armor')]);
  const before = ui.notifications.log.length;
  const worn = await app.wearArmor(spare.system.row.id, true);
  ok('wearing a second helmet: the first helmet came off (displaced) through enforceBaseLayer', worn.displaced.length === 1 && worn.displaced[0].itemId === helmet.system.row.id && helmet.system.row.equipped === false && spare.system.row.equipped === true);
  ok('the base-layer notice names the displaced piece', notesSince(before).some((n) => n.level === 'info' && n.message.includes(helmet.name)));
  // Weapons.
  const bow = actor.rowsOf('customBlasters').find((i) => i.system.row.equipped);
  ok('Rokarr readies the Bowcaster (denominator)', !!bow);
  await app.invokeAction('unready', { itemId: bow.system.row.id });
  ok('Unready clears equipped / equippedAt / heldLocationIds (written whole)', bow.system.row.equipped === false && bow.system.row.equippedAt === null && Array.isArray(bow.system.row.heldLocationIds) && bow.system.row.heldLocationIds.length === 0);
  const right = actor.system.hitLocations.find((l) => l.name === 'Right Hand');
  const left = actor.system.hitLocations.find((l) => l.name === 'Left Hand');
  const b2 = ui.notifications.log.length;
  await app.submitForm({ [`loadout.ready.${right.id}`]: bow.system.row.id });
  ok('Ready puts the Bowcaster in the right hand', bow.system.row.equipped === true && JSON.stringify(bow.system.row.heldLocationIds) === JSON.stringify([right.id]) && typeof bow.system.row.equippedAt === 'number');
  ok('a two-hander warns that it takes a second hand', notesSince(b2).some((n) => n.message.includes('Two-handed') || n.message.includes(bow.name)));
  await app.submitForm({ [`loadout.pin.${bow.system.row.id}.${left.id}`]: true });
  ok('pinning the left hand too keeps both (needs 2)', JSON.stringify(bow.system.row.heldLocationIds) === JSON.stringify([right.id, left.id]));
  const arm = actor.system.hitLocations.find((l) => l.name === 'Right Arm');
  await app.togglePin(bow.system.row.id, arm.id);
  ok('a third pin drops the oldest (capped at what the weapon needs)', bow.system.row.heldLocationIds.length === 2 && !bow.system.row.heldLocationIds.includes(right.id));
  await app.invokeAction('clear-pin', { itemId: bow.system.row.id });
  ok('Let the sheet choose clears the pins', bow.system.row.heldLocationIds.length === 0);
  await bow.updateRow({ equipped: false, isConstructed: false });
  const b3 = ui.notifications.log.length;
  await app.readyInto(bow.system.row.id, right.id);
  ok('an unbuilt weapon is refused (Incomplete Weapon)', bow.system.row.equipped === false && notesSince(b3).some((n) => n.level === 'error'));
  await bow.updateRow({ isConstructed: true });
  // A belt energy shield.
  const shieldProfile = engine.armorData.ARMOR_DATA.find((a) => a.type === 'Energy Shield');
  const utility = engine.armorPiecesData.ENERGY_SHIELDS[0];
  const shieldRow = engine.ensureCompleteArmorItem({ ...shieldProfile, id: engine.rowId(), utilityId: utility.id, equipped: true, isActive: false }, actor.system.hitLocations);
  const [shield] = await actor.createEmbeddedDocuments('Item', [adapter.rowToItemData(shieldRow, 'armor')]);
  await app.invokeAction('toggle-energy-shield', { itemId: shield.id });
  ok('a belt energy shield toggles isActive and grants its DR while on (shieldActiveDR)', shield.system.row.isActive === true && engine.shieldRules.shieldActiveDR(shield.system.row) > 0);
  const ctx = await app._prepareContext({});
  ok('the loadout context lists the shield as active', ctx.loadout.shields.some((s) => s.itemId === shield.id && s.isActive && s.activeDR > 0));
  await app.close();
  // The deflector strip on a droid with a Shield Projector.
  const droid = build('assassinDroid');
  const b = modules['droid-workshop'].buildOf(droid); b.chassisMods.externalIds = ['shield-proj']; await droid.update({ 'system.droidBuild': b });
  const dApp = await BodyLoadout.open(droid);
  let dctx = await dApp._prepareContext({});
  ok('a Shield Projector shows the deflector strip (droidHardwareDr forceField.fitted)', dctx.loadout.deflector?.max === 20 && dctx.loadout.deflector.switched === false);
  await dApp.invokeAction('toggle-shield');
  dctx = await dApp._prepareContext({});
  ok('Ignite writes shieldActive on the whole build and the field is live', droid.system.droidBuild.chassisMods.shieldActive === true && Array.isArray(droid.system.droidBuild.chassisMods.externalIds) && dctx.loadout.deflector.active === true);
  const pp = droid.system.powerPoints;
  await dApp.invokeAction('tick-shield');
  ok('Tick 1 min deducts SHIELD_DRAIN_PP_PER_MIN', droid.system.powerPoints === pp - engine.droidDr.SHIELD_DRAIN_PP_PER_MIN);
  await dApp.invokeAction('set-emitter', { condition: 'Damaged' });
  dctx = await dApp._prepareContext({});
  ok('a Damaged emitter is stored and the Ch7 -1 reaches the field', droid.system.droidBuild.chassisMods.shieldEmitterCondition === 'Damaged' && dctx.loadout.deflector.current === 19);
  await dApp.submitForm({ 'loadout.shieldCurrentDr': '25' });
  ok('the wear input clamps to the field\'s maximum', droid.system.droidBuild.chassisMods.shieldCurrentDr === 20);
  await dApp.close();
}

// ---- 8. Suits & Sets ------------------------------------------------------------------------------------------------
{
  const mod = modules['suits-sets'];
  const combat = mod.resolvedSets().find((s) => s.id === 'combat-suit');
  ok('the picker composes the Combat Suit as a Preset Suit with five rows and the chapter\'s qty-weighted totals', combat?.group === 'Preset Suits' && combat.rows.length === 5 && combat.rows.reduce((n, r) => n + r.quantity, 0) === 7 && combat.tier === 'Medium');
  const actor = build('blank');
  const items = mod.itemsForSet(combat, { equipped: true, wearerSM: 0, hitLocations: actor.system.hitLocations });
  const names = items.map((i) => i.name);
  ok('the Combat Suit deals seven rows named by the chapter (presetSuitItems)', JSON.stringify(names) === JSON.stringify(['Combat Suit Helmet', 'Combat Suit Cuirass', 'Combat Suit Greaves', 'Combat Suit Gauntlet (Right Hand)', 'Combat Suit Gauntlet (Left Hand)', 'Combat Suit Boot (Right Foot)', 'Combat Suit Boot (Left Foot)']), names.join(' | '));
  ok('every dealt row is stamped setId preset-combat-suit and bound per limb', items.every((i) => i.setId === 'preset-combat-suit') && items.filter((i) => i.slot === 'Hands').every((i) => i.wornLocationId));
  ok('a Preset Suit\'s Sealed flags and the SM ride through (ensureCompleteArmorItem)', items.every((i) => 'sealed' in i && 'itemSizeModifier' in i));
  const app = await SuitsAndSets.open(actor);
  app.picker.selectedId = 'combat-suit';
  await app.addSet();
  ok('Add deals the seven rows onto the actor as armor Items, equipped', actor.rowsOf('armor').length === 7 && actor.rowsOf('armor').every((i) => i.system.row.equipped));
  let ctx = await app._prepareContext({});
  const listed = ctx.sets.list.find((s) => s.name === 'Combat Suit');
  ok('Outfits lists the dealt suit as ONE Preset Suit, complete and all worn', listed?.kind === 'Preset Suit' && listed.complete && listed.allWorn && listed.equippedCount === listed.applicableCount);
  ok('the picker on a wearer names the base-layer conflicts', (app.picker.selectedId = 'republic-trooper-standard-armor', (await app._prepareContext({})).suits.hasConflicts));
  app.picker.selectedId = null;
  // Fall back to the dealt rows when Outfits did not recognise the suit (the leg above already failed; keep reporting).
  const ids = listed ? listed.memberIds.split(',') : actor.rowsOf('armor').map((i) => i.system.row.id);
  await app.setEquipped(ids, false);
  ok('Unequip all (applySetEquip) takes every piece off', actor.rowsOf('armor').every((i) => !i.system.row.equipped));
  await app.setEquipped(ids, true);
  ok('Equip all puts them back', actor.rowsOf('armor').every((i) => i.system.row.equipped));
  // A specialty set through the library path.
  const stealth = mod.resolvedSets().find((s) => s.id === 'stealth-suit');
  const sItems = mod.itemsForSet(stealth, { equipped: false, wearerSM: 0, hitLocations: actor.system.hitLocations });
  ok('a Specialty Armor set deals library rows through profileToArmorItem', sItems.length >= 3 && sItems.every((i) => i.name && i.slot && i.equipped === false));
  // A custom set.
  const record = await app.editSet(null, { name: 'Field Kit', memberIds: ids.slice(0, 2) });
  ok('a custom set saves to system.gearSets (whole array)', Array.isArray(actor.system.gearSets) && actor.system.gearSets.length === 1 && actor.system.gearSets[0].name === 'Field Kit' && actor.system.gearSets[0].memberIds.length === 2);
  ctx = await app._prepareContext({});
  ok('Outfits resolves the custom set (resolveCustomSet)', ctx.sets.list.some((s) => s.name === 'Field Kit' && s.stored));
  await app.invokeAction('delete-set', { setId: record.id });
  ok('Delete removes it', actor.system.gearSets.length === 0);
  ok('the tier chips filter the list (Heavy shows only the heavy suit)', (app.picker.tier = 'Heavy', (await app._prepareContext({})).suits.groups.every((g) => g.items.every((i) => i.tier === 'Heavy'))));
  app.picker.tier = null;
  await app.close();
}

// ---- 9. Crafting ----------------------------------------------------------------------------------------------------
{
  const mod = modules['crafting'];
  const CR = engine.craftingRules;
  const forge = (category, extra = {}) => mod.stagesFor({ item: { name: 'x' }, category, mode: 'forge', ...extra }, {});
  ok('a mechanical blaster skips Software Sync (stagesForSilicon)', forge('Blasters', { weaponCarriesSilicon: false }).every((s) => !s.isSoftware) && forge('Blasters', { weaponCarriesSilicon: true }).some((s) => s.isSoftware));
  ok('an unknown silicon answer keeps every stage', forge('Blasters').length === CR.CRAFTING_DEFINITIONS.Blasters.length);
  ok('a plain melee blade stops after Hardware Assembly (stagesForPowerUnit)', forge('Melee Weapons', { item: { name: 'x', utilityParts: [] } }).length < CR.CRAFTING_DEFINITIONS['Melee Weapons'].length && forge('Melee Weapons', { item: { name: 'x', utilityParts: [{ partId: 'p' }] } }).length === CR.CRAFTING_DEFINITIONS['Melee Weapons'].length);
  ok('the saber forge / disassembly / salvage lists are the rules\' own', JSON.stringify(forge('Lightsaber Forge')) === JSON.stringify(CR.LIGHTSABER_FORGE_STAGES) && JSON.stringify(mod.stagesFor({ item: {}, category: 'Lightsaber Forge', mode: 'disassemble' })) === JSON.stringify(CR.LIGHTSABER_DISASSEMBLY_STAGES));
  ok('a deconstruct takes the family\'s teardown list, not the build in reverse', JSON.stringify(mod.stagesFor({ item: {}, category: 'Armor', mode: 'deconstruct' })) === JSON.stringify(CR.DECONSTRUCT_DEFINITIONS.Armor));
  ok('a Blasters swap takes the swap list with the silicon gate', mod.stagesFor({ item: {}, category: 'Blasters', mode: 'swap', weaponCarriesSilicon: false }).every((s) => !s.isSoftware));
  ok('a declared Blueprint prepends the read; an Original Design prepends Phase 0 + the write', mod.stagesFor({ item: { name: 'x' }, category: 'Armor', mode: 'forge' }, { buildBlueprintId: 'c' })[0].name === 'Blueprint Read' && mod.stagesFor({ item: { name: 'x' }, category: 'Armor', mode: 'forge', designPhase: { available: true } }, { designOriginal: true }).slice(0, 2).map((s) => s.name).join('|') === 'Design Phase|Blueprint Write');
  ok('a teardown the player records appends the write (never a salvage)', mod.stagesFor({ item: {}, category: 'Armor', mode: 'deconstruct', blueprintWrite: { available: true } }, { writeBlueprint: true }).at(-1).name === 'Blueprint Write' && mod.stagesFor({ item: {}, category: 'Armor', mode: 'salvage', blueprintWrite: { available: true } }, { writeBlueprint: true }).at(-1).name !== 'Blueprint Write');
  // The Ch10 gate on a picker forge, then a run.
  const actor = build('kaelenRarr');
  const app = await CraftingApp.open(actor);
  const design = engine.blueprintCatalog.craftableDesigns().find((d) => d.name === 'Medpac');
  const plan = engine.blueprintBuild.planBlueprintBuild({ blueprintOf: design.name, blueprintFamily: design.family });
  ok('Medpac is a direct catalog design (denominator)', plan.kind === 'direct' && Array.isArray(plan.row.materials) && plan.row.materials.length > 0);
  const b0 = ui.notifications.log.length;
  ok('a design whose materials are not in stock is refused before the run', (await app.startDesign('Medpac', 1)) === null && notesSince(b0).some((n) => n.level === 'error'));
  const stockRows = plan.row.materials.map((m) => ({ id: engine.rowId(), name: m.name, category: 'Raw Materials', quantity: m.amount * 3, cost: 0, weight: 1 }));
  await subApp.syncRows(actor, 'equipment', [...subApp.storedRows(actor, 'equipment'), ...stockRows]);
  await app.startDesign('Medpac', 1);
  ok('the design starts a forge job with the catalog row', app.job?.mode === 'forge' && app.job.category === 'Medical & Pharmaceuticals' && app.job.item?.name === 'Medpac');
  ok('the Ch10 gate: no Blueprint in hand, the build cannot roll', !app.buildGateSatisfied && (await app.rollStage({ modifier: 0 })) === null);
  const blank = engine.equipmentData.equipmentData.find((r) => engine.blueprints.findBlankDatacard([{ ...r, id: 'x' }]));
  ok('the catalog carries a blank Datacard (denominator)', !!blank, 'no equipment row findBlankDatacard accepts');
  const withCard = engine.blueprintFlow.applyBlueprintWrite([...subApp.storedRows(actor, 'equipment'), { ...blank, id: engine.rowId(), quantity: 1 }], { of: 'Medpac', origin: 'catalog', proven: true, constructionMarkup: design.markup });
  await subApp.syncRows(actor, 'equipment', withCard);
  app.job = null; app.run = mod.freshRun();
  await app.startDesign('Medpac', 1);
  ok('with the Medpac Blueprint in hand the card is auto-declared and the read stage prepended', !!app.activeBlueprint && app.stages[0].name === 'Blueprint Read' && app.buildGateSatisfied);
  const stageCount = app.stages.length;
  const equipBefore = subApp.storedRows(actor, 'equipment');
  queue(...Array.from({ length: stageCount }, () => 5));
  for (let i = 0; i < stageCount; i++) { const r = await app.rollStage({ modifier: 0 }); ok(`stage ${i + 1} rolled through rolls.rollCustom (a card, a total)`, !!r && typeof r.total === 'number' && r.message); }
  ok('a clean run finishes with the meta the cards apply', app.run.finished && app.buildMeta().outcome === 'success' && app.buildMeta().marginOfSuccess >= 0 && 'blueprintUsedId' in app.buildMeta());
  const result = await app.finalize();
  const equipAfter = subApp.storedRows(actor, 'equipment');
  ok('finalize applies the generic outcome: the Medpac row is created', equipAfter.some((r) => r.name === 'Medpac' && r.condition === 'Fine'));
  const need = plan.row.materials[0];
  const q0 = equipBefore.find((r) => r.name === need.name).quantity;
  const q1 = equipAfter.find((r) => r.name === need.name).quantity;
  ok('finalize spends the design\'s materials (spendRawMaterials)', Math.abs((q0 - q1) - need.amount) < 0.01, `${q0} -> ${q1} (need ${need.amount})`);
  ok('the app returns to its picker after a run', app.job === null && result.success === true);
  // A critical failure: the materials are lost (crit -> the full fraction), no item.
  await app.startDesign('Medpac', 1);
  const idx = app.stages.findIndex((s) => s.name !== 'Blueprint Read');
  queue(...Array.from({ length: idx }, () => 5), 18);
  for (let i = 0; i <= idx; i++) await app.rollStage({ modifier: 0 });
  ok('an 18 on a build phase fails the run (critical)', app.run.failed && app.run.sawCriticalFailure);
  const lost = app.materialsLost;
  ok('a critical failure loses the whole batch (materialLossFraction 1 on a chemical / physical phase)', lost.length > 0 && lost.every((l) => Math.abs(l.amount - plan.row.materials.find((m) => m.name === l.name).amount) < 0.01), JSON.stringify(lost));
  ok('a failed run cannot be aborted (Confirm Result only)', (await app.invokeAction('abort')) === false && app.run.failed);
  const q2 = subApp.storedRows(actor, 'equipment').find((r) => r.name === need.name).quantity;
  const medpacs = subApp.storedRows(actor, 'equipment').filter((r) => r.name === 'Medpac').length; // Kaelen carries one already
  await app.finalize();
  const q3 = subApp.storedRows(actor, 'equipment').find((r) => r.name === need.name).quantity;
  ok('Confirm Result spends the lost materials and creates nothing', Math.abs((q2 - q3) - need.amount) < 0.01 && subApp.storedRows(actor, 'equipment').filter((r) => r.name === 'Medpac').length === medpacs, `${q2} -> ${q3}`);
  // Crafter damage on a saber salvage (Ch12 "the crafter takes 1d-3").
  const saber = actor.rowsOf('lightsabers')[0];
  ok('Kaelen owns a lightsaber (denominator)', !!saber);
  await app.startTeardown(saber.id, 'salvage');
  ok('a saber teardown is the Lightsaber Forge family', app.job?.category === 'Lightsaber Forge' && app.job.mode === 'salvage');
  const integ = app.stages.findIndex((s) => s.type === 'Integration');
  ok('the salvage list has an Integration phase (denominator)', integ >= 0);
  // The shim injects the TOTAL of the next Roll: 1 is the clamped 1d-3 the burn lands as.
  queue(...Array.from({ length: integ }, () => 5), 18, 1);
  for (let i = 0; i <= integ; i++) await app.rollStage({ modifier: 0 });
  ok('the Integration crit ends the run and rolls the burn (1d-3 = 1, clamped)', app.run.failed && app.run.crafterDamage === 1, `${app.run.crafterDamage}`);
  const hpMax = actor.stats.currentValues.hitPoints;
  await actor.update({ 'system.currentHitPoints': null });
  await app.finalize();
  ok('finalize applies the crafter damage from a FULL pool (applyCrafterDamage: null means full)', actor.system.currentHitPoints === hpMax - 1, `${actor.system.currentHitPoints} vs ${hpMax}`);
  ok('the salvaged saber is consumed', !actor.items.get(saber.id));
  await app.close();
}

// ---- 10. Dossier Importer -------------------------------------------------------------------------------------------
{
  const vex = engine.characterTemplateStore.vexKorta;
  const vexSheet = engine.loadIncomingSheet(structuredClone(vex.data)).data;
  const file = { name: 'vex.json', text: JSON.stringify(engine.convertSheetToJson(vexSheet, engine.getCalculatedStats(vexSheet))) };
  const broken = { name: 'broken.json', text: '{ not json' };
  for (const a of [...game.actors.values()]) if (a.name === 'Vex Korta' || a.name.startsWith('Vex Korta (')) game.actors.delete(a.id);
  const app = await DossierImporter.open();
  ok('the importer opens for the GM', !!app && app.rendered);
  await app.addFiles([file, broken]);
  const plan = await app.planImport();
  ok('the plan names the invalid file with its reason and the valid one as create', plan.length === 2 && plan[0].action === 'create' && plan[1].action === 'invalid' && typeof plan[1].reason === 'string' && plan[1].reason.length > 0, JSON.stringify(plan));
  ok('a plan writes nothing (dry run)', !game.actors.contents.some((a) => a.name === 'Vex Korta'));
  const ctx = await app._prepareContext({});
  ok('the plan table renders the tally', /1 create/.test(ctx.dossier.tally) && /1 invalid/.test(ctx.dossier.tally));
  const results = await app.runImport();
  const created = game.actors.contents.find((a) => a.name === 'Vex Korta');
  ok('Import creates the actor through bulkImportFiles', !!created && results[0].ok && results[0].actorId === created.id);
  ok('the new actor is hidden from players (ownership default NONE)', created.ownership?.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
  ok('the invalid file is reported, not written', results[1].ok === false && results[1].action === 'invalid');
  await app.submitForm({ 'dossier.policy': 'skip' });
  const r2 = await app.runImport();
  ok('under Skip a second import of the same name is skipped with the reason', r2[0].action === 'skip' && /already/.test(r2[0].reason ?? ''));
  await app.submitForm({ 'dossier.policy': 'copy' });
  const r3 = await app.runImport();
  ok('under Save as copy it lands as "Vex Korta (1)"', r3[0].action === 'copy' && r3[0].finalName === 'Vex Korta (1)' && game.actors.contents.some((a) => a.name === 'Vex Korta (1)'));
  await app.submitForm({ 'dossier.policy': 'overwrite' });
  const r4 = await app.runImport();
  ok('under Overwrite the existing actor is replaced in place (same id)', r4[0].action === 'overwrite' && r4[0].actorId === created.id);
  await app.invokeAction('clear');
  ok('Clear empties the batch', app.files.length === 0 && app.plan === null);
  await app.close();
  const user = game.user; const wasGM = user.isGM; user.isGM = false;
  ok('a player cannot open the importer', (await DossierImporter.open()) === null);
  user.isGM = wasGM;
}

report(`${Object.keys(TEMPLATES).length} templates, 6 apps, ${named.size} keys`);
