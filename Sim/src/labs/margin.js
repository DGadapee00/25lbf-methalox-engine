import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells, eq } from '../ui/shared.js';
import { fmtP, fmtMdot, fmtF, sig } from '../ui/format.js';
import { PSI } from '../physics/constants.js';
import { criticalRatio } from '../physics/elements/orifice.js';
import { components } from '../data/components.js';

/**
 * Choke margin (S-3, brief §8): the GOX and GCH₄ injector margins p₀/P_c at a steady burn, against
 * manifold pressure, for a chosen η_c*, with the holes as drawn and with the holes scaled to keep
 * PROJECT_PLAN's flow at every manifold pressure. The engine is the chamber-fill network
 * (physics/sweep.js), run in the test worker so the page stays live.
 *
 * It informs S-3; it does not decide it. The margin target and the fix are an ADR.
 */
const PRESSURES = [400, 450, 480, 520, 560, 600, 650, 700];
const GREEN = 2.2;

function defaults() {
  const c = components();
  return { eta: c.chamber.etaCstar, pUpPsia: 480, scaled: false };
}

let worker = null;
let seq = 0;
function sweep(points) {
  if (!worker) worker = new Worker(new URL('../engine/testWorker.js', import.meta.url), { type: 'module' });
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const on = (ev) => {
      if (ev.data.id !== id) return;
      worker.removeEventListener('message', on);
      if (ev.data.type === 'error') reject(new Error(ev.data.message));
      else resolve(ev.data.rows);
    };
    worker.addEventListener('message', on);
    worker.postMessage({ type: 'sweep', id, points });
  });
}

const keyOf = (s) => JSON.stringify([s.eta, s.pUpPsia, s.scaled]);

