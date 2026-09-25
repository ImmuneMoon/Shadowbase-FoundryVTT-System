// module/apps/roll-dialog.mjs
//
// The roll prompt (docs/ARCHITECTURE.md §6.3): the website's RollButton
// popover (roll-button.tsx:210-341) as a DialogV2 form - the label, the base
// target (read-only), a situational modifier, the Off-Hand toggle when the
// character is dual wielding, and Foundry's roll-mode chooser (ASSUMPTION Q14
// c). Enter rolls. The dialog decides NOTHING about the target: it hands back
// `{ modifier, offHand, rollMode }` and module/rolls.mjs stacks them
// (roll-button.tsx:127 is the one stacking rule).
//
// DialogV2 is resolved late (foundry.applications.api.DialogV2) so the module
// loads headlessly: tools/foundry-shim.mjs declares no applications API, and a
// caller that passes the modifier itself never opens the dialog.

const SYSTEM_ID = 'shadowbase';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** foundry.applications.api.DialogV2 when the client has it, else null (headless). */
export function dialogClass() {
  const apps = globalThis.foundry?.applications;
  const api = apps && ('api' in apps) ? apps.api : null;
  return api?.DialogV2 ?? null;
}

/**
 * Foundry's roll modes, read from CONFIG.Dice.rollModes - the same source its own
 * chooser uses, so the labels match the running version. v14 changed both the shape
 * ({ publicroll: { label, icon } } vs v13's { publicroll: 'CHAT.RollPublic' }) and the
 * label keys (CHAT.MODES.public vs CHAT.RollPublic); reading the live config is right
 * on both, where the old hardcoded 'CHAT.RollPublic' rendered as a raw key on v14.
 */
export function rollModeOptions() {
  // v14: CONFIG.ChatMessage.modes { public:{label,icon}, gm, blind, self, ic }.
  const v14 = globalThis.CONFIG?.ChatMessage?.modes;
  if (v14 && typeof v14 === 'object') {
    const order = ['public', 'gm', 'blind', 'self'].filter((k) => k in v14); // roll-visibility modes, not 'ic'
    if (order.length) return order.map((k) => ({ value: k, label: loc(typeof v14[k] === 'string' ? v14[k] : (v14[k]?.label ?? k)) }));
  }
  // v13: CONFIG.Dice.rollModes { publicroll:'CHAT.RollPublic', ... } (only reached on pre-v14 core).
  const v13 = globalThis.CONFIG?.Dice?.rollModes;
  if (v13 && typeof v13 === 'object' && Object.keys(v13).length) {
    return Object.entries(v13).map(([value, v]) => ({ value, label: loc(typeof v === 'string' ? v : (v?.label ?? value)) }));
  }
  // Headless / no CONFIG: v14 keys and label ids.
  return [
    { value: 'public', label: loc('CHAT.MODES.public') },
    { value: 'gm', label: loc('CHAT.MODES.gm') },
    { value: 'blind', label: loc('CHAT.MODES.blind') },
    { value: 'self', label: loc('CHAT.MODES.self') },
  ];
}

