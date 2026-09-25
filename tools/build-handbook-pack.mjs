#!/usr/bin/env node
// tools/build-handbook-pack.mjs
//
// The rulebook as a JournalEntry compendium (docs/ARCHITECTURE.md §8, layout
// B of the phase-1 handbook-journal report): one JournalEntry per chapter,
// one text page per top-level h2 plus an "Overview" page for the prose that
// precedes the first h2 (a chapter that opens on an h2 - Ch7, Ch19 - has no
// Overview page). 24 entries; 147 h2 + 22 overviews = 169 pages, measured
// from the website's public/handbook at build time and printed.
//
//   node tools/build-handbook-pack.mjs              # copy JSON, render, write packs-src/handbook, compile packs/handbook
//   node tools/build-handbook-pack.mjs --no-compile
//
// Inputs: the website's public/handbook/*.json (index + 24 chapters), the
// files `npm run sync:handbook` generates there. They are copied UNCHANGED to
// handbook/ so the bundled handbookSearch.searchChapters (through
// tools/shims/handbook-loader.ts) reads the same corpus the pages were
// rendered from; check:handbook pins the copies byte-identical.
//
// THE HTML RECIPE (handbook-chapter-reader.tsx is the reference renderer):
//   p      -> <p>, inline **bold** -> <strong>, *italic* -> <em> (labeled-bold
//             run-ins like "**Taking Damage:** ..." stay in the paragraph);
//   list   -> <ul><li>...</li></ul>, inline markup per item;
//   h3..h6 -> <h3 id="<slug>">..</h6 id="<slug>"> at the book's own level
//             (the page title is the h2), a page-scoped ASCII slug anchor;
//   table  -> the sidecar table at its marker: <div class="sb-handbook-table
//             [--wide]"><table><thead>headers</thead><tbody>rows</tbody>
//             </table></div>, cells from Object.values(row) in column order
//             (repeated headers are suffixed "DR_2" by the converter, so keys
//             are not column names), "\n" -> <br>, wide = more than
//             WIDE_TABLE_COLUMNS columns.
//   "Chapter N" mentions -> @UUID[Compendium.shadowbase.handbook.JournalEntry.<id>]{Chapter N}
//   (the entry the chapter renders to). "ChNN" shorthands are left as text.
//
// ERA GUARD. The book is 3964 BBY and must never drift into the Galactic
// Civil War; the rendered pages are grepped for its vocabulary and a hit
// fails the build. The naive grep (Empire|Rebellion|Bespin|Cloud City) fails
// on the book itself 32 times, all of them "Sith Empire", "Infinite Empire",
// "Rakata Empire", "Fallen Empire" or a bare "the Empire" that means the Sith
// Empire in its sentence - so the guard masks a DECLARED allow-list first:
// ERA_ALLOWED_PHRASES (qualified empires) and ERA_ALLOWED_SENTENCES (the five
// bare uses, verbatim fragments). A sixth bare "the Empire" - or any
// Rebellion/Bespin/Death Star - is a build failure that a human reviews.
//
// handbook/handbook-map.json: chapterId + heading -> { entryId, pageId,
// anchor, level } for every heading (1459), first occurrence per name kept
// in `byHeading`, every occurrence in `headings`; the HUD's chips resolve
// through it (handbookRegistry.HANDBOOK_CHIP_TARGETS) and check:handbook pins
// every chip target.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const WEB = resolve(process.env.SHADOWBASE_WEBSITE ?? join(ROOT, '..', 'ShadowBase Website'));
const WEB_HANDBOOK = join(WEB, 'public', 'handbook');
export const HANDBOOK_DIR = join(ROOT, 'handbook');
export const PACK_NAME = 'handbook';
export const SYSTEM_ID = 'shadowbase';
export const WIDE_TABLE_COLUMNS = 4;
export const OVERVIEW_TITLE = 'Overview';
export const CHAPTER_COUNT = 24;

const argv = process.argv.slice(2);
const COMPILE = !argv.includes('--no-compile');
const die = (msg) => { console.error(`build-handbook-pack: ${msg}`); process.exit(1); };

