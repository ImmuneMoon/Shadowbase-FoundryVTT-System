// systems/shadowbase/scripts/actor.js
import { calculateStats } from './calculations.js';

/**
 * Extend the base Actor document to support our system's data model and calculations.
 * @extends {Actor}
 */
export class ShadowBaseActor extends Actor {

    /** @override */
    prepareData() {
        super.prepareData();
    }
    
    /** @override */
    prepareDerivedData() {
        super.prepareDerivedData();
        
        // Perform all base calculations from calculations.js
        const derivedStats = calculateStats(this.system, this.items.map(i => i.toObject(false)));
        foundry.utils.mergeObject(this.system, derivedStats);

        // Prepare derived defenses like Parry and Block after base stats are calculated
        this._prepareDefenses();
    }
    
    /**
     * Calculates derived defense values like Dodge, Parry, and Block.
     * @private
     */
    _prepareDefenses() {
        const system = this.system;
        const characteristics = system.characteristics;

        // Calculate Dodge (Basic Speed + modifiers, floored)
        // For now, no specific advantages are modeled, so it's just Basic Speed.
        characteristics.defenses.dodge = Math.floor(characteristics.basicSpeed.final);

        // Find skills that provide Parry and Block values
        const parryOptions = [];
        const blockOptions = [];

        for (const item of this.items) {
            if (item.type === 'skill') {
                const skillName = item.name.toLowerCase();
                const skillLevel = parseInt(item.system.level, 10);
                if (isNaN(skillLevel)) continue;

                // GURPS formula: Parry = 3 + (Skill / 2)
                if (skillName.includes('lightsaber') || skillName.includes('sword') || skillName.includes('staff')) {
                    parryOptions.push({
                        id: item.id,
                        name: item.name,
                        value: Math.floor(skillLevel / 2) + 3
                    });
                }
                // GURPS formula: Block = 3 + (Skill / 2)
                if (skillName.includes('shield') || skillName.includes('cloak')) {
                     blockOptions.push({
                        id: item.id,
                        name: item.name,
                        value: Math.floor(skillLevel / 2) + 3
                    });
                }
            }
        }
        
        // Set the available options for the dropdowns on the sheet
        system.parryOptions = parryOptions;
        system.blockOptions = blockOptions;

        // Determine the final Parry and Block scores
        // If an active skill is selected, use its value. Otherwise, default to 0.
        const activeParry = parryOptions.find(p => p.id === system.activeParrySkillId);
        characteristics.defenses.parry = activeParry ? activeParry.value : (parryOptions[0]?.value || 0);
        
        const activeBlock = blockOptions.find(b => b.id === system.activeBlockSkillId);
        characteristics.defenses.block = activeBlock ? activeBlock.value : (blockOptions[0]?.value || 0);
    }


    /**
     * Rolls a 3d6 check against a target number and outputs to chat.
     * @param {string} label - The label for the roll (e.g., "Strength Check").
     * @param {number} targetNumber - The number to roll against.
     * @param {number} [modifier=0] - A situational modifier for the roll.
     */
    async rollCheck(label, targetNumber, modifier = 0) {
        if (targetNumber === undefined || targetNumber === null) {
            ui.notifications.warn(`Cannot roll for "${label}" as it has no target number.`);
            return;
        }
        const finalTarget = Number(targetNumber) + modifier;
        const roll = await new Roll("3d6").roll({ async: true });
        const total = roll.total;

        let resultText = "";
        let cssClass = "";

        // Determine success/failure and criticals based on GURPS rules.
        if (total <= 4) {
            resultText = `Critical Success! (Margin: ${Math.abs(finalTarget - total)})`;
            cssClass = "critical-success";
        } else if (total >= 17) {
            resultText = `Critical Failure! (Margin: ${Math.abs(finalTarget - total)})`;
            cssClass = "critical-failure";
        } else if (total <= finalTarget) {
            resultText = `Success! (Margin: ${finalTarget - total})`;
            cssClass = "success";
        } else {
            resultText = `Failure! (Margin: ${total - finalTarget})`;
            cssClass = "failure";
        }

        const content = `
            <div class="shadowbase-roll">
                <h3 class="roll-label">${label}</h3>
                <div class="roll-result ${cssClass}">${resultText}</div>
                <div class="roll-dice">Rolled ${total} vs ${finalTarget}</div>
            </div>
        `;

        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            content: content,
            roll: roll,
            type: CONST.CHAT_MESSAGE_TYPES.ROLL
        });
    }

    /**
     * Rolls damage based on a GURPS-style damage string (e.g., "2d6+1") and outputs to chat.
     * @param {string} label - The label for the damage roll (e.g., "Blaster Rifle").
     * @param {string} damageFormula - The damage formula string.
     */
    async rollDamage(label, damageFormula) {
        if (!damageFormula || typeof damageFormula !== 'string') return;

        // Sanitize formula to ensure it's a valid dice expression.
        const rollExpression = damageFormula.replace(/cr|cut|imp|pi[+-]*|burn|tox|fat/gi, '').trim();
        try {
            const roll = await new Roll(rollExpression).roll({ async: true });

            const content = `
                <div class="shadowbase-roll">
                    <h3 class="roll-label">${label}</h3>
                    <div class="roll-result damage">${roll.total}</div>
                </div>
            `;
            
            ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor: this }),
                content: content,
                roll: roll,
                type: CONST.CHAT_MESSAGE_TYPES.ROLL
            });
        } catch(err) {
            ui.notifications.error(`Invalid damage formula for ${label}: "${damageFormula}"`);
            console.error(`Invalid damage formula for ${label}:`, err);
        }
    }
}