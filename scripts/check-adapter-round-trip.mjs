#!/usr/bin/env node
// check:adapter-round-trip
//
// SUBJECT: module/adapter.mjs, the two directions between a website sheet
// (CharacterFormValues) and a Foundry actor (docs/ARCHITECTURE.md §4.3):
//
//   sheet --sheetToActorData--> { system, items, effects } --buildActor (headless v13)--> actor --actorToSheet--> sheet'
//
// THE CORPUS is everything the app can load, read through the load-time
// transforms: the 65 shipped templates, the website's coverage fixtures
// (the only sheets with starships, vehicles, implants, limbs, upgrades),
// and every fixtures/*.json of this repo imported the way the website
// imports a file (convertJsonToSheet -> blank spread -> applyLoadMigrations),
// plus one synthetic entry carrying stored status effects, because no
// template stores any and a round trip of zero effects proves nothing.
//
// INVARIANT (§4.3): sheet' deep-equals sheet up to the DECLARED masks -
//   (a) uuids masked (engine.blank() mints fresh ids for its anatomy/Credit Chip rows);
//   (b) DEAD_ECHO_FIELDS are not stored and come back ABSENT, never null: the generator skips
//       them by name (no schema field), sheetToActorData drops them (not even into legacy), and
//       actorToSheet deletes the blank's own copies - each is proven unread by the engine here;
//   (c) a key the website leaves undefined comes back as the field's initial (Foundry cannot store undefined);
//   (d) a family's PERSISTED derived figures (finalWeight, finalCost, ...) are laid over the row the way the
//       website's cards write them back - the key set is read from item.system.derived.persistedFields, a
//       declaration, never rebuilt here; the stored template figure may be stale, the live one wins;
//   (e) a blank characterName becomes the zod default "Unnamed Character";
//   (f) an empty characterPortrait comes back null (the exporter's own `|| null`);
//   (g) a stored status-effect row comes back with NO_MODIFIERS spread under modifiers and phaseIndex 0.
// AND getCalculatedStats parity on all 32 result keys (31 until the website's 2026-10-02 round added `reeling` -
// Ch7's "below one third of HP": { active, threshold, dodgeBeforeReeling }, the last being the figure an active
// Form's Dodge bonus joins before the halving, module/rolls.mjs). The website computes stats on a sheet whose
// cards have MOUNTED and written their live figures back (engine-load-path: the engine reads stored
// final* fields); Foundry lays the same live figures over the rows on every prepare. So parity is pinned
// against that after-mount sheet on every key of every entry, and against the PRE-mount sheet (the raw
// template / import) with one declared, bounded allowance: a stored figure that is STALE against the live
// derivation (the vessel coverage fixtures' starship finalCost, the 2025 legacy file's armor weights and
// costs) may move points.totalWeight and points.totalCost - the two sums of per-item figures - and
// nothing else; points.spent never moves, on any entry.
//
// THE REJECTED ALTERNATIVE, against the app's own code path: an adapter that
// stores status effects in a system field (`system.statusEffects`, the way
// the website stores them and the way template.json would have). The pin
// hands buildActor an actor datum with `system.statusEffects` set and shows
// the field does not exist (cleaning drops it, SKIPPED_KEYS names it) and the
// row is lost, while the same row as an ActiveEffect (the §4.4 shape) survives
// the trip and reaches the engine.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - adapter.mjs actorToSheet: `sheet.statusEffects = effects.map(...)` -> `sheet.statusEffects = []`
//       -> synthetic entry: "statusEffects: 2 rows -> 0"; "the engine sees the stored bag" pin
//   - adapter.mjs rowToItemData: family always 'weapon'
//       -> coverage entries: lightsaberModifications rows -> 0, weaponModifications doubled
//   - adapter.mjs DEAD_ECHO_FIELDS += 'pointsOther'
//       -> stats parity: points differs on every entry with pointsOther set (unexplained)
//   - adapter.mjs actorToSheet: the `delete sheet[key]` loop over DEAD_ECHO_FIELDS removed (U02c)
//       -> "dead echo pointsSkills is ABSENT from actorToSheet" (the blank's 0 leaks back)
//
//   node scripts/check-adapter-round-trip.mjs [--verbose]

