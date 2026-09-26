/**
 * Relief valve with proportional lift (brief §4.3; model changed 2026-09-26 from on/off).
 *
 * Lift L ∈ [0, 1] scales the flow area, C_dA = L · C_dA_rated. Against Δp = p_a − p_b (Pa):
 *
 *   rising curve   L_up(Δp) = clamp( (Δp − p_set) / (acc · p_set), 0, 1 )
 *                  0 at the set (cracking) pressure, full lift at set + accumulation
 *   falling curve  L_dn(Δp) = clamp( (Δp − p_reseat) / (p_full − p_reseat), 0, 1 )
 *                  p_reseat = p_set · (1 − blowdown), p_full = p_set · (1 + acc)
 *
 * L_dn ≥ L_up everywhere, and the two meet at 0 lift below reseat and at full lift above p_full.
 * Between them the valve holds its lift: rising pressure opens it along L_up, falling pressure
 * closes it along L_dn, and it only reseats once Δp is back down to p_reseat. That is the
 * blowdown hysteresis, as a continuous loop rather than an on/off switch, so a relief modulates
 * at the flow it has to pass instead of chattering.
 *
 * The lift follows that target through a first-order lag τ_lift (s):
 *
 *   τ_lift dL/dt = clamp(L, L_up, L_dn) − L
 *
 * so it is an ODE state and needs no event handling. τ_lift is the valve's lift response time.
 * That is a datasheet property; the lag is also what keeps the loop continuous in time, so it
 * must be > 0. Chatter (M5) is read from L(t): repeated excursions between 0 and the upper part
 * of the loop.
 *
 * Parameters: CdA (m², at full lift), set (Pa, Δp), accumulation (fraction, default 0.10 —
 * Dalton's decision, 2026-09-26), blowdown (fraction, 0 < blowdown < 1), tauLift (s), L0.
 */
export const ACCUMULATION_DEFAULT = 0.1;

export function reliefCurves(e) {
  const acc = e.accumulation ?? ACCUMULATION_DEFAULT;
  const pFull = e.set * (1 + acc);
  const pReseat = e.set * (1 - e.blowdown);
  return { acc, pFull, pReseat };
}

/** Target lift for current lift L and Δp (Pa), from the two curves. */
export function reliefTarget(e, c, L, dp) {
  const up = Math.max(0, Math.min(1, (dp - e.set) / (c.acc * e.set)));
  const dn = Math.max(0, Math.min(1, (dp - c.pReseat) / (c.pFull - c.pReseat)));
  return Math.max(up, Math.min(dn, L));
}

export function reliefValidate(e) {
  if (!(e.set > 0)) throw new Error(`relief ${e.id}: set must be > 0 Pa`);
  if (!(e.blowdown > 0 && e.blowdown < 1)) throw new Error(`relief ${e.id}: blowdown must be in (0, 1)`);
  const acc = e.accumulation ?? ACCUMULATION_DEFAULT;
  if (!(acc > 0)) throw new Error(`relief ${e.id}: accumulation must be > 0`);
  if (!(e.tauLift > 0)) throw new Error(`relief ${e.id}: tauLift must be > 0 s (the lift response time)`);
}
