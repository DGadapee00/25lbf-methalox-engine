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

console.log('VR layout');
const { gn2Layout, TUBE_OD_M, HP_LENGTH_M, CHAMBER_DIAMETER_M, CHAMBER_BARREL_M } = await import('../src/vr/scale.js');
const { components } = await import('../src/data/components.js');
const { INCH } = await import('../src/physics/constants.js');
const { ENGINE_PARTS } = await import('../src/data/tags.js');
const { panelModel, buttonAt } = await import('../src/vr/panel.js');
const c = components();
const layout = gn2Layout(c);
const gn2 = STANDS['gn2-coldflow']();
ok(TUBE_OD_M === 0.25 * INCH, 'the drawn tube is the 1/4-in in the HP-line note');
ok(HP_LENGTH_M === 1 && layout.runs.hp === 1, 'the drawn HP run is the note\'s about 1 m');
ok(Math.abs(layout.runs.manifold / layout.runs.hp - c.manifold.V / c.hpline.V) < 1e-12, 'manifold length scales with its placeholder volume');
ok(Math.abs(layout.runs.line / layout.runs.hp - c.line.V / c.hpline.V) < 1e-12, 'injector-line length scales with its placeholder volume');
const sphereV = (4 / 3) * Math.PI * layout.bottle.radius ** 3;
ok(Math.abs(sphereV - c.bottle.V) / c.bottle.V < 1e-9, 'the bottle sphere has the placeholder volume');
ok(layout.engine.diameter === CHAMBER_DIAMETER_M && layout.engine.barrel === CHAMBER_BARREL_M, 'chamber outline is the PROJECT_PLAN §2.2 barrel');
const throat = c['THROAT-01'];
ok(Math.abs(layout.engine.exitD - throat.d * Math.sqrt(throat.eps)) < 1e-12, 'exit diameter is throat diameter times √ε');
ok(layout.engine.nozzleLen > 0 && Number.isFinite(layout.engine.nozzleLen), 'the 15° cone has a finite length');
const missingVr = [];
for (const n of gn2.net.nodes) if (n.kind !== 'ambient' && !layout.nodes[n.id]) missingVr.push(n.id);
for (const e of gn2.net.edges) if (!layout.parts[e.id]) missingVr.push(e.id);
for (const s of gn2.sensors) if (!layout.gauges[s.tag]) missingVr.push(s.tag);
ok(!missingVr.length, `the VR layout has every GN₂ node, edge and transducer (${missingVr.join(', ') || 'clean'})`);
const badTag = Object.keys(layout.parts).filter((id) => !parseTag(id) && !ENGINE_PARTS.includes(id));
ok(!badTag.length, `every drawn part is an S-2 tag or an engine part (${badTag.join(', ') || 'clean'})`);
ok(layout.placard.some((line) => line.includes('UNCALIBRATED')) && layout.placard.some((line) => line.includes('PLACEHOLDER')) && layout.placard.some((line) => line.includes('#6')), 'the placard says uncalibrated, placeholder, and issue #6');
const one = [{ id: 'only', label: 'Only', act: { type: 'pause' } }];
const model = panelModel(one);
const rect = model.rects[0];
const u = (rect.x + rect.w / 2) / model.w;
const v = 1 - (rect.y + rect.h / 2) / model.h;
ok(buttonAt(u, v, model)?.id === 'only', 'a panel uv in a button hits that button');
ok(buttonAt(0.5, 1 - 40 / model.h, model) == null, 'a panel uv in the plot hits no button');

console.log(`\nshell-check: ${failed ? `${failed} failed` : 'all passed'}`);
if (failed) process.exit(1);
