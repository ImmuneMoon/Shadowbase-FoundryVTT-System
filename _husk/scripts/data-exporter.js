// systems\shadowbase\scripts\data-exporter.js

/**
 * Converts the actor's data into a JSON format compatible with the ShadowBase web app.
 * @param {ShadowBaseActor} actor - The actor to export.
 */
export function exportCharacterData(actor) {
    const sheetData = actor.toObject(false);
    const system = sheetData.system;

    // This structure should match what the web app's `convertFoundryToSheet` expects.
    const exportData = {
        name: sheetData.name,
        portrait: sheetData.img,
        player: system.player,
        species: system.species,
        campaign: system.campaign,
        points: system.points,
        credits: system.credits,
        details: system.details,
        languages: system.languages,
        culturalFamiliarities: system.culturalFamiliarities,
        literacy: system.literacy,
        attributes: system.attributes,
        characteristics: system.characteristics,
        narrative: system.narrative,
        traits: {
            advantages: actor.items.filter(i => i.type === 'advantage').map(i => i.toObject(false).system),
            disadvantages: actor.items.filter(i => i.type === 'disadvantage').map(i => i.toObject(false).system),
            quirks: actor.items.filter(i => i.type === 'quirk').map(i => i.toObject(false).system),
        },
        skills: actor.items.filter(i => i.type === 'skill').map(i => i.toObject(false).system),
        abilities: {
            forcePowers: actor.items.filter(i => i.type === 'forcePower').map(i => i.toObject(false).system),
            combatTechniques: actor.items.filter(i => i.type === 'combatTechnique').map(i => i.toObject(false).system),
            lightsaberForms: actor.items.filter(i => i.type === 'lightsaberForm').map(i => i.toObject(false).system),
        },
        inventory: {
            general: actor.items.filter(i => i.type === 'equipment').map(i => i.toObject(false).system),
            weapons: {
                melee: actor.items.filter(i => i.type === 'meleeWeapon').map(i => i.toObject(false).system),
                blasters: actor.items.filter(i => i.type === 'blaster').map(i => i.toObject(false).system),
                lightsabers: actor.items.filter(i => i.type === 'lightsaber').map(i => i.toObject(false).system),
            },
            armor: actor.items.filter(i => i.type === 'armor').map(i => i.toObject(false).system),
            explosives: actor.items.filter(i => i.type === 'explosive').map(i => i.toObject(false).system),
            starships: actor.items.filter(i => i.type === 'vehicle').map(i => i.toObject(false).system),
        }
    };
    
    // Rename 'notes' back to 'description' for web app compatibility
    const renameNotesToDescription = (items) => {
        if (!items) return;
        items.forEach(item => {
            if (item.notes) {
                item.description = item.notes;
                delete item.notes;
            }
        });
    };
    
    renameNotesToDescription(exportData.traits.advantages);
    renameNotesToDescription(exportData.traits.disadvantages);
    renameNotesToDescription(exportData.traits.quirks);
    renameNotesToDescription(exportData.skills);
    renameNotesToDescription(exportData.inventory.general);
    renameNotesToDescription(exportData.inventory.armor);

    const characterName = sheetData.name || 'character';
    const sanitizedFilename = characterName.replace(/[^a-z0-9_.\-\s]/gi, '_').toLowerCase();
    const jsonString = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(jsonString, "application/json", `${sanitizedFilename}_shadowbase.json`);

    ui.notifications.info(`Exported ${characterName} for ShadowBase.`);
}
