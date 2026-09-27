/**
 * M6: Test mode. The done-when first: a synthetic "measured" log, made by the sim with known C_dA
 * values and written through the stand-daq-v1 file with noise and quantization, is fitted from the
 * stand's defaults, and the fitter must recover the known values. Then the prediction record, the
 * VALIDATION writer's refusal of simulated logs, and the sweeps against closed forms.
 */
import { ok, approx, section } from './harness.js';
import { predictReadings, fitAreas, areaOf, applyOverrides } from '../fit.js';
import { registerPrediction, compareToLog, validationSection, PREDICTION_FORMAT } from '../prediction.js';
import { steadyPoint, monteCarlo } from '../sweep.js';
import { daqCsv, parseDaq } from '../daq.js';
import { PSI } from '../constants.js';
import { gn2Coldflow } from '../../data/stands/gn2Coldflow.js';
import { components } from '../../data/components.js';
import { loadSequence, sequenceSource } from '../../data/sequences.js';

/** A synthetic log: the sim with `truth` areas, through the DAQ writer with a noise seed, parsed back. */
function syntheticLog(stand, seq, truth, seed) {
  const syn = predictReadings(stand, seq, { overrides: truth, quantize: true, seed });
  const rows = syn.t.map((t, i) => ({ t, values: Object.fromEntries(syn.channels.map((c) => [c.tag, syn.values[c.tag][i]])) }));
  return parseDaq(daqCsv({ source: 'sim', run: `${stand.id}/${seq.id}`, rateHz: seq.rateHz, channels: syn.channels, rows, seed }));
}

function recovery() {
  section('M6 done-when: a synthetic log with known C_dA is recovered by the fitter');
  const stand = gn2Coldflow();
  const seq = loadSequence('gn2-step1');
  const truth = { 'INJ-OX-01': areaOf(stand.net, 'INJ-OX-01') * 0.92, 'THROAT-01': areaOf(stand.net, 'THROAT-01') * 0.97 };
  const log = syntheticLog(stand, seq, truth, 7);
  ok(log.fields.source === 'sim' && log.fields.noise_seed === '7' && log.rows.length > 300, `synthetic log: ${log.rows.length} samples of ${log.channels.map((c) => c.tag).join(', ')}, noise seed 7, source: sim`);
  const f = fitAreas(stand, seq, log.rows, ['INJ-OX-01', 'THROAT-01'], ['PT-OX-03', 'PT-CH-01']);
  for (const id of f.params) {
    const err = f.fitted[id] / truth[id] - 1;
    ok(Math.abs(err) < 1e-3, `${id}: fitted ${f.fitted[id].toExponential(5)} m², known ${truth[id].toExponential(5)} m², error ${(err * 100).toFixed(3)}% (< 0.1%), from a start ${((f.start[id] / truth[id] - 1) * 100).toFixed(1)}% off`);
    ok(Math.abs(err) < 3 * f.sigmaRel[id], `${id}: the error is inside 3σ of the fit (σ = ${(f.sigmaRel[id] * 100).toFixed(3)}%)`);
  }
  ok(f.converged, `converged in ${f.iterations} iterations, ${f.evals} simulations`);
  const noise = 0.05 * PSI;
  for (const tag of f.tags) ok(f.rms[tag] < 1.5 * noise, `${tag}: residual after the fit ${(f.rms[tag] / PSI).toFixed(3)} psi RMS, the placeholder transducer noise is 0.05 psi (before: ${(f.rms0[tag] / PSI).toFixed(2)} psi)`);

  let refused = '';
  try {
    fitAreas(stand, seq, log.rows, ['PSV-OX-01'], ['PT-CH-01']);
  } catch (e) {
    refused = e.message;
  }
  ok(/cannot identify|not separately identifiable/.test(refused), 'an area that changes no reading (a relief that never lifts) is refused, not "fitted"');
  let bad = '';
  try {
    applyOverrides(stand.net, { 'SV-XX-99': 1e-6 });
  } catch (e) {
    bad = e.message;
  }
  ok(/no edge SV-XX-99/.test(bad), 'an override for an element the stand lacks is refused');
  return { stand, seq, log };
}

