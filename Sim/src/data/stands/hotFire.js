/**
 * Hot-fire stand (brief M4): the full stand's plumbing with GOX in the oxidizer bottle, GCH₄ in the
 * fuel bottle and GN₂ in the purge, a chamber that burns (physics/chamber.js), the igniter, and a
 * thrust load cell.
 *
 *   ox bottle ─HV-OX-01─ hp ─PCV-OX-01─ manifold ─SV-OX-01─ line ─INJ-OX-01─ chamber ─THROAT-01─ exhaust
 *   fu bottle ─HV-FU-01─ hp ─PCV-FU-01─ manifold ─SV-FU-01─ line ─INJ-FU-01─┘   │
 *   n2 bottle ─HV-N2-01─ hp ─PCV-N2-01─ manifold ─SV-N2-01─ line ─CKV-N2-01─┘   IGN-IG-01
 *
 * Every component value is the full stand's (components.json, most of them placeholders, issue #6).
 * The chamber adds η_c* 0.92 (PROJECT_PLAN §2.1, uncalibrated), ε = 3 and a 15° conical nozzle
 * (PROJECT_PLAN §2.1, §3 Phase 1). Lines, manifolds and the chamber start at ambient pressure
 * holding N₂, as after a purge.
 *
 * There is no hot-fire sequence. Its timings are Dalton's design decision (brief §5.4); this stand
 * runs in Operate only, and the self-test's hot-fire fixtures carry their own labelled timings.
 *
 * IGN-IG-01: the igniter as an engine part in the S-2 igniter circuit. D-4 (spark plug or torch) is
 * open, so it is modelled as a switch that arms ignition and nothing else. The tag is provisional
 * until S-2 lists igniter tags (src/data/tags.js).
 */
import { components, injectorCdA } from '../components.js';
import { pressureChannel, forceChannel } from '../sensors.js';
import { nasa7Gas } from '../../physics/gas.js';
import { cvToCdA } from '../../physics/elements/orifice.js';
import { divergenceFactor } from '../../physics/chamber.js';
import { leg } from './fullStand.js';

const circle = (d) => (Math.PI / 4) * d * d;

export const SPECIES = ['O2', 'CH4', 'N2', 'PRODox', 'PRODfu'];

