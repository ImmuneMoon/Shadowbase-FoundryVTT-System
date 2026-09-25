// module/config.mjs
//
// CONFIG.SHADOWBASE - DATA ONLY. Registration into Foundry's CONFIG happens in
// module/shadowbase.mjs (the init hook); this file has no Foundry globals at
// import time so the adapter, the data models and the headless smoke can all
// read it without a running client.
//
// Three registries live here:
//   ITEM_TYPES        the 21 Item types (ARCHITECTURE.md §4.2 table): which
//                     website array each stores, which bundle derivation runs
//                     for it, its icon, its i18n label key;
//   STATUS_EFFECTS    the CONFIG.statusEffects entries (ARCHITECTURE.md §4.4)
//                     plus the rule that maps a stored website status-effect
//                     row to one of them;
//   LUCIDE_FA         the lucide -> Font Awesome 6 Free map re-derived by U05
//                     from the website's imports (docs/STYLE-SPEC.md §4);
//   ICONS             Font Awesome classes for the sheet chrome by semantic
//                     name, resolved through LUCIDE_FA (the `sbIcon` helper
//                     reads both).
//
// Image paths are Foundry core assets (icons/svg/*.svg ship with every install),
// so no system asset has to exist for an Item to render in a sidebar.

/**
 * @typedef {object} ItemTypeConfig
 * @property {string} source       the website array the row lives in (CHARACTER_FORM_ARRAY_KEYS)
 * @property {string[]} sources    every array this type may carry (weaponPart carries two)
 * @property {string|null} family  the bundle derivation family: 'blaster' | 'melee' | 'lightsaber' | 'armor' | 'starship' | null
 * @property {string} img          Foundry core svg used as the Item's default img
 * @property {string} fa           Font Awesome 6 class for the sheet chrome
 * @property {string} label        i18n key (TYPES.Item.<type>, the key Foundry itself reads)
 * @property {boolean} [perName]   compendium items are one per NAME with system.levels[] (powers/techniques/forms)
 */

