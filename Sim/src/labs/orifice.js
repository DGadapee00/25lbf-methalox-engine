import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells, eq } from '../ui/shared.js';
import { fmtP, fmtMdot, sig, unitSystem } from '../ui/format.js';
import { orificeFlow, criticalRatio, flux } from '../physics/elements/orifice.js';
import { nasa7Gas, stateFromPTY, massFractions } from '../physics/gas.js';
import { PSI } from '../physics/constants.js';
import { components, injectorCdA } from '../data/components.js';

/**
 * Orifice (brief §6.1, lab 2): sweep the downstream pressure through the critical ratio and watch
 * the flow stop rising. The default is the GOX injector at the hot-fire design point
 * (PROJECT_PLAN §2.1–2.3: 480 psia manifold into P_c = 250 psia), and its choke indicator is
 * amber there on purpose: that is brief §8's margin issue, S-3.
 *
 * Choke indicator (§5.2): green p₀/p ≥ 2.2, amber choked but below 2.2, red unchoked.
 */
const GASES = { O2: 'GOX', CH4: 'GCH₄', N2: 'GN₂' };
const GREEN = 2.2;
const circle = (d) => (Math.PI / 4) * d * d;

function defaults() {
  const c = components();
  return { gas: 'O2', p0: c['PCV-OX-01'].pSet, pb: 250 * PSI, T0: c.ambient.T, CdA: injectorCdA(c, 'INJ-OX-01'), Cd: c.injector.Cd };
}

function state(gasName, p, T) {
  const g = nasa7Gas([gasName]);
  return stateFromPTY(g, p, T, massFractions(g, { [gasName]: 1 }));
}

function compute(s) {
  const up = state(s.gas, s.p0, s.T0);
  const down = { ...up, p: s.pb };
  const f = orificeFlow(s.CdA, up, down);
  const rStar = criticalRatio(up.gamma);
  const cat = !f.choked ? 'red' : f.margin >= GREEN ? 'green' : 'amber';
  const rs = Array.from({ length: 201 }, (_, i) => 0.02 + (0.98 * i) / 200);
  const curve = rs.map((r) => s.CdA * flux(s.p0, s.T0, up.gamma, up.R, r * s.p0));
  return { up, f, rStar, cat, rs, curve, mChoked: s.CdA * flux(s.p0, s.T0, up.gamma, up.R, 0) };
}

