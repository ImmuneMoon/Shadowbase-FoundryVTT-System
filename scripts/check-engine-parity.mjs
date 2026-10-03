#!/usr/bin/env node
// check:engine-parity
//
// The engine bundle must be the website's engine, byte for byte in effect: for
// every shipped template (and every fixture we carry), getCalculatedStats from
// engine/shadowbase-engine.mjs must return exactly what the website's own
// TypeScript returns when loaded the way the website's 147 checks load it (jiti
// with the '@' alias). Every key of CalculatedStatsResult is compared, with the
// key list taken from the WEBSITE side so a key the bundle drops cannot hide.
//
// THE REJECTED ALTERNATIVE is the old husk's hand-written rules: its Dodge was
// floor(Basic Speed) (5 on the blank sheet) where the book and the engine say
// floor(Basic Speed) + 3 (8). The pin below asserts the bundle gives the engine's
// answer and not the husk's, so a bundle that quietly fell back to a re-
// implementation would fail here rather than in play.
//
// ALSO: the bundle must be fresh. BUILD-INFO.json records the website commit
// and the build time; a bundle older than the newest website source file is a
// stale build and is reported as such (mutation: touch a website file). And
// it must be THIS repo's bundle (ARCHITECTURE.md §9.1 "engine-fresh"):
// BUILD-INFO.entry must resolve to tools/engine-entry.ts (a wave-1 bundle was
// built from a scratchpad variant entry - review m9), BUILD-INFO.entryExports
// must equal the entry's export count today (an entry edited after the last
// build is a stale bundle with a fresh mtime), the bundle must be newer than
// the entry, and the four exports the built code calls on every prepare or
// roll must be there: applyLoadMigrations, calculateMeleeWeaponStats,
// calculateLightsaberStats (U01's extractions) and the weaponAttackSkill
// namespace with attackSkillFor / attackHitBonus (module/rolls.mjs §5.1); and,
// since the website's 2026-09-29..10-03 round, reeling.reelingDodge,
// launcherWeapons.firesExplosivePayload, the postRollHalving reducer and
// blasterGasGrades.loadedGasHalvings (module/rolls.mjs: a Dodge under Reeling,
// the launcher test, a Damage roll's Ch11 halvings).
// Mutations fired for these (each turned the check red, then was restored):
// BUILD-INFO.entry pointed at a scratchpad path; one `export` line appended to
// tools/engine-entry.ts without a rebuild.
//
//   ENGINE_BUNDLE=<path> node scripts/check-engine-parity.mjs   # another bundle
//   SHADOWBASE_WEBSITE=<path> ...                                # another checkout

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { WEB } from '../tools/website-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ENGINE = resolve(process.env.ENGINE_BUNDLE ?? join(ROOT, 'engine', 'shadowbase-engine.mjs'));
const BUILD_INFO = join(dirname(ENGINE), 'BUILD-INFO.json');
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

let checked = 0;
const problems = [];
const ok = (label, cond, detail) => { checked++; if (!cond) problems.push(`${label}${detail ? ` - ${detail}` : ''}`); };
const fail = (msg) => { console.error(`check:engine-parity FAILED - ${msg}`); process.exit(1); };

if (!existsSync(ENGINE)) fail(`engine bundle missing at ${ENGINE} (run npm run build:engine)`);
if (!existsSync(join(WEB, 'node_modules', 'jiti'))) fail(`website jiti missing under ${WEB}`);

// ---- the website side, loaded the way its own checks load it ---------------
const require = createRequire(join(WEB, 'package.json'));
const jiti = require('jiti')(join(WEB, 'package.json'), {
  alias: { '@': join(WEB, 'src') }, interopDefault: true, esmResolve: true,
});
const W = {
  calc: jiti(join(WEB, 'src/hooks/use-character-calculations.ts')),
  templates: jiti(join(WEB, 'src/lib/character-templates.ts')),
};

