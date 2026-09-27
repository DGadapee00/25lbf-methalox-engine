/**
 * Flow network: the feed system as a nonlinear, time-dependent version of FLUX's Circuits lab
 * (brief §4.1). Nodes are control volumes (the capacitors); edges are flow elements with no volume
 * (the resistors); mass balance at a node is KCL.
 *
 * A network is pure data, like FLUX's data/circuits.js, so the scene and the self-test read the
 * same netlist:
 *
 *   nodes: [{ id, kind: 'volume' | 'ambient' | 'chamber', V (m³), p (Pa), T (K), Y: { species: fraction },
 *             thermal: 'adiabatic' (default) | 'isothermal' | { hA (W/K), Tw (K) }, tag? }]
 *     volume   state (m_i per species, U): p and T are derived. p, T, Y are the initial fill.
 *     ambient  a fixed reservoir (atmosphere, or an idealized infinite supply). It accumulates
 *              what flows into it, so conservation can be checked across the whole network.
 *     chamber  a volume with a combustion flag (physics/chamber.js). Extra parameters:
 *              eta (η_c*), nozzle: { throat (edge id), eps, lambda }. The gas must carry O2, CH4
 *              and the burned-gas species PRODox, PRODfu (gas.js).
 *
 *   igniters: optional [{ id, chamber, on0 }]. Commands 'on' | 'off' | { fault: 'no-light' | null }.
 *     An igniter is not a flow element; it arms the chamber's ignition event.
 *
 *   edges: [{ id, type, a, b, tag?, ...params }], positive flow a → b. Types and parameters:
 *     orifice    CdA (m²)
 *     valve      CdAmax (m²), tOpen, tClose (s), delay (s, default 0), x0 (0..1), curve
 *     check      CdA (m²), crack, reseat (Pa, Δp = p_a − p_b), leakCdA (m², default 0), open0
 *     relief     CdA (m², full lift), set (Pa, Δp = p_a − p_b), accumulation, blowdown (fractions
 *                of set), tauLift (s), L0; proportional lift, see elements/relief.js
 *     regulator  pSet (Pa, flowing outlet pressure at rated flow), mdotRated (kg/s), droop or
 *                pLockup (Pa), CdAmax (m²), tau (s), spe, pSupplyRef (Pa), z0, fault
 *                a = supply side, b = outlet (the pressure it regulates); see elements/regulator.js.
 *                jt (default false): deliver the gas at its Joule–Thomson outlet temperature
 *                (physics/jt.js) instead of isenthalpic ideal gas. The energy that takes leaves
 *                the ideal-gas sum; it is the real-gas correction, so V-5 runs with it off.
 *
 *   checks: optional. Every regulated node must carry relief capacity for its regulator failing
 *     open (checkReliefs below); a network may opt out only with
 *     `checks: { reliefOnRegulatedNodes: false, reason: '…' }`, and the reason is required.
 *
 * The state vector y (Float64Array) is laid out node by node: for a volume or ambient node,
 * [m_1 … m_ns, U] (kg, J); then one poppet opening z per regulator and one lift L per relief.
 * Discrete state — valve motion, check-valve open flags, faults — lives in `sys.disc` and changes
 * only at events.
 *
 * Every edge flow is subtracted from one node and added to another with the same species split
 * and the same enthalpy, and ambient nodes accumulate their inflow, so Σ mass and Σ energy are
 * linear invariants of the ODE. Runge–Kutta methods preserve linear invariants exactly, so V-4 and
 * V-5 hold to round-off: they test that the bookkeeping has no leaks, which is their point.
 */
import { massFractions, massesFromPTY, stateFromMasses, stateFromPTY } from './gas.js';
import { orificeFlow, regFlux } from './elements/orifice.js';
import { valveInit, valvePosition, valveCommand, valvePhi } from './elements/valve.js';
import { regulatorDerive, regulatorCmd, regulatorCdA } from './elements/regulator.js';
import { reliefCurves, reliefTarget, reliefValidate, ACCUMULATION_DEFAULT } from './elements/relief.js';
import { mixH, mixR, mixU } from './gas.js';
import { burningState, flammabilityMargin, molesOf, unburned, thrust } from './chamber.js';
import { jtOutletT, jtWeights } from './jt.js';
import { G0 } from './constants.js';

