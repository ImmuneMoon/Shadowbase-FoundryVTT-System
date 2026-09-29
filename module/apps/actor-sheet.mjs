// module/apps/actor-sheet.mjs
//
// ShadowBaseActorSheet (docs/ARCHITECTURE.md §6.1; docs/STYLE-SPEC.md §3 is the
// section inventory it renders). ApplicationV2 + HandlebarsApplicationMixin
// over ActorSheetV2: PARTS header / tabs / info / body / abilities / inventory
// / vehicles, TABS = the website's five tabs, every data-action a static
// handler in `actions`.
//
// What this file decides: NOTHING about a rule. Every figure on the sheet is
// read off `actor.system.derived` (the engine's CalculatedStatsResult) or
// asked of an engine namespace by name; every mutation the website performs
// as a side effect of an edit (the alignment mirror, the SM derived from a
// height, the credits a CP trade buys, the language projection, a species
// swap) is ported with the website file and lines it came from, and calls the
// same engine function the website calls. Where a website figure needs an
// export the bundle does not carry yet (attribute-charging.ts's per-card point
// costs), the sheet shows the total from stats.points and leaves the card's
// cost line off until the export lands (docs/REQUESTS.md, U05 -> orchestrator).
//
// Foundry facts assumed here and marked where the headless shim cannot prove
// them: ActorSheetV2's `_onDropItem(event, item)` receives the Item DOCUMENT in
// v13 (it received data in v12) - both are handled; FormDataExtended casts
// `data-dtype="Number"` inputs (blank -> null is applied here regardless);
// `_prepareTabs(group)` returns the per-tab records; `this.changeTab(id, group)`
// switches a tab group. See tools/foundry-shim.mjs for the modelled surface.

import { engine } from '../engine.mjs';
import { ICONS, LUCIDE_FA, ITEM_TYPES } from '../config.mjs';
import { rowToItemData } from '../adapter.mjs';
import { NULLABLE_NUMBER_FIELDS, FIELD_TABLE } from '../data/actor-schema.generated.mjs';
import { facingHexModel } from '../helpers/facing-hex.mjs';
// Wave 5 (U10): the client preferences are game.settings (module/settings.mjs); only pinPools / pinPoints stay user flags.
import { sheetPreferences, setPreferences, applyPreferenceAttributes } from '../settings.mjs';
// Unit U06's four tabs (docs/REQUESTS.md U06 -> U05): the part contexts, the templates and partials,
// the data-action handlers, the form-pipeline hooks; and the importer (handleFileDrop, exportJson).
import * as tabs from './actor-sheet-tabs.mjs';
import * as importExport from '../import-export.mjs';

export const SYSTEM_ID = 'shadowbase';
const TEMPLATES = `systems/${SYSTEM_ID}/templates/actor`;

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message) => globalThis.ui?.notifications?.[level]?.(message);
const utils = () => globalThis.foundry?.utils;
const deepClone = (v) => (utils()?.deepClone ? utils().deepClone(v) : structuredClone(v));
const sortDensity = () => globalThis.CONST?.SORT_INTEGER_DENSITY ?? 100000;

/** foundry.applications.* resolved LATE so the module loads headlessly before the shim's AppV2 layer is installed. */
function appsApi() {
  const apps = globalThis.foundry?.applications;
  if (!apps) throw new Error('shadowbase actor-sheet: foundry.applications is not available (install tools/foundry-shim.mjs first)');
  return apps;
}
const BaseSheet = (() => {
  const apps = appsApi();
  const mixin = apps.api?.HandlebarsApplicationMixin;
  const ActorSheetV2 = apps.sheets?.ActorSheetV2;
  if (typeof mixin !== 'function' || typeof ActorSheetV2 !== 'function') {
    throw new Error('shadowbase actor-sheet: foundry.applications.api.HandlebarsApplicationMixin / foundry.applications.sheets.ActorSheetV2 are required (Foundry v13)');
  }
  return mixin(ActorSheetV2);
})();

// ---------------------------------------------------------------------------
// The section inventory of the Info tab (docs/STYLE-SPEC.md §3.3; templates/actor/README.md is the checklist)
// ---------------------------------------------------------------------------

/** id, title key, lucide icon (through LUCIDE_FA), handbook chip registry id. */
// The persistent dashboard above the tabs (templates/actor/dashboard.hbs), mirroring
// shadow-base.com where these three sit above the tabs, always visible. Moved out of
// the Info tab 2026-09-19.
export const DASHBOARD_SECTIONS = Object.freeze([
  { id: 'resource-pools', label: 'SHADOWBASE.Sheet.Info.ResourcePools', icon: 'HeartPulse', chip: null },
  { id: 'combat-state', label: 'SHADOWBASE.Sheet.Info.CombatState', icon: 'Timer', chip: 'combat-damage' },
  { id: 'force-alignment', label: 'SHADOWBASE.Sheet.Info.ForceAlignment', icon: 'Sun', chip: 'force-alignment-forms' },
]);

export const INFO_SECTIONS = Object.freeze([
  { id: 'basic-info', label: 'SHADOWBASE.Sheet.Info.BasicInfo', icon: 'User', chip: null },
  { id: 'primary-attributes', label: 'SHADOWBASE.Sheet.Info.PrimaryAttributes', icon: 'Dices', chip: 'core-system-attributes' },
  { id: 'secondary-characteristics', label: 'SHADOWBASE.Sheet.Info.SecondaryCharacteristics', icon: 'Activity', chip: 'core-system-attributes' },
  { id: 'languages', label: 'SHADOWBASE.Sheet.Info.Languages', icon: 'Globe', chip: 'traits-skills' },
  { id: 'encumbrance', label: 'SHADOWBASE.Sheet.Info.Encumbrance', icon: 'Weight', chip: 'combat-damage' },
  { id: 'character-details', label: 'SHADOWBASE.Sheet.Info.CharacterDetails', icon: 'Ruler', chip: null },
  { id: 'narrative', label: 'SHADOWBASE.Sheet.Info.Narrative', icon: 'PenLine', chip: null },
  { id: 'point-ledger', label: 'SHADOWBASE.Sheet.Info.PointLedger', icon: 'Calculator', chip: 'core-system-attributes' },
]);

/** primary-attributes-section.tsx:35-48 */
const PRIMARIES = Object.freeze([
  { key: 'strength', label: 'ST', baseline: 'stBaseline', raw: 'rawStrength', effective: 'effectiveStrength', roll: 'st' },
  { key: 'dexterity', label: 'DX', baseline: 'dxBaseline', raw: 'rawDexterity', effective: 'effectiveDexterity', roll: 'dx' },
  { key: 'iq', label: 'IQ', baseline: 'iqBaseline', raw: 'rawIQ', effective: 'effectiveIQ', roll: 'iq' },
  { key: 'health', label: 'HT', baseline: 'htBaseline', raw: 'rawHealth', effective: 'effectiveHealth', roll: 'ht' },
]);

/**
 * secondary-characteristics-section.tsx:50-65, in the dependency order
 * orderByDependency (lines 81-102) produces: every characteristic after the
 * one it derives from.
 */
const SECONDARIES = Object.freeze([
  { name: 'hitPoints', label: 'SHADOWBASE.Sheet.Char.HitPoints', source: 'strength', costKey: 'HP_PER_POINT', editable: true },
  { name: 'endurancePoints', label: 'SHADOWBASE.Sheet.Char.EndurancePoints', source: 'health', costKey: 'EP_PER_POINT', editable: true },
  { name: 'will', label: 'SHADOWBASE.Sheet.Char.Will', source: 'iq', costKey: 'WILL_PER_POINT', editable: true, rollable: true },
  { name: 'forcePoints', label: 'SHADOWBASE.Sheet.Char.ForcePoints', source: 'will', costKey: 'FP_PER_POINT', editable: true, effectiveKey: 'maxForcePoints' },
  { name: 'basicSpeed', label: 'SHADOWBASE.Sheet.Char.BasicSpeed', source: 'basicSpeed', costKey: 'BASIC_SPEED_PER_QUARTER_POINT', editable: true, isFloat: true },
  { name: 'basicMove', label: 'SHADOWBASE.Sheet.Char.BasicMove', source: 'basicMove', costKey: 'BASIC_MOVE_PER_POINT', editable: true },
  { name: 'perception', label: 'SHADOWBASE.Sheet.Char.Perception', source: 'iq', costKey: 'PER_PER_POINT', editable: true, rollable: true },
  { name: 'frightCheck', label: 'SHADOWBASE.Sheet.Char.FrightCheck', source: 'will', costKey: 'FRIGHT_CHECK_PER_POINT', editable: true, rollable: true },
  { name: 'vision', label: 'SHADOWBASE.Sheet.Char.Vision', source: 'perception', costKey: 'SENSE_PER_POINT', editable: true, rollable: true },
  { name: 'hearing', label: 'SHADOWBASE.Sheet.Char.Hearing', source: 'perception', costKey: 'SENSE_PER_POINT', editable: true, rollable: true },
  { name: 'tasteAndSmell', label: 'SHADOWBASE.Sheet.Char.TasteAndSmell', source: 'perception', costKey: 'SENSE_PER_POINT', editable: true, rollable: true },
  { name: 'touch', label: 'SHADOWBASE.Sheet.Char.Touch', source: 'perception', costKey: 'SENSE_PER_POINT', editable: true, rollable: true },
  { name: 'damageThrust', label: 'SHADOWBASE.Sheet.Char.DamageThrust', source: 'strength', editable: false },
  { name: 'damageSwing', label: 'SHADOWBASE.Sheet.Char.DamageSwing', source: 'strength', editable: false },
]);
/** secondary-characteristics-section.tsx:104-119 */
const SOURCE_LABELS = Object.freeze({ strength: 'ST', dexterity: 'DX', iq: 'IQ', health: 'HT', will: 'Will', perception: 'Per', basicSpeed: '(DX+HT)/4', basicMove: 'floor((ST+DX)/4)' });
/** secondary-characteristics-section.tsx:142-154 */
const DROID_SOURCE_LABELS = Object.freeze({ hitPoints: 'Chassis', basicMove: 'Motive', will: 'Processor', perception: 'Processor', vision: 'Processor', hearing: 'Processor', tasteAndSmell: 'Processor', touch: 'Processor', frightCheck: 'Processor', endurancePoints: 'N/A', forcePoints: 'N/A' });

