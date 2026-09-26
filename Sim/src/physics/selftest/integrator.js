/**
 * Dormand–Prince 5(4) against closed-form solutions: its order of accuracy, its dense output, and
 * its error control. Fixed steps (tolerances disabled) isolate the method from the controller.
 */
import { ok, approx, section } from './harness.js';
import { Dopri5 } from '../integrate/dopri5.js';
import { Ros3 } from '../integrate/ros3.js';

function fixed(f, y0, h, tEnd, probe) {
  const s = new Dopri5(y0.length, f, { rtol: 1, atol: 1e9 });
  const y = Float64Array.from(y0);
  const o = new Float64Array(y0.length);
  let t = 0;
  let dmax = 0;
  const n = Math.round(tEnd / h);
  for (let k = 0; k < n; k++) {
    s.trial(t, y, h);
    s.accept(t, y, h);
    for (const q of [0.3, 0.7]) dmax = Math.max(dmax, Math.abs(s.dense(t + q * h, o)[0] - probe(t + q * h)));
    t += h;
  }
  return { y, dmax };
}

export function run() {
  section('Integrator · Dormand–Prince 5(4)');
  const f = (t, y, d) => void (d[0] = t * y[0]); // y = exp(t²/2)
  const exact = (t) => Math.exp((t * t) / 2);
  const e = [0.05, 0.025, 0.0125].map((h) => fixed(f, [1], h, 1, exact));
  const err = e.map((r) => Math.abs(r.y[0] - exact(1)));
  const order = Math.log2(err[1] / err[2]);
  ok(order > 4.5 && order < 5.6, `global error is 5th order (observed ${order.toFixed(2)}; 2^5 = 32 per halving)`);
  const dOrder = Math.log2(e[1].dmax / e[2].dmax);
  ok(dOrder > 4.5 && dOrder < 5.6, `dense output converges at the same order inside steps (observed ${dOrder.toFixed(2)})`);

  const osc = (t, y, d) => {
    d[0] = y[1];
    d[1] = -y[0];
  };
  const s = new Dopri5(2, osc, { rtol: 1e-10, atol: 1e-12 });
  const y = Float64Array.of(1, 0);
  let t = 0;
  let h = 1e-3;
  let steps = 0;
  while (t < 20) {
    const hh = Math.min(h, 20 - t);
    const er = s.trial(t, y, hh);
    h = s.nextH(hh, er);
    if (er <= 1) {
      s.accept(t, y, hh);
      t += hh;
      steps++;
    }
  }
  approx(y[0], Math.cos(20), 1e-8, `adaptive: harmonic oscillator to t = 20 at rtol 1e-10 (${steps} steps)`);
  approx(y[0] * y[0] + y[1] * y[1], 1, 1e-8, 'adaptive: oscillator energy x² + v² stays 1');

  section('Integrator · Ros3 (Rosenbrock, the default since M3)');
  const fixedRos = (fn, y0, h, tEnd, exact) => {
    const r = new Ros3(y0.length, fn, { rtol: 1, atol: 1e9 });
    const y = Float64Array.from(y0);
    const o = new Float64Array(y0.length);
    let t = 0;
    let dmax = 0;
    for (let k = 0; k < Math.round(tEnd / h); k++) {
      r.trial(t, y, h);
      r.accept(t, y, h);
      dmax = Math.max(dmax, Math.abs(r.dense(t + 0.4 * h, o)[0] - exact(t + 0.4 * h)));
      t += h;
    }
    return { e: Math.abs(y[0] - exact(tEnd)), dmax };
  };
  const rr = [0.05, 0.025, 0.0125].map((hh) => fixedRos((t, y, d) => void (d[0] = t * y[0]), [1], hh, 1, exact));
  const ro = Math.log2(rr[1].e / rr[2].e);
  ok(ro > 2.8 && ro < 3.3, `third order on a nonlinear, time-dependent problem (observed ${ro.toFixed(2)}; checks the coefficients)`);
  const rd = Math.log2(rr[1].dmax / rr[2].dmax);
  ok(rd > 2.7 && rd < 4.3, `Hermite dense output converges at third order or better (observed ${rd.toFixed(2)})`);
  const stiffOne = new Ros3(1, (t, y, d) => void (d[0] = -1e8 * y[0]), { rtol: 1, atol: 1e9 });
  const ys = Float64Array.of(1);
  stiffOne.trial(0, ys, 1);
  stiffOne.accept(0, ys, 1);
  ok(Math.abs(ys[0]) < 1e-6, `L-stable: one step of hλ = −10⁸ damps to ${ys[0].toExponential(1)} (R(∞) = 0)`);
  // Prothero–Robinson: in the stiff limit Rosenbrock methods lose an order; documented, not hidden.
  const pr = [0.05, 0.025].map((hh) => fixedRos((t, y, d) => void (d[0] = -1e6 * (y[0] - Math.sin(t)) + Math.cos(t)), [0], hh, 2, Math.sin));
  const po = Math.log2(pr[0].e / pr[1].e);
  ok(po > 1.7 && po < 3.3, `stiff Prothero–Robinson converges (observed order ${po.toFixed(2)}; 2 is the known stiff order reduction)`);
  const est = new Ros3(1, (t, y, d) => void (d[0] = t * y[0] + 1), { rtol: 0, atol: 1 });
  const ests = [1e-2, 1e-3].map((hh) => {
    est.reset();
    est.trial(0.3, Float64Array.of(0.5), hh);
    return Math.abs(est.err[0]);
  });
  const eo = Math.log10(ests[0] / ests[1]);
  ok(eo > 2.7 && eo < 3.3, `error estimate scales as h³ (observed ${eo.toFixed(2)} decades per decade of h)`);
  // The linear solve the method stands on: random systems that need several pivots.
  let worstLU = 0;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let trial = 0; trial < 200; trial++) {
    const n = 2 + (trial % 12);
    const r = new Ros3(n, () => {}, {});
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) r.J[i][j] = rnd() * (i === j ? 1 : 1e3 * rnd());
    const hh = 0.37;
    r._factor(hh);
    const gg = 1 / (hh * 0.43586652150845899941601945119356);
    const b = Float64Array.from({ length: n }, rnd);
    const x = Float64Array.from(b);
    r._solve(x);
    for (let i = 0; i < n; i++) {
      let res = gg * x[i] - b[i];
      for (let j = 0; j < n; j++) res -= r.J[i][j] * x[j];
      worstLU = Math.max(worstLU, Math.abs(res) / (1 + Math.abs(b[i])));
    }
  }
  ok(worstLU < 1e-10, `LU solve with pivoting: 200 random systems, worst residual ${worstLU.toExponential(1)} (caught a permutation-order bug)`);
}
