# Style spec — the website's look, re-derived for Foundry

Status: the checklist every UI unit builds to (U05 wrote it 2026-09-10 from the
website source; U06/U07/U08/U09 read it). The phase-1 `ui-style.md` was lost
with the scratchpad; every figure below was read from the file it cites, not
remembered. Paths are relative to `../ShadowBase Website/`.

Where the Foundry side adopts something the website does NOT do (angular sheet
tabs, `<details>` accordions, Font Awesome instead of lucide), the row says so
and names the ARCHITECTURE decision that owns it.

## 1. Tokens

### 1.1 Colour tokens (`src/app/globals.css` `:root`, HSL triplets; dark is the only theme)

Every one of these exists in `styles/variables.css` under `.shadowbase, .application.shadowbase`
with the SAME name and the SAME value (`check:css-tokens` reads the website file and pins each).

| token | value | website comment / where it is used |
|---|---|---|
| `--background` | `0 0% 10%` | #1A1A1A page ground; inputs and selects (`bg-background`) |
| `--foreground` | `195 53% 79%` | #ADD8E6 pale blue, body text |
| `--card` | `0 0% 13%` | cards, the sticky tab bar (`bg-card/95`) |
| `--card-foreground` | `195 53% 79%` | |
| `--popover` | `0 0% 13%` | roll popover, select menus, tooltips |
| `--popover-foreground` | `195 53% 79%` | |
| `--primary` | `195 53% 79%` | primary buttons, section h3s, active tab text, roll button focus |
| `--primary-foreground` | `0 0% 7%` | text on primary |
| `--secondary` | `0 0% 20%` | secondary buttons, progress/slider track |
| `--secondary-foreground` | `195 53% 79%` | |
| `--muted` | `0 0% 22%` | tab list ground, read-only inputs (`bg-muted/50`) |
| `--muted-foreground` | `0 0% 55%` | captions, hints, table heads |
| `--accent` | `285 17% 64%` | #B096B3 desaturated purple: section titles, handbook chips, inactive tabs, hover fills |
| `--accent-foreground` | `0 0% 7%` | |
| `--destructive` | `0 60% 50%` | delete buttons, stun warnings, rear-arc threats |
| `--destructive-foreground` | `0 0% 98%` | |
| `--border` | `0 0% 20%` | every border (`* { @apply border-border }`) |
| `--input` | `0 0% 16%` | input BORDER colour (`border-input`); the switch's unchecked fill |
| `--ring` | `285 17% 64%` | focus rings (accent purple) |
| `--radius` | `0.375rem` | 6 px; Tailwind `rounded-lg` = radius, `rounded-md` = radius − 2px (4 px), `rounded-sm` = radius − 4px (2 px) |
| `--sidebar-background` | `0 0% 12%` | navbar/sidebar family (declared, kept for parity) |
| `--sidebar-foreground` | `195 53% 79%` | |
| `--sidebar-primary` | `195 53% 79%` | |
| `--sidebar-primary-foreground` | `0 0% 7%` | |
| `--sidebar-accent` | `285 17% 64%` | |
| `--sidebar-accent-foreground` | `0 0% 7%` | |
| `--sidebar-border` | `0 0% 20%` | |
| `--sidebar-ring` | `285 17% 64%` | |

`--chart-1..5` are referenced by `tailwind.config.ts` but never defined in `globals.css` (no chart on the sheet); not carried.

### 1.2 Fonts

| token | value | source |
|---|---|---|
| `--font-body` / `--font-headline` | `Inter, sans-serif` | `tailwind.config.ts` `fontFamily.body/headline`; `layout.tsx` sets `font-body antialiased` on `<body>`; `globals.css` body falls back to `var(--font-inter), sans-serif` |
| `--font-code` | `monospace` | `fontFamily.code`; the sheet's `font-mono` (costs, dice, hexside labels) |

Foundry: `Inter, system-ui, sans-serif` with NO webfont fetch (ARCHITECTURE §6.6). Weights the sheet uses: 500 (`font-medium`, labels and buttons), 600 (`font-semibold`, section titles), 700 (`font-bold`, figures and uppercase captions).

### 1.3 Type scale (Tailwind defaults as the sheet uses them; counts are call sites under `src/components/character-sheet`)

| class | size / line | used for (count) |
|---|---|---|
| `text-[6px]`..`text-[8px]` | 6–8 px | badge micro-labels inside item cards (84 + 12 + 2) |
| `text-[9px]` | 9 px | uppercase captions on tiles, credit labels (188) |
| `text-[10px]` | 10 px | the sheet's caption size: hints, uppercase group labels, chip labels (517) |
| `text-[11px]` | 11 px | explanatory paragraphs under controls (98) |
| `text-xs` | 0.75rem / 1rem | secondary text, small buttons (413) |
| `text-sm` | 0.875rem / 1.25rem | form labels (`FormRow`), inputs on md+, body copy (204) |
| `text-base` | 1rem / 1.5rem | inputs below md (3) |
| `text-lg` | 1.125rem / 1.75rem | sub-section h3 (`text-primary`), stat figures (47) |
| `text-xl` | 1.25rem / 1.75rem | section accordion titles (`font-semibold font-headline text-accent`) (34) |
| `text-2xl` | 1.5rem / 2rem | HUD title, External Storage h3 (9) |
| `text-3xl` | 1.875rem / 2.25rem | HUD Dodge/Move tiles (3) |
| `text-md` | not a Tailwind size (no-op, inherits 1rem) | 35 call sites; treat as `text-base` |

### 1.4 Literal palette colours (Tailwind defaults) the sheet uses beside the tokens

`styles/variables.css` declares each as `--sb-<name>` (hex from the Tailwind v3 palette). Usage counts under `src/components/character-sheet`.

| Tailwind class | hex | `--sb-*` token | meaning on the sheet |
|---|---|---|---|
| `text-amber-500` (85), `/80`, `/90`, `bg-amber-500/5..20`, `border-amber-500/10..50` | `#f59e0b` | `--sb-amber-500` | advisories: Combat Economy chips, "Side" arc, legacy-text warnings, credit tracking on, physical credits |
| `text-amber-400` (31), `border-amber-400` | `#fbbf24` | `--sb-amber-400` | physical (Aurodium) credit figures |
| `text-amber-300` (1) | `#fcd34d` | `--sb-amber-300` | Reaction Modifier headline |
| `text-amber-600`, `bg-amber-600/5` | `#d97706` | `--sb-amber-600` | rare emphasis |
| `text-green-400` (28), `/80`, `/90`, `border-green-400` | `#4ade80` | `--sb-green-400` | positive modifiers ("Mod: +2"), Remaining points ≥ 0, gear bonus |
| `text-green-500` (14), `bg-green-500/10..20`, `border-green-500/20..50` | `#22c55e` | `--sb-green-500` | success, PP battery > 20 |
| `bg-green-600` (12), `bg-green-700` (11) | `#16a34a`, `#15803d` | `--sb-green-600`, `--sb-green-700` | "Equipped"/"Ready" filled buttons and their hover |
| `text-red-400` (18), `border-red-400/30`, `ring-red-400` | `#f87171` | `--sb-red-400` | negative modifiers, Dark Side label/moon |
| `text-red-500` (13), `border-red-500`, `bg-red-500/5..20` | `#ef4444` | `--sb-red-500` | Remaining points < 0, off-hand penalty, PP battery ≤ 10 |
| `bg-red-600`, `bg-red-700`, `text-red-300`, `text-red-50` | `#dc2626`, `#b91c1c`, `#fca5a5`, `#fef2f2` | `--sb-red-600`, `--sb-red-700`, `--sb-red-300`, `--sb-red-50` | destructive filled buttons and their text |
| `text-blue-400` (21), `bg-blue-500/10..20`, `border-blue-500/30` | `#60a5fa`, `#3b82f6` | `--sb-blue-400`, `--sb-blue-500` | digital (Credit Chip) figures and the chip toggle |
| `text-blue-300` (2), `text-blue-200` | `#93c5fd`, `#bfdbfe` | `--sb-blue-300`, `--sb-blue-200` | Light Side label/sun |
| `bg-blue-600`, `bg-blue-700` | `#2563eb`, `#1d4ed8` | `--sb-blue-600`, `--sb-blue-700` | filled info buttons |
| `text-emerald-400`, `border-emerald-400/30`, `bg-emerald-400/10` | `#34d399` | `--sb-emerald-400` | "installed"/"proven" states |
| `text-sky-400`, `border-sky-500/50` | `#38bdf8`, `#0ea5e9` | `--sb-sky-400`, `--sb-sky-500` | starship readouts |
| `text-yellow-400` | `#facc15` | `--sb-yellow-400` | one warning glyph |
| `bg-black/10` (24), `/20`, `/40`, `/80` | `#000` at α | `--sb-black` | recessed panels (facing band, item cards, jump tiles), dialog overlay `/80` |
| `bg-white/5` (12), `text-white` (23) | `#fff` at α | `--sb-white` | hover wash on card headers; text on filled green/red/blue buttons |
| `hsl(38 92% 50%)` (facing-hex.tsx `arcTone`) | | `--sb-arc-side` | the Side arc colour (Rear = `--destructive`, Front = `--accent`) |
| `rgba(59,130,246,0.3)`, `rgba(245,158,11,0.3)` | | (shadows) | glow behind the active credit toggle (`shadow-[0_0_10px_...]`) |

