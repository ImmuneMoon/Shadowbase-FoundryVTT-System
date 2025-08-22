
// systems\shadowbase\scripts\settings.js

/**
 * Registers system-specific settings in the Foundry VTT settings menu.
 */
export const registerSystemSettings = function () {
    // Example Setting
    game.settings.register("shadowbase", "exampleSetting", {
        name: "Example Setting",
        hint: "This is an example setting for the ShadowBase system.",
        scope: "world", // "world" for world-specific, "client" for client-specific
        config: true,   // false if you don't want it in the settings menu
        type: Boolean,
        default: true,
        onChange: value => {
            console.log("ShadowBase | Example setting changed to:", value);
        }
    });
};
