// systems/shadowbase/scripts/shadowbase.js
import { ShadowBaseActor } from './actor.js';
import { preloadHandlebarsTemplates } from './preload-templates.js';
import { registerSystemSettings } from './settings.js';
import { createShadowBaseMacro } from './macro.js';
import { initializeCombatTracker } from './combat.js';
import { exportCharacterData } from './data-exporter.js';
import { importCharacterData } from './data-importer.js';
import { RollHub } from './roll-hub.js';

Hooks.once('init', async () => {
    console.log('ShadowBase | Initializing System');
    game.shadowbase = { ShadowBaseActor, createShadowBaseMacro };
    CONFIG.Actor.documentClass = ShadowBaseActor;
    registerSystemSettings();
    Handlebars.registerHelper('capitalize', function(str) {
        if (typeof str !== 'string') return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    });
    foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
    foundry.documents.collections.Actors.registerSheet("shadowbase", ShadowBaseActorSheet, {
        types: ["character"],
        makeDefault: true,
        label: "ShadowBase Character Sheet"
    });
    await preloadHandlebarsTemplates();
    console.log('ShadowBase | All templates loaded.');
});

Hooks.on("renderCombatTracker", (app, html, data) => {
    initializeCombatTracker(html, data);
});

class ShadowBaseActorSheet extends foundry.appv1.sheets.ActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["shadowbase", "sheet", "actor"],
            template: "systems/shadowbase/templates/actor-sheet.hbs",
            width: 900,
            height: 850,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "core" }]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = this.actor.system;
        this._prepareItems(context);
        return context;
    }

    _prepareItems(context) {
        const advantages = [], disadvantages = [], quirks = [], skills = [], forcePowers = [],
            combatTechniques = [], lightsaberForms = [], equipment = [], meleeWeapons = [],
            blasters = [], lightsabers = [], explosives = [], armor = [], vehicles = [];
        for (const item of this.actor.items) {
            switch (item.type) {
                case 'advantage': advantages.push(item); break;
                case 'disadvantage': disadvantages.push(item); break;
                case 'quirk': quirks.push(item); break;
                case 'skill': skills.push(item); break;
                case 'forcePower': forcePowers.push(item); break;
                case 'combatTechnique': combatTechniques.push(item); break;
                case 'lightsaberForm': lightsaberForms.push(item); break;
                case 'equipment': equipment.push(item); break;
                case 'meleeWeapon': meleeWeapons.push(item); break;
                case 'blaster': blasters.push(item); break;
                case 'lightsaber': lightsabers.push(item); break;
                case 'explosive': explosives.push(item); break;
                case 'armor': armor.push(item); break;
                case 'vehicle': vehicles.push(item); break;
            }
        }
        context.itemsByType = { advantage: advantages, disadvantage: disadvantages, quirk: quirks };
        context.skills = skills;
        context.abilities = { forcePowers, combatTechniques, lightsaberForms };
        context.inventory = {
            general: equipment,
            weapons: { melee: meleeWeapons, blasters, lightsabers },
            armor, explosives, starships: vehicles
        };
    }

    activateListeners(html) {
        super.activateListeners(html[0]);
        const actor = this.actor;
        html.find('.import-json-button').on('click', (event) => {
            event.preventDefault();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = e => {
                const file = (e.target).files?.[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = readEvent => {
                        const content = readEvent.target?.result;
                        if (typeof content === 'string') {
                            importCharacterData(actor, content);
                        }
                    };
                    reader.readAsText(file);
                }
            };
            input.click();
        });
        html.find('.export-json-button').on('click', (event) => {
            event.preventDefault();
            exportCharacterData(actor);
        });
        html.find('.open-roll-hub').on('click', (event) => {
            event.preventDefault();
            new RollHub(actor).render(true);
        });
        html.find('.item-create').on('click', async (event) => {
            const header = $(event.currentTarget).closest('.item-list-header, .section-header');
            const type = header.data('type');
            if (type) {
                const itemData = { name: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`, type: type };
                await actor.createEmbeddedDocuments("Item", [itemData]);
            }
        });
        html.find('.item-edit').on('click', (event) => {
            const itemId = $(event.currentTarget).closest('.item-entry').data('itemId');
            const item = actor.items.get(itemId);
            if (item) item.sheet.render(true);
        });
        html.find('.item-delete').on('click', async (event) => {
            const itemId = $(event.currentTarget).closest('.item-entry').data('itemId');
            const item = actor.items.get(itemId);
            if (item) {
                const confirmed = await Dialog.confirm({
                    title: `Delete ${item.name}?`,
                    content: `<p>Are you sure you want to delete "${item.name}"?</p>`,
                    yes: () => true, no: () => false, defaultYes: false
                });
                if (confirmed) await actor.deleteEmbeddedDocuments("Item", [itemId]);
            }
        });
        html.find('.rollable-attribute').on('click', (event) => {
            const attributeName = $(event.currentTarget).data('attribute');
            const attribute = actor.system.attributes[attributeName];
            if (attribute) {
                actor.rollCheck(attributeName.capitalize(), attribute.value);
            }
        });
    }
}