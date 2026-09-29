#!/usr/bin/env node
// check:world-update
//
// SUBJECT: module/world-update.mjs runWorldUpdate - the one-time update of actors already in the world
// (Fulllion, 2026-09-28) - run over a world holding three kinds of actor:
//   R0. saved before the website's species-package round: every species' OLD package (the website's own
//       record, scripts/fixtures/species-packages-before-2026-09-28.json), unmarked and swap-marked, no
//       revision stored (reads 0);
//   R1. built this morning at revision 1: the shipped template Actors with their racial markers stripped
//       and the revision set to 1 - the state of every actor a GM made from this morning's packs;
//   R2. current: the shipped template Actors as they are (revision 2).
// Each actor's writes are recorded (update / create / update-embedded / delete-embedded), and:
//   1. every R0 and R1 actor ends holding exactly the rows the website's load produces for its sheet
//      (name, level, points, baseline, fromSpecies), its stored fields as that load leaves them, at the
//      current revision; and every R0 actor holds its species' LIVE Ch18 package, every row marked as the
//      species' own (the independent anchor - the website's check:species-packages makes the same demand);
//   2. only what changed is written: exactly the Items whose row content changed are updated, exactly the
//      retired rows' Items are deleted, exactly the added rows are created - every other Item keeps its id
//      and receives no write;
//   3. an R2 actor receives no write at all; a second run finds nothing due and writes nothing;
//   4. on a player's client, or a second GM's, it does nothing (one client acts: combat.mjs isActingClient);
//   5. the GM gets one whispered card naming every actor the website's chain had something to say about,
//      and counting the marked-only ones;
//   6. an actor that fails part-way stays below the revision and the next run finishes it.
//
// THE REJECTED ALTERNATIVES, against the app's own code path:
//   - re-importing each actor wholesale (importSheet deletes and recreates every Item): leg 2 pins that
//     every Item of an unchanged or changed row keeps its id;
//   - gating on a literal (`< 1`) instead of the engine's SPECIES_PACKAGE_REVISION: the R1 actors would be
//     skipped - leg 1 requires them updated (the website's handoff warned of exactly this);
//   - reading the revision after spreading the blank sheet (the trap check:load-migrations holds): an R0
//     actor would read as current and keep its old package - leg 1's live-package anchor.
//
// MUTATIONS FIRED (2026-09-28, module/world-update.mjs restored byte-identical after each):
//   - the gate on a literal 1 (`storedRevision(a) < 1`, the handoff's warning) -> RED: 54/119 updated, the R1
//     actors unmarked (legs 1, 2, 6)
//   - rows paired by id only (reconcileRows' rule) -> RED: leg 2 (87/119 - every id-less marked row deleted and
//     recreated) and leg 6
//   - the revision written before the rows -> RED: leg 6 (a failing actor reads current and is never finished)
//   - no GM gate -> RED: leg 4 (a player's / second GM's client writes); it first CRASHED the check instead of
//     reporting (a null result dereferenced in leg 5) - leg 5 made null-safe, re-fired, now a clean red
//   - the list diff taken against the Items' stored rows instead of the sheet -> RED: leg 2 (91/119 - spurious
//     writes on gear rows whose sheet copy carries derived figures)
//   - the unreadable-sheet guard and the stated-field guard removed -> RED: leg 6b on the Item-less actor (it
//     gained the blank sheet's Credit Chip Item and revision 2); the actor WITH Items stayed safe behind the
//     row-alignment check, which is why 6b carries both
// And the FIRST version of the update, which handed rows to reconcileRows, failed leg 2 on 38 actors before any
// mutation: every template trait row carries no row id (249 of 249), so marking recreated each one's Item.
//
//   node scripts/check-world-update.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, ROOT, WEB } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:world-update');
const { shim, engine, adapter } = await installSystem({ selfTest: false });
const W = await import(pathToFileURL(join(ROOT, 'module', 'world-update.mjs')).href);
const ss = engine.speciesSwap;
const CURRENT = engine.speciesPackageRevision?.SPECIES_PACKAGE_REVISION;
const LISTS = ['advantages', 'disadvantages', 'quirks', 'forcePowers'];
const sig = (r) => `${r?.name ?? ''}|${r?.level ?? ''}|${r?.points ?? ''}|${r?.baselinePoints ?? 0}|${r?.fromSpecies ?? ''}`;
const listSig = (rows) => (rows ?? []).map(sig).sort();

ok('the engine states the current revision, above 1 (so an R1 actor is due)', Number.isFinite(CURRENT) && CURRENT >= 2, `${CURRENT}`);
ok('world-update gates on the engine constant', W.currentRevision() === CURRENT);

