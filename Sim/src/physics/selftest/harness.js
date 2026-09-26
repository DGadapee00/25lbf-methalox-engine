/**
 * Self-test plumbing: pass/fail counting, and relative checks with the tolerance stated at the
 * call site. Same philosophy as FLUX (brief §7): check the code against independent results —
 * closed forms, conservation laws, published values — never against itself.
 */
let passed = 0;
let failed = 0;
const failures = [];
const pendings = [];

/**
 * Relative check: |a − b| ≤ tol·|b|. When the expected value is exactly 0, `tol` is absolute.
 * (FLUX's lesson: a max(1, |b|) floor makes every check on a small SI quantity pass.)
 */
export function approx(a, b, tol, name) {
  const scale = b !== 0 ? Math.abs(b) : 1;
  const rel = Math.abs(a - b) / scale;
  const good = Number.isFinite(a) && rel <= tol;
  record(good, name, good ? '' : `got ${a}  expected ${b}  rel ${rel.toExponential(2)} > ${tol}`);
  return good;
}

export function ok(cond, name, detail = '') {
  record(!!cond, name, cond ? '' : detail);
  return !!cond;
}

function record(good, name, detail) {
  if (good) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    if (detail) console.log(`        ${detail}`);
  }
}

/** A check the brief requires that cannot be completed yet. Counted apart: never a pass. */
export function pending(name, why) {
  pendings.push(name);
  console.log(`  PEND  ${name}`);
  if (why) console.log(`        ${why}`);
}

export function section(title) {
  console.log(`\n${title}`);
}

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed, ${pendings.length} pending`);
  if (pendings.length) console.log(`pending: ${pendings.join('; ')}`);
  if (failed) console.log(`failed: ${failures.join('; ')}`);
  return failed;
}

/**
 * Stiffness canary. Every simulation a test runs reports its step count and wall time here. At the
 * end they are printed as a table and compared with scripts/baseline/solver-steps.json:
 *   > 1.5× baseline steps  WARN  (something made the problem stiffer, or the tolerances changed)
 *   > 3×   baseline steps  FAIL  (the explicit integrator is being forced into tiny steps: time to
 *                                 look at an implicit method, per docs/solver.md)
 * Wall time is printed but never judged: it depends on the machine.
 * `node src/physics/selftest.js --record-steps` rewrites the baseline; do it in its own commit.
 */
const runs = [];
export function recordStats(name, stats) {
  runs.push({ name, ...stats });
}

export async function stiffnessReport() {
  const fs = await import('node:fs');
  const url = new URL('../../../scripts/baseline/solver-steps.json', import.meta.url);
  const base = fs.existsSync(url) ? JSON.parse(fs.readFileSync(url, 'utf8')).steps : {};
  section('Stiffness canary (steps vs scripts/baseline/solver-steps.json)');
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(`  ${pad('run', 44)}${padL('steps', 8)}${padL('rej', 6)}${padL('f-evals', 9)}${padL('events', 8)}${padL('ms', 9)}${padL('base', 8)}`);
  for (const r of runs) {
    const b = base[r.name];
    console.log(`  ${pad(r.name, 44)}${padL(r.steps, 8)}${padL(r.rejected, 6)}${padL(r.nfev, 9)}${padL(r.events, 8)}${padL(r.wallMs.toFixed(1), 9)}${padL(b ?? '—', 8)}`);
  }
  for (const r of runs) {
    const b = base[r.name];
    if (!b) {
      console.log(`  NOTE  ${r.name}: no baseline step count (record with --record-steps)`);
      continue;
    }
    if (r.steps > 3 * b) ok(false, `${r.name}: steps within 3× baseline`, `${r.steps} steps vs baseline ${b}`);
    else if (r.steps > 1.5 * b) console.log(`  WARN  ${r.name}: ${r.steps} steps vs baseline ${b} (> 1.5×)`);
  }
  if (process.argv.includes('--record-steps')) {
    const steps = Object.fromEntries(runs.map((r) => [r.name, r.steps]));
    const note = 'Step counts per self-test simulation, the stiffness canary baseline (see harness.js). Rewrite with `node src/physics/selftest.js --record-steps`, in its own commit, saying why.';
    fs.writeFileSync(url, JSON.stringify({ _note: note, steps }, null, 2) + '\n');
    console.log(`  recorded ${runs.length} step counts to scripts/baseline/solver-steps.json`);
  }
}
