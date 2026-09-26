/**
 * Lab contract, the same shape as FLUX's defineLab() so a FLUX lab's structure reads across.
 * A "lab" here is either a component lab (#/lab/<id>, one piece of physics) or a stand
 * (#/stand/<id>, the full feed system); both are plain objects from defineLab().
 *
 * id, title
 * live          — recompute every frame
 * orbit         — false locks the camera (the P&ID is a flat schematic, like FLUX's Circuits)
 * hint          — hint-bar copy
 * status        — 'placeholder' | 'uncalibrated' | 'calibrated'. Shown on screen. Nothing is
 *                 'calibrated' until a component's C_dA has been fitted to measured data (J-5).
 * defaultState  — per-lab slice; restored when you come back
 * controls()    — Setup panel HTML; bind(api) attaches its listeners
 * init(ctx)     — build scene objects once; return a handle
 * enter(ctx, handle, state) / exit(ctx, handle, state)
 * recompute(state, computed, ctx)
 * syncViews(state, computed, ctx, handle) — handle is what init() returned
 * tick(dt, state, computed) — optional; return true to keep dirty
 * law(state, computed)      — KaTeX strings
 * liveRows(state, computed) — eq-live HTML
 * readout(state, computed)  — bottom cells HTML
 * coach(state, computed)    — { title, body }: prose with `$…$` math, or a list with eq() blocks
 * plot(state, computed)     — null | plot spec
 *
 * The quantities a lab shows are declared in data/quantities.js (LAB_UNITS); a lab with no entry
 * there fails the self-test (V-11).
 */
export function defineLab(spec) {
  return {
    live: false,
    orbit: false,
    hint: '',
    status: 'placeholder',
    defaultState: () => ({}),
    controls: () => '',
    bind() {},
    init: () => ({}),
    enter() {},
    exit() {},
    recompute() {},
    syncViews() {},
    tick: null,
    law: () => [],
    liveRows: () => '',
    readout: () => '',
    coach: () => ({ title: '', body: '' }),
    plot: () => null,
    ...spec,
  };
}
