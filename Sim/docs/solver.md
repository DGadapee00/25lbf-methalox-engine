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

**Decision (agreed 2026-09-26): add a linearly implicit Rosenbrock method in M3** (e.g. ROS3P or
Rodas4, both with dense output) behind the same driver interface. The network is small (tens of states), so a finite-difference Jacobian is cheap.
Rosenbrock methods need no Newton iteration, which suits the hard events and resets. BDF2 is the
alternative, but its multistep history has to be restarted at every breakpoint and event, and
this problem has many of both.

The canary: each self-test simulation's step count is compared with the recorded baseline. It
warns at 1.5× and fails at 3×. Wall time is printed but never judged.

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

The regulator's z_cmd clamp to [0, 1] is a kink that isn't located as an event; the adaptive
step shrinks through it. It hasn't been a measurable cost (regulator runs: 5–20% rejections).

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

## 7. Known limits (M1–M2)

- Ideal gas. No Z(p,T) (v1.1), no Joule–Thomson cooling across the regulator (M4).
- NASA-7 N₂ is fitted from 300 K; below that it extrapolates. O₂ and CH₄ are fitted from 200 K.
- No line friction element yet. Short runs are lumped C_dA, per the brief.
- The valve φ(x) curve is linear unless a cited table is supplied (D-5).
- V-10's published worked example is pending (see the self-test's PEND line).
