/**
 * Ros3: a 3-stage, third-order, L-stable Rosenbrock method with an embedded second-order error
 * estimate (A. Sandu, J. G. Verwer, et al., "Benchmarking stiff ODE solvers for atmospheric
 * chemistry problems II: Rosenbrock solvers", Atmos. Environ. 31 (1997) 3459–3472; coefficients
 * as in the KPP Rosenbrock integrator's "Ros3"). Added in M3 because the stand network is stiff
 * (docs/solver.md §2): an explicit method's step is capped by stability, this one's is not.
 *
 * Linearly implicit, so no Newton iteration: each step solves three linear systems with the same
 * matrix (1/(hγ) I − J), in the transformed form (Hairer–Wanner, Solving ODEs II, §IV.7):
 *
 *   (1/(hγ) I − J) K_i = f(t + α_i h, y + Σ_j a_ij K_j) + Σ_j (c_ij/h) K_j + h γ_i ∂f/∂t
 *   y_new = y + Σ m_i K_i,    error = Σ e_i K_i
 *
 * The third stage reuses the second's f (a31 = a21, a32 = 0), so a step costs two f evaluations
 * plus the Jacobian. J is by forward differences, one column per state (n evaluations) and one
 * more for ∂f/∂t (valve positions move with t between breakpoints).
 *
 * The coefficients are checked in the self-test, not trusted: order of convergence, zero
 * amplification at infinite stiffness, and the error estimate.
 *
 * Linear invariants survive exactly: if wᵀf = 0 for every y then wᵀJ = 0 (also for the
 * difference Jacobian), and by induction wᵀK_i = 0. So mass and energy conservation (V-4, V-5)
 * stay at round-off, as with Dormand–Prince.
 *
 * Dense output is the cubic Hermite interpolant through (y, f) at both ends of the step, third
 * order like the method; f at the new point is the next step's first stage, so it costs nothing
 * extra. Same interface as Dopri5: trial / nextH / accept / dense / reset.
 */
import { NonPhysicalState } from '../gas.js';

const GAMMA = 0.43586652150845899941601945119356;
const A21 = 1.0;
const A31 = 1.0;
const A32 = 0.0;
const C21 = -1.0156171083877702091975600115545;
const C31 = 4.0759956452537699824805835358067;
const C32 = 9.2076794298330791242156818474003;
const M1 = 1.0;
const M2 = 6.1697947043828245592553615689730;
const M3 = -0.42772256543218573326238373806514;
const E1 = 0.5;
const E2 = -2.9079558716805469821718236208017;
const E3 = 0.22354069897811569627360909276199;
const ALPHA2 = 0.43586652150845899941601945119356;
const G1 = 0.43586652150845899941601945119356;
const G2 = 0.24291996454816804366592249683314;
const G3 = 2.1851380027664058511513169485832;
/** Order of the error estimate's leading term: step factor ∝ err^(−1/3). */
const ELO = 3;

export class Ros3 {
  /**
   * n: state size. f(t, y, dy). atol: Float64Array(n) or number. rtol: number.
   * scale: optional Float64Array(n) of typical magnitudes, for the Jacobian's perturbations.
   */
  constructor(n, f, { rtol = 1e-6, atol = 1e-12, scale = null } = {}) {
    this.n = n;
    this.f = f;
    this.rtol = rtol;
    this.atol = typeof atol === 'number' ? new Float64Array(n).fill(atol) : atol;
    this.scale = scale;
    const z = () => new Float64Array(n);
    this.f0 = z(); this.f1 = z(); this.ft = z(); this.tmp = z(); this.ftmp = z();
    this.k1 = z(); this.k2 = z(); this.k3 = z(); this.ynew = z(); this.err = z();
    this.J = Array.from({ length: n }, () => new Float64Array(n));
    this.A = Array.from({ length: n }, () => new Float64Array(n));
    this.piv = new Int32Array(n);
    this.y0 = z(); this.y1 = z(); this.fa = z(); this.fend = z();
    this.nfev = 0;
    this.njac = 0;
    this.fresh = true;
    this.jacAt = NaN;
  }

  reset() {
    this.fresh = true;
    this.jacAt = NaN;
  }

  _f(t, y, out) {
    this.f(t, y, out);
    this.nfev++;
  }

  /** Forward-difference Jacobian and ∂f/∂t at (t, y), with f0 = f(t, y) already computed. */
  _jacobian(t, y) {
    const { n, J, f0, tmp, ftmp, ft } = this;
    tmp.set(y);
    for (let k = 0; k < n; k++) {
      const yk = y[k];
      const s = this.scale ? this.scale[k] : 1;
      let d = 1e-7 * Math.max(Math.abs(yk), 1e-3 * s, 1e-300);
      let ok = false;
      for (const sign of [1, -1]) {
        tmp[k] = yk + sign * d;
        try {
          this._f(t, tmp, ftmp);
          ok = true;
          d *= sign;
          break;
        } catch (e) {
          if (!(e instanceof NonPhysicalState)) throw e;
        }
      }
      if (!ok) throw new NonPhysicalState('Jacobian: no physical perturbation of state ' + k);
      const inv = 1 / (tmp[k] - yk);
      for (let i = 0; i < n; i++) J[i][k] = (ftmp[i] - f0[i]) * inv;
      tmp[k] = yk;
    }
    const dt = 1e-7 * Math.max(1, Math.abs(t));
    this._f(t + dt, y, ftmp);
    for (let i = 0; i < n; i++) ft[i] = (ftmp[i] - f0[i]) / dt;
    this.njac++;
    this.jacAt = t;
  }