import { makeReporter, installSystem, loadCorpus, ser, UUID } from './lib/harness.mjs';

const VERBOSE = process.argv.includes('--verbose');
const { ok, fail, report } = makeReporter('check:adapter-round-trip');
const { shim, engine, adapter, generated, config, translations } = await installSystem();
const { actorToSheet, sheetToActorData, DEAD_ECHO_FIELDS } = adapter;

// ---- corpus (through the transforms) -------------------------------------------------
const corpus = loadCorpus(engine);
const templates = corpus.filter((c) => c.kind === 'template');
const coverage = corpus.filter((c) => c.kind === 'coverage');
const exportsList = corpus.filter((c) => c.kind === 'export');
ok('65 shipped templates', templates.length === 65, `${templates.length}`);
ok('the website\'s coverage fixtures loaded (vessel owner, droid vessel owner, cybernetics owner)', coverage.length >= 3, coverage.map((c) => c.name).join(', '));
ok('every fixtures/*.json imported (3 declared in fixtures/README.md)', exportsList.length === 3, exportsList.map((c) => c.name).join(', '));
ok('fixtures went through applyLoadMigrations (unit U01 export present)', exportsList.every((c) => c.migrated), 'applyLoadMigrations missing from the bundle - rebuild it');
if (!templates.length) fail('no templates in the bundle');

// The synthetic entry: a template plus the stored rows the website's producers write (a Shock from the
// damage processor, a stimulant with a crash phase, a manual buff), so the effects direction has a denominator.
const rokarr = templates.find((c) => c.name === 'template:rokarr')?.sheet ?? templates[0].sheet;
const STORED_EFFECTS = [
  { id: 'shock-1', name: 'Shock (-3)', type: 'debuff', source: 'Injury', duration: 'Next Turn', expiresAfterTurn: 2, isManual: true, modifiers: { ...engine.NO_MODIFIERS, dexterity: -3, iq: -3 } },
  { id: 'stim-1', name: 'Adrenal Stim', type: 'buff', source: 'Combat Stimulant', description: 'Crash: Lose 4 EP when the effect ends.', isManual: false, isGear: false, duration: '3 minutes', phaseIndex: 0,
    phases: [{ name: 'Adrenal Stim Crash', type: 'debuff', description: 'Recovery period.', duration: 'Recovery Period', modifiers: { endurancePoints: -4 } }],
    modifiers: { ...engine.NO_MODIFIERS, strength: 2, dexterity: 1 } },
  { id: 'manual-1', name: 'Blessing', type: 'buff', source: 'Manual / DM', description: 'GM fiat', isManual: true, isGear: false, duration: '', modifiers: { dodge: 1 } },
];
corpus.push({ name: 'synthetic:rokarr+statusEffects', kind: 'synthetic', sheet: { ...rokarr, statusEffects: STORED_EFFECTS } });

const withRows = (key) => corpus.filter((c) => Array.isArray(c.sheet[key]) && c.sheet[key].length > 0);
// No shipped sheet carries BOTH modification arrays, and the weaponPart family split can only fail on one
// that does: a blaster owner's sheet with a saber owner's sabers and saber parts added.
{
  const gun = withRows('weaponModifications')[0];
  const saber = withRows('lightsaberModifications')[0];
  if (gun && saber) corpus.push({ name: `synthetic:${gun.name.split(':')[1]}+${saber.name.split(':')[1]}-mods`, kind: 'synthetic', sheet: { ...gun.sheet, lightsabers: saber.sheet.lightsabers, lightsaberModifications: saber.sheet.lightsaberModifications } });
}