export default defineLab({
  id: 'orifice',
  title: 'Orifice',
  status: 'uncalibrated',
  hint: 'Drag the back pressure through the critical ratio: the flow stops rising once the orifice chokes.',
  defaultState: defaults,
  controls: (s) => `
    <h3>Orifice</h3>
    <label>Gas <select id="or-gas">${Object.entries(GASES)
      .map(([k, v]) => `<option value="${k}"${s.gas === k ? ' selected' : ''}>${v}</option>`)
      .join('')}</select></label>
    <label>Upstream p₀ (psia) <input id="or-p0" type="number" min="20" max="2000" step="5" value="${(s.p0 / PSI).toFixed(1)}"></label>
    <label>Back pressure (psia) <input id="or-pb-n" type="number" min="1" max="2000" step="1" value="${(s.pb / PSI).toFixed(1)}"></label>
    <input id="or-pb" type="range" min="0.02" max="1" step="0.001" value="${(s.pb / s.p0).toFixed(3)}" aria-label="Back pressure as a fraction of p0">
    <p class="note">Default: GOX injector INJ-OX-01, 4 × ⌀1.4 mm, C_d ${s.Cd} (components.json, uncalibrated), 480 psia into P_c = 250 psia (PROJECT_PLAN §2).</p>`,
  bind({ state: s, bump, root }) {
    const num = root.querySelector('#or-pb-n');
    const sl = root.querySelector('#or-pb');
    root.querySelector('#or-gas').addEventListener('input', (e) => ((s.gas = e.target.value), bump()));
    root.querySelector('#or-p0').addEventListener('input', (e) => {
      s.p0 = Math.max(20, Number(e.target.value)) * PSI;
      sl.value = Math.min(1, s.pb / s.p0);
      bump();
    });
    num.addEventListener('input', (e) => {
      s.pb = Math.max(1, Number(e.target.value)) * PSI;
      sl.value = Math.min(1, s.pb / s.p0);
      bump();
    });
    sl.addEventListener('input', (e) => {
      s.pb = Number(e.target.value) * s.p0;
      num.value = (s.pb / PSI).toFixed(1);
      bump();
    });
  },
  init(ctx) {
    return { pid: new PidView(ctx.scene), built: '' };
  },
  enter(ctx, h) {
    h.pid.setVisible(true);
  },
  exit(ctx, h) {
    h.pid.setVisible(false);
  },
  view: { x: 0, y: 0.2, z: 10 },
  recompute(s, computed) {
    computed.orifice = compute(s);
  },
  syncViews(s, computed, ctx, h) {
    const c = computed.orifice;
    const net = {
      nodes: [
        { id: 'up', kind: 'ambient', p: s.p0, T: s.T0, Y: { N2: 1 }, label: 'manifold (held)' },
        { id: 'down', kind: 'ambient', p: s.pb, T: s.T0, Y: { N2: 1 }, label: 'back pressure' },
      ],
      edges: [{ id: 'INJ-OX-01', type: 'orifice', a: 'up', b: 'down', CdA: s.CdA }],
    };
    const key = `${s.gas}`;
    if (h.built !== key) {
      h.pid.build({ net, layout: { nodes: { up: [-2.4, 0], down: [2.4, 0] } }, sensors: [] }, { circuitColor: s.gas === 'CH4' ? Q.fuel : s.gas === 'N2' ? Q.n2 : Q.ox });
      h.built = key;
    }
    h.pid.pMax = s.p0;
    h.pid.pAmb = Math.min(s.pb, 101325);
    c.readout = { nodes: { up: { p: s.p0 }, down: { p: s.pb } }, edges: { 'INJ-OX-01': { mdot: c.f.mdot, choked: c.f.choked, margin: c.f.margin } } };
    h.pid.update(c.readout, 1 / 60, fmtP);
    computed.orifice.indicator = h.pid.chokeStates()['INJ-OX-01'];
  },
  law: () => ['\\mdot_{\\text{choked}} = C_dA\\,p_0\\sqrt{\\dfrac{\\gamma}{RT_0}}\\left(\\dfrac{2}{\\gamma+1}\\right)^{\\frac{\\gamma+1}{2(\\gamma-1)}}', 'r^* = \\left(\\dfrac{2}{\\gamma+1}\\right)^{\\frac{\\gamma}{\\gamma-1}}'],
  liveRows: (s, computed) => {
    const c = computed.orifice;
    return [
      kv('$p_0/p$', sig(c.f.margin, 4)),
      kv('critical $p_0/p$', sig(1 / c.rStar, 4)),
      kv('$\\gamma$', sig(c.up.gamma, 4)),
      kv('$\\mdot$', fmtMdot(c.f.mdot)),
      kv('$\\mdot$ if choked', fmtMdot(c.mChoked)),
    ].join('');
  },
  readout: (s, computed) => {
    const c = computed.orifice;
    const word = { green: 'choked, margin ≥ 2.2', amber: 'choked, margin < 2.2', red: 'NOT choked' }[c.cat];
    return cells([
      ['$\\mdot$', fmtMdot(c.f.mdot)],
      ['$p_0/p$', sig(c.f.margin, 4)],
      ['choke', `<span class="choke ${c.cat}">${word}</span>`],
      ['$p_0$ → $p$', `${fmtP(s.p0)} → ${fmtP(s.pb)}`],
    ]);
  },
  coach: (s, computed) => {
    const c = computed.orifice;
    const room = s.p0 - s.pb / c.rStar;
    return {
      title: c.f.choked ? 'Choked: the chamber cannot talk back' : 'Subsonic: back pressure sets the flow',
      body: [
        c.f.choked
          ? `Below $r^* = ${sig(c.rStar, 4)}$ the throat of the orifice is sonic, so pressure changes downstream cannot travel upstream. Flow depends only on $p_0$ and $T_0$. That is the decoupling R-8 relies on.`
          : 'Above the critical ratio the flow depends on the back pressure too, and a chamber pressure wobble reaches the feed system.',
        eq('\\text{margin} = \\dfrac{p_0}{p}\\quad \\text{green} \\ge 2.2'),
        c.f.choked ? `Here the upstream pressure can fall ${fmtP(Math.max(0, room)).replace(' psia', ' psi')} before the orifice un-chokes.` : 'Raise $p_0$ or lower the back pressure to choke it.',
      ],
    };
  },
  predict: (s, computed) => {
    const c = computed.orifice;
    const pb2 = 2 * s.pb;
    const up = c.up;
    const f2 = orificeFlow(s.CdA, up, { ...up, p: pb2 });
    const ratio = f2.mdot / c.f.mdot;
    const ans = f2.mdot < 0 ? 3 : Math.abs(ratio - 1) < 1e-6 ? 0 : ratio < 1 ? 1 : 2;
    return [
      {
        id: `or-double-${Math.round(s.pb)}-${Math.round(s.p0)}-${s.gas}`,
        q: `Double the back pressure, ${fmtP(s.pb)} → ${fmtP(pb2)}. What happens to $\\mdot$?`,
        options: ['Unchanged', 'It falls', 'It rises', 'It reverses'],
        answer: ans,
        why: ans === 0 ? 'Still choked at the new back pressure, so the flow cannot feel it: the same $\\mdot$ until the ratio crosses $r^*$.' : ans === 3 ? 'The back pressure is now above $p_0$: flow runs backwards.' : `The orifice ${c.f.choked ? 'un-chokes' : 'is subsonic'}, so $\\mdot$ goes from ${fmtMdot(c.f.mdot)} to ${fmtMdot(f2.mdot)}.`,
      },
    ];
  },
  plot: (s, computed) => {
    const c = computed.orifice;
    return {
      series: [{ xs: c.rs, ys: c.curve.map((m) => m * 1e3), color: s.gas === 'CH4' ? '#f0ac5f' : s.gas === 'N2' ? '#8fa88a' : '#58c4dd', label: `${GASES[s.gas]} through C_dA` }],
      vlines: [
        { x: c.rStar, color: '#fc6255', label: 'r*' },
        { x: 1 / GREEN, color: '#83c167', label: '1/2.2' },
      ],
      marker: { x: Math.min(1, s.pb / s.p0), y: Math.max(0, c.f.mdot) * 1e3, color: '#ece6e2' },
      xLabel: 'p / p₀',
      yLabel: 'ṁ (g/s)',
      xMin: 0,
      xMax: 1,
      yMin: 0,
      xFmt: (v) => sig(v, 2),
      yFmt: (v) => sig(v, 3),
    };
  },
});
