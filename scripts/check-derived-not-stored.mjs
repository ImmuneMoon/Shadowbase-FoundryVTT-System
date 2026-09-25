#!/usr/bin/env node
// check:derived-not-stored
//
// SUBJECT: the data models' prepare methods (module/data/actor-character.mjs
// CharacterData#prepareDerivedData, module/data/item-base.mjs
// ShadowBaseItemData#prepareDerivedData) and the actor document, against the
// rule of docs/ARCHITECTURE.md §4.1/§4.2: derived data is never written to
// `_source`. The derived-only properties are the ones U02a declared
// (docs/REQUESTS.md): `derived`, `sheetCache`, `resources`, `initiative`,
// `engineError` on the actor model; `derived`, `derivedError` on item models.
//
// For every corpus actor (65 templates, the coverage fixtures, the imported
// fixtures/*.json): `_source` serialised before prepareData() is byte-identical
// to `_source` after it (and after a second prepareData, and after an item
// update - the only bytes that may move are the update's own diff);
// toObject() carries none of the derived properties at any depth; every
// item's stored `row` is untouched by its derivation (the persisted figures
// live on `derived.persistedFields`, never on the row).
//
// THE REJECTED ALTERNATIVE, against the app's own code path: the 2025 husk
// merged its derived stats INTO the stored data
// (_husk/scripts/actor.js `foundry.utils.mergeObject(this.system, derivedStats)`
// over a template.json that declared `hitPoints.final` as a stored field), so a
// stale figure could be saved and read back as data. The pin registers a
// throwaway actor model whose prepareDerivedData does exactly that in v13
// terms (`this.updateSource({ hitPoints: <derived> })`) and shows this check's
// own comparator goes red on it - the comparator has teeth, and the real
// model passes it.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - actor-character.mjs prepareDerivedData: `this._source.derived = stats;` added
//       -> "_source byte-identical across prepareData" on every entry
//   - item-base.mjs _deriveBlaster: `Object.assign(this._source.row, persistedFields);` added
//       -> "item row untouched by derivation" on every blaster owner
//   - actor-character.mjs prepareDerivedData: `this.updateSource({ hitPoints: stats.currentValues.hitPoints });` added
//       -> "_source byte-identical" + "hitPoints null stays null" on the blank
//
//   node scripts/check-derived-not-stored.mjs

import { makeReporter, installSystem, loadCorpus, ser } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:derived-not-stored');
const { shim, engine, adapter } = await installSystem();
const { sheetToActorData } = adapter;

const ACTOR_DERIVED = ['derived', 'sheetCache', 'resources', 'initiative', 'engineError'];
const ITEM_DERIVED = ['derived', 'derivedError'];

/** Every key path in an object that names a derived property, at any depth. */
function derivedPaths(obj, names, path = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) { obj.forEach((v, i) => derivedPaths(v, names, `${path}[${i}]`, out)); return out; }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (names.includes(k)) out.push(p);
    derivedPaths(v, names, p, out);
  }
  return out;
}

const corpus = loadCorpus(engine);
ok('corpus loaded (templates + coverage + fixtures)', corpus.length >= 65 + 3 + 3, `${corpus.length}`);

let identical = 0;
let rowsUntouched = 0;
let itemsSeen = 0;
let derivedSeen = 0;
const problems = [];
/**
 * Construct WITHOUT preparing (buildActor prepares once, which would put an
 * idempotent write into the "before" snapshot and hide it). The snapshot is
 * the cleaned, validated source exactly as the database would hold it.
 */
const construct = (data) => new CONFIG.Actor.documentClass(shim.deepClone({ type: 'character', ...data }), { strict: true });

