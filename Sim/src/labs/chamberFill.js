import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells, eq } from '../ui/shared.js';
import { fmtP, fmtF, fmtTime, fmtE, fmtGrams, sig, unitSystem } from '../ui/format.js';
import { simulate } from '../physics/simulate.js';
import { ceaLookup, vandenkerckhove } from '../physics/cea.js';
import { PSI } from '../physics/constants.js';
import { components } from '../data/components.js';
import { chamberFill } from '../data/chamberFill.js';

/**
 * Chamber fill (brief §6.1, lab 6): a step inflow from both injector circuits into the 45 cm³
 * chamber, the τ_c response, and ignition against no-light.
 *
 * The reservoirs hold the manifold pressure fixed, so what you see is the chamber, not the feed
 * system. Main valves open instantly at t = 0 (or the fuel valve leads or lags the ox valve). The
 * igniter is on from t = 0 unless it is off or has the no-light fault; the chamber lights when its
 * gas becomes flammable. Uncalibrated: η_c* is PROJECT_PLAN's assumption and C_d the one
 * uncalibrated injector value.
 */
const T_END = 0.03;
const IGN = { on: 'on', off: 'off', 'no-light': 'no-light fault' };

function defaults() {
  const c = components();
  return { igniter: 'on', pUp: c['PCV-OX-01'].pSet, eta: c.chamber.etaCstar, leadMs: 0 };
}

function compute(s) {
  const f = chamberFill({ pUp: s.pUp, eta: s.eta, igniter: s.igniter, lead: s.leadMs / 1000 });
  const r = simulate(f.net, { gas: f.gas, tEnd: T_END, schedule: f.schedule, sampleDt: 5e-5 });
  const fin = r.final.chambers.chamber;
  const ign = r.events.find((e) => e.what === 'ignition') || null;
  let tauC = null;
  if (fin.burning) {
    const c = components();
    const At = c['THROAT-01'].Cd * (Math.PI / 4) * c['THROAT-01'].d ** 2;
    const t = ceaLookup(fin.OF, fin.p);
    const G = vandenkerckhove(t.gamma);
    tauC = c.chamber.V / At / (s.eta * t.cstar * G * G);
  }
  return { r, fin, ign, tauC, net: f.net };
}
const keyOf = (s) => JSON.stringify([s.igniter, s.pUp, s.eta, s.leadMs]);

