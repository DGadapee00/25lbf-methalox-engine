/**
 * Batch sweeps and Monte Carlo (brief §5.5, M6), headless. The engine at steady state is the
 * chamber-fill network (data/chamberFill.js): both injectors fed from fixed manifold pressure into
 * the burning chamber. That isolates the design checks from the placeholder feed system:
 *
 *   gridSweep     every combination of the listed values: e.g. manifold pressure × η_c*, the
 *                 P_c vs manifold pressure vs choke-margin chart that S-3 needs (brief §8)
 *   monteCarlo    n draws of uncertain inputs (injector C_d per circuit, η_c*, manifold pressure,
 *                 gas temperature, fuel lead), seeded, giving thrust, c*, P_c, O/F with their
 *                 spread (DoD-2, DoD-3)
 *
 * Inputs a sweep may vary: pUp (Pa), eta, CdOx, CdFu, Tox, Tfu (K), lead (s). The spreads for a
 * Monte Carlo are the caller's: this module has none of its own, because an uncertainty is a
 * statement about hardware and must come from a datasheet, a measurement or a stated assumption.
 *
 * Outputs per point: Pc (Pa), OF, mdot (kg/s), F (N), Isp (s), cstar (m/s), marginOx and marginFu
 * (injector p₀/p), chokedOx, chokedFu, burning, unburnedAtIgnition (J), all at the end of a run
 * long enough for the lines to flush (T_STEADY).
 */
import { simulate } from './simulate.js';
import { chamberFill } from '../data/chamberFill.js';
import { mulberry32, gaussian } from './sensors.js';

export const T_STEADY = 0.08;
export const INPUTS = ['pUp', 'eta', 'CdOx', 'CdFu', 'Tox', 'Tfu', 'lead'];
export const OUTPUTS = ['Pc', 'OF', 'mdot', 'F', 'Isp', 'cstar', 'marginOx', 'marginFu', 'chokedOx', 'chokedFu', 'burning', 'unburnedAtIgnition'];

/** One steady operating point for inputs x (any of INPUTS). */
export function steadyPoint(x = {}) {
  for (const k of Object.keys(x)) if (!INPUTS.includes(k)) throw new Error(`sweep: unknown input ${k} (${INPUTS.join(', ')})`);
  const f = chamberFill({ ...x });
  const lead = Math.abs(x.lead ?? 0);
  const r = simulate(f.net, { gas: f.gas, tEnd: T_STEADY + lead, schedule: f.schedule, sampleDt: T_STEADY + lead });
  const ch = r.final.chambers.chamber;
  const ox = r.final.edges['INJ-OX-01'];
  const fu = r.final.edges['INJ-FU-01'];
  const ign = r.events.find((e) => e.what === 'ignition');
  return {
    ...x,
    Pc: ch.p,
    OF: ox.mdot / fu.mdot,
    mdot: ox.mdot + fu.mdot,
    F: ch.F,
    Isp: ch.Isp,
    cstar: ch.burning ? ch.cstar : NaN,
    marginOx: ox.margin,
    marginFu: fu.margin,
    chokedOx: ox.choked,
    chokedFu: fu.choked,
    burning: ch.burning,
    unburnedAtIgnition: ign ? ign.unburnedEnergy : NaN,
  };
}

/** axes: { input: [values] }. Every combination, first axis slowest. */
export function gridSweep(axes, base = {}) {
  const keys = Object.keys(axes);
  const rows = [];
  const rec = (i, x) => {
    if (i === keys.length) {
      rows.push(steadyPoint({ ...base, ...x }));
      return;
    }
    for (const v of axes[keys[i]]) rec(i + 1, { ...x, [keys[i]]: v });
  };
  rec(0, {});
  return rows;
}

/**
 * params: { input: { dist: 'normal', mean, sd } | { dist: 'uniform', lo, hi } }; n draws; seed.
 * Returns { rows, stats: { output: { mean, sd, p05, p50, p95 } } } over numeric outputs.
 */
export function monteCarlo({ params, n, seed, base = {} }) {
  if (!(n >= 2) || !Number.isInteger(seed)) throw new Error('monteCarlo: needs n ≥ 2 and an integer seed');
  const u = mulberry32(seed);
  const draw = (p) => {
    if (p.dist === 'normal') return p.mean + p.sd * gaussian(u);
    if (p.dist === 'uniform') return p.lo + (p.hi - p.lo) * u();
    throw new Error(`monteCarlo: unknown distribution ${p.dist}`);
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const x = { ...base };
    for (const [k, p] of Object.entries(params)) x[k] = draw(p);
    rows.push(steadyPoint(x));
  }
  const stats = {};
  for (const k of ['Pc', 'OF', 'mdot', 'F', 'Isp', 'cstar', 'marginOx', 'marginFu']) {
    const v = rows.map((r) => r[k]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) continue;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
    const q = (f) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
    stats[k] = { mean, sd, p05: q(0.05), p50: q(0.5), p95: q(0.95), n: v.length };
  }
  return { rows, stats };
}

/** Rows as CSV: the given columns, SI. */
export function toCsv(rows, columns) {
  const cell = (v) => (typeof v === 'boolean' ? (v ? '1' : '0') : Number.isFinite(v) ? Number(v.toPrecision(10)).toString() : '');
  return `${columns.join(',')}\n${rows.map((r) => columns.map((c) => cell(r[c])).join(',')).join('\n')}\n`;
}
