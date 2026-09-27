/**
 * Main-thread side of the physics worker. One request in flight at a time: if the worker is still
 * busy with the last chunk when the next frame comes, that frame asks for nothing, so a slow
 * machine runs the sim slower than real time rather than queueing work without bound.
 */
export function createSimClient(onMessage) {
  const worker = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' });
  let busy = false;
  let seekTo = null;
  const pump = () => {
    if (busy || seekTo == null) return;
    const t = seekTo;
    seekTo = null;
    busy = true;
    worker.postMessage({ type: 'seek', t });
  };
  worker.onmessage = (ev) => {
    if (ev.data.type === 'state' || ev.data.type === 'ready' || ev.data.type === 'error') {
      busy = false;
      onMessage(ev.data);
      pump();
    } else onMessage(ev.data);
  };
  worker.onerror = (e) => onMessage({ type: 'error', message: e.message || 'worker error' });
  return {
    init(stand, schedule) {
      busy = true;
      seekTo = null;
      worker.postMessage({ type: 'init', stand, schedule: schedule || [] });
    },
    command(id, cmd) {
      worker.postMessage({ type: 'cmd', id, cmd });
    },
    advance(dt) {
      if (busy || seekTo != null) return false;
      busy = true;
      worker.postMessage({ type: 'advance', dt });
      return true;
    },
    /** Sequence scrub. A newer seek replaces one that has not been sent yet. */
    seek(t) {
      seekTo = t;
      pump();
    },
    terminate() {
      worker.terminate();
    },
  };
}
