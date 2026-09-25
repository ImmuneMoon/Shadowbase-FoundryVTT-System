#!/usr/bin/env node
// check:esm
//
// SUBJECT: every ES module of the system (module/, tools/, scripts/):
//   1. `node --check` passes (syntax, and top-level `await` in a module);
//   2. every relative import / dynamic import / `export * from` / `new URL(x, import.meta.url)`
//      resolves to a file on disk (a typo in a path is a load-time failure in Foundry);
//   3. module/ (the code that ships to the browser) imports the engine bundle from
//      module/engine.mjs ONLY (ARCHITECTURE.md §2) and never a `node:` builtin;
//   4. the Foundry APIs the v13 rewrite forbids are ABSENT from module/ - Application v1
//      (`foundry.appv1`, `FormApplication`, `Dialog.confirm`), jQuery (`jQuery`, `$(`),
//      `CHAT_MESSAGE_TYPES`, and the bare globals `renderTemplate(`, `loadTemplates(`,
//      `mergeObject(` (v13 wants foundry.applications.handlebars.* / foundry.utils.*).
//
// THE DENOMINATOR: a sweep that finds nothing is indistinguishable from a sweep
// whose patterns match nothing (the website CLAUDE.md: "a sweep that filters on
// the thing under test has no denominator"). So the same scanner runs over a
// positive control, fixtures/husk/actor.js - the retired system's actor.js, a
// verbatim copy - and the check FAILS unless the control exists and scores at
// least one hit (`CONST.CHAT_MESSAGE_TYPES.ROLL` on its chat-card lines). The
// rejected alternative is a scan with no control at all: it would have passed
// on the day a pattern typo silenced it.
//
// Comments are stripped before the token scan (a comment that NAMES a forbidden
// API is documentation, not use); strings are scanned as code.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - module/effects.mjs: `Dialog.confirm({});` added as a statement -> forbidden-token pin
//   - module/effects.mjs: import path './config.mjs' -> './confg.mjs' -> import-graph pin
//   - fixtures/husk/actor.js renamed away -> "positive control present and scoring"
//   - module/effects.mjs: a stray `}` appended -> node --check pin
//
//   node scripts/check-esm.mjs

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { makeReporter, ROOT } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:esm');

const SCAN_DIRS = ['module', 'tools', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '_husk', 'stubs', 'shims']);
const CONTROL = join(ROOT, 'fixtures', 'husk', 'actor.js');

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(join(dir, ent.name), out); }
    else if (ent.name.endsWith('.mjs')) out.push(join(dir, ent.name));
  }
  return out;
}
const files = SCAN_DIRS.flatMap((d) => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d)) : []));
const moduleFiles = files.filter((f) => relative(ROOT, f).replace(/\\/g, '/').startsWith('module/'));
ok('modules found under module/ tools/ scripts/ (denominator)', files.length >= 20 && moduleFiles.length >= 12, `${files.length} files, ${moduleFiles.length} under module/`);

// ---- 1. node --check --------------------------------------------------------------------------
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  ok(`node --check ${relative(ROOT, f)}`, r.status === 0, (r.stderr || '').split('\n').slice(0, 3).join(' | '));
}

