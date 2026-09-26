/**
 * Pressure regulator (brief §4.3), dome- or spring-loaded, as a variable orifice whose opening is
 * driven by outlet-pressure error.
 *
 *   poppet opening z ∈ [0, 1] (ODE state):   τ dz/dt = z_cmd − z
 *   z_cmd = clamp( K · (p_set,eff − p_out), 0, 1 )
 *   p_set,eff = p_set + SPE · (p_supply,ref − p_supply)
 *   C_dA = z · C_dA_max
 *
 * - Droop falls out of the proportional law: more flow needs more opening, which needs more error.
 *   regulatorGain() maps a datasheet-style "droop Δp at rated flow" to K.
 * - Supply-pressure effect: SPE (dimensionless, outlet Pa per supply Pa). For a single-stage
 *   regulator the outlet typically *rises* as the supply falls, i.e. SPE > 0 with this sign. The
 *   value is a datasheet property; there is no default.
 * - Lockup: with p_out ≥ p_set,eff the poppet closes (z → 0) and the outlet holds.
 * - Faults: 'open' (C_dA = C_dA_max whatever the poppet), 'closed' (C_dA = 0), or
 *   { creep: C_dA } — a seat leak, the larger of creep and the poppet's own area.
 * - Joule–Thomson cooling is not modelled yet (M4): throttling here is isenthalpic ideal gas, so
 *   T is unchanged across the valve.
 *
 * The clamp makes z_cmd non-smooth where it saturates; the adaptive step shrinks through those
 * kinks rather than locating them as events. See docs/solver.md for when this loop rings.
 */
import { chokedFlux } from './orifice.js';

export function regulatorCmd(e, pOut, pSupply) {
  const pSet = e.pSet + (e.spe ?? 0) * ((e.pSupplyRef ?? pSupply) - pSupply);
  return Math.max(0, Math.min(1, e.K * (pSet - pOut)));
}

/** Effective C_dA (m²) for poppet opening z and the current fault. */
export function regulatorCdA(e, z, fault) {
  if (fault === 'open') return e.CdAmax;
  if (fault === 'closed') return 0;
  const a = Math.max(0, Math.min(1, z)) * e.CdAmax;
  return fault && fault.creep ? Math.max(a, fault.creep) : a;
}

/**
 * Gain K (1/Pa) that gives `droop` (Pa) below p_set at rated flow `mdot` (kg/s), for a choked
 * poppet fed from { p, T, gamma, R } supply: the opening needed is z = ṁ/(C_dA_max·flux), and the
 * steady law z = K·droop gives K = z/droop.
 */
export function regulatorGain({ droop, mdot, CdAmax, supply }) {
  const z = mdot / (CdAmax * chokedFlux(supply.p, supply.T, supply.gamma, supply.R));
  if (z > 1) throw new Error(`regulatorGain: rated flow needs z = ${z.toFixed(2)} > 1; C_dA_max too small`);
  return z / droop;
}
