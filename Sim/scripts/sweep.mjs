/**
 * `npm run sweep -- <config.json>`: batch design checks (brief §5.5), headless. Writes CSV (and for
 * the choke-margin study an SVG chart) next to the config's `out` path.
 *
 * Config kinds (pressures in psia, the unit the stand is set in; everything else SI):
 *
 *   { "kind": "choke-margin", "pUp_psia": [..], "eta": [..], "scaledAt_psia": 480, "out": "…" }
 *       GOX and GCH₄ injector choke margin p₀/P_c against manifold pressure, one line per η_c*,
 *       with the holes as drawn; plus, for the first η, the holes scaled so the design flow is kept
 *       at each manifold pressure (area ∝ scaledAt/p). The chart S-3 asks for (brief §8).
 *   { "kind": "grid", "axes": { input: [..] }, "base": {..}, "out": "…" }
 *   { "kind": "montecarlo", "n": N, "seed": S, "params": { input: { dist, … } }, "base": {..}, "out": "…" }
 *       Spreads are the config author's. None is built in (physics/sweep.js).
 *
 * Inputs: pUp_psia (or pUp in Pa), eta, CdOx, CdFu, Tox, Tfu (K), lead (s). Uncalibrated, like
 * everything the sim computes; the outputs say so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { gridSweep, monteCarlo, steadyPoint, toCsv, OUTPUTS } from '../src/physics/sweep.js';
import { criticalRatio } from '../src/physics/elements/orifice.js';
import { components } from '../src/data/components.js';
import { PSI } from '../src/physics/constants.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run sweep -- <config.json>');
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const out = path.resolve(path.dirname(file), cfg.out || path.basename(file, '.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // not a checkout
}
const stamp = `uncalibrated · stand sim ${commit} · ${new Date().toISOString().slice(0, 10)}`;
const si = (x) => {
  const o = { ...x };
  if ('pUp_psia' in o) {
    o.pUp = o.pUp_psia * PSI;
    delete o.pUp_psia;
  }
  return o;
};

if (cfg.kind === 'choke-margin') {
  const c = components();
  const Cd = c.injector.Cd;
  const rows = [];
  for (const eta of cfg.eta) {
    for (const p of cfg.pUp_psia) rows.push({ scenario: 'holes as drawn', ...steadyPoint({ pUp: p * PSI, eta }), pUp_psia: p });
  }
  const eta0 = cfg.eta[0];
  for (const p of cfg.pUp_psia) {
    const k = cfg.scaledAt_psia / p;
    rows.push({ scenario: `holes scaled for design flow at ${cfg.scaledAt_psia} psia`, ...steadyPoint({ pUp: p * PSI, eta: eta0, CdOx: Cd * k, CdFu: Cd * k }), pUp_psia: p });
  }
  const cols = ['scenario', 'pUp_psia', 'eta', 'Pc', 'OF', 'mdot', 'F', 'marginOx', 'marginFu', 'chokedOx', 'chokedFu'];
  const csv = `# ${stamp}\n# choke-margin study for S-3 (brief §8). Pc in Pa, mdot kg/s, F N. Not a decision: S-3 is Dalton's.\n` + rows.map((r) => r).reduce((acc, r, i) => acc + (i === 0 ? cols.join(',') + '\n' : '') + cols.map((k) => (typeof r[k] === 'string' ? `"${r[k]}"` : typeof r[k] === 'boolean' ? (r[k] ? 1 : 0) : Number(Number(r[k]).toPrecision(8)))).join(',') + '\n', '');
  fs.writeFileSync(`${out}.csv`, csv);
  fs.writeFileSync(`${out}.svg`, chokeChart(rows, cfg, stamp, criticalRatio(1.4)));
  console.log(`wrote ${path.relative(process.cwd(), out)}.csv and .svg (${rows.length} points)`);
} else if (cfg.kind === 'grid') {
  const axes = {};
  for (const [k, v] of Object.entries(cfg.axes)) {
    if (k === 'pUp_psia') axes.pUp = v.map((p) => p * PSI);
    else axes[k] = v;
  }
  const rows = gridSweep(axes, si(cfg.base || {}));
  fs.writeFileSync(`${out}.csv`, `# ${stamp}\n` + toCsv(rows, [...Object.keys(axes), ...OUTPUTS]));
  console.log(`wrote ${path.relative(process.cwd(), out)}.csv (${rows.length} points)`);
} else if (cfg.kind === 'montecarlo') {
  const params = {};
  for (const [k, v] of Object.entries(cfg.params)) {
    if (k === 'pUp_psia') params.pUp = Object.fromEntries(Object.entries(v).map(([a, b]) => [a, typeof b === 'number' && a !== 'dist' ? b * PSI : b]));
    else params[k] = v;
  }
  const res = monteCarlo({ params, n: cfg.n, seed: cfg.seed, base: si(cfg.base || {}) });
  fs.writeFileSync(`${out}.csv`, `# ${stamp}\n` + toCsv(res.rows, [...Object.keys(params), ...OUTPUTS]));
  fs.writeFileSync(`${out}.stats.json`, JSON.stringify({ stamp, uncalibrated: true, config: cfg, stats: res.stats }, null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), out)}.csv and .stats.json (${res.rows.length} draws)`);
  for (const [k, s] of Object.entries(res.stats)) console.log(`  ${k.padEnd(9)} mean ${s.mean.toPrecision(5)}  sd ${s.sd.toPrecision(3)}  5–95% ${s.p05.toPrecision(5)} – ${s.p95.toPrecision(5)}`);
} else {
  console.error(`sweep: unknown kind ${cfg.kind}`);
  process.exit(2);
}

/**
 * GOX choke margin vs manifold pressure. One y-axis (p₀/P_c), up to four series in the reference
 * categorical order (blue, orange, aqua, yellow), each also direct-labelled; the scaled-holes
 * series is dashed as a second cue. Reference lines: O₂'s critical ratio and brief §5.2's 2.2.
 */