// ---- era guard --------------------------------------------------------------------------------------
/** Qualified empires of 3964 BBY (masked before the grep). */
export const ERA_ALLOWED_PHRASES = Object.freeze([
  'Sith Empire', 'Sith-Empire', 'Infinite Empire', 'Rakata Empire', 'Fallen Empire',
]);
/** Bare "the Empire" that the book uses for the Sith Empire, verbatim fragments (a sixth is a review). */
export const ERA_ALLOWED_SENTENCES = Object.freeze([
  'A Sith Master or the Empire provides you with training',
  'As a gift from your Master or the Empire',
  'Created 4,000 years before the Empire by Sith Lord Darth Drear',
  'resources are a secret of the Empire',
  'something the Empire will kill to keep buried',
]);
/** The era guard proper: a hit outside the allow-list FAILS the build. */
export const ERA_FORBIDDEN = /\b(Empire|Rebellion|Bespin|Cloud City)\b/g;
/**
 * Wider Galactic-Civil-War vocabulary, REPORTED not failing: the shipped book
 * carries seven of these itself (Ch19's creature lore names Darth Vader, the
 * Death Star, Luke Skywalker and Palpatine; Ch3 and Ch10 say "Imperial"), and
 * the rulebook is Fulllion's to edit, not this repo's. The build prints them
 * so the drift is visible on every run; docs/REQUESTS.md carries the list.
 */
export const ERA_SUSPECT = /\b(Imperial|Rebel Alliance|Death Star|Stormtrooper|Palpatine|Skywalker|Vader)\b/g;

/** Every era hit in a rendered text after the allow-list is masked. */
export function eraHits(text, pattern = ERA_FORBIDDEN) {
  let masked = text;
  for (const p of ERA_ALLOWED_PHRASES) masked = masked.split(p).join('#'.repeat(p.length));
  for (const s of ERA_ALLOWED_SENTENCES) masked = masked.split(s).join('#'.repeat(s.length));
  const hits = [];
  for (const m of masked.matchAll(pattern)) {
    hits.push({ term: m[1], at: m.index, context: text.slice(Math.max(0, m.index - 60), m.index + m[1].length + 40).replace(/\s+/g, ' ') });
  }
  return hits;
}

// ---- html --------------------------------------------------------------------------------------------
export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The reader's renderInline: `**bold**` and `*italic*` (on already-escaped text). */
export function inline(text) {
  const parts = escapeHtml(text).split(/(\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*))/g);
  return parts.map((part) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return `<strong>${bold[1]}</strong>`;
    const italic = part.match(/^\*([^*]+)\*$/);
    if (italic) return `<em>${italic[1]}</em>`;
    return part;
  }).join('');
}

