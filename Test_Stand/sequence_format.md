# Sequence tables (`Test_Stand/sequences/*.json`)

A sequence table is the single source for the valve-state matrix (Phase 2 gate), the simulator's
Sequence mode and, later, the sequencer firmware (brief §5.4). The simulator reads the files through
`Sim/src/data/sequences.js` and plays them with the table driver, `Sim/src/physics/sequencer.js`.
This page is the format; the driver's header comment is the implementation.

Every number in a table is a design value and is the table author's. The simulator adds none: an
abort that names an action the table does not define is refused, not given a default.

## Fields

| field | required | meaning |
|---|---|---|
| `id` | yes | the file name without `.json` |
| `purpose` | no | one line |
| `tEnd` | yes | how long a Sequence-mode run lasts, s |
| `rateHz` | yes | DAQ and sequencer sample rate, Hz |
| `steps` | yes | `[{ "t": s, "cmd": { "<TAG>": <command> }, "note"?: "…" }]` |
| `aborts` | no | `[{ "id", "when", "action", "test"? }]` |
| `actions` | with aborts | `{ "<name>": [{ "dt": s, "cmd": { "<TAG>": <command> } }] }` |
| `checks` | no | `[{ "id", "expect", "source"? }]` |

Commands: valves `"open"`, `"close"` or a position 0–1; regulators `{ "pSet": Pa }`; the igniter
`"on"` / `"off"`. Faults (`{ "fault": … }`) are what the world does to the stand, not what the
table commands; they belong in an abort's `test` or in the simulator's fault menu.

## Abort conditions (`when`)

```
<SENSOR> <op> <number> <unit> [after t=<s>] [before t=<s>] [for <n> samples]
```

- `SENSOR`: a transducer tag on the stand (`PT-…`, `TE-…`, `LC-…`). The driver reads the
  transducer (lagged and quantized, `daq_format.md`), never the true pressure.
- `op`: `<`, `<=`, `>`, `>=`. `unit`: `psia`, `Pa`, `kPa`, `MPa`, `lbf`, `N`, `K`. A transducer
  reading is absolute, so `psi` is refused.
- `for <n> samples`: the condition must hold on n consecutive samples (default 1).

The first abort to trip cancels the rest of the steps and schedules its action, each command `dt`
seconds after the trip. The sequence is then latched: a later trip is recorded but does not act.

`test` (optional here, required by the simulator's self-test for every abort in a committed table):
`{ "faults": [{ "t": s, "id": "<TAG>", "cmd": { "fault": … } }] }`, the fault that should make this
abort trip. The self-test runs every abort both ways: nominal (must not trip) and with its test
fault (must trip).

## Checks (`expect`)

```
<SENSOR> <op> <number> <unit> [span]          every reading in the span
<ENGINE-TAG> choked [span]                     e.g. INJ-OX-01 choked from t=1.6 to t=2.5
chamber burning [span] | chamber not burning [span]
unburned energy at ignition < <number> J       every ignition
no abort
```

`span`: `[from t=<a> | after t=<a> | after abort + <a> s] [to t=<b> | before t=<b>]`. A check that
starts after an abort passes as "not applicable" when no abort fired.

## Faults the simulator can inject

| element | faults |
|---|---|
| valve (`SV`, `XV`, `HV`) | `"stuck"` (frozen where it is, commands ignored) |
| regulator (`PCV`) | `"open"`, `"closed"`, `{ "creep": C_dA m² }` |
| injector or throat orifice | `{ "blockage": 0–1 }` (fraction of flow area lost) |
| igniter | `"no-light"` |

`{ "fault": null }` clears a fault.
