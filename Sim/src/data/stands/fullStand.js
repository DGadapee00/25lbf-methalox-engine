/**
 * Full cold-flow stand (brief M3). Two propellant circuits and a purge, every bottle filled with
 * nitrogen. The fuel circuit keeps the fuel injector holes and the fuel regulator's design flow;
 * the gas in the bottle is still N2. Hot fire (methane, oxygen, combustion) is M4.
 *
 *   ox bottle ─HV-OX-01─ hp ─PCV-OX-01─ manifold ─SV-OX-01─ line ─INJ-OX-01─ chamber ─THROAT-01─ exhaust
 *   fu bottle ─HV-FU-01─ hp ─PCV-FU-01─ manifold ─SV-FU-01─ line ─INJ-FU-01─┘
 *   n2 bottle ─HV-N2-01─ hp ─PCV-N2-01─ manifold ─SV-N2-01─ line ─CKV-N2-01─┘
 * Each manifold has its relief and a vent valve. Starts safe: isolations shut, downstream ambient.
 *
 * The sequence is the existing Phase 5 step 1 dry run (oxidizer circuit only). Step 3, a nitrogen
 * blowdown through both injectors, is a settled operating point in physics/predictions.js, not a
 * second list of timings.
 */
import { components, injectorCdA } from '../components.js';
import { pressureChannel } from '../sensors.js';
import { loadSequence } from '../sequences.js';
import { reliefCdAForFailOpen } from '../../physics/network.js';
import { stateFromPTY, nasa7Gas, massFractions } from '../../physics/gas.js';
import { cvToCdA } from '../../physics/elements/orifice.js';

const circle = (d) => (Math.PI / 4) * d * d;

export const SPECIES = ['O2', 'CH4', 'N2'];

function leg(c, gas, amb, spec) {
  const T = amb.T;
  const bottleP = c[spec.bottlePart].p0;
  const supply = stateFromPTY(gas, bottleP, T, massFractions(gas, { N2: 1 }));
  const reg = c[spec.pcv];
  const regCdA = cvToCdA(reg.Cv);
  const relief = c[spec.psv];
  const reliefCdA = relief.sizingMargin * reliefCdAForFailOpen(regCdA, supply, relief.set, amb.p, relief.accumulation);
  const vol = (id, part, p, label) => ({ id, kind: 'volume', V: c[part].V, p, T, Y: { N2: 1 }, label, circuit: spec.circuit });
  const valve = (id, a, b) => ({
    id,
    type: 'valve',
    a,
    b,
    CdAmax: cvToCdA(c[id].Cv),
    tOpen: c[id].tOpen,
    tClose: c[id].tClose,
    delay: c[id].delay ?? 0,
    x0: 0,
  });
  return {
    nodes: [
      vol(spec.bottle, spec.bottlePart, bottleP, spec.bottleLabel),
      vol(spec.hp, spec.hpPart, amb.p, spec.hpLabel),
      vol(spec.man, spec.manPart, amb.p, spec.manLabel),
      vol(spec.line, spec.linePart, amb.p, spec.lineLabel),
    ],
    edges: [
      valve(spec.hv, spec.bottle, spec.hp),
      {
        id: spec.pcv,
        type: 'regulator',
        a: spec.hp,
        b: spec.man,
        CdAmax: regCdA,
        pSet: reg.pSet,
        mdotRated: reg.mdotRated,
        droop: reg.droop,
        tau: reg.tau,
        pSupplyRef: bottleP,
        z0: 0,
      },
      {
        id: spec.psv,
        type: 'relief',
        a: spec.man,
        b: 'amb',
        CdA: reliefCdA,
        set: relief.set,
        blowdown: relief.blowdown,
        accumulation: relief.accumulation,
        tauLift: relief.tauLift,
      },
      valve(spec.sv, spec.man, spec.line),
      valve(spec.vent, spec.man, 'amb'),
    ],
  };
}

export function fullStand(c = components()) {
  const gas = nasa7Gas(SPECIES);
  const amb = c.ambient;
  const T = amb.T;
  const air = { N2: 0.767, O2: 0.233 };
  const ox = leg(c, gas, amb, {
    circuit: 'OX',
    bottle: 'ox-bottle', hp: 'ox-hp', man: 'ox-manifold', line: 'ox-line',
    bottlePart: 'bottle', hpPart: 'hpline', manPart: 'manifold', linePart: 'line',
    bottleLabel: 'ox GN₂', hpLabel: 'ox HP', manLabel: 'ox manifold', lineLabel: 'ox line',
    hv: 'HV-OX-01', pcv: 'PCV-OX-01', psv: 'PSV-OX-01', sv: 'SV-OX-01', vent: 'SV-OX-02',
  });
  const fu = leg(c, gas, amb, {
    circuit: 'FU',
    bottle: 'fu-bottle', hp: 'fu-hp', man: 'fu-manifold', line: 'fu-line',
    bottlePart: 'bottle-fu', hpPart: 'hpline-fu', manPart: 'manifold-fu', linePart: 'line-fu',
    bottleLabel: 'fuel GN₂', hpLabel: 'fuel HP', manLabel: 'fuel manifold', lineLabel: 'fuel line',
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
  // Pitch leaves room for a bottle body (±1.2) and the vent symbols off each manifold.
  const YO = 6.2;
  const YF = 3.05;
  const YN = -0.1;
  const YC = 4.6;
  return {
    id: 'full-stand',
    title: 'Full stand, cold flow',
    gas,
    net: {
      nodes: [
        ...ox.nodes,
        ...fu.nodes,
        ...n2.nodes,
        { id: 'chamber', kind: 'volume', V: c.chamber.V, p: amb.p, T, Y: { N2: 1 }, label: 'chamber', circuit: 'CH' },
        { id: 'amb', kind: 'ambient', p: amb.p, T, Y: air, label: 'atmosphere' },
      ],
      edges: [
        ...ox.edges,
        { id: 'INJ-OX-01', type: 'orifice', a: 'ox-line', b: 'chamber', CdA: injectorCdA(c, 'INJ-OX-01') },
        ...fu.edges,
        { id: 'INJ-FU-01', type: 'orifice', a: 'fu-line', b: 'chamber', CdA: injectorCdA(c, 'INJ-FU-01') },
        ...n2.edges,
        { id: 'CKV-N2-01', type: 'check', a: 'n2-line', b: 'chamber', CdA: cvToCdA(chk.Cv), crack: chk.crack, reseat: chk.reseat },
        { id: 'THROAT-01', type: 'orifice', a: 'chamber', b: 'amb', CdA: c['THROAT-01'].Cd * circle(c['THROAT-01'].d) },
      ],
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
    },
    view: { x: -0.7, y: 0.85, z: 30 },
    hint: 'Operate: both propellant circuits and the purge, all flowing GN₂. Sequence plays the step-1 table on the oxidizer circuit, and the timeline scrubs it. Download DAQ CSV writes the transducer log.',
    sequence: loadSequence('gn2-step1'),
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
    ],
  };
}
