/**
 * V-10: C_v → C_dA conversion, closed 2026-09-26 as verified by definition: C_v is defined as the
 * flow of 60 °F water in US gal/min at a 1 psi drop, and the conversion is that definition plus
 * exact unit factors, which is what is checked here.
 *
 * V-10b (open, blocked on D-5): gas service near choking depends on the valve's pressure-recovery
 * factor x_T, which liquid equivalence ignores. Once a valve is selected, check its gas sizing
 * against the vendor's published method.
 */
import { approx, section, pending } from './harness.js';
import { cvToCdA, cdaToCv, RHO_WATER_60F, GPM } from '../elements/orifice.js';
import { PSI, INCH } from '../constants.js';

export function run() {
  section('V-10 · C_v → C_dA (verified by definition)');
  // Definition: C_dA·√(2ρΔp) = ρ·Q at Q = C_v gal/min, Δp = 1 psi.
  const cda = cvToCdA(1);
  approx(RHO_WATER_60F * GPM, cda * Math.sqrt(2 * RHO_WATER_60F * PSI), 1e-12, 'C_v = 1 passes 1 gal/min of 60 °F water at 1 psi (definition)');
  approx(cda / INCH ** 2, 1 / 38.0, 0.001, `C_dA = C_v/${(1 / (cda / INCH ** 2)).toFixed(2)} in² (the commonly quoted C_v/38)`);
  approx(cdaToCv(cvToCdA(0.73)), 0.73, 1e-12, 'cdaToCv inverts cvToCdA');
  pending('V-10b gas-valve sizing (x_T) against the selected vendor\'s published method', 'blocked on D-5 (main valve actuation): no valve selected yet');
}