// ---- the bundle ------------------------------------------------------------
const E = await import(pathToFileURL(ENGINE).href);
ok('bundle exports getCalculatedStats', typeof E.getCalculatedStats === 'function');
ok('bundle exports characterTemplateStore', E.characterTemplateStore && typeof E.characterTemplateStore === 'object');

// ---- freshness -------------------------------------------------------------
const newestSource = (dir) => {
  let newest = 0;
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) { if (!/^(node_modules|\.next|\.refactor-backup)$/.test(ent.name)) walk(p); }
      else if (/\.(ts|tsx|json)$/.test(ent.name)) newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
};
const bundleMtime = statSync(ENGINE).mtimeMs;
const srcMtime = newestSource(join(WEB, 'src'));
ok('bundle is newer than every website source file (stale build)', bundleMtime >= srcMtime,
  `bundle ${new Date(bundleMtime).toISOString()} < newest src ${new Date(srcMtime).toISOString()} - run npm run build:engine`);
const ENTRY = join(ROOT, 'tools', 'engine-entry.ts');
if (existsSync(BUILD_INFO)) {
  const info = JSON.parse(readFileSync(BUILD_INFO, 'utf8'));
  // BUILD-INFO is tracked: a machine's absolute path (a drive letter or a leading slash) must never be written into it.
  const machinePath = (p) => typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\'));
  ok('BUILD-INFO names the website (its repository, never a machine path)', typeof info.website === 'string' && !machinePath(info.website), info.website);
  ok('BUILD-INFO records the package allow-list only', (info.packages ?? []).every((p) => ['zod', 'clsx', 'tailwind-merge'].includes(p)), `packages: ${(info.packages ?? []).join(', ')}`);
  // The entry: this repo's tools/engine-entry.ts, not a variant (review m9).
  ok('BUILD-INFO.entry resolves to tools/engine-entry.ts (not a scratchpad / variant entry)', typeof info.entry === 'string' && !machinePath(info.entry) && resolve(ROOT, info.entry) === resolve(ENTRY), `entry: ${info.entry}`);
  const entryExportsNow = (readFileSync(ENTRY, 'utf8').match(/^export /gm) ?? []).length;
  ok(`BUILD-INFO.entryExports (${info.entryExports}) equals the export count of tools/engine-entry.ts today (${entryExportsNow}) - an edited entry needs a rebuild`, info.entryExports === entryExportsNow);
  ok('the bundle is newer than tools/engine-entry.ts', bundleMtime >= statSync(ENTRY).mtimeMs, `bundle ${new Date(bundleMtime).toISOString()} < entry ${new Date(statSync(ENTRY).mtimeMs).toISOString()} - run npm run build:engine`);
  ok('BUILD-INFO.generatedAt is an ISO timestamp', typeof info.generatedAt === 'string' && !Number.isNaN(Date.parse(info.generatedAt)));
} else {
  ok('BUILD-INFO.json exists beside the bundle', false, BUILD_INFO);
}
// The exports the built code calls on every prepare or roll (ARCHITECTURE.md §2, §2.1, §5.1).
for (const name of ['applyLoadMigrations', 'calculateMeleeWeaponStats', 'calculateLightsaberStats']) {
  ok(`bundle exports ${name} as a function (U01's extraction, ARCHITECTURE.md §2.1)`, typeof E[name] === 'function', typeof E[name]);
}
ok('bundle exports the weaponAttackSkill namespace with attackSkillFor and attackHitBonus (ARCHITECTURE.md §5.1)', E.weaponAttackSkill && typeof E.weaponAttackSkill.attackSkillFor === 'function' && typeof E.weaponAttackSkill.attackHitBonus === 'function', `weaponAttackSkill: ${E.weaponAttackSkill ? Object.keys(E.weaponAttackSkill).join(',') : 'undefined'}`);
ok('the entry file itself lists weaponAttackSkill (the bundle export is not an accident of a variant entry)', /export \* as weaponAttackSkill from '@\/lib\/weapon-attack-skill'/.test(readFileSync(ENTRY, 'utf8')));
// The website's 2026-09-29..10-03 round (631ebe9): the three rule homes module/rolls.mjs calls for a Dodge under Ch7's
// Reeling, for the launcher test and for a Damage roll's Ch11 halvings - each a bundle export, never a restatement.
ok('bundle exports reeling.reelingDodge (Ch7: the Form\'s Dodge bonus joins the unhalved figure)', typeof E.reeling?.reelingDodge === 'function', `reeling: ${E.reeling ? Object.keys(E.reeling).join(',') : 'undefined'}`);
ok('bundle exports launcherWeapons.firesExplosivePayload (Ch11: the ONE launcher test)', typeof E.launcherWeapons?.firesExplosivePayload === 'function', `launcherWeapons: ${E.launcherWeapons ? Object.keys(E.launcherWeapons).join(',') : 'undefined'}`);
ok('bundle exports postRollHalving (resolveDamageRoll, damageRollHalvings, rangeForDamageSource, hasHalfDamageRange) and blasterGasGrades.loadedGasHalvings (Ch11: the Damage roll\'s halvings)',
  ['resolveDamageRoll', 'damageRollHalvings', 'rangeForDamageSource', 'hasHalfDamageRange'].every((n) => typeof E.postRollHalving?.[n] === 'function') && typeof E.blasterGasGrades?.loadedGasHalvings === 'function', `postRollHalving: ${E.postRollHalving ? Object.keys(E.postRollHalving).join(',') : 'undefined'}`);