const TYPES = new Set(['orifice', 'valve', 'check', 'relief', 'regulator']);

export function compileNetwork(net, gas) {
  const ns = gas.n;
  const nodes = net.nodes.map((n) => ({ ...n, Yv: massFractions(gas, n.Y) }));
  const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));
  if (nodeIdx.size !== nodes.length) throw new Error('compileNetwork: duplicate node id');
  let off = 0;
  const ix = { O2: gas.names.indexOf('O2'), CH4: gas.names.indexOf('CH4'), PRODox: gas.names.indexOf('PRODox'), PRODfu: gas.names.indexOf('PRODfu') };
  for (const n of nodes) {
    if (n.kind !== 'volume' && n.kind !== 'ambient' && n.kind !== 'chamber') throw new Error(`node ${n.id}: kind must be volume, ambient or chamber`);
    if (n.kind !== 'ambient' && !(n.V > 0)) throw new Error(`node ${n.id}: V must be > 0 m³`);
    if (n.kind === 'chamber') {
      if (Object.values(ix).some((i) => i < 0)) throw new Error(`chamber ${n.id}: the gas needs O2, CH4, PRODox and PRODfu`);
      if (!(n.eta > 0 && n.eta <= 1.2)) throw new Error(`chamber ${n.id}: eta (η_c*) must be in (0, 1.2]`);
    }
    n.off = off;
    off += ns + 1;
    n.Tlast = n.T;
  }
  const edges = net.edges.map((e) => {
    if (!TYPES.has(e.type)) throw new Error(`edge ${e.id}: unknown type ${e.type}`);
    for (const k of ['a', 'b']) if (!nodeIdx.has(e[k])) throw new Error(`edge ${e.id}: unknown node ${e[k]}`);
    return { ...e, ia: nodeIdx.get(e.a), ib: nodeIdx.get(e.b) };
  });
  for (const e of edges) {
    // Hysteresis must be positive or the device chatters without end.
    if (e.type === 'check' && !(e.crack > e.reseat)) throw new Error(`check ${e.id}: crack must exceed reseat`);
    if (e.type === 'relief') {
      reliefValidate(e);
      e.curves = reliefCurves(e);
    }
  }
  const edgeIdx = new Map(edges.map((e, i) => [e.id, i]));
  if (edgeIdx.size !== edges.length) throw new Error('compileNetwork: duplicate edge id');
  for (const e of edges) {
    if (e.type === 'regulator') {
      e.off = off;
      off += 1;
      e.derived = regulatorDerive(e, initialNodeState(nodes[e.ia]));
    }
    if (e.type === 'relief') {
      e.off = off;
      off += 1;
    }
  }
  const nState = off;
  checkReliefs(net, nodes, edges, initialNodeState);

  // Discrete state, one entry per edge.
  const disc = edges.map((e) => {
    if (e.type === 'valve') return valveInit(e);
    if (e.type === 'check') return { open: !!e.open0 };
    if (e.type === 'regulator') return { fault: e.fault ?? null, pLockup: e.derived.pLockup, jt: !!e.jt };
    return {};
  });

  // Chambers, and the igniters that arm them. Burning is discrete state: it changes only at events.
  const chambers = nodes.map((n, k) => [n, k]).filter(([n]) => n.kind === 'chamber').map(([n, k]) => {
    const throat = n.nozzle?.throat ? edgeIdx.get(n.nozzle.throat) : undefined;
    if (n.nozzle?.throat && throat === undefined) throw new Error(`chamber ${n.id}: unknown throat edge ${n.nozzle.throat}`);
    return { n, k, throat, burning: false, pLast: n.p, ignitions: [], inflow: -1 };
  });
  const igniters = (net.igniters || []).map((g) => {
    const c = chambers.find((ch) => ch.n.id === g.chamber);
    if (!c) throw new Error(`igniter ${g.id}: ${g.chamber} is not a chamber node`);
    if (edgeIdx.has(g.id)) throw new Error(`igniter ${g.id}: an edge already has that id`);
    return { id: g.id, c, on: !!g.on0, fault: null };
  });
  const igniterOf = (c) => igniters.find((g) => g.c === c);
  const armed = (c) => {
    const g = igniterOf(c);
    return !c.burning && !!g && g.on && g.fault !== 'no-light';
  };

  /** A node's state as filled, before any flow: { p, T, gamma, R, … }. */
  function initialNodeState(n) {
    return stateFromPTY(gas, n.p, n.T, n.Yv);
  }

  /** Initial state vector. */
  function initialState() {
    const y = new Float64Array(nState);
    for (const n of nodes) {
      if (n.kind !== 'ambient') {
        const { m, U } = massesFromPTY(gas, n.p, n.T, n.Yv, n.V);
        y.set(m, n.off);
        y[n.off + ns] = U;
      }
      // ambient accumulators start at zero
    }
    for (const e of edges) if (e.type === 'regulator') y[e.off] = e.z0 ?? 0;
    for (const e of edges) if (e.type === 'relief') y[e.off] = e.L0 ?? 0;
    return y;
  }

  /** Thermodynamic state of every node for state vector y. */
  const states = new Array(nodes.length);
  const chamberAt = new Map(chambers.map((c) => [c.k, c]));
  function nodeStates(y) {
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      const ch = chamberAt.get(k);
      if (ch && ch.burning) {
        const s = burningState(gas, ix, y.subarray(n.off, n.off + ns), n.V, n.eta, ch.pLast);
        ch.pLast = s.p;
        states[k] = s;
      } else if (n.kind === 'ambient') {
        states[k] = n.fixed || (n.fixed = stateFromPTY(gas, n.p, n.T, n.Yv));
      } else if (n.thermal === 'isothermal') {
        let m = 0;
        const Y = new Float64Array(ns);
        for (let i = 0; i < ns; i++) m += y[n.off + i];
        for (let i = 0; i < ns; i++) Y[i] = m > 0 ? Math.max(0, y[n.off + i]) / m : n.Yv[i];
        const s = stateFromPTY(gas, 0, n.T, Y, m);
        s.p = (m * s.R * n.T) / n.V;
        states[k] = s;
      } else {
        const s = stateFromMasses(gas, y.subarray(n.off, n.off + ns), y[n.off + ns], n.V, n.Tlast);
        n.Tlast = s.T;
        states[k] = s;
      }
    }
    return states;
  }

  /** Effective C_dA (m²) of edge e at time t. */
  function edgeCdA(e, d, t, y, sa, sb) {
    switch (e.type) {
      case 'orifice':
        return e.CdA;
      case 'valve':
        return e.CdAmax * valvePhi(e, valvePosition(d, t));
      case 'check':
        return d.open ? e.CdA : e.leakCdA ?? 0;
      case 'relief':
        return Math.max(0, Math.min(1, y[e.off])) * e.CdA + (e.leakCdA ?? 0);
      case 'regulator':
        return regulatorCdA(e, y[e.off], d.fault);
    }
    return 0;
  }

  /**
   * Flow through every edge at (t, y), given node states. Writes into `flows` (one record per
   * edge): { mdot (kg/s, a→b), fromA, choked, margin, CdA }.
   */
  const flows = edges.map(() => ({ mdot: 0, fromA: true, choked: false, margin: 1, CdA: 0 }));
  function edgeFlows(t, y, st) {
    for (let j = 0; j < edges.length; j++) {
      const e = edges[j];
      const sa = st[e.ia];
      const sb = st[e.ib];
      const CdA = edgeCdA(e, disc[j], t, y, sa, sb);
      const f = orificeFlow(CdA, sa, sb);
      const r = flows[j];
      r.mdot = f.mdot;
      r.fromA = f.fromA;
      r.choked = f.choked;
      r.margin = f.margin;
      r.CdA = CdA;
    }
    return flows;
  }

  /**
   * Specific enthalpy (J/kg) a JT-enabled regulator j delivers: the upstream gas at its isenthalpic
   * real-gas outlet temperature, evaluated with the ideal-gas h(T). Also records T_out on the flow.
   */
  function jtEnthalpy(j, up, pOut) {
    const Tout = jtOutletT(jtWeights(gas, up.Y), up.p, up.T, pOut);
    flows[j].Tout = Tout;
    return mixH(gas, up.Y, Tout);
  }

  /** dy/dt at (t, y), into dy. */
  function rhs(t, y, dy) {
    dy.fill(0);
    const st = nodeStates(y);
    edgeFlows(t, y, st);
    for (let j = 0; j < edges.length; j++) {
      const e = edges[j];
      const m = flows[j].mdot;
      if (m === 0) continue;
      const up = flows[j].fromA ? st[e.ia] : st[e.ib];
      const oa = nodes[e.ia].off;
      const ob = nodes[e.ib].off;
      for (let i = 0; i < ns; i++) {
        const mi = m * up.Y[i];
        dy[oa + i] -= mi;
        dy[ob + i] += mi;
      }
      const H = m * up.h;
      dy[oa + ns] -= H;
      dy[ob + ns] += e.type === 'regulator' && disc[j].jt && m > 0 ? m * jtEnthalpy(j, up, st[e.ib].p) : H;
    }
    // A burning chamber converts the propellant it receives as it arrives, and its state comes from
    // the CEA table, not from U (which is set again at extinction).
    for (const c of chambers) {
      if (!c.burning) continue;
      const o = c.n.off;
      dy[o + ix.PRODox] += dy[o + ix.O2];
      dy[o + ix.PRODfu] += dy[o + ix.CH4];
      dy[o + ix.O2] = 0;
      dy[o + ix.CH4] = 0;
      dy[o + ns] = 0;
    }
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.kind !== 'volume') continue;
      if (n.thermal === 'isothermal') {
        // T is held: whatever heat that takes is supplied. U follows the species masses at T.
        if (!n.uT) n.uT = gas.names.map((_, i) => gas.h(i, n.T) - gas.R[i] * n.T);
        let dU = 0;
        for (let i = 0; i < ns; i++) dU += dy[n.off + i] * n.uT[i];
        dy[n.off + ns] = dU;
      } else if (n.thermal && typeof n.thermal === 'object') {
        dy[n.off + ns] += n.thermal.hA * (n.thermal.Tw - st[k].T);
      }
    }
    for (const e of edges) {
      if (e.type !== 'regulator') continue;
      const d = disc[edgeIdx.get(e.id)];
      const zc = regulatorCmd(e, e.derived, d.pLockup, st[e.ib].p, st[e.ia].p);
      dy[e.off] = (zc - y[e.off]) / e.tau;
    }
    for (const e of edges) {
      if (e.type !== 'relief') continue;
      const L = y[e.off];
      dy[e.off] = (reliefTarget(e, e.curves, L, st[e.ia].p - st[e.ib].p) - L) / e.tauLift;
    }
  }

  /**
   * State-event functions: one per check-valve edge. g < 0 while the current mode holds; the
   * driver switches mode when g crosses to ≥ 0 and locates the crossing on the dense output.
   */
  const eventEdges = edges.map((e, j) => j).filter((j) => edges[j].type === 'check');
  const nCheckEvents = eventEdges.length;

  /** Flammability margin of chamber c's gas (≥ 0 flammable), from masses in y. */
  function contentsMargin(c, y) {
    const { n, total } = molesOf(gas, y.subarray(c.n.off, c.n.off + ns));
    return flammabilityMargin(n[ix.O2], n[ix.CH4], total);
  }
  /** Flammability margin of the propellant flowing into chamber c now (flows must be current). */
  function inflowMargin(c) {
    let nO2 = 0;
    let nCH4 = 0;
    let nAll = 0;
    for (let j = 0; j < edges.length; j++) {
      const e = edges[j];
      const m = flows[j].mdot;
      const into = (e.ib === c.k && m > 0) || (e.ia === c.k && m < 0);
      if (!into) continue;
      const up = states[e.ib === c.k ? e.ia : e.ib];
      const a = Math.abs(m);
      for (let i = 0; i < ns; i++) {
        const moles = (a * up.Y[i]) / gas.W[i];
        nAll += moles;
        if (i === ix.O2) nO2 += moles;
        if (i === ix.CH4) nCH4 += moles;
      }
    }
    return flammabilityMargin(nO2, nCH4, nAll);
  }

  /**
   * State-event functions. g < 0 while the current mode holds; the driver switches mode when g
   * crosses to ≥ 0 and locates the crossing on the dense output. One per check valve (crack or
   * reseat), then two per chamber: ignition (armed chamber, flammable gas) and extinction (burning
   * chamber, inflow no longer flammable).
   */
  function events(t, y, out) {
    const st = nodeStates(y);
    eventEdges.forEach((j, k) => {
      const e = edges[j];
      const dp = st[e.ia].p - st[e.ib].p;
      const open = disc[j].open;
      out[k] = open ? e.reseat - dp : dp - e.crack;
    });
    if (chambers.length) edgeFlows(t, y, st);
    chambers.forEach((c, i) => {
      out[nCheckEvents + 2 * i] = armed(c) ? contentsMargin(c, y) : -1;
      out[nCheckEvents + 2 * i + 1] = c.burning ? -inflowMargin(c) : -1;
    });
    return out;
  }

  /** Ignite chamber c at t: everything unburned burns at once. Mutates y. */
  function ignite(c, t, y) {
    const o = c.n.off;
    const ub = unburned(gas, y[o + ix.O2], y[o + ix.CH4]);
    const pCold = nodeStates(y)[c.k].p;
    y[o + ix.PRODox] += y[o + ix.O2];
    y[o + ix.PRODfu] += y[o + ix.CH4];
    y[o + ix.O2] = 0;
    y[o + ix.CH4] = 0;
    c.burning = true;
    c.pLast = pCold * 8;
    const pHot = nodeStates(y)[c.k].p;
    const ev = { t, id: c.n.id, what: 'ignition', unburnedMass: ub.mass, unburnedEnergy: ub.energy, pBefore: pCold, pAfter: pHot };
    c.ignitions.push(ev);
    return ev;
  }

  /** Put chamber c out at t: back to the ideal-gas node, same pressure. Mutates y. */
  function extinguish(c, t, y) {
    const o = c.n.off;
    const p = nodeStates(y)[c.k].p;
    const m = y.subarray(o, o + ns);
    let mass = 0;
    for (let i = 0; i < ns; i++) mass += Math.max(0, m[i]);
    const Y = Float64Array.from(m, (v) => (mass > 0 ? Math.max(0, v) / mass : 0));
    const T = mass > 0 ? (p * c.n.V) / (mass * mixR(gas, Y)) : c.n.T;
    y[o + ns] = mass * mixU(gas, Y, T);
    c.burning = false;
    c.n.Tlast = T;
    return { t, id: c.n.id, what: 'extinction', p };
  }

  /** Fire state event k at t with state y (which it may change). Returns the event record(s). */
  function fireEvent(k, t, y) {
    if (k < nCheckEvents) {
      const j = eventEdges[k];
      disc[j].open = !disc[j].open;
      return { t, id: edges[j].id, what: disc[j].open ? 'open' : 'close' };
    }
    const c = chambers[(k - nCheckEvents) >> 1];
    return (k - nCheckEvents) % 2 === 0 ? ignite(c, t, y) : extinguish(c, t, y);
  }

  /**
   * Chamber modes that should already have switched but had no crossing to find: the igniter
   * switched on into a flammable chamber, or a chamber lit into an inflow that cannot sustain it
   * (a flash). The driver calls this after commands and events. Returns the events it fired.
   */
  function reconcile(t, y) {
    const fired = [];
    for (const c of chambers) {
      if (armed(c) && contentsMargin(c, y) >= 0) fired.push(ignite(c, t, y));
      if (c.burning) {
        const st = nodeStates(y);
        edgeFlows(t, y, st);
        if (inflowMargin(c) < 0) fired.push(extinguish(c, t, y));
      }
    }
    return fired;
  }

  /**
   * Kink functions: where the right-hand side changes branch without any state changing. The
   * driver ends a step exactly where one changes sign and restarts the integrator there, as it
   * does at a breakpoint, so no step linearizes across a kink (a Rosenbrock step would, with a
   * Jacobian from the wrong side). Per relief: Δp at set, full lift and reseat, and lift meeting
   * the rising or the falling curve. Per regulator: the command reaching 0 or 1.
   */
  const reliefEdges = edges.filter((e) => e.type === 'relief');
  const regEdges = edges.filter((e) => e.type === 'regulator');
  const nKinks = 5 * reliefEdges.length + 2 * regEdges.length;
  function kinks(t, y, out) {
    const st = nodeStates(y);
    let k = 0;
    for (const e of reliefEdges) {
      const dp = st[e.ia].p - st[e.ib].p;
      const c = e.curves;
      const L = y[e.off];
      const up = Math.max(0, Math.min(1, (dp - e.set) / (c.acc * e.set)));
      const dn = Math.max(0, Math.min(1, (dp - c.pReseat) / (c.pFull - c.pReseat)));
      out[k++] = (dp - e.set) / e.set;
      out[k++] = (dp - c.pFull) / e.set;
      out[k++] = (dp - c.pReseat) / e.set;
      out[k++] = up - L;
      out[k++] = L - dn;
    }
    for (const e of regEdges) {
      const d = disc[edgeIdx.get(e.id)];
      const pL = d.pLockup + (e.spe ?? 0) * (e.derived.pSupplyRef - st[e.ia].p);
      const raw = e.derived.K * (pL - st[e.ib].p);
      out[k++] = raw;
      out[k++] = raw - 1;
    }
    return out;
  }

  /**
   * A scheduled command: valves take 'open' | 'close' | position; regulators take
   * { pSet } or { fault }. Returns the breakpoints (s) it introduces.
   */
  function command(t, id, cmd) {
    const g = igniters.find((x) => x.id === id);
    if (g) {
      if (cmd === 'on' || cmd === 'off') g.on = cmd === 'on';
      else if (cmd && 'fault' in cmd) g.fault = cmd.fault;
      else throw new Error(`command: igniter ${id} takes 'on', 'off' or { fault }`);
      return [t];
    }
    const j = edgeIdx.get(id);
    if (j === undefined) throw new Error(`command: unknown edge ${id}`);
    const e = edges[j];
    if (e.type === 'valve') return valveCommand(e, disc[j], t, cmd);
    if (e.type === 'regulator') {
      // A new set point moves lockup with it; the droop (and so K) is a property of the regulator.
      if (cmd && 'pSet' in cmd) disc[j].pLockup = cmd.pSet + e.derived.droop;
      if (cmd && 'fault' in cmd) disc[j].fault = cmd.fault;
      if (cmd && 'jt' in cmd) disc[j].jt = !!cmd.jt;
      return [t];
    }
    throw new Error(`command: edge ${id} (${e.type}) takes no commands`);
  }

  /** Readouts for sampling and display: per node { p, T, m, Y }, per edge { mdot, choked, … }. */
  function readout(t, y) {
    const st = nodeStates(y);
    edgeFlows(t, y, st);
    const out = { t, nodes: {}, edges: {} };
    nodes.forEach((n, k) => {
      const m = y.subarray(n.off, n.off + ns).reduce((a, b) => a + b, 0);
      out.nodes[n.id] = n.kind === 'ambient' ? { p: n.p, T: n.T, mIn: m, Ein: y[n.off + ns] } : { p: st[k].p, T: st[k].T, m, Y: Array.from(st[k].Y) };
    });
    edges.forEach((e, j) => {
      const r = { ...flows[j] };
      if (e.type === 'valve') r.x = valvePosition(disc[j], t);
      if (e.type === 'check') r.open = disc[j].open;
      if (e.type === 'relief') {
        r.lift = Math.max(0, Math.min(1, y[e.off]));
        r.open = r.lift > 0;
      }
      if (e.type === 'regulator') {
        r.z = y[e.off];
        r.pLockup = disc[j].pLockup;
        r.pSet = disc[j].pLockup - e.derived.droop;
        r.jt = disc[j].jt;
        const up = st[r.fromA ? e.ia : e.ib];
        r.Tout = disc[j].jt && r.mdot > 0 ? jtOutletT(jtWeights(gas, up.Y), up.p, up.T, st[e.ib].p) : up.T;
      }
      out.edges[e.id] = r;
    });
    if (chambers.length) out.chambers = {};
    for (const c of chambers) {
      const s = st[c.k];
      const o = c.n.off;
      const ub = unburned(gas, y[o + ix.O2], y[o + ix.CH4]);
      const rec = { burning: c.burning, p: s.p, T: s.T, unburnedMass: ub.mass, unburnedEnergy: ub.energy, ignitions: c.ignitions.length, lastIgnition: c.ignitions[c.ignitions.length - 1] || null, igniter: igniterOf(c) ? { on: igniterOf(c).on, fault: igniterOf(c).fault } : null, F: 0, CF: 0, Isp: 0, mdot: 0 };
      if (c.burning) Object.assign(rec, { OF: s.OF, cstar: s.cstar, cstarIdeal: s.cstarIdeal, Tc: s.Tc, clamped: s.clamped });
      if (c.throat !== undefined) {
        const e = edges[c.throat];
        const f = flows[c.throat];
        const pa = st[e.ib].p;
        const tq = thrust(s, f.mdot, f.CdA, c.n.nozzle.eps, c.n.nozzle.lambda, pa, f.choked);
        rec.F = tq.F;
        rec.CF = tq.CF;
        rec.mdot = f.mdot;
        rec.Isp = f.mdot > 0 ? tq.F / (f.mdot * G0) : 0;
      }
      out.chambers[c.n.id] = rec;
    }
    return out;
  }

  /** Per-component absolute tolerance scale: the mass a node would hold at the network's top pressure. */
  function scales() {
    const pMax = Math.max(...nodes.map((n) => n.p));
    const sc = new Float64Array(nState).fill(1);
    let mBig = 0;
    for (const n of nodes) {
      if (n.kind === 'ambient') continue;
      const { m, U } = massesFromPTY(gas, pMax, n.T, n.Yv, n.V);
      const mRef = m.reduce((a, b) => a + b, 0);
      mBig = Math.max(mBig, mRef);
      for (let i = 0; i < ns; i++) sc[n.off + i] = mRef;
      sc[n.off + ns] = Math.max(Math.abs(U), mRef * 3e5);
    }
    for (const n of nodes) {
      if (n.kind !== 'ambient') continue;
      for (let i = 0; i < ns; i++) sc[n.off + i] = mBig;
      sc[n.off + ns] = mBig * 3e5;
    }
    return sc;
  }

  /** Σ mass (kg) and Σ energy (J) over the whole network, ambient accumulators included. */
  function totals(y) {
    let m = 0;
    let E = 0;
    for (const n of nodes) {
      for (let i = 0; i < ns; i++) m += y[n.off + i];
      E += y[n.off + ns];
    }
    return { m, E };
  }

  const valveRamps = edges.filter((e) => e.type === 'valve').flatMap((e) => [e.tOpen, e.tClose]).filter((x) => x > 0);

  return {
    gas, nodes, edges, disc, nState, nEvents: eventEdges.length + 2 * chambers.length, nCheckEvents, nKinks, chambers, igniters,
    initialState, rhs, events, fireEvent, reconcile, kinks, command, readout, scales, totals, nodeStates,
    fastestRamp: valveRamps.length ? Math.min(...valveRamps) : Infinity,
  };
}

