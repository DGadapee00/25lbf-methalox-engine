/**
 * Valve-state matrix for the Phase 2 P&ID gate (brief §5.4). Generated from the sequence files
 * and the full-stand netlist. Part numbers stay unassigned until a BOM exists (issue #6).
 */
import { sequenceSource } from './sequences.js';
import { fullStand } from './stands/fullStand.js';
import { ENGINE_PARTS } from './tags.js';

const cell = (cells) => `| ${cells.join(' | ')} |`;

export function valveTableMarkdown() {
  const stand = fullStand();
  const seq = sequenceSource('gn2-step1');
  const valves = stand.net.edges.filter((e) => e.type === 'valve');
  let held = Object.fromEntries(valves.map((v) => [v.id, 'shut']));
  const columns = [];
  for (const t of seq.steps.map((st) => st.t)) {
    held = { ...held };
    for (const st of seq.steps) {
      if (st.t !== t) continue;
      for (const [id, cmd] of Object.entries(st.cmd)) {
        if (!(id in held)) continue;
        held[id] = cmd === 'open' ? 'open' : cmd === 'close' ? 'shut' : String(cmd);
      }
    }
    columns.push(held);
  }
  const times = seq.steps.map((st) => st.t);
  const head = ['tag', 'part number', ...times.map((t) => `${t.toFixed(2)} s`)];
  const commanded = new Set(seq.steps.flatMap((st) => Object.keys(st.cmd)));
  const lines = [
    '# P&ID valve table',
    '',
    'Generated from `Test_Stand/sequences/` and the full-stand netlist by `Sim/src/data/valveTable.js`. Change the sequence, then regenerate this file. Do not edit the table by hand.',
    '',
    'The only sequence is `gn2-step1`, the Phase 5 step 1 dry run on the oxidizer circuit with GN2. Fuel and purge valves stay shut. This file has no hot-fire timings.',
    '',
    'Part numbers are unassigned until the BOM exists (issue #6). Engine parts cite `Sim/data/components.json`.',
    '',
    '## gn2-step1',
    '',
    seq.purpose,
    '',
    cell(head),
    cell(head.map(() => '---')),
    ...valves.map((v) => cell([v.id, 'unassigned', ...columns.map((col) => col[v.id])])),
    '',
    '## Tags on the full stand',
    '',
    '| tag | element | part number | commanded by gn2-step1 |',
    '| --- | --- | --- | --- |',
    ...stand.net.edges.map((e) => {
      const part = ENGINE_PARTS.includes(e.id) ? 'engine part, see components.json' : 'unassigned';
      return `| ${e.id} | ${e.type} | ${part} | ${commanded.has(e.id) ? 'yes' : 'no'} |`;
    }),
    '',
  ];
  return lines.join('\n');
}
