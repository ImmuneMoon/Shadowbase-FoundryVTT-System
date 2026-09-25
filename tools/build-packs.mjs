#!/usr/bin/env node
// tools/build-packs.mjs
//
// Writes packs-src/<pack>/*.json from tools/pack-manifest.mjs and compiles
// each into packs/<pack> (LevelDB) with @foundryvtt/foundryvtt-cli's
// compilePack. packs-src/ is tracked (deterministic ids, deterministic uuids,
// so a rebuild of the same bundle is a no-op in git); packs/ is ignored.
//
//   node tools/build-packs.mjs                 # every pack
//   node tools/build-packs.mjs --only armor    # packs whose name contains "armor"
//   node tools/build-packs.mjs --no-compile    # sources only (no LevelDB)
//   node tools/build-packs.mjs --allow-stale   # build from a bundle older than the website src (dev only)
//
// REFUSES A STALE BUNDLE by the same rule as scripts/check-engine-parity.mjs:
// engine/shadowbase-engine.mjs must be newer than every website source file,
// and engine/BUILD-INFO.json must exist. A pack generated from a stale bundle
// would carry catalog rows the website no longer has, with nothing to say so.
//
// Every stored row is validated at build time against the website's own zod
// schema for its array (pack.schema / pack.schemaOf; kit parts against
// pack.partsSchema) - the same gate the website's item import applies
// (item-transfer.ts parseImport). A row that fails is a build error, never a
// document.
//
// The handbook pack's sources are written by tools/build-handbook-pack.mjs;
// this script compiles packs-src/handbook when it is present so one
// `npm run build:packs` produces every LevelDB directory system.json lists.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const WEB = resolve(process.env.SHADOWBASE_WEBSITE ?? join(ROOT, '..', 'ShadowBase Website'));
const ENGINE = resolve(process.env.ENGINE_BUNDLE ?? join(ROOT, 'engine', 'shadowbase-engine.mjs'));
const BUILD_INFO = join(dirname(ENGINE), 'BUILD-INFO.json');
export const SRC_ROOT = join(ROOT, 'packs-src');
export const OUT_ROOT = join(ROOT, 'packs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : null; };
const ONLY = value('--only');
const COMPILE = !flag('--no-compile');
const ALLOW_STALE = flag('--allow-stale');

const die = (msg) => { console.error(`build-packs: ${msg}`); process.exit(1); };

// ---- freshness (the check-engine-parity rule) ------------------------------------------------
export function newestSourceMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) { if (!/^(node_modules|\.next|\.refactor-backup)$/.test(ent.name)) walk(p); }
      else if (/\.(ts|tsx|json)$/.test(ent.name)) newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

export function assertFreshBundle({ allowStale = false } = {}) {
  if (!existsSync(ENGINE)) die(`engine bundle missing at ${ENGINE} - run npm run build:engine`);
  if (!existsSync(BUILD_INFO)) die(`engine/BUILD-INFO.json missing beside the bundle - run npm run build:engine`);
  if (!existsSync(join(WEB, 'src'))) die(`website src not found at ${WEB} (set SHADOWBASE_WEBSITE)`);
  const bundleMtime = statSync(ENGINE).mtimeMs;
  const srcMtime = newestSourceMtime(join(WEB, 'src'));
  if (bundleMtime < srcMtime) {
    const msg = `engine bundle is STALE: bundle ${new Date(bundleMtime).toISOString()} < newest website src ${new Date(srcMtime).toISOString()} - run npm run build:engine`;
    if (!allowStale) die(msg);
    console.warn(`build-packs: WARNING ${msg} (--allow-stale)`);
  }
  return JSON.parse(readFileSync(BUILD_INFO, 'utf8'));
}

// ---- helpers ---------------------------------------------------------------------------------------
const safeName = (name) => String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'doc';
const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const json = (v) => JSON.stringify(v, null, 2) + '\n';

/** Zod issues as one readable line. */
const issues = (err) => err.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

/**
 * Build one pack's documents (folders + entries) from its declaration.
 * Pure: returns { docs, folders, errors }; nothing is written here.
 */
