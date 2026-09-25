// module/damage.mjs
//
// The Tactical Damage Processor (docs/ARCHITECTURE.md §5.3): the arithmetic of
// the website's hit-location-section.tsx, ported line for line and cited by
// line. Two halves, kept apart the way the component keeps them:
//
//   assessDamage   the useMemo at hit-location-section.tsx:78-175 - DR at the
//                  location (typed DR by damage type, the shock / sonic
//                  bypasses, the ion split), the penetrating base, the wounding
//                  multiplier (type, then the anatomical overrides), the major
//                  wound and the crippling / severing thresholds. PURE.
//   applyDamage    handleProcessDamage at :177-357 - HP or EP written, the
//                  covering armor's drEntries degraded, the Shock effect and
//                  the Trauma Protocol leak stored as ActiveEffects through
//                  module/effects.mjs, crippling flagged on the hit-location
//                  row, and every HT roll the chapter asks for returned as a
//                  PROMPT - never rolled here (§5.3).
//
// The damage-type table (DAMAGE_TYPES) is the component's own picker table
// (:38-57): the wounding multipliers Ch7 prints, which the bundle does not
// export (they live in the component). It is copied here with the labels
// turned into i18n keys, and check:rolls pins every multiplier against the
// chapter's figure named in ARCHITECTURE.md §5.3.
//
// One rule the website's processor does not have: an armor divisor. Ch7's
// "div (Armor Divisor): Divides target's DR by (2), (3), (5), or (10)" is
// applied to the location's DR before the subtraction, rounding down (the
// nearest printed rounding is Ch7's Armor Piercing critical effect, "DR
// protects at half value (round down)") - ASSUMPTION, logged in
// docs/REQUESTS.md; omit the parameter and nothing changes.

import { engine } from './engine.mjs';
import { rowsOf, rowWithDerived } from './adapter.mjs';
import { effects } from './effects.mjs';
import { postNotice } from './rolls.mjs';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };

/**
 * The picker's damage types with their wounding multipliers
 * (hit-location-section.tsx:38-57). `label` is an i18n key.
 */
export const DAMAGE_TYPES = Object.freeze([
  { value: 'cr', label: 'SHADOWBASE.Damage.Type.cr', mult: 1 },
  { value: 'cut', label: 'SHADOWBASE.Damage.Type.cut', mult: 1.5 },
  { value: 'imp', label: 'SHADOWBASE.Damage.Type.imp', mult: 2 },
  { value: 'pi-', label: 'SHADOWBASE.Damage.Type.pi-', mult: 0.5 },
  { value: 'pi', label: 'SHADOWBASE.Damage.Type.pi', mult: 1 },
  { value: 'pi+', label: 'SHADOWBASE.Damage.Type.pi+', mult: 1.5 },
  { value: 'pi++', label: 'SHADOWBASE.Damage.Type.pi++', mult: 2 },
  { value: 'burn', label: 'SHADOWBASE.Damage.Type.burn', mult: 1 },
  { value: 'cor', label: 'SHADOWBASE.Damage.Type.cor', mult: 1 },
  { value: 'tox', label: 'SHADOWBASE.Damage.Type.tox', mult: 1 },
  { value: 'cold', label: 'SHADOWBASE.Damage.Type.cold', mult: 1 },
  { value: 'sonic', label: 'SHADOWBASE.Damage.Type.sonic', mult: 1 },
  { value: 'ion', label: 'SHADOWBASE.Damage.Type.ion', mult: 1 },
  { value: 'shock', label: 'SHADOWBASE.Damage.Type.shock', mult: 1 },
  { value: 'stun', label: 'SHADOWBASE.Damage.Type.stun', mult: 1 },
  { value: 'energy', label: 'SHADOWBASE.Damage.Type.energy', mult: 1 },
  { value: 'spec', label: 'SHADOWBASE.Damage.Type.spec', mult: 1 },
  { value: 'sub', label: 'SHADOWBASE.Damage.Type.sub', mult: 1 },
]);

