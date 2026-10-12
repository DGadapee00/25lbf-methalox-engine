/**
 * Quest page for the single-circuit GN₂ stand.
 *
 * The desktop app (index.html) is unchanged apart from an Enter VR link.
 * Physics stays in the existing Web Worker. This file is the spatial view:
 * real-scale meshes, gauges, and the same Operate commands.
 *
 * IWSDK is not used. The reasons are in docs/vr-plan.md: this repo is the
 * Vite 6 / three.js sim that already deploys, and IWSDK 1.0.1 wants Vite 7,
 * its own three build, and to own the render loop. A first playable slice
 * only needs WebXR on the worker we already have. IWER emulates a Quest 3
 * when there is no headset.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RIG_BELOW_EYE_M, RIG_FORWARD_M, gn2Layout } from './scale.js';
import { createVrSession } from './session.js';
import { createStandView } from './view.js';
import { createInteraction, placeInFront } from './interact.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const layout = gn2Layout();
const session = createVrSession();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x0b0c0e, 1);
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(1);
renderer.xr.setFoveation(0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.02, layout.span + RIG_FORWARD_M * 8);
const man = layout.stations.manifold;
camera.position.set(man[0], RIG_BELOW_EYE_M, man[2] + RIG_FORWARD_M);
camera.lookAt(man[0], 0, man[2]);

const controls = new OrbitControls(camera, canvas);
controls.target.set(man[0], 0, man[2]);
controls.enableDamping = true;
controls.maxDistance = layout.span;
controls.minDistance = 0.2;

scene.add(new THREE.HemisphereLight(0xc8c2bc, 0x1a1c20, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(2, 4, 3);
scene.add(sun);

const view = createStandView(layout, session.spec);
scene.add(view.root);
const interaction = createInteraction({ renderer, scene, camera, canvas, view, session, layout });

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
resize();
window.addEventListener('resize', resize);

const stats = { calls: 0, triangles: 0, dt: 0 };
let placeOnNext = false;
renderer.xr.addEventListener('sessionstart', () => {
  placeOnNext = true;
});

let actions = session.actions();
let actionKey = '';
function currentActions() {
  const s = session.state;
  const key = `${s.paused}|${s.scale}|${s.plot}|${s.amount}|${s.pSetPsia['PCV-OX-01']}`;
  if (key !== actionKey) {
    actionKey = key;
    actions = session.actions();
  }
  return actions;
}

function say(text) {
  const el = $('vr-status');
  if (el) el.textContent = text;
}

function paintReadout() {
  const s = session.state;
  const hv = s.readout?.edges?.['HV-OX-01'];
  const el = $('vr-readout');
  if (!el) return;
  const bits = ['UNCALIBRATED'];
  bits.push(s.ready ? `t ${s.t.toFixed(2)} s` : 'starting the worker');
  if (hv) bits.push(`HV-OX-01 ${hv.stuck ? 'stuck' : hv.x > 0.5 ? 'open' : 'shut'}`);
  if (s.message) bits.push(s.message);
  el.textContent = bits.join(' · ');
}

function paintFallback() {
  const list = currentActions();
  const sig = list.map((a) => a.label).join('|');
  const root = $('vr-actions');
  if (!root || root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  root.replaceChildren();
  for (const a of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    b.dataset.act = a.id;
    b.addEventListener('click', () => session.dispatch(a.act));
    root.appendChild(b);
  }
}

async function enterVR() {
  const xr = navigator.xr;
  if (!xr) {
    say('No WebXR in this browser. Emulate Quest 3, or open this page in Quest Browser over HTTPS.');
    return;
  }
  let xrSession;
  try {
    xrSession = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
  } catch (err) {
    say(err?.message || String(err));
    return;
  }
  const floor = xrSession.enabledFeatures?.includes('local-floor');
  renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
  await renderer.xr.setSession(xrSession);
  if (xrSession.updateTargetFrameRate) {
    try {
      await xrSession.updateTargetFrameRate(72);
    } catch {
      // The headset keeps its display rate. 72 is the target, not a promise.
    }
  }
  xrSession.addEventListener('end', () => say('Left VR. The desktop view is still running.'));
  say(floor ? 'In VR, floor reference.' : 'In VR, local reference.');
}

// The emulator is a separate download (IWER, its overlay, a second three.js).
// A Quest session never asks for it. See docs/vr-plan.md.
let emulator = null;
async function ensureEmulator() {
  if (!emulator) emulator = await import('./emulate.js');
  emulator.installEmulator();
  return emulator;
}

$('vr-enter').addEventListener('click', () => enterVR());
$('vr-emulate').addEventListener('click', async () => {
  await ensureEmulator();
  say('Quest 3 emulator on. Starting the session.');
  await enterVR();
});

window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    session.dispatch({ type: 'pause' });
  } else if (ev.key === 'r' || ev.key === 'R') session.dispatch({ type: 'reset' });
});

const api = {
  ready: false,
  stand: session.standId,
  stats,
  get state() {
    return session.state;
  },
  dispatch: (act) => session.dispatch(act),
  pickTag: (tag) => interaction.pickTag(tag),
  audit() {
    const p = view.root.position;
    const q = view.root.quaternion;
    return {
      tags: Object.keys(view.byTag),
      gauges: Object.keys(layout.gauges),
      placard: layout.placard,
      runs: layout.runs,
      tubeOd: layout.tubeOd,
      triangles: stats.triangles,
      calls: stats.calls,
      t: session.state.t,
      ready: session.state.ready,
      paused: session.state.paused,
      readout: session.state.readout,
      pSetPsia: { ...session.state.pSetPsia },
      message: session.state.message,
      presenting: renderer.xr.isPresenting,
      pose: { x: p.x, y: p.y, z: p.z, qy: q.y },
    };
  },
};
window.__vr = api;

let last = performance.now();
renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  session.tick(dt);
  if (placeOnNext && renderer.xr.isPresenting) {
    const cam = renderer.xr.getCamera();
    placeInFront(view.root, layout.stations.manifold, cam.position, cam.quaternion);
    view.setFloorLocal(-view.root.position.y);
    placeOnNext = false;
  }
  interaction.update(frame);
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  view.update(session.state, currentActions(), cam, now);
  controls.enabled = !renderer.xr.isPresenting;
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
  stats.calls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
  stats.dt = dt;
  if (emulator) emulator.renderEmulator(now);
  paintFallback();
  paintReadout();
  api.ready = session.state.ready && stats.triangles > 0;
});

if (new URLSearchParams(location.search).has('emulate')) {
  ensureEmulator().then(() => enterVR());
}

paintFallback();
say('Desktop view. Enter VR on a headset, or emulate a Quest 3.');
