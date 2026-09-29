#!/usr/bin/env node
// check:reaction-media
//
// SUBJECT: the Reaction Modifier figures the actor sheet shows (infoContext ->
// info.alignment.reaction, rendered in the dashboard's Force Alignment section):
// face to face, over a comlink, in writing. Held against the website's own
// statement of what each medium carries, social-rolls.ts REACTION_MEDIA
// (2026-09-28: faceToFace seen+heard+known, comlink heard+known, writing known
// only - Ch4: a trait that has to be seen does nothing in writing):
//   1. over every template Actor Foundry ships (packs-src/templates, as a GM
//      imports it) that has a reaction source, the sheet's three figures equal
//      netReactionModifier(sources, REACTION_MEDIA.<medium>) over the same rows;
//   2. the rendered dashboard prints the comlink / writing line with those
//      figures whenever either differs from face to face (the website's condition);
//   3. the website's live reading (2026-09-28): a Twi'lek reads +1 face to face,
//      0 over a comlink, 0 in writing.
//
// THE REJECTED ALTERNATIVE, against the app's own code path: "in writing" as
// ['seen', 'known'] - the list the website's sheet AND its guard both typed until
// 2026-09-28, and this sheet copied. The corpus must express the difference: the
// templates whose writing figure differs under the two lists are counted and must
// be non-empty, and the sheet must show the REACTION_MEDIA one on every one.
// A structural leg holds that module/ types no sense list into netReactionModifier
// (the sphere call's `undefined, [sphere]` is not a sense list).
//
// MUTATIONS FIRED (2026-09-28, restored byte-identical after each):
//   - actor-sheet.mjs: `media.writing` -> ['seen', 'known'] (the old line)
//     -> RED: leg 1 (the seen-trait templates), leg 3 (Twi'lek writing +1), structural leg
//   - templates/actor/dashboard.hbs: the comlink figure passed as the writing one
//     -> SURVIVED the first version: in every shipped template whose media differ,
//        comlink and writing both read 0 (their only medium-bound traits are SEEN),
//        so the corpus could not tell the two figures apart. Leg 2b adds the one
//        fixture that can (the Twi'lek template + the catalog's heard-sense trait:
//        +3 / +2 / 0) -> RED on 2b.
//
//   node scripts/check-reaction-media.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, ROOT } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:reaction-media');
const { shim, engine, sys } = await installSystem({ selfTest: false });
// The sheet renders through the system's own registration (check:templates does the same).
sys.registerSheets();
await sys.registerTemplates();
const { ShadowBaseActorSheet } = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'actor-sheet.mjs')).href);
const sr = engine.socialRolls;
const M = sr.REACTION_MEDIA;
const sign = (n) => (n > 0 ? `+${n}` : String(n));

ok('the website states the three media (REACTION_MEDIA faceToFace / comlink / writing)', !!(M && Array.isArray(M.faceToFace) && Array.isArray(M.comlink) && Array.isArray(M.writing)), JSON.stringify(M));
ok('writing carries no seen sense (Ch4, 2026-09-28)', Array.isArray(M?.writing) && !M.writing.includes('seen'), JSON.stringify(M?.writing));

