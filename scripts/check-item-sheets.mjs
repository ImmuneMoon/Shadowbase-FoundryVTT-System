#!/usr/bin/env node
// scripts/check-item-sheets.mjs
//
// check:item-sheets (docs/ARCHITECTURE.md §6.4, §9; unit U08). Subject: the
// item sheets (module/apps/item-sheets/*.mjs, templates/items/**.hbs) over
// shim-built actors and compendium documents.
//
//   1. every one of the 21 Item types has a registered sheet (registerItemSheets
//      through foundry.documents.collections.Items.registerSheet, makeDefault);
//   2. every templates/items/**.hbs COMPILES strict + knownHelpersOnly over the
//      registered helper table, every partial it names is in PARTIALS, and no
//      template carries a literal catalog name (a name from ANY bundle catalog -
//      the sheets read the catalogs, never restate an entry);
//   3. every PART of every sheet RENDERS strict from the live _prepareContext /
//      _preparePartContext for real rows: Rokarr, Kaelen Rarr, Vex Korta, the
//      cybernetics and droid-vessel coverage fixtures (167 owned items across
//      19 types) and one document per Item pack of packs-src/ (the two types the
//      corpus lacks - combatTechnique, armorPart - come from the packs); one
//      root element per part; no unresolved i18n key in the HTML;
//   4. every data-action a template emits has a static handler in the sheet
//      class's actions (core's `tab` excepted);
//   5. the form pipeline, headless, against the engine's own answers:
//      - a blaster slot select bound to an OWNED grip claims the row
//        (isInstalled + installedInBlasterId, BlasterBaseInfo.tsx:121-175) and
//        the slot records its partId; clearing it releases the row; a catalog
//        pick records the template with inventoryId null (a choice, not an
//        acquisition); a Ch11 mod slot writes idField + partIdField;
//      - loading a pack moves it INTO the weapon (the stock row decremented or
//        deleted, the charges following) and unloading puts it back
//        (BlasterAmmunition.tsx:209-262);
//      - a melee list gains / loses entries and an entry claims its row;
//      - a saber's Shared Coupler pick makes it a staff (the second blade's
//        slots and internals appear) and an internal pick writes both fields;
//      - an armor DR entry edit rewrites the WHOLE drEntries array with the
//        other entries byte-identical; a catalog mod pick under Direct Library
//        Access materialises an owned armorPart row and binds it; a powered mod
//        on a piece without a Wired Backing is refused (modFitProblem);
//      - a starship system HP edit rewrites the whole systems array; a chassis
//        change copies the chassis's printed figures;
//      - a trait level select takes the ladder's points; a power level change
//        re-reads the catalog (cpCost follows); the specifier prompt renames the
//        row to the specified instance and refuses a colliding specifier;
//      - an implant install writes the hit location's installedHardwareIds
//        (whole array) and the row's flag; the missing Ch14 flaws become
//        disadvantage rows;
//      - the header: readying stamps equippedAt; Direct Library Access is
//        refused for a player and flips for a GM (never stored on the item);
//        a blank storage select stores null; Field Repair restores the
//        durability; Apply Stress degrades it through weaponStressFor;
//      - nothing derived reaches _source (no `derived` key under system).
//
// Rejected alternatives pinned: rendering non-strict (a missing context key
// renders '' - the husk shipped that way); a hand-built context (proves the
// builder, not the sheet); a slot select that writes only the row field and
// leaves the part row's isInstalled alone (the rebind pin fails).
// Mutations fired while writing it (2026-09-10; each turned the check red, then was restored):
//   - builders.rebindOwnedRow: the `updateEmbeddedDocuments` call removed -> 5 red: the "claims the row" pins for the
//     blaster slot, the Ch11 mod slot, the melee entry, the saber internal, and "clearing the mod slot releases the row";
//   - templates/items/blaster-main.hbs: `{{main.nope}}` added -> 5 red: the strict render pin for every blaster of the
//     corpus and the ranged-weapons pack, the "type rendered at least once" pin, and the blaster pipeline leg (its
//     toggle-library-access re-render throws; the leg reports instead of crashing the check).
// The rejected compositions the pins name (a slot select that writes the row field only; a DR edit that keeps the
// edited entry only) are what those pins fail on.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, ROOT, loadCorpus } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:item-sheets');

const env = await installSystem({ selfTest: false });
const { sys, engine, shim, adapter, translations, config } = env;
sys.registerSheets();
await sys.registerTemplates();
const helpersMod = await import(pathToFileURL(join(ROOT, 'module', 'helpers', 'handlebars.mjs')).href);
const shimApps = await import(pathToFileURL(join(ROOT, 'tools', 'foundry-shim-apps.mjs')).href);
const sheets = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'item-sheets', 'index.mjs')).href);
const builders = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'item-sheets', 'builders.mjs')).href);
const Handlebars = globalThis.Handlebars;
shimApps.setRenderStrict(true);

const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
const text = (v) => (v === null || v === undefined ? '' : String(v));

// ---- 1. every type has a sheet ------------------------------------------------------------------------------------
const registered = globalThis.foundry.documents.collections.Items.registered.filter((r) => r.scope === 'shadowbase');
const registeredTypes = new Set(registered.flatMap((r) => r.options?.types ?? []));
ok('registerSheets registered item sheets (denominator)', registered.length >= 10, `${registered.length} registrations`);
for (const type of config.ITEM_TYPE_NAMES) ok(`Item type "${type}" has a registered sheet (makeDefault)`, registeredTypes.has(type) && registered.some((r) => (r.options?.types ?? []).includes(type) && r.options.makeDefault === true));
for (const type of config.ITEM_TYPE_NAMES) ok(`ITEM_SHEETS.${type} is a ShadowBaseItemSheet subclass`, typeof sheets.ITEM_SHEETS[type] === 'function' && sheets.ITEM_SHEETS[type].prototype instanceof sheets.ITEM_SHEET_CLASSES.ShadowBaseItemSheet);
ok('every registered sheet has a SHADOWBASE.Item.Sheet.<family> label', registered.every((r) => `SHADOWBASE.Item.Sheet.${r.cls.FAMILY}` in translations), registered.map((r) => r.cls.FAMILY).join(','));

