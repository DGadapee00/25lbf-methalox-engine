/**
 * Injector lab's numbers: one C_d, both circuits, cold flow choked, fuel design flow short of
 * PROJECT_PLAN §2.2 by less than 5% (issue #1 — no resize).
 */
import { ok, approx, section } from './harness.js';
import { injectorStudy } from '../../data/injectorStudy.js';

export function run() {
  section('Injector · both circuits, one C_d');
  const s = injectorStudy();
  ok(s.Cd === 0.77, 'the study uses the shared injector C_d, 0.77');
  approx(s.fu.CdA / s.ox.CdA, (1 / 1.4) ** 2, 1e-12, 'fuel area / ox area is (1.0 / 1.4)² from the two hole diameters');
  ok(s.ox.cold.choked && s.fu.cold.choked, 'both circuits are choked into an ambient chamber');
  const relFu = s.fu.design.mdot / s.fu.required - 1;
  ok(relFu < 0 && relFu > -0.05, `fuel at 250 psia is ${(s.fu.design.mdot * 1e3).toFixed(2)} g/s, short of 13.9 g/s by ${(-relFu * 100).toFixed(1)}% (issue #1)`);
  const relOx = s.ox.cold.mdot / s.ox.required - 1;
  ok(Math.abs(relOx) < 0.02, `cold GOX flow ${(s.ox.cold.mdot * 1e3).toFixed(2)} g/s is within 2% of 38.8 g/s`);
  const drop = (s.ox.cold.mdot - s.ox.design.mdot) / s.ox.cold.mdot;
  ok(drop >= -1e-6, 'raising the chamber from ambient to 250 psia does not increase GOX flow');
}
