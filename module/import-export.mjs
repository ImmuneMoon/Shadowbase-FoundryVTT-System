// module/import-export.mjs
//
// The character JSON boundary and the single-item envelope (unit U06;
// docs/ARCHITECTURE.md §6.1 "Import / Export", §4.1 importSheet/exportSheet,
// the website's docs/CHARACTER_JSON_FORMAT.md).
//
//   importJson(actor, json, { mode })   a character file -> this actor, through
//                                       the website's own load path: the data
//                                       layer's ShadowBaseActor#importSheet
//                                       (convertJsonToSheet -> blank spread ->
//                                       applyLoadMigrations -> sheetToActorData ->
//                                       replace items / effects / system), with the
//                                       load notices shown as notifications and
//                                       the portrait downscaled to 512 px first;
//   exportJson(actor)                   ShadowBaseActor#exportSheet (actorToSheet
//                                       -> getCalculatedStats -> convertSheetToJson,
//                                       the echo fields filled) saved as
//                                       <name>_shadowbase.json (use-character-actions.ts:124);
//   importFromFilePicker / handleFileDrop  the two hand-off routes the doc names (§1);
//   bulkImportFiles(files, policy)      the roster route (§1.1, bulk-import.ts) for
//                                       U09's DossierImporter: plan first, then
//                                       create / overwrite / copy / skip;
//   exportItemEnvelope / importItemEnvelope  the item file (§0.1, item-transfer.ts):
//                                       parts closure on the way out, rebinding and
//                                       placement stripping on the way in, name
//                                       collisions resolved the website's four ways.
//
// Nothing here re-implements a conversion: every step is the bundle's
// (convertJsonToSheet, applyLoadMigrations, convertSheetToJson,
// buildEnvelope, collectPartsClosure, parseImport, prepareImportedSheet,
// planBulkImport, findCollision ...). Browser-only steps (the file picker,
// the download, the canvas downscale) are guarded so the module loads and
// its pure halves run headlessly (scripts/check-json-contract.mjs).

import { engine } from './engine.mjs';
import { sheetToActorData, rowsOf, rowWithDerived, rowToItemData, nextSort } from './adapter.mjs';

export const SYSTEM_ID = 'shadowbase';
/** docs/CHARACTER_JSON_FORMAT.md §2.1: keep the portrait to 512 px on the long side. */
export const PORTRAIT_MAX_PX = 512;
/** The item file's magic (item-transfer.ts MAGIC). */
export const ITEM_FORMAT = 'shadowbase.item';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message, options) => { globalThis.ui?.notifications?.[level]?.(message, options); return message; };
const hasDocument = () => typeof globalThis.document?.createElement === 'function';
/** foundry.applications.api.DialogV2, resolved late and through `in` guards (the headless shim's proxy throws on an undeclared member). */
function dialogV2() {
  const apps = globalThis.foundry?.applications;
  const api = apps && ('api' in apps) ? apps.api : null;
  return api && ('DialogV2' in api) ? api.DialogV2 : null;
}

/** The last download this module would have made (headless: no file is written; checks read this). */
export const lastExport = { filename: null, data: null, type: null };

/**
 * Save a file the way Foundry does (foundry.utils.saveDataToFile, the global
 * of the same name before v13's namespace move). Headlessly the file is only
 * recorded on `lastExport`.
 */
export function saveFile(data, type, filename) {
  lastExport.filename = filename;
  lastExport.data = data;
  lastExport.type = type;
  const utils = globalThis.foundry?.utils;
  const fn = (utils && ('saveDataToFile' in utils) && typeof utils.saveDataToFile === 'function') ? utils.saveDataToFile : globalThis.saveDataToFile;
  if (typeof fn === 'function') { fn(data, type, filename); return true; }
  return false;
}

/** use-character-actions.ts:124 - `<name with spaces as underscores, lowercased>_shadowbase.json`. */
export function characterExportFilename(name) {
  return `${String(name || 'character').replace(/\s+/g, '_').toLowerCase()}_shadowbase.json`;
}

// ---------------------------------------------------------------------------
// Character files
// ---------------------------------------------------------------------------

/** True when parsed JSON is a character file rather than an item envelope or something else. */
export function isCharacterFile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.__format === ITEM_FORMAT) return false;
  return data.type === 'character' || 'investment' in data || 'traits' in data || 'characteristics' in data || 'inventory' in data;
}

/** True when parsed JSON is a single-item envelope (item-transfer.ts). */
export function isItemEnvelope(data) {
  return !!data && typeof data === 'object' && data.__format === ITEM_FORMAT;
}

