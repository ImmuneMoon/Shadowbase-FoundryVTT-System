
(async () => {
  // --- Configuration ---
  const packsToImport = [
    { packName: "shadowbase.advantages", filePath: "systems/shadowbase/database/advantages_to_import.json", defaultType: "advantage" },
    { packName: "shadowbase.armor", filePath: "systems/shadowbase/database/armor_to_import.json", defaultType: "armor" },
    { packName: "shadowbase.combattechniques", filePath: "systems/shadowbase/database/combat-techniques_to_import.json", defaultType: "combatTechnique" },
    { packName: "shadowbase.disadvantages", filePath: "systems/shadowbase/database/disadvantages_to_import.json", defaultType: "disadvantage" },
    { packName: "shadowbase.forcepowers", filePath: "systems/shadowbase/database/force-powers_to_import.json", defaultType: "forcePower" },
    { packName: "shadowbase.lightsaberforms", filePath: "systems/shadowbase/database/lightsaber-forms_to_import.json", defaultType: "lightsaberForm" },
    { packName: "shadowbase.quirks", filePath: "systems/shadowbase/database/quirks_to_import.json", defaultType: "quirk" },
    { packName: "shadowbase.skills", filePath: "systems/shadowbase/database/skills_to_import.json", defaultType: "skill" },
    { packName: "shadowbase.vehicles", filePath: "systems/shadowbase/database/vehicles_to_import.json", defaultType: "vehicle" },
    { packName: "shadowbase.lightsabers", filePath: "systems/shadowbase/database/lightsabers_to_import.json", specialHandling: "nestedObject", defaultType: "lightsaber" },
    { packName: "shadowbase.weapons", filePath: "systems/shadowbase/database/weapons_to_import.json", specialHandling: "nestedObject" }
  ];

  // --- Main Logic ---
  console.log("--- Starting Compendium Import Manager ---");

  const confirmed = await Dialog.confirm({
    title: "Confirm Full Compendium Rebuild",
    content: `<p>This will delete and re-import all content for the configured packs. Are you sure?</p>
              <p><strong>Note:</strong> Ensure all relevant compendiums are unlocked before proceeding.</p>`
  });

  if (!confirmed) {
    ui.notifications.warn("Full import cancelled by user.");
    return;
  }

  let totalSuccess = 0;
  let totalFail = 0;

  for (const packInfo of packsToImport) {
    try {
      console.log(`Processing pack: ${packInfo.packName}...`);
      
      const pack = game.packs.get(packInfo.packName);
      if (!pack) throw new Error(`Compendium pack "${packInfo.packName}" not found.`);
      if (pack.locked) throw new Error(`Compendium pack "${pack.title}" is locked.`);

      const response = await fetch(packInfo.filePath);
      if (!response.ok) throw new Error(`Data file not found at ${packInfo.filePath}`);
      const rawData = await response.json();
      
      let dataToCreate = [];

      if (packInfo.specialHandling === "nestedObject") {
        console.log(`-> Applying 'nestedObject' handling.`);
        // MODIFICATION 1: Changed "flamethrower" and "slugthrower" to map to the valid "blaster" type.
        const typeMap = { 
          blasters: "blaster", 
          melee: "meleeWeapon", 
          explosives: "explosive", 
          grenades: "explosive",
          mines: "explosive",
          flamethrowers: "blaster",
          slugthrowers: "blaster",
          gauntlet_and_concealed: "equipment"
        };
        
        function processNested(data, currentType) {
          for (const key in data) {
            if (Array.isArray(data[key])) {
              const itemType = typeMap[key] || currentType;
              data[key].forEach(item => {
                const systemData = { ...item };
                delete systemData.name;
                dataToCreate.push({ name: item.name || "Unnamed", type: itemType, img: "icons/svg/item-bag.svg", system: systemData });
              });
            } else if (typeof data[key] === 'object' && data[key] !== null) {
              processNested(data[key], typeMap[key] || currentType);
            }
          }
        }
        processNested(rawData, packInfo.defaultType);
      } 
      else {
        console.log(`-> Applying standard array handling.`);
        if (!Array.isArray(rawData)) throw new Error(`Data for ${packInfo.packName} is not an array.`);

        dataToCreate = rawData.map(item => {
          const itemType = item.type || packInfo.defaultType;
          
          if (item.levels && Array.isArray(item.levels)) {
            let notesContent = "";
            if (item.description) notesContent += `<h3>Description</h3><p>${item.description}</p>`;
            
            // Correctly set the requirements to the baseSkill.
            if (item.baseSkill) notesContent += `<p><strong>Requirements:</strong> ${item.baseSkill}</p>`;
            
            if (item.specialNote) notesContent += `<p><strong><em>Note:</em></strong> <em>${item.specialNote}</em></p>`;
            
            notesContent += `<h3>Levels</h3>`;
            item.levels.forEach(level => {
              notesContent += `<hr><h4>Level ${level.level} ${level.characterTier ? `(${level.characterTier})` : ''}</h4>`;
              notesContent += `<ul>`;
              if (level.effect) notesContent += `<li><strong>Effect:</strong> ${level.effect}</li>`;
              if (level.points) notesContent += `<li><strong>Points:</strong> ${level.points}</li>`;
              if (level.cpCost) notesContent += `<li><strong>CP Cost:</strong> ${level.cpCost}</li>`;
              if (level.fpCost) notesContent += `<li><strong>FP Cost:</strong> ${level.fpCost}</li>`;
              if (level.epCost) notesContent += `<li><strong>EP Cost:</strong> ${level.epCost}</li>`;
              notesContent += `</ul>`;
            });
            // Pass the baseSkill as the requirements field in the system data.
            return { name: item.name || "Unnamed", type: itemType, img: "icons/svg/item-bag.svg", system: { notes: notesContent, requirements: item.baseSkill } };
          } 
          else {
            const systemData = { ...item };
            delete systemData.name;
            delete systemData.type;
            return { name: item.name || "Unnamed", type: itemType, img: "icons/svg/item-bag.svg", system: systemData };
          }
        });
      }
      
      console.log(`-> Found ${dataToCreate.length} items to create.`);
      
      const existingIds = (await pack.getIndex()).map(i => i._id);
      if (existingIds.length > 0) {
        await Item.deleteDocuments(existingIds, { pack: pack.collection });
      }
      
      // MODIFICATION 2: Added 'throwOnValidationError: true' for stricter error handling.
      await Item.createDocuments(dataToCreate, { pack: pack.collection, throwOnValidationError: true });
      
      ui.notifications.info(`Successfully imported ${dataToCreate.length} items into "${pack.title}".`);
      console.log(`✅ Success for ${packInfo.packName}`);
      totalSuccess++;

    } catch (err) {
      console.error(`❌ Failed to process ${packInfo.packName}:`, err);
      ui.notifications.error(`Failed to import for: ${packInfo.packName}. Check console (F12).`);
      totalFail++;
    }
  }

  ui.notifications.info("Compendium Import Manager finished.");
  console.log(`--- Import complete! Success: ${totalSuccess}, Failed: ${totalFail} ---`);
})();
