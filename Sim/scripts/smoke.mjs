/**
 * Headless smoke test: every lab in the catalog loads in Chromium with no page or console errors,
 * and its key computed values match scripts/baseline/values.json.
 *
 * Unlike FLUX's version it starts its own Vite server, so it needs nothing running first and works
 * the same in CI. Font/TLS noise from a sandbox is filtered; nothing else is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from './playwright.mjs';
import { LABS } from '../src/data/catalog.js';

const outDir = path.resolve('scripts/output');
fs.mkdirSync(outDir, { recursive: true });
const baseline = JSON.parse(fs.readFileSync(path.resolve('scripts/baseline/values.json'), 'utf8'));

const server = await createServer({ server: { port: 5199, strictPort: true, open: false }, logLevel: 'error' });
await server.listen();
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

let status = 0;
try {
  await page.goto(base, { waitUntil: 'load', timeout: 30000 });
  for (const lab of LABS) {
    await page.evaluate((h) => (location.hash = h), `#/${lab.kind}/${lab.id}`);
    await page.waitForFunction((id) => window.__sim?.app?.id === id && !window.__sim.app.dirty, lab.id, { timeout: 10000 });
    const got = await page.evaluate((id) => ({ computed: window.__sim.app.computed[id], status: document.getElementById('lab-status').textContent }), lab.id);
    await page.screenshot({ path: path.join(outDir, `${lab.id}.png`) });
    if (!got.status) mismatches.push({ name: `${lab.id}.status`, got: 'empty', exp: 'a calibration label' });
    for (const [key, { value, tol }] of Object.entries(baseline[lab.id] || {})) {
      const v = got.computed?.[key];
      if (!(relErr(v, value) <= tol)) mismatches.push({ name: `${lab.id}.${key}`, got: v, exp: value, tol });
    }
    if (!baseline[lab.id]) mismatches.push({ name: lab.id, got: 'no baseline entry', exp: 'scripts/baseline/values.json' });
    console.log(`  loaded  ${lab.kind}/${lab.id}`);
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
