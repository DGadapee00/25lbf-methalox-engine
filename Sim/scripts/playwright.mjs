/**
 * Finds Playwright for the browser scripts (smoke, gallery, contact).
 *
 * It is deliberately not a dependency of this project — it is large, and only these three scripts
 * want it — so they borrow an install from wherever the machine keeps one. Tried in order:
 *
 *   1. $PLAYWRIGHT_PATH — an install, or the package.json of a project that has one
 *   2. this repo's own node_modules, if playwright was ever installed here
 *   3. the global install (`npm root -g`)
 *
 * Only resolution is handled here: `chromium.launch()` finds its own browser.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

function candidates() {
  const bases = [];
  const env = process.env.PLAYWRIGHT_PATH;
  if (env) bases.push(env.endsWith('.json') ? env : path.join(env, 'package.json'));
  bases.push(import.meta.url);
  try {
    const root = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (root) bases.push(path.join(root, 'playwright', 'package.json'));
  } catch {
    // no npm on PATH; the other candidates still apply
  }
  return bases;
}

function findPlaywright() {
  const bases = candidates();
  for (const base of bases) {
    // createRequire itself throws on a path this platform cannot read, so both failures land here.
    try {
      return createRequire(base)('playwright');
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    `Cannot find Playwright. Looked from:\n  ${bases.join('\n  ')}\n` +
      'Install it (npm i -D playwright && npx playwright install chromium), ' +
      'or set PLAYWRIGHT_PATH to a project that has it.',
  );
}

const playwright = findPlaywright();
export const { chromium, firefox, webkit } = playwright;
export default playwright;