/**
 * The user's sheet preferences (never on the character - use-sheet-preferences.ts).
 * The website's SheetPreferences are CLIENT SETTINGS (module/settings.mjs, unit
 * U10: showHandbookChips, stickySectionHeaders, showPointCosts, reduceMotion,
 * compactRows, rememberOpenSections, keepRollHistory, the two depths); the two
 * pins the header adds (pinPools / pinPoints) are a user flag, as before.
 */
export const PREF_DEFAULTS = Object.freeze({ showHandbookChips: true, stickySectionHeaders: true, showPointCosts: true, reduceMotion: false, compactRows: false, rememberOpenSections: false, pinPools: false, pinPoints: false });
/** The keys the preferences dialog offers (sheet-preference-controls.tsx's Display + Behaviour groups, the subset the sheet reads). */
export const PREF_DIALOG_KEYS = Object.freeze(['showHandbookChips', 'showPointCosts', 'compactRows', 'stickySectionHeaders', 'reduceMotion', 'rememberOpenSections']);

function userFlag(key) {
  const user = globalThis.game?.user;
  const flags = user?.flags?.[SYSTEM_ID] ?? (typeof user?.getFlag === 'function' ? { [key]: user.getFlag(SYSTEM_ID, key) } : {});
  return flags?.[key];
}
export function sheetPrefs() {
  const flag = userFlag('sheetPrefs') ?? {};
  // The settings win over a flag written before wave 5 (the same keys lived in the flag then).
  return { ...PREF_DEFAULTS, pinPools: !!flag.pinPools, pinPoints: !!flag.pinPoints, ...sheetPreferences() };
}
async function setUserFlag(key, value) {
  const user = globalThis.game?.user;
  if (typeof user?.setFlag === 'function') return user.setFlag(SYSTEM_ID, key, value);
  return null;
}
/** Persist a preferences bag: the settings-backed keys through game.settings, the pins on the user flag. */
async function savePrefs(next) {
  await setPreferences(next);
  const pins = { pinPools: !!next.pinPools, pinPoints: !!next.pinPoints };
  await setUserFlag('sheetPrefs', pins);
  const user = globalThis.game?.user;
  if (user?.flags) { user.flags[SYSTEM_ID] ??= {}; user.flags[SYSTEM_ID].sheetPrefs = pins; }
  return next;
}

// ---------------------------------------------------------------------------
// Row reconciliation (the website writes whole arrays; Foundry writes Items)
// ---------------------------------------------------------------------------

/**
 * Bring the Items of one website array in line with `nextRows` - the array an
 * engine function handed back (adjustCredits, swapSpecies, grantDroidBaseline,
 * carrySkillLevels...). A row is the SAME item when it is the very object the
 * item holds (untouched rows come back by reference) or carries the same `id`
 * (a modified copy); anything else is new; an item whose row is gone is
 * deleted. Row keys the new copy dropped are deleted with `-=`.
 * @param {object} actor
 * @param {string} source one of CHARACTER_FORM_ARRAY_KEYS
 * @param {object[]} nextRows
 */
export async function reconcileRows(actor, source, nextRows) {
  const items = actor.rowsOf(source);
  const byRef = new Map(items.map((i) => [i.system.row, i]));
  const byId = new Map(items.filter((i) => i.system.row?.id).map((i) => [i.system.row.id, i]));
  const keep = new Set();
  const updates = [];
  const creates = [];
  (nextRows ?? []).forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const item = byRef.get(row) ?? (row.id ? byId.get(row.id) : null);
    if (!item) { creates.push(rowToItemData(row, source, (index + 1) * sortDensity())); return; }
    keep.add(item.id);
    if (item.system.row === row) return;
    const changes = { _id: item.id, system: { row: deepClone(row) } };
    for (const k of Object.keys(item.system.row ?? {})) if (!(k in row)) changes.system.row[`-=${k}`] = null;
    updates.push(changes);
  });
  const deletes = items.filter((i) => !keep.has(i.id)).map((i) => i.id);
  if (deletes.length) await actor.deleteEmbeddedDocuments('Item', deletes);
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  if (creates.length) await actor.createEmbeddedDocuments('Item', creates);
  return { created: creates.length, updated: updates.length, deleted: deletes.length };
}

