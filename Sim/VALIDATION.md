# Validation

Predicted vs. measured, per test. One section per Phase 5 test day, written when the prediction
is registered (frozen, before the test) and completed after the DAQ data is reduced.

No entries yet: nothing has been tested, so every result in the simulator is **uncalibrated**.

The self-test (`npm test`) is verification — the code against independent closed forms,
conservation laws and published values. This file is validation — the model against hardware.

## Open verification items

- **V-10 (C_v → C_dA):** the derivation from the C_v definition is checked (C_dA = C_v/37.99 in²),
  but the brief also requires agreement with a **published worked example**. None has been cited
  and reviewed yet, so the self-test reports V-10 as PENDING.
- **V-4 over a hot-fire sequence:** runs over a cold-flow sequence until the chamber model
  exists (M4).
