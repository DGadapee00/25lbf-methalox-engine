/**
 * Test networks. EVERY number below is a test fixture chosen to exercise the solver, not a stand
 * default and not a design value, except where a line cites PROJECT_PLAN. Stand defaults arrive
 * with M2 and carry their own sources (PROVENANCE.md).
 */
import { PSI, P_ATM } from '../constants.js';
import { reliefCdAForFailOpen } from '../network.js';
import { components, injectorCdA } from '../../data/components.js';
import { chokedFlux } from '../elements/orifice.js';
import { R_U } from '../constants.js';

const circle = (d) => (Math.PI / 4) * d * d;

/** PROJECT_PLAN §2.3 injector: 4 × ⌀1.4 mm GOX, 4 × ⌀1.0 mm GCH₄; C_d from components.json. */
const C = components();
export const CDA_OX_INJ = injectorCdA(C, 'INJ-OX-01');
export const CDA_FU_INJ = injectorCdA(C, 'INJ-FU-01');
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

/** Fixture regulator droop (lockup − set) and poppet lag. */
export const DROOP = 20 * PSI;
export const TAU_REG = 0.02;
/** Fixture relief set Δp on each regulated manifold, and the margin its C_dA carries over the minimum. */
export const RELIEF_SET = 600 * PSI;
const RELIEF_MARGIN = 1.2;

/**
 * Regulator fixture: set to the manifold pressure (PROJECT_PLAN §2.3) at the circuit's design flow
 * (PROJECT_PLAN §2.2), from the bottle as filled; 20 psi droop, so lockup at 500 psia.
 */
export function regulatorFixture(mdotRated, CdAmax) {
  return { CdAmax, pSet: P_MANIFOLD, mdotRated, droop: DROOP, tau: TAU_REG, z0: 0 };
}

/** Fixture relief lift response time (no relief selected yet; a datasheet value replaces it). */
export const TAU_LIFT = 0.002;

/** A relief on a regulated manifold, sized by the same rule the network build enforces, ×1.2. */
function reliefFixture(id, node, regCdAmax, W, gamma) {
  const supply = { p: P_BOTTLE, T: T_AMB, gamma, R: R_U / W };
  const CdA = RELIEF_MARGIN * reliefCdAForFailOpen(regCdAmax, supply, RELIEF_SET, P_ATM);
  return { id, type: 'relief', a: node, b: 'amb', CdA, set: RELIEF_SET, blowdown: 0.1, tauLift: TAU_LIFT };
}

/**
 * Tags follow S-2 (2026-09-26): <ISA letters>-<circuit>-<nn>; the injector circuits and throat
 * are engine parts and carry engine-part tags (src/data/tags.js).
 *
 * Two-circuit cold-flow stand with purge, relief and check: every element type, every node kind.
 * Ox: O₂ bottle → regulator → manifold → main valve → line → injector → chamber.
 * Fuel: CH₄, the same. Purge: N₂ bottle → valve → check → chamber. Chamber → throat → ambient.
 * Reliefs on both regulated manifolds (600 psia Δp, sized for the regulator failing open; the
 * network build refuses a regulated node without one). The ox regulator fails open mid-run.
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
      { id: 'PCV-OX-01', type: 'regulator', a: 'bot-ox', b: 'man-ox', ...regulatorFixture(0.0388, CdAregOx) },
      { id: 'SV-OX-01', type: 'valve', a: 'man-ox', b: 'line-ox', CdAmax: 5 * CDA_OX_INJ, tOpen: 0.05, tClose: 0.05, delay: 0.01 },
      { id: 'INJ-OX-01', type: 'orifice', a: 'line-ox', b: 'chamber', CdA: CDA_OX_INJ },
      reliefFixture('PSV-OX-01', 'man-ox', CdAregOx, 0.031998, 1.4),
      { id: 'PCV-FU-01', type: 'regulator', a: 'bot-fu', b: 'man-fu', ...regulatorFixture(0.0139, CdAregFu) },
      reliefFixture('PSV-FU-01', 'man-fu', CdAregFu, 0.016043, 1.31),
      { id: 'SV-FU-01', type: 'valve', a: 'man-fu', b: 'line-fu', CdAmax: 5 * CDA_FU_INJ, tOpen: 0.05, tClose: 0.05, delay: 0.01 },
      { id: 'INJ-FU-01', type: 'orifice', a: 'line-fu', b: 'chamber', CdA: CDA_FU_INJ },
      { id: 'SV-N2-01', type: 'valve', a: 'bot-n2', b: 'line-n2', CdAmax: CDA_FU_INJ, tOpen: 0.02, tClose: 0.02 },
      { id: 'CKV-N2-01', type: 'check', a: 'line-n2', b: 'chamber', CdA: 2 * CDA_FU_INJ, crack: 3 * PSI, reseat: 1 * PSI },
      { id: 'THROAT-01', type: 'orifice', a: 'chamber', b: 'amb', CdA: CDA_THROAT },
    ],
  };
}

/** A sequence over the cold-flow stand (fixture timings, not a proposed sequence). */
export const COLD_FLOW_SCHEDULE = [
  { t: 0.0, id: 'SV-N2-01', cmd: 'open' },
  { t: 0.3, id: 'SV-N2-01', cmd: 'close' },
  { t: 0.4, id: 'SV-OX-01', cmd: 'open' },
  { t: 0.45, id: 'SV-FU-01', cmd: 'open' },
  { t: 1.2, id: 'PCV-OX-01', cmd: { fault: 'open' } },
  { t: 1.4, id: 'SV-FU-01', cmd: 'close' },
  { t: 1.45, id: 'SV-OX-01', cmd: 'close' },
  { t: 1.5, id: 'SV-N2-01', cmd: 'open' },
];

/**
 * A hot-fire run on the hot-fire stand, for V-4, V-8 and the ignition checks. FIXTURE timings,
 * chosen to exercise the chamber model: they are not a proposed sequence, and the real hot-fire
 * sequence is Dalton's decision (brief §5.4). Ox valve leads the fuel valve by 50 ms; the igniter
 * is switched off after the main valves shut, then the purge runs.
 */
export const HOT_FIRE_FIXTURE = [
  { t: 0, id: 'HV-OX-01', cmd: 'open' },
  { t: 0, id: 'HV-FU-01', cmd: 'open' },
  { t: 0, id: 'HV-N2-01', cmd: 'open' },
  { t: 1.0, id: 'IGN-IG-01', cmd: 'on' },
  { t: 1.1, id: 'SV-OX-01', cmd: 'open' },
  { t: 1.15, id: 'SV-FU-01', cmd: 'open' },
  { t: 3.0, id: 'SV-FU-01', cmd: 'close' },
  { t: 3.05, id: 'SV-OX-01', cmd: 'close' },
  { t: 3.05, id: 'IGN-IG-01', cmd: 'off' },
  { t: 3.2, id: 'SV-N2-01', cmd: 'open' },
];
export const HOT_FIRE_FIXTURE_END = 3.6;

/**
 * The M5 abort table is the training table in data/trainingTables.js: one table serves the
 * self-test and the guide, so the lesson plays exactly what the self-test checks.
 */
export { TRAINING_ABORTS as ABORT_FIXTURE } from '../../data/trainingTables.js';
