/**
 * `npm run predict -- <stand> [<sequence id | table.json>] [--out <file>]`
 *
 * Register a prediction before a test (brief J-5): run the table on the stand, read it through the
 * transducers, and write a stand-prediction-v1 record (physics/prediction.js) stamped with the
 * time, this commit and the component file's stamp. Commit the file before the test; that is what
 * "registered" means. Default output: Sim/predictions/<date>-<stand>-<sequence>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { STANDS } from '../src/data/stands/index.js';
import { expandSequence, sequenceSource } from '../src/data/sequences.js';
import { componentsMeta } from '../src/data/components.js';
import { registerPrediction } from '../src/physics/prediction.js';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const [standId, seqArg] = args;
if (!STANDS[standId]) {
  console.error(`usage: npm run predict -- <stand> [<sequence id | table.json>] [--out file]\nstands: ${Object.keys(STANDS).join(', ')}`);
  process.exit(2);
}
const stand = STANDS[standId]();
const table = seqArg ? (seqArg.endsWith('.json') ? JSON.parse(fs.readFileSync(seqArg, 'utf8')) : sequenceSource(seqArg)) : stand.sequence ? sequenceSource(stand.sequence.id) : null;
if (!table) {
  console.error(`predict: ${standId} has no committed sequence; give a table file`);
  process.exit(2);
}
const git = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
const dirty = git('git status --porcelain -- src data ../Test_Stand') !== '';
const meta = {
  registered: new Date().toISOString(),
  sim: { commit: git('git rev-parse --short HEAD') + (dirty ? '+uncommitted' : ''), subject: git('git log -1 --format=%s') },
  components: componentsMeta,
};
const rec = registerPrediction(stand, table, expandSequence(table), meta);
const file = out || path.join('predictions', `${meta.registered.slice(0, 10)}-${standId}-${table.id}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(rec) + '\n');
console.log(`registered ${file}: ${rec.channels.length} channels × ${rec.t.length} samples, uncalibrated${dirty ? ' (WARNING: uncommitted sim changes; commit them so the record can be reproduced)' : ''}`);
