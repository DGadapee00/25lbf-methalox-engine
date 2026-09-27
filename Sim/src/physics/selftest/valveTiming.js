/**
 * SV-OX-01 timing against its own delay and ramp, not against a stored trace. Half open is the
 * middle of the ramp; the stem does not move during the command delay.
 */
import { ok, approx, section } from './harness.js';
import { valveTimingDefaults, runValveTiming } from '../../data/valveTiming.js';

export function run() {
  section('Valve timing · SV-OX-01 delay and ramp');
  const s = valveTimingDefaults();
  const r = runValveTiming(s);
  const during = r.samples.find((x) => x.t >= s.delay * 0.5);
  ok(during.edges['SV-OX-01'].x === 0, `stem stays shut through the ${s.delay * 1e3} ms command delay`);
  approx(r.halfT, s.delay + 0.5 * s.tOpen, 0.002 / (s.delay + 0.5 * s.tOpen), `half open at delay + tOpen/2 (${(r.halfT * 1e3).toFixed(1)} ms)`);
  approx(r.openT, s.delay + s.tOpen, 0.002 / (s.delay + s.tOpen), `full open at delay + tOpen (${(r.openT * 1e3).toFixed(1)} ms)`);
  ok(r.final.edges['INJ-OX-01'].mdot > 0, 'once the valve is open, the injector passes gas');
}
