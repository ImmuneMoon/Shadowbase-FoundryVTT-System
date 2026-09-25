// module/shadowbase.mjs
//
// System entry point (system.json "esmodules"). Registers the data layer and
// the table-play modules (rolls, combat, damage) into Foundry's CONFIG at init
// and exposes `game.shadowbase`; registers the actor sheet, the item sheets
// (U08), the sub-apps (U09) and the settings (U10, module/settings.mjs).
//
// Everything registered here is defined elsewhere: the engine in
// module/engine.mjs, the registries in module/config.mjs, the models in
// module/data/*, the documents in module/documents/*. This file only wires.

import { engine } from './engine.mjs';
import { adapter, sheetToActorData, itemNameFor } from './adapter.mjs';
import { SHADOWBASE, TRACKABLE_ATTRIBUTES, ITEM_TYPES, ICONS } from './config.mjs';
import { effects, registerStatusEffects, registerEffectHooks } from './effects.mjs';
import { rolls, registerChatHooks } from './rolls.mjs';
import { combat, registerCombat, registerCombatHooks } from './combat.mjs';
import { damage } from './damage.mjs';
import { RollDialog } from './apps/roll-dialog.mjs';
import compendiumDrop from './compendium-drop.mjs';
// Wave 3 (U05 owns this file): the actor sheet, its helpers and partials, the HUD and the handbook browser, the importer.
import { ShadowBaseActorSheet } from './apps/actor-sheet.mjs';
import { TAB_TEMPLATES } from './apps/actor-sheet-tabs.mjs';
import { TacticalHud } from './apps/hud.mjs';
import { HandbookBrowser, HandbookBrowserApp } from './apps/handbook-browser.mjs';
import importExport from './import-export.mjs';
import { registerHelpers, preloadTemplates } from './helpers/handlebars.mjs';
// Wave 4 (U08 owns this file): the item sheets and the builder helpers they share.
import { registerItemSheets, ITEM_SHEETS, ITEM_SHEET_CLASSES, builders as itemBuilders } from './apps/item-sheets/index.mjs';
// Wave 4 (U09, folded by U08 per docs/REQUESTS.md): the six sub-apps (§6.5) and the GM's Import Dossiers button.
import { DroidWorkshop } from './apps/droid-workshop.mjs';
import { AnatomyWorkshop } from './apps/anatomy-workshop.mjs';
import { BodyLoadout } from './apps/body-loadout.mjs';
import { SuitsAndSets } from './apps/suits-sets.mjs';
import { CraftingApp } from './apps/crafting.mjs';
import { DossierImporter, registerDossierImporterButton } from './apps/dossier-importer.mjs';
import { CharacterData } from './data/actor-character.mjs';
import { ITEM_DATA_MODELS } from './data/item-types.mjs';
import { ShadowBaseActor } from './documents/actor.mjs';
import { ShadowBaseItem } from './documents/item.mjs';
import { ShadowBaseActiveEffect } from './documents/active-effect.mjs';
// Wave 5 (U10 owns this file): the world / client settings and the facing <-> token rotation mirror.
import { settings, registerSettings, registerSettingsHooks } from './settings.mjs';

export const SYSTEM_ID = 'shadowbase';

/**
 * Register documents, data models, status effects and trackable attributes.
 * Exported so the headless smoke can call exactly what the init hook calls.
 */
