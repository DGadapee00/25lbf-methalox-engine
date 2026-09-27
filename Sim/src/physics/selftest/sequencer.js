/**
 * M5: faults, aborts and sequence checks. The table driver is run on the hot-fire stand with a
 * fixture table (fixtures.js ABORT_FIXTURE): every abort nominal (must not fire) and with its
 * named fault (must fire, act, and cancel the rest of the table). Then the same demonstration over
 * every sequence file in Test_Stand/sequences/: the M5 done-when.
 */
import { ok, section, recordStats } from './harness.js';
import { runSequence, parseAbortCondition, parseCheck } from '../sequencer.js';
import { simulate } from '../simulate.js';
import { PSI } from '../constants.js';
import { expandSequence, loadSequence, sequenceSource, SEQUENCE_IDS } from '../../data/sequences.js';
import { hotFire } from '../../data/stands/hotFire.js';
import { fullStand } from '../../data/stands/fullStand.js';
import { ABORT_FIXTURE } from './fixtures.js';

const throws = (f, re) => {
  try {
    f();
  } catch (e) {
    return re.test(e.message);
  }
  return false;
};

function grammar() {
  section('Sequence grammar: aborts, checks, actions');
  const a = parseAbortCondition('PT-CH-01 < 150 psia after t=1.6');
  ok(a.signal === 'PT-CH-01' && a.op === '<' && Math.abs(a.value - 150 * PSI) < 1e-9 && a.span.from === 1.6 && a.span.to === Infinity, 'the brief\'s A-1 example parses: PT-CH-01 < 150 psia after t=1.6');
  ok(parseAbortCondition('PT-OX-02 > 700 psia for 3 samples').span.persist === 3, 'a persistence clause: for 3 samples');
  ok(throws(() => parseAbortCondition('PT-CH-01 < 150 psi'), /unit/), 'psi is refused for a transducer reading: absolute pressure is psia');
  ok(throws(() => parseAbortCondition('PV-OX-01 > 1 psia'), /sensor/), 'an abort reads a sensor tag, not a valve');
  ok(parseCheck('unburned energy at ignition < 500 J').kind === 'ignition-energy' && parseCheck('INJ-OX-01 choked from t=1.6 to t=2').kind === 'choked', 'check forms: ignition energy and choked over a time span');
  ok(parseCheck('chamber not burning after abort + 0.5 s').span.afterAbort === 0.5, 'a check can start relative to the abort');
  const noAction = { ...ABORT_FIXTURE, actions: {} };
  ok(throws(() => runSequence(hotFire(), expandSequence(noAction), { tEnd: 0.01 }), /not defined in this table's actions/), 'an abort whose action the table does not define is refused, not given a default');
  const wrongStand = expandSequence(ABORT_FIXTURE);
  ok(throws(() => runSequence(fullStand(), wrongStand, { tEnd: 0.01 }), /IGN-IG-01 is not on this stand/), 'a table that commands a tag the stand lacks is refused');
}

function faults() {
  section('Faults: valve stuck, injector blockage');
  const s = hotFire();
  const stuck = simulate(s.net, { gas: s.gas, tEnd: 0.3, sampleDt: 0.1, schedule: [{ t: 0, id: 'SV-OX-01', cmd: { fault: 'stuck' } }, { t: 0.1, id: 'SV-OX-01', cmd: 'open' }] });
  ok(stuck.final.edges['SV-OX-01'].x === 0 && stuck.final.edges['SV-OX-01'].stuck, 'a stuck valve ignores its open command');
  const moving = simulate(s.net, { gas: s.gas, tEnd: 0.3, sampleDt: 0.1, schedule: [{ t: 0.1, id: 'SV-OX-01', cmd: 'open' }, { t: 0.1 + 0.01 + 0.025, id: 'SV-OX-01', cmd: { fault: 'stuck' } }] });
  const x = moving.final.edges['SV-OX-01'].x;
  ok(Math.abs(x - 0.5) < 1e-9, `stuck mid-stroke it stays where it was: x = ${x.toFixed(3)} (half of a 50 ms stroke)`);
}

/** Run the fixture nominally and with each abort's fault. */
function fixture() {
  section('Aborts (fixture table on the hot-fire stand, fixture thresholds)');
  const seq = expandSequence(ABORT_FIXTURE);
  const nominal = runSequence(hotFire(), seq);
  recordStats('M5 fixture, nominal', nominal.out.stats);
  const rep = nominal.report;
  ok(!rep.abort && !rep.tripped.length, 'nominal: no abort trips');
  const byId = Object.fromEntries(rep.checks.map((c) => [c.id, c]));
  ok(byId['C-1'].pass && byId['C-2'].pass, `nominal: C-1 (${byId['C-1'].detail}) and C-2 pass`);
  ok(byId['C-3'].pass && /not applicable/.test(byId['C-3'].detail), 'nominal: C-3 (after abort) is not applicable, and passes');
  ok(!byId['C-4'].pass && !rep.pass, `nominal: C-4 fails, and so the report does: the GOX injector is not choked at the CEA P_c (${byId['C-4'].detail}); S-3`);

  for (const a of seq.aborts) {
    const r = runSequence(hotFire(), seq, { faults: a.test.faults });
    recordStats(`M5 fixture, ${a.id} triggered`, r.out.stats);
    const f = r.report.abort;
    ok(f && f.id === a.id, `${a.id} (${a.when}) fires under its fault ${JSON.stringify(a.test.faults[0].cmd)}${f ? ` at ${f.t.toFixed(3)} s` : ''}`);
    const fin = r.out.final;
    ok(fin.edges['SV-OX-01'].x === 0 && fin.edges['SV-FU-01'].x === 0 && !fin.chambers.chamber.igniter.on, `${a.id}: the action ran: main valves shut, igniter off`);
    ok(fin.edges['SV-N2-01'].x === 1, `${a.id}: and the purge valve opened ${seq.actions['safe-shutdown'][1].dt} s later`);
    const after = r.out.events.filter((e) => e.t > f.t + 1e-9 && (e.id === 'SV-OX-01' || e.id === 'SV-FU-01') && e.what === 'open');
    ok(!after.length, `${a.id}: no table step opened a main valve after the abort (the rest of the table was cancelled)`);
    const c3 = r.report.checks.find((c) => c.id === 'C-3');
    ok(c3.pass, `${a.id}: chamber not burning 0.5 s after the abort (${c3.detail})`);
  }
  const a2 = runSequence(hotFire(), seq, { faults: seq.aborts[1].test.faults });
  const t2 = a2.report.abort.t;
  const truth = a2.out.samples.find((x) => x.nodes['ox-manifold'].p > 650 * PSI)?.t;
  ok(truth !== undefined && t2 >= truth, `the abort reads the lagged, quantized transducer, not the node: true crossing ${truth?.toFixed(3)} s, abort at ${t2.toFixed(3)} s (3-sample persistence at 50 Hz)`);
}

function committed() {
  section('M5 done-when: every abort in every committed sequence table, both ways');
  let total = 0;
  for (const id of SEQUENCE_IDS) {
    const seq = loadSequence(id);
    total += seq.aborts.length;
    for (const a of seq.aborts) {
      ok(!!a.test?.faults?.length, `${id} ${a.id} names the fault that should trip it (abort.test.faults)`);
    }
  }
  const files = SEQUENCE_IDS.map((id) => `${id} (${sequenceSource(id).aborts?.length ?? 0} aborts)`).join(', ');
  ok(true, `committed tables: ${files}. ${total} aborts to demonstrate; the machinery is demonstrated on the fixture above. No hot-fire table exists yet.`);
  // When a committed table carries aborts, each is run nominally and with its test fault here.
  for (const id of SEQUENCE_IDS) {
    const seq = loadSequence(id);
    if (!seq.aborts.length) continue;
    const stand = id.startsWith('gn2') ? fullStand() : hotFire();
    const nominal = runSequence(stand, seq).report;
    for (const a of seq.aborts) {
      ok(!nominal.tripped.some((x) => x.id === a.id), `${id} ${a.id}: does not trip on the nominal run`);
      const r = runSequence(stand, seq, { faults: a.test?.faults || [] }).report;
      ok(r.tripped.some((x) => x.id === a.id), `${id} ${a.id}: trips under its test fault`);
    }
  }
}

export function run() {
  grammar();
  faults();
  fixture();
  committed();
}
