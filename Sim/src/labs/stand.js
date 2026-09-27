import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells, escapeHTML } from '../ui/shared.js';
import { fmtP, fmtMdot, fmtTime, sig, unitSystem } from '../ui/format.js';
import { createSimClient } from '../engine/simClient.js';
import { STANDS } from '../data/stands/index.js';
import { provenance } from '../data/components.js';
import { measureSeries } from '../physics/sensors.js';
import { daqCsv } from '../physics/daq.js';
import { PSI } from '../physics/constants.js';

/**
 * Operate and Sequence on a stand (brief §5.1). Operate: click a valve, the netlist runs live in
 * a Web Worker. Sequence: the stand's sequence table is scheduled up front and plays itself.
 * Either way the physics stays off the main thread.
 *
 * Transducer labels and the DAQ file are the observer in physics/sensors.js (lag, then noise in
 * the file only, then quantization). The pipes stay on the true node pressure.
 *
 * Everything here is uncalibrated, and most component values are placeholders (issue #6).
 */
const SCALES = [0.1, 0.25, 1, 2, 5];
const HISTORY_S = 30;
const NOISE_SEED = 1;

function channelsOf(sensors) {
  return sensors.map(({ offset, ...ch }) => ch);
}

function downloadCsv(name, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function standLab(id) {
  const spec = STANDS[id]();
  const valves = spec.net.edges.filter((e) => e.type === 'valve').map((e) => e.id);
  const reg = spec.net.edges.find((e) => e.type === 'regulator');
  const sequence = spec.sequence;
  const channels = channelsOf(spec.sensors || []);

  const provenanceList = () =>
    `<details class="prov"><summary>Placeholders and uncalibrated values (${provenance().length})</summary><ul>${provenance()
      .map((r) => `<li><b>${escapeHTML(r.part)}.${escapeHTML(r.key)}</b> = ${r.value} ${escapeHTML(r.unit)} <span class="${r.kind}">${r.kind}${r.issue ? ` #${r.issue}` : ''}</span>${r.note ? ` — ${escapeHTML(r.note)}` : ''}</li>`)
      .join('')}</ul></details>`;

  const scaleSelect = (s) =>
    `<label>Time scale <select id="st-scale">${SCALES.map((k) => `<option value="${k}"${k === s.scale ? ' selected' : ''}>${k}×</option>`).join('')}</select></label>`;

  return defineLab({
    id,
    title: spec.title,
    status: 'uncalibrated',
    live: true,
    hint: 'Operate: click a valve, starting with HV-OX-01 then SV-OX-01. Sequence plays the step-1 table. Download DAQ CSV writes the transducer log.',
    defaultState: () => ({ mode: 'operate', scale: 1, paused: false, pSetPsia: reg ? reg.pSet / PSI : 0, fault: null }),
    controls: (s) => {
      const runButtons = `<button type="button" id="st-pause">${s.paused ? 'Resume' : 'Pause'}</button>
      <button type="button" id="st-reset">Reset</button>
      <button type="button" id="st-daq">Download DAQ CSV</button>`;
      if (s.mode === 'sequence') {
        const rows = (sequence?.steps || [])
          .map((st, i) => `<tr data-step="${i}"><td>${st.t.toFixed(2)} s</td><td>${escapeHTML(st.id)}</td><td>${escapeHTML(String(st.cmd))}</td></tr>`)
          .join('');
        return `
          <h3>Sequence</h3>
          <p class="note">${escapeHTML(sequence?.id || '')} · ${sequence?.tEnd ?? ''} s · ${sequence?.rateHz ?? ''} Hz. The table is the run; valves are not clicked.</p>
          <table class="seq" id="seq-table">${rows}</table>
          ${scaleSelect(s)}
          ${runButtons}
          ${provenanceList()}`;
      }
      return `
        <h3>Operate</h3>
        <div class="valve-list">${valves.map((v) => `<button type="button" class="valve-btn" data-valve="${v}">${v}</button>`).join('')}</div>
        ${scaleSelect(s)}
        ${runButtons}
        ${reg ? `<label>${reg.id} set point (psia) <input id="st-pset" type="number" min="50" max="900" step="5" value="${s.pSetPsia.toFixed(0)}"></label>
        <label>${reg.id} fault <select id="st-fault"><option value="">none</option><option value="open"${s.fault === 'open' ? ' selected' : ''}>fails open</option><option value="closed"${s.fault === 'closed' ? ' selected' : ''}>fails closed</option></select></label>` : ''}
        ${provenanceList()}`;
    },
    bind({ state: s, bump, root, handle: h }) {
      h.root = root;
      root.querySelectorAll('.valve-btn').forEach((b) => b.addEventListener('click', () => h.toggle(b.dataset.valve)));
      root.querySelector('#st-scale').addEventListener('input', (e) => ((s.scale = Number(e.target.value)), bump()));
      root.querySelector('#st-pause').addEventListener('click', (e) => {
        s.paused = !s.paused;
        e.target.textContent = s.paused ? 'Resume' : 'Pause';
      });
      root.querySelector('#st-reset').addEventListener('click', () => h.reset());
      root.querySelector('#st-daq').addEventListener('click', () => h.download());
      const ps = root.querySelector('#st-pset');
      if (ps) ps.addEventListener('change', (e) => {
        s.pSetPsia = Number(e.target.value);
        h.client.command(reg.id, { pSet: s.pSetPsia * PSI });
      });
      const fl = root.querySelector('#st-fault');
      if (fl) fl.addEventListener('input', (e) => {
        s.fault = e.target.value || null;
        h.client.command(reg.id, { fault: s.fault });
      });
    },
    setMode(s, h, mode) {
      s.mode = mode;
      h.mode = mode;
      h.history = [];
      h.quiet = [];
      h.error = null;
      h.client.init(id, mode === 'sequence' ? sequence.steps : []);
    },
    init(ctx) {
      const pid = new PidView(ctx.scene);
      pid.build(spec, { circuitColor: Q.ox });
      pid.setVisible(false);
      const h = { pid, live: null, history: [], quiet: [], failsOpen: null, error: null, client: null, mode: null, root: null };
      const onMsg = (m) => {
        if (m.type === 'ready') {
          h.live = m;
          h.failsOpen = m.failsOpen;
          h.history = [];
          h.quiet = [];
        } else if (m.type === 'state') {
          h.live = m;
          h.history.push(...m.samples);
          const cut = m.t - HISTORY_S;
          while (h.history.length && h.history[0].t < cut) h.history.shift();
          h.quiet = h.history.length ? measureSeries(h.history.map((x) => ({ t: x.t, p: x.p })), channels) : [];
        } else if (m.type === 'error') {
          h.error = m.message;
        }
        h.fresh = true;
      };
      h.client = createSimClient(onMsg);
      h.toggle = (tag) => {
        if (h.mode !== 'operate' || !valves.includes(tag) || !h.live) return;
        const x = h.live.readout.edges[tag]?.x ?? 0;
        h.client.command(tag, x > 0.5 ? 'close' : 'open');
      };
      h.reset = () => {
        h.history = [];
        h.quiet = [];
        h.error = null;
        h.client.init(id, h.mode === 'sequence' ? sequence.steps : []);
      };
      h.download = () => {
        const noisy = h.history.length ? measureSeries(h.history.map((x) => ({ t: x.t, p: x.p })), channels, { seed: NOISE_SEED }) : [];
        const run = `${id}/${h.mode === 'sequence' ? sequence.id : 'operate'}`;
        const text = daqCsv({ run, rateHz: sequence.rateHz, channels, rows: noisy, seed: NOISE_SEED });
        downloadCsv(`${run.replace('/', '-')}.csv`, text);
      };
      return h;
    },
    enter(ctx, h) {
      h.pid.setVisible(true);
    },
    exit(ctx, h) {
      h.pid.setVisible(false);
    },
    view: { x: -0.5, y: 0.1, z: 17.5 },
    onPick(tag, h) {
      h.toggle(tag);
    },
    tick(dt, s, computed, h) {
      if (!s.paused) h.client.advance(Math.min(0.1, dt) * s.scale);
      if (h.fresh) {
        h.fresh = false;
        return true;
      }
      return false;
    },
    recompute(s, computed, ctx, h) {
      const last = h?.quiet?.[h.quiet.length - 1];
      computed[id] = {
        t: h?.live?.t ?? 0,
        readout: h?.live?.readout ?? null,
        measured: last?.values ?? null,
        failsOpen: h?.failsOpen,
        error: h?.error,
        stats: h?.live?.stats,
        mode: s.mode,
      };
    },
    syncViews(s, computed, ctx, h) {
      const c = computed[id];
      if (c.readout) h.pid.update({ ...c.readout, measured: c.measured }, 1 / 60, fmtP);
      c.choke = h.pid.chokeStates();
      if (s.mode === 'sequence' && h.root && sequence) {
        let current = -1;
        sequence.steps.forEach((st, i) => {
          if (st.t <= c.t + 1e-9) current = i;
        });
        h.root.querySelectorAll('[data-step]').forEach((el) => el.classList.toggle('now', Number(el.dataset.step) === current));
      }
    },
    law: () => ['\\dfrac{dm_k}{dt} = \\sum_{\\text{in}} \\mdot - \\sum_{\\text{out}} \\mdot', '\\dfrac{dU_k}{dt} = \\sum_{\\text{in}} \\mdot\\,h - \\sum_{\\text{out}} \\mdot\\,h'],
    liveRows: (s, computed) => {
      const c = computed[id];
      if (c.error) return kv('error', escapeHTML(c.error));
      if (!c.readout) return kv('status', 'starting the worker…');
      const r = c.readout;
      const rows = [kv('$t$', fmtTime(c.t)), kv('mode', s.mode)];
      for (const n of spec.net.nodes) if (n.kind === 'volume') rows.push(kv(n.label || n.id, fmtP(r.nodes[n.id].p)));
      if (c.measured) rows.push(kv('PT-OX-02 measured', fmtP(c.measured['PT-OX-02'])));
      rows.push(kv('$\\mdot$ INJ-OX-01', fmtMdot(r.edges['INJ-OX-01'].mdot)));
      rows.push(kv('INJ-OX-01 $p_0/p$', sig(r.edges['INJ-OX-01'].margin, 3)));
      if (reg) rows.push(kv(`${reg.id} opening $z$`, sig(r.edges[reg.id].z, 3)));
      return rows.join('');
    },
    readout: (s, computed) => {
      const c = computed[id];
      if (!c.readout) return '';
      const r = c.readout;
      const fo = (c.failsOpen || [])[0];
      const foCell = fo && !fo.error ? `${fmtP(fo.peak)} <small class="caveat" title="${escapeHTML(fo.caveat)}">depends on ${escapeHTML(fo.dependsOn.join(', '))}</small>` : fo?.error ? escapeHTML(fo.error) : '…';
      return cells([
        ['manifold', fmtP(r.nodes.manifold.p)],
        ['PT-OX-02', c.measured ? fmtP(c.measured['PT-OX-02']) : '…'],
        ['$\\mdot$ injector', fmtMdot(r.edges['INJ-OX-01'].mdot)],
        ['chamber', fmtP(r.nodes.chamber.p)],
        ['peak manifold if PCV fails open', foCell],
      ]);
    },
    coach: (s, computed) => {
      const c = computed[id];
      const fo = (c.failsOpen || [])[0];
      return {
        title: 'GN₂ cold flow (Phase 5 step 1)',
        body: [
          'Everything on this stand is uncalibrated and most component values are placeholders (listed in the Setup panel, issue #6). It shows how the stand behaves with those values, not what the hardware will do.',
          'The transducer tags are the lagged, quantized reading. Download DAQ CSV adds the placeholder noise with a fixed seed, in the format in Test_Stand/daq_format.md.',
          s.mode === 'sequence' ? `Sequence ${sequence.id} opens the bottle isolation, then the main valve, then vents the manifold. The highlighted row is the last command at or before the current time.` : '',
          fo && !fo.error ? `If PCV-OX-01 fails open with the main valve shut, the manifold peaks at ${fmtP(fo.peak)} before the relief catches it and settles at ${fmtP(fo.settled)}. Manifold hardware ratings and the MEOP must cover the peak. It depends on the relief lift time and the regulator poppet lag, both placeholders: a scale, not a design value.` : '',
        ],
      };
    },
    plot: (s, computed, h) => {
      const hist = h?.history || [];
      if (!hist.length) return null;
      const [u, f] = unitSystem() === 'us' ? ['psia', PSI] : ['MPa', 1e6];
      const ts = hist.map((x) => x.t);
      const series = [
        { xs: ts, ys: hist.map((x) => x.p.manifold / f), color: '#8fa88a', label: 'manifold' },
        { xs: ts, ys: hist.map((x) => x.p.line / f), color: '#58c4dd', label: 'line' },
        { xs: ts, ys: hist.map((x) => x.p.chamber / f), color: '#fc6255', label: 'chamber' },
      ];
      if (h.quiet?.length) series.push({ xs: h.quiet.map((x) => x.t), ys: h.quiet.map((x) => x.values['PT-OX-02'] / f), color: '#f4d345', label: 'PT-OX-02' });
      return {
        series,
        hlines: reg ? [{ y: (s.pSetPsia * PSI) / f, color: '#9a9591', label: 'p_set' }] : [],
        xLabel: 't (s)',
        yLabel: `p (${u})`,
        yMin: 0,
        xFmt: (v) => sig(v, 3),
        yFmt: (v) => sig(v, 3),
      };
    },
  });
}

export default standLab('gn2-coldflow');
