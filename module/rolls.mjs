// module/rolls.mjs
//
// Every roll a player makes (docs/ARCHITECTURE.md §5.1). This file is the
// website's Tactical HUD roll surface moved onto Foundry: the TARGET of each
// roll comes out of the engine bundle exactly the way roller-window.tsx
// derives it, the OUTCOME is the engine's one 17/18 comparison
// (resolveRollOutcome), and the dice are Foundry's. Nothing here re-implements
// a rule; where the website computes a figure inline in a component (the
// attack target composition, the ammunition deduction, the modifier stacking)
// the lines are cited so the port can be checked against them.
//
// Three decisions that the website leaves inconsistent, settled here once
// (the adversarial review of ARCHITECTURE.md, items M2-M4, m2):
//
//   1. THE ATTACK TARGET is ARCHITECTURE.md §5.1's composition, through the
//      website's one resolver (weapon-attack-skill.ts, bundled as
//      engine.weaponAttackSkill): target = attackSkillFor(row, skills, attrs, 0,
//      new Map()).skillTarget + minStShortfallPenalty - the bare skill (a saber
//      names its skill by Class Type) exactly as the HUD's readied-weapon matrix
//      shows it (roller-window.tsx getSkillTargetInfo, 828-919). The global
//      to-hit channel and the gear skill bonus are the roll MODIFIER, added once
//      (attackHitBonus, weapon-attack-skill.ts:52-58; roller-window.tsx:1512) -
//      never `attackSkillFor(...).target` (which already folds the hit bonus in)
//      plus an added to-hit, the double application the review found in §5.1's
//      first draft (M3). check:rolls pins a -4 toHit character's card against
//      the engine's own `.target`.
//
//   2. THE MALFUNCTION THRESHOLD is the family's derived `malfunction` (what
//      calculateBlasterStats returns and the HUD reads at roller-window.tsx
//      :1317, `w.malfunction || 17`), not malfunctionOrBase(row.durability, …)
//      - that returns 14 for every kit weapon whose durability was never
//      measured (null), which is all of them.
//
//   3. THE MODIFIER STACK is roll-button.tsx:113-127 verbatim: situational +
//      gear/effect skill bonus - skill penalty + off-hand (-4 attack / -1
//      parry-block, only when dualWielding.penalized and the toggle is on).
//
// A null target is REFUSED with a notification (roller-window.tsx:930-936:
// "null where the chapter grants no roll, not a literal 10"); RollButton's
// `(target ?? 10)` fallback (roll-button.tsx:130) is the rejected alternative.
//
// Chat: one ChatMessage per roll, style OTHER, the Roll attached, the card
// rendered from templates/chat/*.hbs through
// foundry.applications.handlebars.renderTemplate, and everything the card
// shows also under flags.shadowbase so the HUD's history and a later reader
// need no HTML parsing. Roll history: the last N rolls per actor in
// flags.shadowbase.rollHistory (the website's RollHistoryItem shape,
// use-dice-roller.ts:10-15), N from the client setting rollHistoryDepth.

import { engine } from './engine.mjs';
import { actorToSheet, rowsOf, rowWithDerived } from './adapter.mjs';
import { promptRoll } from './apps/roll-dialog.mjs';

export const SYSTEM_ID = 'shadowbase';

/** Chat card templates (ARCHITECTURE.md §5.1). */
export const TEMPLATES = Object.freeze({
  targetRoll: 'systems/shadowbase/templates/chat/target-roll.hbs',
  damage: 'systems/shadowbase/templates/chat/damage.hbs',
  volley: 'systems/shadowbase/templates/chat/volley.hbs',
  forcePower: 'systems/shadowbase/templates/chat/force-power.hbs',
  costs: 'systems/shadowbase/templates/chat/costs.hbs',
  notice: 'systems/shadowbase/templates/chat/notice.hbs',
});

/**
 * Roll history depth. The website reads sheet preferences (use-dice-roller.ts
 * depth(): `Number.isFinite(n) && n >= 1 ? Math.floor(n) : 10`); Foundry reads
 * the client setting `rollHistoryDepth` (module/settings.mjs, registered at
 * init). The read stays guarded: before init, or under a shim without the
 * registration, the website's default of 10 applies instead of a throw.
 */
