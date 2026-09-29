#!/usr/bin/env node
// check:species-swap
//
// SUBJECT: module/apps/actor-sheet.mjs applySpeciesSwap - the Foundry port of the
// website's species-field.tsx applySpecies - run on real (shim) actors, held
// against the website's own swapSpecies (engine.speciesSwap), which is the
// reference implementation:
//   1. every species the website packages (SPECIES_NAMES, discovered - not listed
//      here): a blank actor swapped to it holds, per row array (advantages,
//      disadvantages, quirks, forcePowers), exactly the row names swapSpecies
//      returns for the same blank sheet - the port applies every array the swap
//      hands back, not a subset;
//   2. the Force-power grant (2026-09-28 ruling, Ch18's Miraluka): a swap INTO a
//      species with a power package adds it as a forcePower Item carrying the
//      `fromSpecies` marker; a swap AWAY removes it and nothing else;
//   3. a character who already holds that power (learned, at a higher tier) is
//      not also granted the Apprentice row - one row of that name survives, the
//      learned one;
//   4. the FIRST pick on a blank sheet keeps everything the player added (a bought
//      advantage, a learned power) - the website's grantedBy fix of 2026-09-28,
//      which replaced this check's declared known-defect leg once it went red;
//   5. every template Actor Foundry SHIPS (packs-src/templates, read as a GM
//      imports it) whose species is packaged: swapped away through the port, it
//      holds exactly what the website's swapSpecies returns for the same template
//      as the website loads it, and no row marked for the old species survives -
//      package revision 2 (the template store marks racial rows), including the
//      example characters' 0-against-0 rows (Rokarr's 11).
//
// THE REJECTED ALTERNATIVE, against the app's own code path: reconciling only the
// trait arrays (the pre-2026-09-28 port), which silently drops swap.forcePowers -
// the Miraluka would arrive without Force Sight. Leg 2 pins that the actor's
// forcePower count moves, and leg 1 compares the forcePowers array with the
// website's, so a port that skips it is red on both.
//
// DENOMINATOR: the species whose package carries a Force power are derived from
// the engine (SPECIES_NAMES filtered by package.forcePowers) and must be non-empty,
// so the day no species grants one this check fails rather than going quiet.
//
// MUTATIONS FIRED (2026-09-28, file restored byte-identical after each):
//   - applySpeciesSwap: the `reconcileRows(actor, 'forcePowers', ...)` line removed
//     -> RED: leg 1 (Miraluka forcePowers [] vs [Miralukan Force Sight], 26/27) and
//        leg 2 (no power granted, no fromSpecies)
//   - applySpeciesSwap: `forcePowers: rowsRef(...)` dropped from the swap input
//     -> SURVIVED, and correctly: `values` spreads actor.sheetData, whose cache
//        already carries the forcePowers rows, so the swap still sees the learned
//        power. The explicit rowsRef only keeps untouched rows BY REFERENCE (no
//        needless Item update); that is identity, not outcome, and not pinned here.
//   - applySpeciesSwap: the `reconcileRows(actor, 'advantages', ...)` line removed
//     -> RED: leg 1 (0/27), leg 4 (the package never arrives), leg 5 (0/52 match,
//        32 templates keep their marked rows)
//   - packs-src/templates swapped for the pre-revision-2 build (the bare template
//     shape the website warned of, restored after) -> RED: leg 5 (no template
//     carries a marked row; 32/52 no longer match the website's swap)
//   - (leg 4's predecessor) the declared known-defect leg went red on its own when
//     the website's grantedBy fix landed, as it was written to, and was replaced.
//
//   node scripts/check-species-swap.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, ROOT, unwrap } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:species-swap');
const { shim, engine, adapter } = await installSystem({ selfTest: false });
const { applySpeciesSwap } = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'actor-sheet.mjs')).href);
const ss = engine.speciesSwap;
const ARRAYS = ['advantages', 'disadvantages', 'quirks', 'forcePowers'];