function chokeChart(rows, cfgIn, stampText, rCrit) {
  const W = 820;
  const H = 460;
  const m = { l: 64, r: 190, t: 58, b: 72 };
  const series = [...new Set(rows.map((r) => `${r.scenario}|${r.eta}`))].map((key, i) => {
    const [scenario, eta] = key.split('|');
    const pts = rows.filter((r) => r.scenario === scenario && String(r.eta) === eta).sort((a, b) => a.pUp_psia - b.pUp_psia);
    const scaled = scenario !== 'holes as drawn';
    return { i, pts, dashed: scaled, label: scaled ? `η ${eta}, holes scaled` : `η ${eta}, holes as drawn` };
  });
  const xs = rows.map((r) => r.pUp_psia);
  const ys = rows.map((r) => r.marginOx).concat([1 / rCrit, 2.2]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.floor(Math.min(...ys) * 10) / 10 - 0.05;
  const y1 = Math.ceil(Math.max(...ys) * 10) / 10 + 0.05;
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (y) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ticksX = [];
  for (let x = Math.ceil(x0 / 50) * 50; x <= x1; x += 50) ticksX.push(x);
  const ticksY = [];
  for (let y = Math.ceil(y0 * 10) / 10; y <= y1 + 1e-9; y += 0.1) ticksY.push(Number(y.toFixed(1)));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines = series.map((s) => {
    const d = s.pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.pUp_psia).toFixed(1)},${Y(p.marginOx).toFixed(1)}`).join(' ');
    const dots = s.pts.map((p) => `<circle class="s${s.i + 1} dot" cx="${X(p.pUp_psia).toFixed(1)}" cy="${Y(p.marginOx).toFixed(1)}" r="4"><title>${esc(s.label)}: manifold ${p.pUp_psia} psia → P_c ${(p.Pc / PSI).toFixed(1)} psia, GOX p₀/P_c ${p.marginOx.toFixed(3)} (${p.chokedOx ? 'choked' : 'NOT choked'}), GCH₄ ${p.marginFu.toFixed(3)}</title></circle>`).join('');
    const last = s.pts[s.pts.length - 1];
    return `<path class="s${s.i + 1} line${s.dashed ? ' dash' : ''}" d="${d}"/>${dots}<text class="direct" x="${X(last.pUp_psia) + 8}" y="${Y(last.marginOx) + 4}">${esc(s.label)}</text>`;
  });
  let lx = m.l;
  const legend = series.map((s) => {
    const x = lx;
    lx += 44 + 7 * s.label.length;
    return { s, x };
  }).map(({ s, x }) => `<g transform="translate(${x},${m.t - 22})"><line class="s${s.i + 1} line${s.dashed ? ' dash' : ''}" x1="0" y1="0" x2="18" y2="0"/><text class="legend" x="24" y="4">${esc(s.label)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">GOX injector choke margin against manifold pressure</title>
<desc id="d">Choke margin p0/Pc of the GOX injector at steady burning, for eta_c* values, with the injector holes as drawn and with holes scaled to keep the design flow. ${esc(stampText)}.</desc>
<style>
  svg { --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --grid: #e6e5e1; --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; font-family: system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { svg { --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --grid: #34332f; --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; } }
  .bg { fill: var(--surface); } .grid { stroke: var(--grid); stroke-width: 1; } .axis { fill: var(--ink2); font-size: 12px; }
  .title { fill: var(--ink); font-size: 15px; font-weight: 600; } .sub, .legend, .direct, .ref { fill: var(--ink2); font-size: 12px; }
  .line { fill: none; stroke-width: 2; } .dash { stroke-dasharray: 6 4; } .dot { stroke: var(--surface); stroke-width: 2; }
  .refline { stroke: var(--ink2); stroke-width: 1; stroke-dasharray: 2 3; }
  .s1 { stroke: var(--s1); } circle.s1 { fill: var(--s1); } .s2 { stroke: var(--s2); } circle.s2 { fill: var(--s2); }
  .s3 { stroke: var(--s3); } circle.s3 { fill: var(--s3); } .s4 { stroke: var(--s4); } circle.s4 { fill: var(--s4); }
</style>
<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>
<text class="title" x="${m.l}" y="20">GOX injector choke margin p₀/P_c vs manifold pressure</text>
${legend}
${ticksY.map((y) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}"/><text class="axis" x="${m.l - 8}" y="${Y(y) + 4}" text-anchor="end">${y.toFixed(1)}</text>`).join('')}
${ticksX.map((x) => `<text class="axis" x="${X(x)}" y="${H - m.b + 18}" text-anchor="middle">${x}</text>`).join('')}
<text class="axis" x="${(m.l + W - m.r) / 2}" y="${H - m.b + 36}" text-anchor="middle">manifold pressure (psia)</text>
<text class="axis" transform="translate(16,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">p₀/P_c</text>
<line class="refline" x1="${m.l}" x2="${W - m.r}" y1="${Y(1 / rCrit)}" y2="${Y(1 / rCrit)}"/><text class="ref" x="${W - m.r - 6}" y="${Y(y0 + 0.06)}" text-anchor="end">dotted at ${(1 / rCrit).toFixed(3)}: O₂ critical ratio; below it the injector is not choked</text>
<line class="refline" x1="${m.l}" x2="${W - m.r}" y1="${Y(2.2)}" y2="${Y(2.2)}"/><text class="ref" x="${m.l + 6}" y="${Y(2.2) - 6}">2.2: green on the schematic (brief §5.2)</text>
${lines.join('\n')}
<text class="sub" x="${m.l}" y="${H - 22}">${esc(stampText)}. Steady burn on the chamber-fill network, CEA c*.</text>
<text class="sub" x="${m.l}" y="${H - 6}">Holes as drawn: P_c rises with manifold pressure and the margin stays put. The S-3 target and fix are Dalton's.</text>
</svg>
`;
}
