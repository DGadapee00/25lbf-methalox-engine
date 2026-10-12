# Quest view of the test stand

First playable slice of a Meta Quest 3 view of the GN₂ cold-flow stand. The desktop app is the
same page it was. This file is the map for what shipped and what comes later.

## Why this is WebXR on three.js, not IWSDK

Dalton's other VR project uses IWSDK 1.0.1. That was the first choice here, and it does not fit
this slice.

- The sim that deploys from `main` is Vite 6 and three.js 0.172. IWSDK 1.0.1 peers Vite 7 and
  ships its own three build (`super-three`). Putting both in one graph either upgrades the
  public desktop page's toolchain or loads two copies of three.
- IWSDK's scaffold (`@iwsdk/create`) wants to own the project. This repo already has a lab
  shell, a hash router, and a physics worker. The Quest page only needs a spatial view of one
  stand.
- IWSDK's entity system would wrap the same meshes and the same worker calls. It would not
  change what an operator can do in this slice. Gauges are canvas textures either way, because
  an immersive session does not composite the page's HTML.

IWER 2.5 (the Quest 3 preset plus `@iwer/devui`) is the desktop emulator. It is the same runtime
the other project already uses to fake a headset. The headset itself uses the browser's WebXR,
not IWER.

A later slice can revisit IWSDK if the in-world UI outgrows canvas panels. That would be a
separate page, not a rewrite of the desktop shell.

## What this slice does

- **Enter VR** on the desktop page opens `vr.html`. The P&ID, the labs, and Operate / Sequence /
  Test are untouched.
- The scene is the single-circuit GN₂ stand (`gn2-coldflow`): bottle, HV-OX-01, the HP line,
  PCV-OX-01, PSV-OX-01, the manifold, SV-OX-01, SV-OX-02, the line, INJ-OX-01, the chamber,
  THROAT-01. Tags follow S-2. Transducers are PT-OX-01, PT-OX-02, PT-OX-03, PT-CH-01.
- Lengths come from sources that already exist. The HP run is the components.json note, "about
  1 m of 1/4-in tube". The manifold and the injector line use that length scaled by their
  placeholder volumes. The bottle is a sphere of the placeholder volume, because no bottle is
  selected. The chamber barrel is PROJECT_PLAN §2.2 (⌀22.7 mm by ~90 mm). The nozzle length
  comes from THROAT-01's diameter, expansion ratio and 15° half-angle. Exit diameter is
  Dt × √ε, not a second copy of 13.9 mm.
- Handles, gauge faces, the DAQ panel and where the stand sits relative to your head are a
  viewing rig so the tags can be read and pinched. The placard says so. They are not hardware,
  not a stand height, and not MEOP.
- Operate, through the existing worker: open and close the three valves, nudge PCV-OX-01 in the
  same 50–900 psia field the desktop uses (that field is not a rating), start and stop, reset,
  and inject the same faults (stuck valve, regulator fails open / closed / creep, injector or
  throat blockage). Creep and blockage ask for an amount. There is no default.
- Instruments in the world: a gauge on each PT, a DAQ panel with the same pressure and flow
  series as desktop Operate, and UNCALIBRATED / PLACEHOLDER / issue #6 on the placard, the
  gauges and the page. Transducer text is the lagged, quantized reading. Tube colour is the
  true node pressure, on the same log ramp as the P&ID.
- Comfort: the manifold starts one tube-length in front of you, slightly below eye level. You
  are not walked anywhere. Optional snap turn (45°, or the right stick) and three "go to"
  spots (bottle, valves, engine) move the stand around you.
- The page asks the session for 72 fps and turns fixed foveation off so the gauge text stays
  sharp. Both are requests. A Quest can refuse the frame rate.
- No headset required. The bottom bar is the same actions. **Emulate Quest 3** installs IWER
  and starts a session. `?emulate` does that on load. `npm run smoke:vr` clicks the desktop
  controls and ray-picks HV-OX-01 in headless Chromium.

Physics is not tuned for frame rate. If the worker is still busy, that frame does not queue
another step, which is the desktop client's rule: the sim runs slower than real time instead
of piling up.

## How to try it

Desktop, no headset:

```bash
cd Sim
npm install
npm start
```

