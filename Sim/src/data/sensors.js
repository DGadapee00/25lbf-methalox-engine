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
