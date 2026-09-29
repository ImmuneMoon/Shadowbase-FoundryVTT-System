#!/usr/bin/env node
// check:packs
//
// SUBJECT: tools/pack-manifest.mjs (the declaration of every pack) and
// packs-src/ (what tools/build-packs.mjs wrote from it), held against the
// engine bundle, the website's zod schemas, the headless Foundry shim and
// the drop handler:
//   1. manifest <-> bundle BOTH WAYS through NOT_A_PACK: every array-of-objects
//      table in CATALOG_NAMESPACES is consumed by a pack or listed as not-a-pack;
//      every `consumes` and every NOT_A_PACK name exists in the bundle (a renamed
//      export is red, not a silently empty pack). Denominator: the sweep must find
//      at least 60 tables and must flag a fabricated name.
//   2. per pack: source(engine).length == documents on disk == MANIFEST.json count,
//      and the ARCHITECTURE §7 figures (EXPECTED_COUNTS, a declaration of the
//      architecture's numbers) - a catalog that grows or shrinks is visible here;
//   3. ids: unique, 16 base62 chars, _id == documentId(pack, key) (the manifest's
//      own function), _key by type, folders resolve, flags name the pack and key;
//   4. determinism: an in-process rebuild of every pack reproduces packs-src byte
//      for byte and MANIFEST.json's idsHash/contentHash (two builds, one answer);
//   5. names: every document name == docNameFor(pack, sourceRow) - byte-identical
//      to the catalog row it came from (names are join keys);
//   6. kits: every structural reference of a kit weapon (itemTransfer.structuralPartRefIds,
//      the website's own definition) resolves to a part in the kit, every part claims
//      the weapon as host, every part with a partId resolves to its catalog;
//   7. every stored row parses with its website zod schema; every Item document
//      constructs strictly through the shim's registered Item class with its row
//      intact; every template Actor builds and prepares (engine ran, derived set)
//      and its stats equal getCalculatedStats over the website's own template load
//      (applyLoadMigrations(template.data)) on every result key;
//   8. the drop handler (module/compendium-drop.mjs) over a template actor: kit
//      rebinding, per-name Level 1, seeded skill level == baseChargedLevelForSkill,
//      per-limb armor split (two rows, distinct limbs), armor piece cut to the wearer,
//      reference-only refused, duplicate refused, quirk cap refused, explosive named;
//      REFERENCE_ONLY_CATALOGS agrees with the manifest's referenceOnly packs.
//
// THE REJECTED ALTERNATIVE, against the app's own code path: dropping an
// ARMOR_DATA gauntlets row through the Ch13 Piece path because the row
// carries a pieceId (armor-profile-item.ts: the preset-suit rows ARE Pieces).
// That path renames the row after its Piece and hands out ONE row where the
// website's profileToArmorItem deals one per limb; the pin below drops
// "Beskar'gam Gauntlets" on Rokarr and requires two rows on two hands.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - pack-manifest.mjs advantages.key: r.name -> r.name.toLowerCase() -> "flags name the pack and a source key" 0/183
//     and "document name byte-identical" 0/183 (the keys on disk no longer match the declaration)
//   - packs-src/quirks/<one file>: name edited -> "document name == docNameFor" pin
//   - NOT_A_PACK: 'advantages.advantagesList' removed -> "consumed or declared not-a-pack" pin
//   - compendium-drop.mjs armor branch: piece-first order restored -> per-limb split pin (1 row, piece name)
//   - compendium-drop.mjs: re-added Hooks.on('dropActorSheetData', ...) -> "drops route through the sheet's own
//     v13 _onDrop* and NOT the V1-only dropActorSheetData hook" (that hook never fires for an ActorSheetV2)
//
//   node scripts/check-packs.mjs

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, loadTranslations, ROOT, ser } from './lib/harness.mjs';

const { ok, fail, report } = makeReporter('check:packs');
const { shim, engine, adapter } = await installSystem({ selfTest: false });
const M = await import(pathToFileURL(join(ROOT, 'tools', 'pack-manifest.mjs')).href);
const B = await import(pathToFileURL(join(ROOT, 'tools', 'build-packs.mjs')).href);
const drop = await import(pathToFileURL(join(ROOT, 'module', 'compendium-drop.mjs')).href);
const SRC = join(ROOT, 'packs-src');
if (!existsSync(join(SRC, 'MANIFEST.json'))) fail('packs-src/MANIFEST.json missing - run npm run build:packs');
const manifest = JSON.parse(readFileSync(join(SRC, 'MANIFEST.json'), 'utf8'));

