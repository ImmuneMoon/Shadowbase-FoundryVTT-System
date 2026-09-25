#!/usr/bin/env node
// check:json-contract
//
// SUBJECT: the character JSON boundary (docs/ARCHITECTURE.md §9 "json-contract",
// §6.1 Import / Export): module/import-export.mjs over the data layer's
// ShadowBaseActor#importSheet / #exportSheet, against the website's own
// contract, ../ShadowBase Website/docs/CHARACTER_JSON_FORMAT.md.
//
// Pinned:
//   - every key the contract doc quotes (`"key"` in its section-2 tables and
//     the row examples) survives fixtures/export-sahrhie-vosst-2026-09-06.json
//     -> importJson (through a shim actor: delete-all / update / create-all)
//     -> exportJson: the key is present somewhere in the exported file, at any
//     depth, exactly as spelled (the doc's stale `shipPosition` "object | null"
//     row is a type note, not a key, and needs no exception);
//   - the FOUNDRY ROUTE EQUALS THE WEBSITE ROUTE: the exported file deep-equals
//     convertSheetToJson(applyLoadMigrations(convertJsonToSheet(file))) run
//     directly on the bundle (uuids the blank sheet mints masked, `lastSaved`
//     ignored). The rejected alternative - an exporter that re-shapes rows on
//     the Foundry side - would differ on the first row it touched;
//   - points.spent is 245 (the fixture's fixed target, ARCHITECTURE.md §9),
//     HP 12 / Dodge 10 / Basic Speed 6 on the exported characteristics;
//   - a second import of the export is idempotent (export(import(export)) ==
//     export), the round trip the website's character-export-guide promises;
//   - the item envelope: exportItemEnvelope of a kit-built blaster carries its
//     parts closure (weaponModifications + the loaded pack), importItemEnvelope
//     onto a blank actor creates the weapon and every part rebound to the new
//     host id with placement stripped, and a same-name import resolves as
//     'rename' headlessly (the website's four-way choice; check the Rename leg
//     end to end and the Stack leg on quantity);
//   - bulkImportFiles plans the way bulk-import.ts does: 'skip' leaves an
//     existing name alone, 'copy' creates "Name (1)", 'overwrite' replaces;
//   - the character export filename is use-character-actions.ts:124's
//     `<name>_shadowbase.json`, spaces to underscores, lowercased;
//   - an item envelope handed to importJson is routed to the item importer,
//     never applied as a character (the two formats are distinct, §0.1).
//
// MUTATIONS FIRED (each turned this check red, then was restored; 2026-09-10):
//   - import-export.mjs exportJson: `data.points.spent = 0` before saving          -> "points.spent 245" and the "ONLY persisted keys" leg (spent is not one)
//   - import-export.mjs importJson: `delete file.inventory` before importSheet    -> route equality (characteristics, inventory) and the bounded-mask leg
//   - import-export.mjs exportJson: renaming an armour row on the way out         -> route equality on inventory and the bounded-mask leg (`name` is not a persisted key)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, ROOT, WEB, ser } from './lib/harness.mjs';

const { ok, fail, report } = makeReporter('check:json-contract');
const { shim, engine, adapter } = await installSystem({ selfTest: false });
const ie = await import(pathToFileURL(join(ROOT, 'module', 'import-export.mjs')).href);

const docPath = join(WEB, 'docs', 'CHARACTER_JSON_FORMAT.md');
const fixturePath = join(ROOT, 'fixtures', 'export-sahrhie-vosst-2026-09-06.json');
if (!existsSync(docPath)) fail(`contract doc missing at ${docPath}`);
if (!existsSync(fixturePath)) fail(`fixture missing at ${fixturePath}`);
const doc = readFileSync(docPath, 'utf8');
const file = JSON.parse(readFileSync(fixturePath, 'utf8'));

