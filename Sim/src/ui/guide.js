/**
 * The guide: the guided path through data/course.js, shown as a card at the top of the right
 * panel. It opens each lesson's lab and mode, ticks steps off as the sim reaches them, and marks
 * the one control to press next in yellow (brief §5.3), on the P&ID or in the panels.
 *
 * Progress (current lesson, completed lessons) is kept in localStorage as a convenience; the page
 * works the same without it.
 */
import { COURSE } from '../data/course.js';
import { mathText, escapeHTML } from './shared.js';

const KEY = 'standsim.guide.v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function save(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // private window or blocked storage: progress is not kept, nothing else changes
  }
}

/** Markdown-ish bold in lesson text: **x** → <b>x</b>, after the $…$ math pass. */
const md = (s) => mathText(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/**
 * api: { app, openLab(id), setMode(mode), refresh(), isStand(id), el (the card element) }.
 */
export function createGuide(api) {
  const saved = load();
  const g = {
    active: false,
    index: Math.min(COURSE.length - 1, Math.max(0, saved.index ?? 0)),
    completed: new Set(saved.completed || []),
    step: 0,
    mem: {},
    html: '',
    lastMarked: null,
  };
  const lesson = () => COURSE[g.index];
  const persist = () => save({ index: g.index, completed: [...g.completed] });
  const handle = () => api.app.handles[api.app.id];
  const actionApi = { handle, state: () => api.app.slices[api.app.id], refresh: api.refresh };

  async function open(i, { go = true } = {}) {
    g.index = Math.max(0, Math.min(COURSE.length - 1, i));
    g.step = 0;
    g.mem = {};
    g.active = true;
    persist();
    const l = lesson();
    if (go) {
      await api.openLab(l.lab);
      if (l.mode && api.isStand(l.lab)) await api.setMode(l.mode);
    }
    render(true);
  }

  function close() {
    g.active = false;
    mark(null);
    render(true);
  }

  function ctx() {
    const a = api.app;
    const c = a.computed[a.id];
    return { s: a.slices[a.id] || {}, c, h: a.handles[a.id], mode: a.mode, t: c?.t ?? 0 };
  }

  /** Put the yellow mark on the current step's control, and take it off everything else. */
  function mark(step) {
    const h = handle();
    const x = step && api.app.id === lesson().lab ? step.next : null;
    const tag = x?.tag ? (typeof x.tag === 'function' ? x.tag(ctx()) : x.tag) : null;
    for (const hh of Object.values(api.app.handles)) if (hh?.pid?.setNext && hh !== h) hh.pid.setNext(null);
    if (h?.pid?.setNext) h.pid.setNext(tag);
    const sel = x?.control || (tag ? `[data-valve="${tag}"]` : null);
    const el = sel ? document.querySelector(sel) : null;
    if (el !== g.lastMarked) {
      g.lastMarked?.classList.remove('guide-next');
      el?.classList.add('guide-next');
      g.lastMarked = el;
    }
  }

  function render(force = false) {
    const el = api.el;
    if (!g.active) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const l = lesson();
    const here = api.app.id === l.lab;
    const done = g.step >= l.steps.length;
    const steps = l.steps
      .map((st, i) => {
        const cls = i < g.step ? 'done' : i === g.step ? 'now' : '';
        const act = i === g.step && here && st.action ? ` <button type="button" class="guide-act" data-act="${i}">${escapeHTML(st.action.label)}</button>` : '';
        return `<li class="${cls}">${md(st.text)}${act}</li>`;
      })
      .join('');
    const html = `
      <div class="guide-head"><span class="guide-count">Lesson ${g.index + 1} of ${COURSE.length}</span>
        <button type="button" class="guide-x" data-g="close" aria-label="Close the guide">×</button></div>
      <div class="guide-title">${escapeHTML(l.title)}</div>
      <p class="guide-goal">${md(l.goal)}</p>
      ${here ? '' : `<button type="button" class="guide-go guide-next" data-g="go">Open ${escapeHTML(l.lab)} for this lesson</button>`}
      <ol class="guide-steps">${steps}</ol>
      ${done ? `<p class="guide-take"><b>Takeaway.</b> ${md(l.takeaway)}</p>` : ''}
      <div class="guide-nav">
        <button type="button" data-g="prev"${g.index === 0 ? ' disabled' : ''}>← Back</button>
        <select data-g="pick" aria-label="Lessons">${COURSE.map((c, i) => `<option value="${i}"${i === g.index ? ' selected' : ''}>${i + 1}. ${escapeHTML(c.title)}${g.completed.has(c.id) ? ' ✓' : ''}</option>`).join('')}</select>
        <button type="button" data-g="next" class="${done ? 'guide-next' : ''}"${g.index === COURSE.length - 1 ? ' disabled' : ''}>Next →</button>
      </div>`;
    if (force || html !== g.html) {
      g.html = html;
      el.innerHTML = html;
    }
  }

  api.el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act != null) {
      lesson().steps[Number(b.dataset.act)].action.run(actionApi);
      return;
    }
    const k = b.dataset.g;
    if (k === 'close') close();
    else if (k === 'go') open(g.index);
    else if (k === 'prev') open(g.index - 1);
    else if (k === 'next') open(g.index + 1);
  });
  api.el.addEventListener('change', (e) => {
    if (e.target.dataset.g === 'pick') open(Number(e.target.value));
  });

  /** Every frame: tick the current step if it is done, and keep the yellow mark on the next control. */
  function tick() {
    if (!g.active) return;
    const l = lesson();
    if (api.app.id === l.lab && g.step < l.steps.length) {
      let st = l.steps[g.step];
      let moved = false;
      try {
        while (st && st.done(ctx(), g.mem)) {
          g.step++;
          moved = true;
          st = l.steps[g.step];
        }
      } catch {
        // a check that reads something the lab has not computed yet is simply not done
      }
      if (g.step >= l.steps.length && !g.completed.has(l.id)) {
        g.completed.add(l.id);
        persist();
      }
      if (moved) render(true);
    }
    mark(l.steps[g.step] || null);
    render();
  }

  return { open, close, tick, get active() { return g.active; }, get index() { return g.index; }, state: g, hasProgress: () => saved.index != null };
}
