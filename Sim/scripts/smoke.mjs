/**
 * Headless smoke test: every lab in the catalog loads in Chromium with no page or console errors,
 * and its key computed values match scripts/baseline/values.json.
 *
 * Unlike FLUX's version it starts its own Vite server, so it needs nothing running first and works
 * the same in CI. Font/TLS noise from a sandbox is filtered; nothing else is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer, preview } from 'vite';
import { chromium } from './playwright.mjs';
import { LABS } from '../src/data/catalog.js';

const outDir = path.resolve('scripts/output');
fs.mkdirSync(outDir, { recursive: true });
const baseline = JSON.parse(fs.readFileSync(path.resolve('scripts/baseline/values.json'), 'utf8'));

// `--preview` serves Sim/dist (vite build). That is the check before a merge to main, which publishes
// the production build. The default serves the dev server, for a fast local loop.
const usePreview = process.argv.includes('--preview');
const server = usePreview
  ? await preview({ preview: { port: 5199, strictPort: true }, logLevel: 'error' })
  : await createServer({ server: { port: 5199, strictPort: true, open: false }, logLevel: 'error' });
if (!usePreview) await server.listen();
const base = 'http://localhost:5199/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const NOISE = /fonts\.(googleapis|gstatic)|ERR_CERT|net::ERR_/;
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !NOISE.test(msg.text())) errors.push(msg.text());
});

/** Relative error; absolute when the expected value is 0. */
const relErr = (got, exp) => (Number.isFinite(got) ? Math.abs(got - exp) / (exp !== 0 ? Math.abs(exp) : 1) : Infinity);
const mismatches = [];

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