/** The form's HTML (a plain string; DialogV2 takes content as HTML). */
export function renderPromptContent({ label, target, damage, dualWielding = false, defaultOffHand = false, rollMode, malfunctionThreshold = null, shots = 1 }) {
  const modeOptions = rollModeOptions().map((o) => `<option value="${esc(o.value)}"${o.value === rollMode ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  const baseLine = target !== null && target !== undefined
    ? `<p class="sb-roll-dialog__base">${esc(fmt('SHADOWBASE.Roll.BaseTarget', { target }))}${shots > 1 ? ` · ${esc(fmt('SHADOWBASE.Roll.VolleyShots', { shots }))}` : ''}</p>`
    : `<p class="sb-roll-dialog__base">${esc(fmt('SHADOWBASE.Roll.BaseDamage', { formula: damage ?? '' }))}</p>`;
  const malfLine = malfunctionThreshold != null && malfunctionThreshold < 17
    ? `<p class="sb-roll-dialog__malf">${esc(fmt('SHADOWBASE.Roll.DamagedUnit', { malf: malfunctionThreshold }))}</p>`
    : '';
  const offHand = dualWielding
    ? `<div class="form-group"><label for="sb-roll-offhand">${esc(loc('SHADOWBASE.Roll.OffHandAction'))}</label><input type="checkbox" id="sb-roll-offhand" name="offHand"${defaultOffHand ? ' checked' : ''}></div>`
    : '';
  return `
<div class="shadowbase sb-roll-dialog">
  <h4 class="sb-roll-dialog__label">${esc(label)}</h4>
  ${baseLine}
  ${malfLine}
  <div class="form-group">
    <label for="sb-roll-modifier">${esc(loc('SHADOWBASE.Roll.SituationalModifier'))}</label>
    <input type="number" id="sb-roll-modifier" name="modifier" value="0" step="1" autofocus>
  </div>
  ${offHand}
  <div class="form-group">
    <label for="sb-roll-mode">${esc(loc('SHADOWBASE.Roll.RollMode'))}</label>
    <select id="sb-roll-mode" name="rollMode">${modeOptions}</select>
  </div>
</div>`;
}

/** Read the answer off the dialog's form element. */
export function readPromptForm(form) {
  const el = form?.elements ?? form ?? {};
  const modifier = parseInt(el.modifier?.value ?? '0', 10);
  return {
    modifier: Number.isNaN(modifier) ? 0 : modifier,
    offHand: !!(el.offHand && el.offHand.checked),
    rollMode: el.rollMode?.value || undefined,
  };
}

export class RollDialog {
  /**
   * Ask the player for the situational modifier, the off-hand toggle and the
   * roll mode. Resolves `{ modifier, offHand, rollMode }` or null when closed.
   * @param {{ label: string, target?: number|null, damage?: string|null, dualWielding?: boolean, defaultOffHand?: boolean, rollMode?: string, malfunctionThreshold?: number|null, shots?: number }} spec
   */
  static async prompt(spec) {
    const DialogV2 = dialogClass();
    if (!DialogV2) throw new Error('shadowbase RollDialog: foundry.applications.api.DialogV2 is not available (pass an explicit modifier to roll without the prompt)');
    let defaultMode = spec.rollMode;
    if (!defaultMode) {
      // v14 setting is core.messageMode (public/gm/blind/self); v13 was core.rollMode (…roll).
      try { defaultMode = game.settings.get('core', 'messageMode'); } catch { /* pre-v14 */ }
      if (!defaultMode) { try { defaultMode = game.settings.get('core', 'rollMode'); } catch { defaultMode = 'public'; } }
    }
    const content = renderPromptContent({ ...spec, rollMode: defaultMode });
    const answer = await DialogV2.wait({
      window: { title: fmt('SHADOWBASE.Roll.DialogTitle', { label: spec.label }), icon: 'fa-solid fa-dice' },
      classes: [SYSTEM_ID, 'sb-roll-dialog-window'],
      content,
      buttons: [
        { action: 'roll', label: loc('SHADOWBASE.Roll.RollButton'), icon: 'fa-solid fa-dice', default: true, callback: (event, button) => readPromptForm(button.form) },
        { action: 'cancel', label: loc('Cancel'), icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
      render: (event, dialog) => {
        // Enter rolls: the number input submits the default button.
        const input = (dialog.element ?? dialog)?.querySelector?.('input[name="modifier"]');
        input?.addEventListener?.('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); (dialog.element ?? dialog).querySelector?.('button[data-action="roll"]')?.click(); } });
        input?.focus?.();
      },
    });
    return answer && typeof answer === 'object' ? answer : null;
  }
}

/** The entry point module/rolls.mjs uses. */
export function promptRoll(spec) {
  return RollDialog.prompt(spec);
}

export default RollDialog;
