/**
 * The glossary drawer, opened from the header: the P&ID symbol key and every term the panels use,
 * both searchable.
 */
import { GLOSSARY, SYMBOLS } from '../data/glossary.js';
import { mathText, tex, escapeHTML } from './shared.js';
import { symbolFigure } from './symbolKey.js';

export function createGlossary(el) {
  let built = false;
  let tab = 'symbols';
  function show(t) {
    tab = t;
    el.querySelectorAll('[data-gl-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.glTab === t)));
    el.querySelectorAll('[data-gl-pane]').forEach((p) => (p.hidden = p.dataset.glPane !== t));
  }
  function build() {
    el.innerHTML = `
      <div class="gl-head"><b>Glossary</b><button type="button" class="guide-x" data-gl="close" aria-label="Close the glossary">×</button></div>
      <div class="gl-tabs" role="tablist">
        <button type="button" role="tab" data-gl-tab="symbols">Symbols</button>
        <button type="button" role="tab" data-gl-tab="terms">Terms</button>
      </div>
      <input type="search" class="gl-search" placeholder="Search" aria-label="Search the glossary">
      <div class="gl-list" data-gl-pane="symbols">
        <p class="gl-intro">What each mark on the schematic means. Hover over any element on the P&amp;ID for its live values.</p>
        ${SYMBOLS.map((g) => `<div class="gl-item gl-sym" data-text="${escapeHTML(`${g.name} ${g.def} ${g.where || ''}`.toLowerCase())}">${symbolFigure(g.draw)}<dl><dt>${escapeHTML(g.name)}</dt><dd>${mathText(g.def)}${g.where ? `<div class="gl-where">On the stands: ${escapeHTML(g.where)}</div>` : ''}</dd></dl></div>`).join('')}
      </div>
      <dl class="gl-list" data-gl-pane="terms">${GLOSSARY.map((g) => `<div class="gl-item" data-text="${escapeHTML(`${g.term} ${g.def}`.toLowerCase())}"><dt>${escapeHTML(g.term)}</dt><dd>${mathText(g.def)}${g.formula ? `<div class="gl-formula">${tex(g.formula)}</div>` : ''}${g.where ? `<div class="gl-where">In the sim: ${escapeHTML(g.where)}</div>` : ''}</dd></div>`).join('')}</dl>`;
    el.querySelector('[data-gl="close"]').addEventListener('click', () => toggle(false));
    el.querySelectorAll('[data-gl-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.glTab)));
    el.querySelector('.gl-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      el.querySelectorAll('.gl-item').forEach((it) => (it.hidden = q && !it.dataset.text.includes(q)));
      // A search shows whichever list has matches, symbols first.
      if (q) {
        const hits = (p) => el.querySelector(`[data-gl-pane="${p}"] .gl-item:not([hidden])`);
        if (!hits(tab)) show(hits('symbols') ? 'symbols' : 'terms');
      }
    });
    built = true;
    show(tab);
  }
  /** Open (or close) the drawer; `section` ('symbols' | 'terms') picks the tab. */
  function toggle(on = el.hidden, section = null) {
    if (on && !built) build();
    if (on && section) show(section);
    el.hidden = !on;
    if (on) el.querySelector('.gl-search')?.focus();
  }
  return { toggle, show: (t) => (built ? show(t) : (tab = t)) };
}
