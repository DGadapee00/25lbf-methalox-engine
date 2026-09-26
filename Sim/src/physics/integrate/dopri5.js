/**
 * Dormand–Prince 5(4), the explicit embedded Runge–Kutta pair behind MATLAB's ode45 and Hairer's
 * DOPRI5 (brief §4.5). Fifth-order solution, fourth-order error estimate, FSAL (the last stage of
 * one step is the first of the next), and a fourth-order continuous extension ("dense output") that
 * lets the driver sample and locate events inside a step without re-integrating.
 *
 * Tableau: J. R. Dormand and P. J. Prince, "A family of embedded Runge–Kutta formulae", J. Comput.
 * Appl. Math. 6 (1980) 19–26. Dense-output coefficients: E. Hairer, S. P. Nørsett, G. Wanner,
 * Solving Ordinary Differential Equations I, 2nd ed., §II.6 (as in their DOPRI5 code, CONTD5).
 * The self-test checks both against closed-form solutions, including the order of convergence.
 *
 * Step control is the textbook one: error norm = RMS of e_i / (atol_i + rtol·max(|y_i|, |ŷ_i|)),
 * accept when ≤ 1, next h = h·clamp(0.9·err^(−1/5), 0.2, 5). No PI controller: the solver notes
 * say why it has not been needed yet.
 *
 * f(t, y, dy) writes dy in place. Arrays are Float64Array and reused; nothing allocates per step.
 */
const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
// e = b(5th) − b̂(4th)
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;
// Dense output
const D1 = -12715105075 / 11282082432, D3 = 87487479700 / 32700410799, D4 = -10690763975 / 1880347072;
const D5 = 701980252875 / 199316789632, D6 = -1453857185 / 822651844, D7 = 69997945 / 29380423;

export class Dopri5 {
  /**
   * n: state size. f(t, y, dy). atol: Float64Array(n) or number. rtol: number.
   */
  constructor(n, f, { rtol = 1e-8, atol = 1e-12 } = {}) {
    this.n = n;
    this.f = f;
    this.rtol = rtol;
    this.atol = typeof atol === 'number' ? new Float64Array(n).fill(atol) : atol;
    const z = () => new Float64Array(n);
    this.k1 = z(); this.k2 = z(); this.k3 = z(); this.k4 = z(); this.k5 = z(); this.k6 = z(); this.k7 = z();
    this.ys = z(); this.ynew = z(); this.err = z();
    this.r1 = z(); this.r2 = z(); this.r3 = z(); this.r4 = z(); this.r5 = z();
    this.nfev = 0;
    this.fresh = true; // k1 must be evaluated (start, or after a discontinuity)
  }

  /** Mark that the RHS changed discontinuously at the current point: FSAL k1 is stale. */
  reset() {
    this.fresh = true;
  }

  /**
   * One trial step from (t, y) with size h. On return: this.ynew, this.errNorm. Does not modify y.
   * Call accept(t, y, h) to take it.
   */
  trial(t, y, h) {
    const { n, f, k1, k2, k3, k4, k5, k6, k7, ys, ynew, err } = this;
    if (this.fresh) {
      f(t, y, k1);
      this.nfev++;
      this.fresh = false;
    }
    for (let i = 0; i < n; i++) ys[i] = y[i] + h * A21 * k1[i];
    f(t + C2 * h, ys, k2);
    for (let i = 0; i < n; i++) ys[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
    f(t + C3 * h, ys, k3);
    for (let i = 0; i < n; i++) ys[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    f(t + C4 * h, ys, k4);
    for (let i = 0; i < n; i++) ys[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    f(t + C5 * h, ys, k5);
    for (let i = 0; i < n; i++) ys[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    f(t + h, ys, k6);
    for (let i = 0; i < n; i++) ynew[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
    f(t + h, ynew, k7);
    this.nfev += 6;
    let s = 0;
    for (let i = 0; i < n; i++) {
      err[i] = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
      const sc = this.atol[i] + this.rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i]));
      const q = err[i] / sc;
      s += q * q;
    }
    this.errNorm = Math.sqrt(s / n);
    return this.errNorm;
  }

  /** Suggested next step after a trial with error norm `e`. */
  nextH(h, e) {
    const fac = e === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(e, -0.2)));
    return h * fac;
  }

  /**
   * Take the last trial: build the dense-output polynomial over [t, t+h] and shift k7 → k1 (FSAL).
   * y is overwritten with ynew.
   */
  accept(t, y, h) {
    const { n, k1, k3, k4, k5, k6, k7, ynew, r1, r2, r3, r4, r5 } = this;
    for (let i = 0; i < n; i++) {
      const dy = ynew[i] - y[i];
      const bspl = h * k1[i] - dy;
      r1[i] = y[i];
      r2[i] = dy;
      r3[i] = bspl;
      r4[i] = dy - h * k7[i] - bspl;
      r5[i] = h * (D1 * k1[i] + D3 * k3[i] + D4 * k4[i] + D5 * k5[i] + D6 * k6[i] + D7 * k7[i]);
      y[i] = ynew[i];
    }
    this.t0 = t;
    this.h = h;
    this.k1.set(k7);
  }

  /** Dense output at time t within the last accepted step, written into out. */
  dense(t, out) {
    const th = (t - this.t0) / this.h;
    const th1 = 1 - th;
    const { n, r1, r2, r3, r4, r5 } = this;
    for (let i = 0; i < n; i++) out[i] = r1[i] + th * (r2[i] + th1 * (r3[i] + th * (r4[i] + th1 * r5[i])));
    return out;
  }
}
