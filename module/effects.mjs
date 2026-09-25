// module/effects.mjs
//
// The operations on status effects (docs/ARCHITECTURE.md §4.4): add, dismiss,
// advance a phase, recover EP, sweep the expired, keep `stunType` and the
// token's stun statuses in step. Each is the website's own handler moved off
// React and onto Foundry documents:
//
//   addManualEffect   StatusEffectsHub#handleAddManualEffect   (roller-window.tsx)
//   dismissEffect     StatusEffectsHub#handleDismissEffect + DERIVED_DISMISSALS
//   advancePhase      StatusEffectsHub#handleAdvancePhase      (stimulant-crash.ts applyCrashPhase)
//   recoverEp         StatusEffectsHub#handleRecoverEP
//   sweepExpired      ResourceTrackers' turn-counter effect     (resource-trackers.tsx, `kept = ...`)
//
// Two facts shape everything here:
//
//   1. A stored website row IS the effect. It lives whole under
//      flags.shadowbase.statusEffect (module/adapter.mjs statusEffectToEffectData),
//      `changes` is ALWAYS empty (the engine sums every bag when it reads the
//      sheet; a Foundry change would land the bonus twice - check:effects shows
//      the doubled figure), and the engine's derived cards (Stunned, Encumbered,
//      Critical Power ...) are never stored: they are re-derived from state on
//      every prepare, so "dismissing" one clears the state that produces it.
//
//   2. Stun is STATE (`system.stunType`), not a stored effect. The engine
//      derives the Stunned card and its -4 from stunType (use-character-
//      calculations.ts, "Ch9"); what Foundry adds is the token icon. That icon
//      is a MIRROR ActiveEffect carrying the `stunned-physical` /
//      `stunned-mental` status and NO statusEffect row - so the adapter leaves
//      it out of the sheet and the engine still derives exactly one Stunned
//      card. Toggling the status from the token HUD writes stunType; writing
//      stunType (sheet, recovery roll) creates or removes the mirror. The
//      rejected shape - storing the stun as a status-effect row - would have
//      put two Stunned cards in activeStatusEffects (check:effects pins one).
//
// Row DATA written here (the crash card's name, source, description, the
// 'Manual / DM' source) mirrors the website's literals byte for byte, because
// it is exported in the character JSON and read back by the website; only the
// notifications go through lang/en.json.
//
// Every operation takes the ACTOR and an effect id that is the ROW's id (the
// website keys everything by it; the HUD's derived "stunned" id is accepted by
// dismissEffect) and falls back to the ActiveEffect's own _id.

import { engine } from './engine.mjs';
import { STATUS_EFFECTS, statusIdForRow, statusImg } from './config.mjs';
import { statusEffectToEffectData, effectToStatusEffect, isStatusEffect } from './adapter.mjs';

/** stunType -> CONFIG status id (ARCHITECTURE.md §4.4: toggling either writes stunType). */
export const STUN_STATUS_BY_TYPE = Object.freeze({ Physical: 'stunned-physical', Mental: 'stunned-mental' });
/** CONFIG status id -> stunType. */
export const STUN_TYPE_BY_STATUS = Object.freeze({ 'stunned-physical': 'Physical', 'stunned-mental': 'Mental' });
const STUN_STATUS_IDS = Object.freeze(Object.keys(STUN_TYPE_BY_STATUS));

/** The engine's derived id the HUD dismisses through state rather than through a row. */
export const DERIVED_STUN_ID = 'stunned';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };

// ---------------------------------------------------------------------------
// Row helpers (pure)
// ---------------------------------------------------------------------------

/**
 * The website's turn-sweep predicate, verbatim from resource-trackers.tsx:
 * `kept = effects.filter((e) => e?.expiresAfterTurn == null || turn <= Number(e.expiresAfterTurn))`.
 * An effect is expired exactly when it is NOT kept - written as that literal's
 * complement so the two cannot drift: absent/null never expires by turn; a
 * numeric stamp expires once the counter has passed it; a stamp that is not a
 * number (`turn <= NaN` is false) is dropped on the next move, as the website
 * drops it (statusEffectSchema says int, so only a corrupt row gets here).
 * @param {{ expiresAfterTurn?: number|string|null }|null|undefined} row
 * @param {number} turn the Global Turn Counter after the move
 */