// Denominators for the split pins: the corpus must be able to express each difference.
for (const key of ['weaponModifications', 'lightsaberModifications', 'customStarships', 'vehicles', 'implants', 'cybernetics', 'cyberneticUpgrades', 'statusEffects']) {
  ok(`corpus has entries with ${key} rows (denominator)`, withRows(key).length > 0, '0 entries');
}
ok('corpus has an entry with BOTH modification arrays (the split can fail)', corpus.some((c) => c.sheet.weaponModifications?.length && c.sheet.lightsaberModifications?.length));

// ---- mask (b): prove the dead-echo list against the engine, over the whole corpus ---------------------
// A key may be dropped by sheetToActorData only if the engine never reads it: garbage in it must leave every
// key of getCalculatedStats unchanged on every entry. The rejected member (pointsOther LOOKS like an echo and
// is read) must move the result on every entry, or the corpus could not tell a dead key from a live one.
const garbage = (v) => (typeof v === 'number' ? 987654 : typeof v === 'string' ? 'ZZZ-GARBAGE' : typeof v === 'boolean' ? !v : { garbage: 987654 });
ok('DEAD_ECHO_FIELDS is the generator\'s DEAD_ECHO_KEYS (one list, two readers)', DEAD_ECHO_FIELDS === generated.DEAD_ECHO_KEYS && DEAD_ECHO_FIELDS.length === 13, `${DEAD_ECHO_FIELDS.length}`);
for (const key of DEAD_ECHO_FIELDS) {
  ok(`DEAD_ECHO_FIELDS "${key}" is a generator-skipped zod key, not a schema field`, key in generated.SKIPPED_KEYS && !generated.SCHEMA_KEYS.includes(key) && key in engine.characterSheetSchema.shape);
  let changed = 0;
  for (const { sheet } of corpus) {
    if (ser(engine.getCalculatedStats({ ...sheet, [key]: garbage(sheet[key]) })) !== ser(engine.getCalculatedStats(sheet))) changed++;
  }
  ok(`DEAD_ECHO_FIELDS "${key}" is never read by the engine (garbage changes no result key on any entry)`, changed === 0, `${changed}/${corpus.length} results changed`);
}
{
  let changed = 0;
  for (const { sheet } of corpus) if (ser(engine.getCalculatedStats({ ...sheet, pointsOther: 987654 })) !== ser(engine.getCalculatedStats(sheet))) changed++;
  ok('pointsOther is read by the engine on every entry and is therefore NOT in DEAD_ECHO_FIELDS (the list\'s rejected member)', changed === corpus.length && !DEAD_ECHO_FIELDS.includes('pointsOther'), `${changed}/${corpus.length}`);
}

// ---- the comparison, mask by mask ----------------------------------------------------------
const ITEM_SOURCES = new Set(generated.ITEM_ROW_ARRAY_KEYS);
const derivedMasked = new Map();  // `${source}.${key}` -> count
const defaulted = new Map();      // key -> count
const persistedKeysByType = {};   // declaration read back from live items

