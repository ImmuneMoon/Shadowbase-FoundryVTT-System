// module/adapter.mjs
//
// THE ADAPTER between Foundry documents and the website's CharacterFormValues
// (docs/ARCHITECTURE.md §4.3). Two directions, both pure:
//
//   actorToSheet(actor)                 Actor (+ Items + ActiveEffects) -> sheet object the engine reads
//   sheetToActorData(sheet, opts)       sheet object -> { name, type, system, items[], effects[] } for Actor.create
//
// plus the row-level helpers both directions share. Nothing here computes a
// rule: the engine reads the sheet this file composes, and every figure it
// injects into a row (`rowWithDerived`) came out of the bundle's own per-item
// derivation (module/data/item-base.mjs), which is the same function the
// website's card hooks call before they write the figure back onto the row.
//
// Invariant (tools/smoke-data-layer.mjs, later check:adapter-round-trip):
// actorToSheet(build(sheetToActorData(sheet))) deep-equals sheet for every
// template and coverage fixture, up to the declared masks the smoke lists.

import { engine } from './engine.mjs';
import { SCHEMA_KEYS, ITEM_ROW_ARRAY_KEYS, SYSTEM_ROW_ARRAY_KEYS, ROW_ARRAY_KEYS, SKIPPED_KEYS, DEAD_ECHO_KEYS } from './data/actor-schema.generated.mjs';
import { ITEM_TYPES, SOURCE_TO_TYPE, WEAPON_PART_FAMILIES, statusIdForRow, statusImg } from './config.mjs';

/**
 * DEAD ECHO FIELDS: top-level sheet keys that are never stored on the actor
 * and never handed back by actorToSheet - the generator's DEAD_ECHO_KEYS
 * (tools/gen-actor-schema.mjs declares the list and its reasons; the schema
 * has no field for any of them, ARCHITECTURE.md §9.1).
 *
 * Each is either a figure the website's exporter writes for readers and its
 * importer never reads back (character-json-exporter.ts writes `spent`,
 * `remaining`, `damage.thrust/swing`, `basicLift`, `defenses.parry/block`;
 * character-json-importer.ts reads none of them - docs/CHARACTER_JSON_FORMAT.md
 * §3.7 "Derived keys are ignored"), a write-back the website's own calculation
 * hook makes for the PDF (root `currentValues`, `pointsSkills`, `spentPoints`,
 * `remainingPoints`), or a key neither side of the website's JSON contract
 * touches at all (`trackPurchases`, superseded by trackDigital/trackPhysical;
 * `drHead`/`drTorso`, superseded by the per-location hit-location state; root
 * `flawedBuild`, an item flag that leaked to the root). `pointsOther` and
 * `languagesBaseline` LOOK like members of this family and are NOT: the engine
 * reads both (the smoke's mutation probe over the corpus changes 68/68 results
 * when either is disturbed), so they are stored like any other field; so are
 * `pointsAttributes`/`pointsAdvantages`/`pointsDisadvantages`, which §9.1 keeps
 * as nullable integer fields.
 *
 * On the way OUT they are ABSENT, never null: engine.blank() carries ten of
 * them with the website's own defaults (pointsSkills 0, basicLift '', the root
 * currentValues object ...) and actorToSheet deletes them after the spread, so
 * the sheet the engine and the exporter read has no value for a key nothing
 * writes (ShadowBaseActor#exportSheet fills the three the exporter reads -
 * damageThrust, damageSwing, basicLift - from the live stats).
 *
 * The smoke and check:adapter-round-trip re-prove this list on every run:
 * setting any of these to garbage on every template and fixture must leave
 * every key of getCalculatedStats unchanged. A key that fails that probe does
 * not belong here.
 */
export const DEAD_ECHO_FIELDS = DEAD_ECHO_KEYS;
const DEAD = new Set(DEAD_ECHO_FIELDS);

/** Every top-level key the sheet may legitimately carry; anything else is `legacy`. */
export const KNOWN_SHEET_KEYS = Object.freeze(new Set([
  ...SCHEMA_KEYS, ...ROW_ARRAY_KEYS, ...Object.keys(SKIPPED_KEYS),
]));

/** The schema fields copied by name in both directions (everything but the catch-all). */
const COPIED_FIELDS = SCHEMA_KEYS.filter((k) => k !== 'legacy');

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const clone = (v) => (globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(v) : structuredClone(v));
const sortDensity = () => globalThis.CONST?.SORT_INTEGER_DENSITY ?? 100000;

// ---------------------------------------------------------------------------
// Row-level helpers
// ---------------------------------------------------------------------------

