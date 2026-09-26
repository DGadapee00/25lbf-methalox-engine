/**
 * Simulation driver (brief §4.5): integrates a compiled network with Dormand–Prince 5(4) between
 * breakpoints, handles discrete events, and samples on a fixed grid from the dense output.
 *
 *   simulate(net, { gas, tEnd, schedule, sampleDt, rtol, atolRel, hmax }) →
 *     { t: [...], samples: [readout, …], final, events: [...], stats }
 *
 *   createRun(net, { gas, sampleDt, horizon, … }) → a run that can be advanced in chunks and
 *     commanded as it goes: run.advance(tTo), run.command(id, cmd) at the current time,
 *     run.readout(). The live stand (Web Worker) uses this; simulate() is createRun + one advance,
 *     so every self-test exercises the same stepping code the stand runs.
 *
 * Events, in the order the brief lists them:
 * - Scheduled (valve and regulator commands, and the start and end of every valve ramp they
 *   cause): known in advance, so each is a *breakpoint*. A step is shortened to land on it exactly
 *   and the FSAL stage is re-evaluated after it, so no step ever spans a kink in C_dA(t).
 * - State events (check valve and relief crack/reseat): an event function g changes sign inside a
 *   step. The crossing is located by the Illinois variant of regula falsi on the dense output, to
 *   1e-12 of the step, the step is cut there, the mode flips, and integration restarts.
 *
 * Peaks (opts.trackPeaks): the highest pressure each volume node reaches, found on the dense
 * output at four points inside every accepted step, so a peak between step ends is not missed.
 * Returned as out.peaks = { node: { p (Pa), t (s) } }. Off by default: it costs about four extra
 * state evaluations per step.
 *
 * Max step: tied to the fastest valve ramp (a quarter of it) so a ramp is never resolved by a
 * single step even when the error estimate would allow it, and to horizon/20 (horizon = tEnd for
 * simulate) so a sample grid is never interpolated across one huge step. Stats (steps, rejections, RHS evaluations, events,
 * wall time) come back with every run: the self-test prints them as a stiffness canary.
 */
import { compileNetwork } from './network.js';
import { Dopri5 } from './integrate/dopri5.js';
import { NonPhysicalState } from './gas.js';

export function simulate(net, opts) {
  const { tEnd, schedule = [] } = opts;
  const run = createRun(net, { ...opts, horizon: tEnd, sampleDt: opts.sampleDt ?? tEnd / 200 });
  run.schedule(schedule);
  run.advance(tEnd);
  return run.finish();
}

