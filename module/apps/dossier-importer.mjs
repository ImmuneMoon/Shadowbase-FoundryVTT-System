// module/apps/dossier-importer.mjs
//
// DossierImporter (docs/ARCHITECTURE.md §6.5): the GM's roster route - many
// character JSON files -> Actors, through module/import-export.mjs
// bulkImportFiles (the website's src/app/profile/page.tsx roster importer over
// src/lib/bulk-import.ts: prepareImportedSheet, planBulkImport, tallyPlan). The
// app reads the files, shows what was read (per-file name / validity / reason),
// takes ONE collision policy - Skip / Overwrite / Save as copy, the website's
// POLICY_OPTIONS (:89-93) - plans (a dry run: nothing written), then imports
// and shows each file's outcome with its reason.
//
// GM only (requirements-players digest fact 10: "Player-safe versus GM-eyes is
// a hard split: NPC sheets default hidden"): the window opens for a GM alone,
// and every actor it creates is left at default ownership NONE (hidden from
// players until the GM shares it). Opened from the Actor directory's header
// (registerDossierImporterButton installs the renderActorDirectory hook;
// module/shadowbase.mjs calls it - docs/REQUESTS.md).
//
// Not actor-bound, so it extends ApplicationV2 directly (one window).

import { bulkImportFiles, readTextFile } from '../import-export.mjs';
import { TEMPLATE_ROOT, loc, fmt, notify, num, text, SYSTEM_ID } from './sub-app.mjs';
// Wave 5 (U10): the world setting that keeps imported dossiers GM-eyes-only (module/settings.mjs).
import { npcDefaultHidden } from '../settings.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** src/app/profile/page.tsx:89-93 POLICY_OPTIONS. */
export const POLICIES = Object.freeze(['skip', 'overwrite', 'copy']);
/** :95-100 OUTCOME_OF_ACTION, plus the two the write itself can produce. */
const OUTCOME_KEY = Object.freeze({ create: 'Created', overwrite: 'Overwritten', copy: 'Copied', skip: 'Skipped', invalid: 'Invalid', failed: 'Failed' });

