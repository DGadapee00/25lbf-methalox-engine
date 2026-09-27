/**
 * `npm run sil-check [-- <command> <args…>]`: run the SIL conformance over the stdio protocol.
 * Default sequencer: the reference table logic in a child process (scripts/sil/process.mjs). Give
 * another command (a native build of the firmware logic core, a serial bridge) to hold it to the
 * same checks as the table driver, on the M5 fixture table and every committed table.
 */
import { runSil, conformance } from '../src/physics/sil.js';
import { runSequence } from '../src/physics/sequencer.js';
import { expandSequence, sequenceSource, SEQUENCE_IDS } from '../src/data/sequences.js';
import { hotFire } from '../src/data/stands/hotFire.js';
import { gn2Coldflow } from '../src/data/stands/gn2Coldflow.js';
import { ABORT_FIXTURE } from '../src/physics/selftest/fixtures.js';
import { processSequencer } from './sil/adapter.mjs';

const [cmd, ...args] = process.argv.length > 2 ? process.argv.slice(2) : [process.execPath, 'scripts/sil/process.mjs'];
const cases = [];
const fx = expandSequence(ABORT_FIXTURE);
cases.push({ stand: hotFire, raw: ABORT_FIXTURE, seq: fx, faults: [], name: 'fixture, nominal' });
for (const a of fx.aborts) cases.push({ stand: hotFire, raw: ABORT_FIXTURE, seq: fx, faults: a.test.faults, name: `fixture, ${a.id} fault` });
for (const id of SEQUENCE_IDS) cases.push({ stand: gn2Coldflow, raw: sequenceSource(id), seq: expandSequence(sequenceSource(id)), faults: [], name: `${id} (committed)` });

let failed = 0;
for (const c of cases) {
  const stand = c.stand();
  const table = runSequence(stand, c.seq, { faults: c.faults }).report;
  const seqr = processSequencer(cmd, args, { table: c.raw, sensors: stand.sensors.map((s) => s.tag), rateHz: c.seq.rateHz });
  const sil = (await runSil(c.stand(), c.seq, seqr, { faults: c.faults })).report;
  seqr.close();
  const conf = conformance(table, sil, c.seq.rateHz);
  console.log(`  ${conf.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${conf.ok ? `aborts [${sil.tripped.map((x) => x.id).join(', ') || 'none'}], ${sil.checks.length} checks agree` : conf.problems.join('; ')}`);
  if (!conf.ok) failed++;
}
console.log(`\nsil-check: ${failed ? `${failed} failed` : `the sequencer (${[cmd, ...args].join(' ').replace(process.execPath, 'node')}) conforms to the table driver`}`);
process.exit(failed ? 1 : 0);
