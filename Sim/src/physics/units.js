/**
 * Dimensional analysis for the units registry (src/data/quantities.js).
 *
 * A dimension is the exponent vector [M, L, T, Θ] — mass, length, time, temperature. That covers
 * every quantity the stand shows: pressure is kg·m⁻¹·s⁻², mass flow kg·s⁻¹, a gas constant
 * m²·s⁻²·K⁻¹. Adapted from FLUX's version, which carried current (A) instead of temperature.
 *
 * The self-test parses every registered unit through this, so a typo in a unit string fails `npm
 * test` instead of reaching the panel.
 */

export const ZERO = [0, 0, 0, 0];

const mul = (a, b) => a.map((x, i) => x + b[i]);
const div = (a, b) => a.map((x, i) => x - b[i]);
const scale = (a, n) => a.map((x) => x * n);

export const dimEqual = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
export const isDimensionless = (a) => dimEqual(a, ZERO);

const M = [1, 0, 0, 0];
const L = [0, 1, 0, 0];
const T = [0, 0, 1, 0];
const K = [0, 0, 0, 1];

/** Unit name → dimension. Prefixed forms only matter for the dimension, so mm and m compare equal. */
export const UNITS = {
  kg: M,
  g: M,
  m: L,
  mm: L,
  cm: L,
  s: T,
  ms: T,
  K,
  N: [1, 1, -2, 0],
  J: [1, 2, -2, 0],
  W: [1, 2, -3, 0],
  Pa: [1, -1, -2, 0],
  '': ZERO,
  '1': ZERO,
};

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁻': '-' };

/**
 * "J/(kg*K)" → [0, 2, -2, -1]. Understands ·, *, a space, /, parentheses, and exponents written
 * `^2` or `²`. A `/` divides by the one factor that follows it, so "J/(kg·K)" groups as written.
 */
export function parseUnit(src) {
  const s = String(src ?? '')
    .replace(/[⁰¹²³⁴⁵⁶⁻]/g, (ch) => (ch === '⁻' ? '^-' : `^${SUP[ch]}`))
    .replace(/·|\*/g, ' ')
    .trim();
  if (!s) return ZERO;
  const toks = [...s.matchAll(/\s*([A-Za-z]+(?:\^-?\d+(?:\.\d+)?)?|1|\(|\)|\/)/g)].map((m) => m[1]);
  if (!toks.length) throw new Error(`Unit "${src}": nothing to read`);
  let i = 0;

  function factor() {
    const t = toks[i++];
    if (t === undefined) throw new Error(`Unit "${src}": ends too early`);
    if (t === '(') {
      const d = group();
      if (toks[i++] !== ')') throw new Error(`Unit "${src}": missing )`);
      return d;
    }
    const m = /^([A-Za-z]+|1)(?:\^(-?\d+(?:\.\d+)?))?$/.exec(t);
    if (!m) throw new Error(`Unit "${src}": cannot read "${t}"`);
    const base = UNITS[m[1]];
    if (!base) throw new Error(`Unit "${src}": unknown unit "${m[1]}"`);
    return scale(base, m[2] ? Number(m[2]) : 1);
  }

  function group() {
    let dim = ZERO;
    let first = true;
    while (i < toks.length && toks[i] !== ')') {
      if (toks[i] === '/') {
        i++;
        dim = div(dim, factor());
      } else {
        dim = first ? factor() : mul(dim, factor());
      }
      first = false;
    }
    return dim;
  }

  const dim = group();
  if (i !== toks.length) throw new Error(`Unit "${src}": cannot read "${toks.slice(i).join(' ')}"`);
  return dim;
}

export { mul as dimMul, div as dimDiv, scale as dimScale };
