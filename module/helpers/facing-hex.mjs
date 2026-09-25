// module/helpers/facing-hex.mjs
//
// The facing dial's GEOMETRY, ported from the website's facing-hex.tsx
// (src/components/character-sheet/components/facing-hex.tsx, lines cited
// inline). Nothing here decides a rule: which arc a threat is in, which
// defenses it removes and whether the character can attack without turning
// all come from engine.facingRules (facing-rules.ts), and the sheet passes the
// answers in. This file turns two hexsides into svg paths.
//
// Hexside k sits at k x 60 degrees clockwise from straight up, so 0 is dead
// ahead and 3 dead behind - the convention arcForOffset uses (facing-hex.tsx:9-11).
// Stored values stay 0-based; the labels the player reads are 1-6 (asLabel).

/** facing-hex.tsx:68-73 */
export const CX = 78;
export const CY = 78;
export const HEX_R = 46;    // the hexagon's vertices
export const INNER_R = 38;  // facing ring, filled from the centre
export const RING_IN = 49;  // threat ring
export const RING_OUT = 68;
export const VIEW_BOX = '-6 -6 168 168'; // facing-hex.tsx:116 - padded by 6 so the 0/3 labels are not clipped

/** facing-hex.tsx:30 - a hexside as the player reads it. */
export const asLabel = (hexside) => Number(hexside) + 1;

/** facing-hex.tsx:33-36 - clockwise from straight up. */
export function point(cx, cy, angleDeg, r) {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

const f = (n) => Number(n.toFixed(3));

/** facing-hex.tsx:39-48 - a wedge of an annulus, centred on a hexside's direction. */
export function wedge(cx, cy, side, rInner, rOuter) {
  const mid = side * 60;
  const [x1, y1] = point(cx, cy, mid - 30, rOuter).map(f);
  const [x2, y2] = point(cx, cy, mid + 30, rOuter).map(f);
  const [x3, y3] = point(cx, cy, mid + 30, rInner).map(f);
  const [x4, y4] = point(cx, cy, mid - 30, rInner).map(f);
  return rInner === 0
    ? `M ${cx} ${cy} L ${x1} ${y1} A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2} Z`
    : `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 0 0 ${x4} ${y4} Z`;
}

/** facing-hex.tsx:58-66 - an arrow from one radius to another along a hexside; `to < from` points inward. */
export function arrow(cx, cy, side, from, to, head = 7) {
  const a = side * 60;
  const barb = to > from ? -head : head;
  const [tx, ty] = point(cx, cy, a, to).map(f);
  const [bx, by] = point(cx, cy, a, from).map(f);
  const [lx, ly] = point(cx, cy, a - 12, to + barb).map(f);
  const [rx, ry] = point(cx, cy, a + 12, to + barb).map(f);
  return { shaft: `M ${bx} ${by} L ${tx} ${ty}`, head: `M ${tx} ${ty} L ${lx} ${ly} L ${rx} ${ry} Z` };
}

/**
 * Everything the facing-hex partial draws, for one character.
 * @param {object} input
 * @param {number} input.facing       stored hexside 0-5
 * @param {number} input.bearing      the active threat's hexside
 * @param {number[]} input.others     every other threat's hexside
 * @param {boolean} input.engaged     threatEngaged
 * @param {(side:number) => 'Front'|'Side'|'Rear'} input.arcAt   engine.facingRules.arcFrom for each side
 * @param {number} [input.hexsides]   engine.facingRules.HEXSIDES (6)
 */
export function facingHexModel({ facing, bearing, others = [], engaged = false, arcAt, hexsides = 6 }) {
  const sides = Array.from({ length: hexsides }, (_, i) => i);
  const hex = sides.map((i) => point(CX, CY, i * 60 + 30, HEX_R).map(f).join(',')).join(' ');
  const facingArrow = arrow(CX, CY, facing, 6, INNER_R - 4);                // facing-hex.tsx:98
  const threatSides = engaged ? [bearing, ...others] : [];                  // facing-hex.tsx:102
  const tone = (arc) => (arc === 'Rear' ? 'rear' : arc === 'Side' ? 'side' : 'front'); // arcTone, facing-hex.tsx:76-77
  return {
    viewBox: VIEW_BOX,
    hex,
    threats: sides.map((i) => {
      const isActive = engaged && i === bearing;
      const isOther = engaged && others.includes(i);
      return { side: i, label: asLabel(i), d: wedge(CX, CY, i, RING_IN, RING_OUT), isActive, isOther };
    }),
    facings: sides.map((i) => ({ side: i, label: asLabel(i), d: wedge(CX, CY, i, 0, INNER_R), isActive: i === facing })),
    labels: sides.map((i) => {
      const [x, y] = point(CX, CY, i * 60, RING_OUT + 8).map(f);
      return { side: i, label: asLabel(i), x, y, lit: i === facing || threatSides.includes(i) };
    }),
    self: { ...facingArrow, cx: CX, cy: CY },
    threatArrows: threatSides.map((side, i) => {
      const a = arrow(CX, CY, side, RING_OUT - 4, RING_IN + 3);           // facing-hex.tsx:100 (inward)
      const arc = typeof arcAt === 'function' ? arcAt(side) : 'Front';
      return { side, label: asLabel(side), ...a, active: i === 0, tone: tone(arc), arc };
    }),
    aria: engaged
      ? `Facing hexside ${asLabel(facing)}. Active threat on hexside ${asLabel(bearing)}.${others.length ? ` ${others.length} more on ${others.map(asLabel).join(', ')}.` : ''}`
      : `Facing hexside ${asLabel(facing)}, no engaged threat`,
  };
}

export default facingHexModel;
