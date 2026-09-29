# ShadowBase — Foundry VTT system (v13 / v14)

The Foundry VTT system for *Shadows of the Mandalorian War* (3964 BBY): the
character sheet, the Tactical HUD, the roll and damage processing, the item
builders, the compendia and the rulebook as a journal — all driven by the
ShadowBase website's own rules engine, bundled into this system. Nothing here
re-implements a rule.

- Foundry **v13 and v14** (`compatibility.minimum 13`, verified `14.368`); ApplicationV2 throughout.
- System id `shadowbase`, version **2.0.0** (`docs/CHANGELOG.md`).
- Author: Fulllion Creative Works. Git and deployment are Fulllion's; this repository is never committed or published by the build tooling.

## Architecture in a page

```
website src/lib, src/hooks  ──esbuild──▶  engine/shadowbase-engine.mjs  (the ONLY rules code; ~2.2 MB ESM)
                                                    │
                                          module/engine.mjs (the only importer; polyfill, blank(), rowId())
                                                    │
        ┌───────────────────────────────────────────┼────────────────────────────────────────┐
  module/data/*  (Actor `character` schema GENERATED from the website's zod schema;   module/adapter.mjs
   21 Item types, each holding ONE website row verbatim in system.row)                (actor + items ⇄ the website's flat sheet)
        │                                                                                     │
  module/documents/*  (ShadowBaseActor: prepareDerivedData = getCalculatedStats(actorToSheet(actor)); import/export;
                       ShadowBaseItem: per-family derived stats; ShadowBaseActiveEffect: one per stored status-effect row)
        │
  module/rolls.mjs · combat.mjs · damage.mjs · effects.mjs      (table play: 3d6 → resolveRollOutcome, the tracker's
        │                                                        turn counter and sweep, the damage processor, stun sync)
  module/apps/*  (actor sheet, Tactical HUD, handbook browser, 14 item-sheet families, six sub-apps, roll dialog)
  templates/*.hbs · styles/*.css · lang/en.json                (Handlebars PARTS, plain scoped CSS, every string localized)
  module/settings.mjs                                          (world: enforceEconomy, npcDefaultHidden, tokenRotationSync;
                                                                client: the website's sheet preferences)
  tools/pack-manifest.mjs → packs-src/ → packs/                 (32 compendia: 2,220 Items, 65 template Actors, the handbook)
  handbook/                                                    (the website's 24 chapter JSON + the chip map, for the in-HUD search)
```

The design notes the code comments cite (`docs/ARCHITECTURE.md`, `docs/STYLE-SPEC.md`), the build
log and the in-Foundry test script (`docs/MANUAL-TEST.md`) are working documents kept with the
maintainer's checkout and not published; `docs/CHANGELOG.md` is.

Key decisions, in one breath: one Actor type (`character`; droids are characters with `isDroid`);
null-means-derive on the primaries and secondaries, null-means-full on the pools; item rows are
stored byte-for-byte as the website stores them (names are join keys); derived figures are never
written to `_source`; status effects are ActiveEffects with EMPTY `changes` (the engine sums every
modifier bag itself); initiative is Basic Speed with DX in the hundredths, never a die; the grid is
flat-top hex (`grid.type 4`, 1 yd); the era guard (no Empire / Rebellion / Bespin / Cloud City) is
enforced on the shipped handbook by the pack builder.

## How to build

Prerequisites: Node 20+ and a checkout of the website repo (`ImmuneMoon/ShadowBase-Website`); no
Foundry required. The tools find the website through `tools/website-path.mjs`: the
`SHADOWBASE_WEBSITE` environment variable, else a `website-path.local.json` beside `package.json`
(`{ "website": "<path>" }`, git-ignored, so each machine keeps its own), else `../ShadowBase Website`
beside this repository.

```sh
# 1. the website is the source: install it, sync the handbook, and make sure it is green
cd "<your website checkout>"
npm ci
npm run sync:handbook          # regenerates public/handbook/*.json from the chapters
node scripts/check-all.mjs     # must be green before a compendium build (names are join keys)

# 2. this repository
cd "<this repository>"
npm install                    # esbuild 0.28.2, @foundryvtt/foundryvtt-cli 3.0.4, handlebars 4.7.9
npm run build                  # = build:engine, gen:actor-schema, build:handbook, build:packs (in that order; the schema
                               #   must be regenerated BEFORE the packs, or a new sheet field lands in system.legacy)
npm run gen:actor-schema       # only when engine/BUILD-INFO.json changed: regenerate module/data/actor-schema.generated.mjs
node scripts/check-all.mjs     # every check:* script (23); exit 0 = green
```