/** The condition ladder the armor degradation steps along (hit-location-section.tsx:234). */
const CONDITION_STATES = Object.freeze(['Fine', 'Damaged', 'Broken', 'Destroyed']);

/** The engine's dynamic hit locations for the actor (stats.dynamicHitLocations). */
export function locationsOf(actor) {
  return actor.stats?.dynamicHitLocations ?? actor.system?.derived?.dynamicHitLocations ?? [];
}

/** One location by id, or null. */
export function locationOf(actor, locationId) {
  return locationsOf(actor).find((l) => l.id === locationId) ?? null;
}

/** Endurance damage: cold, stun, and ion against an organic part go to EP (hit-location-section.tsx:185, 222). */
export function isEnduranceDamage(damageType, location) {
  return damageType === 'cold' || damageType === 'stun' || (damageType === 'ion' && !!location?.isOrganic);
}

/**
 * The assessment (hit-location-section.tsx:78-175), pure.
 * @param {object} actor
 * @param {{ locationId: string, amount: number, damageType: string, isExplosive?: boolean, armorDivisor?: number|null }} input
 * @returns {null|{ location: object, drApplied: number, penetratingBase: number, multiplier: number, finalInjury: number, isMajorWound: boolean, isCrippling: boolean, isSevering: boolean, notes: string[], endurance: boolean, maxHP: number }}
 */
export function assessDamage(actor, { locationId, amount, damageType, isExplosive = false, armorDivisor = null }) {
  const location = locationOf(actor, locationId);
  if (!location) return null;
  const damageInput = Math.max(0, Math.floor(Number(amount) || 0));
  const stats = actor.stats ?? actor.system?.derived;
  const isDroid = !!actor.system?.isDroid;
  const notes = [];

  // Ch13's typed DR, applied (:90-94): resolveTypedDR owns the damage-type join.
  const typed = engine.typedResistance.resolveTypedDR(location.totalDR, location.typedDR, { damageType, isExplosive });
  let baseDR = typed.dr;
  if (typed.applied.length) notes.push(fmt('SHADOWBASE.Damage.Note.TypedDR', { bonus: typed.applied.reduce((s, t) => s + t.bonus, 0), vs: typed.applied.map((t) => t.vs).join(', ') }));

  // Ch7's armor divisor (see the header): DR / N, round down. Not in the website's processor.
  const divisor = Number(armorDivisor);
  if (Number.isFinite(divisor) && divisor > 1) {
    baseDR = Math.floor(baseDR / divisor);
    notes.push(fmt('SHADOWBASE.Damage.Note.ArmorDivisor', { divisor, dr: baseDR }));
  }

  // Shock bypasses conductive (non-organic) armor (:96-100); sonic ignores non-sealed DR (:102-106).
  if (damageType === 'shock' && !location.isOrganic) { baseDR = 0; notes.length = 0; notes.push(loc('SHADOWBASE.Damage.Note.ConductiveBypass')); }
  if (damageType === 'sonic') { baseDR = 0; notes.length = 0; notes.push(loc('SHADOWBASE.Damage.Note.AcousticBypass')); }

  const maxHP = stats?.currentValues?.hitPoints || 10;

  // Ion (:108-124): x0.5 to EP on an organic part, x1 electronic disruption otherwise.
  if (damageType === 'ion' && location.isOrganic) {
    const penetratingBase = Math.max(0, damageInput - baseDR);
    return {
      location, drApplied: baseDR, penetratingBase, multiplier: 0.5,
      finalInjury: Math.floor(penetratingBase * 0.5),
      isMajorWound: false, isCrippling: false, isSevering: false,
      notes: [loc('SHADOWBASE.Damage.Note.IonBio')], endurance: true, maxHP,
    };
  }
  if (damageType === 'ion') notes.push(loc('SHADOWBASE.Damage.Note.IonElectronic'));

  const penetratingBase = Math.max(0, damageInput - baseDR);
  let multiplier = DAMAGE_TYPES.find((t) => t.value === damageType)?.mult || 1;

  // Anatomical multipliers (:131-145): head x4 organic / x2 droid processor; vitals x3 vs imp and pi.
  if (location.type === 'Head' || location.type === 'Processor') {
    if (isDroid || !location.isOrganic) { multiplier = 2; notes.push(loc('SHADOWBASE.Damage.Note.Processor')); }
    else { multiplier = 4; notes.push(loc('SHADOWBASE.Damage.Note.Skull')); }
  } else if (location.type === 'Vitals' || location.type === 'Upper Torso') {
    if (damageType === 'imp' || String(damageType).startsWith('pi')) { multiplier = 3; notes.push(loc('SHADOWBASE.Damage.Note.Vitals')); }
  }

  const finalInjury = Math.floor(penetratingBase * multiplier);
  const isMajorWound = finalInjury >= maxHP / 2;
  // Only a location with a real Ch7 threshold can cripple or sever (:151-161).
  const cThresh = location.cripplingThreshold;
  const canCripple = typeof cThresh === 'number' && Number.isFinite(cThresh) && cThresh > 0;
  const isCrippling = canCripple && finalInjury > cThresh;
  const isSevering = canCripple && (damageType === 'cut' || isExplosive) && finalInjury >= cThresh * 2;

  return { location, drApplied: baseDR, penetratingBase, multiplier, finalInjury, isMajorWound, isCrippling, isSevering, notes, endurance: isEnduranceDamage(damageType, location), maxHP };
}