/**
 * ARCHITECTURE §7's per-pack figures (a declaration of the architecture, not of the catalogs).
 * 2026-09-28: equipment 128 -> 133 and blueprints 491 -> 495 - the website's 2026-09-21 food round (commit 37c7858):
 * Hot Meal Pack, Caf Ration, Spiced Portions, Field Feast Kit (+4 rows, +4 blueprints) and Caf Concentrate (+1 material
 * row, no blueprint); the website's own check:fabrication-reach moved 491 -> 495 in the same round.
 * 2026-09-28 (b): advantages 183 -> 185 and disadvantages 191 -> 193 - the website's species-package revision
 * (uncommitted on 63eedd3, built dirty): Telecommunication (Smell/Taste), Tinker's Ingenuity; Appearance (Unattractive),
 * Reputation -2 (Manipulative Spies) - racial traits the revised Ch18 packages name, now catalog rows.
 */
const EXPECTED_COUNTS = {
  advantages: 185, disadvantages: 193, quirks: 45, skills: 153, 'force-powers': 48, 'combat-techniques': 14, 'lightsaber-forms': 7,
  equipment: 133, blueprints: 495, armor: 152, 'armor-pieces': 75, 'armor-parts': 101, 'armor-mods': 33, 'ranged-weapons': 51,
  'ranged-parts': 64, 'weapon-mods': 53, ammunition: 43, explosives: 15, 'melee-weapons': 37, 'melee-parts': 22 + 20, lightsabers: 11,
  'lightsaber-parts': 20 + 3 + 13 + 58, implants: 23, 'cybernetic-limbs': 20, 'cybernetic-upgrades': 4 + 3, starships: 6, 'starship-mods': 17,
  'starship-weapons': 9, vehicles: 9, 'droid-parts': 98, templates: 65,
};

const packs = M.PACKS.filter((p) => p.builder !== 'handbook');
ok('31 catalog packs + the handbook declared (32)', M.PACKS.length === 32 && packs.length === 31, `${M.PACKS.length}`);

// ---- 1. manifest <-> bundle both ways --------------------------------------------------------------------------
const resolveExport = (name) => {
  const [ns, key] = name.split('.');
  if (!key) return typeof engine[ns] === 'object' && engine[ns] !== null ? engine[ns] : undefined;
  return engine[ns] && typeof engine[ns] === 'object' ? engine[ns][key] : undefined;
};
const isTable = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && !Array.isArray(r)) && ('name' in v[0] || 'id' in v[0]);
const tables = [];
for (const ns of M.CATALOG_NAMESPACES) {
  ok(`catalog namespace "${ns}" exists in the bundle`, engine[ns] && typeof engine[ns] === 'object', 'undefined - a wrong name');
  if (!engine[ns]) continue;
  for (const [k, v] of Object.entries(engine[ns])) if (isTable(v)) tables.push(`${ns}.${k}`);
}
tables.push('characterTemplateStore');
ok('the sweep found at least 60 catalog tables (denominator)', tables.length >= 60, `${tables.length}`);
const consumed = new Set(packs.flatMap((p) => p.consumes));
for (const name of consumed) ok(`consumed table "${name}" exists in the bundle`, resolveExport(name) !== undefined);
for (const [name, why] of Object.entries(M.NOT_A_PACK)) ok(`NOT_A_PACK "${name}" exists in the bundle (${why.slice(0, 40)}...)`, resolveExport(name) !== undefined);
const orphans = tables.filter((t) => !consumed.has(t) && !(t in M.NOT_A_PACK));
ok('every bundle catalog table is consumed by a pack or declared NOT_A_PACK', orphans.length === 0, orphans.join(', '));
ok('the sweep flags a fabricated table name (teeth)', !consumed.has('advantages.__nope') && !('advantages.__nope' in M.NOT_A_PACK) && resolveExport('advantages.__nope') === undefined);
ok('no table is both consumed and NOT_A_PACK (except the two the sweep needs twice)', [...consumed].filter((t) => t in M.NOT_A_PACK).every((t) => t === 'lightsaberParts.allLibraryParts'));

