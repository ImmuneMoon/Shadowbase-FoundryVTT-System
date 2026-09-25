#!/usr/bin/env node
// check:rolls
//
// SUBJECT: the table-play layer (docs/ARCHITECTURE.md §5): module/rolls.mjs
// (every target roll, the modifier stack, the damage-formula translation,
// attacks and their bookkeeping, defenses, powers, techniques, crew actions,
// stun recovery, the chat cards), module/combat.mjs (initiative, the
// tracker-driven turn counter and sweep), module/damage.mjs (the Tactical
// Damage Processor), module/apps/roll-dialog.mjs (headless surface only), and
// templates/chat/*.hbs - all driven through shim-built actors so the target
// derivations run through the same documents the sheet and the HUD use.
//
// Pinned, each against the website's own code path it was moved from:
//   - the 368-cell grid (total 3-18 x target 3-25) run THROUGH rolls.rollTarget
//     with injected dice equals engine.resolveRollOutcome on every cell, and the
//     husk's rule (fixtures/husk/actor.js:100-106: 3-4 critical success,
//     17-18 critical failure, else total <= target) is the rejected
//     alternative, diverging on exactly 41 cells (the count is asserted, so a
//     grid that stopped expressing the difference would fail);
//   - toFoundryFormula over EVERY distinct damage string the catalogs produce
//     (ranged kits through calculateBlasterStats, melee kits through
//     calculateMeleeWeaponStats at ST 10 and 20, the corpus sabers through
//     calculateLightsaberStats, explosives, starship weapons and their
//     upgrade, the corpus's unarmed strikes, the ST damage table, technique
//     damage bonuses appended): each translation evaluates in Foundry's dice
//     grammar, and the untranslatable set equals a DECLARED exception list
//     (stale entries fail). Evaluation: a tiny evaluator mirroring the grammar
//     subset the module emits (NdF, integer constants, + - and the * multiplier
//     bound to its dice term), and the NdF±m subset additionally through the
//     shim's Roll (tools/foundry-shim.mjs);
//   - fixed targets through shim-built actors: blank Dodge 8; Rokarr's
//     Guns (Blaster Pistol) 11 resolved from Guns (Bowcaster) 13 at -2 (Ch3's
//     sibling-specialty rate, resolveSkillLevel); Sahrhie 245 / HP 12 / Dodge
//     10 / Basic Speed 6 and Hshif 241 / 13 / 9 / 6 from fixtures/, and the
//     initiative 6.12 both (BS 6 + DX 12/100, never a die);
//   - the attack composition: the to-hit channel lands ONCE (a -4 toHit effect
//     moves the roll's target by exactly -4; the rejected alternative - the
//     to-hit folded into the target AND added as the modifier - would give -8);
//     the malfunction threshold is the derived figure (an undamaged kit blaster
//     rolls Malf 17; malfunctionOrBase(null durability, max) - the rejected
//     figure - answers 14);
//   - the modifier stack (roll-button.tsx:120-127): off-hand -4 on an attack
//     and -1 on a parry/block, only when dualWielding.penalized;
//   - the attack side effects on a shim actor (roller-window.tsx:1335-1418):
//     pendingHits banked, charges deducted only for the shots before a
//     malfunction, lastAttackTurn stamped, isUnready set on a ◊ weapon below
//     the 1.5x Min-ST lift, parriesThisTurn incremented by a parry, the stun
//     lock refusing every attack;
//   - the sweep semantics (expiresAfterTurn strictly less than the turn) both
//     through effects.isExpiredAt and through combat.onUpdateCombat on a fake
//     tracker and on a shim Combat document, and §5.2's gate: the hook acts on
//     the ACTIVE GM's client only (game.users.activeGM === game.user) - pinned by
//     reading module/combat.mjs and by calling the hook as a player, as a second
//     GM and with no GM connected (the counter must not move);
//   - §5.1's composition over EVERY readied weapon of the corpus: target =
//     weaponAttackSkill.attackSkillFor(row, skills, attrs, 0, new Map()).skillTarget
//     + the Min-ST shortfall, and target + hitBonus = attackSkillFor(..., toHit,
//     skillBonuses).target + shortfall (the engine's own folded figure - the bonus
//     lands once);
//   - the damage processor's arithmetic (hit-location-section.tsx:78-175,
//     177-357): the wounding multipliers, the anatomical overrides, the EP
//     routing, the bypasses, the Shock row's shape, the armor degradation,
//     crippling and severing, the prompts - with the `|| 0` threshold fallback
//     (any torso injury cripples) as the rejected alternative;
//   - every i18n key the four modules and six templates name is in lang/en.json
//     (U02c folded U04's key block in) and every SHADOWBASE.Roll/Combat/Damage
//     key of lang/en.json is named somewhere (no dead keys); every template
//     compiles with only the helpers Foundry registers and renders the live
//     contexts without an unresolved mustache.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - rolls.mjs offHandPenalty: `kind === 'defense' ? -1 : -4` -> `-3`
//       -> "off-hand attack penalty is -4" + the dual-wield attack through rollAttack
//   - rolls.mjs toFoundryFormula: `${n || '1'}d${f || '6'}` -> `${n || '1'}d${f || ''}` (bare d kept)
//       -> "3d-1 -> 3d6-1" + every catalog formula's evaluation
//   - rolls.mjs resolveOutcome: replaced by the husk rule
//       -> the 368-cell grid (41 cells red)
//   - rolls.mjs applyAttackSideEffects: `updates.pendingHits = hitCount` dropped on the plain branch
//       -> "single shot: pendingHits 1 banked and one charge spent" + the bowcaster's damage-volley pins
//   - rolls.mjs attackTargetFor: `target = resolved.level + stShortfall` -> `+ stShortfall + hitBonus`
//       -> "to-hit applied once: card target = base - 4"
//   - damage.mjs assessDamage: `isCrippling = canCripple && finalInjury > cThresh` -> `finalInjury > (cThresh || 0)`
//       -> "torso never cripples (threshold null)"
//   - combat.mjs onUpdateCombat: the `setTurn` call skipped
//       -> "round 2: turnCounter follows" + the sweep
//   - combat.mjs isActingClient: `return true` (every client acts) (U02c)
//       -> "updateCombat on a player's client: no actor is touched" + the source pin
//   - rolls.mjs attackTargetFor: attackSkillFor(..., stats.modifiers.toHit, stats.skillBonuses) and
//     `resolved.target` used as the target with hitBonus still added (the review's M3 fold) (U02c)
//       -> "to-hit applied once: card target = base - 4" (reads 5) + "the -4 card's rolled target (9) equals ..."
//          + "every readied weapon of the corpus composes ..."
//
//   node scripts/check-rolls.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { makeReporter, installSystem, loadCorpus, ROOT } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:rolls');
const { shim, engine, adapter, effects, translations } = await installSystem();
const rolls = await import('../module/rolls.mjs');
const combatMod = await import('../module/combat.mjs');
const damageMod = await import('../module/damage.mjs');
const dialogMod = await import('../module/apps/roll-dialog.mjs');
const { sheetToActorData } = adapter;
const unwrap = (t) => (typeof t?.data === 'function' ? t.data() : (t?.data ?? t));
const template = (key) => unwrap(engine.characterTemplateStore[key]);
const settle = () => new Promise((r) => setTimeout(r, 0));

