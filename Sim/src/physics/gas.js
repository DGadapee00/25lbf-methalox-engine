/**
 * Ideal-gas mixture properties (brief §4.2). SI, per unit mass: cp in J/(kg·K), h and u in J/kg,
 * R in J/(kg·K), W in kg/mol.
 *
 * Two property models share one interface, so every element and node works with either:
 *
 *   nasa7Gas(names)   c_p(T) and h(T) from NASA 7-coefficient polynomials (GRI-Mech 3.0, generated
 *                     into data/thermo_nasa7.json by tools/nasa7.py). h is absolute: it includes
 *                     the heat of formation, so mixing reacting species later (M4) needs no change.
 *   perfectGas(specs) calorically perfect gases, constant c_p. It exists because the closed-form
 *                     blowdown solutions (V-1, V-2) are for constant γ, and a test against a
 *                     closed form is only a test if the model matches the form's assumptions.
 *
 * A liquid model would plug in behind the same state functions (massesFromPTY / stateFromMasses);
 * the network only ever asks a node for p, T, h and the upstream orifice properties.
 */
import thermo from '../../data/thermo_nasa7.json' with { type: 'json' };
import cea from '../../data/cea_gox_gch4.json' with { type: 'json' };
import { R_U } from './constants.js';

/** Reference temperature for perfectGas enthalpy, K (standard state, 25 °C). */
export const T_REF = 298.15;

/**
 * Burned gas, as two bookkeeping species. A burning chamber (physics/chamber.js) turns the O₂ and
 * CH₄ it receives into PRODox and PRODfu: the same mass, labelled by which propellant it came from,
 * so the chamber's mixture ratio is PRODox/PRODfu and every element is conserved. While the chamber
 * burns, its state comes from the CEA table, not from these properties. They matter only where
 * burned gas sits outside a burning chamber (the chamber after shutdown, a line after backflow,
 * the ambient accumulator): there it is a calorically perfect gas with the chamber's molar mass and
 * frozen c_p at the CEA design point (PROJECT_PLAN §2.1: 250 psia, O/F 2.8), h = c_p (T − T_REF).
 * An approximation, stated in docs/solver.md §7.
 */
export const PRODUCTS = ['PRODox', 'PRODfu'];
const PRODUCT_REC = { W: cea.design_point.M, cp: cea.design_point.cp_frozen };

export function nasa7Gas(names = ['O2', 'CH4', 'N2']) {
  const recs = names.map((n) => {
    if (PRODUCTS.includes(n)) return { product: true, W: PRODUCT_REC.W };
    const r = thermo.species[n];
    if (!r) throw new Error(`nasa7Gas: no thermo data for "${n}" (data/thermo_nasa7.json)`);
    return r;
  });
  const W = recs.map((r) => r.W);
  const R = W.map((w) => R_U / w);
  const coeffs = (r, T) => (T < r.T_mid ? r.low : r.high);
  return {
    model: 'nasa7',
    names,
    n: names.length,
    W,
    R,
    /** Validity range per species, K. Outside it the polynomials extrapolate. */
    range: recs.map((r) => (r.product ? [0, Infinity] : [r.T_low, r.T_high])),
    cp(i, T) {
      if (recs[i].product) return PRODUCT_REC.cp;
      const a = coeffs(recs[i], T);
      return R[i] * (a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4]))));
    },
    h(i, T) {
      if (recs[i].product) return PRODUCT_REC.cp * (T - T_REF);
      const a = coeffs(recs[i], T);
      return R[i] * T * (a[0] + T * (a[1] / 2 + T * (a[2] / 3 + T * (a[3] / 4 + (T * a[4]) / 5)))) + R[i] * a[5];
    },
  };
}

/** specs: [{ name, W (kg/mol), cp (J/(kg·K)) }]. h = cp·(T − T_REF), so h(T_REF) = 0. */
export function perfectGas(specs) {
  const W = specs.map((s) => s.W);
  const R = W.map((w) => R_U / w);
  const cp = specs.map((s) => s.cp);
  return {
    model: 'perfect',
    names: specs.map((s) => s.name),
    n: specs.length,
    W,
    R,
    range: specs.map(() => [0, Infinity]),
    cp: (i) => cp[i],
    h: (i, T) => cp[i] * (T - T_REF),
  };
}

/** Perfect gas with a chosen γ and molar mass: cp = γR/(γ−1). For tests against closed forms. */
export function perfectGasGamma(name, W, gamma) {
  const R = R_U / W;
  return perfectGas([{ name, W, cp: (gamma * R) / (gamma - 1) }]);
}

/** Mass fractions from a { name: fraction } map (normalized), as a Float64Array in gas order. */
export function massFractions(gas, Y) {
  const out = new Float64Array(gas.n);
  let sum = 0;
  for (const [k, v] of Object.entries(Y)) {
    const i = gas.names.indexOf(k);
    if (i < 0) throw new Error(`massFractions: "${k}" is not in this gas (${gas.names.join(', ')})`);
    out[i] = v;
    sum += v;
  }
  if (!(sum > 0)) throw new Error('massFractions: fractions must sum to a positive number');
  for (let i = 0; i < gas.n; i++) out[i] /= sum;
  return out;
}

