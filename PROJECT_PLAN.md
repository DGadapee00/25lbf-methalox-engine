# Project Plan — 25 lbf Methalox Engine

**Owner:** Dalton Gadapee | University of North Florida | Jacksonville, FL
**Status:** Draft v0.1 — scope baseline, not yet frozen
**Scope:** Program-level plan spanning Phases 0–7. Phase-specific detail lives in the corresponding `PhaseN_*/` folder.

---

## 1. Purpose and Success Criteria

### 1.1 Why this project exists

Ranked, because these conflict and the ranking decides trades:

1. **Portfolio artifact for propulsion internship applications** (SpaceX, Blue Origin, Space Coast primes). Applications for Summer 2028 open ~Aug–Oct 2027. Hardware that has fired, with data, beats hardware that has been designed.
2. **Senior design project substrate** (2028–29), with margin to upscale.
3. **Skill acquisition** — CEA, Siemens NX, machining, fluid system design, DAQ, test operations.

Consequence of that ranking: **a successfully hot-fired 25 lbf GOX/GCH4 engine with reduced data by Q3 2027 is worth more than a beautifully designed LOX/LCH4 engine that has never fired.** When schedule and ambition conflict, ambition yields.

### 1.2 Definition of Done

The project is complete when all of the following are committed to this repo:

| # | Criterion | Verification |
|---|---|---|
| DoD-1 | ≥3 successful GOX/GCH4 hot fires, ≥5 s steady-state, no burn-through | Test reports + video + data logs |
| DoD-2 | Measured thrust within ±15% of predicted at design point | Load cell data vs. Phase 1 prediction |
| DoD-3 | Measured c\* efficiency reported with uncertainty | Data reduction notebook |
| DoD-4 | Full design package reproducible from repo alone | Third party could rebuild from CAD + BOM + drawings |
| DoD-5 | Zero injury, zero uncontrolled release events | Test log |

**Stretch (Phase 6+):** LOX/LCH4 variant fired. Treated as a follow-on program, not a gate on DoD.

### 1.3 Explicitly out of scope

- Flight. This is a ground test article only. No airframe, no recovery, no FAA involvement.
- Regenerative cooling. Channel geometry at an 8 mm throat is not practically machinable with hobby-tier tooling. Heat-sink + film cooling only.
- Turbopumps. Pressure-fed only.
- Throttling and restart. Single set point, single start per run.

---

## 2. Baseline Design Point

**Preliminary — recompute in CEA and commit the output before Phase 2 freeze.** Numbers below are hand-sized to establish scale and drive procurement, not to cut metal from.

### 2.1 Assumptions

| Parameter | Value | Basis |
|---|---|---|
| Propellants (Phase A) | GOX / GCH₄, ambient temperature | Bottle-fed; no cryo handling |
| Propellants (Phase B) | LOX / LCH₄ | Follow-on |
| Chamber pressure, P_c | 250 psia (1.72 MPa) | Keeps feed pressure inside K-bottle regulator range |
| Mixture ratio, O/F | 2.8 | Fuel-rich of peak (~3.3) for wall temperature margin |
| c\* efficiency, η_c\* | 0.92 assumed | Conservative for this scale; high surface-to-volume losses |
| Delivered I_sp (SL) | ~215 s | Ideal ~250 s at ε=3, derated |
| Expansion ratio, ε | 3.0 | Sea-level optimum at P_c = 250 psia |
| Burn duration (Phase A) | 5 s target, 10 s goal | Heat-sink limited |

### 2.2 Derived geometry

| Parameter | Value |
|---|---|
| Thrust | 25 lbf = 111.2 N |
| Total mass flow | 52.7 g/s (0.116 lbm/s) |
| Oxidizer flow | 38.8 g/s |
| Fuel flow | 13.9 g/s |
| Throat diameter, D_t | **8.0 mm (0.316 in)** |
| Exit diameter, D_e | 13.9 mm (0.548 in) |
| Contraction ratio, CR | 8 |
| Chamber diameter, D_c | 22.7 mm (0.894 in) |
| Characteristic length, L\* | 35 in (0.89 m) |
| Chamber volume | ~45 cm³ |
| Chamber barrel length | ~90 mm (3.5 in) |

### 2.3 Why gaseous first is the right call

The README already commits to GOX/GCH₄ → LOX/LCH₄. Worth writing down *why*, because it will be tempting to skip ahead:

- **Injector orifices are machinable.** Choked gas injection at ~480 psia manifold needs roughly 4× ⌀1.4 mm (GOX) and 4× ⌀1.0 mm (GCH₄). The liquid equivalent at 20% ΔP is 4× ⌀0.79 mm and 4× ⌀0.59 mm — #68 and #73 drills into a copper face, with no tolerance for wander.
- **No chilldown, no two-phase flow, no cavitation, no tank pressurization system.** Bottle → regulator → valve → injector.
- **Choked injection decouples the feed system from the chamber**, which removes the dominant low-frequency instability mode for free.
- Roughly **60% of the hardware** (test stand, DAQ, igniter, thrust mount, control logic, procedures) transfers unchanged to the liquid variant.

