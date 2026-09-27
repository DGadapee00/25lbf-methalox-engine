/**
 * Sequence tables (brief §5.4). The files live in Test_Stand/sequences/ because the stand and,
 * later, the firmware share them. This module is the only reader.
 *
 * A step is { t, cmd: { TAG: "open" | "close" | { ... } }, note? }, the brief's shape. The driver
 * and the stand UI take a flat list { t, id, cmd }. expandSequence does that and nothing else.
 * Timings in a file are that sequence's timings. This module does not invent any.
 *
 * Aborts, checks and abort actions (M5) are parsed here and run by physics/sequencer.js; their
 * grammar is documented there. A file with none of them plays exactly as before.
 */
import gn2Step1 from '../../../Test_Stand/sequences/gn2-step1.json' with { type: 'json' };
import { parseAbortCondition, parseCheck } from '../physics/sequencer.js';

const FILES = {
  'gn2-step1': gn2Step1,
};

/** Flat driver steps for one sequence file. */
export function expandSequence(raw) {
  if (!raw?.id || !Array.isArray(raw.steps)) throw new Error('sequence: needs id and steps');
  const steps = [];
  for (const st of raw.steps) {
    if (!(st.t >= 0) || !st.cmd || typeof st.cmd !== 'object' || Array.isArray(st.cmd)) {
      throw new Error(`sequence ${raw.id}: step at t=${st.t} needs t ≥ 0 and a cmd object`);
    }
    for (const [id, cmd] of Object.entries(st.cmd)) {
      const step = { t: st.t, id, cmd };
      if (st.note) step.note = st.note;
      steps.push(step);
    }
  }
  const actions = {};
  for (const [name, list] of Object.entries(raw.actions || {})) {
    if (!Array.isArray(list)) throw new Error(`sequence ${raw.id}: action ${name} must be a list of { dt, cmd }`);
    actions[name] = list.map((a) => {
      if (!(a.dt >= 0) || !a.cmd || typeof a.cmd !== 'object') throw new Error(`sequence ${raw.id}: action ${name} needs dt ≥ 0 and a cmd object`);
      return { dt: a.dt, cmd: a.cmd };
    });
  }
  const aborts = (raw.aborts || []).map((a) => {
    if (!a.id || !a.when || !a.action) throw new Error(`sequence ${raw.id}: an abort needs id, when and action`);
    return { ...a, cond: parseAbortCondition(a.when) };
  });
  const checks = (raw.checks || []).map((c) => {
    if (!c.id || !c.expect) throw new Error(`sequence ${raw.id}: a check needs id and expect`);
    return { ...c, rule: parseCheck(c.expect) };
  });
  return { id: raw.id, purpose: raw.purpose || '', tEnd: raw.tEnd, rateHz: raw.rateHz, steps, aborts, checks, actions };
}

/** The expanded sequence the driver plays. */
export function loadSequence(id) {
  const raw = FILES[id];
  if (!raw) throw new Error(`sequence: no file for ${id}`);
  if (raw.id !== id) throw new Error(`sequence: file id ${raw.id} does not match ${id}`);
  return expandSequence(raw);
}

/** The file as stored, for the valve-state matrix. */
export function sequenceSource(id) {
  const raw = FILES[id];
  if (!raw) throw new Error(`sequence: no file for ${id}`);
  return raw;
}

export const SEQUENCE_IDS = Object.keys(FILES);
