// tools/website-path.mjs - the ONE place the website checkout this system mirrors is resolved.
//
// The website (ImmuneMoon/ShadowBase-Website) is the reference implementation every rule, catalog and
// handbook page comes from. Every build tool and check imports WEB from here. Where the checkout lives is
// a fact about one machine, not about this repository, so it is never written here. In order:
//   1. the SHADOWBASE_WEBSITE environment variable;
//   2. `website-path.local.json` beside package.json - { "website": "<path>" } - git-ignored (*.local.json),
//      so each machine keeps its own;
//   3. `../ShadowBase Website`, a checkout beside this repository.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL_CONFIG = join(ROOT, 'website-path.local.json');
export const SIBLING_WEBSITE = join(ROOT, '..', 'ShadowBase Website');

function fromLocalConfig() {
  if (!existsSync(LOCAL_CONFIG)) return null;
  let parsed;
  try { parsed = JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8')); }
  catch (err) { throw new Error(`website-path: ${LOCAL_CONFIG} is not valid JSON (${err.message}) - expected { "website": "<path>" }`); }
  if (typeof parsed?.website !== 'string' || !parsed.website.trim()) throw new Error(`website-path: ${LOCAL_CONFIG} has no "website" path - expected { "website": "<path>" }`);
  return parsed.website;
}

export const WEB = resolve(process.env.SHADOWBASE_WEBSITE ?? fromLocalConfig() ?? SIBLING_WEBSITE);
