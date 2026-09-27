/**
 * Checks on the app shell that are pure but not physics (so they cannot live in src/physics/,
 * which must not import engine/ or ui/): routing and display formatting.
 */
import { parseHash, hashFor } from '../src/engine/router.js';
import { LABS } from '../src/data/catalog.js';
import { fmtP, fmtF, fmtT, setUnitSystem } from '../src/ui/format.js';
import { PSI } from '../src/physics/constants.js';

let failed = 0;
function ok(cond, name) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed += 1;
}

console.log('Router');
const first = LABS[0];
ok(parseHash('').id === first.id, 'an empty hash opens the first lab');
ok(parseHash('#/nope/zzz').id === first.id, 'an unknown route falls back to the first lab');
ok(parseHash(hashFor(first.id)).id === first.id, 'hashFor round-trips through parseHash');
ok(parseHash(`#/${first.kind}/${first.id}?case=x`).params.get('case') === 'x', 'query parameters survive');
ok(parseHash(`#/stand/${first.id}`).kind === first.kind, 'a lab id under the wrong kind is not opened as that kind');

console.log('Format');
setUnitSystem('us');
ok(fmtP(250 * PSI) === '250 psia', 'US pressure is psia');
ok(fmtF(111.2) === '25 lbf', 'US thrust is lbf (PROJECT_PLAN §2.2: 111.2 N = 25 lbf)');
ok(fmtT(273.15).startsWith('32 °F'), '273.15 K is 32 °F');
setUnitSystem('si');
ok(fmtP(250 * PSI) === '1.724 MPa', 'SI pressure above 1 MPa is MPa');
ok(fmtF(111.2) === '111 N', 'SI thrust is N');
setUnitSystem('us');

console.log('Guide');
const { COURSE } = await import('../src/data/course.js');
const { STANDS } = await import('../src/data/stands/index.js');
const { GLOSSARY } = await import('../src/data/glossary.js');
ok(COURSE.every((l) => LABS.some((x) => x.id === l.lab)), 'every lesson opens a lab that exists');
ok(new Set(COURSE.map((l) => l.id)).size === COURSE.length, 'lesson ids are unique');
const tagIssues = [];
for (const l of COURSE) {
  const stand = STANDS[l.lab]?.();
  if (!stand) continue;
  const tags = new Set([...stand.net.edges.map((e) => e.id), ...(stand.net.igniters || []).map((g) => g.id)]);
  for (const st of l.steps) if (typeof st.next?.tag === 'string' && !tags.has(st.next.tag)) tagIssues.push(`${l.id}: ${st.next.tag}`);
}
ok(!tagIssues.length, `every highlighted tag is on its lesson's stand (${tagIssues.join(', ') || 'clean'})`);
ok(COURSE.every((l) => l.steps.length && l.takeaway && l.goal), 'every lesson has a goal, steps and a takeaway');
ok(GLOSSARY.every((g) => g.term && g.def) && new Set(GLOSSARY.map((g) => g.term)).size === GLOSSARY.length, 'glossary terms are unique and defined');

console.log(`\nshell-check: ${failed ? `${failed} failed` : 'all passed'}`);
if (failed) process.exit(1);
