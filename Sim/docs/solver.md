# Solver notes (M1)

How the flow network is integrated, why, and what the self-test showed. Each number below comes
from `npm test` output on the commit that introduced this file. The step counts are the
stiffness-canary baseline in `scripts/baseline/solver-steps.json`.

## 1. The system

The state is conserved quantities only. Each volume node holds species masses m_i (kg) and
internal energy U (J). Each ambient node holds the mass and energy it has received. Each
regulator holds its poppet opening z. Pressure and temperature are derived from those
(`gas.js`: Newton iteration on u(T), then p = mRT/V). Valve positions and check/relief states
are discrete, not ODE states (`network.js`).

Every edge subtracts the same species flow and enthalpy flow from one node and adds them to
another. So Σm and ΣU (ambient included) are **linear invariants**. A Runge–Kutta step preserves
any linear invariant exactly, which is why V-4 and V-5 hold to round-off (relative 0 and
~1e-13), not merely to tolerance. Those tests prove the bookkeeping has no leaks. They don't
prove accuracy; the closed-form tests do that.

## 2. Integrator: Dormand–Prince 5(4)

This is the brief's starting point. It is explicit, fifth order, with a fourth-order embedded
error estimate, FSAL, and a fourth-order continuous extension. The self-test checks it without
the network:

| check | result |
|---|---|
| global order, y′ = t·y, fixed h | 4.80 (5 expected) |
| dense-output order | 4.97 |
| harmonic oscillator to t = 20 at rtol 1e-10 | cos(20) to 1e-8, 632 steps |

Step control is the textbook one: RMS error norm, factor 0.9·err^(−1/5) clamped to [0.2, 5].
Absolute tolerances are per component. Each node's mass scale is the mass it would hold at the
network's highest initial pressure, so a 45 cm³ chamber and a 50 L bottle each get an error
tolerance sized to themselves (`network.js` `scales()`).

### Evidence: the stand network is stiff

On the V-4 cold-flow stand (two circuits, 5 cm³ line nodes, 20 cm³ manifolds, 45 cm³ chamber),
1 s of simulated time takes:

| rtol | steps | rejected |
|---|---|---|
| 1e-4 | 4 462 | 466 |
| 1e-6 | 5 939 | 392 |
| 1e-8 | 6 286 | 308 |
| 1e-10 | 7 107 | 345 |

For an accuracy-limited problem, step count scales like rtol^(−1/5): about 16× over these six
decades. Here it moves only 1.6×, and about 10% of steps are rejected even at loose tolerance.
The step size (~100–200 µs) is set by the **stability limit** of an explicit method, not by
accuracy. The limiting modes come from small line volumes connected through large open valves
near pressure equilibrium. There the linearized conductance dṁ/dΔp is large (the Δp → 0
regularization has a finite but steep slope), and V/(RT·dṁ/dΔp) is of order 10–50 µs.

The cost today is 2 s of cold flow in about 0.5–0.75 s of wall time in Node, which is acceptable
through M2. It won't be acceptable for M3's full stand, 10 s burns and M6's Monte Carlo sweeps.

**Decision (agreed 2026-09-26), done in M3: a Rosenbrock method, now the default** (§2a). The network is small (tens of states), so a finite-difference Jacobian is cheap.
Rosenbrock methods need no Newton iteration, which suits the hard events and resets. BDF2 is the
alternative, but its multistep history has to be restarted at every breakpoint and event, and
this problem has many of both.

The canary: each self-test simulation's step count is compared with the recorded baseline. It
warns at 1.5× and fails at 3×. Wall time is printed but never judged.

## 2a. Ros3, the default integrator since M3

