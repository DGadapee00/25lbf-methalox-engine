/**
 * M4: the chamber model, the CEA and property tables, and the hot-fire stand, against independent
 * results: CEA's own off-grid points, CoolProp's (h, p) flash, JANAF formation enthalpies, the
 * isentropic tables, a linearized closed form (V-7), PROJECT_PLAN §2 recomputed through the CEA table
 * (V-8), and conservation (V-4 over a hot-fire run).
 */
import { approx, ok, section, recordStats } from './harness.js';
import { simulate } from '../simulate.js';
import { ceaLookup, CEA, vandenkerckhove } from '../cea.js';
import { jtOutletT, PROPS } from '../jt.js';
import { lhvCH4, flammabilityMargin, idealNozzle, divergenceFactor, stoichOF, unburned } from '../chamber.js';
import { nasa7Gas } from '../gas.js';
import { cvToCdA } from '../elements/orifice.js';
import { PSI, P_ATM, G0, R_U } from '../constants.js';
import { hotFire } from '../../data/stands/hotFire.js';
import { chamberFill } from '../../data/chamberFill.js';
import { components, injectorCdA } from '../../data/components.js';
import { tagProblems } from '../../data/tags.js';
import { HOT_FIRE_FIXTURE, HOT_FIRE_FIXTURE_END } from './fixtures.js';

const FIELDS = ['cstar', 'Tc', 'M', 'gamma', 'CFvac', 'PcOvPe'];

function ceaTable() {
  section('CEA table (data/cea_gox_gch4.json) against CEA itself');
  ok(CEA.source.includes('CEA') && CEA.generator && CEA.generated && CEA.commit, 'the table carries source, generator, generated and commit');
  ok(CEA.OF[0] <= 1.5 && CEA.OF[CEA.OF.length - 1] >= 4.5 && CEA.Pc_psia[0] <= 20 && CEA.Pc_psia[CEA.Pc_psia.length - 1] >= 400, 'the grid covers the brief\'s O/F 1.5–4.5 × P_c 20–400 psia');
  const d = CEA.design_point;
  const v = ceaLookup(d.OF, CEA.Pc[CEA.Pc_psia.indexOf(d.Pc_psia)]);
  ok(FIELDS.every((f) => Math.abs(v[f] / d[f] - 1) < 1e-12), 'on a grid point the lookup returns CEA\'s value exactly (PROJECT_PLAN §2.1 design point)');
  let worstNear = 0;
  let worstAll = 0;
  for (const c of CEA.checks) {
    const w = ceaLookup(c.OF, c.Pc_psia * PSI);
    const err = Math.max(...FIELDS.map((f) => Math.abs(w[f] / c[f] - 1)));
    worstAll = Math.max(worstAll, err);
    if (c.OF >= 2 && c.OF <= 3.5) worstNear = Math.max(worstNear, err);
  }
  ok(worstNear < 1e-3, `interpolation against off-grid CEA points, O/F 2–3.5: worst ${worstNear.toExponential(1)} < 1e-3`);
  ok(worstAll < 1e-2, `interpolation against every off-grid CEA point (O/F 1.55–18.5): worst ${worstAll.toExponential(1)} < 1e-2`);
  // An independent relation: for a perfect gas c* = √(R T_c / M)/Γ(γ). CEA's equilibrium c* is
  // computed from throat conditions instead, so the two agree only to a fraction of a percent.
  const cs = Math.sqrt((R_U / d.M) * d.Tc) / vandenkerckhove(d.gamma);
  approx(cs, d.cstar, 0.005, `c* = √(RT_c)/Γ(γ) = ${cs.toFixed(1)} m/s vs CEA ${d.cstar.toFixed(1)} m/s at the design point, 0.5%`);
  approx(d.cstar, 1886.6, 0.001, 'design-point c* is CEA\'s 6189.7 ft/s (design_point.txt), 0.1%');
}

