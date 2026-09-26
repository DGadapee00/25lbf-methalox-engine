/**
 * Remotely actuated valve (brief §4.3): an orifice with C_dA(t) = C_dA_max · φ(x(t)).
 *
 * Position x ∈ [0, 1] is a prescribed function of time, not an ODE state: after a command at t_c
 * the valve holds its current motion for `delay` seconds (command → motion), then ramps toward the
 * target at 1/t_open (opening) or 1/t_close (closing) per second. A command that arrives while an
 * earlier one is still pending or moving supersedes it from the moment the new motion starts.
 *
 * Because x(t) is piecewise linear, dC_dA/dt jumps where a ramp starts and ends. Those instants
 * are returned as breakpoints, and the driver ends a step exactly on each, so the integrator never
 * steps across a kink (brief §4.5).
 *
 * φ: 'linear' (φ = x) by default, or a table [[x, φ], …] with a cited source — a characteristic
 * curve (quick-opening, ball) is a datasheet property and has no default here (open decision D-5).
 */

/** Motion state for a valve edge. x0: initial position (0 closed, 1 open). */
export function valveInit(e) {
  return { x0: e.x0 ?? 0, segs: [] };
}

/** Position at time t (s). */
export function valvePosition(d, t) {
  let x = d.x0;
  for (const s of d.segs) {
    if (t < s.ts) break;
    const dx = s.rate * (t - s.ts);
    x = s.target > s.xs ? Math.min(s.target, s.xs + dx) : Math.max(s.target, s.xs - dx);
  }
  return x;
}

/**
 * Command at t_c (s): 'open', 'close', or a target position in [0, 1]. Returns the breakpoints
 * (s) the new motion introduces.
 */
export function valveCommand(e, d, tc, cmd) {
  const target = cmd === 'open' ? 1 : cmd === 'close' ? 0 : Math.max(0, Math.min(1, Number(cmd)));
  if (!Number.isFinite(target)) throw new Error(`valve ${e.id}: bad command ${cmd}`);
  const ts = tc + (e.delay ?? 0);
  const xs = valvePosition(d, ts);
  d.segs = d.segs.filter((s) => s.ts < ts);
  const ramp = target > xs ? e.tOpen : e.tClose;
  if (!(ramp >= 0)) throw new Error(`valve ${e.id}: tOpen/tClose must be ≥ 0 s`);
  if (ramp === 0) {
    // Instant: model as a step at ts, a breakpoint on each side.
    d.segs.push({ ts, xs: target, target, rate: 0 });
    return [ts];
  }
  const rate = 1 / ramp;
  d.segs.push({ ts, xs, target, rate });
  return [ts, ts + Math.abs(target - xs) * ramp];
}

/** φ(x): flow-area fraction at position x. */
export function valvePhi(e, x) {
  const c = e.curve;
  if (!c || c === 'linear') return x;
  // Piecewise-linear table, x ascending from 0 to 1.
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][0]) {
      const [x0, p0] = c[i - 1];
      const [x1, p1] = c[i];
      return p0 + ((p1 - p0) * (x - x0)) / (x1 - x0);
    }
  }
  return c[c.length - 1][1];
}