const blankActor = (name, patch = {}) => {
  const actor = shim.buildActor(adapter.sheetToActorData({ ...engine.blank(), ...patch }, { actorName: name }));
  globalThis.game.actors.set(actor.id, actor);
  return actor;
};
const namesOf = (actor, source) => actor.rowsOf(source).map((i) => String(i.system.row?.name ?? '')).sort();
const rowNames = (rows) => (rows ?? []).map((r) => String(r?.name ?? '')).sort();

// ---- denominators ---------------------------------------------------------------------------------------------
ok('the website packages species (SPECIES_NAMES, denominator)', Array.isArray(ss.SPECIES_NAMES) && ss.SPECIES_NAMES.length >= 20, `${ss.SPECIES_NAMES?.length}`);
const POWERED = ss.SPECIES_NAMES.filter((n) => (ss.speciesPackageFor(n)?.forcePowers ?? []).length > 0);
ok('at least one species package grants a Force power (the rows that could fail legs 2-3)', POWERED.length > 0, POWERED.join(', ') || 'none');

// ---- 1. the port applies every array the website swap returns ------------------------------------------------
let matched = 0;
for (const species of ss.SPECIES_NAMES) {
  const actor = blankActor(`swap ${species}`);
  const expected = ss.swapSpecies({ ...engine.blank(), advantages: [], disadvantages: [], quirks: [], forcePowers: [] }, species);
  await applySpeciesSwap(actor, species);
  const bad = ARRAYS.filter((a) => JSON.stringify(namesOf(actor, a)) !== JSON.stringify(rowNames(expected[a])));
  if (bad.length === 0 && actor.system.species === species) matched++;
  else ok(`${species}: the actor holds exactly the rows swapSpecies returns`, false, bad.map((a) => `${a}: actor [${namesOf(actor, a).join(', ')}] vs website [${rowNames(expected[a]).join(', ')}]`).join(' | ') || `species ${actor.system.species}`);
}
ok(`every packaged species applies all four row arrays as the website swap returns them (${matched}/${ss.SPECIES_NAMES.length})`, matched === ss.SPECIES_NAMES.length);

// ---- 2. the Force-power grant arrives with the species and leaves with it -------------------------------------
for (const species of POWERED) {
  const pkgPowers = ss.speciesPackageFor(species).forcePowers.map((p) => p.name);
  const actor = blankActor(`into ${species}`);
  const before = actor.rowsOf('forcePowers').length;
  await applySpeciesSwap(actor, species);
  const granted = actor.rowsOf('forcePowers').filter((i) => pkgPowers.includes(i.system.row?.name));
  ok(`${species}: a swap in grants ${pkgPowers.join(', ')} as forcePower Items (was ${before})`, granted.length === pkgPowers.length && actor.rowsOf('forcePowers').length === before + pkgPowers.length, `${actor.rowsOf('forcePowers').length} forcePower rows`);
  ok(`${species}: every granted row carries fromSpecies "${species}"`, granted.length > 0 && granted.every((i) => i.system.row?.fromSpecies === species), granted.map((i) => i.system.row?.fromSpecies).join(','));
  ok(`${species}: every granted row is a forcePower Item`, granted.every((i) => i.type === 'forcePower'), granted.map((i) => i.type).join(','));
  const other = ss.SPECIES_NAMES.find((n) => !POWERED.includes(n) && n !== species);
  await applySpeciesSwap(actor, other);
  ok(`${species} -> ${other}: the swap away removes the granted power and leaves no forcePower row behind`, actor.rowsOf('forcePowers').length === before, `${actor.rowsOf('forcePowers').length} left: ${namesOf(actor, 'forcePowers').join(', ')}`);
}

