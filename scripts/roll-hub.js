
// systems\shadowbase\scripts\roll-hub.js

/**
 * A dialog for making quick rolls for any character stat or skill.
 */
export class RollHub extends FormApplication {
    constructor(actor, options = {}) {
        super(actor, options);
        this.actor = actor;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: "Quick Roll Hub",
            id: "shadowbase-roll-hub",
            template: "systems/shadowbase/templates/partials/roll-hub-dialog.hbs",
            width: 400,
            height: "auto",
            classes: ["shadowbase", "dialog"],
        });
    }

    getData() {
        const data = super.getData();
        data.actor = this.actor;
        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('.rollable').on('click', this._onRoll.bind(this));
    }

    _onRoll(event) {
        event.preventDefault();
        const element = event.currentTarget;
        const { rollType, rollKey, rollLabel, rollFormula } = element.dataset;
        const modifier = parseInt(this.element.find('[name="roll-modifier"]').val()) || 0;

        if (rollType === 'attribute') {
            const target = this.actor.system.attributes[rollKey]?.value;
            if(target !== undefined) this.actor.rollCheck(rollLabel, target, modifier);
        }
        else if (rollType === 'characteristic') {
            const target = this.actor.system.characteristics[rollKey]?.final;
            if(target !== undefined) this.actor.rollCheck(rollLabel, target, modifier);
        }
        else if (rollType === 'skill') {
            const skill = this.actor.items.get(rollKey);
            if(skill) this.actor.rollCheck(skill.name, skill.system.level, modifier);
        }
        else if (rollType === 'damage') {
            if(rollFormula) this.actor.rollDamage(rollLabel, rollFormula);
        }
    }
}
