/**
 * V-4: mass conservation over a multi-valve cold-flow sequence, every element type in play.
 * (The brief asks for a full hot-fire sequence; that needs the chamber model, M4. This runs the
 * same check over everything that exists now and will be extended then.)
 * V-5: energy conservation, and the equilibrium an adiabatic closed network must reach.
 */
import { approx, ok, section, recordStats } from './harness.js';
import { simulate } from '../simulate.js';
import { nasa7Gas, perfectGasGamma } from '../gas.js';
import { coldFlowStand, COLD_FLOW_SCHEDULE } from './fixtures.js';

export function run() {
  section('V-4 · mass conservation, two-circuit cold flow with purge, relief, check, regulator fault');
  const gas = nasa7Gas(['O2', 'CH4', 'N2']);
  const r = simulate(coldFlowStand(), { gas, tEnd: 2.0, schedule: COLD_FLOW_SCHEDULE, sampleDt: 0.01 });
  recordStats('V-4 cold-flow stand sequence', r.stats);
  const sys = r.sys;
  const y0 = sys.initialState();
  const ns = gas.n;
  const m0 = sys.totals(y0).m;
  const m1 = sys.totals(r.y).m;
  approx(m1, m0, 1e-9, `Σ node mass + mass vented = m₀ to 1e-9 (rel ${Math.abs(m1 / m0 - 1).toExponential(1)})`);
  for (let i = 0; i < ns; i++) {
    let a = 0;
    let b = 0;
    for (const n of sys.nodes) {
      a += y0[n.off + i];
      b += r.y[n.off + i];
    }
    approx(b, a, 1e-9, `${gas.names[i]} conserved on its own (no reactions before M4)`);
  }
  const E0 = sys.totals(y0).E;
  const E1 = sys.totals(r.y).E;
  approx(E1, E0, 1e-9, 'energy conserved over the same run (all nodes adiabatic)');
  const vented = r.final.nodes.amb.mIn;
  ok(vented > 0.01, `the run actually moved gas: ${(vented * 1e3).toFixed(1)} g reached ambient`);
  const kinds = new Set(r.events.map((e) => `${e.id}:${e.what}`));
  const liftOx = r.samples.map((sm) => sm.edges['PSV-OX-01'].lift);
  ok(Math.max(...liftOx) > 0, `the ox relief lifted after the regulator failed open (peak lift ${Math.max(...liftOx).toFixed(2)})`);
  ok(kinds.has('CKV-N2-01:open') && kinds.has('CKV-N2-01:close'), 'the purge check valve opened and reseated');

  section('V-5 · adiabatic closed network: two tanks equalize through a valve');
  // Closed forms for a calorically perfect gas, tanks adiabatic, no heat between them:
  //   final common pressure  p_f = (p₁V₁ + p₂V₂)/(V₁ + V₂)       (from ΣU conserved, U = pV/(γ−1))
  //   gas left in tank 1 expanded isentropically: T₁f = T₁ (p_f/p₁)^((γ−1)/γ)
  const g = 1.4;
  const pg = perfectGasGamma('N2', 0.028014, g);
  const [V1, V2, p1, p2, T1, T2] = [0.002, 0.006, 5e6, 5e5, 320, 280];
  const net = {
    nodes: [
      { id: 't1', kind: 'volume', V: V1, p: p1, T: T1, Y: { N2: 1 } },
      { id: 't2', kind: 'volume', V: V2, p: p2, T: T2, Y: { N2: 1 } },
    ],
    edges: [{ id: 'v', type: 'valve', a: 't1', b: 't2', CdAmax: 2e-6, tOpen: 0.1, tClose: 0.1 }],
  };
  const r5 = simulate(net, { gas: pg, tEnd: 60, schedule: [{ t: 0, id: 'v', cmd: 'open' }], sampleDt: 1, rtol: 1e-10 });
  recordStats('V-5 two-tank equalization', r5.stats);
  const f = r5.final.nodes;
  const pf = (p1 * V1 + p2 * V2) / (V1 + V2);
  approx(f.t1.p, pf, 1e-6, `tank 1 → p_f = (p₁V₁+p₂V₂)/(V₁+V₂) = ${(pf / 1e5).toFixed(4)} bar`);
  approx(f.t2.p, pf, 1e-6, 'tank 2 → the same p_f');
  approx(f.t1.T, T1 * Math.pow(pf / p1, (g - 1) / g), 1e-6, 'gas left in tank 1 followed the isentrope');
  const s5 = r5.sys;
  approx(s5.totals(r5.y).E, s5.totals(s5.initialState()).E, 1e-12, 'ΣU conserved to 1e-12');
  approx(s5.totals(r5.y).m, s5.totals(s5.initialState()).m, 1e-12, 'Σm conserved to 1e-12');
}