### 2.4 Open design decisions (resolve in Phase 2, record as ADRs)

| ID | Decision | Options | Driver |
|---|---|---|---|
| D-1 | Injector element | Unlike impinging doublet / shear coax / swirl coax | Machinability vs. mixing efficiency at low flow |
| D-2 | Chamber cooling | Heat-sink copper / heat-sink + fuel film / graphite throat insert in steel | Burn duration vs. complexity |
| D-3 | Throat material | C101 copper monolithic / graphite insert | Erosion vs. machining |
| D-4 | Ignition | Spark plug in chamber / augmented spark torch igniter | Reliability vs. sub-project cost |
| D-5 | Main valve actuation | Solenoid / pneumatically actuated ball | Response time vs. cost |
| D-6 | Flow metering | Cavitating venturi / sonic orifice / Coriolis | Accuracy vs. cost |
| D-7 | Sequencing controller | Teensy/Arduino / Raspberry Pi / relay logic | Determinism vs. dev time |

Each of these gets a short ADR in `Phase2_Design/ADR/` — context, options considered, decision, consequences. One file, one decision, one commit.

---

## 3. Work Breakdown and Phase Gates

Each phase ends with a **gate**: a specific set of artifacts committed and tagged. Do not start the next phase until the gate artifacts are in `main`.

### Phase 0 — Requirements *(nominally complete, not yet committed)*
**Gate artifacts:** requirements document with verification method per requirement; success criteria; safety policy; budget envelope.
**Action:** the README claims this is done. Commit the actual documents or downgrade the status. An uncommitted requirement is not a requirement.
**Tag:** `v0.1-requirements`

### Phase 1 — Theory & Sizing
**Gate artifacts:**
- CEA run set (script + raw output committed, not just screenshots) sweeping O/F 2.0–4.0 and P_c 150–350 psia
- Sizing notebook: flow rates, throat/exit/chamber geometry, injector orifice areas, with units checked
- Bartz heat-flux estimate and heat-sink transient (wall temperature vs. time → burn duration limit)
- Nozzle contour (conical 15° for v1; bell only if it costs nothing)
**Tag:** `v0.2-sizing-frozen`

### Phase 2 — Detailed Design ← *current*
**Gate artifacts:**
- All 7 ADRs closed
- Siemens NX models + STEP exports for chamber, injector, igniter, thrust mount
- Dimensioned drawings with tolerances and surface finish callouts
- P&ID with every valve, transducer, relief, and vent numbered — and a valve table mapping tag → part number → state at each sequence step
- Structural check: chamber hoop stress with burst margin ≥4; bolt/flange analysis; thrust mount load path
- BOM with vendor, part number, lead time, cost
**Tag:** `v0.3-design-review` — and hold an actual design review. Find one person who will argue with you.

### Phase 3 — Fabrication
**Gate artifacts:** as-built dimensional inspection records; photos; deviation log (what differed from drawings and why).
**Scheduling note:** this phase is gated on machine shop access. See §5.

### Phase 4 — Test Stand & Plumbing
**Gate artifacts:**
- Stand built, plumbed, leak-checked to 1.5× MEOP with GN₂
- DAQ calibrated: load cell, ≥4 pressure transducers (ox manifold, fuel manifold, P_c, supply), thermocouples
- Sequencer firmware with abort logic, committed
- Remote operation verified from behind shielding at design standoff
**Tag:** `v0.4-stand-qualified`

### Phase 5 — Incremental Testing
Strictly ordered. Each step is a separate test day with its own procedure and report.

1. **GN₂ cold flow** — leak check, valve timing, sequencer dry run
2. **Water flow injector characterization** — C_d per circuit, spray pattern photography, impingement verification
3. **GN₂ blowdown through injector** — verify choked flow and predicted mass flow
4. **Igniter standalone** — ≥10 consecutive successful ignitions before it goes near the engine
5. **Engine ignition test** — igniter + 0.5 s propellant, no steady state
6. **Short hot fire** — 2 s
7. **Design duration hot fire** — 5 s, repeat ×3
8. **Duration extension** — toward 10 s as thermal data permits

**Gate artifacts:** test procedure + checklist per test; raw data; post-test inspection photos; reduced data with c\*, C_f, I_sp, and uncertainty.
**Tag:** `v1.0-hot-fire`

### Phase 6 — Documentation
**Gate artifacts:** final technical report; lessons-learned; README rewritten as a portfolio front page with results, photos, and a plot above the fold. Repo cleaned so a recruiter reaches the interesting thing in two clicks.
**Tag:** `v1.1-published`

### Phase 7 — LOX/LCH₄ and Upscale
Separate program plan. Do not start until `v1.1`.

---