export function isExpiredAt(row, turn) {
  const stamp = row?.expiresAfterTurn;
  const kept = stamp == null || Number(turn) <= Number(stamp);
  return !kept;
}

/** The website row an effect carries (id guaranteed), or null for a foreign effect / a stun mirror. */
export function statusEffectRow(effect) {
  return effectToStatusEffect(effect);
}

/** True when the effect carries this status id (v13 SetField, or a plain array in creation data). */
export function hasStatus(effect, statusId) {
  const s = effect?.statuses;
  if (!s) return false;
  if (typeof s.has === 'function') return s.has(statusId);
  return Array.isArray(s) && s.includes(statusId);
}

/** The stun status the effect carries, or null. */
export function stunStatusOf(effect) {
  return STUN_STATUS_IDS.find((id) => hasStatus(effect, id)) ?? null;
}

/** A stun MIRROR: the token icon for stunType, carrying a stun status and no row. */
export function isStunMirror(effect) {
  return !isStatusEffect(effect) && stunStatusOf(effect) !== null;
}

/** The non-stun CONFIG status id a foreign effect carries (a token-HUD toggle), or null. */
export function configStatusOf(effect) {
  return STATUS_EFFECTS.map((s) => s.id).find((id) => !STUN_TYPE_BY_STATUS[id] && hasStatus(effect, id)) ?? null;
}

/** Stored status-effect ActiveEffects on an actor (the rows the engine reads). */
export function storedEffects(actor) {
  return actor?.effects?.filter ? actor.effects.filter(isStatusEffect) : [];
}

/**
 * The effect for an id: the ROW id first (what the website and the HUD use),
 * then the ActiveEffect's own _id.
 */
export function findEffect(actor, effectId) {
  if (!actor?.effects || effectId === null || effectId === undefined) return null;
  const byRow = actor.effects.find((e) => e.flags?.shadowbase?.statusEffect?.id === effectId);
  return byRow ?? actor.effects.get?.(effectId) ?? actor.effects.find((e) => e.id === effectId) ?? null;
}

/**
 * The engine's active cards that are NOT stored rows - derived conditions
 * (Stunned, Encumbered, Critical Power, gear and trait cards). Display only
 * (HUD Status tab, sheet Combat State); never persisted (§4.4).
 */
export function derivedEffects(actor) {
  const stats = actor?.system?.derived;
  if (!stats?.activeStatusEffects) return [];
  const stored = new Set(storedEffects(actor).map((e) => e.flags.shadowbase.statusEffect.id));
  return stats.activeStatusEffects.filter((e) => !stored.has(e.id));
}

/** The engine's current EP pool for the actor, null-means-full resolved (module/data/actor-character.mjs resources). */
function currentEp(actor) {
  const pool = actor?.system?.resources?.ep?.value;
  if (typeof pool === 'number' && Number.isFinite(pool)) return pool;
  return Number(actor?.system?.currentEndurancePoints) || 0;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Store a website row as an ActiveEffect (the generic producer: the damage
 * processor's Shock, an armor's activated buff, a stimulant with phases all
 * arrive here with their own ids, sources and stamps). The bag is completed
 * with NO_MODIFIERS and an id is minted when absent (adapter).
 * @param {object} actor
 * @param {object} row a statusEffectSchema row
 * @returns {Promise<object>} the created ActiveEffect
 */
export async function addEffect(actor, row) {
  const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [statusEffectToEffectData(row)]);
  return effect;
}

/**
 * The HUD's "Add Effect" dialog (roller-window.tsx handleAddManualEffect):
 * name, type, description, duration and a bag from the player; source is the
 * website's fixed 'Manual / DM'; isManual so the engine counts its DR as
 * innate (use-character-calculations.ts innateDrBonus reads isManual).
 * @param {object} actor
 * @param {{ name?: string, type?: 'buff'|'debuff', description?: string, duration?: string, modifiers?: object, expiresAfterTurn?: number|null }} [data]
 */