export function registerDataLayer() {
  CONFIG.SHADOWBASE = SHADOWBASE;

  CONFIG.Actor.documentClass = ShadowBaseActor;
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.trackableAttributes = { ...(CONFIG.Actor.trackableAttributes ?? {}), ...TRACKABLE_ATTRIBUTES };

  CONFIG.Item.documentClass = ShadowBaseItem;
  Object.assign(CONFIG.Item.dataModels, ITEM_DATA_MODELS);

  CONFIG.ActiveEffect.documentClass = ShadowBaseActiveEffect;
  // Effects never transfer from items: every modifier the engine reads is on a row or a stored effect row (§4.4).
  CONFIG.ActiveEffect.legacyTransferral = false;

  // v13 CONFIG.statusEffects entries: { id, name (i18n key), img, hud } from module/config.mjs (module/effects.mjs registers them).
  registerStatusEffects();

  // Initiative is Basic Speed with DX in the hundredths, never a die (§5.2): CONFIG.Combat.initiative
  // '@initiative' / 2 decimals, and the Combat/Combatant document classes (module/combat.mjs).
  registerCombat();

  // World settings (enforceEconomy reserved, npcDefaultHidden, tokenRotationSync) and the client
  // preferences the website keeps off the character (module/settings.mjs; the readers in rolls.mjs,
  // hud.mjs and actor-sheet.mjs fall back to the declared defaults while unregistered).
  registerSettings();

  game.shadowbase = {
    id: SYSTEM_ID,
    engine,
    adapter,
    config: SHADOWBASE,
    documents: { ShadowBaseActor, ShadowBaseItem, ShadowBaseActiveEffect },
    models: { CharacterData, ...ITEM_DATA_MODELS },
    // module/effects.mjs: add / dismiss / advancePhase / recoverEp / sweepExpired / syncStun (ShadowBaseActor#sweepTurn delegates here).
    effects,
    // module/rolls.mjs (§5.1): every target roll, damage, volley, defense, power, technique, crew action, stun recovery, chat cards.
    rolls,
    // module/combat.mjs (§5.2): the tracker-driven turn counter, the sweep, the economy advisories.
    combat,
    // module/damage.mjs (§5.3): the Tactical Damage Processor (assessDamage pure, applyDamage writes).
    damage,
    // The applications (§6): the roll prompt (§6.3), the actor sheet (§6.1, U05), the Tactical HUD and the
    // handbook browser (§6.2, U07). U08 adds the item sheets and U09 the sub-apps (DroidWorkshop, AnatomyWorkshop,
    // BodyLoadout, SuitsAndSets, CraftingApp, DossierImporter) under these names - the tabs open them by name.
    apps: { RollDialog, ShadowBaseActorSheet, TacticalHud, HandbookBrowser, HandbookBrowserApp, ...ITEM_SHEET_CLASSES, DroidWorkshop, AnatomyWorkshop, BodyLoadout, SuitsAndSets, CraftingApp, DossierImporter },
    // module/apps/item-sheets (U08): Item type -> sheet class, and the builder rules the sub-apps (U09 CraftingApp) reuse:
    // applyBuild / releaseBuild / slotView / slotEdit / fittedView / fittedEdit / rebindOwnedRow / conditionView.
    itemSheets: ITEM_SHEETS,
    itemBuilders,
    // module/import-export.mjs (U06): character JSON in/out, item envelopes, the bulk roster route.
    importExport,
    // module/compendium-drop.mjs (§7, unit U03): kits, per-name powers and template Actors dropped on a sheet.
    compendiumDrop,
    // module/settings.mjs (U10): the declarations, guarded reads, the preference attributes, the facing mirror.
    settings,
  };
  return game.shadowbase;
}

/**
 * Sheet registration (Foundry v13.341+ registers no default sheets, so nothing
 * is unregistered): the actor sheet for `character` and one item sheet per
 * family for the 21 Item types (module/apps/item-sheets/index.mjs).
 * Exported so the headless checks call exactly what the init hook calls.
 */
export function registerSheets() {
  const collections = foundry.documents.collections;
  collections.Actors.registerSheet(SYSTEM_ID, ShadowBaseActorSheet, { types: ['character'], makeDefault: true, label: 'SHADOWBASE.Sheet.Character' });
  // Wave 4 (U08): one item sheet per family, registered for the types it serves (module/apps/item-sheets/index.mjs).
  registerItemSheets(collections);
  return collections;
}

/**
 * Handlebars helpers (module/helpers/handlebars.mjs) and every partial by
 * name: the sheet's `shadowbase.*` partials plus the tab partials U06's
 * templates reference by path. Runs at `setup` (helpers must exist before the
 * first render; the templates are fetched once).
 */
export async function registerTemplates() {
  registerHelpers(globalThis.Handlebars);
  const partials = await preloadTemplates();
  const tabPartials = Array.isArray(TAB_TEMPLATES?.partials) ? TAB_TEMPLATES.partials : [];
  if (tabPartials.length) await foundry.applications.handlebars.loadTemplates(tabPartials);
  return { partials, tabPartials };
}

/**
 * Hooks that keep documents consistent with the website's conventions.
 * Exported for the smoke; the init hook calls it once.
 */