// ---- the world ------------------------------------------------------------------------------------------------------
const fixture = JSON.parse(readFileSync(join(WEB, 'scripts', 'fixtures', 'species-packages-before-2026-09-28.json'), 'utf8')).packages;
const world = [];
const add = (kind, actor, extra = {}) => { globalThis.game.actors.set(actor.id, actor); world.push({ kind, actor, ...extra }); return actor; };
for (const species of ss.SPECIES_NAMES) {
  for (const marked of [false, true]) {
    const rowsOf = (list) => fixture[species].rows.filter((r) => r.list === list).map(({ list: _l, ...r }) => ({ ...r, description: '', id: engine.rowId(), ...(marked ? { fromSpecies: species } : {}) }));
    const sheet = { ...structuredClone(engine.blankSheetData), species, advantages: rowsOf('advantages'), disadvantages: rowsOf('disadvantages'), quirks: rowsOf('quirks'), culturalFamiliarities: fixture[species].culturalFamiliarities, totalCredits: fixture[species].totalCredits };
    delete sheet.speciesPackageRevision;
    const data = adapter.sheetToActorData(sheet, { actorName: `R0 ${species}${marked ? ' (marked)' : ''}` });
    delete data.system.speciesPackageRevision;
    add('R0', shim.buildActor(data), { species });
  }
}
const TEMPLATE_DIR = join(ROOT, 'packs-src', 'templates');
const docs = readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(TEMPLATE_DIR, f), 'utf8'))).filter((d) => d.type === 'character');
for (const doc of docs) {
  const items = structuredClone(doc.items).map((i) => { if (i.system?.row) delete i.system.row.fromSpecies; return i; });
  add('R1', shim.buildActor({ name: `R1 ${doc.name}`, type: doc.type, system: { ...structuredClone(doc.system), speciesPackageRevision: 1 }, items, effects: structuredClone(doc.effects ?? []) }));
  add('R2', shim.buildActor({ name: `R2 ${doc.name}`, type: doc.type, system: structuredClone(doc.system), items: structuredClone(doc.items), effects: structuredClone(doc.effects ?? []) }));
}
ok('R0 actors read revision 0 (no revision stored)', world.filter((w) => w.kind === 'R0').every((w) => W.storedRevision(w.actor) === 0));
ok('R1 actors read revision 1, R2 the current one', world.filter((w) => w.kind === 'R1').every((w) => W.storedRevision(w.actor) === 1) && world.filter((w) => w.kind === 'R2').every((w) => W.storedRevision(w.actor) === CURRENT));

// ---- expectations, taken BEFORE the run -------------------------------------------------------------------------------
// Rows: the website's load of each actor's own sheet. Writes: stated without the update's pairing rule -
//   R1 (packages already current): marking never retires or adds, so 0 deletes, 0 creates, and one update per
//      row that ends marked (none was marked before);
//   R0: deletes = the old package's rows the live Ch18 package no longer has, creates = the live rows the old
//      one lacked (both from the website's own record, multiset by name|level|points|baseline), and a kept row
//      is written only when it gains its marker (the unmarked saves; the swap-marked ones already carry it).
const shape = (l, r) => `${l}|${r?.name ?? ''}|${r?.level ?? ''}|${r?.points ?? ''}|${r?.baselinePoints ?? 0}`;
const multisetMinus = (a, b) => { const left = [...b]; return a.filter((x) => { const k = left.indexOf(x); if (k === -1) return true; left.splice(k, 1); return false; }); };
for (const w of world) {
  const before = structuredClone(w.actor.sheetData);
  const website = engine.loadIncomingSheet(structuredClone(before)).data;
  w.want = { rows: Object.fromEntries(LISTS.map((l) => [l, listSig(website[l])])), fields: Object.fromEntries(['culturalFamiliarities', 'species'].map((k) => [k, website[k]])) };
  w.itemIds = new Set(LISTS.flatMap((l) => w.actor.rowsOf(l).map((i) => i.id)));
  if (w.kind === 'R0') {
    const pkg = ss.speciesPackageFor(w.species);
    const oldShapes = fixture[w.species].rows.map((r) => shape(r.list, r));
    const liveShapes = LISTS.flatMap((l) => (pkg[l] ?? []).map((r) => shape(l, r)));
    w.expect = {
      deleted: multisetMinus(oldShapes, liveShapes).length,
      created: multisetMinus(liveShapes, oldShapes).length,
      updated: w.actor.name.endsWith('(marked)') ? 0 : oldShapes.length - multisetMinus(oldShapes, liveShapes).length,
    };
  } else if (w.kind === 'R1') {
    w.expect = { deleted: 0, created: 0, updated: null /* rows that end marked, counted after the run */ };
  }
  // The write recorder.
  const log = { update: 0, updated: new Set(), created: 0, deleted: new Set() };
  const wrap = (name, note) => { const orig = w.actor[name].bind(w.actor); w.actor[name] = async (...args) => { note(...args); return orig(...args); }; };
  wrap('update', () => { log.update++; });
  wrap('updateEmbeddedDocuments', (_t, updates) => { for (const u of updates ?? []) log.updated.add(u._id); });
  wrap('createEmbeddedDocuments', (_t, data) => { log.created += (data ?? []).length; });
  wrap('deleteEmbeddedDocuments', (_t, ids) => { for (const id of ids ?? []) log.deleted.add(id); });
  w.log = log;
}
const r0Changing = world.filter((w) => w.kind === 'R0' && (w.expect.deleted || w.expect.created)).length;
ok(`R0 actors whose package the round changed (rows retired or added), the rows that could fail (${r0Changing})`, r0Changing >= 15, `${r0Changing}`);
const r1Marking = world.filter((w) => w.kind === 'R1' && JSON.stringify(w.want.rows).includes('|' + (w.actor.system.species || '\u0000') + '"')).length;
ok(`R1 actors the markers change, at least one per species (${r1Marking})`, r1Marking >= ss.SPECIES_NAMES.length, `${r1Marking}`);

