#!/usr/bin/env node
// check:actor-schema
//
// SUBJECT: module/data/actor-schema.generated.mjs, the actor's system schema,
// which tools/gen-actor-schema.mjs derives from the engine bundle's
// `characterSheetSchema` (zod). Three things are pinned:
//
//   1. The file on disk IS a fresh generation - regenerated here into a temp
//      path and compared byte for byte, so a hand edit to the output (the
//      thing ARCHITECTURE.md §4.1 forbids: "Hand exceptions are declared in the
//      generator, never edited into the output") is a red check, and so is a
//      generator change nobody regenerated for. GENERATED_FROM must also name
//      the bundle in engine/BUILD-INFO.json, or the schema was generated from
//      another build than the one that ships.
//
//   2. Every top-level zod key is accounted for: a system field, or one of
//      the DECLARED skips (row arrays -> Items, characterName -> actor.name,
//      lastSaved -> _stats, statusEffects -> ActiveEffects, and the 13 DEAD
//      ECHO keys the generator skips by name - ARCHITECTURE.md §9.1). The key
//      list is the bundle's, never this file's, so a key the website adds
//      tomorrow fails here rather than vanishing on import. The dead list is
//      pinned both ways: exactly §9.1's thirteen, each skipped with the dead
//      reason and never a field; and the keys §9.1 keeps LIVE (pointsOther,
//      activeFormWeaponId, incomingArc, pointsAttributes/Advantages/
//      Disadvantages) are fields with the §9.1 shapes.
//   4. The §9.1 generator rows hold on the LIVE fields: every StringField is
//      trim: false (a `StringField({ trim: true })` - Foundry's default - is the
//      rejected alternative, shown stripping the whitespace of a notes value
//      the real field keeps); description/background/notes are StringFields
//      with initial "" and NOT HTMLFields; incomingArc is a nullable choices
//      field starting at null; droidBuild / gearSets / storageBoxes /
//      pinnedNotifications are nullable; shipPosition is a nullable string.
//
//   3. NULLABLE_NUMBER_FIELDS equals the set of number fields where null is
//      the website's sentinel. That set is derived HERE from zod's own parse
//      (safeParse(null) yields null, or safeParse(undefined) yields undefined -
//      a value Foundry cannot store and the generator maps to null),
//      independently of the generator's walk, plus the one declared exception
//      (the four primaries, nullable because every shipped droid template
//      stores null for them and derives from hardware - the check proves that
//      corpus fact rather than taking the generator's word).
//
// THE REJECTED ALTERNATIVE, against the app's own code path: a NumberField
// that coerces null to a number for `hitPoints` - the old husk's family
// (_husk/scripts/calculations.js `attributes[attrName]?.value || 10`,
// _husk/template.json `"hitPoints": { "base": 0, ... }`). The pin builds an
// actor through the registered CharacterData with hitPoints null and shows
// the engine derives HP from HT (10 on the blank); then cleans null through
// the alternative field (nullable: false, initial: 0) and shows the engine
// would read HP 0 - the figure the sheet must never show.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - actor-schema.generated.mjs: one space added to a comment line
//       -> "generated file is byte-identical to a fresh generation"
//   - gen-actor-schema.mjs: the four primaries' override made nullable: false
//       -> nullable-set pin (4 missing) + "droid primaries stay null" pin
//   - gen-actor-schema.mjs: hitPoints overridden to NumberField({ nullable: false, initial: 0 })
//       -> nullable-set pin + "hitPoints null survives cleaning" (system.hitPoints 0, HP 0)
//   - gen-actor-schema.mjs (U02c): 'pointsSkills' removed from DEAD_ECHO_KEYS
//       -> "DEAD_ECHO_KEYS is exactly §9.1's thirteen" + "the non-row skips are exactly ..."
//   - gen-actor-schema.mjs (U02c): `trim: false` dropped from the ZodString row
//       -> "every live StringField is trim: false" + "notes keeps its whitespace"
//
//   node scripts/check-actor-schema.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { makeReporter, installSystem, ROOT, unwrap } from './lib/harness.mjs';

