#!/usr/bin/env node
// tools/gen-actor-schema.mjs
//
// Generates module/data/actor-schema.generated.mjs from the engine bundle's
// `characterSheetSchema` (zod 3). NEVER hand-edit the output; every exception
// to the mechanical mapping is declared HERE (ARCHITECTURE.md §4.1: "Hand
// exceptions are declared in the generator, never edited into the output")
// and check:actor-schema (unit U02b) pins the output byte-identical.
//
//   node tools/gen-actor-schema.mjs            # writes the file, prints the table
//   node tools/gen-actor-schema.mjs --check    # exit 1 if the file on disk differs
//   node tools/gen-actor-schema.mjs --stdout   # print instead of writing
//
// THE MAPPING (ARCHITECTURE.md §4.1 table), applied after unwrapping
// ZodEffects / ZodOptional / ZodNullable / ZodDefault down to the core type:
//
//   number             -> NumberField({ required: true, nullable: <zod chain has ZodNullable, or is
//                          optional with no default - undefined has no Foundry storage>,
//                          initial: <zod default | null>, integer: <.int()>, min/max: <.min()/.max()> })
//                          (pointsAttributes/pointsAdvantages/pointsDisadvantages are the optional-int
//                          shape: nullable, integer, initial null - ARCHITECTURE.md §9.1)
//   boolean            -> BooleanField({ initial: <zod default | false> })   (never nullable: the one
//                          nullable boolean in the schema, trackPurchases, transforms null to false)
//   string             -> StringField({ required: true, nullable: true, initial: null, blank: true, trim: false })
//                          trim: false on EVERY string (Foundry's default trim: true would strip the
//                          whitespace a player typed into notes - review finding M6)
//   enum               -> StringField({ choices, initial: <zod default | null>, nullable: <as zod>, trim: false })
//                          (incomingArc: nullable enum with no default -> nullable: true, initial null)
//   array of primitives-> ArrayField(NumberField|StringField|BooleanField)
//   object / array of objects -> ObjectField / ArrayField(ObjectField), opaque (Foundry never
//                          cleans inside an ObjectField, so sparse droid slot arrays survive);
//                          nullable: true where zod is nullable (droidBuild, gearSets, storageBoxes,
//                          pinnedNotifications), so a null stays null instead of becoming {} / []
//
// DECLARED EXCEPTIONS (each is a line in EXCEPTIONS below, with its reason):
//   - the 22 row arrays that become Items are skipped (hitLocations, the 23rd
//     CHARACTER_FORM_ARRAY_KEY, stays a system field: anatomy is state the
//     AnatomyWorkshop edits, not a catalog item - ARCHITECTURE.md §4.1 table,
//     §6.5);
//   - characterName -> actor.name; lastSaved -> Foundry's own _stats; statusEffects -> ActiveEffects (§4.4);
//   - the DEAD ECHO fields (DEAD_ECHO_KEYS below) are skipped BY NAME - a field
//     nothing writes and nothing reads has no business in a schema (review m8,
//     ARCHITECTURE.md §9.1); module/adapter.mjs proves each unread by the engine;
//   - characterPortrait stays a StringField (a data URL; FilePathField rejects base64);
//   - description/background/notes -> StringField with initial "" and trim: false,
//     NOT HTMLField: the website binds all three to plain <textarea>s (newlines
//     significant, no markup) and an HTMLField would open ProseMirror, whose
//     <p> markup the website renders literally (review m6, ARCHITECTURE.md §3);
//   - strength/dexterity/iq/health -> nullable with initial 10: the importer stores
//     null for "derive" and a droid derives from hardware, not 10 (see EXCEPTIONS);
//   - legacy: ObjectField added for unknown top-level keys an import carries (§4.1).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ENGINE = resolve(process.env.ENGINE_BUNDLE ?? join(ROOT, 'engine', 'shadowbase-engine.mjs'));
const BUILD_INFO = join(dirname(ENGINE), 'BUILD-INFO.json');
const OUT = join(ROOT, 'module', 'data', 'actor-schema.generated.mjs');
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const STDOUT = argv.includes('--stdout');

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
if (!existsSync(ENGINE)) { console.error(`gen-actor-schema: engine bundle missing at ${ENGINE}`); process.exit(1); }

