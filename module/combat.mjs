// module/combat.mjs
//
// The combat tracker side of table play (docs/ARCHITECTURE.md §5.2).
//
// Initiative is never rolled. Ch7, Turn Order: "Combat order is strictly
// determined by your Basic Speed ... you do not re-roll initiative" - the
// website's HUD shows currentValues.basicSpeed with the DX tie-break
// (roller-window.tsx:1566-1589), and module/data/actor-character.mjs
// publishes exactly that as `system.initiative` (Basic Speed + DX/100). The
// tracker's formula is `@initiative` with two decimals, so "rolling" it only
// evaluates the figure.
//
// The Global Turn Counter follows the tracker's round (ASSUMPTION Q5 d): when
// `round` changes, every combatant character whose
// flags.shadowbase.autoTurnCounter is not false gets `system.turnCounter =
// round` and then the per-turn sweep the website runs when the counter moves
// (resource-trackers.tsx:294-321, moved onto ShadowBaseActor#sweepTurn by unit
// U02: facingChangeUsed false, parriesThisTurn 0, expired effects removed).
// Only the active GM's client acts, so two connected clients do not both
// sweep (the review's m7).
//
// Combat-economy flags are ADVISORY (combat-economy.ts, 2026-08-28 ruling:
// warn, don't block): the HUD shows them as amber chips; here they ride the
// sweep's chat notice. A world setting `enforceEconomy` is reserved for unit
// U10 and is off by default.

import { engine } from './engine.mjs';
import { rowsOf, rowWithDerived } from './adapter.mjs';
import { postNotice } from './rolls.mjs';

export const SYSTEM_ID = 'shadowbase';
export const INITIATIVE_FORMULA = '@initiative';
export const INITIATIVE_DECIMALS = 2;

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;

// v13 client document classes (foundry.documents.<Name>, the bare global as the deprecated alias - the same
// resolution module/documents/actor.mjs uses); tools/foundry-shim.mjs declares both.
const BaseCombat = foundry.documents.Combat ?? globalThis.Combat;
const BaseCombatant = foundry.documents.Combatant ?? globalThis.Combatant;

export class ShadowBaseCombat extends BaseCombat {}

export class ShadowBaseCombatant extends BaseCombatant {
  /** Basic Speed with the DX tie-break, from the actor's roll data; never a die. */
  _getInitiativeFormula() {
    return globalThis.CONFIG?.Combat?.initiative?.formula || INITIATIVE_FORMULA;
  }
}

/** Register the initiative formula and the document classes (init hook). */
export function registerCombat() {
  CONFIG.Combat.initiative = { formula: INITIATIVE_FORMULA, decimals: INITIATIVE_DECIMALS };
  CONFIG.Combat.documentClass = ShadowBaseCombat;
  if (!('Combatant' in CONFIG)) CONFIG.Combatant = {};
  CONFIG.Combatant.documentClass = ShadowBaseCombatant;
  return CONFIG.Combat.initiative;
}

/**
 * True only on the ACTIVE GM's client (ARCHITECTURE.md §5.2): every connected
 * client receives updateCombat, and the tracker's writes (turnCounter, the
 * sweep) must happen exactly once - a player's client would get permission
 * errors on actors it does not own, and a second GM would sweep twice. With
 * no GM connected nobody acts; the counter waits for one (Foundry's own
 * "no active GM" behaviour for tracker automation).
 */
export function isActingClient() {
  const game = globalThis.game;
  const gm = game?.users?.activeGM ?? null;
  return !!gm && gm === game.user;
}

/** Whether the tracker drives this actor's counter (flags.shadowbase.autoTurnCounter !== false). */
export function followsCombat(actor) {
  const flag = actor?.getFlag?.(SYSTEM_ID, 'autoTurnCounter') ?? actor?.flags?.[SYSTEM_ID]?.autoTurnCounter;
  return flag !== false;
}

/**
 * The EP-economy advisories for the actor's CURRENT state (combat-economy.ts
 * combatEconomyFlags), built the way the HUD builds its input
 * (roller-window.tsx:979-991): the raw EP field (null means full) over the
 * derived maximum, the effective ST, the parry tally, and the readied melee
 * rows' Min ST and ◊ state.
 */