const { ok, fail, report } = makeReporter('check:actor-schema');
const GENERATED = join(ROOT, 'module', 'data', 'actor-schema.generated.mjs');
const GENERATOR = join(ROOT, 'tools', 'gen-actor-schema.mjs');
const BUILD_INFO = join(ROOT, 'engine', 'BUILD-INFO.json');

if (!existsSync(GENERATED)) fail(`${GENERATED} missing - run node tools/gen-actor-schema.mjs`);
if (!existsSync(GENERATOR)) fail(`${GENERATOR} missing`);

// ---- 1. byte-identical regeneration -------------------------------------------
const tmp = mkdtempSync(join(process.env.CLAUDE_SCRATCHPAD ?? tmpdir(), 'sb-actor-schema-'));
try {
  const gen = spawnSync(process.execPath, [GENERATOR, '--stdout'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  ok('generator runs (--stdout)', gen.status === 0, (gen.stderr || gen.stdout).slice(0, 300));
  const fresh = join(tmp, 'actor-schema.generated.mjs');
  writeFileSync(fresh, gen.stdout, 'utf8');
  const onDisk = readFileSync(GENERATED);
  const regenerated = readFileSync(fresh);
  ok('generated file is byte-identical to a fresh generation', Buffer.compare(onDisk, regenerated) === 0,
    `${onDisk.length} vs ${regenerated.length} bytes - run node tools/gen-actor-schema.mjs and review the diff`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- the system, registered as init registers it ---------------------------------
const { shim, engine, generated, config } = await installSystem();
const schema = engine.characterSheetSchema;
const shape = schema?.shape ?? {};
const ZOD_KEYS = Object.keys(shape);
const ROW_KEYS = new Set(engine.CHARACTER_FORM_ARRAY_KEYS);
ok('characterSheetSchema is a ZodObject with keys', schema?._def?.typeName === 'ZodObject' && ZOD_KEYS.length > 100, `${ZOD_KEYS.length} keys`);
ok('CHARACTER_FORM_ARRAY_KEYS has the website\'s 23 row arrays', ROW_KEYS.size === 23, `${ROW_KEYS.size}`);

// Provenance: the schema was generated from THIS bundle.
if (existsSync(BUILD_INFO)) {
  const info = JSON.parse(readFileSync(BUILD_INFO, 'utf8'));
  const g = generated.GENERATED_FROM;
  ok('GENERATED_FROM names the bundle in engine/BUILD-INFO.json (commit, build time, bytes)',
    g.websiteCommit === info.websiteCommit && g.bundleGeneratedAt === info.generatedAt && g.bundleBytes === info.bytes,
    `generated from ${g.websiteCommit}@${g.bundleGeneratedAt} (${g.bundleBytes} b), bundle is ${info.websiteCommit}@${info.generatedAt} (${info.bytes} b) - regenerate`);
  ok('GENERATED_FROM.schemaKeys equals the bundle\'s key count', g.schemaKeys === ZOD_KEYS.length, `${g.schemaKeys} vs ${ZOD_KEYS.length}`);
} else {
  ok('engine/BUILD-INFO.json exists', false, BUILD_INFO);
}

// ---- 2. every zod key is a field or a declared skip -----------------------------------
const SCHEMA_KEYS = new Set(generated.SCHEMA_KEYS);
const SKIPPED = generated.SKIPPED_KEYS;
/** ARCHITECTURE.md §9.1's dead-echo list, as a declaration of the architecture (the generator's list must equal it). */
const DEAD_ECHO_PER_ARCHITECTURE = ['drHead', 'drTorso', 'parry', 'block', 'flawedBuild', 'currentValues', 'pointsSkills', 'basicLift', 'damageThrust', 'damageSwing', 'spentPoints', 'remainingPoints', 'trackPurchases'];
/** The keys §9.1 names as LIVE (must stay fields), with the shape it gives each. */
const KEPT_LIVE = { pointsOther: 'number', activeFormWeaponId: 'string', incomingArc: 'enum', pointsAttributes: 'number', pointsAdvantages: 'number', pointsDisadvantages: 'number' };
const DECLARED_NON_ROW_SKIPS = ['characterName', 'lastSaved', 'statusEffects', ...DEAD_ECHO_PER_ARCHITECTURE];
const nonRow = ZOD_KEYS.filter((k) => !ROW_KEYS.has(k));
const unaccounted = nonRow.filter((k) => !SCHEMA_KEYS.has(k) && !(k in SKIPPED));
ok(`every non-row characterSheetSchema key (${nonRow.length}) is a system field or a declared skip`, unaccounted.length === 0, unaccounted.join(', '));
const skippedNonRow = nonRow.filter((k) => k in SKIPPED);
ok('the non-row skips are exactly characterName, lastSaved, statusEffects and the 13 dead echo keys', skippedNonRow.sort().join(',') === [...DECLARED_NON_ROW_SKIPS].sort().join(','), skippedNonRow.join(','));
ok('no skipped key is also a field', Object.keys(SKIPPED).every((k) => !SCHEMA_KEYS.has(k)));
ok('DEAD_ECHO_KEYS is exactly §9.1\'s thirteen (the generator\'s list equals the architecture\'s)', [...generated.DEAD_ECHO_KEYS].sort().join(',') === [...DEAD_ECHO_PER_ARCHITECTURE].sort().join(',') && generated.DEAD_ECHO_KEYS.length === 13, generated.DEAD_ECHO_KEYS.join(','));
for (const k of generated.DEAD_ECHO_KEYS) {
  ok(`dead echo "${k}": a zod key, skipped with the dead reason, never a field`, ZOD_KEYS.includes(k) && typeof SKIPPED[k] === 'string' && /dead echo/.test(SKIPPED[k]) && !SCHEMA_KEYS.has(k), SKIPPED[k]);
}
for (const [k, kind] of Object.entries(KEPT_LIVE)) {
  ok(`"${k}" stays a live field of kind ${kind} (§9.1 keeps it)`, SCHEMA_KEYS.has(k) && generated.FIELD_TABLE[k]?.kind === kind && !(k in SKIPPED), JSON.stringify(generated.FIELD_TABLE[k]));
}
const rowFields = [...ROW_KEYS].filter((k) => SCHEMA_KEYS.has(k));
ok('the only row array kept as a system field is hitLocations (SYSTEM_ROW_ARRAY_KEYS)', rowFields.join(',') === 'hitLocations' && generated.SYSTEM_ROW_ARRAY_KEYS.join(',') === 'hitLocations', rowFields.join(','));
ok('every other row array is an Item source (ITEM_ROW_ARRAY_KEYS = 22)', generated.ITEM_ROW_ARRAY_KEYS.length === 22 && generated.ITEM_ROW_ARRAY_KEYS.every((k) => ROW_KEYS.has(k) && !SCHEMA_KEYS.has(k) && config.SOURCE_TO_TYPE[k]));
ok('statusEffects is not a system field (it is ActiveEffects, §4.4)', !SCHEMA_KEYS.has('statusEffects') && 'statusEffects' in SKIPPED);
ok('legacy is the one field with no zod key', [...SCHEMA_KEYS].filter((k) => !ZOD_KEYS.includes(k)).join(',') === 'legacy');
const model = CONFIG.Actor.dataModels.character;
const fieldNames = Object.keys(model.schema.fields);
ok('CharacterData.defineSchema emits exactly SCHEMA_KEYS, in order', fieldNames.join('|') === generated.SCHEMA_KEYS.join('|'), `${fieldNames.length} fields vs ${generated.SCHEMA_KEYS.length}`);

// ---- 4. the §9.1 generator rows on the LIVE fields ----------------------------------------------------
{
  const F = model.schema.fields;
  const strings = fieldNames.filter((k) => F[k] instanceof shim.StringField);
  ok('the schema has string fields to inspect (denominator)', strings.length >= 20, `${strings.length}`);
  ok('every live StringField is trim: false (notes keep their whitespace; Foundry\'s default trim: true is the rejected alternative)', strings.every((k) => F[k].trim === false), strings.filter((k) => F[k].trim !== false).join(','));
  for (const k of ['description', 'background', 'notes']) {
    ok(`${k}: a StringField (not HTMLField) with initial "" - the website binds a <textarea>`, F[k] instanceof shim.StringField && !(F[k] instanceof shim.HTMLField) && F[k].initial === '' && F[k].nullable === true && F[k].trim === false);
  }
  ok('incomingArc: nullable choices StringField starting at null (a nullable enum with no default)', F.incomingArc instanceof shim.StringField && F.incomingArc.nullable === true && F.incomingArc.initial === null && Array.isArray(F.incomingArc.choices) && F.incomingArc.choices.includes('Front'));
  for (const k of ['pointsAttributes', 'pointsAdvantages', 'pointsDisadvantages']) {
    ok(`${k}: nullable integer NumberField, initial null (the optional-int shape)`, F[k] instanceof shim.NumberField && F[k].nullable === true && F[k].integer === true && F[k].initial === null);
  }
  ok('droidBuild: ObjectField nullable (a null droidBuild stays null, never {})', F.droidBuild instanceof shim.ObjectField && F.droidBuild.nullable === true && F.droidBuild.initial === null);
  for (const k of ['gearSets', 'storageBoxes', 'pinnedNotifications']) ok(`${k}: ArrayField(ObjectField) nullable`, F[k] instanceof shim.ArrayField && F[k].nullable === true);
  ok('shipPosition: nullable StringField (the JSON doc\'s "object | null" is stale - the schema and the select store a string)', F.shipPosition instanceof shim.StringField && F.shipPosition.nullable === true && F.shipPosition.initial === null);
  // The rejected alternative, through the real field: a trim: true StringField strips what the live notes field keeps.
  const kept = '  two leading spaces, a trailing newline\n';
  const alt = new shim.StringField({ required: true, nullable: true, initial: '', blank: true, trim: true });
  const { sheetToActorData: toActor } = (await import(new URL('../module/adapter.mjs', import.meta.url).href));
  const notesActor = shim.buildActor(toActor({ ...engine.blank(), notes: kept, description: kept, background: kept }));
  ok('notes/description/background keep leading and trailing whitespace through the real fields; the rejected trim: true field strips it', notesActor.system.notes === kept && notesActor.system.description === kept && notesActor.system.background === kept && alt.clean(kept) === kept.trim(), JSON.stringify([notesActor.system.notes, alt.clean(kept)]));
  const nullArc = shim.buildActor(toActor({ ...engine.blank(), incomingArc: null, droidBuild: null, gearSets: null }));
  ok('incomingArc null, droidBuild null and gearSets null survive cleaning as null', nullArc.system.incomingArc === null && nullArc.system.droidBuild === null && nullArc.system.gearSets === null, JSON.stringify([nullArc.system.incomingArc, nullArc.system.droidBuild, nullArc.system.gearSets]));
}

// ---- 3. the nullable set, from zod's own parse ---------------------------------------------
/** Core zod type after the wrappers (effects/optional/nullable/default); only the TYPE is read here, never the wrappers. */
const coreTypeOf = (z) => {
  let cur = z;
  for (let i = 0; i < 16; i++) {
    const t = cur?._def?.typeName;
    if (t === 'ZodEffects') cur = cur._def.schema;
    else if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') cur = cur._def.innerType;
    else return t ?? 'unknown';
  }
  return 'unknown';
};
const numberKeys = nonRow.filter((k) => coreTypeOf(shape[k]) === 'ZodNumber' && SCHEMA_KEYS.has(k));
ok('the schema has number fields to classify (denominator)', numberKeys.length >= 50, `${numberKeys.length}`);

/** The value of the ZodDefault anywhere in the chain (`.default(0).optional()` keeps its 0 for the sheet), or undefined. */
const chainDefault = (z) => {
  let cur = z;
  for (let i = 0; i < 16; i++) {
    const t = cur?._def?.typeName;
    if (t === 'ZodDefault') return cur._def.defaultValue();
    if (t === 'ZodEffects') cur = cur._def.schema;
    else if (t === 'ZodOptional' || t === 'ZodNullable') cur = cur._def.innerType;
    else return undefined;
  }
  return undefined;
};
const zodNullable = [];
const zodDefaulted = [];
for (const k of numberKeys) {
  const z = shape[k];
  const onNull = z.safeParse(null);
  const onUndefined = z.safeParse(undefined);
  const fallback = chainDefault(z);
  // null is the website's sentinel when zod hands null back as a value (nullable / preprocess-to-null), or when
  // an absent value stays undefined with no default anywhere to fall back on (Foundry stores that as null).
  const nullIsSentinel = (onNull.success && onNull.data === null) || (onUndefined.success && onUndefined.data === undefined && fallback === undefined);
  if (nullIsSentinel) zodNullable.push(k);
  else zodDefaulted.push({ key: k, onNull: onNull.success ? onNull.data : 'rejected', onUndefined: onUndefined.success ? onUndefined.data : 'rejected', fallback });
}
// The declared exception (tools/gen-actor-schema.mjs EXCEPTIONS): zod turns a null primary into 10, the website's
// importer stores null on purpose ("Null, not 10", character-json-importer.ts) and every shipped droid template
// stores null - so Foundry must keep the null. Both halves are proven here, not assumed.
const PRIMARIES = ['strength', 'dexterity', 'iq', 'health'];
for (const k of PRIMARIES) {
  const d = zodDefaulted.find((x) => x.key === k);
  ok(`${k}: zod itself defaults null to 10 (the exception departs from zod, deliberately)`, d && d.onNull === 10, JSON.stringify(d));
}
const droids = Object.entries(engine.characterTemplateStore).map(([key, t]) => [key, unwrap(t)]).filter(([, s]) => s.isDroid);
const droidsWithNullPrimaries = droids.filter(([, s]) => PRIMARIES.every((k) => s[k] === null));
ok('the shipped droid templates store null primaries (the reason for the exception)', droids.length > 0 && droidsWithNullPrimaries.length === droids.length, `${droidsWithNullPrimaries.length}/${droids.length} droids`);

const expectedNullable = new Set([...zodNullable, ...PRIMARIES]);
const declared = new Set(generated.NULLABLE_NUMBER_FIELDS);
const missing = [...expectedNullable].filter((k) => !declared.has(k));
const extra = [...declared].filter((k) => !expectedNullable.has(k));
ok(`NULLABLE_NUMBER_FIELDS equals zod's null-sentinel numbers (${zodNullable.length}) plus the four primaries`, missing.length === 0 && extra.length === 0,
  `missing ${missing.join(',') || '-'}; extra ${extra.join(',') || '-'}`);
for (const k of numberKeys) {
  const f = model.schema.fields[k];
  const shouldBeNullable = expectedNullable.has(k);
  ok(`${k}: the live field's nullable flag is ${shouldBeNullable}`, f && f.nullable === shouldBeNullable && (generated.FIELD_TABLE[k]?.nullable === shouldBeNullable), `field nullable=${f?.nullable}, table nullable=${generated.FIELD_TABLE[k]?.nullable}`);
  if (!shouldBeNullable) {
    // Non-nullable is allowed only where zod itself never yields a null: it defaults null to a number
    // (preprocess), or rejects it outright (the website's sanitizer-null migration strips such nulls before
    // the form sees them) - and an absent value has a number to fall back on.
    const d = zodDefaulted.find((x) => x.key === k);
    const fallback = typeof d?.onUndefined === 'number' ? d.onUndefined : d?.fallback;
    ok(`${k}: non-nullable only because zod defaults or rejects null and absent falls back to ${JSON.stringify(fallback)}`,
      d && (typeof d.onNull === 'number' || d.onNull === 'rejected') && typeof fallback === 'number', JSON.stringify(d));
    ok(`${k}: the generated initial is zod's fallback (${JSON.stringify(fallback)})`, generated.FIELD_TABLE[k]?.initial === fallback, `initial ${JSON.stringify(generated.FIELD_TABLE[k]?.initial)}`);
  }
}

// ---- the rejected alternative: null coerced to a number for hitPoints -----------------------------
const blank = engine.blank();
const { sheetToActorData, actorToSheet } = (await import(new URL('../module/adapter.mjs', import.meta.url).href));
const withNullHp = shim.buildActor(sheetToActorData({ ...blank, hitPoints: null }));
ok('hitPoints null survives cleaning (system.hitPoints === null) and the engine derives HP from HT', withNullHp.system.hitPoints === null && withNullHp.system.derived?.currentValues.hitPoints === withNullHp.system.derived?.primaryAttributes.effectiveHealth,
  `system.hitPoints ${JSON.stringify(withNullHp.system.hitPoints)}, HP ${withNullHp.system.derived?.currentValues.hitPoints}`);
ok('actorToSheet hands the engine null, not 0', actorToSheet(withNullHp).hitPoints === null);
{
  const alternative = new shim.NumberField({ required: true, nullable: false, initial: 0, integer: true });
  const coerced = alternative.clean(null);
  const wouldRead = engine.getCalculatedStats({ ...blank, hitPoints: coerced }).currentValues.hitPoints;
  const correct = engine.getCalculatedStats({ ...blank, hitPoints: null }).currentValues.hitPoints;
  ok('the rejected NumberField({ nullable: false, initial: 0 }) turns the null sentinel into 0 and the engine then reads HP 0 (the husk\'s || 10 family) - not what the actor stores',
    coerced === 0 && wouldRead === 0 && correct > 0 && withNullHp.system.derived?.currentValues.hitPoints === correct,
    `alternative cleans null -> ${coerced}, engine HP ${wouldRead}; correct HP ${correct}`);
}
for (const k of generated.NULLABLE_NUMBER_FIELDS) {
  const actor = shim.buildActor(sheetToActorData({ ...blank, [k]: null }));
  ok(`${k}: null stored stays null (never 0)`, actor.system[k] === null, JSON.stringify(actor.system[k]));
}
{
  const [key, droid] = droidsWithNullPrimaries[0] ?? [];
  if (droid) {
    const actor = shim.buildActor(sheetToActorData(droid));
    const pure = engine.getCalculatedStats(droid);
    const hardwareIq = pure.primaryAttributes.effectiveIQ;
    // The rejected reading: null cleaned to 10 hands the engine a STORED IQ of 10, which beats the hardware base.
    const coercedIq = engine.getCalculatedStats({ ...droid, iq: 10 }).primaryAttributes.effectiveIQ;
    ok(`droid template "${key}": primaries stay null on the actor and the engine derives IQ ${hardwareIq} from hardware (a coerced 10 would read ${coercedIq})`,
      PRIMARIES.every((k) => actor.system[k] === null) && typeof hardwareIq === 'number' && hardwareIq !== coercedIq
        && actor.system.derived?.primaryAttributes.effectiveIQ === hardwareIq,
      `actor iq ${JSON.stringify(actor.system.iq)}, effectiveIQ ${actor.system.derived?.primaryAttributes.effectiveIQ} vs hardware ${hardwareIq} / coerced ${coercedIq}`);
  }
}

report(`${ZOD_KEYS.length} zod keys, ${generated.SCHEMA_KEYS.length} fields, ${generated.NULLABLE_NUMBER_FIELDS.length} nullable numbers, ${droids.length} droid templates`);
