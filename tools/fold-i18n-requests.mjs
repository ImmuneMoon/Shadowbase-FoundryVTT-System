#!/usr/bin/env node
// tools/fold-i18n-requests.mjs
//
// Fold every pending ```json uNN-i18n block of docs/REQUESTS.md into
// lang/en.json and replace the block with a one-line note. The en.json owner
// of the wave runs it (npm run fold:i18n); a unit that cannot edit en.json
// appends its keys as such a block and check:i18n / check:templates accept
// the keys from the block until the fold. Existing en.json keys WIN over a
// block's value (a conflict is printed, never silently overwritten).
//
//   node tools/fold-i18n-requests.mjs            # fold and rewrite both files
//   node tools/fold-i18n-requests.mjs --dry-run  # report only

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const enPath = join(ROOT, 'lang', 'en.json');
const reqPath = join(ROOT, 'docs', 'REQUESTS.md');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function mergeKeys(target, source, path = '', stats = { added: 0, kept: 0, conflicts: [] }) {
  for (const [k, v] of Object.entries(source)) {
    const p = path ? `${path}.${k}` : k;
    if (isObj(v)) {
      if (!isObj(target[k])) { if (k in target) stats.conflicts.push(p); target[k] = {}; }
      mergeKeys(target[k], v, p, stats);
    } else if (!(k in target)) { target[k] = v; stats.added++; }
    else { stats.kept++; if (target[k] !== v) stats.conflicts.push(`${p} (en.json keeps its value)`); }
  }
  return stats;
}

export function foldRequests({ dryRun = DRY, date = new Date().toISOString().slice(0, 10) } = {}) {
  const en = JSON.parse(readFileSync(enPath, 'utf8'));
  // docs/REQUESTS.md is a local working file (gitignored since 2026-09-28): a checkout without it has nothing to fold.
  if (!existsSync(reqPath)) return { folded: [], added: 0, kept: 0, conflicts: [] };
  let requests = readFileSync(reqPath, 'utf8');
  const stats = { added: 0, kept: 0, conflicts: [] };
  const folded = [];
  requests = requests.replace(/```json (u\d+)-i18n\s*\n([\s\S]*?)```\n?/g, (whole, unit, body) => {
    try { mergeKeys(en, JSON.parse(body), '', stats); folded.push(unit); return `<!-- ${unit}-i18n block folded into lang/en.json by the en.json owner (${date}); the keys live there now. -->\n`; }
    catch (e) { console.error(`fold-i18n: block ${unit}-i18n does not parse: ${e.message}`); return whole; }
  });
  if (!dryRun && folded.length) {
    writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');
    writeFileSync(reqPath, requests, 'utf8');
  }
  return { folded, ...stats };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const r = foldRequests();
  console.log(`fold-i18n${DRY ? ' (dry run)' : ''}: blocks ${r.folded.join(', ') || 'none'}; added ${r.added}, kept ${r.kept}`);
  if (r.conflicts.length) console.log('conflicts:\n  ' + r.conflicts.join('\n  '));
}