export function hotFire(c = components()) {
  const gas = nasa7Gas(SPECIES);
  const amb = c.ambient;
  const T = amb.T;
  const air = { N2: 0.767, O2: 0.233 };
  const ox = leg(c, gas, amb, {
    circuit: 'OX', fill: { O2: 1 },
    bottle: 'ox-bottle', hp: 'ox-hp', man: 'ox-manifold', line: 'ox-line',
    bottlePart: 'bottle', hpPart: 'hpline', manPart: 'manifold', linePart: 'line',
    bottleLabel: 'GOX', hpLabel: 'ox HP', manLabel: 'ox manifold', lineLabel: 'ox line',
    hv: 'HV-OX-01', pcv: 'PCV-OX-01', psv: 'PSV-OX-01', sv: 'SV-OX-01', vent: 'SV-OX-02',
  });
  const fu = leg(c, gas, amb, {
    circuit: 'FU', fill: { CH4: 1 },
    bottle: 'fu-bottle', hp: 'fu-hp', man: 'fu-manifold', line: 'fu-line',
    bottlePart: 'bottle-fu', hpPart: 'hpline-fu', manPart: 'manifold-fu', linePart: 'line-fu',
    bottleLabel: 'GCH₄', hpLabel: 'fuel HP', manLabel: 'fuel manifold', lineLabel: 'fuel line',
    hv: 'HV-FU-01', pcv: 'PCV-FU-01', psv: 'PSV-FU-01', sv: 'SV-FU-01', vent: 'SV-FU-02',
  });
  const n2 = leg(c, gas, amb, {
    circuit: 'N2',
    bottle: 'n2-bottle', hp: 'n2-hp', man: 'n2-manifold', line: 'n2-line',
    bottlePart: 'bottle-n2', hpPart: 'hpline-n2', manPart: 'manifold-n2', linePart: 'line-n2',
    bottleLabel: 'purge GN₂', hpLabel: 'purge HP', manLabel: 'purge manifold', lineLabel: 'purge line',
    hv: 'HV-N2-01', pcv: 'PCV-N2-01', psv: 'PSV-N2-01', sv: 'SV-N2-01', vent: 'SV-N2-02',
  });
  const chk = c['CKV-N2-01'];
  const th = c['THROAT-01'];
  const YO = 6.2;
  const YF = 3.05;
  const YN = -0.1;
  const YC = 4.6;
  return {
    id: 'hot-fire',
    title: 'Full stand, hot fire',
    gas,
    net: {
      nodes: [
        ...ox.nodes,
        ...fu.nodes,
        ...n2.nodes,
        {
          id: 'chamber', kind: 'chamber', V: c.chamber.V, p: amb.p, T, Y: { N2: 1 }, label: 'chamber', circuit: 'CH',
          eta: c.chamber.etaCstar,
          nozzle: { throat: 'THROAT-01', eps: th.eps, lambda: divergenceFactor(th.halfAngle) },
        },
        { id: 'amb', kind: 'ambient', p: amb.p, T, Y: air, label: 'atmosphere' },
      ],
      edges: [
        ...ox.edges,
        { id: 'INJ-OX-01', type: 'orifice', a: 'ox-line', b: 'chamber', CdA: injectorCdA(c, 'INJ-OX-01') },
        ...fu.edges,
        { id: 'INJ-FU-01', type: 'orifice', a: 'fu-line', b: 'chamber', CdA: injectorCdA(c, 'INJ-FU-01') },
        ...n2.edges,
        { id: 'CKV-N2-01', type: 'check', a: 'n2-line', b: 'chamber', CdA: cvToCdA(chk.Cv), crack: chk.crack, reseat: chk.reseat },
        { id: 'THROAT-01', type: 'orifice', a: 'chamber', b: 'amb', CdA: th.Cd * circle(th.d) },
      ],
      igniters: [{ id: 'IGN-IG-01', chamber: 'chamber' }],
    },
    layout: {
      nodes: {
        'ox-bottle': [-6.2, YO], 'ox-hp': [-4.4, YO], 'ox-manifold': [-2.2, YO], 'ox-line': [0.4, YO],
        'fu-bottle': [-6.2, YF], 'fu-hp': [-4.4, YF], 'fu-manifold': [-2.2, YF], 'fu-line': [0.4, YF],
        'n2-bottle': [-6.2, YN], 'n2-hp': [-4.4, YN], 'n2-manifold': [-2.2, YN], 'n2-line': [0.4, YN],
        chamber: [3.0, YC],
      },
      labels: {
        'ox-bottle': { at: [-6.85, YO], anchor: [1, 0.5] },
        'fu-bottle': { at: [-6.85, YF], anchor: [1, 0.5] },
        'n2-bottle': { at: [-6.85, YN], anchor: [1, 0.5] },
      },
      vents: {
        'PSV-OX-01': [-2.2, YO + 1.5],
        'SV-OX-02': [-0.6, YO + 1.5],
        'PSV-FU-01': [-2.2, YF + 1.5],
        'SV-FU-02': [-0.6, YF + 1.5],
        'PSV-N2-01': [-2.2, YN - 1.5],
        'SV-N2-02': [-0.6, YN - 1.5],
        'THROAT-01': [5.4, YC],
      },
      igniters: { 'IGN-IG-01': [3.0, YC - 1.35] },
    },
    view: { x: -0.7, y: 0.85, z: 30 },
    hint: 'Operate: open HV-OX-01 and HV-FU-01, then the main valves, then switch IGN-IG-01 on. There is no hot-fire sequence: its timings are a design decision not yet made.',
    sequence: null,
    sensors: [
      pressureChannel('PT-OX-01', 'ox-bottle', c, { offset: [0.55, 1.6] }),
      pressureChannel('PT-OX-02', 'ox-manifold', c, { offset: [0.9, 1.6] }),
      pressureChannel('PT-OX-03', 'ox-line', c, { offset: [0.45, 1.45] }),
      pressureChannel('PT-FU-01', 'fu-bottle', c, { offset: [0.55, -1.6] }),
      pressureChannel('PT-FU-02', 'fu-manifold', c, { offset: [-0.85, -1.6] }),
      pressureChannel('PT-FU-03', 'fu-line', c, { offset: [0.5, -1.5] }),
      pressureChannel('PT-N2-01', 'n2-bottle', c, { offset: [0.55, -1.6] }),
      pressureChannel('PT-N2-02', 'n2-manifold', c, { offset: [0.9, -1.6] }),
      pressureChannel('PT-CH-01', 'chamber', c, { offset: [0.2, 1.15] }),
      forceChannel('LC-CH-01', 'chamber', c, { offset: [1.4, 1.15] }),
    ],
  };
}
