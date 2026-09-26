/**
 * V-6: the relief valve cracks and reseats at its configured pressures; the check valve blocks
 * reverse flow and holds closed below its cracking Δp. Plus valve timing (delay, ramp) and the
 * regulator fault modes, which later abort tests depend on.
 */
import { approx, ok, section, recordStats } from './harness.js';
import { simulate } from '../simulate.js';
import { perfectGasGamma } from '../gas.js';
import { valveInit, valveCommand, valvePosition } from '../elements/valve.js';

const gas = perfectGasGamma('N2', 0.028014, 1.4);
const T = 300;

export function run() {
  section('V-6 · relief valve cracks and reseats at its set points');
  // A tank fed from a fixed 50 bar supply through a small orifice, relieving to 1 atm.
  const set = 20e5;
  const blowdown = 0.15;
  const relief = {
    nodes: [
      { id: 'sup', kind: 'ambient', p: 50e5, T, Y: { N2: 1 } },
      { id: 'tank', kind: 'volume', V: 1e-3, p: 1e5, T, Y: { N2: 1 }, thermal: 'isothermal' },
      { id: 'amb', kind: 'ambient', p: 101325, T, Y: { N2: 1 } },
    ],
    edges: [
      { id: 'feed', type: 'orifice', a: 'sup', b: 'tank', CdA: 2e-7 },
      { id: 'RV', type: 'relief', a: 'tank', b: 'amb', CdA: 2e-6, set, blowdown },
    ],
  };
  const r = simulate(relief, { gas, tEnd: 20, sampleDt: 0.05 });
  recordStats('V-6 relief cycling', r.stats);
  const ev = r.events.filter((e) => e.id === 'RV');
  ok(ev.length >= 4, `relief cycled (${ev.length} crack/reseat events in 20 s)`);
  // Pressure at each event, from the dense output-located event time.
  const pAt = (t) => {
    const r2 = simulate(relief, { gas, tEnd: t, sampleDt: t });
    return r2.final.nodes.tank.p;
  };
  const first = ev[0];
  const second = ev[1];
  ok(first.what === 'open' && second.what === 'close', 'first a crack, then a reseat');
  approx(pAt(first.t) - 101325, set, 1e-6, `cracks at the set Δp (${(set / 1e5).toFixed(1)} bar above ambient)`);
  approx(pAt(second.t) - 101325, set * (1 - blowdown), 1e-6, `reseats at set·(1 − blowdown) = ${((set * (1 - blowdown)) / 1e5).toFixed(2)} bar Δp`);

  section('V-6 · check valve');
  const check = (pa, pb, crack) => ({
    nodes: [
      { id: 'A', kind: 'volume', V: 1e-3, p: pa, T, Y: { N2: 1 }, thermal: 'isothermal' },
      { id: 'B', kind: 'volume', V: 1e-3, p: pb, T, Y: { N2: 1 }, thermal: 'isothermal' },
    ],
    edges: [{ id: 'CV', type: 'check', a: 'A', b: 'B', CdA: 1e-6, crack, reseat: crack / 3 }],
  });
  const rev = simulate(check(2e5, 10e5, 0.2e5), { gas, tEnd: 5, sampleDt: 1 });
  recordStats('V-6 check valve reverse', rev.stats);
  const m0 = (res) => res.sys.initialState()[0];
  ok(rev.y[0] === m0(rev) && rev.events.length === 0, 'reverse Δp: no flow at all (mass in A unchanged to the last bit)');
  const below = simulate(check(10e5, 9.9e5, 0.2e5), { gas, tEnd: 5, sampleDt: 1 });
  ok(below.y[0] === m0(below) && below.events.length === 0, 'forward Δp below crack: stays shut');
  const fwd = simulate(check(10e5, 2e5, 0.2e5), { gas, tEnd: 30, sampleDt: 1 });
  recordStats('V-6 check valve forward', fwd.stats);
  const close = fwd.events.find((e) => e.what === 'close');
  ok(fwd.events[0]?.what === 'open' && fwd.events[0].t === 0, 'forward Δp above crack: opens at once');
  ok(!!close, 'reseats as the tanks approach each other');
  const dpFinal = fwd.final.nodes.A.p - fwd.final.nodes.B.p;
  approx(dpFinal, 0.2e5 / 3, 1e-6, 'and holds the reseat Δp (crack/3) after it closes');

  section('Valve timing: delay, then a linear ramp');
  const e = { id: 'v', tOpen: 0.1, tClose: 0.05, delay: 0.02 };
  const d = valveInit(e);
  const bp = valveCommand(e, d, 1.0, 'open');
  ok(bp[0] === 1.02 && Math.abs(bp[1] - 1.12) < 1e-12, 'open at t = 1: motion 1.02 → 1.12 s');
  ok(valvePosition(d, 1.019) === 0 && Math.abs(valvePosition(d, 1.07) - 0.5) < 1e-12 && valvePosition(d, 1.2) === 1, 'x = 0 during the delay, 0.5 halfway, 1 after');
  valveCommand(e, d, 1.05, 'close'); // arrives mid-opening
  approx(valvePosition(d, 1.07), 0.5, 1e-12, 'a close arriving mid-ramp lets the opening continue through its own delay');
  approx(valvePosition(d, 1.08), 0.3, 1e-9, '…then closes from there at 1/t_close');
  ok(valvePosition(d, 1.2) === 0, '…to shut');
}
