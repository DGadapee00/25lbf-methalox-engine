/**
 * M7: the SIL harness. The reference sequencer (the table logic behind the plant interface) must
 * reach the table driver's verdicts on the same table and faults: the conformance a firmware
 * logic core will be held to once D-7 is decided. Here it proves the harness, not firmware.
 */
import { ok, section } from './harness.js';
import { runSil, createTableLogic, conformance } from '../sil.js';
import { runSequence } from '../sequencer.js';
import { expandSequence, loadSequence } from '../../data/sequences.js';
import { hotFire } from '../../data/stands/hotFire.js';
import { gn2Coldflow } from '../../data/stands/gn2Coldflow.js';
import { lsb } from '../sensors.js';
import { ABORT_FIXTURE } from './fixtures.js';

export async function run() {
  section('M7 · SIL harness: the reference sequencer against the table driver');
  const seq = expandSequence(ABORT_FIXTURE);
  const cases = [{ name: 'nominal', faults: [] }, ...seq.aborts.map((a) => ({ name: `${a.id} fault`, faults: a.test.faults }))];
  for (const c of cases) {
    const table = runSequence(hotFire(), seq, { faults: c.faults }).report;
    const sil = (await runSil(hotFire(), seq, createTableLogic(seq), { faults: c.faults })).report;
    const conf = conformance(table, sil, seq.rateHz);
    ok(conf.ok, `fixture table, ${c.name}: same aborts (${sil.tripped.map((x) => `${x.id} at ${x.t.toFixed(2)} s`).join(', ') || 'none'}) and the same verdict on all ${sil.checks.length} checks${conf.ok ? '' : `: ${conf.problems.join('; ')}`}`);
  }
  // The committed table: steps on the 50 Hz grid, so the two drivers command at the same instants.
  const g = loadSequence('gn2-step1');
  const a = runSequence(gn2Coldflow(), g).out.final;
  const b = (await runSil(gn2Coldflow(), g, createTableLogic(g))).out.final;
  const d = Math.abs(a.nodes.manifold.p - b.nodes.manifold.p);
  const step = lsb(1000 * 6894.757293168361, 16);
  ok(d < step, `gn2-step1 through the harness ends where the table driver ends: manifold differs by ${d.toExponential(2)} Pa, under one PT-OX-02 LSB (${step.toFixed(1)} Pa)`);
  const rogue = { step: () => ({ commands: [{ id: 'SV-XX-01', cmd: 'open' }] }) };
  let refused = '';
  try {
    await runSil(gn2Coldflow(), g, rogue, { tEnd: 0.02 });
  } catch (e) {
    refused = e.message;
  }
  ok(/not on this stand/.test(refused), 'a sequencer that commands a tag the stand lacks is stopped');
}
