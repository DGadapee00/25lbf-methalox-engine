/**
 * V-3: the orifice law is continuous in value and slope at the critical ratio, the Δp → 0
 * regularization is C¹ and monotone, and the law tends to the incompressible C_dA·√(2ρΔp).
 * V-9: PROJECT_PLAN §2.3's GOX injector hand check.
 */
import { approx, ok, section } from './harness.js';
import { flux, regFlux, criticalRatio, chokedFlux, LIN_FRAC, orificeFlow } from '../elements/orifice.js';
import { R_U, PSI } from '../constants.js';

export function run() {
  section('V-3 · orifice law: choke point, Δp → 0, incompressible limit');
  const p0 = 3.3e6;
  const T0 = 293;
  for (const [name, W, g] of [['O₂', 0.031998, 1.4], ['CH₄', 0.016043, 1.31]]) {
    const R = R_U / W;
    const rs = criticalRatio(g);
    const at = (r) => flux(p0, T0, g, R, r * p0);
    const eps = 1e-7;
    approx(at(rs * (1 + eps)), at(rs * (1 - eps)), 1e-9, `${name}: flux continuous across r* = ${rs.toFixed(4)}`);
    // Slope dṁ/dp just above r*, in units of choked flux per p₀: zero for a C¹ join.
    const d = 1e-6;
    const slope = ((at(rs * (1 + 2 * d)) - at(rs * (1 + d))) / (rs * d)) / chokedFlux(p0, T0, g, R);
    ok(Math.abs(slope) < 1e-5, `${name}: subsonic slope → 0 at r* (C¹ join; |slope| = ${Math.abs(slope).toExponential(1)})`);
    const rho = p0 / (R * T0);
    const ratio = (dpRel) => flux(p0, T0, g, R, p0 * (1 - dpRel)) / Math.sqrt(2 * rho * p0 * dpRel);
    const e1 = Math.abs(ratio(1e-2) - 1);
    const e2 = Math.abs(ratio(2e-3) - 1);
    ok(e2 < 2e-3 && e1 / e2 > 4 && e1 / e2 < 6, `${name}: → C_dA√(2ρΔp) as Δp → 0, error ∝ Δp (${e1.toExponential(1)} → ${e2.toExponential(1)} for Δp/p₀ 1e-2 → 2e-3)`);

    const dpLin = LIN_FRAC * p0;
    const reg = (dp) => regFlux(p0, T0, g, R, p0 - dp).flux;
    approx(reg(dpLin * (1 - 1e-9)), reg(dpLin * (1 + 1e-9)), 1e-7, `${name}: regularization matches the law in value at Δp_lin`);
    const h = dpLin * 1e-5;
    const sIn = (reg(dpLin) - reg(dpLin - h)) / h;
    const sOut = (reg(dpLin + h) - reg(dpLin)) / h;
    approx(sIn, sOut, 1e-3, `${name}: …and in slope (C¹)`);
    let mono = true;
    for (let k = 1; k <= 1000; k++) if (reg((dpLin * k) / 1000) <= reg((dpLin * (k - 1)) / 1000)) mono = false;
    ok(mono, `${name}: regularized law is strictly increasing on (0, Δp_lin]`);
    ok(reg(0) === 0, `${name}: zero flow at Δp = 0`);
  }
  const sa = { p: 2e5, T: 300, gamma: 1.4, R: 287 };
  const sb = { p: 1e5, T: 300, gamma: 1.4, R: 287 };
  const fwd = orificeFlow(1e-6, sa, sb);
  const rev = orificeFlow(1e-6, sb, sa);
  ok(fwd.mdot > 0 && rev.mdot === -fwd.mdot, 'reverse flow by sign: swapping sides negates ṁ exactly');
  ok(fwd.choked && Math.abs(fwd.margin - 2) < 1e-12, 'reports choked and margin p_up/p_down');

  section('V-9 · PROJECT_PLAN §2.3 hand check');
  // 4 × ⌀1.4 mm GOX at 480 psia, 293 K, C_d ≈ 0.77 → 38.8 g/s (PROJECT_PLAN §2.2 ox flow).
  const A = 4 * (Math.PI / 4) * 1.4e-3 ** 2;
  const mdot = 0.77 * A * chokedFlux(480 * PSI, 293, 1.4, R_U / 0.031998);
  approx(mdot, 0.0388, 0.005, `4×⌀1.4 mm GOX, 480 psia, 293 K, C_d 0.77 → ${(mdot * 1e3).toFixed(2)} g/s ≈ 38.8 g/s (0.5%)`);
}
