/** Lazy lab loaders, keyed by lab id (see data/catalog.js for what each one is). */
const loaders = {
  blowdown: () => import('./blowdown.js'),
  orifice: () => import('./orifice.js'),
  regulator: () => import('./regulator.js'),
  'valve-timing': () => import('./valveTiming.js'),
  injector: () => import('./injector.js'),
  'gn2-coldflow': () => import('./stand.js'),
  'full-stand': () => import('./fullStand.js'),
};

const cache = new Map();

export function hasLab(id) {
  return !!loaders[id];
}

export async function loadLab(id) {
  if (cache.has(id)) return cache.get(id);
  const loader = loaders[id];
  if (!loader) return null;
  const lab = (await loader()).default;
  cache.set(id, lab);
  return lab;
}