export const ROLL_HISTORY_DEFAULT_DEPTH = 10;
export function rollHistoryDepth() {
  let n;
  try { n = globalThis.game?.settings?.get(SYSTEM_ID, 'rollHistoryDepth'); } catch { n = undefined; }
  n = Number(n);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : ROLL_HISTORY_DEFAULT_DEPTH;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** The composed website sheet the engine last read for the actor. */
function sheetOf(actor) {
  return actor.sheetData ?? actor.system?.sheetCache ?? actorToSheet(actor);
}

/** The engine's CalculatedStatsResult, or null (refused with a notification by the caller). */
function statsOf(actor) {
  const stats = actor.stats ?? actor.system?.derived ?? null;
  if (!stats) notify('error', fmt('SHADOWBASE.Roll.EngineUnavailable', { name: actor.name }));
  return stats;
}

/** The one constructor of the attribute bag every target reads (roll-targets.ts rollAttributes). */
function attrsOf(stats) {
  return engine.rollAttributes(stats);
}

/**
 * The mode the chooser defaults to (Foundry's core setting). v14 renamed the
 * setting `core.rollMode` -> `core.messageMode` and the mode keys publicroll/gmroll/
 * blindroll/selfroll -> public/gm/blind/self; read messageMode first, fall back to
 * the v13 setting, then to 'public'. Headless: 'public'.
 */
export function defaultRollMode() {
  const s = globalThis.game?.settings;
  try { const m = s?.get('core', 'messageMode'); if (m) return m; } catch { /* pre-v14: no messageMode */ }
  try { return s?.get('core', 'rollMode') ?? 'public'; } catch { return 'public'; }
}

/** The active die results of a Roll, in order ([d, d, d] on the card). */
export function diceOf(roll) {
  const out = [];
  for (const d of roll?.dice ?? []) for (const r of d.results ?? []) if (r.active !== false) out.push(r.result);
  return out;
}

/** foundry.applications.handlebars.renderTemplate, resolved late so the module loads headlessly (the checks inject one). */
function renderTemplateFn() {
  const apps = globalThis.foundry?.applications;
  const hb = apps && ('handlebars' in apps) ? apps.handlebars : null;
  if (typeof hb?.renderTemplate === 'function') return hb.renderTemplate;
  throw new Error('shadowbase rolls: foundry.applications.handlebars.renderTemplate is not available (the headless checks inject a Handlebars renderer)');
}

/**
 * Apply the roll mode the way Foundry's chooser does (whisper to GMs for gm/blind,
 * blind flag for blind, self-whisper for self). v14 renamed the static
 * ChatMessage.applyRollMode -> ChatMessage.applyMode (deprecated since v14, removed
 * in v16); use whichever the running core exposes. Headlessly the static is absent
 * (tools/foundry-shim.mjs) and the mode is only recorded.
 */
function withRollMode(data, rollMode) {
  const mode = rollMode || defaultRollMode();
  data.flags.shadowbase.rollMode = mode;
  const CM = globalThis.ChatMessage;
  if (typeof CM?.applyMode === 'function') return CM.applyMode(data, mode);        // v14
  if (typeof CM?.applyRollMode === 'function') return CM.applyRollMode(data, mode); // v13
  if (mode === 'blind' || mode === 'blindroll') data.blind = true;
  return data;
}

/** Roll history: newest first, capped (use-dice-roller.ts dispatch ADD_ROLL). Skipped when the user cannot write the actor. */
async function pushHistory(actor, item) {
  if (actor?.isOwner === false) return null;
  const current = actor.getFlag?.(SYSTEM_ID, 'rollHistory') ?? actor.flags?.[SYSTEM_ID]?.rollHistory ?? [];
  const next = [item, ...(Array.isArray(current) ? current : [])].slice(0, rollHistoryDepth());
  await actor.update({ [`flags.${SYSTEM_ID}.rollHistory`]: next });
  return next;
}

/** The actor's roll history (newest first). */
export function rollHistory(actor) {
  const h = actor?.getFlag?.(SYSTEM_ID, 'rollHistory') ?? actor?.flags?.[SYSTEM_ID]?.rollHistory;
  return Array.isArray(h) ? h : [];
}

/** Clear the actor's roll history (use-dice-roller.ts CLEAR_HISTORY). */
export async function clearRollHistory(actor) {
  await actor.update({ [`flags.${SYSTEM_ID}.rollHistory`]: [] });
}

/** Create the chat message for a rendered card. */
async function postCard(actor, template, context, { rollMode, rolls = [], flags = {}, flavor } = {}) {
  const render = renderTemplateFn();
  const content = await render(template, context);
  const data = {
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls,
    flags: { [SYSTEM_ID]: { actorId: actor?.id ?? null, ...flags } },
  };
  if (flavor) data.flavor = flavor;
  // The dice sound Foundry's own Roll#toMessage attaches; CONFIG.sounds is not part of the headless surface.
  if (rolls.length && ('sounds' in CONFIG) && CONFIG.sounds?.dice) data.sound = CONFIG.sounds.dice;
  return ChatMessage.create(withRollMode(data, rollMode));
}

// ---------------------------------------------------------------------------
// Modifier stacking (roll-button.tsx:113-127)
// ---------------------------------------------------------------------------

/**
 * The off-hand penalty: -4 to an attack, -1 to a parry or block, and only when
 * the character is dual wielding WITHOUT Ambidexterity / Jar'Kai
 * (stats.dualWielding.penalized) and the Off-Hand toggle is set
 * (roll-button.tsx:120-124).
 * @param {{ kind: 'attack'|'defense'|'other', offHand?: boolean, penalized?: boolean }} input
 */
export function offHandPenalty({ kind, offHand = false, penalized = false }) {
  if (!offHand || !penalized || kind === 'other') return 0;
  return kind === 'defense' ? -1 : -4;
}

/**
 * total = situational + gear/effect skill bonus - skill penalty + off-hand
 * (roll-button.tsx:127). One rule for every target roll; damage rolls take
 * the situational part only (roll-button.tsx:141, 153).
 */
export function stackModifiers({ situational = 0, skillBonus = 0, skillPenalty = 0, offHand = false, penalized = false, kind = 'other' } = {}) {
  return (Number(situational) || 0) + (Number(skillBonus) || 0) - (Number(skillPenalty) || 0) + offHandPenalty({ kind, offHand, penalized });
}

/**
 * Everything added to an attack roll before the dice: the global to-hit
 * channel (Ch7's "to all actions") plus the unconditional half of the gear
 * bonus to the skill being rolled - the website's own
 * weaponAttackSkill.attackHitBonus (weapon-attack-skill.ts:52-58), through
 * the bundle. Nothing is re-stated here.
 */
export function attackHitBonus(globalToHit, skillBonuses, skillName) {
  return engine.weaponAttackSkill.attackHitBonus(globalToHit, skillBonuses, skillName);
}

// ---------------------------------------------------------------------------
// Damage formula translation (ARCHITECTURE.md §5.1 rollDamage)
// ---------------------------------------------------------------------------

/** The damage-type words a website formula may carry after the dice. */
const DAMAGE_TYPE_WORDS = new Set(['cr', 'cut', 'imp', 'pi-', 'pi', 'pi+', 'pi++', 'burn', 'cor', 'tox', 'cold', 'sonic', 'ion', 'shock', 'stun', 'energy', 'spec', 'sub', 'fat', 'end', 'ex']);

// A dice term is `Nd`, `NdF` or a bare `dF` (a bare `d` followed by a letter is a word: "damage"). The piercing
// words carry their own signs (pi-, pi+, pi++); every other word stops before a sign so "energy+3d" splits.
const FORMULA_TOKEN = /((?:\d+d\d*)|(?:d\d+))(?:\((\d+(?:\.\d+)?)\))?(?:\s*[x×*]\s*(\d+))?|([+-])|(\d+(?:\.\d+)?)|(\([^)]*\))|(pi\+\+|pi[+-](?!\d)|[A-Za-z][A-Za-z/'.]*)/g;

/**
 * A website damage string -> Foundry's dice grammar.
 *
 *   "3d-1"                -> 3d6-1           (a bare `d` is a d6: use-dice-roller.ts:165 `sides = ... : 6`)
 *   "1d+2 cr"             -> 1d6+2, flavor "cr"
 *   "5d energy+3d sonic"  -> 5d6+3d6, flavor "energy sonic"
 *   "8d(5) cr ex"         -> 8d6, armor divisor 5 kept as flavor "(5)"
 *   "2dx3" / "2d*3"       -> 2d6*3           (use-dice-roller.ts:159 `([x*])(\d+)`)
 *   "1d tox (HT-3)"       -> 1d6, flavor "tox (HT-3)"
 *   "By Ammo burn"        -> ok: false (nothing to roll)
 *
 * The parenthetical is a RIDER, never a modifier: the website's own parser
 * (use-dice-roller.ts:152 `split(/(?=[+-])/)`) would read "(HT-3)" as "-3)"
 * and subtract 3 from a toxin's dice - check:rolls pins that "1d tox (HT-3)"
 * translates to 1d6, naming that split as the rejected alternative. A formula
 * with no dice and no constant (By Ammo, By Caliber, Special, an Affliction)
 * is reported as not rollable rather than rolled as the 1 the website's
 * clamp would print for it.
 * @param {unknown} input
 * @returns {{ ok: boolean, formula: string|null, flavor: string, damageType: string|null, armorDivisor: number|null, multiplier: number|null, source: string, reason?: string }}
 */
export function toFoundryFormula(input) {
  const source = String(input ?? '').trim();
  const out = { ok: false, formula: null, flavor: '', damageType: null, armorDivisor: null, multiplier: null, source };
  if (!source) return { ...out, reason: 'empty' };
  const terms = [];
  const flavor = [];
  let pendingSign = null;
  let sawDice = false;
  FORMULA_TOKEN.lastIndex = 0;
  for (const m of source.matchAll(FORMULA_TOKEN)) {
    const [, dice, divisor, mult, sign, number, paren, word] = m;
    if (dice !== undefined) {
      const [n, f] = dice.split('d');
      let term = `${n || '1'}d${f || '6'}`;
      if (mult) { term += `*${mult}`; out.multiplier = Number(mult); }
      terms.push((terms.length ? (pendingSign ?? '+') : (pendingSign === '-' ? '-' : '')) + term);
      if (divisor) { out.armorDivisor = Number(divisor); flavor.push(`(${divisor})`); }
      pendingSign = null;
      sawDice = true;
      continue;
    }
    if (sign) { if (pendingSign) flavor.push(pendingSign); pendingSign = sign; continue; }
    if (number !== undefined) {
      terms.push((terms.length ? (pendingSign ?? '+') : (pendingSign === '-' ? '-' : '')) + number);
      pendingSign = null;
      continue;
    }
    // A word or a parenthetical: flavor. A sign left dangling before it belongs to the rider text ("+ Affliction (HT)").
    if (pendingSign) { flavor.push(pendingSign); pendingSign = null; }
    if (paren) { flavor.push(paren); continue; }
    if (word) {
      const w = word.replace(/\.$/, '');
      const lower = w.toLowerCase();
      if (DAMAGE_TYPE_WORDS.has(lower) && !out.damageType) out.damageType = lower;
      flavor.push(w);
    }
  }
  if (pendingSign) flavor.push(pendingSign);
  out.flavor = flavor.join(' ').replace(/\s+([)])/g, '$1').trim();
  if (!terms.length) return { ...out, reason: 'no dice or constant' };
  out.formula = terms.join('');
  out.ok = true;
  if (!sawDice) out.reason = 'constant only';
  return out;
}

// ---------------------------------------------------------------------------
// The outcome (roll-outcome.ts) and its lines (use-dice-roller.ts rollTargetNumber, 257-294)
// ---------------------------------------------------------------------------

/**
 * The one 17/18 comparison: the engine's resolveRollOutcome. Every target
 * roll and every volley shot goes through here (check:rolls runs the whole
 * 368-cell grid through rollTarget and compares with the engine; the husk's
 * `total <= 4` / `total >= 17` rule - fixtures/husk/actor.js:100-106 - is the
 * rejected alternative, diverging on 41 cells).
 */
export function resolveOutcome(total, target, malfunctionThreshold = null) {
  return engine.resolveRollOutcome(total, target, malfunctionThreshold);
}

/** Ch11 scatter: margin d6 feet in a random direction (use-dice-roller.ts:139-147). */
async function scatter(marginOfFailure) {
  const n = Math.max(0, Math.floor(marginOfFailure));
  let distance = 0;
  if (n > 0) {
    const roll = await new Roll(`${n}d6`).evaluate();
    distance = roll.total;
  }
  const directions = ['Short', 'ShortRight', 'Right', 'LongRight', 'Long', 'LongLeft', 'Left', 'ShortLeft'];
  const direction = directions[Math.floor(Math.random() * directions.length)];
  return fmt('SHADOWBASE.Roll.Scatter', { distance, direction: loc(`SHADOWBASE.Roll.ScatterDirection.${direction}`) });
}

/**
 * The Result line(s) for an outcome, in the website's label order: critical
 * success, critical failure, the automatic (17/18) failure, then a worn
 * weapon's malfunction (use-dice-roller.ts:257-282), plus Ch10's ghost glitch
 * rider on a natural 17/18 with a flawed item (:283-294).
 * @returns {Promise<{ key: string, lines: string[], text: string }>}
 */
export async function outcomeLines(outcome, { total, target, malfunctionThreshold = null, rollType = 'standard', flawedItem = false } = {}) {
  const { success, isMalfunction, isCriticalFailure, isCriticalSuccess, isAutomaticFailure, margin } = outcome;
  const lines = [];
  let key;
  if (isCriticalSuccess) {
    key = 'criticalSuccess';
    lines.push(fmt('SHADOWBASE.Roll.CriticalSuccess', { margin }));
  } else if (isCriticalFailure) {
    key = 'criticalFailure';
    lines.push(fmt('SHADOWBASE.Roll.CriticalFailure', { total }));
    if (isMalfunction) lines.push(fmt('SHADOWBASE.Roll.MalfunctionAlso', { malf: malfunctionThreshold }));
    if (rollType === 'grenade') lines.push(loc('SHADOWBASE.Roll.GrenadeDropped'));
  } else if (isAutomaticFailure) {
    key = 'automaticFailure';
    lines.push(fmt('SHADOWBASE.Roll.AutomaticFailure', { total, target }));
    if (isMalfunction) lines.push(fmt('SHADOWBASE.Roll.MalfunctionNoted', { malf: malfunctionThreshold }));
    if (rollType === 'grenade') lines.push(await scatter(Math.max(1, total - target)));
  } else if (isMalfunction) {
    key = 'malfunction';
    lines.push(fmt('SHADOWBASE.Roll.Malfunction', { total }));
  } else if (!success) {
    key = 'failure';
    lines.push(fmt('SHADOWBASE.Roll.Failure', { margin }));
    if (rollType === 'grenade') lines.push(await scatter(margin));
  } else {
    key = 'success';
    lines.push(fmt('SHADOWBASE.Roll.Success', { margin }));
  }
  if (flawedItem && isAutomaticFailure) lines.push(loc('SHADOWBASE.Roll.GhostGlitch'));
  return { key, lines, text: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// The primitive: one 3d6 against a target
// ---------------------------------------------------------------------------

/**
 * Roll 3d6 against a target (use-dice-roller.ts rollTargetNumber) and post the
 * card. `modifier` is the ALREADY STACKED total (stackModifiers); the target
 * shown is `target + modifier`, as the website shows it.
 *
 * @param {object} actor
 * @param {object} spec
 * @param {string} spec.label            "Guns (Blaster Pistol)", "Dodge", ...
 * @param {number} spec.target           the bare target; null/NaN is refused
 * @param {number} [spec.modifier]       the stacked modifier (default 0)
 * @param {string|null} [spec.skillName] named on the card when the roll is a skill roll
 * @param {number|null} [spec.malfunctionThreshold] the weapon's Malf, or null (no malfunction range)
 * @param {boolean} [spec.flawedItem]    Ch10 ghost glitch rider
 * @param {'standard'|'grenade'} [spec.rollType]
 * @param {string} [spec.rollMode]
 * @param {string} [spec.template]       card template (default target-roll)
 * @param {object} [spec.extra]          extra template context (costs, advisories, item lines)
 * @param {object} [spec.flags]          extra flags.shadowbase entries
 * @param {{ label: string, value: string }[]} [spec.breakdown] the modifier breakdown shown on the card
 * @returns {Promise<null|{ outcome: object, total: number, dice: number[], target: number, baseTarget: number, modifier: number, result: object, roll: object, message: object }>}
 */
export async function rollTarget(actor, spec) {
  const { label, skillName = null, malfunctionThreshold = null, flawedItem = false, rollType = 'standard', rollMode, template = TEMPLATES.targetRoll, extra = {}, flags = {}, breakdown = [] } = spec;
  const base = Number(spec.target);
  if (spec.target === null || spec.target === undefined || spec.target === '' || !Number.isFinite(base)) {
    notify('warn', fmt('SHADOWBASE.Roll.NoTarget', { label }));
    return null;
  }
  const modifier = Number(spec.modifier) || 0;
  const target = base + modifier;
  const roll = await new Roll('3d6').evaluate();
  const total = roll.total;
  const dice = diceOf(roll);
  const malf = malfunctionThreshold == null ? null : Number(malfunctionThreshold);
  const outcome = resolveOutcome(total, target, malf);
  const result = await outcomeLines(outcome, { total, target, malfunctionThreshold: malf, rollType, flawedItem });
  const title = fmt('SHADOWBASE.Roll.CheckTitle', { label });
  const context = {
    title, label, skillName, target, baseTarget: base, modifier, modifierText: modifier ? signed(modifier) : '',
    total, dice, diceText: dice.length ? dice.join(', ') : String(total),
    result, success: outcome.success, critical: outcome.isCriticalSuccess || outcome.isCriticalFailure,
    malfunction: outcome.isMalfunction, malfunctionThreshold: malf, flawedItem,
    breakdown, actorId: actor?.id ?? null, actorName: actor?.name ?? '',
    ...extra,
  };
  const message = await postCard(actor, template, context, {
    rollMode, rolls: [roll],
    flags: { kind: flags.kind ?? 'target-roll', label, skillName, target, baseTarget: base, modifier, total, dice, outcome, resultKey: result.key, malfunctionThreshold: malf, ...flags },
  });
  const description = `${skillName ? `${loc('SHADOWBASE.Roll.Skill')}: ${skillName}\n` : ''}${loc('SHADOWBASE.Roll.Target')}: ${target}\n${loc('SHADOWBASE.Roll.Rolled')}: ${total} [${context.diceText}]\n${loc('SHADOWBASE.Roll.Result')}: ${result.text}`;
  await pushHistory(actor, { title, description, resultText: result.text, timestamp: Date.now() });
  return { outcome, total, dice, target, baseTarget: base, modifier, result, roll, message };
}

/**
 * Resolve the dialog for a roll: the caller either decided the modifier
 * (`opts.modifier` given, or `opts.prompt === false`) or the player is asked
 * (module/apps/roll-dialog.mjs). Returns the resolved options or null when the
 * dialog was cancelled.
 */
async function resolveOptions(actor, opts, context) {
  const wants = opts.prompt ?? (opts.modifier === undefined);
  if (!wants) return { modifier: Number(opts.modifier) || 0, offHand: !!opts.offHand, rollMode: opts.rollMode };
  const answer = await promptRoll({ ...context, defaultOffHand: !!opts.offHand, rollMode: opts.rollMode });
  if (!answer) return null;
  return { modifier: Number(answer.modifier) || 0, offHand: !!answer.offHand, rollMode: answer.rollMode ?? opts.rollMode };
}

/** Roll a bare target with the standard stack (situational only unless the caller passes bonuses). */
async function rollSimple(actor, { label, target, skillName = null, kind = 'other', skillBonus = 0, skillPenalty = 0, breakdown = [], flags = {}, extra = {}, template }, opts = {}) {
  if (target === null || target === undefined || !Number.isFinite(Number(target))) {
    notify('warn', fmt('SHADOWBASE.Roll.NoTarget', { label }));
    return null;
  }
  const stats = statsOf(actor);
  const penalized = !!stats?.dualWielding?.penalized;
  const answer = await resolveOptions(actor, opts, { label, target: Number(target) + (Number(skillBonus) || 0) - (Number(skillPenalty) || 0), dualWielding: kind !== 'other' && penalized, kind });
  if (!answer) return null;
  const modifier = stackModifiers({ situational: answer.modifier, skillBonus, skillPenalty, offHand: answer.offHand, penalized, kind });
  const lines = [...breakdown];
  if (skillBonus) lines.push({ label: loc('SHADOWBASE.Roll.GearBonus'), value: signed(Number(skillBonus)) });
  if (skillPenalty) lines.push({ label: loc('SHADOWBASE.Roll.SkillPenalty'), value: `-${Number(skillPenalty)}` });
  const oh = offHandPenalty({ kind, offHand: answer.offHand, penalized });
  if (oh) lines.push({ label: loc('SHADOWBASE.Roll.OffHand'), value: signed(oh) });
  if (answer.modifier) lines.push({ label: loc('SHADOWBASE.Roll.Situational'), value: signed(answer.modifier) });
  return rollTarget(actor, { label, target: Number(target), modifier, skillName, rollMode: answer.rollMode, breakdown: lines, flags, extra, template, ...opts.spec });
}

// ---------------------------------------------------------------------------
// Attributes, characteristics, skills
// ---------------------------------------------------------------------------

/** rollAttributes(stats) keys -> the label key on the card. */
export const ATTRIBUTE_KEYS = Object.freeze(['st', 'dx', 'iq', 'ht', 'will', 'per']);
/** currentValues keys the Characteristic rolls read (roller-window.tsx:951-970; frightCheck short-circuits on immunity). */
export const CHARACTERISTIC_KEYS = Object.freeze(['will', 'perception', 'frightCheck', 'vision', 'hearing', 'tasteAndSmell', 'touch']);

/** The attribute target: the effective value the engine rolls with (roller-window.tsx:951-957). */
export function attributeTarget(actor, key) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const attrs = attrsOf(stats);
  return attrs[key] ?? null;
}

/**
 * @param {object} actor
 * @param {'st'|'dx'|'iq'|'ht'|'will'|'per'} key
 */
export async function rollAttribute(actor, key, opts = {}) {
  if (!ATTRIBUTE_KEYS.includes(key)) throw new Error(`rolls.rollAttribute: "${key}" is not one of ${ATTRIBUTE_KEYS.join(', ')}`);
  const label = loc(`SHADOWBASE.Roll.Attribute.${key}`);
  return rollSimple(actor, { label, target: attributeTarget(actor, key), flags: { kind: 'attribute', key } }, opts);
}

/** The characteristic target from currentValues; null when Fright Check is immune (the roll is not made). */
export function characteristicTarget(actor, key) {
  const stats = statsOf(actor);
  if (!stats) return null;
  if (key === 'frightCheck' && stats.modifiers?.frightImmune) return null;
  const v = stats.currentValues?.[key];
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

/**
 * @param {object} actor
 * @param {'will'|'perception'|'frightCheck'|'vision'|'hearing'|'tasteAndSmell'|'touch'} key
 */
export async function rollCharacteristic(actor, key, opts = {}) {
  if (!CHARACTERISTIC_KEYS.includes(key)) throw new Error(`rolls.rollCharacteristic: "${key}" is not one of ${CHARACTERISTIC_KEYS.join(', ')}`);
  const stats = statsOf(actor);
  if (!stats) return null;
  if (key === 'frightCheck' && stats.modifiers?.frightImmune) {
    // Immunity means the roll is not made (roller-window.tsx:958-969: the button goes away).
    notify('info', fmt('SHADOWBASE.Roll.FrightImmune', { name: actor.name }));
    return null;
  }
  const label = loc(`SHADOWBASE.Roll.Characteristic.${key}`);
  return rollSimple(actor, { label, target: characteristicTarget(actor, key), flags: { kind: 'characteristic', key } }, opts);
}

/**
 * The HUD's skill target (roller-window.tsx:1746-1759): Ch3's ladder through
 * resolveSkillLevel over the sheet's skills, plus the skill-bonus channel's
 * unconditional half. Null when the ladder cannot read the row.
 * @returns {{ target: number|null, level: number|null, flatBonus: number, resolution: object }|null}
 */
export function skillTargetFor(actor, skillName) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const sheet = sheetOf(actor);
  const resolution = engine.skillDefaults.resolveSkillLevel(skillName, sheet.skills, attrsOf(stats));
  const flatBonus = engine.skillBonuses.skillBonusFor(stats.skillBonuses, skillName).flat;
  const target = resolution.level == null ? null : resolution.level + flatBonus;
  return { target, level: resolution.level, flatBonus, resolution, describe: engine.skillDefaults.describeResolution(resolution) };
}

/** @param {object} actor @param {string} skillName the skill as the sheet names it ("Guns (Blaster Pistol)") */
export async function rollSkill(actor, skillName, opts = {}) {
  const info = skillTargetFor(actor, skillName);
  if (!info) return null;
  return rollSimple(actor, { label: skillName, target: info.target, skillName, flags: { kind: 'skill', skillName, resolution: info.resolution }, breakdown: info.flatBonus ? [{ label: loc('SHADOWBASE.Roll.GearBonus'), value: signed(info.flatBonus) }] : [] }, opts);
}

/** rollCustom(actor, { label, target, modifier }) - the HUD's Custom Roll section. */
export async function rollCustom(actor, { label, target, modifier = 0, rollMode } = {}, opts = {}) {
  return rollSimple(actor, { label: label || loc('SHADOWBASE.Roll.Custom'), target, flags: { kind: 'custom' } }, { modifier, rollMode, ...opts });
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

/** The HUD's readied-weapon order (roller-window.tsx:793-796, 972): blasters, melee, sabers; equipped and not in storage. */
export function equippedWeapons(actor) {
  const rows = [...rowsOf(actor, 'customBlasters'), ...rowsOf(actor, 'customMeleeWeapons'), ...rowsOf(actor, 'lightsabers')];
  return rows.filter((item) => { const r = item.system?.row ?? {}; return !!r.equipped && !r.storageLocationId; });
}

/** Off hand = any readied weapon after the first (roller-window.tsx:1311 `isOffHand = i > 0`). */
export function isOffHandWeapon(actor, item) {
  const idx = equippedWeapons(actor).findIndex((w) => w.id === item.id);
  return idx > 0;
}

const isSaberItem = (item, row) => item?.type === 'lightsaber' || engine.lightsaberClassType.isLightsaberWeapon(row);
const isMeleeItem = (item) => item?.type === 'meleeWeapon';
const lower = (v) => String(v ?? '').toLowerCase();
/** roller-window.tsx:1300-1309 - the shapes, no dead names. */
const isStinger = (row) => lower(row.baseType).includes('stinger');
/**
 * A grenade launcher, mortar or missile tube - a weapon that fires the explosive round it was loaded with
 * instead of rolling a damage line of its own. The website's ONE test (lib/launcher-weapons.ts
 * firesExplosivePayload, 2026-10-03: the weapon card's and the HUD's alike), through the bundle. The HUD's
 * old test - a `category` a blaster row does not carry, then the name fragments "Launcher" and "Tube" - is the
 * rejected alternative: under it the Merr-Sonn MM-s1 Mortar and the Czerka Underslung Grenade attacked without
 * a round loaded, spent charges and rolled "By Ammo" as ordinary guns (check:rolls pins both).
 */
export const firesExplosivePayload = (row) => engine.launcherWeapons.firesExplosivePayload(row);
const isGrenadeLauncher = firesExplosivePayload;
const isSlugthrower = (row) => ['slugthrower', 'ripper', 'cycler'].some((w) => lower(row.baseType).includes(w));

/**
 * The malfunction threshold the attack rolls against (ARCHITECTURE.md §5.1):
 * `item.derived.malfunction` - the figure the family's calculate*Stats
 * computes (a blaster: durability ?? maxDurability, then the loaded gas grade's
 * Malf modifier, min 4; use-blaster-calculations.ts:202, 255-261) - else the
 * stored row's, else Ch7's base 17: the HUD's own read (roller-window.tsx:1317,
 * `w.malfunction || 17`). Never malfunctionOrBase(row.durability, ...), which
 * answers 14 for every kit-built weapon whose durability is the null
 * "unmeasured" sentinel (the review's M4; check:rolls pins 17 vs 14).
 */
export function malfunctionThresholdFor(item) {
  const derived = item?.system?.derived ?? null;
  const figure = derived && derived.malfunction !== undefined ? derived.malfunction : item?.system?.row?.malfunction;
  const m = Number(figure);
  return Number.isFinite(m) && m > 0 ? m : engine.malfunction.BASE_MALFUNCTION;
}

/**
 * The attack target of a readied weapon (ARCHITECTURE.md §5.1): the website's
 * one resolver, weaponAttackSkill.attackSkillFor, called with hit bonus 0 and
 * an empty gear table so `.skillTarget` is the BARE skill - a saber's
 * Lightsaber Combat by Class Type, anything else its baseSkill ('Melee Weapon'
 * when blank), through Ch3's ladder with the chapter's DX-6 / DX-5 printed
 * defaults - plus the universal Min-ST shortfall (melee: finalStRequirement;
 * ranged: grip-first rangedMinSt; roller-window.tsx:889-892). `.hitBonus` of
 * that call is only Ch12's crystal penalty (weapon-attack-skill.ts:117-127),
 * which the HUD's own getSkillTargetInfo omits and the card includes - one
 * composition here. The whole hit bonus (global to-hit + gear skill bonus +
 * crystal penalty) is returned SEPARATELY as the roll's skillBonus so it lands
 * exactly once (header, item 1).
 * @returns {null|{ target: number, skillName: string, type: 'trained'|'fallback'|'default', note: string, stShortfall: number, hitBonus: number, malfunctionThreshold: number, flawedItem: boolean, isSaber: boolean, isMelee: boolean, row: object }}
 */
export function attackTargetFor(actor, item) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const sheet = sheetOf(actor);
  const attrs = attrsOf(stats);
  const row = rowWithDerived(item);
  const skills = sheet.skills ?? [];
  const resolved = engine.weaponAttackSkill.attackSkillFor(row, skills, attrs, 0, new Map());
  if (!resolved) return null;
  const saber = isSaberItem(item, row);
  // The skill the resolver rolled: its own requiredSpecialty for a saber, else the row's baseSkill with the
  // resolver's 'Melee Weapon' fallback (weapon-attack-skill.ts `wanted`).
  const skillName = resolved.requiredSpecialty ?? String(row.baseSkill || 'Melee Weapon');
  const effectiveStrength = stats.primaryAttributes.effectiveStrength;
  const minSt = row.finalStRequirement ?? engine.weaponHandling.rangedMinSt(row, sheet.weaponModifications ?? []);
  const stShortfall = engine.weaponHandling.minStShortfallPenalty(minSt, effectiveStrength);
  const shortfallNote = stShortfall < 0 ? ` · Min ST shortfall ${stShortfall}` : '';
  const target = resolved.skillTarget + stShortfall;
  const type = resolved.type;
  // The human note: Ch3's ladder step the resolver took, or the printed DX-n default it fell to
  // (read off the resolver's own answer rather than re-stating the 6/5 rule).
  const ladder = engine.skillDefaults.resolveSkillLevel(skillName, skills, attrs);
  const note = ladder.level != null
    ? `${engine.skillDefaults.describeResolution(ladder)}${shortfallNote}`
    : `DX-${(attrs.dx ?? 10) - resolved.skillTarget}${shortfallNote}`;
  const hitBonus = attackHitBonus(stats.modifiers?.toHit, stats.skillBonuses, skillName) + (Number(resolved.hitBonus) || 0);
  return {
    target, skillName, type, note, stShortfall, hitBonus,
    malfunctionThreshold: malfunctionThresholdFor(item),
    flawedItem: row.flawedBuild === true,
    isSaber: saber, isMelee: isMeleeItem(item), row,
  };
}

/**
 * Why an attack cannot be made right now, or null (roller-window.tsx
 * isAttackDisabled, 1424-1436): Ch9's stun lock first and without exception,
 * then Ch12's ◊ unready gate, then the per-type ammunition gates.
 */
export function attackBlockedReason(actor, item) {
  const row = rowWithDerived(item);
  const name = item.displayName ?? item.name;
  if (engine.stunRules.isStunned(actor.system?.stunType)) return fmt('SHADOWBASE.Roll.StunnedNoAttack', { name: actor.name });
  if (isMeleeItem(item) && row.isUnready) return fmt('SHADOWBASE.Roll.Unready', { weapon: name });
  if (isSaberItem(item, row)) return null;
  if (isGrenadeLauncher(row)) return row.loadedExplosiveId ? null : fmt('SHADOWBASE.Roll.NoExplosiveLoaded', { weapon: name });
  if (isStinger(row)) return (row.selectedVolleyIndices?.length || 0) > 0 ? null : fmt('SHADOWBASE.Roll.NoDartsSelected', { weapon: name });
  if (item.type === 'blaster') return (row.currentCharges ?? 0) >= (row.chargesPerShot || 1) ? null : fmt('SHADOWBASE.Roll.NoCharges', { weapon: name });
  return null;
}

/** How many shots the attack button fires (roller-window.tsx:1313, 1319-1327): the darts selected, else the rate of fire. */
export function shotsFor(item) {
  const row = rowWithDerived(item);
  if (isStinger(row)) return row.selectedVolleyIndices?.length || 0;
  return parseInt(row.finalRateOfFire || '1', 10) || 1;
}

/**
 * The bookkeeping an attack leaves on the weapon (roller-window.tsx
 * handleAttack, 1335-1407), ported line for line onto the Item:
 *   - melee: lastAttackTurn = turnCounter (hit or miss); isUnready when Ch12's
 *     ◊ applies below the 1.5x Min-ST lift (weaponHandling.attackLeavesUnready);
 *   - stinger: the selected darts leave the reservoir (up to and including the
 *     one that malfunctioned), the hits become lastVolley, pendingHits follows;
 *   - grenade launcher: nothing on a malfunction; else the loaded explosive
 *     becomes lastFiredExplosive and the tube empties;
 *   - slugthrower with a loaded magazine: the fired rounds shift off the
 *     magazine (the ammunition Item too), firedRounds/currentCharges/pendingHits;
 *   - everything else: currentCharges - shots (before the malfunction), pendingHits.
 * @param {object} actor
 * @param {object} item
 * @param {object|object[]} results one outcome, or the volley's list
 * @returns {Promise<{ hitCount: number, shotsToDeduct: number, updates: object, unready: boolean }>}
 */
export async function applyAttackSideEffects(actor, item, results) {
  const list = Array.isArray(results) ? results : [results];
  const hitCount = list.filter((r) => r?.success).length;
  const firstMalfIdx = list.findIndex((r) => r?.isMalfunction);
  const shotsToDeduct = firstMalfIdx === -1 ? list.length : firstMalfIdx;
  const row = rowWithDerived(item);
  const stored = item.system?.row ?? {};
  const updates = {};
  let unready = false;
  if (isMeleeItem(item)) {
    updates.lastAttackTurn = Number(actor.system?.turnCounter) || 0;
    if (engine.weaponHandling.attackLeavesUnready(row, actor.stats?.primaryAttributes?.effectiveStrength)) {
      updates.isUnready = true;
      unready = true;
      notify('warn', fmt('SHADOWBASE.Roll.WeaponUnready', { weapon: item.displayName ?? item.name }));
    }
  }
  if (isStinger(row)) {
    const reservoir = [...(stored.stingerReservoir ?? [])];
    const selected = stored.selectedVolleyIndices ?? [];
    const hits = selected.map((idx) => reservoir[idx]).filter((_, ri) => (Array.isArray(results) ? (results[ri]?.success && (firstMalfIdx === -1 || ri < firstMalfIdx)) : true));
    const remove = firstMalfIdx === -1 ? selected : selected.slice(0, firstMalfIdx + 1);
    updates.stingerReservoir = reservoir.filter((_, idx) => !remove.includes(idx));
    updates.lastVolley = hits;
    updates.selectedVolleyIndices = [];
    updates.pendingHits = hits.length;
  } else if (isGrenadeLauncher(row)) {
    if (firstMalfIdx !== -1) { await writeRow(item, updates); return { hitCount, shotsToDeduct, updates, unready }; }
    updates.lastFiredExplosive = stored.loadedExplosiveData ?? null;
    updates.loadedExplosiveId = null;
    updates.loadedExplosiveData = null;
    updates.currentCharges = 0;
    updates.pendingHits = hitCount;
  } else if (isSlugthrower(row) && stored.loadedAmmunitionData) {
    const mag = { ...stored.loadedAmmunitionData };
    const contents = [...(mag.contents ?? [])];
    const fired = [];
    for (let i = 0; i < shotsToDeduct; i++) if (contents.length > 0) fired.push(contents.shift());
    const magItem = rowsOf(actor, 'ammunition').find((a) => a.system?.row?.id === stored.loadedAmmunitionId);
    if (magItem) await magItem.updateRow({ contents, currentCharges: contents.length });
    updates.loadedAmmunitionData = { ...mag, contents, currentCharges: contents.length };
    updates.firedRounds = fired;
    updates.currentCharges = contents.length;
    updates.pendingHits = hitCount;
  } else if (!isMeleeItem(item) && !isSaberItem(item, row)) {
    const current = Number(stored.currentCharges) || 0;
    updates.currentCharges = Math.max(0, current - shotsToDeduct);
    updates.pendingHits = hitCount;
  } else {
    // A melee weapon or a saber banks its hits and spends nothing (roller-window.tsx:1401-1404 runs for them too).
    const current = Number(stored.currentCharges) || 0;
    if (stored.currentCharges !== undefined && stored.currentCharges !== null) updates.currentCharges = Math.max(0, current - shotsToDeduct);
    updates.pendingHits = hitCount;
  }
  await writeRow(item, updates);
  return { hitCount, shotsToDeduct, updates, unready };
}

async function writeRow(item, updates) {
  if (!Object.keys(updates).length) return;
  if (typeof item.updateRow === 'function') await item.updateRow(updates);
  else await item.update(Object.fromEntries(Object.entries(updates).map(([k, v]) => [`system.row.${k}`, v])));
}

/**
 * Attack with a readied weapon. One shot rolls one 3d6; a weapon whose rate of
 * fire (or dart selection) is above one fires a volley (roller-window.tsx
 * :1319-1327 builds the volley from `rof`). Blocked while stunned, unready or
 * out of ammunition (attackBlockedReason).
 * @param {object} actor
 * @param {object} item a blaster / meleeWeapon / lightsaber Item
 * @param {{ modifier?: number, offHand?: boolean, rollMode?: string, prompt?: boolean, shots?: number }} [opts]
 */
export async function rollAttack(actor, item, opts = {}) {
  const blocked = attackBlockedReason(actor, item);
  if (blocked) { notify('warn', blocked); return null; }
  const info = attackTargetFor(actor, item);
  if (!info) return null;
  const shots = opts.shots ?? shotsFor(item);
  if (shots > 1) return rollVolley(actor, item, shots, opts);
  const stats = statsOf(actor);
  const penalized = !!stats.dualWielding?.penalized;
  const name = item.displayName ?? item.name;
  const label = fmt('SHADOWBASE.Roll.AttackLabel', { weapon: name });
  const answer = await resolveOptions(actor, { offHand: isOffHandWeapon(actor, item), ...opts }, { label, target: info.target + info.hitBonus, dualWielding: penalized, kind: 'attack', malfunctionThreshold: info.malfunctionThreshold });
  if (!answer) return null;
  const modifier = stackModifiers({ situational: answer.modifier, skillBonus: info.hitBonus, offHand: answer.offHand, penalized, kind: 'attack' });
  const breakdown = [];
  if (info.hitBonus) breakdown.push({ label: loc('SHADOWBASE.Roll.ToHit'), value: signed(info.hitBonus) });
  const oh = offHandPenalty({ kind: 'attack', offHand: answer.offHand, penalized });
  if (oh) breakdown.push({ label: loc('SHADOWBASE.Roll.OffHand'), value: signed(oh) });
  if (answer.modifier) breakdown.push({ label: loc('SHADOWBASE.Roll.Situational'), value: signed(answer.modifier) });
  const result = await rollTarget(actor, {
    label, target: info.target, modifier, skillName: info.skillName,
    malfunctionThreshold: info.malfunctionThreshold, flawedItem: info.flawedItem,
    rollType: isGrenadeLauncher(info.row) ? 'grenade' : 'standard', rollMode: answer.rollMode, breakdown,
    extra: { itemId: item.id, itemName: name, skillType: info.type, skillNote: info.note, canRollDamage: true },
    flags: { kind: 'attack', itemId: item.id, skillType: info.type },
  });
  if (!result) return null;
  const side = await applyAttackSideEffects(actor, item, result.outcome);
  return { ...result, sideEffects: side };
}

/**
 * A volley: one 3d6 per shot against the same target, halted at the first
 * malfunction (use-dice-roller.ts rollTargetVolley, 348-384); the weapon's
 * bookkeeping sees the whole list.
 */
export async function rollVolley(actor, item, shots, opts = {}) {
  const blocked = attackBlockedReason(actor, item);
  if (blocked) { notify('warn', blocked); return null; }
  const info = attackTargetFor(actor, item);
  if (!info) return null;
  const stats = statsOf(actor);
  const penalized = !!stats.dualWielding?.penalized;
  const name = item.displayName ?? item.name;
  const label = fmt('SHADOWBASE.Roll.AttackLabel', { weapon: name });
  const answer = await resolveOptions(actor, { offHand: isOffHandWeapon(actor, item), ...opts }, { label, target: info.target + info.hitBonus, dualWielding: penalized, kind: 'attack', malfunctionThreshold: info.malfunctionThreshold, shots });
  if (!answer) return null;
  const modifier = stackModifiers({ situational: answer.modifier, skillBonus: info.hitBonus, offHand: answer.offHand, penalized, kind: 'attack' });
  const target = info.target + modifier;
  const row = info.row;
  const labels = isStinger(row)
    ? (row.selectedVolleyIndices ?? []).map((vIdx) => fmt('SHADOWBASE.Roll.Dart', { n: vIdx + 1, name: row.stingerReservoir?.[vIdx]?.name ?? '' }))
    : Array.from({ length: shots }, (_, si) => {
      const round = isSlugthrower(row) ? row.loadedAmmunitionData?.contents?.[si]?.name : null;
      return round ? fmt('SHADOWBASE.Roll.ShotNamed', { n: si + 1, name: round }) : fmt('SHADOWBASE.Roll.Shot', { n: si + 1 });
    });
  const results = [];
  const rolls = [];
  for (let i = 0; i < labels.length; i++) {
    const roll = await new Roll('3d6').evaluate();
    rolls.push(roll);
    const total = roll.total;
    const outcome = resolveOutcome(total, target, info.malfunctionThreshold);
    const tag = outcome.isCriticalFailure ? 'CritMiss' : outcome.isMalfunction ? 'Malf' : outcome.success ? 'Hit' : 'Miss';
    results.push({ label: labels[i], total, dice: diceOf(roll), target, ...outcome, tag, tagText: loc(`SHADOWBASE.Roll.${tag}`) });
    if (outcome.isMalfunction) break;
  }
  const halted = results.length < labels.length;
  const hits = results.filter((r) => r.success).length;
  const title = fmt('SHADOWBASE.Roll.VolleyTitle', { label });
  const context = { title, label, skillName: info.skillName, target, baseTarget: info.target, modifier, results, halted, hits, shots: labels.length, malfunctionThreshold: info.malfunctionThreshold, itemId: item.id, itemName: name, actorId: actor.id, canRollDamage: hits > 0 };
  const message = await postCard(actor, TEMPLATES.volley, context, { rollMode: answer.rollMode, rolls, flags: { kind: 'volley', itemId: item.id, label, target, results: results.map(({ label: l, total, target: t, success, isMalfunction, isCriticalFailure }) => ({ label: l, total, target: t, success, isMalfunction, isCriticalFailure })) } });
  const description = results.map((r) => `${r.label}: ${r.total} vs ${r.target} [${r.tagText}]`).join('\n');
  await pushHistory(actor, { title, description, timestamp: Date.now() });
  const side = await applyAttackSideEffects(actor, item, results);
  return { results, hits, halted, target, modifier, rolls, message, sideEffects: side };
}

/**
 * What the weapon's Damage button rolls (roller-window.tsx:1314, 1329-1333,
 * 1422, 1542): the derived damage (finalDamage / calculatedDamage), the first
 * fired round's formula for a slugthrower, the fired explosive's effect for a
 * launcher; a stinger's hits and a multi-hit volley become a damage volley.
 * @returns {{ formula: string|null, damageType: string|null, volley: {label: string, formula: string}[]|null, pendingHits: number }}
 */
export function damageFormulaFor(actor, item) {
  const row = rowWithDerived(item);
  const dmg = row.finalDamage || row.calculatedDamage || '1d';
  const damageType = row.finalDamageType ?? null;
  const pendingHits = Number(row.pendingHits) || 0;
  let formula = dmg;
  let volley = null;
  if (isStinger(row)) {
    formula = null;
    volley = (row.lastVolley ?? []).map((dart) => ({ label: fmt('SHADOWBASE.Roll.HitNamed', { name: dart?.name ?? '' }), formula: dart?.formula || '1d' }));
  } else if (isSlugthrower(row) && (row.firedRounds?.length ?? 0) > 0) {
    formula = row.firedRounds[0]?.formula || dmg;
    volley = row.firedRounds.slice(0, pendingHits).map((r) => ({ label: fmt('SHADOWBASE.Roll.HitNamed', { name: r?.name ?? '' }), formula: r?.formula || dmg }));
  } else if (isGrenadeLauncher(row)) {
    formula = row.lastFiredExplosive?.finalDamageEffect ?? null;
  } else if (pendingHits > 1) {
    volley = Array.from({ length: pendingHits }, (_, hi) => ({ label: fmt('SHADOWBASE.Roll.HitNumber', { n: hi + 1 }), formula: dmg }));
  }
  if (volley && volley.length <= 1 && !isStinger(row)) volley = null;
  return { formula, damageType, volley, pendingHits };
}

/** Clear the hits the damage roll consumed (roller-window.tsx handleDamage, 1409-1418). */
async function clearPendingHits(item) {
  const row = rowWithDerived(item);
  const updates = { pendingHits: 0 };
  if (isStinger(row)) updates.lastVolley = [];
  if (isGrenadeLauncher(row)) updates.lastFiredExplosive = null;
  if (isSlugthrower(row)) updates.firedRounds = [];
  await writeRow(item, updates);
}

/** Append the website's damage bonus string the way RollButton does (roll-button.tsx:136-140, 148-152). */
export function withDamageBonus(formula, bonus) {
  if (!bonus) return formula;
  const sep = /^[+-]/.test(String(bonus)) ? '' : ' + ';
  return `${formula}${sep}${bonus}`;
}

/**
 * What a weapon's Damage roll is halved by (Ch11, Core Terms, Range), exactly as the website's Damage button
 * is handed it (roller-window.tsx `postRollHalvings` / `halfDamageRange`; BlasterFinalStats.tsx): ranged rows
 * only - a melee weapon or a saber prints no range and loads no gas.
 *   standing   the halvings the roll always carries: the LOADED pack's (Training-grade gas), read at the roll
 *              from the pack that is loaded (blaster-gas-grades.ts loadedGasHalvings) and never stored;
 *   range      the printed range the "Past 1/2D" switch keys on, or null: a launcher rolls the round it fired,
 *              and an explosive round's blast never halves past 1/2D (post-roll-halving.ts rangeForDamageSource);
 *   canBePast  whether that range is a pair - a single figure is Max only and never halves for range.
 * Nothing is restated here: the three answers are the bundle's.
 * @param {object|null} item
 * @returns {{ standing: { id: string, label: string }[], range: string|null, canBePast: boolean }}
 */
export function damageHalvingsFor(item) {
  if (item?.type !== 'blaster') return { standing: [], range: null, canBePast: false };
  const row = rowWithDerived(item);
  const P = engine.postRollHalving;
  const range = P.rangeForDamageSource(row.finalHalfDamageRange, isGrenadeLauncher(row) ? 'explosive-payload' : 'weapon');
  return { standing: engine.blasterGasGrades.loadedGasHalvings(row), range: range == null ? null : String(range), canBePast: P.hasHalfDamageRange(range) };
}

/**
 * The answers a Damage roll needs before the dice: the situational modifier, the roll mode and - for a weapon
 * with a 1/2D to be past - whether the target is past it. The website asks in the Damage button's popover
 * (roll-button.tsx: a switch, off by default and per roll, "since the sheet holds no target distance"); here
 * the roll prompt opens for exactly that case, unless the caller decided (a modifier or `pastHalfDamage` given,
 * or `prompt: false`). Every other damage roll goes unprompted, as it always has.
 * @returns {Promise<null|{ modifier: number, rollMode: string|undefined, pastHalfDamage: boolean }>} null when the prompt was closed
 */
async function resolveDamageOptions(spec, opts, { label, damage, halving }) {
  const asked = spec.prompt === true || (spec.modifier === undefined && opts.prompt === true);
  const decided = spec.modifier !== undefined || opts.modifier !== undefined || spec.pastHalfDamage !== undefined || spec.prompt === false || opts.prompt === false;
  if (!asked && !(halving.canBePast && !decided)) {
    return { modifier: Number(spec.modifier ?? opts.modifier) || 0, rollMode: spec.rollMode ?? opts.rollMode, pastHalfDamage: spec.pastHalfDamage === true };
  }
  const answer = await promptRoll({ label, target: null, damage, rollMode: spec.rollMode, halvings: halving.standing, halfDamageRange: halving.canBePast ? halving.range : null });
  if (!answer) return null;
  return { modifier: Number(answer.modifier) || 0, rollMode: answer.rollMode, pastHalfDamage: answer.pastHalfDamage === true };
}

/**
 * Roll damage (use-dice-roller.ts rollDamage): the website formula is
 * translated to Foundry's grammar (toFoundryFormula), the situational modifier
 * rides on the formula, the evaluated total is clamped to a minimum of 1, and
 * then Ch11's post-roll halvings land on that total - the loaded pack's
 * Training-grade gas, and "past 1/2D" when the player says so - each rounding
 * down, with NO minimum after them (post-roll-halving.ts resolveDamageRoll: a
 * halving is a transform on the rolled total, never a pre-halved dice string).
 * With an `item`, the formula comes from damageFormulaFor and the item's
 * pending hits are cleared afterwards.
 * @param {object} actor
 * @param {{ label?: string, formula?: string, damageType?: string, item?: object, bonus?: string, modifier?: number, rollMode?: string, prompt?: boolean, pastHalfDamage?: boolean }} spec
 */
export async function rollDamage(actor, spec = {}, opts = {}) {
  const item = spec.item ?? null;
  const derived = item ? damageFormulaFor(actor, item) : null;
  if (derived?.volley?.length) return rollDamageVolley(actor, derived.volley, { ...spec, label: spec.label ?? (item.displayName ?? item.name) }, opts);
  const website = spec.formula ?? derived?.formula ?? null;
  const baseLabel = spec.label ?? (item ? (item.displayName ?? item.name) : loc('SHADOWBASE.Roll.Damage'));
  // Callers pass a label that already ends in "Damage" (use-dice-roller.ts:331-336).
  const title = /\bdamage\s*$/i.test(baseLabel) ? baseLabel : fmt('SHADOWBASE.Roll.DamageTitle', { label: baseLabel });
  const full = withDamageBonus(website, spec.bonus);
  const translated = toFoundryFormula(full);
  if (!translated.ok) {
    notify('warn', fmt('SHADOWBASE.Roll.NotRollable', { formula: String(full ?? ''), reason: translated.reason ?? '' }));
    return null;
  }
  const halving = damageHalvingsFor(item);
  const answer = await resolveDamageOptions(spec, opts, { label: title, damage: full, halving });
  if (!answer) return null;
  const modifier = Number(answer.modifier) || 0;
  const halvings = engine.postRollHalving.damageRollHalvings(halving.standing, halving.range, answer.pastHalfDamage);
  const formula = modifier ? `${translated.formula}${signed(modifier)}` : translated.formula;
  const roll = await new Roll(formula).evaluate();
  const clamped = roll.total < 1;
  // resolveDamageRoll: the 1-point floor sits on the FULL roll (the situational modifier already rides the Foundry
  // formula, hence the 0 here), then each halving rounds down - and nothing floors the result after them.
  const resolved = engine.postRollHalving.resolveDamageRoll(roll.total, 0, halvings);
  const total = resolved.total;
  const damageType = spec.damageType ?? derived?.damageType ?? translated.damageType ?? null;
  const context = {
    title, label: baseLabel, websiteFormula: full, formula, flavor: translated.flavor, damageType, armorDivisor: translated.armorDivisor,
    total, rawTotal: roll.total, clamped, beforeHalving: resolved.beforeHalving, halvingText: resolved.halvingText,
    dice: diceOf(roll), diceText: diceOf(roll).join(', '), modifier, modifierText: modifier ? signed(modifier) : '',
    itemId: item?.id ?? null, itemName: item ? (item.displayName ?? item.name) : null, actorId: actor.id,
  };
  const message = await postCard(actor, TEMPLATES.damage, context, { rollMode: answer.rollMode, rolls: [roll], flags: { kind: 'damage', itemId: item?.id ?? null, websiteFormula: full, formula, total, beforeHalving: resolved.beforeHalving, halvings: halvings.map((h) => h.id), halvingText: resolved.halvingText, damageType, armorDivisor: translated.armorDivisor, flavor: translated.flavor } });
  const description = `${loc('SHADOWBASE.Roll.Formula')}: ${full}${modifier ? ` (${signed(modifier)})` : ''}\n${loc('SHADOWBASE.Roll.Total')}: ${total}${resolved.halvingText ? `\n${loc('SHADOWBASE.Roll.Halved')}: ${resolved.halvingText}` : ''}\n${loc('SHADOWBASE.Roll.Rolls')}: ${context.diceText}`;
  await pushHistory(actor, { title, description, timestamp: Date.now() });
  if (item) await clearPendingHits(item);
  return { total, rawTotal: roll.total, clamped, beforeHalving: resolved.beforeHalving, halvings, halvingText: resolved.halvingText, formula, websiteFormula: full, damageType, flavor: translated.flavor, armorDivisor: translated.armorDivisor, roll, message };
}

/**
 * Several damage rolls at once (use-dice-roller.ts rollDamageVolley): each
 * item's formula rolled, each total clamped to 1 and then halved by the same
 * post-roll halvings a single roll carries (one answer for the whole volley,
 * as the website's one popover gives).
 * @param {object} actor
 * @param {{ label: string, formula: string }[]} items
 */
export async function rollDamageVolley(actor, items, spec = {}, opts = {}) {
  const baseLabel = spec.label ?? loc('SHADOWBASE.Roll.Damage');
  const title = fmt('SHADOWBASE.Roll.VolleyDamageTitle', { label: baseLabel });
  const halving = damageHalvingsFor(spec.item ?? null);
  const answer = await resolveDamageOptions(spec, opts, { label: title, damage: `${[...new Set(items.map((it) => it.formula || '1d'))].join(' / ')} x${items.length}`, halving });
  if (!answer) return null;
  const modifier = Number(answer.modifier) || 0;
  const halvings = engine.postRollHalving.damageRollHalvings(halving.standing, halving.range, answer.pastHalfDamage);
  const results = [];
  const rolls = [];
  for (const it of items) {
    const full = withDamageBonus(it.formula || '1d', spec.bonus);
    const t = toFoundryFormula(full);
    if (!t.ok) { results.push({ label: it.label, websiteFormula: full, formula: null, total: null, notRollable: true }); continue; }
    const formula = modifier ? `${t.formula}${signed(modifier)}` : t.formula;
    const roll = await new Roll(formula).evaluate();
    rolls.push(roll);
    const resolved = engine.postRollHalving.resolveDamageRoll(roll.total, 0, halvings);
    results.push({ label: it.label, websiteFormula: full, formula, flavor: t.flavor, total: resolved.total, rawTotal: roll.total, beforeHalving: resolved.beforeHalving, halvingText: resolved.halvingText, dice: diceOf(roll), diceText: diceOf(roll).join(', ') });
  }
  const context = { title, label: baseLabel, results, modifier, modifierText: modifier ? signed(modifier) : '', itemId: spec.item?.id ?? null, actorId: actor.id, damage: true };
  const message = await postCard(actor, TEMPLATES.volley, context, { rollMode: answer.rollMode, rolls, flags: { kind: 'damage-volley', itemId: spec.item?.id ?? null, halvings: halvings.map((h) => h.id), results: results.map(({ label, total, formula }) => ({ label, total, formula })) } });
  await pushHistory(actor, { title, description: results.map((r) => `${r.label}: ${r.total ?? '-'} [${r.diceText ?? ''}]${r.halvingText ? ` ${fmt('SHADOWBASE.Roll.HalvedShot', { text: r.halvingText })}` : ''}`).join('\n'), timestamp: Date.now() });
  if (spec.item) await clearPendingHits(spec.item);
  return { results, halvings, rolls, message };
}

// ---------------------------------------------------------------------------
// Unarmed (roller-window.tsx:1171-1194, 1231-1294)
// ---------------------------------------------------------------------------

/** Punch and Kick roll the SAME target: the best of the four striking skills (unarmed-strikes.ts). */
export function unarmedTargetFor(actor) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const sheet = sheetOf(actor);
  const strike = engine.unarmedStrikes.unarmedStrikeTarget(sheet.skills, attrsOf(stats));
  return { ...strike, hitBonus: attackHitBonus(stats.modifiers?.toHit, stats.skillBonuses, strike.skillName) };
}

/**
 * @param {object} actor
 * @param {'punch'|'kick'} which
 */
export async function rollUnarmed(actor, which, opts = {}) {
  if (which !== 'punch' && which !== 'kick') throw new Error(`rolls.rollUnarmed: "${which}" is not punch|kick`);
  if (engine.stunRules.isStunned(actor.system?.stunType)) { notify('warn', fmt('SHADOWBASE.Roll.StunnedNoAttack', { name: actor.name })); return null; }
  const strike = unarmedTargetFor(actor);
  if (!strike) return null;
  const label = fmt('SHADOWBASE.Roll.AttackLabel', { weapon: loc(`SHADOWBASE.Roll.${which === 'punch' ? 'Punch' : 'Kick'}`) });
  const result = await rollSimple(actor, {
    label, target: strike.target, skillName: strike.skillName, kind: 'attack', skillBonus: strike.hitBonus,
    flags: { kind: 'unarmed', which, skillType: strike.type }, extra: { skillType: strike.type, skillNote: strike.note },
  }, opts);
  if (!result) return null;
  // The fist has no row: its bank is a flag (the HUD's component state on the website, roller-window.tsx:1183).
  await actor.update({ [`flags.${SYSTEM_ID}.unarmedPendingHits.${which}`]: result.outcome.success ? 1 : 0 });
  return result;
}

/** Damage for a punch or kick from stats.unarmedDamage (Karate's per-die bonus already inside). */
export async function rollUnarmedDamage(actor, which, opts = {}) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const formula = stats.unarmedDamage?.[which];
  const label = fmt('SHADOWBASE.Roll.DamageTitle', { label: loc(`SHADOWBASE.Roll.${which === 'punch' ? 'Punch' : 'Kick'}`) });
  const result = await rollDamage(actor, { label, formula, modifier: opts.modifier, rollMode: opts.rollMode });
  if (result) await actor.update({ [`flags.${SYSTEM_ID}.unarmedPendingHits.${which}`]: 0 });
  return result;
}