// ---- 2-5. per pack --------------------------------------------------------------------------------------------
const readPack = (name) => {
  const dir = join(SRC, name);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const docs = []; const folders = [];
  for (const f of files) { const d = JSON.parse(readFileSync(join(dir, f), 'utf8')); (String(d._key).startsWith('!folders!') ? folders : docs).push({ file: f, doc: d }); }
  return { dir, files, docs, folders };
};
const docsByPack = new Map();
for (const pack of packs) {
  const onDisk = readPack(pack.name);
  if (!ok(`${pack.name}: packs-src directory present (run npm run build:packs)`, !!onDisk)) continue;
  docsByPack.set(pack.name, onDisk);
  const rows = pack.source(engine);
  const expected = EXPECTED_COUNTS[pack.name];
  ok(`${pack.name}: source has ${expected} rows (ARCHITECTURE §7)`, rows.length === expected, `${rows.length}`);
  ok(`${pack.name}: ${rows.length} documents on disk == source length`, onDisk.docs.length === rows.length, `${onDisk.docs.length}`);
  ok(`${pack.name}: MANIFEST.json count == documents`, manifest.packs[pack.name]?.count === onDisk.docs.length, JSON.stringify(manifest.packs[pack.name]));
  // 3. ids
  const ids = onDisk.docs.map((d) => d.doc._id);
  ok(`${pack.name}: ids unique and 16 base62 chars`, new Set(ids).size === ids.length && ids.every((id) => /^[A-Za-z0-9]{16}$/.test(id)));
  const folderIds = new Set(onDisk.folders.map((f) => f.doc._id));
  const byKey = new Map(rows.map((r) => [pack.key(r), r]));
  ok(`${pack.name}: source keys unique`, byKey.size === rows.length);
  let idOk = 0; let nameOk = 0; let folderOk = 0; let flagsOk = 0;
  for (const { doc } of onDisk.docs) {
    const key = doc.flags?.shadowbase?.key;
    const row = byKey.get(key);
    if (doc.flags?.shadowbase?.pack === pack.name && row !== undefined) flagsOk++;
    if (doc._id === M.documentId(pack.name, key) && doc._key === M.keyFor(pack.type, doc._id)) idOk++;
    if (doc.folder === null || folderIds.has(doc.folder)) folderOk++;
    if (row !== undefined && doc.name === M.docNameFor(pack, row, engine)) nameOk++;
    else if (row !== undefined) ok(`${pack.name}: "${doc.name}" == catalog name "${M.docNameFor(pack, row, engine)}"`, false);
  }
  ok(`${pack.name}: every document's flags name the pack and a source key`, flagsOk === onDisk.docs.length, `${flagsOk}/${onDisk.docs.length}`);
  ok(`${pack.name}: every _id == documentId(pack, key) and _key by type`, idOk === onDisk.docs.length, `${idOk}/${onDisk.docs.length}`);
  ok(`${pack.name}: every folder reference resolves`, folderOk === onDisk.docs.length);
  ok(`${pack.name}: every document name byte-identical to its catalog row's name`, nameOk === onDisk.docs.length, `${nameOk}/${onDisk.docs.length}`);
  for (const { doc } of onDisk.folders) ok(`${pack.name}: folder "${doc.name}" is typed ${pack.type} with a resolving parent`, doc.type === pack.type && (doc.folder === null || folderIds.has(doc.folder)));
  // 4. determinism: rebuild in memory and compare with disk + MANIFEST hashes
  const rebuilt = B.buildPackDocuments(pack, M, engine);
  ok(`${pack.name}: in-process rebuild has no errors`, rebuilt.errors.length === 0, rebuilt.errors.slice(0, 2).join(' | '));
  const diskById = new Map(onDisk.docs.map((d) => [d.doc._id, d.doc]));
  const same = rebuilt.docs.filter((d) => JSON.stringify(d) === JSON.stringify(diskById.get(d._id))).length;
  ok(`${pack.name}: rebuild reproduces every document byte for byte (deterministic ids and uuids)`, same === rebuilt.docs.length && rebuilt.docs.length === onDisk.docs.length, `${same}/${rebuilt.docs.length}`);
  ok(`${pack.name}: MANIFEST.json idsHash equals the in-process rebuild's (two builds, one answer)`, manifest.packs[pack.name]?.idsHash === B.idsHash(rebuilt.docs.map((d) => d._id)));
}
ok('MANIFEST.json contentHash of every pack matches the files on disk', packs.every((p) => manifest.packs[p.name]?.contentHash === B.manifestEntry(join(SRC, p.name), p.type).contentHash));
// The packs must have been built from the CURRENT engine bundle. The real
// invariant is agreement between MANIFEST.bundle and engine/BUILD-INFO.json
// (same build), not a git commit: the website checkout lost its .git, so the
// commit is legitimately null on both sides. Pin the build identity instead
// (bundleGeneratedAt + bytes), accept a null commit, and require the two to agree.
const buildInfo = JSON.parse(readFileSync(join(ROOT, 'engine', 'BUILD-INFO.json'), 'utf8'));
ok('MANIFEST.json records the bundle it was built from (BUILD-INFO agreement, freshness)',
  manifest.bundle?.bundleGeneratedAt === buildInfo.generatedAt && manifest.bundle?.bytes === buildInfo.bytes,
  `MANIFEST ${manifest.bundle?.bundleGeneratedAt}/${manifest.bundle?.bytes} vs BUILD-INFO ${buildInfo.generatedAt}/${buildInfo.bytes} - run npm run build`);