/** @type {Record<string, ItemTypeConfig>} */
export const ITEM_TYPES = Object.freeze({
  advantage: { source: 'advantages', sources: ['advantages'], family: null, img: 'icons/svg/upgrade.svg', fa: 'fa-solid fa-star', label: 'TYPES.Item.advantage' },
  disadvantage: { source: 'disadvantages', sources: ['disadvantages'], family: null, img: 'icons/svg/downgrade.svg', fa: 'fa-solid fa-triangle-exclamation', label: 'TYPES.Item.disadvantage' },
  quirk: { source: 'quirks', sources: ['quirks'], family: null, img: 'icons/svg/aura.svg', fa: 'fa-solid fa-masks-theater', label: 'TYPES.Item.quirk' },
  skill: { source: 'skills', sources: ['skills'], family: null, img: 'icons/svg/book.svg', fa: 'fa-solid fa-graduation-cap', label: 'TYPES.Item.skill' },
  forcePower: { source: 'forcePowers', sources: ['forcePowers'], family: null, img: 'icons/svg/light.svg', fa: 'fa-solid fa-wand-sparkles', label: 'TYPES.Item.forcePower', perName: true },
  combatTechnique: { source: 'combatTechniques', sources: ['combatTechniques'], family: null, img: 'icons/svg/combat.svg', fa: 'fa-solid fa-hand-fist', label: 'TYPES.Item.combatTechnique', perName: true },
  lightsaberForm: { source: 'lightsaberForms', sources: ['lightsaberForms'], family: null, img: 'icons/svg/sword.svg', fa: 'fa-solid fa-person-running', label: 'TYPES.Item.lightsaberForm', perName: true },
  equipment: { source: 'equipment', sources: ['equipment'], family: null, img: 'icons/svg/item-bag.svg', fa: 'fa-solid fa-box', label: 'TYPES.Item.equipment' },
  armor: { source: 'armor', sources: ['armor'], family: 'armor', img: 'icons/svg/shield.svg', fa: 'fa-solid fa-shield-halved', label: 'TYPES.Item.armor' },
  blaster: { source: 'customBlasters', sources: ['customBlasters'], family: 'blaster', img: 'icons/svg/target.svg', fa: 'fa-solid fa-crosshairs', label: 'TYPES.Item.blaster' },
  meleeWeapon: { source: 'customMeleeWeapons', sources: ['customMeleeWeapons'], family: 'melee', img: 'icons/svg/sword.svg', fa: 'fa-solid fa-hammer', label: 'TYPES.Item.meleeWeapon' },
  lightsaber: { source: 'lightsabers', sources: ['lightsabers'], family: 'lightsaber', img: 'icons/svg/lightning.svg', fa: 'fa-solid fa-bolt', label: 'TYPES.Item.lightsaber' },
  explosive: { source: 'customExplosives', sources: ['customExplosives'], family: null, img: 'icons/svg/explosion.svg', fa: 'fa-solid fa-bomb', label: 'TYPES.Item.explosive' },
  ammunition: { source: 'ammunition', sources: ['ammunition'], family: null, img: 'icons/svg/circle.svg', fa: 'fa-solid fa-battery-full', label: 'TYPES.Item.ammunition' },
  weaponPart: { source: 'weaponModifications', sources: ['weaponModifications', 'lightsaberModifications'], family: null, img: 'icons/svg/clockwork.svg', fa: 'fa-solid fa-gear', label: 'TYPES.Item.weaponPart' },
  armorPart: { source: 'armorModifications', sources: ['armorModifications'], family: null, img: 'icons/svg/mage-shield.svg', fa: 'fa-solid fa-layer-group', label: 'TYPES.Item.armorPart' },
  implant: { source: 'implants', sources: ['implants'], family: null, img: 'icons/svg/regen.svg', fa: 'fa-solid fa-brain', label: 'TYPES.Item.implant' },
  cyberneticLimb: { source: 'cybernetics', sources: ['cybernetics'], family: null, img: 'icons/svg/bones.svg', fa: 'fa-solid fa-hand', label: 'TYPES.Item.cyberneticLimb' },
  cyberneticUpgrade: { source: 'cyberneticUpgrades', sources: ['cyberneticUpgrades'], family: null, img: 'icons/svg/upgrade.svg', fa: 'fa-solid fa-microchip', label: 'TYPES.Item.cyberneticUpgrade' },
  starship: { source: 'customStarships', sources: ['customStarships'], family: 'starship', img: 'icons/svg/wing.svg', fa: 'fa-solid fa-rocket', label: 'TYPES.Item.starship' },
  vehicle: { source: 'vehicles', sources: ['vehicles'], family: null, img: 'icons/svg/direction.svg', fa: 'fa-solid fa-truck', label: 'TYPES.Item.vehicle' },
});

/** The 21 Item type names, in the order of the ARCHITECTURE.md §4.2 table. */
export const ITEM_TYPE_NAMES = Object.freeze(Object.keys(ITEM_TYPES));

/** website array -> Item type (weaponModifications and lightsaberModifications both -> weaponPart). */
export const SOURCE_TO_TYPE = Object.freeze(Object.fromEntries(
  Object.entries(ITEM_TYPES).flatMap(([type, cfg]) => cfg.sources.map((s) => [s, type])),
));

/** weaponPart: which export array a `family` value names. */
export const WEAPON_PART_FAMILIES = Object.freeze({ weapon: 'weaponModifications', lightsaber: 'lightsaberModifications' });

/**
 * CONFIG.statusEffects entries (ARCHITECTURE.md §4.4). `hud: false` hides a
 * derived-only condition from the token HUD toggles (nothing to toggle: the
 * engine derives it). `match` is the rule that maps a STORED website row to
 * the entry (by the row's own id first, then its name); rows that match
 * nothing fall back to their buff/debuff type so every stored effect still
 * shows on the token.
 */
