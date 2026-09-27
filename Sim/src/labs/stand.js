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
  const regs = spec.net.edges.filter((e) => e.type === 'regulator');
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
    hint: spec.hint || 'Operate: click a valve, starting with HV-OX-01 then SV-OX-01. Sequence plays the step-1 table and the timeline scrubs it. Download DAQ CSV writes the transducer log.',
    defaultState: () => ({
      mode: 'operate',
      scale: 1,
      paused: false,
      scrubbing: false,
      pSetPsia: Object.fromEntries(regs.map((r) => [r.id, r.pSet / PSI])),
      fault: Object.fromEntries(regs.map((r) => [r.id, null])),
    }),
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
          <p class="note">${escapeHTML(sequence?.id || '')} · ${sequence?.tEnd ?? ''} s · ${sequence?.rateHz ?? ''} Hz. The table is the run. Scrub the timeline; valves are not clicked.</p>
          <table class="seq" id="seq-table">${rows}</table>
          <label class="scrub">Timeline <input id="st-scrub" type="range" min="0" max="${sequence?.tEnd ?? 1}" step="0.01" value="0"> <span id="st-scrub-t">0 s</span></label>
          ${scaleSelect(s)}
          ${runButtons}
          ${provenanceList()}`;
      }
      const regControls = regs.map((r) => `<label>${r.id} set point (psia) <input data-pset="${r.id}" type="number" min="50" max="900" step="5" value="${s.pSetPsia[r.id].toFixed(0)}"></label>
        <label>${r.id} fault <select data-fault="${r.id}"><option value="">none</option><option value="open"${s.fault[r.id] === 'open' ? ' selected' : ''}>fails open</option><option value="closed"${s.fault[r.id] === 'closed' ? ' selected' : ''}>fails closed</option></select></label>`).join('');
      return `
        <h3>Operate</h3>
        <div class="valve-list">${valves.map((v) => `<button type="button" class="valve-btn" data-valve="${v}">${v}</button>`).join('')}</div>
        ${scaleSelect(s)}
        ${runButtons}
        ${regControls}
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
      const scrub = root.querySelector('#st-scrub');
      if (scrub) {
        scrub.addEventListener('pointerdown', () => { s.scrubbing = true; });
        scrub.addEventListener('input', () => {
          s.scrubbing = true;
          h.seek(Number(scrub.value));
        });
        scrub.addEventListener('change', () => {
          s.scrubbing = false;
          h.seek(Number(scrub.value));
        });
      }
      root.querySelectorAll('[data-pset]').forEach((ps) => ps.addEventListener('change', () => {
        const tag = ps.dataset.pset;
        s.pSetPsia[tag] = Number(ps.value);
        h.client.command(tag, { pSet: s.pSetPsia[tag] * PSI });
      }));
      root.querySelectorAll('[data-fault]').forEach((fl) => fl.addEventListener('input', () => {
        const tag = fl.dataset.fault;
        s.fault[tag] = fl.value || null;
        h.client.command(tag, { fault: s.fault[tag] });
      }));
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
          if (m.replace) h.history = [];
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
      h.seek = (t) => {
        if (h.mode !== 'sequence') return;
        h.client.seek(t);
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
    view: spec.view || { x: -0.5, y: 0.1, z: 17.5 },
    onPick(tag, h) {
      h.toggle(tag);
    },
    tick(dt, s, computed, h) {
      if (!s.paused && !s.scrubbing) h.client.advance(Math.min(0.1, dt) * s.scale);
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
        const scrub = h.root.querySelector('#st-scrub');
        if (scrub && !s.scrubbing && document.activeElement !== scrub) scrub.value = String(c.t);
        const stamp = h.root.querySelector('#st-scrub-t');
        if (stamp) stamp.textContent = `${c.t.toFixed(2)} s`;
      }
    },
    law: () => ['\\dfrac{dm_k}{dt} = \\sum_{\\text{in}} \\mdot - \\sum_{\\text{out}} \\mdot', '\\dfrac{dU_k}{dt} = \\sum_{\\text{in}} \\mdot\\,h - \\sum_{\\text{out}} \\mdot\\,h'],
    liveRows: (s, computed) => {
      const c = computed[id];
      if (c.error) return kv('error', escapeHTML(c.error));
      if (!c.readout) return kv('status', 'starting the worker…');
      const r = c.readout;
      const rows = [kv('$t$', fmtTime(c.t)), kv('mode', s.mode)];
      for (const n of spec.net.nodes) if (n.kind === 'volume' && !n.id.endsWith('-hp')) rows.push(kv(n.label || n.id, fmtP(r.nodes[n.id].p)));
      for (const sensor of spec.sensors || []) {
        if (c.measured?.[sensor.tag] == null) continue;
        if (!/-02$/.test(sensor.tag) && sensor.tag !== 'PT-CH-01') continue;
        rows.push(kv(`${sensor.tag} measured`, fmtP(c.measured[sensor.tag])));
      }
      for (const e of spec.net.edges) {
        if (!e.id.startsWith('INJ-')) continue;
        rows.push(kv(`$\\mdot$ ${e.id}`, fmtMdot(r.edges[e.id].mdot)));
        rows.push(kv(`${e.id} $p_0/p$`, sig(r.edges[e.id].margin, 3)));
      }
      for (const one of regs) rows.push(kv(`${one.id} opening $z$`, sig(r.edges[one.id].z, 3)));
      return rows.join('');
    },
    readout: (s, computed) => {
      const c = computed[id];
      if (!c.readout) return '';
      const r = c.readout;
      const fo = (c.failsOpen || [])[0];
      const foCell = fo && !fo.error ? `${fmtP(fo.peak)} <small class="caveat" title="${escapeHTML(fo.caveat)}">depends on ${escapeHTML(fo.dependsOn.join(', '))}</small>` : fo?.error ? escapeHTML(fo.error) : '…';
      if (r.nodes['ox-manifold']) {
        const fu = (c.failsOpen || []).find((x) => x.regulator === 'PCV-FU-01');
        const fuCell = fu && !fu.error ? fmtP(fu.peak) : '…';
        return cells([
          ['ox manifold', fmtP(r.nodes['ox-manifold'].p)],
          ['fuel manifold', fmtP(r.nodes['fu-manifold'].p)],
          ['purge manifold', fmtP(r.nodes['n2-manifold'].p)],
          ['$\\mdot$ ox', fmtMdot(r.edges['INJ-OX-01'].mdot)],
          ['$\\mdot$ fuel', fmtMdot(r.edges['INJ-FU-01'].mdot)],
          ['chamber', fmtP(r.nodes.chamber.p)],
          ['peak ox manifold if PCV-OX-01 fails open', foCell],
          ['peak fuel manifold if PCV-FU-01 fails open', fuCell],
        ]);
      }
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
        title: id === 'full-stand' ? 'Full stand, cold flow' : 'GN₂ cold flow (Phase 5 step 1)',
        body: [
          'Everything on this stand is uncalibrated and most component values are placeholders (listed in the Setup panel, issue #6). It shows how the stand behaves with those values, not what the hardware will do.',
          'The transducer tags are the lagged, quantized reading. Download DAQ CSV adds the placeholder noise with a fixed seed, in the format in Test_Stand/daq_format.md.',
          id === 'full-stand' ? 'Both propellant bottles and the purge bottle are filled with nitrogen. The fuel circuit uses the fuel injector holes and the fuel regulator design flow. Combustion is a later milestone.' : '',
          s.mode === 'sequence' ? `Sequence ${sequence.id} opens the oxidizer bottle isolation, then the oxidizer main valve, then vents the oxidizer manifold. The highlighted row is the last command at or before the current time. Drag the timeline to move through the table.` : '',
          id === 'full-stand' ? 'Phase 5 step 1 and step 3 numbers from this model are in Sim/predictions/phase5.json. They carry the same uncalibrated label as this screen.' : '',
          fo && !fo.error ? `If PCV-OX-01 fails open with the main valve shut, the ox manifold peaks at ${fmtP(fo.peak)} before the relief catches it and settles at ${fmtP(fo.settled)}. Manifold hardware ratings and the MEOP must cover the peak. It depends on the relief lift time and the regulator poppet lag, both placeholders: a scale, not a design value.` : '',
        ],
      };
    },
    plot: (s, computed, h) => {
      const hist = h?.history || [];
      if (!hist.length) return null;
      const [u, f] = unitSystem() === 'us' ? ['psia', PSI] : ['MPa', 1e6];
      const ts = hist.map((x) => x.t);
      const series = hist[0].p['ox-manifold']
        ? [
            { xs: ts, ys: hist.map((x) => x.p['ox-manifold'] / f), color: '#58c4dd', label: 'ox manifold' },
            { xs: ts, ys: hist.map((x) => x.p['fu-manifold'] / f), color: '#f0ac5f', label: 'fuel manifold' },
            { xs: ts, ys: hist.map((x) => x.p['n2-manifold'] / f), color: '#8fa88a', label: 'purge manifold' },
            { xs: ts, ys: hist.map((x) => x.p.chamber / f), color: '#fc6255', label: 'chamber' },
          ]
        : [
            { xs: ts, ys: hist.map((x) => x.p.manifold / f), color: '#8fa88a', label: 'manifold' },
            { xs: ts, ys: hist.map((x) => x.p.line / f), color: '#58c4dd', label: 'line' },
            { xs: ts, ys: hist.map((x) => x.p.chamber / f), color: '#fc6255', label: 'chamber' },
          ];
      if (h.quiet?.length && h.quiet[0].values['PT-OX-02'] != null) series.push({ xs: h.quiet.map((x) => x.t), ys: h.quiet.map((x) => x.values['PT-OX-02'] / f), color: '#f4d345', label: 'PT-OX-02' });
      return {
        series,
        hlines: regs.map((one, i) => ({ y: (s.pSetPsia[one.id] * PSI) / f, color: i === 0 ? '#9a9591' : '#c9c3bb', label: regs.length === 1 ? 'p_set' : one.id })),
        xLabel: 't (s)',
        yLabel: `p (${u})`,
        yMin: 0,
        xFmt: (v) => sig(v, 3),
        yFmt: (v) => sig(v, 3),
      };
    },
  });
}

export { standLab };
export default standLab('gn2-coldflow');