function combustion() {
  section('Combustion constants against JANAF and published limits');
  // JANAF ΔH_f(298.15 K), kJ/mol: CO2 −393.522, H2O(g) −241.826, CH4 −74.873 (Chase 1998).
  const perMol = -74.873 - 2 * 0 + 393.522 + 2 * 241.826;
  const g = nasa7Gas(['CH4', 'O2']);
  approx(lhvCH4() * g.W[0], perMol * 1e3, 0.002, `LHV of CH₄ from the NASA-7 fits = ${(lhvCH4() / 1e6).toFixed(2)} MJ/kg; JANAF gives ${perMol.toFixed(1)} kJ/mol, 0.2%`);
  approx(stoichOF(nasa7Gas(['O2', 'CH4'])), 3.989, 0.001, 'stoichiometric O/F of CH₄ + 2 O₂ = 3.99');
  ok(flammabilityMargin(0.9, 0.1, 1) >= 0, '10 vol% CH₄ in O₂ is flammable');
  ok(flammabilityMargin(0.97, 0.03, 1) < 0 && flammabilityMargin(0.3, 0.7, 1) < 0, '3% and 70% CH₄ in O₂ are outside the 5.1–61% limits');
  ok(flammabilityMargin(0.1, 0.2, 1) < 0, '20% CH₄, 10% O₂, 70% N₂ is below the 12% limiting oxygen concentration');
  ok(flammabilityMargin(0, 0, 0) < 0, 'nothing at all is not flammable');
  const ub = unburned(nasa7Gas(['O2', 'CH4']), 0.004, 0.002);
  approx(ub.energy, lhvCH4() * 0.001003, 0.001, 'unburned energy: 4 g O₂ with 2 g CH₄ is O₂-limited, 1.00 g of CH₄ burns');

  section('Nozzle against the isentropic tables');
  // NACA Report 1135 (1953): A/A* = 3.000 at M = 2.637, p/p₀ = 0.0471, for γ = 1.4.
  const n = idealNozzle(1.4, 3);
  approx(n.Me, 2.637, 5e-4, `exit Mach at ε = 3, γ = 1.4: ${n.Me.toFixed(4)} (NACA 1135: 2.637)`);
  approx(1 / n.PcOvPe, 0.0471, 0.005, 'p_e/p₀ = 0.0471 (NACA 1135)');
  // Sutton & Biblarz, table 3-3: λ = 0.9830 for a 15° half-angle cone.
  approx(divergenceFactor((15 * Math.PI) / 180), 0.983, 5e-4, 'λ(15°) = 0.983 (Sutton & Biblarz table 3-3)');
}

function jt() {
  section('Regulator Joule–Thomson against CoolProp\'s (h, p) flash');
  let worst = 0;
  for (const c of PROPS.checks) {
    const T = jtOutletT([[c.gas, 1]], c.p_in, c.T_in, c.p_out);
    worst = Math.max(worst, Math.abs(T - c.T_out));
  }
  ok(worst < 0.25, `integrated μ_JT reproduces ${PROPS.checks.length} isenthalpic flashes (O₂, CH₄, N₂) to ${worst.toFixed(3)} K < 0.25 K`);
  const o2 = PROPS.checks.find((c) => c.gas === 'O2' && Math.abs(c.p_in - 2000 * PSI) < 1 && c.T_in === 293.15 && Math.abs(c.p_out - 480 * PSI) < 1);
  const ch4 = PROPS.checks.find((c) => c.gas === 'CH4' && Math.abs(c.p_in - 2000 * PSI) < 1 && c.T_in === 293.15 && Math.abs(c.p_out - 480 * PSI) < 1);
  ok(o2.T_out < 270 && ch4.T_out < 252, `2000 → 480 psia from 293 K: GOX leaves at ${o2.T_out.toFixed(1)} K, GCH₄ at ${ch4.T_out.toFixed(1)} K (CoolProp)`);

  // In a network: steady flow through a JT regulator into a manifold. Steady and adiabatic, the
  // manifold gas has the regulator's outlet enthalpy, so its temperature is the flash's.
  const c = components();
  const gas = nasa7Gas(['O2', 'CH4', 'N2']);
  const net = (jtOn) => ({
    nodes: [
      { id: 'sup', kind: 'ambient', p: 2000 * PSI, T: 293.15, Y: { O2: 1 } },
      { id: 'man', kind: 'volume', V: c.manifold.V, p: 480 * PSI, T: 293.15, Y: { O2: 1 } },
      { id: 'amb', kind: 'ambient', p: P_ATM, T: 293.15, Y: { N2: 1 } },
    ],
    edges: [
      { id: 'PCV-OX-01', type: 'regulator', a: 'sup', b: 'man', CdAmax: cvToCdA(c['PCV-OX-01'].Cv), pSet: c['PCV-OX-01'].pSet, mdotRated: c['PCV-OX-01'].mdotRated, droop: c['PCV-OX-01'].droop, tau: c['PCV-OX-01'].tau, z0: 0.2, jt: jtOn },
      { id: 'INJ-OX-01', type: 'orifice', a: 'man', b: 'amb', CdA: injectorCdA(c, 'INJ-OX-01') },
    ],
    checks: { reliefOnRegulatedNodes: false, reason: 'JT test fixture: a fixed supply, no failure case' },
  });
  const on = simulate(net(true), { gas, tEnd: 1.5, sampleDt: 0.05 });
  const off = simulate(net(false), { gas, tEnd: 1.5, sampleDt: 0.05 });
  recordStats('JT regulator, steady O2', on.stats);
  const man = on.final.nodes.man;
  ok(Math.abs(man.p - 480 * PSI) < 10 * PSI, `JT on: the manifold settles near p_set (${(man.p / PSI).toFixed(1)} psia)`);
  // The flash is at exactly 480 psia; within 10 psia of it, μ_JT (≈ 0.02 K/psi here) moves T < 0.2 K.
  const flash = o2.T_out;
  ok(Math.abs(man.T - flash) < 0.4, `JT on: manifold T ${man.T.toFixed(2)} K vs CoolProp flash ${o2.T_out.toFixed(2)} K, within 0.4 K`);
  approx(off.final.nodes.man.T, 293.15, 1e-4, 'JT off: isenthalpic ideal gas keeps 293.15 K');
  const mOn = on.final.edges['INJ-OX-01'].mdot;
  const mOff = off.final.edges['INJ-OX-01'].mdot;
  approx(mOn / mOff, Math.sqrt(293.15 / man.T) * (man.p / off.final.nodes.man.p), 0.003, `colder gas passes more mass through the choked injector: ×${(mOn / mOff).toFixed(4)} ≈ √(T_off/T_on)·(p_on/p_off)`);
}