/** Parse a file's text; a clear error names the problem (SHADOWBASE.Import.InvalidJson). */
export function parseJsonText(text) {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch (err) { throw new Error(fmt('SHADOWBASE.Import.InvalidJson', { error: err.message })); }
}

/**
 * Downscale a data-URL portrait to at most `max` px on the long side through a
 * canvas (browser only - headlessly the data URL comes back unchanged). The
 * image type is kept for PNG (transparency) and becomes JPEG otherwise, which
 * is what keeps a phone photo under Firestore's field limit (§2.1, §3.1).
 * @param {string|null} dataUrl
 * @param {number} [max]
 * @returns {Promise<string|null>}
 */
export async function downscalePortrait(dataUrl, max = PORTRAIT_MAX_PX) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl ?? null;
  if (!hasDocument() || typeof globalThis.Image !== 'function') return dataUrl;
  const img = await new Promise((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = dataUrl;
  });
  if (!img) return dataUrl;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h || Math.max(w, h) <= max) return dataUrl;
  const scale = max / Math.max(w, h);
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = /^data:image\/png/i.test(dataUrl);
  return png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Show the website's load-time notices (applyLoadMigrations: species rename,
 * languages structured, Force Points capped ...) as notifications, and
 * return them.
 * @param {{ id: string, title: string, description: string }[]} notices
 */
export function announceNotices(notices = []) {
  for (const n of notices) notify('info', `${n.title}: ${n.description}`, { permanent: false });
  return notices;
}

/**
 * Import a character file into this actor, replacing everything on it.
 * @param {object} actor a ShadowBaseActor
 * @param {object|string} json the character file (parsed or text)
 * @param {{ mode?: 'replace', keepName?: boolean }} [options]
 * @returns {Promise<{ notices: object[], name: string }|null>} null when the file was an item envelope (routed) or refused
 */
export async function importJson(actor, json, { mode = 'replace', keepName = false } = {}) {
  const data = parseJsonText(json);
  if (isItemEnvelope(data)) {
    // A dropped item file on the character importer: route it (§0.1 - the two formats are distinct, never confused).
    const result = await importItemEnvelope(actor, JSON.stringify(data));
    return result?.ok ? { notices: [], name: actor.name, item: result } : null;
  }
  if (!isCharacterFile(data)) throw new Error(fmt('SHADOWBASE.Import.InvalidJson', { error: loc('SHADOWBASE.Import.NotACharacter') }));
  if (mode !== 'replace') throw new Error(fmt('SHADOWBASE.Import.UnknownMode', { mode }));
  const file = { ...data };
  if (typeof file.portrait === 'string' && file.portrait) file.portrait = await downscalePortrait(file.portrait);
  const { notices } = await actor.importSheet(file, { mode, keepName });
  announceNotices(notices);
  notify('info', fmt('SHADOWBASE.Import.Success', { name: actor.name }));
  return { notices, name: actor.name };
}

/**
 * Export this actor as a character file and hand it to the browser as
 * `<name>_shadowbase.json`. Returns the file's object.
 * @param {object} actor
 */
export function exportJson(actor) {
  const data = actor.exportSheet();
  const filename = characterExportFilename(data?.name ?? actor.name);
  saveFile(JSON.stringify(data, null, 2), 'text/json', filename);
  notify('info', fmt('SHADOWBASE.Import.Exported', { filename }));
  return data;
}

/** Read a File (or anything with .text()) as text. */
export async function readTextFile(file) {
  if (!file) return null;
  if (typeof file.text === 'function') return file.text();
  if (typeof globalThis.FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
  return null;
}

/** Open a file picker (browser only) and resolve with the chosen files, or [] when cancelled / headless. */
export function pickFiles({ accept = '.json,application/json', multiple = false } = {}) {
  if (!hasDocument()) return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = globalThis.document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => { const files = Array.from(input.files ?? []); input.remove(); resolve(files); });
    input.addEventListener('cancel', () => { input.remove(); resolve([]); });
    globalThis.document.body.appendChild(input);
    input.click();
  });
}

/** Confirm through DialogV2 when it exists; headlessly (or on an older client) the answer is yes. */
async function confirmReplace(actor) {
  const DialogV2 = dialogV2();
  if (typeof DialogV2?.confirm !== 'function') return true;
  return DialogV2.confirm({
    window: { title: loc('SHADOWBASE.Import.ConfirmTitle') },
    content: `<p>${fmt('SHADOWBASE.Import.ConfirmBody', { name: actor.name })}</p>`,
    rejectClose: false, modal: true,
  });
}

/**
 * The file-picker route (§1): choose a .json, confirm the replacement, import.
 * @param {object} actor
 */