/**
 * The Item name for a row: the website shows `customName` when set, else
 * `name`; the families whose schema has no `name` show their base: an
 * explosive's `baseExplosiveName` (customExplosiveSchema; the website's
 * explosive card and the exporter both read it), a starship's `baseChassis`,
 * a blaster's `baseType`. A blank/absent name falls back to the type's
 * localized label, because Foundry refuses a blank document name.
 * @param {object} row
 * @param {string} type
 */
export function itemNameFor(row, type) {
  const pick = (key) => (typeof row?.[key] === 'string' ? row[key].trim() : '');
  return pick('customName') || pick('name') || pick('baseExplosiveName') || pick('baseChassis') || pick('baseType')
    || loc(ITEM_TYPES[type]?.label ?? 'SHADOWBASE.Item.Unnamed');
}

/**
 * One Item datum for one website row (ARCHITECTURE.md §4.3 sheetToActorData).
 * The row is stored VERBATIM (every website field name, nothing renamed, and
 * NO id minted). ARCHITECTURE.md §4.3 says a row missing `id` gets one; that
 * sentence loses to the same section's invariant (the round trip must
 * deep-equal the sheet) and to the engine: it keys a trait's derived effect
 * `adv-${adv.id ?? adv.name}` (use-character-calculations.ts), the HUD
 * dismisses by that id, and the website's own trait rows carry no id - a
 * minted uuid would have changed an id the website never had. Cross-references
 * between gear rows (installedIn*Id, storageLocationId, gearSets) use the ids
 * the website minted when it created the rows; the Item's own `_id` is
 * Foundry's identity. Callers that need a row id on a NEW row mint one with
 * engine.rowId() before calling this, as the website does on creation.
 * @param {object} row
 * @param {string} source one of CHARACTER_FORM_ARRAY_KEYS (minus the system arrays)
 * @param {number} sort
 */
export function rowToItemData(row, source, sort = 0) {
  const type = SOURCE_TO_TYPE[source];
  if (!type) throw new Error(`adapter: no Item type stores the website array "${source}"`);
  const r = clone(row ?? {});
  const system = { row: r, source };
  if (type === 'weaponPart') system.family = source === WEAPON_PART_FAMILIES.lightsaber ? 'lightsaber' : 'weapon';
  return { name: itemNameFor(r, type), type, img: ITEM_TYPES[type].img, sort, system };
}

/** The stored row of an Item, verbatim (no derived figures). */
export function itemToRow(item) {
  return item?.system?.row ?? null;
}

/**
 * The row the ENGINE should read: the stored row with the family's persisted
 * derived figures laid over it. The website's card hooks write `finalWeight`,
 * `finalCost`, `malfunction` ... back onto the row when the card mounts and the
 * engine reads them from the row (calculateEquipment.ts reads
 * `blaster.finalWeight ?? blaster.baseWeight`, use-character-calculations.ts
 * reads `w.finalST`, `modified?.finalDXPenalty ?? item.dxPenalty`). Foundry
 * never mounts a card, so the write-back happens here, on every prepare.
 * @param {object} item a ShadowBaseItem (or any object with system.row and system.derived)
 */
export function rowWithDerived(item) {
  const row = item?.system?.row ?? {};
  const persisted = item?.system?.derived?.persistedFields;
  return persisted ? { ...row, ...persisted } : { ...row };
}

/**
 * Items of one website array on an actor, in sheet order (Foundry `sort`, then
 * name as a stable tie-break). Kept here so the actor document and the adapter
 * cannot disagree on the order.
 * @param {object} actor
 * @param {string} source
 */
export function rowsOf(actor, source) {
  const items = actor?.items?.filter ? actor.items.filter((i) => i.system?.source === source) : [];
  return items.sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || String(a.name).localeCompare(String(b.name)));
}

/** The `sort` a NEW row appended to `source` gets (after the current last one). */
export function nextSort(actor, source) {
  const rows = rowsOf(actor, source);
  const max = rows.reduce((m, i) => Math.max(m, i.sort ?? 0), 0);
  return max + sortDensity();
}

// ---------------------------------------------------------------------------
// Status effects <-> ActiveEffects (ARCHITECTURE.md §4.4)
// ---------------------------------------------------------------------------

/** @param {object} effect */
export function isStatusEffect(effect) {
  return !!effect?.flags?.shadowbase?.statusEffect;
}

/**
 * ActiveEffect data for one STORED website status-effect row. `changes` is
 * ALWAYS empty: the engine sums every modifier bag itself (getCalculatedStats
 * reads `values.statusEffects`), so a Foundry change would apply the bonus a
 * second time.
 * @param {object} row a statusEffectSchema row
 */
