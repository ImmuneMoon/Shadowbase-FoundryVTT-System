// module/apps/hud.mjs
//
// The Tactical HUD (docs/ARCHITECTURE.md §6.2): the website's roller-window.tsx
// as an ApplicationV2 window beside the actor sheet - Actions / Status /
// Handbook tabs, a roll-history footer, the bell and the settings gear. It
// DECIDES nothing about a rule: every target, gate, cost, effect operation and
// wound goes through the modules that own them -
//
//   module/rolls.mjs    every roll and every button state (attackTargetFor,
//                       attackBlockedReason, defenseTargetFor, skillTargetFor,
//                       forcePowerTargetFor, techniqueTargetFor, crewActionsFor ...)
//   module/effects.mjs  the Active Effects hub (addManualEffect, dismissEffect,
//                       advancePhase, recoverEp; derivedEffects / storedEffects)
//   module/damage.mjs   the Tactical Damage Processor (assessDamage for the live
//                       preview, applyDamage for the wounds)
//   module/combat.mjs   the turn counter, the sweep, the economy advisories
//   module/apps/handbook-browser.mjs   the Handbook tab
//
// and the figures it prints come off `actor.stats` (the engine's
// CalculatedStatsResult) the way the website reads `calculatedStats`. Where
// the website's HUD computes a display detail inline - the ammunition badge,
// the "Phase i of n" line, the modifier badges' labels - the lines are cited.
//
// One window per actor (`id: shadowbase-hud-<actorId>`, TacticalHud.open(actor)),
// re-rendered through the actor's `apps` registry on every change of the
// actor, its Items or its ActiveEffects (the same channel a DocumentSheet
// uses), resizable, with its position remembered in a user flag.
//
// Every user-visible string is a lang/en.json key (SHADOWBASE.Hud.*,
// SHADOWBASE.Handbook.*; the Roll/Effect/Damage keys other modules already
// own are reused where the wording is the same). Row DATA written back to the
// actor (a manual effect's row, the pinned-notification records) keeps the
// website's literals, because it is exported in the character JSON.

import { engine } from '../engine.mjs';
import { rolls } from '../rolls.mjs';
import { effects } from '../effects.mjs';
import { damage } from '../damage.mjs';
import { combat } from '../combat.mjs';
import { rowsOf, rowWithDerived } from '../adapter.mjs';
import { HandbookBrowser, BROWSER_TEMPLATE, resolveTarget } from './handbook-browser.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const SYSTEM_ID = 'shadowbase';
export const HUD_TEMPLATES = Object.freeze({
  header: 'systems/shadowbase/templates/hud/header.hbs',
  tabs: 'systems/shadowbase/templates/hud/tabs.hbs',
  actions: 'systems/shadowbase/templates/hud/actions.hbs',
  status: 'systems/shadowbase/templates/hud/status.hbs',
  handbook: 'systems/shadowbase/templates/hud/handbook.hbs',
  footer: 'systems/shadowbase/templates/hud/footer.hbs',
  browser: BROWSER_TEMPLATE,
});

/** use-sheet-preferences.ts DEFAULTS / ROLL_HISTORY_DEPTHS / NOTIFICATION_DEPTHS. */
export const NOTIFICATION_DEFAULT_DEPTH = 12;
export const NOTIFICATION_DEPTHS = Object.freeze([12, 25, 50]);
export const ROLL_HISTORY_DEPTHS = Object.freeze([10, 25, 50, 100]);
/** roller-window.tsx CustomRollSection: the die sizes offered. */
export const CUSTOM_DICE_SIDES = Object.freeze([2, 4, 6, 8, 10, 12, 20, 100]);
/** roller-window.tsx MOD_LABELS + the inline renames in StatusEffectsHub (:470-476). */
const MOD_LABELS = Object.freeze({ toHit: 'HIT', frightCheck: 'FRIGHT', frightImmune: 'FRIGHT IMMUNE', carryCapacity: 'CARRYING', endurancePoints: 'EP', forcePoints: 'FP' });
/** The Add Custom dialog's channel labels (roller-window.tsx :225 `MOD_LABELS[stat] ?? stat`). */
const DIALOG_LABELS = Object.freeze({ toHit: 'HIT', frightCheck: 'FRIGHT', frightImmune: 'FRIGHT IMMUNE' });

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const lower = (v) => String(v ?? '').toLowerCase();
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** A client setting, or the default while unit U10 has not registered it (module/settings.mjs). */
function settingGet(key, fallback) {
  try { const v = globalThis.game?.settings?.get(SYSTEM_ID, key); return v === undefined ? fallback : v; } catch { return fallback; }
}
async function settingSet(key, value) {
  try { await globalThis.game?.settings?.set(SYSTEM_ID, key, value); return true; } catch { return false; }
}
/** use-toast.ts historyLimit / maxPinned: the bell keeps `notificationDepth`, at most depth-1 pinned. */
export function notificationDepth() {
  const n = Number(settingGet('notificationDepth', NOTIFICATION_DEFAULT_DEPTH));
  return Number.isFinite(n) && n >= 2 ? Math.floor(n) : NOTIFICATION_DEFAULT_DEPTH;
}
export function maxPinned() { return notificationDepth() - 1; }

/** roller-window.tsx:1300-1309 - the ranged shapes (the same predicates module/rolls.mjs keeps private). */
const isStinger = (row) => lower(row.baseType).includes('stinger');
// The launcher test is the website's ONE (lib/launcher-weapons.ts, through module/rolls.mjs): the old inline one read a
// `category` a blaster row does not carry and missed the Mortar and the Underslung Grenade.
const isGrenadeLauncher = (row) => rolls.firesExplosivePayload(row);
const isSlugthrower = (row) => ['slugthrower', 'ripper', 'cycler'].some((w) => lower(row.baseType).includes(w));

/** The composed sheet and the engine result, as module/rolls.mjs reads them. */
const sheetOf = (actor) => actor.sheetData ?? actor.system?.sheetCache ?? null;
const statsOf = (actor) => actor.stats ?? actor.system?.derived ?? null;

/**
 * weapon-selector-for-roll.tsx availableWeapons: which readied weapons a
 * technique (by its base-skill string) or a Form (sabers only) may roll with.
 */
export function weaponsForRequirement(baseSkillString, equipped, { isLightsaberForm = false } = {}) {
  const kindOf = (item) => (item.type === 'blaster' ? 'blaster' : item.type === 'lightsaber' ? 'lightsaber' : 'melee');
  if (isLightsaberForm) return equipped.filter((w) => kindOf(w) === 'lightsaber');
  if (!baseSkillString) return [];
  const lowerReq = lower(baseSkillString);
  if (lowerReq.includes('any') || lowerReq.includes('melee or ranged') || lowerReq.includes('ranged or melee')) return equipped;
  return equipped.filter((weapon) => {
    const kind = kindOf(weapon);
    if (lowerReq.includes('ranged') && kind === 'blaster') return true;
    if (lowerReq.includes('melee') && (kind === 'melee' || kind === 'lightsaber')) return true;
    if (lowerReq.includes('lightsaber') && kind === 'lightsaber') return true;
    const weaponSkill = lower(weapon.system?.row?.baseSkill);
    return !!weaponSkill && lowerReq.includes(weaponSkill);
  });
}

/**
 * The per-channel badges of an effect card (roller-window.tsx StatusEffectsHub
 * :459-520): a boolean channel shows its name only when set; 0 is skipped; a
 * multiplier channel prints through formatModifierChannel and is positive
 * only above identity; a number prints signed with a three-letter label.
 * @returns {{ text: string, positive: boolean }[]}
 */
export function modifierBadges(modifiers) {
  const out = [];
  const mc = engine.modifierChannels;
  for (const [stat, val] of Object.entries(modifiers ?? {})) {
    if (typeof val === 'boolean') { if (val) out.push({ text: MOD_LABELS[stat] ?? stat.toUpperCase(), positive: true }); continue; }
    if (val === 0 || val === null || val === undefined) continue;
    if (mc.isMultiplierChannel(stat)) {
      const text = mc.formatModifierChannel(stat, val, 'MOVE');
      if (text) out.push({ text, positive: val > mc.MULTIPLIER_IDENTITY });
      continue;
    }
    const label = MOD_LABELS[stat] ?? stat.slice(0, 3).toUpperCase();
    out.push({ text: `${val > 0 ? '+' : ''}${val} ${label}`, positive: val > 0 });
  }
  return out;
}

/**
 * The Add Custom dialog's answer -> the row data module/effects.mjs takes
 * (roller-window.tsx AddStatusEffectDialog onConfirm: name, type, description,
 * duration, modifiers - numeric channels parseInt'd, frightImmune a checkbox,
 * moveMultiplier a select over MOVE_MULTIPLIER_OPTIONS).
 * @param {{ elements?: object }|Record<string, any>} form a form element or a plain { name: value } map
 */