function v7() {
  section('V-7 · chamber fill step response against τ_c (brief §4.4)');
  // Fixture η_c* = 0.80 keeps both injectors choked (at 0.92 the GOX circuit is not: V-8), so the
  // inflow does not feel P_c and the linearization is the chamber's alone.
  // The lines start full of N₂ and flush over 5–8 ms (line mass / flow), so the step waits for
  // 0.1 s, twelve of those, before it measures anything.
  const eta = 0.8;
  const tStep = 0.1;
  const f = chamberFill({ eta, step: 0.005, tStep });
  const r = simulate(f.net, { gas: f.gas, tEnd: tStep + 0.02, schedule: f.schedule, sampleDt: 1e-5 });
  recordStats('V-7 chamber fill small step', r.stats);
  const before = r.samples.filter((s) => s.t <= tStep - 1e-9).pop();
  const ch = before.chambers.chamber;
  ok(ch.burning && before.edges['INJ-OX-01'].choked && before.edges['INJ-FU-01'].choked, `before the step: burning, both injectors choked (GOX margin ${before.edges['INJ-OX-01'].margin.toFixed(3)})`);
  const p1 = ch.p;
  const p2 = r.final.chambers.chamber.p;
  const target = p1 + (1 - Math.exp(-1)) * (p2 - p1);
  const i = r.samples.findIndex((s) => s.t > tStep && s.chambers.chamber.p >= target);
  const a = r.samples[i - 1];
  const b = r.samples[i];
  const t63 = a.t + ((target - a.chambers.chamber.p) / (b.chambers.chamber.p - a.chambers.chamber.p)) * (b.t - a.t);
  const tauFit = t63 - tStep;
  // Closed form, brief §4.4: τ_c = L* c* / (R T_c) = L* / (c* Γ²), L* = V / A_t.
  const c = components();
  const At = c['THROAT-01'].Cd * (Math.PI / 4) * c['THROAT-01'].d ** 2;
  const Lstar = c.chamber.V / At;
  const t0 = ceaLookup(ch.OF, p1);
  const cs = eta * t0.cstar;
  const G = vandenkerckhove(t0.gamma);
  const tauC = Lstar / (cs * G * G);
  ok(tauC > 5e-4 && tauC < 3e-3, `τ_c = ${(tauC * 1e3).toFixed(3)} ms: on the order of 1 ms, as the brief expects`);
  approx(tauFit, tauC, 0.03, `63% rise after a 0.5% inflow step: ${(tauFit * 1e3).toFixed(3)} ms vs τ_c ${(tauC * 1e3).toFixed(3)} ms, 3%`);
  // The table's own P_c dependence, linearized: τ = τ_c (1 − a)/(1 − b), a = dln(RT)/dln p,
  // b = dln c*/dln p, from centred differences on the table at fixed O/F.
  const lnRT = (p) => {
    const t = ceaLookup(ch.OF, p);
    return Math.log((eta * t.cstar * vandenkerckhove(t.gamma)) ** 2);
  };
  const lnC = (p) => Math.log(ceaLookup(ch.OF, p).cstar);
  const dp = 0.002 * p1;
  const dl = Math.log((p1 + dp) / (p1 - dp));
  const A = (lnRT(p1 + dp) - lnRT(p1 - dp)) / dl;
  const B = (lnC(p1 + dp) - lnC(p1 - dp)) / dl;
  const tauLin = (tauC * (1 - A)) / (1 - B);
  approx(tauFit, tauLin, 0.005, `with the table's P_c dependence: ${(tauLin * 1e3).toFixed(3)} ms, 0.5%`);
}

