// module/world-update.mjs - the one-time update of actors already in the world (Fulllion, 2026-09-28).
//
// The website runs its whole load chain (load-sheet.ts applyLoadMigrations) every time a saved character
// opens. A Foundry actor has no "open": its data went through that chain once, when it was imported or
// dragged from a compendium. So a website round that changes what the chain produces - 2026-09-28: the
// Ch18 species packages (revision 1), the racial-row markers a species swap strips by (revision 2), the
// Twi'lek / Ugnaught familiarity wording - never reaches an actor already in the world. This runs the SAME
// chain (engine.loadIncomingSheet, not a port of it) over every world actor below the current
// speciesPackageRevision, once, on the active GM's client, when the world is ready.
//
// WHAT IT WRITES. Measured over this morning's template actors at revisions 0 and 1, the chain changes the
// four trait lists, speciesPackageRevision and (revision 0 only) culturalFamiliarities - plus eight dead-echo
// keys (basicLift, spentPoints, ...) the actor schema never stores. So it writes every STORED system field
// (SCHEMA_KEYS) the chain changed, and, row list by row list, only what the chain did to the list:
//   - the comparison is the chain's OUTPUT against the SHEET it was given (actorToSheet: each Item's row with
//     its derived gear figures laid over), never against the Items' stored rows, which differ by those
//     figures and would read as changes the chain never made;
//   - each output row is paired with the sheet row it came from - by row id, else by its content with the
//     `fromSpecies` marker set aside (the one field the chain changes on a row it keeps; many template rows,
//     the droids' and the example characters', carry no id), and the sheet's rows are the actor's Items in
//     order (actorToSheet maps rowsOf 1:1, checked here);
//   - a paired row the chain left alone gets no write; a paired row it changed gets exactly the changed keys
//     written into THE SAME Item, so its id - and every macro, link or effect pointing at it - survives (the
//     generic reconcileRows matches by reference or id only, and would delete and recreate an id-less row just
//     to add its marker); a row the chain retired is deleted; a row it added is created.
// The revision is written LAST, so an actor that fails part-way stays below it and is tried again at the next
// load; the chain converges (a retired row is matched by its whole shape, an added row is skipped where its name
// is already held, marking is exact-match).
//
// REVISION 3 (2026-10-03) needed no code here, which is the point of running the chain rather than porting it:
// Ch18's lore lines are appended to the notes of a saved character whose species prints any (only Miraluka
// does), once. `notes` is a stored field, so the field diff below writes it - the chain only ever APPENDS, so
// what the player wrote still opens the field - and its 'species-lore' notice ("Species notes added") reaches
// the GM's card like any other. What revision 3 did change is the card's count: it is the first revision that
// leaves MOST actors exactly as they were (every species but Miraluka), so an actor with no notice is no longer
// always a marked one.
//
// WHAT IT SAYS. The chain's notices (id 'species-package' names what was added and removed, 'species-lore' the
// lines the notes gained) go to the GM in one whispered chat card. An actor that was only MARKED produces no
// notice - the markers move no row and no point - so it is counted, not listed: an empty notice list is not
// "nothing happened". An actor the chain left exactly as it was (only the revision recorded) is counted apart,
// so the card never says rows were marked where none were.
//
// Not touched: compendium actors (the template pack is rebuilt at the current revision), and the item
// overrides an unlinked token keeps in its own delta (its base actor is updated).

import { engine } from './engine.mjs';
import { SCHEMA_KEYS, ITEM_ROW_ARRAY_KEYS } from './data/actor-schema.generated.mjs';
import { rowToItemData, nextSort } from './adapter.mjs';
import { SYSTEM_ID, isActingClient } from './combat.mjs';

/** The revision the website's load chain brings a sheet to (species-package-revision.ts). */
export function currentRevision() {
  const n = Number(engine.speciesPackageRevision?.SPECIES_PACKAGE_REVISION);
  if (!Number.isFinite(n)) throw new Error('shadowbase engine: speciesPackageRevision.SPECIES_PACKAGE_REVISION is missing - rebuild the engine bundle');
  return n;
}