`integrate/ros3.js` is a 3-stage, third-order, L-stable Rosenbrock method with an embedded
second-order error estimate (Sandu, Verwer et al. 1997, as in KPP's Rosenbrock integrator). It
is linearly implicit, so there is no Newton iteration. Each step:
- builds a forward-difference Jacobian (one RHS evaluation per state, plus one for ∂f/∂t);
- factors (1/(hγ) I − J) once;
- solves three linear systems.

The third stage reuses the second stage's f. Dense output is the cubic Hermite interpolant through
(y, f) at both ends; f at the new point doubles as the next step's first stage.

**What the self-test checks, rather than trusting the coefficients:**
- third-order convergence on a nonlinear, time-dependent problem (observed 2.99);
- third-order dense output (2.95);
- L-stability (one step at hλ = −10⁸ damps to 3×10⁻⁸);
- an error estimate that scales as h³ (3.00);
- the known stiff order reduction to 2 on Prothero–Robinson (2.04), documented rather than hidden;
- the LU solve on 200 random pivoting systems;
- V-1 and V-2 against their closed forms on *both* integrators.

Linear invariants still hold exactly, so V-4 and V-5 stay at round-off.

**Two bugs found on the way:**
1. **Permutation order in the LU solve.** The factorization swaps whole rows, multipliers
   included, so all interchanges must be applied to b before forward substitution. Interleaving
   them is wrong once a late pivot moves an eliminated row. A 3×3 test missed it; the network
   stalled at h = 25 µs.
2. **Kinks.** See §3, "Kinks".

**Tolerances: each method at its natural one.**
- Ros3 defaults to rtol 1e-6 (atol 1e-8 of each state's scale). That is about 0.0005 psi at
  480 psia, well below any transducer.
- Dormand–Prince defaults to rtol 1e-8.
- A test that needs tighter asks for it.

Measured on the stands (wall time, Node):

| run | Dormand–Prince 1e-8 | Ros3 1e-6 |
|---|---|---|
| GN₂ stand, 7 s cold-flow sequence | 55 466 steps, 1394 ms | 2155 steps, 255 ms |
| V-4 two-circuit fixture, 2 s | 11 670 steps, 496 ms | 2292 steps, 613 ms (max 2e-5 relative error) |

On the stiff single-circuit stand, Ros3 is 5× faster. On V-4, the Jacobian's cost (about 45 RHS
evaluations a step) eats most of the gain in steps. The next step there, if it matters, is a
sparse (column-grouped) Jacobian, not a looser tolerance.

On non-stiff problems at 1e-10, Ros3 takes about 20× more steps than Dormand–Prince, which is
what a third-order method does. The closed-form checks run on both.

**Rule: never adjust a physical parameter to make the solver faster.** A volume, C_dA or time
constant is set by the hardware, a datasheet, or a stated placeholder, and never by step counts.
Stiffness is the integrator's problem: it is what Ros3 is for.

## 3. Events

- **Breakpoints (scheduled).** These are valve and regulator commands, plus the start and end of
  every valve ramp they cause. C_dA(t) has a kink at each, so a step is shortened to land on it
  exactly, and FSAL is reset (k1 re-evaluated) after it. Maximum step = min(fastest ramp/4,
  t_end/20).
- **State events.** These are check-valve and relief crack and reseat. Each device has an event
  function g that is < 0 while its mode holds. A sign change inside an accepted step is located
  by Illinois regula falsi on the dense output, to 1e-12 of the step. The step is cut at the
  crossing, the mode flips, and integration restarts. V-6 checks crack and reseat pressures to
  1e-6.
- **Initial consistency.** Before the first step, any device whose g is already ≥ 0 is switched.
  (Without this, a check valve that starts with Δp above crack stays shut forever, because
  there's no crossing. V-6 caught it.)
- **Hysteresis is required.** Crack must exceed reseat, and relief blowdown must be in (0, 1).
  `compileNetwork` refuses anything else, because zero hysteresis chatters without end. A run
  also aborts after 1e5 state events.
- **Non-physical trial stages.** A too-large trial step can produce a stage with u below u(20 K).
  `temperatureFromU` throws `NonPhysicalState`; the driver treats it as a rejected step and
  quarters h. Accepted states are never non-physical. This was found by running V-4 at
  rtol 1e-4.

**Kinks (M3).** Where the right-hand side changes branch without any state changing, the
driver locates the crossing on the dense output, ends the step exactly there, and restarts the
integrator, as at a breakpoint. The kinks are:
- per relief: Δp at set, full lift and reseat, and lift meeting the rising or the falling curve;
- per regulator: the command reaching 0 or 1.

After a cut, that kink is ignored for one step, so the zero it sits on is not found again.

Without this, Ros3 linearized across the relief's rising-curve onset with a Jacobian from the
wrong side: the lift started at 20.76 instead of 20.00 bar, and it settled 10% off its curve.
Dormand–Prince had shrunk its step through the kinks instead. Both integrators now get the kink
cuts.

## 4. Orifice regularization near Δp = 0

The subsonic law's slope ∝ 1/√Δp is infinite at Δp = 0. Below **Δp_lin = 1e-3·p_up**
(approved 2026-09-26; 0.48 psi at a 480 psia manifold) the law is replaced by the odd cubic
ṁ = a·x + b·x³, x = Δp/Δp_lin, with a, b set so value **and slope** match the true law at
x = 1. V-3 checks value and slope continuity, strict monotonicity on (0, Δp_lin], ṁ(0) = 0,
C¹ continuity at the choke point, and the incompressible limit C_dA·√(2ρΔp).

## 5. Regulator: settling, and when it rings

The model is a first-order poppet (τ) with proportional outlet-pressure feedback.

**Set-point convention (changed 2026-09-26).** `pSet` is the **flowing outlet pressure at rated
flow** (`mdotRated`, from `pSupplyRef`), the number a regulator is adjusted to on the stand.
Lockup, the no-flow pressure, is `pSet + droop`; give `droop` or `pLockup`, not both. The gain K
and rated opening z_r are derived from the rating when the network is built
(`regulatorDerive`). Before this change, `pSet` was the lockup pressure, so a "480 psia"
regulator flowed at about 460 psia.

The self-test has four parts (`selftest/regulator.js`):

1. **Convention.**
   - Passing rated flow from the reference supply, the outlet holds p_set to 1e-9.
   - With the outlet shut, it locks up at p_set + droop to 1e-6.
   - Lockup is quasi-static, so this is measured on a 10 L dead-head, where the loop is overdamped.
2. **Exact linear check.** With an ideal supply, an isothermal manifold and a choked outlet, the
   loop is exactly linear while the poppet is unsaturated. A 1% set-point step matches the
   closed-form 2×2 matrix exponential to 4e-8 of the step (ζ = 0.20) and 2e-9 (ζ = 2.37).
3. **Nominal settling.**
   - Setup: GOX, 2000 psia bottle into 20 cm³ at a 480 psia set point, through the GOX
     injector into 250 psia.
   - Regulator numbers are fixtures, since no regulator has been selected: 20 psi droop at
     38.8 g/s, τ = 20 ms.
   - Result: 26% overshoot of the rise, ±1% by 64 ms, final 479.8 psia.
4. **Choke margin at the set point** (§6 below).

**When it rings.** Linearized about steady state, the manifold–poppet loop has
ωn² = a(k + GK)/τ and **ζ = (a·k + 1/τ) / (2ωn)**, where:
- a = RT/V (manifold);
- k = outlet conductance, ṁ_out/p;
- G = poppet flow per unit opening;
- K = gain.

With the fixture regulator:

| V \ τ | 1 ms | 5 ms | 20 ms | 100 ms |
|---|---|---|---|---|
| 5 cm³ | 0.28 | 0.20 | 0.24 | 0.45 |
| 20 cm³ | 0.49 | 0.26 | 0.20 | 0.26 |
| 100 cm³ | 1.07 | 0.49 | 0.28 | 0.20 |
| 500 cm³ | 2.37 | 1.07 | 0.55 | 0.28 |

- **Ringing is worst when the poppet lag τ is comparable to the manifold's own time constant.**
  That is where ζ bottoms out, the diagonal of the table. A fast poppet on a large manifold is
  overdamped. A slow poppet on a small manifold rings, and so does a stiff regulator (small
  droop, large K).
- **This two-state model can't go unstable** (ζ > 0 always). Real regulator instability needs a
  third lag (sensing line, dome volume, or poppet mass with little damping). None is modelled.
- **Model limitation, not a finding: dead-headed trapping.** Dead-headed there is no outflow
  (k = 0) and ζ = 1/(2√(aGKτ)), so a small manifold rings hard. Nothing can bring the pressure
  back down, so any overshoot past lockup is trapped. On 20 cm³ with the fixture regulator
  (ζ ≈ 0.1) the model traps 919 psia against a 500 psia lockup.
  - This comes from the **first-order poppet model**. A real regulator's seat, spring and poppet
    mass close it differently.
  - It isn't a prediction of hardware. The self-test pins it only so that a model change that
    alters it gets noticed.
  - **The poppet lag τ becomes a datasheet parameter once a regulator is selected.** Until then
    τ = 20 ms is a fixture.

**Where M1's "1191 psia fuel manifold" came from.** That number was a product of the M1
fixture, not a prediction:
- the fixture had **no fuel-manifold relief**;
- the poppet is a **pure first-order lag** (τ = 20 ms, no datasheet behind it) filling a
  20 cm³ volume in about 7 ms.

The fixture now carries a relief on every regulated manifold. With the proportional-lift relief
(§5a), the dead-headed peaks are 668 psia (ox) and 656 psia (fuel), below the 674.7 psia
full-lift pressure. Whether real hardware overshoots at all depends on the selected regulator's
poppet dynamics; Phase 5 step 1 cold flow will say.

## 5a. Relief valve: proportional lift (changed 2026-09-26)

The on/off relief chattered: about 200 cycles in 0.25 s with the ox regulator failed open in V-4.
It is replaced by proportional lift (`elements/relief.js`). Lift L ∈ [0, 1] scales the flow
area:
- **Rising curve:** lift ramps from 0 at the set pressure to full at **set + accumulation**
  (10% default, Dalton's decision).
- **Falling curve:** lift ramps from full at set + accumulation to 0 at **reseat =
  set·(1 − blowdown)**.
- **Between the curves the lift holds.** That is the blowdown hysteresis, as a continuous loop
  rather than a switch.

The lift follows its target through a first-order lag **τ_lift**. That makes it an ODE state
with no event handling, and keeps the loop continuous in time. τ_lift is the valve's lift
response time, a datasheet parameter; the fixture uses 2 ms. (This lag is a modelling choice
added with the change; flag it if a different lift model is wanted.)

What the self-test (V-6) checks:
- lift begins at set;
- fed a steady flow, the valve settles on the rising curve at Δp = set·(1 + acc·L*), passing
  exactly the feed flow;
- when the feed is cut, it holds L* until Δp reaches the falling curve, then reseats at
  set·(1 − blowdown);
- exactly one opening: no chatter.

**Effect on V-4.**
- Relief state events fell from 452 to 3; the remaining events are the check valve.
- Steps fell from 14,450 to 11,649. In the regulator-fails-open window specifically, 2,913 fell
  to 1,055.
- Each relief opens twice (once on the dead-headed start, once during the upset) and modulates,
  with peak lift 0.85 on ox and 0.50 on fuel.

M5's chatter reporting reads L(t): repeated openings and closings of the lift. It no longer
counts switches.

## 5b. Relief sizing, checked when a network is built

Every regulated node must carry relief capacity for its regulator **failing open**.
`compileNetwork` refuses a network otherwise, naming the regulator and the relief C_dA it needs.
The rule (`checkReliefs`):

- **Fails-open flow:** C_dA,max from the supply as filled (its highest pressure), into the
  manifold at the relief's full-lift pressure.
- **Capacity:** the reliefs on that node together pass at least that flow **at full lift, which
  they reach at set + accumulation (10%)**. So in steady state a failed-open regulator can't push
  the manifold past set + accumulation.
- **Downstream assumed shut:** a closed main valve is when a dead-headed manifold is most exposed.

`reliefCdAForFailOpen()` gives the minimum C_dA for sizing. Tests check both directions:
- a relief sized by the rule settles a failed-open, dead-headed manifold at or below full-lift
  pressure (674.6 ≤ 674.7 psia);
- one at 0.8× settles at 843 psia.

The rule is steady-state. On the way there, the manifold peaks at 746.7 psia (+10.7%) while a
2 ms lift catches up with a manifold that fills in about 7 ms. That transient is set by τ_lift,
so it is a datasheet question once a relief is selected.

A network may opt out only with `checks: { reliefOnRegulatedNodes: false, reason }`. The
regulator-dynamics tests do, because a relief would mask the loop they measure. M2's stand
defaults will not.

## 5c. Readout: peak manifold pressure when a regulator fails open (MEOP input)

`analysis.js` `failsOpenPeaks(net, gas)` runs one scenario per regulator:
- the regulator is failed open from t = 0;
- every actuated valve is shut, so the outlet is dead-headed;
- the manifold starts at the set point.

It reports the **peak manifold pressure** (from in-step peak tracking on the dense output), the
settled pressure, the full-lift pressure, and the parameters the peak depends on. This is the
pressure the manifold's transducers, valves and fittings actually see. **Their ratings, and the
MEOP definition, must cover this transient, not only the relief set pressure.** The Phase 4 leak
check is at 1.5× MEOP.

On the V-4 fixture it is a strong function of the relief lift time:

| τ_lift | ox peak | fuel peak | settled (both) |
|---|---|---|---|
| 0.5 ms | 674 psia | 678 psia | ≈ 660 psia |
| 2 ms (fixture) | 735 psia | 735 psia | ≈ 660 psia |
| 8 ms | 916 psia | 892 psia | ≈ 660 psia |

At the fixture τ_lift, the ox peak Δp is about 1.20× the 600 psi set. **This is a warning about
scale, not a design value.** The peak depends on the relief's lift response and the
regulator's poppet response, and both are fixtures until real datasheets exist. The readout
carries that caveat and lists the parameters, so the stand view can show it that way.

## 6. Finding: the GOX choke margin at the set point (brief §8)

Under the new convention the manifold sits at the set point, 479.8 psia at the nominal run's
flow:
- p₀/P_c = **1.919** against the critical **1.893** (O₂, γ = 1.4). The injector is choked, but
  only **1.4% above critical**. That is amber by §5.2's 2.2 threshold.
- The manifold can fall **6.6 psi** (to 473.2 psia) before the injector unchokes. Any line
  loss, regulator droop beyond rating, or supply-pressure effect of that size un-chokes it.
- At P_c ≈ 264 psia (η_c* = 0.97, brief §8) the margin is 1.818 and **the GOX injector
  un-chokes**.

The self-test asserts all three, so they stay visible. The target margin and the fix remain
S-3 (an ADR); the M6 sweep will map manifold pressure vs P_c vs margin.

## 6a. The live stand (M2)

Operate mode runs the GN₂ stand in a Web Worker (`engine/simWorker.js`) through the steppable
driver (`createRun`). The main thread asks for dt × time scale of sim time each frame, one
request in flight at a time, so a slow machine runs slower than real time rather than queueing
work. The self-test checks that 60 chunks per second with a live command reproduce a batch run.

**Why the HP line is 20 cm³.** It is about 1 m of 1/4-in tube, a physically plausible
bottle-to-regulator run. **That is the reason, and the only one.** It is still a placeholder
until the as-built volume is known (issue #6).

History, for honesty: the first placeholder was 2 cm³. That made it the stiffest node on the
stand (233 000 Dormand–Prince steps for 7 s), and M2 raised it to 20 cm³. Raising a volume for
speed breaks the rule in §2a; the value is kept because it is plausible, not because it is fast.
With Ros3, a small as-built volume costs little: stiffness no longer sets the step.

## 6b. Transducers are not states (M3)

A pressure transducer does not push on the gas, so it is not in the ODE. `sensors.js` applies, in
order, a first-order lag, optional gaussian noise, and uniform quantization over the full-scale
range. The P&ID tag shows the quiet reading (lag and quantization). Download DAQ CSV adds the
noise with a fixed seed and writes `stand-daq-v1` (`Test_Stand/daq_format.md`, `daq.js`).

The lag, the ADC width, the noise and each range are placeholders (issue #6), the same way a
valve's open time is. They are not adjusted to change a step count. Sequence mode plays
`gn2-step1` from `Test_Stand/sequences/gn2-step1.json`, loaded by `data/sequences.js`. The GN₂
cold-flow stand and the full stand both use that table. It commands the oxidizer circuit.
Scrubbing to an earlier time rebuilds the run from t = 0 with the same commands and advances
to the chosen time.

## 6c. The full stand (M3)

`data/stands/fullStand.js` (lab `full-stand`) is both propellant circuits and a purge leg.
Every bottle is filled with nitrogen. The fuel circuit keeps the fuel injector holes and the
fuel regulator's 13.9 g/s rated flow. This stand has no combustion model.

Phase 5 step 1 is the `gn2-step1` run on the oxidizer circuit. Phase 5 step 3 opens both
propellant paths at t = 0 and integrates for 4 s so the manifolds can settle. The 4 s figure
is an integration length. `predictions/phase5.json` stores both results and labels them
uncalibrated. Nitrogen through those orifices has its own mass flow. The GOX 38.8 g/s and
GCH4 13.9 g/s figures are the design-point propellants.

The purge regulator set point, rated flow, relief set and check-valve crack are placeholders
on issue #6. The relief set sits above the stand-in lockup, so the relief stays shut while
the purge regulator holds. A purge specification has not been written.

## 6d. The chamber, ignition and hot fire (M4)

`physics/chamber.js` and a `chamber` node kind in `network.js`. The chamber is a control volume
with a discrete combustion flag.

- **Cold**, it is an ordinary ideal-gas volume.
- **Ignition** is a state event: armed while the igniter is on (and not faulted no-light), it
  fires when the chamber gas crosses into the CH₄/O₂ flammability limits (5.1–61% CH₄ in O₂,
  LOC 12% O₂; `data/flammability.json`). Everything unburned burns at once: O₂ and CH₄ are
  relabelled PRODox and PRODfu, mass for mass, and the pressure jumps to the table's state.
- **Burning**, P_c comes from the CEA table (`data/cea_gox_gch4.json`, Phase1_Calculations/cea)
  at the contents' O/F with c* = η_c* c*_CEA and (RT)_eff = (c*Γ)², so the throat orifice passes
  exactly P_c A_t/c*. P_c is solved by fixed point because the table depends on it. The energy
  slot is frozen; incoming O₂/CH₄ is converted as it arrives.
- **Extinction** is a second state event: the propellant *inflow* stops being flammable (fuel
  shut first, a purge arriving). The node returns to the ideal-gas model at the same pressure.
- The driver calls `reconcile()` after every command and event, for modes that switch without a
  crossing: an igniter switched on into a gas that is already flammable, or a flash (lit, but the
  inflow cannot sustain it).

Mass is conserved to round-off through all of it (V-4 over a hot-fire run: 1.7e-15), and
oxidizer-origin and fuel-origin mass separately. Energy is not a conserved sum once anything
burns or throttles through a JT regulator, by design; V-5 runs without either.

V-7: after a 0.5% inflow step the fitted 63% time is 1.450 ms, the same as the linearization
τ_c(1 − dln RT/dln p)/(1 − dln c*/dln p) from the table, and 1.4% from the brief's
τ_c = L*/(c*Γ²). The step waits 0.1 s: the lines start full of N₂ and take 5–8 ms time constants
to flush, and an early step measures the flush, not the chamber.

V-8 (hot-fire stand, fixture timings, JT off): ṁ 52.2 g/s, O/F 2.86, P_c 261 psia, F 124.3 N,
I_sp 243 s. Against PROJECT_PLAN §2 recomputed through the CEA table (its ṁ, O/F, throat and
η_c*) every quantity is within 1.2%. Against PROJECT_PLAN's hand-sized numbers, P_c is +4.4%,
F +11.8% and I_sp +13%, and the CEA table accounts for that: η_c*·c*_CEA is 1736 m/s where §2
implies 1644 m/s, and CEA's ideal I_sp at ε = 3 is 267 s, not ~250 s. **Finding for Dalton, not
fixed:** at that P_c neither injector is choked (GOX p₀/p 1.83, GCH₄ 1.81). That is S-3.

JT (regulator `jt: true`): dT/dp = μ_JT(p, T) integrated in p with RK4 over a CoolProp table;
it reproduces CoolProp's own isenthalpic flashes to 0.19 K. From 2000 to 480 psia at 293 K GOX
leaves at 268 K and GCH₄ at 249 K. Off by default, because PROJECT_PLAN §2 assumes ambient-
temperature propellant and the sim has no line heat transfer to warm the gas back up.

## 6e. Faults, aborts and checks (M5)

`physics/sequencer.js` is the brief's table driver (§4.7, driver 1). The plant takes commands by
tag and gives transducer readings at the table's rate; the driver sees nothing else. Steps are
scheduled up front. When a table has aborts or checks, the driver advances the plant one DAQ
sample at a time, pushes the sample through the same observer as the DAQ file (lag, quantize),
and evaluates the abort rules on those readings. The first trip cancels the pending steps
(`run.cancel`) and schedules the table's named action. A table without aborts or checks plays
exactly as before, with no extra chunking, so the M3 step counts and smoke values do not move.

Faults are commands on the network: a valve frozen where it is (`stuck`), a regulator open,
closed or creeping, an orifice partly blocked, the igniter no-light. They are the world, not the
sequencer, so an abort never cancels them.

The self-test runs a fixture table (clearly labelled: its timings and thresholds are test values,
not a proposed sequence) on the hot-fire stand: nominal, then once per abort with the fault it
names. Each abort stays quiet nominally, trips under its fault, runs its action, and cancels the
rest of the table; the check `INJ-OX-01 choked` fails nominally, which is S-3 again. It then
applies the same demonstration to every committed table. Only `gn2-step1` is committed, with no
aborts, so the done-when is met vacuously for committed tables and demonstrated on the fixture.

One observation from building the fixture: on the hot-fire and full stands the ox manifold
overshoots to about 630 psia while it pressurizes dead-headed, above the 615 psia relief crack, and
the first-order poppet then traps about 555 psia (§5). With placeholder regulator and relief
values this is a model statement, not a hardware one, but an overpressure abort threshold below
that overshoot would trip on every start.

## 6f. Test mode, fitting and sweeps (M6)

**Fitting** (`physics/fit.js`). The residual is the transducer reading, simulated through the
same observer as the DAQ file (lag, no quantization, which would make the objective a
staircase), minus the logged one, divided by the channel's full scale. The whole table is re-run
for every evaluation. Parameters are ln(C_dA), Levenberg–Marquardt with a forward-difference
Jacobian (step 1e-3). An area whose column is below 1e-3 RMS is refused: on the GN₂ stand the
integrator's own tolerance noise in that difference is about 2e-4, and a real sensitivity (the
injector, the throat) is about 4e-2.

The done-when: a synthetic log (the sim with INJ-OX-01 at 92% and THROAT-01 at 97% of their
areas, through the stand-daq-v1 writer with seeded noise and 16-bit quantization, parsed back)
is fitted from the stand's values in 6 iterations; both areas come back within 0.009%, inside
their 0.02% standard errors, and the residuals fall to the placeholder noise (0.05 psi).

**Predictions** are `stand-prediction-v1` records: the table, the stand, the sim commit, the
component file's stamp and the time, with the quantized readings every channel should show.
`npm run validate` compares one with a log and writes the VALIDATION.md section, and refuses any
log whose header says `source: sim`.

**Sweeps** (`physics/sweep.js`) run the chamber-fill network to a steady burn. The S-3 study
(`sweeps/s3-choke-margin.json`) shows the result that matters for that decision: with the holes as
drawn the choke margin p₀/P_c does not change with manifold pressure (P_c rises with it), and it
is 1.82 at η_c* 0.92, below O₂'s critical 1.893; it moves with η_c* (1.90 at 0.88, 1.73 at 0.97).
Raising the margin at the design flow takes smaller holes and a higher manifold pressure together
(the dashed line). That is information for the ADR, not a choice. Monte Carlo takes the spreads
from its config; none is built in.

## 6g. SIL (M7, partly: D-7 is open)

`physics/sil.js` runs the plant against any sequencer that answers one tick at a time: in, the time
and the DAQ readings; out, commands by tag and abort events. Commands act on the tick, so a table
step between ticks happens at the next one; the table driver schedules steps at their exact times.
Conformance is therefore judged on outcomes: the same aborts within two sample periods, and the
same verdict on every check, evaluated by the table driver's own code (`evaluateChecks`).

The reference sequencer, `createTableLogic`, is the table logic behind that interface. It
conforms in-process (self-test) and as a child process over the `stand-sil-v1` JSON-lines
protocol (`npm run sil-check`, in CI). It is not firmware: the brief puts the firmware logic after
D-7, and it will be held to the same check.

The optional lumped wall node is not built. Its wall mass, material and heat-transfer coefficient
come from D-2 and D-3 and the Phase 1 Bartz analysis, none of which exists yet; a node made only
of placeholders would print a wall temperature with nothing behind it.

## 7. Known limits (M1–M7)

- Ideal gas. No Z(p,T) (v1.1). JT across regulators only, and only when switched on.
- NASA-7 N₂ is fitted from 300 K; below that it extrapolates. O₂ and CH₄ are fitted from 200 K.
- No line friction element yet. Short runs are lumped C_dA, per the brief.
- The valve φ(x) curve is linear unless a cited table is supplied (D-5).
- V-10's published worked example is pending (see the self-test's PEND line).
- Ignition burns the accumulated mixture instantly at the table's (constant-pressure) equilibrium
  state: the size of the spike, not its shape. Flammability limits are for room temperature and
  1 atm. Inert gas in a burning chamber is taken at the flame temperature without charging the
  flame for heating it.
- Burned gas outside a burning chamber (after shutdown, backflow into a line) is a calorically
  perfect gas with the design-point molar mass and frozen c_p.
- The igniter is a switch (D-4 open): no torch flow, no spark energy. IGN-IG-01 is a provisional
  tag.
- Nozzle flow separation is not modelled; C_F is floored at 0.
- The CEA table is clamped at its edges (O/F 1.2–40, P_c 10–1000 psia).
