#!/usr/bin/env node
// tools/smoke-data-layer.mjs
//
// THE ACCEPTANCE SMOKE FOR UNIT U02a (the Foundry data layer core).
//
// For every shipped template in the engine's characterTemplateStore and every
// coverage fixture (scripts/fixtures/vessel-coverage.ts, loaded through the
// website's own jiti exactly as scripts/check-engine-parity.mjs loads them):
//
//   sheet --sheetToActorData--> actor data --buildActor (headless Foundry)--> prepared actor
//
//   1. actor.system.derived.points.spent === engine.getCalculatedStats(sheet).points.spent
//   2. actorToSheet(actor) deep-equals sheet, up to the DECLARED masks below,
//      each of which is either proven here or is a stated consequence of the
//      Foundry storage model:
//        (a) rows are stored VERBATIM - no id is minted (module/adapter.mjs
//            rowToItemData explains why §4.3's "rows missing id get one" loses to
//            the invariant); the comparison tolerates a minted uuid only where the
//            source row had no id, and a pin below asserts that never happens;
//        (b) DEAD_ECHO_FIELDS (module/adapter.mjs) are not stored - PROVEN below:
//            setting any of them to garbage on every corpus entry leaves every
//            key of getCalculatedStats unchanged;
//        (c) a key the website leaves undefined comes back as the field's initial
//            (the zod default the website's own parse would apply) - Foundry
//            cannot store undefined;
//        (d) the family's persisted derived figures (finalWeight, finalCost, ...)
//            are laid over the row by rowWithDerived - reported, never masked
//            silently, and never allowed to move points.spent;
//        (e) a blank characterName becomes the zod default "Unnamed Character"
//            (Foundry refuses a blank document name);
//        (f) an empty characterPortrait comes back null - the exporter's own
//            `portrait: sheetData.characterPortrait || null` (ARCHITECTURE.md §4.3 step 1).
//
// THE REJECTED ALTERNATIVES, pinned against the app's own code path:
//   - derived data written to _source (the old husk kept `characteristics.hitPoints.final`
//     as stored data): actor.toObject().system must carry none of derived /
//     sheetCache / resources / initiative;
//   - hitLocations as Items: the anatomy comes back from system.hitLocations, twelve
//     rows for a humanoid, and is NOT among the Item sources;
//   - insertion order instead of Foundry sort: rowsOf must follow `sort`;
//   - a token bar writing system.resources.hp.value: modifyTokenAttribute must land on
//     system.currentHitPoints;
//   - ActiveEffect changes carrying the modifier bag: every status effect's `changes`
//     must be empty, and the engine must still see the bag through the sheet.
//
// MUTATIONS FIRED (each turned this smoke red, then was restored):
//   - adapter.mjs rowsOf: sort comparator inverted           -> "rowsOf does not follow sort"
//   - adapter.mjs statusEffectToEffectData: changes: [{...}]  -> "changes must be empty"
//   - adapter.mjs sheetToActorData: DEAD_ECHO_FIELDS += 'pointsOther' -> dead-field proof fails 68/68
//   - actor-character.mjs: `this.derived = stats` removed     -> points.spent pin fails on every entry
//   - documents/actor.mjs BAR_FIELDS hp -> 'resources.hp.value' -> bar pin fails
//   - generated schema: hitLocations skipped (SYSTEM_ROW_ARRAYS emptied) -> anatomy pin fails
//
//   node tools/smoke-data-layer.mjs            # exit 0 = green
//   node tools/smoke-data-layer.mjs --verbose  # per-entry detail

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { WEB } from './website-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const VERBOSE = process.argv.includes('--verbose');

let checked = 0;
const problems = [];
const ok = (label, cond, detail) => { checked++; if (!cond) problems.push(`${label}${detail ? ` - ${detail}` : ''}`); return cond; };
const fail = (msg) => { console.error(`smoke:data-layer FAILED - ${msg}`); process.exit(1); };