const E = await import(pathToFileURL(ENGINE).href);
const schema = E.characterSheetSchema;
const ROW_ARRAY_KEYS = [...E.CHARACTER_FORM_ARRAY_KEYS];
if (schema?._def?.typeName !== 'ZodObject') { console.error('gen-actor-schema: characterSheetSchema is not a ZodObject'); process.exit(1); }
if (ROW_ARRAY_KEYS.length !== 23) { console.error(`gen-actor-schema: expected 23 CHARACTER_FORM_ARRAY_KEYS, got ${ROW_ARRAY_KEYS.length}`); process.exit(1); }

/** The one row array that stays on the actor (see the header). */
const SYSTEM_ROW_ARRAYS = new Set(['hitLocations']);
/** Row arrays that become Items: every CHARACTER_FORM_ARRAY_KEY except the system ones. */
const ITEM_ROW_ARRAYS = ROW_ARRAY_KEYS.filter((k) => !SYSTEM_ROW_ARRAYS.has(k));

/**
 * DEAD ECHO KEYS: top-level characterSheetSchema keys with no writer and no
 * reader in the website's src/ (the phase-1 schema-core reader's fact 24,
 * docs/phase1-digest-A.md; re-verified 2026-09-10 by garbage-probing every
 * template through getCalculatedStats - module/adapter.mjs and
 * check:adapter-round-trip keep that probe live). Each is either a figure the
 * exporter writes for readers and the importer never reads back
 * (`spentPoints`/`remainingPoints` -> points.spent/remaining, `damageThrust`/
 * `damageSwing`, `basicLift`, `parry`/`block` -> defenses), a PDF write-back of
 * the website's own calculation hook (root `currentValues`, `pointsSkills`), or a
 * key neither side of the JSON contract touches (`trackPurchases`, superseded by
 * trackDigital/trackPhysical; `drHead`/`drTorso`, superseded by per-location
 * anatomy; root `flawedBuild`, an item-level flag that leaked to the root).
 * They are SKIPPED here by name so the schema never carries a field nothing
 * writes (review m8; ARCHITECTURE.md §9.1). NOT in this list, deliberately:
 * `pointsOther` (a live input calculateSpecialAbilityPoints reads),
 * `activeFormWeaponId` (the HUD persists it), `incomingArc` (migrateFacing
 * consumes it on import) and `pointsAttributes`/`pointsAdvantages`/
 * `pointsDisadvantages` (kept as nullable integer fields per §9.1's generator row).
 */
const DEAD_ECHO_KEYS = Object.freeze([
  'drHead', 'drTorso', 'parry', 'block', 'flawedBuild', 'currentValues', 'pointsSkills',
  'basicLift', 'damageThrust', 'damageSwing', 'spentPoints', 'remainingPoints', 'trackPurchases',
]);

/** The three textarea fields: plain strings, initial "" as on the website's blank sheet, whitespace kept. */
const TEXTAREA_FIELD = `new fields.StringField({ required: true, nullable: true, initial: "", blank: true, trim: false })`;

