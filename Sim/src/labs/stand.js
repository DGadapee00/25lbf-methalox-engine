import { defineLab } from './define.js';
import { PidView } from '../scene/pid.js';
import { Q } from '../scene/manim.js';
import { kv, cells, escapeHTML } from '../ui/shared.js';
import { fmtP, fmtMdot, fmtTime, fmtF, fmtT, fmtE, fmtGrams, sig, unitSystem } from '../ui/format.js';
import { createSimClient } from '../engine/simClient.js';
import { STANDS } from '../data/stands/index.js';
import { provenance } from '../data/components.js';
import { measureSeries } from '../physics/sensors.js';
import { daqCsv } from '../physics/daq.js';
import { PSI } from '../physics/constants.js';
import { expandSequence, sequenceSource } from '../data/sequences.js';
import { faultTargets, faultCommand, reportMarkdown, renderReport } from '../ui/faults.js';

/**
 * Operate and Sequence on a stand (brief §5.1). Operate: click a valve, the netlist runs live in
 * a Web Worker. Sequence: the stand's sequence table is scheduled up front and plays itself.
 * Either way the physics stays off the main thread.
 *
 * Transducer labels and the DAQ file are the observer in physics/sensors.js (lag, then noise in
 * the file only, then quantization). The pipes stay on the true node pressure.
 *
 * Everything here is uncalibrated, and most component values are placeholders (issue #6).
 *
 * The hot-fire stand (M4) adds the igniter (a button, and a pickable symbol), a Joule–Thomson
 * switch per regulator, and the chamber's readouts: P_c, O/F, thrust, I_sp, and the unburned
 * propellant. It has no sequence file, so its Sequence mode says so and plays nothing.
 *
 * Faults and aborts (M5): Operate injects a fault now; Sequence schedules faults at chosen times
 * and replays the table from t = 0 with them. A sequence file can be loaded from disk (the
 * Test_Stand/sequences/ format) to rehearse a table that is not committed. Sequence mode plays
 * the table through the table driver (physics/sequencer.js) and shows its aborts and checks as a
 * pass/fail report, which downloads as Markdown.
 */
const SCALES = [0.1, 0.25, 1, 2, 5];
const HISTORY_S = 30;
const NOISE_SEED = 1;

function channelsOf(sensors) {
  return sensors.map(({ offset, ...ch }) => ch);
}

