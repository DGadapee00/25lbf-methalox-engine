/**
 * Transducer observer (M3). A pressure transducer does not push on the gas, so it is not an ODE
 * state and it never changes a step count. Lag, noise and quantization are applied to samples
 * after the fluid solve, in the order Test_Stand/daq_format.md specifies.
 *
 * The numbers (range, τ, bits, noise) come from components.json. They are placeholders until a
 * datasheet exists. Nothing here is tuned to make a run cheaper.
 */

/** Exact step of dy/dt = (p − y)/τ for a constant p over dt. τ ≤ 0 passes p through. */
export function stepLag(y, p, dt, tau) {
  if (!(tau > 0) || !(dt > 0)) return p;
  return p + (y - p) * Math.exp(-dt / tau);
}

/** Nearest LSB over [0, range], LSB = range / (2^bits − 1), clamped to the range. */
export function quantize(value, range, bits) {
  if (!(range > 0) || !(bits >= 1)) throw new Error(`quantize: range ${range}, bits ${bits}`);
  const lsb = range / (2 ** bits - 1);
  const clamped = Math.min(range, Math.max(0, value));
  return Math.round(clamped / lsb) * lsb;
}

export function lsb(range, bits) {
  return range / (2 ** bits - 1);
}

/** mulberry32. Returns uniform (0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller, from a uniform generator. */
function gaussian(uniform) {
  let u = uniform();
  let v = uniform();
  while (u <= 1e-12) u = uniform();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * samples: [{ t, p: { nodeId: Pa }, F?: { chamberId: N } }], increasing in t.
 * channels: [{ tag, node, quantity?, range, bits, tau, noise }]. A 'F' channel (load cell) reads
 * the sample's thrust for its chamber; every other channel reads the node pressure.
 * seed: integer to apply noise; omit it for the quiet reading (lag and quantization only).
 * Returns [{ t, values: { tag: number } }].
 */
export function measureSeries(samples, channels, { seed = null } = {}) {
  const obs = createObserver(channels, { seed });
  return samples.map((s) => ({ t: s.t, values: obs.push(s) }));
}

/**
 * The same observer, one sample at a time, for a sequencer that reads the transducers as the run
 * goes (physics/sequencer.js). push(sample) takes { t, p, F? } in time order and returns
 * { tag: reading }. The first sample starts every channel settled.
 */
export function createObserver(channels, { seed = null } = {}) {
  const rng = seed == null ? null : mulberry32(seed);
  const y = {};
  const read = (s, ch) => (ch.quantity === 'F' ? s.F?.[ch.node] : s.p[ch.node]);
  let tLast = null;
  return {
    push(s) {
      const first = tLast === null;
      const dt = first ? 0 : s.t - tLast;
      tLast = s.t;
      const values = {};
      for (const ch of channels) {
        const target = read(s, ch);
        if (target === undefined) throw new Error(`measureSeries: ${ch.tag} reads node ${ch.node}, which this sample does not have`);
        const quiet = first ? target : stepLag(y[ch.tag], target, dt, ch.tau);
        y[ch.tag] = quiet;
        let v = quiet;
        if (rng && ch.noise > 0) v += ch.noise * gaussian(rng);
        values[ch.tag] = quantize(v, ch.range, ch.bits);
      }
      return values;
    },
  };
}
