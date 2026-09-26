# Provenance

Where every table, coefficient and default in the simulator comes from. **A number without an
entry here does not ship.** Generated tables carry `source`, `generator`, `generated` and
`commit` fields inside the JSON as well.

## Constants (`src/physics/constants.js`)

All exact by definition; the definition is cited on each line of the source file.

| Constant | Value | Definition |
|---|---|---|
| g₀ | 9.80665 m/s² | 3rd CGPM (1901) |
| R_u | 8.314462618 J/(mol·K) | SI 2019 (N_A·k_B, CODATA 2018) |
| p_atm | 101 325 Pa | ISO 2533 standard atmosphere |
| inch, lbm | 0.0254 m, 0.45359237 kg | 1959 international yard and pound |
| lbf, psi | derived: lbm·g₀; lbf/in² | checked against NIST SP 811 App. B.8 in `npm test` |

## Design-point values

| Value | Where used | Source |
|---|---|---|
| P_c 250 psia, F 111.2 N, ṁ 52.7 / 38.8 / 13.9 g/s, manifold 480 psia | scaffold lab display only | PROJECT_PLAN §2.1–2.3 (hand-sized, "recompute in CEA") |

## Generated tables (`data/`)

| File | Contents | Source | Generator |
|---|---|---|---|
| `thermo_nasa7.json` | NASA-7 c_p(T), h(T) for O₂, CH₄, N₂, H₂O, CO₂, CO, H₂ | GRI-Mech 3.0 `thermo30.dat` (Smith et al.) | `tools/nasa7.py` |

**How `thermo_nasa7.json` was produced.** The canonical host (`combustion.berkeley.edu`) is
blocked from the build sandbox, so the committed file was generated from Cantera's verbatim copy
of the GRI-Mech 3.0 THERMO block (`Cantera/cantera` branch 2.4, `data/inputs/gri30.inp`). The
JSON records that URL and its SHA-256. To confirm against the canonical file, run
`python3 tools/nasa7.py` with network access. The coefficients should be unchanged; only the
`source_file`, `source_sha256`, `generated` and `commit` fields should differ in `git diff`.

- Molar masses are computed from element counts with IUPAC/CIAAW abridged standard atomic
  weights (2013): H 1.008, C 12.011, N 14.007, O 15.999 g/mol.
- Fit ranges: O₂ and CH₄ 200–3500 K, **N₂ 300–5000 K** (it extrapolates below 300 K). The low
  and high fits meet at 1000 K with a small jump (N₂: 0.19 J/kg in h); `temperatureFromU`
  handles it and the self-test checks it.

Planned: CEA equilibrium (M4), CoolProp Z and μ_JT (M4 / v1.1).

## Reference values used by the self-test

These are independent checks, not inputs. **Entered from the published tables by hand, not
downloaded: verify against the printed sources before relying on them.**

| Value | Source |
|---|---|
| c_p(298.15 K): O₂ 29.376, N₂ 29.124, CH₄ 35.639 J/(mol·K); ΔH_f(CH₄) = −74.873 kJ/mol | NIST-JANAF Thermochemical Tables, 4th ed. (Chase 1998) |
| 1 psi = 6.894757e3 Pa, 1 lbf = 4.448222 N | NIST SP 811, Appendix B.8 |
| 4× ⌀1.4 mm GOX at 480 psia, 293 K, C_d 0.77 → 38.8 g/s (V-9) | PROJECT_PLAN §2.2–2.3; brief V-9 |

## Element constants

| Value | Where | Source |
|---|---|---|
| Δp_lin = 1e-3·p_up | orifice regularization | design choice, approved 2026-09-26 (docs/solver.md §4) |
| ρ_water(60 °F) = 999.0 kg/m³ | C_v → C_dA | IAPWS-95 at 15.56 °C, 1 atm (hand-entered; enters as √ρ, so a 0.01% error is 0.005% in C_dA) |
| 1 US gal = 231 in³ | C_v → C_dA | exact by definition |
| T_MIN = 20 K | lowest node temperature accepted | design choice (solver guard, not physics) |
| relief accumulation = 10% of set | full lift at set + 10% (elements/relief.js); relief sizing rule | Dalton's decision, 2026-09-26 |
| P&ID tags `<ISA letters>-<circuit>-<nn>`; RO/FE for stand orifices; engine parts INJ-OX-01, INJ-FU-01, THROAT-01 | src/data/tags.js | S-2, Dalton's decisions, 2026-09-26 |

## Test fixtures

`src/physics/selftest/fixtures.js` and each suite's fixed parameters (bottle 50 L at 2000 psia,
20 cm³ manifolds, 5 cm³ lines, regulator 20 psi droop and τ = 20 ms, relief τ_lift = 2 ms and
600 psi set, test tank sizes) are **test
fixtures**, chosen to exercise the solver. They aren't stand defaults and must not be copied
into one. The values in that file taken from PROJECT_PLAN (injector geometry, throat, chamber
volume, 480 psia manifold, 250 psia P_c) cite their section on the line.

## Component defaults (`data/components.json`)

The GN₂ cold-flow stand's defaults, in datasheet units, loaded and converted to SI by
`src/data/components.js`. **Every value has either a `source` or `placeholder: true` with its
tracking issue, and the loader refuses anything else.**

- **Sourced:**
  - injector 4× ⌀1.4 mm, throat ⌀8.0 mm, chamber ≈45 cm³ (PROJECT_PLAN §2.2–2.3);
  - regulator set point 480 psia at 38.8 g/s rated flow (PROJECT_PLAN §2.2–2.3);
  - relief accumulation 10% (decision 2026-09-26);
  - standard atmosphere.
- **Uncalibrated:** injector C_d 0.78 (brief §4.3 default) until Phase 5 step 2/3.
- **Placeholders (issue #6):** 25 values, covering bottle volume and fill, valve C_v and timing,
  regulator C_v / droop / τ, relief set / blowdown / τ_lift / sizing margin, manifold, line and
  HP-line volumes, throat C_d, ambient temperature. The stand's Setup panel lists them.

The relief C_dA is not a free number: it is the build-time rule's minimum times the sizing
margin, so it follows the regulator and set pressure.
