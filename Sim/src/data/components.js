/**
 * Stand component defaults (data/components.json), converted to SI.
 *
 * The JSON is written in the units a datasheet uses (psia, psi, g/s, mm, cm³, L, ms) so it can be
 * checked against the datasheet by eye. Every value carries either `source` or `placeholder: true`
 * plus the tracking issue; this module refuses a value with neither, so an unsourced number cannot
 * reach the stand. `provenance()` lists what the UI labels as placeholder or uncalibrated.
 */
import raw from '../../data/components.json' with { type: 'json' };
import { PSI, INCH } from '../physics/constants.js';
import { cvToCdA } from '../physics/elements/orifice.js';

const TO_SI = {
  Pa: 1,
  psia: PSI,
  psi: PSI, // a pressure difference (Δp) in the JSON
  'g/s': 1e-3,
  mm: 1e-3,
  in: INCH,
  cm3: 1e-6,
  L: 1e-3,
  m3: 1,
  ms: 1e-3,
  s: 1,
  K: 1,
  1: 1,
};

function si(part, key, v) {
  if (!v || typeof v.value !== 'number') throw new Error(`components.json ${part}.${key}: missing numeric value`);
  if (!v.source && !v.placeholder) throw new Error(`components.json ${part}.${key}: needs a source or placeholder:true (no number without a source)`);
  if (v.placeholder && !v.issue) throw new Error(`components.json ${part}.${key}: placeholder needs its tracking issue`);
  const f = TO_SI[v.unit];
  if (f === undefined) throw new Error(`components.json ${part}.${key}: unknown unit "${v.unit}"`);
  return v.value * f;
}

/** { part: { key: SI value } } */
export function components(json = raw) {
  const out = {};
  for (const [part, vals] of Object.entries(json.parts)) {
    out[part] = {};
    for (const [key, v] of Object.entries(vals)) out[part][key] = si(part, key, v);
  }
  return out;
}

/** Every placeholder and uncalibrated value, for on-screen labels: [{ part, key, value, unit, note, issue, kind }]. */
export function provenance(json = raw) {
  const rows = [];
  for (const [part, vals] of Object.entries(json.parts)) {
    for (const [key, v] of Object.entries(vals)) {
      if (v.placeholder || v.uncalibrated) rows.push({ part, key, value: v.value, unit: v.unit, note: v.note || v.source || '', issue: v.issue, kind: v.placeholder ? 'placeholder' : 'uncalibrated' });
    }
  }
  return rows;
}

export const componentsMeta = { source: raw.source, generated: raw.generated, commit: raw.commit };

/** C_dA (m²) for a valve part given by C_v. */
export const cdaOf = (part) => cvToCdA(part.Cv);
