/**
 * The GN₂ stand as meshes. Tubes, the bottle and the chamber are the layout in
 * scale.js. Gauges and the placard are reading surfaces, drawn large enough to
 * read and labelled UNCALIBRATED. Pressure colours use the same log ramp as
 * the P&ID (scene/pid.js): ambient to the stand's initial top pressure.
 */
import * as THREE from 'three';
import { rampColorCVD } from '../scene/manim.js';
import { provenance } from '../data/components.js';
import { fmtP } from '../ui/format.js';
import { P_ATM } from '../physics/constants.js';
import {
  GAUGE_M,
  HANDLE_M,
  HP_LENGTH_M,
  PANEL_W_M,
  READ_MODULE_M,
  RIG_BELOW_EYE_M,
  RIG_FORWARD_M,
  TUBE_OD_M,
} from './scale.js';
import { createPanelCanvas, paintPanel, panelModel } from './panel.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

function marks(id) {
  const rows = provenance().filter((r) => r.part === id || (id === 'INJ-OX-01' && r.part === 'injector'));
  return {
    placeholder: rows.some((r) => r.kind === 'placeholder'),
    uncalibrated: rows.some((r) => r.kind === 'uncalibrated'),
  };
}

function tagLines(id, detail) {
  const m = marks(id);
  const lines = [id];
  if (detail) lines.push(detail);
  lines.push('UNCALIBRATED');
  if (m.placeholder) lines.push('PLACEHOLDER');
  else if (m.uncalibrated) lines.push('C_d uncalibrated');
  return lines;
}

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return { canvas, tex };
}