// ---- 3. a learned power is not doubled by the species grant ------------------------------------------------------
// From a PACKAGED species (the swap the website states it handles; the blank-sheet case is leg 4's known defect).
const FROM = ss.SPECIES_NAMES.find((n) => !POWERED.includes(n));
for (const species of POWERED) {
  const pkgRow = ss.speciesPackageFor(species).forcePowers[0];
  const learned = { ...structuredClone(pkgRow), id: `learned-${species}`, level: (Number(pkgRow.level) || 1) + 2 };
  delete learned.fromSpecies;
  // Species set at construction: swapping blank -> FROM first would hit leg 4's defect and strip the learned row.
  const actor = blankActor(`learned ${species}`, { species: FROM, forcePowers: [learned] });
  ok(`${species}: the fixture actor holds the learned ${pkgRow.name} as a ${FROM} before the swap`, actor.rowsOf('forcePowers').length === 1 && actor.system.species === FROM, namesOf(actor, 'forcePowers').join(', '));
  await applySpeciesSwap(actor, species);
  const same = actor.rowsOf('forcePowers').filter((i) => i.system.row?.name === pkgRow.name);
  ok(`${FROM} -> ${species}: holding ${pkgRow.name} already, the swap grants no second row (one row, the learned level ${learned.level}, no fromSpecies)`,
    same.length === 1 && Number(same[0].system.row?.level) === learned.level && !same[0].system.row?.fromSpecies,
    same.map((i) => `level ${i.system.row?.level} from ${i.system.row?.fromSpecies ?? '-'}`).join(' | ') || 'none');
}

// ---- 4. the first pick on a blank sheet keeps what the player added ----------------------------------------------
// Until 2026-09-28 the website's withoutSpecies stripped every UNMARKED row when the previous species was "" (a
// blank sheet's), because an absent marker read as "" too; this check declared that as a known website defect and
// the leg went red the day the website's grantedBy fix landed. Now pinned the right way round, through the port.
for (const species of POWERED) {
  const pkgRow = ss.speciesPackageFor(species).forcePowers[0];
  const learned = { ...structuredClone(pkgRow), id: `first-pick-${species}`, level: (Number(pkgRow.level) || 1) + 2 };
  delete learned.fromSpecies;
  const bought = { name: 'Fit', points: 5, baselinePoints: 0, id: 'bought-fit', description: '' };
  const actor = blankActor(`first pick ${species}`, { advantages: [bought], forcePowers: [learned] });
  ok(`first pick: the blank actor states no species`, !actor.system.species, JSON.stringify(actor.system.species));
  await applySpeciesSwap(actor, species);
  const fit = actor.rowsOf('advantages').filter((i) => i.system.row?.name === 'Fit' && !i.system.row?.fromSpecies);
  const power = actor.rowsOf('forcePowers').filter((i) => i.system.row?.name === pkgRow.name);
  ok(`blank -> ${species}: the bought Fit survives the first pick, unmarked`, fit.length === 1, namesOf(actor, 'advantages').join(', '));
  ok(`blank -> ${species}: the learned ${pkgRow.name} survives at level ${learned.level}, not doubled by the grant`, power.length === 1 && Number(power[0].system.row?.level) === learned.level, power.map((i) => i.system.row?.level).join(','));
  const pkgAdv = ss.speciesPackageFor(species).advantages.map((r) => r.name);
  ok(`blank -> ${species}: the whole package arrives, marked`, pkgAdv.every((n) => actor.rowsOf('advantages').some((i) => i.system.row?.name === n && i.system.row?.fromSpecies === species)), pkgAdv.join(', '));
}