// ---------------------------------------------------------------------------
// Defenses (roller-window.tsx defensiveInfoFor 994-1130; use-character-form.ts 546-567)
// ---------------------------------------------------------------------------

/** The active Form's resolved effect when a saber is readied (use-character-form.ts:546-556), else NO_FORM_EFFECT. */
export function activeFormEffectFor(actor) {
  const sheet = sheetOf(actor);
  const formName = sheet.activeLightsaberForm;
  const saberReadied = (sheet.lightsabers ?? []).some((ls) => ls?.equipped && !ls.storageLocationId);
  if (!formName || !saberReadied) return engine.lightsaberForms.NO_FORM_EFFECT;
  const form = (sheet.lightsaberForms ?? []).find((f) => f?.name === formName);
  if (!form?.level) return engine.lightsaberForms.NO_FORM_EFFECT;
  return engine.lightsaberForms.activeFormEffect(form.name, form.level);
}

/**
 * The defense target for Dodge, or for Parry/Block with a chosen implement
 * (unarmed when none).
 * @param {object} actor
 * @param {'dodge'|'parry'|'block'} kind
 * @param {{ weaponItem?: object|null }} [options]
 * @returns {null|{ target: number, available: boolean, reason: string|null, label: string, isOffHand: boolean, caveat: string|null }}
 */
