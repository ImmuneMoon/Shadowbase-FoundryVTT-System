# templates/actor — the actor sheet's parts and the section checklist

`module/apps/actor-sheet.mjs` (unit U05) renders these PARTS in order: `header.hbs`,
`tabs.hbs`, then one tab part each — `info.hbs` (U05), `body.hbs`, `abilities.hbs`,
`inventory.hbs`, `vehicles.hbs` (U06; the row partials under `parts/` are theirs).
`sheet.hbs` is not a PART: it composes the rendered parts into one page for
`tools/render-preview.mjs`. Every section is a `<details class="sb-section" data-section="…">`
whose open state the sheet remembers per user; the trigger is the `shadowbase.section` partial
(title, website lucide icon through `sbIcon`, the handbook chip where a registry entry exists).

The inventory below is `docs/STYLE-SPEC.md` §3.3 (the website's sections, in its order,
re-derived from the source on 2026-09-10) with a **done** column: `yes` = rendered by the named
template and proven by `check:templates` (strict render over five templates and the two 2026
fixtures) or `check:sheet-tabs`; `partial` = present with a stated gap; `no` = not yet.

## Header (`header.hbs`)

| element | website source | done |
|---|---|---|
| portrait (`system.characterPortrait` data URL, else `actor.img`; click → FilePicker for `actor.img`) | character-portrait-manager.tsx | yes |
| name input (`name`) | basic-info-section.tsx:106 | yes |
| player / species / homeworld / campaign summary (read-only here; the inputs are Info › Basic Info) | basic-info-section.tsx:109-128 | yes |
| Point Total input, Total Spent (with the Versatility budget note), Remaining (green / red), both jumping to Primary Attributes | basic-info-section.tsx:129-189 | yes |
| Import / Export / HUD / Preferences buttons (also window header controls) | form-actions.tsx, roller-window.tsx header | yes |
| pinned bar: Spent / Rem. when Pin Pts, the pools when Pin Pools | basic-info-section.tsx:293-322 pins, use-sticky-offset | yes |

## Tab strip (`tabs.hbs`)

Info · Body · Abilities · Inventory · Vehicles (character-form.tsx:578-582) as angular tabs (layout/angular-tab.tsx; ARCHITECTURE §6.6). done: yes.

## Info tab (`info.hbs`) — eleven sections, in this order

| # | section (`data-section`) | website source | shows / controls | done |
|---|---|---|---|---|
| 1 | Basic Info (`basic-info`) | basic-info-section.tsx:105-151, :278-303 | Player Name, Species (datalist of `SPECIES_NAMES`; a changed species runs the swap — species-field.tsx:62-150 ported as `applySpeciesSwap`), Homeworld, Campaign, CP Spending switch, Pin Pts | yes |
| 2 | Primary Attributes (`primary-attributes`) `[chip core-system-attributes]` | primary-attributes-section.tsx | ST / DX / IQ / HT: null-means-derive input (placeholder = baseline; droid: derived, read-only), roll button, "Base (Human/Template/Hardware): N (±d)", Mod / Effective with the contributing effects named | partial — the per-card `[±N pts]` cost needs `attribute-charging.ts` exported from the bundle (docs/REQUESTS.md); the line renders as soon as `engine.attributeCharging` exists |
| 3 | Secondary Characteristics & Senses (`secondary-characteristics`) `[chip core-system-attributes]` | secondary-characteristics-section.tsx | HP, EP, Will, FP, Basic Speed (.25), Basic Move, Per, Fright, Vision, Hearing, Taste & Smell, Touch (dependency order), Damage Thrust / Swing read-only; "Base (source): N.", Mod / Effective, roll buttons, "Immune" | partial — same cost caveat |
| 4 | Resource Pools (`resource-pools`) | basic-info-section.tsx:306-325, resource-trackers.tsx:158-205 | HP / EP / FP (PP for a droid, battery-coloured) with reset, Reset all, Pin Pools, blank = full | yes |
| 5 | Combat State (`combat-state`) `[chip combat-damage]` | resource-trackers.tsx:344-667 | Global Turn Counter (±, reset, Sweep now), Stunned select + note, Active Effects count → HUD Status, the facing band (hex dial, you face / threat, Engage / Stand down, Turn to face, free-change note, arc explanation, vision line) | yes |
| 6 | Force Alignment (`force-alignment`) `[chip force-alignment-forms]` | basic-info-section.tsx:327-443 | spectrum slider + number box, Dark / Light labels, tier + Self-Mastery + Bearing lines, Reaction Modifier block; the slider mirrors lightSide/darkSidePoints | yes |
| 7 | Languages (`languages`) `[chip traits-skills]` | languages-section.tsx, languages-panel.tsx (on Info per the unit brief; the website keeps it under Abilities) | languageEntries rows (tongue, fluency, Compr., Free, cost, remove), Add language, Add native, total CP, free-count warning, Language Talent note, Ch3 ladder, Republic-raised, literacy line, legacy literacy input, Cultural Familiarities with the bracket billing hint | yes |
| 8 | Encumbrance & Move (`encumbrance`) `[chip combat-damage]` | encumbrance-section.tsx:99-137, :330-370 | Basic Lift, Encumbrance, Current Move, Current Dodge, EP per Fight, Apply Lifting ST, Jumping tiles; the defenses half is Inventory › Encumbrance & Defenses (U06) | yes |
| 9 | Character Details (`character-details`) | character-details-section.tsx:284-462 | Droid status button (conversion / reset confirmations, `attributeResetsForDroid`, `grantDroidBaseline` / `removeDroidBaseline`), droid power note, Height (SM derives on edit), Weight, SM (droid: derived, locked; hint + Apply SM), Age, Appearance | partial — the body-weight hint (`formatBodyWeight`) is not rendered |
| 10 | Narrative (`narrative`) | narrative-section.tsx | Physical Description, Background & History, Notes — three plain textareas | yes |
| 11 | Point Ledger (`point-ledger`) `[chip core-system-attributes]` | basic-info-section.tsx:153-304 + `stats.points` | itemised points, Total Spent, Point Total, Remaining, weight / cost totals, Other Points input, Trade CP for Credits (Digital / Physical; moves credits on the Currencies rows) | yes |

## Body / Abilities / Inventory / Vehicles (U06 — `module/apps/actor-sheet-tabs.mjs`)

See `docs/STYLE-SPEC.md` §3.3 rows B0-B4, A1-A8, N0-N8, V1-V4 and U06's `check:sheet-tabs`.
