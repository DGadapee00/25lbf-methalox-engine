# Validation

Predicted vs. measured, per test. One section per Phase 5 test day, written when the prediction
is registered (frozen, before the test) and completed after the DAQ data is reduced.

No entries yet: nothing has been tested, so every result in the simulator is **uncalibrated**.

The self-test (`npm test`) is verification — the code against independent closed forms,
conservation laws and published values. This file is validation — the model against hardware.

## Open verification items

- **V-10 (C_v → C_dA):** the derivation from the C_v definition is checked (C_dA = C_v/37.99 in²),
  but the brief also requires agreement with a **published worked example**. The candidate is
  IEC 60534-2-1 / ANSI/ISA-75.01.01 Annex D ("Examples of sizing calculations"). On 2026-09-26
  every host carrying it was blocked from the build sandbox (law.resource.org,
  webstore.ansi.org, cdn.standards.iteh.ai, catedras.facet.unt.edu.ar), and the examples are not
  reproduced from memory. The self-test reports V-10 as PENDING until the example's inputs and
  result are transcribed with page reference. Note that those examples size *control valves* with
  F_L, F_P and x_T, so the comparison is only exact for the incompressible, non-choked,
  F_P = 1 case; that is the one to transcribe.
- **V-4 over a hot-fire sequence:** runs over a cold-flow sequence until the chamber model
  exists (M4).