export function defenseTargetFor(actor, kind, { weaponItem = null } = {}) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const adj = stats.defenseAdjustments;
  const form = activeFormEffectFor(actor);
  if (kind === 'dodge') {
    // Dodge is one number on currentEncumbrance (stun and the channel inside), plus the Form's dodge with a saber readied.
    // Ch7's Reeling (below one third of HP) halves Dodge "after its other modifiers, rounding up", and the Form's
    // bonus is the one modifier that lands HERE rather than in the calculator - so it joins the UNHALVED figure the
    // engine publishes for exactly this (stats.reeling.dodgeBeforeReeling) and the SUM is halved, as the website's
    // use-character-form.ts finalDodge does. `currentEncumbrance.dodge + form.dodge` - the figure already halved,
    // the bonus added whole - is the rejected alternative: Dodge 9 with Soresu's +1 would read 6, not 5.
    const target = engine.reeling.reelingDodge(stats.reeling.dodgeBeforeReeling + form.dodge, stats.reeling.active);
    return { target, available: !!adj.dodgeAvailable, reason: adj.dodgeAvailable ? null : fmt('SHADOWBASE.Roll.ArcGate', { arc: adj.arc }), label: loc('SHADOWBASE.Roll.Dodge'), isOffHand: false, caveat: null };
  }
  if (!weaponItem) {
    if (kind === 'block') return { target: 0, available: false, reason: loc('SHADOWBASE.Roll.NoBlockImplement'), label: loc('SHADOWBASE.Roll.NoBlock'), isOffHand: false, caveat: null };
    // The best UNARMED row of the sheet's Defensive Action Matrix (roller-window.tsx:1008-1036); adj.parry is already inside.
    const unarmed = (stats.parryOptions ?? []).filter((o) => o.name === 'Unarmed (DX)' || engine.defenseSkills.isUnarmedParry(o.name));
    const best = unarmed[0];
    const target = best ? best.value : Math.floor(stats.primaryAttributes.effectiveDexterity / 2) + 3 + adj.parry;
    const label = best && best.name !== 'Unarmed (DX)' ? `${loc('SHADOWBASE.Roll.Unarmed')} · ${best.name}` : loc('SHADOWBASE.Roll.Unarmed');
    return { target, available: !!adj.parryAvailable, reason: adj.parryAvailable ? null : fmt('SHADOWBASE.Roll.ArcGate', { arc: adj.arc }), label, isOffHand: false, caveat: best?.note ?? null };
  }
  const info = attackTargetFor(actor, weaponItem);
  if (!info) return null;
  const row = info.row;
  const sheet = sheetOf(actor);
  const weaponName = weaponItem.displayName ?? weaponItem.name;
  const parryBonus = Number(row.finalParryMod) || 0;
  const isShield = ['name', 'baseType', 'customName'].some((k) => lower(row[k]).includes('shield'));
  const skillCanParry = engine.defenseSkills.canParryWith(info.skillName);
  const skillCanBlock = engine.defenseSkills.canBlockWith(info.skillName);
  // Ch4's narrowed Enhanced Parry, per weapon (enhanced-defenses.ts narrowedParryBonus).
  const narrowed = engine.enhancedDefenses.narrowedParryBonus(sheet.advantages ?? [], { skillName: info.skillName, weaponName });
  const turn = actor.system?.turnCounter;
  const uBlocked = info.isMelee && engine.weaponHandling.uParryBlocked(row, stats.primaryAttributes.effectiveStrength, turn);
  const unready = info.isMelee && !!row.isUnready;
  const base = Math.floor(info.target / 2) + 3;
  const isOffHand = isOffHandWeapon(actor, weaponItem);
  if (kind === 'parry') {
    const target = skillCanParry ? base + parryBonus + narrowed + (info.isSaber ? form.parry : 0) + adj.parry : 0;
    const available = skillCanParry && !isShield && !!adj.parryAvailable && !uBlocked && !unready;
    const reason = unready ? loc('SHADOWBASE.Roll.UnreadyGate') : uBlocked ? loc('SHADOWBASE.Roll.UBlocked') : !skillCanParry || isShield ? fmt('SHADOWBASE.Roll.CannotParryWith', { weapon: weaponName }) : !adj.parryAvailable ? fmt('SHADOWBASE.Roll.ArcGate', { arc: adj.arc }) : null;
    return { target, available, reason, label: fmt('SHADOWBASE.Roll.ParryWith', { weapon: weaponName }), isOffHand, caveat: null };
  }
  const target = skillCanBlock ? base + (info.isSaber ? form.block : 0) + adj.block : 0;
  const available = skillCanBlock && !!adj.blockAvailable && !unready;
  const reason = unready ? loc('SHADOWBASE.Roll.UnreadyGate') : !skillCanBlock ? fmt('SHADOWBASE.Roll.CannotBlockWith', { weapon: weaponName }) : !adj.blockAvailable ? fmt('SHADOWBASE.Roll.ArcGate', { arc: adj.arc }) : null;
  return { target, available, reason, label: fmt('SHADOWBASE.Roll.BlockWith', { weapon: weaponName }), isOffHand, caveat: null };
}

