/**
 * Harness side of the SIL/HIL stdio protocol (Test_Stand/sil_protocol.md): wraps a child process
 * that speaks JSON lines as a sequencer for physics/sil.js runSil(). Node only.
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export function processSequencer(command, args, { table, sensors, rateHz }) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: child.stdout });
  const waiting = [];
  const early = [];
  lines.on('line', (line) => {
    if (!line.trim()) return;
    const w = waiting.shift();
    if (w) w(line);
    else early.push(line);
  });
  const next = () => new Promise((resolve) => (early.length ? resolve(early.shift()) : waiting.push(resolve)));
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  send({ type: 'init', protocol: 'stand-sil-v1', table, sensors, rateHz });
  return {
    async step(tick) {
      send({ type: 'tick', t: tick.t, readings: tick.readings });
      const line = await next();
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        throw new Error(`sil: the sequencer answered something that is not JSON: ${line.slice(0, 80)}`);
      }
      return reply;
    },
    close() {
      send({ type: 'end' });
      child.stdin.end();
    },
  };
}
