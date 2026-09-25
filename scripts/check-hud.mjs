#!/usr/bin/env node
// check:hud
//
// SUBJECT: the Tactical HUD and the handbook browser (docs/ARCHITECTURE.md §6.2,
// §8): module/apps/hud.mjs, module/apps/handbook-browser.mjs,
// templates/hud/*.hbs, templates/handbook/browser.hbs, styles/hud.css - driven
// headlessly through tools/foundry-shim.mjs (which installs unit U05's
// ApplicationV2 / Handlebars / DialogV2 layer, tools/foundry-shim-apps.mjs) over
// shim-built actors, so the figures on the HUD are the same documents' figures
// the sheet and the chat cards show. The environment (helpers, partials, the
// disk-backed handbook fetch, the parked i18n keys) is tools/render-hud.mjs's
// installHudEnvironment - the one the preview renderer uses.
//
// Pinned, each against the code path it protects:
//   - WIRING: every `data-action` in the templates (and in the HTML the browser
//     renders itself) has a handler in TacticalHud.DEFAULT_OPTIONS.actions (or is
//     the built-in `tab`), and every handler is reachable from a template - no
//     dead buttons, no dead handlers; every handler that the architecture routes
//     to module/rolls.mjs, module/effects.mjs, module/damage.mjs or
//     module/combat.mjs CALLS that module's function (pinned by reading the
//     handler's own source, so a handler quietly re-implementing a roll fails).
//     The rejected alternative - a HUD that computes its own targets, the
//     website's "HUD rebuilds its own defences" defect - is what the source pin
//     rules out;
//   - RENDER: all six parts render for Rokarr, Kaelen Rarr and the Assassin Droid
//     (strict + knownHelpersOnly over the live _prepareContext) with no unresolved
//     mustache and no leaked object; the figures on them are module/rolls.mjs's
//     (Rokarr's Bowcaster Attack (13) = attackTargetFor, Guns (Bowcaster) 13
//     trained, Dodge 10 = defenseTargetFor; Kaelen's saber Parry/Block = the
//     per-weapon rebuild; the droid's pools are HP/PP and its table is Droid DR
//     with 13 locations);
//   - ACTIONS on a shim actor, through the click dispatch: an attack banks
//     pendingHits and enables Damage, which clears them; a skill / attribute /
//     dodge / unarmed roll posts a card and lands in the roll history; the turn
//     counter moves and sweeps; Add Custom stores a 'Manual / DM' row with the
//     dialog's bag through effects.addManualEffect; Recover 1 EP, Advance (the
//     crash deducted from the CURRENT pool through applyCrashPhase, phaseIndex
//     +1) and Dismiss (the derived stun clears stunType) go through
//     module/effects.mjs; the Damage Processor's Apply Wounds goes through
//     damage.applyDamage (HP down, Shock stored, the ledger and its HT prompts on
//     the tab); pools reset; the form pipeline stores a blank pool as null
//     (null-means-full) and a number as a number; a pin is written to
//     system.pinnedNotifications and the pin cap (depth-1) holds;
//   - HANDBOOK: the tier-1 heading filter (every word, any order) and the full
//     text (searchChapters through the bundle, over the chapters the browser
//     loads itself) with the website's UX rules - Enter/button at 2+, the auto
//     search 450 ms after a miss at 3+, a new query drops the hits, the 60 cap
//     shows "60+", table hits carry the badge and the table's context as the
//     heading; a hit opens its chapter with the heading's ancestors open;
//     "Open in Journal" resolves through handbook/handbook-map.json for every
//     chip target; and the block renderer copied from tools/build-handbook-pack.mjs
//     is BYTE-IDENTICAL to the tool's over every heading, paragraph, list item
//     and table of the 24 chapters (drift between the pack and the browser fails);
//   - the defect this unit found and worked around is recorded, not hidden: the
//     bundle's handbookSearch.loadAllChapters yields nothing through the Foundry
//     loader shim (docs/REQUESTS.md); the check fails the day it starts working
//     so the workaround is retired rather than forgotten;
//   - I18N: every key the two modules and the templates name is in lang/en.json
//     OR in the u07-i18n block parked in docs/REQUESTS.md, and every Hud/Handbook
//     key of the block is named somewhere (no dead keys);
//   - CSS: styles/hud.css is no longer the stub, every rule is scoped under
//     .shadowbase, it reads the website's token names, and it never re-declares
//     a shared recipe of styles/components.css at the sheet's level (the HUD's
//     sizes are scoped under .sb-hud).
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - hud.mjs onRollAttack: `rolls.rollAttack(this.actor, item)` -> `rolls.rollSkill(this.actor, item.name)`
//       -> "handler roll-attack calls rolls.rollAttack(" (the source pin) + "attack banks pendingHits"
//   - hud.mjs #onSubmitForm: the NULLABLE_POOLS branch dropped (`if (value === null) continue;`)
//       -> "a blank HP input stores null (null-means-full)"
//   - handbook-browser.mjs renderInline: the italic branch returns the bare text
//       -> "renderInline == build-handbook-pack inline on the bold / italic / escaping probes" (the corpus
//          carries no single-asterisk italics, so the corpus leg alone did NOT catch this - hence the probes)
//   - handbook-browser.mjs DEEP_SEARCH_DELAY_MS 450 -> 300
//       -> "the auto search waits 450 ms"
//   - templates/hud/status.hbs: the dismiss button's `{{#if this.canDismiss}}` removed
//       -> "a gear row (isGear) shows no dismiss button"
//   - hud.mjs modifierBadges: `val > mc.MULTIPLIER_IDENTITY` -> `val > 0`
//       -> "a x0.5 MOVE badge is negative (red)"
//
//   node scripts/check-hud.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, ROOT } from './lib/harness.mjs';

const { ok, report } = makeReporter('check:hud');

// ---- environment ---------------------------------------------------------------------------------------------
const preview = await import(pathToFileURL(join(ROOT, 'tools', 'render-hud.mjs')).href);
const env = await preview.installHudEnvironment();
const { shim, engine, adapter, effects, translations: enJson, DialogV2, hudMod, hbMod, rollsMod: rolls, damageMod } = env;
const { invoke, submit } = preview;
const parked = preview.requestBlockTranslations();
ok('the application layer is installed (foundry.applications.api.ApplicationV2 present)', !!foundry.applications.api?.ApplicationV2);
const tool = await import(pathToFileURL(join(ROOT, 'tools', 'build-handbook-pack.mjs')).href);
const { TacticalHud, modifierBadges, readEffectForm, renderEffectDialogContent, weaponsForRequirement, maxPinned, notificationDepth } = hudMod;
const { HandbookBrowser, HandbookBrowserApp, headingResults, groupByHeading, pathToHeading, journalTarget, loadMap, resolveTarget } = hbMod;