// ---- 4. the gate first: a player's client and a second GM do nothing -------------------------------------------------
{
  const saved = { user: game.user, userId: game.userId };
  const player = { id: 'player-1', name: 'Player', isGM: false, active: true };
  const otherGm = { id: 'zz-gm-2', name: 'Other GM', isGM: true, active: true };
  game.users.set(player.id, player); game.users.set(otherGm.id, otherGm);
  for (const u of [player, otherGm]) {
    game.user = u; game.userId = u.id;
    const r = await W.runWorldUpdate();
    ok(`4. on ${u.isGM ? 'a second GM' : 'a player'}'s client the update does nothing`, r === null && world.every((w) => w.log.update === 0 && w.log.updated.size === 0 && w.log.created === 0 && w.log.deleted.size === 0));
  }
  game.user = saved.user; game.userId = saved.userId;
  ok('4. the shim is the active GM again (denominator for the run below)', game.users.activeGM === game.user);
}

// ---- the run ----------------------------------------------------------------------------------------------------------
const chatBefore = (globalThis.ChatMessage?.log ?? []).length;
const result = await W.runWorldUpdate();
ok('the run reports no failure', result && result.failed.length === 0, JSON.stringify(result?.failed ?? null));
const due = world.filter((w) => w.kind !== 'R2');
ok(`every R0 and R1 actor was updated (${result?.updated.length}/${due.length}), and no R2 one`, result?.updated.length === due.length);

// 1. rows, fields and revision as the website's load leaves them
let rowsOk = 0; let fieldsOk = 0; let revOk = 0; let liveOk = 0; let r0 = 0;
for (const w of due) {
  const got = Object.fromEntries(LISTS.map((l) => [l, listSig(w.actor.rowsOf(l).map((i) => i.system.row))]));
  if (JSON.stringify(got) === JSON.stringify(w.want.rows)) rowsOk++;
  else ok(`1. ${w.actor.name}: rows as the website loads them`, false, LISTS.filter((l) => JSON.stringify(got[l]) !== JSON.stringify(w.want.rows[l])).map((l) => `${l}: +[${got[l].filter((s) => !w.want.rows[l].includes(s)).slice(0, 2)}] -[${w.want.rows[l].filter((s) => !got[l].includes(s)).slice(0, 2)}]`).join(' | '));
  if (w.actor.system.culturalFamiliarities === w.want.fields.culturalFamiliarities && w.actor.system.species === w.want.fields.species) fieldsOk++;
  else ok(`1. ${w.actor.name}: stored fields as the website loads them`, false, `${w.actor.system.culturalFamiliarities} vs ${w.want.fields.culturalFamiliarities}`);
  if (W.storedRevision(w.actor) === CURRENT) revOk++;
  if (w.kind === 'R0') {
    r0++;
    const pkg = ss.speciesPackageFor(w.species);
    const live = LISTS.flatMap((l) => (pkg[l] ?? []).map((r) => `${l}:${sig({ ...r, fromSpecies: w.species })}`)).sort();
    const held = LISTS.flatMap((l) => w.actor.rowsOf(l).map((i) => `${l}:${sig(i.system.row)}`)).sort();
    if (JSON.stringify(held) === JSON.stringify(live)) liveOk++;
    else ok(`1. ${w.actor.name}: holds the live Ch18 package, every row marked ${w.species}`, false, `extra [${held.filter((s) => !live.includes(s)).slice(0, 2)}] missing [${live.filter((s) => !held.includes(s)).slice(0, 2)}]`);
  }
}
ok(`1. every updated actor holds exactly the website-loaded rows (${rowsOk}/${due.length})`, rowsOk === due.length);
ok(`1. every updated actor's stored fields are the website-loaded ones (${fieldsOk}/${due.length})`, fieldsOk === due.length);
ok(`1. every updated actor is at revision ${CURRENT} (${revOk}/${due.length})`, revOk === due.length);
ok(`1. every R0 actor holds its species' live package, all marked (${liveOk}/${r0})`, liveOk === r0 && r0 > 0);
const renamed = world.filter((w) => w.kind === 'R0' && w.actor.system.culturalFamiliarities !== fixture[w.species].culturalFamiliarities).map((w) => w.species);
ok(`1. the familiarity renames reached the world (${[...new Set(renamed)].join(', ')})`, new Set(renamed).size >= 2);

