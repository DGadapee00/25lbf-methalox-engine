/** Lazy lab loaders, keyed by lab id (see data/catalog.js for what each one is). */
const loaders = {
  scaffold: () => import('./scaffold.js'),
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
