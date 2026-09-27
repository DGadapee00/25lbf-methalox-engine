import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells } from '../ui/shared.js';
import { fmtP, fmtMdot, sig, unitSystem } from '../ui/format.js';
import { injectorStudy, REQUIRED_FU } from '../data/injectorStudy.js';
import { PSI } from '../physics/constants.js';

/**
 * Injector (Phase 5 steps 2–3, predicted here before any water or gas data): both circuits at the
 * one uncalibrated C_d. The orifice lab sweeps one element; this one is the engine's pair, against
 * the flows PROJECT_PLAN §2.2 asks for.
 */
const GREEN = 2.2;

function point(study, back) {
  const src = back === 'cold' ? 'cold' : 'design';
  return { ox: study.ox[src], fu: study.fu[src], pBack: back === 'cold' ? study.coldP : study.pc };
}

export default defineLab({
  id: 'injector',
  title: 'Injector',
  status: 'uncalibrated',
  hint: 'Both circuits share one C_d. Cold chamber flow is the choked value; 250 psia is the hot-fire back pressure.',
  defaultState: () => ({ back: 'design' }),
  controls: (s) => `
    <h3>Injector</h3>
    <label>Back pressure <select id="inj-back">
      <option value="design"${s.back === 'design' ? ' selected' : ''}>P_c = 250 psia (design)</option>
      <option value="cold"${s.back === 'cold' ? ' selected' : ''}>cold chamber (ambient)</option>
    </select></label>
    <p class="note">C_d ${injectorStudy().Cd} from components.json, one value for both circuits, uncalibrated until Phase 5 step 2/3. Geometry is PROJECT_PLAN §2.3.</p>`,
  bind({ state: s, bump, root }) {
    root.querySelector('#inj-back').addEventListener('input', (e) => {
      s.back = e.target.value;
      bump();
    });
  },
  init(ctx) {
    const pid = new PidView(ctx.scene);
    pid.setVisible(false);
    return { pid, built: '' };
  },
  enter(ctx, h) {
    h.pid.setVisible(true);
  },
  exit(ctx, h) {
    h.pid.setVisible(false);
  },
  view: { x: -0.2, y: 0.45, z: 12.5 },
  recompute(s, computed) {
    const study = injectorStudy();
    computed.injector = { study, now: point(study, s.back) };
  },
  syncViews(s, computed, ctx, h) {
    const { study, now } = computed.injector;
    const key = s.back;
    if (h.built !== key) {
      const pb = now.pBack;
      const net = {
        nodes: [
          { id: 'ox-up', kind: 'ambient', p: study.p0, T: study.T, Y: { O2: 1 }, label: 'ox manifold' },
          { id: 'fu-up', kind: 'ambient', p: study.p0, T: study.T, Y: { CH4: 1 }, label: 'fuel manifold' },
          { id: 'ch', kind: 'ambient', p: pb, T: study.T, Y: { N2: 1 }, label: 'chamber' },
        ],
        edges: [
          { id: 'INJ-OX-01', type: 'orifice', a: 'ox-up', b: 'ch', CdA: study.ox.CdA },
          { id: 'INJ-FU-01', type: 'orifice', a: 'fu-up', b: 'ch', CdA: study.fu.CdA },
        ],
      };
      h.pid.build({
        net,
        layout: { nodes: { 'ox-up': [-3.2, 2.45], 'fu-up': [-3.2, 0.95], ch: [2.6, 1.7] }, vents: {} },
        sensors: [],
      }, { circuitColor: Q.ox });
      h.built = key;
    }
    h.pid.pMax = study.p0;
    h.pid.pAmb = Math.min(now.pBack, 101325);
    const readout = {
      nodes: { 'ox-up': { p: study.p0 }, 'fu-up': { p: study.p0 }, ch: { p: now.pBack } },
      edges: {
        'INJ-OX-01': { mdot: now.ox.mdot, choked: now.ox.choked, margin: now.ox.margin },
        'INJ-FU-01': { mdot: now.fu.mdot, choked: now.fu.choked, margin: now.fu.margin },
      },
    };
    h.pid.update(readout, 1 / 60, fmtP);
    computed.injector.readout = readout;
    computed.injector.indicator = h.pid.chokeStates()['INJ-OX-01'];
  },
  law: () => ['\\mdot = C_d A\\, p_0\\sqrt{\\dfrac{\\gamma}{RT_0}}\\left(\\dfrac{2}{\\gamma+1}\\right)^{\\frac{\\gamma+1}{2(\\gamma-1)}} \\;\\text{(choked)}'],
  liveRows: (s, computed) => {
    const { study, now } = computed.injector;
    const rel = (mdot, req) => `${mdot >= req ? '+' : ''}${sig((mdot / req - 1) * 100, 3)}%`;
    return [
      kv('$C_d$', `${study.Cd} uncalibrated`),
      kv('GOX holes', `${study.ox.n} × ⌀${sig(study.ox.d * 1e3, 2)} mm`),
      kv('GCH₄ holes', `${study.fu.n} × ⌀${sig(study.fu.d * 1e3, 2)} mm`),
      kv('GOX $\\mdot$', `${fmtMdot(now.ox.mdot)} (${rel(now.ox.mdot, study.ox.required)} vs 38.8 g/s)`),
      kv('GCH₄ $\\mdot$', `${fmtMdot(now.fu.mdot)} (${rel(now.fu.mdot, study.fu.required)} vs 13.9 g/s)`),
      kv('GOX $p_0/p$', sig(now.ox.margin, 4)),
      kv('GCH₄ $p_0/p$', sig(now.fu.margin, 4)),
    ].join('');
  },
  readout: (s, computed) => {
    const { now } = computed.injector;
    const mark = (m) => (m >= GREEN ? 'green' : now.ox.choked ? 'amber' : 'red');
    return cells([
      ['GOX', `<span class="choke ${mark(now.ox.margin)}">${fmtMdot(now.ox.mdot)}</span>`],
      ['GCH₄', fmtMdot(now.fu.mdot)],
      ['GOX margin', sig(now.ox.margin, 4)],
      ['back pressure', fmtP(now.pBack)],
    ]);
  },
  coach: (s, computed) => {
    const { study } = computed.injector;
    const rel = study.fu.design.mdot / REQUIRED_FU - 1;
    return {
      title: 'One C_d, two circuits',
      body: [
        'INJ-OX-01 is 4 × ⌀1.4 mm and INJ-FU-01 is 4 × ⌀1.0 mm. Both use injector.Cd from components.json. Nothing else in the app has its own injector C_d.',
        `At the 250 psia design point the fuel circuit is ${fmtMdot(study.fu.design.mdot)}, ${sig(Math.abs(rel) * 100, 3)}% ${rel < 0 ? 'under' : 'over'} the 13.9 g/s PROJECT_PLAN asks for. That gap is inside the C_d uncertainty (issue #1). It is not a reason to resize the holes, and it is not a reason to edit C_d.`,
        'Green on the schematic is a choke margin of 2.2 or more. Amber is choked but closer than that. The GOX design point is the amber one.',
      ],
    };
  },
  plot: (s, computed) => {
    const { study, now } = computed.injector;
    const [u, f] = unitSystem() === 'us' ? ['psia', PSI] : ['MPa', 1e6];
    return {
      series: [
        { xs: study.ox.curve.xs.map((p) => p / f), ys: study.ox.curve.ys.map((m) => m * 1e3), color: '#58c4dd', label: 'GOX' },
        { xs: study.fu.curve.xs.map((p) => p / f), ys: study.fu.curve.ys.map((m) => m * 1e3), color: '#f0ac5f', label: 'GCH₄' },
      ],
      vlines: [{ x: now.pBack / f, color: '#fc6255', label: 'back' }],
      hlines: [
        { y: study.ox.required * 1e3, color: '#58c4dd', label: '38.8 g/s', dash: [4, 3] },
        { y: study.fu.required * 1e3, color: '#f0ac5f', label: '13.9 g/s', dash: [4, 3] },
      ],
      xLabel: `back pressure (${u})`,
      yLabel: 'ṁ (g/s)',
      yMin: 0,
      xFmt: (v) => sig(v, 3),
      yFmt: (v) => sig(v, 3),
    };
  },
  predict: (s, computed) => {
    const { study } = computed.injector;
    const rel = study.fu.design.mdot / REQUIRED_FU - 1;
    let fuelAnswer = 2;
    if (Math.abs(rel) < 0.005) fuelAnswer = 2;
    else if (rel < 0 && rel > -0.05) fuelAnswer = 0;
    else fuelAnswer = 1;
    const drop = (study.ox.cold.mdot - study.ox.design.mdot) / study.ox.cold.mdot;
    const oxAnswer = drop < 0.001 ? 0 : 1;
    return [
      {
        id: 'inj-fuel',
        q: 'At $P_c = 250\\,\\mathrm{psia}$, how does the fuel injector flow compare with the 13.9 g/s the plan asks for?',
        options: ['short, by less than 5%', 'high, by about 10%', 'equal to 13.9 g/s'],
        answer: fuelAnswer,
        why: `The model gives ${fmtMdot(study.fu.design.mdot)} (${sig(rel * 100, 3)}%). Issue #1 leaves the holes as drawn.`,
      },
      {
        id: 'inj-ox-back',
        q: 'GOX flow when the chamber rises from ambient to 250 psia:',
        options: ['unchanged — still choked', 'drops — no longer choked', 'rises'],
        answer: oxAnswer,
        why: drop < 0.001
          ? `Both backs are choked, so the flow stays ${fmtMdot(study.ox.design.mdot)}. The margin at 250 psia is ${sig(study.ox.design.margin, 4)}.`
          : `At 250 psia the margin is ${sig(study.ox.design.margin, 4)} and the flow is ${fmtMdot(study.ox.design.mdot)}, against ${fmtMdot(study.ox.cold.mdot)} cold.`,
      },
    ];
  },
});
