/**
 * Species properties against published values. The NASA-7 fits come from GRI-Mech 3.0; the
 * references below are independent of it (NIST-JANAF Thermochemical Tables, 4th ed., M. W. Chase,
 * J. Phys. Chem. Ref. Data Monograph 9, 1998). Tolerances allow for the fits being a different
 * evaluation from JANAF's, not for errors in the code.
 */
import { approx, ok, section } from './harness.js';
import { nasa7Gas, massFractions, mixU, temperatureFromU, massesFromPTY, stateFromMasses, perfectGasGamma } from '../gas.js';

export function run() {
  section('Thermo · NASA-7 (GRI-Mech 3.0) against NIST-JANAF at 298.15 K');
  const g = nasa7Gas(['O2', 'CH4', 'N2']);
  const T = 298.15;
  const cpMolar = (name) => g.cp(g.names.indexOf(name), T) * g.W[g.names.indexOf(name)];
  const hMolar = (name) => g.h(g.names.indexOf(name), T) * g.W[g.names.indexOf(name)];
  // JANAF C°p(298.15 K), J/(mol·K): O2 29.376, N2 29.124, CH4 35.639.
  approx(cpMolar('O2'), 29.376, 0.003, 'O₂ c_p = 29.376 J/(mol·K) (JANAF), 0.3%');
  approx(cpMolar('N2'), 29.124, 0.003, 'N₂ c_p = 29.124 J/(mol·K) (JANAF), 0.3%');
  approx(cpMolar('CH4'), 35.639, 0.005, 'CH₄ c_p = 35.639 J/(mol·K) (JANAF), 0.5%');
  // Elements in their reference state have h = 0 at 298.15 K; CH4 carries ΔH_f = −74.873 kJ/mol.
  approx(hMolar('O2'), 0, 20, 'O₂ h(298.15 K) = 0 (reference element), within 20 J/mol');
  approx(hMolar('N2'), 0, 20, 'N₂ h(298.15 K) = 0 (reference element), within 20 J/mol');
  approx(hMolar('CH4'), -74873, 0.005, 'CH₄ h(298.15 K) = ΔH_f = −74.873 kJ/mol (JANAF), 0.5%');

  section('Thermo · mixtures and state inversion');
  const Y = massFractions(g, { O2: 0.6, CH4: 0.25, N2: 0.15 });
  let worst = 0;
  for (const TT of [150, 250, 300, 800, 999.999, 1000.001, 1500]) {
    worst = Math.max(worst, Math.abs(temperatureFromU(g, Y, mixU(g, Y, TT), 300) / TT - 1));
  }
  ok(worst < 1e-12, `T from u round-trips 150–1500 K on both sides of the 1000 K fit break (worst ${worst.toExponential(1)})`);
  // The low and high fits do not quite meet at 1000 K. A u inside the jump has no exact root;
  // temperatureFromU must return T_mid to within its 1e-3 K gap tolerance instead of throwing.
  const n2only = nasa7Gas(['N2']);
  const Yn = massFractions(n2only, { N2: 1 });
  const uLo = mixU(n2only, Yn, 1000 - 1e-9);
  const uHi = mixU(n2only, Yn, 1000);
  ok(Math.abs(uHi - uLo) < 1, `N₂ fit-break jump in u at 1000 K is < 1 J/kg (${Math.abs(uHi - uLo).toFixed(3)} J/kg)`);
  let gapT = NaN;
  try {
    gapT = temperatureFromU(n2only, Yn, (uLo + uHi) / 2, 900);
  } catch {
    // leaves NaN
  }
  ok(Math.abs(gapT - 1000) < 1e-3, `u inside the fit-break gap returns T_mid within 1e-3 K (got ${gapT})`);
  const s = massesFromPTY(g, 3.3e6, 293, Y, 2e-5);
  const back = stateFromMasses(g, s.m, s.U, 2e-5, 250);
  approx(back.p, 3.3e6, 1e-12, 'p, T → (m, U) → p round-trips');
  approx(back.T, 293, 1e-12, 'p, T → (m, U) → T round-trips');
  const n2 = stateFromMasses(nasa7Gas(['N2']), ...Object.values(massesFromPTY(nasa7Gas(['N2']), 1e5, 300, { N2: 1 }, 1)), 1, 300);
  approx(n2.gamma, 1.4, 0.002, 'N₂ γ ≈ 1.40 at 300 K');
  const pg = perfectGasGamma('X', 0.028, 1.31);
  const ps = stateFromMasses(pg, ...Object.values(massesFromPTY(pg, 1e5, 400, { X: 1 }, 1)), 1, 300);
  approx(ps.gamma, 1.31, 1e-12, 'perfectGasGamma keeps the γ it was given');
}