export async function importFromFilePicker(actor) {
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return null;
  const text = await readTextFile(file);
  return importText(actor, text, { fileName: file.name });
}

/** Import from text already read: an item envelope goes to the item importer, a character file to importJson after confirmation. */
export async function importText(actor, text, { fileName = '' } = {}) {
  let data;
  try { data = parseJsonText(text); } catch (err) { notify('error', err.message); return null; }
  if (isItemEnvelope(data)) return importItemEnvelope(actor, text);
  if (!isCharacterFile(data)) { notify('error', fmt('SHADOWBASE.Import.NotACharacterFile', { file: fileName })); return null; }
  if (!(await confirmReplace(actor))) return null;
  try { return await importJson(actor, data); } catch (err) { notify('error', err.message); return null; }
}

/**
 * The drag-and-drop route (§1): a `.json` file dropped on the sheet. Returns
 * false when the drop carried no JSON file (so the sheet's other drop
 * handlers run), otherwise the import result.
 * @param {object} actor
 * @param {DragEvent} event
 */
export async function handleFileDrop(actor, event) {
  const files = Array.from(event?.dataTransfer?.files ?? []);
  const file = files.find((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
  if (!file) return false;
  event.preventDefault?.();
  const text = await readTextFile(file);
  return importText(actor, text, { fileName: file.name });
}

// ---------------------------------------------------------------------------
// Roster import (bulk-import.ts, §1.1) - for U09's DossierImporter
// ---------------------------------------------------------------------------

/** The world actors keyed by the website's sanitized character id (name with `. # $ [ ] /` replaced). */
function actorIndex() {
  const index = new Map();
  for (const a of globalThis.game?.actors?.contents ?? []) {
    if (a.type !== 'character') continue;
    index.set(engine.saveAsCopy.sanitizeCharacterId(a.name), a);
  }
  return index;
}

/**
 * Plan and run a roster import. `files` are `{ name, text }` pairs (or File
 * objects); `policy` is the website's OverwritePolicy: 'skip' (default),
 * 'overwrite' or 'copy'. Each file is prepared the website's way
 * (prepareImportedSheet: convertJsonToSheet, sanitizer-null repair, blank
 * spread, schema validation), planned against the world's character names,
 * then written: created through sheetToActorData, overwritten through
 * importSheet, copied under the next free "Name (n)". Load-time migrations
 * are applied at write time (a Foundry actor has no "next open" pass; U03's
 * template Actors do the same).
 * @param {Array<File|{ name: string, text: string }>} files
 * @param {'skip'|'overwrite'|'copy'} [policy]
 * @param {{ folder?: string|null, dryRun?: boolean }} [options]
 * @returns {Promise<{ plan: object[], results: object[], tally: object }>}
 */
export async function bulkImportFiles(files, policy = 'skip', { folder = null, dryRun = false } = {}) {
  const prepared = [];
  for (const file of files ?? []) {
    const fileName = file?.name ?? 'file.json';
    const text = typeof file?.text === 'string' ? file.text : await readTextFile(file);
    const p = engine.bulkImport.prepareImportedSheet(text);
    prepared.push({ fileName, characterName: p.characterName, error: p.error, sheet: p.sheet });
  }
  const index = actorIndex();
  const naming = {
    sanitizeId: engine.saveAsCopy.sanitizeCharacterId,
    exists: async (id) => index.has(id),
    nextCopyName: engine.saveAsCopy.nextCopyName,
  };
  const plan = await engine.bulkImport.planBulkImport(prepared.map(({ fileName, characterName, error }) => ({ fileName, characterName, error })), policy, naming);
  const tally = engine.bulkImport.tallyPlan(plan);
  const results = [];
  if (dryRun) return { plan, results, tally };
  const ActorCls = globalThis.CONFIG?.Actor?.documentClass ?? globalThis.Actor;
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    const source = prepared[i];
    if (entry.action === 'skip' || entry.action === 'invalid') { results.push({ ...entry, ok: entry.action === 'skip', actorId: null }); continue; }
    try {
      const migrated = engine.loadIncomingSheet(source.sheet);
      if (entry.action === 'overwrite') {
        const existing = index.get(entry.id);
        if (!existing) throw new Error(`no actor to overwrite for ${entry.id}`);
        await existing.importSheet(migrated.data, { keepName: true });
        results.push({ ...entry, ok: true, actorId: existing.id, notices: migrated.notices });
        continue;
      }
      const data = sheetToActorData(migrated.data, { actorName: entry.finalName });
      if (folder) data.folder = folder;
      const created = await ActorCls.create(data);
      if (created) index.set(entry.id, created);
      results.push({ ...entry, ok: !!created, actorId: created?.id ?? null, notices: migrated.notices });
    } catch (err) {
      results.push({ ...entry, ok: false, actorId: null, reason: err.message });
    }
  }
  return { plan, results, tally };
}

// ---------------------------------------------------------------------------
// The single-item envelope (item-transfer.ts, §0.1)
// ---------------------------------------------------------------------------

/** Item type -> ITEM_KINDS id (equipment rows that are blueprints are the `blueprint` kind). */
const KIND_BY_TYPE = Object.freeze({
  lightsaber: 'lightsaber', blaster: 'customBlaster', meleeWeapon: 'customMeleeWeapon', explosive: 'customExplosive',
  armor: 'armorItem', armorPart: 'armorModification', weaponPart: 'weaponModification', ammunition: 'ammunition',
  implant: 'neuralImplant', cyberneticLimb: 'cyberneticLimb', cyberneticUpgrade: 'cyberneticUpgrade',
  starship: 'customStarship', vehicle: 'vehicle', equipment: 'generalEquipment',
});

/** The transfer kind of an Item, or null for a type that has none (traits, skills, powers). */
export function transferKindFor(item) {
  if (!item) return null;
  if (item.type === 'equipment' && engine.blueprints.isBlueprint(item.system?.row ?? {})) return 'blueprint';
  return KIND_BY_TYPE[item.type] ?? null;
}

/**
 * Export one Item as an item file. The parts closure (the owned rows a built
 * weapon's or suit's slots reference, plus the loaded magazine) rides along,
 * read from the actor's rows with their persisted derived figures - what the
 * website's form holds (item-transfer-buttons.tsx:39-58).
 * @param {object} actor
 * @param {object} item
 * @param {{ note?: string }} [options]
 * @returns {object|null} the envelope
 */
export function exportItemEnvelope(actor, item, { note } = {}) {
  const kind = transferKindFor(item);
  if (!kind) { notify('warn', fmt('SHADOWBASE.Import.NoTransferKind', { name: item?.name ?? '' })); return null; }
  const row = rowWithDerived(item);
  const parts = engine.itemTransfer.collectPartsClosure(kind, row, (field) => rowsOf(actor, field).map(rowWithDerived));
  const envelope = engine.itemTransfer.buildEnvelope(kind, row, note, parts);
  const filename = engine.itemTransfer.exportFilename(kind, row);
  saveFile(JSON.stringify(envelope, null, 2), 'text/json', filename);
  notify('info', fmt('SHADOWBASE.Import.ItemExported', { name: item.displayName ?? item.name, filename }));
  return envelope;
}

/** The kind an envelope declares, else the first ITEM_KINDS entry whose schema accepts the payload (parseImport's own sniff order). */
export function sniffItemKind(text) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (parsed && typeof parsed === 'object' && typeof parsed.__kind === 'string') return parsed.__kind;
  for (const def of engine.itemTransfer.ITEM_KINDS) {
    const r = engine.itemTransfer.parseImport(text, def.kind);
    if (r.ok) return def.kind;
  }
  return null;
}