/** A page-scoped ASCII slug for a heading (Foundry reads a heading's `id` as its anchor). */
export function slugify(text) {
  return String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** Table cells: Object.values(row) in column order (rowCells in the reader), "\n" -> <br>. */
export function renderTable(table) {
  const columns = table.headers.length;
  const cellsOf = (row) => { const v = Object.values(row ?? {}).map((x) => String(x ?? '')); while (v.length < columns) v.push(''); return v; };
  const wide = columns > WIDE_TABLE_COLUMNS ? ' sb-handbook-table--wide' : '';
  const caption = table.context?.trim() ? `<caption>${inline(table.context.trim())}</caption>` : '';
  const head = `<thead><tr>${table.headers.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${(table.rows ?? []).map((row) => `<tr>${cellsOf(row).map((c) => `<td>${inline(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="sb-handbook-table${wide}" data-table-id="${escapeHtml(table.id ?? '')}"><table>${caption}${head}${body}</table></div>`;
}

/**
 * Split a chapter into pages: an Overview (prose before the first h2, when
 * any) and one page per h2, each page carrying its sections in order.
 */
export function paginate(chapter) {
  const pages = [];
  let current = null;
  for (const section of chapter.sections) {
    if (section.type === 'h2') {
      current = { heading: String(section.content), sections: [] };
      pages.push(current);
      continue;
    }
    if (!current) {
      current = { heading: OVERVIEW_TITLE, overview: true, sections: [] };
      pages.push(current);
    }
    current.sections.push(section);
  }
  return pages;
}

/**
 * Render one page's sections. Returns { html, anchors: [{ heading, level, anchor }], tables }.
 * Anchor slugs are unique within the page (a repeated heading gets -2, -3, ...).
 */
export function renderPage(page, tablesById) {
  const out = [];
  const anchors = [];
  const used = new Map();
  const tables = [];
  for (const section of page.sections) {
    const h = /^h([1-6])$/.exec(section.type);
    if (h) {
      const level = Number(h[1]);
      const heading = String(section.content);
      let slug = slugify(heading);
      const n = (used.get(slug) ?? 0) + 1;
      used.set(slug, n);
      if (n > 1) slug = `${slug}-${n}`;
      anchors.push({ heading, level, anchor: slug });
      out.push(`<h${level} id="${slug}">${inline(heading)}</h${level}>`);
      continue;
    }
    if (section.type === 'table') {
      const id = String(section.content?.tableId ?? '');
      const table = tablesById.get(id);
      if (!table) throw new Error(`table marker "${id}" has no sidecar table`);
      tables.push(id);
      out.push(renderTable(table));
      continue;
    }
    if (section.type === 'list') {
      out.push(`<ul>${section.content.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }
    if (section.type === 'p' || section.type === 'note') {
      out.push(`<p>${inline(section.content)}</p>`);
      continue;
    }
    throw new Error(`unknown section type "${section.type}"`);
  }
  return { html: out.join('\n'), anchors, tables };
}

/** "Chapter N" -> a content link to that chapter's entry (N must be a chapter that exists). */
export function enrichChapterLinks(html, entryIdByNumber) {
  return html.replace(/\bChapter (\d{1,2})\b/g, (m, n) => {
    const id = entryIdByNumber.get(Number(n));
    return id ? `@UUID[Compendium.${SYSTEM_ID}.${PACK_NAME}.JournalEntry.${id}]{${m}}` : m;
  });
}

// ---- main ---------------------------------------------------------------------------------------------
export async function buildHandbook({ compile = COMPILE, log = console.log } = {}) {
  if (!existsSync(join(WEB_HANDBOOK, 'index.json'))) die(`website handbook missing at ${WEB_HANDBOOK} (run npm run sync:handbook there)`);
  const M = await import(pathToFileURL(join(HERE, 'pack-manifest.mjs')).href);
  const { documentId, pageId, keyFor, SORT_DENSITY } = M;

  // 1. copy the 25 JSON files unchanged
  mkdirSync(HANDBOOK_DIR, { recursive: true });
  const index = JSON.parse(readFileSync(join(WEB_HANDBOOK, 'index.json'), 'utf8'));
  const files = ['index.json', ...index.chapters.map((c) => `${c.id}.json`)];
  for (const f of files) copyFileSync(join(WEB_HANDBOOK, f), join(HANDBOOK_DIR, f));
  for (const stale of readdirSync(HANDBOOK_DIR).filter((f) => f.endsWith('.json') && f !== 'handbook-map.json' && !files.includes(f))) rmSync(join(HANDBOOK_DIR, stale));
  if (index.chapters.length !== CHAPTER_COUNT) die(`expected ${CHAPTER_COUNT} chapters in index.json, found ${index.chapters.length}`);

  // 2. ids first (links need every entry id before any page renders)
  const chapters = index.chapters.map((c) => ({ meta: c, chapter: JSON.parse(readFileSync(join(WEB_HANDBOOK, `${c.id}.json`), 'utf8')) }));
  const entryIdByNumber = new Map();
  for (const { meta } of chapters) {
    const n = Number(/^ch(\d+)-/.exec(meta.id)?.[1]);
    if (!n) die(`chapter id "${meta.id}" carries no number`);
    entryIdByNumber.set(n, documentId(PACK_NAME, meta.id));
  }

  // 3. render
  const docs = [];
  const map = { generatedAt: index.generatedAt, pack: PACK_NAME, system: SYSTEM_ID, chapters: {} };
  const eraProblems = [];
  const eraWarnings = [];
  let pageCount = 0; let headingCount = 0; let tableCount = 0; let linkCount = 0;
  for (const [ci, { meta, chapter }] of chapters.entries()) {
    const entryId = entryIdByNumber.get(Number(/^ch(\d+)-/.exec(meta.id)[1]));
    const tablesById = new Map((chapter.tables ?? []).map((t) => [String(t.id ?? ''), t]));
    const pages = paginate(chapter);
    const entryMap = { entryId, title: chapter.title, pages: [], headings: [], byHeading: {} };
    const pageDocs = [];
    const renderedTables = new Set();
    pages.forEach((page, pi) => {
      const pid = pageId(PACK_NAME, meta.id, pi);
      const { html, anchors, tables } = renderPage(page, tablesById);
      tables.forEach((t) => renderedTables.add(t));
      const content = enrichChapterLinks(html, entryIdByNumber);
      linkCount += (content.match(/@UUID\[/g) ?? []).length;
      for (const hit of eraHits(`${page.heading}\n${html}`)) eraProblems.push(`${meta.id} / ${page.heading}: "${hit.term}" - ...${hit.context}...`);
      for (const hit of eraHits(`${page.heading}\n${html}`, ERA_SUSPECT)) eraWarnings.push(`${meta.id} / ${page.heading}: "${hit.term}" - ...${hit.context}...`);
      pageDocs.push({
        _id: pid,
        // Embedded pages carry their own LevelDB key (compileClassicLevel reads doc._key on every level).
        _key: `!journal.pages!${entryId}.${pid}`,
        name: page.heading,
        type: 'text',
        title: { show: true, level: 1 },
        text: { content, format: 1, markdown: '' },
        image: {},
        video: {},
        src: null,
        system: {},
        category: null,
        sort: (pi + 1) * SORT_DENSITY,
        ownership: { default: -1 },
        flags: { [SYSTEM_ID]: { handbook: { chapterId: meta.id, heading: page.overview ? null : page.heading, overview: !!page.overview, anchors: anchors.map((a) => a.anchor) } } },
      });
      entryMap.pages.push({ pageId: pid, name: page.heading, overview: !!page.overview });
      // The page's own h2 is an anchor target too (open the page, no in-page anchor).
      const record = (heading, level, anchor) => {
        const entry = { heading, level, entryId, pageId: pid, anchor };
        entryMap.headings.push(entry);
        if (!(heading in entryMap.byHeading)) entryMap.byHeading[heading] = entry;
      };
      if (!page.overview) record(page.heading, 2, null);
      for (const a of anchors) record(a.heading, a.level, a.anchor);
    });
    if (renderedTables.size !== (chapter.tables ?? []).length) die(`${meta.id}: ${renderedTables.size} table markers rendered but the sidecar holds ${chapter.tables.length} tables`);
    pageCount += pageDocs.length;
    headingCount += entryMap.headings.length;
    tableCount += renderedTables.size;
    map.chapters[meta.id] = entryMap;
    docs.push({
      _id: entryId,
      _key: keyFor('JournalEntry', entryId),
      name: chapter.title,
      pages: pageDocs,
      categories: [],
      folder: null,
      sort: (ci + 1) * SORT_DENSITY,
      ownership: { default: 0 },
      flags: { [SYSTEM_ID]: { pack: PACK_NAME, key: meta.id, handbook: { chapterId: meta.id, generatedAt: index.generatedAt, headings: meta.headings.length, tables: meta.tables } } },
    });
  }
  if (eraProblems.length) {
    console.error(`build-handbook-pack: ERA GUARD - ${eraProblems.length} hit(s) outside the declared allow-list:`);
    for (const p of eraProblems) console.error('  - ' + p);
    process.exit(1);
  }
  if (eraWarnings.length) {
    console.warn(`build-handbook-pack: era WARNING - ${eraWarnings.length} Galactic-Civil-War term(s) in the book itself (for the handbook's owner; see docs/REQUESTS.md):`);
    for (const p of eraWarnings) console.warn('  - ' + p);
  }
  if (headingCount !== index.chapters.reduce((n, c) => n + c.headings.length, 0)) die(`mapped ${headingCount} headings but the index lists ${index.chapters.reduce((n, c) => n + c.headings.length, 0)}`);

  // 4. write sources + map
  const dir = join(ROOT, 'packs-src', PACK_NAME);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const d of docs) writeFileSync(join(dir, `${d.flags[SYSTEM_ID].key}_${d._id}.json`), JSON.stringify(d, null, 2) + '\n');
  writeFileSync(join(HANDBOOK_DIR, 'handbook-map.json'), JSON.stringify(map, null, 2) + '\n');

  // 5. compile through the same compilePack as every other pack
  if (compile) {
    const { compilePack } = await import('@foundryvtt/foundryvtt-cli');
    const dest = join(ROOT, 'packs', PACK_NAME);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(join(ROOT, 'packs'), { recursive: true });
    await compilePack(dir, dest, { nedb: false, yaml: false, recursive: false, log: false });
  }
  // 6. record in MANIFEST.json (same entry shape as build-packs)
  const B = await import(pathToFileURL(join(HERE, 'build-packs.mjs')).href);
  const manifestPath = join(ROOT, 'packs-src', 'MANIFEST.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { packs: {} };
  manifest.packs ??= {};
  manifest.packs[PACK_NAME] = { ...B.manifestEntry(dir, 'JournalEntry'), pages: pageCount, headings: headingCount, tables: tableCount, links: linkCount, eraWarnings: eraWarnings.length, handbookGeneratedAt: index.generatedAt };
  manifest.packs = Object.fromEntries(Object.entries(manifest.packs).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  log(`build-handbook-pack: ${docs.length} entries, ${pageCount} pages, ${headingCount} headings mapped, ${tableCount} tables, ${linkCount} chapter links${compile ? ', compiled to packs/handbook' : ''}`);
  return { entries: docs.length, pages: pageCount, headings: headingCount, tables: tableCount, links: linkCount };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildHandbook().catch((err) => { console.error(err); process.exit(1); });
}
