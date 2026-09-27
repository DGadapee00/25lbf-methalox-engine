/**
 * The guided path: lessons in the order Phase 5 builds up (brief §6.1), from one bottle emptying
 * to a hot fire, its aborts, and the test loop. Each lesson opens a lab (and a mode), and walks
 * through steps. A step is ticked when its done(ctx, mem) is true; only the current step is
 * checked, so steps happen in order, and a ticked step stays ticked.
 *
 *   ctx: { s: the lab's state, c: the lab's computed record, h: its handle, mode, t }
 *   mem: the lesson's scratch memory (reset when the lesson restarts)
 *   next: { tag } highlights a P&ID element in yellow, { control: 'css selector' } a control:
 *         yellow is reserved for the one control to press next (brief §5.3)
 *   action: { label, run(api) } a button in the guide that does the step for you
 *
 * Text uses the panels' markup: prose with $…$ math. Every claim here is something the sim shows
 * on screen at that step; the numbers quoted come from the sim's own results.
 */
import { PSI } from '../physics/constants.js';
import { answered } from '../ui/predict.js';
import { TRAINING_ABORTS } from './trainingTables.js';

const ro = (ctx) => ctx.c?.readout || null;
const x = (ctx, tag) => ro(ctx)?.edges?.[tag]?.x ?? 0;
const p = (ctx, node) => ro(ctx)?.nodes?.[node]?.p ?? 0;
const burning = (ctx) => !!ro(ctx)?.chambers?.chamber?.burning;
const operate = { text: 'Switch to **Operate** mode.', next: { control: '#mode-operate' }, done: (ctx) => ctx.mode === 'operate' };