ok('MANIFEST.json and BUILD-INFO agree on the website commit (a string >= 7 chars when the website is a git repo, else null)',
  manifest.bundle?.websiteCommit === buildInfo.websiteCommit
  && (buildInfo.websiteCommit === null || (typeof buildInfo.websiteCommit === 'string' && buildInfo.websiteCommit.length >= 7)),
  `${JSON.stringify(manifest.bundle?.websiteCommit)} vs ${JSON.stringify(buildInfo.websiteCommit)}`);

// ---- 6. kits ---------------------------------------------------------------------------------------------------
const HOST = { blaster: 'installedInBlasterId', meleeWeapon: 'installedInMeleeId', lightsaber: 'installedInSaberId' };
const catalogHas = {
  blaster: (p) => (p.partId ? engine.rangedPartsData.allRangedLibraryParts.some((c) => c.id === p.partId) : engine.weaponModData.WEAPON_MOD_DATA.some((c) => c.name === p.name) || engine.ammunitionData.AMMUNITION_DATA.some((c) => c.name === p.name)),
  meleeWeapon: (p) => engine.meleePartsData.allMeleeLibraryParts.some((c) => c.name === p.name) || engine.weaponModData.WEAPON_MOD_DATA.some((c) => c.name === p.name),
  lightsaber: (p) => engine.lightsaberParts.HILT_COMPONENT_TEMPLATES.some((c) => c.name === p.name) || engine.lightsaberParts.allLibraryParts.some((c) => c.id === p.id || c.name === p.name),
};
let kits = 0;
for (const pack of packs.filter((p) => p.kit)) {
  for (const { doc } of docsByPack.get(pack.name)?.docs ?? []) {
    kits++;
    const kit = doc.system.kit;
    const weapon = kit?.weapon;
    const partIds = new Set((kit?.parts ?? []).map((p) => p.id));
    const refs = engine.itemTransfer.structuralPartRefIds(weapon);
    ok(`${pack.name} "${doc.name}": kit carries weapon/parts/ammunition/equipment and row == kit.weapon`, kit && Array.isArray(kit.parts) && Array.isArray(kit.ammunition) && Array.isArray(kit.equipment) && JSON.stringify(doc.system.row) === JSON.stringify(weapon));
    ok(`${pack.name} "${doc.name}": every structural reference (${refs.length}) resolves to a kit part`, refs.length > 0 && refs.every((id) => partIds.has(id)), refs.filter((id) => !partIds.has(id)).join(','));
    ok(`${pack.name} "${doc.name}": every part claims the weapon as host`, kit.parts.every((p) => p[HOST[doc.type]] === weapon.id && p.isInstalled === true));
    ok(`${pack.name} "${doc.name}": every part resolves to its catalog`, kit.parts.every(catalogHas[doc.type]), kit.parts.filter((p) => !catalogHas[doc.type](p)).map((p) => p.name).join(','));
    if (kit.equipment.length) ok(`${pack.name} "${doc.name}": the launcher's Power Cell is loaded and bound`, weapon.loadedAmmunitionId === kit.equipment[0].id && kit.equipment[0].installedInBlasterId === weapon.id);
  }
}
ok('kits checked (denominator: 51 + 37 + 11)', kits === 99, `${kits}`);
{
  // The normalisation §9.1 "Kits" names: the website's builders return { blaster, parts } / { weapon, parts } and
  // the manifest's project() turns both into kit { weapon, parts, ammunition, equipment }. A blaster kit's
  // `ammunition` stays [] because the loaded pack is embedded in the weapon's own loadedAmmunitionData
  // ("NOT also an inventory row", blaster-common.ts:225) - so the weapon carries its pack, not the kit.
  const bk = engine.blasterCommon.buildTemplateBlaster({ profileName: 'Blaster Pistol' });
  const mk = engine.meleeCommon.buildTemplateMeleeWeapon({ profileName: "Arg'garok" });
  ok('buildTemplateBlaster returns { blaster, parts } and buildTemplateMeleeWeapon { weapon, parts }; neither carries `weapon`+`ammunition` (the manifest normalises)', 'blaster' in bk && 'parts' in bk && !('weapon' in bk) && !('ammunition' in bk) && 'weapon' in mk && 'parts' in mk && !('ammunition' in mk));
  const pistol = docsByPack.get('ranged-weapons').docs.map((d) => d.doc).find((d) => d.name === 'Blaster Pistol');
  const fresh = engine.blasterCommon.buildTemplateBlaster({ profileName: 'Blaster Pistol', customName: 'Blaster Pistol', equipped: false });
  ok('the Blaster Pistol kit\'s weapon IS buildTemplateBlaster().blaster and its parts the builder\'s parts (uuids masked)', !!pistol && ser(pistol.system.kit.weapon) === ser(fresh.blaster) && ser(pistol.system.kit.parts) === ser(fresh.parts) && pistol.system.kit.ammunition.length === 0);
  ok('a blaster kit embeds its loaded pack in the weapon (loadedAmmunitionData bound by loadedAmmunitionId), not as an ammunition row', !!pistol?.system.kit.weapon.loadedAmmunitionData && pistol.system.kit.weapon.loadedAmmunitionId === pistol.system.kit.weapon.loadedAmmunitionData.id);
  const axe = docsByPack.get('melee-weapons').docs.map((d) => d.doc).find((d) => d.name === "Arg'garok");
  const freshAxe = engine.meleeCommon.buildTemplateMeleeWeapon({ profileName: "Arg'garok", customName: "Arg'garok" });
  ok('the Arg\'garok kit\'s weapon IS buildTemplateMeleeWeapon().weapon (uuids masked)', !!axe && ser(axe.system.kit.weapon) === ser(freshAxe.weapon) && ser(axe.system.kit.parts) === ser(freshAxe.parts));
  // The template store's shape (§9.1 "Templates"): { name, description, data, portraitUrl }, 65 entries with blank.
  const store = engine.characterTemplateStore;
  // 64 entries are { name, description, data, portraitUrl }; the blank carries no description.
  ok('characterTemplateStore has 65 entries of { name, [description], data, portraitUrl } (the sheet is .data) and blank\'s category is "Blank"', Object.keys(store).length === 65 && Object.values(store).every((t) => 'name' in t && 'data' in t && 'portraitUrl' in t) && Object.entries(store).filter(([k]) => k !== 'blank').every(([, t]) => 'description' in t) && engine.templateCategories.templateCategory('blank', store.blank) === 'Blank' && engine.templateCategories.TEMPLATE_CATEGORY_ORDER.length === 5);
}