// ---- the doc's quoted keys (section 2 onward: the field reference) -------------------------
const section2 = doc.slice(doc.indexOf('## 2. Field reference'), doc.indexOf('## 3. Pitfalls'));
const quoted = new Set([...section2.matchAll(/`"([A-Za-z][A-Za-z0-9_]*)"`/g)].map((m) => m[1]));
// The row examples (json fences) name keys as "key": ...
for (const m of section2.matchAll(/```json[\s\S]*?```/g)) for (const k of m[0].matchAll(/"([A-Za-z][A-Za-z0-9_]*)"\s*:/g)) quoted.add(k[1]);
// Keys quoted as examples of what NOT to write, or that only some rows carry.
// Quoted VALUES and prose the same regex catches (`"key"` is the doc's own word for a key, `"None"` a stunType value, `"General"` the default category).
const NOT_KEYS = new Set(['digital', 'physical', 'character', 'native', 'broken', 'accented', 'fluent', 'Unnamed Character', 'value', 'key', 'None', 'General']);
for (const k of NOT_KEYS) quoted.delete(k);
ok('the contract doc yields a usable key list (>= 120 quoted keys)', quoted.size >= 120, `${quoted.size}`);

/** Every key present anywhere in a JSON value. */
function keysDeep(v, into = new Set()) {
  if (Array.isArray(v)) { for (const x of v) keysDeep(x, into); return into; }
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { into.add(k); keysDeep(x, into); } }
  return into;
}

// ---- Foundry route: file -> importJson -> exportJson ---------------------------------------
const actor = shim.buildActor(adapter.sheetToActorData(engine.blank(), { actorName: 'Target' }));
const result = await ie.importJson(actor, JSON.stringify(file));
ok('importJson returns the load notices and the actor takes the file\'s name', !!result && Array.isArray(result.notices) && actor.name === file.name, `${actor.name} vs ${file.name}`);
const exported = ie.exportJson(actor);
ok('exportJson records the download as <name>_shadowbase.json', ie.lastExport.filename === ie.characterExportFilename(file.name) && /^[a-z0-9_]+_shadowbase\.json$/.test(ie.lastExport.filename), ie.lastExport.filename);
ok('the export is a character file', exported?.type === 'character' && exported.name === file.name);

const present = keysDeep(exported);
const missing = [...quoted].filter((k) => !present.has(k));
// Keys the doc names that this fixture cannot carry (it has no rows of that kind): checked on the template corpus instead.
const templateKeys = new Set();
for (const key of ['rokarr', 'kaelenRarr', 'vexKorta', 'assassinDroid', 'wookiee', 'human']) {
  const t = engine.characterTemplateStore[key].data;
  const a = shim.buildActor(adapter.sheetToActorData(t));
  keysDeep(a.exportSheet(), templateKeys);
}
// `fromSpecies` is written only on rows a species package applied (§2.11's example row); no shipped template carries
// one, so a Rokarr whose racial rows are marked proves the trait projection keeps the key.
{
  const rok = engine.characterTemplateStore.rokarr.data;
  const marked = { ...rok, advantages: rok.advantages.map((a) => (a.category === 'Racial' ? { ...a, fromSpecies: 'Wookiee' } : a)) };
  keysDeep(shim.buildActor(adapter.sheetToActorData(marked)).exportSheet(), templateKeys);
}
const jiti = (await import('./lib/harness.mjs')).websiteJiti();
if (jiti) {
  const fx = jiti(join(WEB, 'scripts', 'fixtures', 'vessel-coverage.ts'));
  for (const f of ['vesselOwnerFixture', 'cyberneticsOwnerFixture']) if (fx[f]) keysDeep(shim.buildActor(adapter.sheetToActorData(fx[f].data)).exportSheet(), templateKeys);
}
const stillMissing = missing.filter((k) => !templateKeys.has(k));
ok(`every key the contract doc quotes survives import -> export (${quoted.size - missing.length}/${quoted.size} on the Sahrhie fixture, the rest on the corpus)`, stillMissing.length === 0, `missing: ${stillMissing.join(', ')}`);

