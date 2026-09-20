# 25 lbf Methalox Engine
**Student-built 25 lbf pressure-fed GOX/GCH4 → LOX/LCH4 rocket engine**
Dalton Gadapee | Jacksonville, FL | University of North Florida

**Goal:** Safe, self-funded 25 lbf engine for senior project + propulsion internship portfolio (SpaceX / Blue Origin).

Ground test article only — no flight, no turbopumps, no regenerative cooling, no throttling. See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the full program plan: success criteria, baseline design point, phase gates, risk register, schedule, and budget.

## Definition of Done
- ≥3 successful GOX/GCH4 hot fires, ≥5 s steady-state, no burn-through
- Measured thrust within ±15% of predicted at design point
- Measured c\* efficiency reported with uncertainty
- Full design package reproducible from this repo alone
- Zero injury, zero uncontrolled release events

Stretch goal: LOX/LCH4 variant fired (Phase 7, follow-on program).

## Project Roadmap
- Phase 0: Requirements — in progress (plan committed; requirements docs not yet committed)
- Phase 1: Theory & Sizing
- Phase 2: Detailed Design
- Phase 3: Fabrication
- Phase 4: Test Stand & Plumbing
- Phase 5: Incremental Testing (GOX/GCH4 first!)
- Phase 6: Documentation
- Phase 7: LOX/LCH4 and Upscale (separate program, starts after `v1.1`)

Each phase ends at a tagged gate (`v0.1-requirements` → `v1.1-published`). See [PROJECT_PLAN.md §3](PROJECT_PLAN.md#3-work-breakdown-and-phase-gates) for gate artifacts per phase.

## Folder Structure
```bash
25lbf-methalox-engine/
├── README.md
├── PROJECT_PLAN.md
├── Phase0_Requirements/
├── Phase1_Calculations/
│   └── cea/                  # RocketCEA scripts + raw output
├── Phase2_Design/
│   ├── ADR/                  # ADR-001-injector-element.md, etc.
│   ├── P&ID_valve_table.md
│   ├── P&ID_mermaid.png
│   └── BOM.xlsx
├── CAD/                      # Siemens NX files, STEP exports
├── Fabrication/
├── Test_Stand/
│   └── firmware/             # sequencer firmware
├── Data_Logs/
│   └── YYYY-MM-DD-testNN/
├── Photos_Videos/
└── LICENSE (MIT)
```