let status = 0;
try {
  await page.goto(base, { waitUntil: 'load', timeout: 30000 });
  for (const lab of LABS) {
    await page.evaluate((h) => (location.hash = h), `#/${lab.kind}/${lab.id}`);
    await page.waitForFunction((id) => window.__sim?.app?.id === id && !window.__sim.app.dirty && window.__sim.app.computed[id], lab.id, { timeout: 20000 });
    if (lab.kind === 'stand') {
      // Mode is global. A stand opened after Sequence keeps playing the table, and the
      // valve clicks below are ignored outside Operate.
      if (await page.evaluate(() => window.__sim.app.mode) !== 'operate') {
        await page.click('#mode-operate');
        await page.waitForFunction((id) => {
          const c = window.__sim.app.computed[id];
          return c?.mode === 'operate' && c.readout && c.t < 2;
        }, lab.id, { timeout: 30000 });
      }
      // Drive the live stand: bottle isolation open, then the main valve, at 5× time. The hot-fire
      // stand opens both propellant circuits and switches the igniter on with the main valves.
      const hot = lab.id === 'hot-fire';
      await page.waitForFunction((id) => window.__sim.app.computed[id]?.readout, lab.id, { timeout: 20000 });
      await page.evaluate(([id, hotStand]) => {
        const { app } = window.__sim;
        app.slices[id].scale = 5;
        app.handles[id].toggle('HV-OX-01');
        if (hotStand) app.handles[id].toggle('HV-FU-01');
      }, [lab.id, hot]);
      await page.waitForFunction((id) => window.__sim.app.computed[id].t > 2.5, lab.id, { timeout: 30000 });
      await page.evaluate(([id, hotStand]) => {
        const h = window.__sim.app.handles[id];
        h.toggle('SV-OX-01');
        if (hotStand) {
          h.toggle('SV-FU-01');
          h.toggle('IGN-IG-01');
        }
      }, [lab.id, hot]);
      await page.waitForFunction((id) => window.__sim.app.computed[id].t > 6, lab.id, { timeout: hot ? 90000 : 30000 });
    }
    await page.waitForTimeout(300);
    const got = await page.evaluate((id) => ({ computed: window.__sim.app.computed, status: document.getElementById('lab-status').textContent }), lab.id);
    await page.screenshot({ path: path.join(outDir, `${lab.id}.png`) });
    if (!got.status) mismatches.push({ name: `${lab.id}.status`, got: 'empty', exp: 'a calibration label' });
    const want = baseline[lab.id];
    if (!want) mismatches.push({ name: lab.id, got: 'no baseline entry', exp: 'scripts/baseline/values.json' });
    for (const [key, spec] of Object.entries(want || {})) {
      const v = get(got.computed, key);
      if ('equals' in spec) {
        if (v !== spec.equals) mismatches.push({ name: `${lab.id}: ${key}`, got: v, exp: spec.equals });
      } else if (!(relErr(v, spec.value) <= spec.tol)) mismatches.push({ name: `${lab.id}: ${key}`, got: v, exp: spec.value, tol: spec.tol });
    }
    console.log(`  loaded  ${lab.kind}/${lab.id}`);
    if (lab.id === 'hot-fire') {
      // No hot-fire table exists; Sequence mode must say so rather than play anything.
      await page.click('#mode-sequence');
      await page.waitForFunction(() => /No sequence file exists/.test(document.getElementById('setup').textContent), null, { timeout: 20000 });
      console.log('  sequence mode on hot-fire says there is no sequence file');
      // M5 plumbing: a loaded table with one abort, and a scheduled regulator failure that trips it.
      // SMOKE FIXTURE: the threshold and the action are test values, not a proposed abort.
      await page.evaluate(() => {
        const h = window.__sim.app.handles['hot-fire'];
        h.loadTable({
          id: 'smoke-abort',
          purpose: 'smoke fixture',
          tEnd: 2,
          rateHz: 50,
          steps: [{ t: 0, cmd: { 'HV-OX-01': 'open' } }],
          aborts: [{ id: 'A-1', when: 'PT-OX-02 > 650 psia for 3 samples', action: 'vent' }],
          actions: { vent: [{ dt: 0, cmd: { 'SV-OX-02': 'open' } }] },
          checks: [{ id: 'C-1', expect: 'no abort' }],
        }, 'smoke fixture');
        h.state.faults = [{ t: 0.5, id: 'PCV-OX-01', cmd: { fault: 'open' }, label: 'fails open' }];
        h.reset();
      });
      await page.waitForFunction(() => {
        const c = window.__sim.app.computed['hot-fire'];
        return c?.report?.abort?.id === 'A-1' && (c.readout?.edges['SV-OX-02']?.x ?? 0) > 0 && c.report.checks[0].pass === false;
      }, null, { timeout: 60000 });
      console.log('  a scheduled PCV-OX-01 failure tripped the loaded table\'s abort, which vented the manifold');
    } else if (lab.kind === 'stand') {
      // Sequence mode, after the operate baseline: the step-1 table opens HV-OX-01 by itself.
      await page.click('#mode-sequence');
      await page.waitForFunction((id) => {
        const c = window.__sim.app.computed[id];
        const x = c?.readout?.edges['HV-OX-01']?.x ?? 0;
        return c?.mode === 'sequence' && c.t > 0.15 && c.t < 1.2 && x > 0;
      }, lab.id, { timeout: 30000 });
      console.log(`  sequence opened HV-OX-01 from the table (${lab.id})`);
      await page.evaluate((id) => {
        const { app } = window.__sim;
        app.slices[id].paused = true;
        app.slices[id].scrubbing = true;
        app.handles[id].seek(0.05);
      }, lab.id);
      await page.waitForFunction((id) => {
        const c = window.__sim.app.computed[id];
        const x = c?.readout?.edges['HV-OX-01']?.x ?? 1;
        return c && c.t > 0.02 && c.t < 0.12 && x < 1e-9;
      }, lab.id, { timeout: 30000 });
      console.log(`  scrub rewound ${lab.id} to before the first command`);
      if (lab.id === 'gn2-coldflow') {
        // Test mode (M6): a synthetic log with INJ-OX-01 at 92% of its area, fitted back in the worker.
        await page.click('#mode-test');
        await page.waitForFunction(() => window.__sim.app.handles['gn2-coldflow'].test?.s?.mode === 'test', null, { timeout: 20000 });
        const err = await page.evaluate(async () => {
          const api = window.__sim.app.handles['gn2-coldflow'].test;
          api.s.test.synth['INJ-OX-01'] = 92;
          api.s.test.params = ['INJ-OX-01'];
          api.s.test.tags = ['PT-OX-03', 'PT-CH-01'];
          await api.synthetic();
          await api.fit();
          const f = api.state.fit;
          return f ? f.fitted['INJ-OX-01'] / api.state.truth['INJ-OX-01'] - 1 : api.state.error;
        });
        if (!(Math.abs(err) < 5e-3)) errors.push(`test mode: fit did not recover INJ-OX-01 (${err})`);
        else console.log(`  test mode recovered INJ-OX-01 from a synthetic log to ${(err * 100).toFixed(3)}%`);
      }
    }
  }
  // The guide and the inspector (learning layer): a lesson opens its lab and marks the next
  // control in yellow; hovering the schematic shows an element's live card.
  await page.evaluate(() => window.__sim.guide.open(6));
  await page.waitForFunction(() => window.__sim.app.id === 'gn2-coldflow' && window.__sim.app.computed['gn2-coldflow']?.readout, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('guide').hidden && document.querySelector('.guide-next') && window.__sim.app.handles['gn2-coldflow'].pid.nextTag === 'HV-OX-01', null, { timeout: 20000 });
  console.log('  guide lesson 7 opened the GN₂ stand and marked HV-OX-01 in yellow');
  const at = await page.evaluate(() => window.__sim.toScreen(-1.2, 0));
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => !document.getElementById('inspector').hidden && /manifold/.test(document.getElementById('inspector').textContent), null, { timeout: 10000 });
  console.log('  hovering the manifold opened the inspector');
  await page.evaluate(() => window.__sim.guide.close());
  // The symbol key: the button beside the pressure scale opens the glossary on its Symbols tab.
  await page.click('#legend-key');
  await page.waitForFunction(() => {
    const g = document.getElementById('glossary');
    const pane = g.querySelector('[data-gl-pane="symbols"]');
    return !g.hidden && pane && !pane.hidden && pane.querySelectorAll('.gl-sym svg').length >= 15;
  }, null, { timeout: 10000 });
  console.log('  the symbol key opened with the schematic symbols drawn');
  await page.keyboard.press('Escape');
} catch (e) {
  errors.push(String(e));
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) {
  console.error('page errors:\n  ' + errors.join('\n  '));
  status = 1;
}
if (mismatches.length) {
  console.error('baseline mismatches:', mismatches);
  status = 1;
}
console.log(status ? '\nsmoke: FAILED' : `\nsmoke: ${LABS.length} lab(s) loaded clean, baseline matched`);
process.exit(status);