for (const { name, sheet } of corpus) {
  let actor;
  try { actor = construct(sheetToActorData(sheet)); } catch (err) { problems.push(`${name}: build threw ${err.message}`); continue; }
  const before = JSON.stringify(actor._source);
  // Each item's stored row BEFORE any derivation ran (the shim shares the source object with the model).
  const rowsBefore = new Map(actor._source.items.map((i) => [i._id, ser(i.system?.row)]));
  actor.prepareData();
  const after1 = JSON.stringify(actor._source);
  actor.prepareData();
  const after2 = JSON.stringify(actor._source);
  if (before === after1 && after1 === after2) identical++;
  else problems.push(`${name}: _source changed across prepareData (${before.length} -> ${after1.length} -> ${after2.length} bytes)`);
  if (!actor.system.derived) problems.push(`${name}: the engine did not run (${actor.system.engineError})`);
  else derivedSeen++;
  const obj = actor.toObject();
  const leaked = derivedPaths(obj.system, ACTOR_DERIVED).concat(derivedPaths(obj.items, ITEM_DERIVED));
  if (leaked.length) problems.push(`${name}: derived properties in toObject(): ${leaked.slice(0, 5).join(', ')}`);
  let untouched = true;
  for (const item of actor.items) {
    itemsSeen++;
    const stored = rowsBefore.get(item.id);
    if (item.system.derived?.persistedFields) {
      // The persisted figures may differ from the row, but are never written INTO it: the row's stored
      // serialisation after the derivation is what it was before.
      const rowNow = ser(item._source.system.row);
      if (rowNow !== stored) { untouched = false; problems.push(`${name} ${item.type} "${item.name}": row changed by derivation`); }
      const sourceKeys = new Set(Object.keys(item._source.system));
      if ([...sourceKeys].some((k) => ITEM_DERIVED.includes(k))) { untouched = false; problems.push(`${name} ${item.type} "${item.name}": derived key in _source.system`); }
    }
  }
  if (untouched) rowsUntouched++;
}
ok('_source byte-identical across prepareData (twice) for every corpus actor', identical === corpus.length, `${identical}/${corpus.length}`);
ok('the engine produced derived stats for every corpus actor (the comparison is not vacuous)', derivedSeen === corpus.length, `${derivedSeen}/${corpus.length}`);
ok('no derived property in toObject() of any actor or item', !problems.some((p) => p.includes('toObject')));
ok('every item row untouched by its derivation', rowsUntouched === corpus.length, `${rowsUntouched}/${corpus.length}`);
ok('items were examined (denominator)', itemsSeen > 1000, `${itemsSeen}`);
for (const p of problems.slice(0, 12)) ok(p, false);

// ---- an update moves exactly its own diff -------------------------------------------------------
{
  const blank = engine.blank();
  const actor = shim.buildActor(sheetToActorData(blank));
  const before = JSON.parse(JSON.stringify(actor._source));
  const [adv] = await actor.createEmbeddedDocuments('Item', [adapter.rowToItemData({ id: engine.rowId(), name: 'Combat Reflexes', points: 15 }, 'advantages')]);
  await adv.updateRow({ points: 20 });
  const after = JSON.parse(JSON.stringify(actor._source));
  const diff = shim.diffObject(before, after);
  ok('an item update changes only the items array of _source (no derived key rides along)', Object.keys(diff).join(',') === 'items' && after.items.length === before.items.length + 1 && after.items.at(-1).system.row.points === 20, Object.keys(diff).join(','));
  ok('the actor\'s stats moved with the update but stay off _source', actor.system.derived.points.spent === 20 && !('derived' in after.system) && !('resources' in after.system) && !('sheetCache' in after.system) && !('initiative' in after.system));
  ok('hitPoints null on the blank stays null in _source after prepare (never a derived figure written back)', actor._source.system.hitPoints === null && actor.system.derived.currentValues.hitPoints > 0);
}

// ---- the rejected alternative: a model that stores its derived figure ---------------------------------------
{
  const Base = CONFIG.Actor.dataModels.character;
  class HuskLikeData extends Base {
    prepareDerivedData() {
      super.prepareDerivedData();
      // The husk's move in v13 terms: the derived HP written into stored data.
      if (this.derived) this.updateSource({ hitPoints: this.derived.currentValues.hitPoints });
    }
  }
  CONFIG.Actor.dataModels.__husk = HuskLikeData;
  try {
    const data = sheetToActorData(engine.blank());
    data.type = '__husk';
    const actor = construct(data);
    const before = JSON.stringify(actor._source);
    actor.prepareData();
    const after = JSON.stringify(actor._source);
    ok('the rejected alternative (derived HP written to _source in prepareDerivedData) is caught by this comparator: _source changed and hitPoints is no longer null',
      before !== after && actor._source.system.hitPoints !== null && actor._source.system.hitPoints === actor.system.derived.currentValues.hitPoints,
      `${before.length} -> ${after.length} bytes, hitPoints ${JSON.stringify(actor._source.system.hitPoints)}`);
  } finally {
    delete CONFIG.Actor.dataModels.__husk;
  }
}

report(`${corpus.length} corpus actors, ${itemsSeen} items`);