function downloadCsv(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
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
  const igniters = (spec.net.igniters || []).map((g) => g.id);
  const regs = spec.net.edges.filter((e) => e.type === 'regulator');
  const channels = channelsOf(spec.sensors || []);
  const hot = !!spec.net.nodes.find((n) => n.kind === 'chamber');
  const targets = faultTargets(spec.net);
  // The table in play: the stand's committed file, or one loaded from disk (s.table). Expanded
  // here for display; the worker expands it again and validates it against the stand.
  const tableOf = (s) => {
    try {
      return s.table ? expandSequence(s.table) : null;
    } catch {
      return null;
    }
  };
  const rateOf = (s) => tableOf(s)?.rateHz || 50;

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
      jt: Object.fromEntries(regs.map((r) => [r.id, false])),
      table: spec.sequence ? sequenceSource(spec.sequence.id) : null,
      tableName: spec.sequence ? `Test_Stand/sequences/${spec.sequence.id}.json` : '',
      faults: [],
      faultForm: { target: targets[0]?.tag || '', kind: targets[0]?.kinds[0]?.kind || '', amount: '', at: '' },
    }),
    controls: (s) => {
      const runButtons = `<button type="button" id="st-pause">${s.paused ? 'Resume' : 'Pause'}</button>
      <button type="button" id="st-reset">Reset</button>
      <button type="button" id="st-daq">Download DAQ CSV</button>`;
      const loadFile = `<label>Load a sequence file (Test_Stand/sequences format) <input id="st-load" type="file" accept=".json,application/json"></label>`;
      const faultForm = (withTime) => {
        const f = s.faultForm;
        const tgt = targets.find((x) => x.tag === f.target) || targets[0];
        if (!tgt) return '';
        const kind = tgt.kinds.find((k) => k.kind === f.kind) || tgt.kinds[0];
        return `<div class="fault-form">
          <label>Element <select id="ft-target">${targets.map((x) => `<option value="${x.tag}"${x.tag === tgt.tag ? ' selected' : ''}>${x.tag}</option>`).join('')}</select></label>
          <label>Fault <select id="ft-kind">${tgt.kinds.map((k) => `<option value="${k.kind}"${k.kind === kind.kind ? ' selected' : ''}>${k.label}</option>`).join('')}</select></label>
          ${kind.amount ? `<label>${escapeHTML(kind.amount)} <input id="ft-amount" type="number" min="0" max="100" step="1" value="${escapeHTML(f.amount)}" placeholder="required"></label>` : ''}
          ${withTime ? `<label>At t (s) <input id="ft-at" type="number" min="0" step="0.01" value="${escapeHTML(f.at)}" placeholder="required"></label>` : ''}
          <button type="button" id="ft-add">${withTime ? 'Schedule fault' : 'Inject now'}</button>
        </div>`;
      };
      if (s.mode === 'sequence') {
        const seq = tableOf(s);
        if (!seq) {
          return `
            <h3>Sequence</h3>
            <p class="note">No sequence file exists for this stand. ${hot ? 'The hot-fire sequence (valve order, ox lead, igniter timing, purge, aborts) is Dalton\'s design decision (brief §5.4) and has not been written, so the sim does not make one up.' : ''} Load one to rehearse it, or use Operate.</p>
            ${loadFile}
            ${runButtons}
            ${provenanceList()}`;
        }
        const rows = seq.steps
          .map((st, i) => `<tr data-step="${i}"><td>${st.t.toFixed(2)} s</td><td>${escapeHTML(st.id)}</td><td>${escapeHTML(typeof st.cmd === 'object' ? JSON.stringify(st.cmd) : String(st.cmd))}</td></tr>`)
          .join('');
        const faults = s.faults.map((f, i) => `<li>${f.t.toFixed(2)} s · ${escapeHTML(f.id)} · ${escapeHTML(f.label)} <button type="button" class="link" data-unfault="${i}">remove</button></li>`).join('');
        return `
          <h3>Sequence</h3>
          <p class="note">${escapeHTML(seq.id)} · ${seq.tEnd} s · ${seq.rateHz} Hz · ${escapeHTML(s.tableName)}. The table is the run. Scrub the timeline; valves are not clicked.</p>
          <table class="seq" id="seq-table">${rows}</table>
          <label class="scrub">Timeline <input id="st-scrub" type="range" min="0" max="${seq.tEnd}" step="0.01" value="0"> <span id="st-scrub-t">0 s</span></label>
          ${scaleSelect(s)}
          ${runButtons}
          <h4>Faults</h4>
          <p class="note">Injected at their times; a change replays the table from t = 0.</p>
          ${faults ? `<ul class="fault-list">${faults}</ul>` : ''}
          ${faultForm(true)}
          <h4>Aborts and checks</h4>
          <div id="seq-report" class="seq-report">${seq.aborts.length || seq.checks.length ? '…' : '<p class="note">This table has no aborts and no checks.</p>'}</div>
          <button type="button" id="st-report">Download report</button>
          ${loadFile}
          ${spec.sequence && s.tableName !== `Test_Stand/sequences/${spec.sequence.id}.json` ? '<button type="button" id="st-committed">Use the committed table</button>' : ''}
          ${provenanceList()}`;
      }
      const regControls = regs.map((r) => `<label>${r.id} set point (psia) <input data-pset="${r.id}" type="number" min="50" max="900" step="5" value="${s.pSetPsia[r.id].toFixed(0)}"></label>
        <label>${r.id} fault <select data-fault="${r.id}"><option value="">none</option><option value="open"${s.fault[r.id] === 'open' ? ' selected' : ''}>fails open</option><option value="closed"${s.fault[r.id] === 'closed' ? ' selected' : ''}>fails closed</option></select></label>
        ${hot ? `<label class="check"><input type="checkbox" data-jt="${r.id}"${s.jt[r.id] ? ' checked' : ''}> ${r.id} Joule–Thomson cooling</label>` : ''}`).join('');
      return `
        <h3>Operate</h3>
        <div class="valve-list">${valves.map((v) => `<button type="button" class="valve-btn" data-valve="${v}">${v}</button>`).join('')}${igniters.map((g) => `<button type="button" class="valve-btn igniter-btn" data-valve="${g}">${g}</button>`).join('')}</div>
        ${scaleSelect(s)}
        ${runButtons}
        ${regControls}
        <h4>Inject a fault</h4>
        ${faultForm(false)}
        ${provenanceList()}`;
    },
    bind({ state: s, bump, root, handle: h }) {
      h.root = root;
      root.querySelectorAll('.valve-btn').forEach((b) => b.addEventListener('click', () => h.toggle(b.dataset.valve)));
      root.querySelector('#st-scale')?.addEventListener('input', (e) => ((s.scale = Number(e.target.value)), bump()));
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
      root.querySelectorAll('[data-jt]').forEach((cb) => cb.addEventListener('change', () => {
        const tag = cb.dataset.jt;
        s.jt[tag] = cb.checked;
        h.client.command(tag, { jt: cb.checked });
      }));
      // Faults. The form keeps its values in the slice so a re-render does not lose them.
      const redraw = () => {
        root.innerHTML = this.controls(s);
        this.bind({ state: s, bump, root, handle: h });
        bump();
      };
      root.querySelector('#ft-target')?.addEventListener('input', (e) => {
        s.faultForm.target = e.target.value;
        s.faultForm.kind = targets.find((x) => x.tag === e.target.value)?.kinds[0]?.kind || '';
        redraw();
      });
      root.querySelector('#ft-kind')?.addEventListener('input', (e) => ((s.faultForm.kind = e.target.value), redraw()));
      root.querySelector('#ft-amount')?.addEventListener('input', (e) => (s.faultForm.amount = e.target.value));
      root.querySelector('#ft-at')?.addEventListener('input', (e) => (s.faultForm.at = e.target.value));
      root.querySelector('#ft-add')?.addEventListener('click', () => {
        const f = faultCommand(targets, s.faultForm);
        if (f.error) {
          h.error = f.error;
          bump();
          return;
        }
        h.error = null;
        if (s.mode === 'operate') {
          h.client.command(f.id, f.cmd);
          return;
        }
        const t = Number(s.faultForm.at);
        if (!(s.faultForm.at !== '' && t >= 0)) {
          h.error = 'Give the time (s) the fault should happen.';
          bump();
          return;
        }
        s.faults.push({ t, id: f.id, cmd: f.cmd, label: f.label });
        s.faults.sort((a, b) => a.t - b.t);
        h.reset();
        redraw();
      });
      root.querySelectorAll('[data-unfault]').forEach((b) => b.addEventListener('click', () => {
        s.faults.splice(Number(b.dataset.unfault), 1);
        h.reset();
        redraw();
      }));
      root.querySelector('#st-load')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        file.text().then((text) => {
          try {
            const raw = JSON.parse(text);
            expandSequence(raw);
            s.table = raw;
            s.tableName = file.name;
            s.faults = [];
            h.error = null;
            h.reset();
          } catch (err) {
            h.error = `${file.name}: ${err.message || err}`;
          }
          redraw();
        });
      });
      root.querySelector('#st-committed')?.addEventListener('click', () => {
        s.table = sequenceSource(spec.sequence.id);
        s.tableName = `Test_Stand/sequences/${spec.sequence.id}.json`;
        s.faults = [];
        h.reset();
        redraw();
      });
      root.querySelector('#st-report')?.addEventListener('click', () => {
        const rep = h.live?.report;
        if (!rep) return;
        const text = reportMarkdown({ stand: id, table: s.tableName, rep, t: h.live.t });
        downloadCsv(`${id}-${rep.sequence}-report.md`, text, 'text/markdown');
      });
      h.state = s;
    },
    setMode(s, h, mode) {
      s.mode = mode;
      h.mode = mode;
      h.state = s;
      h.reset();
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
          h.quiet = h.history.length ? measureSeries(h.history.map((x) => ({ t: x.t, p: x.p, F: x.F })), channels) : [];
        } else if (m.type === 'error') {
          h.error = m.message;
        }
        h.fresh = true;
      };
      h.client = createSimClient(onMsg);
      h.toggle = (tag) => {
        if (h.mode !== 'operate' || !h.live) return;
        if (igniters.includes(tag)) {
          const g = spec.net.igniters.find((x) => x.id === tag);
          const on = !!h.live.readout.chambers?.[g.chamber]?.igniter?.on;
          h.client.command(tag, on ? 'off' : 'on');
          return;
        }
        if (!valves.includes(tag)) return;
        const x = h.live.readout.edges[tag]?.x ?? 0;
        h.client.command(tag, x > 0.5 ? 'close' : 'open');
      };
      /** Start again from t = 0: Operate empty, Sequence with the table in play and its faults. */
      h.reset = () => {
        h.history = [];
        h.quiet = [];
        h.live = null;
        const s = h.state;
        if (h.mode === 'sequence' && s?.table) h.client.init(id, { sequence: s.table, faults: s.faults.map(({ t, id: tag, cmd }) => ({ t, id: tag, cmd })) });
        else h.client.init(id, {});
      };
      /** Load a table object (as from a file) and replay it. For the smoke test and scripted use. */
      h.loadTable = (raw, name = 'loaded table') => {
        expandSequence(raw);
        h.state.table = raw;
        h.state.tableName = name;
        h.state.faults = [];
        h.reset();
      };
      h.seek = (t) => {
        if (h.mode !== 'sequence') return;
        h.client.seek(t);
      };
      h.download = () => {
        const noisy = h.history.length ? measureSeries(h.history.map((x) => ({ t: x.t, p: x.p, F: x.F })), channels, { seed: NOISE_SEED }) : [];
        const seq = h.mode === 'sequence' ? tableOf(h.state) : null;
        const run = `${id}/${seq ? seq.id : 'operate'}`;
        const text = daqCsv({ run, rateHz: rateOf(h.state), channels, rows: noisy, seed: NOISE_SEED });
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
      if (c.readout) h.pid.update({ ...c.readout, measured: c.measured }, 1 / 60, fmtP, fmtF);
      c.choke = h.pid.chokeStates();
      if (hot) c.chamber = c.readout?.chambers?.chamber ?? null;
      const seq = s.mode === 'sequence' ? tableOf(s) : null;
      c.report = h.live?.report ?? null;
      if (seq && h.root) {
        const box = h.root.querySelector('#seq-report');
        if (box && c.report && (seq.aborts.length || seq.checks.length)) {
          const html = renderReport(seq, c.report, c.t);
          if (box.dataset.html !== html) {
            box.dataset.html = html;
            box.innerHTML = html;
          }
        }
        let current = -1;
        seq.steps.forEach((st, i) => {
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
      for (const one of regs) if (r.edges[one.id].jt) rows.push(kv(`${one.id} outlet $T$ (JT)`, fmtT(r.edges[one.id].Tout)));
      const ch = r.chambers?.chamber;
      if (ch) {
        rows.push(kv('chamber', ch.burning ? 'burning' : 'not burning'));
        if (ch.burning) {
          rows.push(kv('O/F', sig(ch.OF, 4)));
          rows.push(kv('$c^*$', `${sig(ch.cstar, 4)} m/s`));
        }
        rows.push(kv('$F$', fmtF(ch.F)));
        rows.push(kv('$I_{sp}$', ch.Isp > 0 ? `${sig(ch.Isp, 4)} s` : '—'));
        rows.push(kv('unburned in chamber', `${fmtGrams(ch.unburnedMass)}, ${fmtE(ch.unburnedEnergy)}`));
        if (ch.lastIgnition) rows.push(kv('at last ignition', `${fmtGrams(ch.lastIgnition.unburnedMass)}, ${fmtE(ch.lastIgnition.unburnedEnergy)}; ${fmtP(ch.lastIgnition.pBefore)} → ${fmtP(ch.lastIgnition.pAfter)}`));
      }
      return rows.join('');
    },
    readout: (s, computed) => {
      const c = computed[id];
      if (!c.readout) return '';
      const r = c.readout;
      const fo = (c.failsOpen || [])[0];
      const foCell = fo && !fo.error ? `${fmtP(fo.peak)} <small class="caveat" title="${escapeHTML(fo.caveat)}">depends on ${escapeHTML(fo.dependsOn.join(', '))}</small>` : fo?.error ? escapeHTML(fo.error) : '…';
      const ch = r.chambers?.chamber;
      if (ch) {
        const ox = r.edges['INJ-OX-01'];
        const mark = ox.mdot < 1e-6 ? '' : !ox.choked ? 'red' : ox.margin >= 2.2 ? 'green' : 'amber';
        return cells([
          ['$P_c$', fmtP(ch.p)],
          ['O/F', ch.burning ? sig(ch.OF, 3) : '—'],
          ['$F$', fmtF(ch.F)],
          ['$I_{sp}$', ch.Isp > 0 ? `${sig(ch.Isp, 3)} s` : '—'],
          ['$\\mdot$ ox + fuel', fmtMdot(r.edges['INJ-OX-01'].mdot + r.edges['INJ-FU-01'].mdot)],
          ['GOX $p_0/p$', `<span class="choke ${mark}">${sig(ox.margin, 3)}</span>`],
          ['unburned in chamber', fmtE(ch.unburnedEnergy)],
          ['chamber', ch.burning ? 'burning' : 'not burning'],
        ]);
      }
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
      if (hot) {
        const ch = c.readout?.chambers?.chamber;
        return {
          title: 'Full stand, hot fire',
          body: [
            'Uncalibrated. Most component values are placeholders (issue #6), η_c* = 0.92 is PROJECT_PLAN\'s assumption, and the injector C_d is the one uncalibrated value. It shows how this model of the stand behaves, not what the engine will do.',
            'There is no hot-fire sequence. Open HV-OX-01 and HV-FU-01, let the manifolds come up, open the main valves, and switch IGN-IG-01 on; the chamber lights when its gas is inside the CH₄/O₂ flammability limits. The order and the timing are yours to try: the real sequence is a design decision the sim does not make.',
            'At ignition everything unburned in the chamber burns at once. The pressure jump and the energy readout are the hard-start measure (R-4): how much propellant was waiting.',
            ch?.burning ? `Burning at O/F ${sig(ch.OF, 3)} and ${fmtP(ch.p)}. With the CEA c* this chamber runs above PROJECT_PLAN's 250 psia, and both injectors' choke margins drop below critical (red on the schematic): S-3, the open choke-margin decision, not something the sim settles.` : '',
            'Joule–Thomson cooling is off by default: the gas reaches the injectors at bottle temperature, as PROJECT_PLAN §2 assumes. Switched on, each regulator delivers its real-gas outlet temperature (CoolProp), and the colder methane raises the fuel flow more than the oxygen, so O/F falls.',
          ],
        };
      }
      return {
        title: id === 'full-stand' ? 'Full stand, cold flow' : 'GN₂ cold flow (Phase 5 step 1)',
        body: [
          'Everything on this stand is uncalibrated and most component values are placeholders (listed in the Setup panel, issue #6). It shows how the stand behaves with those values, not what the hardware will do.',
          'The transducer tags are the lagged, quantized reading. Download DAQ CSV adds the placeholder noise with a fixed seed, in the format in Test_Stand/daq_format.md.',
          id === 'full-stand' ? 'Both propellant bottles and the purge bottle are filled with nitrogen. The fuel circuit uses the fuel injector holes and the fuel regulator design flow. Combustion is a later milestone.' : '',
          s.mode === 'sequence' && spec.sequence && tableOf(s)?.id === spec.sequence.id ? `Sequence ${spec.sequence.id} opens the oxidizer bottle isolation, then the oxidizer main valve, then vents the oxidizer manifold. The highlighted row is the last command at or before the current time. Drag the timeline to move through the table.` : '',
          s.mode === 'sequence' && tableOf(s) ? 'Faults scheduled in the Setup panel happen at their times whatever the table does. Aborts read the transducers, not the true pressures, at the table\'s sample rate; the first one to trip cancels the rest of the table and runs the action the table names.' : '',
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
