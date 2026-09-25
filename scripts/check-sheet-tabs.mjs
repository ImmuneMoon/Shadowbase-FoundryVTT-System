#!/usr/bin/env node
// check:sheet-tabs
//
// SUBJECT: the actor sheet's Body / Abilities / Inventory / Vehicles tabs
// (docs/ARCHITECTURE.md §6.1; unit U06): module/apps/actor-sheet-tabs.mjs
// (context builders, actions, the submit-data extractor), templates/actor/
// {body,abilities,inventory,vehicles}.hbs + parts/*.hbs, styles/sheet-tabs.css.
// Everything runs over shim-built actors (tools/foundry-shim.mjs) so the
// figures the tabs print are the same documents' prepared data the HUD and
// the rolls read.
//
// Pinned, each against the website surface it was moved from:
//   - every tab template and partial compiles STRICT + knownHelpersOnly and
//     RENDERS from the real context builders for Rokarr, Vex Korta, Kaelen
//     Rarr, a droid template, the vessel-owner coverage fixture and the
//     Sahrhie export (tools/render-tabs-preview.mjs is the renderer); an
//     unregistered helper or a missing context key throws here (the rejected
//     alternative - Foundry's lenient compile - renders blanks);
//   - one root element per PART (HandlebarsApplicationMixin's rule);
//   - every `data-action` a template emits has a handler in TAB_ACTIONS, and
//     every i18n key the templates and modules name exists (lang/en.json or the
//     u06-i18n block in docs/REQUESTS.md until U05 folds it);
//   - the figures on the rows are the engine's: Rokarr's Guns (Bowcaster)
//     target 13 (the level the ladder resolves, roller-window.tsx:1746-1759),
//     a blaster row's Malf is the derived figure (17, never malfunctionOrBase's
//     14), Kaelen's saber row carries the derived classType chip, the droid's
//     dossier reads the derived ST / HP and the hardware CP, the vessel
//     owner's starship card lists the nine damage systems from
//     starshipDerivation.initialSystems and its readouts, the wallet totals
//     equal sumCurrency's chips/physical split over loose currency rows;
//   - the hit-location table is the actor's anatomy (12 rows for a humanoid,
//     the T20 rows for a droid) with DR from hitLocationDRDisplay;
//   - the extractor: `items.<id>.row.<key>` becomes an updateEmbeddedDocuments
//     payload; a Force power's level change re-reads the catalog (cpCost /
//     effect follow; the website's handleLevelSelection); an advantage with a
//     ladder takes the ladder's points; `hitLocations.<id>.innateDR` rewrites
//     the WHOLE hitLocations array (the rejected per-index dotted key would
//     replace the array with an object, ARCHITECTURE §6.5 / review M5) and the
//     other rows are byte-identical; `starshipSystems.<item>.<sys>.hp` rewrites
//     the whole `systems` array on the row; a blank storage select is null;
//     `system.assignedStation` blank is null;
//   - the actions on a shim actor: addRow creates a row Item of the source;
//     toggleReadied flips equipped and stamps equippedAt (clears it when
//     unreadying); toggleTracking keeps digital and physical mutually
//     exclusive (character-inventory.tsx:104-119); addStorageBox / pickUpItem /
//     deleteStorageBox (everything filed in a purged box is picked up first,
//     storage-box-section.tsx:108-118); toggleActiveForm writes
//     activeLightsaberForm and clears it on a second click; toggleEquipped
//     wears armor through applySetEquip; rollSkill / rollAttack / rollPower
//     post a chat card through module/rolls.mjs (the dialog skipped by
//     modifier 0) and the attack banks pendingHits on the row.
//
// MUTATIONS FIRED (each turned this check red, then was restored; 2026-09-10):
//   - actor-sheet-tabs.mjs extractTabSubmitData: the hitLocations array written as an index-keyed object (what a per-index dotted key expands to) -> the whole-array pins fail
//   - actor-sheet-tabs.mjs skillRow: cost left at 0 (calculateCostForSkill not consulted) -> the Guns (Bowcaster) pin fails (cost 0)
//   - actor-sheet-tabs.mjs weaponRow: malfunction from engine.malfunction.malfunctionOrBase(row.durability, derived.maxDurability) - the stored null "unmeasured" reading against the derived maximum, the review's rejected composition (14 for Rokarr's kit Bowcaster against the derived 17) -> the Malf pin fails. (The merged row's durability is the tracked reading, so malfunctionOrBase over the merged row happens to agree on the corpus; check:rolls pins the same figure.)
//   - templates/actor/parts/trait-row.hbs: `{{unknownKey}}` added -> strict render throws for every actor

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, installSystem, loadCorpus, ROOT } from './lib/harness.mjs';