export async function addManualEffect(actor, data = {}) {
  const row = {
    id: engine.rowId(),
    name: (typeof data.name === 'string' && data.name.trim()) || 'New Effect',
    type: data.type === 'debuff' ? 'debuff' : 'buff',
    source: 'Manual / DM',
    description: data.description ?? '',
    isManual: true,
    isGear: false,
    duration: data.duration ?? '',
    modifiers: { ...engine.NO_MODIFIERS, ...(data.modifiers ?? {}) },
  };
  if (data.expiresAfterTurn !== undefined && data.expiresAfterTurn !== null) row.expiresAfterTurn = Number(data.expiresAfterTurn);
  return addEffect(actor, row);
}

/**
 * Dismiss an effect (roller-window.tsx handleDismissEffect).
 *
 * - The derived "stunned" card is state: dismissing it writes stunType 'None'
 *   (DERIVED_DISMISSALS), and the stun mirror follows through syncStun.
 * - A stored stimulant WITHOUT phases is an older save whose crash never
 *   became a phase: Ch10's "Crash: Lose N EP" is applied as an EVENT against
 *   the current pool (stimulant-crash.ts) and an informational crash card is
 *   appended - a modifier there would shrink the maximum, the no-op the
 *   website replaced.
 * - Everything else is simply removed. Gear-locked rows (isGear) are not
 *   dismissable on the website (the button is hidden); the same rule here.
 * @returns {Promise<{ dismissed: string, crashEp?: number }|null>}
 */
export async function dismissEffect(actor, effectId) {
  if (effectId === DERIVED_STUN_ID) {
    await actor.update({ 'system.stunType': 'None' });
    notify('info', loc('SHADOWBASE.Effect.Recovered'));
    return { dismissed: DERIVED_STUN_ID };
  }
  const effect = findEffect(actor, effectId);
  if (!effect) return null;
  const row = statusEffectRow(effect) ?? { name: effect.name };
  if (row.isGear) return null;
  const hasPhases = (row.phases?.length ?? 0) > 0;
  const legacyCrashEP = hasPhases ? 0 : engine.stimulantCrash.parseCrashEP(row.description);
  let crashEp;
  if (legacyCrashEP > 0) {
    const applied = engine.stimulantCrash.applyCrashPhase({ phaseModifiers: { endurancePoints: -legacyCrashEP }, currentEP: currentEp(actor) });
    await actor.update({ 'system.currentEndurancePoints': applied.currentEP });
    await addEffect(actor, {
      id: engine.rowId(),
      name: `${row.name} Crash`,
      type: 'debuff',
      source: 'Metabolism (Crash)',
      description: `Recovery period after using ${row.name}. Lost ${legacyCrashEP} EP. Recover 1 EP per 10 minutes of rest.`,
      isManual: true,
      isGear: false,
      duration: 'Recovery Period',
      modifiers: { ...engine.NO_MODIFIERS },
    });
    crashEp = legacyCrashEP;
    notify('warn', fmt('SHADOWBASE.Effect.CrashDismissed', { ep: legacyCrashEP }));
  }
  await actor.deleteEmbeddedDocuments('ActiveEffect', [effect.id]);
  return crashEp === undefined ? { dismissed: row.id ?? effect.id } : { dismissed: row.id ?? effect.id, crashEp };
}

/**
 * Move a multi-phase effect to its next stage IN PLACE (roller-window.tsx
 * handleAdvancePhase). The phase's stored `endurancePoints` figure is DATA:
 * `engine.stimulantCrash.applyCrashPhase` converts it into a deduction from
 * the CURRENT pool and hands back the phase bag with that channel zeroed, so
 * the loss can never also land on the maximum. The row is then rewritten from
 * the phase (name, type, description, duration, bag) and phaseIndex advances.
 * @returns {Promise<{ effect: object, phase: object, currentEP: number }|null>}
 */