// ---- the i18n keys: lang/en.json owns them (U02c folded U04's request block in) ---------------------------
const OWNED_AREAS = ['SHADOWBASE.Roll.', 'SHADOWBASE.Combat.', 'SHADOWBASE.Damage.'];
const ownedKeys = Object.keys(translations).filter((k) => OWNED_AREAS.some((p) => k.startsWith(p)));
ok('lang/en.json carries the Roll / Combat / Damage areas (denominator)', ownedKeys.length >= 60, `${ownedKeys.length} keys`);
ok('docs/REQUESTS.md no longer carries a u04-i18n block (the keys live in lang/en.json)', !/```json u04-i18n/.test(readFileSync(join(ROOT, 'docs', 'REQUESTS.md'), 'utf8')));

// ---- a Handlebars renderer standing in for foundry.applications.handlebars.renderTemplate ------------------
const require = createRequire(import.meta.url);
const Handlebars = require('handlebars');
Handlebars.registerHelper('localize', function (key, options) {
  const hash = options?.hash ?? {};
  return Object.keys(hash).length ? game.i18n.format(key, hash) : game.i18n.localize(key);
});
const KNOWN_HELPERS = { localize: true, if: true, unless: true, each: true, with: true, lookup: true, log: true, blockHelperMissing: true, helperMissing: true };
const compiled = new Map();
const templatePath = (p) => join(ROOT, p.replace(/^systems\/shadowbase\//, ''));
const rendered = [];
async function renderTemplate(path, data) {
  if (!compiled.has(path)) compiled.set(path, Handlebars.compile(readFileSync(templatePath(path), 'utf8'), { knownHelpers: KNOWN_HELPERS, knownHelpersOnly: true, strict: false }));
  const html = compiled.get(path)(data);
  rendered.push({ path, html, data });
  return html;
}
foundry.applications.handlebars = { renderTemplate };

const NO = engine.NO_MODIFIERS;
const build = (sheet, extra = {}) => shim.buildActor(sheetToActorData({ ...sheet, ...extra }));
const lastMessage = () => ChatMessage.log[ChatMessage.log.length - 1];
const queue = (...totals) => { Roll._queue.length = 0; Roll.queueResults(totals); };

// ---- 1. the 368-cell grid through rollTarget -----------------------------------------------------------------
{
  const actor = build(template('blank'));
  const huskClass = (total, target) => (total <= 4 ? 'criticalSuccess' : total >= 17 ? 'criticalFailure' : total <= target ? 'success' : 'failure');
  const engineClass = (o) => (o.isCriticalSuccess ? 'criticalSuccess' : o.isCriticalFailure ? 'criticalFailure' : o.isAutomaticFailure ? 'automaticFailure' : o.success ? 'success' : 'failure');
  let cells = 0; let agree = 0; let diverge = 0; let cardsAgree = 0;
  for (let total = 3; total <= 18; total++) {
    for (let target = 3; target <= 25; target++) {
      cells++;
      queue(total);
      const r = await rolls.rollTarget(actor, { label: 'Grid', target, modifier: 0 });
      const expected = engine.resolveRollOutcome(total, target, null);
      if (r && JSON.stringify(r.outcome) === JSON.stringify(expected) && r.total === total && r.target === target) agree++;
      const flags = lastMessage()?.flags?.shadowbase;
      if (flags && JSON.stringify(flags.outcome) === JSON.stringify(expected) && flags.resultKey === engineClass(expected)) cardsAgree++;
      if (huskClass(total, target) !== engineClass(expected)) diverge++;
    }
  }
  ok('the grid is 368 cells (16 totals x 23 targets)', cells === 368, `${cells}`);
  ok('rollTarget agrees with engine.resolveRollOutcome on every cell', agree === 368, `${agree}/368`);
  ok('every card carries the outcome and the result key the engine gave', cardsAgree === 368, `${cardsAgree}/368`);
  ok('the husk rule (fixtures/husk/actor.js:100-106) diverges on exactly 41 cells', diverge === 41, `${diverge}`);
  ok('the positive control exists: fixtures/husk/actor.js carries the <= 4 / >= 17 rule', /total <= 4/.test(readFileSync(join(ROOT, 'fixtures', 'husk', 'actor.js'), 'utf8')) && /total >= 17/.test(readFileSync(join(ROOT, 'fixtures', 'husk', 'actor.js'), 'utf8')));
  // A null target is refused, not coerced to 10 (roll-button.tsx:130 is the rejected alternative).
  const before = ChatMessage.log.length;
  ok('a null target is refused (no card)', (await rolls.rollTarget(actor, { label: 'x', target: null, modifier: 0 })) === null && ChatMessage.log.length === before);
  ok('a non-numeric target is refused', (await rolls.rollTarget(actor, { label: 'x', target: 'abc', modifier: 0 })) === null);
  // The malfunction and the ghost-glitch riders on the card.
  queue(17);
  const m = await rolls.rollTarget(actor, { label: 'Malf', target: 16, modifier: 0, malfunctionThreshold: 16, flawedItem: true });
  ok('a 17 at Malf 16 and skill 16 is an automatic (non-critical) failure with the malfunction and the ghost glitch noted', m.outcome.isAutomaticFailure && !m.outcome.isCriticalFailure && m.outcome.isMalfunction && m.result.lines.length === 3, JSON.stringify(m.result.lines));
  // Roll history: newest first, capped at the default depth of 10.
  const history = rolls.rollHistory(actor);
  ok('roll history is capped at the default depth (10) and newest first', history.length === 10 && history[0].title.startsWith('Malf'), `${history.length} / ${history[0]?.title}`);
  ok('rollHistoryDepth falls back to 10 while the setting is unregistered (U10)', rolls.rollHistoryDepth() === 10);
}

// ---- 2. the outcome lines follow the website's label order (use-dice-roller.ts:257-294) --------------------------
{
  const lines = async (t, tg, malf, extra) => (await rolls.outcomeLines(engine.resolveRollOutcome(t, tg, malf), { total: t, target: tg, malfunctionThreshold: malf, ...extra })).key;
  ok('3 is a critical success', (await lines(3, 10, null)) === 'criticalSuccess');
  ok('18 is a critical failure', (await lines(18, 20, null)) === 'criticalFailure');
  ok('17 at skill 16 is an automatic failure, not critical', (await lines(17, 16, null)) === 'automaticFailure');
  ok('17 at skill 15 is a critical failure', (await lines(17, 15, null)) === 'criticalFailure');
  ok('16 at Malf 16 is a malfunction', (await lines(16, 20, 16)) === 'malfunction');
  ok('a plain miss is a failure', (await lines(12, 10, null)) === 'failure');
  ok('a hit is a success', (await lines(9, 10, null)) === 'success');
}

// ---- 3. toFoundryFormula over every catalog damage string -------------------------------------------------------
/** Foundry's grammar subset the module emits: expr := term (('+'|'-') term)*; term := factor ('*' factor)*; factor := NdF | integer. */
function evaluate(formula, rng = () => Math.random()) {
  const toks = formula.match(/\d+d\d+|\d+(?:\.\d+)?|[+\-*]/g) ?? [];
  if (toks.join('') !== formula.replace(/\s+/g, '')) throw new Error(`unparsed characters in "${formula}"`);
  let i = 0;
  const factor = () => {
    const t = toks[i++];
    if (t === undefined) throw new Error(`unexpected end in "${formula}"`);
    const d = /^(\d+)d(\d+)$/.exec(t);
    if (d) { const n = Number(d[1]); const f = Number(d[2]); let sum = 0; for (let k = 0; k < n; k++) sum += 1 + Math.floor(rng() * f); return { v: sum, min: n, max: n * f }; }
    if (/^\d+(?:\.\d+)?$/.test(t)) { const v = Number(t); return { v, min: v, max: v }; }
    throw new Error(`unexpected token "${t}" in "${formula}"`);
  };
  const term = () => { let a = factor(); while (toks[i] === '*') { i++; const b = factor(); a = { v: a.v * b.v, min: a.min * b.min, max: a.max * b.max }; } return a; };
  let acc = toks[i] === '-' ? (i++, (() => { const t = term(); return { v: -t.v, min: -t.max, max: -t.min }; })()) : term();
  while (i < toks.length) {
    const op = toks[i++];
    const b = term();
    if (op === '+') acc = { v: acc.v + b.v, min: acc.min + b.min, max: acc.max + b.max };
    else if (op === '-') acc = { v: acc.v - b.v, min: acc.min - b.max, max: acc.max - b.min };
    else throw new Error(`unexpected operator "${op}" in "${formula}"`);
  }
  if (i !== toks.length) throw new Error(`trailing tokens in "${formula}"`);
  return acc;
}
const corpus = loadCorpus(engine);
{
  const strings = new Map(); // string -> where it came from
  const add = (s, from) => { if (s === undefined || s === null) return; const k = String(s); if (!strings.has(k)) strings.set(k, from); };
  const st = { effectiveStrength: 10, damageStLevels: 0, twoHandedStLevels: 0, useStrikingST: true };
  for (const p of engine.rangedWeaponProfiles.RANGED_WEAPON_PROFILES) {
    const kit = engine.blasterCommon.buildTemplateBlaster({ profileName: p.name });
    const s = engine.calculateBlasterStats(kit.blaster, kit.parts);
    add(s.finalDamage, `ranged:${p.name}`); add(`${s.finalDamage} ${s.finalDamageType ?? ''}`.trim(), `ranged+type:${p.name}`);
  }
  for (const p of engine.meleeWeaponProfiles.MELEE_WEAPON_PROFILES) {
    const kit = engine.meleeCommon.buildTemplateMeleeWeapon({ profileName: p.name });
    for (const es of [10, 20]) { const s = engine.calculateMeleeWeaponStats(kit.weapon, kit.parts, { ...st, effectiveStrength: es }); add(s.finalDamage, `melee:${p.name}@${es}`); add(`${s.finalDamage} ${s.finalDamageType ?? ''}`.trim(), `melee+type:${p.name}@${es}`); }
  }
  for (const e of engine.explosiveData.ALL_EXPLOSIVES_DATA) add(e.damageEffect, `explosive:${e.name}`);
  for (const w of engine.starshipWeapons.STARSHIP_WEAPONS_LIBRARY) { add(`${w.damage} ${w.damageType}`.trim(), `ship:${w.name}`); add(`${engine.starshipWeapons.upgradedDamage(w.damage)} ${w.damageType}`.trim(), `ship+upgrade:${w.name}`); }
  for (const [k, v] of Object.entries(engine.damageTable.damageMap)) { add(v.thrust, `damageMap:${k}:thrust`); add(v.swing, `damageMap:${k}:swing`); }
  let sabers = 0;
  for (const c of corpus) {
    const stats = engine.getCalculatedStats(c.sheet);
    add(stats.unarmedDamage.punch, `unarmed:${c.name}:punch`); add(stats.unarmedDamage.kick, `unarmed:${c.name}:kick`);
    for (const ls of c.sheet.lightsabers ?? []) { sabers++; const s = engine.calculateLightsaberStats(ls, c.sheet.lightsaberModifications ?? []); add(s.calculatedDamage, `saber:${c.name}`); add(s.calculatedDamageTwo, `saber2:${c.name}`); }
  }
  for (const b of [...new Set(engine.techniques.allCombatTechniques.map((t) => t.damageBonus).filter(Boolean))]) add(rolls.withDamageBonus('3d-1', b), `technique-bonus:${b}`);
  ok('catalog damage strings swept (denominator)', strings.size >= 60 && sabers >= 13, `${strings.size} distinct strings, ${sabers} corpus sabers`);
  console.log(`check:rolls formula sweep: ${strings.size} distinct damage strings`);
  // The declared exceptions: nothing to roll. A stale entry fails the check as loudly as a missing one.
  //   By Ammo / By Caliber: launchers and slugthrowers (the round carries the dice); Affliction-only explosives;
  //   "None" / "None cr": the Czerka Neural Whip profile derives no damage mode; "Special": the Tractor Beam
  //   Projector; "—": a saber with no second blade (calculatedDamageTwo, the legacy Kaelen fixture).
  const DECLARED_NOT_ROLLABLE = ['By Ammo', 'By Ammo burn', 'By Ammo ex', 'By Ammo pi', 'By Caliber (pi)', 'By Caliber (pi) pi', 'Affliction (HT-2)', 'Affliction (HT-3)', 'None', 'None cr', 'Special', '—'];
  const untranslated = [];
  const shimShapes = [];
  let evaluated = 0;
  for (const [s, from] of strings) {
    const t = rolls.toFoundryFormula(s);
    if (!t.ok) { untranslated.push(s); continue; }
    let fine = true;
    try {
      const bounds = evaluate(t.formula, () => 0);
      for (let k = 0; k < 50; k++) { const r = evaluate(t.formula); if (!Number.isFinite(r.v) || r.v < bounds.min || r.v > evaluate(t.formula, () => 0.999999).max) fine = false; }
      evaluated++;
    } catch (err) { fine = false; ok(`${from}: "${s}" -> "${t.formula}" evaluates`, false, err.message); }
    if (fine) shimShapes.push(t.formula);
  }
  ok('every translated formula evaluates in the grammar subset', evaluated === strings.size - untranslated.length, `${evaluated} evaluated, ${untranslated.length} not rollable`);
  const sortedU = [...untranslated].sort(); const sortedD = [...DECLARED_NOT_ROLLABLE].sort();
  ok('the untranslatable strings are exactly the declared exceptions', JSON.stringify(sortedU) === JSON.stringify(sortedD), `got ${JSON.stringify(sortedU)}`);
  Roll._queue.length = 0;
  let shimOk = 0;
  const shimFailed = [];
  for (const f of shimShapes) { try { const r = await new Roll(f).evaluate(); if (Number.isFinite(r.total)) shimOk++; else shimFailed.push(f); } catch (err) { shimFailed.push(`${f}: ${err.message}`); } }
  // No catalog string carries the xN multiplier or two dice terms today; the pin below covers those two shapes by example.
  ok('every translated formula evaluates through the shim\'s Roll too (its grammar is the module\'s: NdF | integer, + - and the * multiplier)', shimOk === shimShapes.length && shimShapes.length >= 40, `${shimOk}/${shimShapes.length}; ${shimFailed.slice(0, 3).join(' | ')}`);
  ok('the shim\'s Roll yields one dice term per NdF ("5d6+3d6" two, "2d6*3" one of two dice) and refuses a formula outside the grammar', (await new Roll('5d6+3d6').evaluate()).dice.length === 2 && (await new Roll('2d6*3').evaluate()).dice[0].results.length === 2 && await new Roll('3d6r1').evaluate().then(() => false, () => true) && await new Roll('(1d6)').evaluate().then(() => false, () => true));
  // The pins the header names, each against the website's own parser as the rejected alternative.
  const f = (s) => rolls.toFoundryFormula(s);
  ok('"3d-1" -> 3d6-1', f('3d-1').formula === '3d6-1');
  ok('"1d+2 cr" -> 1d6+2 with cr as flavor', f('1d+2 cr').formula === '1d6+2' && f('1d+2 cr').damageType === 'cr');
  ok('"5d energy+3d sonic" -> 5d6+3d6', f('5d energy+3d sonic').formula === '5d6+3d6' && f('5d energy+3d sonic').flavor === 'energy sonic');
  ok('"8d(5) cr ex" -> 8d6 with the armor divisor kept as flavor', f('8d(5) cr ex').formula === '8d6' && f('8d(5) cr ex').armorDivisor === 5 && /\(5\)/.test(f('8d(5) cr ex').flavor));
  ok('"2dx3" -> 2d6*3 (use-dice-roller.ts:159 multiplier)', f('2dx3').formula === '2d6*3' && f('2d*3').formula === '2d6*3');
  ok('"1d tox (HT-3)" -> 1d6 (the website\'s split would read "-3)" as a -3: rejected)', f('1d tox (HT-3)').formula === '1d6' && f('1d tox (HT-3)').flavor === 'tox (HT-3)');
  ok('"By Ammo burn" is not rollable (the website would roll it as a clamped 1: rejected)', f('By Ammo burn').ok === false);
  ok('"4d cr ex" damage type cr, "3d ion" ion', f('4d cr ex').damageType === 'cr' && f('3d ion').damageType === 'ion');
  ok('"pi++" survives as one word', f('2d pi++').flavor === 'pi++' && f('2d pi++').damageType === 'pi++');
}

// ---- 4. the modifier stack (roll-button.tsx:113-127) --------------------------------------------------------------
{
  ok('off-hand attack penalty is -4 when dual wielding is penalized and the toggle is on', rolls.offHandPenalty({ kind: 'attack', offHand: true, penalized: true }) === -4);
  ok('off-hand parry/block penalty is -1', rolls.offHandPenalty({ kind: 'defense', offHand: true, penalized: true }) === -1);
  ok('no off-hand penalty without the toggle or without the penalized state', rolls.offHandPenalty({ kind: 'attack', offHand: false, penalized: true }) === 0 && rolls.offHandPenalty({ kind: 'attack', offHand: true, penalized: false }) === 0);
  ok('total = situational + bonus - penalty + off-hand', rolls.stackModifiers({ situational: 2, skillBonus: 1, skillPenalty: 3, offHand: true, penalized: true, kind: 'attack' }) === -4);
  ok('a damage-style stack takes no off-hand', rolls.stackModifiers({ situational: 2, offHand: true, penalized: true, kind: 'other' }) === 2);
}

// ---- 5. fixed targets through shim-built actors -------------------------------------------------------------------
{
  const blank = build(template('blank'));
  ok('blank: Dodge 8', rolls.defenseTargetFor(blank, 'dodge').target === 8 && rolls.defenseTargetFor(blank, 'dodge').available === true, `${rolls.defenseTargetFor(blank, 'dodge').target}`);
  const rok = build(template('rokarr'));
  const guns = rolls.skillTargetFor(rok, 'Guns (Blaster Pistol)');
  ok('Rokarr: Guns (Blaster Pistol) 11 via Guns (Bowcaster) 13 at -2', guns.target === 11 && guns.resolution.source === 'specialty' && guns.resolution.from === 'Guns (Bowcaster)' && guns.resolution.penalty === 2, JSON.stringify(guns));
  queue(10);
  const skillRoll = await rolls.rollSkill(rok, 'Guns (Blaster Pistol)', { modifier: 0 });
  ok('rollSkill(Rokarr, Guns (Blaster Pistol)) rolls against 11 and names the skill', skillRoll.target === 11 && lastMessage().flags.shadowbase.skillName === 'Guns (Blaster Pistol)' && lastMessage().flags.shadowbase.kind === 'skill');
  ok('Rokarr: Strength rolls the EFFECTIVE 17 (racial +4), IQ the effective 9', rolls.attributeTarget(rok, 'st') === 17 && rolls.attributeTarget(rok, 'iq') === 9);
  const fixtures = Object.fromEntries(corpus.filter((c) => c.kind === 'export').map((c) => [c.file, build(c.sheet)]));
  const sah = fixtures['export-sahrhie-vosst-2026-09-06.json'];
  const hsh = fixtures['export-hshif-2026-09-05.json'];
  ok('fixtures present (denominator)', !!sah && !!hsh);
  if (sah) ok('Sahrhie: 245 spent / HP 12 / Dodge 10 / Basic Speed 6 / initiative 6.12', sah.stats.points.spent === 245 && sah.stats.currentValues.hitPoints === 12 && rolls.defenseTargetFor(sah, 'dodge').target === 10 && sah.stats.currentValues.basicSpeed === 6 && Math.abs(sah.system.initiative - 6.12) < 1e-9, `${sah.stats.points.spent}/${sah.stats.currentValues.hitPoints}/${rolls.defenseTargetFor(sah, 'dodge').target}/${sah.stats.currentValues.basicSpeed}/${sah.system.initiative}`);
  if (hsh) ok('Hshif: 241 / 13 / Dodge 9 / Basic Speed 6 / initiative 6.12', hsh.stats.points.spent === 241 && hsh.stats.currentValues.hitPoints === 13 && rolls.defenseTargetFor(hsh, 'dodge').target === 9 && hsh.stats.currentValues.basicSpeed === 6 && Math.abs(hsh.system.initiative - 6.12) < 1e-9);
  // Initiative is never a die: the Combatant formula is '@initiative' and evaluates the actor's roll data.
  const cbt = new combatMod.ShadowBaseCombatant();
  ok('Combatant._getInitiativeFormula is "@initiative" and CONFIG.Combat.initiative has 2 decimals', cbt._getInitiativeFormula() === '@initiative' && CONFIG.Combat.initiative.formula === '@initiative' && CONFIG.Combat.initiative.decimals === 2);
  ok('getRollData().initiative is Basic Speed + DX/100 (Rokarr 6.37)', Math.abs(rok.getRollData().initiative - 6.37) < 1e-9, `${rok.getRollData().initiative}`);
  // Characteristics: Fright Check immunity means no roll.
  const immune = build(template('blank'), { statusEffects: [{ id: 'imm', name: 'Battle Stim', type: 'buff', source: 'Manual / DM', isManual: true, modifiers: { ...NO, frightImmune: true } }] });
  ok('frightImmune short-circuits the Fright Check (no target, no card)', rolls.characteristicTarget(immune, 'frightCheck') === null && (await rolls.rollCharacteristic(immune, 'frightCheck', { modifier: 0 })) === null);
  ok('blank: Will 10, Perception 10, Vision 10', rolls.characteristicTarget(blank, 'will') === 10 && rolls.characteristicTarget(blank, 'perception') === 10 && rolls.characteristicTarget(blank, 'vision') === 10);
}

// ---- 6. the attack composition: to-hit once, derived Malf ----------------------------------------------------------
{
  const rok = build(template('rokarr'));
  const bow = rok.items.find((i) => i.type === 'blaster');
  const info = rolls.attackTargetFor(rok, bow);
  ok('Rokarr bowcaster: target 13 trained, hitBonus 0, Malf 17', info.target === 13 && info.type === 'trained' && info.hitBonus === 0 && info.malfunctionThreshold === 17, JSON.stringify({ t: info.target, h: info.hitBonus, m: info.malfunctionThreshold }));
  const debuffed = build(template('rokarr'), { statusEffects: [{ id: 'nr', name: 'Neural Rejection', type: 'debuff', source: 'Bio-Sync Error', isManual: true, modifiers: { ...NO, toHit: -4 } }] });
  const bow2 = debuffed.items.find((i) => i.type === 'blaster');
  const info2 = rolls.attackTargetFor(debuffed, bow2);
  ok('a -4 toHit effect leaves the skill target at 13 and puts -4 in the hit bonus (not in the target)', info2.target === 13 && info2.hitBonus === -4, JSON.stringify({ t: info2.target, h: info2.hitBonus }));
  queue(10);
  const atk = await rolls.rollAttack(debuffed, bow2, { modifier: 0, shots: 1 });
  ok('to-hit applied once: card target = base - 4 (the rejected fold-in-both would give -8)', atk.target === 9 && atk.baseTarget === 13 && atk.modifier === -4 && lastMessage().flags.shadowbase.target === 9, `${atk.baseTarget} -> ${atk.target}`);
  // §5.1's composition against the engine's own folded figure: the rolled target equals weaponAttackSkill
  // .attackSkillFor(row, skills, attrs, toHit, skillBonuses).target + the Min-ST shortfall - the resolver folds
  // the hit bonus in ONCE, so adding rolls' hitBonus on top of `.target` (the rejected fold) would read -8.
  const W = engine.weaponAttackSkill;
  const shortfallOf = (actor, row) => engine.weaponHandling.minStShortfallPenalty(row.finalStRequirement ?? engine.weaponHandling.rangedMinSt(row, actor.sheetData.weaponModifications ?? []), actor.stats.primaryAttributes.effectiveStrength);
  const engineFolded = (actor, item) => { const row = item.rowWithDerived(); return W.attackSkillFor(row, actor.sheetData.skills, engine.rollAttributes(actor.stats), actor.stats.modifiers.toHit, actor.stats.skillBonuses).target + shortfallOf(actor, row); };
  ok('the -4 card\'s rolled target (9) equals attackSkillFor(toHit, skillBonuses).target + shortfall; `.target` plus the hit bonus again would be 5', atk.target === engineFolded(debuffed, bow2) && engineFolded(debuffed, bow2) === 9 && engineFolded(debuffed, bow2) + info2.hitBonus === 5, `${engineFolded(debuffed, bow2)}`);
  ok('rolls.attackHitBonus IS the engine\'s weaponAttackSkill.attackHitBonus (delegation, not a re-statement)', rolls.attackHitBonus(-4, debuffed.stats.skillBonuses, 'Guns (Bowcaster)') === W.attackHitBonus(-4, debuffed.stats.skillBonuses, 'Guns (Bowcaster)') && rolls.attackHitBonus(-4, null, 'x') === -4 && /engine\.weaponAttackSkill\.attackHitBonus\(/.test(readFileSync(join(ROOT, 'module', 'rolls.mjs'), 'utf8')));
  {
    let readied = 0; let agree = 0; const disagree = [];
    for (const c of corpus) {
      const a = build(c.sheet);
      for (const w of rolls.equippedWeapons(a)) {
        readied++;
        const i = rolls.attackTargetFor(a, w);
        const bare = W.attackSkillFor(w.rowWithDerived(), a.sheetData.skills, engine.rollAttributes(a.stats), 0, new Map());
        if (i && bare && i.target === bare.skillTarget + i.stShortfall && i.type === bare.type && i.target + i.hitBonus === engineFolded(a, w)) agree++;
        else disagree.push(`${c.name}:${w.name} (${i?.target} vs ${bare?.skillTarget} + ${i?.stShortfall}; ${i?.type} vs ${bare?.type})`);
      }
    }
    // 29 readied weapons across the 71 corpus entries at the time of writing (templates ready few weapons); the floor is the denominator.
    ok(`every readied weapon of the corpus (${readied}) composes target = attackSkillFor().skillTarget + shortfall and target + hitBonus = attackSkillFor(toHit, skillBonuses).target + shortfall`, readied >= 20 && agree === readied, `${agree}/${readied} agree; ${disagree.slice(0, 5).join('; ')}`);
  }
  // Malf: the derived 17 against malfunctionOrBase(null, max) 14 (the review's M4).
  const kit = engine.blasterCommon.buildTemplateBlaster({ profileName: 'Blaster Pistol' });
  const withKit = build(template('blank'), { customBlasters: [{ ...kit.blaster, equipped: true }], weaponModifications: kit.parts });
  const pistol = withKit.items.find((i) => i.type === 'blaster');
  ok('an undamaged kit blaster rolls Malf 17 (malfunctionOrBase(null durability, max) answers 14: rejected)', rolls.malfunctionThresholdFor(pistol) === 17 && engine.malfunction.malfunctionOrBase(kit.blaster.durability, pistol.derived.maxDurability) === 14, `${rolls.malfunctionThresholdFor(pistol)} / ${engine.malfunction.malfunctionOrBase(kit.blaster.durability, pistol.derived.maxDurability)}`);
  // The crystal penalty rides the hit bonus (weapon-attack-skill.ts:127).
  const jedi = build(template('kaelenRarr'));
  const saber = jedi.items.find((i) => i.type === 'lightsaber');
  const sInfo = rolls.attackTargetFor(jedi, saber);
  ok('Kaelen\'s saber rolls Lightsaber Combat (Standard) trained', sInfo.isSaber && sInfo.skillName === 'Lightsaber Combat (Standard)' && sInfo.type === 'trained', JSON.stringify({ s: sInfo.skillName, t: sInfo.type, target: sInfo.target }));
  // `isFractured` on a fitted part derives crystalAttackPenalty -1 (lightsaber-stats.ts:236-239 - inside calcPiece, the
  // HILT loop, so the flag is read off a handgrip piece's owned row; the emitter is the one this pin marks).
  const crystal = jedi.items.find((i) => i.type === 'weaponPart' && i.system.row.id === saber.system.row.emitter?.inventoryId);
  ok('Kaelen\'s emitter is an owned part (denominator)', !!crystal);
  await crystal.updateRow({ isFractured: true });
  ok('a fractured crystal derives crystalAttackPenalty -1, which reaches the hit bonus and not the target', saber.derived.crystalAttackPenalty === -1 && rolls.attackTargetFor(jedi, saber).hitBonus === sInfo.hitBonus - 1 && rolls.attackTargetFor(jedi, saber).target === sInfo.target, `${saber.derived.crystalAttackPenalty} / ${rolls.attackTargetFor(jedi, saber).hitBonus}`);
  // The Min-ST shortfall moves the target (roller-window.tsx:889-892): a ST 13 axe in ST 10 hands is -3.
  const axeKit = engine.meleeCommon.buildTemplateMeleeWeapon({ profileName: "Arg'garok" });
  const weak = build(template('blank'), { customMeleeWeapons: [{ ...axeKit.weapon, equipped: true }], weaponModifications: axeKit.parts });
  const axe = weak.items.find((i) => i.type === 'meleeWeapon');
  const aInfo = rolls.attackTargetFor(weak, axe);
  ok('Arg\'garok (Min ST 13) in ST 10 hands: shortfall -3 inside the target', aInfo.stShortfall === -3 && aInfo.target === (engine.skillDefaults.resolveSkillLevel(aInfo.skillName, weak.sheetData.skills, engine.rollAttributes(weak.stats)).level ?? (10 - 5)) - 3, JSON.stringify({ t: aInfo.target, s: aInfo.stShortfall, n: aInfo.note }));
}

// ---- 7. attack side effects on shim actors (roller-window.tsx:1335-1418) ------------------------------------------
{
  // A single-shot weapon: pendingHits banked, one charge spent.
  const single = engine.rangedWeaponProfiles.RANGED_WEAPON_PROFILES.map((p) => ({ p, kit: engine.blasterCommon.buildTemplateBlaster({ profileName: p.name }) })).find(({ kit }) => (parseInt(engine.calculateBlasterStats(kit.blaster, kit.parts).finalRateOfFire || '1', 10) || 1) === 1 && !/stinger|launcher|tube|slugthrower|ripper|cycler/i.test(kit.blaster.baseType ?? ''));
  ok('a rate-of-fire-1 ranged kit exists (denominator)', !!single, 'none');
  if (single) {
    const actor = build(template('blank'), { customBlasters: [{ ...single.kit.blaster, equipped: true }], weaponModifications: single.kit.parts });
    const gun = actor.items.find((i) => i.type === 'blaster');
    const charges = gun.system.row.currentCharges;
    ok(`${single.p.name}: shots 1`, rolls.shotsFor(gun) === 1);
    // The blank has no Guns skill: the attack defaults to DX-4 = 6 (Ch3's printed default), so a 6 hits.
    const gInfo = rolls.attackTargetFor(actor, gun);
    ok(`${single.p.name} in untrained hands: target ${gInfo.target} by default (${gInfo.note})`, gInfo.type === 'default' && gInfo.target === 6, JSON.stringify(gInfo.note));
    queue(6);
    const r = await rolls.rollAttack(actor, gun, { modifier: 0 });
    ok('single shot: pendingHits 1 banked and one charge spent', r.outcome.success && gun.system.row.pendingHits === 1 && gun.system.row.currentCharges === charges - 1, `${gun.system.row.pendingHits} / ${gun.system.row.currentCharges}`);
    queue(12);
    await rolls.rollAttack(actor, gun, { modifier: 0 });
    ok('a plain miss banks 0 hits and still spends the shot', gun.system.row.pendingHits === 0 && gun.system.row.currentCharges === charges - 2, `${gun.system.row.pendingHits} / ${gun.system.row.currentCharges}`);
    queue(18);
    const malf = await rolls.rollAttack(actor, gun, { modifier: 0 });
    ok('an 18 at Malf 17 is a malfunction: 0 hits and NO charge spent (roller-window.tsx:1340-1343, shotsToDeduct = the shots before it)', malf.outcome.isMalfunction && gun.system.row.pendingHits === 0 && gun.system.row.currentCharges === charges - 2, `${gun.system.row.currentCharges}`);
    queue(6);
    await rolls.rollAttack(actor, gun, { modifier: 0 });
    const dmgFormula = rolls.damageFormulaFor(actor, gun);
    ok('damageFormulaFor reads the derived finalDamage', dmgFormula.formula === gun.derived.finalDamage && dmgFormula.pendingHits === 1);
    queue(7);
    const d = await rolls.rollDamage(actor, { item: gun });
    ok('rollDamage clears pendingHits and posts the damage card with the translated formula', gun.system.row.pendingHits === 0 && d.total === 7 && lastMessage().flags.shadowbase.kind === 'damage' && lastMessage().flags.shadowbase.formula === rolls.toFoundryFormula(gun.derived.finalDamage).formula);
    // Empty: the gate refuses.
    await gun.updateRow({ currentCharges: 0 });
    ok('no charge left: the attack is refused', rolls.attackBlockedReason(actor, gun) !== null && (await rolls.rollAttack(actor, gun, { modifier: 0 })) === null);
  }
  // Rokarr's bowcaster (RoF 10): a volley halted at the first malfunction; charges spent only for the shots before it.
  const rok = build(template('rokarr'));
  const bow = rok.items.find((i) => i.type === 'blaster');
  ok('bowcaster: 10 shots', rolls.shotsFor(bow) === 10);
  queue(10, 10, 17, 4, 4, 4, 4, 4, 4, 4);
  const v = await rolls.rollAttack(rok, bow, { modifier: 0 });
  ok('volley: 3 shots rolled (halted at the 17 = Malf 17), 2 hits', v.results.length === 3 && v.halted && v.hits === 2 && v.results[2].isMalfunction, JSON.stringify(v.results.map((r) => r.total)));
  ok('volley bookkeeping: pendingHits 2, charges 100 -> 98 (the malfunctioning shot is not deducted)', bow.system.row.pendingHits === 2 && bow.system.row.currentCharges === 98, `${bow.system.row.pendingHits} / ${bow.system.row.currentCharges}`);
  ok('the volley card lists the shots and the halt', lastMessage().flags.shadowbase.kind === 'volley' && lastMessage().flags.shadowbase.results.length === 3 && /Shot #3|Shot/.test(lastMessage().content));
  const dv = rolls.damageFormulaFor(rok, bow);
  ok('two banked hits become a damage volley of two "4d" items', dv.volley?.length === 2 && dv.volley.every((i) => i.formula === '4d'));
  queue(12, 14);
  const dd = await rolls.rollDamage(rok, { item: bow });
  ok('the damage volley rolls each hit and clears the bank', dd?.results?.length === 2 && dd.results[0].total === 12 && dd.results[1].total === 14 && bow.system.row.pendingHits === 0, dd?.results ? `${dd.results.length}` : 'no volley (pendingHits not banked?)');
  // Melee ◊: Arg'garok in ST 10 hands goes unready; the turn is stamped.
  const axeKit = engine.meleeCommon.buildTemplateMeleeWeapon({ profileName: "Arg'garok" });
  const weak = build(template('blank'), { turnCounter: 3, customMeleeWeapons: [{ ...axeKit.weapon, equipped: true }], weaponModifications: axeKit.parts });
  const axe = weak.items.find((i) => i.type === 'meleeWeapon');
  queue(3); // a 3 always hits: the untrained axe sits at DX-5-3 = 2
  const ma = await rolls.rollAttack(weak, axe, { modifier: 0 });
  ok('melee attack: lastAttackTurn = turnCounter (3) and isUnready (◊ below the 1.5x lift)', ma.sideEffects.unready && axe.system.row.isUnready === true && axe.system.row.lastAttackTurn === 3 && axe.system.row.pendingHits === 1, JSON.stringify(ma.sideEffects.updates));
  ok('an unready weapon is refused until a Ready maneuver', rolls.attackBlockedReason(weak, axe) !== null);
  await axe.updateRow({ isUnready: false });
  ok('after Ready the attack is allowed again', rolls.attackBlockedReason(weak, axe) === null);
  // The U gate: an Unbalanced weapon that attacked this turn cannot parry until the turn ends.
  const pInfo = rolls.defenseTargetFor(weak, 'parry', { weaponItem: axe });
  ok('Unbalanced axe that attacked this turn: no Parry (U gate)', pInfo.available === false && /Unbalanced|U/.test(pInfo.reason ?? ''), JSON.stringify(pInfo));
  await weak.update({ 'system.turnCounter': 4 });
  ok('next turn: the Parry comes back', rolls.defenseTargetFor(weak, 'parry', { weaponItem: axe }).available === true);
  // Strong hands: ST 30 shrugs the ◊ off.
  const strong = build(template('blank'), { strength: 30, customMeleeWeapons: [{ ...axeKit.weapon, equipped: true }], weaponModifications: axeKit.parts });
  const axe2 = strong.items.find((i) => i.type === 'meleeWeapon');
  queue(3);
  const sa = await rolls.rollAttack(strong, axe2, { modifier: 0 });
  ok('ST 30: the same attack leaves the axe ready', !sa.sideEffects.unready && !axe2.system.row.isUnready);
  // Stun locks every attack (Ch9), and the recovery roll clears it.
  await weak.update({ 'system.stunType': 'Physical' }); await settle();
  ok('stunned: the weapon attack is refused', (await rolls.rollAttack(weak, axe, { modifier: 0 })) === null && rolls.attackBlockedReason(weak, axe) !== null);
  ok('stunned: the unarmed attack is refused', (await rolls.rollUnarmed(weak, 'punch', { modifier: 0 })) === null);
  queue(5);
  const rec = await rolls.rollStunRecovery(weak, { modifier: 0 });
  ok('stun recovery rolls HT (10) for a physical stun and clears stunType on success', rec.baseTarget === 10 && rec.outcome.success && weak.system.stunType === 'None', `${rec.baseTarget} / ${weak.system.stunType}`);
  await settle();
  ok('not stunned: the recovery roll is refused', (await rolls.rollStunRecovery(weak, { modifier: 0 })) === null);
  // Parries count toward Ch12's ladder; the advisory appears from the second parry on.
  const rok2 = build(template('rokarr'));
  queue(8);
  const p1 = await rolls.rollDefense(rok2, 'parry', {}, { modifier: 0 });
  ok('unarmed parry rolls the best unarmed option (Brawling 11) and increments parriesThisTurn to 1', p1.baseTarget === 11 && rok2.system.parriesThisTurn === 1, `${p1.baseTarget} / ${rok2.system.parriesThisTurn}`);
  queue(8);
  await rolls.rollDefense(rok2, 'parry', {}, { modifier: 0 });
  ok('second parry: parriesThisTurn 2 and the multiple-parries advisory on the card', rok2.system.parriesThisTurn === 2 && /multiple-parries|Multiple parries/i.test(lastMessage().content));
  ok('a shim actor has no Block implement: refused', (await rolls.rollDefense(rok2, 'block', {}, { modifier: 0 })) === null);
  // Unarmed: punch and kick roll the same target (Brawling 14 for Rokarr) and bank a hit in a flag.
  const u = rolls.unarmedTargetFor(rok2);
  ok('Rokarr punches with trained Brawling 14', u.target === 14 && u.skillName === 'Brawling' && u.type === 'trained');
  queue(9);
  const punch = await rolls.rollUnarmed(rok2, 'punch', { modifier: 0 });
  ok('punch: success banked in flags.shadowbase.unarmedPendingHits.punch', punch.outcome.success && rok2.getFlag('shadowbase', 'unarmedPendingHits').punch === 1);
  queue(5);
  const pd = await rolls.rollUnarmedDamage(rok2, 'punch');
  ok('punch damage rolls stats.unarmedDamage.punch (1d+2 cr -> 1d6+2) and clears the bank', pd.websiteFormula === '1d+2 cr' && pd.formula === '1d6+2' && rok2.getFlag('shadowbase', 'unarmedPendingHits').punch === 0);
  // Dual wielding: the off-hand attack takes -4 through rollAttack, a parry -1.
  const pistolKit = engine.blasterCommon.buildTemplateBlaster({ profileName: 'Blaster Pistol' });
  const pistolKit2 = engine.blasterCommon.buildTemplateBlaster({ profileName: 'Blaster Pistol' });
  const dual = build(template('blank'), { customBlasters: [{ ...pistolKit.blaster, equipped: true }, { ...pistolKit2.blaster, equipped: true }], weaponModifications: [...pistolKit.parts, ...pistolKit2.parts] });
  ok('two readied pistols without Ambidexterity: dualWielding.penalized', dual.stats.dualWielding.penalized === true);
  const [main, off] = rolls.equippedWeapons(dual);
  ok('the second readied weapon is the off hand', !rolls.isOffHandWeapon(dual, main) && rolls.isOffHandWeapon(dual, off));
  queue(8);
  const offAtk = await rolls.rollAttack(dual, off, { modifier: 0, shots: 1 });
  ok('off-hand attack: modifier -4 on the card', offAtk.modifier === -4 && offAtk.target === offAtk.baseTarget - 4, `${offAtk.modifier}`);
  queue(8);
  const mainAtk = await rolls.rollAttack(dual, main, { modifier: 0, shots: 1 });
  ok('main-hand attack: modifier 0', mainAtk.modifier === 0);
  queue(8);
  const offForced = await rolls.rollAttack(dual, main, { modifier: 0, offHand: true, shots: 1 });
  ok('the Off-Hand toggle on the main weapon still takes -4 (the toggle decides)', offForced.modifier === -4);
}

// ---- 8. defenses: dodge with a Form, parry with a saber, gates ---------------------------------------------------
{
  const jedi = build(template('kaelenRarr'));
  const saber = jedi.items.find((i) => i.type === 'lightsaber');
  const base = rolls.defenseTargetFor(jedi, 'dodge').target;
  ok('Kaelen: Dodge 10 without a Form', base === 10, `${base}`);
  const parryBase = rolls.defenseTargetFor(jedi, 'parry', { weaponItem: saber });
  // The HUD's per-weapon composition (roller-window.tsx:1117): floor(skill/2)+3 + the sleeve's finalParryMod + Ch4's
  // narrowed Enhanced Parry + adj.parry (Combat Reflexes). Kaelen: LC 17 -> 11 + 1 + 1 + 1 = 14. The sheet's option list
  // reads 13 (calculateCombatStats folds the parts differently) - the two website surfaces disagree by the narrowed
  // bonus; the HUD's figure is the one this port reproduces (docs/REQUESTS.md notes it for the website).
  const saberInfo = rolls.attackTargetFor(jedi, saber);
  const narrowed = engine.enhancedDefenses.narrowedParryBonus(jedi.sheetData.advantages, { skillName: saberInfo.skillName, weaponName: saber.displayName });
  const expectedParry = Math.floor(saberInfo.target / 2) + 3 + (saber.rowWithDerived().finalParryMod || 0) + narrowed + jedi.stats.defenseAdjustments.parry;
  ok(`Kaelen: saber Parry = floor(17/2)+3 + finalParryMod 1 + narrowed ${narrowed} + adj 1 = ${expectedParry}`, parryBase.available && saberInfo.target === 17 && parryBase.target === expectedParry && expectedParry === 14, `${parryBase.target}`);
  const blockBase = rolls.defenseTargetFor(jedi, 'block', { weaponItem: saber });
  ok('Kaelen: saber Block = floor(17/2)+3 + adj 1 = 12 (the sheet\'s option agrees)', blockBase.available && blockBase.target === 12 && blockBase.target === jedi.stats.blockOptions[0].value, `${blockBase.target}`);
  // Soresu I: +1 to all active defenses when a saber is readied (use-character-form.ts:546-558; roller-window.tsx:1059-1062).
  await jedi.update({ 'system.activeLightsaberForm': 'Form III: Soresu' });
  const eff = rolls.activeFormEffectFor(jedi);
  ok('Soresu I active with a readied saber: +1 dodge/parry/block', eff.dodge === 1 && eff.parry === 1 && eff.block === 1);
  ok('Dodge 11, saber Parry +1, saber Block +1 under Soresu I', rolls.defenseTargetFor(jedi, 'dodge').target === base + 1 && rolls.defenseTargetFor(jedi, 'parry', { weaponItem: saber }).target === parryBase.target + 1 && rolls.defenseTargetFor(jedi, 'block', { weaponItem: saber }).target === blockBase.target + 1);
  ok('the Form does not reach an unarmed parry', rolls.defenseTargetFor(jedi, 'parry').target === jedi.stats.parryOptions.find((o) => o.name === 'Brawling').value);
  await saber.updateRow({ equipped: false });
  ok('saber stowed: the Form bonus goes with it (Ch9 "when using a lightsaber")', rolls.activeFormEffectFor(jedi).dodge === 0 && rolls.defenseTargetFor(jedi, 'dodge').target === base);
  await saber.updateRow({ equipped: true });
  // A blaster cannot parry (Ch12: a melee attack, a weapon or bare hands).
  const rok = build(template('rokarr'));
  const bow = rok.items.find((i) => i.type === 'blaster');
  ok('a bowcaster offers no Parry and no Block', rolls.defenseTargetFor(rok, 'parry', { weaponItem: bow }).available === false && rolls.defenseTargetFor(rok, 'block', { weaponItem: bow }).available === false);
  // Stun: -4 on every active defense arrives through the engine (dodge 10 -> 6, parry options -4).
  const stunned = build(template('rokarr'), { stunType: 'Physical' });
  ok('stunned: Dodge 6 and the unarmed Parry 7 (the engine\'s -4)', rolls.defenseTargetFor(stunned, 'dodge').target === 6 && rolls.defenseTargetFor(stunned, 'parry').target === 7);
  queue(10);
  const dodge = await rolls.rollDefense(rok, 'dodge', {}, { modifier: 0 });
  ok('rollDefense dodge posts a defense card against 10', dodge.baseTarget === 10 && lastMessage().flags.shadowbase.kind === 'defense' && lastMessage().flags.shadowbase.defense === 'dodge');
}

// ---- 9. Force powers, techniques, crew actions -------------------------------------------------------------------
{
  const jedi = build(template('kaelenRarr'));
  const power = jedi.items.find((i) => i.type === 'forcePower');
  ok('Kaelen has a Force power Item (denominator)', !!power, jedi.items.map((i) => i.type).join(','));
  if (power) {
    const row = power.system.row;
    const best = rolls.forcePowerTargetFor(jedi, power);
    const expected = engine.forcePowerTarget(row.baseSkill, jedi.sheetData.skills, engine.rollAttributes(jedi.stats));
    ok(`${row.name}: target through forcePowerTarget (${expected?.level})`, best?.level === expected?.level && best?.name === expected?.name);
    const costs = rolls.forcePowerCostsFor(jedi, power);
    ok(`${row.name}: FP cost through calculateAdjustedFPCost (${costs.fp}), EP ${costs.ep}`, costs.fp === engine.forceFpCost.calculateAdjustedFPCost(row.fpCost, row.alignment, jedi.system.forceAlignment) && costs.ep === (Number(row.epCost) || 0));
    const fpBefore = jedi.system.resources.fp.value; const epBefore = jedi.system.resources.ep.value;
    queue(9);
    const pr = await rolls.rollForcePower(jedi, power, { modifier: 0 });
    ok('rollForcePower posts the power card with the costs and moves no pool', pr.baseTarget === expected.level && lastMessage().flags.shadowbase.kind === 'force-power' && lastMessage().flags.shadowbase.costs.fp === costs.fp && jedi.system.resources.fp.value === fpBefore && jedi.system.resources.ep.value === epBefore && /apply-costs/.test(lastMessage().content));
    const applied = await rolls.applyForcePowerCosts(jedi, power);
    ok('applyForcePowerCosts deducts from the resolved pools (null means full) and floors at 0', jedi.system.currentForcePoints === Math.max(0, fpBefore - costs.fp) && applied.after.fp === Math.max(0, fpBefore - costs.fp) && (costs.ep === 0 || jedi.system.currentEndurancePoints === Math.max(0, epBefore - costs.ep)) && lastMessage().flags.shadowbase.kind === 'costs');
    // Card actions: the apply-costs button routes to applyForcePowerCosts through onCardAction.
    const msgs = ChatMessage.log.filter((m) => m.flags.shadowbase.kind === 'force-power');
    const fpNow = jedi.system.currentForcePoints;
    game.actors.set(jedi.id, jedi); // a world actor, the way Actor.create registers one
    await rolls.onCardAction({ ...msgs[msgs.length - 1], speaker: { actor: jedi.id } }, { currentTarget: { dataset: { action: 'apply-costs' } } });
    ok('onCardAction apply-costs applies the costs again', jedi.system.currentForcePoints === Math.max(0, fpNow - costs.fp));
  }
  // A technique with a weapon: the weapon's target, the technique's skill bonus/penalty, its damage bonus on the damage.
  const hsh = corpus.find((c) => c.file === 'export-hshif-2026-09-05.json');
  const withTech = hsh ? build(hsh.sheet) : null;
  const tech = withTech?.items.find((i) => i.type === 'combatTechnique');
  ok('the Hshif fixture carries combat techniques (denominator)', !!tech, withTech ? withTech.items.filter((i) => i.type === 'combatTechnique').length : 'no fixture');
  if (tech) {
    const weapon = rolls.equippedWeapons(withTech)[0] ?? null;
    const info = rolls.techniqueTargetFor(withTech, tech, { weaponItem: weapon });
    if (weapon) {
      const w = rolls.attackTargetFor(withTech, weapon);
      ok(`${tech.system.row.name} with ${weapon.name}: the weapon's target and hit bonus`, info.target === w.target && info.hitBonus === w.hitBonus);
    } else {
      ok(`${tech.system.row.name} without a weapon: needs one (or resolves its own skills)`, info.target === null ? info.needsWeapon === (tech.system.row.category !== 'Unarmed') : Number.isFinite(info.target));
    }
    const costs = { fp: Number(tech.system.row.fpCost) || 0, ep: Number(tech.system.row.epCost) || 0 };
    const applied = await rolls.applyTechniqueCosts(withTech, tech);
    ok(`${tech.system.row.name}: applyTechniqueCosts (${costs.fp} FP / ${costs.ep} EP)`, JSON.stringify(applied.costs) === JSON.stringify(costs));
  }
  const feint = engine.techniques.allCombatTechniques.find((t) => t.name === 'Feint');
  const brawler = build(template('rokarr'), { combatTechniques: [{ ...feint, baselinePoints: 0 }] });
  const feintItem = brawler.items.find((i) => i.type === 'combatTechnique');
  const feintInfo = rolls.techniqueTargetFor(brawler, feintItem, { weaponItem: null });
  ok('Feint (Any Melee or Ranged skill) without a weapon resolves nothing and asks for one', feintInfo.target === null && feintInfo.needsWeapon === true);
  const bow = brawler.items.find((i) => i.type === 'blaster');
  ok('Feint with the bowcaster rolls the bowcaster\'s 13', rolls.techniqueTargetFor(brawler, feintItem, { weaponItem: bow }).target === 13);
  ok('withDamageBonus appends the technique bonus the way RollButton does', rolls.withDamageBonus('3d-1', '+2') === '3d-1+2' && rolls.withDamageBonus('3d-1', '+1d+1') === '3d-1+1d+1' && rolls.toFoundryFormula(rolls.withDamageBonus('3d-1', '+1d+1')).formula === '3d6-1+1d6+1');
  // Crew actions through bestSkillTarget; "No default" where the chapter prints none.
  const crew = build(template('pilot'), { assignedStation: 'Medical Bay' });
  const actions = rolls.crewActionsFor(crew);
  ok('Medical Bay lists Ch16\'s three actions', actions.length === 3 && actions.every((a) => a.station === 'Medical Bay'));
  const surgery = actions.find((a) => a.label === 'Perform Surgery');
  const firstAid = actions.find((a) => a.label === 'Perform First Aid');
  const expectFA = engine.bestSkillTarget(firstAid.skills, crew.sheetData.skills, engine.rollAttributes(crew.stats));
  ok('Perform First Aid: best skill + 2', firstAid.target === (expectFA ? expectFA.level + 2 : null));
  ok('Perform Surgery without Surgery: no default (the invented IQ-4 is rejected)', surgery.target === null && (await rolls.rollCrewAction(crew, { action: 'Perform Surgery' }, { modifier: 0 })) === null);
  if (firstAid.target != null) { queue(9); const cr = await rolls.rollCrewAction(crew, { action: 'Perform First Aid' }, { modifier: 0 }); ok('rollCrewAction rolls First Aid + 2', cr.baseTarget === firstAid.target && lastMessage().flags.shadowbase.kind === 'crew-action'); }
  const gunner = build(template('pilot'), { assignedStation: 'Weapon Stations (Turrets)' });
  ok('Weapon Damage without a weapon system is refused', (await rolls.rollCrewAction(gunner, { action: 'Weapon Damage' }, { modifier: 0 })) === null);
  queue(20);
  const wd = await rolls.rollCrewAction(gunner, { action: 'Weapon Damage', weaponName: engine.starshipWeapons.STARSHIP_WEAPONS_LIBRARY.find((w) => /^\d+d/.test(w.damage)).name }, { modifier: 0 });
  ok('Weapon Damage with a weapon system rolls its damage string', wd && wd.total === 20 && lastMessage().flags.shadowbase.kind === 'damage');
  ok('an unknown station has no actions', rolls.crewActionsFor(crew, 'Bridge of Nowhere').length === 0);
}

