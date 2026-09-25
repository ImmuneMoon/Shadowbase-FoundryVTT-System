// module/settings.mjs
//
// The system's settings (docs/ARCHITECTURE.md §6.7 "SHADOWBASE.Settings.*";
// unit U10). Two kinds:
//
//   world   enforceEconomy (RESERVED - nothing reads it: the maneuver / EP
//           economy and multiple-parry flags are advisory chips per the
//           2026-08-28 ruling, combat-economy.ts "warn, don't block"),
//           npcDefaultHidden (imported dossiers stay GM-eyes-only - the
//           requirements digest's "player-safe versus GM-eyes is a hard
//           split"), tokenRotationSync (the stored facing hexside <-> the
//           token's rotation, off by default: a table that rotates tokens by
//           hand must not have the sheet fight it).
//   client  the website's sheet preferences (use-sheet-preferences.ts DEFAULTS,
//           ROLL_HISTORY_DEPTHS, NOTIFICATION_DEPTHS): compactRows, reduceMotion,
//           showHandbookChips, showPointCosts, stickySectionHeaders,
//           rememberOpenSections, keepRollHistory, rollHistoryDepth,
//           notificationDepth. The website keeps them OFF the character (they
//           describe how a player likes to read the sheet, so they must not
//           travel with an export); a Foundry client setting is the same
//           promise - per browser, never in the world. `showFloatingHudButton`
//           has no Foundry counterpart (the sheet header's HUD button is not
//           floating furniture) and is not registered.
//
// The two preferences the website mirrors onto <html> (use-sheet-preferences.ts
// syncRootAttributes: data-reduce-motion, data-compact-rows) plus the three the
// sheet's CSS reads (data-point-costs, data-handbook-chips, data-sticky-headers;
// styles/sheet.css, styles/components.css) are applied here to every
// `.shadowbase` application root (applyPreferenceAttributes), so one CSS rule
// acts on the sheet, the HUD, the item sheets and the sub-apps alike. There is
// no <html>-level attribute: Foundry's document root is shared with every other
// system and module, and the website's rules are `[data-…]` on the root only
// because the sheet IS the page there.
//
// Readers: module/rolls.mjs#rollHistoryDepth and module/apps/hud.mjs read
// `game.settings.get` inside try/catch (they were written before this file
// existed and keep the guard: a settings read before `init` has run must not
// throw inside prepareData); module/apps/actor-sheet.mjs#sheetPrefs reads
// sheetPreferences(); module/apps/dossier-importer.mjs reads npcDefaultHidden().
//
// Nothing here decides a rule.

export const SYSTEM_ID = 'shadowbase';

/** use-sheet-preferences.ts ROLL_HISTORY_DEPTHS / NOTIFICATION_DEPTHS (the selects' options, and the settings' `choices`). */
export const ROLL_HISTORY_DEPTHS = Object.freeze([10, 25, 50, 100]);
export const NOTIFICATION_DEPTHS = Object.freeze([12, 25, 50]);

/** Every hexside is 60 degrees on a hex grid (system.json grid.type 4, flat-top columns); facing 0-5 is dead ahead .. round the clock. */
export const DEGREES_PER_HEXSIDE = 60;

const choicesOf = (values) => Object.fromEntries(values.map((v) => [v, String(v)]));

/**
 * The declarations, in the order the settings panel lists them. `name` / `hint`
 * are i18n keys (lang/en.json SHADOWBASE.Settings.*). `type` is the constructor
 * Foundry casts a stored value through; `choices` renders a select.
 * `onChange` is filled in by registerSettings (the client preferences repaint
 * the open .shadowbase roots; nothing else reacts live).
 */