export function registerHooks() {
  /*
    A fresh character is the website's blank sheet: its Credit Chip and its
    twelve anatomy rows with fresh uuids (engine.blank()), Ch2's 7,000 credits,
    the Ch4 qualified-ST switches on. Only when the creator gave no system data
    and no items - a compendium template or an import arrives complete and must
    not be overwritten.
    The system fields are seeded in preCreate (updateSource on the unsaved
    document); the Items are created right after creation, by the creating
    client only, because seeding an embedded collection through updateSource
    inside preCreate is UNVERIFIED for Foundry v13 and a throw there would
    abort the creation itself.
  */
  Hooks.on('preCreateActor', (document, data) => {
    if (document.type !== 'character') return;
    const hasSystem = data.system && Object.keys(data.system).length > 0;
    const hasItems = Array.isArray(data.items) && data.items.length > 0;
    if (hasSystem || hasItems) return;
    const seeded = sheetToActorData(engine.blank(), { actorName: data.name });
    document.updateSource({ system: seeded.system });
    document.__shadowbaseSeededItems = seeded.items;
  });
  Hooks.on('createActor', async (document, options, userId) => {
    if (document.type !== 'character' || userId !== game.userId) return;
    const seeded = document.__shadowbaseSeededItems;
    delete document.__shadowbaseSeededItems;
    if (seeded?.length && document.items.size === 0) await document.createEmbeddedDocuments('Item', seeded);
  });

  // An Item's name and icon mirror its row (§4.2): name = customName || name; img = the type's icon unless the creator chose one.
  Hooks.on('preCreateItem', (document, data) => {
    const cfg = ITEM_TYPES[document.type];
    if (!cfg) return;
    const updates = {};
    const row = data.system?.row;
    if (row && (!data.name || data.name === game.i18n.localize(cfg.label))) updates.name = itemNameFor(row, document.type);
    if (!data.img || data.img === ShadowBaseItem.DEFAULT_ICON || data.img === 'icons/svg/item-bag.svg') updates.img = cfg.img;
    if (Object.keys(updates).length) document.updateSource(updates);
  });
  Hooks.on('preUpdateItem', (document, changes) => {
    const row = changes.system?.row;
    if (!row || !(('name' in row) || ('customName' in row))) return;
    if ('name' in changes) return; // an explicit rename wins
    const merged = { ...(document.system?.row ?? {}), ...row };
    changes.name = itemNameFor(merged, document.type);
  });

  // stunType <-> token stun statuses, and token-HUD toggles adopted as manual rows (module/effects.mjs, §4.4).
  registerEffectHooks();

  // updateCombat: the Global Turn Counter follows the tracker's round and sweeps (module/combat.mjs, §5.2).
  registerCombatHooks();

  // renderChatMessageHTML: the card buttons (roll damage after a hit, apply a power's costs) (module/rolls.mjs).
  registerChatHooks();

  // Compendium kits / per-name rows / template Actors are handled by the actor sheet's own v13 _onDropItem /
  // _onDropActor (module/apps/actor-sheet.mjs -> module/compendium-drop.mjs); no dropActorSheetData hook exists
  // (that hook is Application-V1 only and never fires for a v13 ActorSheetV2).

  // renderActorDirectory: the GM-only "Import Dossiers" button (module/apps/dossier-importer.mjs, U09).
  registerDossierImporterButton();

  // updateActor / updateToken: system.facing <-> token rotation while the world setting is on (module/settings.mjs, U10).
  registerSettingsHooks();

  // The actor directory's context menu: "Open Tactical HUD" on a character (v13 getActorContextOptions(application,
  // menuItems) with `li` the entry element and its data-entry-id - the entry shape is UNVERIFIED headlessly, so
  // the callback resolves the id defensively and does nothing when no actor is found).
  Hooks.on('getActorContextOptions', (application, menuItems) => {
    if (!Array.isArray(menuItems)) return;
    menuItems.push({
      name: 'SHADOWBASE.Settings.OpenHud',
      icon: `<i class="${ICONS.hud}"></i>`,
      condition: (li) => { const actor = directoryActor(li); return !!actor && actor.type === 'character' && actor.isOwner !== false; },
      callback: (li) => { const actor = directoryActor(li); return actor ? TacticalHud.open(actor) : null; },
    });
  });
}

/** The world actor an actor-directory entry element names (data-entry-id in v13; data-document-id on older markup). */
function directoryActor(li) {
  const el = li?.[0] ?? li;
  const id = el?.dataset?.entryId ?? el?.dataset?.documentId ?? (typeof el?.getAttribute === 'function' ? (el.getAttribute('data-entry-id') ?? el.getAttribute('data-document-id')) : null);
  return id ? game.actors?.get(id) ?? null : null;
}

Hooks.once('init', () => {
  console.log(`${SYSTEM_ID} | init: engine ${engine.characterSheetSchema ? 'loaded' : 'MISSING'}`);
  registerDataLayer();
  registerHooks();
  registerSheets();
});

Hooks.once('setup', async () => {
  await registerTemplates();
});

Hooks.once('ready', () => {
  const missing = engine.U01_EXPORTS.filter((n) => !engine.hasExport(n));
  if (missing.length) {
    ui.notifications.warn(game.i18n.format('SHADOWBASE.Engine.MissingExport', { names: missing.join(', ') }), { permanent: false });
  }
  console.log(`${SYSTEM_ID} | ready`);
});