export const STATUS_EFFECTS = Object.freeze([
  { id: 'stunned-physical', name: 'SHADOWBASE.Status.StunnedPhysical', img: 'icons/svg/daze.svg', hud: true, match: /^stunned \(physical\)$|^physical stun/i },
  { id: 'stunned-mental', name: 'SHADOWBASE.Status.StunnedMental', img: 'icons/svg/unconscious.svg', hud: true, match: /^stunned \(mental\)$|^mental stun/i },
  { id: 'shock', name: 'SHADOWBASE.Status.Shock', img: 'icons/svg/lightning.svg', hud: true, match: /^shock\b/i },
  { id: 'bleeding', name: 'SHADOWBASE.Status.Bleeding', img: 'icons/svg/blood.svg', hud: true, match: /^bleeding\b/i },
  { id: 'nauseated', name: 'SHADOWBASE.Status.Nauseated', img: 'icons/svg/poison.svg', hud: true, match: /^nauseat/i },
  // `crash` is tested BEFORE `stimulated`: the website names a crash card after its stimulant
  // ("Adrenal Stim Crash", equipment-section.tsx / roller-window.tsx), so a first-match by
  // name in the other order would give every crash the stimulant's icon (check:effects).
  { id: 'crash', name: 'SHADOWBASE.Status.Crash', img: 'icons/svg/downgrade.svg', hud: true, match: /\bcrash\b|comedown|withdrawal/i },
  { id: 'stimulated', name: 'SHADOWBASE.Status.Stimulated', img: 'icons/svg/upgrade.svg', hud: true, match: /stimulant|stimulated|stim pack|adrenal/i },
  { id: 'susceptible', name: 'SHADOWBASE.Status.Susceptible', img: 'icons/svg/terror.svg', hud: true, match: /^susceptib/i },
  { id: 'pain-suppressed', name: 'SHADOWBASE.Status.PainSuppressed', img: 'icons/svg/regen.svg', hud: true, match: /pain suppress|painkill|analges/i },
  { id: 'encumbered', name: 'SHADOWBASE.Status.Encumbered', img: 'icons/svg/anchor.svg', hud: false, match: /^encumbrance$|^encumbered/i },
  { id: 'flanked', name: 'SHADOWBASE.Status.Flanked', img: 'icons/svg/direction.svg', hud: false, match: /^flanked/i },
  { id: 'unready', name: 'SHADOWBASE.Status.Unready', img: 'icons/svg/net.svg', hud: true, match: /^unready/i },
  { id: 'form-active', name: 'SHADOWBASE.Status.FormActive', img: 'icons/svg/aura.svg', hud: true, match: /lightsaber form|^form:/i },
  { id: 'shield-active', name: 'SHADOWBASE.Status.ShieldActive', img: 'icons/svg/shield.svg', hud: true, match: /shield (projector|active)|^shielded/i },
  { id: 'critical-power', name: 'SHADOWBASE.Status.CriticalPower', img: 'icons/svg/hazard.svg', hud: true, match: /^critical power/i },
  { id: 'crippled', name: 'SHADOWBASE.Status.Crippled', img: 'icons/svg/bones.svg', hud: true, match: /crippled|severed/i },
  { id: 'buff', name: 'SHADOWBASE.Status.Buff', img: 'icons/svg/upgrade.svg', hud: true, match: null },
  { id: 'debuff', name: 'SHADOWBASE.Status.Debuff', img: 'icons/svg/downgrade.svg', hud: true, match: null },
]);

/** The engine's derived status-effect ids (use-character-calculations.ts) that map to a CONFIG status id. */
export const DERIVED_STATUS_IDS = Object.freeze({
  stunned: null, // resolved by stunType: Physical -> stunned-physical, Mental -> stunned-mental
  encumbrance: 'encumbered',
  'critical-power': 'critical-power',
});

/**
 * Which CONFIG status id a website status-effect row maps to.
 * @param {{ id?: string, name?: string, type?: string }} row
 * @returns {string} always a status id (buff/debuff as the fallback)
 */
export function statusIdForRow(row) {
  const id = String(row?.id ?? '');
  if (id === 'stunned') return null; // the engine's derived stun row is displayed, never stored (§4.4)
  if (id in DERIVED_STATUS_IDS && DERIVED_STATUS_IDS[id]) return DERIVED_STATUS_IDS[id];
  const direct = STATUS_EFFECTS.find((s) => s.id === id);
  if (direct) return direct.id;
  const name = String(row?.name ?? '');
  const byName = STATUS_EFFECTS.find((s) => s.match && s.match.test(name));
  if (byName) return byName.id;
  return row?.type === 'buff' ? 'buff' : 'debuff';
}