// ---- corpus ----------------------------------------------------------------
const unwrap = (t) => (typeof t?.data === 'function' ? t.data() : (t?.data ?? t));
const corpus = [];
for (const key of Object.keys(W.templates.characterTemplateStore)) {
  corpus.push({ name: `template:${key}`, web: unwrap(W.templates.characterTemplateStore[key]), eng: unwrap(E.characterTemplateStore[key]) });
}
ok('template store has the website\'s stated 65 entries', corpus.length === 65, `got ${corpus.length}`);
ok('bundle template store has the same keys', Object.keys(E.characterTemplateStore).join('|') === Object.keys(W.templates.characterTemplateStore).join('|'));

// Coverage fixtures (the only sheets with starships, vehicles, implants, limbs).
const fixturePath = join(WEB, 'scripts', 'fixtures', 'vessel-coverage.ts');
if (existsSync(fixturePath)) {
  // vessel-coverage.ts exports vesselOwnerFixture and droidVesselOwnerFixture,
  // the only sheets with starships, vehicles, implants, limbs and upgrades.
  const fx = jiti(fixturePath);
  const list = Object.entries(fx).filter(([k, v]) => /Fixture$/.test(k) && v && typeof v === 'object' && !Array.isArray(v));
  for (const [key, sheet] of list) {
    corpus.push({ name: `fixture:${key}`, web: sheet, eng: sheet });
  }
  ok('coverage fixtures loaded (vesselOwnerFixture, droidVesselOwnerFixture)', list.length >= 2, `${list.map(([k]) => k).join(', ')} in ${fixturePath}`);
}

// Real exports carried in this repo's fixtures/ (optional, may hold personal data - never committed by this tool).
const localFixtures = join(ROOT, 'fixtures');
if (existsSync(localFixtures)) {
  for (const f of readdirSync(localFixtures).filter((n) => n.endsWith('.json'))) {
    try {
      const json = JSON.parse(readFileSync(join(localFixtures, f), 'utf8'));
      const importer = jiti(join(WEB, 'src/lib/utils/character-json-importer.ts'));
      const sheet = { ...unwrap(W.templates.characterTemplateStore.blank), ...importer.convertJsonToSheet(json) };
      const sheetE = { ...unwrap(E.characterTemplateStore.blank), ...E.convertJsonToSheet(json) };
      corpus.push({ name: `export:${f}`, web: sheet, eng: sheetE });
    } catch (e) {
      ok(`fixture ${f} parses and imports`, false, e.message);
    }
  }
}

