/**
 * Full cold-flow stand: both propellant circuits and the purge on nitrogen, the step-1 sequence
 * file, a scrub that replays that file, and the Phase 5 step 1 and step 3 numbers.
 */
import fs from 'node:fs';
import { approx, ok, section, recordStats } from './harness.js';
import { simulate, createRun } from '../simulate.js';
import { orificeFlow } from '../elements/orifice.js';
import { stateFromPTY, massFractions } from '../gas.js';
import { PSI } from '../constants.js';
import { fullStand } from '../../data/stands/fullStand.js';
import { GN2_STEP1 } from '../../data/stands/gn2Coldflow.js';
import { components, injectorCdA } from '../../data/components.js';
import { tagProblems } from '../../data/tags.js';
import { valveTableMarkdown } from '../../data/valveTable.js';
import { phase5Step1, phase5Step3 } from '../predictions.js';

function asState(gas, node) {
  const Y = Object.fromEntries(gas.names.map((name, i) => [name, node.Y[i]]));
  return stateFromPTY(gas, node.p, node.T, massFractions(gas, Y));
}

export function run() {
  section('Full stand · two nitrogen circuits, purge, tags');
  const s = fullStand();
  const tags = tagProblems(s.net);
  ok(!tags.length, `S-2 tags on every element (${tags.join('; ') || 'clean'})`);
  ok(s.net.edges.filter((e) => e.type === 'regulator').length === 3, 'oxidizer, fuel and purge each have a regulator');
  ok(s.net.edges.filter((e) => e.type === 'relief').length === 3, 'each regulated manifold has a relief');
  ok(s.net.edges.some((e) => e.id === 'CKV-N2-01' && e.type === 'check'), 'purge enters the chamber through a check valve');
  for (const id of ['ox-bottle', 'fu-bottle', 'n2-bottle']) {
    const n = s.net.nodes.find((node) => node.id === id);
    ok(n.Y.N2 === 1 && !n.Y.CH4 && !n.Y.O2, `${id} is filled with nitrogen`);
  }
  const c = components();
  approx(c['PCV-FU-01'].mdotRated, 0.0139, 1e-12, 'fuel regulator rated flow is PROJECT_PLAN §2.2, 13.9 g/s');
  approx(c['PCV-FU-01'].pSet, 480 * PSI, 1e-12, 'fuel manifold set point is 480 psia');
  approx(c['PCV-OX-01'].mdotRated, 0.0388, 1e-12, 'oxidizer rated flow stays 38.8 g/s');
  ok(c['HV-FU-01'].Cv === c['HV-OX-01'].Cv, 'the unselected fuel isolation valve keeps the oxidizer placeholder Cv');
  ok(c['PSV-N2-01'].set < c['PSV-OX-01'].set, 'the purge relief set is its own placeholder, not the propellant relief set');
  let refused = false;
  try {
    components({ parts: { a: { sameAs: 'b' }, b: { v: { value: 1, unit: 'Pa', placeholder: true, issue: 6 } } } });
  } catch (e) {
    refused = /sameAs needs/.test(e.message);
  }
  ok(refused, 'sameAs without a tracking issue is refused');

  section('Sequence file · Test_Stand/sequences/gn2-step1.json');
  ok(
    GN2_STEP1.steps.length === 4
      && GN2_STEP1.steps[0].t === 0.1
      && GN2_STEP1.steps[0].id === 'HV-OX-01'
      && GN2_STEP1.steps[0].cmd === 'open'
      && GN2_STEP1.steps[3].id === 'SV-OX-02'
      && GN2_STEP1.tEnd === 7
      && GN2_STEP1.rateHz === 50,
    'the file expands to the step-1 driver table',
  );
  ok(s.sequence.steps.every((st, i) => st.t === GN2_STEP1.steps[i].t && st.id === GN2_STEP1.steps[i].id && st.cmd === GN2_STEP1.steps[i].cmd), 'the full stand plays that same table');

  section('Full stand · step 1 does not open fuel or purge');
  const early = simulate(s.net, { gas: s.gas, tEnd: 0.5, schedule: s.sequence.steps, sampleDt: 0.1 });
  recordStats('full stand step1 to 0.5 s', early.stats);
  ok(Math.abs(early.final.edges['INJ-FU-01'].mdot) < 1e-9, 'the fuel injector stays below 1 µg/s');
  ok(!early.final.edges['CKV-N2-01'].open && Math.abs(early.final.edges['CKV-N2-01'].mdot) < 1e-9, 'the purge check stays shut');

  section('Scrub · replaying the sequence to an earlier time');
  const opts = { gas: s.gas, sampleDt: 0.05, horizon: 1 };
  const forward = createRun(s.net, opts);
  forward.schedule(s.sequence.steps);
  forward.advance(2);
  const scrub = createRun(s.net, opts);
  scrub.schedule(s.sequence.steps);
  scrub.advance(0.4);
  const sample = forward.out.samples.find((x) => Math.abs(x.t - 0.4) < 1e-9);
  ok(!!sample, 'the forward run has a sample at 0.4 s');
  if (sample) approx(scrub.readout().nodes['ox-bottle'].p, sample.nodes['ox-bottle'].p, 1e-6, 'rewinding to 0.4 s matches the forward run there');
  approx(scrub.readout().edges['HV-OX-01'].x, 0.3, 1e-9, 'at 0.4 s HV-OX-01 is 0.3 open (command at 0.1 s, 1 s stroke)');
  recordStats('full stand scrub replay to 0.4 s', scrub.stats());

  section('Phase 5 step 1 and step 3');
  const step1 = phase5Step1();
  recordStats('phase5 step1 prediction', step1.stats);
  ok(step1.uncalibrated && step1.flowing.choked && step1.flowing.margin > 2.2, `step 1 injector is choked, margin ${step1.flowing.margin.toFixed(2)}`);
  ok(Math.abs(step1.beforeMainValve.injector_mdot_kg_s) < 1e-9, 'step 1 sends nothing through the injector before the main valve');
  ok(step1.afterShutdown.line_Pa < 1.2e5 && step1.afterShutdown.chamber_Pa < 1.2e5, 'step 1 ends with the line and chamber blown down');

  const step3 = phase5Step3();
  recordStats('phase5 step3 blowdown', step3.stats);
  approx(step3.mass1, step3.mass0, 1e-9, 'mass conserved over the step 3 blowdown');
  for (const side of ['ox', 'fu']) {
    const row = step3[side];
    ok(row.choked && row.margin >= 2.2, `${side} injector is choked on nitrogen (margin ${row.margin.toFixed(2)})`);
    const flow = orificeFlow(injectorCdA(c, row.injector), asState(s.gas, row.line), asState(s.gas, row.chamber));
    approx(row.mdot_kg_s, flow.mdot, 1e-6, `${side} mass flow matches the orifice law at the settled line and chamber`);
    const reg = side === 'ox' ? 'PCV-OX-01' : 'PCV-FU-01';
    approx(row.manifold_Pa, c[reg].pSet, 0.02, `${side} manifold has settled within 2% of its set point`);
  }
  ok(!step3.purge_open && Math.abs(step3.purge_mdot_kg_s) < 1e-8, 'step 3 leaves the purge check shut');
  ok(step3.ox.mdot_kg_s > step3.fu.mdot_kg_s, 'the larger oxidizer holes pass more nitrogen than the fuel holes');

  const saved = JSON.parse(fs.readFileSync(new URL('../../../predictions/phase5.json', import.meta.url), 'utf8'));
  ok(saved.uncalibrated === true && /Not a prediction of what the hardware will do/.test(saved.label), 'predictions/phase5.json is labelled uncalibrated');
  approx(saved.step1.flowing.injector_mdot_kg_s, step1.flowing.injector_mdot_kg_s, 1e-6, 'committed step 1 mass flow is this run');
  approx(saved.step3.ox.mdot_kg_s, step3.ox.mdot_kg_s, 1e-6, 'committed step 3 oxidizer mass flow is this run');
  approx(saved.step3.fu.mdot_kg_s, step3.fu.mdot_kg_s, 1e-6, 'committed step 3 fuel mass flow is this run');
  ok(/Nitrogen through the propellant orifice geometry/.test(saved.step3.note), 'step 3 says the flows are nitrogen, not the design propellants');

  const table = fs.readFileSync(new URL('../../../../Phase2_Design/P&ID_valve_table.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(table === valveTableMarkdown(), 'Phase2_Design/P&ID_valve_table.md matches the generator');
  ok(table.includes('| HV-OX-01 |') && !table.includes('IGN-01') && !table.includes('PV-'), 'the matrix has the step-1 tags and none of the brief\'s format examples');
}