export async function advancePhase(actor, effectId) {
  const effect = findEffect(actor, effectId);
  const row = effect ? statusEffectRow(effect) : null;
  if (!row) return null;
  const phases = Array.isArray(row.phases) ? row.phases : [];
  const index = row.phaseIndex ?? 0;
  const next = phases[index];
  if (!next) return null;
  const before = currentEp(actor);
  const applied = engine.stimulantCrash.applyCrashPhase({ phaseModifiers: next.modifiers ?? {}, currentEP: before });
  if (applied.currentEP !== before) await actor.update({ 'system.currentEndurancePoints': applied.currentEP });
  const updated = {
    ...row,
    name: next.name,
    type: next.type ?? 'debuff',
    description: next.description ?? row.description,
    duration: next.duration ?? null,
    phaseIndex: index + 1,
    modifiers: { ...engine.NO_MODIFIERS, ...applied.effectModifiers },
  };
  const statusId = statusIdForRow(updated);
  await effect.update({
    name: updated.name,
    img: statusImg(statusId ?? (updated.type === 'buff' ? 'buff' : 'debuff')),
    description: updated.description ?? '',
    statuses: statusId ? [statusId] : [],
    'flags.shadowbase.statusEffect': updated,
  });
  notify(updated.type === 'debuff' ? 'warn' : 'info', `${next.name}: ${next.description || fmt('SHADOWBASE.Effect.NextPhase', { name: row.name })}`);
  return { effect, phase: next, currentEP: applied.currentEP };
}

/**
 * "Recover 1 EP" on an effect whose bag carries a negative EP channel
 * (roller-window.tsx handleRecoverEP): the penalty moves one step toward 0;
 * at 0 the effect ends. A row with no negative channel is left alone.
 * @returns {Promise<{ ended: boolean, endurancePoints: number }|null>}
 */
export async function recoverEp(actor, effectId) {
  const effect = findEffect(actor, effectId);
  const row = effect ? statusEffectRow(effect) : null;
  if (!row?.modifiers) return null;
  const penalty = Number(row.modifiers.endurancePoints) || 0;
  if (!(penalty < 0)) return null;
  const next = penalty + 1;
  if (next >= 0) {
    await actor.deleteEmbeddedDocuments('ActiveEffect', [effect.id]);
    notify('info', fmt('SHADOWBASE.Effect.FullyRecovered', { name: row.name }));
    return { ended: true, endurancePoints: 0 };
  }
  await effect.update({ 'flags.shadowbase.statusEffect.modifiers.endurancePoints': next });
  notify('info', fmt('SHADOWBASE.Effect.PartialRecovery', { ep: Math.abs(next) }));
  return { ended: false, endurancePoints: next };
}

/**
 * The turn sweep (ARCHITECTURE.md §5.2; resource-trackers.tsx): every stored
 * effect whose `expiresAfterTurn` the counter has passed is removed. Moving
 * the counter backwards never revives anything - a removed row is gone.
 * Stun mirrors and foreign effects are not rows and are never swept.
 * @param {object} actor
 * @param {number} turn the counter's new value
 * @returns {Promise<string[]>} names of the effects removed
 */
export async function sweepExpired(actor, turn) {
  const expired = storedEffects(actor).filter((e) => isExpiredAt(e.flags.shadowbase.statusEffect, turn));
  if (!expired.length) return [];
  await actor.deleteEmbeddedDocuments('ActiveEffect', expired.map((e) => e.id));
  const names = expired.map((e) => e.name);
  notify('info', fmt('SHADOWBASE.Effect.Expired', { names: names.join(', ') }));
  return names;
}

// ---------------------------------------------------------------------------
// Stun <-> status sync
// ---------------------------------------------------------------------------

/** Creation data for the stun mirror of a stunType (null for 'None'). */
export function stunMirrorData(stunType) {
  const statusId = STUN_STATUS_BY_TYPE[stunType];
  if (!statusId) return null;
  const cfg = STATUS_EFFECTS.find((s) => s.id === statusId);
  return {
    name: loc(cfg.name),
    img: cfg.img,
    disabled: false,
    transfer: false,
    changes: [],
    duration: {},
    statuses: [statusId],
    flags: { shadowbase: { stunMirror: true } },
  };
}

