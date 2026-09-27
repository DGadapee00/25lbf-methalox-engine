/**
 * Web Worker that runs a stand's physics (brief §4.5): physics is decoupled from rendering. The
 * main thread asks for a chunk of sim time each frame; the worker advances the network, applies
 * any commands at the current sim time, and posts back the latest readout plus the samples taken
 * since the last post (for plots).
 *
 * Messages in:  { type: 'init', stand, schedule? }  build the stand and start a run at t = 0.
 *                 schedule is [{ t, id, cmd }] for Sequence mode; Operate omits it.
 *               { type: 'cmd', id, cmd }       command now (valve 'open'/'close', { pSet }, { fault })
 *               { type: 'advance', dt }        advance dt seconds of sim time
 *               { type: 'seek', t }            Sequence scrub. Forward continues the run. Backward
 *                 rebuilds from t = 0 and the same schedule (a command cannot be applied in the past)
 *                 and the state message sets replace so the plot starts over.
 * Messages out: { type: 'ready', t, readout, failsOpen }
 *               { type: 'state', t, readout, samples, stats, replace? }
 *               { type: 'error', message }
 */
import { createRun } from '../physics/simulate.js';
import { failsOpenPeaks } from '../physics/analysis.js';
import { STANDS } from '../data/stands/index.js';

let stand = null;
let standId = null;
let schedule = [];
let run = null;
let lastT = -Infinity;

function boot() {
  stand = STANDS[standId]();
  const rateHz = stand.sequence?.rateHz || 50;
  run = createRun(stand.net, { gas: stand.gas, sampleDt: 1 / rateHz, horizon: 1, maxSamples: 8000 });
  if (schedule.length) run.schedule(schedule);
  lastT = -Infinity;
}

function takeSamples() {
  const fresh = run.out.samples.filter((x) => x.t > lastT);
  if (fresh.length) lastT = fresh[fresh.length - 1].t;
  return fresh.map(compact);
}

function compact(s) {
  const p = {};
  for (const [k, v] of Object.entries(s.nodes)) p[k] = v.p;
  const m = {};
  for (const [k, v] of Object.entries(s.edges)) m[k] = v.mdot;
  if (!s.chambers) return { t: s.t, p, m };
  const F = {};
  for (const [k, v] of Object.entries(s.chambers)) F[k] = v.F;
  return { t: s.t, p, m, F };
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      standId = msg.stand;
      schedule = msg.schedule || [];
      boot();
      run.advance(0);
      let failsOpen = [];
      try {
        failsOpen = failsOpenPeaks(stand.net, stand.gas, { tEnd: 0.3 }).map(({ stats, ...rest }) => rest);
      } catch (e) {
        failsOpen = [{ error: String(e.message || e) }];
      }
      self.postMessage({ type: 'ready', t: run.t, readout: run.readout(), failsOpen });
    } else if (msg.type === 'cmd') {
      run.command(msg.id, msg.cmd);
    } else if (msg.type === 'advance') {
      run.advance(run.t + Math.max(0, msg.dt));
      self.postMessage({ type: 'state', t: run.t, readout: run.readout(), samples: takeSamples(), stats: run.stats() });
    } else if (msg.type === 'seek') {
      const tTo = Math.max(0, Number(msg.t) || 0);
      const rebuild = tTo < run.t - 1e-9;
      if (rebuild) boot();
      run.advance(tTo);
      self.postMessage({ type: 'state', t: run.t, readout: run.readout(), samples: takeSamples(), stats: run.stats(), replace: rebuild });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e.message || e) });
  }
};
