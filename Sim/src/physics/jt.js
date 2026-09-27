/**
 * Joule–Thomson temperature drop across a regulator (brief §4.3). Throttling is isenthalpic; an
 * ideal gas keeps its temperature, a real gas at bottle pressure does not. Along the isenthalp
 *
 *   dT/dp = μ_JT(p, T)        (K/Pa)
 *
 * integrated from the supply (p_in, T_in) down to the outlet pressure p_out, with μ_JT from
 * CoolProp's reference equations of state (tools/props.py → data/props.json). Classical RK4 in p,
 * JT_STEPS steps: the self-test compares the result with CoolProp's own (h, p) flash, a different
 * path through the same equation of state.
 *
 * Mixtures: μ_JT is the mole-fraction average of the pure gases (O₂, CH₄, N₂). The bottles hold
 * pure gases, so this only matters for mixed nodes, where it is an approximation. Species the table
 * does not have (combustion products) are left out of the average.
 *
 * Grid: T 200–360 K, p 0.1–20 MPa, bilinear in (T, ln p), clamped at the edges.
 */
import props from '../../data/props.json' with { type: 'json' };

export const PROPS = props;
const TG = props.T;
const LNP = props.p.map((p) => Math.log(p));
export const JT_STEPS = 16;

function bracket(grid, x) {
  const n = grid.length;
  if (!(x > grid[0])) return [0, 0];
  if (x >= grid[n - 1]) return [n - 2, 1];
  let i = 0;
  while (grid[i + 1] <= x) i++;
  return [i, (x - grid[i]) / (grid[i + 1] - grid[i])];
}

/** μ_JT of one gas (K/Pa) at p (Pa), T (K). */
export function muJT(gasKey, p, T) {
  const t = props.mu_JT[gasKey];
  if (!t) throw new Error(`muJT: no table for ${gasKey}`);
  const [i, a] = bracket(TG, T);
  const [j, b] = bracket(LNP, Math.log(Math.max(p, 1)));
  return (1 - a) * ((1 - b) * t[i][j] + b * t[i][j + 1]) + a * ((1 - b) * t[i + 1][j] + b * t[i + 1][j + 1]);
}

/**
 * Mixture weights for μ_JT from a gas and its mass fractions Y: [[key, moleFraction], …] over the
 * species that have a table. Returns [] when none do.
 */
export function jtWeights(gas, Y) {
  let n = 0;
  const parts = [];
  for (let i = 0; i < gas.n; i++) {
    if (!(Y[i] > 0) || !props.mu_JT[gas.names[i]]) continue;
    const moles = Y[i] / gas.W[i];
    parts.push([gas.names[i], moles]);
    n += moles;
  }
  return n > 0 ? parts.map(([k, m]) => [k, m / n]) : [];
}

function muMix(weights, p, T) {
  let mu = 0;
  for (const [k, x] of weights) mu += x * muJT(k, p, T);
  return mu;
}

/** Outlet temperature (K) of an isenthalpic throttle from (pIn Pa, TIn K) to pOut Pa. */
export function jtOutletT(weights, pIn, TIn, pOut) {
  if (!weights.length || !(pIn > pOut)) return TIn;
  const h = (pOut - pIn) / JT_STEPS;
  let T = TIn;
  let p = pIn;
  for (let k = 0; k < JT_STEPS; k++) {
    const k1 = muMix(weights, p, T);
    const k2 = muMix(weights, p + h / 2, T + (h / 2) * k1);
    const k3 = muMix(weights, p + h / 2, T + (h / 2) * k2);
    const k4 = muMix(weights, p + h, T + h * k3);
    T += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    p += h;
  }
  return T;
}
