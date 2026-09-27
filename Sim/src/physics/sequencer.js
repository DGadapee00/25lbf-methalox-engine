/**
 * Table driver (brief §4.7, driver 1): plays a sequence table against the plant, reads the plant
 * through its transducers at the DAQ rate, and runs the table's abort rules and checks (M5).
 *
 * The plant interface is the one the brief names: inputs are discrete commands by P&ID tag
 * (valves, regulators, the igniter), outputs are sensor readings by tag at a fixed rate. The
 * driver sees only the readings: the lagged, quantized transducer values (physics/sensors.js),
 * never the true node pressure. A firmware driver (M7) replaces this module and keeps the plant.
 *
 * A sequence (data/sequences.js) may carry, besides its steps:
 *
 *   aborts   [{ id, when, action, test? }]
 *            when:   "<SENSOR> <op> <number> <unit> [after t=<s>] [before t=<s>] [for <n> samples]"
 *                    e.g. "PT-CH-01 < 150 psia after t=1.6", "PT-OX-02 > 700 psia"
 *            action: the name of an entry in `actions`
 *            test:   { faults: [{ t, id, cmd }] }, the fault that should make it fire; the
 *                    self-test runs every abort both ways (M5 done-when)
 *   actions  { name: [{ dt, cmd: { TAG: command } }] }   what an abort does, dt after it fires
 *   checks   [{ id, expect, source? }]                    pass/fail over the whole run
 *            expect: "<SENSOR> <op> <number> <unit> [window]"      every reading in the window
 *                    "<ENGINE-TAG> choked [window]"                 every sample in the window
 *                    "chamber burning [window]" | "chamber not burning [window]"
 *                    "unburned energy at ignition < <number> J"     every ignition event
 *                    "no abort"
 *            window: [from t=<a> | after t=<a> | after abort + <a> s] [to t=<b> | before t=<b>]
 *
 * None of this invents a threshold: every number comes from the table it reads. What an abort
 * does is the table's `actions`, not a default; a table that names an action it does not define
 * is refused.
 *
 * Once an abort fires the sequence is latched: remaining steps are cancelled and the action's
 * commands are scheduled. Later aborts are recorded as tripped but do not act again. Faults are
 * the world, not the sequencer, and are never cancelled.
 */
import { createRun } from './simulate.js';
import { createObserver } from './sensors.js';
import { PSI, LBF } from './constants.js';

const UNIT = { Pa: 1, kPa: 1e3, MPa: 1e6, psia: PSI, lbf: LBF, N: 1, K: 1, J: 1 };
const OPS = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
const SENSOR_RE = /^(PT|TE|LC)-(OX|FU|N2|IG|CH)-\d{2}$/;

function num(tok, text) {
  const v = Number(tok);
  if (!Number.isFinite(v)) throw new Error(`sequence: "${text}": ${tok} is not a number`);
  return v;
}

/** Parse "[from t=a | after t=a | after abort + a s] [to t=b | before t=b] [for n samples]". */
function parseWindow(toks, text) {
  const w = { from: -Infinity, to: Infinity, afterAbort: null, persist: 1 };
  let i = 0;
  const tAt = (tok) => {
    const m = /^t=(-?[\d.]+(?:e-?\d+)?)$/.exec(tok || '');
    if (!m) throw new Error(`sequence: "${text}": expected t=<seconds>, got ${tok}`);
    return num(m[1], text);
  };
  while (i < toks.length) {
    const k = toks[i++];
    if ((k === 'from' || k === 'after') && toks[i] === 'abort') {
      if (toks[i + 1] !== '+' || toks[i + 3] !== 's') throw new Error(`sequence: "${text}": write "after abort + <seconds> s"`);
      w.afterAbort = num(toks[i + 2], text);
      i += 4;
    } else if (k === 'from' || k === 'after') w.from = tAt(toks[i++]);
    else if (k === 'to' || k === 'before') w.to = tAt(toks[i++]);
    else if (k === 'for') {
      w.persist = num(toks[i++], text);
      if (toks[i++] !== 'samples' || !(w.persist >= 1)) throw new Error(`sequence: "${text}": write "for <n ≥ 1> samples"`);
    } else throw new Error(`sequence: "${text}": cannot read "${k}"`);
  }
  return w;
}