export default defineLab({
  id: 'chamber-fill',
  title: 'Chamber fill',
  status: 'uncalibrated',
  hint: 'Step inflow into the chamber. Switch the igniter off or give it the no-light fault; lead the fuel valve; change η_c*.',
  defaultState: defaults,
  controls: (s) => `
    <h3>Chamber fill</h3>
    <label>Igniter IGN-IG-01 <select id="cf-ign">${Object.entries(IGN).map(([k, v]) => `<option value="${k}"${s.igniter === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Manifold pressure (psia) <input id="cf-p" type="number" min="100" max="900" step="10" value="${(s.pUp / PSI).toFixed(0)}"></label>
    <label>Fuel valve lead (ms, − lags) <input id="cf-lead" type="number" min="-50" max="50" step="5" value="${s.leadMs}"></label>
    <label>η_c* <input id="cf-eta" type="number" min="0.8" max="1" step="0.01" value="${s.eta}"></label>
    <p class="note">480 psia manifold (PROJECT_PLAN §2.3) held fixed; valves open instantly. η_c* 0.92 is PROJECT_PLAN §2.1's assumption. Injector C_d uncalibrated; lines and valve C_v are placeholders (issue #6).</p>`,
  bind({ state: s, bump, root }) {
    const on = (id, f) => root.querySelector(id).addEventListener('input', (e) => (f(e.target.value), bump()));
    on('#cf-ign', (v) => (s.igniter = v));
    on('#cf-p', (v) => (s.pUp = Math.min(900, Math.max(100, Number(v) || 480)) * PSI));
    on('#cf-lead', (v) => (s.leadMs = Math.max(-50, Math.min(50, Number(v) || 0))));
    on('#cf-eta', (v) => (s.eta = Math.max(0.8, Math.min(1, Number(v) || 0.92))));
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
  view: { x: -0.2, y: 0.3, z: 15.5 },
  recompute(s, computed) {
    const key = keyOf(s);
    if (!computed.chamberFill || computed.chamberFill.key !== key) {
      try {
        computed.chamberFill = { key, ...compute(s), error: null };
      } catch (e) {
        computed.chamberFill = { key, error: String(e.message || e) };
      }
    }
    // The id is hyphenated, so the page's readiness check (computed[id]) cannot use the dotted name.
    computed['chamber-fill'] = computed.chamberFill;
  },
  syncViews(s, computed, ctx, h) {
    const c = computed.chamberFill;
    if (c.error) return;
    if (h.built !== 'x') {
      h.pid.build(
        {
          net: c.net,
          layout: {
            nodes: { 'ox-res': [-4.2, 1.7], 'ox-line': [-1.3, 1.7], 'fu-res': [-4.2, -0.8], 'fu-line': [-1.3, -0.8], chamber: [1.9, 0.45] },
            vents: { 'THROAT-01': [4.3, 0.45] },
            igniters: { 'IGN-IG-01': [3.0, -0.95] },
          },
          sensors: [{ tag: 'PT-CH-01', node: 'chamber', offset: [0.2, 1.3] }],
        },
        { circuitColor: Q.ox },
      );
      h.built = 'x';
    }
    h.pid.pMax = s.pUp;
    h.pid.update(c.r.final, 1 / 60, fmtP, fmtF);
    computed.chamberFill.burning = c.fin.burning;
    computed.chamberFill.F = c.fin.F;
    computed.chamberFill.pc = c.fin.p;
  },
  law: () => ['\\tau_c = \\dfrac{L^* c^*}{R T_c} = \\dfrac{L^*}{c^*\\,\\Gamma^2},\\quad L^* = V_c/A_t', '\\dot m_{\\text{noz}} = \\dfrac{P_c A_t}{c^*},\\quad c^* = \\eta_{c^*}\\,c^*_{\\text{CEA}}(O/F, P_c)'],
  liveRows: (s, computed) => {
    const c = computed.chamberFill;
    if (c.error) return kv('error', c.error);
    const rows = [kv('igniter', IGN[s.igniter])];
    if (c.ign) {
      rows.push(kv('ignition at', fmtTime(c.ign.t)));
      rows.push(kv('unburned at ignition', `${fmtGrams(c.ign.unburnedMass)}, ${fmtE(c.ign.unburnedEnergy)}`));
      rows.push(kv('pressure jump', `${fmtP(c.ign.pBefore)} → ${fmtP(c.ign.pAfter)}`));
    } else {
      rows.push(kv('ignition', 'none'));
    }
    rows.push(kv(`$P_c$ at ${fmtTime(T_END)}`, fmtP(c.fin.p)));
    if (c.fin.burning) {
      rows.push(kv('O/F', sig(c.fin.OF, 4)));
      rows.push(kv('$\\tau_c$', fmtTime(c.tauC)));
      rows.push(kv('$F$', fmtF(c.fin.F)));
      rows.push(kv('$I_{sp}$', `${sig(c.fin.Isp, 4)} s`));
    } else {
      rows.push(kv('unburned in chamber', `${fmtGrams(c.fin.unburnedMass)}, ${fmtE(c.fin.unburnedEnergy)}`));
    }
    return rows.join('');
  },
  readout: (s, computed) => {
    const c = computed.chamberFill;
    if (c.error) return cells([['error', c.error]]);
    return cells([
      ['$P_c$', fmtP(c.fin.p)],
      ['$\\tau_c$', c.tauC ? fmtTime(c.tauC) : '—'],
      ['unburned at ignition', c.ign ? fmtE(c.ign.unburnedEnergy) : 'no ignition'],
      ['$F$', fmtF(c.fin.F)],
    ]);
  },
  coach: (s, computed) => {
    const c = computed.chamberFill;
    if (c.error) return { title: 'Cannot run this case', body: [c.error] };
    const body = [
      'The chamber is a 45 cm³ control volume. Before ignition it fills with cold O₂ and CH₄ like any volume. When the igniter is on and the gas is inside the flammability limits (5.1–61% CH₄ in O₂, at least 12% O₂; Zabetakis 1965), everything unburned burns at once and the pressure jumps: that energy is the hard-start measure.',
      'Burning, the state comes from the CEA table at the chamber\'s O/F and P_c, with c* = η_c* c*_CEA. The throat passes P_c A_t / c*, so the pressure relaxes to the steady value with the time constant τ_c:',
      eq('\\tau_c = \\dfrac{L^*}{c^*\\,\\Gamma^2}'),
      c.tauC ? `Here τ_c = ${fmtTime(c.tauC)}. The dashed curve is how fast the chamber alone would settle from the ignition jump. The real rise is slower: each 5 cm³ line starts full of N₂ at ambient, as after a purge, and until propellant has displaced it the injectors pass nitrogen too. The chamber follows its feed, and on the stand the valves take tens of milliseconds more: valve timing and line fill, not chamber physics, set the startup. (V-7 checks τ_c against a small step on a settled chamber, to 0.5%.)` : '',
      s.igniter !== 'on' ? `With the igniter ${IGN[s.igniter]}, nothing lights: the chamber holds ${fmtGrams(c.fin.unburnedMass)} of propellant (${fmtE(c.fin.unburnedEnergy)}) at ${fmtP(c.fin.p)} and keeps venting it through the throat.` : '',
    ];
    return { title: 'Chamber fill, τ_c and ignition', body };
  },
  predict: (s, computed) => {
    const c = computed.chamberFill;
    if (c.error || s.igniter !== 'on' || s.leadMs !== 0) return [];
    if (!c.alt) {
      c.alt = {
        lead: compute({ ...s, leadMs: 10 }),
        eta: compute({ ...s, eta: Math.min(1, s.eta + 0.05) }),
      };
    }
    const e0 = c.ign?.unburnedEnergy ?? 0;
    const e1 = c.alt.lead.ign?.unburnedEnergy ?? 0;
    const rel = e0 > 0 ? e1 / e0 - 1 : 0;
    const p0 = c.fin.p;
    const p1 = c.alt.eta.fin.p;
    return [
      {
        id: `cf-lead-${s.pUp}-${s.eta}`,
        q: 'Open the fuel valve 10 ms before the ox valve. The unburned energy at ignition, compared with opening both together:',
        options: ['larger', 'about the same (±10%)', 'smaller'],
        answer: rel > 0.1 ? 0 : rel < -0.1 ? 2 : 1,
        why: `${fmtE(e0)} together, ${fmtE(e1)} with a 10 ms fuel lead. Methane alone in the chamber is above the 61% upper limit; nothing lights until enough oxygen arrives, and by then the chamber holds more of both.`,
      },
      {
        id: `cf-eta-${s.pUp}-${s.eta}`,
        q: `Raise η_c* from ${s.eta} to ${sig(Math.min(1, s.eta + 0.05), 3)} with the same manifold pressure. What does P_c do?`,
        options: ['rises', 'stays the same', 'falls'],
        answer: p1 > p0 * 1.002 ? 0 : p1 < p0 * 0.998 ? 2 : 1,
        why: `${fmtP(p0)} → ${fmtP(p1)}. At a fixed flow P_c = ṁ c*/A_t rises with c*, and the GOX choke margin p₀/P_c shrinks with it: the S-3 issue.`,
      },
    ];
  },
  plot: (s, computed) => {
    const c = computed.chamberFill;
    if (c.error) return null;
    const [u, f] = unitSystem() === 'us' ? ['psia', PSI] : ['MPa', 1e6];
    const ts = c.r.t.map((t) => t * 1e3);
    const series = [{ xs: ts, ys: c.r.samples.map((x) => x.chambers.chamber.p / f), color: '#fc6255', label: 'P_c' }];
    if (c.ign && c.tauC) {
      // τ_c overlay: the relaxation from the ignition jump to the final P_c, exponential in τ_c.
      const xs = [];
      const ys = [];
      for (let k = 0; k <= 60; k++) {
        const t = c.ign.t + (k / 60) * (T_END - c.ign.t);
        xs.push(t * 1e3);
        ys.push((c.fin.p + (c.ign.pAfter - c.fin.p) * Math.exp(-(t - c.ign.t) / c.tauC)) / f);
      }
      series.push({ xs, ys, color: '#ece6e2', dash: [4, 3], label: 'chamber alone (τ_c)' });
    }
    return {
      series,
      vlines: c.ign ? [{ x: c.ign.t * 1e3, color: '#f0ac5f', label: 'ignition' }] : [],
      xLabel: 't (ms)',
      yLabel: `P_c (${u})`,
      yMin: 0,
      xFmt: (v) => sig(v, 3),
      yFmt: (v) => sig(v, 3),
    };
  },
});