/** @param {string} statusId */
export function statusImg(statusId) {
  return STATUS_EFFECTS.find((s) => s.id === statusId)?.img ?? 'icons/svg/aura.svg';
}

/**
 * lucide -> Font Awesome 6 Free (docs/STYLE-SPEC.md §4). Keyed by the lucide
 * component name the website imports; the value is the whole FA class string.
 * Reconciled by U05 (2026-09-10) against every lucide import under the
 * website's src/components/{character-sheet,layout,ui}. Where FA Free has no
 * one-to-one glyph (shield-with-exclamation, crossed swords, a single sword
 * are Pro-only) the nearest Free glyph is chosen and the spec marks it.
 */
export const LUCIDE_FA = Object.freeze({
  Activity: 'fa-solid fa-wave-square',
  AlertCircle: 'fa-solid fa-circle-exclamation',
  AlertTriangle: 'fa-solid fa-triangle-exclamation',
  Anchor: 'fa-solid fa-anchor',
  ArrowLeft: 'fa-solid fa-arrow-left',
  ArrowRight: 'fa-solid fa-arrow-right',
  ArrowUpCircle: 'fa-solid fa-circle-arrow-up',
  Ban: 'fa-solid fa-ban',
  Battery: 'fa-solid fa-battery-full',
  BatteryMedium: 'fa-solid fa-battery-half',
  Bell: 'fa-solid fa-bell',
  Binary: 'fa-solid fa-code',
  Bomb: 'fa-solid fa-bomb',
  BookOpen: 'fa-solid fa-book-open',
  Bot: 'fa-solid fa-robot',
  Box: 'fa-solid fa-box',
  BrainCircuit: 'fa-solid fa-brain',
  Calculator: 'fa-solid fa-calculator',
  Car: 'fa-solid fa-car',
  Check: 'fa-solid fa-check',
  CheckCircle: 'fa-solid fa-circle-check',
  CheckCircle2: 'fa-solid fa-circle-check',
  ChevronDown: 'fa-solid fa-chevron-down',
  ChevronUp: 'fa-solid fa-chevron-up',
  ChevronRight: 'fa-solid fa-chevron-right',
  ChevronsDownUp: 'fa-solid fa-compress',
  ChevronsUpDown: 'fa-solid fa-expand',
  Circle: 'fa-regular fa-circle',
  CircleDashed: 'fa-regular fa-circle-dot',
  CircuitBoard: 'fa-solid fa-microchip',
  Clock: 'fa-regular fa-clock',
  Coins: 'fa-solid fa-coins',
  Combine: 'fa-solid fa-diagram-project',
  Compass: 'fa-solid fa-compass',
  Copy: 'fa-regular fa-copy',
  CornerDownRight: 'fa-solid fa-turn-down fa-rotate-270',
  Cpu: 'fa-solid fa-microchip',
  CreditCard: 'fa-solid fa-credit-card',
  Crosshair: 'fa-solid fa-crosshairs',
  Database: 'fa-solid fa-database',
  Dices: 'fa-solid fa-dice',
  Download: 'fa-solid fa-download',
  DownloadCloud: 'fa-solid fa-cloud-arrow-down',
  Droplets: 'fa-solid fa-droplet',
  Eraser: 'fa-solid fa-eraser',
  Eye: 'fa-solid fa-eye',
  FileJson: 'fa-solid fa-file-code',
  FileSearch: 'fa-solid fa-file-magnifying-glass',
  Flame: 'fa-solid fa-fire',
  Frame: 'fa-regular fa-square',
  Glasses: 'fa-solid fa-glasses',
  Globe: 'fa-solid fa-globe',
  GraduationCap: 'fa-solid fa-graduation-cap',
  Hammer: 'fa-solid fa-hammer',
  Hand: 'fa-solid fa-hand',
  HardHat: 'fa-solid fa-helmet-safety',
  Heart: 'fa-solid fa-heart',
  HeartPulse: 'fa-solid fa-heart-pulse',
  History: 'fa-solid fa-clock-rotate-left',
  Home: 'fa-solid fa-house',
  Info: 'fa-solid fa-circle-info',
  Layers: 'fa-solid fa-layer-group',
  Library: 'fa-solid fa-book',
  LibraryBig: 'fa-solid fa-book-atlas',
  List: 'fa-solid fa-list',
  ListChecks: 'fa-solid fa-list-check',
  Loader2: 'fa-solid fa-spinner fa-spin',
  Lock: 'fa-solid fa-lock',
  Unlock: 'fa-solid fa-lock-open',
  LogIn: 'fa-solid fa-right-to-bracket',
  LogOut: 'fa-solid fa-right-from-bracket',
  Mail: 'fa-regular fa-envelope',
  Menu: 'fa-solid fa-bars',
  MinusCircle: 'fa-solid fa-circle-minus',
  PlusCircle: 'fa-solid fa-circle-plus',
  Plus: 'fa-solid fa-plus',
  Moon: 'fa-solid fa-moon',
  Sun: 'fa-solid fa-sun',
  MoreVertical: 'fa-solid fa-ellipsis-vertical',
  MoveHorizontal: 'fa-solid fa-arrows-left-right',
  Package: 'fa-solid fa-box',
  PackageOpen: 'fa-solid fa-box-open',
  Pencil: 'fa-solid fa-pencil',
  PenLine: 'fa-solid fa-pen',
  Pin: 'fa-solid fa-thumbtack',
  PinOff: 'fa-solid fa-thumbtack-slash',
  Play: 'fa-solid fa-play',
  RefreshCcw: 'fa-solid fa-arrows-rotate',
  RefreshCw: 'fa-solid fa-arrows-rotate',
  RotateCcw: 'fa-solid fa-rotate-left',
  Rocket: 'fa-solid fa-rocket',
  Ruler: 'fa-solid fa-ruler',
  Save: 'fa-solid fa-floppy-disk',
  Scale: 'fa-solid fa-scale-balanced',
  Scissors: 'fa-solid fa-scissors',
  Search: 'fa-solid fa-magnifying-glass',
  Settings2: 'fa-solid fa-sliders',
  Sheet: 'fa-solid fa-table-list',
  Shield: 'fa-solid fa-shield-halved',
  ShieldAlert: 'fa-solid fa-shield-virus',
  ShieldCheck: 'fa-solid fa-shield-heart',
  ShieldOff: 'fa-solid fa-shield',
  Ship: 'fa-solid fa-ship',
  Shirt: 'fa-solid fa-shirt',
  SkipForward: 'fa-solid fa-forward-step',
  Sparkles: 'fa-solid fa-wand-magic-sparkles',
  Split: 'fa-solid fa-code-fork',
  Stethoscope: 'fa-solid fa-stethoscope',
  Sword: 'fa-solid fa-khanda',
  Swords: 'fa-solid fa-hand-fist',
  Target: 'fa-solid fa-bullseye',
  Thermometer: 'fa-solid fa-temperature-half',
  Timer: 'fa-solid fa-stopwatch',
  Trash2: 'fa-solid fa-trash-can',
  Unplug: 'fa-solid fa-plug-circle-xmark',
  Upload: 'fa-solid fa-upload',
  User: 'fa-solid fa-user',
  UserCircle: 'fa-solid fa-circle-user',
  Volume2: 'fa-solid fa-volume-high',
  Wallet: 'fa-solid fa-wallet',
  Weight: 'fa-solid fa-weight-hanging',
  Wind: 'fa-solid fa-wind',
  Wrench: 'fa-solid fa-wrench',
  X: 'fa-solid fa-xmark',
  XCircle: 'fa-solid fa-circle-xmark',
  Zap: 'fa-solid fa-bolt',
});