/** @type {Record<string, {skip?: true, reason: string, override?: (info: any) => string}>} */
const EXCEPTIONS = {
  characterName: { skip: true, reason: 'becomes actor.name (ARCHITECTURE.md §4.1)' },
  lastSaved: { skip: true, reason: 'Foundry keeps modification time in _stats (ARCHITECTURE.md §4.1)' },
  statusEffects: { skip: true, reason: 'stored rows are ActiveEffects (ARCHITECTURE.md §4.4)' },
  characterPortrait: { reason: 'data URL; FilePathField rejects base64 so it stays a StringField', override: () => `new fields.StringField({ required: true, nullable: true, initial: null, blank: true, trim: false })` },
  // The four primaries: zod preprocesses null to 10, but the website's form state
  // is never zod-parsed on load and its importer stores `value ?? null` on purpose -
  // null means "derive", which for a droid is the HARDWARE base (character-json-
  // importer.ts "Null, not 10 ... IX-77's Heuristic sets IQ 12"). A non-nullable
  // field would clean that null to 10 and re-create the bug. Nullable, initial 10.
  strength: { reason: 'null means derive (droid hardware base); nullable, initial 10', override: () => `new fields.NumberField({ required: true, nullable: true, initial: 10, integer: true, min: 1 })` },
  dexterity: { reason: 'null means derive (droid hardware base); nullable, initial 10', override: () => `new fields.NumberField({ required: true, nullable: true, initial: 10, integer: true, min: 1 })` },
  iq: { reason: 'null means derive (droid hardware base); nullable, initial 10', override: () => `new fields.NumberField({ required: true, nullable: true, initial: 10, integer: true, min: 1 })` },
  health: { reason: 'null means derive (droid hardware base); nullable, initial 10', override: () => `new fields.NumberField({ required: true, nullable: true, initial: 10, integer: true, min: 1 })` },
  description: { reason: 'textarea text (not HTML); StringField, initial "", trim: false as on the website blank sheet', override: () => TEXTAREA_FIELD },
  background: { reason: 'textarea text (not HTML); StringField, initial "", trim: false as on the website blank sheet', override: () => TEXTAREA_FIELD },
  notes: { reason: 'textarea text (not HTML); StringField, initial "", trim: false as on the website blank sheet', override: () => TEXTAREA_FIELD },
};
for (const k of ITEM_ROW_ARRAYS) EXCEPTIONS[k] = { skip: true, reason: 'row array -> Items (ARCHITECTURE.md §4.2)' };
for (const k of DEAD_ECHO_KEYS) EXCEPTIONS[k] = { skip: true, reason: 'dead echo field: no writer and no reader in the website src (schema-core fact 24; ARCHITECTURE.md §9.1)' };

// ---- zod 3 introspection -----------------------------------------------------
/**
 * Unwrap a zod field to its core type, recording what wrapped it.
 * @param {any} z
 * @returns {{ core: any, coreType: string, nullable: boolean, optional: boolean, hasDefault: boolean, defaultValue: any, preprocess: boolean, transform: boolean }}
 */
function unwrap(z) {
  const info = { nullable: false, optional: false, hasDefault: false, defaultValue: undefined, preprocess: false, transform: false };
  let cur = z;
  for (let guard = 0; guard < 16; guard++) {
    const t = cur?._def?.typeName;
    if (t === 'ZodEffects') {
      const kind = cur._def.effect?.type;
      if (kind === 'preprocess') info.preprocess = true;
      else if (kind === 'transform') info.transform = true;
      cur = cur._def.schema;
    } else if (t === 'ZodOptional') { info.optional = true; cur = cur._def.innerType; }
    else if (t === 'ZodNullable') { info.nullable = true; cur = cur._def.innerType; }
    else if (t === 'ZodDefault') {
      // The OUTERMOST default wins, as it does in zod (an inner default is only
      // reached when the outer wrapper hands undefined down, which a default never does).
      if (!info.hasDefault) { info.hasDefault = true; info.defaultValue = cur._def.defaultValue(); }
      cur = cur._def.innerType;
    } else break;
  }
  return { ...info, core: cur, coreType: cur?._def?.typeName ?? 'unknown' };
}

/** @param {any} zNumber */
function numberChecks(zNumber) {
  const out = { integer: false, min: undefined, max: undefined };
  for (const c of zNumber?._def?.checks ?? []) {
    if (c.kind === 'int') out.integer = true;
    else if (c.kind === 'min') out.min = c.value;
    else if (c.kind === 'max') out.max = c.value;
  }
  return out;
}

