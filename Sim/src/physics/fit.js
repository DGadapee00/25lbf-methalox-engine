/**
 * C_dA fitting against a DAQ log (brief J-5, M6): find the effective flow areas that make the
 * simulated transducer readings match the measured ones, by nonlinear least squares.
 *
 * The model is the whole stand playing the same table the test played (physics/sequencer.js),
 * read through the same transducer observer as the DAQ file (lag; no quantization, whose staircase
 * would defeat finite differences). Parameters are effective areas: an orifice's C_dA, a valve's
 * or regulator's C_dA,max. They are fitted in ln(C_dA) so they stay positive and the steps are
 * relative.
 *
 *   residual_i = (predicted_i − measured_i) / range_channel       (one per channel per sample)
 *
 * Levenberg–Marquardt with a forward-difference Jacobian (relative step FD_STEP). Each residual
 * evaluation is one simulation of the test, so a fit of p areas costs about (p + 1) runs per
 * iteration. The standard errors come from s²(JᵀJ)⁻¹ at the solution, s² = SSR/(N − p): a
 * statement about the fit's noise, not about model error.
 *
 * Which areas a log can identify depends on which transducers it has: an area that changes no
 * reading has a zero column in J and the fit refuses it (singular JᵀJ).
 */
import { runSequence } from './sequencer.js';
import { createObserver } from './sensors.js';

const FD_STEP = 1e-3;
/**
 * Smallest RMS sensitivity d(reading/range)/d ln(C_dA) an area needs to count as identified: 1e-3,
 * i.e. doubling the area moves the readings by about 0.1% of full scale. Below it the finite
 * difference is the integrator's own tolerance noise (about 2e-4 on the GN₂ stand), not physics.
 */
const MIN_SENSITIVITY = 1e-3;

/** Copy of net with effective areas replaced: { edgeId: m² } (orifice C_dA, valve/regulator C_dA,max). */
export function applyOverrides(net, overrides = {}) {
  const ids = new Set(Object.keys(overrides));
  const edges = net.edges.map((e) => {
    if (!ids.has(e.id)) return e;
    ids.delete(e.id);
    const v = overrides[e.id];
    if (!(v > 0)) throw new Error(`fit: ${e.id} area must be > 0 m²`);
    if (e.type === 'orifice' || e.type === 'check' || e.type === 'relief') return { ...e, CdA: v };
    if (e.type === 'valve' || e.type === 'regulator') return { ...e, CdAmax: v };
    throw new Error(`fit: ${e.id} (${e.type}) has no area to fit`);
  });
  if (ids.size) throw new Error(`fit: no edge ${[...ids].join(', ')} on this stand`);
  return { ...net, edges };
}

/** The effective area a parameter id means on net (m²). */
export function areaOf(net, id) {
  const e = net.edges.find((x) => x.id === id);
  if (!e) throw new Error(`fit: no edge ${id}`);
  return e.type === 'valve' || e.type === 'regulator' ? e.CdAmax : e.CdA;
}

/**
 * Simulated readings for stand playing expanded table seq, with area overrides and faults.
 * Returns { t: [s], values: { tag: [SI] }, report, out }. quantize: false by default (fitting);
 * true reproduces what the DAQ file would hold without noise.
 */
export function predictReadings(stand, seq, { overrides = {}, faults = [], tEnd, quantize = false, seed = null } = {}) {
  const s = { ...stand, net: applyOverrides(stand.net, overrides) };
  const { report, out } = runSequence(s, seq, { faults, tEnd: tEnd ?? seq.tEnd });
  const channels = (stand.sensors || []).map(({ offset, ...ch }) => ch);
  const obs = createObserver(channels, { seed, quantize });
  const t = [];
  const values = Object.fromEntries(channels.map((c) => [c.tag, []]));
  for (const smp of out.samples) {
    const p = {};
    for (const [k, v] of Object.entries(smp.nodes)) p[k] = v.p;
    const F = smp.chambers ? Object.fromEntries(Object.entries(smp.chambers).map(([k, v]) => [k, v.F])) : undefined;
    const r = obs.push({ t: smp.t, p, F });
    t.push(smp.t);
    for (const c of channels) values[c.tag].push(r[c.tag]);
  }
  return { t, values, report, out, channels };
}

/** Linear interpolation of (xs, ys) at x; xs ascending. */
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const w = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + w * (ys[hi] - ys[lo]);
}

/**
 * Residuals of a prediction against measured rows [{ t, values }] for channel tags, inside
 * [tFrom, tTo], normalized by each channel's range. Returns { r, perChannel: { tag: rms (SI) } }.
 */