function compareSheets(sheet, back, persisted) {
  const diffs = [];
  for (const key of new Set([...Object.keys(sheet), ...Object.keys(back)])) {
    if (key === 'lastSaved') continue;
    const a = sheet[key];
    const b = back[key];
    if (DEAD_ECHO_FIELDS.includes(key)) continue; // (b)
    if (key === 'characterName' && (a ?? '').trim() === '' && b === translations['SHADOWBASE.Actor.Unnamed']) continue; // (e)
    if (key === 'characterPortrait' && (a ?? '') === '' && b === null) continue; // (f)
    if (a === undefined) { // (c)
      const initial = generated.FIELD_TABLE[key]?.initial;
      if (ser(b) === ser(initial)) { defaulted.set(key, (defaulted.get(key) ?? 0) + 1); continue; }
      diffs.push(`${key}: website undefined, actor ${ser(b)?.slice(0, 80)}`);
      continue;
    }
    if (key === 'statusEffects') { // (g)
      const rowsA = Array.isArray(a) ? a : [];
      const rowsB = Array.isArray(b) ? b : [];
      if (rowsA.length !== rowsB.length) { diffs.push(`statusEffects: ${rowsA.length} rows -> ${rowsB.length}`); continue; }
      rowsA.forEach((ra, i) => {
        const expected = { ...ra, modifiers: { ...engine.NO_MODIFIERS, ...(ra.modifiers ?? {}) }, phaseIndex: ra.phaseIndex ?? 0 };
        if (ser(expected) !== ser(rowsB[i])) diffs.push(`statusEffects[${i}]: ${ser(expected).slice(0, 100)} -> ${ser(rowsB[i]).slice(0, 100)}`);
      });
      continue;
    }
    if (ITEM_SOURCES.has(key)) {
      const rowsA = Array.isArray(a) ? a : [];
      const rowsB = Array.isArray(b) ? b : [];
      if (rowsA.length !== rowsB.length) { diffs.push(`${key}: ${rowsA.length} rows -> ${rowsB.length}`); continue; }
      const type = config.SOURCE_TO_TYPE[key];
      rowsA.forEach((ra, i) => {
        const rb = rowsB[i];
        if ('id' in rb && !('id' in ra)) diffs.push(`${key}[${i}]: an id was minted on a row that had none (rows are stored verbatim)`);
        for (const rk of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
          if (ser(ra[rk]) === ser(rb[rk])) continue;
          if (persisted[type]?.has(rk)) { derivedMasked.set(`${key}.${rk}`, (derivedMasked.get(`${key}.${rk}`) ?? 0) + 1); continue; } // (d)
          diffs.push(`${key}[${i}].${rk}: ${ser(ra[rk])?.slice(0, 60)} -> ${ser(rb[rk])?.slice(0, 60)}`);
        }
      });
      continue;
    }
    if (ser(a) !== ser(b)) diffs.push(`${key}: ${ser(a)?.slice(0, 80)} -> ${ser(b)?.slice(0, 80)}`);
  }
  return diffs;
}

/** The sheet with the actor's live per-item figures laid over its own rows (to EXPLAIN a stats difference, never to hide one). */
function laidOver(sheet, actor) {
  const out = { ...sheet };
  for (const source of ITEM_SOURCES) {
    const rows = Array.isArray(sheet[source]) ? sheet[source] : [];
    const items = actor.rowsOf(source);
    if (rows.length !== items.length) continue;
    out[source] = rows.map((r, i) => ({ ...r, ...(items[i].system?.derived?.persistedFields ?? {}) }));
  }
  return out;
}

/** Mask (g) applied to the engine's INPUT: a stored row's bag is the zod-parsed one (every channel present, phaseIndex 0). */
const normalisedEffects = (sheet) => (Array.isArray(sheet.statusEffects) && sheet.statusEffects.length
  ? { ...sheet, statusEffects: sheet.statusEffects.map((r) => ({ ...r, modifiers: { ...engine.NO_MODIFIERS, ...(r.modifiers ?? {}) }, phaseIndex: r.phaseIndex ?? 0 })) }
  : sheet);

/** The per-item sums that stale stored figures may move (points.spent is deliberately not among them). */
const STALE_FIGURE_SUMS = ['totalWeight', 'totalCost'];

// ---- per entry ------------------------------------------------------------------------------------
let built = 0;
let preMountParity = 0;
let afterMountParity = 0;
const structural = [];
const unexplained = [];
const staleEntries = [];   // entries whose pre-mount figures differ (stale stored final* fields)
let resultKeyCount = 0;
let spentEqual = 0;