/** A sensor comparison: { kind: 'compare', signal, op, value (SI), span }. */
function parseCompare(toks, text) {
  const [signal, op, n, unit, ...rest] = toks;
  if (!SENSOR_RE.test(signal || '')) throw new Error(`sequence: "${text}": ${signal} is not a sensor tag (PT/TE/LC)`);
  if (!OPS[op]) throw new Error(`sequence: "${text}": operator must be <, <=, > or >=`);
  if (!(unit in UNIT)) throw new Error(`sequence: "${text}": unit must be one of ${Object.keys(UNIT).join(', ')} (absolute pressure: psia)`);
  return { kind: 'compare', signal, op, value: num(n, text) * UNIT[unit], unit, shown: `${n} ${unit}`, span: parseWindow(rest, text) };
}

export function parseAbortCondition(text) {
  const c = parseCompare(String(text).trim().split(/\s+/), text);
  if (c.span.afterAbort !== null) throw new Error(`sequence: "${text}": an abort cannot wait for an abort`);
  return c;
}

export function parseCheck(text) {
  const toks = String(text).trim().split(/\s+/);
  if (toks.join(' ') === 'no abort') return { kind: 'no-abort' };
  if (toks[0] === 'unburned' && toks[1] === 'energy' && toks[2] === 'at' && toks[3] === 'ignition') {
    if (!OPS[toks[4]] || toks[6] !== 'J' || toks.length !== 7) throw new Error(`sequence: "${text}": write "unburned energy at ignition < <number> J"`);
    return { kind: 'ignition-energy', op: toks[4], value: num(toks[5], text) };
  }
  if (toks[0] === 'chamber') {
    const not = toks[1] === 'not';
    if (toks[not ? 2 : 1] !== 'burning') throw new Error(`sequence: "${text}": write "chamber burning" or "chamber not burning"`);
    return { kind: 'burning', want: !not, span: parseWindow(toks.slice(not ? 3 : 2), text) };
  }
  if (toks[1] === 'choked') return { kind: 'choked', edge: toks[0], span: parseWindow(toks.slice(2), text) };
  return parseCompare(toks, text);
}

const inWindow = (w, t, tAbort) => {
  const from = w.afterAbort !== null ? (tAbort == null ? Infinity : tAbort + w.afterAbort) : w.from;
  return t >= from - 1e-9 && t <= w.to + 1e-9;
};

/** Every tag a table commands must exist on the stand; every sensor it reads must be wired. */
function validate(seq, sys, channels) {
  const tags = new Set([...sys.edges.map((e) => e.id), ...sys.igniters.map((g) => g.id)]);
  const sensors = new Set(channels.map((c) => c.tag));
  const problems = [];
  for (const st of seq.steps) if (!tags.has(st.id)) problems.push(`step at t=${st.t}: ${st.id} is not on this stand`);
  for (const [name, list] of Object.entries(seq.actions || {})) {
    for (const a of list) for (const id of Object.keys(a.cmd)) if (!tags.has(id)) problems.push(`action ${name}: ${id} is not on this stand`);
  }
  for (const a of seq.aborts || []) {
    if (!seq.actions?.[a.action]) problems.push(`abort ${a.id}: action "${a.action}" is not defined in this table's actions`);
    if (!sensors.has(a.cond.signal)) problems.push(`abort ${a.id}: ${a.cond.signal} is not a sensor on this stand`);
  }
  for (const c of seq.checks || []) {
    if (c.rule.kind === 'compare' && !sensors.has(c.rule.signal)) problems.push(`check ${c.id}: ${c.rule.signal} is not a sensor on this stand`);
    if (c.rule.kind === 'choked' && !sys.edges.some((e) => e.id === c.rule.edge)) problems.push(`check ${c.id}: ${c.rule.edge} is not on this stand`);
  }
  if (problems.length) throw new Error(`sequence ${seq.id}: ${problems.join('; ')}`);
}

/**
 * A run of `sequence` (expanded by data/sequences.js) on stand { net, gas, sensors }, with
 * optional faults [{ t, id, cmd }]. Returns a steppable driver: advance(tTo), readout(),
 * report(); `run` is the underlying plant run.
 */
