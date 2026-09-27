/**
 * Combustion chamber (brief §4.4): the chamber node's state when it burns, the ignition and
 * extinction tests, thrust, and the unburned-propellant metric. network.js owns the node; this
 * module is the physics it calls. SI throughout.
 *
 * A chamber node is a control volume with a combustion flag.
 *
 * Before ignition it is an ordinary ideal-gas volume holding O₂, CH₄ and N₂ (plus any burned gas
 * left from an earlier burn). The accumulated unburned propellant, and the heat it would release,
 * is the hard-start metric (R-4):
 *
 *   E_unburned = LHV_CH₄ · min(m_CH₄, m_O₂ / s),   s = 2 W_O₂ / W_CH₄ (stoichiometric O/F)
 *
 * LHV comes from the NASA-7 formation enthalpies at 298.15 K (CH₄ + 2 O₂ → CO₂ + 2 H₂O(g)).
 *
 * Ignition needs the igniter on, no "no-light" fault, and a flammable chamber gas: CH₄ mole
 * fraction inside the limits of CH₄ in O₂ and O₂ at or above the limiting oxygen concentration
 * (data/flammability.json, Zabetakis 1965). At ignition everything unburned in the chamber burns at
 * once: O₂ becomes PRODox and CH₄ becomes PRODfu, mass for mass. The pressure jumps to the
 * equilibrium state of that mixture. Real ignition takes time, so the jump is the size of the
 * spike, not its shape.
 *
 * Burning, propellant is converted as it arrives, and the chamber state is the CEA table's at the
 * contents' mixture ratio O/F = m_PRODox / m_PRODfu and the chamber pressure:
 *
 *   c* = η_c* · c*_CEA(O/F, P_c)       (brief §4.4; η_c* = 0.92, PROJECT_PLAN §2.1)
 *   (RT)_eff = (c* Γ(γ))²              so the throat's choked flow is exactly P_c A_t / c*
 *   P_c = (m_b + m_inert R_inert/R_b) · (RT)_eff / V
 *
 * R_b = R_u / M_CEA. P_c appears on both sides through the table, so it is solved by fixed-point
 * iteration: c* changes by about 1% per doubling of P_c, and it converges in a few passes. Inert gas
 * (N₂ from a purge, unburned leftovers) is taken to be at the flame temperature; the heat that would
 * take is not charged to the flame. Burning continues while the propellant *inflow* is flammable
 * by the same test; it goes out when it is not (a fuel valve shut, an N₂ purge arriving). At
 * extinction the node goes back to the ideal-gas model with the pressure it had.
 *
 * The throat is an ordinary orifice edge. With the chamber state above, its choked flux is
 * P_c/c*, with the subsonic fallback near ambient for free (brief §4.4).
 *
 * Thrust, F = C_F P_c A_t (A_t: the throat's effective area), with
 *
 *   C_F = λ (C_F,vac − ε/(P_c/p_e)) + ε (p_e/P_c − p_a/P_c)
 *
 * the CEA momentum term scaled by the nozzle divergence factor λ = (1 + cos α)/2 (Sutton &
 * Biblarz, Rocket Propulsion Elements, eq. 3-34) plus the exit pressure term. Cold (not burning),
 * the same form comes from the ideal-nozzle relations for the chamber gas's γ. Flow separation is not
 * modelled; C_F is floored at 0 for an over-expanded nozzle at low P_c.
 */
import flam from '../../data/flammability.json' with { type: 'json' };
import { ceaLookup, vandenkerckhove } from './cea.js';
import { nasa7Gas, T_REF } from './gas.js';
import { R_U } from './constants.js';

export const FLAMMABILITY = flam;

/** Stoichiometric O/F by mass for CH₄ + 2 O₂ (–), from the thermo table's molar masses. */
export function stoichOF(gas) {
  return (2 * gas.W[gas.names.indexOf('O2')]) / gas.W[gas.names.indexOf('CH4')];
}

let lhvCache = null;
/** Lower heating value of CH₄ (J/kg of CH₄) from NASA-7 formation enthalpies at 298.15 K. */
export function lhvCH4() {
  if (lhvCache) return lhvCache;
  const g = nasa7Gas(['CH4', 'O2', 'CO2', 'H2O']);
  const hm = (name) => g.h(g.names.indexOf(name), T_REF) * g.W[g.names.indexOf(name)];
  const perMol = hm('CH4') + 2 * hm('O2') - hm('CO2') - 2 * hm('H2O');
  lhvCache = perMol / g.W[0];
  return lhvCache;
}

/** Unburned propellant in a volume: { mass (kg), energy (J) } from its O₂ and CH₄ masses. */
export function unburned(gas, mO2, mCH4) {
  const s = stoichOF(gas);
  return { mass: mO2 + mCH4, energy: lhvCH4() * Math.max(0, Math.min(mCH4, mO2 / s)) };
}

/**
 * Flammability margin from species amounts (moles, or mass/W): ≥ 0 means flammable. The smallest
 * of (x_CH₄ − lower), (upper − x_CH₄), (x_O₂ − LOC); −1 when there is nothing.
 */
export function flammabilityMargin(nO2, nCH4, nTotal) {
  if (!(nTotal > 0)) return -1;
  const x = nCH4 / nTotal;
  const xo = nO2 / nTotal;
  const { lower, upper } = flam.CH4_in_O2;
  return Math.min(x - lower, upper - x, xo - flam.LOC_O2_N2_diluent);
}

