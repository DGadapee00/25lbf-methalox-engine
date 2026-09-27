/**
 * Sequence tables (brief §5.4). The files live in Test_Stand/sequences/ because the stand and,
 * later, the firmware share them. This module is the only reader.
 *
 * A step is { t, cmd: { TAG: "open" | "close" | { ... } }, note? }, the brief's shape. The driver
 * and the stand UI take a flat list { t, id, cmd }. expandSequence does that and nothing else.
 * Timings in a file are that sequence's timings. This module does not invent any.
 */
import gn2Step1 from '../../../Test_Stand/sequences/gn2-step1.json' with { type: 'json' };

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
  return { id: raw.id, purpose: raw.purpose || '', tEnd: raw.tEnd, rateHz: raw.rateHz, steps };
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
