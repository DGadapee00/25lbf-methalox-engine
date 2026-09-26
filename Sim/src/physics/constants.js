/**
 * Physical constants and unit factors. SI everywhere inside the sim; these are the only place a
 * US-customary factor appears, so the display layer (src/ui/format.js) and any input parser convert
 * through the same numbers.
 *
 * Every value here is exact by definition, which is why none of them needs a table entry in
 * PROVENANCE.md beyond the definition cited on its line.
 */

/** Standard gravity, m/s². Exact (3rd CGPM, 1901). Used only to put I_sp in seconds. */
export const G0 = 9.80665;

/** Molar gas constant, J/(mol·K). Exact since the 2019 SI redefinition (N_A·k_B, CODATA 2018). */
export const R_U = 8.314462618;

/** Standard atmosphere, Pa. Exact (ISO 2533 / ICAO). */
export const P_ATM = 101325;

/** International inch, m. Exact (1959 international yard and pound agreement). */
export const INCH = 0.0254;

/** Pound-mass, kg. Exact (1959 agreement). */
export const LBM = 0.45359237;

/** Pound-force, N: one pound-mass under standard gravity. Exact by construction. */
export const LBF = LBM * G0;

/** Pound-force per square inch, Pa (≈ 6894.757). Exact by construction. */
export const PSI = LBF / (INCH * INCH);

/** Absolute zero offset, K ↔ °C. Exact. */
export const KELVIN_OFFSET = 273.15;