/** The resolved current pool (null means full: module/data/actor-character.mjs resources). */
function poolValue(actor, key, field) {
  const v = actor.system?.resources?.[key]?.value;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const raw = actor.system?.[field];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 10;
}

/**
 * Apply damage (hit-location-section.tsx handleProcessDamage, 177-357). The
 * returned ledger lists every write and every prompt; `post` puts the same on
 * a chat notice.
 * @param {object} actor
 * @param {{ locationId: string, amount: number, damageType: string, isExplosive?: boolean, isLightsaber?: boolean, armorDivisor?: number|null, post?: boolean }} input
 */
export async function applyDamage(actor, { locationId, amount, damageType, isExplosive = false, isLightsaber = false, armorDivisor = null, post = true }) {
  const assessment = assessDamage(actor, { locationId, amount, damageType, isExplosive, armorDivisor });
  if (!assessment) { notify('warn', loc('SHADOWBASE.Damage.NoLocation')); return null; }
  const { location, finalInjury, isMajorWound, isCrippling, isSevering } = assessment;
  const damageInput = Math.max(0, Math.floor(Number(amount) || 0));
  const isCharacterOrganic = !actor.system?.isDroid;
  const ledger = { assessment, hp: null, ep: null, armor: [], effects: [], location: null, prompts: [], notices: [], skipped: false };
  const prompt = (key, data) => { const text = fmt(key, data); ledger.prompts.push({ key, text }); return text; };
  const note = (key, data) => { const text = fmt(key, data); ledger.notices.push({ key, text }); return text; };

  const isEndDamage = assessment.endurance;
  // 1. Apply damage by type (:184-219).
  if (isEndDamage) {
    const before = poolValue(actor, 'ep', 'currentEndurancePoints');
    const after = Math.max(0, before - finalInjury);
    await actor.update({ 'system.currentEndurancePoints': after });
    ledger.ep = { before, after, lost: finalInjury };
    if (damageType === 'ion') note('SHADOWBASE.Damage.Prompt.NeuralInterference', { ep: finalInjury });
    else { note('SHADOWBASE.Damage.Prompt.EnduranceDrained', { ep: finalInjury }); if (damageType === 'stun') prompt('SHADOWBASE.Damage.Prompt.StunCheck'); }
  } else if (damageType === 'tox' && !location.isOrganic) {
    note('SHADOWBASE.Damage.Prompt.InertTarget');
    ledger.skipped = true;
    if (post) await postLedger(actor, ledger);
    return ledger;
  } else {
    const before = poolValue(actor, 'hp', 'currentHitPoints');
    const after = before - finalInjury;
    await actor.update({ 'system.currentHitPoints': after });
    ledger.hp = { before, after, lost: finalInjury };
    if (damageType === 'shock' && finalInjury > 0) prompt('SHADOWBASE.Damage.Prompt.ShockBreach', { n: finalInjury });
    if (damageType === 'sonic' && finalInjury > 0) prompt('SHADOWBASE.Damage.Prompt.AcousticShock', { n: finalInjury });
    if (damageType === 'ion' && !location.isOrganic && finalInjury > 0) note('SHADOWBASE.Damage.Prompt.SystemsOffline', { n: finalInjury });
  }

  // 2. Armor degradation (:221-282): the equipped pieces covering the location.
  if (finalInjury > 0 && damageInput > 0 && !isEndDamage) {
    let armorModified = false;
    for (const item of rowsOf(actor, 'armor')) {
      const row = rowWithDerived(item);
      if (!row.equipped || !row.coveredLocationIds?.includes(location.id)) continue;
      // An inactive shield neither blocks nor takes the hit (:230-231).
      if (row.type === 'Energy Shield' && !row.isActive) continue;
      let condition = row.condition || 'Fine';
      const updates = {};
      let changed = false;
      if (condition === 'Broken') {
        updates.condition = 'Destroyed';
        ledger.armor.push({ itemId: item.id, name: item.displayName ?? item.name, updates });
        armorModified = true;
        await item.updateRow(updates);
        continue;
      }
      if (row.type === 'Clothing') {
        const durThreshold = row.durability ?? 10;
        if (damageInput > durThreshold) {
          changed = true;
          const i = CONDITION_STATES.indexOf(condition);
          if (i < 3) condition = CONDITION_STATES[i + 1];
        }
      } else {
        const entries = [...(row.drEntries || [])];
        const idx = entries.findIndex((e) => e?.locationId === location.id);
        if (idx > -1) {
          const currentDrAtLoc = entries[idx].dr;
          if (damageInput > currentDrAtLoc && finalInjury > 0) {
            changed = true;
            const newDr = Math.max(0, currentDrAtLoc - 1);
            entries[idx] = { ...entries[idx], dr: newDr };
            // `?? 0`, not `|| 1`: DR 0 is a real listed value (:258-262).
            if (condition === 'Fine' && newDr < (row.baseDRValue ?? 0)) condition = 'Damaged';
            if (newDr === 0) condition = 'Broken';
            updates.drEntries = entries;
          }
        }
      }
      if (isMajorWound) {
        changed = true;
        const i = CONDITION_STATES.indexOf(condition);
        if (i < 3) condition = CONDITION_STATES[i + 1];
      }
      if (changed) {
        updates.condition = condition;
        ledger.armor.push({ itemId: item.id, name: item.displayName ?? item.name, updates });
        armorModified = true;
        await item.updateRow(updates);
      }
    }
    if (armorModified) note('SHADOWBASE.Damage.Prompt.ArmorCompromised', { location: location.name });
  }

  // 3. Corrosion reminder (:284-287).
  if (damageType === 'cor' && damageInput > 0) prompt('SHADOWBASE.Damage.Prompt.Corrosion');

  // 4. Shock penalty, organics only (:289-306): -min(4, injury) to DX and IQ through the character's NEXT turn.
  if (isCharacterOrganic && location.isOrganic && finalInjury > 0 && !isEndDamage) {
    const shockVal = Math.min(4, finalInjury);
    const row = {
      id: `shock-${Date.now()}`,
      name: `Shock (-${shockVal})`,
      type: 'debuff',
      source: 'Injury',
      duration: 'Next Turn',
      expiresAfterTurn: (Number(actor.system?.turnCounter) || 0) + 1,
      isManual: true,
      modifiers: { ...engine.NO_MODIFIERS, dexterity: -shockVal, iq: -shockVal },
    };
    const effect = await effects.addEffect(actor, row);
    ledger.effects.push({ id: effect?.id ?? null, row });
  }

  // 5. Trauma Protocol (:308-342): crippling / severing on the hit-location row, then the leak.
  const locations = Array.isArray(actor.system?.hitLocations) ? actor.system.hitLocations : [];
  const locIdx = locations.findIndex((l) => l?.id === location.id);
  if (locIdx > -1 && !isEndDamage) {
    if (isSevering || isCrippling) {
      // The whole array is written (a per-index write turns a Foundry array into an object).
      const next = locations.map((l) => (l?.id === location.id ? { ...l, status: isSevering ? 'Destroyed' : 'Crippled', ...(isSevering ? { isAmputated: true } : {}) } : l));
      await actor.update({ 'system.hitLocations': next });
      ledger.location = { id: location.id, status: isSevering ? 'Destroyed' : 'Crippled', isAmputated: isSevering };
      note(isSevering ? 'SHADOWBASE.Damage.Prompt.Severed' : 'SHADOWBASE.Damage.Prompt.Crippled', { location: location.name });
    }
    if ((isSevering || isCrippling) && !isLightsaber) {
      const organicWound = isCharacterOrganic && location.isOrganic;
      const row = {
        id: `leak-${location.id}`,
        name: organicWound ? 'Bleeding' : 'Coolant Leak',
        type: 'debuff',
        source: 'Trauma Protocol',
        duration: 'Until Stabilized',
        isManual: true,
        description: `Failing HT roll every interval causes loss of ${organicWound ? '1 HP' : '5 PP'}. Requires stabilization.`,
        modifiers: { ...engine.NO_MODIFIERS },
      };
      const effect = await effects.addEffect(actor, row);
      ledger.effects.push({ id: effect?.id ?? null, row });
      prompt('SHADOWBASE.Damage.Prompt.LeakTriggered', { label: organicWound ? loc('SHADOWBASE.Damage.Bleeding') : loc('SHADOWBASE.Damage.SystemLeak') });
    }
  }

  // 6. Major wound (:344-353): HT, -10 on the head, -5 on the vitals.
  if (isMajorWound && !isEndDamage) {
    const penalty = (location.type === 'Head' || location.type === 'Processor') ? '-10' : (location.type === 'Vitals' || location.type === 'Upper Torso') ? '-5' : '';
    prompt('SHADOWBASE.Damage.Prompt.MajorWound', { penalty });
  }

  if (post) await postLedger(actor, ledger);
  return ledger;
}