/** Moles per species of a mass vector (kg → mol), and their sum. */
export function molesOf(gas, m) {
  let n = 0;
  const out = new Float64Array(gas.n);
  for (let i = 0; i < gas.n; i++) {
    out[i] = Math.max(0, m[i]) / gas.W[i];
    n += out[i];
  }
  return { n: out, total: n };
}

/**
 * State of a burning chamber: masses m (kg, gas order), volume V (m³), η_c*, a starting guess for
 * P_c (Pa). Returns the node-state record the network uses ({ p, T, R, gamma, Y, h, mass }) plus
 * { burning, OF, cstar, cstarIdeal, Tc, Teff, clamped }.
 */
export function burningState(gas, ix, m, V, eta, pGuess) {
  let mass = 0;
  for (let i = 0; i < gas.n; i++) mass += Math.max(0, m[i]);
  const mb = Math.max(0, m[ix.PRODox]) + Math.max(0, m[ix.PRODfu]);
  const of = Math.max(0, m[ix.PRODox]) / Math.max(1e-30, Math.max(0, m[ix.PRODfu]));
  // Inert gas counted by moles at the flame temperature.
  let inertR = 0;
  for (let i = 0; i < gas.n; i++) if (i !== ix.PRODox && i !== ix.PRODfu) inertR += Math.max(0, m[i]) * gas.R[i];
  let p = pGuess > 0 ? pGuess : 1e5;
  const t = {};
  let RT = 0;
  let Rb = 0;
  for (let k = 0; k < 40; k++) {
    ceaLookup(of, p, t);
    const G = vandenkerckhove(t.gamma);
    const cs = eta * t.cstar;
    RT = (cs * G) ** 2;
    Rb = R_U / t.M;
    const pn = ((mb + inertR / Rb) * RT) / V;
    const done = Math.abs(pn - p) <= 1e-13 * pn;
    p = pn;
    if (done) break;
  }
  const Teff = RT / Rb;
  const R = mass > 0 ? (mb * Rb + inertR) / mass : Rb;
  const Y = new Float64Array(gas.n);
  let h = 0;
  for (let i = 0; i < gas.n; i++) {
    Y[i] = mass > 0 ? Math.max(0, m[i]) / mass : 0;
    if (Y[i]) h += Y[i] * gas.h(i, Teff);
  }
  return { mass, Y, T: Teff, p, R, cp: (t.gamma * R) / (t.gamma - 1), gamma: t.gamma, h, burning: true, OF: of, cstar: eta * t.cstar, cstarIdeal: t.cstar, Tc: t.Tc, Teff, clamped: t.clamped, CFvac: t.CFvac, PcOvPe: t.PcOvPe };
}

/** Supersonic exit Mach for area ratio ε and γ (Newton on the area–Mach relation). */
export function exitMach(eps, g) {
  const f = (M) => (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), (g + 1) / (2 * (g - 1))) - eps;
  let M = 1.5 + Math.log(eps);
  for (let k = 0; k < 60; k++) {
    const h = 1e-6 * M;
    const d = (f(M + h) - f(M - h)) / (2 * h);
    const step = f(M) / d;
    M = Math.max(1.0001, M - step);
    if (Math.abs(step) < 1e-13 * M) break;
  }
  return M;
}

/** Ideal-nozzle C_F,vac and P_c/p_e for a perfect gas γ at area ratio ε. */
export function idealNozzle(g, eps) {
  const Me = exitMach(eps, g);
  const peOverPc = Math.pow(1 + ((g - 1) / 2) * Me * Me, -g / (g - 1));
  const mom = Math.sqrt(((2 * g * g) / (g - 1)) * Math.pow(2 / (g + 1), (g + 1) / (g - 1)) * (1 - Math.pow(peOverPc, (g - 1) / g)));
  return { CFvac: mom + eps * peOverPc, PcOvPe: 1 / peOverPc, Me };
}

/** Nozzle divergence factor λ = (1 + cos α)/2 for a conical nozzle of half-angle α (rad). */
export const divergenceFactor = (alpha) => (1 + Math.cos(alpha)) / 2;

/**
 * Thrust F (N) and C_F from chamber state s (a burningState, or a cold node state with p, gamma),
 * throat flow ṁ (kg/s), effective throat area At (m²), area ratio eps, divergence factor lam,
 * ambient pa (Pa). Choked cold flow uses the ideal nozzle; an unchoked throat gives the momentum of
 * the flow expanded to ambient, u = √(2 c_p T (1 − (p_a/p)^((γ−1)/γ))).
 */
export function thrust(s, mdot, At, eps, lam, pa, choked) {
  if (!(mdot > 0) || !(s.p > pa)) return { F: 0, CF: 0 };
  if (!choked) {
    const g = s.gamma;
    const u = Math.sqrt(Math.max(0, 2 * s.cp * s.T * (1 - Math.pow(pa / s.p, (g - 1) / g))));
    const F = lam * mdot * u;
    return { F, CF: F / (s.p * At) };
  }
  const noz = s.burning ? { CFvac: s.CFvac, PcOvPe: s.PcOvPe } : idealNozzle(s.gamma, eps);
  const peOverPc = 1 / noz.PcOvPe;
  const CF = Math.max(0, lam * (noz.CFvac - eps * peOverPc) + eps * (peOverPc - pa / s.p));
  return { F: CF * s.p * At, CF };
}
