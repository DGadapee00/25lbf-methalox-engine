/**
 * Number formatting for panels. The physics is SI throughout; this is the one place it is turned
 * into what the stand is read in. `setUnitSystem('us')` (the default: the gauges, the regulators and
 * PROJECT_PLAN are all in psia and lbf) or `'si'` flips every formatter at once.
 *
 * Each helper takes the SI value and returns a string with its unit. `digits` is significant figures.
 */
import { PSI, LBF, KELVIN_OFFSET } from '../physics/constants.js';

let system = 'us';

export function setUnitSystem(s) {
  system = s === 'si' ? 'si' : 'us';
}
export const unitSystem = () => system;

const SUPS = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** Plain-text scientific notation as a person writes it: 3.14 × 10⁻⁷, not 3.14e-7. */
export function sciText(x, digits = 2) {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 1e-300) return '0';
  const [m, e] = Number(x).toExponential(digits).split('e');
  return `${m} × 10${String(Number(e)).replace(/./g, (c) => SUPS[c])}`;
}

/** Significant figures without scientific notation for everyday magnitudes. */
export function sig(x, digits = 3) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-3) return sciText(x, digits - 1);
  return Number(x.toPrecision(digits)).toString();
}

/** Pressure, Pa in. Always absolute: 'psia', never 'psi', so gauge and absolute cannot be confused. */
export function fmtP(pa, digits = 4) {
  if (system === 'us') return `${sig(pa / PSI, digits)} psia`;
  return pa >= 1e6 ? `${sig(pa / 1e6, digits)} MPa` : `${sig(pa / 1e3, digits)} kPa`;
}

/** Temperature, K in. US shows °F with K alongside, since the CEA and property tables are in K. */
export function fmtT(k, digits = 4) {
  if (system === 'us') return `${sig(((k - KELVIN_OFFSET) * 9) / 5 + 32, digits)} °F (${sig(k, digits)} K)`;
  return `${sig(k, digits)} K`;
}

/** Mass flow, kg/s in, g/s out in both systems: the design point is written 52.7 g/s. */
export function fmtMdot(kgs, digits = 3) {
  return `${sig(kgs * 1e3, digits)} g/s`;
}

/** Force, N in. */
export function fmtF(n, digits = 3) {
  if (system === 'us') return `${sig(n / LBF, digits)} lbf`;
  return `${sig(n, digits)} N`;
}

/** Time, s in: ms below one second, where the startup transient lives. */
export function fmtTime(s, digits = 3) {
  if (!Number.isFinite(s)) return '—';
  return Math.abs(s) < 1 ? `${sig(s * 1e3, digits)} ms` : `${sig(s, digits)} s`;
}

/** Energy, J in: kJ from 1 kJ up. Below 1 mJ it is round-off, shown as 0. */
export function fmtE(j, digits = 3) {
  if (!Number.isFinite(j)) return '—';
  if (Math.abs(j) < 1e-3) return '0 J';
  return Math.abs(j) >= 1e3 ? `${sig(j / 1e3, digits)} kJ` : `${sig(j, digits)} J`;
}

/** Small masses, kg in, grams out. Below 1 µg it is round-off, shown as 0. */
export function fmtGrams(kg, digits = 3) {
  if (!Number.isFinite(kg)) return '—';
  return Math.abs(kg) < 1e-9 ? '0 g' : `${sig(kg * 1e3, digits)} g`;
}