/** The stored rows of one array, BY REFERENCE (so an engine function's untouched rows come back identical). */
const rowsRef = (actor, source) => actor.rowsOf(source).map((i) => i.system.row);

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export class ShadowBaseActorSheet extends BaseSheet {
  static DEFAULT_OPTIONS = {
    classes: ['shadowbase', 'sheet', 'actor'],
    position: { width: 960, height: 900 },
    window: {
      resizable: true,
      // The whole CSS is scoped under `.sb-sheet` (styles/sheet.css: `.sb-sheet .tab`
      // gets the tab padding the sticky section-header bleed needs). ApplicationV2
      // renders the PARTS straight into `.window-content` with no wrapper of ours,
      // so the class must ride the content element itself, or every `.sb-sheet …`
      // rule silently misses and the sections overflow their panel.
      contentClasses: ['sb-sheet'],
      // Import / Export / HUD / Preferences live in the in-content header bar
      // (templates/actor/header.hbs), exactly as the website presents them. They
      // are NOT also window-frame controls: v13 put those inline in the title bar,
      // v14 collapses them into the "⋮" menu, and either way it duplicates the
      // header bar and reads as clutter the website does not have.
    },
    form: { submitOnChange: true, closeOnSubmit: false },
    dragDrop: [{ dragSelector: '.draggable', dropSelector: null }],
    actions: {
      // U06's tab handlers first; the header / Info handlers below win on a name clash.
      ...(tabs.TAB_ACTIONS ?? {}),
      'roll-attribute': ShadowBaseActorSheet.#onRollAttribute,
      'roll-characteristic': ShadowBaseActorSheet.#onRollCharacteristic,
      'roll-skill': ShadowBaseActorSheet.#onRollSkill,
      'open-hud': ShadowBaseActorSheet.#onOpenHud,
      'import-json': ShadowBaseActorSheet.#onImportJson,
      'export-json': ShadowBaseActorSheet.#onExportJson,
      'open-preferences': ShadowBaseActorSheet.#onOpenPreferences,
      'edit-portrait': ShadowBaseActorSheet.#onEditPortrait,
      'edit-item': ShadowBaseActorSheet.#onEditItem,
      'delete-item': ShadowBaseActorSheet.#onDeleteItem,
      'create-item': ShadowBaseActorSheet.#onCreateItem,
      'toggle-equipped': ShadowBaseActorSheet.#onToggleEquipped,
      'reset-pool': ShadowBaseActorSheet.#onResetPool,
      'reset-all-pools': ShadowBaseActorSheet.#onResetAllPools,
      'pin-pools': ShadowBaseActorSheet.#onPinPools,
      'pin-points': ShadowBaseActorSheet.#onPinPoints,
      'adjust-turn': ShadowBaseActorSheet.#onAdjustTurn,
      'reset-turn': ShadowBaseActorSheet.#onResetTurn,
      'sweep-turn': ShadowBaseActorSheet.#onSweepTurn,
      'set-facing': ShadowBaseActorSheet.#onSetFacing,
      'cycle-threat': ShadowBaseActorSheet.#onCycleThreat,
      'toggle-engaged': ShadowBaseActorSheet.#onToggleEngaged,
      'turn-to-face': ShadowBaseActorSheet.#onTurnToFace,
      'set-alignment': ShadowBaseActorSheet.#onSetAlignment,
      'add-language': ShadowBaseActorSheet.#onAddLanguage,
      'add-native-language': ShadowBaseActorSheet.#onAddNativeLanguage,
      'remove-language': ShadowBaseActorSheet.#onRemoveLanguage,
      'toggle-droid': ShadowBaseActorSheet.#onToggleDroid,
      'apply-sm': ShadowBaseActorSheet.#onApplySm,
      'swap-species': ShadowBaseActorSheet.#onSwapSpecies,
      'open-handbook': ShadowBaseActorSheet.#onOpenHandbook,
      'open-effects': ShadowBaseActorSheet.#onOpenEffects,
      'jump-section': ShadowBaseActorSheet.#onJumpSection,
      'step-number': ShadowBaseActorSheet.#onStepNumber,
      // U06 names the header buttons importCharacter / exportCharacter; both spellings reach the same handlers.
      importCharacter: ShadowBaseActorSheet.#onImportJson,
      exportCharacter: ShadowBaseActorSheet.#onExportJson,
    },
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    // The persistent combat dashboard, above the tabs, mirroring shadow-base.com
    // (Resource Pools / Combat State + Facing / Force Alignment always visible).
    dashboard: { template: `${TEMPLATES}/dashboard.hbs`, scrollable: [''] },
    tabs: { template: `${TEMPLATES}/tabs.hbs` },
    info: { template: `${TEMPLATES}/info.hbs`, scrollable: [''] },
    body: { template: tabs.TAB_TEMPLATES?.parts?.body ?? `${TEMPLATES}/body.hbs`, scrollable: [''] },
    abilities: { template: tabs.TAB_TEMPLATES?.parts?.abilities ?? `${TEMPLATES}/abilities.hbs`, scrollable: [''] },
    inventory: { template: tabs.TAB_TEMPLATES?.parts?.inventory ?? `${TEMPLATES}/inventory.hbs`, scrollable: [''] },
    vehicles: { template: tabs.TAB_TEMPLATES?.parts?.vehicles ?? `${TEMPLATES}/vehicles.hbs`, scrollable: [''] },
  };

  /** character-form.tsx:578-582: Info / Body / Abilities / Inventory / Vehicles, with the website's icons. */
  static TABS = {
    primary: {
      tabs: [
        { id: 'info', icon: ICONS.info, label: 'SHADOWBASE.Sheet.Tabs.Info' },
        { id: 'body', icon: ICONS.body, label: 'SHADOWBASE.Sheet.Tabs.Body' },
        { id: 'abilities', icon: ICONS.abilities, label: 'SHADOWBASE.Sheet.Tabs.Abilities' },
        { id: 'inventory', icon: ICONS.inventory, label: 'SHADOWBASE.Sheet.Tabs.Inventory' },
        { id: 'vehicles', icon: ICONS.vehicles, label: 'SHADOWBASE.Sheet.Tabs.Vehicles' },
      ],
      initial: 'info',
    },
  };

  /** The four tab parts U06 owns (module/apps/actor-sheet-tabs.mjs builds their context when it exists). */
  static TAB_PARTS = Object.freeze(['body', 'abilities', 'inventory', 'vehicles']);

  /** Embedded-item updates extracted by _processFormData, applied by _processSubmitData. */
  #pendingItemUpdates = [];

  get actor() { return this.document; }

  /** U06's per-tab context builder for a part (bodyContext / abilitiesContext / ...), or null. */
  static tabBuilder(partId) {
    const fn = tabs[`${partId}Context`];
    return typeof fn === 'function' ? fn : null;
  }

  // ---- context ------------------------------------------------------------------------------------

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const stats = actor.stats ?? null;
    const sheet = actor.sheetData ?? null;
    const prefs = sheetPrefs();
    const isDroid = !!system.isDroid;
    Object.assign(context, {
      actor,
      system,
      source: actor._source?.system ?? system?._source ?? {},
      stats,
      sheet,
      isDroid,
      editable: this.isEditable,
      owner: !!(actor.isOwner ?? true),
      engineError: system.engineError ?? null,
      prefs,
      icons: ICONS,
      lucide: LUCIDE_FA,
      tabs: this._prepareTabs('primary'),
      sections: INFO_SECTIONS.map((s) => ({ ...s, title: loc(s.label), icon: LUCIDE_FA[s.icon] ?? s.icon, chipTitle: s.chip ? chipTitle(s.chip) : '' })),
      chips: Object.fromEntries(Object.keys(engine.handbookRegistry?.HANDBOOK_CHIP_TARGETS ?? {}).map((id) => [id, chipTitle(id)])),
      pools: poolsContext(system, stats, isDroid),
    });
    context.header = headerContext(actor, system, stats, prefs, context.pools);
    context.info = infoContext(actor, system, stats, sheet, prefs, isDroid);
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    if (ShadowBaseActorSheet.TAB_PARTS.includes(partId)) {
      // U06: `{ ...context, ...bodyContext(this.document) }` - the tab's own keys merged over the sheet's.
      const builder = ShadowBaseActorSheet.tabBuilder(partId);
      if (builder) context = { ...context, ...(await builder(this.document)) };
      else context[partId] = { placeholder: true, title: context.tab?.label ?? partId };
    }
    return context;
  }

  // ---- form pipeline ------------------------------------------------------------------------------

  /**
   * DocumentSheetV2's hook between the FormDataExtended object and the update:
   *  - `items.<id>.row.<key>` entries leave the actor update and become embedded
   *    updates (Foundry validates `submitData` against the Actor schema, where an
   *    `items` object is not a collection);
   *  - blank number inputs become null for the engine's null-means-derive /
   *    null-means-full fields (character-form-schema.ts blankToNull; the
   *    generator's NULLABLE_NUMBER_FIELDS) and are DROPPED for every other number
   *    field (a non-nullable NumberField would clean a null to its initial);
   *  - `system.languageEntries` (an index-keyed object from the inputs) is
   *    rebuilt as the whole array over the stored entries, because an ArrayField
   *    update replaces the array and the inputs carry only the edited keys.
   * Skill levels stay strings: their inputs carry no data-dtype.
   */
  _processFormData(event, form, formData) {
    const raw = formData?.object ?? formData ?? {};
    let data = utils()?.expandObject ? utils().expandObject(raw) : expandObject(raw);
    this.#pendingItemUpdates = [];
    if (typeof tabs.extractTabSubmitData === 'function') {
      // U06's hook: `items.<id>.row.<key>`, the whole-array rewrites (hitLocations / storageBoxes / starshipSystems)
      // and the catalog re-read a level change implies. It hands back the actor data and the item updates.
      const extracted = tabs.extractTabSubmitData(this.actor, data);
      data = extracted.data ?? data;
      this.#pendingItemUpdates = Array.isArray(extracted.itemUpdates) ? extracted.itemUpdates : [];
    }
    const items = data.items;
    delete data.items;
    if (items && typeof items === 'object') {
      for (const [id, changes] of Object.entries(items)) {
        if (!this.actor.items?.get?.(id)) continue;
        this.#pendingItemUpdates.push({ _id: id, ...flattenObject(changes) });
      }
    }
    const system = data.system ?? {};
    for (const [key, value] of Object.entries(system)) {
      const blank = value === '' || value === null || (typeof value === 'number' && Number.isNaN(value));
      if (NULLABLE_NUMBER_FIELDS.includes(key)) { if (blank) system[key] = null; continue; }
      if (FIELD_TABLE[key]?.kind === 'number' && blank) delete system[key];
    }
    if (system.languageEntries && !Array.isArray(system.languageEntries)) {
      system.languageEntries = mergeLanguageEntries(this.actor.system.languageEntries ?? [], system.languageEntries);
    }
    data.system = system;
    return data;
  }

  /**
   * The actor update, the embedded updates, then the website's on-change side
   * effects (each cited to the component that performs it):
   *  - forceAlignment -> lightSidePoints / darkSidePoints mirror (basic-info-section.tsx:62-83);
   *  - height typed -> sizeModifier derived (character-details-section.tsx applySizeModifierFromHeight), organics only;
   *  - languageEntries -> `languages` re-projected through the one home (languages-panel.tsx commit, :66-70);
   *  - cpTradedForCredits -> the delta of credits moves on the Currencies rows (basic-info-section.tsx:216-226);
   *  - cpCreditsForm -> an existing payout moves between forms (basic-info-section.tsx:241-248);
   *  - species -> the species swap (species-field.tsx:62-150) - through the swap-species action's port.
   */
  async _processSubmitData(event, form, submitData, options) {
    const actor = this.actor;
    const before = {
      forceAlignment: actor.system.forceAlignment,
      height: actor.system.height,
      cpTraded: actor.system.cpTradedForCredits,
      creditForm: actor.system.cpCreditsForm,
      species: actor.system.species,
    };
    const sys = submitData.system ?? {};
    // Alignment mirror, applied inside the same update so the two never disagree for a render.
    if ('forceAlignment' in sys) {
      const val = Number(sys.forceAlignment) || 0;
      sys.forceAlignment = Math.max(-100, Math.min(100, val));
      sys.lightSidePoints = sys.forceAlignment > 0 ? sys.forceAlignment : 0;
      sys.darkSidePoints = sys.forceAlignment < 0 ? Math.abs(sys.forceAlignment) : 0;
    }
    // Height -> SM (organics; a droid's SM derives from its build).
    if ('height' in sys && sys.height !== before.height && !actor.system.isDroid) {
      const derived = engine.sizeModifier.sizeModifierForHeight(sys.height);
      if (derived != null) sys.sizeModifier = derived;
    }
    // Language projection.
    if (Array.isArray(sys.languageEntries)) {
      const lr = engine.languageRows;
      sys.languages = lr.projectLanguagesField(sys.languageEntries, lr.retainedLegacyEntries(actor.system.languages, sys.languageEntries));
    }
    // A species typed into the header: the swap runs INSTEAD of a plain write (it writes species itself).
    const speciesTyped = 'species' in sys && String(sys.species ?? '').trim() !== String(before.species ?? '').trim();
    if (speciesTyped) delete sys.species;
    submitData.system = sys;

    await actor.update(submitData, options);
    if (this.#pendingItemUpdates.length) {
      const pending = this.#pendingItemUpdates;
      this.#pendingItemUpdates = [];
      if (typeof tabs.applyItemUpdates === 'function') await tabs.applyItemUpdates(actor, pending);
      else await actor.updateEmbeddedDocuments('Item', pending);
    }

    // CP traded for credits: only the difference moves (basic-info-section.tsx:216-226).
    if ('cpTradedForCredits' in sys) {
      const w = engine.wealth;
      const next = w.cpSpentOnCredits(sys.cpTradedForCredits);
      const prev = w.cpSpentOnCredits(before.cpTraded);
      if (next !== prev) {
        const form = actor.system.cpCreditsForm ?? w.DEFAULT_CREDIT_FORM;
        const delta = w.creditsFromCp(next) - w.creditsFromCp(prev);
        await reconcileRows(actor, 'equipment', w.adjustCredits(rowsRef(actor, 'equipment'), delta, form, engine.rowId));
      }
      if (next !== Number(sys.cpTradedForCredits)) await actor.update({ 'system.cpTradedForCredits': next });
    }
    // Switching the payout form moves the held credits across (basic-info-section.tsx:241-248).
    if ('cpCreditsForm' in sys && sys.cpCreditsForm !== before.creditForm) {
      const w = engine.wealth;
      const held = w.creditsFromCp(actor.system.cpTradedForCredits);
      if (held > 0) await reconcileRows(actor, 'equipment', w.moveCreditsBetweenForms(rowsRef(actor, 'equipment'), held, before.creditForm ?? w.DEFAULT_CREDIT_FORM, sys.cpCreditsForm, engine.rowId));
    }
    if (speciesTyped) await applySpeciesSwap(actor, String(raw(form, 'system.species') ?? '').trim());
  }

  // ---- drag and drop --------------------------------------------------------------------------------

  /** A `.json` file dropped anywhere on the sheet is a character import (ARCHITECTURE §6.1; module/import-export.mjs handleFileDrop). */
  async _onDrop(event) {
    if (typeof importExport.handleFileDrop === 'function') {
      const handled = await importExport.handleFileDrop(this.actor, event);
      if (handled) return handled;
    } else {
      const files = event?.dataTransfer?.files;
      if (files && files.length && /\.json$/i.test(files[0].name ?? '')) {
        event.preventDefault?.();
        return importJsonText(this.actor, await files[0].text());
      }
    }
    return super._onDrop(event);
  }

  /**
   * Compendium Items go through module/compendium-drop.mjs (kits deal their
   * parts, per-name powers create the level-1 row). v13 hands the Item
   * document; v12-style data is resolved through fromUuid for safety.
   */
  async _onDropItem(event, itemOrData) {
    const item = await resolveDocument(itemOrData, 'Item');
    const drop = globalThis.game?.shadowbase?.compendiumDrop;
    if (item && drop && (drop.isCatalogItem?.(item) || (item.pack && drop.isCompendiumUuid?.(item.uuid)))) {
      return drop.handleItemDrop(this.actor, item);
    }
    return super._onDropItem(event, itemOrData);
  }

  /** A template Actor dropped on the sheet replaces it (with confirmation) - compendium-drop.mjs handleActorDrop. */
  async _onDropActor(event, actorOrData) {
    const dropped = await resolveDocument(actorOrData, 'Actor');
    const drop = globalThis.game?.shadowbase?.compendiumDrop;
    if (dropped && drop && dropped.pack && drop.isCompendiumUuid?.(dropped.uuid)) return drop.handleActorDrop(this.actor, dropped);
    return super._onDropActor(event, actorOrData);
  }

  // ---- render -----------------------------------------------------------------------------------------

  /**
   * After every render: the preference attributes on the root (STYLE-SPEC §5),
   * the remembered open state of every <details class="sb-section"> (the
   * website's `rememberOpenSections` / OPEN_SECTIONS_KEY, here a user flag per
   * actor storing the CLOSED ones so a new section opens by default), and the
   * range -> number mirror of the alignment slider.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const prefs = sheetPrefs();
    applyPreferenceAttributes(root, prefs);

    // use-sheet-preferences.ts rememberOpenSections (default false): off, every section opens and nothing is
    // recorded (the website's openAccordions starts empty); on, the CLOSED ones are remembered per actor.
    if (prefs.rememberOpenSections) {
      const closed = new Set((userFlag('closedSections') ?? {})[this.actor.id] ?? []);
      for (const details of root.querySelectorAll('details.sb-section[data-section]')) {
        const id = details.dataset.section;
        details.open = !closed.has(id);
        details.addEventListener('toggle', () => this.#rememberSection(id, details.open));
      }
    }
    const range = root.querySelector('[data-alignment-range]');
    const box = root.querySelector('[data-alignment-value]');
    if (range && box) range.addEventListener('input', () => { box.value = range.value; });
  }

  /** The sheet scrolls as ONE (styles/sheet.css "ONE SCROLLER"): the header and the dashboard scroll away and the tab strip
   *  sticks at the top. A tab opened while the strip is stuck starts at its own top, right under the strip, instead of
   *  wherever the previous tab was scrolled to; while the strip is still in its place nothing moves. */
  changeTab(tab, group, options) {
    const out = super.changeTab(tab, group, options);
    const wc = this.element?.querySelector?.('.window-content');
    const strip = this.element?.querySelector?.('.sb-sheet__tabs');
    const above = strip?.previousElementSibling;
    if (wc && strip && above && group === 'primary') {
      const stripTop = above.getBoundingClientRect().bottom - wc.getBoundingClientRect().top + wc.scrollTop;   // the strip's place in the flow
      if (wc.scrollTop > stripTop) wc.scrollTop = stripTop;
    }
    return out;
  }

  #rememberTimer = null;
  #rememberSection(id, open) {
    const all = { ...(userFlag('closedSections') ?? {}) };
    const list = new Set(all[this.actor.id] ?? []);
    if (open) list.delete(id); else list.add(id);
    all[this.actor.id] = [...list];
    const user = globalThis.game?.user;
    if (user?.flags) { user.flags[SYSTEM_ID] ??= {}; user.flags[SYSTEM_ID].closedSections = all; }
    clearTimeout(this.#rememberTimer);
    this.#rememberTimer = setTimeout(() => { setUserFlag('closedSections', all)?.catch?.(() => {}); }, 400);
  }

  // ---- actions (static; `this` is the sheet) -----------------------------------------------------------

  static async #onRollAttribute(event, target) {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!rolls?.rollAttribute) return notify('warn', loc('SHADOWBASE.Sheet.Notice.RollsUnavailable'));
    return rolls.rollAttribute(this.actor, target.dataset.key);
  }
  static async #onRollCharacteristic(event, target) {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!rolls?.rollCharacteristic) return notify('warn', loc('SHADOWBASE.Sheet.Notice.RollsUnavailable'));
    return rolls.rollCharacteristic(this.actor, target.dataset.key);
  }
  static async #onRollSkill(event, target) {
    const rolls = globalThis.game?.shadowbase?.rolls;
    if (!rolls?.rollSkill) return notify('warn', loc('SHADOWBASE.Sheet.Notice.RollsUnavailable'));
    const name = target.dataset.name ?? this.actor.items.get(target.dataset.itemId ?? '')?.system?.row?.name;
    return rolls.rollSkill(this.actor, name);
  }
  static async #onOpenHud(event, target) {
    const opts = { tab: target?.dataset?.tab };
    const Hud = globalThis.game?.shadowbase?.apps?.TacticalHud;
    if (typeof Hud?.open === 'function') return Hud.open(this.actor, opts);
    try {
      const spec = ['.', 'hud.mjs'].join('/'); // built at runtime: the HUD is unit U07's; check:esm must not require it
      const mod = await import(spec);
      const cls = mod.TacticalHud ?? mod.default;
      if (typeof cls?.open === 'function') return cls.open(this.actor, opts);
    } catch { /* not shipped yet */ }
    return notify('warn', loc('SHADOWBASE.Sheet.Notice.HudUnavailable'));
  }
  static async #onOpenEffects() { return ShadowBaseActorSheet.#onOpenHud.call(this, null, { dataset: { tab: 'status' } }); }
  static async #onImportJson() {
    if (typeof importExport.importFromFilePicker === 'function') return importExport.importFromFilePicker(this.actor);
    return pickJsonFile(this.actor);
  }
  static async #onExportJson() {
    if (typeof importExport.exportJson === 'function') return importExport.exportJson(this.actor);
    const json = this.actor.exportSheet();
    const name = `${String(this.actor.name).replace(/[^\w-]+/g, '_').toLowerCase()}_shadowbase.json`;
    const save = utils()?.saveDataToFile ?? globalThis.saveDataToFile;
    if (typeof save !== 'function') return notify('warn', loc('SHADOWBASE.Sheet.Notice.ExportUnavailable'));
    save(JSON.stringify(json, null, 2), 'application/json', name);
    return notify('info', fmt('SHADOWBASE.Sheet.Notice.Exported', { name }));
  }
  static async #onOpenPreferences() {
    const next = await promptPreferences(sheetPrefs());
    if (!next) return;
    await savePrefs(next);
    return this.render();
  }
  static async #onEditPortrait() {
    const FP = globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (typeof FP !== 'function') return notify('warn', loc('SHADOWBASE.Sheet.Notice.FilePickerUnavailable'));
    const fp = new FP({ type: 'image', current: this.actor.img, callback: (path) => this.actor.update({ img: path }) });
    return fp.browse();
  }
  static async #onEditItem(event, target) {
    const item = this.actor.items.get(target.closest?.('[data-item-id]')?.dataset.itemId ?? target.dataset.itemId);
    return item?.sheet?.render?.(true);
  }
  static async #onDeleteItem(event, target) {
    const item = this.actor.items.get(target.closest?.('[data-item-id]')?.dataset.itemId ?? target.dataset.itemId);
    if (!item) return;
    return typeof item.deleteDialog === 'function' ? item.deleteDialog() : item.delete();
  }
  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const cfg = ITEM_TYPES[type];
    if (!cfg) return;
    const source = target.dataset.source ?? cfg.source;
    const name = loc('SHADOWBASE.Sheet.NewRow');
    const datum = rowToItemData({ id: engine.rowId(), name }, source, this.actor.nextSort(source));
    datum.name = name;
    if (type === 'weaponPart') datum.system.family = source === 'lightsaberModifications' ? 'lightsaber' : 'weapon';
    const [item] = await this.actor.createEmbeddedDocuments('Item', [datum]);
    return item?.sheet?.render?.(true);
  }
  static async #onToggleEquipped(event, target) {
    const item = this.actor.items.get(target.closest?.('[data-item-id]')?.dataset.itemId ?? target.dataset.itemId);
    if (!item) return;
    return item.update({ 'system.row.equipped': !item.system.row?.equipped });
  }
  /** resource-trackers.tsx:49-51 - the reset writes the calculated maximum into the current pool. */
  static async #onResetPool(event, target) {
    const field = target.dataset.field;
    const pool = poolsContext(this.actor.system, this.actor.stats, !!this.actor.system.isDroid).find((p) => p.field === field);
    if (!pool) return;
    return this.actor.update({ [`system.${field}`]: pool.max });
  }
  /** resource-trackers.tsx:123-135 ResetAllPoolsButton. */
  static async #onResetAllPools() {
    const updates = {};
    for (const p of poolsContext(this.actor.system, this.actor.stats, !!this.actor.system.isDroid)) updates[`system.${p.field}`] = p.max;
    return this.actor.update(updates);
  }
  static async #onPinPools() { return togglePref.call(this, 'pinPools'); }
  static async #onPinPoints() { return togglePref.call(this, 'pinPoints'); }
  static async #onAdjustTurn(event, target) {
    const combat = globalThis.game?.shadowbase?.combat;
    const delta = Number(target.dataset.delta) || 1;
    if (combat?.advanceTurn) return combat.advanceTurn(this.actor, delta);
    return this.actor.update({ 'system.turnCounter': (Number(this.actor.system.turnCounter) || 0) + delta });
  }
  static async #onResetTurn() {
    const combat = globalThis.game?.shadowbase?.combat;
    if (combat?.setTurn) return combat.setTurn(this.actor, 0);
    return this.actor.update({ 'system.turnCounter': 0 });
  }
  static async #onSweepTurn() {
    const combat = globalThis.game?.shadowbase?.combat;
    if (combat?.sweepNow) return combat.sweepNow(this.actor);
    return this.actor.sweepTurn(Number(this.actor.system.turnCounter) || 0);
  }
  /** facing-hex.tsx inner disc: the character turns. */
  static async #onSetFacing(event, target) {
    return this.actor.update({ 'system.facing': Number(target.dataset.side) || 0 });
  }
  /** resource-trackers.tsx:269-293 cycleThreat, ported literally: empty adds, occupied becomes active, active clicked again goes. */
  static async #onCycleThreat(event, target) {
    const side = Number(target.dataset.side) || 0;
    const s = this.actor.system;
    const engaged = !!s.threatEngaged;
    const bearing = Number(s.facing != null ? s.incomingBearing : 0) || 0;
    const others = Array.isArray(s.additionalBearings) ? [...s.additionalBearings] : [];
    if (!engaged) return this.actor.update({ 'system.incomingBearing': side, 'system.additionalBearings': [], 'system.threatEngaged': true });
    if (side === bearing) {
      const [next, ...rest] = others;
      if (next === undefined) return this.actor.update({ 'system.threatEngaged': false });
      return this.actor.update({ 'system.incomingBearing': next, 'system.additionalBearings': rest });
    }
    if (others.includes(side)) {
      // Promote it, and the one it replaces keeps its place on the board.
      return this.actor.update({ 'system.additionalBearings': [bearing, ...others.filter((x) => x !== side)], 'system.incomingBearing': side });
    }
    return this.actor.update({ 'system.additionalBearings': [...others, side] });
  }
  /** resource-trackers.tsx:531-548: standing down clears the board; the active bearing is kept. */
  static async #onToggleEngaged() {
    const engaged = !!this.actor.system.threatEngaged;
    const updates = { 'system.threatEngaged': !engaged };
    if (engaged) updates['system.additionalBearings'] = [];
    return this.actor.update(updates);
  }
  /** resource-trackers.tsx:255-258 turnToEngage: the free change turns the character to the threat. */
  static async #onTurnToFace() {
    const s = this.actor.system;
    return this.actor.update({ 'system.facing': engine.facingRules.facingToEngage(Number(s.incomingBearing) || 0), 'system.facingChangeUsed': true });
  }
  static async #onSetAlignment(event, target) {
    const val = Math.max(-100, Math.min(100, Number(target.dataset.value) || 0));
    return this.actor.update({ 'system.forceAlignment': val, 'system.lightSidePoints': val > 0 ? val : 0, 'system.darkSidePoints': val < 0 ? -val : 0 });
  }
  /** languages-panel.tsx:188-191: a new Accented row with a fresh uuid; the display string re-projects. */
  static async #onAddLanguage() {
    return commitLanguages(this.actor, [...(this.actor.system.languageEntries ?? []), { id: engine.rowId(), tongue: '', tier: 'accented' }]);
  }
  /** languages-panel.tsx:193-200: the species' native, free. */
  static async #onAddNativeLanguage(event, target) {
    const tongue = target.dataset.tongue;
    if (!tongue) return;
    return commitLanguages(this.actor, [...(this.actor.system.languageEntries ?? []), engine.languageRows.nativeLanguageEntry(tongue)]);
  }
  static async #onRemoveLanguage(event, target) {
    const index = Number(target.dataset.index);
    return commitLanguages(this.actor, (this.actor.system.languageEntries ?? []).filter((_, i) => i !== index));
  }
  /**
   * character-details-section.tsx:290-336 / character-form.tsx handleToggleDroidStatus:
   * becoming a droid resets any stored ST/DX/IQ/HT (attributeResetsForDroid) and
   * grants the -10 CP baseline package; leaving takes the marked rows off.
   */
  static async #onToggleDroid() {
    const actor = this.actor;
    const turningOn = !actor.system.isDroid;
    const ok = await confirm(
      loc(turningOn ? 'SHADOWBASE.Sheet.Droid.ConvertTitle' : 'SHADOWBASE.Sheet.Droid.ResetTitle'),
      loc(turningOn ? 'SHADOWBASE.Sheet.Droid.ConvertBody' : 'SHADOWBASE.Sheet.Droid.ResetBody'),
    );
    if (!ok) return;
    const adv = rowsRef(actor, 'advantages');
    const dis = rowsRef(actor, 'disadvantages');
    if (turningOn) {
      const resets = engine.droidAttributes.attributeResetsForDroid(actor.system);
      const updates = { 'system.isDroid': true };
      for (const [k, v] of Object.entries(resets)) updates[`system.${k}`] = v;
      await actor.update(updates);
      const granted = engine.droidBaseline.grantDroidBaseline(adv, dis);
      await reconcileRows(actor, 'advantages', granted.advantages);
      await reconcileRows(actor, 'disadvantages', granted.disadvantages);
      if (granted.added > 0) notify('info', fmt('SHADOWBASE.Sheet.Droid.BaselineGranted', { count: granted.added }));
    } else {
      await actor.update({ 'system.isDroid': false });
      const stripped = engine.droidBaseline.removeDroidBaseline(adv, dis);
      await reconcileRows(actor, 'advantages', stripped.advantages);
      await reconcileRows(actor, 'disadvantages', stripped.disadvantages);
      if (stripped.removed > 0) notify('info', fmt('SHADOWBASE.Sheet.Droid.BaselineRemoved', { count: stripped.removed }));
    }
  }
  /** character-details-section.tsx SizeModifierHint: re-sync SM to the height's Ch2 figure. */
  static async #onApplySm(event, target) {
    const value = Number(target.dataset.value);
    if (!Number.isFinite(value)) return;
    return this.actor.update({ 'system.sizeModifier': value });
  }
  static async #onSwapSpecies(event, target) {
    const next = target.dataset.species ?? this.element?.querySelector?.('[name="system.species"]')?.value ?? '';
    return applySpeciesSwap(this.actor, String(next).trim());
  }
  /** handbook-chip.tsx: open the handbook at the registry target (the HUD's Handbook tab, or the browser app). */
  static async #onOpenHandbook(event, target) {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    const entry = target.dataset.entry;
    const apps = globalThis.game?.shadowbase?.apps ?? {};
    if (typeof apps.HandbookBrowser?.openEntry === 'function') return apps.HandbookBrowser.openEntry(entry, { actor: this.actor });
    if (typeof apps.TacticalHud?.open === 'function') return apps.TacticalHud.open(this.actor, { tab: 'handbook', entry });
    return notify('info', fmt('SHADOWBASE.Sheet.Notice.HandbookAt', { title: chipTitle(entry) }));
  }
  /** The ledger figures jump to the section they report on (basic-info-section.tsx:163-189). */
  static async #onJumpSection(event, target) {
    const tab = target.dataset.tab ?? 'info';
    const section = target.dataset.section;
    if (typeof this.changeTab === 'function' && this.tabGroups?.primary !== tab) this.changeTab(tab, 'primary');
    const el = section ? this.element?.querySelector?.(`details.sb-section[data-section="${section}"]`) : null;
    if (el) { el.open = true; el.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }
  }
  /** quantity-input.tsx nudge: stepUp/stepDown then a real change event, so submitOnChange sees a genuine edit. */
  static async #onStepNumber(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const input = target.closest?.('.sb-qty')?.querySelector?.('input');
    if (!input || input.disabled || input.readOnly) return;
    try { if (Number(target.dataset.dir) < 0) input.stepDown(); else input.stepUp(); } catch { return; }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function togglePref(key) {
  const prefs = sheetPrefs();
  const next = { ...prefs, [key]: !prefs[key] };
  await savePrefs(next);
  return this.render();
}