function paintLines(canvas, lines, { banner = false } = {}) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#14161a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = '#2a2d33';
  g.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  const n = lines.length;
  const size = Math.floor(canvas.height / (n + 1.2));
  g.font = `600 ${Math.max(18, size)}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const warn = line === 'UNCALIBRATED' || line === 'PLACEHOLDER' || line.startsWith('C_d');
    g.fillStyle = banner && i === 0 ? '#f0ac5f' : warn ? '#f0ac5f' : '#ece6e2';
    g.fillText(line, canvas.width / 2, ((i + 1) * canvas.height) / (n + 1));
  });
}

function labelledPlane(w, h, lines, px = 512, py = 256) {
  const { canvas, tex } = canvasTexture(px, py);
  paintLines(canvas, lines, { banner: lines[0] === 'UNCALIBRATED' });
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  mesh.userData.canvas = canvas;
  mesh.userData.tex = tex;
  mesh.userData.key = lines.join('\n');
  return mesh;
}

function setLines(mesh, lines) {
  const key = lines.join('\n');
  if (mesh.userData.key === key) return;
  mesh.userData.key = key;
  paintLines(mesh.userData.canvas, lines, { banner: lines[0] === 'UNCALIBRATED' });
  mesh.userData.tex.needsUpdate = true;
}

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function tube(a, b, radius, material, radial = 10) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const length = Math.max(dir.length(), 1e-4);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radial, 1, false), material);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.multiplyScalar(1 / length));
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  return mesh;
}

function alongX(mesh) {
  mesh.rotation.z = -Math.PI / 2;
  return mesh;
}

export function pressureBounds(spec) {
  const ps = spec.net.nodes.map((n) => n.p);
  return { pAmb: Math.min(...ps, P_ATM), pMax: Math.max(...ps) };
}

export function createStandView(layout, spec) {
  const root = new THREE.Group();
  root.name = 'gn2-stand';
  const { pAmb, pMax } = pressureBounds(spec);
  const mats = {};
  const nodeMat = (id) => {
    if (!mats[id]) mats[id] = lambert(0x888888);
    return mats[id];
  };
  const pickables = [];
  const byTag = {};
  const labels = [];

  const bottle = new THREE.Mesh(new THREE.SphereGeometry(layout.bottle.radius, 20, 14), nodeMat('bottle'));
  bottle.position.set(...layout.bottle.position);
  root.add(bottle);

  for (const seg of layout.segments) {
    root.add(tube(seg.a, seg.b, layout.tubeR, nodeMat(seg.from)));
  }

  const eng = layout.engine;
  const plate = alongX(new THREE.Mesh(
    new THREE.CylinderGeometry(eng.diameter / 2, eng.diameter / 2, eng.plate, 16),
    nodeMat('line'),
  ));
  plate.position.set(eng.injX, 0, 0);
  root.add(plate);
  const holeMat = lambert(0x0b0c0e);
  for (let i = 0; i < eng.injN; i += 1) {
    const a = (i / eng.injN) * Math.PI * 2;
    const hole = alongX(new THREE.Mesh(
      new THREE.CylinderGeometry(eng.injD / 2, eng.injD / 2, eng.plate * 1.2, 8),
      holeMat,
    ));
    hole.position.set(eng.injX, Math.cos(a) * eng.holeCircle, Math.sin(a) * eng.holeCircle);
    root.add(hole);
  }
  const barrel = alongX(new THREE.Mesh(
    new THREE.CylinderGeometry(eng.diameter / 2, eng.diameter / 2, eng.barrel, 16),
    nodeMat('chamber'),
  ));
  barrel.position.set(eng.barrelMid, 0, 0);
  root.add(barrel);
  // +90° about Z sends the cone's +Y end (the exit, the larger radius) toward +X.
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(eng.exitD / 2, eng.throatD / 2, Math.max(eng.nozzleLen, 1e-4), 16),
    nodeMat('chamber'),
  );
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.set(eng.nozzleMid, 0, 0);
  root.add(nozzle);

  const handleMat = lambert(0x2a2d33);
  const leverMat = lambert(0xece6e2);
  for (const part of Object.values(layout.parts)) {
    const group = new THREE.Group();
    group.position.set(...part.position);
    group.name = part.id;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(HANDLE_M / 2, HANDLE_M / 2, HANDLE_M, 10), handleMat);
    if (part.axis === 'x') body.rotation.z = Math.PI / 2;
    group.add(body);
    if (part.kind === 'valve' || part.kind === 'regulator' || part.kind === 'relief') {
      const lever = new THREE.Mesh(new THREE.BoxGeometry(HANDLE_M * 0.18, HANDLE_M, HANDLE_M * 0.18), leverMat.clone());
      lever.position.y = HANDLE_M * 0.55;
      lever.name = 'lever';
      group.add(lever);
      group.userData.lever = lever;
    }
    if (part.kind === 'valve') group.userData.act = { type: 'toggle', tag: part.id };
    else if (part.kind === 'regulator') {
      group.userData.act = { type: 'note', text: 'PCV-OX-01 set point is the − and + on the panel. 50–900 psia is the Operate field, not a rating and not MEOP.' };
    } else if (part.kind === 'relief') {
      group.userData.act = { type: 'note', text: 'PSV-OX-01 lifts on its own. It is not a hand valve. PLACEHOLDER, issue #6.' };
    } else {
      group.userData.act = { type: 'note', text: `${part.id} — UNCALIBRATED. Not a hardware prediction.` };
    }
    root.add(group);
    pickables.push(group);
    byTag[part.id] = group;
    const lab = labelledPlane(READ_MODULE_M * 3.4, READ_MODULE_M * 1.8, tagLines(part.id, ''), 512, 256);
    lab.position.set(part.position[0], part.position[1] + HANDLE_M * 1.6, part.position[2] + layout.tubeR);
    root.add(lab);
    labels.push({ mesh: lab, id: part.id });
  }

  const gaugeMeshes = {};
  for (const [tag, g] of Object.entries(layout.gauges)) {
    const mesh = labelledPlane(GAUGE_M, GAUGE_M * 0.72, tagLines(tag, '—'), 512, 320);
    mesh.position.set(...g.position);
    mesh.name = tag;
    root.add(mesh);
    gaugeMeshes[tag] = { mesh, node: g.node, tag };
  }

  const placard = labelledPlane(READ_MODULE_M * 14, READ_MODULE_M * 8, layout.placard, 1024, 512);
  const midHp = (layout.nodes.hp.a[0] + layout.nodes.hp.b[0]) / 2;
  placard.position.set(midHp, GAUGE_M, RIG_FORWARD_M * 0.25);
  root.add(placard);

  const canvases = createPanelCanvas();
  let model = panelModel([]);
  const panelTex = new THREE.CanvasTexture(canvases.panel);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  panelTex.generateMipmaps = false;
  panelTex.minFilter = THREE.LinearFilter;
  panelTex.magFilter = THREE.LinearFilter;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M, PANEL_W_M * 0.6),
    new THREE.MeshBasicMaterial({ map: panelTex }),
  );
  panel.position.set(layout.stations.manifold[0], PANEL_W_M * 0.35, RIG_FORWARD_M * 0.45);
  panel.userData.panel = true;
  panel.name = 'daq-panel';
  root.add(panel);
  pickables.push(panel);

  const floorY0 = -(RIG_BELOW_EYE_M + HP_LENGTH_M);
  const floorSize = layout.span + HP_LENGTH_M * 2;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshLambertMaterial({ color: 0x16181c }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(layout.span / 2, floorY0, 0);
  root.add(floor);
  const pads = [];
  for (const [station, pos] of Object.entries(layout.stations)) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(READ_MODULE_M * 2, READ_MODULE_M * 2, TUBE_OD_M, 16),
      lambert(0x3a3428),
    );
    pad.position.set(pos[0], floorY0 + TUBE_OD_M, pos[2] + RIG_FORWARD_M * 0.35);
    pad.userData.act = { type: 'focus', station };
    pad.name = `pad-${station}`;
    root.add(pad);
    pickables.push(pad);
    pads.push(pad);
    const lab = labelledPlane(READ_MODULE_M * 3, READ_MODULE_M * 1.2, [station === 'manifold' ? 'valves' : station], 256, 128);
    lab.position.set(0, READ_MODULE_M * 2, 0);
    pad.add(lab);
    labels.push({ mesh: lab, id: null });
  }

  function setFloorLocal(y) {
    floor.position.y = y;
    for (const pad of pads) pad.position.y = y + TUBE_OD_M;
  }

  let lastPaint = 0;
  let paintKey = '';
  const faceQ = new THREE.Quaternion();
  const readable = [panel, placard, ...labels.map((l) => l.mesh), ...Object.values(gaugeMeshes).map((g) => g.mesh)];

  function faceCamera(camera) {
    faceQ.copy(root.quaternion).invert();
    for (const mesh of readable) mesh.quaternion.copy(faceQ).multiply(camera.quaternion);
  }

  function rampT(p) {
    const lo = Math.log(pAmb);
    const hi = Math.log(Math.max(pMax, pAmb * 1.01));
    return Math.max(0, Math.min(1, (Math.log(Math.max(p, 1)) - lo) / (hi - lo)));
  }

  return {
    root,
    pickables,
    byTag,
    panel,
    get model() {
      return model;
    },
    setFloorLocal,
    update(state, actions, camera, now) {
      const nodes = state.readout?.nodes;
      if (nodes) {
        for (const [id, mat] of Object.entries(mats)) {
          const p = nodes[id]?.p;
          if (p == null) continue;
          rampColorCVD(rampT(p), _color);
          mat.color.copy(_color);
        }
      }
      const edges = state.readout?.edges || {};
      for (const [id, group] of Object.entries(byTag)) {
        const e = edges[id];
        const lever = group.userData.lever;
        if (!lever || !e) continue;
        const open = e.x ?? e.z ?? e.lift ?? 0;
        lever.rotation.z = (1 - open) * (Math.PI / 2);
        lever.material.color.setHex(open > 0.5 ? 0x83c167 : 0xece6e2);
      }
      for (const lab of labels) {
        if (!lab.id) continue;
        const e = edges[lab.id];
        let detail = '';
        if (e?.x != null) detail = e.stuck ? 'STUCK' : e.x > 0.5 ? 'open' : 'shut';
        else if (e?.z != null) detail = `z ${e.z.toFixed(2)}`;
        else if (e?.lift != null) detail = e.lift > 0 ? 'lifting' : 'seated';
        else if (e?.blockage) detail = `blocked ${Math.round(e.blockage * 100)}%`;
        setLines(lab.mesh, tagLines(lab.id, detail));
      }
      for (const g of Object.values(gaugeMeshes)) {
        const measured = state.measured?.[g.tag];
        const nodeP = nodes?.[g.node]?.p;
        const shown = measured ?? nodeP;
        const detail = shown == null ? '—' : measured == null ? `${fmtP(shown)} node` : fmtP(shown);
        setLines(g.mesh, tagLines(g.tag, detail));
      }
      faceCamera(camera);
      const key = `${actions.map((a) => a.label).join('|')}|${state.history.length}|${state.message}|${state.plot}`;
      if (now - lastPaint > 100 || key !== paintKey) {
        model = panelModel(actions);
        const aspect = model.h / model.w;
        if (Math.abs(panel.geometry.parameters.height / panel.geometry.parameters.width - aspect) > 1e-3) {
          panel.geometry.dispose();
          panel.geometry = new THREE.PlaneGeometry(PANEL_W_M, PANEL_W_M * aspect);
        }
        paintPanel(canvases, model, state);
        panelTex.needsUpdate = true;
        lastPaint = now;
        paintKey = key;
      }
    },
  };
}
