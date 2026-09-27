/**
 * Test mode on a stand (brief §5.1, J-5, M6): predict before the test, import the DAQ log after
 * it, overlay measured on predicted, fit C_dA values to the log, and write the VALIDATION.md
 * section. The runs go to engine/testWorker.js.
 *
 * Nothing here writes to the repository. "Register" downloads the prediction record for you to
 * commit before the test (or use `npm run predict`); the VALIDATION section downloads as Markdown
 * (or use `npm run validate -- --write`). A log whose header says `source: sim` is marked
 * synthetic everywhere and the VALIDATION button refuses it.
 */
import { escapeHTML, kv } from '../ui/shared.js';
import { fmtF, sig, unitSystem } from '../ui/format.js';
import { parseDaq } from '../physics/daq.js';
import { compareToLog, validationSection } from '../physics/prediction.js';
import { componentsMeta } from '../data/components.js';
import { PSI } from '../physics/constants.js';

const COLORS = { predicted: '#9a9591', measured: '#f4d345', fitted: '#58c4dd' };

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function createTestPanel({ id, spec, tableOf }) {
  const areas = spec.net.edges.filter((e) => e.type === 'orifice' || e.type === 'valve').map((e) => e.id);
  const tags = (spec.sensors || []).map((c) => c.tag);
  let worker = null;
  let seq = 0;
  const pending = new Map();
  const call = (msg, onProgress) => {
    if (!worker) {
      worker = new Worker(new URL('../engine/testWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (ev) => {
        const p = pending.get(ev.data.id);
        if (!p) return;
        if (ev.data.type === 'progress') return p.onProgress?.(ev.data);
        pending.delete(ev.data.id);
        if (ev.data.type === 'error') p.reject(new Error(ev.data.message));
        else p.resolve(ev.data);
      };
    }
    const mid = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(mid, { resolve, reject, onProgress });
      worker.postMessage({ ...msg, id: mid, stand: id });
    });
  };
  const meta = () => ({
    registered: new Date().toISOString(),
    sim: { commit: typeof __BUILD__ !== 'undefined' ? __BUILD__.commit : 'unknown', subject: typeof __BUILD__ !== 'undefined' ? __BUILD__.subject : '' },
    components: componentsMeta,
  });

  const state = { record: null, log: null, logName: '', fit: null, fitted: null, busy: '', progress: '', error: '' };

  const defaults = () => ({ channel: tags.find((t) => t === 'PT-CH-01') || tags[0], params: [], tags: [...tags], synth: Object.fromEntries(areas.map((a) => [a, 100])), seed: 7, testId: '' });

  function controls(s) {
    const t = s.test;
    const table = tableOf(s);
    if (!table) return `<h3>Test</h3><p class="note">Test mode plays a sequence table. This stand has none committed; load one in Sequence mode first.</p>`;
    const synthetic = state.log?.fields.source === 'sim';
    const cmp = state.record && state.log ? compareToLog(state.record, state.log.rows) : null;
    return `
      <h3>Test</h3>
      <p class="note">Table ${escapeHTML(table.id)} · ${escapeHTML(s.tableName)}. Uncalibrated until a fit replaces a value.</p>
      <h4>1 · Predict before the test</h4>
      <button type="button" id="ts-predict"${state.busy ? ' disabled' : ''}>Run the prediction</button>
      ${state.record ? `<button type="button" id="ts-download-pred">Download prediction (.json)</button><p class="note">Registered ${escapeHTML(state.record.registered)}, sim ${escapeHTML(state.record.sim?.commit || '')}. Commit it under Sim/predictions/ before the test (or run <code>npm run predict</code>).</p>` : ''}
      <h4>2 · Import the DAQ log</h4>
      <label>stand-daq-v1 CSV <input id="ts-log" type="file" accept=".csv,text/csv"></label>
      ${state.log ? `<p class="note">${escapeHTML(state.logName)}: run ${escapeHTML(state.log.fields.run)}, ${state.log.rows.length} samples. ${synthetic ? '<b class="warn">Synthetic (source: sim): a check of the fitter, not validation.</b>' : 'source: stand.'}</p>` : ''}
      <details class="synth"><summary>Or make a synthetic log with known areas</summary>
        <p class="note">The sim with these areas (% of the stand's value), through the DAQ writer with noise and quantization. Fitting it from the stand's values should give them back (the M6 done-when).</p>
        ${areas.filter((a) => /^(INJ|THROAT)/.test(a)).map((a) => `<label>${a} (%) <input data-synth="${a}" type="number" min="10" max="300" step="1" value="${t.synth[a]}"></label>`).join('')}
        <label>Noise seed <input id="ts-seed" type="number" step="1" value="${t.seed}"></label>
        <button type="button" id="ts-synth"${state.busy ? ' disabled' : ''}>Make synthetic log</button>
      </details>
      <h4>3 · Overlay</h4>
      <label>Channel <select id="ts-channel">${tags.map((g) => `<option value="${g}"${g === t.channel ? ' selected' : ''}>${g}</option>`).join('')}</select></label>
      ${cmp ? `<table class="seq">${Object.entries(cmp).map(([g, c]) => `<tr><td>${g}</td><td>RMS ${c.unit === 'N' ? fmtF(c.rms) : `${sig(c.rms / PSI, 3)} psi`}</td></tr>`).join('')}</table>` : '<p class="note">Run the prediction and import a log to compare them.</p>'}
      <h4>4 · Fit C_dA to the log</h4>
      <div class="checks">${areas.map((a) => `<label class="check"><input type="checkbox" data-param="${a}"${t.params.includes(a) ? ' checked' : ''}> ${a}</label>`).join('')}</div>
      <p class="note">Channels to fit:</p>
      <div class="checks">${tags.map((g) => `<label class="check"><input type="checkbox" data-tag="${g}"${t.tags.includes(g) ? ' checked' : ''}> ${g}</label>`).join('')}</div>
      <button type="button" id="ts-fit"${state.busy || !state.log ? ' disabled' : ''}>Fit</button>
      ${state.busy ? `<p class="note">${escapeHTML(state.busy)} ${escapeHTML(state.progress)}</p>` : ''}
      ${state.error ? `<p class="note bad">${escapeHTML(state.error)}</p>` : ''}
      ${state.fit ? `<table class="seq"><tr><td>element</td><td>fitted</td><td>change</td><td>1σ</td></tr>${state.fit.params.map((a) => `<tr><td>${a}</td><td>${state.fit.fitted[a].toExponential(4)} m²</td><td>${sig((state.fit.fitted[a] / state.fit.start[a] - 1) * 100, 3)}%</td><td>${sig(state.fit.sigmaRel[a] * 100, 2)}%</td></tr>`).join('')}</table><p class="note">${state.fit.converged ? 'Converged' : 'Not converged'} in ${state.fit.iterations} iterations. σ is the fit's noise only, not model error.</p>` : ''}
      <h4>5 · VALIDATION.md</h4>
      <label>Test id <input id="ts-testid" type="text" placeholder="2027-10-02-test01" value="${escapeHTML(t.testId)}"></label>
      <button type="button" id="ts-validation"${!state.record || !state.log ? ' disabled' : ''}>Download VALIDATION section</button>`;
  }

  function bind({ state: s, root, redraw, bump }) {
    const t = s.test;
    const run = (label, p) => {
      state.busy = label;
      state.progress = '';
      state.error = '';
      redraw();
      return p
        .catch((e) => {
          state.error = e.message;
        })
        .finally(() => {
          state.busy = '';
          redraw();
          bump();
        });
    };
    const table = () => s.table;
    root.querySelector('#ts-predict')?.addEventListener('click', () => run('Running the table…', call({ type: 'predict', table: table(), meta: meta() }).then((m) => {
      state.record = m.record;
      state.fitted = null;
    })));
    root.querySelector('#ts-download-pred')?.addEventListener('click', () => download(`${state.record.registered.slice(0, 10)}-${id}-${state.record.sequence}.json`, `${JSON.stringify(state.record)}\n`, 'application/json'));
    root.querySelector('#ts-log')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      f.text().then((text) => {
        try {
          state.log = parseDaq(text);
          state.logName = f.name;
          state.fit = null;
          state.fitted = null;
          state.error = '';
        } catch (err) {
          state.error = `${f.name}: ${err.message}`;
        }
        redraw();
        bump();
      });
    });
    root.querySelectorAll('[data-synth]').forEach((el) => el.addEventListener('input', () => (t.synth[el.dataset.synth] = Number(el.value))));
    root.querySelector('#ts-seed')?.addEventListener('input', (e) => (t.seed = Math.round(Number(e.target.value) || 1)));
    root.querySelector('#ts-synth')?.addEventListener('click', () => api.synthetic());
    root.querySelector('#ts-channel')?.addEventListener('input', (e) => ((t.channel = e.target.value), bump()));
    root.querySelectorAll('[data-param]').forEach((el) => el.addEventListener('change', () => {
      t.params = el.checked ? [...t.params, el.dataset.param] : t.params.filter((x) => x !== el.dataset.param);
    }));
    root.querySelectorAll('[data-tag]').forEach((el) => el.addEventListener('change', () => {
      t.tags = el.checked ? [...t.tags, el.dataset.tag] : t.tags.filter((x) => x !== el.dataset.tag);
    }));
    root.querySelector('#ts-fit')?.addEventListener('click', () => api.fit());
    root.querySelector('#ts-testid')?.addEventListener('input', (e) => (t.testId = e.target.value));
    root.querySelector('#ts-validation')?.addEventListener('click', () => {
      try {
        const md = validationSection({ testId: t.testId || 'test', record: state.record, daq: state.log, fit: state.fit });
        download(`VALIDATION-${t.testId || 'test'}.md`, md, 'text/markdown');
      } catch (e) {
        state.error = e.message;
        redraw();
      }
    });
    api.s = s;
    api.run = run;
  }

  // Scripted entry points (and the smoke test).
  const api = {
    s: null,
    run: null,
    synthetic() {
      const s = api.s;
      const overrides = {};
      for (const [a, pct] of Object.entries(s.test.synth)) {
        if (pct === 100) continue;
        const e = spec.net.edges.find((x) => x.id === a);
        overrides[a] = (e.type === 'valve' ? e.CdAmax : e.CdA) * (pct / 100);
      }
      return api.run('Making the synthetic log…', call({ type: 'synthetic', table: s.table, overrides, seed: s.test.seed }).then((m) => {
        state.log = parseDaq(m.csv);
        state.logName = 'synthetic log';
        state.fit = null;
        state.fitted = null;
        state.truth = overrides;
      }));
    },
    fit() {
      const s = api.s;
      if (!s.test.params.length) {
        state.error = 'Tick at least one element to fit.';
        return Promise.resolve();
      }
      return api.run('Fitting…', call({ type: 'fit', table: s.table, rows: state.log.rows, params: s.test.params, tags: s.test.tags, meta: meta() }, (p) => {
        state.progress = `iteration ${p.iter + 1}, SSR ${p.ssr.toExponential(3)}`;
      }).then((m) => {
        state.fit = m.fit;
        state.fitted = m.record;
      }));
    },
    state,
  };

  function series(s) {
    const g = s.test.channel;
    const f = unitSystem() === 'us' ? PSI : 1e6;
    const conv = (v) => (/^LC-/.test(g) ? v : v / f);
    const out = [];
    if (state.record) out.push({ xs: state.record.t, ys: state.record.readings[g].map(conv), color: COLORS.predicted, label: 'predicted' });
    if (state.log) out.push({ xs: state.log.rows.map((r) => r.t), ys: state.log.rows.map((r) => conv(r.values[g])), color: COLORS.measured, label: state.log.fields.source === 'sim' ? 'synthetic log' : 'measured' });
    if (state.fitted) out.push({ xs: state.fitted.t, ys: state.fitted.readings[g].map(conv), color: COLORS.fitted, label: 'fitted' });
    return out;
  }

  return {
    defaults,
    controls,
    bind,
    api,
    plot(s) {
      const sr = series(s);
      if (!sr.length) return null;
      const g = s.test.channel;
      const unit = /^LC-/.test(g) ? 'N' : unitSystem() === 'us' ? 'psia' : 'MPa';
      return { series: sr, xLabel: 't (s)', yLabel: `${g} (${unit})`, yMin: 0, xFmt: (v) => sig(v, 3), yFmt: (v) => sig(v, 3) };
    },
    liveRows(s) {
      const rows = [kv('mode', 'test')];
      if (state.record) rows.push(kv('prediction', `${state.record.sequence}, ${state.record.t.length} samples`));
      if (state.log) rows.push(kv('log', `${state.log.rows.length} samples${state.log.fields.source === 'sim' ? ' (synthetic)' : ''}`));
      if (state.fit) for (const a of state.fit.params) rows.push(kv(`${a} $C_dA$`, `${state.fit.fitted[a].toExponential(4)} m² (${sig((state.fit.fitted[a] / state.fit.start[a] - 1) * 100, 3)}%)`));
      if (state.fit && state.truth) for (const a of state.fit.params) if (state.truth[a]) rows.push(kv(`${a} vs known`, `${sig((state.fit.fitted[a] / state.truth[a] - 1) * 100, 3)}%`));
      if (state.fit) for (const [g, r] of Object.entries(state.fit.rms)) rows.push(kv(`${g} residual`, /^LC-/.test(g) ? fmtF(r) : `${sig(r / PSI, 3)} psi RMS`));
      return rows.join('');
    },
    coach() {
      return {
        title: 'Test mode: predict, then compare',
        body: [
          'Before a Phase 5 test, run the prediction and commit the file: that freezes what the sim said, with the table, the sim commit and the component stamp.',
          'After the test, import the DAQ log (stand-daq-v1, Test_Stand/daq_format.md). Tick the effective areas the log can see and fit them: least squares on the transducer readings, the whole table re-simulated for every trial. A fitted area is the first thing in the sim that is calibrated.',
          'A synthetic log made here is labelled source: sim. Fitting it checks the fitter; it validates nothing, and the VALIDATION button refuses it.',
          'The sim never substitutes for a test step. It is a tool for being proven wrong by hardware early.',
        ],
      };
    },
  };
}