// ---------------------------------------------------------------------------
// Context builders (exported so tools/render-preview.mjs and the checks can call them directly)
// ---------------------------------------------------------------------------

/** handbook-registry.ts titles through the bundle (the chip's label). */
export function chipTitle(entry) {
  const t = engine.handbookRegistry?.HANDBOOK_CHIP_TARGETS?.[entry];
  return t?.title ?? entry ?? '';
}

/** resource-trackers.tsx:158-205 ResourcePoolsGrid: HP always; PP for a droid, EP + FP for everyone else. */
export function poolsContext(system, stats, isDroid) {
  const cv = stats?.currentValues ?? {};
  const pp = Number(system.powerPoints);
  // getBatteryColor (resource-trackers.tsx:168-172)
  const battery = pp <= 10 ? 'low' : pp <= 20 ? 'warn' : 'ok';
  const pools = [{ key: 'hp', field: 'currentHitPoints', label: 'SHADOWBASE.Sheet.Pools.HP', short: 'HP', icon: ICONS.hp, value: system.currentHitPoints, max: cv.hitPoints ?? 0, tone: '' }];
  if (isDroid) pools.push({ key: 'pp', field: 'powerPoints', label: 'SHADOWBASE.Sheet.Pools.PP', short: 'PP', icon: ICONS.pp, value: system.powerPoints, max: cv.maxPowerPoints ?? 0, tone: battery });
  else {
    pools.push({ key: 'ep', field: 'currentEndurancePoints', label: 'SHADOWBASE.Sheet.Pools.EP', short: 'EP', icon: ICONS.ep, value: system.currentEndurancePoints, max: cv.endurancePoints ?? 0, tone: '' });
    pools.push({ key: 'fp', field: 'currentForcePoints', label: 'SHADOWBASE.Sheet.Pools.FP', short: 'FP', icon: ICONS.fp, value: system.currentForcePoints, max: cv.maxForcePoints ?? 0, tone: '' });
  }
  return pools.map((p) => ({ ...p, title: loc(p.label), display: p.value ?? '', placeholder: String(p.max ?? '') }));
}

