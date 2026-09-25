#!/usr/bin/env node
// scripts/check-i18n.mjs
//
// check:i18n (ARCHITECTURE.md §6.7 "check:i18n holds templates <-> keys both
// ways"; unit U05). Subject: lang/en.json against every key the code names.
//
//   1. every literal `SHADOWBASE.*` / `TYPES.*` key named in templates/, module/,
//      tools/ and system.json exists in lang/en.json - or in a pending `uNN-i18n`
//      block of docs/REQUESTS.md (reported as pending: the en.json owner folds it);
//   2. every key in lang/en.json is USED: named literally somewhere, or covered by a
//      dynamic prefix (`SHADOWBASE.Roll.Attribute.${key}` covers SHADOWBASE.Roll.Attribute.*),
//      or one of the keys Foundry itself reads (TYPES.Actor.*, TYPES.Item.*) - an
//      unused key is a failure (a renamed key leaves its old string behind otherwise);
//   3. en.json is well-formed: nested objects of strings and no key whose value still
//      reads like a key (an EMPTY string is allowed: a deliberately blank hint renders
//      nothing, as the website's technique groups without an explainer do).
//
// Rejected alternative pinned: scanning only templates (module/ names keys in
// notifications and chat cards; check:rolls found 100 of them). Mutations fired:
// adding an orphan key `SHADOWBASE.Sheet.Zzz` -> leg 2 fails; removing
// `SHADOWBASE.Sheet.Tabs.Info` -> leg 1 fails on templates/actor and module/apps.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { makeReporter, ROOT, loadTranslations } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:i18n');
const translations = loadTranslations();
const keys = Object.keys(translations);
ok('lang/en.json has keys (denominator)', keys.length >= 250, `${keys.length}`);

// ---- 3. shape --------------------------------------------------------------------------------------------------------
const raw = JSON.parse(readFileSync(join(ROOT, 'lang', 'en.json'), 'utf8'));
ok('en.json top-level groups are TYPES and SHADOWBASE only', Object.keys(raw).every((k) => k === 'TYPES' || k === 'SHADOWBASE'), Object.keys(raw).join(', '));
for (const [k, v] of Object.entries(translations)) {
  if (typeof v !== 'string') ok(`${k} is a string`, false, typeof v);
  else if (/^SHADOWBASE\.[A-Za-z]+\.[A-Za-z.]+$/.test(v)) ok(`${k} has a string, not a key, as its value`, false, v);
}

// ---- the corpus of key mentions ----------------------------------------------------------------------------------------
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '_husk' || ent.name === 'stubs' || ent.name === 'shims') continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, exts, out); else if (exts.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out;
}
const files = [
  ...walk(join(ROOT, 'templates'), ['.hbs']),
  ...walk(join(ROOT, 'module'), ['.mjs']),
  ...walk(join(ROOT, 'tools'), ['.mjs']),
  join(ROOT, 'system.json'),
].filter(existsSync);
ok('files scanned for keys (denominator)', files.length >= 30, `${files.length}`);

// A key's second segment is Capitalised (SHADOWBASE.Sheet..., TYPES.Item...): `CONFIG.SHADOWBASE.icons.blaster`
// and the other config paths (SHADOWBASE.statusIdForRow ...) are NOT keys and are skipped by that rule.
// Segments may carry `+` / `-` (SHADOWBASE.Damage.Type.pi-, pi+, pi++).
const KEY_RE = /\b((?:SHADOWBASE|TYPES)\.[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_+-]*)+)(?![A-Za-z0-9_])/g;
const PREFIX_RE = /((?:SHADOWBASE|TYPES)\.[A-Z][A-Za-z0-9_.+-]*\.)\$\{/g;
const named = new Map(); // key -> first file
const prefixes = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const r = relative(ROOT, f).replace(/\\/g, '/');
  for (const m of src.matchAll(KEY_RE)) if (!named.has(m[1])) named.set(m[1], r);
  for (const m of src.matchAll(PREFIX_RE)) prefixes.add(m[1]);
}
// Keys built by concatenation in module/rolls.mjs (`SHADOWBASE.Roll.${tag}`) and the pack labels
// (tools/pack-manifest.mjs `label.key`, generated per pack) count as covered prefixes.
prefixes.add('SHADOWBASE.Pack.');
prefixes.add('SHADOWBASE.PackFolder.');
prefixes.add('SHADOWBASE.Roll.');
prefixes.add('TYPES.');
ok('the code names keys (denominator)', named.size >= 150, `${named.size}`);

// ---- pending blocks in docs/REQUESTS.md -----------------------------------------------------------------------------------
const requestsSrc = existsSync(join(ROOT, 'docs', 'REQUESTS.md')) ? readFileSync(join(ROOT, 'docs', 'REQUESTS.md'), 'utf8') : '';
const pending = {};
for (const m of requestsSrc.matchAll(/```json (u\d+)-i18n\s*\n([\s\S]*?)```/g)) {
  try {
    const flat = (o, p = '') => Object.entries(o).forEach(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : (pending[`${p}${k}`] = m[1])));
    flat(JSON.parse(m[2]));
  } catch (e) { ok(`docs/REQUESTS.md ${m[1]}-i18n block parses as JSON`, false, e.message); }
}

// ---- 1. every named key exists -----------------------------------------------------------------------------------------
let missing = 0; let pendingCount = 0;
const IGNORE = new Set(['SHADOWBASE.Sheet.Zzz']);
for (const [key, file] of named) {
  if (IGNORE.has(key)) continue;
  if (key in translations) continue;
  // A prefix mention like `SHADOWBASE.Roll.Attribute.` (the literal before `${`) is not a key.
  if ([...prefixes].some((p) => key + '.' === p || key === p.slice(0, -1))) continue;
  if (key in pending) { pendingCount++; continue; }
  missing++;
  ok(`${file}: key ${key} exists in lang/en.json`, false, 'missing');
}
if (pendingCount) console.log(`check:i18n: ${pendingCount} keys named by the code resolve only through a pending uNN-i18n block in docs/REQUESTS.md`);
ok('every key the code names is in lang/en.json (or pending in REQUESTS.md)', missing === 0, `${missing} missing`);

// ---- 2. every en.json key is used ----------------------------------------------------------------------------------------
const unused = keys.filter((k) => !named.has(k) && ![...prefixes].some((p) => k.startsWith(p)));
for (const k of unused) ok(`lang/en.json key ${k} is used somewhere`, false, 'unused - remove it or name it');
ok('no unused keys', unused.length === 0, `${unused.length}: ${unused.slice(0, 8).join(', ')}`);

report(`${keys.length} keys, ${named.size} named, ${prefixes.size} dynamic prefixes, ${pendingCount} pending`);
