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
| M2 Component labs + P&ID view, GN₂ cold-flow stand in Operate mode | this: Blowdown, Orifice, Regulator labs; live stand in a Web Worker |
| M2–M7 | see the brief's §6 |

## Run it

```bash
cd Sim
npm install
npm start          # dev server on http://localhost:5175
npm test           # headless guard + physics self-test + shell checks
npm run build      # dist/, stamped with /version.json
npm run smoke      # every lab in headless Chromium against scripts/baseline/values.json
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
│   ├── labs/              # defineLab() contract, loader; blowdown, orifice, regulator, stand
│   ├── engine/            # router (#/lab/<id>, #/stand/<id>); physics Web Worker and its client
│   ├── scene/             # three.js: renderer, palette, P&ID view (pid.js)
│   ├── ui/                # KaTeX helpers, units formatting, plots, predict-first cards
│   ├── data/              # catalog, units registry, S-2 tags, component loader, stands/
│   └── physics/           # pure and headless: no DOM, no three.js, no KaTeX
│       ├── gas.js         # ideal-gas mixtures: NASA-7 or calorically perfect
│       ├── elements/      # orifice, valve, regulator (check/relief live in network.js)
│       ├── network.js     # netlist → state vector, RHS, events, readouts
│       ├── integrate/     # Dormand–Prince 5(4) with dense output
│       ├── simulate.js    # driver: breakpoints, state events, sampling, stats; steppable runs
│       ├── analysis.js    # derived readouts: fails-open peak manifold pressure
│       └── selftest/      # npm test suites, one per topic
├── scripts/               # smoke, headless guard, shell checks, live
├── tools/                 # offline generators for data/ (Python)
├── data/                  # JSON tables (thermo) and stand defaults (components.json), each sourced
└── docs/                  # solver.md and other design notes
```

## Rules

- **Physics is pure and headless.** `scripts/check-headless.mjs` fails `npm test` if anything
  under `src/physics/` imports three.js, KaTeX, UI or scene code, or names a browser global.
- **SI inside, always.** Only `src/ui/format.js` converts for display (psia, lbf, g/s, °F).
- **No number without a source.** Every default carries one (datasheet, CEA run, PROJECT_PLAN
  section, or "placeholder, see issue #N"); see [PROVENANCE.md](PROVENANCE.md).
- **Tests check against independent results** (closed forms, conservation, published values),
  never against the code's own earlier output. See [VALIDATION.md](VALIDATION.md) for
  predicted-vs-measured records once there is hardware data.

Built on the shell of [FLUX](https://github.com/DGadapee00/flux-phy2049): the lab contract,
the rendering palette, the KaTeX helpers, the version stamp and the smoke-test pattern.