/** basic-info-section.tsx:49-58: Spent shows WITHOUT the budget-grant encoding; Remaining already carries it. */
export function ledgerContext(system, stats) {
  const points = stats?.points ?? {};
  const racialBudgetBonus = points.racialBudgetBonus ?? 0;
  const spent = (points.spent ?? 0) + racialBudgetBonus;
  const remaining = points.remaining ?? 0;
  const w = engine.wealth;
  const traded = w.cpSpentOnCredits(system.cpTradedForCredits);
  return {
    total: system.pointTotal,
    spent,
    remaining,
    racialBudgetBonus,
    negative: remaining < 0,
    rows: [
      ['SHADOWBASE.Sheet.Ledger.Attributes', points.attributes],
      ['SHADOWBASE.Sheet.Ledger.Advantages', points.advantages],
      ['SHADOWBASE.Sheet.Ledger.Disadvantages', points.disadvantages],
      ['SHADOWBASE.Sheet.Ledger.Quirks', points.quirks],
      ['SHADOWBASE.Sheet.Ledger.Skills', points.skills],
      ['SHADOWBASE.Sheet.Ledger.ForcePowers', points.forcePowers],
      ['SHADOWBASE.Sheet.Ledger.CombatTechniques', points.combatTechniques],
      ['SHADOWBASE.Sheet.Ledger.LightsaberForms', points.lightsaberForms],
      ['SHADOWBASE.Sheet.Ledger.DroidHardware', points.droidHardware],
      ['SHADOWBASE.Sheet.Ledger.Other', points.other],
    ].map(([label, value]) => ({ label: loc(label), value: value ?? 0 })),
    template: points.template ?? 0,
    pointsOther: system.pointsOther,
    isStartingPointsMode: !!system.isStartingPointsMode,
    cpTraded: traded,
    cpMax: w.CP_FOR_CREDITS.maxCp,
    creditsPerCp: w.CP_FOR_CREDITS.creditsPerCp,
    creditsFromCp: w.creditsFromCp(system.cpTradedForCredits),
    creditForm: system.cpCreditsForm ?? w.DEFAULT_CREDIT_FORM,
    creditForms: [{ value: 'digital', label: loc('SHADOWBASE.Sheet.Ledger.Digital') }, { value: 'physical', label: loc('SHADOWBASE.Sheet.Ledger.Physical') }],
    totalWeight: points.totalWeight ?? 0,
    totalCost: points.totalCost ?? 0,
  };
}

