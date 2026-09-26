/**
 * Physics is pure and headless (brief §4.5, §9): nothing under src/physics/ may import three,
 * katex, or anything from the UI and scene layers, or name a browser global. The same modules run
 * in the self-test, in batch sweeps under Node, and in a Web Worker, none of which has a DOM.
 *
 * This is a static check on the source, so it fails before a stray import can break the worker.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('src/physics');
const BANNED_IMPORT = /from\s+['"](three|katex|[^'"]*\/(ui|scene|labs|engine)\/[^'"]*)['"]/;
const BANNED_GLOBAL = /\b(document|window|localStorage|requestAnimationFrame|HTMLElement)\b/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

const problems = [];
for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inBlock = false;
  lines.forEach((line, i) => {
    // Comments may explain *why* there is no DOM; only code counts.
    let code = line;
    if (inBlock) {
      const end = code.indexOf('*/');
      if (end < 0) return;
      code = code.slice(end + 2);
      inBlock = false;
    }
    code = code.replace(/\/\*.*?\*\//g, '');
    const open = code.indexOf('/*');
    if (open >= 0) {
      code = code.slice(0, open);
      inBlock = true;
    }
    code = code.replace(/\/\/.*$/, '');
    const where = `${path.relative(process.cwd(), file)}:${i + 1}`;
    if (BANNED_IMPORT.test(code)) problems.push(`${where}  imports a browser-side module: ${line.trim()}`);
    else if (BANNED_GLOBAL.test(code)) problems.push(`${where}  names a browser global: ${line.trim()}`);
  });
}

if (problems.length) {
  console.error('src/physics/ must stay headless:\n' + problems.map((p) => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('check-headless: src/physics/ imports no DOM, three.js, KaTeX, UI or scene code');
