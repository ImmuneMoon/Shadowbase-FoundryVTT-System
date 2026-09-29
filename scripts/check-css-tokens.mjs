#!/usr/bin/env node
// scripts/check-css-tokens.mjs
//
// check:css-tokens (ARCHITECTURE.md §6.6, §9; unit U05). Subject: the design
// tokens of styles/variables.css against the website's, and every var() the
// stylesheets use.
//
//   1. every `:root` token of the website's src/app/globals.css exists in
//      styles/variables.css under `.shadowbase, .application.shadowbase` with the
//      SAME name and the SAME value (the website file is read, not remembered);
//   2. every `var(--x)` used anywhere under styles/ (comments stripped) is DEFINED in
//      some styles/*.css (or is a Foundry core token the sheet deliberately reads, listed below);
//   3. the alignment spectrum's six stops match globals.css `.alignment-spectrum`;
//   4. every stylesheet system.json lists exists and NAMESPACES every rule: each selector
//      part is under `.shadowbase` / `.application.shadowbase`, or is an `sb-` prefixed class
//      (the system's own BEM namespace - the chat cards, the HUD and the handbook tables
//      render outside a .shadowbase ancestor and are namespaced by prefix instead).
//
// Rejected alternative pinned: a token list typed into this check (it would drift
// with the website like the husk's did). Mutations fired: `--accent: 285 17% 60%`
// in variables.css -> leg 1 fails; `var(--sb-nope)` in sheet.css -> leg 2 fails.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeReporter, ROOT, WEB } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:css-tokens');

const globalsPath = join(WEB, 'src', 'app', 'globals.css');
ok('the website globals.css is readable', existsSync(globalsPath), globalsPath);
const globals = existsSync(globalsPath) ? readFileSync(globalsPath, 'utf8') : '';
const variablesPath = join(ROOT, 'styles', 'variables.css');
ok('styles/variables.css exists', existsSync(variablesPath));
const variables = existsSync(variablesPath) ? readFileSync(variablesPath, 'utf8') : '';

/** The declarations of the first block whose selector matches. */
function block(css, selectorRe) {
  const re = new RegExp(`${selectorRe.source}\\s*\\{([^}]*)\\}`, 'm');
  const m = re.exec(css);
  return m ? m[1] : '';
}
function tokens(declBlock) {
  const out = {};
  for (const m of declBlock.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  return out;
}

// ---- 1. every website token, same name, same value ----------------------------------------------------------------------
const siteTokens = tokens(block(globals, /:root/));
ok('globals.css :root declares tokens (denominator)', Object.keys(siteTokens).length >= 25, `${Object.keys(siteTokens).length}`);
const ourTokens = tokens(block(variables, /\.shadowbase,\s*\n?\s*\.application\.shadowbase/));
ok('variables.css declares tokens under .shadowbase, .application.shadowbase (denominator)', Object.keys(ourTokens).length >= 40, `${Object.keys(ourTokens).length}`);
for (const [name, value] of Object.entries(siteTokens)) {
  ok(`token ${name} exists with the website's value (${value})`, ourTokens[name] === value, `ours: ${ourTokens[name] ?? 'missing'}`);
}
ok('the website token set is not trivially small (the rejected alternative: a typed list)', Object.keys(siteTokens).includes('--accent') && Object.keys(siteTokens).includes('--radius'));

// ---- 3. the spectrum -------------------------------------------------------------------------------------------------------
const siteSpectrum = [...globals.matchAll(/hsl\([^)]*\)\s+[0-9.]+%/g)].map((m) => m[0].replace(/\s+/g, ' '));
ok('globals.css .alignment-spectrum has six stops', siteSpectrum.length === 6, siteSpectrum.join(' | '));
const componentsCss = readFileSync(join(ROOT, 'styles', 'components.css'), 'utf8');
const stopVars = { '--sb-spectrum-dark-deep': '0%', '--sb-spectrum-dark': '12.5%', '--sb-spectrum-neutral': ['37.5%', '62.5%'], '--sb-spectrum-light': '87.5%', '--sb-spectrum-light-deep': '100%' };
const siteStopColours = siteSpectrum.map((s) => s.split(' ').slice(0, -1).join(' '));
const ourStopColours = ['--sb-spectrum-dark-deep', '--sb-spectrum-dark', '--sb-spectrum-neutral', '--sb-spectrum-neutral', '--sb-spectrum-light', '--sb-spectrum-light-deep'].map((v) => ourTokens[v]);
ok('the six spectrum colours match globals.css in order', JSON.stringify(siteStopColours) === JSON.stringify(ourStopColours), `site ${siteStopColours.join(' | ')} / ours ${ourStopColours.join(' | ')}`);
for (const [v, pct] of Object.entries(stopVars)) for (const p of [].concat(pct)) ok(`components.css places ${v} at ${p}`, new RegExp(`var\\(${v}\\)\\s+${p.replace('.', '\\.')}`).test(componentsCss));