export function economyFlags(actor) {
  const stats = actor.stats ?? actor.system?.derived;
  if (!stats) return [];
  const melee = rowsOf(actor, 'customMeleeWeapons').map(rowWithDerived).filter((w) => w.equipped && !w.storageLocationId);
  return engine.combatEconomy.combatEconomyFlags({
    currentEp: actor.system?.currentEndurancePoints ?? stats.currentValues.endurancePoints,
    maxEp: stats.currentValues.endurancePoints,
    effectiveSt: stats.primaryAttributes.effectiveStrength,
    parriesThisTurn: actor.system?.parriesThisTurn,
    meleeWeapons: melee.map((w) => ({ label: w.customName || w.name, minSt: w.finalStRequirement, isUnready: w.isUnready })),
  });
}

/**
 * Move an actor's Global Turn Counter to `turn` and run the sweep
 * (ShadowBaseActor#sweepTurn). Posts a notice when something expired or an
 * economy flag applies.
 * @param {object} actor
 * @param {number} turn
 * @param {{ post?: boolean }} [options]
 * @returns {Promise<{ turn: number, expired: string[], flags: object[] }>}
 */
export async function setTurn(actor, turn, { post = true } = {}) {
  const next = Number(turn) || 0;
  await actor.update({ 'system.turnCounter': next });
  const expired = (await actor.sweepTurn(next)) ?? [];
  const flags = economyFlags(actor);
  if (post && (expired.length || flags.length)) {
    const lines = expired.length ? [fmt('SHADOWBASE.Combat.Expired', { names: expired.join(', ') })] : [];
    await postNotice(actor, { title: fmt('SHADOWBASE.Combat.SweepTitle', { turn: next }), lines, flags, kind: 'sweep' });
  }
  return { turn: next, expired, flags };
}

/** The HUD's ± buttons: move the counter by `delta` (default +1). */
export async function advanceTurn(actor, delta = 1, options) {
  return setTurn(actor, (Number(actor.system?.turnCounter) || 0) + (Number(delta) || 0), options);
}

/** The HUD's "Sweep now": re-run the sweep at the current counter. */
export async function sweepNow(actor, options) {
  return setTurn(actor, Number(actor.system?.turnCounter) || 0, options);
}

/** Post the actor's current economy advisories as a chat notice (nothing when none apply). */
export async function postEconomyNotice(actor, options = {}) {
  const flags = economyFlags(actor);
  if (!flags.length) return null;
  return postNotice(actor, { title: loc('SHADOWBASE.Combat.EconomyTitle'), lines: [], flags, kind: 'economy', ...options });
}

/** The combatant actors the tracker drives (characters following the tracker). */
export function trackedActors(combat) {
  const out = [];
  const seen = new Set();
  for (const combatant of combat?.combatants ?? []) {
    const actor = combatant?.actor;
    if (!actor || actor.type !== 'character' || seen.has(actor)) continue;
    seen.add(actor);
    if (followsCombat(actor)) out.push(actor);
  }
  return out;
}

/**
 * updateCombat: when the round changes (advancing or rewinding), every tracked
 * combatant's counter follows and sweeps - on the active GM's client only
 * (isActingClient; the hook fires on every client).
 * @param {object} combat
 * @param {object} changed the update diff
 */
export async function onUpdateCombat(combat, changed) {
  if (!changed || changed.round === undefined || changed.round === null) return [];
  if (!isActingClient()) return [];
  const results = [];
  for (const actor of trackedActors(combat)) results.push(await setTurn(actor, combat.round ?? changed.round));
  return results;
}

/** Register the tracker hook (init). */
export function registerCombatHooks() {
  Hooks.on('updateCombat', (combat, changed) => { onUpdateCombat(combat, changed); });
}

export const combat = Object.freeze({
  INITIATIVE_FORMULA, INITIATIVE_DECIMALS, ShadowBaseCombat, ShadowBaseCombatant,
  registerCombat, registerCombatHooks, isActingClient, followsCombat, economyFlags,
  setTurn, advanceTurn, sweepNow, postEconomyNotice, trackedActors, onUpdateCombat,
});

export default combat;