export const SETTINGS = Object.freeze({
  // ---- world ----------------------------------------------------------------------------------------------
  enforceEconomy: { scope: 'world', type: Boolean, default: false, name: 'SHADOWBASE.Settings.EnforceEconomy.Name', hint: 'SHADOWBASE.Settings.EnforceEconomy.Hint', reserved: true },
  npcDefaultHidden: { scope: 'world', type: Boolean, default: true, name: 'SHADOWBASE.Settings.NpcDefaultHidden.Name', hint: 'SHADOWBASE.Settings.NpcDefaultHidden.Hint' },
  tokenRotationSync: { scope: 'world', type: Boolean, default: false, name: 'SHADOWBASE.Settings.TokenRotationSync.Name', hint: 'SHADOWBASE.Settings.TokenRotationSync.Hint' },
  // ---- client: display (sheet-preference-controls.tsx "Display") ---------------------------------------------
  showHandbookChips: { scope: 'client', type: Boolean, default: true, name: 'SHADOWBASE.Settings.ShowHandbookChips.Name', hint: 'SHADOWBASE.Settings.ShowHandbookChips.Hint', attribute: 'data-handbook-chips', preference: true },
  showPointCosts: { scope: 'client', type: Boolean, default: true, name: 'SHADOWBASE.Settings.ShowPointCosts.Name', hint: 'SHADOWBASE.Settings.ShowPointCosts.Hint', attribute: 'data-point-costs', preference: true },
  compactRows: { scope: 'client', type: Boolean, default: false, name: 'SHADOWBASE.Settings.CompactRows.Name', hint: 'SHADOWBASE.Settings.CompactRows.Hint', attribute: 'data-compact-rows', preference: true },
  // ---- client: behaviour (sheet-preference-controls.tsx "Behaviour") ---------------------------------------
  stickySectionHeaders: { scope: 'client', type: Boolean, default: true, name: 'SHADOWBASE.Settings.StickySectionHeaders.Name', hint: 'SHADOWBASE.Settings.StickySectionHeaders.Hint', attribute: 'data-sticky-headers', preference: true },
  reduceMotion: { scope: 'client', type: Boolean, default: false, name: 'SHADOWBASE.Settings.ReduceMotion.Name', hint: 'SHADOWBASE.Settings.ReduceMotion.Hint', attribute: 'data-reduce-motion', preference: true },
  rememberOpenSections: { scope: 'client', type: Boolean, default: false, name: 'SHADOWBASE.Settings.RememberOpenSections.Name', hint: 'SHADOWBASE.Settings.RememberOpenSections.Hint', attribute: 'data-remember-sections', preference: true },
  // ---- client: Ch9 posture + elevation (sheet-preference-controls.tsx, added website-side 2026-09-11) --------
  // Not CSS root-attribute toggles like the display ones above: applyPosture gates whether the stored posture's
  // Ch9 modifiers reach the derived numbers (passed into getCalculatedStats as an option, exactly as the website
  // does, use-character-form.ts:138), and trackElevation shows/hides the elevation field. Both repaint the sheet.
  applyPosture: { scope: 'client', type: Boolean, default: true, name: 'SHADOWBASE.Settings.ApplyPosture.Name', hint: 'SHADOWBASE.Settings.ApplyPosture.Hint', preference: true },
  trackElevation: { scope: 'client', type: Boolean, default: true, name: 'SHADOWBASE.Settings.TrackElevation.Name', hint: 'SHADOWBASE.Settings.TrackElevation.Hint', preference: true },
  // ---- client: the HUD's footer (sheet-settings-menu.tsx) ------------------------------------------------------
  keepRollHistory: { scope: 'client', type: Boolean, default: true, name: 'SHADOWBASE.Settings.KeepRollHistory.Name', hint: 'SHADOWBASE.Settings.KeepRollHistory.Hint', preference: true },
  rollHistoryDepth: { scope: 'client', type: Number, default: 10, choices: choicesOf(ROLL_HISTORY_DEPTHS), name: 'SHADOWBASE.Settings.RollHistoryDepth.Name', hint: 'SHADOWBASE.Settings.RollHistoryDepth.Hint', preference: true },
  notificationDepth: { scope: 'client', type: Number, default: 12, choices: choicesOf(NOTIFICATION_DEPTHS), name: 'SHADOWBASE.Settings.NotificationDepth.Name', hint: 'SHADOWBASE.Settings.NotificationDepth.Hint', preference: true },
});

/** The setting keys, in registration order. */
export const SETTING_KEYS = Object.freeze(Object.keys(SETTINGS));
/** The client preferences (the website's SheetPreferences subset the Foundry sheet reads). */
export const PREFERENCE_KEYS = Object.freeze(SETTING_KEYS.filter((k) => SETTINGS[k].preference));
/** preference key -> the data-* attribute a .shadowbase root carries for it. */
export const PREFERENCE_ATTRIBUTES = Object.freeze(Object.fromEntries(PREFERENCE_KEYS.filter((k) => SETTINGS[k].attribute).map((k) => [k, SETTINGS[k].attribute])));

