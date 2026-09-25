#!/usr/bin/env node
// check:handbook
//
// SUBJECT: the handbook JournalEntry pack (docs/ARCHITECTURE.md §8) as
// tools/build-handbook-pack.mjs wrote it - packs-src/handbook/*.json,
// handbook/*.json and handbook/handbook-map.json - held against the
// website's public/handbook, which is the corpus every figure below is
// MEASURED from (never a literal rebuilt here):
//   1. the 25 JSON files under handbook/ are byte-identical to the website's;
//   2. 24 entries, one per chapter, in chapter order, deterministic ids;
//   3. layout B: per chapter, pages = h2 count + 1 Overview when prose precedes the
//      first h2 (169 today: 147 h2 + 22 overviews; Ch7 and Ch19 open on an h2);
//      page names are the h2 headings in order; every page carries its LevelDB key;
//   4. every heading the index lists (1459) is in handbook-map.json for its chapter,
//      in order, pointing at a page of that entry, with an in-page anchor that exists
//      as an `id` in that page's HTML (h2 pages resolve to the page itself);
//   5. every sidecar table (278) is rendered exactly once, at its marker;
//   6. every HANDBOOK_CHIP_TARGETS target (the sheet's chips) resolves through the map;
//   7. the era guard is clean over every rendered page - AND the naive grep without
//      the allow-list is NOT clean (the allow-list is load-bearing; a guard whose
//      positive control finds nothing has no denominator);
//   8. every @UUID link names an entry of this pack; no `**` survives rendering;
//   9. the compiled packs/handbook LevelDB holds 24 + 169 keys and reads back.
//
// THE REJECTED ALTERNATIVE, against the app's own code path: one page per
// chapter (layout A). Ch19 is 366 headings and 894 sections; a 169-page
// layout is what lets `page.parent.sheet.render(true, { pageId, anchor })`
// land on a section. The pin holds the page count to the h2 rule, so a
// builder that fell back to one page per chapter (24) is red.
//
// MUTATIONS FIRED (each turned this check red, then was restored):
//   - handbook/ch07-combat.json: one byte appended -> "byte-identical to the website" pin
//   - packs-src/handbook/ch01-*.json: a page deleted -> page-count and map pins
//   - handbook/handbook-map.json: "Hit Locations" anchor -> "hit-location" -> anchor-exists pin (52/53 resolve)
//   - packs-src/handbook/ch01-*.json: "<p>the Rebellion regrouped</p>" appended to a page -> era guard pin
//   - (the builder's own guard) build-handbook-pack.mjs ERA_ALLOWED_SENTENCES emptied -> the BUILD exits 1 with the
//     five bare "the Empire" sentences listed; restored and rebuilt clean
//
//   node scripts/check-handbook.mjs

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReporter, ROOT, WEB } from './lib/harness.mjs';

const { ok, fail, report } = makeReporter('check:handbook');
const B = await import(pathToFileURL(join(ROOT, 'tools', 'build-handbook-pack.mjs')).href);
const M = await import(pathToFileURL(join(ROOT, 'tools', 'pack-manifest.mjs')).href);
const engine = M.engine;

const WEB_HB = join(WEB, 'public', 'handbook');
const HB = join(ROOT, 'handbook');
const SRC = join(ROOT, 'packs-src', 'handbook');
if (!existsSync(join(WEB_HB, 'index.json'))) fail(`website handbook missing at ${WEB_HB}`);
if (!existsSync(SRC)) fail('packs-src/handbook missing - run npm run build:handbook');
if (!existsSync(join(HB, 'handbook-map.json'))) fail('handbook/handbook-map.json missing - run npm run build:handbook');

// ---- 1. copies byte-identical ---------------------------------------------------------------------------------
const index = JSON.parse(readFileSync(join(WEB_HB, 'index.json'), 'utf8'));
const files = ['index.json', ...index.chapters.map((c) => `${c.id}.json`)];
ok('the website index lists 24 chapters (denominator)', index.chapters.length === 24, `${index.chapters.length}`);
for (const f of files) {
  const a = existsSync(join(HB, f)) ? readFileSync(join(HB, f)) : null;
  ok(`handbook/${f} is byte-identical to the website's`, a && a.equals(readFileSync(join(WEB_HB, f))));
}
ok('handbook/ carries no stray chapter file', readdirSync(HB).filter((f) => f.endsWith('.json') && f !== 'handbook-map.json').every((f) => files.includes(f)));

// ---- 2. entries -----------------------------------------------------------------------------------------------
const entryFiles = readdirSync(SRC).filter((f) => f.endsWith('.json')).sort();
const entries = entryFiles.map((f) => JSON.parse(readFileSync(join(SRC, f), 'utf8')));
ok('24 JournalEntry documents', entries.length === 24, `${entries.length}`);
const byChapter = new Map(entries.map((e) => [e.flags?.shadowbase?.key, e]));
ok('every chapter has exactly one entry, in chapter order', index.chapters.every((c, i) => byChapter.get(c.id) && entries[i]?.flags?.shadowbase?.key === c.id));
for (const e of entries) {
  const cid = e.flags?.shadowbase?.key;
  ok(`${cid}: _id is the deterministic documentId`, e._id === M.documentId('handbook', cid) && e._key === `!journal!${e._id}`);
  ok(`${cid}: name is the chapter title`, e.name === JSON.parse(readFileSync(join(WEB_HB, `${cid}.json`), 'utf8')).title);
}