function ignition() {
  section('Ignition, no-light and the unburned-propellant metric');
  const run = (opts, tEnd = 0.02) => {
    const f = chamberFill(opts);
    return simulate(f.net, { gas: f.gas, tEnd, schedule: f.schedule, sampleDt: 1e-3 });
  };
  const lit = run({});
  recordStats('chamber fill, igniter on', lit.stats);
  const ign = lit.events.find((e) => e.what === 'ignition');
  ok(!!ign && lit.final.chambers.chamber.burning, `igniter on: lights at ${(ign?.t * 1e3).toFixed(3)} ms and keeps burning`);
  ok(ign && ign.unburnedMass > 0 && ign.unburnedEnergy > 0 && ign.pAfter > ign.pBefore, `the ignition event records ${(ign.unburnedMass * 1e3).toFixed(3)} g unburned, ${ign.unburnedEnergy.toFixed(1)} J, and the pressure jump`);
  ok(ign.unburnedEnergy <= lhvCH4() * ign.unburnedMass, 'unburned energy never exceeds LHV × unburned mass');
  const dark = run({ igniter: 'no-light' });
  recordStats('chamber fill, no-light', dark.stats);
  ok(!dark.events.some((e) => e.what === 'ignition') && !dark.final.chambers.chamber.burning, 'no-light fault: no ignition');
  const u = dark.final.chambers.chamber;
  ok(u.unburnedMass > 0 && u.unburnedEnergy > 0, `no-light: ${(u.unburnedMass * 1e3).toFixed(2)} g of propellant (${(u.unburnedEnergy / 1e3).toFixed(2)} kJ) sits in the chamber`);
  ok(dark.final.chambers.chamber.p < 0.5 * lit.final.chambers.chamber.p, 'no-light: the chamber stays cold, well below the burning P_c');
  const off = run({ igniter: 'off' });
  ok(!off.events.some((e) => e.what === 'ignition'), 'igniter off: no ignition');
}

