# Test-stand DAQ CSV (`stand-daq-v1`)

The simulator and the stand logger write the same file. `Sim/src/physics/daq.js` is the writer
the self-test checks. A reduction notebook should parse this file and nothing else.

## File

- UTF-8, LF line endings, no BOM.
- A line that begins with `#` is a header field: `# key: value`.
- Blank lines are ignored.
- The first line that is not a comment is the column header.
- Every line after that is one sample.

## Required header fields

| key | value |
|---|---|
| `format` | `stand-daq-v1` |
| `source` | `sim` or `stand` |
| `run` | run id (the sim uses `<stand id>/<sequence id>`, or `<stand id>/operate`) |
| `t_unit` | `s` |
| `rate_hz` | nominal sample rate |

Optional: `noise_seed`, an integer. Present only when reading noise was applied. The same seed
rewrites the same file.

## Channel lines

One per channel, in column order, after the fields above:

```
# channel: <tag> quantity=<p|T|F> unit=<Pa|K|N> range=<number> bits=<n> tau_s=<number>
```

`range` is the full scale in `unit`. `tau_s` is the first-order lag in seconds. `bits` is the ADC
width. The column value is the lagged, noisy, quantized reading in `unit`, not the true node value.
The true pressure stays in the simulator.

## Columns

`t_s`, then one column per channel. The header cell is the channel tag (an S-2 tag, such as
`PT-OX-02`).

`t_s` is seconds from the start of the run, six digits after the decimal. It is not rebased when a
log starts late. Channel values are plain decimals or scientific notation that `parseFloat` reads
back to the written number.

## What is applied before a sample is written

The transducer does not feed back into the gas. On the true node quantity, in order:

1. **Lag.** First-order, in sim time. Between samples the input is taken as constant at the new
   sample, so the step is exact: \(y \leftarrow p + (y - p)\,e^{-\Delta t/\tau}\). The sensor
   starts settled on the first sample.
2. **Noise.** Gaussian, 1-sigma from the channel's `noise`, only when `noise_seed` is set.
   The lag state is the quiet reading, so noise does not integrate.
3. **Quantization.** \(\mathrm{LSB} = \mathrm{range}/(2^{\mathrm{bits}}-1)\), nearest, clamped to
   \([0, \mathrm{range}]\).

`range`, `tau` and `noise` are placeholders until a transducer datasheet replaces them
(issue #6). They are not knobs for the solver.