// ---- 3. layout B page rule, measured from the chapter JSON ------------------------------------------------------
const map = JSON.parse(readFileSync(join(HB, 'handbook-map.json'), 'utf8'));
let pagesTotal = 0; let h2Total = 0; let overviews = 0; let tablesTotal = 0; let linksTotal = 0; let tablesRendered = 0;
const entryIds = new Set(entries.map((e) => e._id));
const NAIVE = /\b(Empire|Rebellion|Bespin|Cloud City)\b/g;
let naiveHits = 0; let eraProblems = []; let suspect = 0; let doubleStar = 0;
for (const c of index.chapters) {
  const chapter = JSON.parse(readFileSync(join(WEB_HB, `${c.id}.json`), 'utf8'));
  const e = byChapter.get(c.id);
  if (!e) continue;
  const h2s = chapter.sections.filter((s) => s.type === 'h2').map((s) => String(s.content));
  const hasPreamble = chapter.sections.length > 0 && chapter.sections[0].type !== 'h2';
  const expectedPages = h2s.length + (hasPreamble ? 1 : 0);
  h2Total += h2s.length; if (hasPreamble) overviews++;
  pagesTotal += e.pages.length;
  ok(`${c.id}: ${expectedPages} pages (${h2s.length} h2 + ${hasPreamble ? 1 : 0} overview)`, e.pages.length === expectedPages, `${e.pages.length}`);
  const names = e.pages.map((p) => p.name);
  ok(`${c.id}: page names are the h2 headings in order${hasPreamble ? ' after Overview' : ''}`, JSON.stringify(names) === JSON.stringify(hasPreamble ? [B.OVERVIEW_TITLE, ...h2s] : h2s));
  e.pages.forEach((p, i) => {
    ok(`${c.id} page ${i}: deterministic id and embedded key`, p._id === M.pageId('handbook', c.id, i) && p._key === `!journal.pages!${e._id}.${p._id}` && p.type === 'text' && p.text?.format === 1 && typeof p.text?.content === 'string');
  });
  // 4. headings mapped
  const m = map.chapters[c.id];
  ok(`${c.id}: map entry with entryId`, m && m.entryId === e._id);
  if (!m) continue;
  const mapped = m.headings.map((h) => h.heading);
  ok(`${c.id}: map lists the index's ${c.headings.length} headings in order`, JSON.stringify(mapped) === JSON.stringify(c.headings), `${mapped.length} mapped`);
  const pageById = new Map(e.pages.map((p) => [p._id, p]));
  let anchorsOk = 0;
  for (const h of m.headings) {
    const page = pageById.get(h.pageId);
    if (!page) { ok(`${c.id}: heading "${h.heading}" points at a page of its entry`, false, h.pageId); continue; }
    if (h.level === 2) { if (page.name === h.heading && h.anchor === null) anchorsOk++; else ok(`${c.id}: h2 "${h.heading}" resolves to its own page`, false); continue; }
    if (page.text.content.includes(` id="${h.anchor}"`)) anchorsOk++; else ok(`${c.id}: anchor "${h.anchor}" for "${h.heading}" exists in its page`, false);
  }
  ok(`${c.id}: every mapped heading resolves (${anchorsOk}/${m.headings.length})`, anchorsOk === m.headings.length);
  ok(`${c.id}: byHeading resolves every heading name to its first occurrence`, c.headings.every((h) => m.byHeading[h] && m.byHeading[h].heading === h));
  // 5. tables at markers, 7. era, 8. links / markup
  tablesTotal += chapter.tables.length;
  const rendered = new Map();
  for (const p of e.pages) {
    for (const mm of p.text.content.matchAll(/<div class="sb-handbook-table[^"]*" data-table-id="([^"]*)">/g)) rendered.set(mm[1], (rendered.get(mm[1]) ?? 0) + 1);
    for (const l of p.text.content.matchAll(/@UUID\[Compendium\.shadowbase\.handbook\.JournalEntry\.([A-Za-z0-9]{16})\]\{Chapter \d+\}/g)) { linksTotal++; if (!entryIds.has(l[1])) ok(`${c.id}: link target ${l[1]} is an entry of this pack`, false); }
    const otherLinks = (p.text.content.match(/@UUID\[/g) ?? []).length - (p.text.content.match(/@UUID\[Compendium\.shadowbase\.handbook\.JournalEntry\.[A-Za-z0-9]{16}\]\{Chapter \d+\}/g) ?? []).length;
    if (otherLinks) ok(`${c.id} / ${p.name}: only Chapter-N links are enriched`, false, `${otherLinks} other @UUID`);
    // A `**...**` run the reference renderer's own regex (`\*\*[^*]+\*\*`, handbook-chapter-reader.tsx
    // renderInline) WOULD have rendered is a rendering gap here. A run the regex cannot close - a bold
    // label that itself contains an asterisk, Ch12's "**Reach (*):**" - survives on the website too.
    doubleStar += (p.text.content.match(/\*\*[^*]+\*\*/g) ?? []).length;
    const text = `${p.name}\n${p.text.content}`;
    eraProblems.push(...B.eraHits(text).map((h) => `${c.id} / ${p.name}: ${h.term} ...${h.context}...`));
    suspect += B.eraHits(text, B.ERA_SUSPECT).length;
    naiveHits += (text.match(NAIVE) ?? []).length;
  }
  tablesRendered += [...rendered.values()].reduce((a, b) => a + b, 0);
  ok(`${c.id}: every sidecar table rendered exactly once at its marker (${chapter.tables.length})`, chapter.tables.every((t) => rendered.get(String(t.id)) === 1) && rendered.size === chapter.tables.length, `${rendered.size} rendered`);
}
ok('169 pages = 147 h2 + 22 overviews (measured)', pagesTotal === h2Total + overviews, `${pagesTotal} pages, ${h2Total} h2, ${overviews} overviews`);
ok('page total equals ARCHITECTURE §8\'s 169', pagesTotal === 169, `${pagesTotal}`);
const indexHeadings = index.chapters.reduce((n, c) => n + c.headings.length, 0);
const mappedHeadings = Object.values(map.chapters).reduce((n, m) => n + m.headings.length, 0);
ok(`headings mapped equals the index total (${indexHeadings})`, mappedHeadings === indexHeadings, `${mappedHeadings}`);
ok('1459 headings mapped (ARCHITECTURE §8)', mappedHeadings === 1459);
ok('278 tables rendered (ARCHITECTURE §8)', tablesRendered === 278 && tablesTotal === 278, `${tablesRendered} rendered of ${tablesTotal}`);
ok('no `**` markup survives rendering', doubleStar === 0, `${doubleStar} pages`);
ok('chapter links present and every one names an entry', linksTotal > 400, `${linksTotal}`);

// ---- 6. chip targets --------------------------------------------------------------------------------------------
const chips = Object.entries(engine.handbookRegistry.HANDBOOK_CHIP_TARGETS);
ok('HANDBOOK_CHIP_TARGETS has the sheet\'s 7 chips (denominator)', chips.length === 7, `${chips.length}`);
for (const [id, t] of chips) {
  const m = map.chapters[t.chapterId];
  const hit = m && (t.heading ? m.byHeading[t.heading] : { entryId: m.entryId, pageId: m.pages[0]?.pageId, anchor: null });
  ok(`chip "${id}" -> ${t.chapterId} / ${t.heading ?? '(top)'} resolves to { entryId, pageId, anchor }`, !!(hit && hit.entryId && hit.pageId), JSON.stringify(hit));
}

// ---- 7. era guard ---------------------------------------------------------------------------------------------------
ok('era guard clean over every rendered page (allow-list applied)', eraProblems.length === 0, eraProblems.slice(0, 3).join(' | '));
ok('the naive grep WITHOUT the allow-list is NOT clean (the allow-list is load-bearing)', naiveHits > 0, `${naiveHits}`);
ok('the guard has teeth on a control string', B.eraHits('the Rebellion regrouped at Bespin').length === 2);
ok('the allow-list masks exactly its phrases (Sith Empire passes, bare Empire fails)', B.eraHits('the Sith Empire').length === 0 && B.eraHits('the Galactic Empire').length === 1);
console.log(`check:handbook: ${suspect} Galactic-Civil-War term(s) in the book itself reported by the builder (not failures; docs/REQUESTS.md)`);

// ---- 9. compiled pack reads back -----------------------------------------------------------------------------------
const packDir = join(ROOT, 'packs', 'handbook');
if (ok('packs/handbook compiled (run npm run build:handbook)', existsSync(join(packDir, 'CURRENT')))) {
  const { ClassicLevel } = await import('classic-level');
  const db = new ClassicLevel(packDir, { keyEncoding: 'utf8', valueEncoding: 'json' });
  await db.open();
  const keys = await db.keys().all();
  const journal = keys.filter((k) => k.startsWith('!journal!'));
  const pages = keys.filter((k) => k.startsWith('!journal.pages!'));
  ok('LevelDB holds 24 entries and 169 pages', journal.length === 24 && pages.length === 169, `${journal.length} entries, ${pages.length} pages, ${keys.length} keys`);
  const first = await db.get(journal[0]);
  ok('a stored entry lists its page ids and carries no _key', Array.isArray(first.pages) && first.pages.every((p) => typeof p === 'string') && !('_key' in first));
  await db.close();
}

report(`24 entries, ${pagesTotal} pages, ${Object.values(map.chapters).reduce((n, m) => n + m.headings.length, 0)} headings, ${tablesRendered} tables, ${linksTotal} links`);