Success/failure on chat cards (U04, `styles/chat.css`): `#4ade80` / `#f87171` — the same green-400 / red-400.

### 1.5 The alignment spectrum (`globals.css` `.alignment-spectrum`)

Ch8's thresholds mapped onto a −100..+100 track at `(value + 100) / 2 %`:

| stop | colour | meaning |
|---|---|---|
| 0% | `hsl(0 84% 52%)` | −100 deepest Dark |
| 12.5% | `hsl(0 88% 68%)` | −75 Deeply Dark-Aligned begins |
| 37.5% | `hsl(0 0% 46%)` | −25 Dark-Aligned begins; the Unaligned band is flat grey from here |
| 62.5% | `hsl(0 0% 46%)` | +25 Light-Aligned begins |
| 87.5% | `hsl(213 94% 74%)` | +75 Deeply Light-Aligned begins |
| 100% | `hsl(217 91% 58%)` | +100 deepest Light |

Foundry class: `.sb-alignment-spectrum` (identical gradient), the slider's fill hidden (`rangeClassName="bg-transparent"` on the website: position is the meaning, not a quantity), a 2 px × 1rem `background/80` notch at true zero.

## 2. Component recipes (plain CSS, translated from `src/components/ui/*.tsx`)

All under `.shadowbase`. Tailwind spacing: 1 unit = 0.25rem. `ring-offset-background` focus rings become `outline: 2px solid hsl(var(--ring)); outline-offset: 2px`.

