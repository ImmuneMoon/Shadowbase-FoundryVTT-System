// systems\shadowbase\scripts\combat.js

/**
 * Initializes and enhances the combat tracker for the ShadowBase system.
 * @param {JQuery} html - The jQuery object representing the combat tracker's HTML.
 * @param {object} data - The combat data.
 */
export function initializeCombatTracker(html, data) {
    // The 'renderCombatTracker' hook provides a raw HTMLElement.
    // We need to wrap it with jQuery to use jQuery methods like .find().
    const html$ = $(html);
    const header = html$.find("#combat-tracker-header");

    if (header.find(".roll-all-initiative").length === 0) {
        const button = $(`<a class="combat-control roll-all-initiative" title="Roll Initiative for All"><i class="fas fa-dice-d20"></i></a>`);
        button.on('click', () => {
            const combat = data.combat;
            if (combat) {
                // Assuming dexterity.value exists; adjust if the path is different
                combat.rollAll({ formula: "1d20 + @attributes.dexterity.value" });
            }
        });
        header.find(".combat-controls").prepend(button);
    }
}
