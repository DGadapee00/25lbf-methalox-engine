/**
 * V-11: every lab declares the quantities it shows, every declared unit parses, and nothing is
 * registered that no lab shows. Plus the unit factors, against their definitions.
 */
import { ok, approx, section } from './harness.js';
import { QUANTITIES, LAB_UNITS, baseUnits } from '../../data/quantities.js';
import { LABS } from '../../data/catalog.js';
import { parseUnit } from '../units.js';
import { PSI, LBF, G0, LBM, INCH } from '../constants.js';

export function run() {
  section('V-11 · units registry');
  let bad = 0;
  for (const [id, q] of Object.entries(QUANTITIES)) {
    try {
      parseUnit(q.unit);
    } catch (e) {
      bad += 1;
      console.log(`        ${id}: ${e.message}`);
    }
  }
  ok(bad === 0, 'every quantity declares a unit the dimension engine can parse');

  const ids = LABS.map((l) => l.id);
  const uncovered = ids.filter((l) => !LAB_UNITS[l]?.length);
  ok(!uncovered.length, `every lab has a units list (missing: ${uncovered.join(', ') || 'none'})`);
  const strays = Object.keys(LAB_UNITS).filter((l) => !ids.includes(l));
  ok(!strays.length, `no units list for a lab that does not exist (${strays.join(', ') || 'none'})`);
  const unknown = Object.values(LAB_UNITS).flat().filter((q) => !QUANTITIES[q]);
  ok(!unknown.length, `every listed quantity exists (${unknown.join(', ') || 'none'})`);
  const used = new Set(Object.values(LAB_UNITS).flat());
  const orphans = Object.keys(QUANTITIES).filter((q) => !used.has(q));
  ok(!orphans.length, `every quantity is shown by some lab (${orphans.join(', ') || 'none'})`);
  ok(baseUnits('Pa') === 'kg·m⁻¹·s⁻²', 'Pa in base units');
  ok(baseUnits('J/(kg*K)') === 'm²·s⁻²·K⁻¹', 'specific gas constant in base units');

  section('Unit factors, against their definitions');
  // NIST SP 811 Appendix B.8 lists 1 psi = 6.894 757 E+03 Pa and 1 lbf = 4.448 222 E+00 N.
  approx(PSI, 6894.757, 1e-7, 'psi → Pa matches NIST SP 811 (6.894757e3)');
  approx(LBF, 4.448222, 1e-7, 'lbf → N matches NIST SP 811 (4.448222)');
  approx(LBF, LBM * G0, 1e-15, 'lbf = lbm · g₀ exactly');
  approx(INCH * 12 * 3, 0.9144, 1e-15, 'yard = 0.9144 m exactly');
  approx((250 * PSI) / 1e6, 1.72, 0.003, 'PROJECT_PLAN §2.1: 250 psia ≈ 1.72 MPa');

}
