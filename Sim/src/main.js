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
import { inspectorHTML } from './ui/inspector.js';
import { createGuide } from './ui/guide.js';
import { COURSE } from './data/course.js';
import { createGlossary } from './ui/glossary.js';

/**
 * App shell. Deliberately thin: FLUX's main.js is bound to exams, problems and notes, so this was
 * written fresh against the same lab contract (labs/define.js) rather than stripped down.
 *
 * Modes (brief §5.1): Operate, Sequence, Test. Operate and Sequence are live; Test (M6) predicts,
 * imports a DAQ log, overlays and fits (labs/testPanel.js). Sequence and Test belong to stands.
 */
console.info(`Stand sim build ${__BUILD__.commit}${__BUILD__.subject ? ` — ${__BUILD__.subject}` : ''} (built ${__BUILD__.built})`);

const $id = (id) => document.getElementById(id);
const canvas = $id('c');
const { renderer, scene, camera, controls, labels } = createScene(canvas);
const ctx = { scene, camera, controls, renderer };
const clock = new THREE.Clock();

const app = { id: null, lab: null, handles: {}, slices: {}, computed: {}, dirty: true, gen: 0, mode: 'operate' };
// Read by scripts/smoke.mjs: which lab is mounted, what it computed, and its handle.
window.__sim = { app, build: __BUILD__, ctx };
/** Screen position (CSS px) of a scene point: for the smoke test and the guide's highlights. */
window.__sim.toScreen = (x, y) => {
  const v = new THREE.Vector3(x, y, 0).project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
};

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
  // The readout bar grows when a cell carries a caveat; the plot and legend sit above it.
  const rb = document.querySelector('.readout-bar')?.offsetHeight || 84;
  document.documentElement.style.setProperty('--rb', `${rb}px`);
  const spec = lab.plot(s, c, h);
  $id('plot-panel').hidden = !spec;
  if (spec) drawPlot($id('plot'), spec);
}

