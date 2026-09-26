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
  section('V-6 · relief valve: proportional lift, cracks at set, full at set + accumulation, reseats with blowdown');
  // A 1 L isothermal tank fed from a fixed 50 bar supply through a valve, relieving to 1 atm.
  // Phase 1: feed open, the relief modulates to pass exactly the feed flow.
  // Phase 2: feed shut at t_cut, the tank vents through the relief until it reseats.
  const set = 20e5;
  const blowdown = 0.15;
  const acc = 0.1;
  const P_AMB = 101325;
  const CdAfeed = 2e-7;
  const CdArv = 2e-6;
  const relief = {
    nodes: [
      { id: 'sup', kind: 'ambient', p: 50e5, T, Y: { N2: 1 } },
      { id: 'tank', kind: 'volume', V: 1e-3, p: 1e5, T, Y: { N2: 1 }, thermal: 'isothermal' },
      { id: 'amb', kind: 'ambient', p: P_AMB, T, Y: { N2: 1 } },
    ],
    edges: [
      { id: 'SV-N2-01', type: 'valve', a: 'sup', b: 'tank', CdAmax: CdAfeed, tOpen: 0, tClose: 0, x0: 1 },
      { id: 'PSV-N2-01', type: 'relief', a: 'tank', b: 'amb', CdA: CdArv, set, blowdown, accumulation: acc, tauLift: 1e-3 },
    ],
  };
  const tCut = 30;
  const r = simulate(relief, { gas, tEnd: 60, schedule: [{ t: tCut, id: 'SV-N2-01', cmd: 'close' }], sampleDt: 0.01, rtol: 1e-10 });
  recordStats('V-6 relief, feed then vent', r.stats);
  const pts = r.samples.map((sm) => ({ t: sm.t, dp: sm.nodes.tank.p - P_AMB, L: sm.edges['PSV-N2-01'].lift }));
  // Crack: the first sample with lift is at Δp just above set (the rising curve starts there).
  const first = pts.find((q) => q.L > 1e-6);
  ok(first && first.dp >= set && first.dp < set * (1 + 0.01 * acc), `lift begins at the set Δp (${first ? (first.dp / 1e5).toFixed(4) : '—'} bar vs ${(set / 1e5).toFixed(1)})`);
  // Modulating balance before the cut: relief flow = feed flow at lift L*, on the rising curve.
  const bal = r.samples.find((sm) => sm.t >= tCut - 0.5);
  const Ls = bal.edges['PSV-N2-01'].lift;
  const dps = bal.nodes.tank.p - P_AMB;
  approx(dps, set * (1 + acc * Ls), 1e-6, `holding feed flow, Δp sits on the rising curve: set·(1 + acc·L*) with L* = ${Ls.toFixed(3)}`);
  approx(bal.edges['PSV-N2-01'].mdot, bal.edges['SV-N2-01'].mdot, 1e-6, 'and passes exactly the feed flow (it modulates, it does not cycle)');
  ok(Ls > 0 && Ls < 1, 'the balance is at partial lift, inside the loop');
  // After the cut the lift holds until Δp reaches the falling curve at L*, then follows it down.
  const pReseat = set * (1 - blowdown);
  const pFull = set * (1 + acc);
  const dpTurn = pReseat + Ls * (pFull - pReseat);
  const held = pts.filter((q) => q.t > tCut + 0.05 && q.dp > dpTurn * 1.001);
  ok(held.length > 0 && held.every((q) => Math.abs(q.L - Ls) < 1e-3), `lift holds at L* while Δp falls to the closing curve (${(dpTurn / 1e5).toFixed(3)} bar)`);
  const last = pts[pts.length - 1];
  approx(last.dp, pReseat, 2e-3, `reseats at set·(1 − blowdown) = ${(pReseat / 1e5).toFixed(2)} bar Δp`);
  ok(last.L < 1e-3, 'and is shut again at the end');
  const cycles = pts.reduce((n, q, i) => n + (i && q.L > 1e-3 && pts[i - 1].L <= 1e-3 ? 1 : 0), 0);
  ok(cycles === 1, `one lift, no chatter (${cycles} opening${cycles === 1 ? '' : 's'})`);

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
