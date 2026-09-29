// module/apps/handbook-browser.mjs
//
// The rulebook browser (docs/ARCHITECTURE.md §8): the website's
// handbook-browser.tsx + handbook-chapter-reader.tsx moved onto Foundry. It
// reads the SAME 25 JSON files the JournalEntry pack was generated from
// (handbook/index.json + chNN-*.json, shipped unchanged and fetched through
// the bundled handbookLoader shim at systems/shadowbase/handbook/...), so the
// search the player runs mid-session is the website's own
// engine.handbookSearch.searchChapters over the website's own corpus - every
// word in any order, table rows searched under the table's context, ranked,
// capped at 60 (handbook-search.ts). Nothing here re-implements a search
// rule: the tier-1 heading filter is the browser component's own predicate
// (handbook-browser.tsx `results` useMemo, "every word, any order",
// 2026-09-06), copied because it lives in the component, not the lib.
//
// The UX rules ported verbatim from handbook-browser.tsx:
//   - heading search is free and runs on every keystroke off the index;
//   - full text runs on Enter, on the "Search inside chapters" button, and BY
//     ITSELF 450 ms after the heading filter comes up empty for a query of 3+
//     characters ("no dead ends");
//   - a new query invalidates the previous full-text results;
//   - a full-text hit opens its chapter AT the heading and drops the heading
//     filter (the term is in the body, not the title);
//   - a chapter's open sections are remembered for the session; "Collapse all"
//     shows the count; a chip's focus re-opens even when the same place is
//     asked for twice (the nonce - here openAt() is imperative, so no nonce).
//
// Two things the website does not have:
//   - "Open in Journal": the same place in the handbook JournalEntry pack
//     through handbook/handbook-map.json (chapterId + heading -> { entryId,
//     pageId, anchor }), for a player who wants the full-width page;
//   - the block renderer (renderInline / renderTable / renderSections) is
//     tools/build-handbook-pack.mjs's HTML rendering, copied here because that
//     tool imports node builtins and cannot ship to the browser; check:hud
//     pins the two byte-identical over the whole corpus, and docs/REQUESTS.md
//     asks the tool's owner to import these instead.
//
// This file has TWO faces so the HUD and a standalone window share one
// implementation: `HandbookBrowser` is the state + context + action object a
// host application embeds (the HUD's Handbook tab), `HandbookBrowserApp` is
// the ApplicationV2 window around it.

import { engine } from '../engine.mjs';

export const SYSTEM_ID = 'shadowbase';
export const HANDBOOK_BASE = 'systems/shadowbase/handbook';
export const HANDBOOK_PACK = 'handbook';
export const BROWSER_TEMPLATE = 'systems/shadowbase/templates/handbook/browser.hbs';

/** handbook-browser.tsx: the auto full-text search fires 450 ms after the heading filter misses. */
export const DEEP_SEARCH_DELAY_MS = 450;
/** handbook-browser.tsx: the auto search needs 3+ characters; the button/Enter need 2+. */
export const DEEP_SEARCH_AUTO_MIN = 3;
export const DEEP_SEARCH_MIN = 2;
/** handbook-search.ts: `limit = 60`; the count line shows "60+" at the cap. */
export const SEARCH_LIMIT = 60;
/** handbook-search.ts FETCH_CONCURRENCY. */
export const FETCH_CONCURRENCY = 6;
/** handbook-browser.tsx: the chapter list shows three matching headings, then "+N more". */
export const HEADING_HITS_SHOWN = 3;
/** tools/build-handbook-pack.mjs WIDE_TABLE_COLUMNS: a table wider than this scrolls in its wrapper. */
export const WIDE_TABLE_COLUMNS = 4;
/** tools/build-handbook-pack.mjs OVERVIEW_TITLE / handbook-chapter-reader.tsx "Overview" group. */
export const OVERVIEW_TITLE = 'Overview';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (level, message) => { globalThis.ui?.notifications?.[level]?.(message); return message; };

// ---------------------------------------------------------------------------
// Block rendering (tools/build-handbook-pack.mjs escapeHtml / inline / renderTable, copied)
// ---------------------------------------------------------------------------

