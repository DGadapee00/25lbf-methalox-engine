/**
 * The glossary's symbol key: each P&ID mark drawn as a small SVG from scene/symbols.js, the same
 * geometry and colours the schematic uses, so the key cannot drift from the drawing.
 */
import { CHOKE, edgeShape, pipeGap, VENT, NODE_SHAPES, FLAME, IGNITER, SENSOR_R, ring } from '../scene/symbols.js';
import { M, Q, rampColorCVD } from '../scene/manim.js';

const K = 46; // px per scene unit
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const DARK = '#333333';
const BODY = '#222222';
const PIPE = '#555555';
// Two pressures on the P&ID's ramp, for the examples: a low line and a high one.
const P_LO = `#${rampColorCVD(0.2).getHexString()}`;
const P_HI = `#${rampColorCVD(0.85).getHexString()}`;

/** An SVG canvas in scene units (u right, v up); bounds grow as marks are added. */
function canvas() {
  const out = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const pt = ([u, v]) => {
    const x = u * K;
    const y = -v * K;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const stroke = (color, width, dashed) => `fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"${dashed ? ' stroke-dasharray="6 4"' : ''}`;
  const c = {
    line(pts, color, width = 2, dashed = false) {
      out.push(`<polyline points="${pts.map(pt).join(' ')}" ${stroke(color, width, dashed)}/>`);
    },
    poly(pts, color, opacity = 1) {
      out.push(`<polygon points="${pts.map(pt).join(' ')}" fill="${color}" fill-opacity="${opacity}"/>`);
    },
    ellipse([u, v], rx, ry, color, opacity = 1) {
      pt([u - rx, v - ry]);
      pt([u + rx, v + ry]);
      out.push(`<ellipse cx="${(u * K).toFixed(1)}" cy="${(-v * K).toFixed(1)}" rx="${(rx * K).toFixed(1)}" ry="${(ry * K).toFixed(1)}" fill="${color}" fill-opacity="${opacity}"/>`);
    },
    text([u, v], s, cls) {
      pt([u - 0.6, v - 0.12]);
      pt([u + 0.6, v + 0.12]);
      out.push(`<text x="${(u * K).toFixed(1)}" y="${(-v * K).toFixed(1)}" class="${cls}" text-anchor="middle" dominant-baseline="middle">${s}</text>`);
    },
    svg(label, pad = 6) {
      const w = x1 - x0 + 2 * pad;
      const h = y1 - y0 + 2 * pad;
      return `<svg class="sym-svg" viewBox="${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" width="${Math.round(w)}" height="${Math.round(h)}" role="img" aria-label="${label}">${out.join('')}</svg>`;
    },
  };
  return c;
}

/** A shape from scene/symbols.js at (cx, cy); for edge shapes, along +u. */
function drawShape(c, shape, at, { ink, fill = BODY, fillOpacity = 1, choke = 'off' } = {}) {
  const off = ([u, v]) => [at[0] + u, at[1] + v];
  const col = { circuit: ink, white: hex(M.white), grey: hex(M.grey), hot: hex(Q.hot) }[shape.ink] || ink;
  if (shape.plate) {
    const [w, h] = shape.plate.map((d) => d / 2);
    c.poly([[-w, -h], [w, -h], [w, h], [-w, h]].map(off), fill);
  }
  for (const t of shape.tris || []) c.poly(t.map(off), fill, fillOpacity);
  for (const l of shape.lines || []) c.line(l.map(off), col, shape.width, shape.dashed);
  for (const s of shape.segs || []) c.line(s.map(off), col, shape.width);
  if (shape.disc) c.ellipse(off(shape.disc.at), shape.disc.r, shape.disc.r, shape.ink ? hex(CHOKE[choke]) : fill);
}

/** An edge symbol in a short pipe: the pipe halves stop at the symbol's gap, as on the P&ID. */
function edge(type, letters, opts = {}) {
  const c = canvas();
  const gap = pipeGap(type);
  const L = opts.L ?? 0.75;
  c.line([[-L, 0], [-gap, 0]], opts.pA ?? PIPE, 5);
  c.line([[gap, 0], [L, 0]], opts.pB ?? PIPE, 5);
  drawShape(c, edgeShape(type, letters), [0, 0], { ink: hex(Q.ox), ...opts });
  if (opts.ring) c.line(ring(0, 0, 0.51, 40), hex(Q.next), 3);
  return c;
}

const OPEN = { fill: hex(M.green), fillOpacity: 0.95 };
const SHUT = { fill: BODY, fillOpacity: 0.25 };

/** Each drawing: a list of { svg, caption } variants. */
const DRAW = {
  pipe: () => [{ svg: edge('orifice', null, { pA: P_HI, pB: P_LO, choke: 'green' }).svg('pipe coloured by pressure'), caption: 'high → low' }],
  dots: () => {
    const c = canvas();
    c.line([[-1.1, 0], [1.1, 0]], P_LO, 5);
    for (const u of [-0.8, -0.2, 0.4, 1.0]) c.ellipse([u, 0], 0.06, 0.06, hex(M.white), 0.85);
    return [{ svg: c.svg('flow dots'), caption: 'flow →' }];
  },
  hv: () => [{ svg: edge('valve', 'HV', SHUT).svg('hand valve, shut'), caption: 'shut' }, { svg: edge('valve', 'HV', OPEN).svg('hand valve, open'), caption: 'open' }],
  sv: () => [{ svg: edge('valve', 'SV', SHUT).svg('actuated valve, shut'), caption: 'shut' }, { svg: edge('valve', 'SV', OPEN).svg('actuated valve, open'), caption: 'open' }],
  pcv: () => [{ svg: edge('regulator', 'PCV', { fill: hex(M.green), fillOpacity: 0.6 }).svg('regulator'), caption: 'regulating' }],
  psv: () => {
    const c = edge('relief', 'PSV', SHUT);
    drawShape(c, VENT, [0.75, 0]);
    return [{ svg: c.svg('relief valve, seated'), caption: 'seated' }];
  },
  ckv: () => [{ svg: edge('check', 'CKV').svg('check valve'), caption: 'flow →' }],
  orifice: () => ['green', 'amber', 'red', 'off'].map((q) => ({ svg: edge('orifice', null, { L: 0.4, choke: q }).svg(`orifice, ${q} choke dot`), caption: { green: 'margin ≥ 2.2', amber: 'choked < 2.2', red: 'not choked', off: 'no flow' }[q] })),
  vent: () => {
    const c = canvas();
    c.line([[0, 0.9], [0, 0]], P_LO, 5);
    drawShape(c, VENT, [0, 0]);
    return [{ svg: c.svg('vent'), caption: '' }];
  },
  bottle: () => {
    const c = canvas();
    drawShape(c, NODE_SHAPES.bottle, [0, 0], { ink: hex(Q.ox), fill: P_HI });
    return [{ svg: c.svg('gas bottle'), caption: 'full' }];
  },
  junction: () => {
    const c = canvas();
    c.line([[-0.8, 0], [0.8, 0]], P_HI, 5);
    c.line([[0, 0], [0, -0.7]], P_HI, 5);
    drawShape(c, NODE_SHAPES.junction, [0, 0], { fill: P_HI });
    return [{ svg: c.svg('node'), caption: '' }];
  },
  reservoir: () => {
    const c = canvas();
    drawShape(c, NODE_SHAPES.reservoir, [0, 0], { fill: DARK });
    return [{ svg: c.svg('held-pressure boundary'), caption: '' }];
  },
  chamber: () => [false, true].map((burning) => {
    const c = canvas();
    drawShape(c, NODE_SHAPES.chamber, [0, 0], { fill: DARK });
    if (burning) {
      c.ellipse([0, 0], ...FLAME.outer, hex(Q.hot), 0.85);
      c.ellipse([0, 0], ...FLAME.core, hex(Q.hotCore), 0.9);
    }
    return { svg: c.svg(burning ? 'chamber, burning' : 'chamber, cold'), caption: burning ? 'burning' : 'cold' };
  }),
  igniter: () => [false, true].map((on) => {
    const c = canvas();
    c.line(IGNITER.ring, hex(on ? M.white : M.grey), 2);
    c.line(IGNITER.bolt, hex(on ? Q.hot : M.grey), 2.5);
    return { svg: c.svg(on ? 'igniter, on' : 'igniter, off'), caption: on ? 'on' : 'off' };
  }),
  sensor: () => {
    const c = canvas();
    c.line([[-0.7, 0], [0.7, 0]], P_HI, 5);
    drawShape(c, NODE_SHAPES.junction, [0, 0], { fill: P_HI });
    c.line([[0, 0], [0, 0.9 - SENSOR_R]], hex(M.grey), 1.5);
    c.line(ring(0, 0.9, SENSOR_R), hex(M.grey), 1.5);
    c.text([0, 1.6], 'PT-OX-02', 'sym-t');
    c.text([0, 1.35], '480 psia', 'sym-v');
    return [{ svg: c.svg('pressure transducer'), caption: '' }];
  },
  tag: () => [{ html: '<span class="pid-tag">HV-OX-01</span>', caption: '' }],
  circuits: () => [['oxidizer', Q.ox], ['fuel', Q.fuel], ['N₂', Q.n2], ['chamber', Q.hot]].map(([name, col]) => ({ html: `<span class="sym-swatch" style="background:${hex(col)}"></span>`, caption: name })),
  next: () => [{ svg: edge('valve', 'SV', { ...SHUT, ring: true }).svg('yellow ring: press next'), caption: 'press next' }],
};

/** HTML for one symbol entry's drawings. */
export function symbolFigure(draw) {
  const variants = DRAW[draw]?.() ?? [];
  return `<div class="sym-fig${variants.length > 2 ? ' many' : ''}">${variants.map((x) => `<figure>${x.svg ?? x.html}${x.caption ? `<figcaption>${x.caption}</figcaption>` : ''}</figure>`).join('')}</div>`;
}

/** Names of the drawings available, for the shell check. */
export const SYMBOL_DRAWINGS = Object.keys(DRAW);
