// module/apps/item-sheets/vehicle.mjs
//
// Vehicle (vehicle-item.tsx:92-185): the printed figures as typed fields
// (type, handling, speed, accel/decel, HP, DR, crew, passengers, cargo, cost,
// weapons, weapon skill, hyperdrive), the Terrestrial / Atmospheric category
// (terrestrial-vehicles-section.tsx:55-59: an explicit category wins, then
// the catalog profile, then the type), quantity, notes.

import { engine } from '../../engine.mjs';
import { vehicleCategoryOf } from '../actor-sheet-tabs.mjs';
import { ShadowBaseItemSheet, loc, text, num } from './base.mjs';

const TAB_IDS = ['main', 'notes'];

export class VehicleSheet extends ShadowBaseItemSheet {
  static FAMILY = 'vehicle';
  static TAB_IDS = TAB_IDS;
  static PARTS = ShadowBaseItemSheet.partsFor('vehicle', TAB_IDS);
  static TABS = ShadowBaseItemSheet.tabsFor(TAB_IDS);

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const row = context.row;
    const category = vehicleCategoryOf(row);
    const profile = engine.vehicleData.VEHICLE_DATA.find((v) => v.name === row.name) ?? null;
    const field = (key, { number = false } = {}) => ({ key, name: `system.row.${key}`, value: number ? (row[key] ?? null) : text(row[key]), label: loc(`SHADOWBASE.Item.Vehicle.${key}`), number });
    context.main = {
      categories: ['Terrestrial', 'Atmospheric'].map((c) => ({ value: c, label: loc(`SHADOWBASE.Item.Vehicle.Category.${c}`), selected: c === category })),
      categoryExplicit: row.category === 'Terrestrial' || row.category === 'Atmospheric',
      fields: [field('type'), field('handling'), field('speed'), field('accelDecel'), field('hp', { number: true }), field('dr', { number: true }), field('crew'), field('passengers'), field('cargo'), field('hyperdrive'), field('weapons'), field('weaponSkill')],
      cost: row.cost ?? null,
      quantity: num(row.quantity, 1) || 1,
      inCatalog: !!profile,
      catalogNotes: text(profile?.notes),
    };
    return context;
  }
}

export default VehicleSheet;
