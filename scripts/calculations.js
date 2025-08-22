// systems\shadowbase\scripts\calculations.js
import { GURPS_DAMAGE_TABLE, SKILL_POINT_COST_TABLE, SKILL_COST_BEYOND_PLUS_3, GURPS_ATTRIBUTE_MAP, GURPS_DIFFICULTY_MAP, parseSkillAttribute, parseSkillDifficulty } from './constants.js';

function getDamageValues(st) {
    if (st <= 0) return { thrust: "0d", swing: "0d" };
    const entry = GURPS_DAMAGE_TABLE[st] || GURPS_DAMAGE_TABLE[Object.keys(GURPS_DAMAGE_TABLE).filter(k => k <= st).pop()];
    return entry || { thrust: "N/A", swing: "N/A" };
}

function calculateSkillCost(skill, attributes) {
    if (!skill.level || !skill.relativeLevel) return 0;
    
    const relLvlStr = String(skill.relativeLevel).replace(/[()]/g, '');
    let attrAbbr = 'IQ'; // Default attribute
    let modifier = 0;

    const attributeParseResult = parseSkillAttribute(relLvlStr);
    if (attributeParseResult && attributeParseResult.attribute) {
 attrAbbr = attributeParseResult.attribute.toUpperCase();
 modifier = attributeParseResult.modifier || 0;
    }
    
    const diffAbbr = parseSkillDifficulty(relLvlStr) || 'A'; // Provide a default if parsing returns null
    const attrName = GURPS_ATTRIBUTE_MAP[attrAbbr];
    const diffKey = GURPS_DIFFICULTY_MAP[diffAbbr];

    if (!attrName || !diffKey) return 0;
    
    const attrValue = attributes[attrName]?.value || 10;
    const targetLevel = parseInt(skill.level, 10);
    if (isNaN(targetLevel)) return 0;

    const relativeLevel = targetLevel - (attrValue + modifier);

    const costTable = SKILL_POINT_COST_TABLE[diffKey];
    if (costTable[relativeLevel] !== undefined) {
        return costTable[relativeLevel];
    }
    if (relativeLevel > 3) {
        return costTable[3] + (relativeLevel - 3) * SKILL_COST_BEYOND_PLUS_3;
    }
    return 0;
}

/**
 * Main calculation function. It now accepts items to correctly calculate dependencies.
 * @param {object} system - The actor's system data.
 * @param {Array} items - The actor's items.
 */
export function calculateStats(system, items) {
    // Extract base attributes
    const ST = system.attributes.strength.value || 10;
    const DX = system.attributes.dexterity.value || 10;
    const IQ = system.attributes.iq.value || 10;
    const HT = system.attributes.health.value || 10;

    // Get advantages and disadvantages from items
    const advantages = items.filter(i => i.type === 'advantage').map(i => i.system);
    const disadvantages = items.filter(i => i.type === 'disadvantage').map(i => i.system);
    const quirks = items.filter(i => i.type === 'quirk').map(i => i.system);
    const skills = items.filter(i => i.type === 'skill').map(i => i.system);

    // Calculate derived characteristics from base attributes
    const baseHitPoints = ST;
    const baseWill = IQ;
    const basePerception = IQ;
    const baseEndurance = HT;
    const baseBasicSpeed = (HT + DX) / 4;
    const baseBasicMove = Math.floor(baseBasicSpeed);

    // Get final values, considering overrides
    const finalHitPoints = system.characteristics.hitPoints.final || baseHitPoints;
    const finalWill = system.characteristics.will.final || baseWill;
    const finalPerception = system.characteristics.perception.final || basePerception;
    const finalEndurance = system.characteristics.endurancePoints.final || baseEndurance;
    const finalBasicSpeed = system.characteristics.basicSpeed.final || baseBasicSpeed;
    const finalBasicMove = system.characteristics.basicMove.final || baseBasicMove;
    const finalFP = system.characteristics.forcePoints.final || finalWill;
    const finalFrightCheck = system.characteristics.frightCheck.final || finalWill;

    // Calculate Point Costs
    let points = {
        attributes: (ST - 10) * 10 + (DX - 10) * 20 + (IQ - 10) * 20 + (HT - 10) * 10,
        secondary: (finalHitPoints - baseHitPoints) * 2 + (finalEndurance - baseEndurance) * 3 +
                   (finalWill - baseWill) * 5 + (finalPerception - basePerception) * 5 +
                   (finalFP - baseWill) * 3 + (finalBasicSpeed - baseBasicSpeed) * 20 +
                   (finalBasicMove - baseBasicMove) * 5 + (finalFrightCheck - finalWill) * 2,
        advantages: advantages.reduce((sum, adv) => sum + (adv.points || 0), 0),
        disadvantages: disadvantages.reduce((sum, dis) => sum + (dis.points || 0), 0),
        quirks: quirks.reduce((sum, q) => sum + (q.points || 0), 0),
        skills: skills.reduce((sum, skill) => sum + calculateSkillCost(skill, system.attributes), 0)
    };

    const totalSpent = Object.values(points).reduce((sum, val) => sum + val, 0);

    // Combat Stats
    const damage = getDamageValues(ST);

    return {
        characteristics: {
            ...system.characteristics,
            hitPoints: { base: baseHitPoints, final: finalHitPoints, max: finalHitPoints, value: finalHitPoints, current: system.characteristics.hitPoints.current ?? finalHitPoints },
            will: { base: baseWill, final: finalWill, value: finalWill },
            perception: { base: basePerception, final: finalPerception, value: finalPerception },
            endurancePoints: { base: baseEndurance, final: finalEndurance, max: finalEndurance, value: finalEndurance, current: system.characteristics.endurancePoints.current ?? finalEndurance },
            forcePoints: { base: baseWill, final: finalFP, max: finalFP, value: finalFP, current: system.characteristics.forcePoints.current ?? finalFP },
            frightCheck: { base: baseWill, final: finalFrightCheck, value: finalFrightCheck },
            basicSpeed: { base: baseBasicSpeed, final: finalBasicSpeed, value: finalBasicSpeed },
            basicMove: { base: baseBasicMove, final: finalBasicMove, value: finalBasicMove },
            damage: { thrust: damage.thrust, swing: damage.swing },
            basicLift: `${((ST * ST) / 5).toFixed(2)} lbs`
        },
        points: {
            total: system.points.total,
            spent: totalSpent,
            remaining: system.points.total - totalSpent,
        }
    };
}