// ---- 2. templates compile strict; partials registered; no catalog names ----------------------------------------------
function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else if (ent.name.endsWith('.hbs')) out.push(p);
  }
  return out;
}
const files = walk(join(ROOT, 'templates', 'items')).sort();
ok('templates/items has templates (denominator)', files.length >= 25, `${files.length}`);
const known = {};
for (const name of Object.keys(Handlebars.helpers)) known[name] = true;
for (const name of helpersMod.HELPER_NAMES) known[name] = true;
const sources = {};
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  sources[rel(f)] = src;
  let why = '';
  try { Handlebars.precompile(src, { strict: true, knownHelpersOnly: true, knownHelpers: known }); } catch (e) { why = e.message.split('\n')[0]; }
  ok(`${rel(f)} compiles strict + knownHelpersOnly`, why === '', why);
  for (const m of src.matchAll(/\{\{#?>\s*"([^"]+)"/g)) {
    const name = m[1];
    if (name.startsWith('shadowbase.')) ok(`${rel(f)}: partial "${name}" is registered in PARTIALS`, name in helpersMod.PARTIALS);
    else ok(`${rel(f)}: path partial "${name}" exists`, existsSync(join(ROOT, name.replace(/^systems\/shadowbase\//, ''))));
  }
  for (const m of src.matchAll(/\{\{localize\s+"([^"]+)"/g)) ok(`${rel(f)}: {{localize "${m[1]}"}} resolves in lang/en.json`, m[1] in translations, 'missing key');
}
for (const name of Object.keys(helpersMod.PARTIALS).filter((n) => n.startsWith('shadowbase.item.'))) ok(`PARTIALS ${name} file exists`, existsSync(join(ROOT, helpersMod.PARTIALS[name].replace(/^systems\/shadowbase\//, ''))));
// Every catalog name of the bundle, four characters or longer, must be absent from every template (comments stripped):
// the sheets READ the catalogs through the engine, they never restate an entry.
const catalogNames = new Set();
const collect = (list) => { for (const e of list ?? []) if (e && typeof e.name === 'string' && e.name.length >= 4) catalogNames.add(e.name); };
collect(engine.advantages.advantagesLibrary); collect(engine.disadvantages.disadvantagesLibrary); collect(engine.quirks.allQuirksList); collect(engine.skills.allLibrarySkills);
collect(engine.forcePowers.forcePowersData); collect(engine.techniques.allCombatTechniques); collect(engine.lightsaberForms.lightsaberForms);
collect(engine.equipmentData.equipmentData); collect(engine.armorData.ARMOR_DATA); collect(engine.armorPiecesData.ARMOR_PIECES); collect(engine.armorPartsData.ARMOR_PARTS); collect(engine.armorMods.ARMOR_MOD_DATA);
collect(engine.rangedWeaponProfiles.RANGED_WEAPON_PROFILES); collect(engine.rangedAssembly.ALL_RANGED_PARTS); collect(engine.meleeWeaponProfiles.MELEE_WEAPON_PROFILES); collect(engine.meleeAssembly.ALL_MELEE_PARTS); collect(engine.meleePartsData.MELEE_MATERIALS);
collect(engine.weaponModData.WEAPON_MOD_DATA); collect(engine.ammunitionData.AMMUNITION_DATA); collect(engine.explosiveData.ALL_EXPLOSIVES_DATA);
collect(engine.lightsaberParts.HILT_COMPONENT_TEMPLATES); collect(engine.lightsaberParts.LIGHTSABER_MATERIALS); collect(engine.lightsaberParts.LIGHTSABER_WRAPS); collect(engine.lightsaberParts.allLibraryParts); collect(engine.lightsaberPreconstructed.PRECONSTRUCTED_LIGHTSABERS);
collect(engine.cyberneticsData.NEURAL_IMPLANTS); collect(engine.cyberneticsData.SENSORY_IMPLANTS); collect(engine.cyberneticsData.CYBERNETIC_LIMBS); collect(engine.cyberneticsData.CYBERNETIC_UPGRADES); collect(engine.cyberneticsData.ENHANCEMENT_MODULES);
collect(engine.starshipChassisData.STARSHIP_CHASSIS_DATA); collect(engine.starshipMods.STARSHIP_MODS.filter((m) => m.name !== 'None')); collect(engine.starshipWeapons.STARSHIP_WEAPONS_LIBRARY.filter((w) => w.name !== 'None')); collect(engine.vehicleData.VEHICLE_DATA);
ok('the catalog-name sweep has a denominator', catalogNames.size >= 1500, `${catalogNames.size} names`);
// Comments AND every mustache go (an i18n key such as SHADOWBASE.Item.Saber.Staff is not prose); a bare English word
// ("Status", "Armor", "Shield" are catalog entries too) cannot be told from a restated entry, so the sweep flags names
// that carry a space or run eight characters or longer - every kit, part, mod, material and trait name does.
const stripComments = (s) => s.replace(/\{\{!--[\s\S]*?--\}\}/g, '').replace(/\{\{![\s\S]*?\}\}/g, '').replace(/\{\{[\s\S]*?\}\}/g, ' ');
const namesArray = [...catalogNames].filter((n) => n.includes(' ') || n.length >= 8);
for (const [f, src] of Object.entries(sources)) {
  const body = stripComments(src);
  const hits = namesArray.filter((n) => new RegExp(`(^|[^A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`).test(body));
  ok(`${f}: no literal catalog name`, hits.length === 0, hits.slice(0, 5).join(' | '));
}
// The sweep's positive control: a template that names a catalog entry must be caught.
ok('the catalog-name sweep has teeth', namesArray.some((n) => new RegExp(`(^|[^A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`).test('<option>Combat Reflexes</option>')));

// ---- 4. data-actions <-> handlers ----------------------------------------------------------------------------------------
const familyOfTemplate = (f) => f.replace(/^templates\/items\//, '').split('-')[0].replace(/\.hbs$/, '');
const partialActions = new Set();
for (const [f, src] of Object.entries(sources)) {
  const actions = [...src.matchAll(/data-action="([a-zA-Z-]+)"/g)].map((m) => m[1]).filter((a) => a !== 'tab');
  const family = familyOfTemplate(f);
  const isShared = f.includes('/partials/') || ['header', 'tabs', 'notes'].includes(family);
  const classes = isShared ? Object.values(sheets.ITEM_SHEET_CLASSES) : Object.values(sheets.ITEM_SHEET_CLASSES).filter((c) => c.FAMILY === family);
  if (!isShared) ok(`${f}: names a sheet family`, classes.length === 1, family);
  for (const a of actions) {
    if (isShared) partialActions.add(a);
    const handled = classes.some((c) => typeof c.DEFAULT_OPTIONS?.actions?.[a] === 'function' || typeof sheets.ITEM_SHEET_CLASSES.ShadowBaseItemSheet.DEFAULT_OPTIONS.actions[a] === 'function');
    ok(`${f}: data-action="${a}" has a static handler`, handled);
  }
}
ok('the shared templates declare data-actions (denominator)', partialActions.size >= 8, [...partialActions].join(','));

// ---- 3. render every PART strict over the corpus + one document per pack -------------------------------------------------
const corpus = loadCorpus(engine, { templates: false, exports: false });
const subjects = [];
for (const key of ['rokarr', 'kaelenRarr', 'vexKorta']) {
  const t = engine.characterTemplateStore[key];
  let sheet = t.data ?? t;
  sheet = engine.loadIncomingSheet(structuredClone(sheet)).data;
  subjects.push({ name: `template:${key}`, sheet, actorName: t.name });
}
for (const c of corpus) if (/cyberneticsOwnerFixture|droidVesselOwnerFixture/.test(c.name)) subjects.push({ name: c.name, sheet: c.sheet, actorName: c.name });
ok('the render corpus is three templates + two coverage fixtures', subjects.length === 5, subjects.map((s) => s.name).join(', '));
const actors = new Map();
for (const s of subjects) {
  const actor = shim.buildActor(adapter.sheetToActorData(s.sheet, { actorName: s.actorName }));
  globalThis.game.actors.set(actor.id, actor);
  actors.set(s.name, actor);
}
const rootCount = (html) => {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  let depth = 0; let roots = 0;
  for (const m of String(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m;
    if (close) { depth--; continue; }
    if (depth === 0) roots++;
    if (!self && !VOID.has(tag.toLowerCase())) depth++;
  }
  return roots;
};
const renderedTypes = new Set();
let renderedCount = 0;
async function renderOne(label, item) {
  const Cls = sheets.ITEM_SHEETS[item.type];
  const app = new Cls({ document: item });
  let why = '';
  try { await app.render(); } catch (e) { why = e.stack?.split('\n').slice(0, 2).join(' | ') ?? e.message; }
  ok(`${label}: ${item.type} "${item.name}" renders every PART strict`, why === '', why);
  if (why) return null;
  renderedCount++;
  renderedTypes.add(item.type);
  for (const [p, html] of Object.entries(app.parts)) {
    ok(`${label}: ${item.type} PART ${p} has one root element`, rootCount(html) === 1, `${rootCount(html)} roots`);
    ok(`${label}: ${item.type} PART ${p} carries no unresolved i18n key`, !/SHADOWBASE\.[A-Za-z]+\.[A-Za-z.]+/.test(html.replace(/data-[a-z-]+="[^"]*"/g, '')), (html.match(/SHADOWBASE\.[A-Za-z.]+/g) ?? []).slice(0, 3).join(', '));
  }
  ok(`${label}: ${item.type} PARTS are header, tabs, the family tabs, notes`, JSON.stringify(Object.keys(Cls.PARTS)) === JSON.stringify(['header', 'tabs', ...Cls.TAB_IDS]) && Cls.TAB_IDS.at(-1) === 'notes');
  return app;
}
for (const [name, actor] of actors) for (const item of actor.items) await renderOne(name, item);
for (const pack of readdirSync(join(ROOT, 'packs-src'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const file = readdirSync(join(ROOT, 'packs-src', pack.name)).filter((f) => f.endsWith('.json')).sort()[0];
  if (!file) continue;
  const doc = JSON.parse(readFileSync(join(ROOT, 'packs-src', pack.name, file), 'utf8'));
  if (!doc._key?.startsWith('!items!')) continue;
  const { _key, _id, ...data } = doc;
  const item = await globalThis.Item.create(data);
  await renderOne(`pack:${pack.name}`, item);
}
ok('every corpus + pack item rendered (denominator)', renderedCount >= 180, `${renderedCount}`);
for (const type of config.ITEM_TYPE_NAMES) ok(`type "${type}" rendered at least once (corpus or pack)`, renderedTypes.has(type));

// ---- 5. the form pipeline ------------------------------------------------------------------------------------------------
const rokarr = actors.get('template:rokarr');
const kaelen = actors.get('template:kaelenRarr');
const vex = actors.get('template:vexKorta');
const cyber = actors.get('coverage:cyberneticsOwnerFixture');
const vessel = actors.get('coverage:droidVesselOwnerFixture');
const first = (actor, source) => actor.rowsOf(source)[0] ?? null;
const sheetFor = (item) => new (sheets.ITEM_SHEETS[item.type])({ document: item });
const rowOf = (item) => item.system.row;
const byRowId = (actor, id) => actor.items.find((i) => i.system?.row?.id === id) ?? null;
// A leg that throws (an action re-rendering a template that lost a key, a shim gap) is a RED assertion, never a crash.
const leg = async (label, fn) => { try { await fn(); } catch (e) { ok(`${label}: the pipeline leg runs without throwing`, false, e.stack?.split('\n').slice(0, 2).join(' | ') ?? e.message); } };

// -- blaster: slots, mods, ammunition --
await leg('blaster', async () => {
  const blaster = first(rokarr, 'customBlasters');
  ok('Rokarr carries a blaster (denominator)', !!blaster);
  if (blaster) {
    // A loose grip the design can claim: a real Ch11 template row, built the way the parts shop builds one.
    const grip = engine.partAcquisition.buildAcquiredRow('ranged', 'rifle-stock', 'durasteel', 1, engine.rowId(), 'bought');
    ok('buildAcquiredRow builds a Rifle Stock row (denominator)', !!grip && grip.category === 'Ranged Grip', JSON.stringify(grip ?? null).slice(0, 120));
    const [gripItem] = await rokarr.createEmbeddedDocuments('Item', [adapter.rowToItemData(grip, 'weaponModifications', adapter.nextSort(rokarr, 'weaponModifications'))]);
    // The kit's own grip is fitted; the design is locked (built). Swap Components first (releaseBuild), as the card does.
    let app = sheetFor(blaster);
    await app.invokeAction('release-build');
    ok('release-build: the weapon is a design again (isConstructed false)', rowOf(blaster).isConstructed === false);
    const oldGripId = rowOf(blaster).gripPart?.inventoryId ?? null;
    ok('release-build: the previously fitted grip row went back to stock', !!oldGripId && byRowId(rokarr, oldGripId)?.system.row.isInstalled === false);
    app = sheetFor(blaster);
    await app.submit({ 'slot.gripPart': builders.invValue(grip.id) });
    ok('slot select (owned row): the slot records inventoryId + partId', rowOf(blaster).gripPart?.inventoryId === grip.id && rowOf(blaster).gripPart?.partId === 'rifle-stock');
    ok('slot select (owned row): the row is claimed (isInstalled, installedInBlasterId, equipped)', gripItem.system.row.isInstalled === true && gripItem.system.row.installedInBlasterId === rowOf(blaster).id && gripItem.system.row.equipped === true);
    ok('slot select: the engine resolves the slot to the owned row', engine.rangedAssembly.resolveRangedSlot(rowOf(blaster).gripPart, rokarr.rowsOf('weaponModifications').map(rowOf)).ownedRowId === grip.id);
    app = sheetFor(blaster);
    await app.submit({ 'slot.gripPart': builders.libValue('hold-out-grip') });
    ok('slot select (catalog pick): the template is recorded with inventoryId null (a choice, not an acquisition)', rowOf(blaster).gripPart?.partId === 'hold-out-grip' && rowOf(blaster).gripPart?.inventoryId === null);
    ok('slot select (catalog pick): the previously claimed row is released', gripItem.system.row.isInstalled === false && gripItem.system.row.installedInBlasterId === null);
    ok('slot select (catalog pick): the plan lists it as chosen-not-owned', engine.weaponBuild.planBlasterBuild(rowOf(blaster), rokarr.rowsOf('weaponModifications').map(rowOf), null).shoppingList.some((s) => s.key === 'gripPart'));
    app = sheetFor(blaster);
    await app.submit({ 'material.gripPart': 'phrik' });
    ok('material select writes the slot materialId', rowOf(blaster).gripPart?.materialId === 'phrik');
    // A Ch11 mod slot: the weapon class of Rokarr's Bowcaster has Sights/Optics.
    const modSlots = engine.weaponModData.rangedModSlotsFor(app.category(), rowOf(blaster).baseSkill);
    ok('the Bowcaster has Ch11 mod slots (denominator)', modSlots.includes('Sights/Optics'), modSlots.join(','));
    const sights = engine.fittedGoods.rangedModSlot('Sights/Optics');
    app = sheetFor(blaster);
    await app.submit({ [`mod.${sights.idField}`]: builders.libValue('Rangefinder') });
    ok('mod slot (catalog pick): partIdField set, idField null', rowOf(blaster)[sights.partIdField] === 'Rangefinder' && rowOf(blaster)[sights.idField] === null);
    const modRow = { id: engine.rowId(), name: 'Rangefinder', category: 'Sights/Optics', cost: 100, weight: 0.3, equipped: false, isInstalled: false, quantity: 1 };
    const [modItem] = await rokarr.createEmbeddedDocuments('Item', [adapter.rowToItemData(modRow, 'weaponModifications', adapter.nextSort(rokarr, 'weaponModifications'))]);
    app = sheetFor(blaster);
    await app.submit({ [`mod.${sights.idField}`]: builders.invValue(modRow.id) });
    ok('mod slot (owned row): idField = the row uuid, partIdField = its catalog key, the row claimed', rowOf(blaster)[sights.idField] === modRow.id && rowOf(blaster)[sights.partIdField] === 'Rangefinder' && modItem.system.row.isInstalled === true);
    ok('tallyRangedMods sees the fitted mod through the row', engine.fittedGoods.tallyRangedMods(rowOf(blaster), rokarr.rowsOf('weaponModifications').map(rowOf)).value > 0);
    // Ammunition: a spare Rifle Power Pack (x1) loads into the weapon and comes back out.
    const before = rowOf(blaster).loadedAmmunitionId;
    const spare = first(rokarr, 'ammunition');
    ok('Rokarr carries a spare pack (denominator)', !!spare && spare.system.row.name === 'Rifle Power Pack');
    if (spare) {
      const spareId = spare.system.row.id;
      const spareQty = spare.system.row.quantity;
      app = sheetFor(blaster);
      await app.submit({ 'ammo.loaded': spareId });
      ok('load: the weapon holds the pack (loadedAmmunitionId, loadedAmmunitionData quantity 1, charges follow)', rowOf(blaster).loadedAmmunitionId === spareId && rowOf(blaster).loadedAmmunitionData?.quantity === 1 && rowOf(blaster).currentCharges === spare.system.row.currentCharges);
      // BlasterAmmunition.tsx:220-247 in order: the OLD pack (the kit's own Rifle Power Pack) stacks onto the spare when
      // the names agree (+1), then the spare is decremented (-1) or spliced when it was the last one.
      const stacked = spare.system.row.name === 'Rifle Power Pack' && typeof before === 'string';
      const expectedQty = stacked ? spareQty : spareQty - 1;
      ok('load: the stock row follows the website stack-then-decrement order (BlasterAmmunition.tsx:220-247)', expectedQty >= 1 ? byRowId(rokarr, spareId)?.system.row.quantity === expectedQty : byRowId(rokarr, spareId) === null, `expected ${expectedQty}, got ${byRowId(rokarr, spareId)?.system.row.quantity ?? 'gone'}`);
      ok('load: the previously loaded pack went back to stock (stacked by name or re-created)', rokarr.rowsOf('ammunition').some((i) => i.system.row.name === 'Rifle Power Pack'));
      app = sheetFor(blaster);
      await app.submit({ 'ammo.loaded': '' });
      ok('unload: the weapon is empty (charges 0) and the pack is back in stock', rowOf(blaster).loadedAmmunitionId === null && rowOf(blaster).currentCharges === 0 && rokarr.rowsOf('ammunition').some((i) => i.system.row.name === 'Rifle Power Pack'));
      ok('the loaded id before the exercise was the kit pack (denominator)', typeof before === 'string');
    }
    // Header actions.
    const readiedBefore = !!rowOf(blaster).equipped;
    app = sheetFor(blaster);
    await app.invokeAction('toggle-equipped');
    ok('toggle-equipped (weapon): equipped flips and equippedAt is stamped / cleared', rowOf(blaster).equipped === !readiedBefore && (readiedBefore ? rowOf(blaster).equippedAt === null : typeof rowOf(blaster).equippedAt === 'number'));
    await app.submit({ 'sel.storageLocationId': '' });
    ok('a blank storage select stores null (or leaves the key absent), never ""', rowOf(blaster).storageLocationId == null);
    const box = { id: engine.rowId(), name: 'Locker', description: '' };
    await rokarr.update({ 'system.storageBoxes': [box] });
    await sheetFor(blaster).submit({ 'sel.storageLocationId': box.id });
    ok('a storage select stores the box id', rowOf(blaster).storageLocationId === box.id);
    await sheetFor(blaster).submit({ 'sel.storageLocationId': '' });
    ok('a blank storage select after a box stores null, never ""', rowOf(blaster).storageLocationId === null);
    // Direct Library Access: a player is refused, a GM flips it, nothing is stored.
    const user = globalThis.game.user;
    user.isGM = false;
    app = sheetFor(blaster);
    await app.invokeAction('toggle-library-access');
    ok('Direct Library Access: refused for a player', app.libraryAccess === false);
    user.isGM = true;
    await app.invokeAction('toggle-library-access');
    ok('Direct Library Access: a GM flips it (per window)', app.libraryAccess === true);
    ok('Direct Library Access is never stored on the item', !('libraryAccess' in blaster._source.system) && !('libraryAccess' in (blaster._source.system.row ?? {})));
    const ctx = await app._prepareContext({});
    ok('under Direct Library Access every slot offers the catalog group', ctx.build.slots.every((s) => s.select.groups.some((g) => g.label === translations['SHADOWBASE.Item.Slot.Catalog'])));
    app.libraryAccess = false;
    const ctx2 = await app._prepareContext({});
    ok('without it a slot offers owned rows only (slotScope)', ctx2.build.slots.every((s) => !s.select.groups.some((g) => g.label === translations['SHADOWBASE.Item.Slot.Catalog']) || s.select.groups.find((g) => g.label === translations['SHADOWBASE.Item.Slot.Catalog']).options.length <= 1));
  }
});

// -- melee: entries --
await leg('melee', async () => {
  const melee = first(vex, 'customMeleeWeapons');
  ok('Vex Korta carries a melee weapon (denominator)', !!melee);
  if (melee) {
    let app = sheetFor(melee);
    await app.invokeAction('release-build');
    const guardRow = engine.partAcquisition.buildAcquiredRow('melee', engine.meleeAssembly.meleePartsFor('Melee Guard')[0].id, 'durasteel', 1, engine.rowId(), 'bought');
    const [guardItem] = await vex.createEmbeddedDocuments('Item', [adapter.rowToItemData(guardRow, 'weaponModifications', adapter.nextSort(vex, 'weaponModifications'))]);
    const n = (rowOf(melee).guardParts ?? []).length;
    app = sheetFor(melee);
    await app.invokeAction('add-entry', { key: 'guardParts' });
    ok('add-entry appends an empty guard entry', (rowOf(melee).guardParts ?? []).length === n + 1);
    app = sheetFor(melee);
    await app.submit({ [`entry.guardParts.${n}`]: builders.invValue(guardRow.id), [`entryQty.guardParts.${n}`]: 2 });
    const entry = rowOf(melee).guardParts[n];
    ok('an entry claims its owned row and keeps its quantity', entry.inventoryId === guardRow.id && entry.quantity === 2 && guardItem.system.row.isInstalled === true && guardItem.system.row.installedInMeleeId === rowOf(melee).id);
    ok('meleeSlotEntries resolves the entry to the row', engine.meleeAssembly.meleeSlotEntries(rowOf(melee), vex.rowsOf('weaponModifications').map(rowOf)).some((e) => e.resolved.ownedRowId === guardRow.id && e.resolved.quantity === 2));
    app = sheetFor(melee);
    await app.invokeAction('remove-entry', { key: 'guardParts', index: String(n) });
    ok('remove-entry drops the entry and releases the row', (rowOf(melee).guardParts ?? []).length === n && guardItem.system.row.isInstalled === false);
  }
});

// -- lightsaber: the coupler makes a staff; internals write both fields --
await leg('lightsaber', async () => {
  const saber = first(kaelen, 'lightsabers');
  ok('Kaelen carries a lightsaber (denominator)', !!saber);
  if (saber) {
    let app = sheetFor(saber);
    await app.invokeAction('release-build');
    const coupler = engine.lightsaberAssembly.hiltPartsFor('Coupler Part')[0];
    ok('the catalog has a coupler (denominator)', !!coupler);
    app = sheetFor(saber);
    await app.submit({ 'slot.coupler': builders.libValue(coupler.id) });
    ok('a Shared Coupler pick makes the build a staff (isStaffHilt) and couplerTwo follows it', engine.lightsaberAssembly.isStaffHilt(rowOf(saber)) && rowOf(saber).couplerTwo?.partId === coupler.id);
    let ctx = await sheetFor(saber)._prepareContext({});
    ok('a staff shows the second blade\'s hilt slots and internals', ctx.build.slots.some((s) => s.key === 'emitterTwo') && ctx.internals.slots.some((s) => s.idField === 'primaryCrystalTwo') && ctx.main.isStaff);
    const cell = engine.fittedGoods.lightsaberInternalsCatalog('Lightsaber Power Cell')[0];
    app = sheetFor(saber);
    await app.submit({ 'internal.powerCell': builders.libValue(cell.id) });
    ok('an internal catalog pick writes powerCellPartId and clears powerCell', rowOf(saber).powerCellPartId === cell.id && rowOf(saber).powerCell === null);
    const ownedCell = kaelen.rowsOf('lightsaberModifications').find((i) => i.system.row.category === 'Lightsaber Power Cell');
    ok('Kaelen owns a power cell row (denominator)', !!ownedCell);
    if (ownedCell) {
      app = sheetFor(saber);
      await app.submit({ 'internal.powerCell': builders.invValue(ownedCell.system.row.id) });
      ok('an owned internal writes powerCell (the uuid) + powerCellPartId and claims the row', rowOf(saber).powerCell === ownedCell.system.row.id && typeof rowOf(saber).powerCellPartId === 'string' && ownedCell.system.row.isInstalled === true && ownedCell.system.row.installedInSaberId === rowOf(saber).id);
    }
    app = sheetFor(saber);
    await app.submit({ 'slot.coupler': '' });
    ok('clearing the coupler makes it a single hilt again', !engine.lightsaberAssembly.isStaffHilt(rowOf(saber)));
  }
});

// -- armor: DR entries, mods, powered gate --
await leg('armor', async () => {
  const armor = kaelen.rowsOf('armor').find((i) => (i.system.row.drEntries ?? []).length > 1) ?? first(kaelen, 'armor');
  ok('Kaelen wears armor (denominator)', !!armor);
  if (armor) {
    let app = sheetFor(armor);
    if (!(rowOf(armor).drEntries ?? []).length) await app.invokeAction('reset-dr-entries');
    const entries = rowOf(armor).drEntries ?? [];
    ok('the piece has DR entries (denominator)', entries.length >= 1, `${entries.length}`);
    if (entries.length) {
      const target = entries[0];
      const others = JSON.stringify(entries.slice(1));
      app = sheetFor(armor);
      await app.submit({ [`dr.${target.locationId}`]: Math.max(0, Number(target.dr) - 1) });
      const after = rowOf(armor).drEntries;
      ok('a DR edit rewrites the WHOLE drEntries array with the one entry changed', Array.isArray(after) && after.length === entries.length && after[0].dr === Math.max(0, Number(target.dr) - 1));
      ok('the other entries are byte-identical', JSON.stringify(after.slice(1)) === others);
      const merged = armor.rowWithDerived();
      ok('the sheet shows listedArmorDrAt beside the tracked current DR', (await sheetFor(armor)._prepareContext({})).main.drEntries[0].listed === engine.listedArmorDrAt(merged, target.locationId, kaelen.system.hitLocations));
    }
    // Mods under Direct Library Access: a catalog mod materialises an owned armorPart row and binds it. Kaelen's own
    // pieces may carry no Frame, so a Ch13 catalog Piece with mod slots is dealt onto him for these legs.
    // A Standard frame carries every slot type (SLOT_TYPES_BY_FRAME), so both the fit and the powered gate are reachable.
    const piece = engine.armorPiecesData.ARMOR_PIECES.find((p) => Number(p.modSlots) >= 1 && p.frame === 'Standard') ?? engine.armorPiecesData.ARMOR_PIECES.find((p) => Number(p.modSlots) >= 1 && p.frame);
    const pieceRow = engine.ensureCompleteArmorItem({ id: engine.rowId(), name: piece.name, type: piece.tier, slot: piece.location, pieceId: piece.id, tier: piece.tier, materialId: piece.materialId, frame: piece.frame, sealed: !!piece.sealed, weight: piece.weight, cost: piece.cost, baseDRValue: piece.dr, quantity: 1, equipped: false, isConstructed: true, condition: 'Fine', drEntries: [] });
    const [pieceItem] = await kaelen.createEmbeddedDocuments('Item', [adapter.rowToItemData(pieceRow, 'armor', adapter.nextSort(kaelen, 'armor'))]);
    const modHost = pieceItem;
    const slots = engine.armorModSlots.armorModSlots(rowOf(modHost));
    ok('the dealt Piece has mod slots from its Frame (armorModSlots)', slots.total >= 1 && slots.fromPiece === true, `${slots.total} from ${slots.frame}`);
    app = sheetFor(modHost);
    app.libraryAccess = true;
    const ctx = await app._prepareContext({});
    const modSlot = ctx.build.mods.find((m) => m.select.groups.some((g) => g.label === translations['SHADOWBASE.Item.Slot.Catalog'] && g.options.length));
    ok('the piece offers at least one mod slot with catalog entries under Direct Library Access', !!modSlot, `${slots.total} slots, types ${slots.types.join(',')}`);
    if (modSlot) {
      const catalogGroup = modSlot.select.groups.find((g) => g.label === translations['SHADOWBASE.Item.Slot.Catalog']);
      // The first mod the powered gate accepts.
      const pick = catalogGroup.options.find((o) => { const idx = Number(builders.decodeChoice(o.value).id); return !engine.armorModSlots.modFitProblem(rowOf(modHost), engine.armorMods.ARMOR_MOD_DATA[idx]); });
      ok('a fittable catalog mod exists for the slot', !!pick, catalogGroup.options.map((o) => o.label).slice(0, 3).join(' | '));
      if (pick) {
        const countBefore = kaelen.rowsOf('armorModifications').length;
        await app.submit({ [`armorMod.${modSlot.field}`]: pick.value });
        const bound = rowOf(modHost)[modSlot.field];
        const created = byRowId(kaelen, bound);
        ok('a catalog mod pick creates an owned armorPart row (ArmorModSelector.tsx:149-170) and binds its uuid', kaelen.rowsOf('armorModifications').length === countBefore + 1 && !!created && created.type === 'armorPart');
        ok('the created row is equipped and installed in the piece', !!created && created.system.row.equipped === true && created.system.row.isInstalled === true && created.system.row.installedInArmorId === rowOf(modHost).id);
        ok('calculateModifiedArmor derives the piece with the fitted mod (finalCost at least the piece cost)', modHost.derived !== null && Number(modHost.derived.finalCost) >= Number(pieceRow.cost));
        await sheetFor(modHost).submit({ [`armorMod.${modSlot.field}`]: '' });
        ok('clearing the mod slot releases the row', rowOf(modHost)[modSlot.field] === null && !!created && created.system.row.isInstalled === false && created.system.row.equipped === false);
      }
      // The powered gate: any of the piece's slots that a powered catalog mod fits by slot type and location.
      const poweredPick = ctx.build.mods.map((slot) => ({ slot, powered: engine.armorMods.ARMOR_MOD_DATA.map((m, i) => ({ m, i })).find(({ m }) => engine.armorMods.isPoweredMod({ gurpsEffect: String(m.gurpsEffect ?? '') }) && m.category === engine.armorModSlots.CATEGORY_BY_SLOT_TYPE[slot.type] && (m.validSlots ?? []).includes(rowOf(modHost).slot)) })).find((x) => x.powered) ?? null;
      ok('a powered mod fits one of the dealt Piece\'s slots and the Piece has no Wired Backing (denominator)', !!poweredPick && !engine.armorModSlots.hostsPoweredMods(rowOf(modHost)), poweredPick?.powered?.m?.name ?? 'none');
      if (poweredPick && !engine.armorModSlots.hostsPoweredMods(rowOf(modHost))) {
        await sheetFor(modHost).submit({ [`armorMod.${poweredPick.slot.field}`]: builders.libValue(String(poweredPick.powered.i)) });
        ok('a powered mod on a piece without a Wired Backing is refused (modFitProblem)', rowOf(modHost)[poweredPick.slot.field] === null);
      }
    }
    // Header: wearing goes through applySetEquip; the flag flips.
    const wornBefore = !!rowOf(armor).equipped;
    await sheetFor(armor).invokeAction('toggle-equipped');
    ok('toggle-equipped (armor) flips equipped through gearSets.applySetEquip', rowOf(armor).equipped === !wornBefore);
  }
});

// -- starship: systems array, chassis copy --
await leg('starship', async () => {
  const ship = first(vessel, 'customStarships');
  ok('the droid vessel fixture carries a starship (denominator)', !!ship);
  if (ship) {
    const systems = ship.rowWithDerived().systems ?? [];
    ok('the starship has the nine derived systems (denominator)', systems.length === 9, `${systems.length}`);
    const sys0 = systems[0];
    const app = sheetFor(ship);
    await app.submit({ [`sys.${sys0.id}.hp`]: Math.max(0, Number(sys0.hp) - 3), [`sys.${sys0.id}.status`]: 'Damaged' });
    const after = rowOf(ship).systems;
    ok('a system edit rewrites the whole systems array on the row (mergeSystems keeps hp)', Array.isArray(after) && after.length === 9 && after[0].hp === Math.max(0, Number(sys0.hp) - 3) && after[0].status === 'Damaged');
    ok('mergeSystems keeps the edited hp on the next prepare', (ship.rowWithDerived().systems ?? [])[0]?.hp === Math.max(0, Number(sys0.hp) - 3));
    const other = engine.starshipChassisData.STARSHIP_CHASSIS_DATA.find((c) => c.name !== rowOf(ship).baseChassis);
    await sheetFor(ship).submit({ 'system.row.baseChassis': other.name });
    ok('a chassis change copies the chassis\'s printed figures (customized-starship-item.tsx:48-62)', rowOf(ship).baseChassis === other.name && rowOf(ship).baseHp === other.hp && rowOf(ship).baseCost === other.cost && rowOf(ship).baseHyperdrive === other.hyperdrive);
  }
});

// -- traits and powers: level re-reads the catalog; the specifier prompt --
await leg('traits', async () => {
  const ladder = engine.advantages.advantagesLibrary.find((a) => Array.isArray(a.levels) && a.levels.length >= 2);
  const [adv] = await rokarr.createEmbeddedDocuments('Item', [adapter.rowToItemData({ name: ladder.name, points: ladder.levels[0].points, level: 1, description: '', baselinePoints: 0, category: ladder.category ?? '' }, 'advantages', adapter.nextSort(rokarr, 'advantages'))]);
  await sheetFor(adv).submit({ level: 2 });
  ok('a trait level select takes the ladder\'s points (advantages-section.tsx:63-70)', rowOf(adv).level === 2 && rowOf(adv).points === ladder.levels[1].points);
  const power = first(kaelen, 'forcePowers');
  ok('Kaelen holds a Force power (denominator)', !!power);
  if (power) {
    const rows = engine.forcePowers.forcePowersData.filter((p) => p.name === rowOf(power).name);
    const next = rows.find((p) => p.level !== rowOf(power).level);
    if (next) {
      await sheetFor(power).submit({ level: next.level });
      ok('a power level change re-reads the catalog (cpCost / effect follow)', rowOf(power).level === next.level && rowOf(power).cpCost === next.cpCost && rowOf(power).effect === next.effect);
    }
  }
  const spec = engine.disadvantages.disadvantagesLibrary.find((d) => d.specifierPrompt);
  const [dis] = await rokarr.createEmbeddedDocuments('Item', [adapter.rowToItemData({ name: spec.name, points: spec.levels?.[0]?.points ?? spec.points ?? -5, level: null, description: '', baselinePoints: 0 }, 'disadvantages', adapter.nextSort(rokarr, 'disadvantages'))]);
  const DialogV2 = globalThis.foundry.applications.api.DialogV2;
  DialogV2.queueResponses([{ value: 'Mandalorian Creed' }]);
  await sheetFor(dis).invokeAction('apply-specifier');
  ok('the specifier prompt renames the row to the specified instance (traitSpecifier.specifiedTraitName)', rowOf(dis).name === engine.traitSpecifier.specifiedTraitName(spec.name, 'Mandalorian Creed'));
  ok('the specified row still resolves to its library entry', !!sheets.ITEM_SHEET_CLASSES.TraitSheet.libraryEntry('disadvantages', rowOf(dis).name));
  const colliding = engine.disadvantages.disadvantagesLibrary.find((d) => d.name !== spec.name && engine.traitSpecifier.specifierBase(d.name) === engine.traitSpecifier.specifierBase(spec.name));
  if (colliding) {
    const before = rowOf(dis).name;
    DialogV2.queueResponses([{ value: colliding.name.slice(colliding.name.indexOf('(') + 1, -1) }]);
    await sheetFor(dis).invokeAction('apply-specifier');
    ok('a specifier that names a library entry of its own is refused (specifierCollides)', rowOf(dis).name === before);
  }
});

// -- cybernetics: install writes the anatomy; missing flaws become rows --
await leg('cybernetics', async () => {
  const implant = first(cyber, 'implants');
  ok('the cybernetics fixture carries an implant (denominator)', !!implant);
  if (implant) {
    const live = engine.anatomy.liveLocations(cyber.system.hitLocations);
    const target = live.find((l) => !(l.installedHardwareIds ?? []).includes(rowOf(implant).id)) ?? live[0];
    const before = JSON.stringify(cyber.system.hitLocations.map((l) => ({ ...l, installedHardwareIds: (l.installedHardwareIds ?? []).filter((id) => id !== rowOf(implant).id) })));
    await sheetFor(implant).submit({ install: target.id });
    const loc = cyber.system.hitLocations.find((l) => l.id === target.id);
    ok('install writes the location\'s installedHardwareIds and the row\'s flag', (loc.installedHardwareIds ?? []).includes(rowOf(implant).id) && rowOf(implant).installed === true);
    ok('the hitLocations array is whole and the other rows untouched (ARCHITECTURE §6.5)', Array.isArray(cyber.system.hitLocations) && JSON.stringify(cyber.system.hitLocations.map((l) => ({ ...l, installedHardwareIds: (l.installedHardwareIds ?? []).filter((id) => id !== rowOf(implant).id) }))) === before);
    ok('only one location names the implant', cyber.system.hitLocations.filter((l) => (l.installedHardwareIds ?? []).includes(rowOf(implant).id)).length === 1);
    await sheetFor(implant).invokeAction('uninstall');
    ok('uninstall clears every link and the flag', !cyber.system.hitLocations.some((l) => (l.installedHardwareIds ?? []).includes(rowOf(implant).id)) && rowOf(implant).installed === false);
    await sheetFor(implant).submit({ install: target.id });
    const missing = engine.cyberneticMandatoryFlaws.missingMandatoryFlaws(cyber.rowsOf('disadvantages').map(rowOf), { hasImplants: true, hasLimbs: cyber.rowsOf('cybernetics').some((i) => i.system.row.installed) });
    const countBefore = cyber.rowsOf('disadvantages').length;
    await sheetFor(implant).invokeAction('add-flaws');
    ok('add-flaws creates one disadvantage row per missing Ch14 flaw', cyber.rowsOf('disadvantages').length === countBefore + missing.length);
    ok('after it nothing is missing', engine.cyberneticMandatoryFlaws.missingMandatoryFlaws(cyber.rowsOf('disadvantages').map(rowOf), { hasImplants: true, hasLimbs: cyber.rowsOf('cybernetics').some((i) => i.system.row.installed) }).length === 0);
  }
});

// -- condition: field repair and stress --
await leg('condition', async () => {
  const blaster = first(rokarr, 'customBlasters');
  if (blaster) {
    await sheetFor(blaster).invokeAction('confirm-build');
    const merged = blaster.rowWithDerived();
    const max = merged.maxDurability;
    ok('the built blaster has a measured maximum Durability (denominator)', engine.malfunction.hasBeenMeasured(max), `${max}`);
    const DialogV2 = globalThis.foundry.applications.api.DialogV2;
    DialogV2.queueResponses([{ value: String(Number(max) + 5) }]);
    await sheetFor(blaster).invokeAction('apply-stress');
    const stress = engine.malfunction.weaponStressFor(Number(max) + 5, max, { canSever: true });
    ok('Apply Stress writes weaponStressFor\'s next durability and outcome', rowOf(blaster).durability === stress.nextDurability && rowOf(blaster).condition === stress.outcome);
    await sheetFor(blaster).invokeAction('field-repair');
    ok('Field Repair restores the maximum and Fine', rowOf(blaster).durability === blaster.rowWithDerived().maxDurability && rowOf(blaster).condition === 'Fine');
  }
});

// -- derived never stored --
for (const actor of actors.values()) for (const item of actor.items) ok(`${actor.name}: ${item.type} "${item.name}" stores nothing derived (_source.system has no derived key)`, !('derived' in item._source.system) && !('libraryAccess' in item._source.system));

report(`${files.length} templates, ${renderedCount} renders, ${registered.length} sheet registrations`);
