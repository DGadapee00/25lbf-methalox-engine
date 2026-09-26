import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells, eq } from '../ui/shared.js';
import { fmtP, fmtMdot, fmtTime, sig, unitSystem } from '../ui/format.js';
import { simulate } from '../physics/simulate.js';
import { failsOpenPeaks } from '../physics/analysis.js';
import { nasa7Gas } from '../physics/gas.js';
import { reliefCdAForFailOpen } from '../physics/network.js';
import { stateFromPTY, massFractions } from '../physics/gas.js';
import { cvToCdA } from '../physics/elements/orifice.js';
import { PSI, P_ATM } from '../physics/constants.js';
import { components, injectorCdA } from '../data/components.js';

/**
 * Regulator (brief §6.1, lab 3): droop, lockup, and fails-open, on the stand's regulator and
 * relief defaults (placeholders, issue #6) feeding the GN₂ injector.
 *
 * Cases:
 *   flowing    outlet open: the manifold settles at p_set (the flowing pressure at rated flow)
 *   lockup     outlet shut at t = 0.1 s: pressure rises toward lockup = p_set + droop. With a
 *              small manifold the first-order poppet traps pressure above lockup: a model
 *              limitation (solver.md §5), labelled as such
 *   fails open regulator fails open at t = 0.1 s, outlet shut: the relief lifts and holds the
 *              manifold; the peak on the way is the "peak manifold pressure" readout
 */
const CASES = {
  flowing: 'Flowing (outlet open)',
  lockup: 'Lockup (outlet shut at 0.1 s)',
  failsopen: 'Fails open (outlet shut, at 0.1 s)',
};
const circle = (d) => (Math.PI / 4) * d * d;

function defaults() {
  const c = components();
  return {
    case: 'flowing',
    pSet: c['PCV-OX-01'].pSet,
    droop: c['PCV-OX-01'].droop,
    tau: c['PCV-OX-01'].tau,
    Vman: c.manifold.V,
    pSupply: c.bottle.p0,
    pBack: P_ATM,
  };
}

function network(s) {
  const c = components();
  const gas = nasa7Gas(['O2', 'CH4', 'N2']);
  const T = c.ambient.T;
  const regCdA = cvToCdA(c['PCV-OX-01'].Cv);
  const psv = c['PSV-OX-01'];
  const supply = stateFromPTY(gas, s.pSupply, T, massFractions(gas, { N2: 1 }));
  const reliefCdA = psv.sizingMargin * reliefCdAForFailOpen(regCdA, supply, psv.set, P_ATM, psv.accumulation);
  const shutAt0 = s.case !== 'flowing';
  const net = {
    nodes: [
      { id: 'bottle', kind: 'volume', V: c.bottle.V, p: s.pSupply, T, Y: { N2: 1 }, label: 'GN₂ bottle' },
      { id: 'manifold', kind: 'volume', V: s.Vman, p: s.pSet, T, Y: { N2: 1 }, label: 'manifold' },
      { id: 'amb', kind: 'ambient', p: P_ATM, T, Y: { N2: 0.767, O2: 0.233 } },
      { id: 'back', kind: 'ambient', p: s.pBack, T, Y: { N2: 1 }, label: 'back pressure' },
    ],
    edges: [
      { id: 'PCV-OX-01', type: 'regulator', a: 'bottle', b: 'manifold', CdAmax: regCdA, pSet: s.pSet, mdotRated: c['PCV-OX-01'].mdotRated, droop: s.droop, tau: s.tau, z0: 0 },
      { id: 'PSV-OX-01', type: 'relief', a: 'manifold', b: 'amb', CdA: reliefCdA, set: psv.set, blowdown: psv.blowdown, accumulation: psv.accumulation, tauLift: psv.tauLift },
      { id: 'SV-OX-01', type: 'valve', a: 'manifold', b: 'back', CdAmax: injectorCdA(c, 'INJ-OX-01'), tOpen: 0, tClose: 0, x0: 1 },
    ],
  };
  const schedule = [];
  if (shutAt0) schedule.push({ t: 0.1, id: 'SV-OX-01', cmd: 'close' });
  if (s.case === 'failsopen') schedule.push({ t: 0.1, id: 'PCV-OX-01', cmd: { fault: 'open' } });
  return { net, gas, schedule, psv };
}

