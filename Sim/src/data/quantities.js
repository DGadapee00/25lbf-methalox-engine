/**
 * What the symbols on screen mean, and what they are measured in (brief §3.1, V-11).
 *
 * `unit` is the SI unit the physics works in; `display` names the format.js helper that shows it,
 * which is where the psia / lbf / g/s toggle lives. The base-SI expansion is computed from `unit`
 * through parseUnit(), so it cannot drift from the dimension engine.
 *
 * The registry grows with the labs: a quantity no lab shows fails the self-test, since nobody
 * would notice it was wrong.
 */
import { parseUnit } from '../physics/units.js';

export const QUANTITIES = {
  p: { sym: 'p', name: 'Pressure (absolute)', unit: 'Pa', display: 'fmtP', from: 'p = \\dfrac{mRT}{V}' },
  T: { sym: 'T', name: 'Temperature', unit: 'K', display: 'fmtT', from: '' },
  mdot: { sym: '\\mdot', name: 'Mass flow rate', unit: 'kg/s', display: 'fmtMdot', from: '\\mdot = \\dfrac{dm}{dt}' },
  m: { sym: 'm', name: 'Gas mass in a volume', unit: 'kg', display: 'sig', from: 'm = \\sum_i m_i' },
  V: { sym: 'V', name: 'Volume', unit: 'm^3', display: 'sig', from: '' },
  CdA: { sym: 'C_dA', name: 'Effective flow area', unit: 'm^2', display: 'sig', from: 'C_dA = C_d\\,A_{\\text{geom}}' },
  margin: { sym: 'p_0/p', name: 'Choke margin (pressure ratio)', unit: '1', display: 'sig', from: '\\text{choked when } p_0/p \\ge \\left(\\tfrac{\\gamma+1}{2}\\right)^{\\gamma/(\\gamma-1)}' },
  tau: { sym: '\\tau', name: 'Time constant', unit: 's', display: 'fmtTime', from: '\\tau = \\dfrac{V}{C_dA\\,\\Lambda\\sqrt{\\gamma R T}}' },
  x: { sym: 'x', name: 'Valve stem position', unit: '1', display: 'sig', from: '0 shut, 1 open' },
  F: { sym: 'F', name: 'Thrust', unit: 'N', display: 'fmtF', from: 'F = C_F\\,P_c A_t' },
  OF: { sym: 'O/F', name: 'Mixture ratio (mass)', unit: '1', display: 'sig', from: 'O/F = \\dot m_{ox}/\\dot m_{fu}' },
  cstar: { sym: 'c^*', name: 'Characteristic velocity', unit: 'm/s', display: 'sig', from: 'c^* = \\eta_{c^*}\\,c^*_{\\text{CEA}} = P_c A_t/\\dot m' },
  Isp: { sym: 'I_{sp}', name: 'Specific impulse', unit: 's', display: 'sig', from: 'I_{sp} = F/(\\dot m\\,g_0)' },
  E: { sym: 'E_u', name: 'Chemical energy of unburned propellant', unit: 'J', display: 'sig', from: 'E_u = \\text{LHV}\\,\\min(m_{CH_4}, m_{O_2}/s)' },
};

/** Which quantities each lab puts on screen, most important first. */
export const LAB_UNITS = {
  blowdown: ['p', 'T', 'mdot', 'm', 'V', 'CdA', 'tau'],
  orifice: ['mdot', 'p', 'T', 'CdA', 'margin'],
  regulator: ['p', 'mdot', 'tau', 'V'],
  'valve-timing': ['p', 'mdot', 'tau', 'x'],
  injector: ['mdot', 'p', 'CdA', 'margin'],
  'gn2-coldflow': ['p', 'mdot', 'T', 'margin', 'CdA'],
  'full-stand': ['p', 'mdot', 'T', 'margin', 'CdA'],
  'chamber-fill': ['p', 'tau', 'mdot', 'm', 'E', 'cstar', 'F', 'margin'],
  'hot-fire': ['p', 'F', 'Isp', 'OF', 'mdot', 'T', 'E', 'cstar', 'margin'],
};

const BASE = ['kg', 'm', 's', 'K'];
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((ch) => SUP[ch] ?? ch).join('');

/** Expand a unit string to base SI: 'Pa' → 'kg·m⁻¹·s⁻²'. '' when it does not parse. */
export function baseUnits(unit) {
  let dim;
  try {
    dim = parseUnit(unit);
  } catch {
    return '';
  }
  const parts = dim.map((e, i) => (e === 0 ? null : e === 1 ? BASE[i] : BASE[i] + sup(e))).filter(Boolean);
  return parts.length ? parts.join('·') : 'dimensionless';
}

/** The quantities for a lab, resolved and ready to render. */
export function unitsForLab(labId) {
  return (LAB_UNITS[labId] || [])
    .map((id) => (QUANTITIES[id] ? { id, ...QUANTITIES[id], base: baseUnits(QUANTITIES[id].unit) } : null))
    .filter(Boolean);
}
