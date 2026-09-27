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

console.log('Symbol key');
const { SYMBOLS } = await import('../src/data/glossary.js');
const { SYMBOL_DRAWINGS, symbolFigure } = await import('../src/ui/symbolKey.js');
const { edgeShape } = await import('../src/scene/symbols.js');
const { parseTag } = await import('../src/data/tags.js');
ok(SYMBOLS.every((g) => g.name && g.def && SYMBOL_DRAWINGS.includes(g.draw)), 'every symbol entry has a name, a meaning and a drawing');
ok(SYMBOL_DRAWINGS.every((d) => SYMBOLS.some((g) => g.draw === d)), 'every drawing belongs to an entry');
ok(SYMBOL_DRAWINGS.every((d) => !/NaN|undefined|Infinity/.test(symbolFigure(d))), 'every drawing renders with finite coordinates');
// Every symbol the stands draw has a key entry, and every tag the key cites is on a stand.
const DRAW_OF = { valve: (l) => (l === 'HV' ? 'hv' : 'sv'), regulator: () => 'pcv', relief: () => 'psv', check: () => 'ckv', orifice: () => 'orifice' };
const stands = Object.values(STANDS).map((f) => f());
const missing = new Set();
const allTags = new Set(['IGN-IG-01']);
for (const st of stands) {
  for (const e of st.net.edges) {
    allTags.add(e.id);
    const d = DRAW_OF[e.type]?.(parseTag(e.id)?.letters);
    if (!d || !edgeShape(e.type, parseTag(e.id)?.letters) || !SYMBOLS.some((g) => g.draw === d)) missing.add(`${e.type} ${e.id}`);
  }
  for (const s of st.sensors || []) allTags.add(s.tag);
}
ok(!missing.size, `every element type on the stands is in the symbol key (${[...missing].join(', ') || 'clean'})`);
const cited = SYMBOLS.flatMap((g) => (g.where || '').match(/\b[A-Z]{2,3}-[A-Z0-9]{2}-\d{2}\b/g) || []);
const unknown = cited.filter((t) => !allTags.has(t));
ok(!unknown.length, `every tag the symbol key cites is on a stand (${unknown.join(', ') || 'clean'})`);

console.log(`\nshell-check: ${failed ? `${failed} failed` : 'all passed'}`);
if (failed) process.exit(1);