// ---- comment stripping (for the import graph and the token scan) -------------------------------------
/** Strip // and /* *\/ comments, keeping strings, template literals and regex literals intact. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prevSignificant = '';
  const regexCanStart = () => prevSignificant === '' || /[(,=:\[!&|?{};+\-*%<>~^]/.test(prevSignificant) || /\b(return|typeof|case|do|else|in|of|new|delete|void|throw)$/.test(prevSignificant);
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; } out += src[i]; i++; }
      out += src[i] ?? ''; i++;
      prevSignificant = q;
      continue;
    }
    if (c === '/' && regexCanStart()) {
      out += c; i++;
      let inClass = false;
      while (i < n && (inClass || src[i] !== '/') && src[i] !== '\n') {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
        out += src[i]; i++;
      }
      out += src[i] ?? ''; i++;
      prevSignificant = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) {
      // Keep enough tail to recognise a keyword before a regex literal.
      prevSignificant = /[A-Za-z_$]/.test(c) ? (/[A-Za-z_$]$/.test(prevSignificant) ? prevSignificant + c : c).slice(-8) : c;
    }
    i++;
  }
  return out;
}

// ---- 2. the import graph -----------------------------------------------------------------------------
const IMPORT_RES = [
  /\bimport\s+(?:[^'";]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bexport\s+\*\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bexport\s+\{[^}]*\}\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /new\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
];
let edges = 0;
const bundleImporters = [];
const nodeImporters = [];
for (const f of files) {
  const src = stripComments(readFileSync(f, 'utf8'));
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  for (const re of IMPORT_RES) {
    for (const m of src.matchAll(re)) {
      edges++;
      const target = resolve(dirname(f), m[1]);
      ok(`${rel}: '${m[1]}' resolves to a file`, existsSync(target) && statSync(target).isFile(), target);
      if (/engine\/shadowbase-engine\.mjs$/.test(m[1]) && rel.startsWith('module/')) bundleImporters.push(rel);
    }
  }
  if (rel.startsWith('module/') && /\bfrom\s+['"]node:|\bimport\(\s*['"]node:|\brequire\(\s*['"]node:/.test(src)) nodeImporters.push(rel);
}
ok('the import graph has edges (denominator)', edges >= 25, `${edges}`);
ok('module/engine.mjs is the ONLY module that imports the engine bundle (§2)', bundleImporters.length > 0 && bundleImporters.every((r) => r === 'module/engine.mjs'), bundleImporters.join(', '));
ok('no module/ file imports a node: builtin (browser code)', nodeImporters.length === 0, nodeImporters.join(', '));

// ---- 3. forbidden Foundry APIs -----------------------------------------------------------------------------
const FORBIDDEN = [
  { name: 'foundry.appv1 (Application v1 namespace)', re: /\bfoundry\.appv1\b/ },
  { name: 'FormApplication (Application v1)', re: /\bFormApplication\b/ },
  { name: 'Dialog.confirm (v1 Dialog; use foundry.applications.api.DialogV2)', re: /\bDialog\.(confirm|prompt|wait)\b|\bnew\s+Dialog\(/ },
  { name: 'jQuery', re: /\bjQuery\b/ },
  { name: '$( (jQuery call)', re: /(?<![\w$.])\$\(/ },
  { name: 'CHAT_MESSAGE_TYPES (use CONST.CHAT_MESSAGE_STYLES)', re: /\bCHAT_MESSAGE_TYPES\b/ },
  { name: 'bare renderTemplate( (use foundry.applications.handlebars.renderTemplate)', re: /(?<!handlebars\.)\brenderTemplate\(/ },
  { name: 'bare loadTemplates( (use foundry.applications.handlebars.loadTemplates)', re: /(?<!handlebars\.)\bloadTemplates\(/ },
  { name: 'bare mergeObject( (use foundry.utils.mergeObject)', re: /(?<!utils\.)\bmergeObject\(/ },
];
function scan(src) {
  const code = stripComments(src);
  const hits = [];
  for (const { name, re } of FORBIDDEN) {
    const lines = code.split('\n');
    lines.forEach((line, i) => { if (re.test(line)) hits.push({ name, line: i + 1, text: line.trim().slice(0, 100) }); });
  }
  return hits;
}
for (const f of moduleFiles) {
  const hits = scan(readFileSync(f, 'utf8'));
  ok(`${relative(ROOT, f).replace(/\\/g, '/')}: no forbidden Foundry API`, hits.length === 0, hits.map((h) => `${h.name} @${h.line}: ${h.text}`).join('; '));
}
// The positive control. Missing file or zero hits = the sweep has no denominator = FAIL.
if (ok('positive control fixtures/husk/actor.js is present', existsSync(CONTROL), CONTROL)) {
  const hits = scan(readFileSync(CONTROL, 'utf8'));
  ok('the positive control scores at least one forbidden-API hit (the sweep has teeth)', hits.length >= 1, 'zero hits - the patterns match nothing');
  ok('the control\'s hit is the husk\'s CONST.CHAT_MESSAGE_TYPES chat card (the documented one)', hits.some((h) => /CHAT_MESSAGE_TYPES/.test(h.name)), hits.map((h) => h.name).join('; '));
  console.log(`positive control: ${hits.length} hit(s) in fixtures/husk/actor.js - ${hits.map((h) => `${h.name} @${h.line}`).join('; ')}`);
}
// The stripper itself: a comment naming a forbidden API must not count, code must.
ok('stripComments drops a comment that names an API and keeps the code that uses it',
  scan('// FormApplication is gone\n/* Dialog.confirm too */\nconst x = 1;').length === 0 && scan('const s = "url//not a comment"; foo.$("x"); jQuery(x);').length === 1 && scan('const re = /a\\/\\/b/; Dialog.confirm({});').length === 1);

report(`${files.length} modules, ${edges} import edges, ${moduleFiles.length} scanned for forbidden APIs, ${FORBIDDEN.length} patterns`);
