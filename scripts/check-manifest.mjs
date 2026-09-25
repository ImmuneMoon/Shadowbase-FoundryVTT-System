#!/usr/bin/env node
// check:manifest
//
// SUBJECT: system.json (docs/ARCHITECTURE.md §3), read as a declaration and
// held against the things it names:
//   1. every `packs[]` entry is a pack tools/pack-manifest.mjs declares, with the
//      manifest's label/type/path, and its compiled `packs/<name>` directory exists
//      (a LevelDB directory: CURRENT + MANIFEST-*) after `npm run build:packs`;
//      `packFolders[]` equals the manifest's plan, every pack in exactly one folder;
//   2. every `esmodules` and `languages[].path` file exists; every `styles` path is
//      under styles/ and EXISTS (U02c ships an empty stub for every stylesheet a
//      later unit owns, so Foundry never 404s - ARCHITECTURE.md §9.1 "Style stubs"),
//      and the nine stylesheets of §3 are all listed;
//   3. `documentTypes.Item` equals the 21 registered data models
//      (module/config.mjs ITEM_TYPE_NAMES, the same registry CONFIG.Item.dataModels
//      is filled from) and `documentTypes.Actor` is exactly `character` with NO
//      htmlFields (description/background/notes are plain StringFields bound to
//      <textarea>s - an HTMLField would open ProseMirror whose <p> markup the
//      website renders literally; §3, review m6);
//   4. compatibility.minimum is 13 (Foundry v13 APIs only), id 'shadowbase',
//      primary/secondary token attributes are the §4.1 resources, grid is the
//      §3 hex ruling: type 4 = CONST.GRID_TYPES.HEXODDQ, hexagonal COLUMNS
//      (flat-top) - type 2 (HEXODDR, pointy-top rows) is the review's M1 mistake.
//
// THE REJECTED ALTERNATIVE, against the app's own code path: reading the
// pack list from system.json alone and trusting it. The pin builds the
// expected packs[] from tools/pack-manifest.mjs (systemJsonPacks()) and
// requires system.json to EQUAL it, so a pack added to the manifest but not
// to system.json - or a hand-edited label - is red here, not a silent
// "compendium not found" in Foundry.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - system.json: packs[0].label "Advantages" -> "Advantagez" -> "packs[] equals the manifest" pin
//   - system.json: documentTypes.Item.vehicle removed -> "documentTypes.Item equals ITEM_TYPE_NAMES" pin
//   - packs/quirks renamed away -> "compiled pack directory exists" pin
//   - styles/hud.css renamed away (U02c) -> "stylesheet exists: styles/hud.css"
//   - system.json: grid.type 4 -> 2 (U02c) -> "grid is hex columns (type 4 HEXODDQ)"
//   - system.json: htmlFields ["description"] restored (U02c) -> "Actor.character declares no htmlFields"
//
//   node scripts/check-manifest.mjs

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, ROOT } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:manifest');
const M = await import(pathToFileURL(join(ROOT, 'tools', 'pack-manifest.mjs')).href);
const config = await import(pathToFileURL(join(ROOT, 'module', 'config.mjs')).href);
const generated = await import(pathToFileURL(join(ROOT, 'module', 'data', 'actor-schema.generated.mjs')).href);
const sys = JSON.parse(readFileSync(join(ROOT, 'system.json'), 'utf8'));

/**
 * ARCHITECTURE §3's stylesheets. Every one exists from wave 2b on (U02c's empty stubs, §9.1 "Style stubs"):
 * variables/foundry-chrome/components/sheet/sheet-tabs are U05's, hud U07's, items U08's, chat U04's, apps U09's.
 */
const DECLARED_STYLESHEETS = ['styles/variables.css', 'styles/foundry-chrome.css', 'styles/components.css', 'styles/sheet.css', 'styles/sheet-tabs.css', 'styles/hud.css', 'styles/items.css', 'styles/chat.css', 'styles/apps.css'];

// ---- 4. identity ------------------------------------------------------------------------------------------
ok('id is shadowbase', sys.id === 'shadowbase', sys.id);
ok('compatibility.minimum is 13', String(sys.compatibility?.minimum) === '13', JSON.stringify(sys.compatibility));
ok('compatibility.verified is a 14.x build (the 2026-09-19 v14 pass; minimum stays 13 with v13 fallbacks)', /^14(\.\d+)?$/.test(String(sys.compatibility?.verified)), String(sys.compatibility?.verified));
ok('primaryTokenAttribute is resources.hp', sys.primaryTokenAttribute === 'resources.hp');
ok('secondaryTokenAttribute is resources.ep', sys.secondaryTokenAttribute === 'resources.ep');
// CONST.GRID_TYPES: GRIDLESS 0, SQUARE 1, HEXODDR 2, HEXEVENR 3, HEXODDQ 4, HEXEVENQ 5 - the Q grids are the
// flat-top COLUMN hexes the campaign plays on; the R grids are pointy-top rows (the review's M1).
ok('grid is hex columns (type 4 HEXODDQ, flat-top), 1 yd (§3) - not type 2 HEXODDR (pointy-top rows)', sys.grid?.type === 4 && sys.grid?.distance === 1 && sys.grid?.units === 'yd', JSON.stringify(sys.grid));

