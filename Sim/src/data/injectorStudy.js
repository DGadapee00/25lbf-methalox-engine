/**
 * Both injector circuits at the one C_d in components.json. Cold is a vented chamber (ambient).
 * Design is P_c = 250 psia (PROJECT_PLAN §2.1). Required flows are PROJECT_PLAN §2.2.
 * The fuel gap against 13.9 g/s is issue #1: left alone until a measured C_d exists.
 */
import { components, injectorCdA } from './components.js';
import { nasa7Gas, stateFromPTY, massFractions } from '../physics/gas.js';
import { orificeFlow } from '../physics/elements/orifice.js';
import { PSI } from '../physics/constants.js';

export const REQUIRED_OX = 0.0388;
export const REQUIRED_FU = 0.0139;
export const PC_DESIGN = 250 * PSI;

function flow(gasName, CdA, p0, T, back) {
  const g = nasa7Gas([gasName]);
  const up = stateFromPTY(g, p0, T, massFractions(g, { [gasName]: 1 }));
  const f = orificeFlow(CdA, up, { ...up, p: back });
  return { mdot: f.mdot, margin: f.margin, choked: f.choked };
}

function curve(gasName, CdA, p0, T) {
  const g = nasa7Gas([gasName]);
  const up = stateFromPTY(g, p0, T, massFractions(g, { [gasName]: 1 }));
  const n = 121;
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    const back = p0 * (0.02 + (0.96 * i) / (n - 1));
    xs.push(back);
    ys.push(orificeFlow(CdA, up, { ...up, p: back }).mdot);
  }
  return { xs, ys };
}

export function injectorStudy(c = components()) {
  const p0 = c['PCV-OX-01'].pSet;
  const T = c.ambient.T;
  const coldP = c.ambient.p;
  const oxA = injectorCdA(c, 'INJ-OX-01');
  const fuA = injectorCdA(c, 'INJ-FU-01');
  return {
    Cd: c.injector.Cd,
    p0,
    T,
    coldP,
    pc: PC_DESIGN,
    ox: {
      CdA: oxA,
      n: c['INJ-OX-01'].n,
      d: c['INJ-OX-01'].d,
      cold: flow('O2', oxA, p0, T, coldP),
      design: flow('O2', oxA, p0, T, PC_DESIGN),
      required: REQUIRED_OX,
      curve: curve('O2', oxA, p0, T),
    },
    fu: {
      CdA: fuA,
      n: c['INJ-FU-01'].n,
      d: c['INJ-FU-01'].d,
      cold: flow('CH4', fuA, p0, T, coldP),
      design: flow('CH4', fuA, p0, T, PC_DESIGN),
      required: REQUIRED_FU,
      curve: curve('CH4', fuA, p0, T),
    },
  };
}
