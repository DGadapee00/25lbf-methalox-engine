/**
 * Compressible orifice: the core flow element (brief §4.3). Every valve, regulator, check valve,
 * relief and injector circuit is this with a C_dA that changes.
 *
 * Upstream stagnation state (p₀ Pa, T₀ K, γ, R J/(kg·K)), downstream static pressure p (Pa),
 * r = p/p₀, critical ratio r* = (2/(γ+1))^(γ/(γ−1)).
 *
 *   choked,    r ≤ r*:  ṁ = C_dA · p₀ · √(γ/(R T₀)) · (2/(γ+1))^((γ+1)/(2(γ−1)))
 *   subsonic,  r > r*:  ṁ = C_dA · p₀ · √( 2γ/((γ−1) R T₀) · [r^(2/γ) − r^((γ+1)/γ)] )
 *
 * Both give the same value at r*, and the subsonic slope dṁ/dp is exactly zero there, so the law
 * is C¹ across the choke point (V-3). Node gas is at rest, so node static state is the stagnation
 * state.
 *
 * Near Δp → 0 the subsonic law goes like √Δp, whose slope is infinite at 0: an integrator taking a
 * Jacobian-free step there sees a flow that flips sign violently across a tiny Δp and stalls. Below
 * Δp_lin = LIN_FRAC · p_up the law is replaced by the odd cubic ṁ = a·x + b·x³, x = Δp/Δp_lin, with
 * a, b chosen so value AND slope match the true law at x = 1. It is monotone on [0, 1] (checked in
 * the self-test) and exact above the threshold. LIN_FRAC = 1e-3 (approved 2026-09-26): 0.48 psi at a
 * 480 psia manifold, far below anything a transducer on the stand resolves.
 *
 * Reverse flow is handled by sign: the higher-pressure side is upstream.
 */
import { INCH, PSI } from '../constants.js';

export const LIN_FRAC = 1e-3;

/** (2/(γ+1))^((γ+1)/(2(γ−1))): the choked-flow function Λ (dimensionless). */
export const lambda = (g) => Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));

/** Critical pressure ratio r* = p/p₀ at which the throat chokes (dimensionless). */
export const criticalRatio = (g) => Math.pow(2 / (g + 1), g / (g - 1));

/** Choked mass flux per unit C_dA, kg/(s·m²). */
export function chokedFlux(p0, T0, g, R) {
  return p0 * Math.sqrt(g / (R * T0)) * lambda(g);
}

/** Mass flux per unit C_dA for p ≤ p₀, kg/(s·m²), without regularization. */
export function flux(p0, T0, g, R, p) {
  const r = p / p0;
  if (r <= criticalRatio(g)) return chokedFlux(p0, T0, g, R);
  const phi = Math.pow(r, 2 / g) - Math.pow(r, (g + 1) / g);
  return p0 * Math.sqrt(((2 * g) / ((g - 1) * R * T0)) * Math.max(0, phi));
}

/** d(flux)/d(Δp) at fixed p₀, subsonic branch, kg/(s·m²·Pa). Zero when choked. */
function dFluxDdp(p0, T0, g, R, p) {
  const r = p / p0;
  if (r <= criticalRatio(g)) return 0;
  const C = (2 * g) / ((g - 1) * R * T0);
  const phi = Math.pow(r, 2 / g) - Math.pow(r, (g + 1) / g);
  const dphi = (2 / g) * Math.pow(r, 2 / g - 1) - ((g + 1) / g) * Math.pow(r, 1 / g);
  // Δp = p₀ − p, so d/dΔp = −(1/p₀)·d/dr.
  return -(Math.sqrt(C) * dphi) / (2 * Math.sqrt(phi));
}

/**
 * Regularized mass flux magnitude for upstream p₀ ≥ downstream p, kg/(s·m²).
 * Returns { flux, choked, lin }.
 */
export function regFlux(p0, T0, g, R, p) {
  const dp = p0 - p;
  const dpLin = LIN_FRAC * p0;
  if (dp >= dpLin) {
    return { flux: flux(p0, T0, g, R, p), choked: p / p0 <= criticalRatio(g), lin: false };
  }
  if (dp <= 0) return { flux: 0, choked: false, lin: true };
  const M = flux(p0, T0, g, R, p0 - dpLin);
  const S = dFluxDdp(p0, T0, g, R, p0 - dpLin) * dpLin; // slope in x units
  const b = (S - M) / 2;
  const a = M - b;
  const x = dp / dpLin;
  return { flux: a * x + b * x * x * x, choked: false, lin: true };
}

/**
 * Flow a → b through C_dA (m²) between two node states { p, T, gamma, R } (Pa, K, –, J/(kg·K)).
 * Returns { mdot (kg/s, + for a→b), fromA (true when a is upstream), choked, margin = p_up/p_down }.
 */
export function orificeFlow(CdA, sa, sb) {
  const fromA = sa.p >= sb.p;
  const up = fromA ? sa : sb;
  const pd = fromA ? sb.p : sa.p;
  const margin = pd > 0 ? up.p / pd : Infinity;
  if (!(CdA > 0) || !(up.p > 0)) return { mdot: 0, fromA, choked: false, margin };
  const f = regFlux(up.p, up.T, up.gamma, up.R, pd);
  const m = CdA * f.flux;
  return { mdot: fromA ? m : -m, fromA, choked: f.choked, margin };
}

/**
 * C_v → C_dA by liquid equivalence (brief §4.3). C_v is the flow of 60 °F water in US gal/min at a
 * 1 psi drop; setting that equal to C_dA·√(2ρΔp)/ρ gives
 *
 *   C_dA = C_v · (1 gal/min) / √(2 · 1 psi / ρ_w)   ≈ C_v · 1.698e-5 m²  ≈ C_v / 38.0 in²
 *
 * with 1 US gal = 231 in³ (exact) and ρ_w = 999.0 kg/m³ at 60 °F (15.56 °C). ρ_w is the value this
 * rests on: see PROVENANCE.md. The equivalence ignores a valve's pressure-recovery factor x_T, so for
 * gas service near choking it overstates what a ball valve passes; V-10 is pending a cited worked
 * example (see VALIDATION of the self-test).
 */
export const RHO_WATER_60F = 999.0;
export const GPM = (231 * INCH ** 3) / 60; // m³/s per US gal/min
export function cvToCdA(cv) {
  return (cv * GPM) / Math.sqrt((2 * PSI) / RHO_WATER_60F);
}
export const cdaToCv = (cda) => cda / cvToCdA(1);

/** C_dA (m²) that passes a rated choked flow ṁ (kg/s) at p₀, T₀ — relief valve sizing. */
export function cdaForChokedFlow(mdot, p0, T0, g, R) {
  return mdot / chokedFlux(p0, T0, g, R);
}
