# templates/ — Handlebars templates

Compiled by Foundry v13's Handlebars (`foundry.applications.handlebars.renderTemplate`);
proven headlessly by `check:templates` (strict + knownHelpersOnly compile of every file,
strict render of every actor-sheet PART over the corpus), `check:sheet-tabs` (U06) and
`check:hud` (U07). Every user-visible string is `{{localize}}`d from `lang/en.json`
(`check:i18n` holds both directions).

| directory | owner | what |
|---|---|---|
| `actor/` | U05 (`header`, `tabs`, `info`, `sheet`), U06 (`body`, `abilities`, `inventory`, `vehicles`, `parts/`) | the actor sheet's PARTS (`actor/README.md` is the section checklist) |
| `partials/` | U05 | the named partials below |
| `chat/` | U04 | the roll / damage / volley / power / costs / notice cards |
| `hud/`, `handbook/` | U07 | the Tactical HUD parts and the handbook browser |
| `items/`, `apps/` | U08, U09 | item sheets and sub-apps (later waves) |

## Named partials (`module/helpers/handlebars.mjs` `PARTIALS`, preloaded at `setup`)

Every hash param listed is REQUIRED (the templates render strict in the checks; pass `""` / `false` when unused).

| partial name | file | params | renders |
|---|---|---|---|
| `shadowbase.field` (block) | `partials/field.hbs` | `id`, `label` (localized text), `cls` | the website's FormRow: label over the block content, `data-sheet-row` |
| `shadowbase.qty` | `partials/qty.hbs` | `id`, `name`, `value`, `placeholder`, `min`, `max`, `step`, `dtype`, `disabled`, `cls` (`''` / `sb-qty--dense` / `sb-qty--short`), `label` | QuantityInput: a number field with the step arrows beside the digits (`data-action="step-number"`) |
| `shadowbase.section` | `partials/section-head.hbs` | `title`, `icon`, `chip` (registry id or `''`), `chipTitle`, `meta` | the `<summary>` of an `sb-section` details: title + icon, meta text, handbook chip, chevron |
| `shadowbase.chip` | `partials/chip.hbs` | `entry`, `title` | the handbook chip (`data-action="open-handbook"`) |
| `shadowbase.badges` | `partials/badges.hbs` | `badges` (the `sbChannel` helper's list) | per-channel modifier badges, green / red |
| `shadowbase.pool` | `partials/pool.hbs` | `pool` (`poolsContext` entry), `compact`, `editable`, `pinned` | one resource tracker with reset |
| `shadowbase.empty` | `partials/empty.hbs` | `icon`, `title`, `description`, `action` | the section empty state |
| `shadowbase.facing-hex` | `partials/facing-hex.hbs` | `hex` (`facingHexModel`), `editable` | the facing dial svg (`set-facing` / `cycle-threat` wedges) |
| `shadowbase.switch` | `partials/switch.hbs` | `id`, `name`, `checked`, `disabled`, `label`, `cls` | the website's Switch over a checkbox |
| `shadowbase.roll-btn` | `partials/roll-btn.hbs` | `action`, `key`, `name`, `title`, `label`, `disabled` | the RollButton trigger (dice glyph) |

U06's tab templates reference their `actor/parts/*.hbs` by PATH (`{{> "systems/shadowbase/templates/actor/parts/trait-row.hbs"}}`);
`registerTemplates()` in `module/shadowbase.mjs` loads those through `loadTemplates([...paths])`.

## Helpers (`module/helpers/handlebars.mjs`)

`sbIcon` (semantic or lucide name → FA class), `sbSigned`, `sbNumber`, `sbFixed`, `sbDice`, `sbChannel`,
`sbLevelLabel`, `sbHas`, `sbRowField`, `sbJson` / `json`, `sbOr`, `sbConcat`, `sbPct`, `sbAdd`, `sbIsNull`,
`sbPlural`, `sbCount`; core's `localize`, `eq`/`ne`/`gt`/`lt`/`gte`/`lte`/`and`/`or`/`not`, `concat`,
`checked`, `disabled`, `selectOptions`, `signedString`, `numberFormat` are registered only where the host lacks them.