/**
 * Roll an active defense. A parry counts toward Ch12's Multiple Parries ladder
 * (parriesThisTurn, roller-window.tsx:1642) and the ladder's advisory is
 * shown - warn only, never blocking (combat-economy.ts).
 * @param {object} actor
 * @param {'dodge'|'parry'|'block'} kind
 * @param {{ weaponItem?: object|null }} [options]
 */
export async function rollDefense(actor, kind, { weaponItem = null } = {}, opts = {}) {
  if (!['dodge', 'parry', 'block'].includes(kind)) throw new Error(`rolls.rollDefense: "${kind}" is not dodge|parry|block`);
  const info = defenseTargetFor(actor, kind, { weaponItem });
  if (!info) return null;
  if (!info.available) { notify('warn', fmt('SHADOWBASE.Roll.DefenseUnavailable', { defense: info.label, reason: info.reason ?? '' })); return null; }
  const advisories = [];
  if (kind === 'parry') {
    const parries = Number(actor.system?.parriesThisTurn) || 0;
    if (parries >= 1) {
      const flag = engine.combatEconomy.combatEconomyFlags({ currentEp: null, maxEp: null, effectiveSt: 0, parriesThisTurn: parries, meleeWeapons: [] }).find((f) => f.id === 'multiple-parries');
      if (flag) { advisories.push(flag); notify('warn', `${flag.label}: ${flag.detail}`); }
    }
  }
  const result = await rollSimple(actor, {
    label: info.label, target: info.target, kind: 'defense',
    flags: { kind: 'defense', defense: kind, itemId: weaponItem?.id ?? null }, extra: { advisories, caveat: info.caveat },
  }, { offHand: info.isOffHand, ...opts });
  if (!result) return null;
  if (kind === 'parry') await actor.update({ 'system.parriesThisTurn': (Number(actor.system?.parriesThisTurn) || 0) + 1 });
  return result;
}