export function buildPackDocuments(pack, M, engine) {
  const { documentId, folderId, embeddedId, keyFor, remapUuids, SORT_DENSITY, SYSTEM_ID, itemTypeFor, schemaFor, docNameFor } = M;
  const rows = pack.source(engine);
  const docs = [];
  const folders = new Map(); // path -> folder doc
  const errors = [];
  const seenIds = new Map();
  const seenKeys = new Set();

  const ensureFolder = (path) => {
    if (!path.length) return null;
    const full = path.join('/');
    if (!folders.has(full)) {
      const parent = ensureFolder(path.slice(0, -1));
      const id = folderId(pack.name, path);
      folders.set(full, {
        _id: id,
        _key: keyFor('Folder', id),
        name: path[path.length - 1],
        type: pack.type,
        folder: parent,
        sorting: 'a',
        sort: folders.size * SORT_DENSITY,
        color: null,
        description: '',
        flags: { [SYSTEM_ID]: { pack: pack.name, path } },
      });
    }
    return folders.get(full)._id;
  };

  rows.forEach((row, index) => {
    const key = pack.key(row);
    if (typeof key !== 'string' || !key) { errors.push(`${pack.name}[${index}]: key() returned ${JSON.stringify(key)}`); return; }
    if (seenKeys.has(key)) { errors.push(`${pack.name}: duplicate key "${key}"`); return; }
    seenKeys.add(key);
    const id = documentId(pack.name, key);
    if (seenIds.has(id)) { errors.push(`${pack.name}: id collision ${id} between "${seenIds.get(id)}" and "${key}"`); return; }
    seenIds.set(id, key);

    let body;
    try {
      body = pack.project(row, { engine, pack: pack.name, key, index });
    } catch (err) {
      errors.push(`${pack.name} "${key}": project() threw - ${err.message}`);
      return;
    }
    body = remapUuids(body, `${pack.name}:${key}`);
    const folder = ensureFolder(pack.folderPlan(row, engine) ?? []);
    const sort = (index + 1) * SORT_DENSITY;
    const expectedName = docNameFor(pack, row, engine);
    if (body.name !== expectedName) errors.push(`${pack.name} "${key}": document name "${body.name}" != declared docName "${expectedName}"`);

    let doc;
    if (pack.type === 'Item') {
      const type = itemTypeFor(pack, row);
      if (body.type !== type) errors.push(`${pack.name} "${key}": projected type ${body.type} != declared ${type}`);
      const schema = schemaFor(pack, row, engine);
      const parsed = schema.safeParse(body.system.row);
      if (!parsed.success) errors.push(`${pack.name} "${key}": row fails ${type}'s website schema - ${issues(parsed.error)}`);
      if (body.system.kit) {
        const partsSchema = pack.partsSchema?.(engine);
        for (const [i, part] of (body.system.kit.parts ?? []).entries()) {
          const p = partsSchema ? partsSchema.safeParse(part) : { success: true };
          if (!p.success) errors.push(`${pack.name} "${key}": kit part ${i} "${part?.name}" fails the parts schema - ${issues(p.error)}`);
        }
        for (const [i, eq] of (body.system.kit.equipment ?? []).entries()) {
          const p = engine.inventorySchemas.generalEquipmentItemSchema.safeParse(eq);
          if (!p.success) errors.push(`${pack.name} "${key}": kit equipment ${i} "${eq?.name}" fails the equipment schema - ${issues(p.error)}`);
        }
      }
      doc = {
        _id: id,
        _key: keyFor('Item', id),
        name: body.name,
        type: body.type,
        img: body.img,
        folder,
        sort,
        system: body.system,
        effects: [],
        ownership: { default: 0 },
        flags: { [SYSTEM_ID]: { pack: pack.name, key } },
      };
    } else if (pack.type === 'Actor') {
      doc = {
        _id: id,
        _key: keyFor('Actor', id),
        name: body.name,
        type: body.type,
        img: body.img,
        folder,
        sort,
        system: body.system,
        prototypeToken: body.prototypeToken,
        // Embedded documents carry their own LevelDB key (foundryvtt-cli compileClassicLevel reads
        // doc._key on every level of the hierarchy): `!actors.items!<actorId>.<itemId>`.
        items: (body.items ?? []).map((it, i) => { const iid = embeddedId(pack.name, key, 'items', i); return { _id: iid, _key: `!actors.items!${id}.${iid}`, ...it, effects: [], flags: {} }; }),
        effects: (body.effects ?? []).map((ef, i) => { const eid = embeddedId(pack.name, key, 'effects', i); return { _id: eid, _key: `!actors.effects!${id}.${eid}`, ...ef }; }),
        ownership: { default: 0 },
        flags: { [SYSTEM_ID]: { pack: pack.name, key, ...(body.flags?.[SYSTEM_ID] ?? {}) } },
      };
    } else {
      errors.push(`${pack.name}: build-packs cannot assemble a ${pack.type} document (the handbook has its own builder)`);
      return;
    }
    docs.push(doc);
  });

  return { docs, folders: [...folders.values()], errors, count: rows.length };
}

