# ShadowBase — Foundry VTT system (v13)

The Foundry VTT system for *Shadows of the Mandalorian War* (3964 BBY): the
character sheet, the Tactical HUD, the roll and damage processing, the item
builders, the compendia and the rulebook as a journal — all driven by the
ShadowBase website's own rules engine, bundled into this system. Nothing here
re-implements a rule.

- Foundry **v13** only (`compatibility.minimum 13`, verified `13.346`); ApplicationV2 throughout.
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

The contract is `docs/ARCHITECTURE.md` (its §9.1 records the review corrections and §9.2 the
facts recorded as built). The unit plan and build log are `docs/WORKPLAN.md`; the cross-unit
request ledger is `docs/REQUESTS.md`; the in-Foundry test script is `docs/MANUAL-TEST.md`.

Key decisions, in one breath: one Actor type (`character`; droids are characters with `isDroid`);
null-means-derive on the primaries and secondaries, null-means-full on the pools; item rows are
stored byte-for-byte as the website stores them (names are join keys); derived figures are never
written to `_source`; status effects are ActiveEffects with EMPTY `changes` (the engine sums every
modifier bag itself); initiative is Basic Speed with DX in the hundredths, never a die; the grid is
flat-top hex (`grid.type 4`, 1 yd); the era guard (no Empire / Rebellion / Bespin / Cloud City) is
enforced on the shipped handbook by the pack builder.

## How to build

Prerequisites: Node 20+, the website checkout beside this repository
(`../ShadowBase Website`, or `SHADOWBASE_WEBSITE=<path>`), no Foundry required.

```sh
# 1. the website is the source: install it, sync the handbook, and make sure it is green
cd "../ShadowBase Website"
npm ci
npm run sync:handbook          # regenerates public/handbook/*.json from the chapters
node scripts/check-all.mjs     # must be green before a compendium build (names are join keys)

# 2. this repository
cd "../Shadowbase-FoundryVTT-System"
npm install                    # esbuild 0.28.2, @foundryvtt/foundryvtt-cli 3.0.4, handlebars 4.7.9
npm run build                  # = build:engine, build:handbook, build:packs (in that order)
npm run gen:actor-schema       # only when engine/BUILD-INFO.json changed: regenerate module/data/actor-schema.generated.mjs
node scripts/check-all.mjs     # every check:* script (19); exit 0 = green
```

`npm run build:engine` bundles `tools/engine-entry.ts` (which re-exports the website modules the
system reads) with esbuild — react, firebase, next and react-hook-form are aliased to
`tools/stubs/`, the handbook loader to `tools/shims/handbook-loader.ts`; only zod, clsx and
tailwind-merge may reach the bundle. `build:handbook` writes the 24-entry / 169-page JournalEntry
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
compiled LevelDB packs, so run `npm run build:packs` (or the full `npm run build`) once before
starting Foundry; then create a world on the "ShadowBase — Shadows of the Mandalorian War" system.
`docs/MANUAL-TEST.md` is the acceptance script with the expected figures.

Settings (Configure Settings › ShadowBase): three world settings — *Enforce the combat economy*
(reserved, off), *Hide imported dossiers from players* (on), *Sync token rotation with facing*
(off) — and the website's sheet preferences as client settings (compact rows, reduce motion,
handbook shortcuts, point costs, pinned section headers, remembered sections, roll-history depth
10/25/50/100, notifications kept 12/25/50, keep roll history). The preferences are applied as
`data-*` attributes on every ShadowBase window, exactly like the website's root attributes.

## What is generated, what git tracks

| path | how it is made | tracked |
|---|---|---|
| `engine/shadowbase-engine.mjs`, `engine/BUILD-INFO.json` | `npm run build:engine` from the website source | yes — a checkout installs without a build |
| `module/data/actor-schema.generated.mjs` | `npm run gen:actor-schema` from the bundle's zod schema; `check:actor-schema` requires it byte-identical | yes |
| `handbook/*.json` | `npm run build:handbook` (copies of the website's `public/handbook` + the chip map) | yes |
| `packs-src/**/*.json` | `npm run build:packs` (deterministic ids; ~14 MB) | yes |
| `packs/**` (LevelDB) | `npm run build:packs` from `packs-src/` | **no** (`.gitignore`) — rebuild after every checkout |
| `preview/` | the preview renderers' default output | no (`.gitignore`) |
| `node_modules/` | `npm install` | no |
| `_husk/` | the retired 2025 system, moved aside by the makeover (README inside) | Fulllion's call — see `docs/REQUESTS.md` (U02b → Fulllion) |

Everything else (`module/`, `templates/`, `styles/`, `lang/`, `tools/`, `scripts/`, `fixtures/`,
`docs/`, `system.json`, `package.json`) is hand-written and tracked. At the time of writing git still
indexes the 2025 husk's paths (`template.json`, `scripts/*.js`, the old `packs/`, `database/`,
`TEST CHARACTERS/`), so `git status` shows their deletion plus every new path untracked; the first
commit of the makeover is Fulllion's to make.

## Verification

`node scripts/check-all.mjs` discovers every `check:*` script in `package.json` and every
`scripts/check-*.mjs` on disk (an unregistered check still runs), runs them in parallel and prints
only failures. Each check names its subject, the rejected alternative it pins against the app's own
code path, and the mutations that were fired to prove it has teeth. The headless Foundry is
`tools/foundry-shim.mjs` (+ `tools/foundry-shim-apps.mjs` for ApplicationV2 / Handlebars / DialogV2):
a declared surface behind a Proxy that throws on any member Foundry v13 does not have. What cannot be
proven here — rendering, form binding, drag-drop, chat cards, the token HUD, sockets — is the
script in `docs/MANUAL-TEST.md`.