for (const entry of corpus) {
  const { name, sheet } = entry;
  let actor;
  try {
    actor = shim.buildActor(sheetToActorData(sheet));
    built++;
  } catch (err) {
    structural.push(`${name}: build threw ${err.message}`);
    continue;
  }
  for (const item of actor.items) {
    const p = item.system?.derived?.persistedFields;
    if (!p) continue;
    (persistedKeysByType[item.type] ??= new Set());
    for (const k of Object.keys(p)) persistedKeysByType[item.type].add(k);
  }
  const back = actorToSheet(actor);
  const diffs = compareSheets(sheet, back, persistedKeysByType);
  if (diffs.length) structural.push(`${name}:\n      ${diffs.slice(0, 8).join('\n      ')}`);

  // Stats parity on every result key: against the after-mount sheet (every key), and against the
  // pre-mount sheet (every key but the two per-item sums a stale stored figure may move).
  const got = actor.system.derived;
  if (!ok(`${name}: engine ran inside prepareDerivedData`, !!got, actor.system.engineError)) continue;
  const preMount = engine.getCalculatedStats(normalisedEffects(sheet));
  const afterMount = engine.getCalculatedStats(normalisedEffects(laidOver(sheet, actor)));
  resultKeyCount = Object.keys(preMount).length;
  if (preMount.points.spent === got.points.spent) spentEqual++;
  const afterDiffs = Object.keys(preMount).filter((k) => ser(afterMount[k]) !== ser(got[k]));
  if (afterDiffs.length === 0) afterMountParity++;
  else unexplained.push(`${name}: differs from the after-mount sheet on ${afterDiffs.join(', ')}`);
  const preDiffs = Object.keys(preMount).filter((k) => ser(preMount[k]) !== ser(got[k]));
  if (preDiffs.length === 0) { preMountParity++; continue; }
  const pointsKeys = Object.keys(preMount.points).filter((k) => preMount.points[k] !== got.points[k]);
  const bounded = preDiffs.join(',') === 'points' && pointsKeys.every((k) => STALE_FIGURE_SUMS.includes(k));
  if (bounded) staleEntries.push(`${name} (${pointsKeys.map((k) => `${k} ${preMount.points[k]} -> ${got.points[k]}`).join(', ')})`);
  else unexplained.push(`${name}: pre-mount difference on ${preDiffs.join(', ')} / points.${pointsKeys.join(',')} is outside the stale-figure allowance`);
  if (VERBOSE) console.log(`  ${name}: pre-mount stats differ on ${preDiffs.join(', ')} (${pointsKeys.join(', ')})`);
}

ok('every corpus entry built through the shim', built === corpus.length, `${built}/${corpus.length}`);
ok('every family with a derivation reported its persisted keys (declaration read back)', ['blaster', 'armor', 'starship', 'meleeWeapon', 'lightsaber'].every((t) => persistedKeysByType[t]?.size), Object.keys(persistedKeysByType).join(','));
ok('actorToSheet round-trips every entry (declared masks only)', structural.length === 0, `\n    ${structural.slice(0, 6).join('\n    ')}`);
ok(`CalculatedStatsResult has the website's 32 keys`, resultKeyCount === 32, `${resultKeyCount}`);
// The 32nd (2026-10-02): `reeling`. Named, so a count that stays 32 while a key is swapped for another still fails.
{
  const blankStats = engine.getCalculatedStats(engine.blank());
  const shape = blankStats.reeling ?? {};
  ok('the 32nd key is `reeling` { active, threshold, dodgeBeforeReeling }: a blank sheet (HP 10, never wounded) is not reeling, reels below 4, Dodge 8 unhalved',
    'reeling' in blankStats && Object.keys(shape).sort().join(',') === 'active,dodgeBeforeReeling,threshold' && shape.active === false && shape.threshold === 4 && shape.dodgeBeforeReeling === 8 && shape.dodgeBeforeReeling === blankStats.currentEncumbrance.dodge, JSON.stringify(shape));
}
ok('points.spent agrees on every entry (persisted figures never move it)', spentEqual === corpus.length, `${spentEqual}/${corpus.length}`);
ok('the actor\'s stats equal the engine\'s on the after-mount sheet, all 32 keys, every entry', afterMountParity === corpus.length && unexplained.length === 0, `${afterMountParity}/${corpus.length}\n    ${unexplained.slice(0, 6).join('\n    ')}`);
ok('pre-mount differences are bounded to points.totalWeight / points.totalCost (stale stored figures)', unexplained.length === 0, `\n    ${unexplained.slice(0, 6).join('\n    ')}`);
ok('the corpus contains stale stored figures, so the allowance is exercised (denominator)', staleEntries.length > 0, '0 entries - the allowance above is untested');
ok('most entries agree with the engine pre-mount too (the allowance is the exception, not the rule)', preMountParity > corpus.length / 2, `${preMountParity}/${corpus.length}`);