/** The stunType the actor's stun mirrors say, or 'None' when there is none. */
export function stunTypeFromEffects(actor) {
  const mirror = (actor?.effects?.find ? actor.effects.find(isStunMirror) : null);
  return mirror ? STUN_TYPE_BY_STATUS[stunStatusOf(mirror)] : 'None';
}

/**
 * stunType -> token: make the actor's stun mirrors match `system.stunType`
 * (exactly one mirror for Physical/Mental, none for 'None'). Idempotent, so
 * the hooks can call it on every stunType change without a re-entrancy guard:
 * the deleteActiveEffect hook sees a mirror whose status no longer matches
 * stunType and does nothing; the createActiveEffect hook sees stunType already
 * equal to the new mirror's type and does nothing.
 * @returns {Promise<{ created: number, removed: number }>}
 */
export async function syncStun(actor) {
  const want = STUN_STATUS_BY_TYPE[actor.system?.stunType] ?? null;
  const mirrors = actor.effects.filter(isStunMirror);
  const stale = mirrors.filter((e) => stunStatusOf(e) !== want);
  const kept = mirrors.length - stale.length;
  let created = 0;
  // Create before deleting, so the token never passes through a moment with no stun icon while stunned.
  if (want && kept === 0) {
    await actor.createEmbeddedDocuments('ActiveEffect', [stunMirrorData(actor.system.stunType)]);
    created = 1;
  }
  if (stale.length) await actor.deleteEmbeddedDocuments('ActiveEffect', stale.map((e) => e.id));
  return { created, removed: stale.length };
}

/**
 * token -> stunType: write the stunType the mirrors imply (a token-HUD toggle
 * created or removed one). No-op when they already agree.
 */
export async function syncStunFromEffects(actor) {
  const implied = stunTypeFromEffects(actor);
  if ((actor.system?.stunType ?? 'None') === implied) return false;
  await actor.update({ 'system.stunType': implied });
  return true;
}

/**
 * Set or clear a CONFIG status on an actor from the sheet/HUD (not the token
 * HUD, which goes through Foundry's own toggle and the hooks below). Stun
 * statuses write stunType; any other status adds a manual stored effect with
 * that name and no bag, or removes the stored effects carrying it (§4.4).
 * @param {object} actor
 * @param {string} statusId
 * @param {{ active?: boolean }} [options] omit to toggle
 */
export async function toggleStatus(actor, statusId, { active } = {}) {
  const stunType = STUN_TYPE_BY_STATUS[statusId];
  if (stunType) {
    const on = active ?? actor.system.stunType !== stunType;
    await actor.update({ 'system.stunType': on ? stunType : 'None' });
    return on;
  }
  const cfg = STATUS_EFFECTS.find((s) => s.id === statusId);
  if (!cfg) throw new Error(`effects: "${statusId}" is not a CONFIG.SHADOWBASE status id`);
  const carrying = storedEffects(actor).filter((e) => hasStatus(e, statusId));
  const on = active ?? carrying.length === 0;
  if (on) {
    if (carrying.length) return true;
    await addEffect(actor, tokenToggleRow(cfg, loc(cfg.name)));
    return true;
  }
  if (carrying.length) await actor.deleteEmbeddedDocuments('ActiveEffect', carrying.map((e) => e.id));
  return false;
}

/** Statuses that read as a benefit when toggled by hand; everything else is a debuff. */
const BUFF_STATUS_IDS = new Set(['stimulated', 'pain-suppressed', 'form-active', 'shield-active', 'buff']);