export function createSequenceRun(stand, sequence, { faults = [], seed = null, maxSamples = Infinity } = {}) {
  const channels = (stand.sensors || []).map(({ offset, ...ch }) => ch);
  const rateHz = sequence.rateHz || 50;
  const dt = 1 / rateHz;
  const run = createRun(stand.net, { gas: stand.gas, sampleDt: dt, horizon: 1, maxSamples });
  validate(sequence, run.sys, channels);
  const aborts = sequence.aborts || [];
  const checks = sequence.checks || [];
  const live = aborts.length > 0 || checks.length > 0;
  run.schedule(sequence.steps.map((s) => ({ ...s, src: 'step' })));
  run.schedule(faults.map((f) => ({ ...f, src: 'fault' })));

  const obs = createObserver(channels, { seed });
  const readings = [];
  const counts = Object.fromEntries(aborts.map((a) => [a.id, 0]));
  const tripped = [];
  let fired = null;
  let tSample = 0;

  function sample() {
    const r = run.readout();
    const p = {};
    for (const [k, v] of Object.entries(r.nodes)) p[k] = v.p;
    const F = r.chambers ? Object.fromEntries(Object.entries(r.chambers).map(([k, v]) => [k, v.F])) : undefined;
    const values = obs.push({ t: r.t, p, F });
    readings.push({ t: r.t, values, choked: Object.fromEntries(Object.entries(r.edges).map(([k, v]) => [k, v.choked])), burning: r.chambers ? Object.values(r.chambers).some((c) => c.burning) : false });
    if (readings.length > maxSamples) readings.shift();
    for (const a of aborts) {
      const c = a.cond;
      const hit = inWindow(c.span, r.t, null) && OPS[c.op](values[c.signal], c.value);
      counts[a.id] = hit ? counts[a.id] + 1 : 0;
      if (counts[a.id] >= c.span.persist && !tripped.some((x) => x.id === a.id)) {
        const rec = { id: a.id, t: r.t, when: a.when, reading: values[c.signal], action: a.action };
        tripped.push(rec);
        if (!fired) {
          fired = rec;
          run.cancel((cmd) => cmd.src === 'step');
          run.schedule(sequence.actions[a.action].flatMap((st) => Object.entries(st.cmd).map(([id, cmd]) => ({ t: r.t + (st.dt || 0), id, cmd, src: 'abort' }))));
        }
      }
    }
  }

  /** Advance to tTo, reading the transducers on the DAQ grid when the table has rules. */
  function advance(tTo) {
    if (!live) return run.advance(tTo);
    while (tSample <= tTo + 1e-12) {
      run.advance(tSample);
      sample();
      tSample = Math.round((tSample + dt) * rateHz) / rateHz;
    }
    run.advance(tTo);
  }

  /** Pass/fail over what has run so far. */
  function report() {
    const out = run.out;
    const ignitions = out.events.filter((e) => e.what === 'ignition');
    const tA = fired?.t ?? null;
    const res = checks.map((c) => {
      const r = c.rule;
      let pass = true;
      let detail = '';
      if (r.kind === 'no-abort') {
        pass = !fired;
        detail = fired ? `${fired.id} fired at ${fired.t.toFixed(3)} s` : 'no abort fired';
      } else if (r.kind === 'ignition-energy') {
        if (!ignitions.length) {
          pass = false;
          detail = 'no ignition happened';
        } else {
          const worst = Math.max(...ignitions.map((e) => e.unburnedEnergy));
          pass = ignitions.every((e) => OPS[r.op](e.unburnedEnergy, r.value));
          detail = `${ignitions.length} ignition(s), largest ${worst.toFixed(1)} J`;
        }
      } else {
        const inside = readings.filter((x) => inWindow(r.span, x.t, tA));
        if (!inside.length) {
          pass = r.span.afterAbort !== null && !fired;
          detail = pass ? 'not applicable: no abort fired' : 'no readings in the time span';
        } else {
          const bad = inside.find((x) => (r.kind === 'compare' ? !OPS[r.op](x.values[r.signal], r.value) : r.kind === 'choked' ? !x.choked[r.edge] : x.burning !== r.want));
          pass = !bad;
          detail = bad ? `fails at t = ${bad.t.toFixed(3)} s${r.kind === 'compare' ? ` (${r.signal} reads ${(bad.values[r.signal] / UNIT[r.unit]).toPrecision(5)} ${r.unit})` : ''}` : `holds over ${inside.length} readings`;
        }
      }
      return { id: c.id, expect: c.expect, source: c.source || '', pass, detail };
    });
    return {
      sequence: sequence.id,
      faults,
      abort: fired,
      tripped,
      checks: res,
      pass: res.every((x) => x.pass),
      ignitions: ignitions.map((e) => ({ t: e.t, unburnedMass: e.unburnedMass, unburnedEnergy: e.unburnedEnergy })),
      t: run.t,
    };
  }

  return { run, advance, readout: () => run.readout(), report, readings, get t() { return run.t; } };
}

/** Batch: play the whole table (to tEnd) and return { report, run }. */
export function runSequence(stand, sequence, opts = {}) {
  const d = createSequenceRun(stand, sequence, opts);
  d.advance(opts.tEnd ?? sequence.tEnd);
  return { report: d.report(), out: d.run.finish(), driver: d };
}