const lit = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));

/**
 * Field expression for a PRIMITIVE core type (used top-level and for array elements).
 * @returns {{ expr: string, kind: string, nullable: boolean, initial: any }}
 */
function primitiveField(info, { element = false } = {}) {
  const { core, coreType } = info;
  if (coreType === 'ZodNumber') {
    const { integer, min, max } = numberChecks(core);
    // An optional number with no default (pointsAttributes and friends) is
    // `undefined` on the website; Foundry cannot store undefined, so null is
    // its faithful representation and the field is nullable.
    const nullable = element ? false : (info.nullable || (info.optional && !info.hasDefault));
    const initial = info.hasDefault ? info.defaultValue : (nullable ? null : (element ? 0 : null));
    const opts = [`required: true`, `nullable: ${nullable}`, `initial: ${lit(initial)}`];
    if (integer) opts.push('integer: true');
    if (min !== undefined) opts.push(`min: ${lit(min)}`);
    if (max !== undefined) opts.push(`max: ${lit(max)}`);
    if (!nullable && initial === null) throw new Error('non-nullable number without a default');
    return { expr: `new fields.NumberField({ ${opts.join(', ')} })`, kind: 'number', nullable, initial };
  }
  if (coreType === 'ZodBoolean') {
    const initial = info.hasDefault ? Boolean(info.defaultValue) : false;
    return { expr: `new fields.BooleanField({ initial: ${lit(initial)} })`, kind: 'boolean', nullable: false, initial };
  }
  if (coreType === 'ZodString') {
    // trim: false on every string: Foundry's default (trim: true) would strip the whitespace a player typed.
    return { expr: `new fields.StringField({ required: true, nullable: true, initial: null, blank: true, trim: false })`, kind: 'string', nullable: true, initial: null };
  }
  if (coreType === 'ZodEnum') {
    const choices = [...core._def.values];
    // Foundry forces nullable: false on a choices StringField unless told otherwise; a nullable zod enum
    // with no default (incomingArc) must say nullable: true explicitly and start at null.
    const nullable = info.nullable;
    const initial = info.hasDefault ? info.defaultValue : null;
    const opts = [`required: true`, `nullable: ${nullable}`, `blank: false`, `initial: ${lit(initial)}`, `choices: ${lit(choices)}`, `trim: false`];
    return { expr: `new fields.StringField({ ${opts.join(', ')} })`, kind: 'enum', nullable, initial, choices };
  }
  return null;
}

/** @returns {{ expr: string, kind: string, nullable: boolean, initial: any, note?: string }} */
function fieldFor(key, z) {
  const info = unwrap(z);
  const prim = primitiveField(info);
  if (prim) return prim;
  const { core, coreType } = info;
  if (coreType === 'ZodArray') {
    const el = unwrap(core._def.type);
    const elPrim = primitiveField(el, { element: true });
    const nullable = info.nullable;
    const initial = info.hasDefault ? info.defaultValue : (nullable ? null : []);
    if (elPrim) {
      return { expr: `new fields.ArrayField(${elPrim.expr}, { required: true, nullable: ${nullable}, initial: ${lit(initial)} })`, kind: `array<${elPrim.kind}>`, nullable, initial };
    }
    // Arrays of objects/records/anything: opaque rows.
    return { expr: `new fields.ArrayField(new fields.ObjectField({ required: true, nullable: false }), { required: true, nullable: ${nullable}, initial: ${lit(initial)} })`, kind: 'array<object>', nullable, initial };
  }
  if (coreType === 'ZodObject' || coreType === 'ZodRecord' || coreType === 'ZodAny') {
    const nullable = info.nullable;
    const initial = info.hasDefault ? info.defaultValue : (nullable ? null : {});
    return { expr: `new fields.ObjectField({ required: true, nullable: ${nullable}, initial: ${lit(initial)} })`, kind: 'object', nullable, initial };
  }
  throw new Error(`gen-actor-schema: no mapping for "${key}" (zod ${coreType})`);
}

