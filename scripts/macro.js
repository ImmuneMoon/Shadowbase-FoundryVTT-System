
// systems\shadowbase\scripts\macro.js

/**
 * Creates a sample macro for the ShadowBase system.
 * This function is intended to be used as a template for creating other macros.
 */
export async function createShadowBaseMacro(data, slot) {
    const command = `
// Example ShadowBase Macro
const speaker = ChatMessage.getSpeaker();
let actor;
if (speaker.token) actor = game.actors.tokens[speaker.token];
if (!actor) actor = game.actors.get(speaker.actor);

if (actor) {
    // Example: Roll a Strength check for the selected actor
    actor.rollCheck("Strength Check", actor.system.attributes.strength.value);
} else {
    ui.notifications.warn("You must select a token or have an actor assigned to your user to use this macro.");
}
    `;
    let macro = game.macros.find(m => (m.name === data.name) && (m.command === command));
    if (!macro) {
        macro = await Macro.create({
            name: data.name,
            type: "script",
            img: data.img,
            command: command,
            flags: { "shadowbase.type": "example" }
        });
    }
    game.user.assignHotbarMacro(macro, slot);
    return false;
}
