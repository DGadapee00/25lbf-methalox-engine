/**
 * Pressure-transducer channels for a stand. Node and tag live on the stand; range, lag, bits and
 * noise live in components.json (`pt` shared, per-tag `range`) so the orifice lab, the stand and
 * the DAQ file cannot each invent a number.
 */
import { components } from './components.js';

/** One channel, SI, ready for measureSeries and daqCsv. `extra` is layout (offset) and the like. */
export function pressureChannel(tag, node, c = components(), extra = {}) {
  const pt = c.pt;
  const part = c[tag];
  if (!part?.range) throw new Error(`sensors: ${tag} has no range in components.json`);
  return {
    tag,
    node,
    quantity: 'p',
    unit: 'Pa',
    range: part.range,
    bits: pt.bits,
    tau: pt.tau,
    noise: pt.noise,
    ...extra,
  };
}

/**
 * Thrust load-cell channel: reads the chamber's thrust F (N), not a node pressure. Range, lag, bits
 * and noise from components.json (`lc` shared, per-tag `range`), placeholders until a load cell is
 * selected (issue #6).
 */
export function forceChannel(tag, chamber, c = components(), extra = {}) {
  const lc = c.lc;
  const part = c[tag];
  if (!part?.range) throw new Error(`sensors: ${tag} has no range in components.json`);
  return {
    tag,
    node: chamber,
    quantity: 'F',
    unit: 'N',
    range: part.range,
    bits: lc.bits,
    tau: lc.tau,
    noise: lc.noise,
    ...extra,
  };
}
