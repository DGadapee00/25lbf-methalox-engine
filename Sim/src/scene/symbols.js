/**
 * P&ID symbol geometry, shared by the schematic (scene/pid.js, three.js) and the glossary's
 * symbol key (ui/symbolKey.js, SVG), so the key always shows exactly what the schematic draws.
 *
 * Pure data, no three.js. Coordinates are scene units in a symbol's own frame: for an edge
 * symbol u runs along the pipe (in the flow direction of the edge, a → b) and v across it; for a
 * node symbol they are x and y about its centre. A shape is
 *   { tris: [[p, p, p]…]  filled triangles (the valve body, whose fill shows how far it is open),
 *     lines: [[p…]…]      polylines,
 *     segs: [[p, p]…]     separate segments,
 *     plate: [w, h]       a filled rectangle behind the outline (bottles, chambers, reservoirs),
 *     disc: { at, r }     a filled circle (a junction, the choke indicator),
 *     ink: 'circuit' | 'white' | 'grey' | 'hot', width, dashed }
 */
export const S = 0.32; // symbol half-size

/** Choke indicator colours: margin p₀/p ≥ 2.2, choked below 2.2, not choked, no flow. */
export const CHOKE = { green: 0x83c167, amber: 0xf0ac5f, red: 0xfc6255, off: 0x444444 };

/** Points on a circle of radius r about (cx, cy), closed. */
export function ring(cx, cy, r, n = 24) {
  return Array.from({ length: n + 1 }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]);
}

const BOW_L = [[-S, -S * 0.75], [-S, S * 0.75], [0, 0]];
const BOW_R = [[S, -S * 0.75], [S, S * 0.75], [0, 0]];
const bowtie = () => ({ tris: [BOW_L, BOW_R], lines: [[...BOW_L, BOW_L[0]], [...BOW_R, BOW_R[0]]], ink: 'circuit', width: 2 });

/** Half-width of the gap a symbol leaves in its pipe. */
export const pipeGap = (type) => (type === 'orifice' ? 0.08 : S);

/** Shape of an edge symbol, from the element type and (for valves) its ISA letters. */
export function edgeShape(type, letters) {
  if (type === 'regulator') {
    const arc = Array.from({ length: 13 }, (_, k) => [0.22 * Math.cos((Math.PI * k) / 12), S * 0.3 + 0.22 * Math.sin((Math.PI * k) / 12)]);
    const b = bowtie();
    return { ...b, lines: [...b.lines, [[0, 0], [0, S * 0.3], ...arc]] };
  }
  if (type === 'valve' && letters === 'HV') return { ...bowtie(), segs: [[[0, 0], [0, S * 1.2]], [[-S * 0.6, S * 1.2], [S * 0.6, S * 1.2]]] };
  if (type === 'valve') {
    const a = S * 0.45;
    return { ...bowtie(), segs: [[[0, 0], [0, S]], [[-a, S], [a, S]], [[-a, S * 1.6], [a, S * 1.6]], [[-a, S], [-a, S * 1.6]], [[a, S], [a, S * 1.6]]] };
  }
  if (type === 'relief') {
    // Angle body (one triangle) with a zigzag spring behind it, along the pipe.
    const spring = [[0, 0], ...Array.from({ length: 6 }, (_, k) => [-(k + 1) * 0.1, ((k + 1) % 2 ? 1 : -1) * 0.12])];
    return { tris: [BOW_L], lines: [[...BOW_L, BOW_L[0]], spring], ink: 'circuit', width: 2 };
  }
  if (type === 'check') {
    return { lines: [[[-S, -S * 0.7], [-S, S * 0.7], [S * 0.6, 0], [-S, -S * 0.7]]], segs: [[[S * 0.6, -S * 0.8], [S * 0.6, S * 0.8]]], ink: 'circuit', width: 2 };
  }
  if (type === 'orifice') return { segs: [[[-0.07, -S], [-0.07, S]], [[0.07, -S], [0.07, S]]], ink: 'white', width: 2.5, disc: { at: [0, -S - 0.3], r: 0.13 } };
  return null;
}

/** A vent to atmosphere at the end of a pipe: three shrinking bars. */
export const VENT = { segs: [[[-0.18, 0], [0.18, 0]], [[-0.11, -0.08], [0.11, -0.08]], [[-0.04, -0.16], [0.04, -0.16]]], ink: 'grey', width: 2 };

/** Node symbols. */
export const NODE_SHAPES = {
  bottle: (() => {
    const w = 0.5;
    const h = 1.2;
    return { plate: [2 * w, 2 * h], lines: [[[-w, -h], [w, -h], [w, h - 0.3], [0.2, h], [-0.2, h], [-w, h - 0.3], [-w, -h]]], ink: 'circuit', width: 2.5 };
  })(),
  chamber: (() => {
    const w = 0.9;
    const h = 0.55;
    return { plate: [2 * w, 2 * h], lines: [[[-w, -h], [w * 0.55, -h], [w, -0.15], [w, 0.15], [w * 0.55, h], [-w, h], [-w, -h]]], ink: 'hot', width: 2.5 };
  })(),
  reservoir: { plate: [1, 1], lines: [[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]]], ink: 'grey', width: 2, dashed: true },
  junction: { disc: { at: [0, 0], r: 0.11 } },
};

/** Where a node's name label sits under its body (junctions label on the diagonal instead). */
export const NODE_LABEL_DROP = { bottle: 1.55, chamber: 0.85, reservoir: 0.8 };
/** Size of a node's inspector target. */
export const NODE_HIT = { bottle: [1.0, 2.4], chamber: [1.8, 1.1], reservoir: [1.0, 1.0] };

/** Flame inside a burning chamber: a hot core in a red envelope (ellipse radii). */
export const FLAME = { outer: [0.42 * 1.5, 0.42 * 0.95], core: [0.2 * 1.6, 0.2 * 0.9] };

/** Igniter: a spark in a circle. */
export const IGNITER = { ring: ring(0, 0, 0.3), bolt: [[-0.08, 0.2], [0.06, 0.02], [-0.06, -0.02], [0.08, -0.2]] };

/** Transducer or load cell: a circle on a stem from the node it reads. */
export const SENSOR_R = 0.28;