export function headerContext(actor, system, stats, prefs, pools) {
  const portrait = typeof system.characterPortrait === 'string' && system.characterPortrait.trim() ? system.characterPortrait : (actor.img || '');
  const placeholder = !system.characterPortrait && (!actor.img || /mystery-man/.test(actor.img));
  return {
    portrait,
    placeholder,
    name: actor.name,
    playerName: system.playerName ?? '',
    species: system.species ?? '',
    speciesOptions: (engine.speciesSwap?.SPECIES_NAMES ?? []).map((n) => ({ value: n, label: n })),
    homeworld: system.homeworld ?? '',
    campaign: system.campaign ?? '',
    ledger: ledgerContext(system, stats),
    pinPools: !!prefs.pinPools,
    pinPoints: !!prefs.pinPoints,
    pools,
    buttons: [
      { action: 'import-json', icon: ICONS.import, label: loc('SHADOWBASE.Sheet.Header.Import') },
      { action: 'export-json', icon: ICONS.export, label: loc('SHADOWBASE.Sheet.Header.Export') },
      { action: 'open-hud', icon: ICONS.hud, label: loc('SHADOWBASE.Sheet.Header.Hud') },
      { action: 'open-preferences', icon: ICONS.preferences, label: loc('SHADOWBASE.Sheet.Header.Preferences') },
    ],
  };
}

