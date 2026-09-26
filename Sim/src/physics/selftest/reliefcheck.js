/**
 * The build-time relief rule (network.js checkReliefs): every regulated node must carry relief
 * capacity for its regulator failing open, sized at the relief's set pressure. Tested two ways:
 * the rule itself (what compileNetwork accepts and refuses), and physically: a relief sized
 * exactly by the rule holds a dead-headed manifold near its full-lift pressure (set +
 * accumulation) with the regulator failed open, and an undersized one does not.
 */
import { ok, section, recordStats } from './harness.js';
import { compileNetwork, reliefCdAForFailOpen } from '../network.js';
import { simulate } from '../simulate.js';
import { perfectGasGamma } from '../gas.js';
import { R_U, PSI } from '../constants.js';
import { P_BOTTLE, P_MANIFOLD, V_MANIFOLD, T_AMB, DROOP, TAU_REG, CDA_OX_INJ, RELIEF_SET, TAU_LIFT } from './fixtures.js';
import { ACCUMULATION_DEFAULT } from '../elements/relief.js';

const W = 0.031998;
const g = 1.4;
const gas = perfectGasGamma('O2', W, g);
const T = T_AMB;
const CdAmax = 3 * CDA_OX_INJ * (P_MANIFOLD / P_BOTTLE);
const supply = { p: P_BOTTLE, T, gamma: g, R: R_U / W };
const need = reliefCdAForFailOpen(CdAmax, supply, RELIEF_SET, 101325);

function stand(reliefCdA, checks) {
  const edges = [
    { id: 'PCV-OX-01', type: 'regulator', a: 'sup', b: 'man', CdAmax, pSet: P_MANIFOLD, mdotRated: 0.0388, droop: DROOP, tau: TAU_REG, fault: 'open' },
  ];
  if (reliefCdA) edges.push({ id: 'PSV-OX-01', type: 'relief', a: 'man', b: 'amb', CdA: reliefCdA, set: RELIEF_SET, blowdown: 0.1, tauLift: TAU_LIFT });
  return {
    checks,
    nodes: [
      { id: 'sup', kind: 'ambient', p: P_BOTTLE, T, Y: { O2: 1 } },
      { id: 'man', kind: 'volume', V: V_MANIFOLD, p: P_MANIFOLD, T, Y: { O2: 1 }, thermal: 'isothermal' },
      { id: 'amb', kind: 'ambient', p: 101325, T, Y: { O2: 1 } },
    ],
    edges,
  };
}
const throws = (fn, re) => {
  try {
    fn();
    return false;
  } catch (e) {
    return re.test(e.message);
  }
};

export function run() {
  section('Relief rule · checked when a network is built');
  ok(throws(() => compileNetwork(stand(0), gas), /no relief on the regulated node/), 'a regulated node with no relief is refused');
  ok(throws(() => compileNetwork(stand(0.99 * need), gas), /needs relief C_dA ≥/), 'a relief 1% under the fails-open flow is refused, naming the C_dA it needs');
  ok(!throws(() => compileNetwork(stand(1.001 * need), gas), /./), 'a relief sized by the rule is accepted');
  ok(throws(() => compileNetwork(stand(0, { reliefOnRegulatedNodes: false }), gas), /needs a stated reason/), 'opting out without a reason is refused');
  ok(!throws(() => compileNetwork(stand(0, { reliefOnRegulatedNodes: false, reason: 'test' }), gas), /./), 'opting out with a reason is accepted');
  console.log(`        fails-open sizing: C_dA,max ${CdAmax.toExponential(3)} m² from ${(P_BOTTLE / PSI).toFixed(0)} psia needs relief C_dA ≥ ${need.toExponential(3)} m², full lift at ${(RELIEF_SET / PSI).toFixed(0)} psi set + ${ACCUMULATION_DEFAULT * 100}%`);

  section('Relief rule · physically: regulator failed open into a dead-headed manifold');
  // The rule is a steady-state one: once the lift has caught up, a sized relief holds the
  // manifold at or below full-lift pressure. The transient peak on the way there depends on how
  // fast the lift follows (τ_lift) against how fast the manifold fills; it is reported, and it
  // becomes a datasheet question once a relief is selected.
  const pOpen = 101325 + RELIEF_SET * (1 + ACCUMULATION_DEFAULT);
  const sized = simulate(stand(1.001 * need), { gas, tEnd: 0.5, sampleDt: 1e-4 });
  recordStats('relief rule, sized relief', sized.stats);
  const settled = sized.final.nodes.man.p;
  ok(settled <= pOpen, `a relief sized by the rule settles the manifold at or below full-lift pressure (${(settled / PSI).toFixed(1)} psia ≤ ${(pOpen / PSI).toFixed(1)})`);
  const peak = Math.max(...sized.samples.map((s) => s.nodes.man.p));
  console.log(`        transient peak ${(peak / PSI).toFixed(1)} psia (+${((peak / pOpen - 1) * 100).toFixed(1)}% over full lift) with τ_lift = ${TAU_LIFT * 1e3} ms fixture; a datasheet τ_lift sets this`);
  const small = simulate(stand(0.8 * need, { reliefOnRegulatedNodes: false, reason: 'demonstrating an undersized relief' }), { gas, tEnd: 0.5, sampleDt: 1e-4 });
  recordStats('relief rule, undersized relief', small.stats);
  const settledS = small.final.nodes.man.p;
  ok(settledS > 1.05 * pOpen, `a relief at 0.8× the rule does not: the manifold settles at ${(settledS / PSI).toFixed(0)} psia`);
}
