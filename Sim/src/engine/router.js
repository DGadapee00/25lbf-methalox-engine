import { LABS, labById } from '../data/catalog.js';

/**
 * Hash routes (brief §3.1): `#/lab/blowdown?case=adiabatic`, `#/stand/coldflow`. Anything that does
 * not name a known lab opens the first one, so a stale link still lands somewhere.
 *
 * Returns { kind, id, params } where params is a URLSearchParams of the query.
 */
export function parseHash(hash = typeof location === 'undefined' ? '' : location.hash) {
  const full = String(hash).replace(/^#\/?/, '');
  const [raw, query = ''] = full.split('?');
  const params = new URLSearchParams(query);
  const [kind, id] = raw.split('/').filter(Boolean);
  const lab = labById(id);
  if (lab && lab.kind === kind) return { kind, id, params };
  const first = LABS[0];
  return { kind: first.kind, id: first.id, params: new URLSearchParams() };
}

export function hashFor(id, params) {
  const lab = labById(id);
  if (!lab) return '#/';
  const q = params && String(params) ? `?${params}` : '';
  return `#/${lab.kind}/${lab.id}${q}`;
}

/** Each lab switch is a history entry; `replace` is for boot, where we only normalize the URL. */
export function writeHash(id, { replace = false, params = null } = {}) {
  const next = hashFor(id, params);
  if (location.hash === next) return;
  if (replace) history.replaceState(null, '', next);
  else history.pushState(null, '', next);
}