`npm run build:engine` bundles `tools/engine-entry.ts` (which re-exports the website modules the
system reads) with esbuild — react, firebase, next and react-hook-form are aliased to
`tools/stubs/`, the handbook loader to `tools/shims/handbook-loader.ts`; only zod, clsx and
tailwind-merge may reach the bundle. `build:handbook` writes the 24-entry / 171-page JournalEntry
pack sources and copies the chapter JSON to `handbook/`; `build:packs` writes `packs-src/<pack>/*.json`
(deterministic ids) and compiles them to LevelDB under `packs/` — it refuses a bundle older than the
website source, and Foundry must not have a world open while it runs.

Headless previews (no Foundry): `npm run preview:all` renders the actor sheet, the tab-level sheet,
the Tactical HUD, every item sheet, the six sub-apps and the settings panel to standalone HTML files
(`tools/render-preview.mjs --template|--fixture|--tabs|--hud|--item|--app|--settings`; default
output directory `preview/`, git-ignored). The CSS is inlined in `system.json` order; every panel is
stacked because nothing switches tabs headlessly.

## How to install into Foundry

Copy (or symlink) this directory to `<Foundry user data>/Data/systems/shadowbase/` — the folder
name must be `shadowbase` (the system id). A checkout carries everything Foundry loads except the
compendia (the item libraries the sheet's "Add From Library" opens, the template characters and the
handbook journal): build them with `npm run build`, which needs the website checkout above - or
install a release zip, which carries them compiled. Then create a world on the "ShadowBase —
Shadows of the Mandalorian War" system.

Settings (Configure Settings › ShadowBase): three world settings — *Enforce the combat economy*
(reserved, off), *Hide imported dossiers from players* (on), *Sync token rotation with facing*
(off) — and the website's sheet preferences as client settings (compact rows, reduce motion,
handbook shortcuts, point costs, pinned section headers, remembered sections, roll-history depth
10/25/50/100, notifications kept 12/25/50, keep roll history). The preferences are applied as
`data-*` attributes on every ShadowBase window, exactly like the website's root attributes.

## What is generated, what git tracks

| path | how it is made | tracked |
|---|---|---|
| `engine/shadowbase-engine.mjs`, `engine/BUILD-INFO.json` | `npm run build:engine` from the website source (BUILD-INFO records the website repo and commit, and paths relative to this repository) | yes — the system cannot run without the engine |
| `module/data/actor-schema.generated.mjs` | `npm run gen:actor-schema` from the bundle's zod schema; `check:actor-schema` requires it byte-identical | yes |
| `handbook/*.json` | `npm run build:handbook` (copies of the website's `public/handbook` + the chip map) | yes — the handbook browser reads them |
| `packs-src/**/*.json` | `npm run build` regenerates them from the engine on every build (deterministic ids) | no (`.gitignore`) |
| `packs/**` (LevelDB) | `npm run build`, compiled from `packs-src/` | no (`.gitignore`) — a release zip carries them compiled |
| `website-path.local.json` (any `*.local.json`) | written by hand on each machine: where the website checkout lives | no (`.gitignore`) |
| `preview/` | the preview renderers' default output | no (`.gitignore`) |
| `node_modules/` | `npm install` | no |
| `_husk/` | the retired 2025 system, kept on disk for reference; git history holds it | no (`.gitignore`) |
| `docs/*` except `docs/CHANGELOG.md` | the maintainer's working documents (design notes, build log, test script) | no (`.gitignore`) |

Everything else (`module/`, `templates/`, `styles/`, `lang/`, `assets/`, `tools/`, `scripts/`,
`fixtures/`, `system.json`, `package.json`, `README.md`, `docs/CHANGELOG.md`) is hand-written and tracked.

## Verification

`node scripts/check-all.mjs` discovers every `check:*` script in `package.json` and every
`scripts/check-*.mjs` on disk (an unregistered check still runs), runs them in parallel and prints
only failures. Each check names its subject, the rejected alternative it pins against the app's own
code path, and the mutations that were fired to prove it has teeth. The headless Foundry is
`tools/foundry-shim.mjs` (+ `tools/foundry-shim-apps.mjs` for ApplicationV2 / Handlebars / DialogV2):
a declared surface behind a Proxy that throws on any member Foundry v13 does not have. What cannot be
proven here — rendering, form binding, drag-drop, chat cards, the token HUD, sockets — is checked
by hand in a running Foundry (the maintainer's test script).
