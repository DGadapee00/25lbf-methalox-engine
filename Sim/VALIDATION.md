# Validation

Predicted vs. measured, per test. One section per Phase 5 test day, written when the prediction
is registered (frozen, before the test) and completed after the DAQ data is reduced.

No entries yet: nothing has been tested, so every result in the simulator is **uncalibrated**.

The self-test (`npm test`) is verification — the code against independent closed forms,
conservation laws and published values. This file is validation — the model against hardware.

## Open verification items

- **V-10 (C_v → C_dA): closed 2026-09-26 as verified by definition.** C_v's definition plus exact
  unit factors gives C_dA = C_v/37.99 in², checked in `npm test`.
- **V-10b (gas-valve sizing, x_T): open, blocked on D-5.** Liquid equivalence ignores a valve's
  pressure-recovery factor, which matters for gas service near choking. Once a valve is
  selected, check against the vendor's published gas-sizing method. Reported as PENDING.
- **V-4 over a hot-fire sequence: closed in M4 as verification.** The self-test runs it over a
  hot-fire run on the hot-fire stand with fixture timings (not a proposed sequence): mass to
  round-off through ignition, burn and shutdown. Nothing here has been compared with hardware.
