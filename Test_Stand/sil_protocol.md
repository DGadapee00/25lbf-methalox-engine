# SIL / HIL protocol (`stand-sil-v1`)

How a sequencer outside the simulator (a native build of the firmware's logic core for
software-in-the-loop, or a bridge to the real controller for hardware-in-the-loop) is driven by the
simulated stand (brief §4.7, J-4). The simulator side is `Sim/src/physics/sil.js` and
`Sim/scripts/sil/adapter.mjs`; `npm run sil-check -- <command> <args…>` runs any sequencer through
it and holds it to the table driver's verdicts.

The controller (D-7) is not chosen, so nothing here assumes one. The only reference sequencer is
`Sim/scripts/sil/process.mjs`, the table logic in a child process: it proves the protocol and is not
the firmware.

## Transport

JSON, one object per line (LF), UTF-8. The simulator writes to the sequencer's stdin and reads its
stdout; stderr is passed through for the sequencer's own logging. A serial bridge carries the same
lines.

## Simulator → sequencer

```json
{"type":"init","protocol":"stand-sil-v1","table":{…},"sensors":["PT-OX-01",…],"rateHz":50}
{"type":"tick","t":1.02,"readings":{"PT-OX-02":3309812.4,"PT-CH-01":101325,…}}
{"type":"end"}
```

- `table` is the sequence file (`sequence_format.md`). A sequencer with its table compiled in may
  ignore it.
- One `tick` per DAQ sample, t = k / rateHz from 0. `readings` are what the DAQ reads (lagged and
  quantized, `daq_format.md`) in SI: Pa, N, K. Never the true node values.

## Sequencer → simulator

Exactly one line per tick, before the next tick is sent:

```json
{"commands":[{"id":"SV-OX-01","cmd":"open"}],"events":[{"what":"abort","id":"A-1"}]}
```

- `commands` take effect at that tick's time. A tag the stand does not have stops the run.
- `events` with `"what":"abort"` report a trip; the first one is the run's abort, for the checks
  that refer to it. Other events are recorded and ignored.

## Conformance (M7 done-when)

For each committed table (and the M5 fixture table on the hot-fire stand, nominal and with each
abort's test fault) the sequencer must trip the same aborts as the table driver, within two sample
periods, and every check must reach the same verdict.