// ---- walk the schema ----------------------------------------------------------
const shape = schema.shape;
const rows = [];
const skipped = [];
for (const [key, z] of Object.entries(shape)) {
  const ex = EXCEPTIONS[key];
  if (ex?.skip) { skipped.push({ key, reason: ex.reason }); continue; }
  const info = unwrap(z);
  const mapped = ex?.override
    ? { expr: ex.override(info), kind: ['strength', 'dexterity', 'iq', 'health'].includes(key) ? 'number' : 'exception', nullable: true, initial: key === 'characterPortrait' ? null : (['strength', 'dexterity', 'iq', 'health'].includes(key) ? 10 : '') }
    : fieldFor(key, z);
  rows.push({ key, zod: describeZod(z), ...mapped, note: ex?.reason ?? '' });
}
// The lossless-export catch-all (ARCHITECTURE.md §4.1 "plus legacy: ObjectField").
rows.push({ key: 'legacy', zod: '(none)', expr: `new fields.ObjectField({ required: true, nullable: false, initial: {} })`, kind: 'object', nullable: false, initial: {}, note: 'unknown top-level keys an import carries, kept for lossless export (ARCHITECTURE.md §4.1)' });

function describeZod(z) {
  const parts = [];
  let cur = z;
  for (let g = 0; g < 16 && cur?._def?.typeName; g++) {
    const t = cur._def.typeName;
    if (t === 'ZodEffects') { parts.push(cur._def.effect?.type ?? 'effects'); cur = cur._def.schema; }
    else if (t === 'ZodOptional') { parts.push('optional'); cur = cur._def.innerType; }
    else if (t === 'ZodNullable') { parts.push('nullable'); cur = cur._def.innerType; }
    else if (t === 'ZodDefault') { parts.push(`default(${lit(cur._def.defaultValue())})`); cur = cur._def.innerType; }
    else { parts.push(t.replace('Zod', '').toLowerCase() + (t === 'ZodNumber' ? (numberChecks(cur).integer ? '.int' : '') : '')); break; }
  }
  return parts.join('>');
}

// ---- emit ------------------------------------------------------------------------
const info = existsSync(BUILD_INFO) ? JSON.parse(readFileSync(BUILD_INFO, 'utf8')) : {};
const generatedFrom = { websiteCommit: info.websiteCommit ?? null, websiteDirty: info.websiteDirty ?? null, bundleGeneratedAt: info.generatedAt ?? null, bundleBytes: info.bytes ?? null, schemaKeys: Object.keys(shape).length };
const nullableNumbers = rows.filter((r) => r.kind === 'number' && r.nullable).map((r) => r.key);