/** Write one pack's source directory (cleared first). Returns the file list. */
export function writePackSources(pack, { docs, folders }) {
  const dir = join(SRC_ROOT, pack.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const f of folders) {
    const file = `_folder_${safeName(f.name)}_${f._id}.json`;
    writeFileSync(join(dir, file), json(f));
    files.push(file);
  }
  for (const d of docs) {
    const file = `${safeName(d.name)}_${d._id}.json`;
    writeFileSync(join(dir, file), json(d));
    files.push(file);
  }
  return files.sort();
}

/** sha256 of a pack's document ids, sorted - the "same documents" fingerprint MANIFEST.json records. */
export const idsHash = (ids) => sha256hex([...ids].sort().join('\n'));

/** The MANIFEST.json entry for one written pack directory. */
export function manifestEntry(dir, type) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const ids = [];
  let folders = 0;
  const contents = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const doc = JSON.parse(text);
    if (String(doc._key).startsWith('!folders!')) folders++; else ids.push(doc._id);
    contents.push(`${f}\n${text}`);
  }
  return { type, count: ids.length, folders, idsHash: idsHash(ids), contentHash: sha256hex(contents.join('\n')) };
}

async function compileOne(name) {
  const { compilePack } = await import('@foundryvtt/foundryvtt-cli');
  const src = join(SRC_ROOT, name);
  const dest = join(OUT_ROOT, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(OUT_ROOT, { recursive: true });
  // compilePack option names verified against node_modules/@foundryvtt/foundryvtt-cli/lib/package.mjs:
  // { nedb=false, yaml=false, recursive=false, log=false, transformEntry }.
  await compilePack(src, dest, { nedb: false, yaml: false, recursive: false, log: false });
}

// ---- main -------------------------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  const info = assertFreshBundle({ allowStale: ALLOW_STALE });
  const M = await import(pathToFileURL(join(HERE, 'pack-manifest.mjs')).href);
  const engine = M.engine;
  const packs = M.PACKS.filter((p) => !ONLY || p.name.includes(ONLY));
  if (!packs.length) die(`no pack matches --only ${ONLY}`);
  mkdirSync(SRC_ROOT, { recursive: true });

  const manifestPath = join(SRC_ROOT, 'MANIFEST.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { packs: {} };
  manifest.generatedAt = new Date().toISOString();
  manifest.bundle = { websiteCommit: info.websiteCommit ?? null, websiteDirty: info.websiteDirty ?? null, bundleGeneratedAt: info.generatedAt ?? null, bytes: info.bytes ?? null };
  manifest.packs ??= {};

  const failures = [];
  const compiled = [];
  for (const pack of packs) {
    if (pack.builder === 'handbook') {
      const dir = join(SRC_ROOT, pack.name);
      if (!existsSync(dir)) { console.warn(`build-packs: ${pack.name}: no packs-src/${pack.name} yet - run npm run build:handbook`); continue; }
      manifest.packs[pack.name] = manifestEntry(dir, pack.type);
      if (COMPILE) { await compileOne(pack.name); compiled.push(pack.name); }
      console.log(`build-packs: ${pack.name.padEnd(20)} ${String(manifest.packs[pack.name].count).padStart(4)} ${pack.type} (from build-handbook-pack)`);
      continue;
    }
    const built = buildPackDocuments(pack, M, engine);
    if (built.errors.length) {
      failures.push(...built.errors);
      console.error(`build-packs: ${pack.name}: ${built.errors.length} error(s)`);
      for (const e of built.errors.slice(0, 8)) console.error('  - ' + e);
      continue;
    }
    writePackSources(pack, built);
    manifest.packs[pack.name] = manifestEntry(join(SRC_ROOT, pack.name), pack.type);
    if (COMPILE) { await compileOne(pack.name); compiled.push(pack.name); }
    console.log(`build-packs: ${pack.name.padEnd(20)} ${String(built.docs.length).padStart(4)} ${pack.type}${built.folders.length ? ` in ${built.folders.length} folders` : ''}`);
  }
  // Packs are written in manifest order, sorted for a stable file.
  manifest.packs = Object.fromEntries(Object.entries(manifest.packs).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(manifestPath, json(manifest));

  if (failures.length) {
    console.error(`build-packs: FAILED - ${failures.length} error(s); packs with errors were not written`);
    process.exit(1);
  }
  const total = Object.values(manifest.packs).reduce((n, p) => n + p.count, 0);
  console.log(`build-packs: ${Object.keys(manifest.packs).length} packs, ${total} documents${COMPILE ? `, ${compiled.length} compiled to packs/` : ' (sources only)'} in ${Date.now() - t0} ms`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