// ---- 7. schemas, shim, templates ------------------------------------------------------------------------------------
const ItemClass = CONFIG.Item.documentClass;
let zodOk = 0; let shimOk = 0; let itemsTotal = 0;
for (const pack of packs.filter((p) => p.type === 'Item')) {
  const rows = pack.source(engine);
  const byKey = new Map(rows.map((r) => [pack.key(r), r]));
  for (const { doc } of docsByPack.get(pack.name)?.docs ?? []) {
    itemsTotal++;
    const row = byKey.get(doc.flags.shadowbase.key);
    const schema = M.schemaFor(pack, row, engine);
    if (schema.safeParse(doc.system.row).success) zodOk++; else ok(`${pack.name} "${doc.name}": row parses with its website schema`, false);
    try {
      const { _key, ...data } = doc;
      const item = new ItemClass(data, { strict: true });
      if (item.type === doc.type && item.system.catalog === pack.name && JSON.stringify(item.system.row) === JSON.stringify(doc.system.row) && item.system.source === doc.system.source) shimOk++;
      else ok(`${pack.name} "${doc.name}": shim Item keeps type/catalog/source/row`, false, `${item.type} ${item.system.catalog} ${item.system.source}`);
    } catch (err) { ok(`${pack.name} "${doc.name}": constructs strictly through the shim`, false, err.message); }
  }
}
ok(`every Item row parses with its website zod schema (${zodOk}/${itemsTotal})`, zodOk === itemsTotal && itemsTotal > 2000);
ok(`every Item document constructs strictly through the registered Item class with its row intact (${shimOk}/${itemsTotal})`, shimOk === itemsTotal);