// ---- 2. files ----------------------------------------------------------------------------------------------
ok('esmodules lists module/shadowbase.mjs', Array.isArray(sys.esmodules) && sys.esmodules.includes('module/shadowbase.mjs'));
for (const p of sys.esmodules ?? []) ok(`esmodule exists: ${p}`, existsSync(join(ROOT, p)));
ok('one language entry, en', (sys.languages ?? []).length >= 1 && sys.languages.some((l) => l.lang === 'en'));
for (const l of sys.languages ?? []) ok(`language file exists: ${l.path}`, existsSync(join(ROOT, l.path)));
for (const p of sys.styles ?? []) {
  ok(`stylesheet path is under styles/: ${p}`, p.startsWith('styles/') && p.endsWith('.css'));
  ok(`stylesheet exists: ${p}`, existsSync(join(ROOT, p)), 'missing - Foundry would 404 at load (ship a stub)');
}
ok('every §3 stylesheet is listed, in order', JSON.stringify(sys.styles) === JSON.stringify(DECLARED_STYLESHEETS), `system.json: ${(sys.styles ?? []).join(', ')}`);
ok('no stylesheet exists on disk that system.json does not list (a sheet nobody loads)', readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css')).every((f) => (sys.styles ?? []).includes(`styles/${f}`)), readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css') && !(sys.styles ?? []).includes(`styles/${f}`)).join(', '));

// ---- 3. documentTypes = registered models -----------------------------------------------------------------
const itemTypes = Object.keys(sys.documentTypes?.Item ?? {});
ok('documentTypes.Item equals ITEM_TYPE_NAMES (21 registered data models), same order', JSON.stringify(itemTypes) === JSON.stringify([...config.ITEM_TYPE_NAMES]), `system.json: ${itemTypes.join(',')}`);
ok('documentTypes.Actor is exactly { character }', JSON.stringify(Object.keys(sys.documentTypes?.Actor ?? {})) === JSON.stringify(['character']));
{
  // htmlFields names fields Foundry treats as HTML (the sidebar search / enrichment paths). §3 keeps the three
  // textarea fields plain, and the generated schema agrees: none of them is an HTMLField.
  const html = sys.documentTypes?.Actor?.character?.htmlFields ?? [];
  ok('Actor.character declares no htmlFields (description/background/notes are plain textarea StringFields, §3)', html.length === 0, JSON.stringify(html));
  const textareas = ['description', 'background', 'notes'];
  ok('the generated schema keeps description/background/notes as StringField (not HTMLField), initial "", trim: false', textareas.every((k) => generated.FIELD_TABLE[k] && generated.FIELD_TABLE[k].initial === ''));
  const src = readFileSync(join(ROOT, 'module', 'data', 'actor-schema.generated.mjs'), 'utf8');
  ok('no HTMLField is emitted anywhere in the actor schema', !/HTMLField/.test(src));
  ok('every StringField in the actor schema carries trim: false (notes keep their whitespace, review M6)', (src.match(/new fields\.StringField\(/g) ?? []).length > 20 && (src.match(/new fields\.StringField\(\{[^}]*trim: false/g) ?? []).length === (src.match(/new fields\.StringField\(/g) ?? []).length);
}

// ---- 1. packs = manifest ------------------------------------------------------------------------------------
const expectedPacks = M.systemJsonPacks();
const expectedFolders = M.systemJsonPackFolders();
ok(`packs[] has ${expectedPacks.length} entries (the manifest's)`, (sys.packs ?? []).length === expectedPacks.length, `${(sys.packs ?? []).length}`);
ok('packs[] equals the manifest (name/label/path/type/system/ownership, same order)', JSON.stringify(sys.packs) === JSON.stringify(expectedPacks),
  (sys.packs ?? []).map((p, i) => (JSON.stringify(p) === JSON.stringify(expectedPacks[i]) ? null : `#${i} ${p.name}`)).filter(Boolean).join(', ') || 'lengths differ');
ok('packFolders[] equals the manifest plan', JSON.stringify(sys.packFolders) === JSON.stringify(expectedFolders));
{
  const inFolders = (sys.packFolders ?? []).flatMap((f) => f.packs);
  const names = (sys.packs ?? []).map((p) => p.name);
  ok('every pack is in exactly one packFolder', names.every((n) => inFolders.filter((x) => x === n).length === 1) && inFolders.every((n) => names.includes(n)),
    `unfoldered: ${names.filter((n) => !inFolders.includes(n)).join(',') || '-'}; unknown: ${inFolders.filter((n) => !names.includes(n)).join(',') || '-'}`);
  ok('pack names are unique', new Set(names).size === names.length);
  for (const p of sys.packs ?? []) {
    ok(`${p.name}: path is packs/${p.name}`, p.path === `packs/${p.name}`);
    ok(`${p.name}: type is Item/Actor/JournalEntry`, ['Item', 'Actor', 'JournalEntry'].includes(p.type), p.type);
    ok(`${p.name}: Actor/Item packs name the system`, p.type === 'JournalEntry' ? p.system === undefined : p.system === 'shadowbase');
    const dir = join(ROOT, p.path);
    const compiled = existsSync(dir) && existsSync(join(dir, 'CURRENT')) && readdirSync(dir).some((f) => f.startsWith('MANIFEST-'));
    ok(`${p.name}: compiled pack directory exists (packs/${p.name}, LevelDB CURRENT + MANIFEST-*) - run npm run build`, compiled);
  }
}

report(`${(sys.packs ?? []).length} packs, ${(sys.packFolders ?? []).length} pack folders, ${itemTypes.length} Item types`);
