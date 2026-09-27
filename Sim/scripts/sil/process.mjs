/**
 * The reference sequencer as a separate process speaking stand-sil-v1 (Test_Stand/sil_protocol.md)
 * on stdin/stdout. It runs physics/sil.js createTableLogic: the table logic, not the stand's
 * firmware. It exists so the protocol and the harness are tested end to end before the firmware
 * logic core (after D-7) takes its place.
 */
import readline from 'node:readline';
import { expandSequence } from '../../src/data/sequences.js';
import { createTableLogic } from '../../src/physics/sil.js';

let logic = null;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type === 'init') logic = createTableLogic(expandSequence(msg.table));
  else if (msg.type === 'tick') process.stdout.write(`${JSON.stringify(logic.step(msg))}\n`);
  else if (msg.type === 'end') rl.close();
});
