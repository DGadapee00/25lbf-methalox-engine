/**
 * The GN₂ cold-flow stand (data/stands/gn2Coldflow.js) that Operate mode runs: it must build under
 * the relief rule, carry S-2 tags, flag every placeholder, and behave as Phase 5 step 1 expects
 * with its default components. It is the same netlist the P&ID view draws.
 */
import { approx, ok, section, recordStats } from './harness.js';
import { simulate } from '../simulate.js';
import { failsOpenPeaks } from '../analysis.js';
import { gn2Coldflow, GN2_STEP1 } from '../../data/stands/gn2Coldflow.js';
import { measureSeries, lsb } from '../sensors.js';
import { daqCsv, parseDaq } from '../daq.js';
import { components, provenance } from '../../data/components.js';
import { tagProblems } from '../../data/tags.js';
import raw from '../../../data/components.json' with { type: 'json' };
import { PSI } from '../constants.js';

export function run() {
  section('Stand · GN₂ cold flow: build, tags, provenance');
  const s = gn2Coldflow();
  ok(!tagProblems(s.net).length, `every element carries an S-2 or engine-part tag (${tagProblems(s.net).join('; ') || 'clean'})`);
  const rows = provenance();
  ok(rows.length > 0 && rows.every((r) => (r.kind === 'placeholder' ? r.issue : true)), `${rows.filter((r) => r.kind === 'placeholder').length} placeholders, each with its tracking issue; ${rows.filter((r) => r.kind === 'uncalibrated').length} uncalibrated`);
  let refused = false;
  try {
    components({ parts: { x: { v: { value: 1, unit: 'psia' } } } });
  } catch (e) {
    refused = /source or placeholder/.test(e.message);
  }
  ok(refused, 'the loader refuses a number with neither a source nor a placeholder flag');
  const everyPart = Object.values(raw.parts).flatMap((p) => Object.values(p));
  ok(everyPart.every((v) => v.source || v.placeholder), 'every value in components.json has a source or is a placeholder');

  section('Stand · Phase 5 step 1 sequence on the defaults (placeholders, uncalibrated)');
  const r = simulate(s.net, { gas: s.gas, tEnd: GN2_STEP1.tEnd, schedule: GN2_STEP1.steps, sampleDt: 0.05 });
  recordStats('stand GN2 cold-flow sequence', r.stats);
  const at = (t) => r.samples.find((x) => x.t >= t - 1e-9);
  const flowing = at(4.5);
  approx(flowing.nodes.manifold.p, s.net.edges.find((e) => e.id === 'PCV-OX-01').pSet, 0.01, `flowing, the regulator holds the manifold at p_set (${(flowing.nodes.manifold.p / PSI).toFixed(1)} psia, 1%)`);
  ok(flowing.edges['INJ-OX-01'].choked && flowing.edges['INJ-OX-01'].margin > 2.2, `the injector is choked into the cold chamber with a wide margin (${flowing.edges['INJ-OX-01'].margin.toFixed(1)}; only hot fire is marginal)`);
  // Line and chamber both sit at ambient; tolerance-level pressure noise moves a little gas back
  // and forth through the steep near-Δp = 0 conductance. Under Dormand–Prince that was ~2e-8
  // kg/s; under Ros3 (default since M3) it is ~4e-10 kg/s, so the bound is back to 1 µg/s.
  ok(Math.abs(at(2.0).edges['INJ-OX-01'].mdot) < 1e-9 && at(2.0).nodes.line.p < 1.2e5, 'before SV-OX-01 opens nothing reaches the line (< 1 µg/s through the injector)');
  ok(r.final.nodes.line.p < 1.2e5 && r.final.nodes.chamber.p < 1.2e5, 'after SV-OX-01 closes, line and chamber blow down to ambient');
  const channels = s.sensors.map(({ offset, ...ch }) => ch);
  const measured = measureSeries(
    r.samples.map((x) => ({ t: x.t, p: Object.fromEntries(Object.entries(x.nodes).map(([k, v]) => [k, v.p])) })),
    channels,
  );
  const pt = channels.find((c) => c.tag === 'PT-OX-02');
  const atM = measured.find((x) => x.t >= 4.5 - 1e-9);
  ok(Math.abs(atM.values['PT-OX-02'] - flowing.nodes.manifold.p) <= 0.5 * lsb(pt.range, pt.bits) + 1e-6, 'steady manifold reading is the true pressure within half an LSB (quiet log, lag settled)');
  const csv = daqCsv({ run: `${s.id}/${GN2_STEP1.id}`, rateHz: GN2_STEP1.rateHz, channels, rows: measured });
  const parsed = parseDaq(csv);
  ok(parsed.fields.format === 'stand-daq-v1' && parsed.header.slice(1).join(',') === channels.map((c) => c.tag).join(','), 'the sequence log is stand-daq-v1 with the stand\'s transducer tags');
  const y0 = r.sys.initialState();
  approx(r.sys.totals(r.y).m, r.sys.totals(y0).m, 1e-9, 'mass conserved over the sequence (V-4 on the stand)');

  section('Stand · peak manifold pressure if PCV-OX-01 fails open (readout)');
  const [fo] = failsOpenPeaks(s.net, s.gas, { tEnd: 0.3 });
  recordStats('stand fails-open peak', fo.stats);
  ok(fo.settled <= fo.pFull * (1 + 1e-6) && fo.peak > fo.settled, `peak ${(fo.peak / PSI).toFixed(0)} psia, settles at ${(fo.settled / PSI).toFixed(0)} ≤ full lift ${(fo.pFull / PSI).toFixed(0)} (depends on ${fo.dependsOn.join(', ')})`);
}
