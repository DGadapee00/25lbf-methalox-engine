/**
 * Test networks. EVERY number below is a test fixture chosen to exercise the solver, not a stand
 * default and not a design value, except where a line cites PROJECT_PLAN. Stand defaults arrive
 * with M2 and carry their own sources (PROVENANCE.md).
 */
import { PSI, P_ATM } from '../constants.js';
import { regulatorGain } from '../elements/regulator.js';
import { chokedFlux } from '../elements/orifice.js';
import { R_U } from '../constants.js';

const circle = (d) => (Math.PI / 4) * d * d;

/** PROJECT_PLAN §2.3 injector: 4 × ⌀1.4 mm GOX, 4 × ⌀1.0 mm GCH₄; C_d 0.77 (brief V-9). */
export const CDA_OX_INJ = 0.77 * 4 * circle(1.4e-3);
export const CDA_FU_INJ = 0.77 * 4 * circle(1.0e-3);
/** PROJECT_PLAN §2.2 throat ⌀8.0 mm, C_d 1 (fixture: a cold-flow throat is not characterized). */
export const CDA_THROAT = circle(8.0e-3);
/** PROJECT_PLAN §2.2 chamber volume ≈ 45 cm³. */
export const V_CHAMBER = 45e-6;
/** PROJECT_PLAN §2.3 manifold pressure. */
export const P_MANIFOLD = 480 * PSI;

/** Fixtures. */
export const P_BOTTLE = 2000 * PSI;
export const V_BOTTLE = 0.05;
export const V_MANIFOLD = 20e-6;
export const V_LINE = 5e-6;
export const T_AMB = 293.15;

/** Regulator fixture: 20 psi droop at the circuit's design flow, 20 ms poppet lag. */
export function regulatorFixture(W, gamma, mdot, CdAmax) {
  const supply = { p: P_BOTTLE, T: T_AMB, gamma, R: R_U / W };
  return { CdAmax, pSet: P_MANIFOLD, K: regulatorGain({ droop: 20 * PSI, mdot, CdAmax, supply }), tau: 0.02, z0: 0 };
}

/**
 * Two-circuit cold-flow stand with purge, relief and check: every element type, every node kind.
 * Ox: O₂ bottle → regulator → manifold → main valve → line → injector → chamber.
 * Fuel: CH₄, the same. Purge: N₂ bottle → valve → check → chamber. Chamber → throat → ambient.
 * Relief on the ox manifold (set just above lockup, so it cracks when the regulator fails open).
 */
export function coldFlowStand() {
  const CdAregOx = 3 * CDA_OX_INJ * chokedFlux(P_MANIFOLD, T_AMB, 1.4, R_U / 0.031998) / chokedFlux(P_BOTTLE, T_AMB, 1.4, R_U / 0.031998);
  const CdAregFu = 3 * CDA_FU_INJ * chokedFlux(P_MANIFOLD, T_AMB, 1.31, R_U / 0.016043) / chokedFlux(P_BOTTLE, T_AMB, 1.31, R_U / 0.016043);
  const vol = (id, V, p, Y) => ({ id, kind: 'volume', V, p, T: T_AMB, Y });
  return {
    nodes: [
      vol('bot-ox', V_BOTTLE, P_BOTTLE, { O2: 1 }),
      vol('man-ox', V_MANIFOLD, P_ATM, { N2: 1 }),
      vol('line-ox', V_LINE, P_ATM, { N2: 1 }),
      vol('bot-fu', V_BOTTLE, P_BOTTLE, { CH4: 1 }),
      vol('man-fu', V_MANIFOLD, P_ATM, { N2: 1 }),
      vol('line-fu', V_LINE, P_ATM, { N2: 1 }),
      vol('bot-n2', V_BOTTLE, 1000 * PSI, { N2: 1 }),
      vol('line-n2', V_LINE, P_ATM, { N2: 1 }),
      vol('chamber', V_CHAMBER, P_ATM, { N2: 1 }),
      { id: 'amb', kind: 'ambient', p: P_ATM, T: T_AMB, Y: { N2: 0.767, O2: 0.233 } },
    ],
    edges: [
      { id: 'REG-OX', type: 'regulator', a: 'bot-ox', b: 'man-ox', ...regulatorFixture(0.031998, 1.4, 0.0388, CdAregOx) },
      { id: 'PV-OX', type: 'valve', a: 'man-ox', b: 'line-ox', CdAmax: 5 * CDA_OX_INJ, tOpen: 0.05, tClose: 0.05, delay: 0.01 },
      { id: 'INJ-OX', type: 'orifice', a: 'line-ox', b: 'chamber', CdA: CDA_OX_INJ },
      { id: 'RV-OX', type: 'relief', a: 'man-ox', b: 'amb', CdA: 2 * CDA_OX_INJ, set: 600 * PSI, blowdown: 0.1 },
      { id: 'REG-FU', type: 'regulator', a: 'bot-fu', b: 'man-fu', ...regulatorFixture(0.016043, 1.31, 0.0139, CdAregFu) },
      { id: 'PV-FU', type: 'valve', a: 'man-fu', b: 'line-fu', CdAmax: 5 * CDA_FU_INJ, tOpen: 0.05, tClose: 0.05, delay: 0.01 },
      { id: 'INJ-FU', type: 'orifice', a: 'line-fu', b: 'chamber', CdA: CDA_FU_INJ },
      { id: 'PV-N2', type: 'valve', a: 'bot-n2', b: 'line-n2', CdAmax: CDA_FU_INJ, tOpen: 0.02, tClose: 0.02 },
      { id: 'CV-N2', type: 'check', a: 'line-n2', b: 'chamber', CdA: 2 * CDA_FU_INJ, crack: 3 * PSI, reseat: 1 * PSI },
      { id: 'THROAT', type: 'orifice', a: 'chamber', b: 'amb', CdA: CDA_THROAT },
    ],
  };
}

/** A sequence over the cold-flow stand (fixture timings, not a proposed sequence). */
export const COLD_FLOW_SCHEDULE = [
  { t: 0.0, id: 'PV-N2', cmd: 'open' },
  { t: 0.3, id: 'PV-N2', cmd: 'close' },
  { t: 0.4, id: 'PV-OX', cmd: 'open' },
  { t: 0.45, id: 'PV-FU', cmd: 'open' },
  { t: 1.2, id: 'REG-OX', cmd: { fault: 'open' } },
  { t: 1.4, id: 'PV-FU', cmd: 'close' },
  { t: 1.45, id: 'PV-OX', cmd: 'close' },
  { t: 1.5, id: 'PV-N2', cmd: 'open' },
];