// 2. only what changed is written
let writesOk = 0; let untouched = 0; let idless = 0;
const hasItem = (actor, id) => !!(actor.items.get?.(id) ?? [...actor.items].find((i) => i.id === id));
for (const w of due) {
  const exp = { ...w.expect };
  if (w.kind === 'R1') exp.updated = LISTS.flatMap((l) => w.actor.rowsOf(l)).filter((i) => i.system.row?.fromSpecies).length;
  const kept = [...w.itemIds].filter((id) => !w.log.deleted.has(id));
  const idsKept = kept.every((id) => hasItem(w.actor, id)) && (w.kind === 'R1' ? kept.length === w.itemIds.size : true);
  const counts = w.log.deleted.size === exp.deleted && w.log.created === exp.created && w.log.updated.size === exp.updated;
  if (counts && idsKept) writesOk++;
  else ok(`2. ${w.actor.name}: deletes / creates / updates exactly the retired / added / newly-marked rows, every kept Item keeps its id`, false,
    `deleted ${w.log.deleted.size} vs ${exp.deleted}, created ${w.log.created} vs ${exp.created}, updated ${w.log.updated.size} vs ${exp.updated}, ids kept ${idsKept}`);
  untouched += kept.filter((id) => !w.log.updated.has(id)).length;
  if (w.kind === 'R1') idless += LISTS.flatMap((l) => w.actor.rowsOf(l)).filter((i) => i.system.row?.fromSpecies && !i.system.row?.id).length;
}
ok(`2. every updated actor received exactly the writes its rows called for, and kept every other Item (${writesOk}/${due.length})`, writesOk === due.length);
ok(`2. kept Items that received no write at all (${untouched}) - the rows a wholesale re-import would have recreated`, untouched > 0);
ok(`2. marked rows that carry NO row id, marked in place in their own Item (${idless}) - the case reconcileRows would recreate`, idless > 0);

// 3. current actors untouched; a second run is a no-op
ok('3. every R2 (current) actor received no write', world.filter((w) => w.kind === 'R2').every((w) => w.log.update === 0 && w.log.updated.size === 0 && w.log.created === 0 && w.log.deleted.size === 0));
{
  const snapshot = world.map((w) => [w.log.update, w.log.updated.size, w.log.created, w.log.deleted.size].join(','));
  const again = await W.runWorldUpdate();
  ok('3. a second run finds nothing due and writes nothing', again === null && JSON.stringify(world.map((w) => [w.log.update, w.log.updated.size, w.log.created, w.log.deleted.size].join(','))) === JSON.stringify(snapshot));
}

// 5. the GM's card
{
  const cards = (globalThis.ChatMessage?.log ?? []).slice(chatBefore);
  ok('5. one card, whispered to the GM who ran it', cards.length === 1 && Array.isArray(cards[0]?.whisper) && cards[0].whisper.length === 1 && cards[0].whisper[0] === game.user.id, `${cards.length} card(s)`);
  const content = cards[0]?.content ?? '';
  const noticed = (result?.updated ?? []).filter((u) => u.notices.length);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  ok(`5. it names every actor the website's chain had a notice for (${noticed.length})`, noticed.length > 0 && noticed.every((u) => content.includes(`<strong>${esc(u.actor)}</strong>`)), noticed.filter((u) => !content.includes(esc(u.actor))).map((u) => u.actor).slice(0, 3).join(', '));
  ok('5. every R0 actor whose package changed has a species-package notice', world.filter((w) => w.kind === 'R0' && (w.expect.deleted || w.expect.created)).every((w) => (result?.updated ?? []).find((u) => u.actor === w.actor.name)?.notices.some((n) => n.id === 'species-package')));
  const quiet = (result?.updated ?? []).length - noticed.length;
  ok(`5. the marked-only actors are counted, not listed (${quiet})`, quiet > 0 && content.includes(game.i18n.format('SHADOWBASE.WorldUpdate.MarkedOnly', { count: quiet })));
}

