#!/usr/bin/env node
// check:effects
//
// SUBJECT: status effects as ActiveEffects (docs/ARCHITECTURE.md §4.4):
// module/adapter.mjs statusEffectToEffectData / effectToStatusEffect,
// module/effects.mjs (add / dismiss / advancePhase / recoverEp / sweepExpired /
// syncStun), the CONFIG.statusEffects registration from module/config.mjs, and
// the hooks module/shadowbase.mjs registers.
//
// Pinned, each against the website's own handler it was moved from:
//   - every stored row becomes an ActiveEffect with `changes: []` and the row
//     whole under flags.shadowbase.statusEffect; the round trip through the
//     document equals the row with NO_MODIFIERS spread and phaseIndex 0 (the
//     zod-parsed shape of statusEffectSchema);
//   - sweepExpired removes exactly the rows the website's turn effect drops
//     (resource-trackers.tsx: `kept = effects.filter((e) => e?.expiresAfterTurn == null || turn <= Number(e.expiresAfterTurn))`)
//     - that literal is the oracle here, run over the same rows;
//   - advancePhase applies the crash through engine.stimulantCrash.applyCrashPhase:
//     the phase's EP figure comes off currentEndurancePoints and the channel on
//     the advanced row is 0, so the maximum never moves (stimulant-crash.ts);
//   - CONFIG.statusEffects ids equal module/config.mjs both ways, are the 18 of
//     §4.4, carry core icons/svg paths and i18n names lang/en.json resolves;
//   - stunType <-> stun status both ways, with the derived Stunned card
//     appearing exactly once.
//
// THE REJECTED ALTERNATIVES, each exercised through the engine:
//   - an effect carrying `changes` on system.* - the bag is summed by the engine
//     from the sheet AND applied by Foundry to the model: the pin builds that
//     effect and shows DX 14 where the bag alone gives 12 (double application);
//   - the crash phase's -N left on the endurancePoints channel - the engine
//     applies it to the MAXIMUM (a 10/10 character reads 10/6 with 10 to
//     spend): the pin shows the maximum move under that bag and stay put under
//     the zeroed one;
//   - the stun stored as a status-effect row - the engine derives Stunned from
//     stunType as well, so the HUD would list two: the pin counts two cards
//     under that shape and one under the mirror.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - effects.mjs isExpiredAt: kept `Number(turn) <= Number(stamp)` -> `Number(turn) < Number(stamp)` (one turn short)
//       -> "sweepExpired removes exactly the website's kept-complement" at turns 2..5, and sweepTurn
//   - effects.mjs advancePhase: bag spread from `next.modifiers` instead of applied.effectModifiers
//       -> "advanced row's endurancePoints channel is 0" + "maximum EP unchanged"
//   - adapter.mjs statusEffectToEffectData: `changes: []` -> a system.dexterity ADD change
//       -> "every stored effect has empty changes" + doubled DX through the engine
//   - config.mjs STATUS_EFFECTS: the `flanked` entry removed
//       -> "CONFIG.statusEffects carries exactly the 18 ids of §4.4"
//   - effects.mjs stunMirrorData: flags carrying a statusEffect row instead of stunMirror
//       -> "exactly one Stunned card" + "mirror absent from the sheet"
//   - effects.mjs syncStun: the `kept === 0` guard dropped (U02c)
//       -> "syncStun again: nothing created" + "the updateActor hook replayed ...: still exactly one mirror" (two mirrors)
//   - effects.mjs syncStunFromEffects: the agreeing-state early return dropped (U02c)
//       -> "syncStunFromEffects with a matching mirror returns false and writes nothing" (an update op is logged)
//   - effects.mjs createActiveEffect hook: the `stunType !== want` guard dropped (U02c)
//       -> "a duplicate token toggle of the current stun writes no stunType update"
//
//   node scripts/check-effects.mjs

import { makeReporter, installSystem, loadCorpus, ser } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:effects');
const { shim, engine, adapter, effects, config, translations } = await installSystem();
const { sheetToActorData, actorToSheet, statusEffectToEffectData, effectToStatusEffect, isStatusEffect } = adapter;
const NO = engine.NO_MODIFIERS;