function compute(s) {
  const { net, gas, schedule, psv } = network(s);
  const r = simulate(net, { gas, tEnd: 0.6, schedule, sampleDt: 0.002, trackPeaks: true });
  const pLockup = s.pSet + s.droop;
  const pFull = P_ATM + psv.set * (1 + psv.accumulation);
  const pCrack = P_ATM + psv.set;
  const fo = failsOpenPeaks(network({ ...s, case: 'failsopen' }).net, gas, { tEnd: 0.3 })[0];
  return { r, pLockup, pFull, pCrack, peak: r.peaks.manifold, fo, psv };
}
const keyOf = (s) => JSON.stringify([s.case, s.pSet, s.droop, s.tau, s.Vman, s.pSupply, s.pBack]);

export default defineLab({
  id: 'regulator',
  title: 'Regulator',
  status: 'uncalibrated',
  hint: 'Pick a case. p_set is the flowing pressure at rated flow; lockup = p_set + droop.',
  defaultState: defaults,
  controls: (s) => `
    <h3>Regulator PCV-OX-01</h3>
    <label>Case <select id="rg-case">${Object.entries(CASES)
      .map(([k, v]) => `<option value="${k}"${s.case === k ? ' selected' : ''}>${v}</option>`)
      .join('')}</select></label>
    <label>Set point p_set (psia) <input id="rg-pset" type="number" min="100" max="900" step="5" value="${(s.pSet / PSI).toFixed(0)}"></label>
    <label>Droop (psi) <input id="rg-droop" type="number" min="1" max="100" step="1" value="${(s.droop / PSI).toFixed(0)}"></label>
    <label>Poppet lag τ (ms) <input id="rg-tau" type="number" min="1" max="200" step="1" value="${(s.tau * 1e3).toFixed(0)}"></label>
    <label>Manifold volume (cm³) <input id="rg-V" type="number" min="2" max="2000" step="1" value="${(s.Vman * 1e6).toFixed(0)}"></label>
    <p class="note">Regulator droop, lag, C_v and the relief are placeholders (issue #6). Rated flow 38.8 g/s (PROJECT_PLAN §2.2) through the GOX injector area, on GN₂.</p>`,
  bind({ state: s, bump, root }) {
    const on = (id, f) => root.querySelector(id).addEventListener('input', (e) => (f(e.target.value), bump()));
    on('#rg-case', (v) => (s.case = v));
    on('#rg-pset', (v) => (s.pSet = Math.max(100, Number(v)) * PSI));
    on('#rg-droop', (v) => (s.droop = Math.max(1, Number(v)) * PSI));
    on('#rg-tau', (v) => (s.tau = Math.max(1, Number(v)) * 1e-3));
    on('#rg-V', (v) => (s.Vman = Math.max(2, Number(v)) * 1e-6));
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
  view: { x: -0.2, y: -0.6, z: 13.5 },
  recompute(s, computed) {
    const key = keyOf(s);
    if (!computed.regulator || computed.regulator.key !== key) {
      try {
        computed.regulator = { key, ...compute(s), error: null };
      } catch (e) {
        computed.regulator = { key, error: String(e.message || e) };
      }
    }
  },
  syncViews(s, computed, ctx, h) {
    const c = computed.regulator;
    if (c.error) return;
    if (h.built !== 'x') {
      h.pid.build(
        {
          net: network(s).net,
          layout: { nodes: { bottle: [-3.9, 0], manifold: [-0.6, 0], back: [3.1, 0] }, vents: { 'PSV-OX-01': [-0.6, 2.3] } },
          sensors: [{ tag: 'PT-OX-02', node: 'manifold', offset: [1.1, 1.3] }],
        },
        { circuitColor: Q.n2 },
      );
      h.built = 'x';
    }
    h.pid.pMax = s.pSupply;
    h.pid.update(c.r.final, 1 / 60, fmtP);
  },
  law: () => ['p_{\\text{lockup}} = p_{\\text{set}} + \\Delta p_{\\text{droop}}', 'z_{\\text{cmd}} = K\\,(p_{\\text{lockup}} - p_{\\text{out}}),\\quad \\tau\\dot z = z_{\\text{cmd}} - z'],
  liveRows: (s, computed) => {
    const c = computed.regulator;
    if (c.error) return kv('error', c.error);
    const f = c.r.final;
    return [
      kv('$p_{\\text{manifold}}$', fmtP(f.nodes.manifold.p)),
      kv('$p_{\\text{set}}$', fmtP(s.pSet)),
      kv('$p_{\\text{lockup}}$', fmtP(c.pLockup)),
      kv('regulator $\\mdot$', fmtMdot(f.edges['PCV-OX-01'].mdot)),
      kv('relief lift', sig(f.edges['PSV-OX-01'].lift, 3)),
    ].join('');
  },
  readout: (s, computed) => {
    const c = computed.regulator;
    if (c.error) return cells([['error', c.error]]);
    return cells([
      ['final $p$', fmtP(c.r.final.nodes.manifold.p)],
      ['peak $p$ (this case)', fmtP(c.peak.p)],
      ['peak if PCV fails open', `${fmtP(c.fo.peak)} <small class="caveat">depends on τ_lift, τ</small>`],
      ['relief full lift', fmtP(c.pFull)],
    ]);
  },
  coach: (s, computed) => {
    const c = computed.regulator;
    if (c.error) return { title: 'Cannot build this network', body: [c.error] };
    const trapped = s.case === 'lockup' && c.r.final.nodes.manifold.p > c.pLockup * 1.01;
    const body = {
      flowing: [
        'Passing rated flow, the regulator holds $p_{\\text{set}}$: that is what the set point means here (the convention changed 2026-09-26). With less flow it rises toward lockup; with more it droops below.',
        eq('\\Delta p_{\\text{droop}} = p_{\\text{lockup}} - p_{\\text{set}}'),
      ],
      lockup: [
        'With the outlet shut the poppet closes, and pressure rises toward lockup.',
        trapped
          ? `<b>Model limitation, not a finding:</b> on this ${sig(s.Vman * 1e6, 3)} cm³ manifold the first-order poppet lags the fill and traps ${fmtP(c.r.final.nodes.manifold.p)}, above the ${fmtP(c.pLockup)} lockup. A real regulator's seat and spring close it differently; its poppet lag is a datasheet value once one is selected. Try a larger manifold or a shorter lag.`
          : 'Here the fill is slow enough compared with the poppet lag that it creeps up to lockup from below.',
      ],
      failsopen: [
        'Failed open, the regulator passes its full-open flow into a dead-headed manifold. The relief lifts, from zero at its set pressure to full at set + 10%, and holds the manifold.',
        `The peak on the way (${fmtP(c.peak.p)}) is what the manifold's transducers, valves and fittings see: their ratings and the MEOP must cover it, not only the relief set. It depends on the relief's lift time and the poppet lag, both placeholders, so treat it as a scale, not a design value.`,
      ],
    }[s.case];
    return { title: CASES[s.case], body };
  },
  predict: (s, computed) => {
    const c = computed.regulator;
    if (c.error || s.case !== 'flowing') return [];
    if (!c.twice) c.twice = compute({ ...s, droop: 2 * s.droop });
    const p1 = c.r.final.nodes.manifold.p;
    const p2 = c.twice.r.final.nodes.manifold.p;
    const moved = Math.abs(p2 - p1) / s.pSet;
    return [
      {
        id: `rg-droop-${Math.round(s.droop)}`,
        q: `Double the regulator's droop (${fmtP(s.droop).replace('psia', 'psi')} → ${fmtP(2 * s.droop).replace('psia', 'psi')}). What happens to the flowing manifold pressure?`,
        options: ['Unchanged (±1%)', 'It falls by about the extra droop', 'It rises'],
        answer: moved < 0.01 ? 0 : p2 < p1 ? 1 : 2,
        why: `Flowing: ${fmtP(p1)} → ${fmtP(p2)}. p_set is the flowing pressure at rated flow, so near rated flow the manifold stays put and lockup moves instead (${fmtP(c.pLockup)} → ${fmtP(c.pLockup + s.droop)}).`,
      },
    ];
  },
  plot: (s, computed) => {
    const c = computed.regulator;
    if (c.error) return null;
    const [u, f] = unitSystem() === 'us' ? ['psia', PSI] : ['MPa', 1e6];
    return {
      series: [{ xs: c.r.t, ys: c.r.samples.map((x) => x.nodes.manifold.p / f), color: '#8fa88a', label: 'manifold' }],
      hlines: [
        { y: s.pSet / f, color: '#ece6e2', label: 'p_set' },
        { y: c.pLockup / f, color: '#9a9591', label: 'lockup' },
        { y: c.pCrack / f, color: '#f0ac5f', label: 'relief set' },
        { y: c.pFull / f, color: '#fc6255', label: 'full lift' },
      ],
      xLabel: 't (s)',
      yLabel: `p (${u})`,
      xFmt: (v) => sig(v, 2),
      yFmt: (v) => sig(v, 3),
    };
  },
});