/** The manual row a token-HUD toggle of a non-stun status becomes (§4.4: "that name and no bag"). */
function tokenToggleRow(cfg, name) {
  return {
    id: engine.rowId(),
    name,
    type: BUFF_STATUS_IDS.has(cfg.id) ? 'buff' : 'debuff',
    source: 'Token HUD',
    // The engine lists a row only when it has a bag, a description or a duration
    // (use-character-calculations.ts activeStatusEffects filter); a bare toggle
    // gets its status name as the description so the HUD's Status tab shows it.
    description: name,
    isManual: true,
    isGear: false,
    duration: '',
    phaseIndex: 0,
    modifiers: { ...engine.NO_MODIFIERS },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * CONFIG.statusEffects (v13 array) from module/config.mjs. `match` is our own
 * row->status rule and stays on CONFIG.SHADOWBASE; Foundry sees id, name (an
 * i18n key it localizes itself), img (a core icons/svg path) and hud.
 */
export function registerStatusEffects() {
  CONFIG.statusEffects = STATUS_EFFECTS.map(({ id, name, img, hud }) => ({ id, name, img, hud }));
  return CONFIG.statusEffects;
}

/**
 * The hooks that keep stunType and the token in step and adopt token-HUD
 * toggles (ARCHITECTURE.md §4.4). Only the client that made the change acts
 * (userId === game.userId), so two connected clients do not both create a
 * mirror.
 *
 * Why `updateActor` and not `preUpdateActor` for the stunType direction: the
 * mirror is an embedded document, and creating or deleting one from inside a
 * pre-hook of its parent's update (before that update is committed) is not a
 * documented v13 pattern; the post-update hook sees the committed stunType and
 * the embedded operation is an ordinary one.
 */
export function registerEffectHooks() {
  const isOurs = (actor) => actor?.documentName === 'Actor' && actor.type === 'character';
  const mine = (userId) => userId === globalThis.game?.userId;

  Hooks.on('updateActor', (actor, changes, options, userId) => {
    if (!isOurs(actor) || !mine(userId)) return;
    if (changes?.system?.stunType === undefined) return;
    syncStun(actor);
  });

  Hooks.on('createActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (!isOurs(actor) || !mine(userId) || isStatusEffect(effect)) return;
    const stun = stunStatusOf(effect);
    if (stun) {
      // A token-HUD stun toggle: stunType follows THIS effect's status. (Our own
      // mirror arrives here too, already equal to stunType - a no-op. Reading the
      // remaining mirrors instead would, mid Physical -> Mental swap, still find
      // the retiring physical one and write stunType back to Physical.)
      const want = STUN_TYPE_BY_STATUS[stun];
      if (actor.system?.stunType !== want) actor.update({ 'system.stunType': want });
      return;
    }
    const statusId = configStatusOf(effect);
    if (!statusId) return; // a module's or a core condition: not ours to adopt
    const cfg = STATUS_EFFECTS.find((s) => s.id === statusId);
    // A token-HUD toggle of one of our statuses becomes a manual stored effect
    // with that name and no bag, so the sheet, the HUD and the export all see it.
    effect.update({ changes: [], transfer: false, 'flags.shadowbase.statusEffect': tokenToggleRow(cfg, effect.name) });
  });

  Hooks.on('deleteActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (!isOurs(actor) || !mine(userId) || !isStunMirror(effect)) return;
    // Only a mirror that still represents the CURRENT stunType clears it (the
    // player removed the icon). A mirror syncStun retired because stunType
    // moved on (Physical -> Mental, or -> None) no longer matches and is left
    // alone - reading the remaining mirrors here instead would see none for a
    // moment and wrongly write 'None' in the middle of a Physical -> Mental swap.
    if (STUN_TYPE_BY_STATUS[stunStatusOf(effect)] !== actor.system?.stunType) return;
    // A duplicate mirror of the same stun (two token toggles) leaving while its twin stays does not clear the state.
    if (actor.effects.some((e) => e.id !== effect.id && isStunMirror(e) && stunStatusOf(e) === stunStatusOf(effect))) return;
    actor.update({ 'system.stunType': 'None' });
  });
}

export const effects = Object.freeze({
  isExpiredAt, statusEffectRow, hasStatus, stunStatusOf, isStunMirror, configStatusOf, storedEffects, findEffect, derivedEffects,
  addEffect, addManualEffect, dismissEffect, advancePhase, recoverEp, sweepExpired,
  stunMirrorData, stunTypeFromEffects, syncStun, syncStunFromEffects, toggleStatus,
  registerStatusEffects, registerEffectHooks,
  STUN_STATUS_BY_TYPE, STUN_TYPE_BY_STATUS, DERIVED_STUN_ID,
});

export default effects;