// ---- CONFIG.statusEffects <-> module/config.mjs -----------------------------------------------------
const DECLARED_IDS = ['stunned-physical', 'stunned-mental', 'shock', 'bleeding', 'nauseated', 'stimulated', 'crash', 'susceptible', 'pain-suppressed', 'encumbered', 'flanked', 'unready', 'form-active', 'shield-active', 'critical-power', 'crippled', 'buff', 'debuff'];
const cfgIds = config.STATUS_EFFECTS.map((s) => s.id);
const liveIds = CONFIG.statusEffects.map((s) => s.id);
ok('CONFIG.statusEffects carries exactly the 18 ids of §4.4', [...cfgIds].sort().join(',') === [...DECLARED_IDS].sort().join(','), `config: ${cfgIds.join(',')}`);
ok('CONFIG.statusEffects (live) == module/config.mjs STATUS_EFFECTS (ids, both ways, same order)', liveIds.join('|') === cfgIds.join('|'), `live: ${liveIds.join(',')}`);
ok('registerStatusEffects() re-registers the same array', effects.registerStatusEffects().map((s) => s.id).join('|') === cfgIds.join('|'));
for (const s of CONFIG.statusEffects) {
  ok(`${s.id}: img is a Foundry core icon (icons/svg/*.svg)`, /^icons\/svg\/[a-z0-9-]+\.svg$/.test(s.img), s.img);
  ok(`${s.id}: name is an i18n key lang/en.json resolves`, typeof s.name === 'string' && s.name.startsWith('SHADOWBASE.Status.') && s.name in translations, s.name);
  ok(`${s.id}: hud is a boolean`, typeof s.hud === 'boolean');
  ok(`${s.id}: no rule leaks into CONFIG (match stays on CONFIG.SHADOWBASE)`, !('match' in s));
}
ok('encumbered and flanked are derived-only (hud: false); every other status is toggleable', CONFIG.statusEffects.every((s) => s.hud === !['encumbered', 'flanked'].includes(s.id)));
ok('stun ids map both ways', Object.entries(effects.STUN_STATUS_BY_TYPE).every(([t, id]) => effects.STUN_TYPE_BY_STATUS[id] === t && cfgIds.includes(id)) && Object.keys(effects.STUN_TYPE_BY_STATUS).length === 2);
ok('CONFIG.ActiveEffect.legacyTransferral is false (nothing transfers from items)', CONFIG.ActiveEffect.legacyTransferral === false);
{
  // Every notification key module/effects.mjs names resolves in lang/en.json (the row DATA literals are the website's, by design).
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../module/effects.mjs', import.meta.url), 'utf8');
  const keys = [...new Set([...src.matchAll(/'(SHADOWBASE\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]))];
  ok('module/effects.mjs names i18n keys (denominator)', keys.length >= 5, `${keys.length}`);
  ok('every i18n key module/effects.mjs names exists in lang/en.json', keys.every((k) => k in translations), keys.filter((k) => !(k in translations)).join(', '));
}
ok('game.shadowbase.effects is the module (ShadowBaseActor#sweepTurn delegates to it)', game.shadowbase.effects === effects.effects && typeof game.shadowbase.effects.sweepExpired === 'function');

// ---- the rows: what the website's producers write ------------------------------------------------------
// Each shape is copied from its producer: the damage processor's Shock (hit-location-section.tsx), a stimulant with
// its crash phase (equipment-section.tsx), an activated armor buff and its recharge note (armor-item-card.tsx), the
// HUD's manual effect (roller-window.tsx), and a legacy stimulant whose crash never became a phase.
const ROWS = [
  { id: 'shock-1', name: 'Shock (-3)', type: 'debuff', source: 'Injury', duration: 'Next Turn', expiresAfterTurn: 2, isManual: true, modifiers: { ...NO, dexterity: -3, iq: -3 } },
  { id: 'stim-1', name: 'Adrenal Stim', type: 'buff', source: 'Combat Stimulant', description: 'Crash: Lose 4 EP when the effect ends.', isManual: false, isGear: false, duration: '3 minutes', phaseIndex: 0,
    phases: [{ name: 'Adrenal Stim Crash', type: 'debuff', description: 'Recovery period after using Adrenal Stim. Recover 1 EP per 10 minutes of rest.', duration: 'Recovery Period', modifiers: { endurancePoints: -4 } }],
    modifiers: { ...NO, strength: 2, dexterity: 1 } },
  { id: 'activated-armor-1', name: 'Reflex Weave (Active)', type: 'buff', source: 'Reflex Weave', isManual: true, isGear: false, description: 'Activated buff - lasts 1 minute (10 combat turns; dismiss it out of combat).', modifiers: { dodge: 1 }, expiresAfterTurn: 11 },
  { id: 'recharge-armor-1', name: 'Reflex Weave Recharging', type: 'debuff', source: 'Reflex Weave', isManual: true, isGear: false, description: '1 use per 4 hours - clear this after 4 in-game hours have passed.', modifiers: { ...NO } },
  { id: 'manual-1', name: 'Blessing', type: 'buff', source: 'Manual / DM', description: 'GM fiat', isManual: true, isGear: false, duration: '', modifiers: { ...NO, will: 1 } },
  { id: 'legacy-stim-1', name: 'Old Stim', type: 'buff', source: 'Combat Stimulant', description: 'Crash: Lose 3 EP when the effect ends.', isManual: false, isGear: false, duration: '3 minutes', modifiers: { ...NO, strength: 1 } },
  { id: 'gear-1', name: 'Neural Rejection', type: 'debuff', source: 'Bio-Sync Error', description: 'Conflicting hardware detected.', isManual: false, isGear: true, modifiers: { ...NO, dexterity: -4 } },
];
const zodShape = (r) => ({ ...r, modifiers: { ...NO, ...(r.modifiers ?? {}) }, phaseIndex: r.phaseIndex ?? 0 });
ok('rows under test (denominator)', ROWS.length >= 7);

// Pure adapter round trip, then through the document.
for (const row of ROWS) {
  const data = statusEffectToEffectData(row);
  ok(`${row.id}: statusEffectToEffectData has changes [] and the row under flags`, Array.isArray(data.changes) && data.changes.length === 0 && data.flags?.shadowbase?.statusEffect?.id === row.id && data.transfer === false && data.disabled === false);
  ok(`${row.id}: effectToStatusEffect(statusEffectToEffectData(row)) == row with NO_MODIFIERS spread`, ser(effectToStatusEffect(data)) === ser(zodShape(row)), `${ser(effectToStatusEffect(data)).slice(0, 120)}`);
  const expectedStatus = config.statusIdForRow(row);
  ok(`${row.id}: statuses carries the CONFIG id the row maps to (${expectedStatus})`, data.statuses.length === 1 && data.statuses[0] === expectedStatus && cfgIds.includes(expectedStatus));
}
ok('the stored rows validate against the bundle\'s statusEffectSchema after the spread (the zod shape)', ROWS.every((r) => engine.statusEffectSchema.safeParse(zodShape(r)).success));

const blank = engine.blank();
const build = (rows, extra = {}) => shim.buildActor(sheetToActorData({ ...blank, ...extra, statusEffects: rows }));
{
  const actor = build(ROWS);
  const stored = actor.effects.filter(isStatusEffect);
  ok('every stored row is an ActiveEffect on the actor', stored.length === ROWS.length, `${stored.length}`);
  ok('every stored effect has EMPTY changes (the engine sums the bag; a change would double it)', stored.every((e) => e.changes.length === 0));
  ok('the document round trip equals the zod shape (toStatusEffect)', stored.every((e) => ser(e.toStatusEffect()) === ser(zodShape(ROWS.find((r) => r.id === e.statusRow.id)))));
  ok('actorToSheet hands the engine every row', actorToSheet(actor).statusEffects.length === ROWS.length);
  const sum = ROWS.reduce((a, r) => a + (r.modifiers?.dexterity ?? 0), 0);
  ok(`the engine sums the bags from the sheet (DX ${sum})`, actor.system.derived.modifiers.dexterity === sum, `${actor.system.derived.modifiers.dexterity}`);
}
// The corpus: templates store no effects today; that is recorded, not assumed.
const corpus = loadCorpus(engine);
const corpusRows = corpus.reduce((n, c) => n + (c.sheet.statusEffects?.length ?? 0), 0);
console.log(`corpus stored status-effect rows: ${corpusRows} across ${corpus.length} entries (the synthetic rows above are the denominator)`);
for (const entry of corpus.filter((c) => c.sheet.statusEffects?.length)) {
  const actor = shim.buildActor(sheetToActorData(entry.sheet));
  ok(`${entry.name}: ${entry.sheet.statusEffects.length} stored rows -> ActiveEffects with empty changes`, actor.effects.filter(isStatusEffect).every((e) => e.changes.length === 0) && actor.effects.filter(isStatusEffect).length === entry.sheet.statusEffects.length);
}

// ---- the rejected alternative: changes on system.* (double application) ---------------------------------------
{
  const row = { id: 'dx-buff', name: 'Focus', type: 'buff', source: 'Manual / DM', description: '+2 DX', isManual: true, isGear: false, modifiers: { ...NO, dexterity: 2 } };
  const clean = build([row]);
  const data = sheetToActorData({ ...blank, statusEffects: [row] });
  data.effects[0].changes = [{ key: 'system.dexterity', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: '2' }];
  const doubled = shim.buildActor(data);
  ok('the rejected alternative (a change on system.dexterity beside the bag) doubles the figure through the engine: DX 14 vs 12',
    clean.system.derived.primaryAttributes.effectiveDexterity === 12 && doubled.system.derived.primaryAttributes.effectiveDexterity === 14,
    `clean ${clean.system.derived.primaryAttributes.effectiveDexterity}, with changes ${doubled.system.derived.primaryAttributes.effectiveDexterity}`);
}

// ---- sweepExpired against the website's literal predicate -----------------------------------------------------
{
  const stamps = [1, 2, 3, 4, null, undefined, '2', 'x'];
  const rows = stamps.map((s, i) => ({ id: `t-${i}`, name: `T${i} (${JSON.stringify(s) ?? 'undefined'})`, type: 'debuff', source: 'Test', description: 'turn-scoped', isManual: true, isGear: false, modifiers: { ...NO }, ...(s === undefined ? {} : { expiresAfterTurn: s }) }));
  // resource-trackers.tsx line 315, verbatim: the rows the website KEEPS when the counter reaches `turn`.
  const websiteKept = (list, turn) => list.filter((e) => e?.expiresAfterTurn == null || turn <= Number(e.expiresAfterTurn));
  for (const turn of [0, 1, 2, 3, 4, 5]) {
    const actor = build(rows);
    const removed = await effects.sweepExpired(actor, turn);
    const keptNames = actor.effects.filter(isStatusEffect).map((e) => e.name).sort();
    const expectedKept = websiteKept(rows, turn).map((r) => r.name).sort();
    ok(`sweepExpired(turn ${turn}) removes exactly the website's kept-complement (removed ${removed.length})`, keptNames.join('|') === expectedKept.join('|') && removed.sort().join('|') === rows.filter((r) => !websiteKept(rows, turn).includes(r)).map((r) => r.name).sort().join('|'),
      `kept ${keptNames.join(',')} vs website ${expectedKept.join(',')}`);
    ok(`isExpiredAt agrees with the website predicate on every row at turn ${turn} (document and pure helper)`, rows.every((r) => effects.isExpiredAt(r, turn) === !websiteKept([r], turn).length));
  }
  const actor = build(rows);
  await effects.sweepExpired(actor, 3);
  const afterThree = actor.effects.size;
  await effects.sweepExpired(actor, 1);
  ok('rewinding the counter never revives a removed row', actor.effects.size === afterThree);
  const viaActor = build(rows);
  await viaActor.update({ 'system.facingChangeUsed': true, 'system.parriesThisTurn': 2 });
  const names = await viaActor.sweepTurn(3);
  const dropAtThree = rows.length - websiteKept(rows, 3).length;
  ok('ShadowBaseActor#sweepTurn delegates to effects.sweepExpired (the website\'s complement at turn 3) and resets the per-turn fields', names.length === dropAtThree && viaActor.system.facingChangeUsed === false && viaActor.system.parriesThisTurn === 0 && viaActor.effects.size === rows.length - dropAtThree, `${names.join(',')}`);
}

// ---- advancePhase: the crash is an EVENT against the current pool ---------------------------------------------------
{
  const stim = ROWS.find((r) => r.id === 'stim-1');
  const actor = build([stim]);
  const maxEp = actor.system.derived.currentValues.endurancePoints;
  ok('a never-recorded pool reads full (null means full)', actor.system.currentEndurancePoints === null && actor.system.resources.ep.value === maxEp);
  const result = await effects.advancePhase(actor, 'stim-1');
  const row = effects.findEffect(actor, 'stim-1').statusRow;
  ok('advancePhase deducts the phase\'s crash EP from currentEndurancePoints (full pool resolved first)', actor.system.currentEndurancePoints === maxEp - 4 && result?.currentEP === maxEp - 4, `${actor.system.currentEndurancePoints} vs ${maxEp - 4}`);
  ok('the advanced row\'s endurancePoints channel is 0 (the figure was converted out of the bag)', row.modifiers.endurancePoints === 0 && Object.keys(NO).every((k) => k in row.modifiers));
  ok('the row is rewritten from the phase: name, type, description, duration, phaseIndex 1', row.name === 'Adrenal Stim Crash' && row.type === 'debuff' && row.description === stim.phases[0].description && row.duration === 'Recovery Period' && row.phaseIndex === 1);
  ok('the effect\'s name and status follow the phase (crash)', effects.findEffect(actor, 'stim-1').name === 'Adrenal Stim Crash' && effects.hasStatus(effects.findEffect(actor, 'stim-1'), 'crash'));
  ok('the maximum EP did not move (the rejected reading applied -4 to the maximum)', actor.system.derived.currentValues.endurancePoints === maxEp, `${actor.system.derived.currentValues.endurancePoints}`);
  const rejected = engine.getCalculatedStats({ ...blank, statusEffects: [{ ...zodShape(stim), modifiers: { ...NO, endurancePoints: -4 } }] });
  ok('under the rejected bag the engine lowers the MAXIMUM by 4 - which is why the channel is zeroed', rejected.currentValues.endurancePoints === maxEp - 4);
  ok('a second advance with no phase left is a no-op (null)', (await effects.advancePhase(actor, 'stim-1')) === null && actor.system.currentEndurancePoints === maxEp - 4);
  const low = build([stim], { currentEndurancePoints: 2 });
  await effects.advancePhase(low, 'stim-1');
  ok('the deduction clamps at 0 (the app\'s EP-spend convention)', low.system.currentEndurancePoints === 0);
  ok('the engine\'s own applyCrashPhase is what ran (same figures)', engine.stimulantCrash.applyCrashPhase({ phaseModifiers: { endurancePoints: -4 }, currentEP: 2 }).currentEP === 0 && engine.stimulantCrash.applyCrashPhase({ phaseModifiers: { endurancePoints: -4 }, currentEP: maxEp }).effectModifiers.endurancePoints === 0);
}

// ---- recoverEp ----------------------------------------------------------------------------------------------------------------
{
  const row = { id: 'crash-1', name: 'Crash', type: 'debuff', source: 'Metabolism (Crash)', description: 'x', isManual: true, isGear: false, modifiers: { ...NO, endurancePoints: -2 } };
  const actor = build([row]);
  const r1 = await effects.recoverEp(actor, 'crash-1');
  ok('recoverEp moves the penalty one step toward 0 (-2 -> -1) and keeps the effect', r1?.ended === false && r1.endurancePoints === -1 && effects.findEffect(actor, 'crash-1')?.statusRow.modifiers.endurancePoints === -1);
  const r2 = await effects.recoverEp(actor, 'crash-1');
  ok('recoverEp at -1 ends the effect', r2?.ended === true && effects.findEffect(actor, 'crash-1') === null && actor.effects.size === 0);
  const none = build([ROWS.find((r) => r.id === 'manual-1')]);
  ok('recoverEp on a row without a negative EP channel is a no-op (null)', (await effects.recoverEp(none, 'manual-1')) === null && none.effects.size === 1);
}

// ---- dismissEffect ---------------------------------------------------------------------------------------------------------------
{
  const actor = build([ROWS.find((r) => r.id === 'legacy-stim-1'), ROWS.find((r) => r.id === 'stim-1'), ROWS.find((r) => r.id === 'gear-1')]);
  const maxEp = actor.system.derived.currentValues.endurancePoints;
  const r = await effects.dismissEffect(actor, 'legacy-stim-1');
  const crash = actor.effects.filter(isStatusEffect).map((e) => e.statusRow).find((row) => row.source === 'Metabolism (Crash)');
  ok('dismissing a LEGACY stimulant (no phases) crashes: EP -3 and an informational crash card appended', r?.crashEp === 3 && actor.system.currentEndurancePoints === maxEp - 3 && crash && crash.name === 'Old Stim Crash' && crash.duration === 'Recovery Period' && crash.isManual === true && crash.modifiers.endurancePoints === 0, JSON.stringify(r));
  ok('the dismissed row is gone', effects.findEffect(actor, 'legacy-stim-1') === null);
  const before = actor.system.currentEndurancePoints;
  await effects.dismissEffect(actor, 'stim-1');
  ok('dismissing a PHASED stimulant does not crash (its crash is the Advance control)', actor.system.currentEndurancePoints === before && effects.findEffect(actor, 'stim-1') === null && actor.effects.filter((e) => e.statusRow?.source === 'Metabolism (Crash)').length === 1);
  ok('a gear-locked row is not dismissable (the website hides the button)', (await effects.dismissEffect(actor, 'gear-1')) === null && effects.findEffect(actor, 'gear-1') !== null);
  ok('an unknown id is a no-op (null)', (await effects.dismissEffect(actor, 'nope')) === null);
}

// ---- addManualEffect / addEffect --------------------------------------------------------------------------------------------------
{
  const actor = build([]);
  const before = actor.system.derived.currentEncumbrance.dodge;
  const e = await effects.addManualEffect(actor, { name: 'Cover', type: 'buff', description: 'Behind a crate', modifiers: { dodge: 1 } });
  const row = e.statusRow;
  ok('addManualEffect stores the HUD\'s manual shape: uuid id, source Manual / DM, isManual, full bag', /^[0-9a-f-]{36}$/.test(row.id) && row.source === 'Manual / DM' && row.isManual === true && row.isGear === false && row.modifiers.dodge === 1 && Object.keys(NO).every((k) => k in row.modifiers) && e.changes.length === 0);
  ok('the engine applies it (dodge +1)', actor.system.derived.currentEncumbrance.dodge === before + 1);
  const blankName = await effects.addManualEffect(actor, {});
  ok('a nameless manual effect gets the website\'s "New Effect" default', blankName.statusRow.name === 'New Effect' && blankName.name === 'New Effect');
}

// ---- stun <-> status, both ways ---------------------------------------------------------------------------------------------------------
// The hooks run un-awaited (Foundry's callAll ignores promises); `settle` lets their embedded operations
// finish before a pin reads the actor, the way a rendered sheet would see them a tick later.
const settle = () => new Promise((r) => setTimeout(r, 0));
{
  const actor = build([]);
  const mirrors = () => actor.effects.filter(effects.isStunMirror);
  const stunnedCards = () => actor.system.derived.activeStatusEffects.filter((c) => c.id === 'stunned').length;
  await actor.update({ 'system.stunType': 'Physical' }); await settle();
  ok('stunType Physical -> one stun mirror carrying stunned-physical, with no row', mirrors().length === 1 && effects.stunStatusOf(mirrors()[0]) === 'stunned-physical' && !isStatusEffect(mirrors()[0]) && mirrors()[0].changes.length === 0);
  ok('the mirror is absent from the sheet and the engine derives exactly ONE Stunned card', actorToSheet(actor).statusEffects.length === 0 && stunnedCards() === 1);
  ok('the actor\'s statuses set carries the id (what the token reads)', actor.statuses.has('stunned-physical'));
  // The mirror's shape (ARCHITECTURE.md §9.1 "Stun sync"): a stunMirror flag and NO statusEffect row - the engine
  // derives the Stunned card from stunType, so a row here would be the two-card shape rejected below.
  const m0 = mirrors()[0];
  ok('the stun mirror carries flags.shadowbase.stunMirror and no flags.shadowbase.statusEffect row', m0.flags.shadowbase.stunMirror === true && m0.flags.shadowbase.statusEffect === undefined && !isStatusEffect(m0)
    && effects.stunMirrorData('Physical').flags.shadowbase.statusEffect === undefined && effects.stunMirrorData('Mental').flags.shadowbase.statusEffect === undefined && effects.stunMirrorData('None') === null);
  // Idempotence, stunType -> token (§9.1: "both directions are no-ops when the target state already matches"):
  // a second sync, a replayed updateActor hook and a same-value update all leave exactly one mirror.
  const again = await effects.syncStun(actor); await settle();
  ok('syncStun again: nothing created, nothing removed, still one mirror', again.created === 0 && again.removed === 0 && mirrors().length === 1, JSON.stringify(again));
  Hooks.callAll('updateActor', actor, { system: { stunType: 'Physical' } }, {}, game.userId); await settle();
  ok('the updateActor hook replayed with the same stunType: still exactly one mirror (no duplicate, no loop)', mirrors().length === 1 && stunnedCards() === 1, `${mirrors().length} mirrors`);
  await actor.update({ 'system.stunType': 'Physical' }); await settle();
  ok('a same-value stunType update: still one mirror', mirrors().length === 1);
  // Idempotence, token -> stunType: agreeing state writes nothing (the shim's write log is the witness).
  const updatesFor = (id) => shim.shimLog().filter((e) => e.op === 'update' && e.document === 'Actor' && e.id === id).length;
  const before = updatesFor(actor.id);
  ok('syncStunFromEffects with a matching mirror returns false and writes nothing', (await effects.syncStunFromEffects(actor)) === false && updatesFor(actor.id) === before, `${updatesFor(actor.id) - before} update(s) logged`);
  await actor.createEmbeddedDocuments('ActiveEffect', [{ name: 'Stunned (Physical)', img: 'icons/svg/daze.svg', statuses: ['stunned-physical'] }]); await settle();
  ok('a duplicate token toggle of the current stun writes no stunType update (the createActiveEffect guard)', updatesFor(actor.id) === before && actor.system.stunType === 'Physical' && mirrors().length === 2, `${updatesFor(actor.id) - before} update(s) logged, ${mirrors().length} mirrors`);
  await actor.deleteEmbeddedDocuments('ActiveEffect', [mirrors()[1].id]); await settle();
  ok('removing the duplicate while its twin stays leaves stunType Physical and one mirror', actor.system.stunType === 'Physical' && mirrors().length === 1);
  await actor.update({ 'system.stunType': 'Mental' }); await settle();
  ok('stunType Mental -> the physical mirror is replaced by a mental one', mirrors().length === 1 && effects.stunStatusOf(mirrors()[0]) === 'stunned-mental' && actor.system.stunType === 'Mental');
  await actor.update({ 'system.stunType': 'None' }); await settle();
  ok('stunType None -> no mirror', mirrors().length === 0 && stunnedCards() === 0);
  // token -> stunType: what Actor#toggleStatusEffect creates (a status, a name, an img - no flags of ours).
  await actor.createEmbeddedDocuments('ActiveEffect', [{ name: 'Stunned (Mental)', img: 'icons/svg/unconscious.svg', statuses: ['stunned-mental'] }]); await settle();
  ok('a token-HUD stun toggle writes stunType (Mental)', actor.system.stunType === 'Mental' && mirrors().length === 1 && stunnedCards() === 1);
  await actor.deleteEmbeddedDocuments('ActiveEffect', mirrors().map((e) => e.id)); await settle();
  ok('removing the stun status from the token clears stunType', actor.system.stunType === 'None' && mirrors().length === 0);
  await effects.toggleStatus(actor, 'stunned-physical'); await settle();
  ok('toggleStatus on a stun id writes stunType', actor.system.stunType === 'Physical' && mirrors().length === 1);
  const d = await effects.dismissEffect(actor, 'stunned'); await settle();
  ok('dismissing the derived "stunned" card clears stunType and the mirror follows', d?.dismissed === 'stunned' && actor.system.stunType === 'None' && mirrors().length === 0);
  // The rejected shape: the stun stored as a row. The engine derives Stunned from stunType too -> two cards.
  const stunRow = { id: 'stunned', name: 'Stunned (Physical)', type: 'debuff', source: 'Chapter 9', description: 'Attacks are locked out.', isManual: false, isGear: false, modifiers: { ...NO } };
  const two = engine.getCalculatedStats({ ...blank, stunType: 'Physical', statusEffects: [zodShape(stunRow)] }).activeStatusEffects.filter((c) => c.id === 'stunned').length;
  ok('the rejected shape (stun stored as a status-effect row) lists Stunned twice; the mirror lists it once', two === 2);
  // A token-HUD toggle of a non-stun status becomes a manual stored row.
  await actor.createEmbeddedDocuments('ActiveEffect', [{ name: 'Bleeding', img: 'icons/svg/blood.svg', statuses: ['bleeding'] }]); await settle();
  const adopted = actor.effects.find((e) => effects.hasStatus(e, 'bleeding'));
  ok('a token-HUD toggle of a non-stun status is adopted as a manual stored effect with that name and no bag', adopted && isStatusEffect(adopted) && adopted.statusRow.name === 'Bleeding' && adopted.statusRow.isManual === true && Object.values(adopted.statusRow.modifiers).every((v) => v === 0 || v === 1 || v === false) && adopted.changes.length === 0);
  ok('the adopted row reaches the sheet and the engine (a card with a description)', actorToSheet(actor).statusEffects.some((r) => r.name === 'Bleeding') && actor.system.derived.activeStatusEffects.some((c) => c.name === 'Bleeding'));
  await effects.toggleStatus(actor, 'bleeding', { active: false }); await settle();
  ok('toggleStatus off removes the stored effects carrying that status', !actor.effects.some((e) => effects.hasStatus(e, 'bleeding')));
  await effects.toggleStatus(actor, 'shock'); await settle();
  ok('toggleStatus on a non-stun id adds a manual stored effect carrying the status', actor.effects.some((e) => isStatusEffect(e) && effects.hasStatus(e, 'shock')));
}

// ---- Ch7 Reeling (2026-10-02): a DERIVED card, like Stunned and Encumbered - never a stored row -------------------------------------
// The engine lists "Reeling (below 1/3 HP)" among the active effects while current HP is below one third of the
// maximum, with an EMPTY bag (the Move and Dodge halves are applied in its derivation - a bag would state both
// twice) and isGear (not dismissable: it follows current HP and would return at once). Nothing here stores it, so
// nothing reaches an ActiveEffect, the sheet's statusEffects or an export; a droid reads "Damaged systems".
{
  const cardsOf = (actor) => actor.system.derived.activeStatusEffects.filter((c) => c.id === 'reeling');
  const organic = build([]);
  const droid = build([], { isDroid: true });
  ok('at full (unset) HP nobody reels: no card', cardsOf(organic).length === 0 && organic.system.derived.reeling.active === false && cardsOf(droid).length === 0);
  for (const [actor, label] of [[organic, engine.reeling.reelingLabel(false)], [droid, engine.reeling.reelingLabel(true)]]) {
    const threshold = actor.system.derived.reeling.threshold;
    const moveBefore = actor.system.derived.currentEncumbrance.move;
    const dodgeBefore = actor.system.derived.currentEncumbrance.dodge;
    await actor.update({ 'system.currentHitPoints': threshold - 1 });
    const cards = cardsOf(actor);
    const card = cards[0] ?? {};
    ok(`${label}: below one third of HP the engine lists exactly one card - a debuff from Chapter 7, isGear, with an empty bag`, cards.length === 1 && card.name === label && card.type === 'debuff' && card.source === 'Chapter 7' && card.isGear === true && card.isManual === false && !engine.hasAnyModifier(card.modifiers), JSON.stringify(card).slice(0, 200));
    ok(`${label}: and still halves Move and Dodge (in the derivation, not through the card's bag)`, actor.system.derived.currentEncumbrance.dodge === Math.ceil(dodgeBefore / 2) && actor.system.derived.currentEncumbrance.move < moveBefore, `dodge ${dodgeBefore} -> ${actor.system.derived.currentEncumbrance.dodge}, move ${moveBefore} -> ${actor.system.derived.currentEncumbrance.move}`);
    ok(`${label}: it is derived, not stored - no ActiveEffect, no row on the sheet, nothing in the export, nothing to dismiss`, effects.derivedEffects(actor).some((e) => e.id === 'reeling') && actor.effects.size === 0 && actorToSheet(actor).statusEffects.length === 0
      && !JSON.stringify(actor.exportSheet()).includes(label) && effects.findEffect(actor, 'reeling') === null && (await effects.dismissEffect(actor, 'reeling')) === null && cardsOf(actor).length === 1);
    await actor.update({ 'system.currentHitPoints': threshold });
    ok(`${label}: healed back to one third, the card goes`, cardsOf(actor).length === 0 && actor.system.derived.currentEncumbrance.dodge === dodgeBefore);
  }
  ok('the two labels differ (a droid "reels the same way" under its own name)', engine.reeling.reelingLabel(true) !== engine.reeling.reelingLabel(false) && /Damaged systems/.test(engine.reeling.reelingLabel(true)));
}

report(`${ROWS.length} producer rows, ${corpus.length} corpus entries (${corpusRows} stored rows), ${cfgIds.length} statuses`);
