import 'katex/dist/katex.min.css';
import * as THREE from 'three';
import { createScene } from './scene/createScene.js';
import { LABS, COMING, labById } from './data/catalog.js';
import { parseHash, writeHash } from './engine/router.js';
import { loadLab } from './labs/load.js';
import { setLawEl, prose, mathText, escapeHTML } from './ui/shared.js';
import { setUnitSystem, unitSystem } from './ui/format.js';
import { drawPlot } from './ui/plot.js';
import { renderPredict } from './ui/predict.js';
import { rampColorCVD } from './scene/manim.js';

/**
 * App shell. Deliberately thin: FLUX's main.js is bound to exams, problems and notes, so this was
 * written fresh against the same lab contract (labs/define.js) rather than stripped down.
 *
 * Modes (brief §5.1): Operate, Sequence, Test. Operate and Sequence are live; Test arrives in M6.
 */
console.info(`Stand sim build ${__BUILD__.commit}${__BUILD__.subject ? ` — ${__BUILD__.subject}` : ''} (built ${__BUILD__.built})`);

const $id = (id) => document.getElementById(id);
const canvas = $id('c');
const { renderer, scene, camera, controls, labels } = createScene(canvas);
const ctx = { scene, camera, controls, renderer };
const clock = new THREE.Clock();

const app = { id: null, lab: null, handles: {}, slices: {}, computed: {}, dirty: true, gen: 0, mode: 'operate' };
// Read by scripts/smoke.mjs: which lab is mounted, what it computed, and its handle.
window.__sim = { app, build: __BUILD__ };

function renderTabs() {
  const tabs = LABS.map(
    (l) => `<button type="button" role="tab" data-lab="${l.id}" aria-selected="${l.id === app.id}" class="${l.id === app.id ? 'active' : ''}${l.kind === 'stand' ? ' stand' : ''}">${escapeHTML(l.title)}</button>`,
  );
  const soon = COMING.map((c) => `<span class="tab-soon" title="Arrives in ${c.milestone}">${escapeHTML(c.title)} <small>${c.milestone}</small></span>`);
  $id('lab-tabs').innerHTML = tabs.join('') + soon.join('');
}

const STATUS_TEXT = {
  placeholder: 'placeholder — no physics',
  uncalibrated: 'uncalibrated — not a prediction of hardware',
  calibrated: 'calibrated against test data',
};

// Pressure legend: the same colour-blind-safe ramp the P&ID lines use.
(function legend() {
  const c = new THREE.Color();
  const stops = Array.from({ length: 7 }, (_, i) => {
    rampColorCVD(i / 6, c);
    return `#${c.getHexString()} ${Math.round((i / 6) * 100)}%`;
  });
  $id('legend-bar').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
})();

function renderPanels() {
  const { lab } = app;
  if (!lab) return;
  const s = app.slices[app.id];
  const c = app.computed;
  const h = app.handles[app.id];
  setLawEl($id('law'), lab.law(s, c));
  $id('eq-live').innerHTML = lab.liveRows(s, c);
  $id('readout').innerHTML = lab.readout(s, c);
  const coach = lab.coach(s, c);
  $id('coach').innerHTML = coach.title ? `<h3>${mathText(coach.title)}</h3>${prose(coach.body)}` : '';
  renderPredict($id('predict'), lab.predict(s, c), () => (app.dirty = true));
  const st = $id('lab-status');
  st.textContent = STATUS_TEXT[lab.status] || lab.status;
  st.className = `lab-status ${lab.status}`;
  $id('hint').textContent = lab.hint;
  const spec = lab.plot(s, c, h);
  $id('plot-panel').hidden = !spec;
  if (spec) drawPlot($id('plot'), spec);
}

async function openLab(id, { replace = false } = {}) {
  const gen = ++app.gen;
  const lab = await loadLab(id);
  if (!lab || gen !== app.gen) return;
  if (app.lab) app.lab.exit(ctx, app.handles[app.id], app.slices[app.id]);
  app.id = id;
  app.lab = lab;
  if (!app.slices[id]) app.slices[id] = lab.defaultState();
  if (lab.setMode) app.slices[id].mode = app.mode;
  if (!app.handles[id]) app.handles[id] = lab.init(ctx);
  const h = app.handles[id];
  controls.enableRotate = !!lab.orbit;
  const v = lab.view;
  camera.position.set(v.x, v.y, v.z);
  controls.target.set(v.x, v.y, 0);
  lab.enter(ctx, h, app.slices[id]);
  const root = $id('setup');
  root.innerHTML = lab.controls(app.slices[id]);
  lab.bind({ state: app.slices[id], bump: () => (app.dirty = true), root, handle: h });
  // Start the stand, and restart it only when the mode changed. Coming back keeps the run.
  if (lab.setMode && h.mode !== app.mode) lab.setMode(app.slices[id], h, app.mode);
  writeHash(id, { replace });
  document.title = `${labById(id).title} — Stand Sim`;
  renderTabs();
  app.dirty = true;
}

$id('lab-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lab]');
  if (b) openLab(b.dataset.lab);
});

function paintModes() {
  for (const mode of ['operate', 'sequence']) {
    const b = $id(`mode-${mode}`);
    const on = app.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

function refreshControls() {
  const { lab } = app;
  if (!lab) return;
  const root = $id('setup');
  const s = app.slices[app.id];
  root.innerHTML = lab.controls(s);
  lab.bind({ state: s, bump: () => (app.dirty = true), root, handle: app.handles[app.id] });
}

async function setMode(mode) {
  if (mode === app.mode && !(mode === 'sequence' && app.id !== 'gn2-coldflow')) return;
  app.mode = mode;
  paintModes();
  if (mode === 'sequence' && app.id !== 'gn2-coldflow') {
    await openLab('gn2-coldflow');
    return;
  }
  const { lab } = app;
  if (lab?.setMode) lab.setMode(app.slices[app.id], app.handles[app.id], mode);
  refreshControls();
  app.dirty = true;
}

$id('mode-operate').addEventListener('click', () => setMode('operate'));
$id('mode-sequence').addEventListener('click', () => setMode('sequence'));

$id('units-toggle').addEventListener('click', () => {
  setUnitSystem(unitSystem() === 'us' ? 'si' : 'us');
  $id('units-toggle').textContent = unitSystem() === 'us' ? 'US units' : 'SI units';
  app.dirty = true;
});

// Click on the schematic: hand the P&ID element under the pointer to the lab.
const ndc = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => {
  const { lab } = app;
  const h = app.handles[app.id];
  if (!lab?.onPick || !h?.pid) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const tag = h.pid.pick(ndc, camera);
  if (tag) {
    lab.onPick(tag, h);
    app.dirty = true;
  }
});

window.addEventListener('hashchange', () => {
  const { id } = parseHash();
  if (id !== app.id) openLab(id, { replace: true });
});

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta());
  const { lab } = app;
  if (lab) {
    const s = app.slices[app.id];
    const h = app.handles[app.id];
    if (lab.tick && lab.tick(dt, s, app.computed, h)) app.dirty = true;
    if (app.dirty) {
      lab.recompute(s, app.computed, ctx, h);
      lab.syncViews(s, app.computed, ctx, h);
      renderPanels();
      app.dirty = false;
    } else if (h?.pid) {
      // Keep the flow dots moving between physics updates.
      const c = app.computed[app.id];
      // A readout has nodes. injector.now is the operating point, not a readout.
      const r = [c?.readout, c?.now, c?.r?.final, c?.final].find((x) => x?.nodes);
      if (r) h.pid.update(r, dt);
    }
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
}

openLab(parseHash().id, { replace: true });
frame();
