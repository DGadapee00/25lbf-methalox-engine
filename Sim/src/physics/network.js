/**
 * Flow network: the feed system as a nonlinear, time-dependent version of FLUX's Circuits lab
 * (brief §4.1). Nodes are control volumes (the capacitors); edges are flow elements with no volume
 * (the resistors); mass balance at a node is KCL.
 *
 * A network is pure data, like FLUX's data/circuits.js, so the scene and the self-test read the
 * same netlist:
 *
 *   nodes: [{ id, kind: 'volume' | 'ambient', V (m³), p (Pa), T (K), Y: { species: fraction },
 *             thermal: 'adiabatic' (default) | 'isothermal' | { hA (W/K), Tw (K) }, tag? }]
 *     volume   state (m_i per species, U): p and T are derived. p, T, Y are the initial fill.
 *     ambient  a fixed reservoir (atmosphere, or an idealized infinite supply). It accumulates
 *              what flows into it, so conservation can be checked across the whole network.
 *
 *   edges: [{ id, type, a, b, tag?, ...params }], positive flow a → b. Types and parameters:
 *     orifice    CdA (m²)
 *     valve      CdAmax (m²), tOpen, tClose (s), delay (s, default 0), x0 (0..1), curve
 *     check      CdA (m²), crack, reseat (Pa, Δp = p_a − p_b), leakCdA (m², default 0), open0
 *     relief     CdA (m², full lift), set (Pa, Δp = p_a − p_b), accumulation, blowdown (fractions
 *                of set), tauLift (s), L0; proportional lift, see elements/relief.js
 *     regulator  pSet (Pa, flowing outlet pressure at rated flow), mdotRated (kg/s), droop or
 *                pLockup (Pa), CdAmax (m²), tau (s), spe, pSupplyRef (Pa), z0, fault
 *                a = supply side, b = outlet (the pressure it regulates); see elements/regulator.js
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

const TYPES = new Set(['orifice', 'valve', 'check', 'relief', 'regulator']);

export function compileNetwork(net, gas) {
  const ns = gas.n;
  const nodes = net.nodes.map((n) => ({ ...n, Yv: massFractions(gas, n.Y) }));
  const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));
  if (nodeIdx.size !== nodes.length) throw new Error('compileNetwork: duplicate node id');
  let off = 0;
  for (const n of nodes) {
    if (n.kind !== 'volume' && n.kind !== 'ambient') throw new Error(`node ${n.id}: kind must be volume or ambient`);
    if (n.kind === 'volume' && !(n.V > 0)) throw new Error(`node ${n.id}: V must be > 0 m³`);
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
    if (e.type === 'regulator') return { fault: e.fault ?? null, pLockup: e.derived.pLockup };
    return {};
  });

  /** A node's state as filled, before any flow: { p, T, gamma, R, … }. */
  function initialNodeState(n) {
    return stateFromPTY(gas, n.p, n.T, n.Yv);
  }

  /** Initial state vector. */
  function initialState() {
    const y = new Float64Array(nState);
    for (const n of nodes) {
      if (n.kind === 'volume') {
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
  function nodeStates(y) {
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.kind === 'ambient') {
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
      dy[ob + ns] += H;
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
  function events(t, y, out) {
    const st = nodeStates(y);
    eventEdges.forEach((j, k) => {
      const e = edges[j];
      const dp = st[e.ia].p - st[e.ib].p;
      const open = disc[j].open;
      out[k] = open ? e.reseat - dp : dp - e.crack;
    });
    return out;
  }
  function fireEvent(k, t) {
    const j = eventEdges[k];
    disc[j].open = !disc[j].open;
    return { t, id: edges[j].id, what: disc[j].open ? 'open' : 'close' };
  }

  /**
   * A scheduled command: valves take 'open' | 'close' | position; regulators take
   * { pSet } or { fault }. Returns the breakpoints (s) it introduces.
   */
  function command(t, id, cmd) {
    const j = edgeIdx.get(id);
    if (j === undefined) throw new Error(`command: unknown edge ${id}`);
    const e = edges[j];
    if (e.type === 'valve') return valveCommand(e, disc[j], t, cmd);
    if (e.type === 'regulator') {
      // A new set point moves lockup with it; the droop (and so K) is a property of the regulator.
      if (cmd && 'pSet' in cmd) disc[j].pLockup = cmd.pSet + e.derived.droop;
      if (cmd && 'fault' in cmd) disc[j].fault = cmd.fault;
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
      }
      out.edges[e.id] = r;
    });
    return out;
  }

  /** Per-component absolute tolerance scale: the mass a node would hold at the network's top pressure. */
  function scales() {
    const pMax = Math.max(...nodes.map((n) => n.p));
    const sc = new Float64Array(nState).fill(1);
    let mBig = 0;
    for (const n of nodes) {
      if (n.kind !== 'volume') continue;
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
    gas, nodes, edges, disc, nState, nEvents: eventEdges.length,
    initialState, rhs, events, fireEvent, command, readout, scales, totals, nodeStates,
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
 * filled; with no Joule–Thomson model yet the manifold gas is at supply temperature.
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