// ---------------------------------------------------------------------------
// Reads (guarded: a setting read before init, or under a shim that has not
// registered it, answers its declared default and never throws)
// ---------------------------------------------------------------------------

/** A setting's value, or its declared default while unregistered / unavailable. */
export function getSetting(key) {
  const decl = SETTINGS[key];
  if (!decl) throw new Error(`settings: "${key}" is not a ShadowBase setting`);
  let v;
  try { v = globalThis.game?.settings?.get(SYSTEM_ID, key); } catch { v = undefined; }
  return coerce(decl, v);
}

/** Write a setting (the preferences dialog, the HUD gear). Resolves false when unavailable. */
export async function setSetting(key, value) {
  const decl = SETTINGS[key];
  if (!decl) throw new Error(`settings: "${key}" is not a ShadowBase setting`);
  try { await globalThis.game?.settings?.set(SYSTEM_ID, key, coerce(decl, value)); return true; } catch { return false; }
}

/** Cast a raw value through the declaration: booleans from 'true'/'on'/true, depths to a listed choice, else the default. */
export function coerce(decl, v) {
  if (v === undefined || v === null) return decl.default;
  if (decl.type === Boolean) return v === true || v === 'true' || v === 'on' || v === 1;
  if (decl.type === Number) {
    const n = Number(v);
    if (!Number.isFinite(n)) return decl.default;
    if (decl.choices && !(String(n) in decl.choices)) return decl.default;
    return n;
  }
  return v;
}

export const enforceEconomy = () => getSetting('enforceEconomy');
export const npcDefaultHidden = () => getSetting('npcDefaultHidden');
export const tokenRotationSync = () => getSetting('tokenRotationSync');
export const keepRollHistory = () => getSetting('keepRollHistory');
/** use-dice-roller.ts depth(): a listed depth, else the website's 10. */
export const rollHistoryDepth = () => getSetting('rollHistoryDepth');
/** use-toast.ts historyLimit: a listed depth, else the website's 12. */
export const notificationDepth = () => getSetting('notificationDepth');

/** The client preferences as one bag (the shape module/apps/actor-sheet.mjs#sheetPrefs spreads). */
export function sheetPreferences() {
  return Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, getSetting(k)]));
}

/** Write several preferences at once (the sheet's preferences dialog); unknown keys are ignored. */
export async function setPreferences(prefs) {
  const wrote = [];
  for (const [k, v] of Object.entries(prefs ?? {})) {
    if (!PREFERENCE_KEYS.includes(k)) continue;
    if (getSetting(k) === coerce(SETTINGS[k], v)) continue; // idempotent: no write for an unchanged value
    wrote.push(k);
    await setSetting(k, v);
  }
  return wrote;
}

// ---------------------------------------------------------------------------
// The root attributes (use-sheet-preferences.ts syncRootAttributes, widened to
// the three attributes styles/sheet.css and components.css read)
// ---------------------------------------------------------------------------

/** attribute name -> 'true' | 'false' for the given (or current) preferences. */
export function preferenceAttributes(prefs = sheetPreferences()) {
  return Object.fromEntries(Object.entries(PREFERENCE_ATTRIBUTES).map(([k, attr]) => [attr, String(!!prefs[k])]));
}

/** Stamp the attributes on an element (an ApplicationV2 root, the sheet's root, a chat card). Returns the element. */
export function applyPreferenceAttributes(root, prefs = sheetPreferences()) {
  if (!root || typeof root.setAttribute !== 'function') return root;
  for (const [attr, value] of Object.entries(preferenceAttributes(prefs))) root.setAttribute(attr, value);
  return root;
}

/**
 * Every open ApplicationV2 root that is a .shadowbase root
 * (foundry.applications.instances: Map<id, ApplicationV2> in v13 - UNVERIFIED
 * headlessly; the shim declares no instances and the loop is skipped).
 */