## 4. Risk Register

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| R-1 | **No legal test site** | **Critical** | Start now — see §5. Gates everything from Phase 5 onward. |
| R-2 | Oxygen fire from hydrocarbon contamination in LOX/GOX path | Critical | Written O₂ cleaning procedure; O₂-compatible materials only; no aluminum in high-velocity O₂; PTFE/Viton seals rated for service |
| R-3 | Methane leak and deflagration | Critical | Outdoor test only; combustible gas detector; purge before/after; no ignition sources downwind |
| R-4 | Hard start / overpressure | High | Igniter qualified standalone first; ox-lead sequencing; minimum propellant residence before ignition |
| R-5 | Throat erosion or burn-through | High | Short first burns; wall thermocouples; inspect after every fire; film cooling as fallback (D-2) |
| R-6 | Schedule slip past internship application window | High | Gaseous-first; test stand built in parallel with fabrication; see §5 |
| R-7 | Budget overrun | Medium | Buy instrumentation and valves used where safe to do so; never used on pressure vessels or relief devices |
| R-8 | Combustion instability | Low-Med | Choked injection; low expected sensitivity at this scale; accept and characterize |

**Standing safety rules** (to be expanded into a real safety policy in Phase 0):
remote operation only, minimum standoff behind barrier, no personnel approach until full vent and purge complete, two-person rule for any pressurized operation, written and signed-off procedure for every test.

---

## 5. Schedule

Shaped around known constraints: full-time accounting role through summer 2027, junior year starting fall 2027, part-time machine shop work from fall 2027, graduation spring 2029.

| Window | Bandwidth | Focus | Target |
|---|---|---|---|
| Fall 2026 | Low (PHY 2049 + full-time work) | Phase 1 analysis; **secure test site (R-1)**; Phase 0 artifacts committed | `v0.2` by Dec 2026 |
| Spring 2027 | Low–Med | Phase 2 design; ADRs; CAD; design review; order long-lead items | `v0.3` by May 2027 |
| Summer 2027 | **High** — leaving accounting | Phase 4 test stand build (needs no machining); procurement | `v0.4` by Sep 2027 |
| Fall 2027 | Med — **machine shop access begins** | Phase 3 fabrication; Phase 5 steps 1–4 | Cold flow + igniter qualified |
| Spring 2028 | Med | Phase 5 steps 5–8 | `v1.0-hot-fire` |
| Summer 2028 | Med | Phase 6 documentation | `v1.1-published` |
| 2028–29 | — | Phase 7 as senior design | — |

**Two scheduling insights worth acting on:**

1. **Fabrication is gated on machine shop access (fall 2027), but the test stand is not.** Build the stand, plumbing, DAQ, and sequencer during summer 2027 while the engine is still on paper. That removes the stand from the critical path entirely.
2. **The internship application window (Aug–Oct 2027) lands before first hot fire.** Accept that. What you can have by then is `v0.4`: a qualified stand, complete design package, and cold-flow data — which is already far more than most applicants show. Plan the README so that state reads as a program in motion, not an unfinished one.

---

## 6. Budget (order of magnitude)

| Category | Est. |
|---|---|
| Gas bottles, regulators, initial fills | $800–1,500 |
| Valves (main, check, relief, vent, purge) | $1,000–2,000 |
| Tubing, fittings, manifolds (316 SS) | $600–1,200 |
| Instrumentation + DAQ | $800–1,500 |
| Engine material + tooling | $300–800 |
| Igniter | $150–300 |
| Stand structure + shielding | $300–600 |
| Safety equipment and consumables | $300–500 |
| **Total** | **$4,250–8,400** |

Spread across ~18 months. Largest single lever is machine shop access converting fabrication cost into material cost.

---

## 7. Repo Conventions

Since every work product ends as a commit, the conventions are part of the deliverable.

**Structure** — as defined in README, plus:
```
Phase2_Design/ADR/        # one file per decision, ADR-001-injector-element.md
Phase1_Calculations/cea/  # scripts + raw CEA output, not screenshots
Test_Stand/firmware/
Data_Logs/YYYY-MM-DD-testNN/
```

**Commits** — conventional prefixes, one logical artifact per commit:
`feat:` new analysis/design/hardware doc · `fix:` correction to committed work · `docs:` narrative · `data:` test data · `adr:` decision record

**Never commit a number without its source.** Every value in a design document traces to a CEA run, a calculation in a committed notebook, a datasheet, or a measurement. If it came from a hand estimate, say so.

**Tag every phase gate.** Tags are the portfolio narrative — they show a program advancing on a plan.

**Test data is immutable.** Raw logs committed as captured. Reduction happens in a separate notebook that reads the raw file.

---

## 8. Immediate Next Actions

1. **Start the test site search.** Longest lead item, costs nothing, gates the back half of the program. Options: private rural acreage within driving distance, a Florida rocketry club with a liquids-capable site, or UNF faculty sponsorship of a campus-adjacent facility.
2. **Commit the Phase 0 requirements documents**, or change the README status.
3. **Set up RocketCEA** and commit the first O/F and P_c sweep. That replaces every number in §2 with a traceable one.
4. **Open GitHub Issues for D-1 through D-7**, one per ADR, and work them in that order.

---

*This document is the program baseline. Changes to scope, success criteria, or phase gates should be made here by PR, not by drift.*
