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
      // Drive the live stand: bottle isolation open, then the main valve, at 5× time.
      await page.waitForFunction((id) => window.__sim.app.computed[id]?.readout, lab.id, { timeout: 20000 });
      await page.evaluate((id) => {
        const { app } = window.__sim;
        app.slices[id].scale = 5;
        app.handles[id].toggle('HV-OX-01');
      }, lab.id);
      await page.waitForFunction((id) => window.__sim.app.computed[id].t > 2.5, lab.id, { timeout: 30000 });
      await page.evaluate((id) => window.__sim.app.handles[id].toggle('SV-OX-01'), lab.id);
      await page.waitForFunction((id) => window.__sim.app.computed[id].t > 6, lab.id, { timeout: 30000 });
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
    if (lab.id === 'gn2-coldflow') {
      // Sequence mode, after the operate baseline: the step-1 table opens HV-OX-01 by itself.
      await page.click('#mode-sequence');
      await page.waitForFunction((id) => {
        const c = window.__sim.app.computed[id];
        const x = c?.readout?.edges['HV-OX-01']?.x ?? 0;
        return c?.mode === 'sequence' && c.t > 0.15 && c.t < 1.2 && x > 0;
      }, lab.id, { timeout: 20000 });
      console.log('  sequence opened HV-OX-01 from the table');
    }
  }
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