async function openLab(id, { replace = false } = {}) {
  const gen = ++app.gen;
  showInspector(null);
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
  for (const mode of ['operate', 'sequence', 'test']) {
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

function isStand(id) {
  return labById(id)?.kind === 'stand';
}

async function setMode(mode) {
  if (mode === app.mode && !(mode !== 'operate' && !isStand(app.id))) return;
  app.mode = mode;
  paintModes();
  if (mode !== 'operate' && !isStand(app.id)) {
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
$id('mode-test').addEventListener('click', () => setMode('test'));

$id('units-toggle').addEventListener('click', () => {
  setUnitSystem(unitSystem() === 'us' ? 'si' : 'us');
  $id('units-toggle').textContent = unitSystem() === 'us' ? 'US units' : 'SI units';
  app.dirty = true;
});

// Click on the schematic: hand the P&ID element under the pointer to the lab.
const ndc = new THREE.Vector2();
const toNdc = (e) => {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};
canvas.addEventListener('pointerdown', (e) => {
  const { lab } = app;
  const h = app.handles[app.id];
  if (!h?.pid) return;
  toNdc(e);
  // A tap shows the inspector (there is no hover on a touch screen); a click on a valve also toggles it.
  if (e.pointerType !== 'mouse') {
    const r = canvas.getBoundingClientRect();
    showInspector(h.pid.inspect(ndc, camera, { px: 24, w: r.width, h: r.height }), e.clientX, e.clientY);
  }
  if (!lab?.onPick) return;
  const tag = h.pid.pick(ndc, camera);
  if (tag) {
    lab.onPick(tag, h);
    app.dirty = true;
  }
});

// Inspector (brief §5.2): hover any element for what it is, its live state and its law.
const insEl = $id('inspector');
const ins = { target: null, x: 0, y: 0, last: 0 };
function placeInspector() {
  const w = insEl.offsetWidth;
  const hgt = insEl.offsetHeight;
  const x = Math.min(window.innerWidth - w - 8, ins.x + 16);
  const y = Math.min(window.innerHeight - hgt - 8, ins.y + 16);
  insEl.style.left = `${Math.max(8, x)}px`;
  insEl.style.top = `${Math.max(8, y)}px`;
}
function renderInspector() {
  const h = app.handles[app.id];
  if (!ins.target || !h?.pid) return;
  insEl.innerHTML = inspectorHTML(ins.target, h.pid);
  placeInspector();
}
function showInspector(target, x, y) {
  ins.target = target;
  ins.x = x;
  ins.y = y;
  insEl.hidden = !target;
  canvas.style.cursor = target ? 'help' : '';
  if (target) renderInspector();
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const h = app.handles[app.id];
  if (!h?.pid) return showInspector(null);
  toNdc(e);
  const t = h.pid.inspect(ndc, camera);
  if (t?.kind !== ins.target?.kind || t?.id !== ins.target?.id) showInspector(t, e.clientX, e.clientY);
  else if (t) {
    ins.x = e.clientX;
    ins.y = e.clientY;
    placeInspector();
  }
  if (t && h.pid.pick(ndc, camera)) canvas.style.cursor = 'pointer';
});
// A finger lifting also "leaves"; only a mouse leaving the canvas closes the card. On touch, the
// next tap elsewhere (or Esc) replaces or closes it.
canvas.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && showInspector(null));

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
  guide.tick();
  // Keep an open inspector live, a few times a second.
  if (ins.target && performance.now() - ins.last > 150) {
    ins.last = performance.now();
    renderInspector();
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
}

// The guided path and the first-visit welcome.
const guide = createGuide({ app, openLab, setMode, refresh: refreshControls, isStand, el: $id('guide') });
// Desktop: the guide heads the right panel. Phone: the panels stack, so it goes under the header.
const phone = window.matchMedia('(max-width: 720px)');
const placeGuide = () => {
  const el = $id('guide');
  if (phone.matches) document.querySelector('.brand').after(el);
  else document.querySelector('.eq-panel').prepend(el);
};
placeGuide();
phone.addEventListener?.('change', placeGuide);
window.__sim.guide = guide;
window.__sim.lessonIds = COURSE.map((l) => l.id);
$id('guide-btn').addEventListener('click', () => (guide.active ? guide.close() : guide.open(guide.index)));
const glossary = createGlossary($id('glossary'));
$id('glossary-btn').addEventListener('click', () => glossary.toggle());
const WELCOME = 'standsim.welcome.v1';
let seen = false;
try {
  seen = localStorage.getItem(WELCOME) === '1';
} catch {
  // storage blocked: show it
}
const welcome = $id('welcome');
const dismiss = () => {
  welcome.hidden = true;
  try {
    localStorage.setItem(WELCOME, '1');
  } catch {
    // not kept
  }
};
// Automated browsers (the smoke test) skip it: it would sit over the controls they click.
if (!seen && !navigator.webdriver) welcome.hidden = false;
$id('welcome-start').addEventListener('click', () => {
  dismiss();
  guide.open(guide.hasProgress() ? guide.index : 0);
});
$id('welcome-explore').addEventListener('click', dismiss);
welcome.addEventListener('click', (e) => e.target === welcome && dismiss());

// Keys: Space pause/resume and R reset (stands), G the guide, ? the glossary, Esc closes overlays.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, select, textarea')) return;
  const { lab } = app;
  if (e.key === 'Escape') {
    showInspector(null);
    glossary.toggle(false);
    if (!welcome.hidden) dismiss();
    return;
  }
  if (e.key === '?') glossary.toggle();
  else if (e.key === 'g' || e.key === 'G') (guide.active ? guide.close() : guide.open(guide.index));
  else if ((e.key === ' ' || e.key === 'r' || e.key === 'R') && lab?.onKey) {
    e.preventDefault();
    lab.onKey(e.key === ' ' ? 'space' : 'reset', app.slices[app.id], app.handles[app.id]);
    refreshControls();
  } else return;
  app.dirty = true;
});

openLab(parseHash().id, { replace: true });
frame();
