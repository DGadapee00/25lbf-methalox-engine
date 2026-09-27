/**
 * `npm run course-check`: play the whole guided path in headless Chromium, the way a learner
 * would, through the page's own controls, and check that every lesson reaches its takeaway.
 * Against `vite build` + preview, like the smoke test. It catches a lesson whose step can no
 * longer be completed (a renamed control, a changed default, a physics change).
 */
import { preview } from 'vite';
import { chromium } from './playwright.mjs';

const server = await preview({ preview: { port: 5199, strictPort: true, open: false }, logLevel: 'error' });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const setValue = (sel, v) => page.evaluate(([s, val]) => {
  const el = document.querySelector(s);
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [sel, v]);
const answerAll = async () => {
  for (let k = 0; k < 4; k++) {
    const b = await page.$('.predict-opt:not([disabled])');
    if (!b) break;
    await b.click();
    await page.waitForTimeout(150);
  }
};
const valve = (tag) => page.click(`[data-valve="${tag}"]`);
const fast = () => page.evaluate(() => (window.__sim.app.slices[window.__sim.app.id].scale = 5));
const waitStep = (n, timeout = 60000) => page.waitForFunction((k) => window.__sim.guide.state.step >= k, n, { timeout });
const waitLab = (id) => page.waitForFunction((x) => window.__sim.app.id === x && window.__sim.app.computed[x], id, { timeout: 30000 });

// What a learner does at each step, lesson by lesson.
const PLAY = {
  blowdown: [() => page.click('#bd-play'), () => setValue('#bd-mode', 'isothermal'), answerAll],
  orifice: [() => setValue('#or-pb', 0.1), () => setValue('#or-pb', 0.8), async () => {
    await setValue('#or-p0', 480);
    await setValue('#or-pb-n', 250);
  }, answerAll],
  regulator: [() => setValue('#rg-case', 'lockup'), () => setValue('#rg-case', 'failsopen'), async () => {
    await setValue('#rg-case', 'flowing');
    await page.click('#rg-jt');
  }, answerAll],
  'valve-timing': [answerAll, () => setValue('#vt-delay', 40)],
  injector: [() => setValue('#inj-back', 'cold'), answerAll],
  'chamber-fill': [() => setValue('#cf-ign', 'no-light'), async () => {
    await setValue('#cf-ign', 'on');
    await setValue('#cf-lead', 10);
  }, async () => {
    await setValue('#cf-lead', 0);
    await page.waitForTimeout(800);
    await answerAll();
  }],
  'gn2-operate': [() => page.click('#mode-operate'), async () => {
    await fast();
    await valve('HV-OX-01');
  }, () => null, () => valve('SV-OX-01'), () => null, () => page.click('#st-daq')],
  'gn2-sequence': [async () => {
    await page.click('#mode-sequence');
    await fast();
  }, async () => {
    await page.evaluate(() => {
      const h = window.__sim.app.handles['gn2-coldflow'];
      window.__sim.app.slices['gn2-coldflow'].scrubbing = true;
      h.seek(1.0);
    });
  }],
  'full-stand': [() => page.click('#mode-operate'), async () => {
    await fast();
    await valve('HV-OX-01');
  }, () => setValue('[data-fault="PCV-OX-01"]', 'open'), () => null],
  'hot-fire': [() => page.click('#mode-operate'), async () => {
    await fast();
    await valve('HV-OX-01');
    await valve('HV-FU-01');
  }, () => null, async () => {
    await valve('SV-OX-01');
    await valve('SV-FU-01');
  }, () => valve('IGN-IG-01'), () => null, () => valve('SV-FU-01'), async () => {
    await valve('SV-OX-01');
    await valve('IGN-IG-01');
  }],
  aborts: [() => page.click('#mode-sequence'), async () => {
    await page.click('.guide-act');
    await page.waitForTimeout(500);
    await fast();
  }, () => null, async () => {
    await page.click('.guide-act');
    await page.waitForTimeout(500);
    await fast();
  }, () => null, () => page.click('#st-report')],
  'test-mode': [() => page.click('#mode-test'), () => page.click('#ts-predict'), () => page.click('.guide-act'), () => page.click('.guide-act'), () => null],
  margin: [async () => {
    await page.waitForFunction(() => document.querySelector('.predict-opt'), null, { timeout: 30000 });
    await answerAll();
  }, async () => {
    await setValue('#mg-p', 400);
    await page.waitForTimeout(600);
    await setValue('#mg-p', 700);
  }, () => page.click('#mg-scaled')],
};

let failed = 0;
try {
  await page.goto('http://localhost:5199/', { waitUntil: 'load' });
  await waitLab('blowdown');
  const ids = await page.evaluate(() => window.__sim.lessonIds);
  for (let i = 0; i < ids.length; i++) {
    const key = ids[i];
    await page.evaluate((k) => window.__sim.guide.open(k), i);
    await page.waitForFunction((k) => window.__sim.guide.state.index === k, i, { timeout: 30000 });
    await page.waitForTimeout(500);
    const start = await page.evaluate(() => window.__sim.guide.state.step);
    const plays = PLAY[key];
    if (!plays) {
      console.log(`  FAIL  lesson ${i + 1} ${key}: no walkthrough written`);
      failed++;
      continue;
    }
    let ok = true;
    for (let s = start; s < plays.length; s++) {
      try {
        await page.waitForTimeout(300);
        await plays[s]();
        await waitStep(s + 1, ['test-mode', 'hot-fire', 'aborts'].includes(key) ? 120000 : 60000);
      } catch (e) {
        console.log(`  FAIL  lesson ${i + 1} ${key}: step ${s + 1} did not complete (${String(e.message).split('\n')[0]})`);
        ok = false;
        failed++;
        break;
      }
    }
    if (ok) console.log(`  PASS  lesson ${i + 1} ${key}: ${plays.length} steps, takeaway reached`);
  }
} catch (e) {
  errors.push(String(e));
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) console.error('page errors:\n  ' + errors.join('\n  '));
console.log(`\ncourse-check: ${failed || errors.length ? 'FAILED' : 'every lesson can be completed through the page'}`);
process.exit(failed || errors.length ? 1 : 0);
