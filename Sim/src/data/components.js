/**
 * Stand component defaults (data/components.json), converted to SI.
 *
 * The JSON is written in the units a datasheet uses (psia, psi, g/s, mm, cm³, L, ms) so it can be
 * checked against the datasheet by eye. Every value carries either `source` or `placeholder: true`
 * plus the tracking issue; this module refuses a value with neither, so an unsourced number cannot
 * reach the stand. A part may `sameAs` another part to reuse its placeholders (see expandPart).
 * `provenance()` lists what the UI labels as placeholder or uncalibrated.
 */
import raw from '../../data/components.json' with { type: 'json' };
import { PSI, INCH, LBF } from '../physics/constants.js';
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
  deg: Math.PI / 180,
  lbf: LBF,
  1: 1,
};

const META = new Set(['sameAs', 'issue', 'note']);

function si(part, key, v) {
  if (!v || typeof v.value !== 'number') throw new Error(`components.json ${part}.${key}: missing numeric value`);
  if (!v.source && !v.placeholder) throw new Error(`components.json ${part}.${key}: needs a source or placeholder:true (no number without a source)`);
  if (v.placeholder && !v.issue) throw new Error(`components.json ${part}.${key}: placeholder needs its tracking issue`);
  const f = TO_SI[v.unit];
  if (f === undefined) throw new Error(`components.json ${part}.${key}: unknown unit "${v.unit}"`);
  return v.value * f;
}

/**
 * Resolve one part to a map of value records.
 *
 * `sameAs` copies another part's placeholders (a second valve that has not been selected either).
 * Sourced fields do not come along: a fuel regulator must not inherit the oxidizer's rated flow.
 * The alias names its own tracking issue. Fields written on the alias replace the copy.
 */
function expandPart(name, parts, seen = new Set()) {
  const part = parts[name];
  if (!part) throw new Error(`components.json: no part ${name}`);
  if (!part.sameAs) {
    const out = {};
    for (const [key, v] of Object.entries(part)) if (!META.has(key)) out[key] = v;
    return out;
  }
  if (seen.has(name)) throw new Error(`components.json: sameAs cycle at ${name}`);
  if (!part.issue) throw new Error(`components.json ${name}: sameAs needs its tracking issue`);
  seen.add(name);
  const base = expandPart(part.sameAs, parts, seen);
  const out = {};
  for (const [key, v] of Object.entries(base)) {
    if (!v?.placeholder) continue;
    out[key] = { ...v, issue: part.issue, note: part.note || v.note };
  }
  for (const [key, v] of Object.entries(part)) if (!META.has(key)) out[key] = v;
  return out;
}

function resolvedParts(json) {
  const out = {};
  for (const name of Object.keys(json.parts)) out[name] = expandPart(name, json.parts);
  return out;
}

/** Problems in the raw file: a number with no source, or a sameAs with no issue. Empty means clean. */
export function componentProblems(json = raw) {
  const problems = [];
  for (const [name, part] of Object.entries(json.parts || {})) {
    if (part.sameAs && !part.issue) problems.push(`${name}: sameAs needs its tracking issue`);
    for (const [key, v] of Object.entries(part)) {
      if (META.has(key)) continue;
      if (!v || typeof v !== 'object' || (!v.source && !v.placeholder)) problems.push(`${name}.${key}: needs a source or placeholder:true`);
    }
  }
  return problems;
}

/** { part: { key: SI value } } */
export function components(json = raw) {
  const out = {};
  for (const [part, vals] of Object.entries(resolvedParts(json))) {
    out[part] = {};
    for (const [key, v] of Object.entries(vals)) out[part][key] = si(part, key, v);
  }
  return out;
}

/** Every placeholder and uncalibrated value, for on-screen labels: [{ part, key, value, unit, note, issue, kind }]. */
export function provenance(json = raw) {
  const rows = [];
  for (const [part, vals] of Object.entries(resolvedParts(json))) {
    for (const [key, v] of Object.entries(vals)) {
      if (v.placeholder || v.uncalibrated) rows.push({ part, key, value: v.value, unit: v.unit, note: v.note || v.source || '', issue: v.issue, kind: v.placeholder ? 'placeholder' : 'uncalibrated' });
    }
  }
  return rows;
}

export const componentsMeta = { source: raw.source, generated: raw.generated, commit: raw.commit };

/**
 * C_dA (m²) of an injector circuit: the one shared injector C_d (components.json `injector.Cd`,
 * uncalibrated) × n holes × hole area. Every injector C_dA in the app comes through here.
 */
export function injectorCdA(c, part) {
  const p = c[part];
  return c.injector.Cd * p.n * (Math.PI / 4) * p.d * p.d;
}

/** C_dA (m²) for a valve part given by C_v. */
export const cdaOf = (part) => cvToCdA(part.Cv);