// ---- 10. the sweep and the combat tracker ---------------------------------------------------------------------------
{
  ok('isExpiredAt: expires strictly after the stamped turn', effects.isExpiredAt({ expiresAfterTurn: 3 }, 3) === false && effects.isExpiredAt({ expiresAfterTurn: 3 }, 4) === true && effects.isExpiredAt({ expiresAfterTurn: null }, 99) === false);
  const shock = { id: 'shock-x', name: 'Shock (-2)', type: 'debuff', source: 'Injury', duration: 'Next Turn', expiresAfterTurn: 2, isManual: true, modifiers: { ...NO, dexterity: -2, iq: -2 } };
  const actor = build(template('blank'), { turnCounter: 1, parriesThisTurn: 2, facingChangeUsed: true, statusEffects: [shock] });
  const combatStub = { round: 2, combatants: [{ actor }] };
  ok('the tracked actor follows the tracker by default', combatMod.followsCombat(actor) && combatMod.trackedActors(combatStub).length === 1);
  ok('a round change of nothing does nothing', (await combatMod.onUpdateCombat(combatStub, { turn: 1 })).length === 0);
  const r2 = await combatMod.onUpdateCombat(combatStub, { round: 2 });
  ok('round 2: turnCounter follows, parries and the facing change reset, the Shock (expires after 2) is KEPT', r2.length === 1 && actor.system.turnCounter === 2 && actor.system.parriesThisTurn === 0 && actor.system.facingChangeUsed === false && actor.effects.filter(effects.storedEffects ? () => true : () => true).some((e) => e.flags?.shadowbase?.statusEffect?.id === 'shock-x'));
  combatStub.round = 3;
  const r3 = await combatMod.onUpdateCombat(combatStub, { round: 3 });
  ok('round 3: the Shock is swept (expiresAfterTurn 2 < 3) and the notice names it', r3[0].expired.includes('Shock (-2)') && !actor.effects.some((e) => e.flags?.shadowbase?.statusEffect?.id === 'shock-x') && lastMessage().flags.shadowbase.kind === 'sweep' && /Shock \(-2\)/.test(lastMessage().content));
  await actor.setFlag('shadowbase', 'autoTurnCounter', false);
  combatStub.round = 4;
  ok('flags.shadowbase.autoTurnCounter false: the tracker leaves the actor alone', (await combatMod.onUpdateCombat(combatStub, { round: 4 })).length === 0 && actor.system.turnCounter === 3);
  ok('advanceTurn / sweepNow move the counter by hand', (await combatMod.advanceTurn(actor, 1, { post: false })).turn === 4 && (await combatMod.sweepNow(actor, { post: false })).turn === 4);
  // §5.2's gate: the tracker's writes happen on the ACTIVE GM's client only. Pinned by reading the source and by
  // calling the hook as a player, as a second GM and with no GM connected (the rejected alternative - every
  // client acting - is the review's m7: permission errors for players, double sweeps for two GMs).
  {
    const src = readFileSync(join(ROOT, 'module', 'combat.mjs'), 'utf8');
    const gateSrc = /export function isActingClient\(\)\s*\{[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    ok('module/combat.mjs isActingClient reads game.users.activeGM and compares it to game.user by identity (no headless "return true")', /users\?\.activeGM/.test(gateSrc) && /gm === game\.user/.test(gateSrc) && !/return true/.test(gateSrc), gateSrc.slice(0, 240));
    ok('onUpdateCombat consults isActingClient before any setTurn', /export async function onUpdateCombat[\s\S]*?if \(!isActingClient\(\)\) return \[\];[\s\S]*?setTurn\(/.test(src));
    ok('the shim is the active GM on its own client (denominator for the gate)', game.users.activeGM === game.user && combatMod.isActingClient() === true);
    const gmActor = build(template('blank'), { turnCounter: 1 });
    const stub2 = { round: 5, combatants: [{ actor: gmActor }] };
    const saved = { user: game.user, userId: game.userId };
    const player = { id: 'player-1', name: 'Player', isGM: false, active: true };
    // An id that sorts AFTER the shim GM's, so the shim stays the active GM (Foundry: the active GM with the lowest id).
    const otherGm = { id: 'zz-gm-2', name: 'Other GM', isGM: true, active: true };
    game.users.set(player.id, player); game.users.set(otherGm.id, otherGm);
    game.user = player; game.userId = player.id;
    ok('on a player\'s client the active GM is someone else and the client does not act', game.users.activeGM !== game.user && combatMod.isActingClient() === false);
    ok('updateCombat on a player\'s client: no actor is touched (every-client-writes is the rejected alternative)', (await combatMod.onUpdateCombat(stub2, { round: 5 })).length === 0 && gmActor.system.turnCounter === 1);
    game.user = otherGm; game.userId = otherGm.id;
    ok('a second, non-active GM does not act either (exactly one client sweeps)', game.users.activeGM !== game.user && combatMod.isActingClient() === false && (await combatMod.onUpdateCombat(stub2, { round: 5 })).length === 0 && gmActor.system.turnCounter === 1);
    for (const u of game.users.contents) if (u.isGM) u.active = false;
    ok('with no active GM nobody acts (the counter waits for one)', game.users.activeGM === null && combatMod.isActingClient() === false && (await combatMod.onUpdateCombat(stub2, { round: 5 })).length === 0);
    for (const u of game.users.contents) if (u.isGM) u.active = true;
    game.users.delete(player.id); game.users.delete(otherGm.id);
    game.user = saved.user; game.userId = saved.userId;
    ok('restored: the shim GM acts again and the counter follows', combatMod.isActingClient() === true && (await combatMod.onUpdateCombat(stub2, { round: 5 })).length === 1 && gmActor.system.turnCounter === 5);
    // Through the real shim documents: a Combat with a Combatant naming the actor by id.
    game.actors.set(gmActor.id, gmActor);
    const combatDoc = new foundry.documents.Combat({ round: 6, combatants: [{ actorId: gmActor.id }] });
    ok('a shim Combat document resolves its combatant\'s actor and the hook drives it', combatDoc.combatants.size === 1 && combatMod.trackedActors(combatDoc).length === 1 && combatMod.trackedActors(combatDoc)[0] === gmActor && (await combatMod.onUpdateCombat(combatDoc, { round: 6 })).length === 1 && gmActor.system.turnCounter === 6);
    ok('ShadowBaseCombat / ShadowBaseCombatant extend the client document classes (no headless stand-in) and are registered', Object.getPrototypeOf(combatMod.ShadowBaseCombat) === foundry.documents.Combat && Object.getPrototypeOf(combatMod.ShadowBaseCombatant) === foundry.documents.Combatant && CONFIG.Combat.documentClass === combatMod.ShadowBaseCombat && CONFIG.Combatant.documentClass === combatMod.ShadowBaseCombatant);
  }
  // Economy flags from the one statement (combat-economy.ts): a low EP pool raises the Vicious Cycle flag.
  const tired = build(template('rokarr'), { currentEndurancePoints: 2 });
  const flags = combatMod.economyFlags(tired);
  ok('EP 2 of 13: the vicious-cycle advisory (label and detail from the engine)', flags.some((f) => f.id === 'vicious-cycle') && JSON.stringify(flags) === JSON.stringify(engine.combatEconomy.combatEconomyFlags({ currentEp: 2, maxEp: 13, effectiveSt: 17, parriesThisTurn: 0, meleeWeapons: [] })));
  const before = ChatMessage.log.length;
  await combatMod.postEconomyNotice(tired);
  ok('postEconomyNotice posts one notice card carrying the flags', ChatMessage.log.length === before + 1 && lastMessage().flags.shadowbase.kind === 'economy' && lastMessage().flags.shadowbase.economy.length === flags.length);
  ok('nothing to warn about: no card', (await combatMod.postEconomyNotice(build(template('rokarr')))) === null);
}

// ---- 11. the damage processor (hit-location-section.tsx) ------------------------------------------------------------
{
  const jedi = build(template('kaelenRarr'));
  const locs = damageMod.locationsOf(jedi);
  const byType = (t) => locs.find((l) => l.type === t);
  const torso = byType('Torso'); const head = byType('Head'); const vitals = byType('Vitals'); const arm = byType('Arm');
  ok('Kaelen has torso, head, vitals and an arm (denominator)', !!torso && !!head && !!vitals && !!arm, locs.map((l) => l.type).join(','));
  const hp = jedi.stats.currentValues.hitPoints;
  const a = (loc, amount, damageType, extra = {}) => damageMod.assessDamage(jedi, { locationId: loc.id, amount, damageType, ...extra });
  ok('torso cr 10 vs DR 0: injury 10, x1', a(torso, 10, 'cr').finalInjury === 10 && a(torso, 10, 'cr').multiplier === 1);
  ok('cut x1.5 (floor): 10 -> 15, 7 -> 10', a(torso, 10, 'cut').finalInjury === 15 && a(torso, 7, 'cut').finalInjury === 10);
  ok('imp x2, pi- x0.5, pi+ x1.5, pi++ x2', a(torso, 10, 'imp').finalInjury === 20 && a(torso, 7, 'pi-').finalInjury === 3 && a(torso, 10, 'pi+').finalInjury === 15 && a(torso, 10, 'pi++').finalInjury === 20);
  ok('head: innate DR 2, then x4 (organic skull): 10 -> 32', head.totalDR === 2 && a(head, 10, 'cr').finalInjury === 32 && a(head, 10, 'cr').multiplier === 4);
  ok('vitals x3 vs imp and pi, not vs cr', a(vitals, 10, 'imp').finalInjury === 30 && a(vitals, 10, 'pi').finalInjury === 30 && a(vitals, 10, 'cr').finalInjury === 10);
  ok('cold and stun route to EP (x1)', a(torso, 6, 'cold').endurance && a(torso, 6, 'stun').endurance && a(torso, 6, 'stun').finalInjury === 6);
  ok('ion vs an organic part: x0.5 to EP', a(torso, 9, 'ion').endurance && a(torso, 9, 'ion').finalInjury === 4);
  ok('sonic ignores DR (head DR 2 -> 0)', a(head, 5, 'sonic').drApplied === 0);
  ok('shock keeps DR on an organic part (the bypass is for conductive armor)', a(head, 5, 'shock').drApplied === 2);
  ok('armor divisor (2) halves the DR, rounding down (head DR 2 -> 1)', a(head, 5, 'cr', { armorDivisor: 2 }).drApplied === 1 && a(head, 5, 'cr', { armorDivisor: 3 }).drApplied === 0);
  ok(`major wound at >= HP/2 (${hp})`, a(torso, Math.ceil(hp / 2), 'cr').isMajorWound && !a(torso, Math.ceil(hp / 2) - 1, 'cr').isMajorWound);
  ok('torso never cripples (threshold null; the `|| 0` fallback that cripples on any injury is rejected)', torso.cripplingThreshold === null && !a(torso, 100, 'cut').isCrippling && !a(torso, 100, 'cut').isSevering);
  const thresh = arm.cripplingThreshold;
  ok(`an arm cripples above its threshold (${thresh}) and severs at twice it on a cut`, thresh > 0 && a(arm, thresh + 1, 'cr').isCrippling && !a(arm, thresh, 'cr').isCrippling && a(arm, 2 * thresh, 'cut').isSevering && !a(arm, 2 * thresh, 'cr').isSevering);
  // Droid processor x2.
  const droid = build(template('assassinDroid'));
  const proc = damageMod.locationsOf(droid).find((l) => l.type === 'Head' || l.type === 'Processor');
  ok('a droid processor takes x2', !!proc && damageMod.assessDamage(droid, { locationId: proc.id, amount: proc.totalDR + 10, damageType: 'cr' }).multiplier === 2);
  // applyDamage: the writes.
  const hpBefore = jedi.system.resources.hp.value; const turn = jedi.system.turnCounter;
  const ledger = await damageMod.applyDamage(jedi, { locationId: torso.id, amount: 6, damageType: 'cut' });
  ok('torso cut 6: HP -9 (6 x 1.5)', ledger.hp.lost === 9 && jedi.system.currentHitPoints === hpBefore - 9);
  const shockEffect = jedi.effects.find((e) => e.flags?.shadowbase?.statusEffect?.source === 'Injury');
  const shockRow = shockEffect?.flags.shadowbase.statusEffect;
  ok('a Shock (-4) row is stored: source Injury, Next Turn, expiresAfterTurn = turn + 1, DX/IQ -min(4, injury), isManual', shockRow && shockRow.name === 'Shock (-4)' && shockRow.duration === 'Next Turn' && shockRow.expiresAfterTurn === turn + 1 && shockRow.modifiers.dexterity === -4 && shockRow.modifiers.iq === -4 && shockRow.isManual === true && shockEffect.changes.length === 0, JSON.stringify(shockRow));
  ok('the ledger carries the major-wound prompt as a PROMPT (never rolled)', ledger.prompts.some((p) => p.key === 'SHADOWBASE.Damage.Prompt.MajorWound') && ledger.isMajorWoundRolled === undefined && lastMessage().flags.shadowbase.kind === 'damage-ledger');
  const l2 = await damageMod.applyDamage(jedi, { locationId: torso.id, amount: 2, damageType: 'cr' });
  ok('a 2-point wound gives Shock (-2)', l2.effects[0].row.name === 'Shock (-2)' && l2.effects[0].row.modifiers.dexterity === -2);
  // Crippling flags the hit-location row; severing amputates and adds Bleeding.
  const armLedger = await damageMod.applyDamage(jedi, { locationId: arm.id, amount: thresh + 1, damageType: 'cr' });
  ok('arm crippled: system.hitLocations[i].status Crippled and a Bleeding row', armLedger.location.status === 'Crippled' && jedi.system.hitLocations.find((l) => l.id === arm.id).status === 'Crippled' && armLedger.effects.some((e) => e.row.name === 'Bleeding' && e.row.source === 'Trauma Protocol' && e.row.id === `leak-${arm.id}`));
  const jedi2 = build(template('kaelenRarr'));
  const arm2 = damageMod.locationsOf(jedi2).find((l) => l.type === 'Arm');
  const sever = await damageMod.applyDamage(jedi2, { locationId: arm2.id, amount: 2 * arm2.cripplingThreshold, damageType: 'cut', isLightsaber: true });
  ok('a cauterized (lightsaber) severing: Destroyed + isAmputated and NO Bleeding', sever.location.status === 'Destroyed' && sever.location.isAmputated === true && jedi2.system.hitLocations.find((l) => l.id === arm2.id).isAmputated === true && !sever.effects.some((e) => e.row.name === 'Bleeding'));
  // EP damage: the EP pool, no Shock, no armor.
  const jedi3 = build(template('kaelenRarr'));
  const t3 = damageMod.locationsOf(jedi3).find((l) => l.type === 'Torso');
  const ep = jedi3.system.resources.ep.value;
  const cold = await damageMod.applyDamage(jedi3, { locationId: t3.id, amount: 4, damageType: 'cold' });
  ok('cold 4: EP -4, HP untouched, no Shock', cold.ep.lost === 4 && jedi3.system.currentEndurancePoints === ep - 4 && cold.hp === null && cold.effects.length === 0);
  const stunL = await damageMod.applyDamage(jedi3, { locationId: t3.id, amount: 3, damageType: 'stun' });
  ok('stun: the HT-5 prompt', stunL.prompts.some((p) => p.key === 'SHADOWBASE.Damage.Prompt.StunCheck'));
  // Toxic vs a synthetic part: inert.
  const droidTorso = damageMod.locationsOf(droid).find((l) => !l.isOrganic);
  const droidHp = droid.system.resources.hp.value;
  const tox = await damageMod.applyDamage(droid, { locationId: droidTorso.id, amount: 5, damageType: 'tox' });
  ok('toxic vs a synthetic part: skipped, HP untouched', tox.skipped && droid.system.resources.hp.value === droidHp);
  // Armor degradation: an equipped armor row covering the torso loses 1 DR at the location and reads Damaged.
  const armorRow = { id: 'armor-1', name: 'Test Plate', type: 'Body Armor', equipped: true, coveredLocationIds: [torso.id], baseDRValue: 5, drEntries: [{ locationId: torso.id, dr: 5 }], condition: 'Fine' };
  const armored = build(template('kaelenRarr'), { armor: [armorRow] });
  const t4 = damageMod.locationsOf(armored).find((l) => l.type === 'Torso');
  const plate = armored.items.find((i) => i.type === 'armor');
  const drBefore = t4.totalDR;
  const hit = await damageMod.applyDamage(armored, { locationId: t4.id, amount: drBefore + 4, damageType: 'cr' });
  ok(`armor over the torso (DR ${drBefore}): hit for ${drBefore + 4} -> 4 injury, the entry drops to ${plate.system.row.drEntries[0].dr}, condition Damaged`, hit.assessment.finalInjury === 4 && hit.armor.length === 1 && plate.system.row.drEntries.find((e) => e.locationId === t4.id).dr === 4 && plate.system.row.condition === 'Damaged', JSON.stringify(hit.armor));
  const miss = await damageMod.applyDamage(armored, { locationId: t4.id, amount: 2, damageType: 'cr' });
  ok('a hit that does not exceed the DR neither injures nor degrades', miss.assessment.finalInjury === 0 && miss.armor.length === 0 && !miss.effects.length);
  ok('DAMAGE_TYPES carries the 18 picker entries with the chapter multipliers', damageMod.DAMAGE_TYPES.length === 18 && Object.fromEntries(damageMod.DAMAGE_TYPES.map((t) => [t.value, t.mult])).cut === 1.5 && Object.fromEntries(damageMod.DAMAGE_TYPES.map((t) => [t.value, t.mult]))['pi++'] === 2);
  ok('an unknown location is refused', (await damageMod.applyDamage(jedi, { locationId: 'nope', amount: 5, damageType: 'cr' })) === null);
}

// ---- 12. templates and i18n ---------------------------------------------------------------------------------------
{
  const templateFiles = readdirSync(join(ROOT, 'templates', 'chat')).filter((f) => f.endsWith('.hbs')).sort();
  ok('six chat templates exist', templateFiles.length === 6, templateFiles.join(','));
  ok('every template file is one of rolls.TEMPLATES', templateFiles.every((f) => Object.values(rolls.TEMPLATES).some((p) => basename(p) === f)));
  for (const f of templateFiles) {
    let compiles = true; let why = '';
    try { Handlebars.precompile(readFileSync(join(ROOT, 'templates', 'chat', f), 'utf8'), { knownHelpers: KNOWN_HELPERS, knownHelpersOnly: true }); } catch (e) { compiles = false; why = e.message; }
    ok(`${f} compiles with only Foundry's helpers`, compiles, why);
    ok(`${f} was rendered by this check with a live context`, rendered.some((r) => basename(r.path) === f), 'never rendered');
  }
  ok('no rendered card leaves a mustache unresolved', rendered.every((r) => !/\{\{|\}\}/.test(r.html)), `${rendered.filter((r) => /\{\{|\}\}/.test(r.html)).map((r) => r.path).join(',')}`);
  ok('no rendered card shows an untranslated SHADOWBASE key', rendered.every((r) => !/SHADOWBASE\./.test(r.html)), rendered.filter((r) => /SHADOWBASE\./.test(r.html)).map((r) => basename(r.path) + ': ' + (/SHADOWBASE\.[A-Za-z0-9_.]+/.exec(r.html) ?? [])[0]).slice(0, 5).join('; '));
  ok(`cards rendered (denominator)`, rendered.length >= 400, `${rendered.length}`);
  // Every key the modules and templates name exists in lang/en.json or in the U04 block of docs/REQUESTS.md.
  const sources = ['module/rolls.mjs', 'module/combat.mjs', 'module/damage.mjs', 'module/apps/roll-dialog.mjs', ...templateFiles.map((f) => `templates/chat/${f}`)];
  const named = new Set();
  const dynamicPrefixes = ['SHADOWBASE.Roll.ScatterDirection.', 'SHADOWBASE.Roll.Attribute.', 'SHADOWBASE.Roll.Characteristic.', 'SHADOWBASE.Damage.Type.', 'SHADOWBASE.Roll.'];
  for (const s of sources) {
    const src = readFileSync(join(ROOT, s), 'utf8');
    for (const m of src.matchAll(/["'](SHADOWBASE\.[A-Za-z0-9_.+-]+)["']/g)) if (!m[1].endsWith('.')) named.add(m[1]);
  }
  // The dynamically built keys: the enumerations the code interpolates.
  for (const d of ['Short', 'ShortRight', 'Right', 'LongRight', 'Long', 'LongLeft', 'Left', 'ShortLeft']) named.add(`SHADOWBASE.Roll.ScatterDirection.${d}`);
  for (const k of rolls.ATTRIBUTE_KEYS) named.add(`SHADOWBASE.Roll.Attribute.${k}`);
  for (const k of rolls.CHARACTERISTIC_KEYS) named.add(`SHADOWBASE.Roll.Characteristic.${k}`);
  for (const t of damageMod.DAMAGE_TYPES) named.add(t.label);
  for (const tag of ['Hit', 'Miss', 'Malf', 'CritMiss', 'Punch', 'Kick']) named.add(`SHADOWBASE.Roll.${tag}`);
  const missing = [...named].filter((k) => !(k in translations));
  ok('the modules and templates name i18n keys (denominator)', named.size >= 80, `${named.size}`);
  ok('every named SHADOWBASE key is in lang/en.json', missing.length === 0, missing.join(', '));
  const unused = ownedKeys.filter((k) => !named.has(k));
  ok('every SHADOWBASE.Roll / Combat / Damage key of lang/en.json is named somewhere (no dead keys)', unused.length === 0, unused.join(', '));
  ok('the dynamic key families are enumerated above (denominator)', dynamicPrefixes.every((p) => [...named].some((k) => k.startsWith(p))));
  // The dialog's headless surface.
  ok('the roll prompt content carries the label, the base target, the modifier input, the off-hand toggle and the roll modes', (() => { const html = dialogMod.renderPromptContent({ label: 'Guns (Blaster Pistol)', target: 11, dualWielding: true, rollMode: 'gm' }); return /Guns \(Blaster Pistol\)/.test(html) && /11/.test(html) && /name="modifier"/.test(html) && /name="offHand"/.test(html) && /name="rollMode"/.test(html) && /value="gm" selected/.test(html); })());
  ok('without dual wielding the off-hand toggle is absent', !/name="offHand"/.test(dialogMod.renderPromptContent({ label: 'x', target: 10, dualWielding: false })));
  ok('readPromptForm reads the three answers', JSON.stringify(dialogMod.readPromptForm({ elements: { modifier: { value: '-2' }, offHand: { checked: true }, rollMode: { value: 'blind' } } })) === JSON.stringify({ modifier: -2, offHand: true, rollMode: 'blind' }));
  // The shim carries an AppV2 layer since U05 (tools/foundry-shim-apps.mjs); the guard is probed with DialogV2 hidden.
  ok('headless: with DialogV2 absent the prompt says so instead of guessing', await (async () => {
    const api = foundry.applications.api;
    const saved = api.DialogV2;
    api.DialogV2 = undefined;
    try { return dialogMod.dialogClass() === null && await dialogMod.promptRoll({ label: 'x', target: 10 }).then(() => false, (e) => /DialogV2/.test(e.message)); }
    finally { api.DialogV2 = saved; }
  })());
  ok('game.shadowbase exposes rolls, combat and damage', game.shadowbase.rolls === rolls.rolls && game.shadowbase.combat === combatMod.combat && game.shadowbase.damage === damageMod.damage);
}

report(`grid 368, corpus ${corpus.length}, cards ${rendered.length}, chat messages ${ChatMessage.log.length}`);