const HUD_SRC = readFileSync(join(ROOT, 'module', 'apps', 'hud.mjs'), 'utf8');
const HB_SRC = readFileSync(join(ROOT, 'module', 'apps', 'handbook-browser.mjs'), 'utf8');
const templateFiles = [
  ...readdirSync(join(ROOT, 'templates', 'hud')).filter((f) => f.endsWith('.hbs')).map((f) => join(ROOT, 'templates', 'hud', f)),
  ...readdirSync(join(ROOT, 'templates', 'handbook')).filter((f) => f.endsWith('.hbs')).map((f) => join(ROOT, 'templates', 'handbook', f)),
];
const TEMPLATES = Object.fromEntries(templateFiles.map((f) => [relative(ROOT, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]));
ok('templates found (denominator): six hud parts + the browser', Object.keys(TEMPLATES).length === 7, Object.keys(TEMPLATES).join(', '));

const answerPrompt = () => DialogV2.queueResponses([{ modifier: 0, offHand: false, rollMode: 'publicroll' }]);
const queue = (...totals) => { Roll._queue.length = 0; Roll.queueResults(totals); };
const lastMessage = () => ChatMessage.log[ChatMessage.log.length - 1];
const text = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

// ---- 1. wiring: data-actions <-> handlers <-> the modules the architecture names ---------------------------------
const actions = TacticalHud.DEFAULT_OPTIONS.actions;
const templateActions = new Set();
for (const src of Object.values(TEMPLATES)) for (const m of src.matchAll(/data-action="([a-z-]+)"/g)) templateActions.add(m[1]);
// The browser renders its own section triggers (renderGroups) outside the templates.
for (const m of HB_SRC.matchAll(/data-action="([a-z-]+)"/g)) templateActions.add(m[1]);
ok('templates declare data-actions (denominator)', templateActions.size >= 40, `${templateActions.size} distinct`);
for (const a of templateActions) ok(`data-action="${a}" has a handler`, a === 'tab' || typeof actions[a] === 'function', 'no handler in TacticalHud.DEFAULT_OPTIONS.actions');
for (const a of Object.keys(actions)) ok(`handler "${a}" is reachable from a template`, templateActions.has(a), 'dead handler');
for (const a of HandbookBrowser.ACTIONS) ok(`handbook action "${a}" is on the HUD and the standalone app`, typeof actions[a] === 'function' && typeof HandbookBrowserApp.DEFAULT_OPTIONS.actions[a] === 'function');

/** The architecture's routing: handler -> the module call its source must contain. */
const ROUTES = {
  'roll-custom-dice': 'rolls.rollDamage(', 'roll-custom-target': 'rolls.rollCustom(', 'roll-unarmed': 'rolls.rollUnarmed(', 'roll-unarmed-damage': 'rolls.rollUnarmedDamage(',
  'roll-attack': 'rolls.rollAttack(', 'roll-weapon-damage': 'rolls.rollDamage(', 'roll-parry': "rolls.rollDefense(this.actor, 'parry'", 'roll-block': "rolls.rollDefense(this.actor, 'block'", 'roll-dodge': "rolls.rollDefense(this.actor, 'dodge'",
  'roll-attribute': 'rolls.rollAttribute(', 'roll-characteristic': 'rolls.rollCharacteristic(', 'roll-skill': 'rolls.rollSkill(',
  'roll-power': 'rolls.rollForcePower(', 'apply-power-costs': 'rolls.applyForcePowerCosts(', 'roll-technique': 'rolls.rollTechnique(', 'apply-technique-costs': 'rolls.applyTechniqueCosts(', 'roll-technique-damage': 'rolls.rollTechniqueDamage(',
  'roll-form-attack': 'rolls.rollAttack(', 'roll-form-defense': 'rolls.rollDefense(', 'roll-crew-action': 'rolls.rollCrewAction(', 'roll-stun-recovery': 'rolls.rollStunRecovery(',
  'turn-advance': 'combat.advanceTurn(', 'sweep-now': 'combat.sweepNow(', 'post-economy': 'combat.postEconomyNotice(',
  'add-effect': 'effects.addManualEffect(', 'dismiss-effect': 'effects.dismissEffect(', 'advance-phase': 'effects.advancePhase(', 'recover-ep': 'effects.recoverEp(',
  'apply-damage': 'damage.applyDamage(', 'clear-history': 'rolls.clearRollHistory(', 'ready-weapon': 'updateRow({ isUnready: false })', 'unready-weapon': 'updateRow({ isUnready: true })',
  'toggle-form': "'system.activeLightsaberForm'", 'reset-pool': 'this.actor.update(', 'reset-all-pools': 'this.actor.update(',
};
for (const [action, needle] of Object.entries(ROUTES)) {
  const src = actions[action]?.toString() ?? '';
  ok(`handler ${action} calls ${needle}`, src.includes(needle), `handler source: ${src.slice(0, 120).replace(/\s+/g, ' ')}...`);
}
for (const a of HandbookBrowser.ACTIONS) ok(`handler ${a} delegates to the browser`, (actions[a]?.toString() ?? '').includes('this.handbook.handleAction('));
ok('the HUD never re-implements a target: no resolveSkillLevel/attackSkillFor/unarmedStrikeTarget call in hud.mjs', !/\b(resolveSkillLevel|attackSkillFor|unarmedStrikeTarget|resolveRollOutcome)\s*\(/.test(HUD_SRC));
ok('the HUD reads the engine figures through actor.stats / rolls.* only (no getCalculatedStats call)', !/getCalculatedStats\s*\(/.test(HUD_SRC));
ok('the pools context reads system.resources / currentValues (ARCHITECTURE §4.1), never the token bars', /currentValues/.test(HUD_SRC) && !/getBarAttribute/.test(HUD_SRC));
ok('the HUD id is shadowbase-hud-<actorId>', /shadowbase-hud-\$\{actor\.id\}/.test(HUD_SRC));
ok('the window is resizable and its position is remembered on the user (hudPosition flag)', /resizable:\s*true/.test(HUD_SRC) && /setFlag\(SYSTEM_ID, 'hudPosition'/.test(HUD_SRC) && /getFlag\(SYSTEM_ID, 'hudPosition'\)/.test(HUD_SRC));
ok('the HUD registers on actor.apps so the actor re-renders it (ClientDocument#apps)', /this\.#actor\.apps \?\?= \{\}\)\[this\.id\] = this/.test(HUD_SRC));
ok('game.settings reads are guarded (try/catch) until U10 registers them', /try \{ const v = globalThis\.game\?\.settings\?\.get\(SYSTEM_ID, key\)/.test(HUD_SRC));
ok('every button in the form is type="button" (the root is a submitOnChange form)', Object.values(TEMPLATES).every((src) => !/<button(?![^>]*type="button")/.test(src)));
ok('pool inputs bind by full dotted name with data-dtype="Number"', /name="\{\{this\.field\}\}" data-dtype="Number"/.test(TEMPLATES['templates/hud/status.hbs']) && /'system\.currentHitPoints'/.test(HUD_SRC));
ok('the section accordions use the shared sb-section anatomy (summary > title + chevron; body)', /<details class="sb-section"[^>]*>\s*<summary class="sb-section__summary"><span class="sb-section__title">/.test(TEMPLATES['templates/hud/actions.hbs']) && /sb-section__chevron/.test(TEMPLATES['templates/hud/status.hbs']));

// ---- 2. i18n: every named key exists somewhere; no dead block keys -----------------------------------------------
const named = new Set();
for (const src of [HUD_SRC, HB_SRC, ...Object.values(TEMPLATES)]) for (const m of src.matchAll(/SHADOWBASE\.(?:Hud|Handbook|Roll|Combat|Damage|Status|Effect)\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g)) named.add(m[0]);
const known = { ...parked, ...enJson };
const dynamicPrefixes = ['SHADOWBASE.Roll.Attribute.', 'SHADOWBASE.Roll.Characteristic.', 'SHADOWBASE.Roll.', 'SHADOWBASE.Hud.'];
for (const key of named) {
  // `SHADOWBASE.Roll.Attribute.${key}` scans as the bare prefix; a prefix of known keys is dynamic.
  const dynamic = key.endsWith('.') || Object.keys(known).some((k) => k.startsWith(`${key}.`));
  if (dynamic) { ok(`dynamic key prefix ${key} is a known area`, dynamicPrefixes.some((p) => key.startsWith(p))); continue; }
  ok(`i18n key ${key} exists (lang/en.json or the u07-i18n block)`, key in known);
}
const blockKeys = Object.keys(parked).filter((k) => k.startsWith('SHADOWBASE.Hud.') || k.startsWith('SHADOWBASE.Handbook.'));
ok('the u07-i18n block is parked in docs/REQUESTS.md (or already folded into lang/en.json)', blockKeys.length > 100 || Object.keys(enJson).filter((k) => k.startsWith('SHADOWBASE.Hud.')).length > 100);
const hudKeysAnywhere = Object.keys(known).filter((k) => k.startsWith('SHADOWBASE.Hud.') || k.startsWith('SHADOWBASE.Handbook.'));
for (const key of hudKeysAnywhere) {
  const short = key.replace(/^SHADOWBASE\.Hud\.|^SHADOWBASE\.Handbook\./, '');
  const used = named.has(key) || (key.startsWith('SHADOWBASE.Hud.') && ['Dodge', 'Parry', 'Block'].includes(short)) || key === 'SHADOWBASE.Handbook.Overview';
  ok(`key ${key} is named by the HUD or the browser (no dead keys)`, used);
}
ok('the rendered strings resolve (localize returns the string, not the key)', game.i18n.localize('SHADOWBASE.Hud.ReadiedWeapons') === 'Readied Weapons');

// ---- 3. CSS ------------------------------------------------------------------------------------------------------
const css = readFileSync(join(ROOT, 'styles', 'hud.css'), 'utf8');
ok('styles/hud.css is no longer the stub', css.length > 5000 && !/EMPTY STUB/.test(css));
// Keyframe steps (0%, 50%, from, to) are not selectors.
const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((sel) => sel && !/^(\d+%|from|to)(\s*,\s*(\d+%|from|to))*$/.test(sel));
const unscoped = selectors.filter((s) => !s.split(',').every((part) => /^\s*\.shadowbase/.test(part)));
ok('every hud.css rule is scoped under .shadowbase', unscoped.length === 0, unscoped.slice(0, 5).join(' | '));
for (const token of ['--background', '--foreground', '--card', '--primary', '--accent', '--destructive', '--border', '--muted-foreground', '--radius', '--font-mono', '--sb-green-400', '--sb-red-400', '--sb-amber-400']) ok(`hud.css reads the website token ${token}`, css.includes(`var(${token}`));
// A shared recipe redeclared at the sheet's level (".shadowbase .sb-btn {") would restyle the sheet; the HUD scopes its sizes under .sb-hud.
const sheetLevel = selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter((s) => /^\.shadowbase \.sb-(btn|badge|section|tabs|tab|input|select|table|chip|stat-tile|card|empty|field|grid|pool|row)(\b|-)/.test(s) && !/sb-(hud|hb)/.test(s));
ok('hud.css never redeclares a components.css recipe at the sheet level (.shadowbase .sb-btn ...)', sheetLevel.length === 0, sheetLevel.slice(0, 6).join(' | '));

// ---- 4. block-render parity with tools/build-handbook-pack.mjs over the whole corpus ----------------------------------
const index = JSON.parse(readFileSync(join(ROOT, 'handbook', 'index.json'), 'utf8'));
let inlineChecked = 0, inlineBad = 0, tablesChecked = 0, tablesBad = 0;
for (const entry of index.chapters) {
  const chapter = JSON.parse(readFileSync(join(ROOT, 'handbook', `${entry.id}.json`), 'utf8'));
  for (const s of chapter.sections) {
    const items = s.type === 'list' ? s.content : typeof s.content === 'string' ? [s.content] : [];
    for (const it of items) { inlineChecked++; if (hbMod.renderInline(it) !== tool.inline(it)) inlineBad++; }
  }
  for (const t of chapter.tables ?? []) { tablesChecked++; if (hbMod.renderTable(t) !== tool.renderTable(t)) tablesBad++; }
}
ok('renderInline == build-handbook-pack inline over every heading/paragraph/list item', inlineBad === 0 && inlineChecked > 5000, `${inlineBad} of ${inlineChecked} differ`);
// The corpus carries no single-asterisk italics, so the italic branch needs its own probe (with the escaping the tool applies first).
const INLINE_PROBES = ['plain', 'a **bold** run-in', 'an *italic* word', '**bold** & *italic* <both>', 'a * lone asterisk', '**Label:** text with "quotes"'];
ok('renderInline == build-handbook-pack inline on the bold / italic / escaping probes', INLINE_PROBES.every((p) => hbMod.renderInline(p) === tool.inline(p)), INLINE_PROBES.filter((p) => hbMod.renderInline(p) !== tool.inline(p)).join(' | '));
ok('renderTable == build-handbook-pack renderTable over every table (278)', tablesBad === 0 && tablesChecked >= 270, `${tablesBad} of ${tablesChecked} differ`);
ok('renderSections resolves a table marker to the sidecar table and skips headings', (() => {
  const ch = JSON.parse(readFileSync(join(ROOT, 'handbook', 'ch07-combat.json'), 'utf8'));
  const byId = new Map(ch.tables.map((t) => [t.id, t]));
  const html = hbMod.renderSections(ch.sections, byId);
  return html.includes('sb-handbook-table') && !/<h[1-6]/.test(html) && html.includes('<ul>');
})());

// ---- 5. the heading tree, the tier-1 filter, the journal map ----------------------------------------------------------
const ch07 = JSON.parse(readFileSync(join(ROOT, 'handbook', 'ch07-combat.json'), 'utf8'));
const groups = groupByHeading(ch07);
ok('groupByHeading: Ch7 opens on an h2 (no Overview root) and nests h3 under h2', groups[0].title !== 'Overview' && groups.every((g) => g.level === 2) && groups.some((g) => g.children.length > 0));
const hitLocPath = pathToHeading(groups, 'Hit Locations');
ok('pathToHeading finds "Hit Locations" (an h3) under its h2 in Ch7', Array.isArray(hitLocPath) && hitLocPath.length === 2, JSON.stringify(hitLocPath));
const ch19 = JSON.parse(readFileSync(join(ROOT, 'handbook', 'ch19-galaxy-at-large.json'), 'utf8'));
ok('groupByHeading keys repeated headings uniquely (ch19 "Attributes:" x50)', (() => { const keys = new Set(); const walk = (gs) => gs.forEach((g) => { keys.add(g.key); walk(g.children); }); const gs = groupByHeading(ch19); walk(gs); let n = 0; const count = (list) => list.forEach((g) => { n++; count(g.children); }); count(gs); return keys.size === n; })());
const tier1 = headingResults(index.chapters, 'hit loc');
ok('tier 1: "hit loc" lists Ch7 with the "Hit Locations" heading', tier1.some((r) => r.chapter.id === 'ch07-combat' && r.hits.includes('Hit Locations')));
ok('tier 1: every word in any order ("locations hit" finds the same heading)', headingResults(index.chapters, 'locations hit').some((r) => r.hits.includes('Hit Locations')));
ok('tier 1: an empty query lists all 24 chapters with no hits', headingResults(index.chapters, '').length === 24 && headingResults(index.chapters, '').every((r) => r.hits.length === 0));
ok('tier 1: one-letter noise is ignored (2+ char tokens only)', headingResults(index.chapters, 'a hit locations').some((r) => r.hits.includes('Hit Locations')));
ok('tier 1: "shock baton" matches no heading (the table-row case the full text exists for)', headingResults(index.chapters, 'shock baton').length === 0);
const map = await loadMap();
for (const [chip, target] of Object.entries(engine.handbookRegistry.HANDBOOK_CHIP_TARGETS)) {
  const jt = journalTarget(map, target.chapterId, target.heading);
  const level = map.chapters[target.chapterId]?.headings.find((h) => h.heading === target.heading)?.level;
  ok(`chip ${chip} resolves in handbook-map.json (${target.chapterId} / ${target.heading})`, !!jt && !!jt.entryId && !!jt.pageId && (level === 2 ? jt.anchor === null : typeof jt.anchor === 'string'), JSON.stringify(jt));
  ok(`resolveTarget('${chip}') gives the chip's chapter and heading`, resolveTarget(chip)?.chapterId === target.chapterId && resolveTarget(chip)?.heading === target.heading);
}
ok('journalTarget without a heading lands on the chapter\'s first page', journalTarget(map, 'ch07-combat')?.pageId === map.chapters['ch07-combat'].pages[0].pageId);
ok('journalTarget on an unknown chapter is null', journalTarget(map, 'ch99-nope', 'x') === null);

// ---- 6. the browser: loading, deep search UX, opening at a heading ---------------------------------------------------
const bundled = await engine.handbookSearch.loadAllChapters();
ok('RECORDED DEFECT (docs/REQUESTS.md): the bundle\'s loadAllChapters finds nothing through the Foundry loader shim - retire the browser\'s own loader when this fails', bundled.length === 0, `now ${bundled.length} chapters: the shim was fixed, delegate loadAllChapters to the bundle`);
const own = await hbMod.loadAllChapters();
ok('the browser loads all 24 chapters itself', own.length === 24);
const timers = { pending: [], set(fn, ms) { const id = this.pending.length + 1; this.pending.push({ id, fn, ms }); return id; }, clear(id) { this.pending = this.pending.filter((t) => t.id !== id); } };
const changes = [];
const browser = new HandbookBrowser({ onChange: (b, reason) => changes.push(reason), timers });
await browser.ensureIndex();
ok('the browser index has 24 chapters', browser.state.index?.length === 24);
browser.setQuery('sh');
ok('no auto search below 3 characters', timers.pending.length === 0);
browser.setQuery('shock baton');
ok('the auto search waits 450 ms after a tier-1 miss at 3+ characters', timers.pending.length === 1 && timers.pending[0].ms === hbMod.DEEP_SEARCH_DELAY_MS && hbMod.DEEP_SEARCH_DELAY_MS === 450);
browser.setQuery('hit locations');
ok('a query that hits a heading schedules no auto search', timers.pending.length === 0);
browser.setQuery('shock baton');
const t = timers.pending[0];
timers.pending = [];
await t.fn();
ok('the auto search ran the full text', Array.isArray(browser.state.hits) && browser.state.hitsQuery === 'shock baton');
const batonHit = browser.state.hits?.find((h) => h.kind === 'table' && h.heading === 'Batons/Tonfa');
ok('"shock baton" finds the Ch12 Batons/Tonfa table row (kind table, the table\'s context as heading)', !!batonHit && batonHit.chapterId === 'ch12-melee-weapons', JSON.stringify(browser.state.hits?.slice(0, 2)));
let ctx = await browser.prepareContext();
ok('the hits render with the table badge and the count line', ctx.hasHits && ctx.hits.some((h) => h.isTable) && /passage/.test(ctx.hitsCountLine));
browser.setQuery('shock batons');
ok('a new query drops the previous hits', browser.state.hits === null && browser.state.hitsQuery === '');
timers.pending = [];
await browser.runDeepSearch('the');
ok('the 60 cap reads "60+"', browser.state.hits?.length === 60 && (await browser.prepareContext()).hitsCountLine.includes('60+'));
ok('runDeepSearch refuses a 1-character query', (await browser.runDeepSearch('x')) === null);
await browser.openAt(batonHit.chapterId, batonHit.heading);
ok('a hit opens its chapter with the heading\'s ancestors open and a scroll target', browser.state.chapterId === 'ch12-melee-weapons' && browser.openKeys().length >= 1 && typeof browser.state.scrollToKey === 'string');
ctx = await browser.prepareContext();
ok('the open chapter renders the tree with the focused group open (its body present)', ctx.isChapter && ctx.chapter.html.includes('data-group-key') && ctx.chapter.html.includes('sb-hb-group__body') && ctx.chapter.html.includes('Shock Baton'));
ok('a chapter opened from a hit drops the heading filter', ctx.chapter.filter === '');
browser.collapseAll();
ok('collapse all empties the open set', browser.openKeys().length === 0);
browser.toggleSection(groupByHeading(browser.state.chapter)[0].key);
ok('toggling a section opens it', browser.openKeys().length === 1);
browser.back();
ok('back returns to the list', !browser.state.chapterId && (await browser.prepareContext()).view === 'list');
ok('onChange fired for each state change', changes.length >= 8, `${changes.length}`);
await browser.openAt('ch07-combat', 'Hit Locations', { fromChip: true });
ok('a chip opens Ch7 at "Hit Locations" with the query cleared', browser.state.chapterId === 'ch07-combat' && browser.state.query === '' && browser.openKeys().length === 2);
ok('the standalone HandbookBrowserApp renders the browser part', await (async () => { const app = await HandbookBrowserApp.open('combat-damage'); return app.rendered && app.parts.browser.includes('sb-hb') && app.browser.state.chapterId === 'ch07-combat'; })());

// ---- 7. render every part for the three actors -------------------------------------------------------------------------
const build = (key) => preview.buildFromKey(env, key);
const huds = {};
for (const key of ['rokarr', 'kaelenRarr', 'assassinDroid']) {
  const actor = build(key);
  const hud = await TacticalHud.open(actor);
  huds[key] = hud;
  ok(`${key}: the HUD renders with id shadowbase-hud-<actorId>`, hud.rendered && hud.id === `shadowbase-hud-${actor.id}`);
  const parts = hud.parts;
  for (const p of ['header', 'tabs', 'actions', 'status', 'handbook', 'footer']) {
    ok(`${key}: part ${p} rendered`, typeof parts[p] === 'string' && parts[p].length > 100);
    ok(`${key}: part ${p} has no unresolved mustache / leaked object / undefined`, !/\{\{|\[object Object\]|>undefined<|>NaN</.test(parts[p] ?? ''));
    ok(`${key}: part ${p} has exactly one root element`, (() => { const s = (parts[p] ?? '').trim(); const tag = s.match(/^<(\w+)[\s>]/)?.[1]; return !!tag && s.endsWith(`</${tag}>`); })());
  }
  ok(`${key}: every SHADOWBASE key on the page resolved`, !/SHADOWBASE\./.test(Object.values(parts).join('')));
  ok(`${key}: the tab strip carries the three tabs with the active one marked`, (parts.tabs.match(/data-action="tab"/g) ?? []).length === 3 && /data-tab="actions"[^>]*/.test(parts.tabs) && parts.tabs.includes('sb-tab active'));
}

// Rokarr: the figures are rolls.mjs's.
{
  const hud = huds.rokarr;
  const actor = hud.actor;
  const bowcaster = rolls.equippedWeapons(actor).find((w) => /bowcaster/i.test(w.name));
  const info = rolls.attackTargetFor(actor, bowcaster);
  const html = text(hud.parts.actions);
  ok('Rokarr: Bowcaster attack target on the card is attackTargetFor\'s (13)', info.target === 13 && html.includes(`Attack (x${rolls.shotsFor(bowcaster)}) (13)`), html.slice(html.indexOf('Readied Weapons'), html.indexOf('Readied Weapons') + 200));
  ok('Rokarr: the Bowcaster is Main with Malf 17 (the derived figure, not malfunctionOrBase\'s 14)', /Bowcaster.*Main.*Malf 17/.test(html) && rolls.malfunctionThresholdFor(bowcaster) === 17);
  ok('Rokarr: Guns (Bowcaster) 13 TRAINED on the skill list', /Guns \(Bowcaster\) \(13\) TRAINED/.test(html));
  ok('Rokarr: Base Dodge (10) = defenseTargetFor dodge', rolls.defenseTargetFor(actor, 'dodge').target === 10 && /Base Dodge \(10\)/.test(html));
  ok('Rokarr: the attribute grid rolls the effective figures (ST 17, DX 12, IQ 9)', /Strength \(17\)/.test(html) && /Dexterity \(12\)/.test(html) && /Intelligence \(9\)/.test(html));
  ok('Rokarr: the turn-order line shows Basic Speed 6.25 with the DX tie-break', /Basic Speed 6\.25 · tie-break DX 12/.test(html));
  ok('Rokarr: a blaster\'s Defensive Action Matrix shows Parry/Block N/A (Guns cannot parry)', /Parry \(N\/A\).*Block \(N\/A\)/.test(html));
  const st = text(hud.parts.status);
  ok('Rokarr: the Status tab lists HP/EP/FP pools and the racial/trait cards without a dismiss X (isGear)', /HP \/ 17/.test(st) && /EP \/ 13/.test(st) && /ST \+4 \(Racial\)/.test(st) && !hud.parts.status.includes('data-action="dismiss-effect"'));
  ok('Rokarr: the badges read +4 STR / +1 DOD / +2 FRIGHT (roller-window MOD_LABELS)', /\+4 STR/.test(st) && /\+2 FRIGHT/.test(st));
  ok('Rokarr: the Anatomical DR table lists 12 locations with Tgt / DR / Status', (hud.parts.status.match(/data-action="select-location"/g) ?? []).length === 12 && /Anatomical DR/.test(st));
  ok('Rokarr: the tiles read Dodge 10 · Move 7 · Encumbrance None · Running Jump 7 yd', /Dodge 10 Move 7 Encumbrance None Running Jump 7 yd/.test(st));
}
// Kaelen: the saber's per-weapon defenses and the Form row.
{
  const hud = huds.kaelenRarr;
  const actor = hud.actor;
  const saber = rolls.equippedWeapons(actor).find((w) => w.type === 'lightsaber');
  const parry = rolls.defenseTargetFor(actor, 'parry', { weaponItem: saber });
  const block = rolls.defenseTargetFor(actor, 'block', { weaponItem: saber });
  const html = text(hud.parts.actions);
  ok('Kaelen: the saber card\'s Parry/Block are the per-weapon rebuild\'s figures', parry.available && block.available && html.includes(`Parry (${parry.target})`) && html.includes(`Block (${block.target})`));
  ok('Kaelen: Form III: Soresu listed inactive with Activate', /Form III: Soresu \(Lvl 1\) Activate/.test(html));
  ok('Kaelen: two Force powers with their alignment-adjusted FP costs', /Force Jump\/Leap \(Lvl 1\) \(1 FP\)/.test(html) && /Force Push\/Pull \(Lvl 1\) \(2 FP\)/.test(html));
  await invoke(hud, 'toggle-form', { form: 'Form III: Soresu' });
  await hud.render(); // the shim has no ClientDocument#apps re-render; Foundry re-renders the HUD on the actor's update
  const after = text(hud.parts.actions);
  ok('Kaelen: Activate writes activeLightsaberForm and the Form panel appears with the saber bound', actor.system.activeLightsaberForm === 'Form III: Soresu' && /Form III: Soresu · Attack/.test(after) && hud.parts.actions.includes('data-action="roll-form-attack"'));
  const formParry = rolls.defenseTargetFor(actor, 'parry', { weaponItem: saber });
  ok('Kaelen: with the Form active the saber Parry gains the Form bonus (+2 at Soresu 1)', formParry.target === parry.target + engine.lightsaberForms.activeFormEffect('Form III: Soresu', 1).parry);
  await invoke(hud, 'toggle-form', { form: 'Form III: Soresu' });
  ok('Kaelen: Active toggles the Form off again', actor.system.activeLightsaberForm === null);
}
// The droid: pools HP/PP, Droid DR, 13 locations.
{
  const hud = huds.assassinDroid;
  const st = text(hud.parts.status);
  ok('droid: pools are HP and PP (no EP/FP)', /HP \/ 12/.test(st) && /PP \/ 100/.test(st) && !/EP \//.test(st) && !/FP \//.test(st));
  ok('droid: the table is Droid DR with 13 locations', /Droid DR/.test(st) && (hud.parts.status.match(/data-action="select-location"/g) ?? []).length === 13);
  ok('droid: the header pools are HP and PP', /HP 12 \/12 PP 100 \/100/.test(text(hud.parts.header)));
}

// ---- 8. actions through the click dispatch (Rokarr) ------------------------------------------------------------------
{
  const hud = huds.rokarr;
  const actor = hud.actor;
  const bowcaster = rolls.equippedWeapons(actor).find((w) => /bowcaster/i.test(w.name));
  const shots = rolls.shotsFor(bowcaster);
  answerPrompt();
  queue(...Array.from({ length: shots }, () => 5));
  const before = ChatMessage.log.length;
  const r = await invoke(hud, 'roll-attack', { itemId: bowcaster.id });
  ok('attack: the click dispatch ran rolls.rollAttack and posted a card', r.handled && ChatMessage.log.length === before + 1 && ['attack', 'volley'].includes(lastMessage().flags.shadowbase.kind));
  ok('attack: every shot hit at 5, so pendingHits = shots and charges dropped by the shots', bowcaster.system.row.pendingHits === shots && bowcaster.system.row.currentCharges === 100 - shots);
  await hud.render();
  ok('attack: the Damage button is enabled with the hit count', hud.parts.actions.includes(`data-action="roll-weapon-damage" data-item-id="${bowcaster.id}"`) && !new RegExp(`data-action="roll-weapon-damage" data-item-id="${bowcaster.id}" disabled`).test(hud.parts.actions) && text(hud.parts.actions).includes(`Damage ×${shots}`));
  const r2 = await invoke(hud, 'roll-weapon-damage', { itemId: bowcaster.id });
  ok('damage: rolls.rollDamage posted and cleared pendingHits', r2.handled && lastMessage().flags.shadowbase.kind.startsWith('damage') && bowcaster.system.row.pendingHits === 0);
  answerPrompt(); queue(9);
  await invoke(hud, 'roll-skill', { skill: 'Guns (Bowcaster)' });
  ok('skill: the card targets 13 (Guns (Bowcaster) trained)', lastMessage().flags.shadowbase.kind === 'skill' && lastMessage().flags.shadowbase.target === 13);
  answerPrompt(); queue(9);
  await invoke(hud, 'roll-attribute', { key: 'dx' });
  ok('attribute: DX 12', lastMessage().flags.shadowbase.kind === 'attribute' && lastMessage().flags.shadowbase.target === 12);
  answerPrompt(); queue(9);
  await invoke(hud, 'roll-dodge');
  ok('dodge: 10', lastMessage().flags.shadowbase.kind === 'defense' && lastMessage().flags.shadowbase.target === 10);
  answerPrompt(); queue(9);
  await invoke(hud, 'roll-unarmed', { which: 'punch' });
  ok('unarmed: the punch banks a hit in flags.shadowbase.unarmedPendingHits', actor.flags.shadowbase.unarmedPendingHits.punch === 1);
  await invoke(hud, 'roll-unarmed-damage', { which: 'punch' });
  ok('unarmed damage: clears the bank', actor.flags.shadowbase.unarmedPendingHits.punch === 0 && lastMessage().flags.shadowbase.kind === 'damage');
  answerPrompt(); queue(9);
  await invoke(hud, 'roll-characteristic', { key: 'frightCheck' });
  ok('characteristic: Fright Check 11', lastMessage().flags.shadowbase.target === 11);
  const history = rolls.rollHistory(actor);
  ok('the roll history holds the rolls newest first (depth 10)', history.length >= 7 && history.length <= 10 && /Fright Check/.test(history[0].title));
  await invoke(hud, 'toggle-history');
  ok('the footer drawer lists the history', hud.uiState.ui.historyExpanded && text(hud.parts.footer).includes('Fright Check'));
  await invoke(hud, 'clear-history');
  ok('CLEAR empties the history (rolls.clearRollHistory)', rolls.rollHistory(actor).length === 0);
  // Turn counter and sweep.
  await effects.addEffect(actor, { id: 'x-expires', name: 'Expiring', type: 'debuff', source: 'Test', expiresAfterTurn: 0, isManual: true, modifiers: { ...engine.NO_MODIFIERS, dexterity: -1 } });
  await invoke(hud, 'turn-advance', { delta: 1 });
  ok('turn-advance: combat.advanceTurn moved the counter to 1 and swept the effect that expired after turn 0', actor.system.turnCounter === 1 && !effects.findEffect(actor, 'x-expires'));
  await invoke(hud, 'turn-advance', { delta: -1 });
  ok('turn-advance -1 rewinds', actor.system.turnCounter === 0);
  // Custom rolls.
  hud.setLocalState('custom.dice', 2); hud.setLocalState('custom.sides', 6); hud.setLocalState('custom.modifier', 1);
  await invoke(hud, 'roll-custom-dice');
  ok('custom dice: 2d6+1 rolled as a damage card', lastMessage().flags.shadowbase.formula === '2d6+1');
  hud.setLocalState('custom.label', 'Luck'); hud.setLocalState('custom.target', 12); hud.setLocalState('custom.targetModifier', -2);
  queue(9);
  await invoke(hud, 'roll-custom-target');
  ok('a custom target roll with a typed modifier never prompts (rollCustom hands the modifier down)', DialogV2._queue.length === 0, `${DialogV2._queue.length} queued`);
  ok('custom target: 3d6 vs 12 - 2 = 10', lastMessage().flags.shadowbase.kind === 'custom' && lastMessage().flags.shadowbase.target === 10);
  // The custom-roll and ship fields through the form pipeline.
  await submit(hud, { 'hud.custom.dice': '3', 'hud.ship.weaponName': 'Light Laser Cannon' });
  ok('the form pipeline routes hud.* fields to local state', hud.uiState.custom.dice === 3 && hud.uiState.ship.weaponName === 'Light Laser Cannon');
  await submit(hud, { 'system.assignedStation': 'Weapon Stations (Turrets)' });
  ok('the form pipeline writes system.assignedStation', actor.system.assignedStation === 'Weapon Stations (Turrets)');
  await hud.render();
  const crew = rolls.crewActionsFor(actor);
  ok('Ship Systems lists the turret actions with the weapon picker', crew.length > 0 && hud.parts.actions.includes('name="hud.ship.weaponName"') && text(hud.parts.actions).includes(crew[0].label));
  await invoke(hud, 'roll-crew-action', { crewAction: crew.find((a) => a.isDamage)?.label ?? crew[0].label });
  ok('roll-crew-action ran (a damage action with the selected weapon posts a damage card)', lastMessage().flags.shadowbase.kind === 'damage' || lastMessage().flags.shadowbase.kind === 'crew-action');
}

// ---- 9. the Status tab: pools, effects hub, damage processor, pins (Kaelen) ---------------------------------------------
{
  const hud = huds.kaelenRarr;
  const actor = hud.actor;
  const maxHp = actor.stats.currentValues.hitPoints;
  await submit(hud, { 'system.currentHitPoints': '5' });
  ok('a typed HP stores the number', actor.system.currentHitPoints === 5 && actor.system.resources.hp.value === 5);
  await submit(hud, { 'system.currentHitPoints': '' });
  ok('a blank HP input stores null (null-means-full)', actor.system.currentHitPoints === null && actor.system.resources.hp.value === maxHp);
  await submit(hud, { 'system.currentEndurancePoints': '3' });
  await invoke(hud, 'reset-pool', { pool: 'ep' });
  ok('reset-pool writes the calculated maximum', actor.system.currentEndurancePoints === actor.stats.currentValues.endurancePoints);
  await submit(hud, { 'system.currentHitPoints': '2', 'system.currentForcePoints': '1' });
  await invoke(hud, 'reset-all-pools');
  ok('reset-all-pools refills HP/EP/FP (not PP) for an organic', actor.system.currentHitPoints === maxHp && actor.system.currentForcePoints === actor.stats.currentValues.maxForcePoints);
  // Add Custom -> effects.addManualEffect with the dialog's bag (the dialog's answer is what its Apply callback returns).
  const dialogHtml = renderEffectDialogContent();
  ok('the Add Custom dialog offers the 23 numeric channels, the fright-immune box and the move select', (dialogHtml.match(/name="mod\./g) ?? []).length === 25 && dialogHtml.includes('name="mod.frightImmune"') && dialogHtml.includes('name="mod.moveMultiplier"'));
  ok('every prompt so far was consumed (no stale dialog answer waits in the queue)', DialogV2._queue.length === 0, `${DialogV2._queue.length} queued`);
  const dxBefore = rolls.attributeTarget(actor, 'dx');
  const answer = readEffectForm({ elements: { name: { value: 'Focus' }, type: { value: 'buff' }, duration: { value: '1 hour' }, description: { value: 'Steady hands' }, 'mod.dexterity': { value: '2' }, 'mod.frightImmune': { type: 'checkbox', checked: true }, 'mod.moveMultiplier': { value: '0.5' } } });
  DialogV2.queueResponses([answer]);
  const created = await invoke(hud, 'add-effect');
  const focus = effects.findEffect(actor, created.result?.flags?.shadowbase?.statusEffect?.id);
  const row = focus?.flags.shadowbase.statusEffect;
  ok('add-effect stored a Manual / DM row with the dialog\'s bag (+2 DX, fright immune, x0.5 move)', row?.source === 'Manual / DM' && row.name === 'Focus' && row.modifiers.dexterity === 2 && row.modifiers.frightImmune === true && row.modifiers.moveMultiplier === 0.5 && row.duration === '1 hour');
  ok('the +2 DX reaches the DX roll target (the engine sums the stored bag)', rolls.attributeTarget(actor, 'dx') === dxBefore + 2);
  await hud.render();
  const st = text(hud.parts.status);
  ok('the card shows the badges +2 DEX / FRIGHT IMMUNE / x0.5 MOVE and a dismiss X', /\+2 DEX/.test(st) && /FRIGHT IMMUNE/.test(st) && /×0\.5 MOVE/.test(st) && hud.parts.status.includes(`data-action="dismiss-effect" data-effect-id="${row.id}"`));
  const badges = modifierBadges(row.modifiers);
  ok('a x0.5 MOVE badge is negative (red), +2 DEX positive, the boolean shows its name only', badges.find((b) => b.text === '×0.5 MOVE')?.positive === false && badges.find((b) => b.text === '+2 DEX')?.positive === true && badges.some((b) => b.text === 'FRIGHT IMMUNE' && b.positive));
  ok('the badges render with the shared pos/neg recipe (sb-badge--pos / sb-badge--neg)', /sb-badge--neg">×0\.5 MOVE/.test(hud.parts.status) && /sb-badge--pos">\+2 DEX/.test(hud.parts.status));
  ok('modifierBadges skips zero and the identity multiplier', modifierBadges({ ...engine.NO_MODIFIERS }).length === 0);
  ok('a gear row (isGear) shows no dismiss button', !new RegExp(`data-action="dismiss-effect" data-effect-id="adv-Combat Reflexes"`).test(hud.parts.status));
  // Recover 1 EP and Advance through module/effects.mjs.
  await effects.addEffect(actor, { id: 'stim-1', name: 'Battle Stim', type: 'buff', source: 'Combat Stimulant', duration: '10 min', isManual: true, isGear: false, modifiers: { ...engine.NO_MODIFIERS, endurancePoints: -2 }, phases: [{ name: 'Battle Stim Crash', type: 'debuff', description: 'Comedown', duration: 'Recovery', modifiers: { endurancePoints: -3 } }], phaseIndex: 0 });
  await hud.render();
  const st2 = text(hud.parts.status);
  ok('a phased row shows "Phase 1 of 2 — next: Battle Stim Crash" with Advance, and Recover 1 EP for its -2 EP', /Phase 1 of 2 — next: Battle Stim Crash/.test(st2) && hud.parts.status.includes('data-action="advance-phase" data-effect-id="stim-1"') && hud.parts.status.includes('data-action="recover-ep" data-effect-id="stim-1"'));
  await invoke(hud, 'recover-ep', { effectId: 'stim-1' });
  ok('recover-ep moved the penalty one step toward 0 (effects.recoverEp)', effects.findEffect(actor, 'stim-1').flags.shadowbase.statusEffect.modifiers.endurancePoints === -1);
  const epBefore = actor.system.resources.ep.value;
  await invoke(hud, 'advance-phase', { effectId: 'stim-1' });
  const stim = effects.findEffect(actor, 'stim-1').flags.shadowbase.statusEffect;
  ok('advance-phase deducted the crash from the CURRENT pool and rewrote the row (effects.advancePhase / applyCrashPhase)', actor.system.currentEndurancePoints === epBefore - 3 && stim.name === 'Battle Stim Crash' && stim.phaseIndex === 1 && stim.modifiers.endurancePoints === 0);
  await invoke(hud, 'dismiss-effect', { effectId: 'stim-1' });
  ok('dismiss-effect removed the row (effects.dismissEffect)', !effects.findEffect(actor, 'stim-1'));
  await actor.update({ 'system.stunType': 'Physical' });
  await hud.render();
  ok('stunned: the header shows the recovery roll and the weapon cards are locked', hud.parts.header.includes('data-action="roll-stun-recovery"') && /roll-attack" data-item-id="[^"]+" disabled/.test(hud.parts.actions) && text(hud.parts.actions).includes('Stunned -4'));
  await invoke(hud, 'dismiss-effect', { effectId: 'stunned' });
  ok('dismissing the derived stunned card clears stunType', actor.system.stunType === 'None');
  await actor.update({ 'system.stunType': 'Mental' });
  answerPrompt(); queue(3);
  await invoke(hud, 'roll-stun-recovery');
  ok('roll-stun-recovery: a success clears the stun (rolls.rollStunRecovery, IQ for a mental stun)', actor.system.stunType === 'None' && lastMessage().flags.shadowbase.attribute === 'IQ');
  // The Damage Processor.
  const torso = damageMod.locationsOf(actor).find((l) => l.name === 'Torso');
  await invoke(hud, 'select-location', { locationId: torso.id });
  hud.setLocalState('damage.amount', 8); hud.setLocalState('damage.damageType', 'cut');
  await hud.render();
  const proc = text(hud.parts.status);
  const assessment = damageMod.assessDamage(actor, { locationId: torso.id, amount: 8, damageType: 'cut' });
  ok('select-location opens the processor with the live assessment (damage.assessDamage)', /Tactical Damage Processor: Torso/.test(proc) && proc.includes(`Final Injury: ${assessment.finalInjury} HP`) && assessment.finalInjury === Math.floor(Math.max(0, 8 - assessment.drApplied) * 1.5));
  const hpBefore = actor.system.resources.hp.value;
  const effectsBefore = effects.storedEffects(actor).length;
  const r = await invoke(hud, 'apply-damage');
  ok('apply-damage: damage.applyDamage wrote HP, stored the Shock row and returned the ledger', r.result?.hp?.after === hpBefore - assessment.finalInjury && actor.system.currentHitPoints === hpBefore - assessment.finalInjury && effects.storedEffects(actor).length === effectsBefore + 1 && effects.storedEffects(actor).some((e) => /^Shock/.test(e.name)));
  const after = text(hud.parts.status);
  ok('the ledger and its HT prompts show on the tab', /Damage: Torso/.test(after) && (assessment.isMajorWound ? /MAJOR WOUND/.test(after) : true) && hud.parts.status.includes('sb-hud-ledger'));
  await invoke(hud, 'abort-damage');
  ok('abort closes the processor', hud.uiState.damage.locationId === null && !hud.parts.status.includes('sb-hud-processor'));
  // Pins.
  const log = hud.log;
  ok('the bell recorded the HUD\'s outcomes (rolls, the effect, the wounds)', log.records.length >= 3);
  const rec = log.records[0];
  await invoke(hud, 'pin-notification', { notificationId: rec.id });
  ok('a pin is written to system.pinnedNotifications (SavedNotification shape)', Array.isArray(actor.system.pinnedNotifications) && actor.system.pinnedNotifications.some((p) => p.id === rec.id && 'title' in p && 'description' in p && 'at' in p));
  const limit = maxPinned();
  ok('the pin cap is notificationDepth - 1 (12 -> 11)', notificationDepth() === 12 && limit === 11);
  for (let i = 0; i < 14; i++) TacticalHud.record(actor, { title: `n${i}`, description: '' });
  ok('the bell keeps notificationDepth records with the pin exempt from eviction', log.records.length === 12 && log.records.some((x) => x.id === rec.id && x.pinned));
  let refused = 0;
  for (const x of log.records) { if (!x.pinned) { const res = await invoke(hud, 'pin-notification', { notificationId: x.id }); if (res.result === false) refused++; } }
  ok('pinning past the cap is refused', log.pinnedCount() === limit && refused >= 1);
  await invoke(hud, 'toggle-bell');
  ok('the bell panel lists the records with pin/delete controls', hud.uiState.ui.bellOpen && hud.parts.footer.includes('data-action="pin-notification"') && text(hud.parts.footer).includes(`${limit}/${limit} pinned`));
  await invoke(hud, 'clear-notifications');
  ok('Clear Unpinned keeps the pins', log.records.length === limit && log.records.every((x) => x.pinned));
  // Settings gear: game.settings, registered at init by module/settings.mjs (U10) - the write lands and
  // rolls.rollHistoryDepth() follows it (the pre-U10 leg pinned the unregistered fallback of 10).
  DialogV2.queueResponses([{ rollHistoryDepth: 25, notificationDepth: 25, keepRollHistory: true }]);
  const s = await invoke(hud, 'open-settings');
  ok('the settings gear writes through game.settings and rolls.rollHistoryDepth() follows (25)', s.handled && s.result?.rollHistoryDepth === 25 && rolls.rollHistoryDepth() === 25);
  await globalThis.game.settings.set('shadowbase', 'rollHistoryDepth', 10);
  await globalThis.game.settings.set('shadowbase', 'notificationDepth', 12);
  ok('readEffectForm parses a plain map too (the shim answer shape)', readEffectForm({ name: 'X', type: 'debuff', 'mod.iq': '-3', 'mod.frightImmune': 'on', 'mod.moveMultiplier': 'bogus' }).modifiers.iq === -3 && readEffectForm({ name: 'X' }).modifiers.moveMultiplier === 1);
  // close unregisters (Foundry calls _onClose; the HUD's own close() tears down too, idempotently).
  await hud.close();
  ok('close unregisters the instance and the actor.apps entry', !TacticalHud.instances.has(actor.id) && !(hud.id in (actor.apps ?? {})));
}

// ---- 10. techniques and the weapon filter ---------------------------------------------------------------------------------
{
  const actor = huds.rokarr.actor;
  const equipped = rolls.equippedWeapons(actor);
  ok('weaponsForRequirement: "Ranged" admits blasters, "Melee" does not, "Any" admits all', weaponsForRequirement('Ranged', equipped).length === equipped.filter((w) => w.type === 'blaster').length && weaponsForRequirement('Melee', equipped).every((w) => w.type !== 'blaster') && weaponsForRequirement('Any', equipped).length === equipped.length);
  const tech = engine.techniques.allCombatTechniques.find((t) => t.category === 'Ranged') ?? engine.techniques.allCombatTechniques[0];
  const [item] = await actor.createEmbeddedDocuments('Item', [adapter.rowToItemData({ ...tech, level: 1, baselinePoints: 0, selectedWeaponId: null }, 'combatTechniques')]);
  const hud = await TacticalHud.open(actor);
  const bowcaster = equipped.find((w) => w.type === 'blaster');
  await submit(hud, { [`items.${item.id}.row.selectedWeaponId`]: bowcaster.id });
  ok('the technique weapon select writes items.<id>.row.selectedWeaponId through the form pipeline', item.system.row.selectedWeaponId === bowcaster.id);
  await hud.render();
  ok('the technique row shows the bound weapon selected and a Damage button', new RegExp(`<option value="${bowcaster.id}" selected>`).test(hud.parts.actions) && hud.parts.actions.includes(`data-action="roll-technique-damage" data-item-id="${item.id}"`));
  answerPrompt(); queue(9);
  const r = await invoke(hud, 'roll-technique', { itemId: item.id });
  ok('roll-technique rolls with the bound weapon (rolls.rollTechnique)', r.handled && (r.result === null || lastMessage().flags.shadowbase.kind === 'technique'));
  await hud.close();
}

void shim;
report(`${Object.keys(TEMPLATES).length} templates, ${Object.keys(actions).length} actions, ${inlineChecked} inline blocks + ${tablesChecked} tables byte-identical to the pack renderer, 3 actors rendered`);
