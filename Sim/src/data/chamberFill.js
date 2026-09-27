/**
 * Chamber fill (brief §6.1, lab 6): both injector circuits fed from fixed-pressure reservoirs into
 * the chamber, the throat to ambient. Shared by the lab and the V-7 self-test, so both run the same
 * netlist.
 *
 *   ox-res ─SV-OX-01─ ox-line ─INJ-OX-01─ chamber ─THROAT-01─ atmosphere
 *   fu-res ─SV-FU-01─ fu-line ─INJ-FU-01─┘      (XV-OX-01, XV-FU-01: small step valves, res → chamber)
 *
 * Reservoirs are ambient-kind nodes: an idealized supply at the manifold pressure, so the step
 * response is the chamber's own and not the feed system's. The main valves (the stand's C_v and
 * line volume, placeholders) move instantly (tOpen 0): a step inflow, as lab 6 asks. A second,
 * small valve per circuit can open later for the small-step test (V-7).
 *
 * Defaults: manifold 480 psia (PROJECT_PLAN §2.3), gas at ambient temperature, injector, chamber,
 * throat and η_c* from components.json. The reservoir pressure is a lab control.
 */
import { components, injectorCdA } from './components.js';
import { nasa7Gas } from '../physics/gas.js';
import { divergenceFactor } from '../physics/chamber.js';
import { cvToCdA } from '../physics/elements/orifice.js';
import { SPECIES } from './stands/hotFire.js';

const circle = (d) => (Math.PI / 4) * d * d;

/**
 * opts: pUp (Pa, both reservoirs), eta (η_c*), igniter ('on' | 'off' | 'no-light'), step (fraction
 * of each injector's C_dA added at tStep, 0 for none), tStep (s), lead (s: fuel valve opens this
 * long before the ox valve when > 0, after it when < 0).
 */
export function chamberFill(opts = {}, c = components()) {
  const gas = nasa7Gas(SPECIES);
  const T = c.ambient.T;
  const pUp = opts.pUp ?? c['PCV-OX-01'].pSet;
  const eta = opts.eta ?? c.chamber.etaCstar;
  const th = c['THROAT-01'];
  const oxA = injectorCdA(c, 'INJ-OX-01');
  const fuA = injectorCdA(c, 'INJ-FU-01');
  const step = opts.step ?? 0;
  const lead = opts.lead ?? 0;
  const inst = (id, a, b, CdAmax, x0) => ({ id, type: 'valve', a, b, CdAmax, tOpen: 0, tClose: 0, x0 });
  const edges = [
    inst('SV-OX-01', 'ox-res', 'ox-line', cvToCdA(c['SV-OX-01'].Cv), lead > 0 ? 0 : 1),
    { id: 'INJ-OX-01', type: 'orifice', a: 'ox-line', b: 'chamber', CdA: oxA },
    inst('SV-FU-01', 'fu-res', 'fu-line', cvToCdA(c['SV-FU-01'].Cv), lead < 0 ? 0 : 1),
    { id: 'INJ-FU-01', type: 'orifice', a: 'fu-line', b: 'chamber', CdA: fuA },
    { id: 'THROAT-01', type: 'orifice', a: 'chamber', b: 'amb', CdA: th.Cd * circle(th.d) },
  ];
  if (step > 0) {
    edges.push(inst('XV-OX-01', 'ox-res', 'chamber', step * oxA, 0), inst('XV-FU-01', 'fu-res', 'chamber', step * fuA, 0));
  }
  const schedule = [];
  if (lead > 0) schedule.push({ t: lead, id: 'SV-OX-01', cmd: 'open' });
  if (lead < 0) schedule.push({ t: -lead, id: 'SV-FU-01', cmd: 'open' });
  if (step > 0) schedule.push({ t: opts.tStep, id: 'XV-OX-01', cmd: 'open' }, { t: opts.tStep, id: 'XV-FU-01', cmd: 'open' });
  if (opts.igniter === 'no-light') schedule.push({ t: 0, id: 'IGN-IG-01', cmd: { fault: 'no-light' } });
  return {
    gas,
    schedule,
    net: {
      nodes: [
        { id: 'ox-res', kind: 'ambient', p: pUp, T, Y: { O2: 1 }, label: 'GOX at manifold pressure' },
        { id: 'fu-res', kind: 'ambient', p: pUp, T, Y: { CH4: 1 }, label: 'GCH₄ at manifold pressure' },
        { id: 'ox-line', kind: 'volume', V: c.line.V, p: c.ambient.p, T, Y: { N2: 1 }, label: 'ox line', circuit: 'OX' },
        { id: 'fu-line', kind: 'volume', V: c['line-fu'].V, p: c.ambient.p, T, Y: { N2: 1 }, label: 'fuel line', circuit: 'FU' },
        {
          id: 'chamber', kind: 'chamber', V: c.chamber.V, p: c.ambient.p, T, Y: { N2: 1 }, label: 'chamber',
          eta, nozzle: { throat: 'THROAT-01', eps: th.eps, lambda: divergenceFactor(th.halfAngle) },
        },
        { id: 'amb', kind: 'ambient', p: c.ambient.p, T, Y: { N2: 0.767, O2: 0.233 }, label: 'atmosphere' },
      ],
      edges,
      igniters: [{ id: 'IGN-IG-01', chamber: 'chamber', on0: opts.igniter !== 'off' }],
    },
  };
}
