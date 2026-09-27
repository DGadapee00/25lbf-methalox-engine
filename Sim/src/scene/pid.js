import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { M, Q, fatLine, fatSegments, disposeTree, rampColorCVD } from './manim.js';
import { parseTag } from '../data/tags.js';

/**
 * P&ID view (brief §5.2), the fluid counterpart of FLUX's SchematicView: it draws a stand's
 * netlist (data/stands/*) as a flat schematic and animates it from a network readout.
 *
 * - Each pipe is split at its symbol and each half is coloured by the pressure of the node it
 *   touches, on the colour-blind-safe ramp (log scale from ambient to the highest node pressure);
 *   a legend shows the scale.
 * - ISA-5.1-style symbols: bowtie valves (actuator box for SV/XV, T handle for HV), regulator with
 *   dome, angle relief with spring, check valve, orifice plate, bottle, chamber, vent.
 * - Valve fill shows position; relief fill shows lift.
 * - Choke indicator on every orifice (§5.2): green p₀/p ≥ 2.2, amber choked but below 2.2, red
 *   unchoked.
 * - Flow dots move along each pipe at a speed ∝ ṁ, in the direction of flow.
 * - Every element carries its tag; transducers show their node's pressure (a load cell its thrust).
 * - A chamber that burns shows a flame and its state; an igniter is a spark symbol, lit when on.
 * - Valves and igniters are pickable: pick(ndc, camera) returns the tag under the pointer.
 *
 * It reads pressures and flows only; it never computes physics.
 */
const S = 0.32; // symbol half-size, scene units
const PIPE_W = 5;
const OUTLINE = M.white;
const CHOKE = { green: 0x83c167, amber: 0xf0ac5f, red: 0xfc6255, off: 0x444444 };
const INK = { OX: Q.ox, FU: Q.fuel, N2: Q.n2, IG: Q.n2, CH: Q.hot };

/** Symbol colour from an S-2 circuit, an engine-part tag, or the stand's single-circuit fallback. */
function inkOf(id, fallback) {
  const circuit = parseTag(id)?.circuit;
  if (circuit && INK[circuit]) return INK[circuit];
  if (id.startsWith('INJ-OX')) return Q.ox;
  if (id.startsWith('INJ-FU')) return Q.fuel;
  if (id === 'THROAT-01') return Q.hot;
  return fallback;
}

/** anchor: [ax, ay] in the label's own box; [0.5, 0.5] centres it on (x, y), [0, 0] puts its top-left corner there. */
function label(html, x, y, cls, anchor = [0.5, 0.5]) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  const o = new CSS2DObject(el);
  o.center.set(anchor[0], anchor[1]);
  o.position.set(x, y, 0.05);
  return o;
}
function setText(obj, html) {
  if (obj.userData.html !== html) {
    obj.userData.html = html;
    obj.element.innerHTML = html;
  }
}

/** Polyline points (local u along the pipe, v across) → world flat array around center c. */
function place(c, dir, pts) {
  const [ux, uy] = dir;
  const out = [];
  for (const [u, v] of pts) out.push(c[0] + u * ux - v * uy, c[1] + u * uy + v * ux, 0.02);
  return out;
}
function triMesh(c, dir, tris, color) {
  const pos = [];
  for (const t of tris) pos.push(...place(c, dir, t));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
}
const segs = (c, dir, list) => list.flatMap((seg) => place(c, dir, seg));