/** Ask how to resolve a name collision (import-collision.ts): replace / rename / stack / ignore. Headless default: rename. */
async function askCollision(existingName, canStack) {
  const DialogV2 = dialogV2();
  if (typeof DialogV2?.wait !== 'function') return 'rename';
  const buttons = [
    { action: 'replace', label: loc('SHADOWBASE.Import.Collision.Replace') },
    { action: 'rename', label: loc('SHADOWBASE.Import.Collision.Rename'), default: true },
    ...(canStack ? [{ action: 'stack', label: loc('SHADOWBASE.Import.Collision.Stack') }] : []),
    { action: 'ignore', label: loc('SHADOWBASE.Import.Collision.Ignore') },
  ];
  const answer = await DialogV2.wait({ window: { title: loc('SHADOWBASE.Import.Collision.Title') }, content: `<p>${fmt('SHADOWBASE.Import.Collision.Body', { name: existingName })}</p>`, buttons, rejectClose: false, modal: true });
  return answer ?? 'ignore';
}

/**
 * Import an item file onto the actor. `kind` is the receiving section
 * (ITEM_KINDS id) - the sheet's per-section Import button - or null to take
 * the envelope's own kind (a file dropped on the sheet). Validation is by
 * shape (parseImport); placement is stripped; carried parts arrive rebound to
 * the new host; a display-name collision is resolved the website's four ways.
 * @param {object} actor
 * @param {string} text the file's text
 * @param {{ kind?: string|null, resolution?: 'replace'|'rename'|'stack'|'ignore'|null }} [options]
 * @returns {Promise<{ ok: boolean, kind?: string, created?: object[], reason?: string, message?: string }>}
 */