export function mixR(gas, Y) {
  let r = 0;
  for (let i = 0; i < gas.n; i++) r += Y[i] * gas.R[i];
  return r;
}
export function mixCp(gas, Y, T) {
  let c = 0;
  for (let i = 0; i < gas.n; i++) if (Y[i]) c += Y[i] * gas.cp(i, T);
  return c;
}
export function mixH(gas, Y, T) {
  let h = 0;
  for (let i = 0; i < gas.n; i++) if (Y[i]) h += Y[i] * gas.h(i, T);
  return h;
}
/** u = h − RT for an ideal gas. */
export const mixU = (gas, Y, T) => mixH(gas, Y, T) - mixR(gas, Y) * T;

/**
 * Temperature from specific internal energy, by Newton on u(T) − u = 0 with du/dT = c_v.
 * c_v > 0 everywhere, so u(T) is monotone and the root is unique; Newton from a nearby guess
 * converges in 2–4 iterations. Tolerance 1e-10 K: far below anything the integrator resolves.
 *
 * One exception: the NASA-7 low and high fits meet at T_mid (1000 K) with a small jump in h
 * (GRI-Mech N₂: 0.19 J/kg, i.e. 2e-4 K of c_v). A u inside that gap has no exact root, and Newton
 * bounces between the two fits. When it is bouncing by less than GAP_TOL it has found the break,
 * and T_mid's neighbourhood is returned — an error of < GAP_TOL K, tested in the self-test.
 */
const GAP_TOL = 1e-3; // K

/**
 * Thrown when conserved quantities describe no physical gas state (u below u(T_MIN), a
 * non-finite value). This happens inside a too-large trial Runge–Kutta stage, never in an
 * accepted state; the driver catches it and rejects the step with a smaller h.
 */
export class NonPhysicalState extends Error {}
/** Lowest temperature a gas node may take, K. Well below anything a GOX/GCH₄ stand reaches. */
export const T_MIN = 20;

export function temperatureFromU(gas, Y, u, Tguess = 300) {
  const R = mixR(gas, Y);
  if (!Number.isFinite(u)) throw new NonPhysicalState(`temperatureFromU: u = ${u}`);
  if (mixH(gas, Y, T_MIN) - R * T_MIN > u) throw new NonPhysicalState(`temperatureFromU: u = ${u} J/kg is below u(${T_MIN} K)`);
  let T = Tguess > 0 && Number.isFinite(Tguess) ? Tguess : 300;
  let dT = Infinity;
  for (let k = 0; k < 60; k++) {
    const f = mixH(gas, Y, T) - R * T - u;
    const cv = mixCp(gas, Y, T) - R;
    dT = f / cv;
    // Never step below T_MIN (the root is above it, checked on entry): bisect toward it instead.
    T = T - dT > T_MIN ? T - dT : (T + T_MIN) / 2;
    if (Math.abs(dT) < 1e-10) return T;
    if (k >= 20 && Math.abs(dT) < GAP_TOL) return T;
  }
  throw new Error(`temperatureFromU: no convergence (u = ${u} J/kg, last T = ${T} K, last step ${dT} K)`);
}

/** Species masses (kg) and internal energy (J) of volume V (m³) filled at p (Pa), T (K), Y. */
export function massesFromPTY(gas, p, T, Y, V) {
  const Yv = Y instanceof Float64Array ? Y : massFractions(gas, Y);
  const R = mixR(gas, Yv);
  const m = (p * V) / (R * T);
  const masses = Float64Array.from(Yv, (y) => y * m);
  return { m: masses, U: m * mixU(gas, Yv, T) };
}

/**
 * Thermodynamic state of a control volume from its conserved quantities: species masses (kg),
 * internal energy U (J) and volume V (m³). `Tguess` seeds Newton (pass the last T).
 * Returns { mass, Y, T, p, R, cp, gamma, h } — h is the specific enthalpy an outflow carries.
 */
export function stateFromMasses(gas, masses, U, V, Tguess) {
  let mass = 0;
  for (let i = 0; i < gas.n; i++) mass += masses[i];
  const Y = new Float64Array(gas.n);
  if (!(mass > 0)) return { mass: 0, Y, T: Tguess || 300, p: 0, R: 0, cp: 0, gamma: 1.4, h: 0 };
  for (let i = 0; i < gas.n; i++) Y[i] = Math.max(0, masses[i]) / mass;
  const T = temperatureFromU(gas, Y, U / mass, Tguess);
  return stateFromPTY(gas, (mass * mixR(gas, Y) * T) / V, T, Y, mass);
}

/** The same record at a fixed T (isothermal nodes, ambient boundaries). */
export function stateFromPTY(gas, p, T, Y, mass = NaN) {
  const R = mixR(gas, Y);
  const cp = mixCp(gas, Y, T);
  return { mass, Y, T, p, R, cp, gamma: cp / (cp - R), h: mixH(gas, Y, T) };
}
