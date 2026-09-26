/**
 * V-10: C_v → C_dA conversion. The conversion is derived from the definition of C_v (US gal/min
 * of 60 °F water at a 1 psi drop), and that derivation is checked here. The brief also asks for a
 * published worked example: none has been cited and reviewed yet, so that half is reported as
 * PENDING, not passed. Replace the pending line with the example (source, page, numbers) once
 * Dalton has checked it.
 */
import { approx, section, pending } from './harness.js';
import { cvToCdA, cdaToCv, RHO_WATER_60F, GPM } from '../elements/orifice.js';
import { PSI, INCH } from '../constants.js';

export function run() {
  section('V-10 · C_v → C_dA');
  // Definition: C_dA·√(2ρΔp) = ρ·Q at Q = C_v gal/min, Δp = 1 psi.
  const cda = cvToCdA(1);
  approx(RHO_WATER_60F * GPM, cda * Math.sqrt(2 * RHO_WATER_60F * PSI), 1e-12, 'C_v = 1 passes 1 gal/min of 60 °F water at 1 psi (definition)');
  approx(cda / INCH ** 2, 1 / 38.0, 0.001, `C_dA = C_v/${(1 / (cda / INCH ** 2)).toFixed(2)} in² (the commonly quoted C_v/38)`);
  approx(cdaToCv(cvToCdA(0.73)), 0.73, 1e-12, 'cdaToCv inverts cvToCdA');
  pending('V-10 published worked example', 'IEC 60534-2-1 / ISA-75.01.01 Annex D not reachable from the sandbox; transcribe the incompressible example (see VALIDATION.md)');
}
