/**
 * Simulation driver (brief §4.5): integrates a compiled network between breakpoints with Ros3
 * (Rosenbrock, default: the stand is stiff) or Dormand–Prince 5(4) (opts.method: 'dopri5'), handles discrete events, and samples on a fixed grid from the dense output.
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
import { Ros3 } from './integrate/ros3.js';
import { NonPhysicalState } from './gas.js';

export function simulate(net, opts) {
  const { tEnd, schedule = [] } = opts;
  const run = createRun(net, { ...opts, horizon: tEnd, sampleDt: opts.sampleDt ?? tEnd / 200 });
  run.schedule(schedule);
  run.advance(tEnd);
  return run.finish();
}

export function createRun(net, opts) {
  const method = opts.method ?? 'ros3';
  // Each method at its natural tolerance: third-order Ros3 at 1e-6 (≈ 0.0005 psi at 480 psia,
  // below any transducer), fifth-order Dormand–Prince at 1e-8. Tests that need tighter ask for it.
  const TOL = { ros3: [1e-6, 1e-8], dopri5: [1e-8, 1e-10] }[method];
  if (!TOL) throw new Error(`simulate: unknown method ${method}`);
  const { gas, sampleDt = 0.01, rtol = TOL[0], atolRel = opts.rtol !== undefined ? opts.rtol / 100 : TOL[1], maxSteps = 2e6, maxEvents = 1e5, maxSamples = Infinity } = opts;
  const horizon = opts.horizon ?? 1;
  const sys = opts.sys || compileNetwork(net, gas);
  const y = sys.initialState();
  const sc = sys.scales();
  const atol = sc.map((s) => s * atolRel);
  // Integrator: 'ros3' (Rosenbrock, the default since M3: the stand is stiff) or 'dopri5'.
  const solver = method === 'dopri5' ? new Dopri5(sys.nState, sys.rhs, { rtol, atol }) : new Ros3(sys.nState, sys.rhs, { rtol, atol, scale: sc });
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
  const vols = sys.nodes.map((n, k) => [n, k]).filter(([n]) => n.kind !== 'ambient');
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
  const k0 = new Float64Array(sys.nKinks);
  const k1 = new Float64Array(sys.nKinks);
  const km = new Float64Array(sys.nKinks);
  const skip = new Uint8Array(sys.nKinks);
  let nKinkCuts = 0;
  const g1 = new Float64Array(sys.nEvents);
  const gm = new Float64Array(sys.nEvents);
  const yE = new Float64Array(sys.nState);

  const wall0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let t = 0;
  let h = Math.min(hmax, 1e-6 * Math.max(1, horizon));
  let steps = 0;
  let rejected = 0;
  let nEv = 0;

  /** Chamber modes a command or an event left behind with no crossing to find (network.js). */
  const reconcile = (tt) => {
    if (!sys.reconcile) return;
    for (let k = 0; k < 4; k++) {
      const fired = sys.reconcile(tt, y);
      if (!fired.length) return;
      out.events.push(...fired);
      nEv += fired.length;
      solver.reset();
    }
  };

  const applyCommandsAt = (tt) => {
    let any = false;
    while (ci < cmds.length && cmds[ci].t <= tt) {
      const c = cmds[ci++];
      for (const b of sys.command(c.t, c.id, c.cmd)) bps.add(b);
      out.events.push({ t: c.t, id: c.id, what: typeof c.cmd === 'object' ? JSON.stringify(c.cmd) : String(c.cmd) });
      solver.reset();
      any = true;
    }
    if (any) reconcile(tt);
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
      for (let k = 0; k < sys.nEvents; k++) if (g0[k] >= 0 && k < (sys.nCheckEvents ?? sys.nEvents)) out.events.push(sys.fireEvent(k, 0, y)), nEv++;
      reconcile(0);
      sys.events(t, y, g0);
      solver.reset();
    }
    if (sys.nKinks) sys.kinks(t, y, k0);
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

  /** Drop pending (not yet applied) commands for which pred(cmd) is true: an abort cancels the rest of a table. */
  function cancel(pred) {
    cmds = cmds.slice(0, ci).concat(cmds.slice(ci).filter((c) => !pred(c)));
  }

  /** Apply a command now (live operation). */
  function command(id, cmd) {
    if (!started) start();
    for (const b of sys.command(t, id, cmd)) bps.add(b);
    out.events.push({ t, id, what: typeof cmd === 'object' ? JSON.stringify(cmd) : String(cmd) });
    solver.reset();
    reconcile(t);
    if (sys.nEvents) sys.events(t, y, g0);
    if (sys.nKinks) sys.kinks(t, y, k0);
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

      // State events and kinks inside [tOld, tNew]? Take the earliest.
      let fired = -1;
      let kinked = -1;
      let tFirst = Infinity;
      if (sys.nEvents) {
        sys.events(tNew, y, g1);
        for (let k = 0; k < sys.nEvents; k++) {
          if (g0[k] < 0 && g1[k] >= 0) {
            const tr = locate(solver, (tt, yy, o) => sys.events(tt, yy, o), k, tOld, tNew, g0[k], g1[k], yE, gm);
            if (tr < tFirst) {
              tFirst = tr;
              fired = k;
            }
          }
        }
      }
      if (sys.nKinks) {
        sys.kinks(tNew, y, k1);
        for (let k = 0; k < sys.nKinks; k++) {
          if (!skip[k] && k0[k] * k1[k] < 0) {
            const tr = locate(solver, (tt, yy, o) => sys.kinks(tt, yy, o), k, tOld, tNew, k0[k], k1[k], yE, km);
            if (tr < tFirst && tr > tOld) {
              tFirst = tr;
              kinked = k;
              fired = -1;
            }
          }
        }
        skip.fill(0);
      }
      if (kinked >= 0) {
        // Cut the step at the kink and restart there; no state changes.
        solver.dense(tFirst, yE);
        while (tSample <= tFirst + 1e-15) sample(tSample, solver.dense(tSample, yS)), (tSample += sampleDt);
        y.set(yE);
        tNew = tFirst;
        nKinkCuts++;
        solver.reset();
        skip[kinked] = 1; // it sits at zero here; do not find it again at the start of the next step
        if (sys.nEvents) sys.events(tNew, y, g1);
        sys.kinks(tNew, y, k1);
      }
      if (sys.nEvents) {
        if (fired >= 0) {
          solver.dense(tFirst, yE);
          while (tSample <= tFirst + 1e-15) sample(tSample, solver.dense(tSample, yS)), (tSample += sampleDt);
          y.set(yE);
          tNew = tFirst;
          out.events.push(sys.fireEvent(fired, tNew, y));
          if (++nEv > maxEvents) throw new Error(`simulate: more than ${maxEvents} state events (chattering?)`);
          solver.reset();
          reconcile(tNew);
          sys.events(tNew, y, g1);
        }
      }
      if (fired < 0 && kinked < 0) {
        while (tSample <= tNew + 1e-15) sample(tSample, solver.dense(tSample, yS)), (tSample += sampleDt);
      }
      if (peaks) {
        for (const q of [0.25, 0.5, 0.75]) notePeaks(tOld + q * (tNew - tOld), solver.dense(tOld + q * (tNew - tOld), yP));
        notePeaks(tNew, y);
      }
      t = tNew;
      if (sys.nEvents) g0.set(g1);
      if (sys.nKinks) {
        if (fired >= 0) sys.kinks(t, y, k1);
        k0.set(k1);
      }
      // Landing on tTo only because a chunk ended is not a discontinuity: keep the step size.
      h = fired >= 0 || kinked >= 0 ? Math.min(hNext, hTry) : tNew === tTo && !bps.has(tNew) ? Math.max(h, hNext) : hNext;
      if (bps.has(t) || (ci < cmds.length && cmds[ci].t <= t)) {
        applyCommandsAt(t);
        solver.reset();
        if (sys.nEvents) sys.events(t, y, g0);
        if (sys.nKinks) sys.kinks(t, y, k0);
      }
    }
  }

  function stats() {
    const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - wall0;
    return { steps: steps - rejected, rejected, nfev: solver.nfev, events: nEv, kinks: nKinkCuts, wallMs: wall, method };
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
    cancel,
    command,
    advance,
    finish,
    stats,
    readout: () => sys.readout(t, y),
    peaks: () => peaks,
  };
}

/**
 * Illinois regula falsi on the last step's dense output, for component k of evalFn(t, y, out),
 * which changes sign between ta (value ga) and tb (value gb). Returns the time just past the
 * crossing: the first time at which the component has the sign it has at tb.
 */
function locate(solver, evalFn, k, ta, tb, ga, gb, yE, g) {
  let a = ta;
  let b = tb;
  let fa = ga;
  let fb = gb;
  let side = 0;
  const tol = 1e-12 * Math.max(1e-9, tb - ta);
  const sgnB = Math.sign(gb) || 1;
  for (let it = 0; it < 100 && b - a > tol; it++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    evalFn(c, solver.dense(c, yE), g);
    const fc = g[k];
    if ((Math.sign(fc) || sgnB) === sgnB) {
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
  return b;
}