/** The chat notice for a ledger: the injury line, the writes, the prompts. */
async function postLedger(actor, ledger) {
  const a = ledger.assessment;
  const lines = [];
  lines.push(fmt('SHADOWBASE.Damage.Line.Injury', { injury: a.finalInjury, pool: a.endurance ? loc('SHADOWBASE.Roll.EP') : loc('SHADOWBASE.Roll.HP'), dr: a.drApplied, penetrating: a.penetratingBase, multiplier: a.multiplier }));
  for (const n of a.notes) lines.push(n);
  if (ledger.hp) lines.push(fmt('SHADOWBASE.Damage.Line.HP', { before: ledger.hp.before, after: ledger.hp.after }));
  if (ledger.ep) lines.push(fmt('SHADOWBASE.Damage.Line.EP', { before: ledger.ep.before, after: ledger.ep.after }));
  for (const n of ledger.notices) lines.push(n.text);
  for (const e of ledger.effects) lines.push(fmt('SHADOWBASE.Damage.Line.Effect', { name: e.row.name }));
  for (const p of ledger.prompts) { lines.push(p.text); notify('warn', p.text); }
  return postNotice(actor, { title: fmt('SHADOWBASE.Damage.Title', { location: a.location.name }), lines, kind: 'damage-ledger' });
}

export const damage = Object.freeze({ DAMAGE_TYPES, locationsOf, locationOf, isEnduranceDamage, assessDamage, applyDamage });

export default damage;
