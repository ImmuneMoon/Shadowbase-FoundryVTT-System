// systems\shadowbase\scripts\preload-templates.js

/**
 * Preloads all the Handlebars templates used by the system.
 */
export const preloadHandlebarsTemplates = async function () {
    const templatePaths = [
        
        // Main Actor Sheet
        "systems/shadowbase/templates/actor-sheet.hbs",

        // Actor Sheet Partials

        // Core Tab
        "systems/shadowbase/templates/partials/core/actor-header-info.hbs",
        "systems/shadowbase/templates/partials/core/actor-force-alignment.hbs",
        "systems/shadowbase/templates/partials/core/actor-primary-stats.hbs",
        "systems/shadowbase/templates/partials/core/actor-secondary-stats.hbs",
        "systems/shadowbase/templates/partials/core/actor-damage-resistance.hbs",

        // Combat Hub Tab
        "systems/shadowbase/templates/partials/combat/actor-combat-hub.hbs",
        "systems/shadowbase/templates/partials/combat/combat-hub-resources.hbs",
        "systems/shadowbase/templates/partials/combat/combat-hub-defenses.hbs",
        "systems/shadowbase/templates/partials/combat/combat-hub-weapons.hbs",

        // Abilities Tab
        "systems/shadowbase/templates/partials/abilities/actor-traits.hbs",
        "systems/shadowbase/templates/partials/abilities/actor-skills.hbs",
        "systems/shadowbase/templates/partials/abilities/actor-abilities.hbs",

        // Inventory
        "systems/shadowbase/templates/partials/inventory/actor-inventory.hbs",
        "systems/shadowbase/templates/partials/inventory/actor-vehicles.hbs",
        "systems/shadowbase/templates/partials/inventory/actor-weapons-list.hbs",

        // Narriative
        "systems/shadowbase/templates/partials/narriative/actor-notes.hbs",

        // Roll Hub
        "systems/shadowbase/templates/partials/roll-hub/roll-hub-dialog.hbs",

        // Item Sheets
        "systems/shadowbase/templates/items/item-generic-sheet.hbs",
        "systems/shadowbase/templates/items/item-skill-sheet.hbs",
        "systems/shadowbase/templates/items/item-weapon-sheet.hbs",
    ];

    return foundry.applications.handlebars.loadTemplates(templatePaths);
};
