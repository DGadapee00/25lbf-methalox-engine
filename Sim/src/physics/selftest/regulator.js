/**
 * Regulator dynamics. Three parts:
 *
 * 1. Exact linear check. With an ideal (fixed-pressure) supply, a choked poppet, an isothermal
 *    manifold and a choked outlet (cold flow to atmosphere; into 250 psia the outlet is NOT
 *    choked once the regulator droops, which part 2 reports), the regulator loop is exactly linear while the poppet is
 *    unsaturated:
 *        dp/dt = a (G z − k p),      a = RT/V,  G = C_dA,max·flux(p_s),  k = C_dA,out·flux(p)/p
 *        τ dz/dt = K (p_lockup − p) − z
 *    so a small set-point step has a closed-form response (2×2 matrix exponential). The sim
 *    must reproduce it to integrator tolerance, overshoot and ringing included.
 *
 * 0. Set-point convention: passing rated flow from the reference supply the outlet holds p_set;
 *    with the outlet shut it locks up at p_set + droop.
 *
 * 2. Settling at nominal conditions: GOX, 2000 psia bottle (fixture), 480 psia set point
 *    (PROJECT_PLAN §2.3, the flowing pressure at the 38.8 g/s rated flow), the GOX injector (PROJECT_PLAN §2.3, C_d 0.77) discharging into a fixed
 *    250 psia back pressure standing in for P_c (PROJECT_PLAN §2.1), adiabatic manifold. Measures
 *    overshoot and the time to settle within ±1%, then the GOX injector's choke margin there.
 *
 * 3. When it oscillates: the linear model's damping ratio
 *        ζ = (a k + 1/τ) / (2 √((a k + a G K)/τ))
 *    over manifold volume and poppet lag. Printed as a table and summarized in docs/solver.md.
 *
 * Regulator parameters (droop, τ) are fixtures: no regulator has been selected (BOM pending).
 */
import { approx, ok, section, recordStats } from './harness.js';
import { simulate } from '../simulate.js';
import { perfectGasGamma, nasa7Gas } from '../gas.js';
import { chokedFlux, criticalRatio } from '../elements/orifice.js';
import { regulatorDerive } from '../elements/regulator.js';
import { PSI, R_U } from '../constants.js';
import { CDA_OX_INJ, P_MANIFOLD, P_BOTTLE, V_BOTTLE, V_MANIFOLD, T_AMB, DROOP, TAU_REG } from './fixtures.js';

const W_O2 = 0.031998;

/** exp(A t) x0 for a 2×2 A, via the Cayley–Hamilton closed form. */
function expm2(A, t, x0) {
  const s = (A[0][0] + A[1][1]) / 2;
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const d = s * s - det;
  let c;
  let sn;
  if (d > 0) {
    const q = Math.sqrt(d);
    c = Math.cosh(q * t);
    sn = Math.sinh(q * t) / q;
  } else if (d < 0) {
    const w = Math.sqrt(-d);
    c = Math.cos(w * t);
    sn = Math.sin(w * t) / w;
  } else {
    c = 1;
    sn = t;
  }
  const e = Math.exp(s * t);
  const M = [
    [c + sn * (A[0][0] - s), sn * A[0][1]],
    [sn * A[1][0], c + sn * (A[1][1] - s)],
  ];
  return [e * (M[0][0] * x0[0] + M[0][1] * x0[1]), e * (M[1][0] * x0[0] + M[1][1] * x0[1])];
}

/** Linear-model coefficients for the loop. */
function loop({ V, T, gamma, R, pSupply, CdAmax, CdAout, K, tau }) {
  const a = (R * T) / V;
  const G = CdAmax * chokedFlux(pSupply, T, gamma, R);
  const k = CdAout * chokedFlux(1, T, gamma, R); // choked flux is linear in p
  const wn = Math.sqrt((a * k + a * G * K) / tau);
  const zeta = (a * k + 1 / tau) / (2 * wn);
  return { a, G, k, wn, zeta, pss: (pLockup) => (G * K * pLockup) / (k + G * K) };
}

