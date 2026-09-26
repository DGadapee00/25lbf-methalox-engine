/**
 * Network analyses: derived numbers the stand's readouts show that are not a single simulation's
 * state. Pure and headless, like the rest of src/physics/.
 *
 * failsOpenPeaks(net, gas): for each regulator, the **peak manifold pressure** when that
 * regulator fails open into its dead-headed outlet node. That is the worst the manifold's
 * transducers, valves and fittings see, and the number the MEOP and component-rating decision
 * needs (PROJECT_PLAN §3 Phase 4: leak check at 1.5× MEOP).
 *
 * The scenario, per regulator:
 * - the regulator is failed open from t = 0 (fault 'open');
 * - every actuated valve starts and stays shut, so the outlet node is dead-headed and only its
 *   reliefs can pass the flow (the same assumption as the build-time relief rule);
 * - the outlet node starts at the regulator's set point, the supply as filled.
 * It runs until the relief lift and the pressure have settled, and reports:
 *   peak     highest pressure reached (Pa), from the driver's in-step peak tracking
 *   settled  pressure at the end (Pa): what the relief holds once its lift has caught up
 *   pFull    the reliefs' full-lift pressure (Pa), which the sizing rule guarantees `settled` ≤
 *   dependsOn the parameters the transient peak is sensitive to: every relief's tauLift and the
 *            regulator's tau. Until those come from datasheets, the peak is a scale, not a
 *            design value, and is labelled so.
 */
import { simulate } from './simulate.js';
import { compileNetwork } from './network.js';

export function failsOpenPeaks(net, gas, { tEnd } = {}) {
  const sys = compileNetwork(net, gas); // validates, including the relief rule
  const regs = sys.edges.filter((e) => e.type === 'regulator');
  return regs.map((reg) => {
    const reliefs = sys.edges.filter((e) => e.type === 'relief' && e.a === reg.b);
    const variant = {
      ...net,
      nodes: net.nodes.map((n) => (n.id === reg.b ? { ...n, p: reg.pSet } : n)),
      edges: net.edges.map((e) => {
        if (e.id === reg.id) return { ...e, fault: 'open' };
        if (e.type === 'valve') return { ...e, x0: 0 };
        return e;
      }),
    };
    const slow = Math.max(reg.tau, ...reliefs.map((r) => r.tauLift));
    const T = tEnd ?? Math.max(0.2, 100 * slow);
    const r = simulate(variant, { gas, tEnd: T, sampleDt: T, trackPeaks: true });
    const node = reg.b;
    const pDown = Math.min(...reliefs.map((rv) => net.nodes.find((n) => n.id === rv.b).p));
    const pFull = Math.min(...reliefs.map((rv) => rv.curves.pFull)) + pDown;
    return {
      regulator: reg.id,
      node,
      label: 'peak manifold pressure (regulator fails open, outlet dead-headed)',
      peak: r.peaks[node].p,
      tPeak: r.peaks[node].t,
      settled: r.final.nodes[node].p,
      pFull,
      dependsOn: [...reliefs.map((rv) => `${rv.id} tauLift = ${rv.tauLift} s`), `${reg.id} tau = ${reg.tau} s`],
      caveat: 'The transient peak depends on relief lift and poppet response times; until those come from datasheets it is a scale, not a design value.',
      stats: r.stats,
    };
  });
}