export function residuals(pred, measured, tags, { tFrom = -Infinity, tTo = Infinity } = {}) {
  const r = [];
  const perChannel = {};
  for (const tag of tags) {
    const ch = pred.channels.find((c) => c.tag === tag);
    if (!ch) throw new Error(`fit: the stand has no channel ${tag}`);
    let ss = 0;
    let n = 0;
    for (const row of measured) {
      if (row.t < tFrom || row.t > tTo) continue;
      const m = row.values[tag];
      if (!Number.isFinite(m)) continue;
      const d = interp(pred.t, pred.values[tag], row.t) - m;
      r.push(d / ch.range);
      ss += d * d;
      n++;
    }
    perChannel[tag] = n ? Math.sqrt(ss / n) : NaN;
  }
  return { r, perChannel };
}

/** Solve A x = b for a small dense SPD-ish matrix by Gaussian elimination with pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function inverse(A) {
  const n = A.length;
  const cols = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const x = solve(A, e);
    if (!x) return null;
    cols.push(x);
  }
  return A.map((_, i) => cols.map((c) => c[i]));
}

/**
 * Fit the areas `params` (edge ids) of `stand` so that table `seq` reproduces `measured`
 * (rows [{ t, values: { tag } }] from parseDaq) on channels `tags`. opts: tFrom, tTo (s, the
 * part of the log to fit), start ({ id: m² }, default the stand's values), maxIter, onIter.
 * Returns { params, start, fitted: { id: m² }, sigmaRel: { id }, ssr0, ssr, iterations, rms0,
 * rms, converged, n }.
 */
export function fitAreas(stand, seq, measured, params, tags, opts = {}) {
  if (!params.length) throw new Error('fit: choose at least one area to fit');
  const maxIter = opts.maxIter ?? 25;
  const start = Object.fromEntries(params.map((id) => [id, opts.start?.[id] ?? areaOf(stand.net, id)]));
  let theta = params.map((id) => Math.log(start[id]));
  const toOverrides = (th) => Object.fromEntries(params.map((id, i) => [id, Math.exp(th[i])]));
  let evals = 0;
  const evalAt = (th) => {
    evals++;
    const pred = predictReadings(stand, seq, { overrides: toOverrides(th), tEnd: opts.tEnd });
    return residuals(pred, measured, tags, opts);
  };
  const ssrOf = (r) => r.reduce((a, x) => a + x * x, 0);
  let cur = evalAt(theta);
  const rms0 = cur.perChannel;
  const ssr0 = ssrOf(cur.r);
  let ssr = ssr0;
  let lambda = 1e-3;
  let J = null;
  let iter = 0;
  let converged = false;
  for (; iter < maxIter; iter++) {
    J = params.map((_, k) => {
      const th = theta.slice();
      th[k] += FD_STEP;
      const rk = evalAt(th).r;
      return rk.map((v, i) => (v - cur.r[i]) / FD_STEP);
    });
    const p = params.length;
    const JTJ = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (__, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0)));
    const JTr = Array.from({ length: p }, (_, a) => J[a].reduce((s, v, i) => s + v * cur.r[i], 0));
    const weak = params.filter((_, a) => !(Math.sqrt(JTJ[a][a] / cur.r.length) > MIN_SENSITIVITY));
    if (weak.length) throw new Error(`fit: ${weak.join(', ')} changes no reading on ${tags.join(', ')} beyond solver noise; the log cannot identify it`);
    let accepted = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) : v)));
      const d = solve(A, JTr.map((v) => -v));
      if (!d) throw new Error('fit: singular normal equations (the chosen areas are not separately identifiable from these channels)');
      const th = theta.map((v, k) => v + d[k]);
      const next = evalAt(th);
      const s2 = ssrOf(next.r);
      if (s2 < ssr) {
        const small = Math.max(...d.map(Math.abs)) < 1e-7 || (ssr - s2) / Math.max(ssr, 1e-300) < 1e-10;
        theta = th;
        cur = next;
        ssr = s2;
        lambda = Math.max(1e-9, lambda / 3);
        accepted = true;
        opts.onIter?.({ iter, ssr, fitted: toOverrides(theta) });
        if (small) converged = true;
        break;
      }
      lambda *= 4;
    }
    if (!accepted || converged) {
      converged = true;
      break;
    }
  }
  const n = cur.r.length;
  const p = params.length;
  const JTJ = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (__, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0)));
  const cov = inverse(JTJ);
  const s2 = n > p ? ssr / (n - p) : NaN;
  const fitted = toOverrides(theta);
  return {
    params,
    tags,
    start,
    fitted,
    sigmaRel: Object.fromEntries(params.map((id, k) => [id, cov ? Math.sqrt(Math.max(0, s2 * cov[k][k])) : NaN])),
    ssr0,
    ssr,
    rms0,
    rms: cur.perChannel,
    iterations: iter + 1,
    evals,
    converged,
    n,
  };
}