// ---- 2. every var() is defined -----------------------------------------------------------------------------------------
const styleFiles = readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css')).sort();
// Comments stripped: a `var(--x)` in a header comment is prose, not a token use.
const allCss = Object.fromEntries(styleFiles.map((f) => [f, readFileSync(join(ROOT, 'styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]));
const defined = new Set();
for (const css of Object.values(allCss)) for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
// Foundry core tokens a stylesheet may read on purpose (ThemeV2 / the AppV2 frame).
const CORE_TOKENS = new Set(['--color-text-primary', '--color-text-secondary', '--color-cool-4', '--color-cool-5', '--font-primary', '--font-h1', '--color-shadow-primary']);
let used = 0;
for (const [f, css] of Object.entries(allCss)) {
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
    used++;
    const v = m[1];
    if (defined.has(v) || CORE_TOKENS.has(v)) continue;
    ok(`${f}: var(${v}) is defined in styles/`, false, 'undefined token');
  }
}
ok('stylesheets use var() (denominator)', used >= 200, `${used}`);

// ---- 4. scoping --------------------------------------------------------------------------------------------------------------
const sys = JSON.parse(readFileSync(join(ROOT, 'system.json'), 'utf8'));
for (const p of sys.styles ?? []) ok(`${p} exists`, existsSync(join(ROOT, p)));
for (const [f, css] of Object.entries(allCss)) {
  const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map((m) => m[2].trim()).filter((s) => s && !s.startsWith('@'));
  const namespaced = (part) => /(^|\s|\.)shadowbase\b/.test(part) || /(^|\s|>)\.sb-[a-z]/.test(part) || /^#tooltip\.shadowbase/.test(part) || /^(from|to|\d+%)$/.test(part);
  const unscoped = selectors.filter((s) => !s.split(',').every((part) => namespaced(part.trim())));
  ok(`${f}: every rule is namespaced (.shadowbase ancestor or an sb-* class)`, unscoped.length === 0, unscoped.slice(0, 4).join(' | '));
}

// ---- 5. content-class dependency (the 2026-09-19 live-Foundry layout bug) ---------------------------------------------------
// styles/sheet.css scopes the whole actor sheet under `.sb-sheet` (`.sb-sheet .tab`
// carries the tab padding the sticky section-header bleed needs). ApplicationV2
// renders the PARTS straight into `.window-content` with no wrapper of ours, so
// that class must ride the content element via `window.contentClasses` - if it is
// dropped, every `.sb-sheet ...` rule misses live and the sections overflow their
// panel (the headless preview composes sheet.hbs, which has its own .sb-sheet
// wrapper, so it CANNOT see this - only this source pin can).
const actorSheetSrc = readFileSync(join(ROOT, 'module', 'apps', 'actor-sheet.mjs'), 'utf8');
const sheetCss = readFileSync(join(ROOT, 'styles', 'sheet.css'), 'utf8');
ok('styles/sheet.css scopes the sheet under `.sb-sheet` (the dependency is real)', /\.sb-sheet\s+\.tab\b/.test(sheetCss));
const ccBlock = /contentClasses:\s*\[([^\]]*)\]/.exec(actorSheetSrc)?.[1] ?? '';
ok('ShadowBaseActorSheet applies `sb-sheet` via window.contentClasses (rejected: [] -> `.sb-sheet .tab` never matches, sections overflow)', /['"]sb-sheet['"]/.test(ccBlock), `contentClasses: [${ccBlock.trim()}]`);

report(`${Object.keys(siteTokens).length} website tokens, ${defined.size} defined, ${used} var() uses, ${styleFiles.length} stylesheets`);
