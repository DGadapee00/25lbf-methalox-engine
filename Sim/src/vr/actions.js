/**
 * The Operate-mode actions the VR page can send. Same commands as the desktop
 * stand (labs/stand.js): valve open/close, regulator set point, faults.
 *
 * The 50–900 psia field and the 5 psi step are that page's number input, not a
 * component rating and not MEOP (MEOP is undecided). The time scales are the
 * same list as Operate.
 */
import { faultTargets, faultCommand } from '../ui/faults.js';
import { PSI } from '../physics/constants.js';

export const TIME_SCALES = [0.1, 0.25, 1, 2, 5];
export const PSET_PSI = { min: 50, max: 900, step: 5 };

const SHORT = {
  'HV-OX-01': 'HV',
  'SV-OX-01': 'SV-01',
  'SV-OX-02': 'SV-02',
  'PCV-OX-01': 'PCV',
  'PSV-OX-01': 'PSV',
  'INJ-OX-01': 'INJ',
  'THROAT-01': 'throat',
};

export function shortTag(tag) {
  return SHORT[tag] || tag;
}

/** Buttons on the DAQ panel and the desktop fallback. `state` is the session. */
export function operateActions(state, targets) {
  const psi = state.pSetPsia['PCV-OX-01'];
  const actions = [
    { id: 'run', label: state.paused ? 'Start' : 'Stop', act: { type: 'pause' } },
    { id: 'reset', label: 'Reset', act: { type: 'reset' } },
    { id: 'plot', label: state.plot === 'flows' ? 'Plot: flow' : 'Plot: pressure', act: { type: 'plot' } },
    { id: 'scale', label: `Time ${state.scale}×`, act: { type: 'scale' } },
    { id: 'pset-down', label: `PCV ${psi.toFixed(0)} −`, act: { type: 'pset', dir: -1 } },
    { id: 'pset-up', label: `PCV ${psi.toFixed(0)} +`, act: { type: 'pset', dir: 1 } },
    { id: 'snap-l', label: 'Snap left', act: { type: 'snap', sign: -1 } },
    { id: 'snap-r', label: 'Snap right', act: { type: 'snap', sign: 1 } },
    { id: 'f-bottle', label: 'Go: bottle', act: { type: 'focus', station: 'bottle' } },
    { id: 'f-man', label: 'Go: valves', act: { type: 'focus', station: 'manifold' } },
    { id: 'f-eng', label: 'Go: engine', act: { type: 'focus', station: 'engine' } },
  ];
  for (const tag of state.valves) actions.push({ id: `v-${tag}`, label: tag, act: { type: 'toggle', tag } });
  for (const n of [10, 50, 90]) {
    actions.push({
      id: `amt-${n}`,
      label: state.amount === n ? `${n}% set` : `${n}%`,
      act: { type: 'amount', amount: n },
    });
  }
  for (const t of targets) {
    for (const k of t.kinds) {
      actions.push({
        id: `ft-${t.tag}-${k.kind}`,
        label: `${shortTag(t.tag)} ${k.kind}`,
        act: { type: 'fault', target: t.tag, kind: k.kind },
      });
    }
  }
  return actions;
}

export function targetsOf(net) {
  return faultTargets(net);
}

/** Desktop Operate injects "now". Amounts (creep, blockage) have no default. */
export function injectFault(targets, form) {
  return faultCommand(targets, form);
}

export function clampPset(psia) {
  const { min, max, step } = PSET_PSI;
  const stepped = Math.round(psia / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

export function psetPa(psia) {
  return psia * PSI;
}
