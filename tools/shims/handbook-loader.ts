// Foundry-side replacement for the website's src/lib/handbook-loader.ts.
//
// The website fetches its handbook chapters from absolute '/handbook/<id>.json'
// URLs that do not exist under /systems/shadowbase/. This shim keeps the same
// exports and fetches the same 25 JSON files (shipped unchanged under
// systems/shadowbase/handbook/) so the bundled searchChapters and the handbook
// browser read the same corpus the JournalEntry pack was generated from.
//
// The types are copied from src/lib/handbook/types.ts and handbook-loader.ts;
// keep them in step. `check:handbook` on the Foundry side pins the shape.

export interface HandbookSection {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'list' | 'note' | 'table';
  content: any;
}

export interface HandbookTable {
  id: string;
  context: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface HandbookChapter {
  id: string;
  title: string;
  sections: HandbookSection[];
  tables: HandbookTable[];
}

export interface HandbookIndexChapter {
  id: string;
  title: string;
  headings: string[];
  tables: number;
  bytes: number;
}

export interface HandbookIndex {
  generatedAt: string;
  chapters: HandbookIndexChapter[];
}

const BASE = 'systems/shadowbase/handbook';
const indexCache: { value: Promise<HandbookIndex> | null } = { value: null };
const chapterCache = new Map<string, Promise<HandbookChapter>>();

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`ShadowBase handbook: ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadHandbookIndex(): Promise<HandbookIndex> {
  if (!indexCache.value) indexCache.value = fetchJson<HandbookIndex>(`${BASE}/index.json`);
  return indexCache.value;
}

export async function loadHandbookChapter(id: string): Promise<HandbookChapter> {
  let p = chapterCache.get(id);
  if (!p) {
    const index = await loadHandbookIndex();
    const v = encodeURIComponent(index.generatedAt);
    p = fetchJson<HandbookChapter>(`${BASE}/${id}.json?v=${v}`);
    chapterCache.set(id, p);
  }
  return p;
}

export function clearHandbookCache(): void {
  indexCache.value = null;
  chapterCache.clear();
}
