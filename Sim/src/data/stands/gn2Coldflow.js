/**
 * GN₂ cold-flow stand, single circuit (Phase 5 step 1: leak check, valve timing, sequencer dry run).
 * The ox circuit's hardware flowing GN₂, so tags carry the OX circuit (S-2).
 *
 *   bottle ─HV-OX-01─ hp ─PCV-OX-01─ manifold ─SV-OX-01─ line ─INJ-OX-01─ chamber ─THROAT-01─ exhaust
 *                                     │  │
 *                         PSV-OX-01 ──┘  └── SV-OX-02 (vent)
 *
 * Pure data, like FLUX's data/circuits.js: the P&ID view draws this netlist and the self-test
 * builds and runs the same one. Positions are scene units on the flat schematic. Every parameter
 * comes from data/components.json, sourced or placeholder (issue #6).
 *
 * Starts safe: bottle isolation shut, everything downstream at ambient.
 */
import { components } from '../components.js';
import { reliefCdAForFailOpen } from '../../physics/network.js';
import { stateFromPTY, nasa7Gas, massFractions } from '../../physics/gas.js';
import { cvToCdA } from '../../physics/elements/orifice.js';

const circle = (d) => (Math.PI / 4) * d * d;

export const SPECIES = ['O2', 'CH4', 'N2'];

export function gn2Coldflow(c = components()) {
  const gas = nasa7Gas(SPECIES);
  const amb = c.ambient;
  const T = amb.T;
  const air = { N2: 0.767, O2: 0.233 };
  const bottleP = c.bottle.p0;
  const supply = stateFromPTY(gas, bottleP, T, massFractions(gas, { N2: 1 }));
  const regCdA = cvToCdA(c['PCV-OX-01'].Cv);
  const psv = c['PSV-OX-01'];
  const reliefCdA = psv.sizingMargin * reliefCdAForFailOpen(regCdA, supply, psv.set, amb.p, psv.accumulation);
  const vol = (id, V, p, extra = {}) => ({ id, kind: 'volume', V, p, T, Y: { N2: 1 }, ...extra });
  const valve = (id, a, b, part, extra = {}) => ({
    id,
    type: 'valve',
    a,
    b,
    CdAmax: cvToCdA(part.Cv),
    tOpen: part.tOpen,
    tClose: part.tClose,
    delay: part.delay ?? 0,
    x0: 0,
    ...extra,
  });
  return {
    id: 'gn2-coldflow',
    title: 'GN₂ cold flow, single circuit',
    gas,
    net: {
      nodes: [
        vol('bottle', c.bottle.V, bottleP, { label: 'GN₂ bottle' }),
        vol('hp', c.hpline.V, amb.p, { label: 'HP line' }),
        vol('manifold', c.manifold.V, amb.p, { label: 'manifold' }),
        vol('line', c.line.V, amb.p, { label: 'line' }),
        vol('chamber', c.chamber.V, amb.p, { label: 'chamber' }),
        { id: 'amb', kind: 'ambient', p: amb.p, T, Y: air, label: 'atmosphere' },
      ],
      edges: [
        valve('HV-OX-01', 'bottle', 'hp', c['HV-OX-01']),
        {
          id: 'PCV-OX-01',
          type: 'regulator',
          a: 'hp',
          b: 'manifold',
          CdAmax: regCdA,
          pSet: c['PCV-OX-01'].pSet,
          mdotRated: c['PCV-OX-01'].mdotRated,
          droop: c['PCV-OX-01'].droop,
          tau: c['PCV-OX-01'].tau,
          pSupplyRef: bottleP,
          z0: 0,
        },
        { id: 'PSV-OX-01', type: 'relief', a: 'manifold', b: 'amb', CdA: reliefCdA, set: psv.set, blowdown: psv.blowdown, accumulation: psv.accumulation, tauLift: psv.tauLift },
        valve('SV-OX-01', 'manifold', 'line', c['SV-OX-01']),
        valve('SV-OX-02', 'manifold', 'amb', c['SV-OX-02']),
        { id: 'INJ-OX-01', type: 'orifice', a: 'line', b: 'chamber', CdA: c['INJ-OX-01'].Cd * c['INJ-OX-01'].n * circle(c['INJ-OX-01'].d) },
        { id: 'THROAT-01', type: 'orifice', a: 'chamber', b: 'amb', CdA: c['THROAT-01'].Cd * circle(c['THROAT-01'].d) },
      ],
    },
    // P&ID layout. Ambient is drawn once per edge that reaches it, at that edge's `vent` point.
    layout: {
      nodes: { bottle: [-5.8, 0], hp: [-4.0, 0], manifold: [-1.2, 0], line: [1.5, 0], chamber: [3.7, 0] },
      vents: { 'PSV-OX-01': [-1.2, 2.3], 'SV-OX-02': [-1.2, -2.3], 'THROAT-01': [5.6, 0] },
    },
    sensors: [
      { tag: 'PT-OX-01', node: 'bottle', offset: [0.9, 1.7] },
      { tag: 'PT-OX-02', node: 'manifold', offset: [0.9, 1.2] },
      { tag: 'PT-OX-03', node: 'line', offset: [0, 1.2] },
      { tag: 'PT-CH-01', node: 'chamber', offset: [0, 1.4] },
    ],
  };
}
