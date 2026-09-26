import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells, eq } from '../ui/shared.js';
import { fmtP, fmtT, fmtMdot, fmtTime, sig, unitSystem } from '../ui/format.js';
import { simulate } from '../physics/simulate.js';
import { nasa7Gas, stateFromPTY, massFractions } from '../physics/gas.js';
import { lambda } from '../physics/elements/orifice.js';
import { PSI, P_ATM } from '../physics/constants.js';
import { components } from '../data/components.js';

/**
 * Blowdown (brief §6.1, lab 1): one bottle emptying through one orifice to atmosphere, isothermal
 * or adiabatic, with the closed-form curve overlaid (V-1, V-2).
 *
 * The simulation uses NASA-7 N₂ (c_p varies with T); the closed forms assume constant γ, taken at
 * the starting temperature. Isothermal, the two agree to the solver's tolerance. Adiabatic, the
 * gap between them is real c_p(T), not error. Runs only while the orifice stays choked (tank above
 * twice ambient), which is where the closed forms hold.
 *
 * Time plays back compressed so the run fits about six seconds, and can be scrubbed, the way
 * FLUX's RC lab plays a charging capacitor.
 */
const PLAY_SECONDS = 6;
const circle = (d) => (Math.PI / 4) * d * d;

function defaults() {
  const c = components();
  return { mode: 'adiabatic', p0: c.bottle.p0, V: c.bottle.V, d: 1.0e-3, Cd: 1, T0: c.ambient.T, view: 1, playing: false };
}

/** Run the blowdown for a state; pure, cached by the inputs that matter. */
function compute(s) {
  const gas = nasa7Gas(['N2']);
  const CdA = s.Cd * circle(s.d);
  const st0 = stateFromPTY(gas, s.p0, s.T0, massFractions(gas, { N2: 1 }));
  const g = st0.gamma;
  const tau = s.V / (CdA * lambda(g) * Math.sqrt(g * st0.R * s.T0));
  const pStop = 2 * P_ATM;
  const tChoke = s.mode === 'isothermal' ? tau * Math.log(s.p0 / pStop) : (2 * tau * (Math.pow(pStop / s.p0, -(g - 1) / (2 * g)) - 1)) / (g - 1);
  const tEnd = Math.min(3 * tau, tChoke);
  const net = {
    nodes: [
      { id: 'tank', kind: 'volume', V: s.V, p: s.p0, T: s.T0, Y: { N2: 1 }, thermal: s.mode, label: 'GN₂ bottle' },
      { id: 'amb', kind: 'ambient', p: P_ATM, T: s.T0, Y: { N2: 1 } },
    ],
    edges: [{ id: 'RO-N2-01', type: 'orifice', a: 'tank', b: 'amb', CdA }],
  };
  const r = simulate(net, { gas, tEnd, sampleDt: tEnd / 240 });
  const closed = (t) => (s.mode === 'isothermal' ? s.p0 * Math.exp(-t / tau) : s.p0 * Math.pow(1 + ((g - 1) / 2) * (t / tau), (-2 * g) / (g - 1)));
  const tHalf = r.t.find((t, i) => r.samples[i].nodes.tank.p <= s.p0 / 2) ?? NaN;
  return { net, r, tau, tEnd, g, CdA, closed, tHalf, stats: r.stats };
}

const keyOf = (s) => JSON.stringify([s.mode, s.p0, s.V, s.d, s.Cd, s.T0]);

function sampleAt(c, frac) {
  const i = Math.min(c.r.samples.length - 1, Math.round(frac * (c.r.samples.length - 1)));
  return c.r.samples[i];
}

const P_UNIT = () => (unitSystem() === 'us' ? ['psia', PSI] : ['MPa', 1e6]);

