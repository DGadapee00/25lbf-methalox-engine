/**
 * Main-thread side of the physics worker. One request in flight at a time: if the worker is still
 * busy with the last chunk when the next frame comes, that frame asks for nothing, so a slow
 * machine runs the sim slower than real time rather than queueing work without bound.
 */
export function createSimClient(onMessage) {
  const worker = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' });
  let busy = false;
  worker.onmessage = (ev) => {
    if (ev.data.type === 'state' || ev.data.type === 'ready' || ev.data.type === 'error') busy = false;
    onMessage(ev.data);
  };
  worker.onerror = (e) => onMessage({ type: 'error', message: e.message || 'worker error' });
  return {
    init(stand, schedule) {
      busy = true;
      worker.postMessage({ type: 'init', stand, schedule: schedule || [] });
    },
    command(id, cmd) {
      worker.postMessage({ type: 'cmd', id, cmd });
    },
    advance(dt) {
      if (busy) return false;
      busy = true;
      worker.postMessage({ type: 'advance', dt });
      return true;
    },
    terminate() {
      worker.terminate();
    },
  };
}