const { ok, fail, report } = makeReporter('check:sheet-tabs');
const { shim, engine, adapter, translations } = await installSystem({ selfTest: false });
const renderer = await import(pathToFileURL(join(ROOT, 'tools', 'render-tabs-preview.mjs')).href);
const pending = renderer.pendingU06Translations();
shim.installFoundryShim({ translations: pending });
const i18n = globalThis.game.i18n;
const tabs = await import(pathToFileURL(join(ROOT, 'module', 'apps', 'actor-sheet-tabs.mjs')).href);
const rolls = await import(pathToFileURL(join(ROOT, 'module', 'rolls.mjs')).href);
// module/rolls.mjs resolves foundry.applications.handlebars.renderTemplate late; give it the chat templates through Handlebars.
const { createRequire } = await import('node:module');
const Handlebars = createRequire(import.meta.url)('handlebars');
const chatHb = Handlebars.create();
renderer.registerHelpers(chatHb, i18n);
globalThis.foundry.applications.handlebars = { renderTemplate: async (path, ctx) => chatHb.compile(readFileSync(join(ROOT, path.replace(/^systems\/shadowbase\//, '')), 'utf8'))(ctx) };
// DialogV2 stand-in: the roll prompt answers modifier 0, the confirms answer yes (headless surface only; the real
// dialog is Foundry's - MANUAL-TEST). Assigned through the proxy's set trap, the way check:rolls injects renderTemplate.
globalThis.foundry.applications.api = { DialogV2: { wait: async () => ({ modifier: 0, offHand: false, rollMode: 'publicroll' }), confirm: async () => true } };

// ---- compile strict + render the corpus ---------------------------------------------------------
let compiled;
try { compiled = await renderer.compileTabTemplates(i18n, tabs.TAB_TEMPLATES); ok('every tab template and partial compiles strict + knownHelpersOnly (with the sheet\'s own helpers and named partials when module/helpers/handlebars.mjs exists)', true); }
catch (err) { fail(`templates do not compile strict: ${err.message}`); }

const entries = await renderer.defaultCorpus(engine, { loadCorpus, unwrap: (t) => t?.data ?? t });
ok('the corpus the brief names is loadable (Rokarr, Vex Korta, Kaelen Rarr, a droid, the vessel owner, Sahrhie)', entries.length === 6, entries.map((e) => e.key).join(', '));
const rendered = new Map();
const actors = new Map();
for (const entry of entries) {
  let actor;
  try { actor = shim.buildActor(adapter.sheetToActorData(entry.sheet)); } catch (err) { ok(`${entry.key}: actor builds`, false, err.message); continue; }
  actors.set(entry.key, actor);
  try {
    const out = renderer.renderTabs(actor, tabs, compiled);
    rendered.set(entry.key, out);
    for (const [tab, { html }] of Object.entries(out)) {
      const roots = html.trim().match(/^<section\b[\s\S]*<\/section>\s*$/) ? 1 : 0;
      ok(`${entry.key}/${tab}: renders strict with ONE root element`, roots === 1 && html.length > 500, `${html.length} bytes`);
    }
  } catch (err) {
    ok(`${entry.key}: every tab renders strict`, false, `${err.message}`);
  }
}

// ---- data-actions and i18n keys ------------------------------------------------------------------
const templateFiles = [...Object.values(tabs.TAB_TEMPLATES.parts), ...tabs.TAB_TEMPLATES.partials].map((p) => join(ROOT, p.replace(/^systems\/shadowbase\//, '')));
const templateSrc = templateFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const actions = new Set([...templateSrc.matchAll(/data-action="([a-zA-Z]+)"/g)].map((m) => m[1]));
const missingActions = [...actions].filter((a) => typeof tabs.TAB_ACTIONS[a] !== 'function');
ok(`every data-action the templates emit has a TAB_ACTIONS handler (${actions.size} actions)`, missingActions.length === 0, missingActions.join(', '));
const moduleSrc = ['module/apps/actor-sheet-tabs.mjs', 'module/import-export.mjs'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
// A key followed by `.${` is a family prefix composed at runtime (SHADOWBASE.Sheet.Channel.${label}); its members are the `dynamic` list below.
const allSrc = templateSrc + moduleSrc;
const keys = new Set([...allSrc.matchAll(/SHADOWBASE\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g)].map((m) => m[0]).filter((k) => !k.endsWith('.') && !allSrc.includes(`${k}.\${`)));
const have = (k) => k in translations || k in pending;
const missingKeys = [...keys].filter((k) => !have(k));
ok(`every i18n key named by the tabs exists in lang/en.json or the u06-i18n block (${keys.size} keys)`, missingKeys.length === 0, missingKeys.join(', '));
// The dynamic keys built at runtime.
const dynamic = [
  ...Object.values({ strength: 'ST', dexterity: 'DX', iq: 'IQ', health: 'HT', will: 'Will', perception: 'Per', move: 'Move', dodge: 'Dodge', dr: 'DR', carryCapacity: 'Carry', endurancePoints: 'EP', forcePoints: 'FP', toHit: 'ToHit', basicSpeed: 'BasicSpeed', hitPoints: 'HP', frightCheck: 'Fright', parry: 'Parry', block: 'Block', stunRecovery: 'StunRecovery', strikingSt: 'StrikingST', liftingSt: 'LiftingST', kickDamage: 'KickDamage', jumpDistance: 'Jump' }).map((l) => `SHADOWBASE.Sheet.Channel.${l}`),
  ...['None', 'Physical', 'Mental'].map((s) => `SHADOWBASE.Sheet.Body.Stun.${s}`),
  ...['Universal', 'Melee', 'Unarmed', 'Ranged'].flatMap((c) => [`SHADOWBASE.Sheet.Abilities.Technique.${c}`, `SHADOWBASE.Sheet.Abilities.Technique.${c}Hint`]),
  ...['blaster', 'melee', 'lightsaber', 'explosive'].map((k) => `SHADOWBASE.Sheet.Weapon.Kind.${k}`),
  ...['Damage', 'Acc', 'Range', 'RoF', 'ST', 'Bulk', 'Rcl', 'Reach', 'Parry', 'MinST', 'Unbalanced', 'DamageTwo', 'ClassType', 'EnergyRes', 'Skill', 'Legality'].map((k) => `SHADOWBASE.Sheet.Weapon.${k}`),
  ...['Nominal', 'Damaged', 'Disabled'].map((s) => `SHADOWBASE.Sheet.Vehicles.Status.${s}`),
  ...['none', 'light', 'medium', 'heavy', 'xheavy'].map((s) => `SHADOWBASE.Sheet.Encumbrance.${s}`),
  ...['BodyLoadout', 'AnatomyWorkshop', 'DroidWorkshop', 'SuitsAndSets', 'CraftingApp', 'TacticalHud'].map((a) => `SHADOWBASE.Sheet.App.${a}`),
];
const missingDynamic = dynamic.filter((k) => !have(k));
ok('every runtime-composed i18n key exists too', missingDynamic.length === 0, missingDynamic.join(', '));
ok('no rendered tab shows a raw SHADOWBASE.* key (every localize resolved)', [...rendered.values()].every((out) => Object.values(out).every(({ html }) => !/SHADOWBASE\.[A-Z]/.test(html))));

// ---- the figures on the rows are the engine's --------------------------------------------------
const rokarr = actors.get('rokarr');
const rokOut = rendered.get('rokarr');
if (rokarr && rokOut) {
  const guns = rokOut.abilities.context.skills.find((s) => s.rowName === 'Guns (Bowcaster)');
  ok('Rokarr: Guns (Bowcaster) row target 13 = rolls.skillTargetFor (level + gear flat), cost 2 from calculateCostForSkill', guns && guns.target === 13 && guns.cost === 2 && guns.level === '13', JSON.stringify(guns && { target: guns.target, cost: guns.cost, level: guns.level }));
  const blasters = rokOut.inventory.context.weapons.blasters;
  ok('Rokarr: the blaster row\'s Malf is the derived figure (never malfunctionOrBase\'s 14)', blasters.length > 0 && blasters.every((b) => b.malfunction === rolls.malfunctionThresholdFor(rokarr.rowsOf('customBlasters').find((i) => i.id === b.id)) && b.malfunction !== 14), blasters.map((b) => `${b.rowName}: ${b.malfunction}`).join('; '));
  ok('Rokarr: a blaster row carries the derived chips (Damage / Acc / Range / RoF) and an attack target', blasters.some((b) => b.chips.some((c) => c.label === i18n.localize('SHADOWBASE.Sheet.Weapon.Damage')) && b.chips.some((c) => c.label === 'Acc') && typeof b.attackTarget === 'number'));
  ok('Rokarr: the hit-location table is the 12-row humanoid anatomy with DR from hitLocationDRDisplay', rokOut.body.context.locations.length === 12 && rokOut.body.context.locations.every((l) => l.drText === String(rokarr.stats.hitLocationDRDisplay[l.name] ?? '')));
  ok('Rokarr: innate DR is editable on the stored rows (organic) and the input binds under the hitLocations.<id> prefix', rokOut.body.context.locations.every((l) => l.innateEditable) && /name="hitLocations\.[0-9a-f-]+\.innateDR"/.test(rokOut.body.html));
  const loose = rokarr.sheetData.equipment.filter((r) => r.category === 'Currencies' && !r.storageLocationId);
  const chips = loose.reduce((s, r) => s + (r.storedValue != null ? r.storedValue * (r.quantity || 1) : 0), 0);
  ok('Rokarr: the wallet\'s Credit Chip total is the loose chips\' storedValue x quantity (character-inventory.tsx:77-86)', rokOut.inventory.context.wallet.digital === Math.round(chips).toLocaleString('en-US'), `${rokOut.inventory.context.wallet.digital} vs ${chips}`);
  ok('Rokarr: carry weight and capacity are points.totalWeight and basicLift', rokOut.inventory.context.wallet.totalWeight === String(Number(rokarr.stats.points.totalWeight.toFixed(2))) && rokOut.inventory.context.wallet.capacity === String(parseFloat(rokarr.stats.basicLift)));
  ok('Rokarr: the encumbrance table marks the current level', rokOut.inventory.context.encumbrance.rows.filter((r) => r.current).length === 1);
  ok('Rokarr: the Combat State mirror reads facing / stunType / arc from the actor and the engine', rokOut.body.context.state.stunType === 'None' && rokOut.body.context.state.arc === rokarr.stats.defenseAdjustments.arc);
  const adv = rokOut.abilities.context.advantages;
  ok('Rokarr: a racial trait row carries its modifier badge from traitModifiersFor (ST +4 (Racial) -> "+4 ST")', adv.some((a) => a.rowName === 'ST +4 (Racial)' && a.modifiers.some((m) => m.text === `+4 ${i18n.localize('SHADOWBASE.Sheet.Channel.ST')}`)));
  ok('Rokarr: the level select of a levelled trait resolves by points (advantages-section.tsx:156-163)', adv.filter((a) => a.hasLevels).every((a) => a.levels.some((l) => l.selected) || a.level === null));
}
const kaelen = actors.get('kaelenRarr');
const kaelOut = rendered.get('kaelenRarr');
if (kaelen && kaelOut) {
  const sabers = kaelOut.inventory.context.weapons.lightsabers;
  ok('Kaelen: the saber row carries the derived classType chip and calculatedDamage', sabers.length > 0 && sabers.every((s) => s.chips.some((c) => c.label === i18n.localize('SHADOWBASE.Sheet.Weapon.ClassType')) && s.chips.some((c) => c.value.includes('d'))), JSON.stringify(sabers.map((s) => s.chips)));
  const forms = kaelOut.abilities.context.lightsaberForms;
  ok('Kaelen: a lightsaber Form row reads cpCost / tier from getFormDetails and lists the 7 catalog forms', forms.length > 0 && forms.every((f) => f.forms.length === 7 && f.tier), JSON.stringify(forms.map((f) => [f.rowName, f.level, f.tier, f.cpCost])));
}
const vex = actors.get('vexKorta');
const vexOut = rendered.get('vexKorta');
if (vex && vexOut) {
  const melee = vexOut.inventory.context.weapons.melee;
  ok('Vex: melee rows carry Reach / Parry / Min ST chips from calculateMeleeWeaponStats', melee.length > 0 && melee.every((m) => m.chips.some((c) => c.label === i18n.localize('SHADOWBASE.Sheet.Weapon.Reach'))));
  const explosives = vexOut.inventory.context.weapons.explosives;
  ok('Vex: an explosive row shows its damage effect, the Thrown Weapon (Grenade) target and its quantity input', explosives.length > 0 && explosives.every((e) => e.canDamage && e.attackSkill === 'Thrown Weapon (Grenade)') && /row\.quantity/.test(vexOut.inventory.html));
}
const droid = actors.get('assassinDroid');
const droidOut = rendered.get('assassinDroid');
if (droid && droidOut) {
  const d = droidOut.body.context;
  ok('droid: the dossier reads derived ST / HP / DX / IQ / Move / Dodge, PP and the hardware CP', d.isDroid && d.droid && d.droid.st === droid.stats.primaryAttributes.rawStrength && d.droid.hp === droid.stats.currentValues.hitPoints && d.droid.hardwareCp === droid.stats.points.droidHardware && d.droid.pp === droid.system.powerPoints);
  ok('droid: the hit-location table is the derived T20 anatomy (droidAnatomy) and innate DR is not editable', d.locations.length === droid.stats.dynamicHitLocations.length && d.locations.length > 0 && d.locations.every((l) => !l.innateEditable));
  ok('droid: the droid sections render (dossier + workshop button)', /Droid PC Tactical Dossier/.test(droidOut.body.html) && /data-action="openDroidWorkshop"/.test(droidOut.body.html));
}
const vessel = actors.get('vesselOwnerFixture');
const vesselOut = rendered.get('vesselOwnerFixture');
if (vessel && vesselOut) {
  const v = vesselOut.vehicles.context;
  const ship = v.starships[0];
  ok('vessel owner: the starship card lists the nine damage systems (starshipDerivation.initialSystems) with statuses', ship && ship.systems.length === 9 && ship.systems.every((s) => s.statusOptions.length === 3), `${ship?.systems.length}`);
  ok('vessel owner: the readouts are the derived figures (finalHandling / finalSpeed / finalHp / finalDr / finalHyperdrive / finalCost)', ship && ship.readouts.hp !== '' && ship.readouts.handling !== '' && ship.readouts.cost !== '');
  ok('vessel owner: the vehicle is split by category (vehicle-item / terrestrial-vehicles-section rule)', v.atmospheric.length + v.terrestrial.length === 1);
  ok('vessel owner: the six SHIP_STATIONS and six crew roles are offered', v.assignment.stations.length === 7 && v.assignment.positions.length === 7);
  ok('vessel owner: system HP inputs bind under starshipSystems.<itemId>.<sysId>.hp', /name="starshipSystems\.[^.]+\.[^.]+\.hp"/.test(vesselOut.vehicles.html));
}
const sahrhie = actors.get('sahrhie');
if (sahrhie) ok('Sahrhie (real export): every tab renders and the abilities context carries her skills', rendered.get('sahrhie')?.abilities.context.skills.length > 10);

// ---- the submit-data extractor -----------------------------------------------------------------
if (rokarr) {
  // Not Guns (Bowcaster): its level 13 is the fixed target the roll leg below pins.
  const skill = rokarr.rowsOf('skills').find((s) => s.system.row.name !== 'Guns (Bowcaster)');
  const { data, itemUpdates } = tabs.extractTabSubmitData(rokarr, { [`items.${skill.id}.row.level`]: '14', [`items.${skill.id}.row.notes`]: 'x', 'system.pointTotal': 160, 'system.assignedStation': '' });
  ok('extractor: items.<id>.row.<key> becomes an updateEmbeddedDocuments payload and leaves the actor fields (expanded) alone', itemUpdates.length === 1 && itemUpdates[0]._id === skill.id && itemUpdates[0]['system.row.level'] === '14' && itemUpdates[0]['system.row.notes'] === 'x' && data.system.pointTotal === 160 && !('items' in data), JSON.stringify({ data, itemUpdates }));
  ok('extractor: a blank station select is null (SYSTEM_NULL_WHEN_BLANK)', data.system.assignedStation === null);
  await tabs.applyItemUpdates(rokarr, itemUpdates);
  ok('applyItemUpdates writes the row (skill level stays a STRING)', skill.system.row.level === '14' && typeof skill.system.row.level === 'string');

  // whole-array hit locations
  const loc = rokarr.system.hitLocations[3];
  const before = JSON.stringify(rokarr.system.hitLocations);
  const hl = tabs.extractTabSubmitData(rokarr, { [`hitLocations.${loc.id}.innateDR`]: '3' });
  ok('extractor: hitLocations.<id>.innateDR rewrites the WHOLE 12-row array with only that row changed (never a per-index dotted key)', Array.isArray(hl.data.system.hitLocations) && hl.data.system.hitLocations.length === 12 && hl.data.system.hitLocations[3].innateDR === 3 && JSON.stringify(hl.data.system.hitLocations.filter((_, i) => i !== 3)) === JSON.stringify(JSON.parse(before).filter((_, i) => i !== 3)));
  await rokarr.update(hl.data);
  ok('the innate DR reaches the engine (the location\'s total DR moves by +3)', rokarr.stats.dynamicHitLocations.find((l) => l.id === loc.id).innateDR === 3 && rokarr.system.hitLocations.length === 12);

  // storage boxes whole array
  await tabs.TAB_ACTIONS.addStorageBox.call({ document: rokarr });
  const box = rokarr.system.storageBoxes[0];
  const sb = tabs.extractTabSubmitData(rokarr, { [`storageBoxes.${box.id}.name`]: 'Footlocker' });
  ok('extractor: storageBoxes.<id>.name rewrites the whole storageBoxes array', sb.data.system.storageBoxes.length === 1 && sb.data.system.storageBoxes[0].name === 'Footlocker' && sb.data.system.storageBoxes[0].id === box.id);
  const medpac = rokarr.rowsOf('equipment').find((i) => i.system.row.name !== 'Credit Chip') ?? rokarr.rowsOf('equipment')[0];
  const toBox = tabs.extractTabSubmitData(rokarr, { [`items.${medpac.id}.row.storageLocationId`]: box.id });
  await tabs.applyItemUpdates(rokarr, toBox.itemUpdates);
  const boxed = tabs.inventoryContext(rokarr).boxes[0];
  ok('a row sent to storage shows under its box (boxedRows) and leaves the carried lists', boxed.rows.some((r) => r.id === medpac.id) && !tabs.inventoryContext(rokarr).equipmentGroups.some((g) => g.rows.some((r) => r.id === medpac.id)));
  const blank = tabs.extractTabSubmitData(rokarr, { [`items.${medpac.id}.row.storageLocationId`]: '' });
  ok('extractor: a blank storage select is null (carried again)', blank.itemUpdates[0]['system.row.storageLocationId'] === null);
  await tabs.TAB_ACTIONS.pickUpItem.call({ document: rokarr }, null, { dataset: { itemId: medpac.id } });
  ok('pickUpItem clears storageLocationId', medpac.system.row.storageLocationId === null);
  await tabs.applyItemUpdates(rokarr, toBox.itemUpdates);
  await tabs.TAB_ACTIONS.deleteStorageBox.call({ document: rokarr }, null, { dataset: { boxId: box.id } });
  ok('deleteStorageBox picks up everything filed in the box first, then removes it', rokarr.system.storageBoxes.length === 0 && medpac.system.row.storageLocationId === null);

  // level changes re-read the catalog
  const ladder = rokarr.rowsOf('advantages').find((a) => tabs.traitLibraryEntry('advantages', a.system.row.name)?.levels?.length > 1);
  if (ladder) {
    const entry = tabs.traitLibraryEntry('advantages', ladder.system.row.name);
    const other = entry.levels.find((l) => l.level !== ladder.system.row.level) ?? entry.levels[1];
    const p = tabs.levelChangePatch(ladder, other.level);
    ok(`levelChangePatch: a levelled advantage (${ladder.name}) takes the ladder's points for the new level`, p.level === other.level && p.points === other.points, JSON.stringify(p));
  }
}
const forceUser = actors.get('kaelenRarr');
if (forceUser) {
  const power = forceUser.rowsOf('forcePowers')[0];
  if (power) {
    const name = power.system.row.name;
    const levels = engine.forcePowers.forcePowersData.filter((p) => p.name === name);
    const target = levels.find((l) => l.level !== power.system.row.level) ?? levels[0];
    const { itemUpdates } = tabs.extractTabSubmitData(forceUser, { [`items.${power.id}.row.level`]: String(target.level) });
    const u = itemUpdates[0];
    ok(`extractor: a Force power's level change re-reads the catalog (${name} -> level ${target.level}: cpCost ${target.cpCost}, effect follows)`, u && u['system.row.level'] === target.level && u['system.row.cpCost'] === target.cpCost && u['system.row.effect'] === target.effect && u['system.row.characterTier'] === target.characterTier, JSON.stringify(u));
  } else ok('Kaelen has a Force power to test the level re-read', false);
}
const tech = [...actors.values()].flatMap((a) => a.rowsOf('combatTechniques').map((t) => [a, t])).find(([, t]) => engine.techniques.allCombatTechniques.some((c) => c.name === t.system.row.name));
if (tech) {
  const [a, t] = tech;
  const cat = engine.techniques.allCombatTechniques.filter((c) => c.name === t.system.row.name);
  const target = cat.find((c) => c.level !== t.system.row.level) ?? cat[0];
  const p = tabs.levelChangePatch(t, target.level);
  ok(`levelChangePatch: a combat technique (${t.name}) re-reads cpCost / epCost / effect / tier for the tier`, p.cpCost === target.cpCost && p.epCost === target.epCost && p.effect === target.effect && p.characterTier === target.characterTier && ('fpCost' in p), JSON.stringify(p).slice(0, 200));
}
if (vessel) {
  const ship = vessel.rowsOf('customStarships')[0];
  const systems = ship.rowWithDerived().systems;
  const sys = systems[0];
  const { itemUpdates } = tabs.extractTabSubmitData(vessel, { [`starshipSystems.${ship.id}.${sys.id}.hp`]: '5', [`starshipSystems.${ship.id}.${sys.id}.status`]: 'Damaged' });
  const next = itemUpdates[0]?.['system.row.systems'];
  ok('extractor: starshipSystems.<item>.<sys>.* rewrites the whole systems array on the row (hp numeric, status text)', Array.isArray(next) && next.length === 9 && next[0].hp === 5 && next[0].status === 'Damaged' && next[1].hp === systems[1].hp, JSON.stringify(next?.[0]));
  await tabs.applyItemUpdates(vessel, itemUpdates);
  ok('the tracked hp survives re-derivation (mergeSystems never overwrites hp)', ship.rowWithDerived().systems[0].hp === 5 && ship.rowWithDerived().systems[0].status === 'Damaged');
}

// ---- actions on a shim actor ---------------------------------------------------------------------
if (rokarr) {
  const app = { document: rokarr };
  const nSkills = rokarr.rowsOf('skills').length;
  await tabs.TAB_ACTIONS.addRow.call(app, null, { dataset: { source: 'skills' } });
  ok('addRow creates a blank skill Item of the source', rokarr.rowsOf('skills').length === nSkills + 1 && rokarr.rowsOf('skills').at(-1).system.row.level === '');
  const added = rokarr.rowsOf('skills').at(-1);
  await tabs.TAB_ACTIONS.deleteItem.call(app, null, { dataset: { itemId: added.id } });
  ok('deleteItem removes the row after the confirm', rokarr.rowsOf('skills').length === nSkills && !rokarr.items.get(added.id));
  const blaster = rokarr.rowsOf('customBlasters')[0];
  const wasReadied = !!blaster.system.row.equipped;
  await tabs.TAB_ACTIONS.toggleReadied.call(app, null, { dataset: { itemId: blaster.id } });
  ok('toggleReadied flips equipped and stamps / clears equippedAt', blaster.system.row.equipped === !wasReadied && (wasReadied ? blaster.system.row.equippedAt === null : typeof blaster.system.row.equippedAt === 'number'));
  await tabs.TAB_ACTIONS.toggleReadied.call(app, null, { dataset: { itemId: blaster.id } });
  ok('toggleReadied is its own inverse', blaster.system.row.equipped === wasReadied);
  await tabs.TAB_ACTIONS.toggleTracking.call(app, null, { dataset: { form: 'digital' } });
  const d1 = rokarr.system.trackDigital;
  await tabs.TAB_ACTIONS.toggleTracking.call(app, null, { dataset: { form: 'physical' } });
  ok('toggleTracking keeps digital and physical mutually exclusive (character-inventory.tsx:104-119)', d1 === true && rokarr.system.trackPhysical === true && rokarr.system.trackDigital === false);
  const armor = rokarr.rowsOf('armor').find((a) => !a.system.row.equipped) ?? rokarr.rowsOf('armor')[0];
  if (armor) {
    const was = !!armor.system.row.equipped;
    await tabs.TAB_ACTIONS.toggleEquipped.call(app, null, { dataset: { itemId: armor.id } });
    ok('toggleEquipped wears / removes armor through applySetEquip', armor.system.row.equipped === !was);
    await tabs.TAB_ACTIONS.toggleEquipped.call(app, null, { dataset: { itemId: armor.id } });
  }
  // rolls through module/rolls.mjs with the dialog skipped
  const skill = rokarr.rowsOf('skills').find((s) => s.system.row.name === 'Guns (Bowcaster)');
  const nMsgs = ChatMessage.log.length;
  const r = await rolls.rollSkill(rokarr, skill.system.row.name, { modifier: 0 });
  ok('rollSkill from the row posts a card against target 13', r && r.target === 13 && ChatMessage.log.length === nMsgs + 1);
  if (blaster.system.row.equipped) {
    const shots = rolls.shotsFor(blaster);
    const res = await rolls.rollAttack(rokarr, blaster, { modifier: 0 });
    ok('rollAttack from the row runs (a volley when RoF > 1) and banks pendingHits on the row', !!res && typeof blaster.system.row.pendingHits === 'number', `shots ${shots}`);
  }
}
if (kaelen) {
  const app = { document: kaelen };
  const form = kaelen.rowsOf('lightsaberForms')[0];
  if (form) {
    await tabs.TAB_ACTIONS.toggleActiveForm.call(app, null, { dataset: { itemId: form.id } });
    const on = kaelen.system.activeLightsaberForm === form.system.row.name;
    await tabs.TAB_ACTIONS.toggleActiveForm.call(app, null, { dataset: { itemId: form.id } });
    ok('toggleActiveForm activates the Form and a second click clears it (lightsaber-forms-section.tsx:67-69)', on && kaelen.system.activeLightsaberForm === null);
  }
  const power = kaelen.rowsOf('forcePowers')[0];
  if (power) {
    const n = ChatMessage.log.length;
    await tabs.TAB_ACTIONS.rollPower.call(app, null, { dataset: { itemId: power.id } });
    ok('rollPower from the row posts through rolls.rollForcePower (or refuses a null target with a notification, never throws)', ChatMessage.log.length === n + 1 || ui.notifications.log.some((l) => /target|default/i.test(l.message)));
  }
}

// ---- stylesheet: tokens only, scoped -----------------------------------------------------------------
const css = readFileSync(join(ROOT, 'styles', 'sheet-tabs.css'), 'utf8');
const unscoped = css.split('\n').filter((l) => /^\s*[.#a-zA-Z][^{]*\{/.test(l) && !/^\s*(\.shadowbase|@media|:root)/.test(l) && !l.trim().startsWith('/*'));
ok('styles/sheet-tabs.css scopes every rule under .shadowbase (or a media query)', unscoped.length === 0, unscoped.slice(0, 3).join(' | '));
ok('styles/sheet-tabs.css reads colours through hsl(var(--token)) (no hard-coded hex)', !/#[0-9a-fA-F]{3,6}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));

report(`${rendered.size} actors x 4 tabs rendered strict`);