export const COURSE = [
  {
    id: 'blowdown',
    lab: 'blowdown',
    title: 'A bottle empties',
    goal: 'How fast a bottle loses pressure through an orifice, and why the gas cools on the way.',
    steps: [
      { text: 'Press **Play**. The solid curve is the simulation; the dashed one is the closed form it is checked against (V-1, V-2).', next: { control: '#bd-play' }, done: (ctx, mem) => {
        mem.v0 ??= ctx.s.view;
        return ctx.s.playing || ctx.s.view !== mem.v0;
      } },
      { text: 'Switch **Thermal model** to isothermal and see how the half-pressure time moves.', next: { control: '#bd-mode' }, done: (ctx) => ctx.s.mode === 'isothermal' },
      { text: 'Answer the **Predict first** card on the right, then read why.', next: { control: '.predict-opt' }, done: () => answered('bd-') },
    ],
    takeaway: 'An adiabatic bottle cools as it empties, and colder gas leaves faster: it loses pressure sooner than an isothermal one. A real bottle lies between the two, because its wall warms the gas.',
  },
  {
    id: 'orifice',
    lab: 'orifice',
    title: 'Choked flow',
    goal: 'Why a choked injector does not feel the chamber, and what the choke margin p₀/p means.',
    steps: [
      { text: 'Drag the back-pressure slider all the way down. Past a point the flow stops rising: the orifice is **choked**.', next: { control: '#or-pb' }, done: (ctx, mem) => (mem.low = mem.low || ctx.s.pb / ctx.s.p0 < 0.3) },
      { text: 'Now drag it up past the critical ratio: the flow falls and the indicator on the schematic turns red.', next: { control: '#or-pb' }, done: (ctx) => ctx.s.pb / ctx.s.p0 > 0.6 },
      { text: 'Type **250** psia back pressure with **480** psia upstream: the design point. The indicator is amber: choked, but with a margin of 1.92 against O₂\'s critical 1.89.', next: { control: '#or-pb-n' }, done: (ctx) => Math.abs(ctx.s.pb - 250 * PSI) < 3 * PSI && Math.abs(ctx.s.p0 - 480 * PSI) < 3 * PSI },
      { text: 'Answer the **Predict first** card.', next: { control: '.predict-opt' }, done: () => answered('or-') },
    ],
    takeaway: 'Choked, the flow depends only on the upstream side, which is what isolates the feed system from the chamber. The design point is barely choked on paper: that is open decision S-3.',
  },
  {
    id: 'regulator',
    lab: 'regulator',
    title: 'The regulator',
    goal: 'Set point, droop and lockup; what happens when a regulator fails open; Joule–Thomson cooling.',
    steps: [
      { text: 'Choose case **Lockup**: the outlet shuts and the pressure rises toward lockup, a droop above the set point.', next: { control: '#rg-case' }, done: (ctx) => ctx.s.case === 'lockup' },
      { text: 'Choose **Fails open**: the regulator passes its full flow into a shut manifold and the relief lifts to hold it. The peak on the way is what the hardware has to survive.', next: { control: '#rg-case' }, done: (ctx) => ctx.s.case === 'failsopen' },
      { text: 'Back to **Flowing**, and tick **Joule–Thomson cooling**: the manifold temperature row drops, because real gas cools when it throttles.', next: { control: '#rg-jt' }, done: (ctx) => ctx.s.case === 'flowing' && ctx.s.jt },
      { text: 'Answer both **Predict first** cards.', next: { control: '.predict-opt' }, done: () => answered('rg-droop') && answered('rg-jt') },
    ],
    takeaway: 'p_set is the flowing pressure; lockup sits a droop above it. A failed-open regulator is caught by the relief, after a peak set by response times that are still placeholders. JT cools methane more than oxygen, so it lowers O/F.',
  },
  {
    id: 'valve-timing',
    lab: 'valve-timing',
    title: 'Valve timing',
    goal: 'A commanded valve is late twice: the command delay, then its stroke.',
    steps: [
      { text: 'Answer the **Predict first** card: when is SV-OX-01 half open?', next: { control: '.predict-opt' }, done: () => answered('vt-') },
      { text: 'Change the **command delay** and watch the half-open point move by exactly that much.', next: { control: '#vt-delay' }, done: (ctx, mem) => {
        mem.d0 ??= ctx.s.delay;
        return ctx.s.delay !== mem.d0;
      } },
    ],
    takeaway: 'Delay plus half the stroke: on the stand, valve timing, not chamber physics, sets the startup.',
  },
  {
    id: 'injector',
    lab: 'injector',
    title: 'Two injector circuits',
    goal: 'One uncalibrated C_d, two circuits, and the flows PROJECT_PLAN asks for.',
    steps: [
      { text: 'Switch **Back pressure** to the cold chamber. The GOX flow does not change: it was choked both times.', next: { control: '#inj-back' }, done: (ctx) => ctx.s.back === 'cold' },
      { text: 'Answer both **Predict first** cards.', next: { control: '.predict-opt' }, done: () => answered('inj-fuel') && answered('inj-ox-back') },
    ],
    takeaway: 'The fuel circuit is about 1.4% short of 13.9 g/s (issue #1). That is inside the C_d uncertainty, so the holes stay as drawn until water-flow data (Phase 5 step 2) measures C_d.',
  },
  {
    id: 'chamber-fill',
    lab: 'chamber-fill',
    title: 'Chamber fill and ignition',
    goal: 'τ_c, ignition inside the flammability limits, and the hard start.',
    steps: [
      { text: 'Set **Igniter** to the no-light fault: nothing lights, and unburned propellant piles up in the chamber.', next: { control: '#cf-ign' }, done: (ctx) => ctx.s.igniter === 'no-light' },
      { text: 'Set it back **on**, and lead the fuel valve by **10** ms. Compare the unburned energy at ignition with the simultaneous start.', next: { control: '#cf-lead' }, done: (ctx) => ctx.s.igniter === 'on' && ctx.s.leadMs === 10 },
      { text: 'Set the lead back to **0** and answer both cards.', next: { control: '#cf-lead' }, done: () => answered('cf-lead') && answered('cf-eta') },
    ],
    takeaway: 'The chamber settles in a few τ_c (about a millisecond each). How hard it starts is set by what accumulated before it lit, so valve order and igniter timing matter more than chamber size (R-4).',
  },
  {
    id: 'gn2-operate',
    lab: 'gn2-coldflow',
    mode: 'operate',
    title: 'GN₂ cold flow, by hand',
    goal: 'Phase 5 step 1 on the oxidizer circuit, one valve at a time.',
    steps: [
      operate,
      { text: 'Click **HV-OX-01** (on the schematic or in Setup) to open the bottle.', next: { tag: 'HV-OX-01' }, done: (ctx) => x(ctx, 'HV-OX-01') > 0.99 },
      { text: 'Wait for the manifold to come up to lockup. Hover it on the schematic to read it.', next: { tag: 'PCV-OX-01' }, done: (ctx) => p(ctx, 'manifold') > 470 * PSI },
      { text: 'Open **SV-OX-01**: nitrogen flows through the injector into the chamber.', next: { tag: 'SV-OX-01' }, done: (ctx) => x(ctx, 'SV-OX-01') > 0.99 && (ro(ctx)?.edges?.['INJ-OX-01']?.mdot ?? 0) > 0.01 },
      { text: 'Hover **INJ-OX-01**: against a cold chamber it is choked with margin above 2.2 (green).', next: { tag: 'INJ-OX-01' }, done: (ctx) => ctx.c?.choke?.['INJ-OX-01'] === 'green' },
      { text: 'Press **Download DAQ CSV**: the transducer log, in the same format the stand logger writes.', next: { control: '#st-daq' }, done: (ctx) => (ctx.h?.downloads ?? 0) > 0 },
    ],
    takeaway: 'The transducer tags show what the DAQ reads: lagged and quantized. The sim and the stand write the same file, so one reduction notebook reads both.',
  },
  {
    id: 'gn2-sequence',
    lab: 'gn2-coldflow',
    title: 'The sequence table',
    goal: 'Let the committed step-1 table run the stand, and scrub through it.',
    steps: [
      { text: 'Switch to **Sequence** mode. The table opens HV-OX-01, then SV-OX-01, then vents the manifold.', next: { control: '#mode-sequence' }, done: (ctx, mem) => {
        if (ctx.mode === 'sequence') mem.tMax = Math.max(mem.tMax || 0, ctx.t);
        return ctx.mode === 'sequence' && ctx.t > 3;
      } },
      { text: 'Drag the **Timeline** back before 2.5 s: the run replays from zero to that moment.', next: { control: '#st-scrub' }, done: (ctx, mem) => ctx.mode === 'sequence' && ctx.t < 2.4 && (mem.tMax || 0) > 3 },
    ],
    takeaway: 'The table is the run. Test_Stand/sequences/gn2-step1.json drives Sequence mode and generates the P&ID valve table; nothing keeps a private copy.',
  },
  {
    id: 'full-stand',
    lab: 'full-stand',
    title: 'A regulator fails open',
    goal: 'Both propellant circuits and the purge on nitrogen, and a fault.',
    steps: [
      operate,
      { text: 'Open **HV-OX-01**.', next: { tag: 'HV-OX-01' }, done: (ctx) => x(ctx, 'HV-OX-01') > 0.99 },
      { text: 'Set **PCV-OX-01 fault** to fails open, with the main valve still shut.', next: { control: '[data-fault="PCV-OX-01"]' }, done: (ctx) => ctx.s.fault?.['PCV-OX-01'] === 'open' },
      { text: 'Watch **PSV-OX-01** lift and hold the manifold. Hover it for its lift.', next: { tag: 'PSV-OX-01' }, done: (ctx) => (ro(ctx)?.edges?.['PSV-OX-01']?.lift ?? 0) > 0.05 },
    ],
    takeaway: 'The relief is sized by a rule the sim enforces at build time: it must pass the regulator\'s full failed-open flow at full lift. The peak readout in the bar below is what the MEOP has to cover.',
  },
  {
    id: 'hot-fire',
    lab: 'hot-fire',
    title: 'Hot fire',
    goal: 'GOX and GCH₄, the igniter, thrust, and a shutdown.',
    steps: [
      operate,
      { text: 'Open **HV-OX-01** and **HV-FU-01**.', next: { tag: (ctx) => (x(ctx, 'HV-OX-01') > 0.99 ? 'HV-FU-01' : 'HV-OX-01') }, done: (ctx) => x(ctx, 'HV-OX-01') > 0.99 && x(ctx, 'HV-FU-01') > 0.99 },
      { text: 'Wait until both manifolds are up to pressure.', done: (ctx) => p(ctx, 'ox-manifold') > 470 * PSI && p(ctx, 'fu-manifold') > 470 * PSI },
      { text: 'Open **SV-OX-01** and **SV-FU-01**. Propellant fills the chamber, cold.', next: { tag: (ctx) => (x(ctx, 'SV-OX-01') > 0.99 ? 'SV-FU-01' : 'SV-OX-01') }, done: (ctx) => x(ctx, 'SV-OX-01') > 0.99 && x(ctx, 'SV-FU-01') > 0.99 },
      { text: 'Switch **IGN-IG-01** on. The chamber lights; the jump in pressure is the propellant that was waiting.', next: { tag: 'IGN-IG-01' }, done: (ctx, mem) => {
        if (burning(ctx) && mem.tBurn == null) mem.tBurn = ctx.t;
        return burning(ctx);
      } },
      { text: 'Read P_c, thrust and I_sp below. Hover the injectors: both are red, not choked, at this P_c. That is S-3.', next: { tag: 'INJ-OX-01' }, done: (ctx, mem) => burning(ctx) && ctx.t > (mem.tBurn ?? Infinity) + 1 },
      { text: 'Shut down fuel first: close **SV-FU-01**. The inflow turns oxygen-rich and the flame goes out.', next: { tag: 'SV-FU-01' }, done: (ctx) => x(ctx, 'SV-FU-01') < 0.01 && !burning(ctx) },
      { text: 'Close **SV-OX-01** and switch the igniter off.', next: { tag: (ctx) => (x(ctx, 'SV-OX-01') > 0.01 ? 'SV-OX-01' : 'IGN-IG-01') }, done: (ctx) => x(ctx, 'SV-OX-01') < 0.01 && !ro(ctx)?.chambers?.chamber?.igniter?.on },
    ],
    takeaway: 'Uncalibrated, and every valve is a placeholder, but the chain is real: manifold pressure, injector flow, CEA c*, P_c, thrust. With the CEA c* the chamber runs above 250 psia and the injectors un-choke. The sim shows it; S-3 decides it.',
  },
  {
    id: 'aborts',
    lab: 'hot-fire',
    title: 'Faults and aborts',
    goal: 'A sequence with aborts, a fault that trips one, and the pass/fail report.',
    steps: [
      { text: 'Switch to **Sequence** mode.', next: { control: '#mode-sequence' }, done: (ctx) => ctx.mode === 'sequence' },
      { text: 'Load the **training table**. Its timings and thresholds are made up for learning; it is not a proposed hot-fire sequence.', action: { label: 'Load the training table', run: (api) => api.handle().loadTable(TRAINING_ABORTS, 'training table (made-up values)') }, done: (ctx) => ctx.s.table?.id === TRAINING_ABORTS.id },
      { text: 'Let it play to the end. No abort trips, but check C-4 fails: the GOX injector is not choked (S-3 again).', done: (ctx) => ctx.c?.report && ctx.t >= 2.9 && !ctx.c.report.abort },
      { text: 'Schedule a fault: **PCV-OX-01 fails open at 0.5 s**.', action: { label: 'Add this fault', run: (api) => {
        const s = api.state();
        s.faults.push({ t: 0.5, id: 'PCV-OX-01', cmd: { fault: 'open' }, label: 'fails open' });
        api.handle().reset();
        api.refresh();
      } }, done: (ctx) => ctx.s.faults?.some((f) => f.id === 'PCV-OX-01') },
      { text: 'Watch **A-2** trip on the PT-OX-02 reading and the table\'s safe-shutdown run. The rest of the table is cancelled.', done: (ctx) => ctx.c?.report?.abort?.id === 'A-2' },
      { text: 'Press **Download report**: the pass/fail record of this rehearsal.', next: { control: '#st-report' }, done: (ctx) => (ctx.h?.reports ?? 0) > 0 },
    ],
    takeaway: 'Aborts read the transducers, not the truth, so their thresholds live with lag and quantization. What an abort does is the table\'s action, never a default. The real table, its aborts and its safe state are design decisions still to be written.',
  },
  {
    id: 'test-mode',
    lab: 'gn2-coldflow',
    title: 'Predict, then test, then fit',
    goal: 'The loop that calibrates the sim against the hardware (J-5).',
    steps: [
      { text: 'Switch to **Test** mode.', next: { control: '#mode-test' }, done: (ctx) => ctx.mode === 'test' },
      { text: 'Press **Run the prediction**. Before a real test you would download it and commit it: that freezes what the sim said.', next: { control: '#ts-predict' }, done: (ctx) => !!ctx.h?.test?.state.record },
      { text: 'Make a **synthetic log** with INJ-OX-01 at 92% of its area: a pretend test where the injector flows less than the model thinks.', action: { label: 'Set 92% and make the log', run: (api) => {
        const t = api.handle().test;
        t.s.test.synth['INJ-OX-01'] = 92;
        t.synthetic();
      } }, done: (ctx) => !!ctx.h?.test?.state.truth?.['INJ-OX-01'] },
      { text: 'Tick **INJ-OX-01**, fit on PT-OX-03 and PT-CH-01, and press **Fit**.', action: { label: 'Tick and fit', run: (api) => {
        const t = api.handle().test;
        t.s.test.params = ['INJ-OX-01'];
        t.s.test.tags = ['PT-OX-03', 'PT-CH-01'];
        t.fit();
      } }, done: (ctx) => !!ctx.h?.test?.state.fit },
      { text: 'Read "vs known" on the right: the fitter found the 92% injector from the pressures alone. A real log goes through the same steps.', done: (ctx) => !!ctx.h?.test?.state.fit },
    ],
    takeaway: 'Predict, commit, test, compare, fit. A synthetic log only checks the fitter; the VALIDATION writer refuses it. The first fitted value from a real log is the first calibrated number in the sim.',
  },
  {
    id: 'margin',
    lab: 'margin',
    title: 'Design question: the choke margin',
    goal: 'What S-3 is really about, with the sim as the calculator.',
    steps: [
      { text: 'Answer both **Predict first** cards: what does raising the manifold pressure do to the margin, and what does better combustion do?', next: { control: '.predict-opt' }, done: () => answered('mg-up') && answered('mg-eta') },
      { text: 'Drag the **manifold pressure** from 400 to 700 psia and watch the margin line: flat.', next: { control: '#mg-p' }, done: (ctx, mem) => {
        mem.lo = mem.lo || ctx.s.pUpPsia <= 420;
        mem.hi = mem.hi || ctx.s.pUpPsia >= 680;
        return mem.lo && mem.hi;
      } },
      { text: 'Tick **Scale the injector holes**: now the margin grows with the manifold pressure. That is what "raise the manifold pressure" means in S-3.', next: { control: '#mg-scaled' }, done: (ctx) => ctx.s.scaled },
    ],
    takeaway: 'The margin is set by injector-to-throat area and c*, not by the manifold pressure alone. Which margin is enough, and which fix, is the S-3 ADR. The same study runs headless: npm run sweep -- sweeps/s3-choke-margin.json.',
  },
];

export const lessonById = (id) => COURSE.find((l) => l.id === id) || null;