// ---- headless Foundry --------------------------------------------------------
const shim = await import(pathToFileURL(join(HERE, 'foundry-shim.mjs')).href);
const flatten = (obj, prefix = '') => Object.entries(obj).reduce((acc, [k, v]) => {
  const key = prefix ? `${prefix}.${k}` : k;
  if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(acc, flatten(v, key)); else acc[key] = v;
  return acc;
}, {});
const enJson = JSON.parse(readFileSync(join(ROOT, 'lang', 'en.json'), 'utf8'));
const translations = flatten(enJson);
shim.installFoundryShim({ translations });
await shim.runDocumentSelfTest();
ok('shim self-tests pass', true);

// ---- the system's registration, exactly as the init hook runs it ---------------
const sys = await import(pathToFileURL(join(ROOT, 'module', 'shadowbase.mjs')).href);
sys.registerDataLayer();
sys.registerHooks();
const { engine } = await import(pathToFileURL(join(ROOT, 'module', 'engine.mjs')).href);
const adapter = await import(pathToFileURL(join(ROOT, 'module', 'adapter.mjs')).href);
const gen = await import(pathToFileURL(join(ROOT, 'module', 'data', 'actor-schema.generated.mjs')).href);
const { actorToSheet, sheetToActorData, DEAD_ECHO_FIELDS } = adapter;
ok('CONFIG registered the character model and 21 item models', CONFIG.Actor.dataModels.character && Object.keys(CONFIG.Item.dataModels).length === 21, `${Object.keys(CONFIG.Item.dataModels).length} item models`);
ok('every i18n key the modules reference exists in lang/en.json', (() => {
  const src = ['module/adapter.mjs', 'module/config.mjs', 'module/shadowbase.mjs', 'module/documents/actor.mjs', 'module/documents/item.mjs', 'module/documents/active-effect.mjs', 'module/data/item-base.mjs', 'module/data/actor-character.mjs']
    .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const keys = [...src.matchAll(/'((?:SHADOWBASE|TYPES)\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(keys)].filter((k) => !(k in translations));
  if (missing.length) problems.push(`missing en.json keys: ${missing.join(', ')}`);
  return missing.length === 0;
})());

// ---- corpus ---------------------------------------------------------------------
const unwrap = (t) => (typeof t?.data === 'function' ? t.data() : (t?.data ?? t));
const corpus = [];
for (const key of Object.keys(engine.characterTemplateStore)) corpus.push({ name: `template:${key}`, sheet: unwrap(engine.characterTemplateStore[key]) });
ok('template store has the website\'s 65 entries', corpus.length === 65, `got ${corpus.length}`);
const fixturePath = join(WEB, 'scripts', 'fixtures', 'vessel-coverage.ts');
if (existsSync(join(WEB, 'node_modules', 'jiti')) && existsSync(fixturePath)) {
  const require = createRequire(join(WEB, 'package.json'));
  const jiti = require('jiti')(join(WEB, 'package.json'), { alias: { '@': join(WEB, 'src') }, interopDefault: true, esmResolve: true });
  const fx = jiti(fixturePath);
  const list = Object.entries(fx).filter(([k, v]) => /Fixture$/.test(k) && v && typeof v === 'object' && !Array.isArray(v));
  for (const [key, entry] of list) corpus.push({ name: `fixture:${key}`, sheet: unwrap(entry) });
  ok('coverage fixtures loaded (vessel owner, droid vessel owner, cybernetics owner)', list.length >= 2, list.map(([k]) => k).join(', '));
} else {
  fail(`website jiti or fixture missing (${fixturePath})`);
}

// ---- stable serialisation -----------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stable = (v) => {
  if (v instanceof Map) return { __map: [...v.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, x]) => [k, stable(x)]) };
  if (v instanceof Set) return { __set: [...v].map(stable) };
  if (Array.isArray(v)) return Array.from(v, (x) => stable(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  if (typeof v === 'number' && Number.isNaN(v)) return '__NaN';
  if (typeof v === 'string' && UUID.test(v)) return '<uuid>';
  return v;
};
const ser = (v) => JSON.stringify(stable(v));

// ---- (b) prove the dead-field list against the engine over the whole corpus -------
const garbage = (v) => (typeof v === 'number' ? 987654 : typeof v === 'string' ? 'ZZZ-GARBAGE' : typeof v === 'boolean' ? !v : { garbage: 987654 });
for (const key of DEAD_ECHO_FIELDS) {
  ok(`DEAD_ECHO_FIELDS "${key}" is a generator-skipped zod key, not a schema field (ARCHITECTURE.md §9.1)`, key in gen.SKIPPED_KEYS && !gen.SCHEMA_KEYS.includes(key));
  let changed = 0;
  for (const { sheet } of corpus) {
    const base = ser(engine.getCalculatedStats(sheet));
    const after = ser(engine.getCalculatedStats({ ...sheet, [key]: garbage(sheet[key]) }));
    if (after !== base) changed++;
  }
  ok(`DEAD_ECHO_FIELDS "${key}" is never read by the engine (garbage changes nothing)`, changed === 0, `${changed}/${corpus.length} results changed`);
}
// The rejected alternative for that list: a field that LOOKS dead and is not.
{
  let changed = 0;
  for (const { sheet } of corpus) if (ser(engine.getCalculatedStats(sheet)) !== ser(engine.getCalculatedStats({ ...sheet, pointsOther: 987654 }))) changed++;
  ok('pointsOther is read by the engine and therefore NOT in DEAD_ECHO_FIELDS', changed === corpus.length && !DEAD_ECHO_FIELDS.includes('pointsOther'), `${changed}/${corpus.length}`);
}

// ---- per-entry round trip ------------------------------------------------------------
const persistedKeysByFamily = {};
let built = 0, spentEqual = 0, allKeysEqual = 0;
const derivedDiffs = new Map(); // key -> count
const defaulted = new Map();     // key -> count
const statsKeyDiffs = new Map(); // CalculatedStatsResult key -> count of entries where the actor's differs from the pure sheet's
const itemsByType = new Map();   // item type -> count built across the corpus
const derivedByType = new Map(); // item type -> count with a non-null derivation
const derivedErrors = [];        // per-item derivation failures (must be empty)
const structural = [];
const ITEM_SOURCES = new Set(gen.ITEM_ROW_ARRAY_KEYS);

function compareEntry(name, sheet, back) {
  const diffs = [];
  const keys = new Set([...Object.keys(sheet), ...Object.keys(back)]);
  for (const key of keys) {
    if (key === 'lastSaved') continue;
    const a = sheet[key];
    const b = back[key];
    if (DEAD_ECHO_FIELDS.includes(key)) continue; // (b)
    if (key === 'characterName' && (a ?? '').trim() === '' && b === translations['SHADOWBASE.Actor.Unnamed']) continue; // (e)
    if (key === 'characterPortrait' && (a ?? '') === '' && b === null) continue; // (f)
    if (a === undefined) { // (c)
      const initial = gen.FIELD_TABLE[key]?.initial;
      if (ser(b) === ser(initial)) { defaulted.set(key, (defaulted.get(key) ?? 0) + 1); continue; }
      diffs.push(`${key}: website undefined, actor ${ser(b)?.slice(0, 80)}`);
      continue;
    }
    if (ITEM_SOURCES.has(key)) {
      const rowsA = Array.isArray(a) ? a : [];
      const rowsB = Array.isArray(b) ? b : [];
      if (rowsA.length !== rowsB.length) { diffs.push(`${key}: ${rowsA.length} rows -> ${rowsB.length}`); continue; }
      rowsA.forEach((ra, i) => {
        const rb = { ...rowsB[i] };
        if (!ra.id && UUID.test(rb.id ?? '')) delete rb.id; // (a)
        const rowKeys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
        for (const rk of rowKeys) {
          if (ser(ra[rk]) === ser(rb[rk])) continue;
          const family = CONFIG.SHADOWBASE.SOURCE_TO_TYPE[key];
          const persisted = persistedKeysByFamily[family];
          if (persisted && persisted.has(rk)) { derivedDiffs.set(`${key}.${rk}`, (derivedDiffs.get(`${key}.${rk}`) ?? 0) + 1); continue; } // (d)
          diffs.push(`${key}[${i}].${rk}: ${ser(ra[rk])?.slice(0, 60)} -> ${ser(rb[rk])?.slice(0, 60)}`);
        }
      });
      continue;
    }
    if (ser(a) !== ser(b)) diffs.push(`${key}: ${ser(a)?.slice(0, 80)} -> ${ser(b)?.slice(0, 80)}`);
  }
  return diffs;
}

for (const entry of corpus) {
  const { name, sheet } = entry;
  let actor;
  try {
    const data = sheetToActorData(sheet);
    actor = shim.buildActor(data);
    built++;
  } catch (err) {
    problems.push(`${name}: build threw ${err.message}`);
    continue;
  }
  // Collect the persisted derived keys per item type from the live items (a declaration read back, not rebuilt here).
  for (const item of actor.items) {
    itemsByType.set(item.type, (itemsByType.get(item.type) ?? 0) + 1);
    if (item.system?.derivedError) derivedErrors.push(`${name} ${item.type} "${item.name}": ${item.system.derivedError}`);
    const p = item.system?.derived?.persistedFields;
    if (!p) continue;
    derivedByType.set(item.type, (derivedByType.get(item.type) ?? 0) + 1);
    (persistedKeysByFamily[item.type] ??= new Set());
    for (const k of Object.keys(p)) persistedKeysByFamily[item.type].add(k);
  }
  const expected = engine.getCalculatedStats(sheet);
  const got = actor.system.derived;
  if (!ok(`${name}: engine ran inside prepareDerivedData`, !!got, actor.system.engineError)) continue;
  if (got.points.spent === expected.points.spent) spentEqual++;
  else problems.push(`${name}: points.spent ${got.points.spent} != ${expected.points.spent}`);
  const keyDiffs = Object.keys(expected).filter((k) => ser(expected[k]) !== ser(got[k]));
  if (keyDiffs.length === 0) allKeysEqual++;
  else {
    for (const k of keyDiffs) statsKeyDiffs.set(k, (statsKeyDiffs.get(k) ?? 0) + 1);
    if (VERBOSE) console.log(`  ${name}: stats differ on ${keyDiffs.join(', ')} (persisted derived figures laid over rows)`);
  }
  const back = actorToSheet(actor);
  const diffs = compareEntry(name, sheet, back);
  if (diffs.length) structural.push(`${name}:\n      ${diffs.slice(0, 8).join('\n      ')}`);
  ok(`${name}: derived is not stored`, !['derived', 'sheetCache', 'resources', 'initiative'].some((k) => k in actor.toObject().system));
}
ok('every corpus entry built', built === corpus.length, `${built}/${corpus.length}`);
ok('no item derivation threw across the corpus', derivedErrors.length === 0, derivedErrors.slice(0, 5).join('; '));
for (const family of ['blaster', 'armor', 'starship', 'meleeWeapon', 'lightsaber']) {
  const total = itemsByType.get(family) ?? 0;
  const derived = derivedByType.get(family) ?? 0;
  const live = family === 'meleeWeapon' ? engine.hasExport('calculateMeleeWeaponStats') : family === 'lightsaber' ? engine.hasExport('calculateLightsaberStats') : true;
  if (total && live) ok(`every owned ${family} item derived (${derived}/${total})`, derived === total);
}
ok('points.spent agrees on every entry', spentEqual === corpus.length, `${spentEqual}/${corpus.length}`);
ok('actorToSheet round-trips every entry (declared masks only)', structural.length === 0, `\n    ${structural.slice(0, 6).join('\n    ')}`);

// ---- pins against the rejected alternatives -------------------------------------------
// A throw inside a pin is a failure like any other, reported with the assertions
// that preceded it rather than as a crash that hides them.
try {
  const blank = engine.blank();
  const actor = shim.buildActor(sheetToActorData(blank));
  const sheet = actorToSheet(actor);
  ok('blank sheet: anatomy comes back from system.hitLocations (12 rows), not from Items', sheet.hitLocations.length === 12 && actor.system.hitLocations.length === 12 && !ITEM_SOURCES.has('hitLocations'));
  ok('blank sheet: the Credit Chip is an equipment Item', actor.items.filter((i) => i.type === 'equipment').length === 1 && sheet.equipment[0].name === 'Credit Chip');
  ok('blank sheet: dodge is the engine\'s, not the husk\'s floor(BS)', actor.system.derived.currentEncumbrance.dodge === Math.floor(actor.system.derived.currentValues.basicSpeed) + 3);
  ok('blank sheet: resources follow null-means-full', actor.system.resources.hp.value === actor.system.resources.hp.max && actor.system.resources.hp.max === actor.system.derived.currentValues.hitPoints);
  ok('blank sheet: initiative is Basic Speed + DX/100', actor.system.initiative === actor.system.derived.currentValues.basicSpeed + actor.system.derived.primaryAttributes.effectiveDexterity / 100);
  ok('blank sheet: strength stored 10, and a null primary survives (droid hardware base)', actor.system.strength === 10 && (() => { const a2 = shim.buildActor(sheetToActorData({ ...blank, iq: null })); return a2.system.iq === null; })());

  // sort order, not insertion order
  await actor.createEmbeddedDocuments('Item', [
    adapter.rowToItemData({ id: engine.rowId(), name: 'Second', points: 1 }, 'advantages', 200000),
    adapter.rowToItemData({ id: engine.rowId(), name: 'First', points: 1 }, 'advantages', 100000),
  ]);
  ok('rowsOf follows Foundry sort, not insertion order', actor.rowsOf('advantages').map((i) => i.name).join(',') === 'First,Second');
  ok('nextSort appends after the last row', actor.nextSort('advantages') === 200000 + CONST.SORT_INTEGER_DENSITY);

  // an item update re-derives the actor
  const before = actor.system.derived.points.spent;
  const adv = actor.rowsOf('advantages')[0];
  await adv.updateRow({ points: 15 });
  ok('an item row update re-runs the engine on the actor', actor.system.derived.points.spent === before + 14 && adv.row.points === 15 && adv.row.name === 'First', `${before} -> ${actor.system.derived.points.spent}`);

  // token bars land on the website's own fields
  await actor.modifyTokenAttribute('resources.hp', -3, true, true);
  ok('a token-bar delta on resources.hp writes system.currentHitPoints', actor.system.currentHitPoints === actor.system.resources.hp.max - 3 && actor.system.resources.hp.value === actor.system.currentHitPoints && !('resources' in actor.toObject().system));
  await actor.modifyTokenAttribute('resources.hp', 999, false, true);
  ok('a bar value is clamped to the pool maximum', actor.system.currentHitPoints === actor.system.resources.hp.max);
  await actor.modifyTokenAttribute('resources.hp', -50, true, true);
  ok('HP may go below zero (Ch7 injury), EP may not', actor.system.currentHitPoints < 0 && (await actor.modifyTokenAttribute('resources.ep', -999, true, true), actor.system.currentEndurancePoints === 0));
  await actor.modifyTokenAttribute('resources.pp', 5, false, true);
  ok('resources.pp writes system.powerPoints', actor.system.powerPoints === 5);
  ok('getRollData carries the engine\'s current values and initiative', actor.getRollData().basicSpeed === actor.system.derived.currentValues.basicSpeed && actor.getRollData().initiative === actor.system.initiative);

  // status effects as ActiveEffects: empty changes, bag still seen by the engine
  const row = { id: 'shock-1', name: 'Shock', type: 'debuff', source: 'Wound', isManual: true, isGear: false, expiresAfterTurn: 3, modifiers: { dexterity: -2, iq: -2 } };
  const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [adapter.statusEffectToEffectData(row)]);
  ok('a stored status effect has EMPTY changes and its row under flags.shadowbase.statusEffect', effect.changes.length === 0 && effect.flags.shadowbase.statusEffect.id === 'shock-1' && effect.flags.shadowbase.statusEffect.modifiers.moveMultiplier === 1);
  ok('the effect maps to the CONFIG status id', effect.statuses.has ? effect.statuses.has('shock') : effect.statuses.includes('shock'));
  ok('the engine sees the bag through the sheet (DX -2)', actor.system.derived.modifiers.dexterity === -2 && actor.system.derived.primaryAttributes.effectiveDexterity === 8);
  ok('effectsAsStatusEffects returns the row', actor.effectsAsStatusEffects().length === 1 && actor.effectsAsStatusEffects()[0].name === 'Shock');
  ok('isExpiredAt follows expiresAfterTurn', !effect.isExpiredAt(3) && effect.isExpiredAt(4));
  const removed = await actor.sweepTurn(4);
  ok('sweepTurn removes the expired effect and resets the turn fields', removed.length === 1 && actor.effects.size === 0 && actor.system.parriesThisTurn === 0 && actor.system.facingChangeUsed === false);

  // exportSheet runs the website's exporter on the composed sheet
  const json = actor.exportSheet();
  ok('exportSheet produces a character file with the engine\'s spent points', json.type === 'character' && json.points.spent === actor.system.derived.points.spent && typeof json.characteristics.damage.thrust === 'string');

  // importSheet: guarded with a clear error until U01's applyLoadMigrations is in the bundle, real after
  if (!engine.hasExport('applyLoadMigrations')) {
    let msg = '';
    try { await actor.importSheet(json); } catch (e) { msg = e.message; }
    ok('importSheet fails with a clear error while applyLoadMigrations is missing', /applyLoadMigrations/.test(msg) && /U01/.test(msg), msg);
  } else {
    const rokarr = unwrap(engine.characterTemplateStore.rokarr);
    const target = shim.buildActor(sheetToActorData(engine.blank(), { actorName: 'Target' }));
    const file = shim.buildActor(sheetToActorData(rokarr)).exportSheet();
    const { notices } = await target.importSheet(JSON.stringify(file));
    const expected = engine.getCalculatedStats(rokarr).points.spent;
    ok('importSheet replaces the actor from a character file through convertJsonToSheet + applyLoadMigrations (Rokarr\'s points.spent survives)', target.name === rokarr.characterName && target.system.derived?.points.spent === expected && target.items.size === sheetToActorData(rokarr).items.length, `spent ${target.system.derived?.points.spent} vs ${expected}, items ${target.items.size}, notices ${JSON.stringify(notices).slice(0, 120)}`);
    ok('importSheet accepts a sheet object too, without mutating it, and keepName keeps the actor\'s name', await (async () => { const keeper = shim.buildActor(sheetToActorData(engine.blank(), { actorName: 'Keeper' })); const copy = JSON.parse(JSON.stringify(rokarr)); const before = JSON.stringify(copy); await keeper.importSheet(copy, { keepName: true }); return JSON.stringify(copy) === before && keeper.name === 'Keeper' && keeper.system.derived?.points.spent === expected; })());
  }

  // melee / lightsaber derivation through the U01 exports (live once the bundle carries them)
  if (engine.hasExport('calculateMeleeWeaponStats') && engine.hasExport('calculateLightsaberStats')) {
    const vex = shim.buildActor(sheetToActorData(unwrap(engine.characterTemplateStore.vexKorta)));
    const kaelen = shim.buildActor(sheetToActorData(unwrap(engine.characterTemplateStore.kaelenRarr)));
    const melees = vex.rowsOf('customMeleeWeapons');
    const sabers = kaelen.rowsOf('lightsabers');
    ok('meleeWeapon items derive through calculateMeleeWeaponStats on the owner\'s stats (second pass)', melees.length > 0 && melees.every((m) => m.derived && m.persistedFields && 'canParryWhileAttacking' in m.persistedFields), melees.map((m) => `${m.name}: ${m.derived ? Object.keys(m.persistedFields).join('/') : m.system.derivedError}`).join('; '));
    // The hook's !hasComponents rule as an invariant over the real corpus: a weapon with
    // components gets a computed finalCost; one without keeps the stored figure untouched.
    ok('every melee weapon either derives finalCost (has components) or keeps its stored finalCost (none)', melees.every((m) => {
      const back = actorToSheet(vex).customMeleeWeapons.find((r) => r.id === m.row.id);
      return ('finalCost' in m.persistedFields) ? typeof m.persistedFields.finalCost === 'number' : back?.finalCost === m.row.finalCost;
    }));
    ok('lightsaber items derive through calculateLightsaberStats', sabers.length > 0 && sabers.every((s) => s.derived && typeof s.persistedFields.totalCost === 'number' && typeof s.persistedFields.calculatedDamage === 'string'), sabers.map((s) => `${s.name}: ${s.derived ? Object.keys(s.persistedFields).join('/') : s.system.derivedError}`).join('; '));
    ok('the owner\'s stats after the second pass equal the pure-sheet stats on points.spent', vex.system.derived.points.spent === engine.getCalculatedStats(unwrap(engine.characterTemplateStore.vexKorta)).points.spent);
  }

  // unknown top-level keys survive in system.legacy and come back on the sheet
  const withLegacy = shim.buildActor(sheetToActorData({ ...blank, someFutureKey: { a: 1 } }));
  ok('an unknown top-level key lands in system.legacy and returns on the sheet', withLegacy.system.legacy.someFutureKey?.a === 1 && actorToSheet(withLegacy).someFutureKey?.a === 1);

  // a blank-created actor is seeded from the blank sheet by the preCreate/create hooks
  const fresh = await Actor.create({ name: 'Fresh', type: 'character' });
  ok('Actor.create with no data is seeded from engine.blank() (Credit Chip, 12 anatomy rows, 7000 credits)', fresh.items.size === 1 && fresh.system.hitLocations.length === 12 && fresh.system.totalCredits === engine.wealth.STARTING_CREDITS_BASELINE && fresh.system.derived?.points.spent === 0);
  const prefilled = await Actor.create({ name: 'Given', type: 'character', system: { totalCredits: 5 } });
  ok('Actor.create with system data is NOT overwritten by the seed', prefilled.system.totalCredits === 5 && prefilled.items.size === 0);

  // an item created from a row gets its name and icon from the row and type
  const [blaster] = await actor.createEmbeddedDocuments('Item', [adapter.rowToItemData({ name: 'Blaster Pistol', customName: 'Old Reliable' }, 'customBlasters')]);
  ok('rowToItemData names the Item from customName and sets the type icon', blaster.name === 'Old Reliable' && blaster.img === CONFIG.SHADOWBASE.icons.blaster);
  const [labelled] = await actor.createEmbeddedDocuments('Item', [{ type: 'equipment', name: translations['TYPES.Item.equipment'], img: 'icons/svg/item-bag.svg', system: { row: { name: 'Medpac' }, source: 'equipment' } }]);
  ok('preCreateItem mirrors the row name over a type-label placeholder and sets the type icon', labelled.name === 'Medpac' && labelled.img === CONFIG.SHADOWBASE.icons.equipment);
  const [explicit] = await actor.createEmbeddedDocuments('Item', [{ type: 'equipment', name: 'My Own Name', system: { row: { name: 'Medpac' }, source: 'equipment' } }]);
  ok('an explicit Item name is not overridden by the row', explicit.name === 'My Own Name');
  ok('rows are stored verbatim: no id is minted on a row that had none', (() => { const d = adapter.rowToItemData({ name: 'Combat Reflexes', points: 15 }, 'advantages'); const e = adapter.rowToItemData({ name: 'Medpac' }, 'equipment'); return !('id' in d.system.row) && !('id' in e.system.row); })());
  ok('the engine keys a trait\'s derived effect by name when the row has no id (the reason nothing is minted)', (() => { const s = { ...blank, advantages: [{ name: 'Combat Reflexes', points: 15 }] }; return engine.getCalculatedStats(s).activeStatusEffects.some((e) => e.id === 'adv-Combat Reflexes'); })());
  await blaster.updateRow({ customName: 'Renamed' });
  ok('preUpdateItem mirrors a customName change onto the Item name', blaster.name === 'Renamed');
  ok('blaster derives through calculateBlasterStats with persistedFields', blaster.derived && typeof blaster.derived.finalCost === 'number' && 'finalWeight' in blaster.persistedFields);
  // weaponPart: family decides the source
  const [part] = await actor.createEmbeddedDocuments('Item', [{ type: 'weaponPart', name: 'Crystal', system: { row: { name: 'Crystal' }, family: 'lightsaber', source: 'weaponModifications' } }]);
  ok('a weaponPart with family lightsaber is read as a lightsaberModifications row', part.system.source === 'lightsaberModifications' && actor.rowsOf('lightsaberModifications').length === 1);
  // melee/lightsaber guarded
  const [melee] = await actor.createEmbeddedDocuments('Item', [{ type: 'meleeWeapon', name: 'Vibroblade', system: { row: { name: 'Vibroblade', finalCost: 690, finalWeight: 4.15 }, source: 'customMeleeWeapons' } }]);
  if (!engine.hasExport('calculateMeleeWeaponStats')) {
    ok('meleeWeapon keeps its stored figures while calculateMeleeWeaponStats is missing (derived null, no throw)', melee.derived === null && actorToSheet(actor).customMeleeWeapons[0].finalCost === 690);
  }
} catch (err) {
  checked++;
  problems.push(`a pin threw: ${err.stack?.split('\n').slice(0, 3).join(' | ') ?? err}`);
}