export function readEffectForm(form) {
  const el = form?.elements ?? form ?? {};
  const read = (name) => {
    const f = el[name];
    if (f === undefined) return undefined;
    if (f && typeof f === 'object' && (f.type === 'checkbox' || 'checked' in f)) return !!f.checked;
    return f && typeof f === 'object' && 'value' in f ? f.value : f;
  };
  const mc = engine.modifierChannels;
  const modifiers = { ...engine.NO_MODIFIERS };
  for (const stat of mc.NUMERIC_MODIFIER_CHANNELS) modifiers[stat] = parseInt(String(read(`mod.${stat}`) ?? '0'), 10) || 0;
  const immune = read('mod.frightImmune');
  modifiers.frightImmune = immune === true || immune === 'true' || immune === 'on';
  const mult = Number(read('mod.moveMultiplier'));
  modifiers.moveMultiplier = Number.isFinite(mult) && mult > 0 ? mult : mc.MULTIPLIER_IDENTITY;
  const type = read('type') === 'debuff' ? 'debuff' : 'buff';
  return { name: String(read('name') ?? ''), type, description: String(read('description') ?? ''), duration: String(read('duration') ?? ''), modifiers };
}

/** The Add Custom dialog's HTML (a DialogV2 form; roller-window.tsx AddStatusEffectDialog). */
export function renderEffectDialogContent() {
  const mc = engine.modifierChannels;
  const channels = mc.NUMERIC_MODIFIER_CHANNELS.map((stat) => `<label class="sb-effect-dialog__channel"><span>${esc(DIALOG_LABELS[stat] ?? stat)}</span><input type="number" name="mod.${esc(stat)}" value="0" step="1"></label>`).join('');
  const moveOptions = engine.moveMultipliers.MOVE_MULTIPLIER_OPTIONS.map((o) => `<option value="${esc(o.value)}" title="${esc(o.note)}"${o.value === mc.MULTIPLIER_IDENTITY ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return `
<div class="shadowbase sb-effect-dialog">
  <div class="form-group"><label for="sb-effect-name">${esc(loc('SHADOWBASE.Hud.EffectName'))}</label><input type="text" id="sb-effect-name" name="name" placeholder="${esc(loc('SHADOWBASE.Hud.EffectNamePlaceholder'))}" autofocus></div>
  <div class="form-group"><label for="sb-effect-type">${esc(loc('SHADOWBASE.Hud.EffectType'))}</label><select id="sb-effect-type" name="type"><option value="buff">${esc(loc('SHADOWBASE.Hud.EffectBuff'))}</option><option value="debuff">${esc(loc('SHADOWBASE.Hud.EffectDebuff'))}</option></select></div>
  <div class="form-group"><label for="sb-effect-duration">${esc(loc('SHADOWBASE.Hud.EffectDuration'))}</label><input type="text" id="sb-effect-duration" name="duration" placeholder="${esc(loc('SHADOWBASE.Hud.EffectDurationPlaceholder'))}"></div>
  <div class="form-group"><label for="sb-effect-description">${esc(loc('SHADOWBASE.Hud.EffectDescription'))}</label><textarea id="sb-effect-description" name="description" rows="2" placeholder="${esc(loc('SHADOWBASE.Hud.EffectDescriptionPlaceholder'))}"></textarea></div>
  <p class="sb-effect-dialog__heading">${esc(loc('SHADOWBASE.Hud.StatModifiers'))}</p>
  <div class="sb-effect-dialog__channels">${channels}</div>
  <label class="sb-effect-dialog__check"><input type="checkbox" name="mod.frightImmune"> ${esc(loc('SHADOWBASE.Hud.FrightImmune'))}</label>
  <div class="form-group"><label for="sb-effect-move">${esc(loc('SHADOWBASE.Hud.MoveMultiplier'))}</label><select id="sb-effect-move" name="mod.moveMultiplier">${moveOptions}</select></div>
</div>`;
}

/** The settings gear's dialog (sheet-preference-controls.tsx: the two depths and keepRollHistory, the HUD's own subset). */
export function renderSettingsContent(current) {
  const opt = (values, sel) => values.map((v) => `<option value="${v}"${Number(sel) === v ? ' selected' : ''}>${v}</option>`).join('');
  return `
<div class="shadowbase sb-settings-dialog">
  <div class="form-group"><label for="sb-set-history">${esc(loc('SHADOWBASE.Hud.RollHistoryDepth'))}</label><select id="sb-set-history" name="rollHistoryDepth">${opt(ROLL_HISTORY_DEPTHS, current.rollHistoryDepth)}</select></div>
  <div class="form-group"><label for="sb-set-notes">${esc(loc('SHADOWBASE.Hud.NotificationDepth'))}</label><select id="sb-set-notes" name="notificationDepth">${opt(NOTIFICATION_DEPTHS, current.notificationDepth)}</select></div>
  <label class="sb-effect-dialog__check"><input type="checkbox" name="keepRollHistory"${current.keepRollHistory ? ' checked' : ''}> ${esc(loc('SHADOWBASE.Hud.KeepRollHistory'))}</label>
  <p class="sb-hud__hint">${esc(loc('SHADOWBASE.Hud.SettingsHint'))}</p>
</div>`;
}

/** Read the settings dialog's form. */
export function readSettingsForm(form) {
  const el = form?.elements ?? form ?? {};
  const read = (name) => { const f = el[name]; return f && typeof f === 'object' && 'value' in f ? (f.type === 'checkbox' ? !!f.checked : f.value) : f; };
  return { rollHistoryDepth: Number(read('rollHistoryDepth')) || 10, notificationDepth: Number(read('notificationDepth')) || NOTIFICATION_DEFAULT_DEPTH, keepRollHistory: read('keepRollHistory') === true || read('keepRollHistory') === 'true' };
}

/**
 * The bell's records for one actor, kept for the session (use-toast.ts
 * memoryState.notifications): newest first, capped at notificationDepth with
 * pinned records exempt from eviction (capHistory), at most depth-1 pinned.
 * Pinned records are also written to the actor (`system.pinnedNotifications`,
 * the website's SavedNotification shape) so they survive a reload.
 */
class NotificationLog {
  constructor() { this.records = []; this.seq = 0; }
  /** Restore an actor's saved pins (restoreNotifications): ids kept, seq advanced past them. */
  restore(saved) {
    const pins = (Array.isArray(saved) ? saved : []).slice(0, maxPinned()).map((s) => ({ id: String(s.id), title: s.title ?? '', description: s.description ?? '', variant: s.variant ?? null, at: Number(s.at) || 0, pinned: true }));
    for (const p of pins) { const n = Number(p.id); if (Number.isFinite(n) && n > this.seq) this.seq = n; }
    const ids = new Set(pins.map((p) => p.id));
    this.records = [...pins, ...this.records.filter((r) => !ids.has(r.id))];
    this.cap();
  }
  add({ title = '', description = '', variant = null }) {
    const record = { id: String(++this.seq), title: String(title), description: String(description), variant, at: Date.now(), pinned: false };
    this.records.unshift(record);
    this.cap();
    return record;
  }
  /** use-toast.ts capHistory: drop the oldest unpinned records past the depth. */
  cap() {
    const limit = notificationDepth();
    for (let i = this.records.length - 1; i >= 0 && this.records.length > limit; i--) if (!this.records[i].pinned) this.records.splice(i, 1);
  }
  pinnedCount() { return this.records.filter((r) => r.pinned).length; }
  togglePin(id) {
    const target = this.records.find((r) => r.id === id);
    if (!target) return null;
    if (!target.pinned && this.pinnedCount() >= maxPinned()) return false;
    target.pinned = !target.pinned;
    return target.pinned;
  }
  remove(id) { this.records = this.records.filter((r) => r.id !== id); }
  clear() { this.records = this.records.filter((r) => r.pinned); }
  /** getPinnedNotifications: the pins as the character document holds them. */
  pinned() { return this.records.filter((r) => r.pinned).map((r) => ({ id: r.id, title: r.title, description: r.description, variant: r.variant ?? null, at: r.at })); }
  /** Pinned float to the top (notification-history.tsx `ordered`). */
  ordered() { return [...this.records].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)); }
}

/** "just now" / "4m ago" (notification-history.tsx timeAgo). */
export function timeAgo(at, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return loc('SHADOWBASE.Hud.JustNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return fmt('SHADOWBASE.Hud.MinutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return fmt('SHADOWBASE.Hud.HoursAgo', { n: hours });
  return fmt('SHADOWBASE.Hud.DaysAgo', { n: Math.round(hours / 24) });
}

const NUMBER_FIELDS = new Set(['system.currentHitPoints', 'system.currentEndurancePoints', 'system.currentForcePoints', 'system.powerPoints', 'system.turnCounter', 'hud.custom.dice', 'hud.custom.sides', 'hud.custom.modifier', 'hud.custom.target', 'hud.custom.targetModifier', 'hud.damage.amount', 'hud.damage.armorDivisor']);
/** The website's null-means-full pools: a blank input stores null (resource-trackers.tsx onChange). */
const NULLABLE_POOLS = new Set(['system.currentHitPoints', 'system.currentEndurancePoints', 'system.currentForcePoints']);

export class TacticalHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'shadowbase-hud-{id}',
    classes: ['shadowbase', 'sb-hud'],
    tag: 'form',
    window: { title: 'SHADOWBASE.Hud.Title', icon: 'fa-solid fa-crosshairs', resizable: true, contentClasses: ['sb-hud__content'] },
    position: { width: 470, height: 760 },
    form: { handler: TacticalHud.#onSubmitForm, submitOnChange: true, closeOnSubmit: false },
    actions: {
      // header
      'open-sheet': TacticalHud.onOpenSheet,
      'turn-advance': TacticalHud.onTurnAdvance,
      'sweep-now': TacticalHud.onSweepNow,
      'roll-stun-recovery': TacticalHud.onRollStunRecovery,
      // actions tab
      'roll-custom-dice': TacticalHud.onRollCustomDice,
      'roll-custom-target': TacticalHud.onRollCustomTarget,
      'roll-unarmed': TacticalHud.onRollUnarmed,
      'roll-unarmed-damage': TacticalHud.onRollUnarmedDamage,
      'roll-attack': TacticalHud.onRollAttack,
      'roll-weapon-damage': TacticalHud.onRollWeaponDamage,
      'ready-weapon': TacticalHud.onReadyWeapon,
      'unready-weapon': TacticalHud.onUnreadyWeapon,
      'roll-parry': TacticalHud.onRollParry,
      'roll-block': TacticalHud.onRollBlock,
      'roll-dodge': TacticalHud.onRollDodge,
      'roll-attribute': TacticalHud.onRollAttribute,
      'roll-characteristic': TacticalHud.onRollCharacteristic,
      'roll-skill': TacticalHud.onRollSkill,
      'roll-power': TacticalHud.onRollPower,
      'apply-power-costs': TacticalHud.onApplyPowerCosts,
      'roll-technique': TacticalHud.onRollTechnique,
      'apply-technique-costs': TacticalHud.onApplyTechniqueCosts,
      'roll-technique-damage': TacticalHud.onRollTechniqueDamage,
      'toggle-form': TacticalHud.onToggleForm,
      'roll-form-attack': TacticalHud.onRollFormAttack,
      'roll-form-defense': TacticalHud.onRollFormDefense,
      'roll-crew-action': TacticalHud.onRollCrewAction,
      'post-economy': TacticalHud.onPostEconomy,
      // status tab
      'reset-pool': TacticalHud.onResetPool,
      'reset-all-pools': TacticalHud.onResetAllPools,
      'add-effect': TacticalHud.onAddEffect,
      'dismiss-effect': TacticalHud.onDismissEffect,
      'advance-phase': TacticalHud.onAdvancePhase,
      'recover-ep': TacticalHud.onRecoverEp,
      'select-location': TacticalHud.onSelectLocation,
      'apply-damage': TacticalHud.onApplyDamage,
      'abort-damage': TacticalHud.onAbortDamage,
      // handbook tab (delegated to module/apps/handbook-browser.mjs)
      ...Object.fromEntries(HandbookBrowser.ACTIONS.map((name) => [name, TacticalHud.onHandbookAction])),
      // footer
      'toggle-history': TacticalHud.onToggleHistory,
      'clear-history': TacticalHud.onClearHistory,
      'toggle-bell': TacticalHud.onToggleBell,
      'pin-notification': TacticalHud.onPinNotification,
      'delete-notification': TacticalHud.onDeleteNotification,
      'clear-notifications': TacticalHud.onClearNotifications,
      'open-settings': TacticalHud.onOpenSettings,
    },
  };

  static PARTS = {
    header: { template: HUD_TEMPLATES.header },
    tabs: { template: HUD_TEMPLATES.tabs },
    actions: { template: HUD_TEMPLATES.actions, scrollable: [''] },
    status: { template: HUD_TEMPLATES.status, scrollable: [''] },
    handbook: { template: HUD_TEMPLATES.handbook, templates: [HUD_TEMPLATES.browser], scrollable: [''] },
    footer: { template: HUD_TEMPLATES.footer },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: 'actions', icon: 'fa-solid fa-dice', label: 'SHADOWBASE.Hud.TabActions' },
        { id: 'status', icon: 'fa-solid fa-heart-pulse', label: 'SHADOWBASE.Hud.TabStatus' },
        { id: 'handbook', icon: 'fa-solid fa-book-open', label: 'SHADOWBASE.Hud.TabHandbook' },
      ],
      initial: 'actions',
    },
  };

  /** The per-actor session notification logs (survive closing the window). */
  static logs = new Map();
  /** actorId -> the open HUD. */
  static instances = new Map();

  #actor;
  #handbook;
  #custom = { dice: 1, sides: 6, modifier: 0, label: '', target: 10, targetModifier: 0 };
  #damage = { locationId: null, amount: 0, damageType: 'cr', isLightsaber: false, isExplosive: false, armorDivisor: null, ledger: null };
  #ship = { weaponName: '' };
  #ui = { historyExpanded: false, bellOpen: false, focusSearch: false };
  #positionTimer = null;

  /**
   * @param {{ actor: object } & object} options `actor` is required; `id` is derived from it.
   */
  /**
   * @param {{ actor?: object, document?: object, tab?: string } & object} options `actor` (or `document`, the
   *   sheet's spelling) is required; `id` is derived from it; `tab` opens on that tab (U06's Damage
   *   Processor entry). TacticalHud.open(actor, { tab }) is the preferred entry: one window per actor.
   */
  constructor(options = {}) {
    const actor = options.actor ?? options.document;
    if (!actor) throw new Error('TacticalHud: options.actor is required');
    const { tab, ...rest } = options;
    super({ ...rest, actor, id: options.id ?? `shadowbase-hud-${actor.id}` });
    this.#actor = actor;
    if (tab && TacticalHud.TABS.primary.tabs.some((t) => t.id === tab)) this.tabGroups.primary = tab;
    this.#handbook = new HandbookBrowser({ onChange: () => { if (this.rendered) this.render({ parts: ['handbook'] }); } });
    if (!TacticalHud.instances.has(actor.id)) TacticalHud.instances.set(actor.id, this);
  }

  get actor() { return this.#actor; }
  get handbook() { return this.#handbook; }
  /** The HUD's local, non-persisted state (for the check and the preview renderer). */
  get uiState() { return { custom: { ...this.#custom }, damage: { ...this.#damage }, ship: { ...this.#ship }, ui: { ...this.#ui } }; }
  get title() { return fmt('SHADOWBASE.Hud.WindowTitle', { name: this.#actor.name }); }

  /** The actor's session notification log. */
  get log() {
    let log = TacticalHud.logs.get(this.#actor.id);
    if (!log) { log = new NotificationLog(); log.restore(this.#actor.system?.pinnedNotifications); TacticalHud.logs.set(this.#actor.id, log); }
    return log;
  }

  /**
   * Open (or focus) the actor's HUD. `tab` selects a tab; `handbook` (a chip
   * id or `{ chapterId, heading }`) opens the Handbook tab at that place.
   * @param {object} actor
   * @param {{ tab?: 'actions'|'status'|'handbook', handbook?: string|{ chapterId: string, heading?: string }, entry?: string|object }} [options]
   *   `entry` is the sheet's spelling of `handbook` (a chip id).
   */
  static async open(actor, { tab = null, handbook = null, entry = null } = {}) {
    let hud = TacticalHud.instances.get(actor.id);
    if (!hud) {
      const saved = TacticalHud.savedPosition();
      hud = new TacticalHud({ actor, ...(saved ? { position: saved } : {}) });
      TacticalHud.instances.set(actor.id, hud);
    }
    const target = resolveTarget(handbook ?? entry);
    if (target) tab = 'handbook';
    // Before the first render there is no DOM for changeTab to touch; the group's initial tab is state.
    if (tab) { if (hud.rendered) hud.changeTab(tab, 'primary', { force: true }); else hud.tabGroups.primary = tab; }
    await hud.render({ force: true });
    if (target) await hud.handbook.openAt(target.chapterId, target.heading, { fromChip: true });
    return hud;
  }

  /** A sheet chip's entry point (handbook-focus.ts requestHandbookEntry): open the HUD's Handbook tab at the chip's place. */
  static openHandbook(actor, chipIdOrTarget) { return TacticalHud.open(actor, { handbook: chipIdOrTarget }); }

  /** The position remembered on the user (a client flag), or null. */
  static savedPosition() {
    try {
      const user = globalThis.game?.user;
      const p = typeof user?.getFlag === 'function' ? user.getFlag(SYSTEM_ID, 'hudPosition') : null;
      return p && typeof p === 'object' ? { ...p } : null;
    } catch { return null; }
  }

  /** Record a notification for the actor's bell (the HUD's own outcomes; other modules may call it). */
  static record(actor, note) {
    const hud = TacticalHud.instances.get(actor.id);
    const log = hud ? hud.log : (TacticalHud.logs.get(actor.id) ?? (() => { const l = new NotificationLog(); l.restore(actor.system?.pinnedNotifications); TacticalHud.logs.set(actor.id, l); return l; })());
    const rec = log.add(note);
    if (hud?.rendered) hud.render({ parts: ['footer'] });
    return rec;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // The actor re-renders every app in its registry on its own, its Items' and its effects' updates.
    (this.#actor.apps ??= {})[this.id] = this;
  }

  _onClose(options) {
    super._onClose?.(options);
    this.#teardown();
  }

  /** Foundry's close() calls _onClose; a headless base class may not, so the teardown is idempotent and runs from both. */
  async close(options = {}) {
    const result = await super.close(options);
    this.#teardown();
    return result;
  }

  #teardown() {
    if (this.#actor.apps) delete this.#actor.apps[this.id];
    if (TacticalHud.instances.get(this.#actor.id) === this) TacticalHud.instances.delete(this.#actor.id);
    this.#savePosition(true);
  }

  _onPosition(position) {
    super._onPosition?.(position);
    this.#savePosition(false);
  }

  #savePosition(now) {
    const write = () => {
      this.#positionTimer = null;
      const user = globalThis.game?.user;
      if (typeof user?.setFlag !== 'function') return;
      const { left, top, width, height } = this.position ?? {};
      const p = { left, top, width, height };
      if (Object.values(p).every((v) => v === undefined)) return;
      user.setFlag(SYSTEM_ID, 'hudPosition', p).catch?.(() => {});
    };
    if (now) { if (this.#positionTimer !== null) { clearTimeout(this.#positionTimer); this.#positionTimer = null; } write(); return; }
    if (this.#positionTimer !== null) clearTimeout(this.#positionTimer);
    this.#positionTimer = setTimeout(write, 400);
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners?.(partId, htmlElement, options);
    if (!htmlElement || typeof htmlElement.querySelector !== 'function') return;
    if (partId === 'handbook') {
      this.#handbook.attachListeners(htmlElement);
      if (this.#ui.focusSearch) {
        const input = htmlElement.querySelector('input[data-hb-search]');
        if (input) { input.focus(); const n = input.value.length; input.setSelectionRange?.(n, n); }
      }
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#ui.focusSearch = false;
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  async _prepareContext(options) {
    const actor = this.#actor;
    const sheet = sheetOf(actor);
    const stats = statsOf(actor);
    const tabs = this._prepareTabs('primary');
    const engineOk = !!(sheet && stats);
    const context = {
      ...(await super._prepareContext(options)),
      tabs,
      actor: { id: actor.id, name: actor.name, img: actor.system?.characterPortrait || actor.img || '', isDroid: !!actor.system?.isDroid },
      engineOk,
      engineError: actor.system?.engineError ?? null,
    };
    context.header = this.#headerContext(actor, sheet, stats);
    context.actions = engineOk ? this.#actionsContext(actor, sheet, stats) : null;
    context.status = engineOk ? this.#statusContext(actor, sheet, stats) : null;
    context.handbook = await this.#handbook.prepareContext();
    context.footer = this.#footerContext(actor);
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  #headerContext(actor, sheet, stats) {
    const stunType = actor.system?.stunType ?? 'None';
    const stunned = engine.stunRules.isStunned(stunType);
    const attribute = stunned ? engine.stunRules.stunRecoveryAttribute(stunType) : null;
    const isDroid = !!actor.system?.isDroid;
    const res = actor.system?.resources ?? {};
    const pool = (key) => ({ value: res[key]?.value ?? 0, max: res[key]?.max ?? 0 });
    return {
      turnCounter: num(actor.system?.turnCounter),
      stunned, stunType, stunAttribute: attribute,
      stunLine: stunned ? fmt('SHADOWBASE.Hud.StunnedLine', { type: stunType, attribute }) : '',
      pools: isDroid ? [{ key: 'hp', label: loc('SHADOWBASE.Roll.HP'), ...pool('hp') }, { key: 'pp', label: loc('SHADOWBASE.Hud.PP'), ...pool('pp') }]
        : [{ key: 'hp', label: loc('SHADOWBASE.Roll.HP'), ...pool('hp') }, { key: 'ep', label: loc('SHADOWBASE.Roll.EP'), ...pool('ep') }, { key: 'fp', label: loc('SHADOWBASE.Roll.FP'), ...pool('fp') }],
      basicSpeed: stats ? Number(stats.currentValues.basicSpeed ?? 0).toFixed(2) : '—',
      dodge: stats ? (stats.defenseAdjustments.dodgeAvailable ? rolls.defenseTargetFor(actor, 'dodge')?.target ?? '—' : loc('SHADOWBASE.Hud.NA')) : '—',
      arc: stats?.defenseAdjustments?.arc ?? 'Front',
      flanked: !!stats?.defenseAdjustments?.flanked,
    };
  }

  #weaponContext(actor, sheet, stats, item, index) {
    const row = rowWithDerived(item);
    const name = item.displayName ?? item.name;
    const isMelee = item.type === 'meleeWeapon';
    const isSaber = item.type === 'lightsaber' || engine.lightsaberClassType.isLightsaberWeapon(row);
    const stinger = isStinger(row);
    const launcher = isGrenadeLauncher(row);
    const slug = isSlugthrower(row);
    const info = rolls.attackTargetFor(actor, item);
    const blocked = rolls.attackBlockedReason(actor, item);
    const shots = rolls.shotsFor(item);
    const dmg = rolls.damageFormulaFor(actor, item);
    const hasHits = stinger ? (row.lastVolley?.length ?? 0) > 0 : (num(row.pendingHits) > 0);
    const pendingHits = stinger ? (row.lastVolley?.length ?? 0) : num(row.pendingHits);
    const effectiveSt = stats.primaryAttributes.effectiveStrength;
    const wh = engine.weaponHandling;
    const handling = wh.handlingSummary({
      minSt: isMelee ? row.finalStRequirement : wh.rangedMinSt(row, sheet.weaponModifications ?? []),
      effectiveSt,
      isTwoHanded: isMelee && engine.isWeaponTwoHanded(row, sheet.weaponModifications ?? []),
      isUnbalanced: isMelee && !!row.isUnbalanced,
      canBecomeUnready: isMelee && wh.canBecomeUnreadyFor(row.baseType),
      isUnready: isMelee && !!row.isUnready,
      attackedThisTurn: isMelee && wh.attackedThisTurn(row, actor.system?.turnCounter),
    });
    // The ammunition badge (roller-window.tsx weapon card: charges, the magazine's rounds, the darts, the tube).
    let ammo = null;
    if (launcher) ammo = { text: row.loadedExplosiveData?.baseExplosiveName ?? row.loadedExplosiveData?.name ?? loc('SHADOWBASE.Hud.NoExplosive'), empty: !row.loadedExplosiveId };
    else if (stinger) ammo = { text: fmt('SHADOWBASE.Hud.Darts', { selected: row.selectedVolleyIndices?.length ?? 0, total: row.stingerReservoir?.length ?? 0 }), empty: (row.stingerReservoir?.length ?? 0) === 0 };
    else if (slug && row.loadedAmmunitionData) ammo = { text: fmt('SHADOWBASE.Hud.Rounds', { n: row.loadedAmmunitionData.contents?.length ?? 0 }), empty: (row.loadedAmmunitionData.contents?.length ?? 0) === 0 };
    else if (item.type === 'blaster' || (row.currentCharges !== undefined && row.currentCharges !== null)) ammo = { text: fmt('SHADOWBASE.Hud.Charges', { current: num(row.currentCharges), max: row.maxCharges ?? '—' }), empty: num(row.currentCharges) < (num(row.chargesPerShot, 1) || 1) };
    const parry = rolls.defenseTargetFor(actor, 'parry', { weaponItem: item });
    const block = rolls.defenseTargetFor(actor, 'block', { weaponItem: item });
    const skillType = info?.type ?? 'default';
    return {
      id: item.id, name, baseType: row.baseType || (isSaber ? loc('TYPES.Item.lightsaber') : loc('SHADOWBASE.Hud.Weapon')),
      isOffHand: index > 0, isMelee, isSaber, isBlaster: item.type === 'blaster',
      target: info?.target ?? null, hitBonus: info?.hitBonus ?? 0, hitBonusText: info?.hitBonus ? signed(info.hitBonus) : '',
      skillName: info?.skillName ?? '', skillType, skillBadge: skillType === 'trained' ? '' : skillType.toUpperCase(), skillNote: info?.note ?? '',
      malf: rolls.malfunctionThresholdFor(item),
      attackLabel: stinger ? fmt('SHADOWBASE.Hud.Fire', { n: shots }) : shots > 1 ? fmt('SHADOWBASE.Hud.AttackTimes', { n: shots }) : loc('SHADOWBASE.Hud.Attack'),
      shots, blocked, canAttack: !blocked && info?.target != null,
      damageFormula: dmg.volley ? fmt('SHADOWBASE.Hud.DamageVolley', { n: dmg.volley.length }) : (dmg.formula ?? '—'),
      hasHits, pendingHits, canDamage: hasHits && (dmg.formula != null || (dmg.volley?.length ?? 0) > 0),
      unready: isMelee && !!row.isUnready, canUnready: isMelee && !row.isUnready,
      ammo,
      handling: handling.map((s) => ({ id: s.id, text: s.text, active: !!s.active })),
      parry: { target: parry?.target ?? 0, available: !!parry?.available, reason: parry?.reason ?? '', label: parry?.label ?? '' },
      block: { target: block?.target ?? 0, available: !!block?.available, reason: block?.reason ?? '', label: block?.label ?? '' },
    };
  }

  #actionsContext(actor, sheet, stats) {
    const equipped = rolls.equippedWeapons(actor);
    const weapons = equipped.map((item, i) => this.#weaponContext(actor, sheet, stats, item, i));
    const stunned = engine.stunRules.isStunned(actor.system?.stunType);
    const adj = stats.defenseAdjustments;
    const unarmed = rolls.unarmedTargetFor(actor);
    const bank = actor.getFlag?.(SYSTEM_ID, 'unarmedPendingHits') ?? actor.flags?.[SYSTEM_ID]?.unarmedPendingHits ?? {};
    const strikes = ['punch', 'kick'].map((which) => ({
      which, label: loc(`SHADOWBASE.Roll.${which === 'punch' ? 'Punch' : 'Kick'}`),
      target: unarmed?.target ?? null, skillName: unarmed?.skillName ?? '', type: unarmed?.type ?? 'default',
      badge: unarmed?.type && unarmed.type !== 'trained' ? unarmed.type.toUpperCase() : '', note: unarmed?.note ?? '',
      damage: stats.unarmedDamage?.[which] ?? '', pendingHits: num(bank?.[which]), canAttack: !stunned && unarmed?.target != null,
    }));
    const dodge = rolls.defenseTargetFor(actor, 'dodge');
    const unarmedParry = rolls.defenseTargetFor(actor, 'parry', { weaponItem: null });
    const attributes = rolls.ATTRIBUTE_KEYS.map((key) => ({ kind: 'attribute', key, label: loc(`SHADOWBASE.Roll.Attribute.${key}`), target: rolls.attributeTarget(actor, key), immune: false }));
    const characteristics = rolls.CHARACTERISTIC_KEYS.filter((k) => k !== 'will' && k !== 'perception').map((key) => ({
      kind: 'characteristic', key, label: loc(`SHADOWBASE.Roll.Characteristic.${key}`),
      target: rolls.characteristicTarget(actor, key), immune: key === 'frightCheck' && !!stats.modifiers?.frightImmune,
    }));
    const economy = combat.economyFlags(actor).map((f) => ({ id: f.id, label: f.label, detail: f.detail }));
    const skills = (sheet.skills ?? []).map((s) => {
      const info = rolls.skillTargetFor(actor, s.name);
      const source = info?.resolution?.source ?? 'none';
      return { name: s.name ?? '', target: info?.target ?? null, trained: source === 'trained', badge: source === 'trained' ? loc('SHADOWBASE.Hud.Trained') : loc('SHADOWBASE.Hud.Default'), note: info?.describe ?? '', level: s.level ?? '' };
    });
    const powers = rowsOf(actor, 'forcePowers').map((item) => {
      const row = item.system.row ?? {};
      const best = rolls.forcePowerTargetFor(actor, item);
      const costs = rolls.forcePowerCostsFor(actor, item);
      return { id: item.id, name: row.name ?? item.name, level: row.level ?? '', baseSkill: row.baseSkill ?? '', alignment: row.alignment ?? '', target: best?.level ?? null, skillName: best?.name ?? '', fp: costs.fp, ep: costs.ep, effect: row.effect ?? '' };
    });
    const techniques = rowsOf(actor, 'combatTechniques').map((item) => {
      const row = item.system.row ?? {};
      const options = weaponsForRequirement(row.baseSkill, equipped);
      const selectedId = row.selectedWeaponId && options.some((w) => w.id === row.selectedWeaponId) ? row.selectedWeaponId : null;
      const weaponItem = selectedId ? equipped.find((w) => w.id === selectedId) : null;
      const info = rolls.techniqueTargetFor(actor, item, { weaponItem });
      return {
        id: item.id, name: row.name ?? item.name, level: row.level ?? '', category: row.category ?? '', baseSkill: row.baseSkill ?? '',
        target: info?.target ?? null, skillName: info?.skillName ?? '', needsWeapon: !!info?.needsWeapon, skillBonus: num(row.skillBonus), skillPenalty: num(row.skillPenalty),
        fp: num(row.fpCost), ep: num(row.epCost), hasCosts: num(row.fpCost) > 0 || num(row.epCost) > 0, damageBonus: row.damageBonus ?? '',
        weapons: options.map((w) => ({ id: w.id, name: w.displayName ?? w.name, selected: w.id === selectedId })), hasWeaponOptions: options.length > 0, selectedWeaponId: selectedId, effect: row.effect ?? '',
      };
    });
    const activeFormName = sheet.activeLightsaberForm ?? null;
    const sabers = equipped.filter((w) => w.type === 'lightsaber');
    const formWeaponId = actor.system?.activeFormWeaponId && sabers.some((w) => w.id === actor.system.activeFormWeaponId) ? actor.system.activeFormWeaponId : (sabers.length === 1 ? sabers[0].id : null);
    const formWeapon = formWeaponId ? sabers.find((w) => w.id === formWeaponId) : null;
    const formEffect = rolls.activeFormEffectFor(actor);
    const forms = rowsOf(actor, 'lightsaberForms').map((item) => {
      const row = item.system.row ?? {};
      return { id: item.id, name: row.name ?? item.name, level: row.level ?? '', active: activeFormName === row.name };
    });
    const formAttack = formWeapon ? rolls.attackTargetFor(actor, formWeapon) : null;
    const activeForm = activeFormName ? {
      name: activeFormName,
      effect: { attack: formEffect.attack, parry: formEffect.parry, dodge: formEffect.dodge, block: formEffect.block, basicMove: formEffect.basicMove },
      saberReadied: sabers.length > 0,
      weapons: sabers.map((w) => ({ id: w.id, name: w.displayName ?? w.name, selected: w.id === formWeaponId })),
      weaponId: formWeaponId,
      attackTarget: formAttack?.target ?? null, attackBonus: formAttack ? formAttack.hitBonus + formEffect.attack : 0,
      dodge: { target: dodge?.target ?? 0, available: !!dodge?.available },
      parry: (() => { const p = formWeapon ? rolls.defenseTargetFor(actor, 'parry', { weaponItem: formWeapon }) : null; return { target: p?.target ?? 0, available: !!p?.available }; })(),
      block: (() => { const b = formWeapon ? rolls.defenseTargetFor(actor, 'block', { weaponItem: formWeapon }) : null; return { target: b?.target ?? 0, available: !!b?.available }; })(),
    } : null;
    const station = actor.system?.assignedStation ?? null;
    const crewActions = rolls.crewActionsFor(actor, station ?? undefined).map((a) => ({
      label: a.label, isDamage: !!a.isDamage, target: a.target ?? null, skills: (a.skills ?? []).join(' / '), modifier: a.modifier ? signed(a.modifier) : '', skillName: a.best?.name ?? '',
    }));
    const weaponLibrary = engine.starshipWeapons.STARSHIP_WEAPONS_LIBRARY.filter((w) => w.name !== 'None').map((w) => ({ name: w.name, label: `${w.name} (${w.cost}cr)`, selected: w.name === this.#ship.weaponName }));
    return {
      stunned,
      custom: { ...this.#custom, sides: CUSTOM_DICE_SIDES.map((s) => ({ value: s, label: `d${s}`, selected: s === num(this.#custom.sides, 6) })), formula: `${num(this.#custom.dice, 1)}d${num(this.#custom.sides, 6)}${this.#custom.modifier ? signed(num(this.#custom.modifier)) : ''}` },
      strikes,
      weapons, hasWeapons: weapons.length > 0,
      turnOrder: { basicSpeed: Number(stats.currentValues.basicSpeed ?? 0).toFixed(2), dx: stats.primaryAttributes.effectiveDexterity },
      dodge: { target: dodge?.target ?? 0, available: !!dodge?.available, reason: dodge?.reason ?? '' },
      unarmedParry: { target: unarmedParry?.target ?? 0, available: !!unarmedParry?.available, reason: unarmedParry?.reason ?? '', label: unarmedParry?.label ?? '', caveat: unarmedParry?.caveat ?? '' },
      arc: adj.arc, flanked: !!adj.flanked, parryAvailable: !!adj.parryAvailable, blockAvailable: !!adj.blockAvailable, dodgeAvailable: !!adj.dodgeAvailable,
      stunPenalty: stunned ? engine.stunRules.STUN_ACTIVE_DEFENSE_PENALTY : 0,
      attributes, characteristics,
      economy, hasEconomy: economy.length > 0,
      maneuverNotes: engine.combatEconomy.MANEUVER_ECONOMY_NOTES.map((n) => ({ name: n.name, rule: n.rule })),
      skills, hasSkills: skills.length > 0,
      powers, hasPowers: powers.length > 0,
      techniques, hasTechniques: techniques.length > 0,
      forms, hasForms: forms.length > 0, activeForm,
      ship: { station, stations: engine.shipStations.SHIP_STATIONS.map((s) => ({ value: s, selected: s === station })), actions: crewActions, hasActions: crewActions.length > 0, isTurret: station === 'Weapon Stations (Turrets)', weapons: weaponLibrary, weaponName: this.#ship.weaponName },
    };
  }

  #statusContext(actor, sheet, stats) {
    const isDroid = !!actor.system?.isDroid;
    const cv = stats.currentValues;
    const raw = (field) => { const v = actor.system?.[field]; return v === null || v === undefined ? '' : v; };
    const pp = num(actor.system?.powerPoints, cv.maxPowerPoints);
    const pools = [
      { key: 'hp', field: 'system.currentHitPoints', label: loc('SHADOWBASE.Roll.HP'), value: raw('currentHitPoints'), max: cv.hitPoints, icon: 'fa-solid fa-heart', tone: '' },
      ...(isDroid
        ? [{ key: 'pp', field: 'system.powerPoints', label: loc('SHADOWBASE.Hud.PP'), value: pp, max: cv.maxPowerPoints, icon: 'fa-solid fa-battery-half', tone: pp <= 10 ? 'is-critical' : pp <= 20 ? 'is-low' : 'is-ok' }]
        : [
          { key: 'ep', field: 'system.currentEndurancePoints', label: loc('SHADOWBASE.Roll.EP'), value: raw('currentEndurancePoints'), max: cv.endurancePoints, icon: 'fa-solid fa-bolt', tone: '' },
          { key: 'fp', field: 'system.currentForcePoints', label: loc('SHADOWBASE.Roll.FP'), value: raw('currentForcePoints'), max: cv.maxForcePoints, icon: 'fa-solid fa-wand-sparkles', tone: '' },
        ]),
    ];
    const storedIds = new Set(effects.storedEffects(actor).map((e) => e.flags.shadowbase.statusEffect.id));
    const cards = (stats.activeStatusEffects ?? []).map((e) => {
      const phases = Array.isArray(e.phases) ? e.phases : [];
      const phaseIndex = num(e.phaseIndex);
      const hasPhase = phases.length > phaseIndex;
      const epPenalty = num(e.modifiers?.endurancePoints) < 0;
      return {
        id: e.id, name: e.name ?? '', type: e.type === 'debuff' ? 'debuff' : 'buff', source: e.source ?? '', duration: e.duration ?? '', description: e.description ?? '',
        isGear: !!e.isGear, isStored: storedIds.has(e.id), isDerived: !storedIds.has(e.id) && !e.isGear,
        badges: modifierBadges(e.modifiers),
        canRecoverEp: epPenalty && !e.isGear,
        hasPhase, phaseLine: hasPhase ? fmt('SHADOWBASE.Hud.PhaseLine', { index: phaseIndex + 1, total: phases.length + 1 }) : '', nextPhase: hasPhase ? (phases[phaseIndex]?.name ?? '') : '',
        canDismiss: !e.isGear,
      };
    });
    const dodge = rolls.defenseTargetFor(actor, 'dodge');
    const tiles = {
      dodge: stats.defenseAdjustments.dodgeAvailable ? String(dodge?.target ?? 0) : loc('SHADOWBASE.Hud.NA'), dodgeAvailable: !!stats.defenseAdjustments.dodgeAvailable,
      move: stats.currentEncumbrance.move, encumbrance: stats.currentEncumbrance.level || 'None', runningJump: stats.jumpDistances.running,
    };
    const d = this.#damage;
    const locations = damage.locationsOf(actor).map((l) => ({
      id: l.id, name: l.name, isOrganic: !!l.isOrganic, target: signed(num(l.targetPenalty)), dr: engine.typedResistance.formatTypedDR(l.totalDR, l.typedDR ?? []), drPositive: num(l.totalDR) > 0,
      status: l.status ?? 'Healthy', healthy: (l.status ?? 'Healthy') === 'Healthy', selected: l.id === d.locationId,
    }));
    const selected = d.locationId ? damage.locationOf(actor, d.locationId) : null;
    const assessment = selected ? damage.assessDamage(actor, { locationId: d.locationId, amount: d.amount, damageType: d.damageType, isExplosive: d.isExplosive, armorDivisor: d.armorDivisor }) : null;
    const processor = selected ? {
      locationId: selected.id, name: selected.name, isOrganic: !!selected.isOrganic, structure: loc(selected.isOrganic ? 'SHADOWBASE.Hud.Biological' : 'SHADOWBASE.Hud.Synthetic'),
      amount: d.amount, damageType: d.damageType, isLightsaber: d.isLightsaber, isExplosive: d.isExplosive, armorDivisor: d.armorDivisor ?? '',
      types: damage.DAMAGE_TYPES.map((t) => ({ value: t.value, label: loc(t.label), selected: t.value === d.damageType })),
      dr: assessment?.drApplied ?? selected.totalDR ?? 0, finalInjury: assessment?.finalInjury ?? 0, pool: assessment?.endurance ? loc('SHADOWBASE.Roll.EP') : loc('SHADOWBASE.Roll.HP'),
      notes: assessment?.notes ?? [], isMajorWound: !!assessment?.isMajorWound, isCrippling: !!assessment?.isCrippling, isSevering: !!assessment?.isSevering, multiplier: assessment?.multiplier ?? 1,
    } : null;
    const ledger = d.ledger;
    return {
      isDroid, pools,
      effects: cards, hasEffects: cards.length > 0,
      tiles,
      locations, hasLocations: locations.length > 0, anatomyTitle: loc(isDroid ? 'SHADOWBASE.Hud.DroidDR' : 'SHADOWBASE.Hud.AnatomicalDR'),
      processor,
      ledger: ledger ? { title: ledger.title, lines: ledger.lines, prompts: ledger.prompts } : null,
    };
  }

  #footerContext(actor) {
    const history = rolls.rollHistory(actor).map((r) => ({
      title: r.title ?? '', description: r.description ?? '', resultText: r.resultText ?? '',
      time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
      success: /success/i.test(r.resultText ?? ''), failure: /failure/i.test(r.resultText ?? ''),
    }));
    const log = this.log;
    const now = Date.now();
    const records = log.ordered().map((r) => ({ id: r.id, title: r.title, description: r.description, variant: r.variant ?? '', pinned: !!r.pinned, destructive: r.variant === 'destructive', ago: timeAgo(r.at, now) }));
    const pinnedCount = log.pinnedCount();
    return {
      history, hasHistory: history.length > 0, historyExpanded: this.#ui.historyExpanded, historyDepth: rolls.rollHistoryDepth(),
      bellOpen: this.#ui.bellOpen, notifications: records, count: records.length, pinnedCount, pinLimit: maxPinned(), pinsExhausted: pinnedCount >= maxPinned(), hasUnpinned: records.length > pinnedCount,
      pinnedLine: fmt('SHADOWBASE.Hud.PinnedOf', { pinned: pinnedCount, limit: maxPinned() }),
      bellTitle: records.length === 0 ? loc('SHADOWBASE.Hud.BellEmpty') : fmt('SHADOWBASE.Hud.BellKept', { count: records.length, pinned: pinnedCount }),
    };
  }

  // ---------------------------------------------------------------------------
  // The form: inputs bound by full dotted name (submitOnChange)
  // ---------------------------------------------------------------------------

  /**
   * `system.*` writes the actor (a blank current pool stores null - the
   * website's null-means-full), `items.<id>.row.<key>` writes an Item's row
   * (a technique's selectedWeaponId), `hud.*` is this window's own state.
   */
  static async #onSubmitForm(event, form, formData) {
    const data = formData?.object ?? {};
    const actorUpdates = {};
    const parts = new Set();
    for (const [name, raw] of Object.entries(data)) {
      let value = raw;
      if (NUMBER_FIELDS.has(name)) value = raw === '' || raw === null || raw === undefined ? null : Number(raw);
      if (name.startsWith('system.')) {
        if (value === null && !NULLABLE_POOLS.has(name)) continue;
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        if (value === '') value = null;
        const current = foundry.utils.getProperty(this.actor, name);
        if (current !== value) actorUpdates[name] = value;
        continue;
      }
      if (name.startsWith('items.')) {
        const [, itemId, ...rest] = name.split('.');
        const key = rest.join('.').replace(/^row\./, '');
        const item = this.actor.items.get(itemId);
        if (item && key) await item.updateRow({ [key]: value === '' ? null : value });
        continue;
      }
      if (name.startsWith('hud.')) parts.add(this.#setLocal(name.slice(4), value));
    }
    if (Object.keys(actorUpdates).length) await this.actor.update(actorUpdates);
    parts.delete(null);
    if (parts.size) await this.render({ parts: [...parts] });
    return { actorUpdates, parts: [...parts] };
  }

  /** Set a `hud.*` field; returns the part to re-render (null for none). */
  #setLocal(path, value) {
    const [group, key] = path.split('.');
    switch (group) {
      case 'custom': if (key in this.#custom) this.#custom[key] = value ?? (typeof this.#custom[key] === 'number' ? 0 : ''); return 'actions';
      case 'ship': if (key === 'weaponName') this.#ship.weaponName = String(value ?? ''); return 'actions';
      case 'damage':
        if (key === 'isLightsaber' || key === 'isExplosive') this.#damage[key] = value === true || value === 'true' || value === 'on';
        else if (key === 'damageType') this.#damage.damageType = String(value ?? 'cr');
        else if (key === 'armorDivisor') this.#damage.armorDivisor = value === null || value === '' ? null : Number(value);
        else if (key === 'amount') this.#damage.amount = Math.max(0, Math.floor(num(value)));
        return 'status';
      case 'handbook': if (key === 'query') { this.#handbook.setQuery(String(value ?? '')); this.#ui.focusSearch = true; } return null;
      default: return null;
    }
  }

  /** TEST/PREVIEW SEAM: set local state the way the form would (the same routing as the submit handler). */
  setLocalState(path, value) { return this.#setLocal(path, value); }

  // ---------------------------------------------------------------------------
  // Actions - header
  // ---------------------------------------------------------------------------

  static onOpenSheet(event) { event?.preventDefault?.(); return this.actor.sheet?.render?.(true); }
  static async onTurnAdvance(event, target) { event?.preventDefault?.(); return combat.advanceTurn(this.actor, num(target?.dataset?.delta, 1) || 1); }
  static async onSweepNow(event) { event?.preventDefault?.(); return combat.sweepNow(this.actor); }
  static async onRollStunRecovery(event) {
    event?.preventDefault?.();
    const attribute = engine.stunRules.stunRecoveryAttribute(this.actor.system?.stunType) ?? '';
    const r = await rolls.rollStunRecovery(this.actor);
    this.#recordRoll(fmt('SHADOWBASE.Roll.StunRecovery', { attribute }), r);
    return r;
  }

  // ---------------------------------------------------------------------------
  // Actions - Actions tab
  // ---------------------------------------------------------------------------

  /** roller-window.tsx CustomRollSection: `${dice}d${sides}${modifier}` rolled as damage (use-dice-roller rollDamage). */
  static async onRollCustomDice(event) {
    event?.preventDefault?.();
    const dice = Math.max(1, Math.floor(num(this.uiState.custom.dice, 1)));
    const sides = CUSTOM_DICE_SIDES.includes(num(this.uiState.custom.sides)) ? num(this.uiState.custom.sides) : 6;
    const modifier = Math.trunc(num(this.uiState.custom.modifier));
    const formula = `${dice}d${sides}${modifier ? signed(modifier) : ''}`;
    const r = await rolls.rollDamage(this.actor, { label: loc('SHADOWBASE.Hud.CustomDiceRoll'), formula, modifier: 0 });
    if (r) TacticalHud.record(this.actor, { title: loc('SHADOWBASE.Hud.CustomDiceRoll'), description: `${formula} = ${r.total}` });
    return r;
  }

  /** A bare 3d6 against a typed target (rolls.rollCustom). */
  static async onRollCustomTarget(event) {
    event?.preventDefault?.();
    const label = String(this.uiState.custom.label || '').trim() || loc('SHADOWBASE.Roll.Custom');
    const r = await rolls.rollCustom(this.actor, { label, target: num(this.uiState.custom.target, 10), modifier: num(this.uiState.custom.targetModifier) });
    this.#recordRoll(label, r);
    return r;
  }

  static async onRollUnarmed(event, target) {
    event?.preventDefault?.();
    const which = target?.dataset?.which === 'kick' ? 'kick' : 'punch';
    const r = await rolls.rollUnarmed(this.actor, which);
    this.#recordRoll(fmt('SHADOWBASE.Roll.AttackLabel', { weapon: loc(`SHADOWBASE.Roll.${which === 'punch' ? 'Punch' : 'Kick'}`) }), r);
    return r;
  }
  static async onRollUnarmedDamage(event, target) {
    event?.preventDefault?.();
    const which = target?.dataset?.which === 'kick' ? 'kick' : 'punch';
    return rolls.rollUnarmedDamage(this.actor, which);
  }

  static async onRollAttack(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    if (!item) return null;
    const r = await rolls.rollAttack(this.actor, item);
    this.#recordRoll(fmt('SHADOWBASE.Roll.AttackLabel', { weapon: item.displayName ?? item.name }), r);
    return r;
  }
  static async onRollWeaponDamage(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    return item ? rolls.rollDamage(this.actor, { item }) : null;
  }
  /** Ch12 ◊: the Ready maneuver clears the mark (roller-window.tsx "◊ Unready — Ready"). */
  static async onReadyWeapon(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    return item ? item.updateRow({ isUnready: false }) : null;
  }
  /** The GM's hand: mark a melee weapon unready (a dropped or fumbled weapon); the sheet's own toggle. */
  static async onUnreadyWeapon(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    return item && item.type === 'meleeWeapon' ? item.updateRow({ isUnready: true }) : null;
  }
  static async onRollParry(event, target) {
    event?.preventDefault?.();
    const item = target?.dataset?.itemId ? this.#itemOf(target) : null;
    const r = await rolls.rollDefense(this.actor, 'parry', { weaponItem: item });
    this.#recordRoll(loc('SHADOWBASE.Hud.Parry'), r);
    return r;
  }
  static async onRollBlock(event, target) {
    event?.preventDefault?.();
    const item = target?.dataset?.itemId ? this.#itemOf(target) : null;
    const r = await rolls.rollDefense(this.actor, 'block', { weaponItem: item });
    this.#recordRoll(loc('SHADOWBASE.Hud.Block'), r);
    return r;
  }
  static async onRollDodge(event) {
    event?.preventDefault?.();
    const r = await rolls.rollDefense(this.actor, 'dodge');
    this.#recordRoll(loc('SHADOWBASE.Roll.Dodge'), r);
    return r;
  }
  static async onRollAttribute(event, target) {
    event?.preventDefault?.();
    const key = target?.dataset?.key;
    const r = await rolls.rollAttribute(this.actor, key);
    this.#recordRoll(loc(`SHADOWBASE.Roll.Attribute.${key}`), r);
    return r;
  }
  static async onRollCharacteristic(event, target) {
    event?.preventDefault?.();
    const key = target?.dataset?.key;
    const r = await rolls.rollCharacteristic(this.actor, key);
    this.#recordRoll(loc(`SHADOWBASE.Roll.Characteristic.${key}`), r);
    return r;
  }
  static async onRollSkill(event, target) {
    event?.preventDefault?.();
    const name = target?.dataset?.skill;
    const r = await rolls.rollSkill(this.actor, name);
    this.#recordRoll(name, r);
    return r;
  }
  static async onRollPower(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    if (!item) return null;
    const r = await rolls.rollForcePower(this.actor, item);
    this.#recordRoll(item.displayName ?? item.name, r);
    return r;
  }
  static async onApplyPowerCosts(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    return item ? rolls.applyForcePowerCosts(this.actor, item) : null;
  }
  static async onRollTechnique(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    if (!item) return null;
    const weaponItem = this.#techniqueWeapon(item);
    const r = await rolls.rollTechnique(this.actor, item, { weaponItem });
    this.#recordRoll(item.displayName ?? item.name, r);
    return r;
  }
  static async onApplyTechniqueCosts(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    return item ? rolls.applyTechniqueCosts(this.actor, item) : null;
  }
  static async onRollTechniqueDamage(event, target) {
    event?.preventDefault?.();
    const item = this.#itemOf(target);
    return item ? rolls.rollTechniqueDamage(this.actor, item, { weaponItem: this.#techniqueWeapon(item) }) : null;
  }
  /** roller-window.tsx Lightsaber Forms: Activate / Active toggles `activeLightsaberForm`. */
  static async onToggleForm(event, target) {
    event?.preventDefault?.();
    const name = target?.dataset?.form;
    if (!name) return null;
    const isActive = this.actor.system?.activeLightsaberForm === name;
    return this.actor.update({ 'system.activeLightsaberForm': isActive ? null : name });
  }
  static async onRollFormAttack(event) {
    event?.preventDefault?.();
    const saber = this.#formWeapon();
    if (!saber) { notify('warn', loc('SHADOWBASE.Hud.NoSaberForForm')); return null; }
    const r = await rolls.rollAttack(this.actor, saber);
    this.#recordRoll(fmt('SHADOWBASE.Roll.AttackLabel', { weapon: saber.displayName ?? saber.name }), r);
    return r;
  }
  static async onRollFormDefense(event, target) {
    event?.preventDefault?.();
    const kind = target?.dataset?.kind;
    if (!['dodge', 'parry', 'block'].includes(kind)) return null;
    const saber = kind === 'dodge' ? null : this.#formWeapon();
    if (kind !== 'dodge' && !saber) { notify('warn', loc('SHADOWBASE.Hud.NoSaberForForm')); return null; }
    const r = await rolls.rollDefense(this.actor, kind, { weaponItem: saber });
    this.#recordRoll(loc(`SHADOWBASE.Hud.${kind === 'dodge' ? 'Dodge' : kind === 'parry' ? 'Parry' : 'Block'}`), r);
    return r;
  }
  static async onRollCrewAction(event, target) {
    event?.preventDefault?.();
    const action = target?.dataset?.crewAction;
    const r = await rolls.rollCrewAction(this.actor, { action, weaponName: this.uiState.ship.weaponName || undefined });
    this.#recordRoll(action ?? '', r);
    return r;
  }
  static async onPostEconomy(event) { event?.preventDefault?.(); return combat.postEconomyNotice(this.actor); }

  // ---------------------------------------------------------------------------
  // Actions - Status tab
  // ---------------------------------------------------------------------------

  /** resource-trackers.tsx handleReset: the pool back to its calculated maximum. */
  static async onResetPool(event, target) {
    event?.preventDefault?.();
    const key = target?.dataset?.pool;
    const field = { hp: 'currentHitPoints', ep: 'currentEndurancePoints', fp: 'currentForcePoints', pp: 'powerPoints' }[key];
    const max = this.actor.system?.resources?.[key]?.max;
    if (!field || !Number.isFinite(Number(max))) return null;
    return this.actor.update({ [`system.${field}`]: Number(max) });
  }
  /** resource-trackers.tsx ResetAllPoolsButton: HP always, PP for a droid, EP/FP for everyone else. */
  static async onResetAllPools(event) {
    event?.preventDefault?.();
    const cv = statsOf(this.actor)?.currentValues;
    if (!cv) return null;
    const updates = { 'system.currentHitPoints': cv.hitPoints };
    if (this.actor.system?.isDroid) updates['system.powerPoints'] = cv.maxPowerPoints;
    else { updates['system.currentEndurancePoints'] = cv.endurancePoints; updates['system.currentForcePoints'] = cv.maxForcePoints; }
    return this.actor.update(updates);
  }
  /** The Add Custom dialog -> effects.addManualEffect (roller-window.tsx handleAddManualEffect). */
  static async onAddEffect(event) {
    event?.preventDefault?.();
    const data = await TacticalHud.promptEffect();
    if (!data) return null;
    const effect = await effects.addManualEffect(this.actor, data);
    TacticalHud.record(this.actor, { title: loc('SHADOWBASE.Hud.EffectApplied'), description: effect?.name ?? data.name });
    return effect;
  }
  static async onDismissEffect(event, target) {
    event?.preventDefault?.();
    const id = target?.dataset?.effectId;
    return id ? effects.dismissEffect(this.actor, id) : null;
  }
  static async onAdvancePhase(event, target) {
    event?.preventDefault?.();
    const id = target?.dataset?.effectId;
    const r = id ? await effects.advancePhase(this.actor, id) : null;
    if (r) TacticalHud.record(this.actor, { title: r.phase?.name ?? '', description: r.phase?.description ?? '', variant: (r.phase?.type ?? 'debuff') === 'debuff' ? 'destructive' : null });
    return r;
  }
  static async onRecoverEp(event, target) {
    event?.preventDefault?.();
    const id = target?.dataset?.effectId;
    return id ? effects.recoverEp(this.actor, id) : null;
  }
  /** A hit-location row opens the processor on that part (hit-location-section.tsx setSelectedPart). */
  static async onSelectLocation(event, target) {
    event?.preventDefault?.();
    const id = target?.dataset?.locationId ?? null;
    this.#setDamage({ locationId: id === this.uiState.damage.locationId ? null : id, ledger: null });
    return this.render({ parts: ['status'] });
  }
  /** Apply Wounds -> damage.applyDamage; the ledger and its HT prompts are shown under the form. */
  static async onApplyDamage(event) {
    event?.preventDefault?.();
    const d = this.uiState.damage;
    if (!d.locationId) return null;
    const ledger = await damage.applyDamage(this.actor, { locationId: d.locationId, amount: d.amount, damageType: d.damageType, isExplosive: d.isExplosive, isLightsaber: d.isLightsaber, armorDivisor: d.armorDivisor });
    if (!ledger) return null;
    const a = ledger.assessment;
    const lines = [];
    if (ledger.hp) lines.push(fmt('SHADOWBASE.Damage.Line.HP', { before: ledger.hp.before, after: ledger.hp.after }));
    if (ledger.ep) lines.push(fmt('SHADOWBASE.Damage.Line.EP', { before: ledger.ep.before, after: ledger.ep.after }));
    for (const n of ledger.notices) lines.push(n.text);
    for (const e of ledger.effects) lines.push(fmt('SHADOWBASE.Damage.Line.Effect', { name: e.row.name }));
    for (const arm of ledger.armor) lines.push(fmt('SHADOWBASE.Hud.ArmorDegraded', { name: arm.name, condition: arm.updates.condition ?? '' }));
    const title = fmt('SHADOWBASE.Damage.Title', { location: a.location.name });
    this.#setDamage({ ledger: { title, lines: [fmt('SHADOWBASE.Damage.Line.Injury', { injury: a.finalInjury, pool: a.endurance ? loc('SHADOWBASE.Roll.EP') : loc('SHADOWBASE.Roll.HP'), dr: a.drApplied, penetrating: a.penetratingBase, multiplier: a.multiplier }), ...lines], prompts: ledger.prompts.map((p) => p.text) }, amount: 0 });
    TacticalHud.record(this.actor, { title, description: [`${a.finalInjury} ${a.endurance ? 'EP' : 'HP'}`, ...ledger.prompts.map((p) => p.text)].join(' · '), variant: a.finalInjury > 0 ? 'destructive' : null });
    await this.render({ parts: ['status'] });
    return ledger;
  }
  static async onAbortDamage(event) {
    event?.preventDefault?.();
    this.#setDamage({ locationId: null, amount: 0, ledger: null });
    return this.render({ parts: ['status'] });
  }

  // ---------------------------------------------------------------------------
  // Actions - Handbook tab and footer
  // ---------------------------------------------------------------------------

  static async onHandbookAction(event, target) {
    event?.preventDefault?.();
    return this.handbook.handleAction(target?.dataset?.action, { ...(target?.dataset ?? {}) });
  }
  static async onToggleHistory(event) {
    event?.preventDefault?.();
    this.#toggleUi('historyExpanded');
    return this.render({ parts: ['footer'] });
  }
  static async onClearHistory(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    await rolls.clearRollHistory(this.actor);
    return this.render({ parts: ['footer'] });
  }
  static async onToggleBell(event) {
    event?.preventDefault?.();
    this.#toggleUi('bellOpen');
    return this.render({ parts: ['footer'] });
  }
  /** Pin or unpin (notification-history.tsx toggleNotificationPin): pins are saved on the character. */
  static async onPinNotification(event, target) {
    event?.preventDefault?.();
    const id = target?.dataset?.notificationId;
    const state = this.log.togglePin(id);
    if (state === false) { notify('warn', fmt('SHADOWBASE.Hud.PinLimit', { limit: maxPinned() })); return false; }
    if (state === null) return null;
    await this.#savePins();
    await this.render({ parts: ['footer'] });
    return state;
  }
  static async onDeleteNotification(event, target) {
    event?.preventDefault?.();
    const id = target?.dataset?.notificationId;
    const wasPinned = this.log.records.find((r) => r.id === id)?.pinned;
    this.log.remove(id);
    if (wasPinned) await this.#savePins();
    return this.render({ parts: ['footer'] });
  }
  static async onClearNotifications(event) {
    event?.preventDefault?.();
    this.log.clear();
    return this.render({ parts: ['footer'] });
  }
  /** The settings gear (sheet-settings-menu.tsx): the HUD's client preferences, through game.settings once U10 registers them. */
  static async onOpenSettings(event) {
    event?.preventDefault?.();
    const current = { rollHistoryDepth: rolls.rollHistoryDepth(), notificationDepth: notificationDepth(), keepRollHistory: settingGet('keepRollHistory', true) !== false };
    const DialogV2 = foundry.applications.api.DialogV2;
    if (!DialogV2) { notify('warn', loc('SHADOWBASE.Hud.SettingsUnavailable')); return null; }
    const answer = await DialogV2.wait({
      window: { title: loc('SHADOWBASE.Hud.SettingsTitle'), icon: 'fa-solid fa-sliders' },
      classes: [SYSTEM_ID, 'sb-settings-dialog-window'],
      content: renderSettingsContent(current),
      buttons: [
        { action: 'save', label: loc('SHADOWBASE.Hud.Save'), icon: 'fa-solid fa-check', default: true, callback: (ev, button) => readSettingsForm(button.form) },
        { action: 'cancel', label: loc('Cancel'), icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    if (!answer || typeof answer !== 'object') return null;
    const wrote = await Promise.all([settingSet('rollHistoryDepth', answer.rollHistoryDepth), settingSet('notificationDepth', answer.notificationDepth), settingSet('keepRollHistory', answer.keepRollHistory)]);
    if (!wrote.every(Boolean)) notify('info', loc('SHADOWBASE.Hud.SettingsUnavailable'));
    this.log.cap();
    await this.render({ parts: ['footer'] });
    return answer;
  }

  /** The Add Custom dialog (DialogV2.wait over renderEffectDialogContent); null when cancelled. */
  static async promptEffect() {
    const DialogV2 = foundry.applications.api.DialogV2;
    if (!DialogV2) throw new Error('TacticalHud: foundry.applications.api.DialogV2 is not available');
    const answer = await DialogV2.wait({
      window: { title: loc('SHADOWBASE.Hud.ApplyStatusEffect'), icon: 'fa-solid fa-heart-pulse' },
      classes: [SYSTEM_ID, 'sb-effect-dialog-window'],
      content: renderEffectDialogContent(),
      buttons: [
        { action: 'apply', label: loc('SHADOWBASE.Hud.ApplyEffect'), icon: 'fa-solid fa-plus', default: true, callback: (ev, button) => readEffectForm(button.form) },
        { action: 'cancel', label: loc('Cancel'), icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    return answer && typeof answer === 'object' ? answer : null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers (instance-bound through the static handlers' `this`)
  // ---------------------------------------------------------------------------

  #itemOf(target) {
    const id = target?.dataset?.itemId;
    return id ? this.actor.items.get(id) ?? null : null;
  }
  /** A technique's bound weapon (its row's selectedWeaponId, among the readied weapons it may use). */
  #techniqueWeapon(item) {
    const row = item.system?.row ?? {};
    const options = weaponsForRequirement(row.baseSkill, rolls.equippedWeapons(this.actor));
    return options.find((w) => w.id === row.selectedWeaponId) ?? null;
  }
  /** The active Form's saber: system.activeFormWeaponId, else the only readied saber. */
  #formWeapon() {
    const sabers = rolls.equippedWeapons(this.actor).filter((w) => w.type === 'lightsaber');
    const id = this.actor.system?.activeFormWeaponId;
    return sabers.find((w) => w.id === id) ?? (sabers.length === 1 ? sabers[0] : null);
  }
  #recordRoll(title, r) {
    if (!r) return;
    const text = r.result?.text ?? (r.results ? fmt('SHADOWBASE.Roll.HitsOf', { hits: r.hits, shots: r.results.length }) : '');
    TacticalHud.record(this.actor, { title: String(title), description: text, variant: r.outcome ? (r.outcome.success ? null : 'destructive') : null });
  }
  #setDamage(changes) { Object.assign(this.#damage, changes); }
  #toggleUi(key) { this.#ui[key] = !this.#ui[key]; }
  async #savePins() { await this.actor.update({ 'system.pinnedNotifications': this.log.pinned() }); }
}

export default TacticalHud;
