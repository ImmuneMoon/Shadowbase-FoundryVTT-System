// systems\shadowbase\scripts\data-importer.js
import { calculateStats } from './calculations.js';
/**
 * Imports character data from a JSON file (exported from the web app) and updates the actor.
 * @param {ShadowBaseActor} actor - The actor to update.
 * @param {string} jsonContent - The JSON content from the imported file.
 */
export async function importCharacterData(actor, jsonContent) {
    try {
        const data = JSON.parse(jsonContent);

        // Start building the update object
        const updateData = {};
        const systemUpdate = {};

        // Update top-level properties like name and image
        if (data.name) updateData['name'] = data.name;
        if (data.portrait) updateData['img'] = data.portrait;

        // Directly map simple system properties
        const simpleSystemKeys = ['player', 'species', 'campaign', 'points', 'credits', 'details', 'languages', 'culturalFamiliarities', 'literacy', 'attributes', 'narrative', 'forceAlignment'];
        simpleSystemKeys.forEach(key => {
            if (data[key] !== undefined) {
                systemUpdate[`system.${key}`] = data[key];
            }
        });

        // Map characteristics, ensuring current values are set
        if (data.characteristics) {
            const characteristics = foundry.utils.deepClone(data.characteristics);
            if (characteristics.hitPoints) characteristics.hitPoints.current = characteristics.hitPoints.final;
            if (characteristics.endurancePoints) characteristics.endurancePoints.current = characteristics.endurancePoints.final;
            if (characteristics.forcePoints) characteristics.forcePoints.current = characteristics.forcePoints.final;
            systemUpdate['system.characteristics'] = characteristics;
        }

        foundry.utils.mergeObject(updateData, systemUpdate);

        // --- Item Management ---
        // CORRECTED: Added 'lightsaber' to the list of items to clear on import.
        const itemTypesToClear = ['advantage', 'disadvantage', 'quirk', 'skill', 'forcePower', 'combatTechnique', 'lightsaberForm', 'equipment', 'meleeWeapon', 'blaster', 'lightsaber', 'explosive', 'armor', 'vehicle'];
        const idsToDelete = actor.items.filter(i => itemTypesToClear.includes(i.type)).map(i => i.id);
        if (idsToDelete.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", idsToDelete);
        }

        const itemsToCreate = [];
        const itemCategories = {
            'advantage': data.traits?.advantages || [],
            'disadvantage': data.traits?.disadvantages || [],
            'quirk': data.traits?.quirks || [],
            'skill': data.skills || [],
            'forcePower': data.abilities?.forcePowers || [],
            'combatTechnique': data.abilities?.combatTechniques || [],
            'lightsaberForm': data.abilities?.lightsaberForms || [],
            'equipment': data.inventory?.general || [],
            'meleeWeapon': data.inventory?.weapons?.melee || [],
            'blaster': data.inventory?.weapons?.blasters || [],
            'lightsaber': data.inventory?.weapons?.lightsabers || [],
            'explosive': data.inventory?.explosives || [],
            'armor': data.inventory?.armor || [],
            // CORRECTED: Mapped the 'starships' key from the JSON to the 'vehicle' item type.
            'vehicle': data.inventory?.starships || [] 
        };

        for (const [type, items] of Object.entries(itemCategories)) {
            if (items && Array.isArray(items)) {
                items.forEach(itemData => {
                    const newItem = {
                        name: itemData.name || `New ${type}`,
                        type: type,
                        system: itemData
                    };
                    // Rename 'description' from web app to 'notes' for Foundry
                    if (newItem.system.description && !newItem.system.notes) {
                        newItem.system.notes = newItem.system.description;
                        delete newItem.system.description;
                    }
                    itemsToCreate.push(newItem);
                });
            }
        }
        
        await actor.update(updateData);
        if (itemsToCreate.length > 0) {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        }

        // Recalculate stats after all data and items are loaded
        const calculatedData = calculateStats(actor.system, actor.items.map(i => i.toObject(false)));
        await actor.update({"system.characteristics": calculatedData.characteristics, "system.points": calculatedData.points});

        ui.notifications.info(`Successfully imported character data for ${data.name}.`);

    } catch (error) {
        console.error("ShadowBase | Import Error:", error);
        ui.notifications.error("Failed to import character data. Check the console for details.");
    }
}