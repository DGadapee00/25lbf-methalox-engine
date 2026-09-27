/**
 * Predict before test (brief J-5, §5.1 Test mode, M6).
 *
 * registerPrediction: what the sim says a test will read, frozen with everything needed to know
 * later what produced it: the table, the stand, the component file's stamp, the sim's commit, and
 * the time it was registered. The record is a file to commit under Sim/predictions/ before the
 * test (the app downloads it; scripts/predict.mjs writes it). It is always labelled uncalibrated
 * until a component has been fitted to measured data.
 *
 * compareToLog: the registered readings against a DAQ log, per channel: RMS and largest
 * difference over the overlap, and the mean offset.
 *
 * validationSection: the Markdown section for Sim/VALIDATION.md. It refuses a log whose header says
 * `source: sim`: a simulated log is verification of the fitter, never validation of the model.
 */
import { predictReadings } from './fit.js';

export const PREDICTION_FORMAT = 'stand-prediction-v1';
export const UNCALIBRATED_LABEL = 'Uncalibrated: placeholder hardware (issue #6) and uncalibrated injector C_d and η_c*. Not a prediction of what the hardware will do until the fitted values replace them.';

/**
 * stand: a stand spec; table: the raw table (file format); seq: the same table expanded;
 * meta: { registered (ISO string), sim: { commit, subject }, components: { generated, commit } }.
 */
export function registerPrediction(stand, table, seq, meta, { overrides = {}, faults = [] } = {}) {
  const pred = predictReadings(stand, seq, { overrides, faults, quantize: true });
  return {
    format: PREDICTION_FORMAT,
    registered: meta.registered,
    uncalibrated: true,
    label: UNCALIBRATED_LABEL,
    stand: stand.id,
    sequence: seq.id,
    table,
    sim: meta.sim,
    components: meta.components,
    overrides,
    faults,
    rateHz: seq.rateHz,
    channels: pred.channels.map(({ tag, node, quantity, unit, range, bits, tau }) => ({ tag, node, quantity, unit, range, bits, tau })),
    t: pred.t,
    readings: pred.values,
    report: { abort: pred.report.abort, checks: pred.report.checks, pass: pred.report.pass, ignitions: pred.report.ignitions },
  };
}

/** Per channel: { n, rms, maxAbs, meanDiff } of (measured − predicted), in the channel's unit (SI). */
export function compareToLog(record, rows) {
  const out = {};
  for (const ch of record.channels) {
    const ts = record.t;
    const ys = record.readings[ch.tag];
    let n = 0;
    let ss = 0;
    let sum = 0;
    let max = 0;
    for (const row of rows) {
      const m = row.values[ch.tag];
      if (!Number.isFinite(m) || row.t < ts[0] || row.t > ts[ts.length - 1]) continue;
      let i = 1;
      while (i < ts.length - 1 && ts[i] < row.t) i++;
      const w = (row.t - ts[i - 1]) / (ts[i] - ts[i - 1] || 1);
      const p = ys[i - 1] + w * (ys[i] - ys[i - 1]);
      const d = m - p;
      n++;
      ss += d * d;
      sum += d;
      max = Math.max(max, Math.abs(d));
    }
    if (n) out[ch.tag] = { n, rms: Math.sqrt(ss / n), maxAbs: max, meanDiff: sum / n, unit: ch.unit };
  }
  return out;
}

const fmt = (v, unit) => (unit === 'Pa' ? `${(v / 6894.757293168361).toFixed(2)} psi` : unit === 'N' ? `${v.toFixed(2)} N` : `${v.toPrecision(4)} ${unit}`);

/**
 * VALIDATION.md section. daq: parseDaq() output (fields, rows); record: a registered prediction;
 * fit: fitAreas() result or null; testId: the Phase 5 test day (e.g. "2027-10-02-test01").
 */
export function validationSection({ testId, record, daq, fit = null, notes = '' }) {
  if (daq.fields.source !== 'stand') {
    throw new Error(`validation: the log says source: ${daq.fields.source || '(none)'}. Only a log from the stand (source: stand) validates the model; a simulated log checks the fitter, not the physics.`);
  }
  const cmp = compareToLog(record, daq.rows);
  const lines = [
    `## ${testId}: ${record.sequence} on ${record.stand}`,
    '',
    `- Prediction registered ${record.registered} (sim ${record.sim?.commit || 'unknown'}, components ${record.components?.commit || 'unknown'}), before the test.`,
    `- DAQ log: run \`${daq.fields.run}\`, ${daq.rows.length} samples at ${daq.fields.rate_hz} Hz.`,
    '',
    '| channel | samples | RMS (measured − predicted) | largest | mean offset |',
    '| --- | --- | --- | --- | --- |',
    ...Object.entries(cmp).map(([tag, c]) => `| ${tag} | ${c.n} | ${fmt(c.rms, c.unit)} | ${fmt(c.maxAbs, c.unit)} | ${fmt(c.meanDiff, c.unit)} |`),
    '',
  ];
  if (fit) {
    lines.push(
      `C_dA fitted to this log (channels ${fit.tags.join(', ')}, ${fit.n} residuals, ${fit.converged ? 'converged' : 'NOT converged'}):`,
      '',
      '| element | before (m²) | fitted (m²) | change | 1σ (fit noise only) |',
      '| --- | --- | --- | --- | --- |',
      ...fit.params.map((id) => `| ${id} | ${fit.start[id].toExponential(4)} | ${fit.fitted[id].toExponential(4)} | ${((fit.fitted[id] / fit.start[id] - 1) * 100).toFixed(2)}% | ${(fit.sigmaRel[id] * 100).toFixed(2)}% |`),
      '',
    );
  }
  if (notes) lines.push(notes, '');
  return lines.join('\n');
}
