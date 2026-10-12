/**
 * Operate mode for the GN₂ cold-flow stand, on the same worker as the desktop.
 *
 * createSimClient posts init / cmd / advance. This module does not solve
 * anything. Valve toggles match labs/stand.js: the last command wins, and the
 * picture follows the worker's stem position as the valve ramps.
 */
import { createSimClient } from '../engine/simClient.js';
import { gn2Coldflow } from '../data/stands/gn2Coldflow.js';
import { createObserver } from '../physics/sensors.js';
import { PSET_PSI, TIME_SCALES, clampPset, injectFault, operateActions, psetPa, targetsOf } from './actions.js';

const HISTORY_S = 30;
const STAND_ID = 'gn2-coldflow';

function channelsOf(sensors) {
  return sensors.map(({ offset, ...ch }) => ch);
}

export function createVrSession() {
  const spec = gn2Coldflow();
  const valves = spec.net.edges.filter((e) => e.type === 'valve').map((e) => e.id);
  const targets = targetsOf(spec.net);
  const channels = channelsOf(spec.sensors || []);
  const regs = spec.net.edges.filter((e) => e.type === 'regulator');

  const state = {
    ready: false,
    paused: false,
    scale: 1,
    plot: 'pressures',
    pSetPsia: Object.fromEntries(regs.map((r) => [r.id, r.pSet / psetPa(1)])),
    amount: null,
    message: '',
    t: 0,
    readout: null,
    measured: null,
    failsOpen: null,
    history: [],
    quiet: [],
    valves,
    pendingFocus: null,
    pendingSnap: null,
  };

  let observer = createObserver(channels);
  let cmd = {};
  let client = null;

  const onMsg = (m) => {
    if (m.type === 'ready') {
      state.ready = true;
      state.t = m.t;
      state.readout = m.readout;
      state.failsOpen = m.failsOpen;
      state.history = [];
      state.quiet = [];
      state.measured = null;
      observer = createObserver(channels);
    } else if (m.type === 'state') {
      state.ready = true;
      state.t = m.t;
      state.readout = m.readout;
      if (m.replace) {
        state.history = [];
        state.quiet = [];
        observer = createObserver(channels);
      }
      for (const sample of m.samples) {
        state.history.push(sample);
        state.quiet.push({ t: sample.t, values: observer.push(sample) });
      }
      const cut = m.t - HISTORY_S;
      while (state.history.length && state.history[0].t < cut) state.history.shift();
      while (state.quiet.length && state.quiet[0].t < cut) state.quiet.shift();
      const last = state.quiet[state.quiet.length - 1];
      state.measured = last ? last.values : null;
    } else if (m.type === 'error') {
      state.message = m.message;
    }
  };

  client = createSimClient(onMsg);
  client.init(STAND_ID, {});

  const api = {
    spec,
    state,
    targets,
    channels,
    standId: STAND_ID,
    actions() {
      return operateActions(state, targets);
    },
    toggle(tag) {
      if (!valves.includes(tag)) return;
      const open = cmd[tag] ? cmd[tag] === 'open' : (state.readout?.edges[tag]?.x ?? 0) > 0.5;
      cmd[tag] = open ? 'close' : 'open';
      client.command(tag, cmd[tag]);
      state.message = `${tag} ${cmd[tag]}`;
    },
    dispatch(act) {
      switch (act.type) {
        case 'toggle':
          api.toggle(act.tag);
          break;
        case 'pause':
          state.paused = !state.paused;
          state.message = state.paused ? 'Stopped' : 'Running';
          break;
        case 'reset':
          api.reset();
          break;
        case 'pset': {
          const tag = 'PCV-OX-01';
          state.pSetPsia[tag] = clampPset(state.pSetPsia[tag] + act.dir * PSET_PSI.step);
          client.command(tag, { pSet: psetPa(state.pSetPsia[tag]) });
          state.message = `${tag} set ${state.pSetPsia[tag].toFixed(0)} psia`;
          break;
        }
        case 'scale': {
          const i = TIME_SCALES.indexOf(state.scale);
          state.scale = TIME_SCALES[(i + 1) % TIME_SCALES.length];
          state.message = `Time scale ${state.scale}×`;
          break;
        }
        case 'plot':
          state.plot = state.plot === 'flows' ? 'pressures' : 'flows';
          break;
        case 'focus':
          state.pendingFocus = act.station;
          break;
        case 'snap':
          state.pendingSnap = act.sign;
          break;
        case 'amount':
          state.amount = act.amount;
          state.message = `Amount ${act.amount}%`;
          break;
        case 'fault': {
          const form = { target: act.target, kind: act.kind, amount: state.amount == null ? '' : String(state.amount) };
          const f = injectFault(targets, form);
          if (f.error) {
            state.message = f.error;
            break;
          }
          client.command(f.id, f.cmd);
          state.message = `${f.id}: ${f.label}`;
          break;
        }
        case 'note':
          state.message = act.text;
          break;
        default: {
          const unknown = act.type;
          throw new Error(`unknown VR action ${unknown}`);
        }
      }
    },
    tick(dt) {
      if (!state.paused && state.ready) client.advance(Math.min(0.1, dt) * state.scale);
    },
    reset() {
      state.history = [];
      state.quiet = [];
      state.measured = null;
      state.readout = null;
      state.ready = false;
      state.t = 0;
      cmd = {};
      observer = createObserver(channels);
      client.init(STAND_ID, {});
      state.message = 'Reset';
    },
    dispose() {
      client.terminate();
    },
  };
  return api;
}