export function openShadowbaseRoots() {
  const apps = globalThis.foundry?.applications;
  if (!apps || !('instances' in apps)) return [];
  const out = [];
  for (const app of apps.instances.values?.() ?? []) {
    const el = app?.element;
    if (!el || typeof el.setAttribute !== 'function') continue;
    const isOurs = (typeof el.classList?.contains === 'function' && el.classList.contains(SYSTEM_ID)) || app.options?.classes?.includes?.(SYSTEM_ID);
    if (isOurs) out.push({ app, element: el });
  }
  return out;
}

/**
 * A client preference changed: repaint every open .shadowbase root, and for the
 * preferences that are not pure CSS, re-render the actor sheets that show them.
 * Two of those - applyPosture and trackElevation - are read INSIDE
 * prepareDerivedData (module/data/actor-character.mjs passes them to
 * getCalculatedStats), so their effect is baked into the cached
 * actor.system.derived; the actor must be RE-DERIVED before the render, because
 * render() does not re-prepare a document and would otherwise paint stale
 * numbers (Current Dodge, the tactical-effect badges, the roll modifiers). The
 * rest (showPointCosts / showHandbookChips / rememberOpenSections) are read in
 * _prepareContext, so a render alone reflects them; the remaining preferences
 * are CSS-only (the data-* attributes) and need no render at all.
 */
