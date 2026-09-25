// systems\shadowbase\scripts\constants.js

export const GURPS_DAMAGE_TABLE = {
    1: { thrust: "1d-6", swing: "1d-5" }, 2: { thrust: "1d-6", swing: "1d-5" },
    3: { thrust: "1d-5", swing: "1d-4" }, 4: { thrust: "1d-5", swing: "1d-4" },
    5: { thrust: "1d-4", swing: "1d-3" }, 6: { thrust: "1d-4", swing: "1d-3" },
    7: { thrust: "1d-3", swing: "1d-2" }, 8: { thrust: "1d-3", swing: "1d-2" },
    9: { thrust: "1d-2", swing: "1d-1" }, 10: { thrust: "1d-2", swing: "1d" },
    11: { thrust: "1d-1", swing: "1d+1" }, 12: { thrust: "1d-1", swing: "1d+2" },
    13: { thrust: "1d", swing: "2d-1" }, 14: { thrust: "1d", swing: "2d" },
    15: { thrust: "1d+1", swing: "2d+1" }, 16: { thrust: "1d+1", swing: "2d+2" },
    17: { thrust: "1d+2", swing: "3d-1" }, 18: { thrust: "1d+2", swing: "3d" },
    19: { thrust: "2d-1", swing: "3d+1" }, 20: { thrust: "2d-1", swing: "3d+2" },
    21: { thrust: "2d", swing: "4d-1" }, 22: { thrust: "2d", swing: "4d" },
    23: { thrust: "2d+1", swing: "4d+1" }, 24: { thrust: "2d+1", swing: "4d+2" },
    25: { thrust: "2d+2", swing: "5d-1" }, 26: { thrust: "2d+2", swing: "5d" },
    27: { thrust: "3d-1", swing: "5d+1" }, 28: { thrust: "3d-1", swing: "5d+1" },
    29: { thrust: "3d", swing: "5d+2" }, 30: { thrust: "3d", swing: "5d+2" },
    31: { thrust: "3d+1", swing: "6d-1" }, 32: { thrust: "3d+1", swing: "6d-1" },
    33: { thrust: "3d+2", swing: "6d" }, 34: { thrust: "3d+2", swing: "6d" },
    35: { thrust: "4d-1", swing: "6d+1" }, 36: { thrust: "4d-1", swing: "6d+1" },
    37: { thrust: "4d", swing: "6d+2" }, 38: { thrust: "4d", swing: "6d+2" },
    39: { thrust: "4d+1", swing: "7d-1" }, 40: { thrust: "4d+1", swing: "7d-1" },
    45: { thrust: "5d", swing: "7d+1" }, 50: { thrust: "5d+2", swing: "8d-1" },
    55: { thrust: "6d", swing: "8d+1" }, 60: { thrust: "7d-1", swing: "9d" },
    65: { thrust: "7d+1", swing: "9d+2" }, 70: { thrust: "8d", swing: "10d" },
    75: { thrust: "8d+2", swing: "10d+2" }, 80: { thrust: "9d", swing: "11d" },
    85: { thrust: "9d+2", swing: "11d+2" }, 90: { thrust: "10d", swing: "12d" },
    95: { thrust: "10d+2", swing: "12d+2" }, 100: { thrust: "11d", swing: "13d" }
};

export const SKILL_POINT_COST_TABLE = {
  E: { "-1": 0, "0": 1, "1": 2, "2": 3, "3": 4 },
  A: { "-1": 1, "0": 2, "1": 3, "2": 4, "3": 6 },
  H: { "-1": 2, "0": 4, "1": 6, "2": 8, "3": 10 },
  VH: { "-1": 4, "0": 6, "1": 8, "2": 10, "3": 12 },
};

export const SKILL_COST_BEYOND_PLUS_3 = 3;

export const GURPS_ATTRIBUTE_MAP = {
    'ST': 'strength', 'DX': 'dexterity', 'IQ': 'iq', 'HT': 'health',
    'WILL': 'will', 'PER': 'perception'
};

export const GURPS_DIFFICULTY_MAP = {
    'E': 'E', 'A': 'A', 'H': 'H', 'VH': 'VH'
};

export function parseSkillAttribute(skillString) {
    let attribute = null;
    let specialization = null;
    let modifier = null;

    // Find attribute (ST, DX, IQ, HT, Will, Per, Strength, Dexterity, Intelligence, Health, Perception)
    const attributeMatch = skillString.match(/(ST|DX|IQ|HT|Will|Per|Strength|Dexterity|Intelligence|Health|Perception)/i);
    if (attributeMatch) {
        attribute = attributeMatch[0].toLowerCase();
        skillString = skillString.replace(attributeMatch[0], '').trim();
    }

    // Find specialization (anything after /)
    const specializationMatch = skillString.match(/\/(.+)/);
    if (specializationMatch) {
        specialization = specializationMatch[1].trim();
        skillString = skillString.replace(specializationMatch[0], '').trim();
    }

    // Find modifier (+/- followed by digits)
    const modifierMatch = skillString.match(/([+-]\d+)/);
    if (modifierMatch) {
        modifier = parseInt(modifierMatch[0], 10);
    }

    return { attribute, specialization, modifier };
}

export function parseSkillDifficulty(skillString) {
    const difficultyMatch = skillString.match(/(Easy|Average|Hard|Very Hard|E|A|H|VH)/i);
    if (difficultyMatch) {
        return difficultyMatch[0].charAt(0).toUpperCase();
    }
    return null;
}