/** A regulator test network needs no relief: it would mask the loop under test. */
const NO_RELIEF = { reliefOnRegulatedNodes: false, reason: 'regulator dynamics test: a relief would mask the loop under test' };

export function run() {
  const g = 1.4;
  const gas = perfectGasGamma('O2', W_O2, g);
  const R = R_U / W_O2;
  const T = T_AMB;
  const CdAout = CDA_OX_INJ;
  const CdAmax = 3 * CdAout * (P_MANIFOLD / P_BOTTLE);
  const supply = { p: P_BOTTLE, T, gamma: g, R };
  const reg = { id: 'PCV-OX-01', CdAmax, pSet: P_MANIFOLD, mdotRated: 0.0388, droop: DROOP, tau: TAU_REG };
  const { K, zRated, pLockup } = regulatorDerive(reg, supply);

  section('Regulator · set-point convention: p_set is the flowing pressure at rated flow');
  // Ideal supply at the reference pressure, outlet sized to pass exactly the rated flow at p_set.
  const CdAr = reg.mdotRated / chokedFlux(P_MANIFOLD, T, g, R);
  const rated = (outlet, V = V_MANIFOLD) => ({
    checks: NO_RELIEF,
    nodes: [
      { id: 'sup', kind: 'ambient', p: P_BOTTLE, T, Y: { O2: 1 } },
      { id: 'man', kind: 'volume', V, p: P_MANIFOLD, T, Y: { O2: 1 }, thermal: 'isothermal' },
      { id: 'amb', kind: 'ambient', p: 101325, T, Y: { O2: 1 } },
    ],
    edges: [{ type: 'regulator', a: 'sup', b: 'man', ...reg, z0: zRated }, outlet],
  });
  const flowing = simulate(rated({ id: 'OUT', type: 'orifice', a: 'man', b: 'amb', CdA: CdAr }), { gas, tEnd: 0.5, sampleDt: 0.05, rtol: 1e-10 });
  recordStats('regulator rated-flow hold', flowing.stats);
  approx(flowing.final.nodes.man.p, P_MANIFOLD, 1e-9, 'passing rated flow from the reference supply, the outlet holds p_set (480 psia)');
  approx(flowing.final.edges['PCV-OX-01'].mdot, reg.mdotRated, 1e-8, '…at the rated flow (38.8 g/s)');
  // Lockup is quasi-static: with the outlet shut nothing can bring pressure back down, so any
  // overshoot is trapped. Dead-headed, the loop has ζ = 1/(2√(aGKτ)); on 10 L it is overdamped
  // (ζ ≈ 2.4) and creeps up to lockup from below. On the 20 cm³ manifold ζ ≈ 0.1 and the model
  // traps well above lockup. That is a LIMITATION of the first-order poppet model (docs/solver.md
  // §5), not a prediction: it is asserted so a model change that alters it is noticed.
  const shut = { id: 'OUT', type: 'valve', a: 'man', b: 'amb', CdAmax: CdAr, tOpen: 0, tClose: 0, x0: 1 };
  const close = [{ t: 0, id: 'OUT', cmd: 'close' }];
  const dead = simulate(rated(shut, 0.01), { gas, tEnd: 10, schedule: close, sampleDt: 0.5, rtol: 1e-10 });
  recordStats('regulator lockup, 10 L dead-head', dead.stats);
  approx(dead.final.nodes.man.p, pLockup, 1e-6, `with the outlet shut it locks up at p_set + droop = ${(pLockup / PSI).toFixed(1)} psia (10 L, overdamped)`);
  const small = simulate(rated(shut), { gas, tEnd: 0.5, schedule: close, sampleDt: 0.05, rtol: 1e-10 });
  recordStats('regulator lockup, 20 cm³ dead-head', small.stats);
  const trapped = small.final.nodes.man.p;
  ok(trapped > 1.2 * pLockup, `model limitation, pinned: on 20 cm³ the first-order poppet traps ${(trapped / PSI).toFixed(0)} psia above lockup (not a hardware prediction)`);
  const viaLockup = regulatorDerive({ ...reg, droop: undefined, pLockup }, supply);
  approx(viaLockup.K, K, 1e-12, 'giving pLockup instead of droop derives the same gain');

  section('Regulator · exact linear response to a small set-point step');
  for (const [label, tau, V] of [['underdamped', TAU_REG, V_MANIFOLD], ['overdamped', 0.001, 500e-6]]) {
    const L = loop({ V, T, gamma: g, R, pSupply: P_BOTTLE, CdAmax, CdAout, K, tau });
    const p1 = L.pss(pLockup);
    const z1 = (L.k * p1) / L.G;
    const pSet2 = P_MANIFOLD * 1.01;
    const p2 = L.pss(pSet2 + DROOP);
    const z2 = (L.k * p2) / L.G;
    const net = {
      checks: NO_RELIEF,
      nodes: [
        { id: 'sup', kind: 'ambient', p: P_BOTTLE, T, Y: { O2: 1 } },
        { id: 'man', kind: 'volume', V, p: p1, T, Y: { O2: 1 }, thermal: 'isothermal' },
        { id: 'pc', kind: 'ambient', p: 101325, T, Y: { O2: 1 } },
      ],
      edges: [
        { type: 'regulator', a: 'sup', b: 'man', ...reg, tau, z0: z1 },
        { id: 'INJ', type: 'orifice', a: 'man', b: 'pc', CdA: CdAout },
      ],
    };
    // Long enough for the slowest mode to decay by e^-12 (~6e-6 of the step).
    const slow = L.zeta < 1 ? L.zeta * L.wn : L.wn * (L.zeta - Math.sqrt(L.zeta * L.zeta - 1));
    const tEnd = 12 / slow;
    const r = simulate(net, { gas, tEnd, schedule: [{ t: 0, id: 'PCV-OX-01', cmd: { pSet: pSet2 } }], sampleDt: tEnd / 400, rtol: 1e-10 });
    recordStats(`regulator linear step, ${label}`, r.stats);
    const A = [
      [-L.a * L.k, L.a * L.G],
      [-K / tau, -1 / tau],
    ];
    let worst = 0;
    r.t.forEach((t, i) => {
      const [dp] = expm2(A, t, [p1 - p2, z1 - z2]);
      worst = Math.max(worst, Math.abs(r.samples[i].nodes.man.p - (p2 + dp)) / (p2 - p1));
    });
    ok(worst < 1e-6, `${label} (ζ = ${L.zeta.toFixed(3)}): p(t) matches the closed-form 2×2 response, worst ${worst.toExponential(1)} of the step`);
    approx(r.final.nodes.man.p, p2, 1e-6, `${label}: settles at p_ss = GK·p_lockup/(k + GK)`);
    ok(r.samples.every((s) => s.edges['PCV-OX-01'].z > 0 && s.edges['PCV-OX-01'].z < 1 && s.edges.INJ.choked), `${label}: poppet unsaturated and outlet choked throughout (linear regime holds)`);
  }

  section('Regulator · settling at nominal conditions (GOX, 2000 → 480 psia, into 250 psia)');
  const nasa = nasa7Gas(['O2']);
  const nominal = (pc) => ({
    checks: NO_RELIEF,
    nodes: [
      { id: 'bottle', kind: 'volume', V: V_BOTTLE, p: P_BOTTLE, T, Y: { O2: 1 } },
      { id: 'man', kind: 'volume', V: V_MANIFOLD, p: pc, T, Y: { O2: 1 } },
      { id: 'pc', kind: 'ambient', p: pc, T, Y: { O2: 1 } },
    ],
    edges: [
      { type: 'regulator', a: 'bottle', b: 'man', ...reg, z0: 0 },
      { id: 'INJ', type: 'orifice', a: 'man', b: 'pc', CdA: CdAout },
    ],
  });
  const rn = simulate(nominal(250 * PSI), { gas: nasa, tEnd: 1.0, sampleDt: 0.0005 });
  recordStats('regulator nominal settling', rn.stats);
  const fin = rn.final.nodes;
  approx(fin.man.p, P_MANIFOLD, 0.005, `final manifold ${(fin.man.p / PSI).toFixed(1)} psia ≈ p_set 480 psia (0.5%; the injector passes ≈ rated flow)`);
  const Lf = loop({ V: V_MANIFOLD, T: fin.man.T, gamma: 1.4, R, pSupply: fin.bottle.p, CdAmax, CdAout, K, tau: TAU_REG });
  const peak = Math.max(...rn.samples.map((s) => s.nodes.man.p));
  let tSettle = 0;
  rn.samples.forEach((s) => {
    if (Math.abs(s.nodes.man.p - fin.man.p) > 0.01 * fin.man.p) tSettle = s.t;
  });
  const over = (peak - fin.man.p) / (fin.man.p - 250 * PSI);
  console.log(`        overshoot ${(over * 100).toFixed(1)}% of the rise, settles to ±1% by ${(tSettle * 1e3).toFixed(0)} ms, linear ζ ≈ ${Lf.zeta.toFixed(2)} (choked-outlet estimate)`);
  ok(tSettle < 0.5, `settles within ±1% in under 0.5 s (${(tSettle * 1e3).toFixed(0)} ms)`);

  section('Regulator · choke margin at the set point (brief §8; the target is S-3)');
  // With p_set the flowing pressure, the manifold sits at ≈ 480 psia and the margin is 480/250.
  const inj = rn.final.edges.INJ;
  const rStar = 1 / criticalRatio(1.4);
  const floor = 250 * PSI * rStar;
  console.log(`        GOX injector: p₀/P_c = ${inj.margin.toFixed(3)} against critical ${rStar.toFixed(3)} (γ = 1.4); choked: ${inj.choked}`);
  console.log(`        the manifold can fall only ${((fin.man.p - floor) / PSI).toFixed(1)} psi (to ${(floor / PSI).toFixed(1)} psia) before the injector unchokes`);
  ok(inj.choked && inj.margin < 2.2, `choked at the set point, but amber: margin ${inj.margin.toFixed(3)} < 2.2 (§5.2 green threshold)`);
  ok((inj.margin - rStar) / rStar < 0.02, `within 2% of critical (${(((inj.margin - rStar) / rStar) * 100).toFixed(1)}%)`);
  const hot = simulate(nominal(264 * PSI), { gas: nasa, tEnd: 0.5, sampleDt: 0.01 });
  recordStats('regulator nominal, P_c 264 psia', hot.stats);
  const injHot = hot.final.edges.INJ;
  ok(!injHot.choked, `at P_c ≈ 264 psia (η_c* 0.97, brief §8) the GOX injector un-chokes: margin ${injHot.margin.toFixed(3)}`);

  section('Regulator · when it rings: linear damping ratio ζ over manifold volume and poppet lag');
  const vols = [5e-6, 20e-6, 100e-6, 500e-6];
  const taus = [0.001, 0.005, 0.02, 0.1];
  console.log(`        ${'V \\ τ'.padEnd(10)}${taus.map((t) => `${t * 1e3} ms`.padStart(9)).join('')}`);
  for (const V of vols) {
    const row = taus.map((tt) => loop({ V, T, gamma: g, R, pSupply: P_BOTTLE, CdAmax, CdAout, K, tau: tt }).zeta.toFixed(2).padStart(9));
    console.log(`        ${`${V * 1e6} cm³`.padEnd(10)}${row.join('')}`);
  }
  const zs = vols.flatMap((V) => taus.map((tt) => loop({ V, T, gamma: g, R, pSupply: P_BOTTLE, CdAmax, CdAout, K, tau: tt }).zeta));
  ok(zs.every((z) => z > 0), 'the two-state loop is always damped (ζ > 0): it can ring but not go unstable; see docs/solver.md');
}
