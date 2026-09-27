/**
 * Transducer observer and the stand-daq-v1 file. Checks the lag step against the exponential,
 * quantization against its LSB, a seeded noise stream against itself, and a CSV round trip
 * against Test_Stand/daq_format.md.
 */
import { ok, approx, section } from './harness.js';
import { stepLag, quantize, lsb, measureSeries } from '../sensors.js';
import { daqCsv, parseDaq } from '../daq.js';

export function run() {
  section('Sensors · lag, quantization, seeded noise');
  const tau = 1e-3;
  const p0 = 1e5;
  const p1 = 5e5;
  approx(stepLag(p0, p1, tau, tau), p1 + (p0 - p1) * Math.exp(-1), 1e-12, 'one time constant of lag is 1 − 1/e of the step');
  approx(stepLag(p0, p1, 0, tau), p1, 0, 'a zero-width step passes the new value (the sensor starts settled)');

  const range = 100;
  const bits = 2;
  const step = lsb(range, bits);
  approx(step, 100 / 3, 1e-15, '2-bit LSB is range / 3');
  approx(quantize(50, range, bits), 2 * step, 1e-12, 'nearest level of 50 on a 2-bit range');
  approx(quantize(-5, range, bits), 0, 0, 'below the range clamps to 0');
  approx(quantize(1e9, range, bits), range, 0, 'above the range clamps to full scale');
  ok(Math.abs(quantize(37, 3000, 16) - 37) <= 0.5 * lsb(3000, 16) + 1e-9, 'quantization error is at most half an LSB');

  const samples = [
    { t: 0, p: { line: p0 } },
    { t: tau, p: { line: p1 } },
  ];
  const ch = [{ tag: 'PT-OX-03', node: 'line', quantity: 'p', unit: 'Pa', range: 1e7, bits: 16, tau, noise: 1000 }];
  const quiet = measureSeries(samples, ch);
  approx(quiet[1].values['PT-OX-03'], quantize(p1 + (p0 - p1) * Math.exp(-1), 1e7, 16), 1e-9, 'quiet series is lag then quantization');
  const noisy = measureSeries(samples, ch, { seed: 1 });
  const again = measureSeries(samples, ch, { seed: 1 });
  ok(noisy[1].values['PT-OX-03'] === again[1].values['PT-OX-03'], 'the same noise seed rewrites the same reading');
  ok(noisy[1].values['PT-OX-03'] !== quiet[1].values['PT-OX-03'], 'a seeded log is not the quiet reading');

  section('DAQ · stand-daq-v1 round trip');
  const csv = daqCsv({ run: 'gn2-coldflow/gn2-step1', rateHz: 50, channels: ch, rows: noisy, seed: 1 });
  ok(!csv.includes('\r') && csv.endsWith('\n') && !csv.startsWith('\uFEFF'), 'LF, trailing newline, no BOM');
  const parsed = parseDaq(csv);
  ok(parsed.fields.format === 'stand-daq-v1' && parsed.fields.source === 'sim' && parsed.fields.t_unit === 's', 'format, source and time unit');
  ok(parsed.fields.run === 'gn2-coldflow/gn2-step1' && parsed.fields.rate_hz === '50' && parsed.fields.noise_seed === '1', 'run, rate and noise seed');
  ok(parsed.channels[0].tag === 'PT-OX-03' && parsed.channels[0].quantity === 'p' && parsed.channels[0].unit === 'Pa', 'channel tag, quantity and unit');
  approx(parsed.channels[0].tau_s, tau, 0, 'channel lag');
  ok(parsed.header.join(',') === 't_s,PT-OX-03', 'column header is t_s then the tag');
  approx(parsed.rows[1].t, tau, 0, 'sample time survives');
  approx(parsed.rows[1].values['PT-OX-03'], noisy[1].values['PT-OX-03'], 1e-9, 'the written reading parses back');

  let bom = false;
  try {
    parseDaq(`\uFEFF${csv}`);
  } catch (e) {
    bom = /BOM/.test(e.message);
  }
  ok(bom, 'a BOM is refused');
}
