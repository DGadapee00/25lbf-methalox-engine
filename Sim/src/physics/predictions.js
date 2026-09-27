/**
 * Phase 5 step 1 and step 3 numbers from the cold-flow model.
 *
 * Uncalibrated. Placeholder hardware (issue #6) and the injector C_d are not a prediction of what
 * the stand will measure. Step 3 flows nitrogen through both injector geometries; it is not the
 * GOX / GCH4 design point (38.8 g/s and 13.9 g/s).
 *
 * Step 3 opens the blowdown path at t = 0 and integrates for a fixed horizon so the manifolds can
 * settle. That horizon is not a test procedure and not a proposed sequence.
 */
import { simulate } from './simulate.js';
import { gn2Coldflow, GN2_STEP1 } from '../data/stands/gn2Coldflow.js';
import { fullStand } from '../data/stands/fullStand.js';

const STEP3_HORIZON_S = 4;
const STEP3_OPEN = ['HV-OX-01', 'HV-FU-01', 'SV-OX-01', 'SV-FU-01'];

function at(samples, t) {
  return samples.find((x) => x.t >= t - 1e-9);
}

function snap(node) {
  return { p: node.p, T: node.T, Y: [...node.Y] };
}

/** Phase 5 step 1 on the single-circuit GN2 stand. */
export function phase5Step1() {
  const s = gn2Coldflow();
  const r = simulate(s.net, { gas: s.gas, tEnd: GN2_STEP1.tEnd, schedule: GN2_STEP1.steps, sampleDt: 0.05 });
  const flowing = at(r.samples, 4.5);
  const held = at(r.samples, 2);
  const inj = flowing.edges['INJ-OX-01'];
  return {
    id: 'phase5-step1',
    what: 'GN2 cold flow on the oxidizer circuit: leak check, valve timing, sequencer dry run',
    sequence: GN2_STEP1.id,
    stand: s.id,
    uncalibrated: true,
    flowing: {
      t_s: flowing.t,
      manifold_Pa: flowing.nodes.manifold.p,
      injector_mdot_kg_s: inj.mdot,
      choked: inj.choked,
      margin: inj.margin,
    },
    beforeMainValve: {
      t_s: held.t,
      injector_mdot_kg_s: held.edges['INJ-OX-01'].mdot,
      line_Pa: held.nodes.line.p,
    },
    afterShutdown: {
      t_s: r.final.t,
      line_Pa: r.final.nodes.line.p,
      chamber_Pa: r.final.nodes.chamber.p,
    },
    stats: r.stats,
  };
}

/**
 * Phase 5 step 3: nitrogen blowdown through both injectors on the full stand.
 * Returns the run so a test can check the orifice law against the settled node states.
 */
export function phase5Step3() {
  const s = fullStand();
  const schedule = STEP3_OPEN.map((id) => ({ t: 0, id, cmd: 'open' }));
  const r = simulate(s.net, { gas: s.gas, tEnd: STEP3_HORIZON_S, schedule, sampleDt: 0.05 });
  const end = r.final;
  const circuit = (inj, line, manifold) => {
    const e = end.edges[inj];
    return {
      injector: inj,
      mdot_kg_s: e.mdot,
      choked: e.choked,
      margin: e.margin,
      manifold_Pa: end.nodes[manifold].p,
      line: snap(end.nodes[line]),
      chamber: snap(end.nodes.chamber),
    };
  };
  return {
    id: 'phase5-step3',
    what: 'GN2 blowdown through both injectors. Valves that open the path are commanded together at t = 0; the horizon is how long the integration runs, not a procedure.',
    gas: 'N2',
    stand: s.id,
    horizon_s: STEP3_HORIZON_S,
    commands: schedule,
    uncalibrated: true,
    note: 'Nitrogen through the propellant orifice geometry. These mass flows are not the GOX 38.8 g/s and GCH4 13.9 g/s design points.',
    ox: circuit('INJ-OX-01', 'ox-line', 'ox-manifold'),
    fu: circuit('INJ-FU-01', 'fu-line', 'fu-manifold'),
    purge_mdot_kg_s: end.edges['CKV-N2-01'].mdot,
    purge_open: !!end.edges['CKV-N2-01'].open,
    mass0: r.sys.totals(r.sys.initialState()).m,
    mass1: r.sys.totals(r.y).m,
    stats: r.stats,
  };
}

function withoutStats(row) {
  const { stats, mass0, mass1, ...rest } = row;
  return rest;
}

/** The document committed under Sim/predictions/phase5.json. */
export function phase5Document() {
  return {
    uncalibrated: true,
    label: 'Placeholder hardware (issue #6) and an uncalibrated injector Cd. Not a prediction of what the hardware will do.',
    step1: withoutStats(phase5Step1()),
    step3: withoutStats(phase5Step3()),
  };
}
