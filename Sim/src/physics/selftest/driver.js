/**
 * The steppable driver the live stand runs (createRun) against the batch one (simulate): the same
 * run advanced in many small chunks, with a command issued live, must match one batch run with
 * that command scheduled. Chunk ends are not discontinuities, so the answers agree to the
 * integrator's tolerance.
 */
import { approx, ok, section, recordStats } from './harness.js';
import { simulate, createRun } from '../simulate.js';
import { perfectGasGamma } from '../gas.js';

export function run() {
  section('Driver · live chunks and commands match a batch run');
  const gas = perfectGasGamma('N2', 0.028014, 1.4);
  const net = {
    nodes: [
      { id: 'bot', kind: 'volume', V: 0.01, p: 5e6, T: 300, Y: { N2: 1 } },
      { id: 'man', kind: 'volume', V: 2e-5, p: 1e5, T: 300, Y: { N2: 1 } },
      { id: 'amb', kind: 'ambient', p: 101325, T: 300, Y: { N2: 1 } },
    ],
    edges: [
      { id: 'SV-N2-01', type: 'valve', a: 'bot', b: 'man', CdAmax: 2e-6, tOpen: 0.05, tClose: 0.05, delay: 0.01 },
      { id: 'RO-N2-01', type: 'orifice', a: 'man', b: 'amb', CdA: 1e-6 },
    ],
  };
  const tOpen = 0.2;
  const tEnd = 1.0;
  const batch = simulate(net, { gas, tEnd, schedule: [{ t: tOpen, id: 'SV-N2-01', cmd: 'open' }], sampleDt: 0.1, rtol: 1e-10 });
  recordStats('driver batch', batch.stats);
  const live = createRun(net, { gas, sampleDt: 0.1, rtol: 1e-10, horizon: tEnd });
  const chunk = 1 / 60;
  let commanded = false;
  while (live.t < tEnd - 1e-12) {
    const tTo = Math.min(tEnd, live.t + chunk);
    if (!commanded && tTo >= tOpen) {
      live.advance(tOpen);
      live.command('SV-N2-01', 'open');
      commanded = true;
    }
    live.advance(tTo);
  }
  const res = live.finish();
  recordStats('driver live, 60 chunks/s', res.stats);
  approx(res.final.nodes.man.p, batch.final.nodes.man.p, 1e-7, 'manifold pressure after 1 s matches the batch run');
  approx(res.final.nodes.bot.m, batch.final.nodes.bot.m, 1e-9, 'bottle mass matches');
  ok(res.events.some((e) => e.id === 'SV-N2-01' && e.t === tOpen), 'the live command is logged at the time it was given');
  let threw = false;
  try {
    live.schedule([{ t: 0.5, id: 'SV-N2-01', cmd: 'close' }]);
  } catch {
    threw = true;
  }
  ok(threw, 'scheduling a command in the past is refused');
}
