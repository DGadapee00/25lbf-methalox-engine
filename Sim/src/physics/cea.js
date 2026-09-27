/**
 * GOX/GCH₄ chamber equilibrium from the CEA table (brief §4.4, §4.8). The table is generated
 * offline by Phase1_Calculations/cea/cea_table.py (RocketCEA, shifting equilibrium, ε = 3) into
 * data/cea_gox_gch4.json; nothing here computes chemistry.
 *
 * ceaLookup(OF, Pc) → { cstar (m/s), Tc (K), M (kg/mol), gamma, CFvac, PcOvPe } at mixture ratio
 * O/F (mass, oxidizer/fuel) and chamber pressure Pc (Pa). Bilinear in (O/F, ln Pc), which is how
 * CEA's properties vary most nearly linearly across a cell. Outside the grid (O/F 1.2–40,
 * P_c 10–1000 psia) the value is clamped to the edge: the chamber reads the edge, it does not
 * extrapolate chemistry. `clamped` says when that happened.
 *
 * Interpolation error is measured, not assumed: the JSON carries off-grid points computed directly
 * by CEA (`checks`), and the self-test compares the lookup against them.
 */
import cea from '../../data/cea_gox_gch4.json' with { type: 'json' };

export const CEA = cea;
const FIELDS = ['cstar', 'Tc', 'M', 'gamma', 'CFvac', 'PcOvPe'];
const OF = cea.OF;
const LNP = cea.Pc.map((p) => Math.log(p));

/** Index i and weight w with x between grid[i] and grid[i + 1] (clamped). */
function bracket(grid, x) {
  const n = grid.length;
  if (!(x > grid[0])) return { i: 0, w: 0, clamped: x < grid[0] };
  if (x >= grid[n - 1]) return { i: n - 2, w: 1, clamped: x > grid[n - 1] };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid] <= x) lo = mid;
    else hi = mid;
  }
  return { i: lo, w: (x - grid[lo]) / (grid[lo + 1] - grid[lo]), clamped: false };
}

/** Chamber equilibrium at O/F (–) and P_c (Pa). */
export function ceaLookup(of, pc, out = {}) {
  const a = bracket(OF, of);
  const b = bracket(LNP, Math.log(Math.max(pc, 1)));
  for (const f of FIELDS) {
    const t = cea.table[f];
    const v00 = t[a.i][b.i];
    const v01 = t[a.i][b.i + 1];
    const v10 = t[a.i + 1][b.i];
    const v11 = t[a.i + 1][b.i + 1];
    out[f] = (1 - a.w) * ((1 - b.w) * v00 + b.w * v01) + a.w * ((1 - b.w) * v10 + b.w * v11);
  }
  out.clamped = a.clamped || b.clamped;
  return out;
}

/** Γ(γ) = √γ · (2/(γ+1))^((γ+1)/(2(γ−1))): c* = √(RT)/Γ for a perfect gas (dimensionless). */
export function vandenkerckhove(g) {
  return Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
}

/** Range of the table, for labels: { OF: [lo, hi], Pc: [lo, hi] (Pa) }. */
export const ceaRange = { OF: [OF[0], OF[OF.length - 1]], Pc: [cea.Pc[0], cea.Pc[cea.Pc.length - 1]] };