function prediction({ stand, seq, log }) {
  section('Prediction registration and the VALIDATION writer');
  const meta = { registered: '2026-09-27T00:00:00Z', sim: { commit: 'selftest' }, components: { commit: 'selftest' } };
  const rec = registerPrediction(stand, sequenceSource('gn2-step1'), seq, meta);
  ok(rec.format === PREDICTION_FORMAT && rec.uncalibrated === true && /Uncalibrated/.test(rec.label), 'the record is stand-prediction-v1 and labelled uncalibrated');
  ok(rec.table.id === 'gn2-step1' && rec.registered === meta.registered && rec.channels.length === stand.sensors.length, 'it carries the table, the registration time and every channel');
  const cmp = compareToLog(rec, log.rows);
  ok(cmp['PT-CH-01'].rms > 0 && cmp['PT-CH-01'].n > 300, `against the synthetic log (different C_dA) PT-CH-01 differs by ${(cmp['PT-CH-01'].rms / PSI).toFixed(2)} psi RMS`);
  const self = compareToLog(rec, rec.t.map((t, i) => ({ t, values: Object.fromEntries(rec.channels.map((c) => [c.tag, rec.readings[c.tag][i]])) })));
  ok(Object.values(self).every((c) => c.rms < 1e-6), 'compared with its own readings, every channel differs by 0 (to interpolation round-off, < 1 µPa)');
  let refused = '';
  try {
    validationSection({ testId: 'x', record: rec, daq: log });
  } catch (e) {
    refused = e.message;
  }
  ok(/source: sim/.test(refused), 'the VALIDATION writer refuses a simulated log: it would be verification written up as validation');
  const stamped = { ...log, fields: { ...log.fields, source: 'stand' } };
  const md = validationSection({ testId: '2027-10-02-test01', record: rec, daq: stamped });
  ok(md.startsWith('## 2027-10-02-test01') && md.includes('| PT-CH-01 |'), 'with a stand log it writes the section: per-channel RMS, largest and mean offset');
}

function sweeps() {
  section('Sweeps against closed forms');
  // Choked injectors from a fixed manifold pressure p₀: every flow ∝ p₀ and P_c = ṁ c*/A_t ∝ p₀
  // (c* barely moves with P_c), so the margin p₀/P_c is nearly independent of p₀.
  const a = steadyPoint({ pUp: 400 * PSI, eta: 0.88 });
  const b = steadyPoint({ pUp: 640 * PSI, eta: 0.88 });
  ok(a.chokedOx && b.chokedOx, 'at η_c* 0.88 the GOX injector is choked at both 400 and 640 psia');
  approx(b.marginOx, a.marginOx, 0.005, `holes as drawn: GOX margin ${a.marginOx.toFixed(4)} at 400 psia, ${b.marginOx.toFixed(4)} at 640 psia (P_c rises with p₀), 0.5%`);
  approx(b.Pc / a.Pc, 640 / 400, 0.01, 'and P_c scales with the manifold pressure, 1%');
  // Holes scaled to keep the flow: the same ṁ, so the same P_c, and the margin scales with p₀.
  const k = 400 / 640;
  const cd = components().injector.Cd;
  const s = steadyPoint({ pUp: 640 * PSI, eta: 0.88, CdOx: cd * k, CdFu: cd * k });
  // Not exact: the main valve's pressure drop (fixed C_v) does not scale with the holes.
  approx(s.Pc, a.Pc, 0.01, 'holes scaled by 400/640: the same P_c as at 400 psia, 1% (the main-valve drop does not scale)');
  approx(s.marginOx, (a.marginOx * 640) / 400, 0.01, 'and the margin grows by 640/400, 1%');
  const mc1 = monteCarlo({ params: { eta: { dist: 'uniform', lo: 0.9, hi: 0.94 } }, n: 6, seed: 3 });
  const mc2 = monteCarlo({ params: { eta: { dist: 'uniform', lo: 0.9, hi: 0.94 } }, n: 6, seed: 3 });
  ok(mc1.rows.every((r, i) => r.F === mc2.rows[i].F), 'Monte Carlo with a seed reproduces itself (fixture spread, not a hardware uncertainty)');
  ok(mc1.stats.F.p05 <= mc1.stats.F.p50 && mc1.stats.F.p50 <= mc1.stats.F.p95 && mc1.stats.F.sd > 0, `thrust spread: ${mc1.stats.F.mean.toFixed(1)} ± ${mc1.stats.F.sd.toFixed(2)} N over 6 draws of η_c* in [0.90, 0.94]`);
}

export function run() {
  const ctx = recovery();
  prediction(ctx);
  sweeps();
}