// ---- the website route, run on the bundle directly ----------------------------------------
const converted = { ...engine.blankSheetData, ...engine.convertJsonToSheet(JSON.parse(JSON.stringify(file))) };
const loaded = engine.applyLoadMigrations(converted, engine.blankSheetData);
const webStats = engine.getCalculatedStats(loaded.data);
const webExport = engine.convertSheetToJson({ ...loaded.data, damageThrust: webStats.damageThrust, damageSwing: webStats.damageSwing, basicLift: webStats.basicLift }, webStats);
const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.lastSaved; return c; };
// The one declared allowance (ARCHITECTURE.md §9.1 "Round-trip comparison"): Foundry lays every family's persisted
// derived figures over its rows on every prepare (adapter rowWithDerived) - the website writes the same figures only
// when that item's card mounts - so an inventory row may differ from the website's un-mounted export on exactly the
// keys the actor's own items declare as `derived.persistedFields`. Those keys are masked; anything else must match.
const persistedKeys = {};
for (const item of actor.items) for (const k of Object.keys(item.system?.derived?.persistedFields ?? {})) (persistedKeys[item.type] ??= new Set()).add(k);
const TYPE_BY_GROUP = { general: 'equipment', armor: 'armor', explosives: 'explosive', ammunition: 'ammunition', weaponModifications: 'weaponPart', lightsaberModifications: 'weaponPart', armorModifications: 'armorPart', implants: 'implant', cybernetics: 'cyberneticLimb', cyberneticUpgrades: 'cyberneticUpgrade', 'weapons.melee': 'meleeWeapon', 'weapons.blasters': 'blaster', 'weapons.lightsabers': 'lightsaber' };
const maskRows = (inv) => {
  const out = JSON.parse(JSON.stringify(inv));
  const mask = (rows, type) => { for (const row of rows ?? []) for (const k of persistedKeys[type] ?? []) delete row[k]; };
  for (const [group, type] of Object.entries(TYPE_BY_GROUP)) {
    const [g, sub] = group.split('.');
    mask(sub ? out[g]?.[sub] : out[g], type);
  }
  // starships and vehicles share one array; a starship row is the one with baseChassis.
  for (const row of out.starships ?? []) for (const k of persistedKeys[row.baseChassis ? 'starship' : 'vehicle'] ?? []) delete row[k];
  return out;
};
const maskedFoundry = { ...strip(exported), inventory: maskRows(exported.inventory) };
const maskedWeb = { ...strip(webExport), inventory: maskRows(webExport.inventory) };
const routeDiff = [...new Set([...Object.keys(maskedFoundry), ...Object.keys(maskedWeb)])].filter((k) => ser(maskedFoundry[k]) !== ser(maskedWeb[k]));
ok('FOUNDRY ROUTE == WEBSITE ROUTE: the exported file deep-equals convertSheetToJson over the bundle\'s own load path (uuids and the declared persisted derived keys masked)', routeDiff.length === 0, `top-level groups that differ: ${routeDiff.join(', ')}`);
// The allowance is bounded: what differs before masking is ONLY persisted derived keys, and there is at least one such
// difference on this fixture (so the mask is exercised, not vacuous).
const rawDiffKeys = new Set();
(function walk(a, b, path) {
  if (Array.isArray(a) && Array.isArray(b)) { a.forEach((x, i) => walk(x, b[i], path)); return; }
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`); return; }
  if (ser(a) !== ser(b)) rawDiffKeys.add(path.split('.').pop());
})(strip(exported), strip(webExport), '');
const allPersisted = new Set(Object.values(persistedKeys).flatMap((s) => [...s]));
ok('before masking, the two routes differ ONLY on persisted derived keys (and on at least one - the mask is exercised)', rawDiffKeys.size > 0 && [...rawDiffKeys].every((k) => allPersisted.has(k)), `keys: ${[...rawDiffKeys].join(', ')}`);
ok('points.spent is the fixture\'s fixed target 245', exported.points.spent === 245 && webStats.points.spent === 245, `${exported.points.spent}`);
ok('HP 12 / Dodge 10 / Basic Speed 6 on the exported characteristics', exported.characteristics.hitPoints.final === 12 || exported.characteristics.hitPoints.effective === 12, JSON.stringify(exported.characteristics.hitPoints));
ok('Dodge 10 and Basic Speed 6', exported.characteristics.defenses.dodge === 10 && Number(exported.characteristics.basicSpeed.effective ?? exported.characteristics.basicSpeed.final) === 6, `${exported.characteristics.defenses.dodge} / ${JSON.stringify(exported.characteristics.basicSpeed)}`);

// ---- idempotence: export(import(export)) == export ------------------------------------------
const second = shim.buildActor(adapter.sheetToActorData(engine.blank(), { actorName: 'Second' }));
await ie.importJson(second, exported);
const exported2 = ie.exportJson(second);
ok('a second import of the export is idempotent (export(import(export)) == export)', ser(strip(exported2)) === ser(strip(exported)));

// ---- the item envelope --------------------------------------------------------------------
const rokarr = shim.buildActor(adapter.sheetToActorData(engine.characterTemplateStore.rokarr.data));
const blaster = rokarr.rowsOf('customBlasters')[0];
const envelope = ie.exportItemEnvelope(rokarr, blaster);
ok('exportItemEnvelope stamps the envelope (format / kind / version 2) and names the file <slug>.shadowbase-item.json', envelope?.__format === 'shadowbase.item' && envelope.__kind === 'customBlaster' && envelope.__version === engine.itemTransfer.TRANSFER_VERSION && /\.shadowbase-item\.json$/.test(ie.lastExport.filename), ie.lastExport.filename);
const partsCarried = Object.values(envelope?.parts ?? {}).reduce((s, r) => s + r.length, 0);
ok('the envelope carries the parts closure (the kit\'s weaponModifications, plus the loaded pack when one is loaded)', partsCarried >= 3 && Array.isArray(envelope.parts.weaponModifications), JSON.stringify(Object.fromEntries(Object.entries(envelope?.parts ?? {}).map(([k, v]) => [k, v.length]))));

const receiver = shim.buildActor(adapter.sheetToActorData(engine.blank(), { actorName: 'Receiver' }));
const imported = await ie.importItemEnvelope(receiver, JSON.stringify(envelope));
ok('importItemEnvelope creates the weapon and every carried part', imported?.ok && imported.created.length === 1 + partsCarried, `${imported?.created?.length} created (${imported?.reason ?? ''})`);
const newBlaster = receiver.rowsOf('customBlasters')[0];
const newParts = receiver.rowsOf('weaponModifications').map((i) => i.system.row);
ok('the imported weapon has a FRESH id and no placement (equipped false, no storage)', newBlaster && newBlaster.system.row.id !== blaster.system.row.id && newBlaster.system.row.equipped === false && !newBlaster.system.row.storageLocationId);
ok('every carried part is rebound to the NEW host id (installedInBlasterId) with a fresh id', newParts.length > 0 && newParts.every((p) => p.installedInBlasterId === newBlaster.system.row.id && p.id !== blaster.system.row.id) && new Set(newParts.map((p) => p.id)).size === newParts.length);
ok('the imported weapon\'s slots point at the imported parts only (structuralPartRefIds subset of the new part ids)', engine.itemTransfer.structuralPartRefIds(newBlaster.system.row).every((id) => newParts.some((p) => p.id === id)));
// A closed collision dialog (the shim's DialogV2.wait resolves null, as a dismissed DialogV2 does) ignores the file.
const closed = await ie.importItemEnvelope(receiver, JSON.stringify(envelope));
ok('a same-name import with the collision dialog dismissed is ignored (nothing created)', closed && closed.ok === false && closed.reason === 'ignored' && receiver.rowsOf('customBlasters').length === 1, JSON.stringify(closed));
const again = await ie.importItemEnvelope(receiver, JSON.stringify(envelope), { resolution: 'rename' });
const names = receiver.rowsOf('customBlasters').map((i) => i.system.row.customName || i.system.row.name);
ok('the Rename resolution imports under the next free name (import-collision.ts renamedForImport / uniqueName)', again?.ok && receiver.rowsOf('customBlasters').length === 2 && new Set(names).size === 2, names.join(' | '));
const medpac = { __format: 'shadowbase.item', __kind: 'generalEquipment', __version: 2, __exportedAt: new Date().toISOString(), item: { id: engine.rowId(), name: 'Medpac', weight: 1, cost: 204, quantity: 2, condition: 'Fine', category: 'Medical & Pharmaceuticals' } };
await ie.importItemEnvelope(receiver, JSON.stringify(medpac));
const stacked = await ie.importItemEnvelope(receiver, JSON.stringify(medpac), { resolution: 'stack' });
const medpacs = receiver.rowsOf('equipment').filter((i) => i.system.row.name === 'Medpac');
ok('the Stack resolution adds the quantity onto the existing row (applyStack)', stacked?.ok && medpacs.length === 1 && medpacs[0].system.row.quantity === 4, `${medpacs.length} rows, qty ${medpacs[0]?.system.row.quantity}`);
const wrongKind = await ie.importItemEnvelope(receiver, JSON.stringify(medpac), { kind: 'customBlaster' });
ok('a kind mismatch is refused with the website\'s message, not thrown', wrongKind && wrongKind.ok === false && wrongKind.reason === 'wrong-kind');
const routed = await ie.importJson(receiver, JSON.stringify({ ...medpac, item: { ...medpac.item, id: engine.rowId(), name: 'Stimpack' } }));
ok('importJson routes an item envelope to the item importer instead of replacing the actor', routed?.item?.ok === true && receiver.rowsOf('equipment').some((i) => i.system.row.name === 'Stimpack') && receiver.name === 'Receiver');

// ---- roster import (bulk-import.ts) ------------------------------------------------------------
const existing = await Actor.create(adapter.sheetToActorData(engine.characterTemplateStore.rokarr.data));
const rokFile = existing.exportSheet();
const files = [{ name: 'rokarr.json', text: JSON.stringify(rokFile) }, { name: 'vex.json', text: JSON.stringify(shim.buildActor(adapter.sheetToActorData(engine.characterTemplateStore.vexKorta.data)).exportSheet()) }, { name: 'bad.json', text: '{ not json' }];
const skip = await ie.bulkImportFiles(files, 'skip', { dryRun: true });
ok('bulkImportFiles plans skip / create / invalid the way planBulkImport does', skip.tally.skip === 1 && skip.tally.create === 1 && skip.tally.invalid === 1, JSON.stringify(skip.tally));
const copy = await ie.bulkImportFiles(files, 'copy');
ok('policy copy archives the duplicate under "Name (1)" and creates the new one', copy.results.some((r) => r.action === 'copy' && r.ok && /\(1\)$/.test(r.finalName)) && copy.results.some((r) => r.action === 'create' && r.ok), JSON.stringify(copy.results.map((r) => [r.action, r.finalName, r.ok])));
const before = existing.system.derived.points.spent;
const over = await ie.bulkImportFiles([{ name: 'rokarr.json', text: JSON.stringify({ ...rokFile, points: { ...rokFile.points, total: 999 } }) }], 'overwrite');
ok('policy overwrite replaces the existing actor through importSheet', over.results[0]?.action === 'overwrite' && over.results[0].ok && existing.system.pointTotal === 999 && existing.system.derived.points.spent === before, JSON.stringify(over.results[0]));

// ---- portrait: the downscale is a no-op headlessly and keeps a data URL ------------------------
const url = 'data:image/png;base64,iVBORw0KGgo=';
ok('downscalePortrait is a no-op headlessly (no canvas) and leaves non-data-URL values alone', (await ie.downscalePortrait(url)) === url && (await ie.downscalePortrait(null)) === null && (await ie.downscalePortrait('http://x/y.png')) === 'http://x/y.png');

report(`${quoted.size} contract keys, fixture ${fixturePath.split(/[\\/]/).pop()}`);