export class PidView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.edges = [];
    this.nodes = [];
    this.picks = [];
    this.sensors = [];
    this.flames = [];
    this.igniters = [];
    this.hits = [];
    this._c = new THREE.Color();
    this.raycaster = new THREE.Raycaster();
    this.dotGeo = new THREE.CircleGeometry(0.06, 12);
  }

  setVisible(v) {
    this.group.visible = v;
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      disposeTree(o);
    }
    this.edges = [];
    this.nodes = [];
    this.picks = [];
    this.sensors = [];
    this.flames = [];
    this.igniters = [];
    this.hits = [];
    this.nextRing = null;
    this.nextTag = null;
  }

  /**
   * stand: { net, layout: { nodes, vents }, sensors, circuit? }.
   * circuitColor: outline colour for the circuit's symbols (Q.ox, Q.fuel, Q.n2).
   */
  build(stand, { circuitColor = Q.ox } = {}) {
    this.clear();
    const { net, layout } = stand;
    this.net = net;
    this.gas = stand.gas || null;
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    // Inspector targets: an invisible disc or plate over every element (inspect(ndc) → { kind, id }).
    const addHit = (geo, x, y, info) => {
      const m = new THREE.Mesh(geo, hitMat);
      m.position.set(x, y, 0.045);
      m.userData.inspect = info;
      this.hits.push(m);
      this.group.add(m);
    };
    const nodeById = Object.fromEntries(net.nodes.map((n) => [n.id, n]));
    // A node with a layout position is drawn there (an ambient one as a fixed-pressure reservoir);
    // an ambient node without one is drawn as a vent at the end of each edge that reaches it.
    const posOf = (edge, end) => layout.nodes[edge[end]] ?? layout.vents?.[edge.id];
    const isVent = (edge, end) => nodeById[edge[end]].kind === 'ambient' && !layout.nodes[edge[end]];
    const add = (o) => (this.group.add(o), o);

    // Nodes: bottles, chambers and junctions.
    for (const n of net.nodes) {
      if (!layout.nodes[n.id]) continue;
      const [x, y] = layout.nodes[n.id];
      const kind = n.kind === 'ambient' ? 'reservoir' : /bottle|tank/.test(n.id) ? 'bottle' : /chamber/.test(n.id) ? 'chamber' : 'junction';
      let fill;
      if (kind === 'bottle') {
        const w = 0.5;
        const h = 1.2;
        fill = add(new THREE.Mesh(new THREE.PlaneGeometry(2 * w, 2 * h), new THREE.MeshBasicMaterial({ color: 0x333333 })));
        fill.position.set(x, y, 0.01);
        add(fatLine([x - w, y - h, 0.03, x + w, y - h, 0.03, x + w, y + h - 0.3, 0.03, x + 0.2, y + h, 0.03, x - 0.2, y + h, 0.03, x - w, y + h - 0.3, 0.03, x - w, y - h, 0.03], { color: INK[n.circuit] || circuitColor, width: 2.5 }));
      } else if (kind === 'chamber') {
        const w = 0.9;
        const h = 0.55;
        fill = add(new THREE.Mesh(new THREE.PlaneGeometry(2 * w, 2 * h), new THREE.MeshBasicMaterial({ color: 0x333333 })));
        fill.position.set(x, y, 0.01);
        add(fatLine([x - w, y - h, 0.03, x + w * 0.55, y - h, 0.03, x + w, y - 0.15, 0.03, x + w, y + 0.15, 0.03, x + w * 0.55, y + h, 0.03, x - w, y + h, 0.03, x - w, y - h, 0.03], { color: Q.hot, width: 2.5 }));
        if (n.kind === 'chamber') {
          // Flame: a hot core inside a red envelope, shown only while the chamber burns.
          const flame = new THREE.Group();
          const outer = new THREE.Mesh(new THREE.CircleGeometry(0.42, 28), new THREE.MeshBasicMaterial({ color: Q.hot, transparent: true, opacity: 0.85 }));
          outer.scale.set(1.5, 0.95, 1);
          const core = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), new THREE.MeshBasicMaterial({ color: Q.hotCore, transparent: true, opacity: 0.9 }));
          core.scale.set(1.6, 0.9, 1);
          core.position.z = 0.001;
          flame.add(outer, core);
          flame.position.set(x, y, 0.02);
          flame.visible = false;
          this.flames.push({ id: n.id, flame: add(flame), state: add(label('', x, y - h - 0.78, 'pid-state')) });
        }
      } else if (kind === 'reservoir') {
        const w = 0.5;
        fill = add(new THREE.Mesh(new THREE.PlaneGeometry(2 * w, 2 * w), new THREE.MeshBasicMaterial({ color: 0x333333 })));
        fill.position.set(x, y, 0.01);
        add(fatLine([x - w, y - w, 0.03, x + w, y - w, 0.03, x + w, y + w, 0.03, x - w, y + w, 0.03, x - w, y - w, 0.03], { color: M.grey, width: 2, dashed: true }));
      } else {
        fill = add(new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshBasicMaterial({ color: 0x333333 })));
        fill.position.set(x, y, 0.03);
      }
      // Bottles, chambers and reservoirs are labelled under their body. A junction can have pipes
      // on all four sides, so its label goes on the diagonal, below and right, clear of any pipe.
      const placed = layout.labels?.[n.id];
      const name = placed
        ? add(label(n.label || n.id, placed.at[0], placed.at[1], 'pid-node', placed.anchor || [0.5, 0.5]))
        : kind === 'junction'
          ? add(label(n.label || n.id, x + 0.16, y - 0.16, 'pid-node', [0, 0]))
          : add(label(n.label || n.id, x, y - ({ bottle: 1.55, chamber: 0.85, reservoir: 0.8 }[kind] ?? 0.35), 'pid-node'));
      this.nodes.push({ id: n.id, fill, name, kind });
      const size = { bottle: [1.0, 2.4], chamber: [1.8, 1.1], reservoir: [1.0, 1.0] }[kind];
      addHit(size ? new THREE.PlaneGeometry(size[0], size[1]) : new THREE.CircleGeometry(0.3, 16), x, y, { kind: 'node', id: n.id });
    }

    // Edges: two half pipes, a symbol, flow dots, a tag, and for orifices a choke indicator.
    for (const e of net.edges) {
      const A = posOf(e, 'a');
      const B = posOf(e, 'b');
      if (!A || !B) continue;
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const L = Math.hypot(dx, dy);
      const dir = [dx / L, dy / L];
      const Mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const gap = e.type === 'orifice' ? 0.08 : S;
      const inA = [Mid[0] - dir[0] * gap, Mid[1] - dir[1] * gap];
      const inB = [Mid[0] + dir[0] * gap, Mid[1] + dir[1] * gap];
      const halfA = add(fatLine([A[0], A[1], 0, inA[0], inA[1], 0], { color: 0x555555, width: PIPE_W }));
      const halfB = add(fatLine([inB[0], inB[1], 0, B[0], B[1], 0], { color: 0x555555, width: PIPE_W }));
      const rec = { id: e.id, type: e.type, e, A, B, L, dir, halfA, halfB, fill: null, choke: null, dots: [], phase: 0 };
      const letters = parseTag(e.id)?.letters;
      const ink = inkOf(e.id, circuitColor);
      if (e.type === 'valve' || e.type === 'regulator') {
        const bow = [[[-S, -S * 0.75], [-S, S * 0.75], [0, 0], [-S, -S * 0.75]], [[S, -S * 0.75], [S, S * 0.75], [0, 0], [S, -S * 0.75]]];
        rec.fill = add(triMesh(Mid, dir, [[[-S, -S * 0.75], [-S, S * 0.75], [0, 0]], [[S, -S * 0.75], [S, S * 0.75], [0, 0]]], 0x222222));
        for (const b of bow) add(fatLine(place(Mid, dir, b), { color: ink, width: 2 }));
        if (e.type === 'regulator') {
          const arc = [];
          for (let k = 0; k <= 12; k++) arc.push([0.22 * Math.cos((Math.PI * k) / 12), S * 0.3 + 0.22 * Math.sin((Math.PI * k) / 12)]);
          add(fatLine(place(Mid, dir, [[0, 0], [0, S * 0.3], ...arc]), { color: ink, width: 2 }));
        } else if (letters === 'HV') {
          add(fatSegments(segs(Mid, dir, [[[0, 0], [0, S * 1.2]], [[-S * 0.6, S * 1.2], [S * 0.6, S * 1.2]]]), { color: ink, width: 2 }));
        } else {
          add(fatSegments(segs(Mid, dir, [[[0, 0], [0, S * 1.0]], [[-S * 0.45, S * 1.0], [S * 0.45, S * 1.0]], [[-S * 0.45, S * 1.6], [S * 0.45, S * 1.6]], [[-S * 0.45, S * 1.0], [-S * 0.45, S * 1.6]], [[S * 0.45, S * 1.0], [S * 0.45, S * 1.6]]]), { color: ink, width: 2 }));
        }
      } else if (e.type === 'relief') {
        rec.fill = add(triMesh(Mid, dir, [[[-S, -S * 0.75], [-S, S * 0.75], [0, 0]]], 0x222222));
        add(fatLine(place(Mid, dir, [[-S, -S * 0.75], [-S, S * 0.75], [0, 0], [-S, -S * 0.75]]), { color: ink, width: 2 }));
        const zig = [[0, 0]];
        for (let k = 1; k <= 6; k++) zig.push([(k % 2 ? 1 : -1) * 0.12, k * 0.1]);
        add(fatLine(place(Mid, dir, zig.map(([v, u]) => [-u, v])), { color: ink, width: 2 }));
      } else if (e.type === 'check') {
        add(fatLine(place(Mid, dir, [[-S, -S * 0.7], [-S, S * 0.7], [S * 0.6, 0], [-S, -S * 0.7]]), { color: ink, width: 2 }));
        add(fatSegments(segs(Mid, dir, [[[S * 0.6, -S * 0.8], [S * 0.6, S * 0.8]]]), { color: ink, width: 2 }));
      } else if (e.type === 'orifice') {
        add(fatSegments(segs(Mid, dir, [[[-0.07, -S], [-0.07, S]], [[0.07, -S], [0.07, S]]]), { color: OUTLINE, width: 2.5 }));
        rec.choke = add(new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), new THREE.MeshBasicMaterial({ color: CHOKE.off })));
        const cp = place(Mid, dir, [[0, -S - 0.3]]);
        rec.choke.position.set(cp[0], cp[1], 0.04);
      }
      // Vent symbol at an ambient end.
      for (const end of ['a', 'b']) {
        if (!isVent(e, end)) continue;
        const P = end === 'a' ? A : B;
        add(fatSegments([P[0] - 0.18, P[1], 0.02, P[0] + 0.18, P[1], 0.02, P[0] - 0.11, P[1] - 0.08, 0.02, P[0] + 0.11, P[1] - 0.08, 0.02, P[0] - 0.04, P[1] - 0.16, 0.02, P[0] + 0.04, P[1] - 0.16, 0.02], { color: M.grey, width: 2 }));
      }
      // Tag, on the side away from the pipe.
      const tp = e.type === 'relief' ? place(Mid, dir, [[S + 1.0, S + 0.55]]) : place(Mid, dir, [[0, e.type === 'orifice' ? S + 0.35 : S + 0.75]]);
      rec.tag = add(label(e.id, tp[0], tp[1], 'pid-tag'));
      // Flow dots.
      for (let k = 0; k < 5; k++) {
        const d = new THREE.Mesh(this.dotGeo, new THREE.MeshBasicMaterial({ color: M.white, transparent: true, opacity: 0.85 }));
        d.visible = false;
        rec.dots.push(add(d));
      }
      if (e.type === 'valve') {
        const hit = new THREE.Mesh(new THREE.CircleGeometry(S * 1.6, 16), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(Mid[0], Mid[1], 0.05);
        hit.userData.tag = e.id;
        this.picks.push(add(hit));
      }
      this.edges.push(rec);
      addHit(new THREE.CircleGeometry(e.type === 'orifice' ? 0.34 : S * 1.5, 16), Mid[0], Mid[1], { kind: 'edge', id: e.id });
    }

    // Igniters: a spark in a circle, wired to its chamber, pickable like a valve.
    for (const g of net.igniters || []) {
      const P = layout.igniters?.[g.id];
      const C = layout.nodes[g.chamber];
      if (!P || !C) continue;
      const [x, y] = P;
      add(fatLine([x, y + 0.3, 0.02, C[0], C[1] - 0.55, 0.02], { color: M.grey, width: 1.5, dashed: true }));
      const ring = add(fatLine(Array.from({ length: 25 }, (_, k) => [x + 0.3 * Math.cos((2 * Math.PI * k) / 24), y + 0.3 * Math.sin((2 * Math.PI * k) / 24), 0.02]).flat(), { color: M.grey, width: 2 }));
      const bolt = add(fatLine([x - 0.08, y + 0.2, 0.03, x + 0.06, y + 0.02, 0.03, x - 0.06, y - 0.02, 0.03, x + 0.08, y - 0.2, 0.03], { color: M.grey, width: 2.5 }));
      const tag = add(label(g.id, x + 0.45, y, 'pid-tag', [0, 0.5]));
      const hit = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(x, y, 0.05);
      hit.userData.tag = g.id;
      this.picks.push(add(hit));
      this.igniters.push({ id: g.id, chamber: g.chamber, ring, bolt, tag });
      addHit(new THREE.CircleGeometry(0.5, 16), x, y, { kind: 'igniter', id: g.id });
    }

    for (const s of stand.sensors || []) {
      const [x, y] = layout.nodes[s.node];
      const [ox, oy] = s.offset;
      add(fatSegments([x, y, 0.02, x + ox, y + oy - 0.28, 0.02], { color: M.grey, width: 1.5 }));
      add(fatLine(Array.from({ length: 25 }, (_, k) => [x + ox + 0.28 * Math.cos((2 * Math.PI * k) / 24), y + oy + 0.28 * Math.sin((2 * Math.PI * k) / 24), 0.02]).flat(), { color: M.grey, width: 1.5 }));
      const lab = add(label(`<b>${s.tag}</b><span></span>`, x + ox, y + oy + 0.55, 'pid-sensor'));
      this.sensors.push({ ...s, lab });
      addHit(new THREE.CircleGeometry(0.34, 16), x + ox, y + oy, { kind: 'sensor', id: s.tag });
    }
    this.pAmb = Math.min(...net.nodes.map((n) => n.p), 101325);
    this.pMax = Math.max(...net.nodes.map((n) => n.p));
  }

  /** Ramp position of pressure p (Pa), log-scaled from ambient to the stand's top pressure. */
  rampT(p) {
    const lo = Math.log(this.pAmb);
    const hi = Math.log(Math.max(this.pMax, this.pAmb * 1.01));
    return Math.max(0, Math.min(1, (Math.log(Math.max(p, 1)) - lo) / (hi - lo)));
  }

  /**
   * Update from a network readout ({ nodes: {id: {p}}, edges: {id: {mdot, choked, margin, x,
   * lift, z}} }). dt (s, real time) advances the flow dots; fmtP formats sensor values.
   */
  update(readout, dt, fmtP, fmtF) {
    if (!readout) return;
    this.last = readout;
    if (this.nextRing?.visible) {
      this.pulse = ((this.pulse || 0) + (dt || 0) * 5) % (2 * Math.PI);
      this.nextRing.scale.setScalar(1 + 0.12 * Math.sin(this.pulse));
    }
    if (fmtP) this.fmtP = fmtP;
    if (fmtF) this.fmtF = fmtF;
    const pOf = (id) => readout.nodes[id]?.p ?? this.pAmb;
    for (const n of this.nodes) n.fill.material.color.copy(rampColorCVD(this.rampT(pOf(n.id)), this._c));
    const mRef = Math.max(1e-6, ...Object.values(readout.edges).map((r) => Math.abs(r.mdot || 0)));
    for (const r of this.edges) {
      const er = readout.edges[r.id] || {};
      r.halfA.material.color.copy(rampColorCVD(this.rampT(pOf(r.e.a)), this._c));
      r.halfB.material.color.copy(rampColorCVD(this.rampT(pOf(r.e.b)), this._c));
      const open = r.type === 'valve' ? er.x ?? 0 : r.type === 'relief' ? er.lift ?? 0 : r.type === 'regulator' ? er.z ?? 0 : 1;
      if (r.fill) {
        r.fill.material.color.setHex(open > 0.01 ? M.green : 0x222222);
        r.fill.material.opacity = 0.25 + 0.7 * Math.min(1, open);
      }
      if (r.choke) {
        const q = Math.abs(er.mdot || 0) < 1e-6 ? 'off' : !er.choked ? 'red' : er.margin >= 2.2 ? 'green' : 'amber';
        r.choke.material.color.setHex(CHOKE[q]);
        r.chokeState = q;
      }
      const m = er.mdot || 0;
      const speed = (Math.abs(m) / mRef) * 1.2; // scene units per second
      r.phase = (r.phase + (m >= 0 ? 1 : -1) * speed * (dt || 0)) % r.L;
      const show = Math.abs(m) > 1e-5;
      r.dots.forEach((d, k) => {
        d.visible = show;
        if (!show) return;
        let s = (r.phase + (k * r.L) / r.dots.length) % r.L;
        if (s < 0) s += r.L;
        d.position.set(r.A[0] + r.dir[0] * s, r.A[1] + r.dir[1] * s, 0.06);
      });
    }
    for (const s of this.sensors) {
      if (s.quantity === 'F') {
        const F = readout.measured?.[s.tag] ?? readout.chambers?.[s.node]?.F ?? 0;
        setText(s.lab, `<b>${s.tag}</b><span>${this.fmtF ? this.fmtF(F) : ''}</span>`);
        continue;
      }
      const p = readout.measured?.[s.tag] ?? pOf(s.node);
      setText(s.lab, `<b>${s.tag}</b><span>${this.fmtP ? this.fmtP(p) : ''}</span>`);
    }
    for (const f of this.flames) {
      const c = readout.chambers?.[f.id];
      const burning = !!c?.burning;
      f.flame.visible = burning;
      if (burning) {
        this.flicker = ((this.flicker || 0) + (dt || 0) * 9) % (2 * Math.PI);
        f.flame.scale.setScalar(0.92 + 0.08 * Math.sin(this.flicker));
      }
      setText(f.state, c ? (burning ? '<b>burning</b>' : c.unburnedMass > 1e-7 ? 'unburned propellant' : 'cold') : '');
    }
    for (const g of this.igniters) {
      const on = !!readout.chambers?.[g.chamber]?.igniter?.on;
      const col = on ? M.white : M.grey;
      g.ring.material.color.setHex(col);
      g.bolt.material.color.setHex(on ? Q.hot : M.grey);
    }
  }

  /** Tag of the valve under normalized device coordinates (THREE.Vector2), or null. */
  pick(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObjects(this.picks, false)[0];
    return hit ? hit.object.userData.tag : null;
  }

  /**
   * The one control to press next (brief §5.3: yellow is reserved for it): a pulsing yellow ring on
   * the element with this tag or node id, or none for null. Used by the guide.
   */
  setNext(tag) {
    if (tag === this.nextTag) return;
    this.nextTag = tag;
    if (!this.nextRing) {
      this.nextRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 40), new THREE.MeshBasicMaterial({ color: Q.next, transparent: true, opacity: 0.95, depthWrite: false }));
      this.nextRing.visible = false;
      this.group.add(this.nextRing);
    }
    const at = this.positionOf(tag);
    this.nextRing.visible = !!at;
    if (at) this.nextRing.position.set(at[0], at[1], 0.08);
  }

  /** Scene position of an edge's symbol, an igniter, a sensor or a node, by id. */
  positionOf(id) {
    if (!id) return null;
    const e = this.edges.find((r) => r.id === id);
    if (e) return [(e.A[0] + e.B[0]) / 2, (e.A[1] + e.B[1]) / 2];
    const h = this.hits.find((m) => m.userData.inspect.id === id);
    return h ? [h.position.x, h.position.y] : null;
  }

  /** What is under the pointer, for the inspector: { kind: 'node' | 'edge' | 'igniter' | 'sensor', id } or null. */
  inspect(ndc, camera) {
    if (!this.group.visible) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObjects(this.hits, false)[0];
    return hit ? hit.object.userData.inspect : null;
  }

  /** Choke state per orifice, for readouts and the smoke test. */
  chokeStates() {
    return Object.fromEntries(this.edges.filter((r) => r.choke).map((r) => [r.id, r.chokeState]));
  }
}
