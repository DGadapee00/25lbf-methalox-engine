import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells } from '../ui/shared.js';
import { fmtP, fmtMdot, fmtTime, sig } from '../ui/format.js';
import { valveTimingDefaults, runValveTiming } from '../data/valveTiming.js';
import { components } from '../data/components.js';

/**
 * Valve timing (Phase 5 step 1): command, delay, ramp, then flow. The answer on the predict card
 * is the time the simulated stem crosses half open.
 */
const c0 = components();

function netFor(s) {
  return {
    nodes: [
      { id: 'up', kind: 'volume', V: c0.bottle.V, p: c0['PCV-OX-01'].pSet, T: c0.ambient.T, Y: { N2: 1 }, label: 'supply' },
      { id: 'line', kind: 'volume', V: c0.line.V, p: c0.ambient.p, T: c0.ambient.T, Y: { N2: 1 }, label: 'line' },
      { id: 'amb', kind: 'ambient', p: c0.ambient.p, T: c0.ambient.T, Y: { N2: 1 } },
    ],
    edges: [
      { id: 'SV-OX-01', type: 'valve', a: 'up', b: 'line', CdAmax: 1, tOpen: s.tOpen, tClose: s.tClose, delay: s.delay, x0: 0 },
      { id: 'INJ-OX-01', type: 'orifice', a: 'line', b: 'amb', CdA: 1 },
    ],
  };
}

export default defineLab({
  id: 'valve-timing',
  title: 'Valve timing',
  status: 'uncalibrated',
  hint: 'The stem waits out the command delay, then ramps. Half open is the middle of that ramp.',
  defaultState: valveTimingDefaults,
  controls: (s) => `
    <h3>SV-OX-01</h3>
    <label>Command delay (ms) <input id="vt-delay" type="number" min="0" max="500" step="1" value="${(s.delay * 1e3).toFixed(0)}"></label>
    <label>Open time (ms) <input id="vt-open" type="number" min="1" max="1000" step="1" value="${(s.tOpen * 1e3).toFixed(0)}"></label>
    <p class="note">Defaults are the SV-OX-01 placeholders (issue #6): ${fmtTime(c0['SV-OX-01'].delay)} delay, ${fmtTime(c0['SV-OX-01'].tOpen)} open. A what-if here does not change the stand.</p>`,
  bind({ state: s, bump, root }) {
    root.querySelector('#vt-delay').addEventListener('input', (e) => {
      s.delay = Math.max(0, Number(e.target.value)) * 1e-3;
      bump();
    });
    root.querySelector('#vt-open').addEventListener('input', (e) => {
      s.tOpen = Math.max(1e-3, Number(e.target.value)) * 1e-3;
      bump();
    });
  },
  init(ctx) {
    const pid = new PidView(ctx.scene);
    pid.build({ net: netFor(valveTimingDefaults()), layout: { nodes: { up: [-2.6, 0], line: [0.4, 0] }, vents: { 'INJ-OX-01': [3.2, 0] } }, sensors: [{ tag: 'PT-OX-03', node: 'line', offset: [0, 1.3] }] }, { circuitColor: Q.n2 });
    pid.setVisible(false);
    return { pid };
  },
  enter(ctx, h) {
    h.pid.setVisible(true);
  },
  exit(ctx, h) {
    h.pid.setVisible(false);
  },
  view: { x: 0.2, y: 0.2, z: 11 },
  recompute(s, computed) {
    // The id is hyphenated, so the page's readiness check (computed[id]) cannot use the dotted name.
    computed.valveTiming = runValveTiming(s);
    computed['valve-timing'] = computed.valveTiming;
  },
  syncViews(s, computed, ctx, h) {
    const c = computed.valveTiming;
    const last = c.final;
    h.pid.update(last, 1 / 60, fmtP);
  },
  law: () => ['x = 0 \\;\\text{for}\\; t < t_{\\text{delay}}', 'x = \\dfrac{t - t_{\\text{delay}}}{t_{\\text{open}}} \\;\\text{while the stem is moving}'],
  liveRows: (s, computed) => {
    const c = computed.valveTiming;
    return [
      kv('command delay', fmtTime(s.delay)),
      kv('open time', fmtTime(s.tOpen)),
      kv('half open', fmtTime(c.halfT)),
      kv('full open', fmtTime(c.openT)),
      kv('line', fmtP(c.final.nodes.line.p)),
      kv('$\\mdot$', fmtMdot(c.final.edges['INJ-OX-01'].mdot)),
    ].join('');
  },
  readout: (s, computed) => {
    const c = computed.valveTiming;
    return cells([
      ['half open', fmtTime(c.halfT)],
      ['full open', fmtTime(c.openT)],
      ['stem at end', sig(c.final.edges['SV-OX-01'].x, 3)],
      ['$\\mdot$', fmtMdot(c.final.edges['INJ-OX-01'].mdot)],
    ]);
  },
  coach: () => ({
    title: 'Command, then motion',
    body: 'A command does not move the stem until the delay has elapsed. The ramp then takes the open time. Both numbers are placeholders until D-5 picks a valve. The supply is the bottle volume held at the regulator set point, so the upstream pressure stays put while you watch the stem.',
  }),
  plot: (s, computed) => {
    const c = computed.valveTiming;
    const ts = c.samples.map((x) => x.t * 1e3);
    return {
      series: [
        { xs: ts, ys: c.samples.map((x) => (x.t < s.delay ? 0 : 1)), color: '#9a9591', label: 'command' },
        { xs: ts, ys: c.samples.map((x) => x.edges['SV-OX-01'].x), color: '#f4d345', label: 'stem x' },
      ],
      vlines: [
        { x: s.delay * 1e3, color: '#9a9591', label: 'delay' },
        { x: c.halfT * 1e3, color: '#f4d345', label: 'half' },
      ],
      xLabel: 't (ms)',
      yLabel: 'x',
      yMin: 0,
      yMax: 1.05,
      xFmt: (v) => sig(v, 3),
      yFmt: (v) => sig(v, 2),
    };
  },
  predict: (s, computed) => {
    const c = computed.valveTiming;
    const options = [s.delay, s.delay + 0.5 * s.tOpen, s.delay + s.tOpen];
    let answer = 0;
    options.forEach((t, i) => {
      if (Math.abs(t - c.halfT) < Math.abs(options[answer] - c.halfT)) answer = i;
    });
    return [{
      id: 'vt-half',
      q: 'SV-OX-01 is commanded open at $t = 0$. When is the stem half open?',
      options: options.map((t) => fmtTime(t)),
      answer,
      why: `The run crosses $x = 0.5$ at ${fmtTime(c.halfT)}. Motion starts after the ${fmtTime(s.delay)} delay and takes ${fmtTime(s.tOpen)} to finish.`,
    }];
  },
});