/**
 * Font Awesome classes for the sheet chrome by SEMANTIC name (what the
 * templates ask for through the `sbIcon` helper), resolved through LUCIDE_FA
 * so a tab or a section carries exactly the glyph the website's lucide icon
 * maps to (docs/STYLE-SPEC.md §3.1 / §3.3). Item types resolve to their
 * ITEM_TYPES.fa. Any lucide name is also accepted by sbIcon directly.
 */
export const ICONS = Object.freeze({
  actor: LUCIDE_FA.User,
  // the five sheet tabs (character-form.tsx:578-582)
  info: LUCIDE_FA.User,
  body: LUCIDE_FA.Crosshair,
  abilities: LUCIDE_FA.BrainCircuit,
  inventory: LUCIDE_FA.Box,
  vehicles: LUCIDE_FA.Rocket,
  // header controls
  hud: LUCIDE_FA.Activity,
  import: LUCIDE_FA.Upload,
  export: LUCIDE_FA.FileJson,
  preferences: LUCIDE_FA.Settings2,
  portrait: LUCIDE_FA.User,
  // rolls and effects
  roll: LUCIDE_FA.Dices,
  effect: LUCIDE_FA.HeartPulse,
  chip: LUCIDE_FA.BookOpen,
  // pools and combat state (resource-trackers.tsx)
  hp: LUCIDE_FA.Heart,
  ep: LUCIDE_FA.Zap,
  fp: LUCIDE_FA.Sparkles,
  pp: LUCIDE_FA.Battery,
  reset: LUCIDE_FA.RefreshCcw,
  turn: LUCIDE_FA.Timer,
  stun: LUCIDE_FA.AlertTriangle,
  posture: 'fa-solid fa-person-walking',
  facing: LUCIDE_FA.Compass,
  engage: LUCIDE_FA.Swords,
  standDown: LUCIDE_FA.ShieldOff,
  pin: LUCIDE_FA.Pin,
  pinOff: LUCIDE_FA.PinOff,
  darkSide: LUCIDE_FA.Moon,
  lightSide: LUCIDE_FA.Sun,
  droid: LUCIDE_FA.Bot,
  sizeModifier: LUCIDE_FA.Ruler,
  weight: LUCIDE_FA.Weight,
  add: LUCIDE_FA.Plus,
  addCircle: LUCIDE_FA.PlusCircle,
  remove: LUCIDE_FA.Trash2,
  close: LUCIDE_FA.X,
  chevronDown: LUCIDE_FA.ChevronDown,
  chevronUp: LUCIDE_FA.ChevronUp,
  chevronRight: LUCIDE_FA.ChevronRight,
  search: LUCIDE_FA.Search,
  library: LUCIDE_FA.Library,
  edit: LUCIDE_FA.Pencil,
  copy: LUCIDE_FA.Copy,
  storage: LUCIDE_FA.Package,
  wallet: LUCIDE_FA.Wallet,
  info_: LUCIDE_FA.Info,
  minus: LUCIDE_FA.MinusCircle,
  plus: LUCIDE_FA.PlusCircle,
  ...Object.fromEntries(Object.entries(ITEM_TYPES).map(([t, c]) => [t, c.fa])),
});

/** Token bars and value attributes (ARCHITECTURE.md §4.1). */
export const TRACKABLE_ATTRIBUTES = Object.freeze({
  character: {
    bar: ['resources.hp', 'resources.ep', 'resources.fp', 'resources.pp'],
    value: ['derived.currentEncumbrance.dodge', 'derived.currentValues.basicSpeed', 'derived.currentValues.basicMove', 'initiative'],
  },
});

/** The value CONFIG.SHADOWBASE takes at init. */
export const SHADOWBASE = Object.freeze({
  ITEM_TYPES,
  ITEM_TYPE_NAMES,
  SOURCE_TO_TYPE,
  WEAPON_PART_FAMILIES,
  STATUS_EFFECTS,
  ICONS,
  LUCIDE_FA,
  TRACKABLE_ATTRIBUTES,
  statusIdForRow,
  statusImg,
  /** Item img by type (Foundry core svg). */
  icons: Object.freeze(Object.fromEntries(Object.entries(ITEM_TYPES).map(([t, c]) => [t, c.img]))),
});

export default SHADOWBASE;
