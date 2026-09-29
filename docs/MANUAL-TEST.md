# Manual test script — what the headless checks cannot see

Status: COMPLETE for 2.0.0 (unit U10, 2026-09-10; the U02b skeleton with every
row units U03–U09 asked for folded in; 2026-09-19 fix pass added the Ch9 posture
+ elevation steps and the applyPosture live-repaint step). Every section is something
`node scripts/check-all.mjs` cannot verify because no Foundry runs on the build
machine (ARCHITECTURE.md §9): rendering, form binding, drag-drop, chat cards,
the token HUD, the combat tracker, sockets. Each step names the figure it must
show; the figures are the engine's answers, proven headlessly by the checks
(`check:rolls`, `check:packs`, `check:hud`, `check:sheet-tabs`,
`check:item-sheets`, `check:apps`, `check:settings`), so a manual step that
disagrees is a Foundry-side defect, not a rules question.

Fill in the **result** column when running; leave **expected** alone (it drifts
only when a check's pin drifts). Steps marked UNVERIFIED are Foundry v13
behaviours the code assumes without a client — a failure there is a shim gap to
fix in `tools/foundry-shim*.mjs` as much as a bug.

## 0. Setup

- Foundry VTT **13.346** (or `compatibility.verified` in `system.json`), a fresh world on this system, the packs built (`npm run build`).
- Console open (F12): the load prints `shadowbase | init: engine loaded` and `shadowbase | ready`, NO `MissingExport` warning, no 404 (nine stylesheets, all present).
- Fixtures: `fixtures/export-sahrhie-vosst-2026-09-06.json`, `fixtures/export-hshif-2026-09-05.json`, `fixtures/legacy-2025-kaelen-rarr.json`.
- Fixed figures (the checks' pins): blank character **Dodge 8**; Sahrhie **245** CP spent / HP **12** / Dodge **10** / Basic Speed **6**; Hshif **241** / **13** / **9** / **6**; Rokarr **Guns (Blaster Pistol) 11** (via Guns (Bowcaster) −2), Bowcaster **Attack 13**, Malf **17**, HP **17**; the 2025 Kaelen file **103** (not its stored 178); the Assassin Droid's derived **IQ 12**.

## 1. Rendering

| step | expected | result |
|---|---|---|
| Create Actor → Character "Fresh" | the sheet opens on Info; a Credit Chip equipment Item and 12 anatomy rows (Body › Hit Locations) exist; credits 7000; points 0 / 150; Dodge **8** in Encumbrance & Move | |
| Header › Import `export-sahrhie-vosst-2026-09-06.json` (confirm) | points **245** spent; HP **12**; Dodge **10**; Basic Speed **6**; the load notices appear as notifications; portrait empty (fixture) | |
| Import `export-hshif-2026-09-05.json` | points **241**; HP **13**; Dodge **9**; Basic Speed **6** | |
| Import `legacy-2025-kaelen-rarr.json` | points **103** (NOT the file's 178); three notices: Force Points capped, Languages updated, Languages are structured rows | |
| Open the Assassin Droid template (Compendia › Characters › Droids) | ST/DX/IQ/HT inputs blank (null = derive) with the hardware figure as placeholder; derived IQ **12**, not 10; pools HP / PP (no EP/FP) | |
| Open every tab on Rokarr (Wookiee Republic Soldier), Vex Korta, Kaelen Rarr, the Assassin Droid, a vessel owner (a starship template) | no console error; every section in the website's order (`templates/actor/README.md` checklist); Info's eleven sections open by default | |
| Info: the eleven `<details>` sections | each opens / closes; with the client setting *Remember open sections* ON the closed set survives a close/reopen of the sheet (per actor); OFF, every section opens on reopen | |
| Header › Preferences | the dialog lists Handbook shortcuts / Point costs / Compact rows / Pin section headers / Reduce motion / Remember open sections; Save writes Configure Settings › ShadowBase (the same values show there); Compact rows ON sets `data-compact-rows="true"` on the sheet root AND on an open HUD / item sheet (inspect the element); the row padding tightens | |
| Configure Settings › ShadowBase | three world settings (Enforce the combat economy — reserved; Hide imported dossiers; Sync token rotation) with the GM only; **eleven** client settings with the website's defaults (chips ON, costs ON, compact OFF, sticky ON, motion OFF, remember OFF, apply posture ON, track elevation ON, keep history ON, depth 10, notifications 12); changing Point costs re-renders open actor sheets without a reload (`onChange`) | |
| Point costs OFF | the `[±N pts]` cost lines under each attribute disappear (`data-point-costs="false"`); ON, they return | |
| Combat State: set Posture to **Crawling** (any non-standing) and, with Track Elevation on, Elevation **5** | the posture `<select>` persists to `system._source.posture`; with Apply Posture ON the derived numbers drop per Ch9 (Crawling: Dodge **−3**, so Rokarr's Dodge **10 → 7**) and a "Chapter 9" tactical effect appears; Elevation persists to `system._source.elevation` and shows "Elevation +5 yd" | |
| Configure Settings › ShadowBase: with that non-standing posture set, toggle **Apply Posture Modifiers** OFF then ON | OFF repaints Current Dodge, the Active Tactical Effects badges and the roll modifiers to their un-applied values **without a reload** (Rokarr Dodge 7 → 10); the Combat State "recorded, not applied" note appears only while OFF and the numbers never contradict it; ON restores the applied values. (This is the 2026-09-19 fix: refreshPreferenceRoots re-derives the actor before re-rendering — a render-only path would leave the numbers stale while the note flipped.) | |
| Configure Settings › ShadowBase: toggle **Track Elevation** OFF/ON | the Combat State Elevation field hides/shows without a reload and keeps its value either way; an off-ground elevation's "Elevation +N yd" status line follows | |
| Handbook shortcuts OFF | every section-heading chip disappears (`data-handbook-chips="false"`) | |
| Reduce motion ON | no accordion / panel animation on any ShadowBase window | |
| Blank ST input | placeholder = the baseline (10, or the racial figure); typing **12** prices it (the ledger's Attributes line moves by 20) and `_source.strength` is a number | |
| Force Alignment slider | mirrors Light Side / Dark Side points; the tier label follows (Aligned at ±25, Deeply Aligned at ±75) | |
| Trade CP: 2 | 1,400 CR land on the Credit Chip (700 / CP), the ledger shows the trade | |
| Combat State: Engage + click a hexside + Turn to face | `threatEngaged` on, `incomingBearing` set, the facing turns and `facingChangeUsed` becomes true; a second turn is refused until the sweep | |
| Reset all pools | HP / EP / FP return to max (stored null = full) | |
| Right-click a character in the Actors directory | an **Open Tactical HUD** entry (characters only) opens the HUD (UNVERIFIED: `getActorContextOptions` entry shape) | |

## 2. Form binding

| step | expected | result |
|---|---|---|
| Clear the HP (max) input and blur | `actor.system._source.hitPoints` is **null**; derived HP falls back to HT | |
| Type `12` into ST | derived figures update without reload; `_source.strength` is a number | |
| Edit an inventory row's quantity inline | the Item's `system.row.quantity` changes; nothing else on the row moves | |
| Rename an item through `customName` | the Item's name mirrors it (preUpdateItem) | |
| A skill's Level input | writes a STRING (`system.row.level` "12", not 12) | |
| A Force power's Level select | re-reads the catalog: cpCost and effect follow the level | |
| Info › Combat State › Posture `<select>` and Elevation input (submitOnChange) | selecting a posture writes `system._source.posture` and re-renders once; with Apply Posture ON the derived Dodge/Move/to-hit update in the same render; the Elevation number writes `system._source.elevation` (blank keeps 0) and only shows while Track Elevation is on | |
| Body › Hit Locations › Innate DR; Inventory › storage-box rename; Vehicles › a starship system's HP | each writes the WHOLE array (`actor.system.hitLocations` / `storageBoxes` / the row's `systems` in the console: an array, the other rows byte-identical) — never a per-index dotted key | |
| Inventory › Send to storage | moves the row into the box (`storageLocationId`); the wallet excludes boxed currency | |
| Inventory › an item's Export button | downloads `<slug>.shadowbase-item.json` (the versioned envelope with the parts closure); Import accepts it; a name collision prompts Replace / Rename / Stack / Ignore | |
| Header › Import JSON | replaces the actor after a confirm and shows the load notices | |
| Header › Edit portrait | the picked image is downscaled to 512 px (browser canvas) and stored in `system.characterPortrait` as a data URL; `actor.img` stays a file path | |
| Droid Workshop: fill slot 3 of an empty chassis array | `droidBuild.chassisMods.internalIds` stays SPARSE in memory; after a reload the holes read as `null` (LevelDB JSON) — the website treats null and hole alike | |
| Item sheets: `submitOnChange` | one `system.row.<key>` write per input and a re-render; a blanked number stores null (UNVERIFIED: FormDataExtended's cast — the sheet nulls NaN itself) | |

## 3. Drag and drop, compendia, handbook

| step | expected | result |
|---|---|---|
| Compendium sidebar | the 32 packs appear under the 10 `packFolders` with their inner folders (UNVERIFIED: the embedded Folder document shape); players can browse (ownership OBSERVER) | |
| Drag "Blaster Pistol" (Ranged Weapons) onto a character | **6** Items arrive (the weapon + 5 parts, parts installed in the weapon, fresh uuids, host references rebound); the card reads **1,734 cr / 2.8 lb / Dur 11** | |
| Drag "Beskar'gam Gauntlets" (Armor) | two rows, one per hand | |
| Drag "Advanced Repulsorlift Stabilizers" (Starship Modifications) | refused with a warning (a catalog pick, not an inventory item) | |
| Drag a second "Combat Reflexes" | refused ("already on this sheet") | |
| Drag a Force Power (per-name compendium Item) | a level-1 row is created; the sheet's level select offers the catalog's levels | |
| Drag "Rokarr (Wookiee Republic Soldier)" (Character Templates) onto an existing character's sheet | asks to confirm, then replaces the sheet (name kept); HP **17/17** | |
| Import Rokarr from the sidebar | a full actor with linked token bars HP / EP | |
| Open several of the 65 template Actors (Compendia › Character Templates) | each loads with its inline embedded Items (and effects) intact — no missing rows, no duplicates, no console error from the nested `!actors.items!` / `!actors.effects!` `_key` fields the pack build stamps on the embedded docs | |
| Drop a `.json` character file on a sheet | import with the figures of §1 | |
| Catalog / template drop routing | a compendium Item / template Actor dropped on the character sheet is handled by the sheet's own v13 `_onDropItem` / `_onDropActor` → `compendium-drop.mjs` (there is NO `dropActorSheetData` hook — it is Application-V1 only and never fires for an ActorSheetV2); a non-catalog world Item still takes Foundry's default drop | |
| Open a handbook entry (Compendia › Rules › Handbook) | 24 entries / **171** pages; tables render inside `.sb-handbook-table` (wide ones scroll); "Chapter N" mentions are live `@UUID` links to the other entries | |
| HUD › Handbook › a hit › Open in Journal | the entry opens at that page scrolled to the heading (UNVERIFIED: Foundry uses the heading's `id` as its TOC anchor; if it slugifies the text instead, regenerate `handbook/handbook-map.json`'s anchors with Foundry's `slugify`) | |

## 4. Chat cards and rolls

| step | expected | result |
|---|---|---|
| Rokarr: roll Guns (Blaster Pistol) from the Abilities tab | target **11**; Skill / Target / Rolled [d,d,d] / Result / margin lines | |
| Blank character: roll Dodge | target **8** | |
| Roll damage `2d+1 pi` (Custom Roll) | translated to `2d6+1`, minimum 1, flavor `pi` | |
| Roll-mode chooser in the prompt | `gmroll` whispers to the GMs, `blindroll` is blind, `selfroll` private | |
| A hit, then the card's **Roll damage** button; a power card's **Apply costs** | both route through `renderChatMessageHTML` and work for the roller only (owner check) | |
| The situational-modifier prompt | Enter rolls; Cancel posts nothing; the off-hand toggle appears only while dual wielding | |
| Stunned (Physical) | every attack button refuses with the stun notice; Dodge / Parry / Block carry −4 | |
| Stun recovery (HUD) | rolls HT (Physical) / IQ (Mental) + the `stunRecovery` channel; success clears `stunType` | |

## 5. Token HUD and status effects

| step | expected | result |
|---|---|---|
| CONFIG.statusEffects icons and HUD grid | each status renders its Foundry-core icon via `img` (v13 uses `img`, not `icon`); the `hud:false` statuses (encumbered, flanked) do NOT appear in the token-HUD toggle grid but still display on the sheet Combat State / HUD Status tab | |
| Set stunType Physical on the sheet | the token shows the `stunned-physical` icon (daze); the HUD's Status tab lists ONE "Stunned (Physical)" card | |
| Stun mirror idempotency & swap | setting Physical then Mental leaves exactly one stun mirror (the Physical→Mental swap, no duplicate); re-setting the same value writes nothing; toggling a core stun status from the token HUD is adopted as the stored `stunType` | |
| Toggle `Stunned (Mental)` from the token HUD | the sheet's stunType reads Mental; the physical icon is gone; exactly one stun icon | |
| Remove the stun icon from the token HUD | stunType None | |
| Toggle `Bleeding` from the token HUD | a manual stored effect "Bleeding" appears in the HUD Status list and in the export's `statusEffects` | |
| Apply a stimulant with a crash phase (equipment), then **Advance** in the HUD | current EP drops by the crash figure; the row becomes "<name> Crash"; max EP unchanged | |
| Dismiss a legacy stimulant (description "Crash: Lose 3 EP", no phases) | EP −3 and a "<name> Crash" informational card | |
| Damage Processor: 5 injury to the torso on an organic | a Shock (−4) card with `expiresAfterTurn = turn + 1`; advancing the turn counter twice removes it and notifies "Effects expired: …" | |
| Token bars | the HP bar edits `system.currentHitPoints` (may go below 0); EP / FP / PP bars clamp at 0 and max | |
| World setting *Sync token rotation with facing* ON: set facing 2 on the sheet | the actor's linked tokens rotate to **120°**; setting facing 2 again writes nothing; rotating a token by hand to ~300° writes facing **5** back; OFF (default), neither direction moves (UNVERIFIED: `getActiveTokens(true, true)` and `updateToken` on the writing client; the art is assumed to face up at rotation 0) | |

## 6. Tactical HUD

| step | expected | result |
|---|---|---|
| Header › HUD on Rokarr | opens at 470×760 on the right, resizes, and reopens where it was left (user flag `hudPosition`; UNVERIFIED: `_onPosition` fires on resize) | |
| Actions: the Bowcaster card | Attack (**13**) with a Main badge and Malf **17**; Attack rolls with the prompt; a hit enables Damage (×1); Damage rolls the card's formula and clears the bank | |
| Custom Roll `2d6+1` | posts a damage card | |
| Defensive Action Matrix on a melee card | Parry greyed while unready; the Ready button restores it | |
| Combat Economy chips | appear when EP drops below a third (Vicious Cycle); never block a roll | |
| Status: type 5 into HP | writes `system.currentHitPoints` 5 and the token bar follows; clearing it stores null (full) | |
| Status: Add Custom with +2 DX | a green "+2 DEX" badge; the DX roll target moves by 2 | |
| Status: Advance on a Combat Stimulant row | deducts the crash EP and shows the next phase; the X dismisses a manual row; no gear row shows an X | |
| Status: click Torso, 8 cutting | Final Injury **12** HP (DR 0); Apply Wounds lowers HP, stores a Shock (−4) effect and warns MAJOR WOUND; the HT prompts arrive as `ui.notifications.warn` | |
| Handbook: type "hit loc" | lists Ch7 with "Hit Locations"; "shock baton" auto-searches after ~0.5 s and lists a Ch12 table hit "Batons/Tonfa"; clicking it opens Ch12 scrolled to the heading | |
| Footer | every roll appears in Roll History (newest first, depth 10); the gear changes the depth to 25 (Configure Settings shows 25) and the history grows; the bell counts the HUD's outcomes; a pin survives a reload (`system.pinnedNotifications`); the pin cap is depth − 1 | |
| `actor.apps` | item / effect updates re-render the open HUD (UNVERIFIED headlessly) | |

## 7. Combat tracker

| step | expected | result |
|---|---|---|
| Add Sahrhie to combat | initiative shows Basic Speed with DX in the hundredths (e.g. `6.13`), no die animation | |
| Advance the round | every tracked combatant's `turnCounter` follows; `facingChangeUsed` false; `parriesThisTurn` 0; expired effects removed with the "Effects expired" notice | |
| `actor.setFlag('shadowbase', 'autoTurnCounter', false)` | that actor opts out of the round sync | |
| Two GMs connected | only the ACTIVE GM's client writes (one update per actor per round) | |

## 8. Item sheets and builders

| step | expected | result |
|---|---|---|
| Open each of the 21 Item types from a sheet row | the family's tabs (Overview / Assembly / Modifications / Internals / Notes as the family has them) and the header strip | |
| Rokarr's Bowcaster: Swap Components | releases the five kit parts (the Inventory tab's Ranged Structural Components rows read Loose); choosing "Rifle Stock" under In Inventory re-claims the row (Installed in Bowcaster); Confirm Construction stamps FINALIZED / Built | |
| Direct Library Access (header and strip) | absent for a player; for the GM, ON lists the Component catalog in every slot; never stored on the item | |
| Load the spare Rifle Power Pack | decrements it and fills Charges; unloading puts it back | |
| Transfer button | downloads `<slug>.shadowbase-item.json` with the parts closure | |
| Forge / Deconstruct | open the Crafting window on the item | |
| A lightsaber's Shared Coupler pick | opens Blade 2's slots and internals | |
| An armor Piece's DR table | edits write `drEntries`; Add missing flaws creates the Ch14 disadvantage rows on an implant | |
| A starship's system HP; an implant's Installed-at select | the whole `systems` array / `hitLocations[].installedHardwareIds` (inspect in the console: arrays) | |

## 9. Sub-apps

| step | expected | result |
|---|---|---|
| Body › Workshop / Load-Out / Anatomy buttons | one window per actor; it re-renders when the sheet changes (`actor.apps`) | |
| HK Assassin Droid: choose a part in an Internal System Bay | `actor.system.droidBuild.chassisMods.internalIds` is an ARRAY with null holes and index 99 = the Backup Power Array; a select in a warped slot refuses | |
| A swap on a built droid | opens the Crafting window; a critical failure ruins the part / drains 20 PP / warps the slot | |
| Anatomy Workshop's link picker | installs an implant on the location and flags the implant row | |
| Load-Out's wear picker | enforces Ch13's base layer (a second helmet takes the first off, with the notice); Ready puts the Bowcaster in the right hand with the 2H notice; the pin checkboxes move it | |
| Suits & Sets: deal the Combat Suit | seven rows named Combat Suit Helmet / Cuirass / Greaves / Gauntlet (Right Hand) / (Left Hand) / Boot (Right Foot) / (Left Foot), grouped as one Preset Suit in Outfits | |
| Crafting window: Roll | a chat card per phase; the failed-run consequences apply on Confirm Result | |
| Actors directory: Import Dossiers (GM only; UNVERIFIED: the `.directory-header .action-buttons` selector) | the plan table names an invalid file's reason; Skip / Overwrite / Save as copy; imported actors are hidden from players while *Hide imported dossiers* is ON; OFF, they get the world's default ownership | |

## 10. Sockets / multi-client

| step | expected | result |
|---|---|---|
| Two clients, GM sets stunType on a player's actor | exactly ONE stun mirror effect is created (only the changing client acts: `userId === game.userId`) | |
| Player toggles a token status while the GM has the sheet open | the GM's sheet re-renders with the effect; no duplicate | |
| Player rotates a token with rotation sync ON | the player's client writes the facing once; the GM's client writes nothing | |

## 11. Export

| step | expected | result |
|---|---|---|
| Export Sahrhie after §1 | a file the website imports without notices; `points.spent` 245; `characteristics.damage.thrust` present (filled from live stats) | |
| Export after a crash advance | `statusEffects[].modifiers.endurancePoints` is 0 on the advanced row | |
| Export a droid | `droidBuild` keeps its sparse arrays (nulls in the JSON); the website reloads it with the same CP | |

## 12. The one-time world update (2026-09-28, species-package revision 2)

`module/world-update.mjs`, held headlessly by `check:world-update` (184 world actors at revisions 0 / 1 / 2, plus one that fails part-way and two with unreadable sheets). What only a live world shows: the ready hook firing, the whisper, and the update surviving a reload.

| step | expected | result |
|---|---|---|
| Reload a world whose actors predate 2026-09-28 (e.g. the "Test" world), as the GM | once, after `shadowbase \| ready`: a notification "ShadowBase: N actor(s) updated to species-package revision 2", and ONE chat card whispered to the GM titled "World update to species-package revision 2", listing each actor whose species package changed (added / removed traits) and counting the ones only marked | |
| Open an actor made from a species template before today (e.g. a Wookiee) | its racial traits are the same rows as before (same Items, nothing recreated), now marked as the species' own; points spent unchanged | |
| Change that actor's species to Human | every Wookiee racial trait comes off (Rokarr: all 11), bought traits stay; Total Spent moves only by the size change (Rokarr 153 → 156) | |
| Reload the world again | no notification, no card: every actor is at revision 2 | |
| Log in as a player (second browser) during a GM's first load | the player's client writes nothing (no permission errors in its console) | |