let out = '';
out += `// module/data/actor-schema.generated.mjs\n`;
out += `//\n// GENERATED by tools/gen-actor-schema.mjs from the engine bundle's characterSheetSchema.\n`;
out += `// DO NOT EDIT - regenerate (node tools/gen-actor-schema.mjs); check:actor-schema pins it byte-identical.\n`;
out += `// Every hand exception lives in the generator (its header lists them), never here.\n//\n`;
out += `// Source bundle: website commit ${generatedFrom.websiteCommit}${generatedFrom.websiteDirty ? ' (dirty)' : ''}, built ${generatedFrom.bundleGeneratedAt}, ${generatedFrom.bundleBytes} bytes.\n`;
out += `// ${Object.keys(shape).length} zod keys -> ${rows.length - 1} fields + legacy; skipped: ${skipped.map((s) => s.key).join(', ')}.\n\n`;
out += `/** Provenance of this file, for check:actor-schema and the smoke. */\n`;
out += `export const GENERATED_FROM = Object.freeze(${JSON.stringify(generatedFrom)});\n\n`;
out += `/** The website's CHARACTER_FORM_ARRAY_KEYS at generation time (23 row arrays). */\n`;
out += `export const ROW_ARRAY_KEYS = Object.freeze(${JSON.stringify(ROW_ARRAY_KEYS)});\n\n`;
out += `/** Row arrays that stay on the actor as ArrayField(ObjectField) rather than becoming Items. */\n`;
out += `export const SYSTEM_ROW_ARRAY_KEYS = Object.freeze(${JSON.stringify([...SYSTEM_ROW_ARRAYS])});\n\n`;
out += `/** Row arrays that become Items (ROW_ARRAY_KEYS minus SYSTEM_ROW_ARRAY_KEYS). */\n`;
out += `export const ITEM_ROW_ARRAY_KEYS = Object.freeze(${JSON.stringify(ITEM_ROW_ARRAYS)});\n\n`;
out += `/** Every key of the actor's system schema, in schema order. */\n`;
out += `export const SCHEMA_KEYS = Object.freeze(${JSON.stringify(rows.map((r) => r.key))});\n\n`;
out += `/**\n * Number fields where null is the website's sentinel ("derive" for attributes and\n * characteristics, "full" for the three current pools). The sheet's _processFormData\n * maps a blank input to null for these (the website's blankToNull, character-form-schema.ts).\n */\n`;
out += `export const NULLABLE_NUMBER_FIELDS = Object.freeze(${JSON.stringify(nullableNumbers)});\n\n`;
out += `/** Top-level zod keys the generator skipped, with the reason (for check:actor-schema). */\n`;
out += `export const SKIPPED_KEYS = Object.freeze(${JSON.stringify(Object.fromEntries(skipped.map((s) => [s.key, s.reason])))});\n\n`;
out += `/**\n * The dead echo fields (no writer and no reader on the website; see the generator's header): skipped\n * by name, never stored, never returned by the adapter (module/adapter.mjs DEAD_ECHO_FIELDS is this list).\n */\n`;
out += `export const DEAD_ECHO_KEYS = Object.freeze(${JSON.stringify([...DEAD_ECHO_KEYS])});\n\n`;
out += `/** { key: { kind, nullable, initial } } for every emitted field, so a check can compare against zod without re-deriving. */\n`;
out += `export const FIELD_TABLE = Object.freeze(${JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, { kind: r.kind, nullable: r.nullable, initial: r.initial === undefined ? null : r.initial, zod: r.zod }])))});\n\n`;
out += `/**\n * @param {typeof foundry.data.fields} fields\n * @returns {Record<string, foundry.data.fields.DataField>}\n */\n`;
out += `export function defineActorSchema(fields) {\n  return {\n`;
for (const r of rows) out += `    ${r.key}: ${r.expr},\n`;
out += `  };\n}\n`;

if (STDOUT) { process.stdout.write(out); }
else if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  if (current !== out) { console.error(`gen-actor-schema --check: ${OUT} differs from a fresh generation (regenerate and commit)`); process.exit(1); }
  console.log(`gen-actor-schema --check: OK (${rows.length} fields, byte-identical)`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out, 'utf8');
}

// ---- the table -----------------------------------------------------------------------
if (!STDOUT && !CHECK) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${pad('key', 30)} ${pad('zod', 46)} ${pad('kind', 14)} ${pad('nullable', 9)} initial`);
  for (const r of rows) console.log(`${pad(r.key, 30)} ${pad(r.zod, 46)} ${pad(r.kind, 14)} ${pad(r.nullable, 9)} ${lit(r.initial)}${r.note ? `   // ${r.note}` : ''}`);
  console.log(`\nskipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  ${pad(s.key, 28)} ${s.reason}`);
  console.log(`\n${rows.length} fields emitted (${nullableNumbers.length} nullable numbers) -> ${CHECK ? '(check only)' : OUT}`);
}
