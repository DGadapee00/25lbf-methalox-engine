/**
 * Pressure regulator (brief §4.3), dome- or spring-loaded, as a variable orifice whose opening is
 * driven by outlet-pressure error.
 *
 * Set-point convention (changed 2026-09-26): **p_set is the flowing outlet pressure at rated
 * flow**, the number a regulator is adjusted to on the stand. Lockup, the no-flow pressure, lies
 * above it by the droop:
 *
 *   p_lockup = p_set + droop          (give `droop`, or give `pLockup` and droop is derived)
 *
 * Parameters (SI): pSet (Pa), mdotRated (kg/s), droop or pLockup (Pa), CdAmax (m²), tau (s),
 * pSupplyRef (Pa, the supply pressure the rating applies at; default: the supply node's initial
 * pressure), spe (supply-pressure effect, Pa/Pa, default 0), z0, fault.
 *
 * Law, with poppet opening z ∈ [0, 1] as the ODE state:
 *
 *   τ dz/dt = z_cmd − z
 *   z_cmd = clamp( K · (p_lockup,eff − p_out), 0, 1 )
 *   p_lockup,eff = p_lockup + SPE · (p_supply,ref − p_supply)
 *   C_dA = z · C_dA_max
 *
 * K and the rated opening z_r are derived from the rating (regulatorDerive): at rated flow from
 * p_supply,ref the poppet must open to z_r = ṁ_r / (C_dA_max · flux(p_supply,ref → p_set)), and
 * the steady law z_r = K · droop fixes K. So a regulator passing its rated flow from its reference
 * supply holds exactly p_set, and with no flow it locks up at p_lockup. The self-test checks both.
 *
 * - Supply-pressure effect: with this sign, SPE > 0 means the outlet rises as the supply falls,
 *   as a single-stage regulator typically does. It is a datasheet property; there is no default.
 * - Faults: 'open' (C_dA = C_dA_max whatever the poppet), 'closed' (C_dA = 0), or
 *   { creep: C_dA }, a seat leak: the larger of creep and the poppet's own area.
 * - Joule–Thomson cooling (M4) is the network's, not this element's: with `jt: true` on the edge
 *   (or the { jt } command) the outlet gas is delivered at its real-gas isenthalpic temperature
 *   (physics/jt.js). Off by default: then throttling is isenthalpic ideal gas and T is unchanged.
 *
 * The clamp makes z_cmd non-smooth where it saturates; the adaptive step shrinks through those
 * kinks rather than locating them as events. See docs/solver.md §5 for when this loop rings.
 */
import { regFlux } from './orifice.js';

/**
 * Derive K (1/Pa), z_r, droop and p_lockup (Pa) from the rating, for a supply state
 * { p, T, gamma, R } (the supply node at the start; p is replaced by pSupplyRef if given).
 * Throws if the rating is inconsistent (both or neither of droop/pLockup, z_r > 1, droop ≤ 0).
 */
export function regulatorDerive(e, supply) {
  const has = (k) => e[k] !== undefined && e[k] !== null;
  if (has('droop') === has('pLockup')) throw new Error(`regulator ${e.id}: give exactly one of droop or pLockup`);
  for (const k of ['pSet', 'mdotRated', 'CdAmax', 'tau']) if (!(e[k] > 0)) throw new Error(`regulator ${e.id}: ${k} must be > 0`);
  const droop = has('droop') ? e.droop : e.pLockup - e.pSet;
  if (!(droop > 0)) throw new Error(`regulator ${e.id}: lockup must lie above the set point (droop > 0)`);
  const pRef = e.pSupplyRef ?? supply.p;
  if (!(pRef > e.pSet)) throw new Error(`regulator ${e.id}: supply reference ${pRef} Pa must exceed the set point`);
  const flux = regFlux(pRef, supply.T, supply.gamma, supply.R, e.pSet).flux;
  const zRated = e.mdotRated / (e.CdAmax * flux);
  if (zRated > 1) throw new Error(`regulator ${e.id}: rated flow needs z = ${zRated.toFixed(2)} > 1; C_dA_max too small`);
  return { K: zRated / droop, zRated, droop, pLockup: e.pSet + droop, pSupplyRef: pRef };
}

/** Commanded opening for outlet p_out and supply p_supply (Pa), given derived values `r`. */
export function regulatorCmd(e, r, pLockup, pOut, pSupply) {
  const pL = pLockup + (e.spe ?? 0) * (r.pSupplyRef - pSupply);
  return Math.max(0, Math.min(1, r.K * (pL - pOut)));
}

/** Effective C_dA (m²) for poppet opening z and the current fault. */
export function regulatorCdA(e, z, fault) {
  if (fault === 'open') return e.CdAmax;
  if (fault === 'closed') return 0;
  const a = Math.max(0, Math.min(1, z)) * e.CdAmax;
  return fault && fault.creep ? Math.max(a, fault.creep) : a;
}