export function refreshPreferenceRoots(changedKey = null) {
  const prefs = sheetPreferences();
  const roots = openShadowbaseRoots();
  // applyPosture folds the posture's Ch9 modifiers into the derived numbers; trackElevation gates the
  // elevation contribution (and shows/hides the field). Both feed getCalculatedStats, so the actor's
  // system.derived is stale until it is re-prepared - a bare render would repaint the old cache.
  const rederive = changedKey === 'applyPosture' || changedKey === 'trackElevation';
  const rerender = rederive || changedKey === 'showPointCosts' || changedKey === 'showHandbookChips' || changedKey === 'rememberOpenSections';
  for (const { app, element } of roots) {
    applyPreferenceAttributes(element, prefs);
    if (!rerender || app.document?.documentName !== 'Actor' || typeof app.render !== 'function') continue;
    // Re-derive first (prepareData re-runs prepareDerivedData over the unchanged source), then render the
    // fresh system.derived. reset() would do the same in a running client but also discards source edits.
    if (rederive && typeof app.document.prepareData === 'function') { try { app.document.prepareData(); } catch { /* a document mid-teardown */ } }
    try { app.render(); } catch { /* a sheet mid-close */ }
  }
  return roots.length;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let registered = false;

/**
 * game.settings.register for every declaration (init). Idempotent: Foundry
 * throws on a duplicate registration and the headless harness calls the init
 * path more than once.
 */
export function registerSettings() {
  if (registered) return SETTING_KEYS;
  const settings = globalThis.game?.settings;
  if (!settings || typeof settings.register !== 'function') return [];
  for (const key of SETTING_KEYS) {
    const decl = SETTINGS[key];
    const config = { name: decl.name, hint: decl.hint, scope: decl.scope, config: true, type: decl.type, default: decl.default };
    if (decl.choices) config.choices = decl.choices;
    if (decl.preference) config.onChange = () => refreshPreferenceRoots(key);
    settings.register(SYSTEM_ID, key, config);
  }
  registered = true;
  return SETTING_KEYS;
}

/** For the checks: forget the registration guard (the shim keeps its own table). */
export function _resetRegistration() { registered = false; }

// ---------------------------------------------------------------------------
// tokenRotationSync: system.facing <-> TokenDocument.rotation
// ---------------------------------------------------------------------------

/**
 * A hexside as a token rotation. Foundry rotates clockwise in degrees from the
 * art's default orientation; module/helpers/facing-hex.mjs puts hexside k at
 * k x 60 degrees clockwise from straight up. ASSUMPTION: the token art faces UP
 * at rotation 0 (the usual top-down convention), so the two agree without an
 * offset - a table whose art faces another way turns the setting off.
 */
export function rotationForFacing(facing) {
  const f = Number(facing);
  if (!Number.isInteger(f)) return null;
  return (((f % 6) + 6) % 6) * DEGREES_PER_HEXSIDE;
}

/** A token rotation as the nearest hexside (0-5); 30 degrees either side of a hexside rounds to it. */
export function facingForRotation(rotation) {
  const r = Number(rotation);
  if (!Number.isFinite(r)) return null;
  return Math.round((((r % 360) + 360) % 360) / DEGREES_PER_HEXSIDE) % 6;
}

/**
 * The TokenDocuments a facing change should turn: an unlinked token actor's own
 * token, else the actor's linked tokens on the active scene
 * (Actor#getActiveTokens(linked, document) - UNVERIFIED headlessly; the shim
 * declares no tokens and a check injects `getActiveTokens`).
 */
export function tokensToRotate(actor) {
  if (!actor) return [];
  if (actor.isToken && actor.token) return [actor.token];
  if (typeof actor.getActiveTokens !== 'function') return [];
  try { return actor.getActiveTokens(true, true) ?? []; } catch { return []; }
}

/** Marker on the update options that stops the mirror hook from writing back (both hooks skip it). */
export const SYNC_OPTION = 'shadowbaseFacingSync';

/** updateActor: a stored facing change turns the actor's tokens (the writing client only; idempotent). */
export async function onUpdateActorFacing(actor, changes, options, userId) {
  if (!tokenRotationSync()) return [];
  if (options?.[SYNC_OPTION]) return [];
  if (userId !== globalThis.game?.userId) return [];
  if (actor?.type !== 'character' || changes?.system?.facing === undefined) return [];
  const rotation = rotationForFacing(actor.system?.facing);
  if (rotation === null) return [];
  const turned = [];
  for (const token of tokensToRotate(actor)) {
    if (Number(token?.rotation) === rotation) continue;
    if (typeof token?.update !== 'function') continue;
    await token.update({ rotation }, { [SYNC_OPTION]: true });
    turned.push(token);
  }
  return turned;
}

/** updateToken: a token turned by hand writes the nearest hexside back to its actor (the writing client only; idempotent). */
export async function onUpdateTokenRotation(tokenDoc, changes, options, userId) {
  if (!tokenRotationSync()) return false;
  if (options?.[SYNC_OPTION]) return false;
  if (userId !== globalThis.game?.userId) return false;
  if (changes?.rotation === undefined) return false;
  const actor = tokenDoc?.actor;
  if (!actor || actor.type !== 'character') return false;
  const facing = facingForRotation(tokenDoc.rotation);
  if (facing === null || Number(actor.system?.facing) === facing) return false;
  await actor.update({ 'system.facing': facing }, { [SYNC_OPTION]: true });
  return true;
}

let hooksInstalled = false;

/** The two mirror hooks (init). Idempotent. */
export function registerSettingsHooks() {
  if (hooksInstalled) return false;
  const Hooks = globalThis.Hooks;
  if (!Hooks?.on) return false;
  Hooks.on('updateActor', (actor, changes, options, userId) => { onUpdateActorFacing(actor, changes, options, userId).catch((e) => console.warn(`${SYSTEM_ID} | facing -> token rotation`, e)); });
  Hooks.on('updateToken', (tokenDoc, changes, options, userId) => { onUpdateTokenRotation(tokenDoc, changes, options, userId).catch((e) => console.warn(`${SYSTEM_ID} | token rotation -> facing`, e)); });
  hooksInstalled = true;
  return true;
}

/** The namespace game.shadowbase.settings carries. */
export const settings = Object.freeze({
  SYSTEM_ID, SETTINGS, SETTING_KEYS, PREFERENCE_KEYS, PREFERENCE_ATTRIBUTES, ROLL_HISTORY_DEPTHS, NOTIFICATION_DEPTHS, DEGREES_PER_HEXSIDE, SYNC_OPTION,
  registerSettings, registerSettingsHooks,
  getSetting, setSetting, coerce,
  enforceEconomy, npcDefaultHidden, tokenRotationSync, keepRollHistory, rollHistoryDepth, notificationDepth,
  sheetPreferences, setPreferences, preferenceAttributes, applyPreferenceAttributes, openShadowbaseRoots, refreshPreferenceRoots,
  rotationForFacing, facingForRotation, tokensToRotate, onUpdateActorFacing, onUpdateTokenRotation,
});

export default settings;