Open http://localhost:5175/vr.html . Use the buttons, or click a valve on the stand. **Emulate
Quest 3** starts IWER's Quest 3 preset; its overlay moves the emulated head and controllers.

Quest 3, after this branch is merged to `main` (GitHub Pages is HTTPS, which the headset
browser requires for Enter VR):

1. Open `https://dgadapee00.github.io/25lbf-methalox-engine/vr.html` in Quest Browser.
2. Press **Enter VR**. Standing or seated both work. Recenter with the headset's own control
   if the stand is not in front of you.
3. Point a controller and pull the trigger, or pinch, on a valve. The DAQ panel faces you.
   Stop, the set point, faults, snap turn and the three go-to spots are buttons on that panel.

This pull request does not deploy. Pages publishes `main` only. A headset cannot enter VR on
an `http://` LAN address. Until merge, use the emulator, or serve `Sim/dist` from any HTTPS
origin the headset can reach.

## What was not verified on a headset

No Quest was attached to this run. Not checked on device:

- Enter VR, controller aim, pinch, and the stick snap in Quest Browser.
- Whether the session actually holds 72 fps, or drops frames when the regulator is moving.
- Fixed foveation left at 0: text stays sharper, and the GPU does more work. That trade has
  not been measured.
- IWER's stereo view and dev overlay on a real desktop GPU. The smoke test does not start an
  immersive session, because headless Chromium has no headset and the emulator is a second
  WebGL context we did not want the CI check to depend on.
- Readable type size in the headset. The gauges are 6 inch faces at about 1 m. That is a
  guess until someone wears it.

The smoke test does check that the production build loads `vr.html`, that the worker opens
HV-OX-01, moves the regulator set point, accepts a blockage and a stuck valve, and that snap
turn and "go to" move the stand.

## Frame-rate risks

- The target is 72 fps. Quest Browser often starts at 72, and Quest 3 can also be set to 90
  or 120. If the display is not 72, the first change is the requested frame rate, so it
  matches the panel. Not the physics.
- The DAQ panel is one canvas texture, redrawn at most 10 times a second. Gauge canvases
  update only when the printed number changes. Those uploads are the likely GPU cost, not
  the mesh. The stand is a few thousand triangles. CI rejects the page if a frame draws
  more than 30 000 triangles or 120 draw calls. That is a budget, not a Quest measurement.
- A stiff step still happens on the worker. A slow step skips the next request instead of
  queuing. The picture keeps drawing. The clock falls behind real time. Do not "fix" that
  by changing a volume or a time constant.
- IWER and its dev UI, including a second three.js, download only after **Emulate Quest 3**
  (or `?emulate`). A headset session does not ask for that chunk. The desktop P&ID never
  loads it either.
- Foveation is off. If a headset trace misses 72, turn foveation up before touching the
  scene. The gauge text will get softer at the edge of view.
- The billboard panels face the headset every frame. That is a few quaternion writes, not
  a draw-call change.

## Not in this slice

Left alone on purpose: S-3 (choke margin), MEOP, D-5 (how the main valves are actuated),
D-7 (the controller), and the placeholder numbers tracked in issue #6. Nothing in the
physics data files was edited. The 50–900 psia regulator field is copied from the desktop
Operate input so the two pages cannot disagree. It is not a component rating.

## Later slices

1. **Assemble the stand.** Pick parts from a bench and attach them, instead of spawning the
   finished GN₂ circuit. The finished circuit in this slice is the target the build mode
   would check against. Still no invented part numbers.
2. **Sequence mode in VR.** Play `Test_Stand/sequences/gn2-step1.json` on this page, with
   the timeline and the pass/fail report in the world. The table driver is already in the
   worker. This slice stays on Operate.
3. **Fault drills with abort rules.** A drill loads a table that has aborts, injects a
   fault, and shows the report. No committed table has aborts yet. The drill must not
   invent thresholds. It waits until a real table, or it labels a training table the way
   the desktop lessons do.
4. **DAQ CSV from a VR run.** The desktop already writes `stand-daq-v1`. The VR session
   keeps the same samples. Export is a download, which a headset handles badly, so this
   wants a deliberate "save the run" path rather than a button dropped into the panel.

After any of those, a worn-headset pass with OVR Metrics (frame rate and stale frames) is
the measurement this slice does not have.
