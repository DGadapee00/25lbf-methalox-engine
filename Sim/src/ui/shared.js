import katex from 'katex';

const TEX_MACROS = {
  // House style, so every panel spells the same quantity the same way.
  '\\mdot': '\\dot m',
  '\\CdA': 'C_dA',
  '\\Pc': 'P_c',
};

const texCache = new Map();

export function tex(src, display = false) {
  const key = display ? `D:${src}` : src;
  let html = texCache.get(key);
  if (!html) {
    html = katex.renderToString(src, { throwOnError: false, displayMode: display, macros: TEX_MACROS });
    texCache.set(key, html);
  }
  return html;
}

/**
 * Panel text is written in a light markup: prose with math between `$…$`, typeset by KaTeX, so a
 * row label, an explainer and the law at the top of the panel all render the same way.
 *
 * Text outside the delimiters passes through as HTML — every string here is authored in this repo,
 * and several carry `<sup>`/`<sub>` from the number formatters.
 */
export function mathText(s, escape = false) {
  const keep = escape ? escapeHTML : (x) => x;
  const str = s == null ? '' : String(s);
  if (str.indexOf('$') < 0) return keep(str);
  let out = '';
  let i = 0;
  for (;;) {
    const a = str.indexOf('$', i);
    if (a < 0) return out + keep(str.slice(i));
    const b = str.indexOf('$', a + 1);
    if (b < 0) return out + keep(str.slice(i));
    out += keep(str.slice(i, a)) + tex(str.slice(a + 1, b));
    i = b + 1;
  }
}

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESC[c]);

/**
 * Prose that may carry math but never markup: everything outside `$…$` is escaped. Problem
 * statements, worked steps and hints go through this — they are prose, and they contain `<` and
 * `>` often enough ("$q < 0$", "r > R") that passing them through as HTML would be a mistake.
 */
export const mathProse = (s) => mathText(s, true);

/** A displayed (centered) equation inside an explainer body. */
export const eq = (src) => ({ eq: src });

/**
 * An explainer body: a string, or a list of paragraphs and `eq(...)` display equations — the way a
 * textbook sets a short argument, with the equation it turns on given a line of its own.
 */
export function prose(body) {
  const blocks = Array.isArray(body) ? body : [body];
  return blocks
    .filter(Boolean)
    .map((b) => (b.eq ? `<div class="prose-eq">${tex(b.eq, true)}</div>` : `<p>${mathText(b)}</p>`))
    .join('');
}

export function kv(k, v) {
  return `<div class="row"><span class="k">${mathText(k)}</span><span class="v">${mathText(v)}</span></div>`;
}

export function qv(cls, v) {
  return `<span class="${cls}">${v}</span>`;
}

export function cells(items) {
  return items
    .map(
      ([label, value, cls]) =>
        `<div class="cell"><div class="label">${mathText(label)}</div><div class="value ${cls || ''}">${mathText(value)}</div></div>`,
    )
    .join('');
}

export function matchClass(pct) {
  if (pct >= 97) return 'ok';
  if (pct >= 90) return 'warn';
  return 'bad';
}

export function setLawEl(el, lines) {
  el.innerHTML = (lines || []).map((l) => `<div class="law-row">${tex(l)}</div>`).join('');
}
