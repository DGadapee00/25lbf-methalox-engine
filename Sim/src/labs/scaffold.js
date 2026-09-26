import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { defineLab } from './define.js';
import { Q, fatLine, disposeTree, rampColorCVD } from '../scene/manim.js';
import { cells, kv } from '../ui/shared.js';
import { fmtP, fmtMdot, fmtF, fmtT } from '../ui/format.js';
import { PSI } from '../physics/constants.js';

/**
 * M0 placeholder. It exists so the shell has something to mount, route to and smoke-test, and so
 * the rendering primitives the P&ID will use (fat lines, the CVD pressure ramp, CSS2D labels, the
 * units toggle) are exercised before there is any physics behind them.
 *
 * It shows PROJECT_PLAN §2's design point converted through format.js. Those are hand-sized numbers
 * (PROJECT_PLAN §2: "Preliminary — recompute in CEA"); nothing here is computed.
 */
const DESIGN = {
  Pc: 250 * PSI, // PROJECT_PLAN §2.1
  F: 111.2, // N, PROJECT_PLAN §2.2
  mdot: 0.0527, // kg/s, PROJECT_PLAN §2.2
  mdotOx: 0.0388, // kg/s, PROJECT_PLAN §2.2
  mdotFu: 0.0139, // kg/s, PROJECT_PLAN §2.2
  pMan: 480 * PSI, // PROJECT_PLAN §2.3
};

function label(html, x, y, cls = 'scene-label') {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  const o = new CSS2DObject(el);
  o.position.set(x, y, 0);
  return o;
}

export default defineLab({
  id: 'scaffold',
  title: 'Scaffold check',
  status: 'placeholder',
  hint: 'M0 scaffold: no physics yet. The component labs arrive in M2.',
  init(ctx) {
    const group = new THREE.Group();
    // A line from manifold pressure down to P_c, coloured by the pressure ramp the P&ID will use.
    const n = 48;
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pos.push(-3 + 6 * t, 0, 0);
      rampColorCVD(1 - t, c);
      col.push(c.r, c.g, c.b);
    }
    group.add(fatLine(pos, { colors: col, width: 6 }));
    group.add(fatLine([-3, -0.9, 0, -0.3, -0.9, 0], { color: Q.ox, width: 4 }));
    group.add(fatLine([0.3, -0.9, 0, 3, -0.9, 0], { color: Q.fuel, width: 4 }));
    const left = label('', -3, 0.6);
    const right = label('', 3, 0.6);
    group.add(left, right, label('ox', -1.6, -1.4, 'scene-label ox'), label('fuel', 1.6, -1.4, 'scene-label fuel'));
    ctx.scene.add(group);
    return { group, left, right };
  },
  enter(ctx, h) {
    h.group.visible = true;
  },
  exit(ctx, h) {
    h.group.visible = false;
  },
  dispose(ctx, h) {
    disposeTree(h.group);
  },
  recompute(state, computed) {
    computed.scaffold = { ...DESIGN };
  },
  syncViews(state, computed, ctx, h) {
    h.left.element.textContent = `manifold ${fmtP(DESIGN.pMan)}`;
    h.right.element.textContent = `chamber ${fmtP(DESIGN.Pc)}`;
  },
  law: () => ['\\mdot = \\mdot_{ox} + \\mdot_{fu}', 'F = C_F\\,\\Pc\\,A_t'],
  liveRows: (s, c) =>
    [
      kv('$\\mdot_{ox}$', fmtMdot(c.scaffold.mdotOx)),
      kv('$\\mdot_{fu}$', fmtMdot(c.scaffold.mdotFu)),
      kv('$\\mdot$', fmtMdot(c.scaffold.mdot)),
    ].join(''),
  readout: (s, c) =>
    cells([
      ['$\\Pc$', fmtP(c.scaffold.Pc)],
      ['$F$', fmtF(c.scaffold.F)],
      ['$\\mdot$', fmtMdot(c.scaffold.mdot)],
      ['$T_{ref}$', fmtT(293.15)],
    ]),
  coach: () => ({
    title: 'Placeholder lab',
    body: [
      'These are PROJECT_PLAN §2 design-point numbers, hand-sized and not yet from CEA. They are shown to check the units toggle and the rendering primitives, not as results.',
    ],
  }),
});