// ---------------------------------------------------------------------------
// Force powers, techniques, crew actions, stun recovery
// ---------------------------------------------------------------------------

/** What a Force power rolls against (roller-window.tsx:937-940): null where the chapter grants no roll. */
export function forcePowerTargetFor(actor, item) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const sheet = sheetOf(actor);
  const row = item.system?.row ?? item;
  return engine.forcePowerTarget(row.baseSkill, sheet.skills, attrsOf(stats));
}

/** The alignment-adjusted FP cost plus the row's EP cost (force-powers-section.tsx:127-128). */
export function forcePowerCostsFor(actor, item) {
  const row = item.system?.row ?? item;
  const alignment = Number(actor.system?.forceAlignment) || 0;
  return { fp: engine.forceFpCost.calculateAdjustedFPCost(row.fpCost, row.alignment, alignment), ep: Number(row.epCost) || 0 };
}

/**
 * Roll a Force power. The card carries the costs and an Apply button; the
 * pools move only through applyForcePowerCosts (ARCHITECTURE.md §5.1).
 */
export async function rollForcePower(actor, item, opts = {}) {
  const best = forcePowerTargetFor(actor, item);
  const row = item.system?.row ?? item;
  const name = row.name ?? item.name;
  if (!best) { notify('warn', fmt('SHADOWBASE.Roll.NoTarget', { label: name })); return null; }
  const costs = forcePowerCostsFor(actor, item);
  return rollSimple(actor, {
    label: name, target: best.level, skillName: best.name, template: TEMPLATES.forcePower,
    flags: { kind: 'force-power', itemId: item.id, costs },
    extra: { itemId: item.id, power: { name, level: row.level, baseSkill: row.baseSkill, alignment: row.alignment, effect: row.effect }, costs, resolution: best.describe },
  }, opts);
}

