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

None yet. Planned: species thermo (GRI-Mech 3.0 NASA-7, M1), CEA equilibrium (M4), CoolProp
Z and μ_JT (M4/v1.1).

## Component defaults

None yet. They arrive with the component labs (M2) and cite a datasheet or are labelled as
placeholders on screen.
