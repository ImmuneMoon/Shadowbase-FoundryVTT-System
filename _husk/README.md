# _husk/ — the retired 2025 system, kept for reference

Moved here on 2026-09-10 by unit U02b of the v13 makeover (`docs/WORKPLAN.md`),
preserving the original paths one level down. Nothing in this folder is loaded
by Foundry: `system.json` no longer references any of it, and `scripts/` at the
repository root now holds only the `check-*.mjs` verification scripts.

## What is here

| path | what it was |
|---|---|
| `template.json` | the v10-era data template (`characteristics.hitPoints.final` stored as data; the family of bugs `check:derived-not-stored` and `check:actor-schema` now pin against) |
| `scripts/*.js` | actor, calculations, combat, constants, data-exporter, data-importer, macro, preload-templates, roll-hub, settings, shadowbase — the hand-written rules (`Dodge = floor(Basic Speed)`, `ST = value \|\| 10`), the Application v1 sheet, the jQuery combat hook |
| `templates/**` | the old Handlebars sheet and partials |
| `styles/sheet.css` | the old stylesheet (the new `styles/sheet.css` of ARCHITECTURE.md §3 is unit U05's; had this stayed in place Foundry would have loaded it under the new name) |
| `database/` | the JSON the 2025 pack-building script imported from, plus that script |
| `packs/` | the compiled LevelDB compendia built from `database/` (the new packs are built by `tools/build-packs.mjs` into a fresh `packs/`, which `.gitignore` excludes) |

`TEST CHARACTERS/kaelen rarr_shadowbase.json` did NOT come here: it is now
`fixtures/legacy-2025-kaelen-rarr.json`, a legacy-import regression fixture
(see `fixtures/README.md`). The then-empty `TEST CHARACTERS/` directory was
removed. A copy of `scripts/actor.js` also lives at `fixtures/husk/actor.js` as
the positive control for `check:esm`'s forbidden-API sweep (the sweep must hit
it, or the sweep has no denominator).

## Why it is kept rather than deleted

- `docs/ARCHITECTURE.md` §9 names the husk's choices as the REJECTED
  ALTERNATIVES the new checks pin against (`check:engine-parity` — Dodge;
  `check:actor-schema` — the `|| 10` family; `check:derived-not-stored` — derived
  figures merged into stored data; `check:esm` — the v1/jQuery APIs). Having the
  source beside the pins keeps the citations checkable.
- The move is reversible with `mv`; a deletion is not.

## Git

Git still tracks the OLD paths (`template.json`, `scripts/*.js`, `templates/**`,
`styles/sheet.css`, `database/**`, `packs/**`, `TEST CHARACTERS/**`) — the
makeover units never touch git state. `git status` therefore shows those paths
as deleted and `_husk/` as untracked. Fulllion decides whether to commit the
move (`git add -A` records it as renames), to commit the deletions and drop
`_husk/`, or to add `_husk/` to `.gitignore`.

Safe to delete once the checks named above no longer need to cite it.