/**
 * Relief sizing, checked whenever a network is built. For every regulator, the relief valves on
 * its outlet node must together pass the regulator's fails-open flow — C_dA_max from the supply
 * as filled (its highest pressure: the larger of the supply node's starting pressure and the
 * regulator's pSupplyRef) — at full lift, which each relief reaches at set +
 * accumulation (elements/relief.js). So a failed-open regulator cannot push the manifold past
 * set + accumulation. It assumes everything downstream is shut (a closed main valve is exactly
 * when a dead-headed manifold is most exposed). Gas properties are the supply's as
 * filled, at supply temperature. With Joule–Thomson cooling on, the manifold gas is colder and a
 * relief passes more mass per unit C_dA (ṁ ∝ 1/√T) while the regulator's fails-open flow, set by
 * the supply, does not change: the rule without JT is the conservative one.
 *
 * Returns the per-regulator results; throws, naming the regulator and the C_dA it would need,
 * unless the network opts out with a stated reason.
 */
export function checkReliefs(net, nodes, edges, stateOf) {
  const opt = net.checks || {};
  if (opt.reliefOnRegulatedNodes === false) {
    if (!opt.reason) throw new Error('checks.reliefOnRegulatedNodes: false needs a stated reason');
    return [];
  }
  const results = [];
  for (const reg of edges.filter((e) => e.type === 'regulator')) {
    // The supply as filled: the regulator's reference supply pressure when it is higher than the
    // supply node's starting pressure (an isolation valve shut at t = 0 leaves the node low).
    const sup0 = stateOf(nodes[reg.ia]);
    const sup = { ...sup0, p: Math.max(sup0.p, reg.derived.pSupplyRef) };
    const reliefs = edges.filter((e) => e.type === 'relief' && e.ia === reg.ib);
    let capacity = 0;
    let needCdA = Infinity;
    for (const rv of reliefs) {
      const pDown = nodes[rv.ib].p;
      const pOpen = pDown + rv.curves.pFull;
      const failOpen = reg.CdAmax * regFlux(sup.p, sup.T, sup.gamma, sup.R, pOpen).flux;
      const perCdA = regFlux(pOpen, sup.T, sup.gamma, sup.R, pDown).flux;
      capacity += rv.CdA * perCdA;
      needCdA = Math.min(needCdA, failOpen / perCdA);
      results.push({ regulator: reg.id, relief: rv.id, failOpen, pOpen });
    }
    const worst = results.filter((r) => r.regulator === reg.id).reduce((m, r) => Math.max(m, r.failOpen), 0);
    const where = `regulator ${reg.id} → node ${reg.b}`;
    if (!reliefs.length) {
      throw new Error(`${where}: no relief on the regulated node. Every regulated manifold needs one sized for the regulator failing open (or opt out with checks.reason).`);
    }
    if (capacity < worst) {
      throw new Error(`${where}: relief capacity ${(capacity * 1e3).toFixed(1)} g/s at full lift (set + accumulation) is below the fails-open flow ${(worst * 1e3).toFixed(1)} g/s; needs relief C_dA ≥ ${needCdA.toExponential(3)} m²`);
    }
  }
  return results;
}

/**
 * Smallest relief C_dA (m², at full lift) that passes a regulator's fails-open flow at the
 * relief's full-lift Δp, set·(1 + accumulation), relieving from a node to back pressure pDown (Pa).
 * For sizing fixtures and stand defaults.
 */
export function reliefCdAForFailOpen(regCdAmax, supply, set, pDown, accumulation = ACCUMULATION_DEFAULT) {
  const pOpen = pDown + set * (1 + accumulation);
  return (regCdAmax * regFlux(supply.p, supply.T, supply.gamma, supply.R, pOpen).flux) / regFlux(pOpen, supply.T, supply.gamma, supply.R, pDown).flux;
}