  /** LU-factor A = 1/(hγ) I − J in place (partial pivoting). */
  _factor(h) {
    const { n, J, A, piv } = this;
    const d = 1 / (h * GAMMA);
    for (let i = 0; i < n; i++) {
      const Ai = A[i];
      const Ji = J[i];
      for (let j = 0; j < n; j++) Ai[j] = -Ji[j];
      Ai[i] += d;
    }
    for (let c = 0; c < n; c++) {
      let p = c;
      let best = Math.abs(A[c][c]);
      for (let r = c + 1; r < n; r++) {
        const v = Math.abs(A[r][c]);
        if (v > best) {
          best = v;
          p = r;
        }
      }
      piv[c] = p;
      if (p !== c) [A[c], A[p]] = [A[p], A[c]];
      const pc = A[c][c] || 1e-300;
      for (let r = c + 1; r < n; r++) {
        const fct = A[r][c] / pc;
        if (fct === 0) continue;
        A[r][c] = fct;
        const Ar = A[r];
        const Ac = A[c];
        for (let j = c + 1; j < n; j++) Ar[j] -= fct * Ac[j];
      }
    }
  }

  /**
   * Solve A x = b in place (b ← x) with the factors from _factor. The factorization swaps whole
   * rows, multipliers included (as LAPACK getrf does), so every interchange is applied to b first
   * and only then does forward substitution run (as getrs does). Interleaving the two is wrong as
   * soon as a later pivot moves a row that an earlier column already eliminated.
   */
  _solve(b) {
    const { n, A, piv } = this;
    for (let c = 0; c < n; c++) {
      const p = piv[c];
      if (p !== c) {
        const t = b[c];
        b[c] = b[p];
        b[p] = t;
      }
    }
    for (let c = 0; c < n; c++) {
      const bc = b[c];
      if (bc === 0) continue;
      for (let r = c + 1; r < n; r++) b[r] -= A[r][c] * bc;
    }
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      const Ar = A[r];
      for (let j = r + 1; j < n; j++) s -= Ar[j] * b[j];
      b[r] = s / (Ar[r] || 1e-300);
    }
  }

  trial(t, y, h) {
    const { n, f0, ft, k1, k2, k3, tmp, ftmp, ynew, err } = this;
    if (this.fresh) {
      this._f(t, y, f0);
      this.fresh = false;
      this.jacAt = NaN;
    }
    if (this.jacAt !== t) this._jacobian(t, y);
    this._factor(h);
    // Stage 1
    for (let i = 0; i < n; i++) k1[i] = f0[i] + h * G1 * ft[i];
    this._solve(k1);
    // Stage 2
    for (let i = 0; i < n; i++) tmp[i] = y[i] + A21 * k1[i];
    this._f(t + ALPHA2 * h, tmp, ftmp);
    for (let i = 0; i < n; i++) k2[i] = ftmp[i] + (C21 / h) * k1[i] + h * G2 * ft[i];
    this._solve(k2);
    // Stage 3: same f as stage 2 (a31 = a21, a32 = 0, α3 = α2)
    for (let i = 0; i < n; i++) k3[i] = ftmp[i] + (C31 / h) * k1[i] + (C32 / h) * k2[i] + h * G3 * ft[i];
    this._solve(k3);
    let s = 0;
    for (let i = 0; i < n; i++) {
      ynew[i] = y[i] + M1 * k1[i] + M2 * k2[i] + M3 * k3[i];
      err[i] = E1 * k1[i] + E2 * k2[i] + E3 * k3[i];
      const sc = this.atol[i] + this.rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i]));
      const q = err[i] / sc;
      s += q * q;
    }
    this.errNorm = Math.sqrt(s / n);
    if (!Number.isFinite(this.errNorm)) this.errNorm = Infinity;
    return this.errNorm;
  }

  nextH(h, e) {
    const fac = e === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(e, -1 / ELO)));
    return h * fac;
  }

  /** Take the last trial; build the Hermite interpolant over [t, t+h]. */
  accept(t, y, h) {
    const { ynew, f0, fend, y0, y1, fa } = this;
    this._f(t + h, ynew, fend);
    y0.set(y);
    fa.set(f0);
    y1.set(ynew);
    y.set(ynew);
    f0.set(fend);
    this.t0 = t;
    this.h = h;
    this.jacAt = NaN;
  }

  /** Cubic Hermite through (y0, f0) and (y1, f1) at time t inside the last step. */
  dense(t, out) {
    const { n, y0, fa, fend, y1, h } = this;
    const s = (t - this.t0) / h;
    const h00 = (1 + 2 * s) * (1 - s) * (1 - s);
    const h10 = s * (1 - s) * (1 - s);
    const h01 = s * s * (3 - 2 * s);
    const h11 = s * s * (s - 1);
    for (let i = 0; i < n; i++) out[i] = h00 * y0[i] + h10 * h * fa[i] + h01 * y1[i] + h11 * h * fend[i];
    return out;
  }
}
