/**
 * Software-in-the-loop harness (brief §4.7, J-4, M7). The plant (a stand) runs here; the sequencer
 * is a separate thing that sees only what firmware would see, once per DAQ tick:
 *
 *   in:   { t (s), readings: { SENSOR_TAG: value (SI, as the DAQ reads it: lagged, quantized) } }
 *   out:  { commands: [{ id: TAG, cmd }], events?: [{ what, id, … }] }
 *
 * Commands take effect at the tick they are returned on: a sequencer acts on a sample grid, so a
 * table step at 1.15 s on a 50 Hz grid happens at 1.16 s. That is the difference from the table
 * driver (physics/sequencer.js), which schedules steps at their exact times.
 *
 * Any object with step(tick) → reply (or a promise of one) is a sequencer. Two ship with the sim:
 *
 *   createTableLogic(seq)  a reference sequencer written as a state machine over ticks: it plays a
 *                          table, trips its aborts on the readings, latches, and runs the table's
 *                          action. It is the table driver's logic moved behind the interface, to
 *                          prove the harness; it is NOT the stand's firmware. D-7 (controller) is
 *                          open, and the firmware logic is written after it (brief §4.7).
 *   a process sequencer    scripts/sil/process.mjs speaks the same messages as JSON lines on
 *                          stdio (Test_Stand/sil_protocol.md), so a native build of the firmware's
 *                          logic core, or a serial bridge to the real controller (HIL), can be
 *                          plugged in without touching the plant.
 *
 * runSil judges any sequencer with the table's own checks (evaluateChecks, the table driver's
 * code). The M7 done-when is the firmware passing the same checks as the table driver.
 */
import { createRun } from './simulate.js';
import { createObserver } from './sensors.js';
import { evaluateChecks, OPS, inWindow } from './sequencer.js';

/** The reference sequencer: a table as a tick-driven state machine. */
export function createTableLogic(seq) {
  const pending = seq.steps.map((s) => ({ ...s }));
  const counts = Object.fromEntries((seq.aborts || []).map((a) => [a.id, 0]));
  const tripped = new Set();
  let latched = null;
  let actions = [];
  return {
    step({ t, readings }) {
      const commands = [];
      const events = [];
      const eps = 1e-9;
      if (!latched) {
        while (pending.length && pending[0].t <= t + eps) {
          const s = pending.shift();
          commands.push({ id: s.id, cmd: s.cmd });
        }
      }
      for (const a of seq.aborts || []) {
        const c = a.cond;
        const hit = inWindow(c.span, t, null) && OPS[c.op](readings[c.signal], c.value);
        counts[a.id] = hit ? counts[a.id] + 1 : 0;
        if (counts[a.id] >= c.span.persist && !tripped.has(a.id)) {
          tripped.add(a.id);
          events.push({ what: 'abort', id: a.id, t, reading: readings[c.signal], latched: !!latched });
          if (!latched) {
            latched = a.id;
            pending.length = 0;
            actions = seq.actions[a.action].flatMap((st) => Object.entries(st.cmd).map(([id, cmd]) => ({ t: t + (st.dt || 0), id, cmd }))).sort((p, q) => p.t - q.t);
          }
        }
      }
      while (actions.length && actions[0].t <= t + eps) {
        const a = actions.shift();
        commands.push({ id: a.id, cmd: a.cmd });
      }
      return { commands, events };
    },
  };
}

/**
 * Run stand with sequencer (anything with step(tick)) for the table seq (its rate, tEnd, checks),
 * injecting faults [{ t, id, cmd }]. Async so a process or serial sequencer can answer in its own
 * time; the plant waits for each reply (the plant is simulated, so waiting costs nothing).
 * Returns { report, out, log }: report has the same shape as the table driver's.
 */
export async function runSil(stand, seq, sequencer, { faults = [], tEnd } = {}) {
  const channels = (stand.sensors || []).map(({ offset, ...ch }) => ch);
  const rateHz = seq.rateHz || 50;
  const run = createRun(stand.net, { gas: stand.gas, sampleDt: 1 / rateHz, horizon: 1 });
  run.schedule(faults);
  const obs = createObserver(channels);
  const readings = [];
  const log = [];
  let fired = null;
  const tripped = [];
  const end = tEnd ?? seq.tEnd;
  const known = new Set([...run.sys.edges.map((e) => e.id), ...run.sys.igniters.map((g) => g.id)]);
  for (let k = 0; ; k++) {
    const t = k / rateHz;
    if (t > end + 1e-9) break;
    run.advance(t);
    const r = run.readout();
    const p = {};
    for (const [id, v] of Object.entries(r.nodes)) p[id] = v.p;
    const F = r.chambers ? Object.fromEntries(Object.entries(r.chambers).map(([id, v]) => [id, v.F])) : undefined;
    const values = obs.push({ t, p, F });
    readings.push({ t, values, choked: Object.fromEntries(Object.entries(r.edges).map(([id, v]) => [id, v.choked])), burning: r.chambers ? Object.values(r.chambers).some((c) => c.burning) : false });
    const reply = (await sequencer.step({ t, readings: values })) || {};
    for (const c of reply.commands || []) {
      if (!known.has(c.id)) throw new Error(`sil: the sequencer commanded ${c.id}, which is not on this stand`);
      run.command(c.id, c.cmd);
      log.push({ t, id: c.id, cmd: c.cmd });
    }
    for (const e of reply.events || []) {
      if (e.what !== 'abort') continue;
      const rec = { id: e.id, t, reading: e.reading };
      tripped.push(rec);
      if (!fired) fired = rec;
    }
  }
  const out = run.finish();
  const ignitions = out.events.filter((e) => e.what === 'ignition');
  const checks = evaluateChecks(seq.checks || [], readings, ignitions, fired);
  return {
    report: { sequence: seq.id, faults, abort: fired, tripped, checks, pass: checks.every((c) => c.pass), ignitions: ignitions.map((e) => ({ t: e.t, unburnedEnergy: e.unburnedEnergy })), t: run.t },
    out,
    log,
  };
}

/**
 * Conformance of a SIL run to the table driver's run of the same table and faults: the same
 * aborts trip (trip times within one sample period plus the step quantization), and every check
 * reaches the same verdict. Returns { ok, problems: [...] }.
 */
export function conformance(tableReport, silReport, rateHz) {
  const problems = [];
  const tol = 2 / rateHz + 1e-9;
  const ids = (r) => r.tripped.map((x) => x.id).sort().join(',');
  if (ids(tableReport) !== ids(silReport)) problems.push(`aborts tripped: table driver [${ids(tableReport)}], sequencer [${ids(silReport)}]`);
  if ((tableReport.abort?.id || null) !== (silReport.abort?.id || null)) problems.push(`first abort: ${tableReport.abort?.id || 'none'} vs ${silReport.abort?.id || 'none'}`);
  for (const a of tableReport.tripped) {
    const b = silReport.tripped.find((x) => x.id === a.id);
    if (b && Math.abs(b.t - a.t) > tol) problems.push(`${a.id} trips at ${a.t.toFixed(3)} s vs ${b.t.toFixed(3)} s`);
  }
  for (const c of tableReport.checks) {
    const d = silReport.checks.find((x) => x.id === c.id);
    if (!d || d.pass !== c.pass) problems.push(`check ${c.id}: ${c.pass ? 'pass' : 'fail'} vs ${d ? (d.pass ? 'pass' : 'fail') : 'missing'}`);
  }
  return { ok: !problems.length, problems };
}