| component (file) | Foundry class | recipe |
|---|---|---|
| Card (`card.tsx`) | `.sb-card` | `border: 1px solid hsl(var(--border)); border-radius: var(--radius); background: hsl(var(--card)); color: hsl(var(--card-foreground)); box-shadow: 0 1px 2px 0 rgb(0 0 0 / .05)`. Header `padding: 1.5rem; display:flex; flex-direction:column; gap:.375rem`; title `font-size:1.5rem; font-weight:600; line-height:1; letter-spacing:-.025em`; description `font-size:.875rem; color: muted-foreground`; content `padding: 0 1.5rem 1.5rem`; footer `display:flex; align-items:center; padding: 0 1.5rem 1.5rem`. Item cards on the sheet use `bg-black/10 shadow-md overflow-hidden` with a `p-4` header that toggles expansion on click and washes `bg-white/5` on hover. |
| Accordion (`accordion.tsx`) | `.sb-section` on `<details>`, `.sb-section__summary` on `<summary>`, `.sb-section__body` | Item: `border-bottom: 1px solid border`. Trigger: `display:flex; flex:1; min-width:0; align-items:center; justify-content:space-between; padding: 1rem 0; font-weight:500; text-decoration on hover: underline`; chevron `1rem` square, `transition: transform .2s`, rotated 180° when open. Section TITLES on the sheet add `font-size:1.25rem; font-weight:600; color: accent` (`text-xl font-semibold font-headline text-accent`); nested sub-accordions use `text-lg font-semibold text-primary hover:no-underline`. Content wrapper `overflow:hidden; font-size:.875rem`; body `padding: 0 0 1rem` (`pb-4 pt-0`), and every section body on the sheet adds `pt-4` (1rem top). Marker attributes the preferences hook targets: `data-accordion-trigger` on the trigger, `data-accordion-body` on the body. Sticky headers (pref) park at `top: var(--sheet-section-sticky-top, 8rem); z-index:30; background: card/95; backdrop-filter: blur(4px)`. Foundry uses native `<details open>` (ARCHITECTURE §6.1); open state is remembered per user and actor (a client flag, replacing the website's `shadowbase.open-sections` localStorage key). The website's open/close height animation (`accordion-down/up` 0.2s ease-out) is dropped — `<details>` has no measurable height to animate. |
| Badge (`badge.tsx`) | `.sb-badge`, `-secondary`, `-destructive`, `-outline` | `display:inline-flex; align-items:center; border-radius:9999px; border:1px solid transparent; padding: .125rem .625rem; font-size:.75rem; font-weight:600; transition: color .15s`. default `background: primary; color: primary-foreground` (hover α .8); secondary `background: secondary; color: secondary-foreground`; destructive `background: destructive; color: destructive-foreground`; outline `border-color: currentColor-ish (the token border); color: foreground`. Sheet variants seen: `font-mono text-[10px]` count badges, `h-6 text-[10px] border-accent/30 bg-accent/5` effect badges (debuff: `border-destructive/30 bg-destructive/5 text-destructive`). |
| Button (`button.tsx`) | `.sb-btn` + `-default` `-destructive` `-outline` `-secondary` `-ghost` `-link`; sizes `-sm` `-lg` `-icon` | Base: `display:inline-flex; align-items:center; justify-content:center; gap:.5rem; white-space:nowrap; border-radius: calc(var(--radius) - 2px); font-size:.875rem; font-weight:500; transition: color .15s, background-color .15s; disabled: pointer-events:none; opacity:.5; svg: pointer-events:none; flex-shrink:0`. Sizes: default `height:2.5rem; padding:.5rem 1rem`; sm `height:2.25rem; padding: 0 .75rem`; lg `height:2.75rem; padding: 0 2rem`; icon `height:2.5rem; width:2.5rem; padding:0`. Variants: default `background: primary; color: primary-foreground` (hover α .9); destructive `background: destructive; color: destructive-foreground` (hover α .9); outline `border:1px solid input; background: background; hover: background accent, color accent-foreground`; secondary `background: secondary; color: secondary-foreground` (hover α .8); ghost `background:none; hover: accent/accent-foreground`; link `color: primary; text-decoration: underline on hover; underline-offset: 4px`. Sheet-specific: the uppercase micro buttons `h-8 px-4 text-[10px] font-bold uppercase border-accent/30`; the reset arrows `ghost icon h-8 w-8`. |
| Tabs (`tabs.tsx`, the sheet's TabsList at `character-form.tsx:577`) | (website recipe recorded; Foundry uses the angular tab below — ARCHITECTURE §6.6) | List: `display:inline-flex; min-height:2.5rem; align-items:center; border-radius: calc(radius - 2px); background: muted; padding:.25rem; color: muted-foreground; flex-wrap:wrap`; on the sheet: `grid-cols-5 h-11 gap-1 sticky top-[var(--sheet-sticky-top,5rem)] z-40 bg-card/95 backdrop-blur-sm`. Trigger: `display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; border-radius: calc(radius - 4px); padding:.375rem .75rem; font-size:.875rem; font-weight:500`; inactive `background: accent/70; color: accent-foreground`; inactive hover `background: muted; color: accent`; active `background: muted; color: primary; box-shadow: 0 1px 2px rgb(0 0 0/.05)`. Each trigger carries a 1rem icon with `margin-right:.5rem`. Content `margin-top:.5rem`. |
| Angular tab (`src/components/layout/angular-tab.tsx`, navbar `--tab-cut-size: 1rem`) | `.sb-tabs` / `.sb-tab` | `position:relative; display:flex; align-items:center; justify-content:center; padding: 0 1rem (xl: 1.5rem); height:100%; min-width:104px (xl: 120px); font-size:.875rem; font-weight:500; transition: all .2s ease-in-out; backdrop-filter: blur(12px); clip-path: polygon(var(--tab-cut-size) 0%, 100% 0%, calc(100% - var(--tab-cut-size)) 100%, 0% 100%); margin-left: calc(-1 * var(--tab-cut-size))` (first tab: 0; the row itself pads left by `--tab-cut-size`). Active `background: primary/75; color: primary-foreground; z-index:20; box-shadow: inset 0 2px 4px rgb(0 0 0/.05)`; inactive `background: card/45; color: foreground; z-index:10`; hover `background: accent/75; color: accent-foreground`; focus-visible ring 2px. Icon `1.25rem` square `margin-right:.5rem`, `color: primary` when inactive / `primary-foreground` when active; label `text-overflow: ellipsis`. |
| Input (`input.tsx`) | `.sb-input` | `display:flex; height:2.5rem; width:100%; border-radius: calc(radius - 2px); border:1px solid hsl(var(--input)); background: hsl(var(--background)); padding: .5rem .75rem; font-size:1rem (md+: .875rem); placeholder: muted-foreground; focus-visible: outline 2px ring, offset 2px; disabled: cursor not-allowed, opacity .5`. Read-only calculated fields: `bg-muted/50 border-dashed text-center font-semibold`. Native number spinners are switched OFF globally (`appearance: textfield`); the stepper is the QuantityInput below. |
| QuantityInput (`quantity-input.tsx`) | `.sb-qty` (wrapper), `.sb-qty__arrows`, `.sb-qty__arrow` | Wrapper `position:relative; display:inline-flex; width:100%`. Field: an `.sb-input` of `height:3rem` (h-12; dense rows pin h-6/h-7/h-8) with `padding-right: 32px` set INLINE (28 px arrow column + 4). Arrow column: `position:absolute; top:1px; bottom:1px; right:1px; width:28px; display:flex; flex-direction:column; overflow:hidden; border-left:1px solid input; border-radius: 0 5px 5px 0`; each arrow `flex:1; min-height:0; display:flex; align-items:center; justify-content:center; color: muted-foreground; hover: background accent, color accent-foreground`; the lower arrow has `border-top:1px solid input`; chevrons `.75rem`. Stepping calls `stepUp/stepDown` and dispatches a real `input` event. |
| Select (`select.tsx`) | `.sb-select` | Trigger: as `.sb-input` (`h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm`) with a `1rem` chevron at `opacity:.5` on the right, `justify-content: space-between`. Content: `z-index:50; max-height:24rem; min-width:8rem; overflow:hidden; border-radius: calc(radius - 2px); border:1px solid border; background: popover; color: popover-foreground; box-shadow: 0 4px 6px -1px rgb(0 0 0/.1)`; viewport `padding:.25rem`; item `padding: .375rem .5rem .375rem 2rem; font-size:.875rem; border-radius: calc(radius - 4px); focus: background accent, color accent-foreground`; a 1rem check at `left:.5rem` marks the selected item. Foundry renders a native `<select>` styled like the trigger (the popover half is the browser's). |
| Switch (`switch.tsx`) | `.sb-switch` | Root: `display:inline-flex; height:1.5rem; width:2.75rem; align-items:center; border-radius:9999px; border:2px solid transparent; cursor:pointer; transition: background-color .15s`; checked `background: primary`; unchecked `background: hsl(var(--input))`; disabled opacity .5. Thumb: `height:1.25rem; width:1.25rem; border-radius:9999px; background: background; box-shadow: 0 10px 15px -3px rgb(0 0 0/.1); transition: transform .15s; translateX(1.25rem) when checked`. |
| Checkbox (`checkbox.tsx`) | `.sb-checkbox` | `height:1rem; width:1rem; flex-shrink:0; border-radius: calc(radius - 4px); border:1px solid primary`; checked `background: primary; color: primary-foreground` with a 1rem check glyph; focus ring; disabled opacity .5. (Foundry v13 draws checkboxes as Font Awesome glyphs — `foundry-chrome.css` restyles them inside `.shadowbase` only.) |
| Tooltip (`tooltip.tsx`) | `.sb-tooltip` | `z-index:50; overflow:hidden; border-radius: calc(radius - 2px); border:1px solid border; background: popover; color: popover-foreground; padding: .375rem .75rem; font-size:.875rem; box-shadow: 0 4px 6px -1px rgb(0 0 0/.1)`; entrance fade+zoom 95%, side offset 4px; long-press (500 ms) opens on touch. Foundry: native `data-tooltip` (core `TooltipManager`) restyled inside `.shadowbase` via `.sb-tooltip`. |
| Progress (`progress.tsx`) | `.sb-progress`, `.sb-progress__bar` | Track `position:relative; height:1rem; width:100%; overflow:hidden; border-radius:9999px; background: secondary`; indicator `height:100%; background: primary; transition: transform .15s; transform: translateX(-(100 - value)%)`. |
| Slider (`slider.tsx`) | `.sb-slider` (a native `<input type=range>`) | Root `position:relative; display:flex; width:100%; align-items:center; touch-action:none; user-select:none`. Track `height:.5rem; flex-grow:1; overflow:hidden; border-radius:9999px; background: secondary` (the alignment slider passes the spectrum as the track and a transparent range). Range (fill) `position:absolute; height:100%; background: primary`. Thumb `height:1.25rem; width:1.25rem; border-radius:9999px; border:2px solid primary; background: background; focus ring; disabled opacity .5`. |
| Table (`table.tsx`) | `.sb-table` | Wrapper `position:relative; width:100%; overflow:auto`; table `width:100%; caption-side:bottom; font-size:.875rem`; header rows `border-bottom:1px solid border`; body: last row `border:0`; footer `border-top:1px solid border; background: muted/50; font-weight:500`; row `border-bottom:1px solid border; transition: background .15s; hover: background muted/50; selected: background muted`; th `height:3rem; padding: 0 1rem; text-align:left; vertical-align:middle; font-weight:500; color: muted-foreground`; td `padding:1rem; vertical-align:middle`; caption `margin-top:1rem; font-size:.875rem; color: muted-foreground`. Compact rows (pref) trim th/td to `padding-top/bottom .25rem`. |
| Separator (`separator.tsx`) | `.sb-separator` | `flex-shrink:0; background: border; height:1px; width:100%` (vertical: `width:1px; height:100%`). The sheet uses `my-6` (1.5rem) between blocks and `opacity-30` in the HUD. |
| Dialog (`dialog.tsx`) | `.sb-dialog` (Foundry: DialogV2 window restyled by `foundry-chrome.css`) | Overlay `position:fixed; inset:0; z-index:50; background: rgb(0 0 0/.8)` fading in. Content `position:fixed; left:50%; top:50%; z-index:50; display:grid; width:100%; max-width:32rem; transform: translate(-50%,-50%); gap:1rem; border:1px solid border; background: background; padding:1.5rem; box-shadow: 0 10px 15px -3px rgb(0 0 0/.1); sm+: border-radius: var(--radius)`; entrance 200 ms fade+zoom 95%. Close `position:absolute; right:1rem; top:1rem; border-radius: calc(radius - 4px); opacity:.7; hover: opacity 1` with a 1rem X. Header `display:flex; flex-direction:column; gap:.375rem; text-align: center (sm+: left)`; title `font-size:1.125rem; font-weight:600; line-height:1; letter-spacing:-.025em`; description `font-size:.875rem; color: muted-foreground`; footer `display:flex; flex-direction: column-reverse (sm+: row, justify-content:flex-end, gap:.5rem)`. |
| Sheet / drawer (`sheet.tsx`, the HUD's shell) | `.sb-drawer` (Foundry: the HUD is an AppV2 window at the right, ARCHITECTURE §6.2) | Overlay as Dialog. Content `position:fixed; z-index:50; gap:1rem; background: background; padding:1.5rem; box-shadow lg; transition ease-in-out (open 500 ms, close 300 ms)`; side `right`: `inset-y:0; right:0; height:100%; width:75%; border-left:1px solid border; sm+: max-width:24rem`; the HUD passes `w-full sm:max-w-md p-0 overflow-hidden flex-col` (28rem). Same close button as Dialog; title `font-size:1.125rem; font-weight:600; color: foreground`; description `font-size:.875rem; color: muted-foreground`. |
| ScrollArea (`scroll-area.tsx`) | `.sb-scroll` | Root `position:relative; overflow:hidden`; viewport `height:100%; width:100%; border-radius:inherit`; scrollbar (vertical) `width:.625rem; padding:1px; border-left:1px solid transparent`; thumb `flex:1; border-radius:9999px; background: border`. Foundry: native scrollbars restyled (`scrollbar-width: thin; scrollbar-color: hsl(var(--border)) transparent` and the `::-webkit-scrollbar` pair) inside `.shadowbase`. |
| Textarea (`textarea.tsx`) | `.sb-textarea` | As `.sb-input` with `min-height:80px` and no fixed height; the narrative fields use `rows=4/6/6`, appearance `rows=3`, cultural familiarities `rows=2`. |
| Label (`label.tsx`) / FormRow (`src/components/character-sheet/form-row.tsx`) | `.sb-field` (row), `.sb-field__label` | Label `font-size:.875rem; font-weight:500; line-height:1` (`text-sm font-medium leading-none`); a disabled peer dims it to opacity .7. FormRow: `display:grid; grid-template-columns:1fr; gap:.25rem`, attribute `data-sheet-row` (compact-rows sets `gap:0`), label `text-foreground` (`text-destructive` on error), error text `font-size:.875rem; color: destructive; margin-top:.25rem`; a calculated control gets `bg-muted/50 border-dashed`. Field grids: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4` (2rem / 1rem) for info rows, `lg:grid-cols-4` for the attribute cards. |
| Empty state (`section-empty-state.tsx`) | `.sb-empty` | `display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius: var(--radius); border:2px dashed border/50; background: background/20; padding: 2rem 1.5rem; text-align:center`; icon `2rem` at `opacity:.3 color muted-foreground`; title `margin-top:.75rem; font-size:.875rem; font-weight:700; text-transform:uppercase; letter-spacing:-.025em; color: foreground/70`; description `margin-top:.375rem; max-width:28rem; font-size:.75rem; line-height:1.625; color: muted-foreground`; action line `margin-top:.75rem; font-size:11px; color: muted-foreground/70` with the button name in `font-bold text-primary`. The tab-level "No X Found" search state is the same box at `py-20 opacity-40` with a 3rem search icon. |
| Handbook chip (`handbook-chip.tsx`) | `.sb-chip` | `display:inline-flex; min-width:0; flex-shrink:0; cursor:pointer; align-items:center; gap:.25rem; border-radius:9999px; border:1px solid accent/25; background: accent/5; padding: .125rem .5rem; font-size:10px; font-weight:700; letter-spacing:.05em; color: accent/80; hover: border accent/50, background accent/15, color accent; focus ring accent`; a `.75rem` book icon, the label hidden below sm. It is a `<span role=button>` INSIDE the section trigger (a nested `<button>` is invalid), stops propagation, and opens the HUD's Handbook tab at the registry target (`handbook-registry.ts`: core-system-attributes → "Core Mechanics & Attributes", traits-skills → "Traits & Skills", combat-damage → "Combat & Engagement", force-alignment-forms → "The Force & Lightsaber Forms", equipment-crafting → "Equipment & Crafting", vehicles-starships → "Vehicles & Starships", droids-constructs → "Droids & Constructs"). Hidden by the `showHandbookChips` preference. |
| Stat tile (HUD Status tab `roller-window.tsx:1874-1904`; Droid Dossier `character-form.tsx:672-687`) | `.sb-stat-tile` | `padding:.75rem (dossier .5rem); border:1px solid border; border-radius: var(--radius); background: background/50 (dossier /40, border border/30); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center`; caption `font-size:9px (dossier 10px); text-transform:uppercase; color: muted-foreground; font-weight:700; margin-bottom:.125rem`; figure `font-size:1.875rem; font-weight:700; color: primary` (unavailable: `color muted-foreground; text-decoration: line-through`); the Encumbrance/Running Jump tiles span two columns with `font-size:.875rem; color: accent`. |
| Resource pool tracker (`resource-trackers.tsx` `ResourceTracker`) | `.sb-pool` | A FormRow whose control is `display:flex; align-items:center; gap:.5rem`: a 1.25rem icon (`text-accent`; HP heart, EP zap, FP sparkles, PP battery coloured red ≤ 10 / amber ≤ 20 / green), a QuantityInput bound to the current pool (placeholder = the max, blank = full), the text `/ {max}` in `text-sm text-muted-foreground font-medium`, and a ghost icon reset (h-8 w-8, refresh arrows). Compact (HUD) rendering: `gap:.25rem`, three abreast, the icon IS the reset button, `/ max` at `text-xs`. Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4`. |
| Pinned bar (`character-form.tsx` `stickyHudPortal`, the Pin Pts / Pin Pools buttons in `basic-info-section.tsx:293-322`) | `.sb-pinned-bar` | A sticky strip below the navbar (`--sheet-sticky-top`) carrying Spent/Remaining and the three pools inline when pinned; Pin buttons are `outline sm h-10/h-8 text-[10px] font-bold uppercase border-accent/30` toggling to `default` when pinned, with a pin / pin-off glyph. Foundry: the sheet header's pinned pools row. |
| Facing hex (`facing-hex.tsx`) | `.sb-facing-hex` (svg) | `viewBox="-6 -6 168 168"`, rendered `168 × 168 px`, `user-select:none`. Geometry: centre (78,78); hexagon vertices at radius 46 (angles k·60+30); inner facing disc radius 38 (six wedges from the centre); threat ring 49–68 (six annulus wedges); labels 1–6 at radius 76. Fills: facing wedge `primary/20` (hover `/10`); threat wedge active `accent/25`, other `accent/10`, empty transparent (hover `accent/10`); hexagon `background/40` stroked `hsl(var(--border))` 1.5; wedge strokes `border` at .5 / .4. Arrows: the character's from radius 6 to 34 in `primary` (width 3, round caps, head 7) with a 4 px centre dot; each threat's from 64 inward to 52 in its arc colour (`arcTone`: Rear `destructive`, Side `hsl(38 92% 50%)`, Front `accent`), the active one at width 3 / opacity 1, others width 2 / opacity .5. Labels `font-mono 10px bold`, lit ones `fill foreground`, others `muted-foreground/60`. Every wedge is `role=button tabindex=0` (Enter/Space activate) with a `<title>` tooltip; hexsides are stored 0-based and LABELLED 1–6. |

## 3. The sheet

### 3.1 Layout (`src/components/character-sheet/character-form.tsx`)

1. `#header-section` (`px-2 py-6 sm:p-6`): `FormHeader` = a 1/2/3-column grid of TemplateLoader / LoadCharacterDropdown / CharacterJsonImporter, a separator (`my-6`), the portrait manager (`w-32 h-44 sm:w-40 sm:h-52` rounded frame, upload input, Remove Portrait), then `BasicInfoSection` (see §3.3 Info rows 1–3: Basic Info fields, the point ledger row, Resource Pools + Combat State, Force Alignment).
2. The tab strip (`TabsList data-sheet-tabs`, sticky at `--sheet-sticky-top`, z-40, `bg-card/95 backdrop-blur-sm`, `sm:grid sm:grid-cols-5 sm:h-11 gap-1 p-1`): **Info** (lucide `User`) · **Body** (`Crosshair`, tab value `anatomy`) · **Abilities** (`BrainCircuit`) · **Inventory** (`Box`) · **Vehicles** (`Rocket`). Each trigger icon `mr-2 h-4 w-4`.
3. Under the strip: `CollapseAllButton` and the per-tab search input (`Search in {tab}...`, `pl-9 h-9 text-sm bg-background/40 border-primary/20`), then `CrossSectionSearchResults`.
4. Each `TabsContent` (`space-y-6 px-2 py-6 sm:p-6`): one `Accordion type=multiple` (`space-y-4`) of the tab's sections, then a `CardFooter` (`border-t mt-4`, centred, `gap-4`) of `FormActions`: Download PDF (primary, lg), Export JSON (outline), Reset Form (outline), Save Character (accent).

Foundry (ARCHITECTURE §6.1): PARTS `header` / `tabs` / `info` / `body` / `abilities` / `inventory` / `vehicles`; the website's header block is split into the Foundry HEADER (portrait, name, player, species, homeworld, campaign, points ledger, pinned pools, Import / Export / HUD / Preferences) and the Info tab's first sections; the template loader / load dropdown / PDF / Save do not exist in Foundry (compendium templates and the document itself replace them).

### 3.2 Section anatomy

Every section is an `AccordionItem` whose trigger is `text-xl font-semibold font-headline text-accent` (`sticky`, with `after={<HandbookChip …/>}` where a registry entry exists) and whose content is `pt-4` (+ `space-y-6` / `space-y-4` where sub-blocks stack). Sub-headings inside a section are `h3.text-lg.font-semibold.text-primary.mb-2` with a `p.text-sm.text-muted-foreground.mb-4` explainer. Nested item accordions use `text-lg font-semibold font-headline text-primary hover:no-underline` (`border-b`).

### 3.3 Section inventory, per tab, in the website's order

Column key — **tab** · **title as displayed** · **lucide icon** (the trigger's own icon where one exists; otherwise the section's empty-state icon in parentheses, and `—` when neither) · **component** · **shows / controls**. `[chip: x]` = the handbook chip's registry id.

#### Info (`character-form.tsx:614-626`, `form-header.tsx`, `basic-info-section.tsx`, `character-core-stats.tsx`, `narrative-section.tsx`)

| # | title | icon | component | shows / controls |
|---|---|---|---|---|
| I1 | (header) Basic Info | `User` (portrait placeholder) | `basic-info-section.tsx:105-128`, `character-portrait-manager.tsx` | Character Name, Player Name, Species (`species-field.tsx`: combobox over `SPECIES_NAMES` + write-in; changing it runs `swapSpecies` and carries skills/languages — species-field.tsx:62-150), Homeworld ("Planet, or Unknown"), Campaign, Point Total (QuantityInput, blank → 150). Portrait: data URL upload (PNG/JPG/WEBP, ≤ ~1 MB), Remove. |
| I2 | (header) Point totals | `Pin`/`PinOff` | `basic-info-section.tsx:155-304` | Total Spent (`points.spent + racialBudgetBonus`, "budget +N (Versatility)"), Remaining (green ≥ 0 / red < 0) — both are buttons that jump to Attributes; Trade CP for Credits (0–5, ×700 CR, Digital/Physical select — moves credits on the Currencies rows via `wealth.adjustCredits` / `moveCreditsBetweenForms`); CP Spending switch (`isStartingPointsMode`); Pin Pts. |
| I3 | Resource Pools | `Heart` `Zap` `Sparkles` / `Battery` (droid) | `resource-trackers.tsx` `ResourcePoolsGrid` (h3 `text-xl font-semibold font-headline text-accent`) | HP / EP / FP trackers (PP instead of EP+FP for a droid; PP icon red ≤ 10, amber ≤ 20, green above), each with reset; Reset all pools; Pin Pools. Blank current = full (`placeholder = max`). |
| I4 | Combat State | `Timer` `AlertTriangle` `HeartPulse` `Compass` | `resource-trackers.tsx:344-667` | Global Turn Counter (QuantityInput + reset; changing it sweeps `facingChangeUsed`, `parriesThisTurn`, expired effects — the turn sweep), Stunned select (Not stunned / Physical (recover on HT) / Mental (recover on IQ)) with the "Do Nothing only. Active Defenses at −4. Roll HT/IQ each turn to recover." note, Active Effects button (`N buffs, M debuffs` + count pill → opens the HUD Status tab). Facing band (`rounded-lg border border-border/40 bg-black/10 p-4`): the `FacingHex`, "you face N · threat N +k", Engage / Stand down (`Swords` / `ShieldOff`), Turn to face (disabled when in Front arc or the change is spent), "1 free change per round" / "change spent", and the arc explanation column (`describeArc`, lost defenses in amber/red, Flanked note, "cannot attack until you turn", also-engaged list, `describeVision`). |
| I5 | Force Alignment | `Moon` (Dark, red-400) / `Sun` (Light, blue-300) | `basic-info-section.tsx:327-443` + `AlignmentEffects` + `ReactionModifierEffects` | Slider −100..100 on the spectrum track (fill hidden, zero notch), number box (`text-center font-bold text-lg`, borderless with a `border-b-2 border-b-accent/50`), Dark Side / Light Side labels; below: the tier label (red-400 Dark / blue-300 Light) or "Unaligned — no Self-Mastery or Bearing modifier…", Self-Mastery and Bearing lines (`universalAlignmentEffects`), and the Reaction Modifier block (`text-amber-300` headline; sources "Trait: +N"; per-sphere lines; comlink / writing variants; "Not counted: …"; the "Not applied to any roll" footnote). Changing the slider mirrors `lightSidePoints` / `darkSidePoints`. |
| I6 | Attributes & Characteristics `[chip: core-system-attributes]` | — | `character-core-stats.tsx` | h3 **Primary Attributes** (`lg:grid-cols-4`): ST / DX / IQ / HT — QuantityInput (droid: read-only derived figure) + icon roll button (target = value + modifier), caption "Base (Human/Template/Hardware): N (±d) [±N pts]" (hidden by the Point costs pref; "[Template]" when spending is off), droid note, "Mod: ±N (Effective: N)" in green/red naming the contributing effects. Separator. h3 **Secondary Characteristics & Senses** (`lg:grid-cols-4`, dependency order): Hit Points, Endurance Points, Will, Force Points, Basic Speed (step .25, 2 dp), Basic Move, Perception, Fright Check, Vision, Hearing, Taste & Smell, Touch (editable QuantityInputs, roll buttons on Will / Per / Fright / senses, "Immune" instead of a Fright button when `frightImmune`), Damage Thrust / Damage Swing (read-only dashed). Caption "Base (ST/HT/IQ/Will/Per/(DX+HT)/4/floor((ST+DX)/4)): N. Cost: [±N pts]" and "Mod: ±N (Effective: N)". |
| I7 | Narrative Details | `Ruler` (SM row) | `narrative-section.tsx` + `character-details-section.tsx` | h3 **Character Details**: "Is this character a Droid?" checkbox (conversion / reset confirmations; `attributeResetsForDroid`, `grantDroidBaseline` / `removeDroidBaseline`), droid power note, Height (auto-derives SM via `sizeModifierForHeight`), Weight (+ body-weight hint), Size Modifier (step .01; droid: derived, locked; hint + "Apply SM" button), Age, Appearance (textarea rows 3), Cultural Familiarities (textarea rows 2, placeholder "e.g., Core Worlds [1]; Outer Rim Scum [0]", hint "One culture per line or separated by semicolons, cost in brackets…"). h3 **Physical Description** (`description`, rows 4), **Background & History** (`background`, rows 6), **Notes** (`notes`, rows 6, placeholder "Campaign notes, GM info, plot hooks, etc."). Plain textareas, no rich text. |
| I8 | (footer) Form actions | `Download` `FileJson` `Eraser` `Save` | `form-actions.tsx` | Download PDF · Export JSON · Reset Form · Save Character. Foundry: Export JSON only (header control). |

The Foundry Info tab (U05, ARCHITECTURE §6.1 + the unit brief) renders these as: Basic Info · Primary Attributes · Secondary Characteristics · Resource Pools · Combat State · Force Alignment · Languages (moved here from Abilities per the brief; the website keeps it under Abilities — A5) · Encumbrance & Move (the Move half of the Inventory tab's Encumbrance & Defenses — N1) · Character Details · Narrative · Point Ledger (`points.*` itemised, `pointsOther` input, Trade CP, CP Spending).

#### Body (tab value `anatomy`; `character-form.tsx:631-745`)

| # | title | icon | component | shows / controls |
|---|---|---|---|---|
| B0 | Droid PC Status (strip above the accordion) | `Bot` | `character-form.tsx:637-658` | "Status: Droid / Status: Organic" toggle button (`h-8 px-4 text-[10px] uppercase`, accent when droid) with the conversion / anatomical-reset confirmations. |
| B1 | Droid PC Tactical Dossier `[chip: droids-constructs "Droids"]` (droid only) | `Activity` | `character-form.tsx:660-688` | Four stat tiles: ST / HP, Eff. DX / IQ, Move / Dodge, Design Power (PP). Title colour `text-primary`. |
| B2 | Droid Character Workshop (droid only) | `Wrench` | `droid-workshop.tsx` | The droidBuild editor (chassis, power core, head/processor/sensors, arms, legs, chassis mods, warped slots) — ARCHITECTURE §6.5. |
| B3 | Load-Out by Location `[chip: equipment-crafting "Worn & Carried"]` | (`Shirt`, `ShieldCheck` on rows) | `body-loadout-panel.tsx` | "N readied · k/n hands free" in the trigger; "What each part of the body is wearing and holding."; deflector-field strip; one row per hit location listing worn armor and held weapons with equip/ready controls. |
| B4 | Anatomy Workshop `[chip: combat-damage "Hit Locations"]` | — | `anatomy-workshop.tsx` | "Configure physiological structure and graft hardware."; Reset Bio-Plan (organic); hit-location rows (name, type, innate DR, status, installed hardware). |

#### Abilities (`form-groups/character-abilities.tsx`)

| # | title | icon | component | shows / controls |
|---|---|---|---|---|
| A1 | Advantages & Perks `[chip: traits-skills]` | (`ShieldAlert`) | `advantages-section.tsx` | Trait rows (name, level select, points, description, modifier badges), Add From Library / Add Custom, remove. |
| A2 | Disadvantages `[chip: traits-skills]` | (`ShieldAlert`) | `disadvantages-section.tsx` | As A1 (negative points; the −10 droid baseline rows marked). |
| A3 | Quirks `[chip: traits-skills]` | (`Info`) | `quirks-section.tsx` | Explainer paragraph; up to 5 quirk rows (−1 each). |
| A4 | Skills `[chip: traits-skills]` | (`GraduationCap`) | `skills-section.tsx` | Skill rows (name, attribute/difficulty, level as a STRING, points, notes, roll button), Add From Library, missing-skills prompt. |
| A5 | Languages `[chip: traits-skills]` | — | `languages-section.tsx` + `languages-panel.tsx` | `languageEntries` rows: tongue input, fluency select (Native (free) / Broken / Accented / Fluent), Compr. checkbox, Free checkbox (non-native), "N CP / free / 0 CP" (`font-mono text-[10px]`), remove; "Add language", "Add {tongue} (Native, free)" when the species' native is missing; "Languages: N CP"; free-count warning; Language Talent note; "Ch3 ladder: Broken 1 · Accented 2 · Fluent 3 · Comprehension-only half, round up (1/1/2) · one free native at [0]."; Republic-raised checkbox (species without Basic native). Literacy line (Illiterate via the Ch5 disadvantage or legacy text, else "literate in every language known, at no cost"); legacy `literacy` input while text remains. |
| A6 | Force Powers `[chip: force-alignment-forms]` | (`Sparkles`) | `force-powers-section.tsx` | Power rows (name, level select re-reading the catalog, base skill, FP/EP cost with the alignment-adjusted FP, effect), roll + Apply Costs, Add From Library. |
| A7 | Combat Techniques `[chip: combat-damage]` | (`Crosshair`) | `combat-techniques-section.tsx` | Nested accordions **Universal Techniques** ("Can be used with either melee or ranged weaponry."), **Melee Techniques**, **Unarmed Techniques** (Ch9 note), **Ranged Techniques**; rows with level, skill bonus/penalty, damage bonus, weapon selector for the roll, Apply Costs. |
| A8 | Lightsaber Forms `[chip: force-alignment-forms]` | (`CircleDashed`) | `lightsaber-forms-section.tsx` | Form rows (name, level, applies/conditional effects), the active-form selector (`activeLightsaberForm` + weapon), Add From Library. |

#### Inventory (`character-inventory.tsx`)

| # | title | icon | component | shows / controls |
|---|---|---|---|---|
| N0 | (card above the accordion) Carry Weight / credits | `Weight`; credit chip & Aurodium images | `character-inventory.tsx:129-235` | Total Weight Carried, Total Carry Capacity, Remaining Capacity (green/red) — the heading jumps to Encumbrance; Credit Chip Total (blue-400, chip toggle = `trackDigital`) and Physical Credit Total (amber-400, toggle = `trackPhysical`), each figure a link to the Currencies category. |
| N1 | Encumbrance & Defenses `[chip: combat-damage]` | `HeartPulse` (Active Tactical Effects), `Compass`, `Info`, `Calculator` | `character-inventory.tsx` `StatusEffectsSection` + `encumbrance-section.tsx` | Active Tactical Effects badges; Basic Lift, Encumbrance, Current Move, EP per Fight (+ Armor (tier) roll), Attacked from (arc, hexes), Current Dodge (roll), Parry (select of `parryOptions`, roll), Block (select, roll), Apply Lifting ST switch, the encumbrance table (None/Light/Medium/Heavy/X-Heavy weights, Move, Dodge), Jumping tiles (Running / Standing / Vertical off Move) with the failure note. |
| N2 | Hit Locations & Damage Resistance (DR) / "Modular DR & System Integrity" (droid) `[chip: combat-damage]` | — | `hit-location-section.tsx` | Per-location DR table (innate + armor + typed), damage status, the Tactical Damage Processor (amount, type, location, apply) — ARCHITECTURE §5.3. |
| N3 | General Equipment `[chip: equipment-crafting]` | (`Package`) | `equipment-section.tsx` | One nested accordion per category (`text-lg font-bold font-headline text-primary` + count badge), plus **Blueprints**, **Other Gear**, **Raw Materials**; `EquipmentItemCard` rows (expand on click, name inline, `x{qty}` badge, currency badges blue/amber, Send to storage / Split / Delete), Add From Library, Add Custom, crafting/fabrication controls. |
| N4 | Armor & Clothing `[chip: equipment-crafting]` | — | `armor-and-clothing-section.tsx`, `armor-item-card.tsx` (`Combine` Anatomical Shell, `Settings2` Modifications & Slots) | Per-slot sections (`{slot} Gear`), armor cards (equipped, sealed, DR entries per location, condition, mods), Add From Library / Armor Piece / Preset Suit / Belt & Shield / Face Gear, gear sets panel. |
| N5 | Weapons `[chip: equipment-crafting]` | (`Combine`, `Settings2` on cards) | `character-inventory.tsx:273-303` | Nested: **Melee Weapons** (`customized-melee-weapon-item.tsx`), **Ranged Weapons** (`blaster-customization-section.tsx`, `customized-blaster-item.tsx`: Structural Matrix, Modifications & Slots, ammunition), **Explosives**, **Lightsabers** (`lightsaber-item.tsx`). Cards carry derived stat panels, equipped/ready, durability, Add From Library / Build. |
| N6 | Ammo, Mods, & Parts `[chip: equipment-crafting]` | — | `ammunition-and-modifications-section.tsx` | Nested: **Ammunition**; **Weapon Mods & Parts** → Melee Structural Components, Ranged Structural Components, Melee Customization Mods, Ranged Weapon Mods; **Armor Mods & Pieces** → Spare Armor Pieces, Armor Structural Components, Armor Mods (per layer); **Lightsaber Parts**. |
| N7 | Implants & Cybernetics `[chip: equipment-crafting]` | (`BrainCircuit`) | `implants-cybernetics-section.tsx` | Nested: **Neural & Sensory Implants**, **Cybernetic Limbs**, **Hardware Upgrades**; install/link to hit locations, mandatory flaws, prosthetic forge, implant build dialog. |
| N8 | External Storage (h3 `text-2xl font-bold text-accent`, after the accordion) | `Package` | `storage/storage-box-section.tsx` | Add Box; per box: name input in the header, delete, and every row whose `storageLocationId` is the box. |

#### Vehicles (`vehicles-and-starships-section.tsx`)

| # | title | icon | component | shows / controls |
|---|---|---|---|---|
| V1 | Ship Assignment | — | `ship-crew-position-section.tsx` (card "Ship Assignment & Actions") | `assignedStation` / `shipPosition` selects, the station's actions with roll buttons (`crew-action-roller.tsx`). |
| V2 | Starships `[chip: vehicles-starships]` | — | `starship-customization-section.tsx`, `customized-starship-item.tsx` (nested **Damage Control Matrix**) | Starship cards (chassis, mods, weapons, derived readouts, nine systems' HP/status), Add From Library / Builder / Import Starship. |
| V3 | Atmospheric Vehicles `[chip: vehicles-starships]` | — | `atmospheric-vehicles-section.tsx`, `vehicle-item.tsx` | Vehicle cards, Add From Library / Import Vehicle. |
| V4 | Terrestrial Vehicles `[chip: vehicles-starships]` | — | `terrestrial-vehicles-section.tsx` | As V3. |

### 3.4 The Tactical HUD (`roller-window.tsx`, `roll-button.tsx`)

Shell: a right-side drawer (`SheetContent side="right" w-full sm:max-w-md p-0 flex-col`, 28rem). Header (`p-6 pb-2`): title `text-2xl font-headline text-primary` with a `1.75rem` `Activity` icon — "Tactical HUD"; right of it the settings gear (`Settings2`, `SheetSettingsMenu`) and the notification bell (`NotificationHistoryBell`); description "Command center for real-time actions and status." (`text-xs text-foreground/80`). Tab list `grid-cols-3 rounded-none bg-muted/20 border-y`: **Actions** · **Status** · **Handbook**. Each tab body is a `ScrollArea` with `px-4`.

| tab | section (accordion `text-md font-semibold text-accent`; default open: unarmed, attributes) | contents |
|---|---|---|
| Actions | Custom Roll | label, target, modifier → `rollTargetNumber`. |
| Actions | Unarmed Combat | Punch / Kick targets (`unarmedStrikeTarget`) and damage (`unarmedDamage`), roll + damage buttons. |
| Actions | Readied Weapons | one card per equipped weapon (`equippedAt` order): attack target (`getSkillTargetInfo`), RoF/shots, ammunition state, damage, Parry/Block with the U / unready gates, Ready button, off-hand default for the second weapon. |
| Actions | Core & Defenses | Turn Order line (Basic Speed, DX tie-break), Dodge, the Defensive Action Matrix (Dodge / Parry / Block per readied weapon with availability), **Combat Economy — GM adjudicates** (`text-[10px] font-bold text-amber-500 uppercase`) chips from `combatEconomyFlags`, the attribute grid (ST/DX/IQ/HT/Will/Per roll buttons). |
| Actions | Skills | every skill with its resolved level (`resolveSkillLevel` + `describeResolution`) and a roll button. |
| Actions | Abilities & Forms | h4 **Force Powers** (target `forcePowerTarget`, FP cost `calculateAdjustedFPCost`, Apply Costs), h4 **Lightsaber Forms** (active form effect). |
| Actions | Ship Systems | station actions (`SHIP_STATION_ACTIONS`) via `bestSkillTarget`, ship weapon damage. |
| Status | Resource Pools (h4 `text-md font-semibold font-headline text-primary` + `HeartPulse`, collapsible, open) | `ResourcePoolsGrid compact` three abreast + Reset all. |
| Status | Active Effects hub (`StatusEffectsHub`) | h4 "Active Effects" (`text-sm font-bold text-accent uppercase`); each effect: name, source badge, uppercase duration with `Timer`, italic description, channel badges (`formatModifierChannel`, green/red), Recover 1 EP, Advance ("Phase i of n – next: X"), Dismiss X (not on gear); **Add Custom** dialog (name, type, duration, description, the 23 numeric channels, Fright-immune, Move multiplier select). |
| Status | Tiles | Dodge (3xl, line-through when unavailable) · Move (3xl) · Encumbrance (2-col, `text-sm text-accent`) · Running Jump (2-col). |
| Status | Anatomical DR / Droid DR (h4 + `Shield`) | `HitLocationSection compact` with the Damage Processor. |
| Handbook | `HandbookBrowser` | search box, results, chapter reader; opened at a chip's target. |
| footer | Roll History (`h-14`, `History` icon in a `bg-primary/20 p-1.5 rounded-md` box, "ROLL HISTORY" uppercase, "NEW" pulse) | click to expand, drag the header to resize, CLEAR button; entries from `useDiceRoller` history (depth pref). |

RollButton (`roll-button.tsx`): an `outline icon` button with a `Dices` glyph (destructive variant for damage); its popover (`w-64 p-4 bg-popover shadow-2xl`, side top, align end) shows the label (`text-primary`), "Base Target: N" / "Base Damage: X" / "Volley Attack (xN)" (`text-[10px] uppercase font-bold`), the Off-Hand Action switch when dual wielding (`bg-accent/10 border-accent/30`), Active Modifiers (Gear/Effect Bonus green, Skill Penalty red, Off-Hand Penalty red-500), Damage Modifiers, "Damaged Unit: Malf N" (amber, `ShieldAlert`, when Malf < 17), a list of situational modifier QuantityInputs each with a remove X, **Add Modifier** (`outline sm border-dashed`, `PlusCircle`) and **Roll with Hit Mod (+N)** (primary, `w-full h-9 font-bold`). Foundry: `RollDialog` (ARCHITECTURE §6.3, U04) carries the same fields.

## 4. lucide → Font Awesome 6 Free map

Every lucide icon imported under `src/components/character-sheet`, `src/components/layout` and `src/components/ui` (counts = import sites). Registered as `CONFIG.SHADOWBASE.ICONS` (`module/config.mjs`) and read by the `sbIcon` helper; the FA class is the whole `fa-<style> fa-<name>` string.

| lucide | FA 6 Free class | used for |
|---|---|---|
| Activity | `fa-solid fa-wave-square` | HUD title, Droid Dossier |
| AlertCircle | `fa-solid fa-circle-exclamation` | inline errors |
| AlertTriangle | `fa-solid fa-triangle-exclamation` | stun, warnings, droid conversion dialogs |
| Anchor | `fa-solid fa-anchor` | encumbrance status |
| ArrowLeft | `fa-solid fa-arrow-left` | back |
| ArrowRight | `fa-solid fa-arrow-right` | handbook results |
| ArrowUpCircle | `fa-solid fa-circle-arrow-up` | level up / promote |
| Ban | `fa-solid fa-ban` | refused |
| Battery / BatteryMedium | `fa-solid fa-battery-full` / `fa-solid fa-battery-half` | PP pool |
| Bell | `fa-solid fa-bell` | notifications |
| Binary | `fa-solid fa-code` | firmware datacards |
| Bomb | `fa-solid fa-bomb` | explosives |
| BookOpen | `fa-solid fa-book-open` | handbook chip |
| Bot | `fa-solid fa-robot` | droid status |
| Box | `fa-solid fa-box` | Inventory tab |
| BrainCircuit | `fa-solid fa-brain` | Abilities tab, implants |
| Calculator | `fa-solid fa-calculator` | encumbrance derivation |
| Car | `fa-solid fa-car` | terrestrial vehicles |
| Check / CheckCircle / CheckCircle2 | `fa-solid fa-check` / `fa-solid fa-circle-check` | selected, confirmed |
| ChevronDown / ChevronUp / ChevronRight / ChevronsDownUp / ChevronsUpDown | `fa-solid fa-chevron-down` / `-up` / `-right` / `fa-solid fa-compress` / `fa-solid fa-expand` | accordion chevron, steppers, expanders, collapse-all |
| Circle / CircleDashed | `fa-regular fa-circle` / `fa-regular fa-circle-dot` | ammunition, empty forms |
| CircuitBoard | `fa-solid fa-microchip` | cybernetic upgrades |
| Clock | `fa-regular fa-clock` | crafting time |
| Coins | `fa-solid fa-coins` | credits |
| Combine | `fa-solid fa-diagram-project` | Structural Matrix / Anatomical Shell |
| Compass | `fa-solid fa-compass` | facing |
| Copy | `fa-regular fa-copy` | duplicate |
| CornerDownRight | `fa-solid fa-turn-down` (with `fa-rotate-270`) | nested rows |
| Cpu | `fa-solid fa-microchip` | processors |
| CreditCard | `fa-solid fa-credit-card` | credit chip |
| Crosshair | `fa-solid fa-crosshairs` | Body tab, techniques |
| Database | `fa-solid fa-database` | memory cores |
| Dices | `fa-solid fa-dice` | roll buttons |
| Download / DownloadCloud | `fa-solid fa-download` / `fa-solid fa-cloud-arrow-down` | PDF, load |
| Droplets | `fa-solid fa-droplet` | bleeding |
| Eraser | `fa-solid fa-eraser` | reset form |
| Eye | `fa-solid fa-eye` | vision |
| FileJson | `fa-solid fa-file-code` | export JSON |
| FileSearch | `fa-solid fa-file-magnifying-glass` | dossier search |
| Flame | `fa-solid fa-fire` | burn |
| Frame | `fa-regular fa-square` | armor frame |
| Glasses | `fa-solid fa-glasses` | face gear |
| Globe | `fa-solid fa-globe` | languages / homeworld |
| GraduationCap | `fa-solid fa-graduation-cap` | skills |
| Hammer | `fa-solid fa-hammer` | crafting / build |
| Hand | `fa-solid fa-hand` | hands / cybernetic limbs |
| HardHat | `fa-solid fa-helmet-safety` | armor pieces |
| Heart / HeartPulse | `fa-solid fa-heart` / `fa-solid fa-heart-pulse` | HP, active effects |
| History | `fa-solid fa-clock-rotate-left` | roll history |
| Home | `fa-solid fa-house` | home |
| Info | `fa-solid fa-circle-info` | quirks, hints |
| Layers | `fa-solid fa-layer-group` | armor layering |
| Library / LibraryBig | `fa-solid fa-book` / `fa-solid fa-book-atlas` | Add From Library |
| List / ListChecks | `fa-solid fa-list` / `fa-solid fa-list-check` | lists |
| Loader2 | `fa-solid fa-spinner fa-spin` | saving |
| Lock / Unlock | `fa-solid fa-lock` / `fa-solid fa-lock-open` | locked blueprint |
| LogIn / LogOut | `fa-solid fa-right-to-bracket` / `fa-solid fa-right-from-bracket` | auth (not in Foundry) |
| Mail | `fa-regular fa-envelope` | contact |
| Menu | `fa-solid fa-bars` | navbar |
| MinusCircle / PlusCircle / Plus | `fa-solid fa-circle-minus` / `fa-solid fa-circle-plus` / `fa-solid fa-plus` | remove / add |
| Moon / Sun | `fa-solid fa-moon` / `fa-solid fa-sun` | Dark / Light side |
| MoreVertical | `fa-solid fa-ellipsis-vertical` | row menu |
| MoveHorizontal | `fa-solid fa-arrows-left-right` | move |
| Package / PackageOpen | `fa-solid fa-box` / `fa-solid fa-box-open` | storage, equipment |
| Pencil / PenLine | `fa-solid fa-pencil` / `fa-solid fa-pen` | edit |
| Pin / PinOff | `fa-solid fa-thumbtack` / `fa-solid fa-thumbtack-slash` | pinned bars |
| Play | `fa-solid fa-play` | run |
| RefreshCcw / RefreshCw / RotateCcw | `fa-solid fa-arrows-rotate` / `fa-solid fa-rotate-left` | reset pool / turn |
| Rocket | `fa-solid fa-rocket` | Vehicles tab |
| Ruler | `fa-solid fa-ruler` | size modifier |
| Save | `fa-solid fa-floppy-disk` | save |
| Scale | `fa-solid fa-scale-balanced` | weight |
| Scissors | `fa-solid fa-scissors` | split stack |
| Search | `fa-solid fa-magnifying-glass` | search |
| Settings2 | `fa-solid fa-sliders` | preferences |
| Sheet | `fa-solid fa-table-list` | sheet |
| Shield / ShieldAlert / ShieldCheck / ShieldOff | `fa-solid fa-shield-halved` / `fa-solid fa-shield-virus`* / `fa-solid fa-shield-heart`* / `fa-solid fa-shield` (with a strike) | DR, malfunction warning, equipped armor, stand down |
| Ship | `fa-solid fa-ship` | starships (alt: `fa-solid fa-rocket`) |
| Shirt | `fa-solid fa-shirt` | clothing |
| SkipForward | `fa-solid fa-forward-step` | advance phase |
| Sparkles | `fa-solid fa-wand-magic-sparkles` | FP, force powers |
| Split | `fa-solid fa-code-fork` | split |
| Stethoscope | `fa-solid fa-stethoscope` | medical |
| Sword / Swords | `fa-solid fa-khanda`* / `fa-solid fa-hand-fist`* | melee, engage |
| Target | `fa-solid fa-bullseye` | targeting |
| Thermometer | `fa-solid fa-temperature-half` | heat |
| Timer | `fa-solid fa-stopwatch` | turn counter |
| Trash2 | `fa-solid fa-trash-can` | delete |
| Unplug | `fa-solid fa-plug-circle-xmark` | unload |
| Upload | `fa-solid fa-upload` | import |
| User / UserCircle | `fa-solid fa-user` / `fa-solid fa-circle-user` | Info tab, portrait |
| Volume2 | `fa-solid fa-volume-high` | hearing |
| Wallet | `fa-solid fa-wallet` | credit tracking |
| Weight | `fa-solid fa-weight-hanging` | carry weight |
| Wind | `fa-solid fa-wind` | atmospheric vehicles |
| Wrench | `fa-solid fa-wrench` | workshop |
| X / XCircle | `fa-solid fa-xmark` / `fa-solid fa-circle-xmark` | close / remove |
| Zap | `fa-solid fa-bolt` | EP |

`*` = no one-to-one FA Free glyph; the nearest Free glyph is chosen (FA's shield-with-exclamation, crossed swords and single sword are Pro-only).

## 5. Root preference attributes (`use-sheet-preferences.ts:289-290`, `globals.css`)

Set on `<html>` by the preferences hook; in Foundry on the sheet's root element (`.shadowbase.sheet.actor`) from the user's sheet preferences.

| attribute | preference (default) | what it changes |
|---|---|---|
| `data-reduce-motion="true"` | `reduceMotion` (false) | `* , *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important }` — kills every tailwindcss-animate entrance and the accordion keyframes at once. Independent of `prefers-reduced-motion` (which the browser honours anyway). |
| `data-compact-rows="true"` | `compactRows` (false) | `[data-accordion-trigger] { padding-top/bottom: .5rem }`, `[data-accordion-body] { padding-bottom: .5rem }`, `[data-sheet-row] { gap: 0 }`, `td, th { padding-top/bottom: .25rem }` — only the parts that repeat; controls keep their hit area. |

Other preferences the sheet reads (defaults): `showHandbookChips` true, `stickySectionHeaders` true, `showPointCosts` true, `showFloatingHudButton` true, `rememberOpenSections` false, `keepRollHistory` true, `rollHistoryDepth` 10 (10/25/50/100), `notificationDepth` 12 (12/25/50). None travels with the character.