export function createRun(net, opts) {
  const { gas, sampleDt = 0.01, rtol = 1e-8, atolRel = 1e-10, maxSteps = 2e6, maxEvents = 1e5, maxSamples = Infinity } = opts;
  const horizon = opts.horizon ?? 1;
  const sys = opts.sys || compileNetwork(net, gas);
  const y = sys.initialState();
  const sc = sys.scales();
  const atol = sc.map((s) => s * atolRel);
  const solver = new Dopri5(sys.nState, sys.rhs, { rtol, atol });
  const hmax = Math.min(opts.hmax ?? Infinity, sys.fastestRamp / 4, horizon / 20);

  // Breakpoints: scheduled commands first; valve ramps add more as commands fire.
  let cmds = [];
  const bps = new Set();
  let ci = 0;
  const nextBreak = (t, tTo) => {
    let nb = tTo;
    for (const b of bps) if (b > t && b < nb) nb = b;
    return nb;
  };

  const out = { t: [], samples: [], events: [], stats: null, peaks: null };
  const vols = sys.nodes.map((n, k) => [n, k]).filter(([n]) => n.kind === 'volume');
  const peaks = opts.trackPeaks ? Object.fromEntries(vols.map(([n]) => [n.id, { p: -Infinity, t: 0 }])) : null;
  const yP = new Float64Array(sys.nState);
  const notePeaks = (tt, yy) => {
    const st = sys.nodeStates(yy);
    for (const [n, k] of vols) if (st[k].p > peaks[n.id].p) peaks[n.id] = { p: st[k].p, t: tt };
  };
  let tSample = 0;
  const yS = new Float64Array(sys.nState);
  const sample = (tt, yy) => {
    out.t.push(tt);
    out.samples.push(sys.readout(tt, yy));
    if (out.t.length > maxSamples) {
      out.t.shift();
      out.samples.shift();
    }
  };

  const g0 = new Float64Array(sys.nEvents);
  const g1 = new Float64Array(sys.nEvents);
  const gm = new Float64Array(sys.nEvents);
  const yE = new Float64Array(sys.nState);

  const wall0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let t = 0;
  let h = Math.min(hmax, 1e-6 * Math.max(1, horizon));
  let steps = 0;
  let rejected = 0;
  let nEv = 0;

  const applyCommandsAt = (tt) => {
    while (ci < cmds.length && cmds[ci].t <= tt) {
      const c = cmds[ci++];
      for (const b of sys.command(c.t, c.id, c.cmd)) bps.add(b);
      out.events.push({ t: c.t, id: c.id, what: typeof c.cmd === 'object' ? JSON.stringify(c.cmd) : String(c.cmd) });
      solver.reset();
    }
  };

  let started = false;
  function start() {
    started = true;
    applyCommandsAt(0);
    if (peaks) notePeaks(0, y);
    // Reconcile discrete modes with the initial state: a check valve that starts with Δp above its
    // crack is open from t = 0. Crossing detection alone would miss it, since there is no
    // crossing. One pass suffices: crack > reseat, so a switched mode is stable.
    if (sys.nEvents) {
      sys.events(t, y, g0);
      for (let k = 0; k < sys.nEvents; k++) if (g0[k] >= 0) out.events.push(sys.fireEvent(k, 0)), nEv++;
      sys.events(t, y, g0);
      solver.reset();
    }
    sample(0, y);
    tSample = sampleDt;
  }

  /** Queue commands [{ t, id, cmd }] at future times (t ≥ now). Applied ones stay before ci. */
  function schedule(list) {
    const later = list.map((c, i) => ({ ...c, i: cmds.length + i }));
    for (const c of later) if (c.t < t) throw new Error(`schedule: command at t = ${c.t} s is in the past (now ${t} s)`);
    const pending = cmds.slice(ci).concat(later).sort((p, q) => p.t - q.t || p.i - q.i);
    cmds = cmds.slice(0, ci).concat(pending);
    for (const c of later) bps.add(c.t);
  }

  /** Apply a command now (live operation). */
  function command(id, cmd) {
    if (!started) start();
    for (const b of sys.command(t, id, cmd)) bps.add(b);
    out.events.push({ t, id, what: typeof cmd === 'object' ? JSON.stringify(cmd) : String(cmd) });
    solver.reset();
    if (sys.nEvents) sys.events(t, y, g0);
  }

  /** Integrate from now to tTo (s). */
  function advance(tTo) {
    if (!started) start();
    while (t < tTo) {
      if (++steps > maxSteps) throw new Error(`simulate: more than ${maxSteps} steps by t = ${t} s (stiff?)`);
      const tb = nextBreak(t, tTo);
      const hTry = Math.min(h, hmax, tb - t);
      let err;
      try {
        err = solver.trial(t, y, hTry);
      } catch (ex) {
        // A stage left the physical state space: the step was too big. Reject and shrink.
        if (!(ex instanceof NonPhysicalState)) throw ex;
        err = Infinity;
        solver.reset();
      }
      if (!(err <= 1)) {
        rejected++;
        h = Number.isFinite(err) ? solver.nextH(hTry, err) : hTry / 4;
        if (h < 1e-15 * Math.max(1, t)) throw new Error(`simulate: step size underflow at t = ${t} s`);
        continue;
      }
      const tOld = t;
      const hNext = solver.nextH(hTry, err);
      solver.accept(t, y, hTry);
      let tNew = tOld + hTry;
      if (tb - tNew <= 1e-12 * Math.max(1, tb)) tNew = tb; // land exactly on the breakpoint

      // State events inside [tOld, tNew]?
      let fired = -1;
      if (sys.nEvents) {
        sys.events(tNew, y, g1);
        let tFirst = Infinity;
        for (let k = 0; k < sys.nEvents; k++) {
          if (g0[k] < 0 && g1[k] >= 0) {
            const tr = locate(solver, sys, k, tOld, tNew, g0[k], g1[k], yE, gm);
            if (tr < tFirst) {
              tFirst = tr;
              fired = k;
            }
          }
        }
        if (fired >= 0) {
          solver.dense(tFirst, yE);
          while (tSample <= tFirst + 1e-15) sample(tSample, solver.dense(tSample, yS)), (tSample += sampleDt);
          y.set(yE);
          tNew = tFirst;
          out.events.push(sys.fireEvent(fired, tNew));
          if (++nEv > maxEvents) throw new Error(`simulate: more than ${maxEvents} state events (chattering?)`);
          solver.reset();
          sys.events(tNew, y, g1);
        }
      }
      if (fired < 0) {
        while (tSample <= tNew + 1e-15) sample(tSample, solver.dense(tSample, yS)), (tSample += sampleDt);
      }
      if (peaks) {
        for (const q of [0.25, 0.5, 0.75]) notePeaks(tOld + q * (tNew - tOld), solver.dense(tOld + q * (tNew - tOld), yP));
        notePeaks(tNew, y);
      }
      t = tNew;
      if (sys.nEvents) g0.set(g1);
      // Landing on tTo only because a chunk ended is not a discontinuity: keep the step size.
      h = fired >= 0 ? Math.min(hNext, hTry) : tNew === tTo && !bps.has(tNew) ? Math.max(h, hNext) : hNext;
      if (bps.has(t) || (ci < cmds.length && cmds[ci].t <= t)) {
        applyCommandsAt(t);
        solver.reset();
        if (sys.nEvents) sys.events(t, y, g0);
      }
    }
  }

  function stats() {
    const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - wall0;
    return { steps: steps - rejected, rejected, nfev: solver.nfev, events: nEv, wallMs: wall };
  }

  /** Close out a batch run: the last sample, final readout and stats. */
  function finish() {
    if (!started) start();
    if (out.t[out.t.length - 1] < t - 1e-12) sample(t, y);
    out.final = sys.readout(t, y);
    out.peaks = peaks;
    out.y = y;
    out.sys = sys;
    out.stats = stats();
    return out;
  }

  return {
    sys,
    out,
    get t() {
      return t;
    },
    schedule,
    command,
    advance,
    finish,
    stats,
    readout: () => sys.readout(t, y),
    peaks: () => peaks,
  };
}

/** Illinois regula falsi for event k on the last step's dense output. Returns the crossing time. */
function locate(solver, sys, k, ta, tb, ga, gb, yE, g) {
  let a = ta;
  let b = tb;
  let fa = ga;
  let fb = gb;
  let side = 0;
  const tol = 1e-12 * Math.max(1e-9, tb - ta);
  for (let it = 0; it < 100 && b - a > tol; it++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    sys.events(c, solver.dense(c, yE), g);
    const fc = g[k];
    if (fc >= 0) {
      b = c;
      fb = fc;
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      a = c;
      fa = fc;
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return b; // the first time at which g ≥ 0
}