// ---- stable serialisation over EVERY result key ----------------------------
// Uuids are masked on BOTH sides: every template spreads blankSheetData, whose
// anatomy and Credit Chip rows mint fresh uuids at module evaluation, so the
// website's copy and the bundle's copy of the same template never share an id.
// Masking keeps the structure comparable; the numbers are what the check is for.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stable = (v) => {
  if (v instanceof Map) return { __map: [...v.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, x]) => [k, stable(x)]) };
  if (v instanceof Set) return { __set: [...v].map(stable) };
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  if (typeof v === 'number' && Number.isNaN(v)) return '__NaN';
  if (typeof v === 'string' && UUID.test(v)) return '<uuid>';
  return v;
};

// Data parity first: the bundle's template store must be the website's, uuids aside.
let storeDiffs = 0;
for (const c of corpus.filter((x) => x.name.startsWith('template:'))) {
  if (JSON.stringify(stable(c.web)) !== JSON.stringify(stable(c.eng))) storeDiffs++;
}
ok('bundle template store equals the website template store (uuids masked)', storeDiffs === 0, `${storeDiffs} templates differ`);

// Engine parity: the SAME sheet object into both engines, so only the code is under test.
let compared = 0;
const diffs = [];
let resultKeys = null;
for (const c of corpus) {
  let a, b;
  try { a = W.calc.getCalculatedStats(c.web); } catch (e) { diffs.push(`${c.name}: website threw ${e.message}`); continue; }
  try { b = E.getCalculatedStats(c.web); } catch (e) { diffs.push(`${c.name}: bundle threw ${e.message}`); continue; }
  resultKeys ??= Object.keys(a);
  ok(`${c.name}: bundle result has every website key`, Object.keys(a).every((k) => k in b), Object.keys(a).filter((k) => !(k in b)).join(', '));
  for (const k of resultKeys) {
    const sa = JSON.stringify(stable(a[k]));
    const sb = JSON.stringify(stable(b[k]));
    if (sa !== sb) diffs.push(`${c.name}.${k}: website ${sa.slice(0, 160)} | bundle ${sb.slice(0, 160)}`);
  }
  compared++;
}
ok('every corpus entry was compared', compared === corpus.length, `${compared}/${corpus.length}`);
ok('CalculatedStatsResult has the website\'s 32 keys (31 until the 2026-10-02 round added `reeling`)', (resultKeys ?? []).length >= 32 && (resultKeys ?? []).includes('reeling'), `got ${(resultKeys ?? []).length}`);
ok(`bundle and website agree on every key of every corpus entry (${compared} entries x ${(resultKeys ?? []).length} keys)`, diffs.length === 0, diffs.slice(0, 5).join('\n    '));

// ---- the rejected alternative: the husk's Dodge -----------------------------
const blank = unwrap(E.characterTemplateStore.blank);
const s = E.getCalculatedStats(blank);
const huskDodge = Math.floor(s.currentValues.basicSpeed);
ok('blank-sheet Dodge is the engine\'s floor(BS)+3, not the husk\'s floor(BS)', s.currentEncumbrance.dodge === huskDodge + 3 && s.currentEncumbrance.dodge !== huskDodge,
  `engine dodge ${s.currentEncumbrance.dodge}, husk would say ${huskDodge}`);

// ---- report ----------------------------------------------------------------
if (problems.length) {
  console.error(`check:engine-parity FAILED (${problems.length} of ${checked} assertions):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`check:engine-parity OK - ${checked} assertions, ${compared} corpus entries, ${(resultKeys ?? []).length} result keys, bundle ${statSync(ENGINE).size} bytes`);