/** Everything the Info tab renders (docs/STYLE-SPEC.md §3.3 Info rows I1-I8 as the eleven sections of the brief). */
export function infoContext(actor, system, stats, sheet, prefs, isDroid) {
  const charging = engine.attributeCharging ?? null; // not in the bundle yet (docs/REQUESTS.md); costs hidden until it lands
  const isSpendingOn = !!system.isStartingPointsMode;
  const pa = stats?.primaryAttributes ?? {};
  const effects = stats?.activeStatusEffects ?? [];
  const numericModifier = engine.modifierChannels?.numericModifier ?? ((bag, ch) => Number(bag?.[ch]) || 0);

  // ---- primary attributes (primary-attributes-section.tsx:52-221) ----
  const primaries = PRIMARIES.map((p) => {
    const stored = system[p.key];
    const hardwareBase = pa.hardwareBases?.[p.key] ?? engine.coreStats?.BASE_ATTRIBUTE_VALUE ?? 10;
    // primaryAttributeBaseline (attribute-charging.ts) when the export lands; the same inputs otherwise
    const baseline = charging?.primaryAttributeBaseline
      ? charging.primaryAttributeBaseline({ hardwareBase, baselineField: system[p.baseline], isDroid })
      : (isDroid ? hardwareBase : (Number.isFinite(Number(system[p.baseline])) && system[p.baseline] !== null ? Number(system[p.baseline]) : (engine.coreStats?.BASE_ATTRIBUTE_VALUE ?? 10)));
    const baselineLabel = isDroid ? loc('SHADOWBASE.Sheet.Attr.Hardware') : baseline === (engine.coreStats?.BASE_ATTRIBUTE_VALUE ?? 10) ? loc('SHADOWBASE.Sheet.Attr.Human') : loc('SHADOWBASE.Sheet.Attr.Template');
    const current = pa[p.raw] ?? (stored ?? baseline);
    const difference = Math.round(current - baseline);
    const effective = pa[p.effective] ?? current;
    const modifier = numericModifier(stats?.modifiers ?? {}, p.key);
    const contributors = effects.map((e) => ({ name: e.name, value: numericModifier(e.modifiers ?? {}, p.key) })).filter((c) => c.value !== 0);
    let cost = null;
    if (charging?.primaryAttributeCardCost) {
      cost = charging.primaryAttributeCardCost({ attr: p.key, current, baseline, sizeModifier: system.sizeModifier, isDroid, isSpendingOn });
    }
    return {
      key: p.key, label: p.label, roll: p.roll,
      value: isDroid ? current : (stored ?? ''),
      placeholder: String(baseline),
      readOnly: isDroid,
      baseline, baselineLabel, difference,
      differenceText: difference !== 0 ? ` (${difference > 0 ? '+' : ''}${difference})` : '',
      hasCost: cost !== null, cost, costText: cost === null ? '' : `[${cost > 0 ? '+' : ''}${cost.toLocaleString()} pts]`,
      isSpendingOn,
      modifier, effective,
      contributors,
      contributorsText: contributors.length === 1 ? contributors[0].name : contributors.map((c) => `${c.name} (${c.value > 0 ? '+' : ''}${c.value})`).join(', '),
      rollTitle: fmt('SHADOWBASE.Sheet.Attr.RollTitle', { attr: p.label, current, modifier: modifier !== 0 ? ` ${modifier > 0 ? '+' : ''}${modifier}` : '', effective }),
    };
  });

  // ---- secondary characteristics (secondary-characteristics-section.tsx:156-323) ----
  const derivedBase = stats?.derivedBase ?? {};
  const cv = stats?.currentValues ?? {};
  const secondaries = SECONDARIES.map((f) => {
    const stored = system[f.name];
    const base = derivedBase[f.name] ?? 0;
    const display = f.editable ? (stored ?? base) : base;
    const effectiveRaw = cv[f.effectiveKey ?? f.name];
    const effective = Number(effectiveRaw ?? display);
    const a = Number(effective); const b = Number(display);
    // applied-modifier.ts appliedModifier: effective minus printed, 0 where either is not a number
    const applied = Number.isFinite(a) && Number.isFinite(b) ? a - b : 0;
    const isImmune = f.name === 'frightCheck' && !!stats?.modifiers?.frightImmune;
    const sourceLabel = isDroid ? (DROID_SOURCE_LABELS[f.name] ?? SOURCE_LABELS[f.source] ?? 'Calc') : (SOURCE_LABELS[f.source] ?? 'Calc');
    let cost = null;
    if (f.editable && f.costKey && charging?.secondaryCardCost) {
      cost = charging.secondaryCardCost({ attrName: f.name, costKey: f.costKey, current: Number(display), base: Number(base), baseline: system[`${f.name}Baseline`], sizeModifier: system.sizeModifier, isDroid, isSpendingOn });
    }
    const baseDisplay = f.isFloat && typeof base === 'number' ? base.toFixed(2) : String(typeof base === 'number' ? base.toLocaleString() : base);
    return {
      name: f.name, label: loc(f.label), editable: f.editable, isFloat: !!f.isFloat, rollable: !!f.rollable && !isImmune,
      value: f.editable ? (stored === null || stored === undefined ? '' : (f.isFloat ? Number(stored).toFixed(2) : stored)) : (f.isFloat ? Number(base).toFixed(2) : String(base)),
      placeholder: f.isFloat && typeof base === 'number' ? base.toFixed(2) : String(base),
      step: f.isFloat ? '0.25' : '1',
      baseDisplay, sourceLabel,
      hasCost: cost !== null,
      costText: cost === null ? '' : (isSpendingOn ? `Cost: [${cost > 0 ? '+' : ''}${cost.toLocaleString()} pts]` : loc('SHADOWBASE.Sheet.Attr.CostTemplate')),
      isSpendingOn,
      applied,
      appliedText: `${applied > 0 ? '+' : ''}${f.isFloat ? applied.toFixed(2) : applied.toLocaleString()}`,
      effectiveText: f.isFloat ? effective.toFixed(2) : (Number.isFinite(effective) ? effective.toLocaleString() : String(effectiveRaw ?? display)),
      isImmune,
    };
  });

  // ---- combat state (resource-trackers.tsx:207-667) ----
  const stunType = system.stunType ?? 'None';
  const stunned = engine.stunRules.isStunned(stunType);
  const fr = engine.facingRules;
  const facing = Number(system.facing) || 0;
  const bearing = Number(system.incomingBearing) || 0;
  const engaged = !!system.threatEngaged;
  const others = Array.isArray(system.additionalBearings) ? system.additionalBearings.map(Number) : [];
  const vision = fr.visionModeFrom([...(sheet?.advantages ?? []), ...(sheet?.implants ?? []), ...(sheet?.cybernetics ?? [])]);
  const arcAt = (side) => fr.arcFrom({ facing, bearing: side, vision });
  const arc = engaged ? fr.arcFrom({ facing, bearing, vision }) : 'Front';
  const flanked = engaged && fr.isFlanked(arc);
  const lostDefenses = engaged ? fr.unavailableDefenses(arc) : [];
  const canEngage = !engaged || fr.canAttackWithoutTurning({ facing, bearing, vision });
  const facingSpent = !!system.facingChangeUsed;
  // Ch9 posture + elevation (resource-trackers.tsx, website-side 2026-09-11). Posture is a fact about the
  // character shown always; applyPosture (a client preference) only gates whether its modifiers reach the
  // derived numbers - the actor's prepareDerivedData passes it to getCalculatedStats. Elevation is a plain
  // field hidden when trackElevation is off (its value is kept either way).
  const P = engine.postureRules;
  const posture = P.normalisePosture(system.posture);
  const postureActive = P.postureIsActive(posture);
  const buffCount = effects.filter((e) => e.type === 'buff').length;
  const effectCount = effects.length;
  const combat = {
    turnCounter: system.turnCounter ?? 0,
    stunType, stunned,
    stunOptions: [
      { value: 'None', label: loc('SHADOWBASE.Sheet.Combat.NotStunned') },
      { value: 'Physical', label: loc('SHADOWBASE.Sheet.Combat.StunPhysical') },
      { value: 'Mental', label: loc('SHADOWBASE.Sheet.Combat.StunMental') },
    ],
    stunNote: stunned ? fmt('SHADOWBASE.Sheet.Combat.StunNote', { penalty: engine.stunRules.STUN_ACTIVE_DEFENSE_PENALTY, attr: engine.stunRules.stunRecoveryAttribute(stunType) ?? '' }) : '',
    posture: {
      value: posture,
      active: postureActive,
      applied: !!prefs.applyPosture,
      options: P.POSTURES.map((p) => ({ value: p, label: P.postureEffects(p).label })),
      effectText: postureActive ? P.describePostureEffect(posture) : '',
      // Recorded-but-not-applied note, mirroring the website when the preference is off.
      note: (postureActive && !prefs.applyPosture) ? loc('SHADOWBASE.Sheet.Combat.PostureNotApplied') : '',
    },
    elevation: {
      show: !!prefs.trackElevation,
      value: Number(system.elevation) || 0,
    },
    effectCount, buffCount, debuffCount: effectCount - buffCount,
    effectsText: effectCount === 0 ? loc('SHADOWBASE.Sheet.Combat.NoneRunning') : fmt('SHADOWBASE.Sheet.Combat.EffectsCount', { buffs: buffCount, buffWord: buffCount === 1 ? loc('SHADOWBASE.Sheet.Combat.Buff') : loc('SHADOWBASE.Sheet.Combat.Buffs'), debuffs: effectCount - buffCount, debuffWord: effectCount - buffCount === 1 ? loc('SHADOWBASE.Sheet.Combat.Debuff') : loc('SHADOWBASE.Sheet.Combat.Debuffs') }),
    facing: {
      facing, bearing, engaged, others, arc, flanked, lostDefenses, canEngage, facingSpent,
      arcTone: arc === 'Rear' ? 'rear' : arc === 'Side' ? 'side' : 'front',
      label: engaged ? fmt('SHADOWBASE.Sheet.Facing.LabelEngaged', { arc }) : loc('SHADOWBASE.Sheet.Facing.LabelIdle'),
      youFace: facing + 1, threat: bearing + 1, othersCount: others.length,
      turnLabel: !engaged ? loc('SHADOWBASE.Sheet.Facing.NoThreat') : canEngage ? loc('SHADOWBASE.Sheet.Facing.InFront') : facingSpent ? loc('SHADOWBASE.Sheet.Facing.ChangeUsed') : loc('SHADOWBASE.Sheet.Facing.TurnToFace'),
      turnDisabled: canEngage || facingSpent,
      freeText: facingSpent ? loc('SHADOWBASE.Sheet.Facing.ChangeSpent') : fmt('SHADOWBASE.Sheet.Facing.FreeChange', { n: fr.FACING_CHANGES_PER_ROUND }),
      describeArc: engaged ? fr.describeArc(arc) : '',
      lostText: lostDefenses.length ? fmt('SHADOWBASE.Sheet.Facing.Unavailable', { defenses: lostDefenses.join(' and '), arc }) : '',
      describeVision: fr.describeVision(vision) ?? '',
      othersList: others.map((s) => ({ label: s + 1, arc: arcAt(s), tone: arcAt(s) === 'Rear' ? 'rear' : arcAt(s) === 'Side' ? 'side' : 'front' })),
      hex: facingHexModel({ facing, bearing, others, engaged, arcAt, hexsides: fr.HEXSIDES ?? 6 }),
    },
  };

  // ---- force alignment (basic-info-section.tsx:327-443, AlignmentEffects, ReactionModifierEffects) ----
  const alignmentValue = Number(system.forceAlignment) || 0;
  const fx = engine.alignment.universalAlignmentEffects(alignmentValue);
  const sign = (n) => (n > 0 ? `+${n}` : String(n));
  const sr = engine.socialRolls;
  const advRows = sheet?.advantages ?? [];
  const disRows = sheet?.disadvantages ?? [];
  const found = sr.reactionSourcesFor(advRows, disRows);
  const unresolved = sr.unresolvedReactionRows(advRows, disRows);
  // Which senses each medium leaves the other party is social-rolls.ts's to say (REACTION_MEDIA, 2026-09-28),
  // never a list typed here: this line used to type "in writing" as ['seen', 'known'], the website's own old
  // mistake - a trait that has to be seen does nothing in writing (Ch4).
  const media = sr.REACTION_MEDIA;
  const faceToFace = sr.netReactionModifier(found, media.faceToFace);
  const overComlink = sr.netReactionModifier(found, media.comlink);
  const inWriting = sr.netReactionModifier(found, media.writing);
  const spheres = sr.reactionSpheres(found).map((s) => ({ name: s, net: sign(sr.netReactionModifier(found, undefined, [s])) }));
  const alignment = {
    value: alignmentValue,
    pct: (alignmentValue + 100) / 2,
    threshold: engine.alignment.ALIGNED_THRESHOLD,
    tier: fx.tier, side: fx.side, label: fx.label,
    isDark: fx.side === 'Dark', isLight: fx.side === 'Light',
    selfControl: sign(fx.selfControl),
    intimidation: sign(fx.bearing?.intimidation ?? 0),
    trust: sign(fx.bearing?.trust ?? 0),
    reaction: {
      show: found.length > 0 || unresolved.length > 0,
      faceToFace: sign(faceToFace),
      sources: found.map((s) => `${s.trait}: ${sign(s.figure)}`).join(', '),
      hasSources: found.length > 0,
      spheres,
      perception: overComlink !== faceToFace || inWriting !== faceToFace,
      overComlink: sign(overComlink), inWriting: sign(inWriting),
      unresolved: unresolved.map((u) => `${u.trait} (${u.why})`).join('; '),
      hasUnresolved: unresolved.length > 0,
    },
  };

  // ---- languages (languages-section.tsx + languages-panel.tsx) ----
  const lr = engine.languageRows;
  const entries = Array.isArray(system.languageEntries) ? system.languageEntries : [];
  const hasAdvantage = (name) => advRows.some((a) => String(a?.name ?? '').trim() === name);
  const hasBilingual = hasAdvantage('Bilingual');
  const hasPolyglot = hasAdvantage('Polyglot');
  const freeCount = entries.filter(lr.isFreeLanguageEntry).length;
  const freeAllowed = 1 + (hasBilingual ? 1 : 0) + (hasPolyglot ? 3 : 0); // languages-panel.tsx:44-46
  const info = engine.speciesLanguages.speciesLanguageInfo(system.species);
  const expectedNative = info ? (system.republicRaised === true && !info.basicNative ? 'Basic' : info.tongue) : null;
  const hasExpectedNative = expectedNative != null && entries.some((e) => e.tier === 'native' && lr.sameTongue(e.tongue, expectedNative));
  const legacy = lr.retainedLegacyEntries(system.languages, entries);
  const illiterate = disRows.some((d) => /illiterac/i.test(String(d?.name ?? ''))) || /illiterate/i.test(String(system.literacy ?? ''));
  const languages = {
    entries: entries.map((e, index) => {
      const cost = lr.languageEntryCost(e);
      const free = lr.isFreeLanguageEntry(e);
      return {
        index, id: e.id ?? '', tongue: e.tongue ?? '', tier: e.tier ?? 'accented', notes: e.notes ?? '',
        comprehensionOnly: e.comprehensionOnly === true, granted: e.granted === true, isNative: e.tier === 'native',
        cost, costText: cost > 0 ? `${cost} CP` : free ? loc('SHADOWBASE.Sheet.Lang.Free') : '0 CP', paid: cost > 0,
      };
    }),
    tierOptions: [{ value: 'native', label: loc('SHADOWBASE.Sheet.Lang.NativeFree') }, ...lr.BUYABLE_TIERS.map((t) => ({ value: t, label: lr.LANGUAGE_TIER_LABELS[t] }))],
    totalCp: lr.languageEntriesTotal(entries),
    legacy, legacyText: legacy.join('; '), hasLegacy: legacy.length > 0,
    expectedNative: expectedNative ?? '', offerNative: expectedNative != null && !hasExpectedNative,
    freeCount, freeAllowed, tooManyFree: freeCount > freeAllowed,
    coverage: `1 free native${hasBilingual ? ' + Bilingual' : ''}${hasPolyglot ? ' + Polyglot' : ''}`,
    hasLanguageTalent: hasAdvantage('Language Talent'),
    republicRaised: system.republicRaised === true,
    showRepublicRaised: !!(info && !info.basicNative),
    speciesTongue: info?.tongue ?? '',
    cannotSpeakBasic: !!info?.cannotSpeakBasic,
    illiterate,
    hasLegacyLiteracy: Boolean(String(system.literacy ?? '').trim()),
    literacy: system.literacy ?? '',
    culturalFamiliarities: system.culturalFamiliarities ?? '',
  };

  // ---- encumbrance & move (encumbrance-section.tsx:99-137, 330-370; the defenses half is the Inventory tab's, U06) ----
  const enc = stats?.currentEncumbrance ?? {};
  const armorEp = stats?.armorEp ?? null;
  const encumbrance = {
    basicLift: stats?.basicLift ?? '',
    level: enc.level ?? '',
    move: enc.move ?? '',
    dodge: enc.dodge ?? '',
    epPerFight: armorEp ? (armorEp.trainedEpCost !== armorEp.baseEpCost ? fmt('SHADOWBASE.Sheet.Enc.EpSplit', { trained: armorEp.trainedEpCost, untrained: armorEp.baseEpCost }) : String(armorEp.baseEpCost)) : '',
    jump: stats?.jumpDistances ?? { running: 0, standing: 0, vertical: 0 },
    hasLiftingST: advRows.some((a) => String(a?.name ?? '').toLowerCase() === 'lifting st'),
    useLiftingST: system.useLiftingST !== false,
    dodgeAvailable: stats?.defenseAdjustments?.dodgeAvailable !== false,
  };

  // ---- character details (character-details-section.tsx:284-462) ----
  const sm = engine.sizeModifier;
  const feet = sm.parseHeightToFeet(system.height);
  const suggested = feet == null ? null : sm.sizeModifierForFeet(feet);
  const currentSm = system.sizeModifier === null || system.sizeModifier === undefined || system.sizeModifier === '' ? null : Number(system.sizeModifier);
  const smMatches = suggested != null && currentSm != null && Number.isFinite(currentSm) && Math.abs(currentSm - suggested) < 0.001;
  let derivedDroidSm = null;
  if (isDroid && system.droidBuild) { try { derivedDroidSm = engine.droidSize.deriveDroidSm(system.droidBuild); } catch { derivedDroidSm = null; } }
  const details = {
    isDroid,
    droidRule: engine.droidAttributes?.DROID_ATTRIBUTE_RULE ?? '',
    height: system.height ?? '',
    weight: system.weight ?? '',
    sizeModifier: isDroid ? (derivedDroidSm ?? '') : (system.sizeModifier ?? ''),
    age: system.age ?? 0,
    appearance: system.appearance ?? '',
    speciesKnown: !!engine.speciesSwap.isKnownSpecies(system.species),
    speciesName: system.species ?? '',
    smHint: feet == null
      ? (engine.speciesSwap.isKnownSpecies(system.species) ? fmt('SHADOWBASE.Sheet.Details.SmFromSpecies', { species: system.species }) : loc('SHADOWBASE.Sheet.Details.SmEnterHeight'))
      : '',
    smSuggested: suggested, smSuggestedText: suggested == null ? '' : `${suggested >= 0 ? '+' : ''}${suggested}`, smMatches, showApply: suggested != null,
  };

  return {
    primaries, secondaries, combat, alignment, languages, encumbrance, details,
    narrative: { description: system.description ?? '', background: system.background ?? '', notes: system.notes ?? '' },
    ledger: ledgerContext(system, stats),
    droidPowerNote: isDroid ? loc('SHADOWBASE.Sheet.Details.DroidPower') : '',
    showPointCosts: prefs.showPointCosts !== false,
  };
}