const templates = docsByPack.get('templates')?.docs ?? [];
let tplOk = 0; let statsOk = 0; let actorFor = null;
const migrate = engine.hasExport('applyLoadMigrations') ? engine.applyLoadMigrations : null;
ok('applyLoadMigrations is in the bundle (templates go through the website\'s own load)', !!migrate);
for (const { doc } of templates) {
  const key = doc.flags.shadowbase.key;
  let actor;
  try {
    const { _key, ...data } = doc;
    actor = shim.buildActor({ ...data, items: data.items.map(({ _key: k, ...it }) => it) }, { strict: true });
  } catch (err) { ok(`templates "${doc.name}": builds strictly through the shim`, false, err.message); continue; }
  if (actor.system.derived && actor.items.size === doc.items.length && actor.system.resources.hp.max > 0) tplOk++; else ok(`templates "${doc.name}": prepares (derived set, items intact)`, false);
  if (key === 'rokarr') actorFor = actor;
  const entry = engine.characterTemplateStore[key];
  const sheet = structuredClone(typeof entry.data === 'function' ? entry.data() : entry.data);
  const website = engine.getCalculatedStats(migrate ? migrate(sheet, engine.blankSheetData).data : sheet);
  const foundry = actor.system.derived;
  const diffs = Object.keys(website).filter((k) => ser(website[k]) !== ser(foundry[k]));
  if (diffs.length === 0) statsOk++; else ok(`templates "${doc.name}": stats equal the website's loaded template on every key`, false, diffs.join(','));
  ok(`templates "${doc.name}": prototype token bars are hp/ep and linked`, doc.prototypeToken?.bar1?.attribute === 'resources.hp' && doc.prototypeToken?.bar2?.attribute === 'resources.ep' && doc.prototypeToken?.actorLink === true);
}
ok(`every template Actor builds and prepares through the shim (${tplOk}/${templates.length})`, tplOk === templates.length && templates.length === 65);
ok(`every template's 31 stat keys equal getCalculatedStats(applyLoadMigrations(template.data)) (${statsOk}/${templates.length})`, statsOk === templates.length);
ok('template folders are Ch18\'s categories; the blank sheet is at the root', (docsByPack.get('templates')?.folders ?? []).map((f) => f.doc.name).sort().join('|') === 'Character Archetypes|Droids|Example Player Characters|Species' && templates.find((t) => t.doc.flags.shadowbase.key === 'blank')?.doc.folder === null);
ok('Vex Korta\'s Concussion Grenade is named by baseExplosiveName (adapter.itemNameFor reads it)', templates.some((t) => t.doc.items.some((i) => i.type === 'explosive' && i.name === 'Concussion Grenade')) && !templates.some((t) => t.doc.items.some((i) => /^TYPES\./.test(i.name))));
{
  // The naming lives in the adapter now (U03's request, folded by U02c): the two marked workarounds are gone.
  ok('adapter.itemNameFor names an explosive by baseExplosiveName, a starship by baseChassis, a blaster by baseType', adapter.itemNameFor({ baseExplosiveName: 'Thermal Detonator' }, 'explosive') === 'Thermal Detonator' && adapter.itemNameFor({ baseChassis: 'YT-1300' }, 'starship') === 'YT-1300' && adapter.itemNameFor({ baseType: 'Blaster Pistol' }, 'blaster') === 'Blaster Pistol' && adapter.itemNameFor({ customName: 'Mine', name: 'Catalog' }, 'equipment') === 'Mine');
  const manifestSrc = readFileSync(join(ROOT, 'tools', 'pack-manifest.mjs'), 'utf8');
  const dropSrc = readFileSync(join(ROOT, 'module', 'compendium-drop.mjs'), 'utf8');
  ok('neither tools/pack-manifest.mjs nor module/compendium-drop.mjs renames explosives itself any more (no displayNameFor, no inline baseExplosiveName read)', !/displayNameFor/.test(manifestSrc + dropSrc) && !/row\??\.baseExplosiveName/.test(manifestSrc + dropSrc));
  // U03's i18n request (folded by U02c): every key the drop module names, every pack and folder label, are in lang/en.json.
  const tr = loadTranslations();
  const dropKeys = [...new Set([...dropSrc.matchAll(/'(SHADOWBASE\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]))];
  ok('module/compendium-drop.mjs names SHADOWBASE.Drop keys (denominator)', dropKeys.length >= 8, `${dropKeys.length}`);
  ok('every key module/compendium-drop.mjs names is in lang/en.json', dropKeys.every((k) => k in tr), dropKeys.filter((k) => !(k in tr)).join(','));
  ok('every pack label key (32) and pack-folder label key (10) is in lang/en.json with the manifest\'s English', M.PACKS.every((p) => tr[p.label.key] === p.label.en) && M.PACK_FOLDERS.every((f) => tr[f.label.key] === f.label.en), [...M.PACKS.map((p) => p.label.key), ...M.PACK_FOLDERS.map((f) => f.label.key)].filter((k) => !(k in tr)).join(','));
  ok('SHADOWBASE.Handbook.Overview is in lang/en.json (the Overview page name)', tr['SHADOWBASE.Handbook.Overview'] === 'Overview');
}

// ---- 8. the drop handler -----------------------------------------------------------------------------------------------
ok('compendium-drop REFERENCE_ONLY_CATALOGS equals the manifest\'s referenceOnly packs', [...drop.REFERENCE_ONLY_CATALOGS].sort().join('|') === [...M.REFERENCE_ONLY_CATALOGS].sort().join('|'));
{
  // Drops arrive through the actor sheet's own v13 ApplicationV2 route (_onDropItem / _onDropActor calling
  // handleItemDrop / handleActorDrop), never a `dropActorSheetData` hook - that hook is Application-V1 only and
  // a v13 ActorSheetV2 never fires it, so registering one would be dead code (rf-foundry-api finding).
  const dropSrc = readFileSync(join(ROOT, 'module', 'compendium-drop.mjs'), 'utf8');
  const bootSrc = readFileSync(join(ROOT, 'module', 'shadowbase.mjs'), 'utf8');
  const sheetSrc = readFileSync(join(ROOT, 'module', 'apps', 'actor-sheet.mjs'), 'utf8');
  ok('no dropActorSheetData (V1-only) hook is registered, and registerCompendiumDropHooks is gone', !/Hooks\.on\(\s*['"]dropActorSheetData['"]/.test(dropSrc + bootSrc) && !/registerCompendiumDropHooks/.test(dropSrc + bootSrc));
  ok('the actor sheet routes catalog / template drops through its own v13 _onDropItem / _onDropActor -> handleItemDrop / handleActorDrop', /_onDropItem\s*\(/.test(sheetSrc) && /_onDropActor\s*\(/.test(sheetSrc) && /handleItemDrop\(/.test(sheetSrc) && /handleActorDrop\(/.test(sheetSrc));
}
if (ok('Rokarr template actor available for the drop legs', !!actorFor)) {
  const actor = actorFor;
  const findDoc = (pack, pred) => docsByPack.get(pack).docs.map((d) => d.doc).find(pred);
  const asItem = (doc) => { const { _key, ...d } = doc; return new ItemClass(d, { strict: true }); };
  // kit
  const bp = drop.planItemDrop(actor, asItem(findDoc('ranged-weapons', (d) => d.name === 'Blaster Pistol')));
  const w = bp.items[0]?.system.row;
  ok('drop: a blaster kit plans the weapon + its 5 parts', bp.items.length === 6 && bp.items[0].type === 'blaster' && bp.items.slice(1).every((d) => d.type === 'weaponPart' && d.system.source === 'weaponModifications'));
  ok('drop: the kit is re-keyed (fresh weapon id) and every part rebound to it', w && w.id !== findDoc('ranged-weapons', (d) => d.name === 'Blaster Pistol').system.row.id && bp.items.slice(1).every((d) => d.system.row.installedInBlasterId === w.id));
  ok('drop: every structural reference of the dropped weapon resolves to a dropped part', engine.itemTransfer.structuralPartRefIds(w).every((id) => bp.items.slice(1).some((d) => d.system.row.id === id)));
  const gl = drop.planItemDrop(actor, asItem(findDoc('ranged-weapons', (d) => d.system.kit.equipment.length > 0)));
  const glw = gl.items[0].system.row; const cell = gl.items.find((d) => d.system.source === 'equipment')?.system.row;
  ok('drop: a launcher kit carries its Power Cell, loaded and bound to the new weapon id', !!cell && glw.loadedAmmunitionId === cell.id && glw.loadedAmmunitionData?.id === cell.id && cell.installedInBlasterId === glw.id);
  const ls = drop.planItemDrop(actor, asItem(findDoc('lightsabers', (d) => /Saberstaff/.test(d.name))));
  ok('drop: a saberstaff kit plans 13 saber parts into lightsaberModifications with slots resolving', ls.items.length === 14 && ls.items.slice(1).every((d) => d.system.source === 'lightsaberModifications') && engine.itemTransfer.structuralPartRefIds(ls.items[0].system.row).every((id) => ls.items.some((d) => d.system.row.id === id)));
  // per-name
  const fp = drop.planItemDrop(actor, asItem(findDoc('force-powers', (d) => d.name === 'Animal Bond')));
  ok('drop: a force power plans its Level 1 row with system.levels carried', fp.items.length === 1 && fp.items[0].system.row.level === 1 && fp.items[0].system.levels.length >= 3);
  // skill seeding
  const sk = drop.planItemDrop(actor, asItem(findDoc('skills', (d) => d.name === 'Acrobatics')));
  const expectedLevel = String(engine.baseChargedLevelForSkill('DX/Hard', actor.system.derived.skillPricingAttributes) ?? '');
  ok('drop: a skill row is seeded at the charging level (baseChargedLevelForSkill over the owner\'s attributes)', sk.items.length === 1 && sk.items[0].system.row.level === expectedLevel && expectedLevel !== '', `${sk.items[0]?.system.row.level} vs ${expectedLevel}`);
  const ownSkill = actor.rowsOf('skills')[0]?.system.row.name;
  ok('drop: an already-held skill is refused', drop.planItemDrop(actor, asItem({ ...findDoc('skills', (d) => d.name === 'Acrobatics'), name: ownSkill, system: { ...findDoc('skills', (d) => d.name === 'Acrobatics').system, row: { name: ownSkill, level: '', points: null, relativeLevel: 'DX/Easy', notes: '', baselinePoints: 0 } } })).items.length === 0);
  // armor per limb (the rejected alternative is one row named by the Piece)
  const ga = drop.planItemDrop(actor, asItem(findDoc('armor', (d) => d.name === "Beskar'gam Gauntlets")));
  ok('drop: ARMOR_DATA gauntlets split per limb - two rows, two distinct hands, named by the profile', ga.items.length === 2 && ga.items.every((d) => /Beskar'gam Gauntlet \((Left|Right) Hand\)/.test(d.name)) && new Set(ga.items.map((d) => d.system.row.wornLocationId)).size === 2 && !ga.items.some((d) => /Heavy Hand Plate/.test(d.name)), ga.items.map((d) => d.name).join(' | '));
  const ap = drop.planItemDrop(actor, asItem(findDoc('armor-pieces', (d) => d.name === 'Light Head Plate (Flex-Armor)')));
  ok('drop: a Ch13 Piece is rebuilt for the wearer with DR entries against the actor\'s anatomy', ap.items.length === 1 && ap.items[0].system.row.pieceId === 'light-head-plate-flex-armor' && ap.items[0].system.row.drEntries.length > 0 && ap.items[0].system.row.itemSizeModifier === (actor.system.sizeModifier ?? 0));
  // refusals
  ok('drop: a reference-only catalog row is refused with SHADOWBASE.Drop.ReferenceOnly', drop.planItemDrop(actor, asItem(findDoc('starship-mods', () => true))).notices.some((n) => n[0] === 'SHADOWBASE.Drop.ReferenceOnly'));
  const heldAdv = actor.rowsOf('advantages').map((i) => i.system.row.name).find((n) => !engine.enhancedDefenses.advantageAllowsDuplicates(n));
  const advDoc = findDoc('advantages', (d) => d.name === heldAdv);
  ok('drop: a duplicate advantage is refused (AlreadyKnown)', !!advDoc && drop.planItemDrop(actor, asItem(advDoc)).notices.some((n) => n[0] === 'SHADOWBASE.Drop.AlreadyKnown'), heldAdv);
  const quirkDocs = docsByPack.get('quirks').docs.map((d) => d.doc);
  const fullQuirks = shim.buildActor({ ...structuredClone({ name: 'Q', type: 'character', system: actorFor.toObject().system }), items: quirkDocs.slice(0, engine.quirks.MAX_QUIRKS).map((q) => ({ name: q.name, type: 'quirk', system: { row: q.system.row, source: 'quirks' } })), effects: [] });
  ok('drop: the sixth quirk is refused (MAX_QUIRKS)', drop.planItemDrop(fullQuirks, asItem(quirkDocs[engine.quirks.MAX_QUIRKS])).notices.some((n) => n[0] === 'SHADOWBASE.Drop.QuirkLimit'));
  const ex = drop.planItemDrop(actor, asItem(findDoc('explosives', () => true)));
  ok('drop: an explosive is named by baseExplosiveName', ex.items.length === 1 && ex.items[0].name === ex.items[0].system.row.baseExplosiveName);
  ok('drop: an implant arrives uninstalled and cut to the wearer\'s SM', drop.planItemDrop(actor, asItem(findDoc('implants', () => true))).items[0]?.system.row.installed === false);
}

report(`${packs.length} packs, ${itemsTotal} Item documents, ${templates.length} template Actors, ${kits} kits, ${tables.length} bundle tables swept`);
