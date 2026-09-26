/**
 * Dormand–Prince 5(4) against closed-form solutions: its order of accuracy, its dense output, and
 * its error control. Fixed steps (tolerances disabled) isolate the method from the controller.
 */
import { ok, approx, section } from './harness.js';
import { Dopri5 } from '../integrate/dopri5.js';

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
}