/** The stored revision of an actor; absent (an actor from before the field existed) reads 0. */
export function storedRevision(actor) {
  const n = Number(actor?.system?.speciesPackageRevision);
  return Number.isFinite(n) ? n : 0;
}

/** World characters the update applies to: below the current revision. */
export function actorsToUpdate(actors = globalThis.game?.actors) {
  const current = currentRevision();
  return [...(actors?.contents ?? actors?.values?.() ?? [])].filter((a) => a?.type === 'character' && storedRevision(a) < current);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A row with its `fromSpecies` marker set aside: the one field the chain changes on a row it keeps. */
export function markerBlind(row) {
  if (!row || typeof row !== 'object') return JSON.stringify(row ?? null);
  const { fromSpecies: _marker, ...rest } = row;
  return JSON.stringify(rest);
}

/**
 * Apply what the chain did to one row list. `was` is the sheet's list (the actor's Items in order, derived
 * figures laid over), `next` the chain's output for it. Returns the counts written.
 */
export async function applyRowList(actor, source, was, next) {
  const items = actor.rowsOf(source);
  if (items.length !== was.length || items.some((item, k) => (item.system?.row?.name ?? null) !== (was[k]?.name ?? null))) {
    throw new Error(`${source}: the actor's Items and its sheet do not line up - left for a GM to look at`);
  }
  const pool = was.map((row, k) => ({ row, item: items[k], used: false }));
  const take = (r) => {
    const hit = (r?.id ? pool.find((p) => !p.used && p.row?.id === r.id) : null)
      ?? pool.find((p) => !p.used && markerBlind(p.row) === markerBlind(r));
    if (hit) hit.used = true;
    return hit;
  };
  const updates = []; const creates = [];
  // New rows append after the list's last Item, one sort step apart (adapter.nextSort's density).
  const density = globalThis.CONST?.SORT_INTEGER_DENSITY ?? 100000;
  let sort = nextSort(actor, source);
  for (const r of next) {
    const hit = take(r);
    if (!hit) { creates.push(rowToItemData(r, source, sort)); sort += density; continue; }
    if (same(hit.row, r)) continue;
    // Exactly the keys the chain changed, into the same Item (a merge: the stored row keeps everything else).
    const row = {};
    for (const k of new Set([...Object.keys(hit.row ?? {}), ...Object.keys(r ?? {})])) {
      if (same(hit.row?.[k], r?.[k])) continue;
      if (r?.[k] === undefined) row[`-=${k}`] = null; else row[k] = structuredClone(r[k]);
    }
    updates.push({ _id: hit.item.id, system: { row } });
  }
  const deletes = pool.filter((p) => !p.used).map((p) => p.item.id);
  if (deletes.length) await actor.deleteEmbeddedDocuments('Item', deletes);
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  if (creates.length) await actor.createEmbeddedDocuments('Item', creates);
  return { deleted: deletes.length, updated: updates.length, created: creates.length };
}

/**
 * Bring one actor to the state the website's load gives its sheet.
 * @param {Actor} actor
 * @returns {Promise<{ actor: string, notices: object[], rows: string[], fields: string[] }>}
 */
export async function updateActor(actor) {
  // No readable sheet (the adapter itself failed for this actor): the chain would run over nothing and hand
  // back the blank sheet, whose defaults the field diff below would then write over the actor's real data.
  const sheet = actor.sheetData;
  if (!sheet || typeof sheet !== 'object' || !('species' in sheet)) throw new Error('its sheet could not be read - left as it is for a GM to look at');
  const before = structuredClone(sheet);
  const { data: after, notices = [] } = engine.loadIncomingSheet(structuredClone(before));
  const rows = [];
  for (const source of ITEM_ROW_ARRAY_KEYS) {
    const was = Array.isArray(before[source]) ? before[source] : [];
    const next = Array.isArray(after[source]) ? after[source] : [];
    if (same(was, next)) continue;
    await applyRowList(actor, source, was, next);
    rows.push(source);
  }
  const changes = {};
  for (const key of SCHEMA_KEYS) {
    if (key === 'legacy' || key === 'speciesPackageRevision') continue;
    // Only a field the sheet stated: an absent one would read as "changed" to the blank sheet's default.
    if (!(key in before) || after[key] === undefined) continue;
    if (!same(before[key], after[key])) changes[`system.${key}`] = after[key];
  }
  if (Object.keys(changes).length) await actor.update(changes);
  // Last: an actor that failed above stays below the current revision and is tried again next load.
  await actor.update({ 'system.speciesPackageRevision': after.speciesPackageRevision ?? currentRevision() });
  return { actor: actor.name, notices, rows, fields: Object.keys(changes).map((k) => k.slice('system.'.length)) };
}

/**
 * How the updated actors divide for the card: `listed` have a notice from the chain; `marked` have none but the
 * chain changed their rows or a stored field (the racial markers of revision 2); `unchanged` are exactly as they
 * were - nothing in the revisions they crossed applies to them, and only the revision was recorded.
 */
export function reportCounts(updated = []) {
  const listed = updated.filter((u) => u.notices.length);
  const silent = updated.filter((u) => !u.notices.length);
  const marked = silent.filter((u) => (u.rows?.length ?? 0) > 0 || (u.fields?.length ?? 0) > 0).length;
  return { listed, marked, unchanged: silent.length - marked };
}

/** The GM's card: listed actors (with notices), the counts of marked-only and of unchanged ones, and any failures. */
export function reportHtml({ revision, updated, failed }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const { listed, marked, unchanged } = reportCounts(updated);
  const loc = (key, data) => globalThis.game?.i18n?.format?.(`SHADOWBASE.WorldUpdate.${key}`, data) ?? key;
  const items = listed.map((u) => `<li><strong>${esc(u.actor)}</strong>: ${u.notices.map((n) => esc([n.title, n.description].filter(Boolean).join(' — '))).join('; ')}</li>`).join('');
  return `<div class="shadowbase sb-world-update"><h3>${esc(loc('Title', { revision }))}</h3>`
    + `<p>${esc(loc('Summary', { count: updated.length, revision }))}</p>`
    + (items ? `<ul>${items}</ul>` : '')
    + (marked ? `<p>${esc(loc('MarkedOnly', { count: marked }))}</p>` : '')
    + (unchanged ? `<p>${esc(loc('Unchanged', { count: unchanged }))}</p>` : '')
    + (failed.length ? `<p>${esc(loc('Failed', { names: failed.map((f) => `${f.actor} (${f.error})`).join(', ') }))}</p>` : '')
    + '</div>';
}

/**
 * The world-load entry: on the active GM's client only, update every world character below the current
 * revision, then whisper the GM what happened. Returns null on any other client (or when nothing is due).
 */
export async function runWorldUpdate({ actors } = {}) {
  if (!isActingClient()) return null;
  const due = actorsToUpdate(actors);
  if (!due.length) return null;
  const revision = currentRevision();
  const updated = []; const failed = [];
  for (const actor of due) {
    try { updated.push(await updateActor(actor)); }
    catch (err) { failed.push({ actor: actor.name, error: err?.message ?? String(err) }); console.error(`${SYSTEM_ID} | world update: ${actor.name}`, err); }
  }
  const content = reportHtml({ revision, updated, failed });
  const ChatMessage = globalThis.CONFIG?.ChatMessage?.documentClass ?? globalThis.ChatMessage;
  try { await ChatMessage?.create?.({ content, whisper: [globalThis.game.user.id], speaker: { alias: 'ShadowBase' } }); } catch (err) { console.error(`${SYSTEM_ID} | world update: report`, err); }
  globalThis.ui?.notifications?.info?.(globalThis.game?.i18n?.format?.('SHADOWBASE.WorldUpdate.Notify', { count: updated.length, revision }) ?? '');
  return { revision, updated, failed };
}