/** tools/build-handbook-pack.mjs escapeHtml. */
export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** tools/build-handbook-pack.mjs inline: `**bold**` and `*italic*` on escaped text (the reader's renderInline). */
export function renderInline(text) {
  const parts = escapeHtml(text).split(/(\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*))/g);
  return parts.map((part) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return `<strong>${bold[1]}</strong>`;
    const italic = part.match(/^\*([^*]+)\*$/);
    if (italic) return `<em>${italic[1]}</em>`;
    return part;
  }).join('');
}

/** tools/build-handbook-pack.mjs renderTable: Object.values(row) in column order, padded, "\n" -> <br>. */
export function renderTable(table) {
  const columns = table.headers.length;
  const cellsOf = (row) => { const v = Object.values(row ?? {}).map((x) => String(x ?? '')); while (v.length < columns) v.push(''); return v; };
  const wide = columns > WIDE_TABLE_COLUMNS ? ' sb-handbook-table--wide' : '';
  const caption = table.context?.trim() ? `<caption>${renderInline(table.context.trim())}</caption>` : '';
  const head = `<thead><tr>${table.headers.map((h) => `<th>${renderInline(h)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${(table.rows ?? []).map((row) => `<tr>${cellsOf(row).map((c) => `<td>${renderInline(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="sb-handbook-table${wide}" data-table-id="${escapeHtml(table.id ?? '')}"><table>${caption}${head}${body}</table></div>`;
}

/**
 * The body blocks of one heading group (no headings: the reader draws those as
 * triggers). A table marker resolves to its sidecar table; an unresolved
 * marker renders nothing (the reader returns null for it).
 * @param {{ type: string, content: any }[]} sections
 * @param {Map<string, object>} tablesById
 */
export function renderSections(sections, tablesById) {
  const out = [];
  for (const section of sections) {
    if (section.type === 'table') {
      const table = tablesById.get(String(section.content?.tableId ?? ''));
      if (table) out.push(renderTable(table));
      continue;
    }
    if (section.type === 'list') { out.push(`<ul>${section.content.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`); continue; }
    if (section.type === 'p' || section.type === 'note') { out.push(`<p>${renderInline(section.content)}</p>`); continue; }
    if (/^h[1-6]$/.test(section.type)) continue;
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// The heading tree (handbook-chapter-reader.tsx groupByHeading / filterGroups / pathToHeading)
// ---------------------------------------------------------------------------

/**
 * Split a chapter's flat section list into one group per heading, nested by
 * level (h2 > h3 > ...). Prose before the first heading becomes a synthetic
 * "Overview" root kept OFF the stack so the real h2s stay its siblings, not
 * its children (the reader's comment).
 * @returns {{ key: string, title: string, level: number, body: object[], children: object[] }[]}
 */
export function groupByHeading(chapter) {
  const roots = [];
  const stack = [];
  let current = null;
  let seq = 0;
  for (const section of chapter.sections ?? []) {
    const level = /^h([1-6])$/.exec(section.type)?.[1];
    if (level) {
      const title = String(section.content);
      const group = { key: `${seq++}-${title}`, title, level: Number(level), body: [], children: [] };
      while (stack.length && stack[stack.length - 1].level >= group.level) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(group); else roots.push(group);
      stack.push(group);
      current = group;
      continue;
    }
    if (!current) {
      current = { key: 'intro', title: loc('SHADOWBASE.Handbook.Overview') === 'SHADOWBASE.Handbook.Overview' ? OVERVIEW_TITLE : loc('SHADOWBASE.Handbook.Overview'), level: 1, body: [], children: [] };
      roots.push(current);
    }
    current.body.push(section);
  }
  return roots;
}

/** Keep a group when it or any descendant matches the needle (lower-cased substring), narrowing children. */
export function filterGroups(groups, needle) {
  const out = [];
  for (const g of groups) {
    if (g.title.toLowerCase().includes(needle)) { out.push(g); continue; }
    const children = filterGroups(g.children, needle);
    if (children.length) out.push({ ...g, children });
  }
  return out;
}

/** Every ancestor key of the group whose heading equals `heading` (trimmed, case-insensitive), plus its own; null when absent. */
export function pathToHeading(groups, heading) {
  const target = String(heading ?? '').trim().toLowerCase();
  for (const group of groups) {
    if (group.title.trim().toLowerCase() === target) return [group.key];
    const below = pathToHeading(group.children, heading);
    if (below) return [group.key, ...below];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 1: the heading filter (handbook-browser.tsx `results`)
// ---------------------------------------------------------------------------

/**
 * Chapters whose title or headings carry every word of the query (2+ chars,
 * any order); an empty query lists every chapter. `hits` are the matching
 * headings, so the click is informed.
 * @param {{ id: string, title: string, headings: string[] }[]} index
 * @param {string} query
 * @returns {{ chapter: object, hits: string[] }[]}
 */
export function headingResults(index, query) {
  if (!index) return [];
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return index.map((c) => ({ chapter: c, hits: [] }));
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 2);
  const matches = (text) => { const t = String(text ?? '').toLowerCase(); return tokens.length > 0 && tokens.every((tok) => t.includes(tok)); };
  return index
    .map((chapter) => ({ chapter, hits: (chapter.headings ?? []).filter((h) => matches(h)) }))
    .filter(({ chapter, hits }) => hits.length > 0 || matches(chapter.title));
}

// ---------------------------------------------------------------------------
// Loading (the bundled handbookLoader shim; tools/shims/handbook-loader.ts)
// ---------------------------------------------------------------------------

/**
 * The index's chapter list. The Foundry-side loader shim returns the whole
 * index document ({ generatedAt, chapters }) where the website's loader
 * returns the array - which is why the bundle's handbookSearch.loadAllChapters
 * finds nothing through the shim (`index.length` is undefined); both shapes
 * are accepted here and docs/REQUESTS.md asks the shim's owner to align it.
 */
export async function loadIndex() {
  const idx = await engine.handbookLoader.loadHandbookIndex();
  return Array.isArray(idx) ? idx : (idx?.chapters ?? []);
}

/** One chapter (cached by the loader). */
export async function loadChapter(id) {
  return engine.handbookLoader.loadHandbookChapter(id);
}

/**
 * Every chapter, FETCH_CONCURRENCY at a time (handbook-search.ts loadAllChapters,
 * over the index shape above). Repeats are free - the loader caches.
 * @param {(loaded: number, total: number) => void} [onProgress]
 */
export async function loadAllChapters(onProgress) {
  const index = await loadIndex();
  const out = [];
  let done = 0;
  for (let i = 0; i < index.length; i += FETCH_CONCURRENCY) {
    const batch = index.slice(i, i + FETCH_CONCURRENCY);
    const loaded = await Promise.all(batch.map((entry) => loadChapter(entry.id).catch(() => null)));
    for (const chapter of loaded) if (chapter) out.push(chapter);
    done += batch.length;
    onProgress?.(Math.min(done, index.length), index.length);
  }
  return out;
}

/** The website's ranked full-text search, through the bundle (handbook-search.ts searchChapters). */
export function searchChapters(chapters, query, limit = SEARCH_LIMIT) {
  return engine.handbookSearch.searchChapters(chapters, query, limit);
}

let mapPromise = null;
/** handbook/handbook-map.json (chapterId + heading -> journal entry / page / anchor), fetched once. */
export async function loadMap() {
  if (!mapPromise) {
    mapPromise = (async () => {
      const res = await fetch(`${HANDBOOK_BASE}/handbook-map.json`);
      if (!res.ok) throw new Error(`ShadowBase handbook: handbook-map.json -> HTTP ${res.status}`);
      return res.json();
    })().catch((err) => { mapPromise = null; throw err; });
  }
  return mapPromise;
}

/**
 * Where a chapter + heading lives in the JournalEntry pack (docs/REQUESTS.md,
 * U03's row): `map.chapters[chapterId].byHeading[heading]`, or the chapter's
 * first page when no heading is named / the heading is unmapped.
 * @returns {null|{ entryId: string, pageId: string|null, anchor: string|null }}
 */
export function journalTarget(map, chapterId, heading) {
  const chapter = map?.chapters?.[chapterId];
  if (!chapter) return null;
  const hit = heading ? chapter.byHeading?.[heading] : null;
  if (hit) return { entryId: hit.entryId ?? chapter.entryId, pageId: hit.pageId ?? null, anchor: hit.anchor ?? null };
  return { entryId: chapter.entryId, pageId: chapter.pages?.[0]?.pageId ?? null, anchor: null };
}

/** Open the same place in the handbook compendium (the page's sheet at the anchor). */
export async function openInJournal(chapterId, heading) {
  const map = await loadMap();
  const target = journalTarget(map, chapterId, heading);
  if (!target) { notify('warn', loc('SHADOWBASE.Handbook.JournalUnavailable')); return null; }
  const resolver = globalThis.fromUuid;
  if (typeof resolver !== 'function') { notify('warn', loc('SHADOWBASE.Handbook.JournalUnavailable')); return target; }
  const entry = await resolver(`Compendium.${SYSTEM_ID}.${HANDBOOK_PACK}.JournalEntry.${target.entryId}`);
  if (!entry?.sheet) { notify('warn', loc('SHADOWBASE.Handbook.JournalUnavailable')); return target; }
  await entry.sheet.render(true, { pageId: target.pageId ?? undefined, anchor: target.anchor ?? undefined });
  return target;
}

// ---------------------------------------------------------------------------
// The browser (state + context + actions), embeddable
// ---------------------------------------------------------------------------

/** Which open sections each chapter had, for the session (handbook-chapter-reader.tsx openSectionsByChapter). */
const openSectionsByChapter = new Map();

export class HandbookBrowser {
  /**
   * @param {{ onChange?: (browser: HandbookBrowser, reason: string) => void, timers?: { set: Function, clear: Function } }} [options]
   *   onChange  called whenever the view should re-render (the host renders its part)
   *   timers    setTimeout/clearTimeout (injectable so a check can run the debounce synchronously)
   */
  constructor({ onChange = null, timers = null } = {}) {
    this.onChange = onChange;
    this.timers = timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
    this.state = {
      index: null, indexError: null, loadingIndex: false,
      query: '',
      chapterId: null, chapter: null, chapterError: null, loadingChapter: false,
      focusHeading: null, scrollToKey: null,
      hits: null, hitsQuery: '', progress: null,
      timer: null,
    };
  }

  #emit(reason) { this.onChange?.(this, reason); }

  /** Load the index once (the chapter list and 1466 headings, ~39 KB). */
  async ensureIndex() {
    const s = this.state;
    if (s.index || s.loadingIndex) return s.index;
    s.loadingIndex = true;
    try { s.index = await loadIndex(); s.indexError = null; }
    catch (err) { s.indexError = err?.message ?? String(err); s.index = []; }
    finally { s.loadingIndex = false; }
    this.#emit('index');
    return s.index;
  }

  /** The tier-1 results for the current query. */
  headingResults() { return headingResults(this.state.index, this.state.query); }

  /**
   * The search box changed. Heading search re-runs on render; a changed query
   * drops the previous full-text results; and when the heading filter misses
   * on a 3+ character query the full text runs by itself after 450 ms.
   */
  setQuery(value) {
    const s = this.state;
    const q = String(value ?? '');
    if (q === s.query) return;
    s.query = q;
    if (s.hits && q.trim() !== s.hitsQuery) { s.hits = null; s.hitsQuery = ''; }
    this.#scheduleAutoSearch();
    this.#emit('query');
  }

  #scheduleAutoSearch() {
    const s = this.state;
    if (s.timer !== null) { this.timers.clear(s.timer); s.timer = null; }
    const q = s.query.trim();
    if (!s.index || q.length < DEEP_SEARCH_AUTO_MIN || s.hits || s.progress !== null) return;
    if (this.headingResults().length > 0) return;
    // The callback returns the search's promise (setTimeout ignores it; an injected timer can await it).
    s.timer = this.timers.set(() => { s.timer = null; return this.runDeepSearch(q); }, DEEP_SEARCH_DELAY_MS);
  }

  /**
   * Full text (Enter / the button / the auto search). `override` exists for
   * the same reason as on the website: a caller that sets the term and
   * searches at once must not search the previous term.
   */
  async runDeepSearch(override) {
    const s = this.state;
    const q = String(override ?? s.query).trim();
    if (q.length < DEEP_SEARCH_MIN || s.progress !== null) return null;
    s.progress = 0;
    this.#emit('searching');
    try {
      const chapters = await loadAllChapters((loaded, total) => { s.progress = Math.round((loaded / total) * 100); this.#emit('progress'); });
      s.hits = searchChapters(chapters, q);
      s.hitsQuery = q;
    } catch (err) {
      s.hits = [];
      s.hitsQuery = q;
      notify('warn', fmt('SHADOWBASE.Handbook.SearchFailed', { error: err?.message ?? String(err) }));
    } finally {
      s.progress = null;
    }
    this.#emit('hits');
    return s.hits;
  }

  clearHits() {
    const s = this.state;
    s.hits = null;
    s.hitsQuery = '';
    this.#emit('hits');
  }

  /**
   * Open a chapter, at a heading when one is named (a full-text hit or a
   * sheet chip): every ancestor of the heading opens and the reader scrolls
   * to it on render. A chip's request also clears the query and the hits so
   * a stale filter cannot hide the section it named.
   * @param {string} chapterId
   * @param {string} [heading]
   * @param {{ fromChip?: boolean }} [options]
   */
  async openAt(chapterId, heading, { fromChip = false } = {}) {
    const s = this.state;
    if (fromChip) { s.query = ''; s.hits = null; s.hitsQuery = ''; }
    s.chapterId = chapterId;
    s.focusHeading = heading ?? null;
    s.scrollToKey = null;
    s.chapterError = null;
    s.loadingChapter = true;
    this.#emit('chapter');
    try {
      const chapter = await loadChapter(chapterId);
      if (!chapter) throw new Error(chapterId);
      s.chapter = chapter;
      if (s.focusHeading) {
        const groups = groupByHeading(chapter);
        const path = pathToHeading(groups, s.focusHeading);
        if (path) {
          const open = this.#open(chapterId);
          for (const key of path) open.add(key);
          s.scrollToKey = path[path.length - 1];
        }
      }
    } catch (err) {
      s.chapter = null;
      s.chapterError = err?.message ?? String(err);
    } finally {
      s.loadingChapter = false;
    }
    this.#emit('chapter');
    return s.chapter;
  }

  back() {
    const s = this.state;
    s.chapterId = null;
    s.chapter = null;
    s.chapterError = null;
    s.focusHeading = null;
    s.scrollToKey = null;
    this.#emit('list');
  }

  #open(chapterId) {
    let set = openSectionsByChapter.get(chapterId);
    if (!set) { set = new Set(); openSectionsByChapter.set(chapterId, set); }
    return set;
  }

  toggleSection(key) {
    const s = this.state;
    if (!s.chapterId) return;
    const open = this.#open(s.chapterId);
    if (open.has(key)) open.delete(key); else open.add(key);
    s.scrollToKey = null;
    this.#emit('section');
  }

  collapseAll() {
    const s = this.state;
    if (!s.chapterId) return;
    this.#open(s.chapterId).clear();
    s.scrollToKey = null;
    this.#emit('section');
  }

  /** The open-section keys of the current chapter (a copy). */
  openKeys() { return this.state.chapterId ? [...this.#open(this.state.chapterId)] : []; }

  /** Open the current place (chapter + focused heading, else the chapter's first page) in the Journal compendium. */
  async openJournal(chapterId = this.state.chapterId, heading = this.state.focusHeading) {
    if (!chapterId) return null;
    return openInJournal(chapterId, heading ?? undefined);
  }

  /**
   * The rendered heading tree of the open chapter: each group is a trigger
   * plus, when open, its body blocks and its children (the reader mounts a
   * closed group's content lazily; here it is simply not rendered).
   */
  renderGroups(groups, tablesById, open, depth = 0) {
    return groups.map((g) => {
      const isOpen = open.has(g.key);
      const levelClass = g.level <= 1 ? 'sb-hb-group--root' : g.level === 2 ? 'sb-hb-group--h2' : 'sb-hb-group--deep';
      const trigger = `<button type="button" class="sb-hb-group__trigger" data-action="hb-toggle-section" data-key="${escapeHtml(g.key)}" aria-expanded="${isOpen ? 'true' : 'false'}"><i class="fa-solid fa-chevron-right sb-hb-group__chevron"></i><span class="sb-hb-group__title">${escapeHtml(g.title)}</span></button>`;
      let body = '';
      if (isOpen) {
        const blocks = renderSections(g.body, tablesById);
        const children = g.children.length ? `<div class="sb-hb-group__children">${this.renderGroups(g.children, tablesById, open, depth + 1)}</div>` : '';
        const empty = !blocks && !g.children.length ? `<p class="sb-hb-empty">${escapeHtml(loc('SHADOWBASE.Handbook.NoDetail'))}</p>` : '';
        body = `<div class="sb-hb-group__body">${blocks}${children}${empty}</div>`;
      }
      return `<div class="sb-hb-group ${levelClass}${isOpen ? ' is-open' : ''}" data-group-key="${escapeHtml(g.key)}" data-level="${g.level}">${trigger}${body}</div>`;
    }).join('');
  }

  /**
   * The template context of templates/handbook/browser.hbs. Every key is
   * present (the templates compile strict).
   */
  async prepareContext() {
    const s = this.state;
    if (!s.index && !s.loadingIndex) await this.ensureIndex();
    const query = s.query;
    const trimmed = query.trim();
    const results = this.headingResults().map(({ chapter, hits }) => ({
      id: chapter.id,
      title: chapter.title,
      hasHits: hits.length > 0,
      hitsLine: hits.length ? `${hits.slice(0, HEADING_HITS_SHOWN).join(' · ')}${hits.length > HEADING_HITS_SHOWN ? ` · +${hits.length - HEADING_HITS_SHOWN} more` : ''}` : '',
    }));
    const hits = s.hits ? s.hits.map((h) => ({ chapterId: h.chapterId, heading: h.heading, snippet: h.snippet, chapterTitle: h.chapterTitle, isTable: h.kind === 'table', score: h.score })) : null;
    const hitsCount = s.hits?.length ?? 0;
    const capped = hitsCount >= SEARCH_LIMIT;
    let chapter = null;
    if (s.chapterId) {
      const entry = (s.index ?? []).find((c) => c.id === s.chapterId) ?? null;
      const open = this.#open(s.chapterId);
      let html = '';
      let noMatch = false;
      const filter = s.focusHeading ? '' : trimmed.toLowerCase();
      if (s.chapter) {
        const groups = groupByHeading(s.chapter);
        const visible = filter ? filterGroups(groups, filter) : groups;
        const tablesById = new Map((s.chapter.tables ?? []).map((t) => [String(t.id ?? ''), t]));
        noMatch = visible.length === 0;
        html = this.renderGroups(visible, tablesById, open);
      }
      chapter = {
        id: s.chapterId,
        title: entry?.title ?? s.chapter?.title ?? s.chapterId,
        loading: s.loadingChapter,
        failed: !s.loadingChapter && !s.chapter,
        error: s.chapterError,
        filter: s.focusHeading ? '' : trimmed,
        focusHeading: s.focusHeading,
        noMatch,
        html,
        openCount: open.size,
        hasOpen: open.size > 0,
        collapseLabel: fmt('SHADOWBASE.Handbook.CollapseAll', { count: open.size }),
      };
    }
    return {
      ready: !!s.index && !s.loadingIndex,
      loadingIndex: s.loadingIndex || (!s.index && !s.indexError),
      indexError: s.indexError,
      query,
      chapterCount: s.index?.length ?? 0,
      searchPlaceholder: fmt('SHADOWBASE.Handbook.SearchPlaceholder', { count: s.index?.length ?? 24 }),
      view: s.chapterId ? 'chapter' : 'list',
      isChapter: !!s.chapterId,
      results,
      noMatch: results.length === 0 && !s.hits && trimmed.length > 0,
      noMatchLine: fmt('SHADOWBASE.Handbook.NoMatch', { query: trimmed }),
      canDeepSearch: trimmed.length >= DEEP_SEARCH_MIN && !s.hits,
      searching: s.progress !== null,
      progress: s.progress ?? 0,
      progressLine: fmt('SHADOWBASE.Handbook.Reading', { progress: s.progress ?? 0 }),
      hits,
      hasHits: !!s.hits,
      hitsQuery: s.hitsQuery,
      hitsCountLine: !s.hits ? '' : hitsCount === 0
        ? fmt('SHADOWBASE.Handbook.NoPassages', { query: s.hitsQuery })
        : fmt(hitsCount === 1 ? 'SHADOWBASE.Handbook.Passage' : 'SHADOWBASE.Handbook.Passages', { count: `${hitsCount}${capped ? '+' : ''}`, query: s.hitsQuery }),
      chapter,
    };
  }

  /**
   * The `hb-*` data-actions a host dispatches here. Returns true when the
   * action was one of ours.
   * @param {string} action
   * @param {Record<string, string>} dataset the element's data-* attributes
   */
  async handleAction(action, dataset = {}) {
    switch (action) {
      case 'hb-open-chapter': await this.openAt(dataset.chapterId); return true;
      case 'hb-open-hit': await this.openAt(dataset.chapterId, dataset.heading || undefined); return true;
      case 'hb-back': this.back(); return true;
      case 'hb-search': await this.runDeepSearch(); return true;
      case 'hb-clear-hits': this.clearHits(); return true;
      case 'hb-toggle-section': this.toggleSection(dataset.key); return true;
      case 'hb-collapse-all': this.collapseAll(); return true;
      case 'hb-open-journal': await this.openJournal(dataset.chapterId || undefined, dataset.heading || undefined); return true;
      default: return false;
    }
  }

  /** Every `hb-*` action name (for a host's static actions map and the check). */
  static get ACTIONS() { return ['hb-open-chapter', 'hb-open-hit', 'hb-back', 'hb-search', 'hb-clear-hits', 'hb-toggle-section', 'hb-collapse-all', 'hb-open-journal']; }

  /**
   * DOM wiring for a host's rendered part: the search box (input -> setQuery,
   * Enter -> full text) and the scroll to a focused heading. No-op without a
   * DOM (the headless shim hands back strings).
   * @param {HTMLElement} root
   */
  attachListeners(root) {
    if (!root || typeof root.querySelector !== 'function') return;
    const input = root.querySelector('input[data-hb-search]');
    if (input) {
      input.addEventListener('input', (ev) => this.setQuery(ev.target.value));
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void this.runDeepSearch(); } });
    }
    const key = this.state.scrollToKey;
    if (key) {
      const esc = globalThis.CSS?.escape ?? ((v) => String(v).replace(/["\\]/g, '\\$&'));
      const el = root.querySelector(`[data-group-key="${esc(key)}"]`);
      el?.scrollIntoView?.({ block: 'center' });
      this.state.scrollToKey = null;
    }
  }
}

// ---------------------------------------------------------------------------
// The standalone window
// ---------------------------------------------------------------------------

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The handbook in its own window (ARCHITECTURE.md §6: `HandbookBrowser` is
 * the class name the contract lists for the app). One instance; `open(target)`
 * renders it and, given `{ chapterId, heading }` or a chip id from
 * engine.handbookRegistry.HANDBOOK_CHIP_TARGETS, lands there.
 */
export class HandbookBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'shadowbase-handbook',
    classes: ['shadowbase', 'sb-handbook-app'],
    tag: 'div',
    window: { title: 'SHADOWBASE.Handbook.Title', icon: 'fa-solid fa-book-open', resizable: true },
    position: { width: 520, height: 700 },
    actions: Object.fromEntries(HandbookBrowser.ACTIONS.map((name) => [name, HandbookBrowserApp.#onHandbookAction])),
  };

  static PARTS = {
    browser: { template: BROWSER_TEMPLATE, scrollable: [''] },
  };

  static #instance = null;

  #browser;

  constructor(options = {}) {
    super(options);
    this.#browser = new HandbookBrowser({ onChange: () => { if (this.rendered) this.render(); } });
  }

  /** The embedded browser (state, openAt, ...). */
  get browser() { return this.#browser; }

  /** The one window, created on first use. */
  static get instance() { return HandbookBrowserApp.#instance ??= new HandbookBrowserApp(); }

  /**
   * Open the window at a place: `{ chapterId, heading }`, a chip id
   * (HANDBOOK_CHIP_TARGETS), or nothing (the chapter list).
   */
  static async open(target = null) {
    const app = HandbookBrowserApp.instance;
    await app.render({ force: true });
    const place = resolveTarget(target);
    if (place) await app.browser.openAt(place.chapterId, place.heading, { fromChip: true });
    return app;
  }

  /** The browser template reads its keys at the root (the HUD hands it the same object as a partial context). */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, ...(await this.#browser.prepareContext()) };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#browser.attachListeners(this.element);
  }

  static async #onHandbookAction(event, target) {
    event?.preventDefault?.();
    return this.browser.handleAction(target.dataset.action, { ...target.dataset });
  }
}

/** A chip id or a { chapterId, heading } -> { chapterId, heading } (null when unresolvable). */
export function resolveTarget(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    const chip = engine.handbookRegistry.handbookChipTarget(target);
    return chip ? { chapterId: chip.chapterId, heading: chip.heading } : null;
  }
  if (typeof target === 'object' && target.chapterId) return { chapterId: target.chapterId, heading: target.heading ?? undefined };
  return null;
}

export default HandbookBrowserApp;
