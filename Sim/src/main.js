import 'katex/dist/katex.min.css';
import { createScene } from './scene/createScene.js';
import { LABS, COMING, labById } from './data/catalog.js';
import { parseHash, writeHash } from './engine/router.js';
import { loadLab } from './labs/load.js';
import { setLawEl, prose, mathText, escapeHTML } from './ui/shared.js';
import { setUnitSystem, unitSystem } from './ui/format.js';

/**
 * App shell. Deliberately thin: FLUX's main.js is bound to exams, problems and notes, so this was
 * written fresh against the same lab contract (labs/define.js) rather than stripped down.
 *
 * Modes (brief §5.1): Operate, Sequence, Test. Only Operate exists in M0; the others are shown
 * disabled with the milestone they arrive in.
 */
console.info(`Stand sim build ${__BUILD__.commit}${__BUILD__.subject ? ` — ${__BUILD__.subject}` : ''} (built ${__BUILD__.built})`);

const $id = (id) => document.getElementById(id);
const { renderer, scene, camera, controls, labels } = createScene($id('c'));
const ctx = { scene, camera, controls, renderer };

const app = { id: null, lab: null, handles: {}, slices: {}, computed: {}, dirty: true, gen: 0 };
// Read by scripts/smoke.mjs: which lab is mounted and what it computed.
window.__sim = { app, build: __BUILD__ };

function renderTabs() {
  const tabs = LABS.map(
    (l) => `<button type="button" role="tab" data-lab="${l.id}" aria-selected="${l.id === app.id}" class="${l.id === app.id ? 'active' : ''}">${escapeHTML(l.title)}</button>`,
  );
  const soon = COMING.map((c) => `<span class="tab-soon" title="Arrives in ${c.milestone}">${escapeHTML(c.title)} <small>${c.milestone}</small></span>`);
  $id('lab-tabs').innerHTML = tabs.join('') + soon.join('');
}

const STATUS_TEXT = {
  placeholder: 'placeholder — no physics',
  uncalibrated: 'uncalibrated — not a prediction of hardware',
  calibrated: 'calibrated against test data',
};

function renderPanels() {
  const { lab } = app;
  if (!lab) return;
  const s = app.slices[app.id];
  const c = app.computed;
  setLawEl($id('law'), lab.law(s, c));
  $id('eq-live').innerHTML = lab.liveRows(s, c);
  $id('readout').innerHTML = lab.readout(s, c);
  const coach = lab.coach(s, c);
  $id('coach').innerHTML = coach.title ? `<h3>${mathText(coach.title)}</h3>${prose(coach.body)}` : '';
  const st = $id('lab-status');
  st.textContent = STATUS_TEXT[lab.status] || lab.status;
  st.className = `lab-status ${lab.status}`;
  $id('hint').textContent = lab.hint;
}

async function openLab(id, { replace = false } = {}) {
  const gen = ++app.gen;
  const lab = await loadLab(id);
  if (!lab || gen !== app.gen) return;
  if (app.lab) app.lab.exit(ctx, app.handles[app.id], app.slices[app.id]);
  app.id = id;
  app.lab = lab;
  if (!app.slices[id]) app.slices[id] = lab.defaultState();
  if (!app.handles[id]) app.handles[id] = lab.init(ctx);
  controls.enableRotate = !!lab.orbit;
  lab.enter(ctx, app.handles[id], app.slices[id]);
  $id('setup').innerHTML = lab.controls(app.slices[id]);
  lab.bind({ state: app.slices[id], bump: () => (app.dirty = true) });
  writeHash(id, { replace });
  document.title = `${labById(id).title} — Stand Sim`;
  renderTabs();
  app.dirty = true;
}

$id('lab-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lab]');
  if (b) openLab(b.dataset.lab);
});

$id('units-toggle').addEventListener('click', () => {
  setUnitSystem(unitSystem() === 'us' ? 'si' : 'us');
  $id('units-toggle').textContent = unitSystem() === 'us' ? 'US units' : 'SI units';
  app.dirty = true;
});

window.addEventListener('hashchange', () => {
  const { id } = parseHash();
  if (id !== app.id) openLab(id, { replace: true });
});

function frame() {
  requestAnimationFrame(frame);
  const { lab } = app;
  if (lab) {
    const s = app.slices[app.id];
    if (lab.live || app.dirty) {
      lab.recompute(s, app.computed, ctx);
      lab.syncViews(s, app.computed, ctx, app.handles[app.id]);
      renderPanels();
      app.dirty = false;
    }
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
}

openLab(parseHash().id, { replace: true });
frame();