// ---------------------------------------------------------------------------
// Side effects ported from the website (each cites its component)
// ---------------------------------------------------------------------------

/** languages-panel.tsx:66-70 commit(): every mutation re-projects the display string through the one home. */
async function commitLanguages(actor, next) {
  const lr = engine.languageRows;
  const legacy = lr.retainedLegacyEntries(actor.system.languages, next);
  return actor.update({ 'system.languageEntries': next, 'system.languages': lr.projectLanguagesField(next, legacy) });
}

/** The inputs' index-keyed object over the stored entries (only the edited keys arrive). */
function mergeLanguageEntries(stored, edited) {
  const base = Array.isArray(stored) ? stored.map((e) => ({ ...e })) : [];
  const lr = engine.languageRows;
  for (const [k, patch] of Object.entries(edited ?? {})) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || !patch || typeof patch !== 'object') continue;
    base[i] ??= { id: engine.rowId(), tongue: '', tier: 'accented' };
    const row = base[i];
    if ('tongue' in patch) row.tongue = lr.sanitizeTongueInput(patch.tongue);
    if ('tier' in patch) {
      row.tier = patch.tier;
      // Buying a tier is a purchase; Native is free by definition (languages-panel.tsx:117-121).
      if (patch.tier === 'native') delete row.granted;
    }
    if ('comprehensionOnly' in patch) { if (patch.comprehensionOnly === true || patch.comprehensionOnly === 'true') row.comprehensionOnly = true; else delete row.comprehensionOnly; }
    if ('granted' in patch) { if ((patch.granted === true || patch.granted === 'true') && row.tier !== 'native') row.granted = true; else delete row.granted; }
    if ('republicRaised' in patch) { /* handled at the actor level */ }
  }
  return base.filter(Boolean);
}

/**
 * species-field.tsx:62-150 applySpecies, ported: an alias resolves to the head
 * name (announced), the swap comes from swapSpecies, bought skills carry their
 * relative level across the attribute change (carrySkillLevels through
 * getCalculatedStats on both sides), languages are entry surgery
 * (swapNativeLanguageEntries), and NO credits move (ruled 2026-08-28). A species
 * can be born with a Force power (Ch18: the Miraluka's Force Sight); swapSpecies
 * hands back `forcePowers` with it granted or stripped by its `fromSpecies`
 * marker, and it is reconciled like the trait arrays (species-field.tsx,
 * 2026-09-28).
 */
export async function applySpeciesSwap(actor, rawNext) {
  const ss = engine.speciesSwap;
  const lr = engine.languageRows;
  const sheet = actor.sheetData ?? {};
  const viaAlias = ss.isKnownSpecies(rawNext) ? null : ss.speciesForAlias(rawNext);
  const next = viaAlias ?? rawNext;
  if (viaAlias) notify('info', fmt('SHADOWBASE.Sheet.Species.Alias', { typed: rawNext, head: viaAlias }));
  if ((sheet.species ?? '') === next) return null;
  const values = { ...sheet, advantages: rowsRef(actor, 'advantages'), disadvantages: rowsRef(actor, 'disadvantages'), quirks: rowsRef(actor, 'quirks'), skills: rowsRef(actor, 'skills'), forcePowers: rowsRef(actor, 'forcePowers') };
  const swap = ss.swapSpecies(values, next);
  const pricingBefore = engine.getCalculatedStats(values).skillPricingAttributes;
  const pricingAfter = engine.getCalculatedStats({ ...values, species: next, advantages: swap.advantages, disadvantages: swap.disadvantages, quirks: swap.quirks }).skillPricingAttributes;
  const carried = typeof engine.carrySkillLevels === 'function' ? engine.carrySkillLevels(values.skills, pricingBefore, pricingAfter) : values.skills;
  const swappedEntries = lr.swapNativeLanguageEntries(values.languageEntries ?? [], values.species, next, values.republicRaised === true);
  await actor.update({
    'system.species': swap.species,
    'system.sizeModifier': swap.sizeModifier,
    'system.height': swap.height,
    'system.weight': swap.weight,
    'system.languageEntries': swappedEntries,
    'system.languages': lr.projectLanguagesField(swappedEntries, lr.retainedLegacyEntries(values.languages, swappedEntries)),
    'system.languagesBaseline': 0,
    'system.culturalFamiliarities': swap.culturalFamiliarities,
    'system.culturalFamiliaritiesBaseline': swap.culturalFamiliaritiesBaseline,
    'system.literacy': swap.literacy,
    'system.literacyBaseline': swap.literacyBaseline,
  });
  await reconcileRows(actor, 'advantages', swap.advantages);
  await reconcileRows(actor, 'disadvantages', swap.disadvantages);
  await reconcileRows(actor, 'quirks', swap.quirks);
  await reconcileRows(actor, 'forcePowers', swap.forcePowers);
  if (carried !== values.skills) await reconcileRows(actor, 'skills', carried);
  return swap;
}

/** A character JSON text into this actor through ShadowBaseActor#importSheet, with the load notices reported. */
export async function importJsonText(actor, text) {
  try {
    const { notices = [] } = await actor.importSheet(text, { mode: 'replace' });
    notify('info', fmt('SHADOWBASE.Sheet.Notice.Imported', { name: actor.name }));
    for (const n of notices) notify('info', `${n.title ?? ''}${n.description ? ` — ${n.description}` : ''}`);
    return true;
  } catch (err) {
    notify('error', fmt('SHADOWBASE.Sheet.Notice.ImportFailed', { error: err?.message ?? String(err) }));
    return false;
  }
}

/** The fallback importer: a file input the browser opens (module/import-export.mjs, U06, replaces it). */
async function pickJsonFile(actor) {
  const doc = globalThis.document;
  if (!doc?.createElement) return notify('warn', loc('SHADOWBASE.Sheet.Notice.ImportUnavailable'));
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await importJsonText(actor, await file.text());
  });
  input.click();
}

/** DialogV2.confirm when the client has it; headless callers get `true` (the shim records the prompt). */
async function confirm(title, content) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm !== 'function') return true;
  return DialogV2.confirm({ window: { title }, content: `<div class="shadowbase"><p>${content}</p></div>`, rejectClose: false, modal: true });
}

/** The preferences dialog (sheet-preference-controls.tsx, the subset the Foundry sheet reads). Returns the new prefs or null. */
async function promptPreferences(prefs) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2) { notify('warn', loc('SHADOWBASE.Sheet.Notice.DialogUnavailable')); return null; }
  const row = (key, label) => `<label class="sb-check-row"><input type="checkbox" name="${key}"${prefs[key] ? ' checked' : ''}> ${loc(label)}</label>`;
  const content = `<div class="shadowbase sb-prefs">
    <p class="sb-text-xs sb-text-muted">${loc('SHADOWBASE.Sheet.Prefs.Hint')}</p>
    ${row('showHandbookChips', 'SHADOWBASE.Sheet.Prefs.HandbookChips')}
    ${row('showPointCosts', 'SHADOWBASE.Sheet.Prefs.PointCosts')}
    ${row('compactRows', 'SHADOWBASE.Sheet.Prefs.CompactRows')}
    ${row('stickySectionHeaders', 'SHADOWBASE.Sheet.Prefs.StickyHeaders')}
    ${row('reduceMotion', 'SHADOWBASE.Sheet.Prefs.ReduceMotion')}
    ${row('rememberOpenSections', 'SHADOWBASE.Sheet.Prefs.RememberSections')}
  </div>`;
  const read = (form) => {
    const out = { ...prefs };
    for (const key of PREF_DIALOG_KEYS) out[key] = !!form?.elements?.[key]?.checked;
    return out;
  };
  if (typeof DialogV2.input === 'function') {
    const result = await DialogV2.input({ window: { title: loc('SHADOWBASE.Sheet.Prefs.Title') }, content, ok: { label: loc('SHADOWBASE.Sheet.Prefs.Save') } });
    if (!result) return null;
    const out = { ...prefs };
    for (const key of PREF_DIALOG_KEYS) out[key] = result[key] === true || result[key] === 'true' || result[key] === 'on';
    return out;
  }
  return DialogV2.wait({
    window: { title: loc('SHADOWBASE.Sheet.Prefs.Title') },
    content,
    buttons: [
      { action: 'save', label: loc('SHADOWBASE.Sheet.Prefs.Save'), default: true, callback: (event, button) => read(button.form) },
      { action: 'cancel', label: loc('Cancel'), callback: () => null },
    ],
    rejectClose: false,
  });
}

/** v13 hands a document; older data carries a uuid. */
async function resolveDocument(docOrData, documentName) {
  if (!docOrData) return null;
  if (docOrData.documentName === documentName) return docOrData;
  const uuid = docOrData.uuid;
  if (typeof uuid === 'string' && typeof globalThis.fromUuid === 'function') {
    try { return await globalThis.fromUuid(uuid); } catch { return null; }
  }
  return null;
}

/** The raw value of one named control on the submitted form (for the species swap after the update). */
function raw(form, name) {
  const el = form?.elements?.namedItem?.(name) ?? form?.querySelector?.(`[name="${name}"]`);
  return el?.value;
}

function expandObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const parts = k.split('.');
    let t = out;
    for (let i = 0; i < parts.length - 1; i++) { t[parts[i]] ??= {}; t = t[parts[i]]; }
    t[parts[parts.length - 1]] = v;
  }
  return out;
}
function flattenObject(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenObject(v, key)); else out[key] = v;
  }
  return out;
}

export default ShadowBaseActorSheet;