/** Deduct from the RESOLVED pools (null means full; module/data/actor-character.mjs resources), floored at 0. */
async function deductPools(actor, { fp = 0, ep = 0 }) {
  const res = actor.system?.resources ?? {};
  const updates = {};
  const after = {};
  if (fp > 0) { const cur = Number(res.fp?.value ?? actor.system?.currentForcePoints) || 0; after.fp = Math.max(0, cur - fp); updates['system.currentForcePoints'] = after.fp; }
  if (ep > 0) { const cur = Number(res.ep?.value ?? actor.system?.currentEndurancePoints) || 0; after.ep = Math.max(0, cur - ep); updates['system.currentEndurancePoints'] = after.ep; }
  if (Object.keys(updates).length) await actor.update(updates);
  return after;
}

/** Apply a power's FP/EP costs (force-powers-section.tsx:238-243) and post the costs card. */
export async function applyForcePowerCosts(actor, item, { rollMode } = {}) {
  const row = item.system?.row ?? item;
  const name = row.name ?? item.name;
  const costs = forcePowerCostsFor(actor, item);
  const after = await deductPools(actor, costs);
  const context = { title: fmt('SHADOWBASE.Roll.CostsTitle', { name }), name, costs, after, actorId: actor.id };
  const message = await postCard(actor, TEMPLATES.costs, context, { rollMode, flags: { kind: 'costs', itemId: item.id, costs, after } });
  notify('info', fmt('SHADOWBASE.Roll.CostsApplied', { name, fp: costs.fp, ep: costs.ep }));
  return { costs, after, message };
}

/**
 * A technique's target (combat-techniques-section.tsx:363-380, 536-560): an
 * unarmed technique rolls the best of the skills its base skill names;
 * anything else rolls the selected weapon's attack target. The row's
 * skillBonus/skillPenalty are the roll's modifiers.
 */
export function techniqueTargetFor(actor, item, { weaponItem = null } = {}) {
  const stats = statsOf(actor);
  if (!stats) return null;
  const row = item.system?.row ?? item;
  const sheet = sheetOf(actor);
  if (row.category === 'Unarmed' || !weaponItem) {
    const names = engine.rollTargets.skillNamesIn(row.baseSkill);
    const best = engine.bestSkillTarget(names, sheet.skills, attrsOf(stats));
    if (!best) return { target: null, skillName: null, hitBonus: 0, needsWeapon: row.category !== 'Unarmed', skillBonus: Number(row.skillBonus) || 0, skillPenalty: Number(row.skillPenalty) || 0 };
    return { target: best.level, skillName: best.name, hitBonus: attackHitBonus(stats.modifiers?.toHit, stats.skillBonuses, best.name), needsWeapon: false, skillBonus: Number(row.skillBonus) || 0, skillPenalty: Number(row.skillPenalty) || 0 };
  }
  const info = attackTargetFor(actor, weaponItem);
  return { target: info.target, skillName: info.skillName, hitBonus: info.hitBonus, needsWeapon: false, skillBonus: Number(row.skillBonus) || 0, skillPenalty: Number(row.skillPenalty) || 0, weapon: info };
}

