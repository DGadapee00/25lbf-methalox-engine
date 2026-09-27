/**
 * Valve-timing case: SV-OX-01 between a settled supply and the injector line, commanded open at
 * t = 0. The supply volume is the bottle's, at the regulator set point, so the upstream pressure
 * does not sag while the stem moves. Timings start from the SV-OX-01 placeholders.
 */
import { components, injectorCdA } from './components.js';
import { nasa7Gas } from '../physics/gas.js';
import { cvToCdA } from '../physics/elements/orifice.js';
import { simulate } from '../physics/simulate.js';

export function valveTimingDefaults(c = components()) {
  const v = c['SV-OX-01'];
  return { delay: v.delay, tOpen: v.tOpen, tClose: v.tClose };
}

export function runValveTiming(state, c = components()) {
  const gas = nasa7Gas(['O2', 'CH4', 'N2']);
  const T = c.ambient.T;
  const net = {
    nodes: [
      { id: 'up', kind: 'volume', V: c.bottle.V, p: c['PCV-OX-01'].pSet, T, Y: { N2: 1 }, label: 'supply' },
      { id: 'line', kind: 'volume', V: c.line.V, p: c.ambient.p, T, Y: { N2: 1 }, label: 'line' },
      { id: 'amb', kind: 'ambient', p: c.ambient.p, T, Y: { N2: 0.767, O2: 0.233 } },
    ],
    edges: [
      {
        id: 'SV-OX-01',
        type: 'valve',
        a: 'up',
        b: 'line',
        CdAmax: cvToCdA(c['SV-OX-01'].Cv),
        tOpen: state.tOpen,
        tClose: state.tClose,
        delay: state.delay,
        x0: 0,
      },
      { id: 'INJ-OX-01', type: 'orifice', a: 'line', b: 'amb', CdA: injectorCdA(c, 'INJ-OX-01') },
    ],
  };
  const tEnd = state.delay + state.tOpen + 0.15;
  const r = simulate(net, { gas, tEnd, schedule: [{ t: 0, id: 'SV-OX-01', cmd: 'open' }], sampleDt: 0.001 });
  const half = r.samples.find((x) => x.edges['SV-OX-01'].x >= 0.5);
  const open = r.samples.find((x) => x.edges['SV-OX-01'].x >= 0.999);
  return { samples: r.samples, halfT: half ? half.t : null, openT: open ? open.t : null, final: r.final };
}
