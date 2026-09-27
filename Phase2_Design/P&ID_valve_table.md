# P&ID valve table

Generated from `Test_Stand/sequences/` and the full-stand netlist by `Sim/src/data/valveTable.js`. Change the sequence, then regenerate this file. Do not edit the table by hand.

The only sequence is `gn2-step1`, the Phase 5 step 1 dry run on the oxidizer circuit with GN2. Fuel and purge valves stay shut. This file has no hot-fire timings.

Part numbers are unassigned until the BOM exists (issue #6). Engine parts cite `Sim/data/components.json`.

## gn2-step1

Phase 5 step 1 dry run on the oxidizer circuit with GN2: leak check, valve timing, sequencer. Fuel and purge are not commanded. Not a hot-fire sequence.

| tag | part number | 0.10 s | 2.50 s | 5.00 s | 5.50 s |
| --- | --- | --- | --- | --- | --- |
| HV-OX-01 | unassigned | open | open | open | open |
| SV-OX-01 | unassigned | shut | open | shut | shut |
| SV-OX-02 | unassigned | shut | shut | shut | open |
| HV-FU-01 | unassigned | shut | shut | shut | shut |
| SV-FU-01 | unassigned | shut | shut | shut | shut |
| SV-FU-02 | unassigned | shut | shut | shut | shut |
| HV-N2-01 | unassigned | shut | shut | shut | shut |
| SV-N2-01 | unassigned | shut | shut | shut | shut |
| SV-N2-02 | unassigned | shut | shut | shut | shut |

## Tags on the full stand

| tag | element | part number | commanded by gn2-step1 |
| --- | --- | --- | --- |
| HV-OX-01 | valve | unassigned | yes |
| PCV-OX-01 | regulator | unassigned | no |
| PSV-OX-01 | relief | unassigned | no |
| SV-OX-01 | valve | unassigned | yes |
| SV-OX-02 | valve | unassigned | yes |
| INJ-OX-01 | orifice | engine part, see components.json | no |
| HV-FU-01 | valve | unassigned | no |
| PCV-FU-01 | regulator | unassigned | no |
| PSV-FU-01 | relief | unassigned | no |
| SV-FU-01 | valve | unassigned | no |
| SV-FU-02 | valve | unassigned | no |
| INJ-FU-01 | orifice | engine part, see components.json | no |
| HV-N2-01 | valve | unassigned | no |
| PCV-N2-01 | regulator | unassigned | no |
| PSV-N2-01 | relief | unassigned | no |
| SV-N2-01 | valve | unassigned | no |
| SV-N2-02 | valve | unassigned | no |
| CKV-N2-01 | check | unassigned | no |
| THROAT-01 | orifice | engine part, see components.json | no |