export function statusEffectToEffectData(row) {
  const r = clone(row ?? {});
  if (!r.id) r.id = engine.rowId();
  r.modifiers = { ...engine.NO_MODIFIERS, ...(r.modifiers ?? {}) };
  r.phaseIndex = r.phaseIndex ?? 0;
  const statusId = statusIdForRow(r);
  return {
    name: (typeof r.name === 'string' && r.name.trim()) || loc('SHADOWBASE.Effect.Unnamed'),
    img: statusImg(statusId ?? (r.type === 'buff' ? 'buff' : 'debuff')),
    description: r.description ?? '',
    disabled: false,
    transfer: false,
    changes: [],
    duration: {},
    flags: { shadowbase: { statusEffect: r } },
    statuses: statusId ? [statusId] : [],
  };
}

/**
 * The website row an ActiveEffect carries, or null for an effect that is not
 * a ShadowBase status effect (a module's, a core condition toggled by hand).
 * @param {object} effect
 */
export function effectToStatusEffect(effect) {
  const row = effect?.flags?.shadowbase?.statusEffect;
  if (!row) return null;
  return { ...row, id: row.id ?? engine.rowId() };
}

// ---------------------------------------------------------------------------
// Actor <-> sheet
// ---------------------------------------------------------------------------

/**
 * The sheet (CharacterFormValues) the engine reads for an actor.
 * @param {object} actor a ShadowBaseActor (or a shim actor with items/effects collections)
 * @returns {object} a plain object; the engine never mutates it
 */
export function actorToSheet(actor) {
  const system = actor.system ?? {};
  // Legacy keys first so every schema field wins over an unknown import key of the same name.
  const sheet = { ...engine.blank(), ...(system.legacy ?? {}) };
  // The dead echo fields are absent, never null (see DEAD_ECHO_FIELDS): the blank's own copies go too.
  for (const key of DEAD_ECHO_FIELDS) delete sheet[key];
  for (const key of COPIED_FIELDS) sheet[key] = system[key];
  sheet.characterName = actor.name;
  sheet.characterPortrait = system.characterPortrait || null;
  for (const source of ITEM_ROW_ARRAY_KEYS) sheet[source] = rowsOf(actor, source).map(rowWithDerived);
  for (const source of SYSTEM_ROW_ARRAY_KEYS) sheet[source] = system[source] ?? [];
  const effects = actor.effects?.filter ? actor.effects.filter(isStatusEffect) : [];
  sheet.statusEffects = effects.map(effectToStatusEffect);
  return sheet;
}

/**
 * Actor creation data for a sheet (ARCHITECTURE.md §4.3).
 * @param {object} sheet CharacterFormValues (a template's data, an import after applyLoadMigrations, ...)
 * @param {{ actorName?: string }} [options]
 * @returns {{ name: string, type: 'character', system: object, items: object[], effects: object[] }}
 */
export function sheetToActorData(sheet, { actorName } = {}) {
  const system = { legacy: {} };
  // COPIED_FIELDS has no dead echo key (the schema has no field for them) and KNOWN_SHEET_KEYS names them
  // (SKIPPED_KEYS), so an incoming dead key is neither stored nor kept as legacy - it is dropped.
  for (const key of COPIED_FIELDS) {
    if (DEAD.has(key)) continue;
    if (key in sheet && sheet[key] !== undefined) system[key] = clone(sheet[key]);
  }
  system.characterPortrait = sheet.characterPortrait || null;
  for (const [k, v] of Object.entries(sheet)) {
    if (KNOWN_SHEET_KEYS.has(k) || v === undefined) continue;
    system.legacy[k] = clone(v);
  }
  const items = [];
  for (const source of ITEM_ROW_ARRAY_KEYS) {
    const rows = sheet[source];
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, i) => { if (row && typeof row === 'object') items.push(rowToItemData(row, source, (i + 1) * sortDensity())); });
  }
  const effects = (Array.isArray(sheet.statusEffects) ? sheet.statusEffects : []).map(statusEffectToEffectData);
  const given = typeof actorName === 'string' ? actorName.trim() : '';
  const own = typeof sheet.characterName === 'string' ? sheet.characterName.trim() : '';
  // The zod default for a blank name (character-form-schema.ts: .default("Unnamed Character")).
  const name = given || own || loc('SHADOWBASE.Actor.Unnamed');
  return { name, type: 'character', system, items, effects };
}

export const adapter = Object.freeze({
  actorToSheet, sheetToActorData, rowToItemData, itemToRow, rowWithDerived, rowsOf, nextSort, itemNameFor,
  statusEffectToEffectData, effectToStatusEffect, isStatusEffect,
  DEAD_ECHO_FIELDS, KNOWN_SHEET_KEYS,
});

export default adapter;