export async function importItemEnvelope(actor, text, { kind = null, resolution = null } = {}) {
  const raw = typeof text === 'string' ? text : JSON.stringify(text);
  const expected = kind ?? sniffItemKind(raw);
  if (!expected) { const message = loc('SHADOWBASE.Import.ItemUnrecognised'); notify('error', message); return { ok: false, reason: 'unrecognised', message }; }
  const result = engine.itemTransfer.parseImport(raw, expected);
  if (!result.ok) { notify('error', `${result.message}${result.detail ? ` ${result.detail}` : ''}`); return result; }
  const def = engine.itemTransfer.kindDef(expected);
  const field = def.field;
  let item = result.item;
  let parts = result.parts ?? {};
  if (result.partsMissing) notify('warn', fmt('SHADOWBASE.Import.ItemPartsMissing', { name: engine.importCollision.displayName(item) }));
  const existingRows = rowsOf(actor, field).map((i) => i.system.row);
  const collision = engine.importCollision.findCollision(existingRows, item);
  if (collision) {
    const choice = resolution ?? await askCollision(engine.importCollision.displayName(collision), engine.importCollision.canStack(collision, item));
    const own = actor.itemByRowId?.(collision.id) ?? actor.items?.find?.((i) => i.system?.row?.id === collision.id) ?? null;
    if (choice === 'ignore') return { ok: false, reason: 'ignored', kind: expected, message: loc('SHADOWBASE.Import.Collision.Ignored') };
    if (choice === 'stack') {
      const stacked = engine.importCollision.applyStack(existingRows, collision.id, item).find((r) => r.id === collision.id);
      if (own && stacked) await own.updateRow({ quantity: stacked.quantity });
      notify('info', fmt('SHADOWBASE.Import.ItemStacked', { name: engine.importCollision.displayName(collision) }));
      return { ok: true, kind: expected, created: [], stacked: own?.id ?? null };
    }
    if (choice === 'replace') {
      const replaced = engine.importCollision.applyReplace(existingRows, collision.id, item).find((r) => r.id === collision.id);
      // The website keeps the existing row's id (applyReplace); carried parts were rebound to the incoming id, so they follow the kept one.
      const oldHost = String(item.id);
      if (own && replaced) await own.update({ 'system.row': replaced }, { recursive: false });
      item = null;
      parts = rebindParts(parts, oldHost, collision.id);
    } else {
      item = engine.importCollision.renamedForImport(existingRows, item);
    }
  }
  const creations = [];
  let sort = nextSort(actor, field);
  if (item) creations.push(rowToItemData(item, field, sort));
  for (const [pField, rows] of Object.entries(parts)) {
    let pSort = nextSort(actor, pField);
    for (const row of rows) { creations.push(rowToItemData(row, pField, pSort)); pSort += (globalThis.CONST?.SORT_INTEGER_DENSITY ?? 100000); }
  }
  sort += 0;
  const created = creations.length ? await actor.createEmbeddedDocuments('Item', creations) : [];
  const name = engine.importCollision.displayName(item ?? result.item);
  notify('info', fmt('SHADOWBASE.Import.ItemImported', { name, count: created.length, section: def.section }));
  return { ok: true, kind: expected, created, note: result.note ?? null };
}

/** Point every carried part's host claim at the row the replace kept. */
function rebindParts(parts, oldHost, newHost) {
  const out = {};
  for (const [field, rows] of Object.entries(parts ?? {})) {
    out[field] = rows.map((r) => {
      const c = { ...r };
      for (const k of ['installedInSaberId', 'installedInMeleeId', 'installedInBlasterId', 'installedInArmorId', 'installedInDroidId']) if (c[k] === oldHost) c[k] = newHost;
      return c;
    });
  }
  return out;
}

/** The per-section Import Item button (browser): pick a file, import it into `kind` (or the file's own kind). */
export async function importItemFromFilePicker(actor, { kind = null } = {}) {
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return null;
  const text = await readTextFile(file);
  return importItemEnvelope(actor, text, { kind });
}

export const importExport = Object.freeze({
  importJson, exportJson, importFromFilePicker, importText, handleFileDrop, bulkImportFiles,
  exportItemEnvelope, importItemEnvelope, importItemFromFilePicker, sniffItemKind, transferKindFor,
  downscalePortrait, announceNotices, characterExportFilename, isCharacterFile, isItemEnvelope, parseJsonText,
  saveFile, lastExport, PORTRAIT_MAX_PX, ITEM_FORMAT,
});

export default importExport;
