# Stand Sim

A browser-based, operable simulation of the 25 lbf GOX/GCH₄ engine's **test stand and feed
system**: bottles, regulators, lines, valves, injector, chamber and purge.

**It is a tool for being proven wrong by hardware as early as possible. It never replaces a Phase 5
test step.** Until a component has been calibrated against measured data, it is labelled
*uncalibrated* on screen.

## Status

| Milestone | State |
|---|---|
| M0 Scaffold | done: app shell, tests, CI, Pages deploy |
| M1 Component library + network solver (headless) | done: V-1 to V-6 (plus V-3, V-9, regulator settling); see [docs/solver.md](docs/solver.md) |
| M2 Component labs + P&ID view, GN₂ cold-flow stand in Operate mode | done: Blowdown, Orifice, Regulator; live stand in a Web Worker |
| M3 Full stand, cold flow | done: two propellant circuits and a purge, all bottles GN₂; sequence table (`Test_Stand/sequences/gn2-step1.json`) and timeline scrub; Phase 5 step 1 and step 3 predictions in `predictions/phase5.json`. Rosenbrock, DAQ CSV, the valve-timing lab and the injector lab are included |
| M4 Hot fire | done: chamber combustion state from the CEA table (`data/cea_gox_gch4.json`), ignition inside the CH₄/O₂ flammability limits with the unburned-propellant (hard-start) metric, thrust and I_sp, regulator Joule–Thomson (CoolProp). Chamber-fill lab (lab 6) and a hot-fire stand in Operate; no hot-fire sequence is invented. V-7 and V-8 in `npm test`; see [docs/solver.md §6d](docs/solver.md) |
| M5 Faults and aborts | done: fault injection (valve stuck, regulator open / closed / creep, injector or throat blockage, igniter no-light), the table driver with abort rules read from the transducers, abort actions from the table, checks and a pass/fail report (Sequence mode, Markdown download). Load a sequence file to rehearse it. Format: [Test_Stand/sequence_format.md](../Test_Stand/sequence_format.md). No committed table has aborts yet; the self-test demonstrates the machinery on a labelled fixture |
| M6–M7 | Test mode, SIL |

## Run it

```bash
cd Sim
npm install
npm start          # dev server on http://localhost:5175
npm test           # headless guard + physics self-test + shell checks
npm run build      # dist/, stamped with /version.json
npm run smoke      # every lab in headless Chromium, dev server, against scripts/baseline/values.json
npm run smoke:prod # same, against `vite build` + preview — run this before merging to main
npm run live       # which commit the deployed site was built from
```

The smoke test borrows Playwright from `$PLAYWRIGHT_PATH`, this folder's `node_modules`, or the
global install; it is not a dependency.

## Layout

```
Sim/
├── index.html, vite.config.js, package.json
├── src/
│   ├── main.js            # app shell: router, lab mount, panels, render loop
│   ├── labs/              # defineLab() contract, loader; blowdown, orifice, regulator, valve timing, injector, chamber fill, stand
│   ├── engine/            # router (#/lab/<id>, #/stand/<id>); physics Web Worker and its client
│   ├── scene/             # three.js: renderer, palette, P&ID view (pid.js)
│   ├── ui/                # KaTeX helpers, units formatting, plots, predict-first cards
│   ├── data/              # catalog, units registry, S-2 tags, component loader, sequence loader, stands/
│   └── physics/           # pure and headless: no DOM, no three.js, no KaTeX
│       ├── gas.js         # ideal-gas mixtures: NASA-7 or calorically perfect
│       ├── elements/      # orifice, valve, regulator (check/relief live in network.js)
│       ├── network.js     # netlist → state vector, RHS, events, readouts
│       ├── integrate/     # Ros3 (default) and Dormand–Prince 5(4), both with dense output
│       ├── sensors.js     # transducer lag, noise, quantization (not an ODE state)
│       ├── daq.js         # stand-daq-v1 CSV (Test_Stand/daq_format.md)
│       ├── simulate.js    # driver: breakpoints, state events, sampling, stats; steppable runs
│       ├── chamber.js     # combustion chamber: ignition, burning state, thrust, unburned metric
│       ├── cea.js, jt.js  # CEA table lookup; Joule–Thomson integral over the CoolProp table
│       ├── sequencer.js   # table driver: steps, aborts on transducer readings, actions, checks
│       ├── analysis.js    # derived readouts: fails-open peak manifold pressure
│       ├── predictions.js # Phase 5 step 1 and step 3 from the cold-flow model
│       └── selftest/      # npm test suites, one per topic
├── scripts/               # smoke, headless guard, shell checks, live
├── tools/                 # offline generators for data/ (Python): nasa7.py, props.py
├── data/                  # JSON tables (thermo, CEA, JT, flammability) and stand defaults
│                          # (components.json), each sourced. The CEA generator lives in
│                          # Phase1_Calculations/cea/ (brief §4.8)
└── docs/                  # solver.md and other design notes
```

## Rules

- **Physics is pure and headless.** `scripts/check-headless.mjs` fails `npm test` if anything
  under `src/physics/` imports three.js, KaTeX, UI or scene code, or names a browser global.
- **Never adjust a physical parameter to make the solver faster.** Volumes, C_dA and time
  constants come from hardware, datasheets or stated placeholders; stiffness is the integrator's
  job (Ros3, docs/solver.md §2a).
- **SI inside, always.** Only `src/ui/format.js` converts for display (psia, lbf, g/s, °F).
- **No number without a source.** Every default carries one (datasheet, CEA run, PROJECT_PLAN
  section, or "placeholder, see issue #N"); see [PROVENANCE.md](PROVENANCE.md).
- **Tests check against independent results** (closed forms, conservation, published values),
  never against the code's own earlier output. See [VALIDATION.md](VALIDATION.md) for
  predicted-vs-measured records once there is hardware data.

Built on the shell of [FLUX](https://github.com/DGadapee00/flux-phy2049): the lab contract,
the rendering palette, the KaTeX helpers, the version stamp and the smoke-test pattern.
