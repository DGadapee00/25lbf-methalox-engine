/**
 * Web Worker that runs a stand's physics (brief §4.5): physics is decoupled from rendering. The
 * main thread asks for a chunk of sim time each frame; the worker advances the network, applies
 * any commands at the current sim time, and posts back the latest readout plus the samples taken
 * since the last post (for plots).
 *
 * Messages in:  { type: 'init', stand, sequence?, faults? }  build the stand and start at t = 0.
 *                 sequence is a table in the Test_Stand/sequences/ file format (Sequence mode):
 *                 the table driver (physics/sequencer.js) plays its steps and runs its aborts and
 *                 checks. faults [{ t, id, cmd }] are injected at their times. Operate omits both.
 *               { type: 'cmd', id, cmd }       command now (valve 'open'/'close', { pSet }, { fault }, igniter)
 *               { type: 'advance', dt }        advance dt seconds of sim time
 *               { type: 'seek', t }            Sequence scrub. Forward continues the run. Backward
 *                 rebuilds from t = 0 and the same table (a command cannot be applied in the past)
 *                 and the state message sets replace so the plot starts over.
 * Messages out: { type: 'ready', t, readout, failsOpen, report? }
 *               { type: 'state', t, readout, samples, stats, report?, replace? }
 *               { type: 'error', message }
 */
import { createRun } from '../physics/simulate.js';
import { createSequenceRun } from '../physics/sequencer.js';
import { failsOpenPeaks } from '../physics/analysis.js';
import { expandSequence } from '../data/sequences.js';
import { STANDS } from '../data/stands/index.js';

let stand = null;
let standId = null;
let sequence = null;
let faults = [];
let run = null;
let driver = null;
let lastT = -Infinity;

function boot() {
  stand = STANDS[standId]();
  const rateHz = sequence?.rateHz || stand.sequence?.rateHz || 50;
  driver = null;
  if (sequence) {
    driver = createSequenceRun(stand, sequence, { faults, maxSamples: 8000 });
    run = driver.run;
  } else {
    run = createRun(stand.net, { gas: stand.gas, sampleDt: 1 / rateHz, horizon: 1, maxSamples: 8000 });
    if (faults.length) run.schedule(faults);
  }
  lastT = -Infinity;
}

const advanceTo = (t) => (driver ? driver.advance(t) : run.advance(t));
const report = () => (driver ? driver.report() : null);

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
      sequence = msg.sequence ? expandSequence(msg.sequence) : null;
      faults = msg.faults || [];
      boot();
      advanceTo(0);
      let failsOpen = [];
      try {
        failsOpen = failsOpenPeaks(stand.net, stand.gas, { tEnd: 0.3 }).map(({ stats, ...rest }) => rest);
      } catch (e) {
        failsOpen = [{ error: String(e.message || e) }];
      }
      self.postMessage({ type: 'ready', t: run.t, readout: run.readout(), failsOpen, report: report() });
    } else if (msg.type === 'cmd') {
      run.command(msg.id, msg.cmd);
    } else if (msg.type === 'advance') {
      advanceTo(run.t + Math.max(0, msg.dt));
      self.postMessage({ type: 'state', t: run.t, readout: run.readout(), samples: takeSamples(), stats: run.stats(), report: report() });
    } else if (msg.type === 'seek') {
      const tTo = Math.max(0, Number(msg.t) || 0);
      const rebuild = tTo < run.t - 1e-9;
      if (rebuild) boot();
      advanceTo(tTo);
      self.postMessage({ type: 'state', t: run.t, readout: run.readout(), samples: takeSamples(), stats: run.stats(), report: report(), replace: rebuild });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e.message || e) });
  }
};
