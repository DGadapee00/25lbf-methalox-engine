/**
 * `npm run validate -- --prediction <file> --daq <log.csv> --test <id> [--fit A,B --channels X,Y] [--write]`
 *
 * After a Phase 5 test: compare the registered prediction with the DAQ log and, optionally, fit
 * effective areas (C_dA) to the log (physics/fit.js). Prints the VALIDATION.md section; --write
 * appends it to Sim/VALIDATION.md. A log whose header says `source: sim` is refused: a simulated
 * log checks the fitter, it does not validate the model.
 */
import fs from 'node:fs';
import { STANDS } from '../src/data/stands/index.js';
import { expandSequence } from '../src/data/sequences.js';
import { parseDaq } from '../src/physics/daq.js';
import { validationSection } from '../src/physics/prediction.js';
import { fitAreas } from '../src/physics/fit.js';

const opt = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const recFile = opt('prediction');
const daqFile = opt('daq');
const testId = opt('test');
if (!recFile || !daqFile || !testId) {
  console.error('usage: npm run validate -- --prediction <file> --daq <log.csv> --test <id> [--fit A,B --channels X,Y] [--write]');
  process.exit(2);
}
const record = JSON.parse(fs.readFileSync(recFile, 'utf8'));
const daq = parseDaq(fs.readFileSync(daqFile, 'utf8'));
let fit = null;
if (opt('fit')) {
  const stand = STANDS[record.stand]();
  const params = opt('fit').split(',');
  const tags = (opt('channels') || daq.channels.map((c) => c.tag).join(',')).split(',');
  fit = fitAreas(stand, expandSequence(record.table), daq.rows, params, tags, { onIter: (x) => console.error(`  iteration ${x.iter + 1}: SSR ${x.ssr.toExponential(3)}`) });
}
let md;
try {
  md = validationSection({ testId, record, daq, fit });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (process.argv.includes('--write')) {
  fs.appendFileSync('VALIDATION.md', `\n${md}`);
  console.log(`appended ${testId} to VALIDATION.md`);
} else console.log(md);
