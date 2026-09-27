/**
 * Test-mode worker (brief §5.1 Test, M6). The runs behind Test mode take seconds (a prediction is
 * one simulation of the whole table; a fit is tens), so they stay off the main thread and off the
 * live stand's worker.
 *
 * Messages in:
 *   { type: 'predict', id, stand, table, meta, overrides? }       → { type: 'prediction', id, record }
 *   { type: 'synthetic', id, stand, table, overrides, seed }       → { type: 'synthetic', id, csv }
 *   { type: 'fit', id, stand, table, rows, params, tags, meta }   → { type: 'progress', id, iter, ssr }…
 *                                                                    { type: 'fit', id, fit, record }
 * Out on failure: { type: 'error', id, message }.
 */
import { STANDS } from '../data/stands/index.js';
import { expandSequence } from '../data/sequences.js';
import { registerPrediction } from '../physics/prediction.js';
import { predictReadings, fitAreas } from '../physics/fit.js';
import { daqCsv } from '../physics/daq.js';

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    const stand = STANDS[m.stand]();
    const seq = expandSequence(m.table);
    if (m.type === 'predict') {
      self.postMessage({ type: 'prediction', id: m.id, record: registerPrediction(stand, m.table, seq, m.meta, { overrides: m.overrides || {} }) });
    } else if (m.type === 'synthetic') {
      const syn = predictReadings(stand, seq, { overrides: m.overrides, quantize: true, seed: m.seed });
      const rows = syn.t.map((t, i) => ({ t, values: Object.fromEntries(syn.channels.map((c) => [c.tag, syn.values[c.tag][i]])) }));
      self.postMessage({ type: 'synthetic', id: m.id, csv: daqCsv({ source: 'sim', run: `${m.stand}/${seq.id}/synthetic`, rateHz: seq.rateHz, channels: syn.channels, rows, seed: m.seed }) });
    } else if (m.type === 'fit') {
      const fit = fitAreas(stand, seq, m.rows, m.params, m.tags, { onIter: (x) => self.postMessage({ type: 'progress', id: m.id, iter: x.iter, ssr: x.ssr }) });
      const record = registerPrediction(stand, m.table, seq, m.meta, { overrides: fit.fitted });
      self.postMessage({ type: 'fit', id: m.id, fit, record });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: String(e.message || e) });
  }
};