// ---- the nulls: never 0 --------------------------------------------------------------------------------
const blank = engine.blank();
const blankActor = shim.buildActor(sheetToActorData(blank));
const blankNulls = generated.NULLABLE_NUMBER_FIELDS.filter((k) => blank[k] === null);
ok('the blank sheet carries null sentinels to test (denominator)', blankNulls.length >= 10, `${blankNulls.length}`);
for (const k of blankNulls) ok(`blank ${k}: null comes back null, not 0`, blankActor.system[k] === null && actorToSheet(blankActor)[k] === null, JSON.stringify(blankActor.system[k]));
{
  const allNull = Object.fromEntries(generated.NULLABLE_NUMBER_FIELDS.map((k) => [k, null]));
  const a = shim.buildActor(sheetToActorData({ ...rokarr, ...allNull }));
  const back = actorToSheet(a);
  ok('every NULLABLE_NUMBER_FIELD set to null on a full template comes back null', generated.NULLABLE_NUMBER_FIELDS.every((k) => a.system[k] === null && back[k] === null));
}

// ---- the splits ----------------------------------------------------------------------------------------------
for (const entry of withRows('lightsaberModifications')) {
  const actor = shim.buildActor(sheetToActorData(entry.sheet));
  const back = actorToSheet(actor);
  ok(`${entry.name}: weaponModifications (${entry.sheet.weaponModifications?.length ?? 0}) and lightsaberModifications (${entry.sheet.lightsaberModifications.length}) split back by weaponPart family`,
    back.weaponModifications.length === (entry.sheet.weaponModifications?.length ?? 0) && back.lightsaberModifications.length === entry.sheet.lightsaberModifications.length
      && actor.rowsOf('lightsaberModifications').every((i) => i.type === 'weaponPart' && i.system.family === 'lightsaber')
      && actor.rowsOf('weaponModifications').every((i) => i.type === 'weaponPart' && i.system.family === 'weapon'));
}
for (const entry of withRows('customStarships')) {
  const actor = shim.buildActor(sheetToActorData(entry.sheet));
  const back = actorToSheet(actor);
  ok(`${entry.name}: customStarships (${entry.sheet.customStarships.length}) and vehicles (${entry.sheet.vehicles?.length ?? 0}) come back as their own arrays`,
    back.customStarships.length === entry.sheet.customStarships.length && back.vehicles.length === (entry.sheet.vehicles?.length ?? 0)
      && actor.rowsOf('customStarships').every((i) => i.type === 'starship') && actor.rowsOf('vehicles').every((i) => i.type === 'vehicle'));
  const json = actor.exportSheet();
  ok(`${entry.name}: the export puts starships and vehicles together in inventory.starships (the website's JSON contract)`, Array.isArray(json.inventory?.starships) && json.inventory.starships.length === entry.sheet.customStarships.length + (entry.sheet.vehicles?.length ?? 0), `${json.inventory?.starships?.length}`);
}

