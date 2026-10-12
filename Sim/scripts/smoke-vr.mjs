/**
 * Smoke test for the Quest page (vr.html). No headset and no WebXR session:
 * the desktop fallback drives the same worker as Operate mode, and a ray from
 * in front of HV-OX-01 has to hit that valve.
 *
 * `--preview` serves Sim/dist. The default uses the dev server. Playwright is
 * borrowed the same way as scripts/smoke.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer, preview } from 'vite';
import { chromium } from './playwright.mjs';

const outDir = path.resolve('scripts/output');
fs.mkdirSync(outDir, { recursive: true });
const usePreview = process.argv.includes('--preview');
const port = 5201;
const server = usePreview
  ? await preview({ preview: { port, strictPort: true }, logLevel: 'error' })
  : await createServer({ server: { port, strictPort: true, open: false }, logLevel: 'error' });
if (!usePreview) await server.listen();
const base = `http://localhost:${port}/`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const NOISE = /fonts\.(googleapis|gstatic)|ERR_CERT|net::ERR_|THREE\.WebGLRenderer: Context Lost/;
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !NOISE.test(msg.text())) errors.push(msg.text());
});

const fails = [];
const expect = (cond, name) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) fails.push(name);
};

let status = 0;
try {
  await page.goto(base, { waitUntil: 'load', timeout: 30000 });
  const href = await page.getAttribute('#enter-vr', 'href');
  expect(href === 'vr.html', 'the desktop page links to vr.html');

  await page.goto(`${base}vr.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__vr?.ready, null, { timeout: 30000 });
  const audit = await page.evaluate(() => window.__vr.audit());
  const wantTags = ['HV-OX-01', 'PCV-OX-01', 'PSV-OX-01', 'SV-OX-01', 'SV-OX-02', 'INJ-OX-01', 'THROAT-01'];
  const wantGauges = ['PT-OX-01', 'PT-OX-02', 'PT-OX-03', 'PT-CH-01'];
  expect(wantTags.every((t) => audit.tags.includes(t)), `the stand carries the S-2 tags (${audit.tags.join(', ')})`);
  expect(wantGauges.every((t) => audit.gauges.includes(t)), 'a gauge sits on each pressure transducer');
  const placard = audit.placard.join(' ');
  expect(placard.includes('UNCALIBRATED') && placard.includes('PLACEHOLDER') && placard.includes('#6'), 'the placard says UNCALIBRATED, PLACEHOLDER, and issue #6');
  expect(audit.runs.hp === 1, 'the HP run is 1 m');
  expect(audit.triangles > 0 && audit.triangles < 30000, `triangle count stays small (${audit.triangles})`);
  expect(audit.calls > 0 && audit.calls < 120, `draw calls stay small (${audit.calls})`);
  const badge = await page.textContent('#vr-badge');
  expect(badge && badge.includes('UNCALIBRATED'), 'the page badge says UNCALIBRATED');
  await page.screenshot({ path: path.join(outDir, 'vr.png') });

  const picked = await page.evaluate(() => window.__vr.pickTag('HV-OX-01'));
  expect(picked === true, 'a ray in front of HV-OX-01 hits that valve');
  await page.waitForFunction(() => {
    const e = window.__vr.state.readout?.edges?.['HV-OX-01'];
    return e && e.x > 0.5 && window.__vr.state.t > 0.2;
  }, null, { timeout: 30000 });
  console.log('  PASS  HV-OX-01 opened through the worker');

  const before = await page.evaluate(() => window.__vr.state.pSetPsia['PCV-OX-01']);
  await page.click('[data-act="pset-up"]');
  await page.waitForFunction((was) => {
    const psi = window.__vr.state.readout?.edges?.['PCV-OX-01']?.pSet;
    return psi > (was + 1) * 6894;
  }, before, { timeout: 20000 });
  console.log('  PASS  PCV-OX-01 set point moved, same command as Operate');

  await page.click('[data-act="amt-50"]');
  await page.click('[data-act="ft-INJ-OX-01-blockage"]');
  await page.waitForFunction(() => window.__vr.state.readout?.edges?.['INJ-OX-01']?.blockage === 0.5, null, { timeout: 20000 });
  console.log('  PASS  injector blockage 50% reached the worker');

  await page.click('[data-act="ft-HV-OX-01-stuck"]');
  await page.waitForFunction(() => window.__vr.state.readout?.edges?.['HV-OX-01']?.stuck === true, null, { timeout: 20000 });
  console.log('  PASS  HV-OX-01 stuck');

  const pose = await page.evaluate(() => window.__vr.audit().pose);
  await page.click('[data-act="f-eng"]');
  await page.waitForFunction((was) => {
    const p = window.__vr.audit().pose;
    return Math.hypot(p.x - was.x, p.y - was.y, p.z - was.z) > 0.05;
  }, pose, { timeout: 5000 });
  console.log('  PASS  Go: engine moves the stand, not the camera');

  await page.click('[data-act="snap-r"]');
  await page.waitForFunction((was) => Math.abs(window.__vr.audit().pose.qy - was.qy) > 1e-3, pose, { timeout: 5000 });
  console.log('  PASS  snap turn rotates the stand around the view');

  await page.click('[data-act="run"]');
  await page.waitForFunction(() => window.__vr.state.paused === true, null, { timeout: 5000 });
  const t0 = await page.evaluate(() => window.__vr.state.t);
  await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => window.__vr.state.t);
  expect(t1 - t0 < 0.25, `Stop holds the clock (${t0.toFixed(2)} → ${t1.toFixed(2)})`);

  await page.click('[data-act="reset"]');
  await page.waitForFunction(() => {
    const s = window.__vr.state;
    const x = s.readout?.edges?.['HV-OX-01']?.x ?? 1;
    return s.ready && s.t < 0.5 && x < 0.05;
  }, null, { timeout: 30000 });
  console.log('  PASS  reset returns to a shut isolation valve');
} catch (err) {
  fails.push(err?.stack || String(err));
  console.error(err);
  try {
    await page.screenshot({ path: path.join(outDir, 'vr-error.png') });
  } catch {
    /* the page may already be gone */
  }
} finally {
  if (errors.length) {
    console.error(errors.map((e) => `  console  ${e}`).join('\n'));
    status = 1;
  }
  if (fails.length) {
    console.error(fails.map((e) => `  failed  ${e}`).join('\n'));
    status = 1;
  } else if (!status) console.log('smoke-vr: passed');
  await browser.close();
  await server.close();
}
process.exit(status);
