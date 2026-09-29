#!/usr/bin/env node
// check:load-migrations
//
// SUBJECT: every way a saved character enters Foundry, run over saves made
// BEFORE the website's 2026-09-28 species-package round, held against the
// website's own load call - applyLoadMigrations(save, blankSheetData), exactly as
// use-character-form.ts makes it:
//   A. ShadowBaseActor#importSheet with a sheet object (the compendium-drop path);
//   B. ShadowBaseActor#importSheet with a character FILE (the sheet's Import button);
//   C. bulkImportFiles (the batch importer), which migrates at write time;
//   D. engine.loadIncomingSheet, the one helper the three share.
// For every one of the 27 species, saved unmarked and saved with the rows marked
// by a swap, the Foundry actor must hold exactly the rows the website's load
// produces (name, level, points, baseline, fromSpecies marker) and leave at the
// current speciesPackageRevision.
//
// THE REJECTED ALTERNATIVE, against the app's own code path: spreading the blank
// sheet under the incoming one BEFORE the call - applyLoadMigrations({ ...blank,
// ...save }, blankSheetData) - which both Foundry callers did until 2026-09-28.
// The blank sheet is born at the current revision, so the spread hands an old
// save that revision before the website's function can read the save's own (it
// reads `speciesPackageRevision` off the incoming sheet BEFORE its own spread),
// and the species-package update is skipped. The leg below runs that call through
// the website's function and requires it to DIFFER from the website's load on
// the changed species - so the trap is shown against the real code, not asserted.
// A structural leg holds that no module calls applyLoadMigrations except through
// engine.loadIncomingSheet (discovered over module/**, not listed).
//
// DENOMINATOR: the species whose save CHANGES on load (package delta or marker)
// are counted from the fixture and the live packages, and must be non-empty.
//
// MUTATIONS FIRED (2026-09-28; each red, then restored byte-identical):
//   - the SHIPPED code, before the fix (importSheet and bulkImportFiles calling
//     applyLoadMigrations({ ...engine.blank(), ...incoming }, blankSheetData))
//     -> A-raw 8/54 (46 raw saves kept the old package, unmarked, stamped revision 2)
//        and the one-door leg (actor.mjs, import-export.mjs call it directly)
//   - engine.loadIncomingSheet spreading the blank under the incoming itself
//     -> A-raw and D-raw 8/54
//   The FILE shapes (A, B, C) stay green under both: convertJsonToSheet writes an
//   explicit revision 0, which survives the spread - the raw shape is the one at risk.
//
//   node scripts/check-load-migrations.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, ROOT, WEB } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:load-migrations');
const { shim, engine, adapter } = await installSystem({ selfTest: false });
const { bulkImportFiles } = await import(pathToFileURL(join(ROOT, 'module', 'import-export.mjs')).href);

const clone = (v) => structuredClone(v);
const LISTS = ['advantages', 'disadvantages', 'quirks', 'forcePowers'];
const sig = (r, list) => `${list}|${r?.name ?? ''}|${r?.level ?? ''}|${r?.points ?? ''}|${r?.baselinePoints ?? 0}|${r?.fromSpecies ?? ''}`;
const sheetSig = (d) => LISTS.flatMap((list) => (d?.[list] ?? []).map((r) => sig(r, list))).sort();
const actorSig = (actor) => LISTS.flatMap((list) => actor.rowsOf(list).map((i) => sig(i.system.row, list))).sort();
const REVISION = engine.speciesPackageRevision?.SPECIES_PACKAGE_REVISION ?? engine.blankSheetData.speciesPackageRevision;

// ---- the corpus: the website's own record of the packages as they shipped at 63eedd3 ---------------------------
const fixture = JSON.parse(readFileSync(join(WEB, 'scripts', 'fixtures', 'species-packages-before-2026-09-28.json'), 'utf8'));
const old = fixture.packages;
const species = engine.speciesSwap.SPECIES_NAMES;
ok('the record holds every species the website packages (denominator)', JSON.stringify(Object.keys(old).sort()) === JSON.stringify([...species].sort()), `${Object.keys(old).length} vs ${species.length}`);
ok('the blank sheet is born at the current revision (why pre-spreading it is a trap), and that revision is above 0', Number(REVISION) > 0 && engine.blankSheetData.speciesPackageRevision === REVISION, `${REVISION}`);

/** A save as the OLD package left it, through the real save format (the website's savedBefore, check:species-packages). */
const savedBefore = (name, { marked = false } = {}) => {
  const rowsOf = (list) => old[name].rows.filter((r) => r.list === list).map(({ list: _l, ...r }) => ({ ...r, description: '', ...(marked ? { fromSpecies: name } : {}) }));
  const sheet = {
    ...clone(engine.blankSheetData), species: name, characterName: `Saved ${name}`,
    advantages: rowsOf('advantages'), disadvantages: rowsOf('disadvantages'), quirks: rowsOf('quirks'),
    culturalFamiliarities: old[name].culturalFamiliarities, totalCredits: old[name].totalCredits,
  };
  delete sheet.speciesPackageRevision;
  const file = engine.convertSheetToJson(sheet, engine.getCalculatedStats(sheet));
  return { file, sheet: engine.convertJsonToSheet(clone(file)) };
};
const freshActor = (name) => {
  const actor = shim.buildActor(adapter.sheetToActorData(engine.blank(), { actorName: name }));
  globalThis.game.actors.set(actor.id, actor);
  return actor;
};