// ---- the fixtures' fixed targets (ARCHITECTURE.md §9; fixtures/README.md) ---------------------------------------
const TARGETS = {
  'export:export-sahrhie-vosst-2026-09-06': { spent: 245, hp: 12, dodge: 10, bs: 6 },
  'export:export-hshif-2026-09-05': { spent: 241, hp: 13, dodge: 9, bs: 6 },
};
for (const [name, t] of Object.entries(TARGETS)) {
  const entry = exportsList.find((c) => c.name === name);
  if (!ok(`${name} is in the corpus`, !!entry)) continue;
  const actor = shim.buildActor(sheetToActorData(entry.sheet));
  const s = actor.system.derived;
  ok(`${name}: Foundry route gives points.spent ${t.spent} / HP ${t.hp} / Dodge ${t.dodge} / Basic Speed ${t.bs}`,
    s.points.spent === t.spent && s.currentValues.hitPoints === t.hp && s.currentEncumbrance.dodge === t.dodge && s.currentValues.basicSpeed === t.bs,
    `${s.points.spent} / ${s.currentValues.hitPoints} / ${s.currentEncumbrance.dodge} / ${s.currentValues.basicSpeed}`);
  ok(`${name}: the file's own points.spent agrees (a current export, not a legacy one)`, entry.raw.points?.spent === t.spent, `${entry.raw.points?.spent}`);
  ok(`${name}: portrait is null in the fixture (fixtures/README.md)`, entry.raw.portrait === null);
}
{
  const entry = exportsList.find((c) => c.name === 'export:legacy-2025-kaelen-rarr');
  if (ok('the legacy Kaelen Rarr fixture is in the corpus', !!entry)) {
    const actor = shim.buildActor(sheetToActorData(entry.sheet));
    const website = engine.getCalculatedStats(entry.sheet).points.spent;
    ok(`legacy Kaelen: Foundry route == website route on points.spent (${website})`, actor.system.derived.points.spent === website, `${actor.system.derived.points.spent}`);
    ok(`legacy Kaelen: the file's stored ${entry.raw.points?.spent} is NOT the engine's ${website} - the fixture still expresses the husk's error, so the pin above is a real one`, entry.raw.points?.spent !== website);
    ok('legacy Kaelen: applyLoadMigrations announced its migrations (a legacy shape)', entry.notices.length > 0, entry.notices.map((n) => n.id).join(','));
  }
}

// ---- status effects: the ActiveEffect shape survives, the rejected system-field shape does not --------------------
{
  const actor = shim.buildActor(sheetToActorData({ ...rokarr, statusEffects: STORED_EFFECTS }));
  const without = shim.buildActor(sheetToActorData({ ...rokarr, statusEffects: [] })).system.derived.modifiers;
  const withM = actor.system.derived.modifiers;
  ok('stored status effects become ActiveEffects (one per row)', actor.effects.filter(adapter.isStatusEffect).length === STORED_EFFECTS.length, `${actor.effects.size}`);
  ok('the engine sees the stored bags through the sheet (DX -3 +1 = -2, dodge +1 over the template\'s own modifiers)', withM.dexterity - without.dexterity === -2 && withM.dodge - without.dodge === 1 && withM.strength - without.strength === 2, `dx ${without.dexterity} -> ${withM.dexterity}, dodge ${without.dodge} -> ${withM.dodge}`);
  ok('system.statusEffects is not a schema key (SKIPPED_KEYS) and never appears on the actor', 'statusEffects' in generated.SKIPPED_KEYS && !generated.SCHEMA_KEYS.includes('statusEffects') && actor.system.statusEffects === undefined && !('statusEffects' in actor.toObject().system));
  // The rejected alternative: the same rows stored in a system field, the website's own layout.
  const data = sheetToActorData({ ...rokarr, statusEffects: [] });
  data.system.statusEffects = STORED_EFFECTS;
  const alt = shim.buildActor(data);
  ok('the rejected alternative (system.statusEffects) is dropped by cleaning: the rows are lost and the engine sees no bag', alt.system.statusEffects === undefined && actorToSheet(alt).statusEffects.length === 0 && alt.system.derived.modifiers.dexterity === 0 && alt.effects.size === 0);
}