export default defineLab({
  id: 'margin',
  title: 'Choke margin (S-3)',
  status: 'uncalibrated',
  hint: 'Move the manifold pressure and η_c*. With the holes as drawn, the margin barely moves: P_c follows the manifold.',
  defaultState: defaults,
  controls: (s) => `
    <h3>Choke margin</h3>
    <label>Manifold pressure (psia) <input id="mg-p" type="range" min="400" max="700" step="10" value="${s.pUpPsia}"> <span id="mg-p-v">${s.pUpPsia} psia</span></label>
    <label>η_c* <input id="mg-eta" type="range" min="0.85" max="1" step="0.01" value="${s.eta}"> <span id="mg-eta-v">${s.eta.toFixed(2)}</span></label>
    <label class="check"><input id="mg-scaled" type="checkbox"${s.scaled ? ' checked' : ''}> Scale the injector holes to keep the 480 psia flow</label>
    <p class="note">Steady burn with both manifolds held at the chosen pressure (chamber-fill network, CEA c*). Holes as drawn: PROJECT_PLAN §2.3. Scaling the holes is a what-if for S-3, not a change to the design. Uncalibrated.</p>`,
  bind({ state: s, bump, root }) {
    const p = root.querySelector('#mg-p');
    const e = root.querySelector('#mg-eta');
    p.addEventListener('input', () => {
      s.pUpPsia = Number(p.value);
      root.querySelector('#mg-p-v').textContent = `${s.pUpPsia} psia`;
      bump();
    });
    e.addEventListener('input', () => {
      s.eta = Number(e.value);
      root.querySelector('#mg-eta-v').textContent = s.eta.toFixed(2);
      bump();
    });
    root.querySelector('#mg-scaled').addEventListener('change', (ev) => ((s.scaled = ev.target.checked), bump()));
  },
  init(ctx) {
    return { pid: new PidView(ctx.scene), built: '', pending: null };
  },
  enter(ctx, h) {
    h.pid.setVisible(true);
  },
  exit(ctx, h) {
    h.pid.setVisible(false);
  },
  view: { x: -0.2, y: 0.45, z: 12.5 },
  tick(dt, s, computed, h) {
    if (h.fresh) {
      h.fresh = false;
      return true;
    }
    return false;
  },
  recompute(s, computed, ctx, h) {
    const key = keyOf(s);
    if (h.pending === key || computed.marginLab?.key === key) return;
    h.pending = key;
    const Cd = components().injector.Cd;
    const scale = (p) => (s.scaled ? { CdOx: (Cd * 480) / p, CdFu: (Cd * 480) / p } : {});
    const pts = PRESSURES.map((p) => ({ pUp: p * PSI, eta: s.eta, ...scale(p) }));
    const drawn = PRESSURES.map((p) => ({ pUp: p * PSI, eta: s.eta }));
    const here = { pUp: s.pUpPsia * PSI, eta: s.eta, ...scale(s.pUpPsia) };
    const up = { pUp: 600 * PSI, eta: s.eta };
    const hotter = { pUp: 480 * PSI, eta: Math.min(1, s.eta + 0.05) };
    sweep([here, ...pts, ...(s.scaled ? drawn : []), up, hotter])
      .then((rows) => {
        if (h.pending !== key) return;
        const n = PRESSURES.length;
        const now = rows[0];
        const line = rows.slice(1, 1 + n);
        const drawnLine = s.scaled ? rows.slice(1 + n, 1 + 2 * n) : line;
        computed.marginLab = { key, now, line, drawnLine, up: rows[rows.length - 2], hotter: rows[rows.length - 1], eta: s.eta, scaled: s.scaled };
        computed.margin = computed.marginLab;
        h.pending = null;
        h.fresh = true;
      })
      .catch((e) => {
        computed.marginLab = { key, error: e.message };
        h.pending = null;
        h.fresh = true;
      });
  },
  syncViews(s, computed, ctx, h) {
    const c = computed.marginLab;
    if (!c?.now) return;
    const n = c.now;
    const pb = n.Pc;
    if (!h.built) {
      h.pid.build({
        net: {
          nodes: [
            { id: 'ox-up', kind: 'ambient', p: n.pUp, T: 293.15, label: 'ox manifold' },
            { id: 'fu-up', kind: 'ambient', p: n.pUp, T: 293.15, label: 'fuel manifold' },
            { id: 'ch', kind: 'ambient', p: pb, T: 293.15, label: 'chamber (burning)' },
          ],
          edges: [
            { id: 'INJ-OX-01', type: 'orifice', a: 'ox-up', b: 'ch' },
            { id: 'INJ-FU-01', type: 'orifice', a: 'fu-up', b: 'ch' },
          ],
        },
        layout: { nodes: { 'ox-up': [-3.2, 2.45], 'fu-up': [-3.2, 0.95], ch: [2.6, 1.7] }, vents: {} },
        sensors: [],
      }, { circuitColor: Q.ox });
      h.built = 'x';
    }
    h.pid.pMax = 700 * PSI;
    h.pid.pAmb = 101325;
    h.pid.update({
      nodes: { 'ox-up': { p: n.pUp }, 'fu-up': { p: n.pUp }, ch: { p: n.Pc } },
      edges: {
        'INJ-OX-01': { mdot: n.mdot * (n.OF / (1 + n.OF)), choked: n.chokedOx, margin: n.marginOx },
        'INJ-FU-01': { mdot: n.mdot / (1 + n.OF), choked: n.chokedFu, margin: n.marginFu },
      },
    }, 1 / 60, fmtP);
    c.choke = h.pid.chokeStates();
  },
  law: () => ['\\dfrac{p_0}{P_c} = \\dfrac{p_0 A_t}{\\dot m\\,c^*}', '\\dot m \\propto C_dA\\,p_0 \\;\\Rightarrow\\; \\dfrac{p_0}{P_c} \\propto \\dfrac{A_t}{C_dA\\,c^*}'],
  liveRows: (s, computed) => {
    const c = computed.marginLab;
    if (!c) return kv('status', 'running the sweep…');
    if (c.error) return kv('error', c.error);
    const n = c.now;
    return [
      kv('manifold', fmtP(n.pUp)),
      kv('$P_c$', fmtP(n.Pc)),
      kv('GOX $p_0/P_c$', `${sig(n.marginOx, 4)} ${n.chokedOx ? '(choked)' : '(not choked)'}`),
      kv('GCH₄ $p_0/P_c$', `${sig(n.marginFu, 4)} ${n.chokedFu ? '(choked)' : '(not choked)'}`),
      kv('$\\mdot$', fmtMdot(n.mdot)),
      kv('O/F', sig(n.OF, 3)),
      kv('$F$', fmtF(n.F)),
      kv('$c^*$', `${sig(n.cstar, 4)} m/s`),
    ].join('');
  },
  readout: (s, computed) => {
    const c = computed.marginLab;
    if (!c?.now) return '';
    const n = c.now;
    const mark = (m, ch) => (!ch ? 'red' : m >= GREEN ? 'green' : 'amber');
    return cells([
      ['GOX margin', `<span class="choke ${mark(n.marginOx, n.chokedOx)}">${sig(n.marginOx, 4)}</span>`],
      ['GCH₄ margin', `<span class="choke ${mark(n.marginFu, n.chokedFu)}">${sig(n.marginFu, 4)}</span>`],
      ['$P_c$', fmtP(n.Pc)],
      ['$F$', fmtF(n.F)],
    ]);
  },
  coach: (s, computed) => {
    const c = computed.marginLab;
    if (!c?.line) return { title: 'Choke margin', body: ['Running the sweep…'] };
    const flat = Math.abs(c.drawnLine[c.drawnLine.length - 1].marginOx / c.drawnLine[0].marginOx - 1);
    const crit = 1 / criticalRatio(1.4);
    return {
      title: 'Why the manifold pressure alone does not fix it',
      body: [
        'Choked, each injector passes flow in proportion to its manifold pressure, and at steady state $P_c = \\dot m\\,c^*/A_t$. So $P_c$ rises with the manifold, and their ratio, the margin, stays put:',
        eq('\\dfrac{p_0}{P_c} \\propto \\dfrac{A_t}{C_dA\\;c^*}'),
        `With the holes as drawn the GOX margin moves ${sig(flat * 100, 2)}% from 400 to 700 psia. It is set by the injector-to-throat area ratio and by c*: a better burn (higher η_c*) means a higher P_c for the same flow, and a smaller margin. O₂ chokes at ${sig(crit, 4)}.`,
        'Scaling the holes down as the manifold goes up keeps the flow, and so P_c, fixed, and then the margin grows with the manifold pressure. That is the "raise the manifold pressure" option in S-3: it is a pair of changes, holes and pressure together.',
        'Which margin is enough (brief §8 suggests 2.2–2.5) and which fix to take are Dalton\'s, as an ADR. The sim informs it.',
      ],
    };
  },
  predict: (s, computed) => {
    const c = computed.marginLab;
    if (!c?.now || s.scaled || s.pUpPsia !== 480) return [];
    const base = c.line[PRESSURES.indexOf(480)];
    const r1 = c.up.marginOx / base.marginOx - 1;
    const r2 = c.hotter.marginOx / base.marginOx - 1;
    return [
      {
        id: `mg-up-${s.eta}`,
        q: 'With the holes as drawn, raise the manifold from 480 to 600 psia. The GOX choke margin:',
        options: ['rises by about 25%', 'stays within 1%', 'falls'],
        answer: r1 > 0.1 ? 0 : Math.abs(r1) <= 0.01 ? 1 : r1 < 0 ? 2 : 0,
        why: `${sig(base.marginOx, 4)} → ${sig(c.up.marginOx, 4)} (${sig(r1 * 100, 2)}%). P_c went from ${fmtP(base.Pc)} to ${fmtP(c.up.Pc)}: it follows the manifold.`,
      },
      {
        id: `mg-eta-${s.eta}`,
        q: `Combustion comes in better than assumed: η_c* ${s.eta.toFixed(2)} → ${Math.min(1, s.eta + 0.05).toFixed(2)}. The GOX margin:`,
        options: ['rises', 'stays the same', 'falls'],
        answer: r2 > 0.002 ? 0 : r2 < -0.002 ? 2 : 1,
        why: `${sig(base.marginOx, 4)} → ${sig(c.hotter.marginOx, 4)}. Higher c* means a higher P_c for the same flow (${fmtP(base.Pc)} → ${fmtP(c.hotter.Pc)}), so less margin: brief §8's warning.`,
      },
    ];
  },
  plot: (s, computed) => {
    const c = computed.marginLab;
    if (!c?.line) return null;
    const series = [{ xs: PRESSURES, ys: c.drawnLine.map((r) => r.marginOx), color: '#58c4dd', label: 'GOX, holes as drawn' }];
    series.push({ xs: PRESSURES, ys: c.drawnLine.map((r) => r.marginFu), color: '#f0ac5f', label: 'GCH₄, holes as drawn' });
    if (c.scaled) series.push({ xs: PRESSURES, ys: c.line.map((r) => r.marginOx), color: '#58c4dd', dash: [5, 4], label: 'GOX, holes scaled' });
    return {
      series,
      hlines: [
        { y: 1 / criticalRatio(1.4), color: '#9a9591', label: 'O₂ critical', dash: [2, 3] },
        { y: GREEN, color: '#83c167', label: '2.2', dash: [2, 3] },
      ],
      marker: { x: s.pUpPsia, y: c.now.marginOx, color: '#ece6e2' },
      xLabel: 'manifold pressure (psia)',
      yLabel: 'p₀/P_c',
      xFmt: (v) => sig(v, 3),
      yFmt: (v) => sig(v, 3),
    };
  },
});
