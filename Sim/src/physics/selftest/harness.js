/**
 * Self-test plumbing: pass/fail counting, and relative checks with the tolerance stated at the
 * call site. Same philosophy as FLUX (brief §7): check the code against independent results —
 * closed forms, conservation laws, published values — never against itself.
 */
let passed = 0;
let failed = 0;
const failures = [];

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

export function section(title) {
  console.log(`\n${title}`);
}

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log(`failed: ${failures.join('; ')}`);
  return failed;
}