// ---- unknown keys survive in system.legacy ------------------------------------------------------------------------------
{
  const a = shim.buildActor(sheetToActorData({ ...blank, someFutureKey: { a: 1 } }));
  ok('an unknown top-level key lands in system.legacy and returns on the sheet (lossless export)', a.system.legacy.someFutureKey?.a === 1 && actorToSheet(a).someFutureKey?.a === 1);
}

// ---- the dead echo keys: dropped on the way in, ABSENT on the way out, never null ---------------------------------------------
{
  const carried = DEAD_ECHO_FIELDS.filter((k) => k in blank);
  ok('engine.blank() carries some dead echo keys with the website\'s defaults (denominator for "absent")', carried.length >= 8, carried.join(','));
  const poisoned = Object.fromEntries(DEAD_ECHO_FIELDS.map((k) => [k, garbage(rokarr[k])]));
  const data = sheetToActorData({ ...rokarr, ...poisoned });
  ok('sheetToActorData stores no dead echo key on system and keeps none as legacy', DEAD_ECHO_FIELDS.every((k) => !(k in data.system) && !(k in data.system.legacy)), DEAD_ECHO_FIELDS.filter((k) => (k in data.system) || (k in data.system.legacy)).join(','));
  const actor = shim.buildActor(data);
  const back = actorToSheet(actor);
  for (const k of DEAD_ECHO_FIELDS) ok(`dead echo ${k} is ABSENT from actorToSheet (not null, not the blank's ${JSON.stringify(blank[k])})`, !(k in back) && actor.system[k] === undefined, JSON.stringify(back[k]));
  ok('the blank actor\'s sheet carries no dead echo key either', DEAD_ECHO_FIELDS.every((k) => !(k in actorToSheet(blankActor))));
  // The export: the exporter reads five of them off the sheet (parry/block, and damage.thrust/swing + basicLift, which
  // ShadowBaseActor#exportSheet fills from the live stats); the file must carry a figure or nothing - never a null echo.
  const json = actor.exportSheet();
  const nulls = [];
  const walk = (v, path) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (['parry', 'block', 'basicLift', 'thrust', 'swing'].includes(k) && x === null) nulls.push(`${path}.${k}`); walk(x, `${path}.${k}`); } };
  walk(json, 'json');
  const stats = actor.system.derived;
  ok('exportSheet fills damage.thrust/swing and basicLift from the live stats (the exporter reads them off the sheet)', JSON.stringify(json).includes(JSON.stringify(stats.damageThrust)) && JSON.stringify(json).includes(JSON.stringify(stats.basicLift)), `${stats.damageThrust} / ${stats.basicLift}`);
  ok('the export carries no null echo for parry/block/basicLift/thrust/swing', nulls.length === 0, nulls.join(','));
}

// ---- report ---------------------------------------------------------------------------------------------------------------
const masked = [...derivedMasked.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} x${n}`).join(', ');
console.log(`(c) website-undefined keys that came back as the field initial: ${[...defaulted.entries()].map(([k, n]) => `${k} x${n}`).join(', ') || '(none)'}`);
console.log(`(d) persisted derived figures laid over stale template figures: ${masked || '(none)'}`);
console.log(`stats: after-mount parity ${afterMountParity}/${corpus.length}; pre-mount parity ${preMountParity}/${corpus.length}; stale stored figures: ${staleEntries.join('; ') || '(none)'}`);
report(`${corpus.length} corpus entries (${templates.length} templates, ${coverage.length} coverage, ${exportsList.length} exports, ${corpus.filter((c) => c.kind === 'synthetic').length} synthetic), ${resultKeyCount} result keys`);
