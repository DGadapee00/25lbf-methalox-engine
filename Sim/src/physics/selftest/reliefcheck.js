/**
 * The build-time relief rule (network.js checkReliefs): every regulated node must carry relief
 * capacity for its regulator failing open, sized at the relief's set pressure. Tested two ways:
 * the rule itself (what compileNetwork accepts and refuses), and physically: a relief sized
 * exactly by the rule holds a dead-headed manifold at its opening pressure with the regulator
 * failed open, and an undersized one does not.
 */
import { ok, section, recordStats } from './harness.js';
import { compileNetwork, reliefCdAForFailOpen } from '../network.js';
import { simulate } from '../simulate.js';
import { perfectGasGamma } from '../gas.js';
import { R_U, PSI } from '../constants.js';
import { P_BOTTLE, P_MANIFOLD, V_MANIFOLD, T_AMB, DROOP, TAU_REG, CDA_OX_INJ, RELIEF_SET } from './fixtures.js';

const W = 0.031998;
const g = 1.4;
const gas = perfectGasGamma('O2', W, g);
const T = T_AMB;
const CdAmax = 3 * CDA_OX_INJ * (P_MANIFOLD / P_BOTTLE);
const supply = { p: P_BOTTLE, T, gamma: g, R: R_U / W };
const need = reliefCdAForFailOpen(CdAmax, supply, RELIEF_SET, 101325);

function stand(reliefCdA, checks) {
  const edges = [
    { id: 'REG', type: 'regulator', a: 'sup', b: 'man', CdAmax, pSet: P_MANIFOLD, mdotRated: 0.0388, droop: DROOP, tau: TAU_REG, fault: 'open' },
  ];
  if (reliefCdA) edges.push({ id: 'RV', type: 'relief', a: 'man', b: 'amb', CdA: reliefCdA, set: RELIEF_SET, blowdown: 0.1 });
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
  console.log(`        fails-open sizing: C_dA,max ${CdAmax.toExponential(3)} m² from ${(P_BOTTLE / PSI).toFixed(0)} psia needs relief C_dA ≥ ${need.toExponential(3)} m² at ${(RELIEF_SET / PSI).toFixed(0)} psi set`);

  section('Relief rule · physically: regulator failed open into a dead-headed manifold');
  const pOpen = 101325 + RELIEF_SET;
  const sized = simulate(stand(1.001 * need), { gas, tEnd: 0.5, sampleDt: 1e-4 });
  recordStats('relief rule, sized relief', sized.stats);
  const peak = Math.max(...sized.samples.map((s) => s.nodes.man.p));
  ok(peak <= pOpen * (1 + 1e-6), `a relief sized by the rule holds the manifold at its opening pressure (peak ${(peak / PSI).toFixed(1)} psia, open at ${(pOpen / PSI).toFixed(1)})`);
  const small = simulate(stand(0.8 * need, { reliefOnRegulatedNodes: false, reason: 'demonstrating an undersized relief' }), { gas, tEnd: 0.5, sampleDt: 1e-4 });
  recordStats('relief rule, undersized relief', small.stats);
  const peakS = Math.max(...small.samples.map((s) => s.nodes.man.p));
  ok(peakS > 1.05 * pOpen, `a relief at 0.8× the rule does not: the manifold climbs to ${(peakS / PSI).toFixed(0)} psia`);
}