export async function rollTechnique(actor, item, { weaponItem = null } = {}, opts = {}) {
  const row = item.system?.row ?? item;
  const name = row.name ?? item.name;
  const info = techniqueTargetFor(actor, item, { weaponItem });
  if (!info) return null;
  if (info.target == null) { notify('warn', info.needsWeapon ? fmt('SHADOWBASE.Roll.TechniqueNeedsWeapon', { name }) : fmt('SHADOWBASE.Roll.NoTarget', { label: name })); return null; }
  if (weaponItem) {
    const blocked = attackBlockedReason(actor, weaponItem);
    if (blocked) { notify('warn', blocked); return null; }
  }
  const costs = { fp: Number(row.fpCost) || 0, ep: Number(row.epCost) || 0 };
  return rollSimple(actor, {
    label: name, target: info.target, skillName: info.skillName, kind: 'attack', skillBonus: info.hitBonus + info.skillBonus, skillPenalty: info.skillPenalty,
    template: TEMPLATES.forcePower,
    flags: { kind: 'technique', itemId: item.id, weaponItemId: weaponItem?.id ?? null, costs },
    extra: { itemId: item.id, power: { name, level: row.level, baseSkill: row.baseSkill, effect: row.effect, damageBonus: row.damageBonus }, costs, technique: true, weaponItemId: weaponItem?.id ?? null },
  }, { offHand: weaponItem ? isOffHandWeapon(actor, weaponItem) : false, ...opts });
}

/** Apply a technique's FP/EP costs (combat-techniques-section.tsx:98-113). */
export async function applyTechniqueCosts(actor, item, { rollMode } = {}) {
  const row = item.system?.row ?? item;
  const name = row.name ?? item.name;
  const costs = { fp: Number(row.fpCost) || 0, ep: Number(row.epCost) || 0 };
  if (costs.fp <= 0 && costs.ep <= 0) { notify('info', fmt('SHADOWBASE.Roll.NoCosts', { name })); return { costs, after: {}, message: null }; }
  const after = await deductPools(actor, costs);
  const context = { title: fmt('SHADOWBASE.Roll.CostsTitle', { name }), name, costs, after, actorId: actor.id };
  const message = await postCard(actor, TEMPLATES.costs, context, { rollMode, flags: { kind: 'costs', itemId: item.id, costs, after } });
  notify('info', fmt('SHADOWBASE.Roll.CostsApplied', { name, fp: costs.fp, ep: costs.ep }));
  return { costs, after, message };
}

/** Technique damage: the weapon's damage with the technique's damage bonus appended (roll-button.tsx:148-152). */
export async function rollTechniqueDamage(actor, item, { weaponItem }, opts = {}) {
  const row = item.system?.row ?? item;
  if (!weaponItem) { notify('warn', fmt('SHADOWBASE.Roll.TechniqueNeedsWeapon', { name: row.name ?? item.name })); return null; }
  return rollDamage(actor, { item: weaponItem, bonus: row.damageBonus || null, label: `${row.name ?? item.name} (${weaponItem.displayName ?? weaponItem.name})`, modifier: opts.modifier, rollMode: opts.rollMode }, opts);
}

/**
 * The actions of a crew station with their resolved targets (ship-stations.ts
 * SHIP_STATION_ACTIONS through bestSkillTarget; roller-window.tsx:609-683).
 * A skill that prints no default yields target null ("No default").
 * @param {object} actor
 * @param {string} [station] defaults to system.assignedStation
 */
export function crewActionsFor(actor, station = actor.system?.assignedStation) {
  const stats = statsOf(actor);
  if (!stats || !station) return [];
  const sheet = sheetOf(actor);
  const attrs = attrsOf(stats);
  return (engine.shipStations.SHIP_STATION_ACTIONS[station] ?? []).map((action) => {
    if (action.isDamage) return { ...action, station, target: null, best: null };
    const best = engine.bestSkillTarget(action.skills, sheet.skills, attrs);
    return { ...action, station, best, target: best ? best.level + (action.modifier || 0) : null };
  });
}

/**
 * @param {object} actor
 * @param {{ station?: string, action: string, weaponName?: string }} spec the action's label; a damage action needs a weapon system name (starshipWeapons library)
 */
export async function rollCrewAction(actor, { station = actor.system?.assignedStation, action, weaponName } = {}, opts = {}) {
  const entry = crewActionsFor(actor, station).find((a) => a.label === action);
  if (!entry) { notify('warn', fmt('SHADOWBASE.Roll.NoTarget', { label: action ?? '' })); return null; }
  if (entry.isDamage) {
    const weapon = engine.starshipWeapons.STARSHIP_WEAPONS_LIBRARY.find((w) => w.name === weaponName && w.name !== 'None');
    if (!weapon) { notify('warn', loc('SHADOWBASE.Roll.CrewNoWeapon')); return null; }
    return rollDamage(actor, { label: `${weapon.name}`, formula: `${weapon.damage} ${weapon.damageType}`.trim(), modifier: opts.modifier, rollMode: opts.rollMode }, opts);
  }
  if (entry.target == null) { notify('warn', fmt('SHADOWBASE.Roll.CrewNoDefault', { action: entry.label, skills: entry.skills.join(' / ') })); return null; }
  const modString = entry.modifier ? ` (${signed(entry.modifier)})` : '';
  return rollSimple(actor, { label: `${entry.label}${modString}`, target: entry.target, skillName: entry.best.name, flags: { kind: 'crew-action', station, action: entry.label }, extra: { resolution: entry.best.describe } }, opts);
}

/**
 * The stun recovery roll (Ch9: HT for a physical stun, IQ for a mental one -
 * stun-rules.ts stunRecoveryAttribute) plus the declared stunRecovery channel.
 * A deliberate, documented departure: the website declares the channel and
 * has no button (ARCHITECTURE.md §5.1). Success clears stunType (the token
 * mirror follows through module/effects.mjs).
 */
export async function rollStunRecovery(actor, opts = {}) {
  const attribute = engine.stunRules.stunRecoveryAttribute(actor.system?.stunType);
  if (!attribute) { notify('info', fmt('SHADOWBASE.Roll.NotStunned', { name: actor.name })); return null; }
  const stats = statsOf(actor);
  if (!stats) return null;
  const attrs = attrsOf(stats);
  const target = attribute === 'HT' ? attrs.ht : attrs.iq;
  const bonus = Number(stats.modifiers?.stunRecovery) || 0;
  const result = await rollSimple(actor, { label: fmt('SHADOWBASE.Roll.StunRecovery', { attribute }), target, skillBonus: bonus, flags: { kind: 'stun-recovery', attribute } }, opts);
  if (!result) return null;
  if (result.outcome.success) {
    await actor.update({ 'system.stunType': 'None' });
    notify('info', fmt('SHADOWBASE.Roll.Recovered', { name: actor.name }));
  } else notify('warn', fmt('SHADOWBASE.Roll.StillStunned', { name: actor.name }));
  return result;
}

// ---------------------------------------------------------------------------
// Notices and the chat hook
// ---------------------------------------------------------------------------

/**
 * An advisory card (sweep results, expiries, combat-economy flags).
 * @param {object} actor
 * @param {{ title: string, lines?: string[], flags?: {label:string, detail:string}[], kind?: string, rollMode?: string }} spec
 */
export async function postNotice(actor, { title, lines = [], flags = [], kind = 'notice', rollMode } = {}) {
  const context = { title, lines, economy: flags, actorId: actor?.id ?? null };
  return postCard(actor, TEMPLATES.notice, context, { rollMode, flags: { kind, title, lines, economy: flags } });
}

/** The actor a chat message speaks for (token first, then the world actor). */
function actorOfMessage(message) {
  const speaker = message?.speaker ?? {};
  const CM = globalThis.ChatMessage;
  if (typeof CM?.getSpeakerActor === 'function') { const a = CM.getSpeakerActor(speaker); if (a) return a; }
  const id = message?.flags?.[SYSTEM_ID]?.actorId ?? speaker.actor;
  return id ? (globalThis.game?.actors?.get?.(id) ?? null) : null;
}

/**
 * Card buttons (data-action on templates/chat/*.hbs): roll-damage after a hit,
 * apply-costs on a power/technique card. Registered on renderChatMessageHTML
 * (v13: the html argument is an HTMLElement).
 */
export async function onCardAction(message, event) {
  const button = event.currentTarget ?? event.target;
  const action = button?.dataset?.action;
  const actor = actorOfMessage(message);
  if (!actor) return null;
  const flags = message.flags?.[SYSTEM_ID] ?? {};
  const item = flags.itemId ? actor.items.get(flags.itemId) : null;
  switch (action) {
    case 'roll-damage': return item ? rollDamage(actor, { item }) : null;
    case 'apply-costs': return item ? (flags.kind === 'technique' ? applyTechniqueCosts(actor, item) : applyForcePowerCosts(actor, item)) : null;
    case 'roll-technique-damage': {
      const weapon = flags.weaponItemId ? actor.items.get(flags.weaponItemId) : null;
      return item ? rollTechniqueDamage(actor, item, { weaponItem: weapon }) : null;
    }
    default: return null;
  }
}

/** Register the chat card hook (module/shadowbase.mjs calls it at init). */
export function registerChatHooks() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const root = html?.querySelector ? html : null;
    if (!root) return;
    const card = root.querySelector('.sb-chat-card');
    if (!card) return;
    for (const btn of card.querySelectorAll('[data-action]')) {
      btn.addEventListener('click', (event) => { event.preventDefault(); onCardAction(message, event); });
    }
  });
}

export const rolls = Object.freeze({
  TEMPLATES, ROLL_HISTORY_DEFAULT_DEPTH, rollHistoryDepth, rollHistory, clearRollHistory, defaultRollMode, diceOf,
  offHandPenalty, stackModifiers, attackHitBonus, toFoundryFormula, resolveOutcome, outcomeLines, rollTarget,
  ATTRIBUTE_KEYS, CHARACTERISTIC_KEYS, attributeTarget, characteristicTarget, skillTargetFor,
  rollAttribute, rollCharacteristic, rollSkill, rollCustom,
  equippedWeapons, isOffHandWeapon, malfunctionThresholdFor, attackTargetFor, attackBlockedReason, shotsFor, applyAttackSideEffects,
  firesExplosivePayload, rollAttack, rollVolley, damageFormulaFor, damageHalvingsFor, withDamageBonus, rollDamage, rollDamageVolley,
  unarmedTargetFor, rollUnarmed, rollUnarmedDamage,
  activeFormEffectFor, defenseTargetFor, rollDefense,
  forcePowerTargetFor, forcePowerCostsFor, rollForcePower, applyForcePowerCosts,
  techniqueTargetFor, rollTechnique, applyTechniqueCosts, rollTechniqueDamage,
  crewActionsFor, rollCrewAction, rollStunRecovery,
  postNotice, onCardAction, registerChatHooks,
});

export default rolls;
