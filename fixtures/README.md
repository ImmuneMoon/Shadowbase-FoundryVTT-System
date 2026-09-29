# fixtures/ — character JSON exports used by the checks

Every `*.json` here is read by `check:engine-parity`, `check:adapter-round-trip`
and (later) `check:rolls` as a REAL character file: imported through the
engine's own `convertJsonToSheet`, spread over `blankSheetData`, then run
through `applyLoadMigrations` — the website's load path, so the sheet the
checks see is the sheet a running app would see (the website `CLAUDE.md`:
"read the corpus through the transform"). Never hand-edit a figure in these
files; a fixture whose numbers drift to match the code constrains nothing.

`fixtures/husk/` is NOT a character file: see the last section.

## Provenance

| file | origin | why it is here |
|---|---|---|
| `export-sahrhie-vosst-2026-09-06.json` | a player's export `sahrhie_vosst_shadowbase(4).json`, the newest export of that name by mtime (2026-09-06 00:21), 200,942 bytes | a current-format player character with a full inventory; the `points.spent` **245** / HP 12 / Dodge 10 / Basic Speed 6 fixed targets of ARCHITECTURE.md §9 |
| `export-hshif-2026-09-05.json` | a player's export `hshif_shadowbase(3).json`, the newest export of that name by mtime (2026-09-05 07:57), 945,098 bytes | a current-format Force user; `points.spent` **241** / HP 13 / Dodge 9 / Basic Speed 6 |
| `legacy-2025-kaelen-rarr.json` | moved verbatim from `TEST CHARACTERS/kaelen rarr_shadowbase.json` (2025-08-07, 121,131 bytes), the one test character the retired 2025 system shipped | the LEGACY shape: pre-2026 keys, no `stunType`/`facing`/`gearSets`, languages as free text; `applyLoadMigrations` announces `force-point-ceiling`, `languages-rule` and `language-entries` on it |

### Portraits

The two 2026 exports carried base64 portraits of 118,550 and 896,603
characters (the Hshif one alone was 95% of the file). Both are replaced by
`"portrait": null` here — ARCHITECTURE.md §1 says fixtures never carry a
portrait over 512 px, the portrait is never read by a rule, and the exporter's
own contract is `portrait: characterPortrait || null`, so `null` is a value the
importer already handles. The files were re-serialised with two-space
indentation (JSON content otherwise identical to the download).

### Player names

The two 2026 exports named their players (`"player"`). A public repository
carries no player's name, so both are blanked to `""` (2026-09-28); no check
reads the field, and `""` is what the website's blank sheet stores.

Kaelen's portrait is a 211 × 270 PNG (105,358 characters) and stays: it is
under the 512 px line and the file is kept byte-for-byte as the 2025 system
shipped it, which is the point of a legacy fixture.

### The Kaelen figure

The file stores `points.spent: 178`; the engine (the website's
`getCalculatedStats`, both before and after `applyLoadMigrations`) says **103**.
The 178 was written by the 2025 husk's hand-written `calculations.js`, which is
exactly the code the makeover retires. The VALID pin is therefore
**Foundry route == website route** (the actor built by the adapter derives the
same 103 the engine derives from the imported sheet), never "equals the stored
178" — a check that read the file's own figure would be pinning the bug.
`check:adapter-round-trip` records the stored figure only to prove the fixture
still expresses the difference.

## fixtures/husk/actor.js

A verbatim copy of the retired system's `scripts/actor.js` (the original moved
to `_husk/scripts/actor.js`). `check:esm` sweeps `module/**` for Foundry APIs
the v13 rewrite forbids (`foundry.appv1`, `FormApplication`, `Dialog.confirm`,
jQuery, `CHAT_MESSAGE_TYPES`, bare `renderTemplate(` / `loadTemplates(` /
`mergeObject(`). A sweep that finds nothing is indistinguishable from a sweep
whose patterns match nothing, so the check ALSO runs its patterns over this
file and fails unless at least one hits (`CONST.CHAT_MESSAGE_TYPES.ROLL` on the
chat-card lines). Missing file = failed check.