export class DossierImporter extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'shadowbase-dossier-importer',
    classes: ['shadowbase', 'sb-app', 'sb-app--dossier'],
    tag: 'form',
    window: { title: 'SHADOWBASE.Apps.Dossier.WindowTitle', icon: 'fa-solid fa-file-import', resizable: true },
    position: { width: 640, height: 640 },
    form: { handler: DossierImporter.#onSubmitForm, submitOnChange: true, closeOnSubmit: false },
    actions: {
      'plan': DossierImporter.onPlan,
      'import': DossierImporter.onImport,
      'clear': DossierImporter.onClear,
      'remove-file': DossierImporter.onRemoveFile,
    },
  };

  static PARTS = { dossier: { template: `${TEMPLATE_ROOT}/dossier-importer.hbs`, scrollable: [''] } };

  static instance = null;

  /** The files read so far: { name, text, size }. */
  files = [];
  policy = 'skip';
  folder = null;
  plan = null;
  results = null;
  tally = null;
  busy = false;

  /** GM only. */
  static async open(options = {}) {
    if (globalThis.game?.user && !globalThis.game.user.isGM) { notify('warn', loc('SHADOWBASE.Apps.Dossier.GmOnly')); return null; }
    if (!DossierImporter.instance) DossierImporter.instance = new DossierImporter(options);
    await DossierImporter.instance.render({ force: true });
    return DossierImporter.instance;
  }

  get title() { return loc('SHADOWBASE.Apps.Dossier.WindowTitle'); }

  _onClose(options) { super._onClose?.(options); if (DossierImporter.instance === this) DossierImporter.instance = null; }
  async close(options = {}) { const r = await super.close(options); if (DossierImporter.instance === this) DossierImporter.instance = null; return r; }

  /** Add files (File objects or { name, text }); the plan and results are dropped, they describe the old batch. */
  async addFiles(list) {
    for (const f of list ?? []) {
      const name = f?.name ?? 'file.json';
      const body = typeof f?.text === 'string' ? f.text : await readTextFile(f);
      if (typeof body !== 'string') continue;
      this.files.push({ name, text: body, size: body.length });
    }
    this.plan = null; this.results = null; this.tally = null;
    if (this.rendered) await this.render();
    return this.files.length;
  }

  /** The browser file input: `_onRender` wires it (headless: the element answers querySelector with null). */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const input = this.element?.querySelector?.('input[type="file"][data-dossier-files]');
    if (!input) return;
    input.addEventListener('change', async () => { await this.addFiles(Array.from(input.files ?? [])); });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const folders = (globalThis.game && ('folders' in globalThis.game) ? globalThis.game.folders?.contents ?? [] : []).filter((f) => f.type === 'Actor');
    context.dossier = {
      isGM: !!(globalThis.game?.user?.isGM ?? true),
      files: this.files.map((f, index) => ({ index, name: f.name, size: f.size })),
      fileCount: this.files.length, hasFiles: this.files.length > 0,
      policies: POLICIES.map((p) => ({ value: p, label: loc(`SHADOWBASE.Apps.Dossier.Policy.${p}`), hint: loc(`SHADOWBASE.Apps.Dossier.PolicyHint.${p}`), checked: p === this.policy })),
      folders: [{ value: '', label: loc('SHADOWBASE.Apps.Dossier.NoFolder'), selected: !this.folder }, ...folders.map((f) => ({ value: f.id, label: f.name, selected: f.id === this.folder }))],
      hasFolders: folders.length > 0,
      plan: this.plan ? this.plan.map((p) => ({ fileName: p.fileName, characterName: p.characterName ?? '', finalName: p.finalName ?? '', action: loc(`SHADOWBASE.Apps.Dossier.Action.${p.action}`), tone: p.action === 'invalid' ? 'bad' : p.action === 'skip' ? 'muted' : 'ok', reason: text(p.reason) })) : null,
      tally: this.tally ? Object.entries(this.tally).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${loc(`SHADOWBASE.Apps.Dossier.Action.${k}`).toLowerCase()}`).join(', ') : '',
      results: this.results ? this.results.map((r) => ({ fileName: r.fileName, name: r.finalName ?? r.characterName ?? '', outcome: loc(`SHADOWBASE.Apps.Dossier.Outcome.${r.ok ? OUTCOME_KEY[r.action] ?? 'Created' : (r.action === 'invalid' ? 'Invalid' : 'Failed')}`), tone: r.ok ? (r.action === 'skip' ? 'muted' : 'ok') : 'bad', reason: text(r.reason), notices: (r.notices ?? []).map((n) => `${n.title}: ${n.description}`).join(' ') })) : null,
      busy: this.busy,
      canImport: !!this.plan && !this.busy && this.plan.some((p) => p.action !== 'invalid' && p.action !== 'skip'),
    };
    return context;
  }

  static async #onSubmitForm(event, form, formData) {
    const data = formData?.object ?? {};
    if ('dossier.policy' in data && POLICIES.includes(String(data['dossier.policy']))) { this.policy = String(data['dossier.policy']); this.plan = null; this.results = null; this.tally = null; }
    if ('dossier.folder' in data) this.folder = data['dossier.folder'] ? String(data['dossier.folder']) : null;
    if (this.rendered) await this.render();
    return { policy: this.policy, folder: this.folder };
  }

  /** The dry run: what each file would do under the policy, nothing written. */
  async planImport() {
    if (!this.files.length) { notify('warn', loc('SHADOWBASE.Apps.Dossier.NoFiles')); return null; }
    this.busy = true;
    try {
      const { plan, tally } = await bulkImportFiles(this.files, this.policy, { folder: this.folder, dryRun: true });
      this.plan = plan; this.tally = tally; this.results = null;
      return plan;
    } finally { this.busy = false; if (this.rendered) await this.render(); }
  }

  /**
   * The write. New actors are left hidden from players: Foundry's default
   * ownership for a new Actor is NONE for everyone but the creator, and the
   * importer pins it explicitly on every actor it created (a world whose
   * default was changed still gets hidden NPCs) - while the world setting
   * `npcDefaultHidden` (module/settings.mjs, default on) says so; off, the
   * world's own default ownership stands.
   */
  async runImport() {
    if (!this.files.length) { notify('warn', loc('SHADOWBASE.Apps.Dossier.NoFiles')); return null; }
    this.busy = true;
    try {
      const { plan, results, tally } = await bulkImportFiles(this.files, this.policy, { folder: this.folder, dryRun: false });
      this.plan = plan; this.results = results; this.tally = tally;
      const NONE = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
      const hide = npcDefaultHidden();
      for (const r of results) {
        if (!hide) break;
        if (!r.ok || !r.actorId || (r.action !== 'create' && r.action !== 'copy')) continue;
        const actor = globalThis.game?.actors?.get(r.actorId);
        if (actor && num(actor.ownership?.default, NONE) !== NONE) await actor.update({ 'ownership.default': NONE });
      }
      const created = results.filter((r) => r.ok && r.action !== 'skip').length;
      const failed = results.filter((r) => !r.ok && r.action !== 'invalid').length;
      notify(failed ? 'warn' : 'info', fmt('SHADOWBASE.Apps.Dossier.Done', { imported: created, skipped: results.filter((r) => r.action === 'skip').length, invalid: results.filter((r) => r.action === 'invalid').length, failed }));
      return results;
    } finally { this.busy = false; if (this.rendered) await this.render(); }
  }

  static async onPlan(event) { event?.preventDefault?.(); return this.planImport(); }
  static async onImport(event) { event?.preventDefault?.(); return this.runImport(); }
  static async onClear(event) { event?.preventDefault?.(); this.files = []; this.plan = null; this.results = null; this.tally = null; await this.render(); return true; }
  static async onRemoveFile(event, target) { event?.preventDefault?.(); const i = Number(target?.dataset?.index); if (!Number.isInteger(i)) return false; this.files.splice(i, 1); this.plan = null; this.results = null; this.tally = null; await this.render(); return true; }
}

/**
 * The Actor directory's header button (GM only). v13's renderActorDirectory
 * hands an HTMLElement; the button joins `.directory-header .action-buttons`
 * (UNVERIFIED headlessly - the shim renders no directory; MANUAL-TEST row).
 * module/shadowbase.mjs calls this from registerHooks (docs/REQUESTS.md).
 */
export function registerDossierImporterButton() {
  globalThis.Hooks?.on?.('renderActorDirectory', (app, html) => {
    if (!globalThis.game?.user?.isGM) return;
    const root = html?.querySelector ? html : html?.[0];
    const bar = root?.querySelector?.('.directory-header .action-buttons');
    if (!bar || bar.querySelector('[data-action="shadowbase-dossier"]')) return;
    const button = globalThis.document.createElement('button');
    button.type = 'button';
    button.dataset.action = 'shadowbase-dossier';
    button.innerHTML = `<i class="fa-solid fa-file-import"></i> ${loc('SHADOWBASE.Apps.Dossier.Button')}`;
    button.addEventListener('click', (ev) => { ev.preventDefault(); DossierImporter.open(); });
    bar.appendChild(button);
  });
  return `${SYSTEM_ID}.renderActorDirectory`;
}

export default DossierImporter;