// Three shapes of an old save. A character FILE and what convertJsonToSheet makes of it both state
// speciesPackageRevision: 0 explicitly (the importer writes the 0), and an explicit 0 survives any spread.
// A RAW sheet object with no such key - an archived document, or a Foundry actor's stored data from before
// the field existed - is where a blank spread first would hand it the current revision: the case the
// website's check:species-packages tests as "the object states no revision at all".
let changing = 0; let rawChanging = 0; let trapShown = 0; let trapOnFiles = 0;
const tally = { A: 0, B: 0, C: 0, D: 0, 'A-raw': 0, 'D-raw': 0 };
const cases = species.flatMap((name) => [false, true].map((marked) => ({ name, marked })));
const check = (tag, want, leg, got, revision) => {
  const same = JSON.stringify(got) === JSON.stringify(want) && revision === REVISION;
  if (same) tally[leg]++;
  else ok(`${tag} via ${leg}: loads as the website loads it (rows + markers) at revision ${REVISION}`, false,
    `revision ${revision}; missing [${want.filter((s) => !got.includes(s)).slice(0, 3).join(', ')}] extra [${got.filter((s) => !want.includes(s)).slice(0, 3).join(', ')}]`);
};
for (const { name, marked } of cases) {
  const tag = `${name}${marked ? ' (marked by a swap)' : ''}`;
  const { file, sheet } = savedBefore(name, { marked });
  ok(`${tag}: the converted save states revision 0`, sheet.speciesPackageRevision === 0, `${sheet.speciesPackageRevision}`);
  const want = sheetSig(engine.applyLoadMigrations(clone(sheet), engine.blankSheetData).data);
  if (JSON.stringify(want) !== JSON.stringify(sheetSig(sheet))) changing++;
  // With the explicit 0, even the rejected spread loads correctly - counted, not required, so the report says so.
  if (JSON.stringify(sheetSig(engine.applyLoadMigrations({ ...engine.blank(), ...clone(sheet) }, engine.blankSheetData).data)) !== JSON.stringify(want)) trapOnFiles++;

  // A. importSheet with a sheet object
  { const actor = freshActor(`A ${tag}`); await actor.importSheet(clone(sheet)); check(tag, want, 'A', actorSig(actor), actor.system.speciesPackageRevision); }
  // B. importSheet with the character file
  { const actor = freshActor(`B ${tag}`); await actor.importSheet(clone(file)); check(tag, want, 'B', actorSig(actor), actor.system.speciesPackageRevision); }
  // C. the batch importer (copy policy: always writes a new actor)
  {
    const { results } = await bulkImportFiles([{ name: `${name}.json`, text: JSON.stringify(file) }], 'copy');
    const actor = results[0]?.actorId ? globalThis.game.actors.get(results[0].actorId) : null;
    if (actor) check(tag, want, 'C', actorSig(actor), actor.system.speciesPackageRevision);
    else ok(`${tag} via C: the batch importer created an actor`, false, JSON.stringify(results[0] ?? null).slice(0, 200));
  }
  // D. the shared helper
  if (typeof engine.loadIncomingSheet === 'function') {
    const loaded = engine.loadIncomingSheet(clone(sheet));
    check(tag, want, 'D', sheetSig(loaded.data), loaded.data.speciesPackageRevision);
  } else ok(`${tag} via D: engine.loadIncomingSheet exists`, false);

  // The RAW object: same save, the revision key absent.
  const raw = clone(sheet); delete raw.speciesPackageRevision;
  const wantRaw = sheetSig(engine.applyLoadMigrations(clone(raw), engine.blankSheetData).data);
  if (JSON.stringify(wantRaw) !== JSON.stringify(sheetSig(raw))) {
    rawChanging++;
    // The rejected alternative, through the website's own function: must load DIFFERENTLY here.
    if (JSON.stringify(sheetSig(engine.applyLoadMigrations({ ...engine.blank(), ...clone(raw) }, engine.blankSheetData).data)) !== JSON.stringify(wantRaw)) trapShown++;
  }
  { const actor = freshActor(`A-raw ${tag}`); await actor.importSheet(clone(raw)); check(`${tag} (raw, no revision key)`, wantRaw, 'A-raw', actorSig(actor), actor.system.speciesPackageRevision); }
  if (typeof engine.loadIncomingSheet === 'function') {
    const loaded = engine.loadIncomingSheet(clone(raw));
    check(`${tag} (raw, no revision key)`, wantRaw, 'D-raw', sheetSig(loaded.data), loaded.data.speciesPackageRevision);
  }
}
ok(`saves that CHANGE on load, the rows that could fail (${changing}/${cases.length})`, changing >= species.length, `${changing}`);
ok(`raw saves (no revision key) that change on load (${rawChanging}/${cases.length})`, rawChanging >= species.length, `${rawChanging}`);
ok(`the rejected alternative (blank spread under the save first) loads a raw save differently from the website every time it changes (${trapShown}/${rawChanging})`, trapShown === rawChanging && trapShown > 0, `${trapShown}`);
for (const leg of Object.keys(tally)) ok(`${leg}: all ${cases.length} old saves load exactly as the website loads them (${tally[leg]}/${cases.length})`, tally[leg] === cases.length);
console.log(`check:load-migrations: the rejected spread also mis-loads ${trapOnFiles}/${changing} converted FILE saves (0 expected: the importer's explicit 0 survives the spread)`);

// ---- structural: one door to the website's load path ---------------------------------------------------------------
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : []; });
const callers = walk(join(ROOT, 'module')).filter((p) => /applyLoadMigrations\s*\(|requireExport\(\s*['"]applyLoadMigrations['"]\s*\)/.test(readFileSync(p, 'utf8'))).map((p) => relative(ROOT, p).replace(/\\/g, '/'));
ok('only module/engine.mjs calls applyLoadMigrations (every other caller goes through engine.loadIncomingSheet)', JSON.stringify(callers) === JSON.stringify(['module/engine.mjs']), callers.join(', '));

report(`${cases.length} old saves x 4 entry points; ${changing} change on load; revision ${REVISION}`);