const dir = join(ROOT, 'packs-src', 'templates');
const docs = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).filter((d) => d.type === 'character');
let withSources = 0; let matched = 0; let expressive = 0; let lineOk = 0; let lineCases = 0; let twilek = null;
for (const doc of docs) {
  const rows = (type) => (doc.items ?? []).filter((i) => i.type === type).map((i) => i.system.row);
  const found = sr.reactionSourcesFor(rows('advantage'), rows('disadvantage'));
  if (!found.length) continue;
  withSources++;
  const want = { faceToFace: sign(sr.netReactionModifier(found, M.faceToFace)), overComlink: sign(sr.netReactionModifier(found, M.comlink)), inWriting: sign(sr.netReactionModifier(found, M.writing)) };
  if (sign(sr.netReactionModifier(found, ['seen', 'known'])) !== want.inWriting) expressive++;

  const actor = shim.buildActor({ name: doc.name, type: doc.type, system: structuredClone(doc.system), items: structuredClone(doc.items), effects: structuredClone(doc.effects ?? []) });
  globalThis.game.actors.set(actor.id, actor);
  const app = new ShadowBaseActorSheet({ document: actor });
  let reaction = null; let dashboard = '';
  try { await app.render(); reaction = (await app._prepareContext({})).info?.alignment?.reaction ?? null; dashboard = app.parts?.dashboard ?? ''; }
  catch (e) { ok(`${doc.name}: the sheet renders`, false, e.message); continue; }
  const got = { faceToFace: reaction?.faceToFace, overComlink: reaction?.overComlink, inWriting: reaction?.inWriting };
  if (JSON.stringify(got) === JSON.stringify(want)) matched++;
  else ok(`${doc.name}: the sheet's face-to-face / comlink / writing figures are REACTION_MEDIA's`, false, `sheet ${JSON.stringify(got)} vs website ${JSON.stringify(want)}`);
  // 2. the printed line, under the website's condition
  const shows = want.overComlink !== want.faceToFace || want.inWriting !== want.faceToFace;
  const line = game.i18n.format('SHADOWBASE.Sheet.Align.Perception', { comlink: want.overComlink, writing: want.inWriting });
  const printed = dashboard.includes(line.replace(/&/g, '&amp;').split(' — ')[0]) || dashboard.includes(line.split(' — ')[0]);
  if (shows) { lineCases++; if (printed) lineOk++; else ok(`${doc.name}: the dashboard prints "${line.split(' — ')[0]}"`, false); }
  else ok(`${doc.name}: no comlink / writing line when all three agree`, !dashboard.includes('Over a comlink'));
  if (/twi'?lek/i.test(doc.name) && doc.system?.species === "Twi'lek" && !/\(/.test(doc.name)) twilek = got;
}
// 2b. The shipped corpus cannot tell COMLINK from WRITING: every template whose media differ owes it to a SEEN trait
// alone, so both read 0 and a sheet printing one figure for the other passes (the mutation that survived the first
// run). One fixture that can: the shipped Twi'lek template as the website loads it, plus the catalog's heard-sense
// advantage - discovered from the library, not named - so face to face, comlink and writing all differ.
{
  const lib = engine.advantages?.advantagesLibrary ?? [];
  const heard = lib.find((row) => sr.reactionSourcesFor([{ ...row, points: row.points ?? 0 }], []).some((s) => s.sense === 'heard'));
  ok('the catalog carries an advantage the other party only needs to HEAR (denominator for 2b)', !!heard, `${lib.length} library rows`);
  const tw = engine.characterTemplateStore.twilek ?? Object.values(engine.characterTemplateStore).find((t) => (t?.data?.species ?? t?.species) === "Twi'lek");
  if (heard && tw) {
    const sheet = engine.applyLoadMigrations(structuredClone(tw.data ?? tw), engine.blankSheetData).data;
    sheet.advantages = [...(sheet.advantages ?? []), { ...structuredClone(heard), id: 'fixture-heard', points: heard.points ?? 0 }];
    const found = sr.reactionSourcesFor(sheet.advantages, sheet.disadvantages ?? []);
    const want = { faceToFace: sign(sr.netReactionModifier(found, M.faceToFace)), overComlink: sign(sr.netReactionModifier(found, M.comlink)), inWriting: sign(sr.netReactionModifier(found, M.writing)) };
    ok(`2b fixture (Twi'lek + ${heard.name}): the three media all differ, so a swapped figure would show`, new Set(Object.values(want)).size === 3, JSON.stringify(want));
    const actor = shim.buildActor((await import(pathToFileURL(join(ROOT, 'module', 'adapter.mjs')).href)).sheetToActorData(sheet, { actorName: `Twi'lek + ${heard.name}` }));
    globalThis.game.actors.set(actor.id, actor);
    const app = new ShadowBaseActorSheet({ document: actor });
    await app.render();
    const r = (await app._prepareContext({})).info?.alignment?.reaction ?? {};
    ok(`2b fixture: the sheet shows ${JSON.stringify(want)}`, r.faceToFace === want.faceToFace && r.overComlink === want.overComlink && r.inWriting === want.inWriting, JSON.stringify({ faceToFace: r.faceToFace, overComlink: r.overComlink, inWriting: r.inWriting }));
    const line = game.i18n.format('SHADOWBASE.Sheet.Align.Perception', { comlink: want.overComlink, writing: want.inWriting }).split(' — ')[0];
    ok(`2b fixture: the dashboard prints "${line}"`, (app.parts?.dashboard ?? '').includes(line));
  } else ok('2b fixture: the Twi\'lek template is in the store', !!tw);
}
ok(`shipped templates with a reaction source (${withSources}), the rows that could fail`, withSources > 0, `${withSources}`);
ok(`on which the rejected "in writing" list gives a different figure (${expressive}) - the corpus can tell the lists apart`, expressive > 0, `${expressive}`);
ok(`1. every one shows REACTION_MEDIA's three figures (${matched}/${withSources})`, matched === withSources);
ok(`2. every one whose media differ prints the comlink / writing line with them (${lineOk}/${lineCases})`, lineOk === lineCases && lineCases > 0, `${lineOk}/${lineCases}`);
ok('3. the website\'s live reading: a Twi\'lek reads +1 face to face, 0 over a comlink, 0 in writing', JSON.stringify(twilek) === JSON.stringify({ faceToFace: '+1', overComlink: '0', inWriting: '0' }), JSON.stringify(twilek));

// ---- structural: no sense list typed at a call site ------------------------------------------------------------------
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : []; });
const typed = walk(join(ROOT, 'module')).filter((p) => /netReactionModifier\(\s*[^,()]+,\s*\[\s*['"](seen|heard|known)['"]/.test(readFileSync(p, 'utf8'))).map((p) => relative(ROOT, p).replace(/\\/g, '/'));
ok('no module types a sense list into netReactionModifier (REACTION_MEDIA is the one statement)', typed.length === 0, typed.join(', '));

report(`${withSources} templates with reaction sources, ${expressive} where the old writing list differs, ${lineCases} print the media line`);