// ---- 5. the template Actors Foundry ships, swapped away ---------------------------------------------------------------
const sig = (r) => `${r?.name ?? ''}|${r?.level ?? ''}|${r?.points ?? ''}|${r?.baselinePoints ?? 0}|${r?.fromSpecies ?? ''}`;
const actorSigs = (actor, a) => actor.rowsOf(a).map((i) => sig(i.system.row)).sort();
const TEMPLATE_DIR = join(ROOT, 'packs-src', 'templates');
const docs = readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(TEMPLATE_DIR, f), 'utf8'))).filter((d) => d.type === 'character');
let swapped = 0; let matchedT = 0; let carriers = 0; let clean = 0;
for (const doc of docs) {
  const from = doc.system?.species;
  if (!ss.isKnownSpecies(from)) continue;
  const key = doc.flags?.shadowbase?.key;
  const entry = engine.characterTemplateStore[key];
  if (!ok(`${doc.name}: its store entry (${key}) exists`, !!entry)) continue;
  swapped++;
  const target = from === 'Human' ? 'Wookiee' : 'Human';
  // The website's side: the template as the website loads it (loadAndResetForm), then its swap.
  const loaded = engine.applyLoadMigrations(structuredClone(unwrap(entry)), engine.blankSheetData).data;
  const expected = ss.swapSpecies(loaded, target);
  // Foundry's side: the shipped document, as a GM imports it, through the port.
  const actor = shim.buildActor({ name: doc.name, type: doc.type, system: structuredClone(doc.system), items: structuredClone(doc.items), effects: structuredClone(doc.effects ?? []) });
  globalThis.game.actors.set(actor.id, actor);
  const markedBefore = ARRAYS.flatMap((a) => actor.rowsOf(a)).filter((i) => i.system.row?.fromSpecies === from).length;
  // A template with no marked row (the Human archetypes: Human's one-row package, Versatility (Human), is not on
  // their sheets) must then hold NONE of its package's rows unmarked - else a swap would leave a racial row behind.
  if (markedBefore === 0) {
    const pkgNames = new Set(ARRAYS.flatMap((a) => (ss.speciesPackageFor(from)?.[a] ?? []).map((r) => r.name)));
    const unmarkedPkg = ARRAYS.flatMap((a) => actor.rowsOf(a)).filter((i) => pkgNames.has(i.system.row?.name));
    ok(`${doc.name}: carries no marked ${from} row, so it holds none of the ${from} package's rows unmarked`, unmarkedPkg.length === 0, unmarkedPkg.map((i) => i.system.row?.name).join(', '));
  } else carriers++;
  await applySpeciesSwap(actor, target);
  const bad = ARRAYS.filter((a) => JSON.stringify(actorSigs(actor, a)) !== JSON.stringify((expected[a] ?? []).map(sig).sort()));
  if (bad.length === 0) matchedT++;
  else ok(`${doc.name} (${from} -> ${target}): the actor holds exactly what the website's swap returns`, false, bad.map((a) => `${a}: ${actorSigs(actor, a).filter((s) => !(expected[a] ?? []).map(sig).includes(s)).slice(0, 2).join('; ')} vs ${(expected[a] ?? []).map(sig).filter((s) => !actorSigs(actor, a).includes(s)).slice(0, 2).join('; ')}`).join(' | '));
  const left = ARRAYS.flatMap((a) => actor.rowsOf(a)).filter((i) => i.system.row?.fromSpecies === from);
  if (left.length === 0) clean++;
  else ok(`${doc.name} (${from} -> ${target}): no row marked ${from} survives the swap`, false, `${markedBefore} marked before, ${left.length} left: ${left.map((i) => i.system.row?.name).join(', ')}`);
}
ok(`shipped template Actors with a packaged species swapped (${swapped})`, swapped >= ss.SPECIES_NAMES.length, `${swapped}`);
ok(`those carrying marked racial rows, the rows that could fail - at least one per species (${carriers})`, carriers >= ss.SPECIES_NAMES.length, `${carriers}`);
ok(`every one matches the website's swap of the same template (${matchedT}/${swapped})`, matchedT === swapped);
ok(`no marked row of the old species survives in any of them (${clean}/${swapped})`, clean === swapped);

report(`${ss.SPECIES_NAMES.length} species swapped, ${POWERED.length} with a Force-power package (${POWERED.join(', ')})`);
