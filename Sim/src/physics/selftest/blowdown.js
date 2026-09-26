/**
 * V-1, V-2: a bottle blowing down through a choked orifice, against the closed forms. Both use a
 * calorically perfect gas, because that is what the closed forms assume; the NASA-7 run after them
 * shows how far real c_p(T) moves the adiabatic answer (not a pass/fail against the closed form).
 */
import { approx, ok, section, recordStats } from './harness.js';
import { simulate } from '../simulate.js';
import { perfectGasGamma, nasa7Gas } from '../gas.js';
import { lambda } from '../elements/orifice.js';

const W_N2 = 0.028014;
const V = 0.01; // m³ (test fixture)
const CdA = 1e-6; // m²
const T0 = 300; // K
const P0 = 1e7; // Pa
const P_AMB = 101325;

function tank(thermal) {
  return {
    nodes: [
      { id: 'tank', kind: 'volume', V, p: P0, T: T0, Y: { N2: 1 }, thermal },
      { id: 'amb', kind: 'ambient', p: P_AMB, T: T0, Y: { N2: 1 } },
    ],
    edges: [{ id: 'o', type: 'orifice', a: 'tank', b: 'amb', CdA }],
  };
}

export function run() {
  const g = 1.4;
  const gas = perfectGasGamma('N2', W_N2, g);
  const R = gas.R[0];
  const tau = V / (CdA * lambda(g) * Math.sqrt(g * R * T0));

  section('V-1 · isothermal blowdown, p/p₀ = exp(−t/τ)');
  // To 3τ: p falls to 5% of p₀ = 5 bar, still choked (critical back pressure 1.9 bar).
  const r1 = simulate(tank('isothermal'), { gas, tEnd: 3 * tau, sampleDt: tau / 20, rtol: 1e-10 });
  recordStats('V-1 isothermal blowdown', r1.stats);
  let w1 = 0;
  r1.t.forEach((t, i) => (w1 = Math.max(w1, Math.abs(r1.samples[i].nodes.tank.p / (P0 * Math.exp(-t / tau)) - 1))));
  ok(w1 < 1e-8, `matches closed form over 0–3τ (τ = ${tau.toFixed(2)} s), worst rel ${w1.toExponential(1)} < 1e-8`);
  ok(r1.samples.every((s) => s.edges.o.choked), 'orifice choked throughout');

  section('V-2 · adiabatic blowdown, p/p₀ = (1 + (γ−1)t/(2τ₀))^(−2γ/(γ−1))');
  const r2 = simulate(tank('adiabatic'), { gas, tEnd: 3 * tau, sampleDt: tau / 20, rtol: 1e-10 });
  recordStats('V-2 adiabatic blowdown', r2.stats);
  let w2 = 0;
  let wT = 0;
  r2.t.forEach((t, i) => {
    const pr = Math.pow(1 + ((g - 1) / 2) * (t / tau), (-2 * g) / (g - 1));
    const s = r2.samples[i].nodes.tank;
    w2 = Math.max(w2, Math.abs(s.p / (P0 * pr) - 1));
    wT = Math.max(wT, Math.abs(s.T / (T0 * Math.pow(pr, (g - 1) / g)) - 1));
  });
  ok(w2 < 1e-8, `p matches closed form over 0–3τ₀, worst rel ${w2.toExponential(1)} < 1e-8`);
  ok(wT < 1e-8, `T follows the isentrope T/T₀ = (p/p₀)^((γ−1)/γ), worst rel ${wT.toExponential(1)}`);

  section('Adiabatic blowdown with NASA-7 N₂ (information, not a pass/fail against the closed form)');
  const r3 = simulate(tank('adiabatic'), { gas: nasa7Gas(['N2']), tEnd: tau, sampleDt: tau / 10, rtol: 1e-10 });
  recordStats('adiabatic blowdown, NASA-7 N2', r3.stats);
  const pr = Math.pow(1 + ((g - 1) / 2), (-2 * g) / (g - 1));
  const dev = r3.final.nodes.tank.p / (P0 * pr) - 1;
  console.log(`        at t = τ₀: p is ${(dev * 100).toFixed(2)}% from the γ = 1.4 closed form, T = ${r3.final.nodes.tank.T.toFixed(1)} K`);
  ok(Math.abs(dev) < 0.02, 'real c_p(T) moves p by < 2% at t = τ₀ (N₂ is close to γ = 1.4 here)');
}
