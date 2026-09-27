/**
 * The glossary drawer: every term the panels use, searchable. Opened from the header.
 */
import { GLOSSARY } from '../data/glossary.js';
import { mathText, tex, escapeHTML } from './shared.js';

export function createGlossary(el) {
  let built = false;
  function build() {
    el.innerHTML = `
      <div class="gl-head"><b>Glossary</b><button type="button" class="guide-x" data-gl="close" aria-label="Close the glossary">×</button></div>
      <input type="search" class="gl-search" placeholder="Search terms" aria-label="Search the glossary">
      <dl class="gl-list">${GLOSSARY.map((g) => `<div class="gl-item" data-text="${escapeHTML(`${g.term} ${g.def}`.toLowerCase())}"><dt>${escapeHTML(g.term)}</dt><dd>${mathText(g.def)}${g.formula ? `<div class="gl-formula">${tex(g.formula)}</div>` : ''}${g.where ? `<div class="gl-where">In the sim: ${escapeHTML(g.where)}</div>` : ''}</dd></div>`).join('')}</dl>`;
    el.querySelector('[data-gl="close"]').addEventListener('click', () => toggle(false));
    el.querySelector('.gl-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      el.querySelectorAll('.gl-item').forEach((it) => (it.hidden = q && !it.dataset.text.includes(q)));
    });
    built = true;
  }
  function toggle(on = el.hidden) {
    if (on && !built) build();
    el.hidden = !on;
    if (on) el.querySelector('.gl-search')?.focus();
  }
  return { toggle };
}
