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

**Recommendation:** when M3 profiling confirms this on the full stand, add a linearly implicit
**Rosenbrock** method (e.g. ROS3P or Rodas4, both with dense output) behind the same driver
interface. The network is small (tens of states), so a finite-difference Jacobian is cheap.
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

The model is a first-order poppet (τ) with proportional outlet-pressure feedback (gain K from
"droop at rated flow"). The self-test has three parts (`selftest/regulator.js`).

**Exact linear check.** With an ideal supply, an isothermal manifold and a choked outlet, the
loop is exactly linear while the poppet is unsaturated. A 1% set-point step matches the
closed-form 2×2 matrix exponential to 4e-8 of the step (ζ = 0.20) and 8e-10 (ζ = 2.37).

**Nominal settling.** GOX, 2000 psia bottle into 20 cm³ at a 480 psia set point, through the
GOX injector into 250 psia. All regulator numbers are fixtures (20 psi droop at 38.8 g/s,
τ = 20 ms), because no regulator has been selected. Results: 27% overshoot of the rise, settled
to ±1% in 55 ms, final 460.6 psia, matching the droop prediction within 1%.

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
  droop, large K), since GK sits under the square root.
- **This two-state model can't go unstable** (ζ > 0 always: both characteristic coefficients
  are positive). Real regulator instability needs a third lag: a sensing line, dome volume, or
  poppet mass with little damping. None of these is modelled. A test that *expects* sustained
  oscillation needs that third state first.
- **Dead-headed fill overshoots.** With the main valve closed, a regulator filling its own small
  manifold overshoots badly when τ exceeds the fill time. In the V-4 fixture, the ox manifold
  reached 608 psia (relief at 600 cracked and cycled) and the fuel manifold 1191 psia, against a
  480 psia set point. Fill time at full opening was about 7 ms against τ = 20 ms. Real
  regulators lock up better than this. Whether the model is too pessimistic here depends on the
  real poppet's τ, which a datasheet or the Phase 5 step 1 cold flow can give.

## 6. Finding: droop un-chokes the GOX injector (brief §8)

In the nominal run the regulator droops to 460.6 psia, so p₀/P_c = 1.843 < 1.893 (O₂ critical
ratio, γ = 1.4). **The GOX injector is not choked into 250 psia.** The self-test asserts this so
it stays visible. The injector flow barely changes (the flux curve is flat near r*), but the
feed system is no longer decoupled from the chamber, and decoupling is R-8's mitigation. This
is the case for a choke-margin target (S-3); the M6 sweep will map it.

## 7. Known limits (M1)

- Ideal gas. No Z(p,T) (v1.1), no Joule–Thomson cooling across the regulator (M4).
- NASA-7 N₂ is fitted from 300 K; below that it extrapolates. O₂ and CH₄ are fitted from 200 K.
- No line friction element yet. Short runs are lumped C_dA, per the brief.
- The valve φ(x) curve is linear unless a cited table is supplied (D-5).
- V-10's published worked example is pending (see the self-test's PEND line).
