/**
 * Predict first (brief §6.1), after FLUX's engine/predict.js: a card states a change, you pick
 * what you think happens, then the lab's own physics answers. The answer is computed from the
 * current state every time — never typed in — so a card cannot drift from the model it quizzes.
 *
 * A lab's predict(state) returns cards: [{ id, q, options: [label…], answer: index, why }], where
 * `answer` and `why` come from running the lab's physics on the changed state.
 */
import { mathText, escapeHTML } from './shared.js';

const picked = new Map(); // card id → chosen index, kept while the lab is open

export function renderPredict(el, cards, onPick) {
  if (!el) return;
  if (!cards || !cards.length) {
    if (el.innerHTML) el.innerHTML = '';
    el.dataset.html = '';
    return;
  }
  // Rebuild only when something changed: an animating lab calls this every frame, and replacing
  // the buttons under the pointer would swallow the click.
  const html = cards
    .map((c) => {
      const choice = picked.get(c.id);
      const done = choice !== undefined;
      const opts = c.options
        .map((o, i) => {
          const cls = done ? (i === c.answer ? 'right' : i === choice ? 'wrong' : '') : '';
          return `<button type="button" class="predict-opt ${cls}" data-card="${escapeHTML(c.id)}" data-i="${i}" ${done ? 'disabled' : ''}>${mathText(o)}</button>`;
        })
        .join('');
      const verdict = done ? `<p class="predict-why"><b>${choice === c.answer ? 'Right.' : 'Not quite.'}</b> ${mathText(c.why)}</p>` : '';
      return `<div class="predict-card"><div class="predict-q"><span class="predict-tag">Predict first</span> ${mathText(c.q)}</div><div class="predict-opts">${opts}</div>${verdict}</div>`;
    })
    .join('');
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
  el.onclick = (e) => {
    const b = e.target.closest('button[data-card]');
    if (!b) return;
    picked.set(b.dataset.card, Number(b.dataset.i));
    onPick?.();
  };
}

export function resetPredict() {
  picked.clear();
}

/** Has a card whose id starts with `prefix` been answered (this session)? For the guide. */
export function answered(prefix) {
  for (const k of picked.keys()) if (k.startsWith(prefix)) return true;
  return false;
}