export default defineLab({
  id: 'blowdown',
  title: 'Blowdown',
  status: 'uncalibrated',
  hint: 'Play or scrub time. Switch isothermal ↔ adiabatic, or change the orifice. Solid: simulation; dashed: closed form.',
  defaultState: defaults,
  controls: (s) => `
    <h3>Blowdown</h3>
    <label>Thermal model
      <select id="bd-mode"><option value="adiabatic"${s.mode === 'adiabatic' ? ' selected' : ''}>adiabatic</option><option value="isothermal"${s.mode === 'isothermal' ? ' selected' : ''}>isothermal</option></select></label>
    <label>Orifice ⌀ (mm) <input id="bd-d" type="number" min="0.2" max="5" step="0.1" value="${(s.d * 1e3).toFixed(2)}"></label>
    <label>Start pressure (psia) <input id="bd-p0" type="number" min="100" max="3000" step="50" value="${(s.p0 / PSI).toFixed(0)}"></label>
    <label>Bottle volume (L) <input id="bd-V" type="number" min="1" max="100" step="1" value="${(s.V * 1e3).toFixed(1)}"></label>
    <label>Time <input id="bd-t" type="range" min="0" max="1" step="0.001" value="${s.view}"></label>
    <button type="button" id="bd-play">${s.playing ? 'Pause' : 'Play'}</button>
    <p class="note">Bottle volume and fill default to the stand's placeholder values (issue #6). C_d = 1 (ideal orifice).</p>`,
  bind({ state: s, bump, root }) {
    const on = (id, f) => root.querySelector(id).addEventListener('input', (e) => (f(e.target.value), bump()));
    on('#bd-mode', (v) => (s.mode = v));
    on('#bd-d', (v) => (s.d = Math.max(0.2, Number(v)) * 1e-3));
    on('#bd-p0', (v) => (s.p0 = Math.max(100, Number(v)) * PSI));
    on('#bd-V', (v) => (s.V = Math.max(1, Number(v)) * 1e-3));
    on('#bd-t', (v) => ((s.view = Number(v)), (s.playing = false)));
    root.querySelector('#bd-play').addEventListener('click', (e) => {
      s.playing = !s.playing;
      if (s.playing && s.view >= 1) s.view = 0;
      e.target.textContent = s.playing ? 'Pause' : 'Play';
      bump();
    });
  },
  init(ctx) {
    const pid = new PidView(ctx.scene);
    return { pid, built: '' };
  },
  enter(ctx, h) {
    h.pid.setVisible(true);
  },
  exit(ctx, h) {
    h.pid.setVisible(false);
  },
  view: { x: 0.2, y: -0.9, z: 11 },
  recompute(s, computed) {
    const key = keyOf(s);
    if (!computed.blowdown || computed.blowdown.key !== key) computed.blowdown = { key, ...compute(s) };
    const c = computed.blowdown;
    c.now = sampleAt(c, s.view);
  },
  tick(dt, s) {
    if (!s.playing) return false;
    s.view = Math.min(1, s.view + dt / PLAY_SECONDS);
    if (s.view >= 1) s.playing = false;
    const el = typeof document !== 'undefined' && document.getElementById('bd-t');
    if (el) el.value = s.view;
    return true;
  },
  syncViews(s, computed, ctx, h) {
    const c = computed.blowdown;
    if (h.built !== c.key) {
      h.pid.build({ net: c.net, layout: { nodes: { tank: [-2.4, 0] }, vents: { 'RO-N2-01': [2.6, 0] } }, sensors: [{ tag: 'PT-N2-01', node: 'tank', offset: [1.2, 1.3] }] }, { circuitColor: Q.n2 });
      h.built = c.key;
    }
    h.pid.update(c.now, 1 / 60, fmtP);
  },
  law: (s) => (s.mode === 'isothermal' ? ['\\dfrac{p}{p_0} = e^{-t/\\tau}', '\\tau = \\dfrac{V}{C_dA\\,\\Lambda\\sqrt{\\gamma R T}}'] : ['\\dfrac{p}{p_0} = \\left(1 + \\dfrac{\\gamma-1}{2}\\dfrac{t}{\\tau_0}\\right)^{-\\frac{2\\gamma}{\\gamma-1}}', '\\dfrac{T}{T_0} = \\left(\\dfrac{p}{p_0}\\right)^{\\frac{\\gamma-1}{\\gamma}}']),
  liveRows: (s, computed) => {
    const c = computed.blowdown;
    const n = c.now;
    return [
      kv('$t$', fmtTime(n.t)),
      kv('$p$ (sim)', fmtP(n.nodes.tank.p)),
      kv('$p$ (closed form)', fmtP(c.closed(n.t))),
      kv('$T$', fmtT(n.nodes.tank.T)),
      kv('$\\mdot$', fmtMdot(n.edges['RO-N2-01'].mdot)),
      kv('$\\tau$', fmtTime(c.tau)),
    ].join('');
  },
  readout: (s, computed) => {
    const c = computed.blowdown;
    return cells([
      ['$\\tau$', fmtTime(c.tau)],
      ['$t_{1/2}$', fmtTime(c.tHalf)],
      ['$p$ now', fmtP(c.now.nodes.tank.p)],
      ['$T$ now', fmtT(c.now.nodes.tank.T)],
    ]);
  },
  coach: (s, computed) => {
    const c = computed.blowdown;
    const dev = c.r.samples.reduce((w, x) => Math.max(w, Math.abs(x.nodes.tank.p / c.closed(x.t) - 1)), 0);
    return {
      title: s.mode === 'isothermal' ? 'Isothermal: exponential decay' : 'Adiabatic: the gas cools as it expands',
      body: [
        s.mode === 'isothermal'
          ? 'Held at constant temperature, a choked orifice passes mass in proportion to $p$, so pressure decays exponentially with time constant $\\tau$.'
          : 'With no heat in, the gas left in the bottle expands isentropically and cools. Colder gas passes more mass per unit pressure, and the pressure drops faster than the isothermal curve.',
        eq('\\mdot = C_dA\\,p\\sqrt{\\tfrac{\\gamma}{RT}}\\,\\Lambda'),
        `Largest gap between simulation and closed form over the run: ${sig(dev * 100, 2)}%. ${s.mode === 'isothermal' ? 'That is solver tolerance.' : 'That is real $c_p(T)$ against the constant-$\\gamma$ closed form (N₂ is fitted from 300 K; below that it extrapolates).'}`,
        s.mode === 'adiabatic' && Math.min(...c.r.samples.map((x) => x.nodes.tank.T)) < 150
          ? `<b>Outside the model:</b> the gas reaches ${fmtT(Math.min(...c.r.samples.map((x) => x.nodes.tank.T)))}. Adiabatic is a limit: over a run of ${fmtTime(c.tEnd)} the bottle wall heats the gas, so a real bottle lies between the two curves. This cold, N₂ also nears saturation, where the ideal-gas model (and the 300 K-based fit) no longer holds.`
          : '',
      ],
    };
  },
  predict: (s, computed) => {
    const c = computed.blowdown;
    if (!c.other) c.other = compute({ ...s, mode: s.mode === 'isothermal' ? 'adiabatic' : 'isothermal' });
    const other = c.other;
    const toOther = s.mode === 'isothermal' ? 'adiabatic' : 'isothermal';
    const sooner = other.tHalf < c.tHalf;
    return [
      {
        id: `bd-mode-${s.mode}`,
        q: `Switch this blowdown to ${toOther}. Does the bottle reach half its starting pressure sooner or later?`,
        options: ['Sooner', 'Later', 'The same'],
        answer: Math.abs(other.tHalf / c.tHalf - 1) < 0.005 ? 2 : sooner ? 0 : 1,
        why: `${toOther[0].toUpperCase() + toOther.slice(1)}: $t_{1/2}$ = ${fmtTime(other.tHalf)}, against ${fmtTime(c.tHalf)} now. Adiabatic gas cools, so pressure falls on two counts: less mass and lower temperature.`,
      },
    ];
  },
  plot: (s, computed) => {
    const c = computed.blowdown;
    const [u, f] = P_UNIT();
    const ts = c.r.t;
    return {
      series: [
        { xs: ts, ys: c.r.samples.map((x) => x.nodes.tank.p / f), color: '#8fa88a', label: 'simulation (NASA-7 N₂)' },
        { xs: ts, ys: ts.map((t) => c.closed(t) / f), color: '#ece6e2', dash: [5, 4], width: 1.5, label: `closed form (γ = ${c.g.toFixed(3)})` },
      ],
      marker: { x: c.now.t, y: c.now.nodes.tank.p / f, color: '#ece6e2' },
      xLabel: 't (s)',
      yLabel: `p (${u})`,
      yMin: 0,
      xFmt: (v) => sig(v, 3),
      yFmt: (v) => sig(v, 3),
    };
  },
});