// 6. a failure part-way stays below the revision and the next run finishes it
{
  const doc = docs.find((d) => d.system?.species === 'Wookiee' && /Rokarr/.test(d.name)) ?? docs.find((d) => d.system?.species === 'Wookiee');
  const items = structuredClone(doc.items).map((i) => { if (i.system?.row) delete i.system.row.fromSpecies; return i; });
  const actor = add('R1-fail', shim.buildActor({ name: `R1-fail ${doc.name}`, type: doc.type, system: { ...structuredClone(doc.system), speciesPackageRevision: 1 }, items, effects: [] }));
  const orig = actor.updateEmbeddedDocuments.bind(actor);
  let thrown = 0;
  actor.updateEmbeddedDocuments = async (...args) => { if (!thrown++) throw new Error('simulated write failure'); return orig(...args); };
  const first = await W.runWorldUpdate();
  ok('6. the failing actor is reported, not swallowed', first?.failed?.some((f) => f.actor === actor.name && /simulated/.test(f.error)), JSON.stringify(first?.failed ?? null));
  ok('6. it stays below the current revision (the revision is written last)', W.storedRevision(actor) === 1, `${W.storedRevision(actor)}`);
  const second = await W.runWorldUpdate();
  const marked = LISTS.flatMap((l) => actor.rowsOf(l)).filter((i) => i.system.row?.fromSpecies === 'Wookiee').length;
  ok('6. the next run finishes it: current revision, its racial rows marked', second?.updated?.some((u) => u.actor === actor.name) && W.storedRevision(actor) === CURRENT && marked > 0, `revision ${W.storedRevision(actor)}, ${marked} marked`);
}

// 6b. an actor whose sheet cannot be read is reported and left exactly as it is (never overwritten with blank defaults).
// Two of them: one with Items (the row lists then fail to line up, a second line of defence) and one with NONE, where
// the lists line up trivially and only the sheet guard stands between the actor and the blank sheet's Credit Chip
// row and default fields.
{
  const doc = docs.find((d) => d.system?.species === 'Twi\'lek' && !/\(/.test(d.name)) ?? docs[0];
  const unreadable = [
    add('R1-unreadable', shim.buildActor({ name: `R1-unreadable ${doc.name}`, type: doc.type, system: { ...structuredClone(doc.system), speciesPackageRevision: 1 }, items: structuredClone(doc.items), effects: [] })),
    add('R1-unreadable', shim.buildActor({ name: `R1-unreadable (no Items) ${doc.name}`, type: doc.type, system: { ...structuredClone(doc.system), speciesPackageRevision: 1 }, items: [], effects: [] })),
  ];
  const snap = (a) => JSON.stringify([a.system?._source ?? a._source?.system ?? a.system, [...a.items].map((i) => [i.id, i.system.row])]);
  const before = unreadable.map((a) => { Object.defineProperty(a, 'sheetData', { get: () => null, configurable: true }); return snap(a); });
  const r = await W.runWorldUpdate();
  unreadable.forEach((a, k) => {
    ok(`6b. ${a.name}: reported as failed`, r?.failed?.some((f) => f.actor === a.name), JSON.stringify(r?.failed ?? null));
    ok(`6b. ${a.name}: left exactly as it was (no field, no Item, no revision written)`, snap(a) === before[k] && W.storedRevision(a) === 1, `${[...a.items].length} Items, revision ${W.storedRevision(a)}`);
    globalThis.game.actors.delete?.(a.id);
  });
}

report(`${world.length} world actors (R0 ${world.filter((w) => w.kind === 'R0').length}, R1 ${world.filter((w) => w.kind === 'R1').length}, R2 ${world.filter((w) => w.kind === 'R2').length}); ${result?.updated.length} updated (${r0Changing} R0 packages changed, ${r1Marking} R1 marked); ${untouched} kept Items unwritten, ${idless} id-less rows marked in place; revision ${CURRENT}`);