// ---- report ---------------------------------------------------------------------------
const derivedSummary = [...derivedDiffs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} x${n}`).join(', ');
const defaultedSummary = [...defaulted.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} x${n}`).join(', ');
console.log(`items built by type: ${[...itemsByType.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}`).join(', ')}`);
console.log(`items derived by type: ${[...derivedByType.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}/${itemsByType.get(t)}`).join(', ') || '(none)'}`);
console.log(`persisted derived keys by type: ${Object.entries(persistedKeysByFamily).map(([t, s]) => `${t}[${[...s].join(',')}]`).join(' ') || '(none in corpus)'}`);
console.log(`(c) website-undefined keys that came back as the field initial: ${defaultedSummary || '(none)'}`);
console.log(`(d) persisted derived figures that differ from the stored template figure: ${derivedSummary || '(none)'}`);
console.log(`stats agree on all ${Object.keys(engine.getCalculatedStats(corpus[0].sheet)).length} keys for ${allKeysEqual}/${corpus.length} entries; points.spent for ${spentEqual}/${corpus.length}; keys that differ (persisted derived figures in play): ${[...statsKeyDiffs.entries()].map(([k, n]) => `${k} x${n}`).join(', ') || '(none)'}`);
if (problems.length) {
  console.error(`smoke:data-layer FAILED (${problems.length} of ${checked} assertions):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`smoke:data-layer OK - ${checked} assertions, ${corpus.length} corpus entries (65 templates + ${corpus.length - 65} fixtures), ${built} actors built`);