function v8andV4() {
  section('Hot-fire stand · build');
  const s = hotFire();
  ok(!tagProblems(s.net).length, `every element is S-2 tagged (${tagProblems(s.net).join('; ') || 'clean'})`);
  ok(s.sequence === null, 'no hot-fire sequence is invented: the stand runs in Operate');
  const r = simulate(s.net, { gas: s.gas, tEnd: HOT_FIRE_FIXTURE_END, schedule: HOT_FIRE_FIXTURE, sampleDt: 0.01 });
  recordStats('hot-fire fixture run', r.stats);

  section('V-4 · mass conservation over a hot-fire run (fixture timings)');
  const sys = r.sys;
  const y0 = sys.initialState();
  const m0 = sys.totals(y0).m;
  approx(sys.totals(r.y).m, m0, 1e-9, `Σ mass (nodes + ambient) = m₀ to 1e-9 through ignition, burn and shutdown (rel ${Math.abs(sys.totals(r.y).m / m0 - 1).toExponential(1)})`);
  const g = s.gas;
  const sum = (y, names) => sys.nodes.reduce((acc, n) => acc + names.reduce((a, name) => a + y[n.off + g.names.indexOf(name)], 0), 0);
  approx(sum(r.y, ['O2', 'PRODox']), sum(y0, ['O2', 'PRODox']), 1e-9, 'oxidizer-origin mass (O₂ + burned) conserved: combustion relabels, it does not create');
  approx(sum(r.y, ['CH4', 'PRODfu']), sum(y0, ['CH4', 'PRODfu']), 1e-9, 'fuel-origin mass (CH₄ + burned) conserved');
  approx(sum(r.y, ['N2']), sum(y0, ['N2']), 1e-9, 'N₂ conserved');
  const whats = r.events.map((e) => e.what);
  ok(whats.includes('ignition') && whats.includes('extinction'), 'the run ignites and goes out');
  ok(r.final.nodes.amb.mIn > 0.05, `${(r.final.nodes.amb.mIn * 1e3).toFixed(1)} g left through the throat and vents`);

  section('V-8 · steady state at the design point: PROJECT_PLAN §2 through the CEA table');
  const at = (t) => r.samples.find((x) => x.t >= t - 1e-9);
  const a = at(2.5);
  const b = at(2.9);
  const ca = a.chambers.chamber;
  const cb = b.chambers.chamber;
  ok(cb.burning && Math.abs(cb.p / ca.p - 1) < 1e-3, `steady: P_c moves ${(Math.abs(cb.p / ca.p - 1) * 100).toFixed(3)}% from 2.5 s to 2.9 s`);
  const mOx = b.edges['INJ-OX-01'].mdot;
  const mFu = b.edges['INJ-FU-01'].mdot;
  const mdot = mOx + mFu;
  approx(cb.mdot, mdot, 1e-3, 'throat flow equals injector flow at steady state');
  const c = components();
  const At = c['THROAT-01'].Cd * (Math.PI / 4) * c['THROAT-01'].d ** 2;
  const eta = c.chamber.etaCstar;
  const lam = divergenceFactor(c['THROAT-01'].halfAngle);
  const eps = c['THROAT-01'].eps;
  // Consistency with the table at the sim's own operating point, computed here by hand.
  const t = ceaLookup(cb.OF, cb.p);
  approx(cb.p, (mdot * eta * t.cstar) / At, 2e-3, 'P_c = ṁ η_c* c*_CEA / A_t at the sim\'s own O/F and P_c');
  const CF = lam * (t.CFvac - eps / t.PcOvPe) + eps * (1 / t.PcOvPe - P_ATM / cb.p);
  approx(cb.F, CF * cb.p * At, 2e-3, 'F = C_F P_c A_t with C_F from the table (λ on the momentum term)');
  // PROJECT_PLAN §2 recomputed through the table: its ṁ and O/F, its throat, its η_c*.
  const plan = { mdot: 0.0527, OF: 2.8, F: 111.2, Pc: 250 * PSI, Isp: 215 };
  let Pref = plan.Pc;
  for (let k = 0; k < 50; k++) Pref = (plan.mdot * eta * ceaLookup(plan.OF, Pref).cstar) / At;
  const tr = ceaLookup(plan.OF, Pref);
  const Fref = (lam * (tr.CFvac - eps / tr.PcOvPe) + eps * (1 / tr.PcOvPe - P_ATM / Pref)) * Pref * At;
  const ref = { mdot: plan.mdot, OF: plan.OF, Pc: Pref, F: Fref, Isp: Fref / (plan.mdot * G0) };
  const sim = { mdot, OF: mOx / mFu, Pc: cb.p, F: cb.F, Isp: cb.Isp };
  const ALLOW = 0.03;
  const unit = { mdot: [1e3, 'g/s'], OF: [1, ''], Pc: [1 / PSI, 'psia'], F: [1, 'N'], Isp: [1, 's'] };
  for (const k of ['mdot', 'OF', 'Pc', 'F', 'Isp']) {
    const [f, u] = unit[k];
    const dev = sim[k] / ref[k] - 1;
    const planDev = sim[k] / plan[k] - 1;
    const refDev = ref[k] / plan[k] - 1;
    ok(Math.abs(dev) <= ALLOW, `${k}: sim ${(sim[k] * f).toFixed(2)} ${u}, CEA-recomputed plan ${(ref[k] * f).toFixed(2)}, plan ${(plan[k] * f).toFixed(2)}; sim vs CEA plan ${(dev * 100).toFixed(1)}% (≤ 3%), sim vs plan ${(planDev * 100).toFixed(1)}% of which the CEA table accounts for ${(refDev * 100).toFixed(1)}%`);
  }
  const ox = b.edges['INJ-OX-01'];
  ok(!ox.choked, `finding, not a failure: at this P_c the GOX injector is not choked (p₀/p = ${ox.margin.toFixed(3)}); S-3 is open`);
}

export function run() {
  ceaTable();
  combustion();
  jt();
  v7();
  ignition();
  v8andV4();
}
