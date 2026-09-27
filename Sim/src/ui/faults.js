/**
 * Fault injection menu and the pass/fail report (M5, brief §5.1 Sequence mode and J-3).
 *
 * faultTargets(net) lists what can fail on a stand and how: valves stick, regulators fail open or
 * closed or creep, the igniter fails to light, an injector or the throat is partly blocked (the
 * way to a low P_c). Amounts (creep, blockage) have no default: the form asks for one.
 * faultCommand turns the form into the network command. The physics is in network.js.
 */
import { escapeHTML } from './shared.js';

export function faultTargets(net) {
  const out = [];
  for (const e of net.edges) {
    if (e.type === 'valve') out.push({ tag: e.id, type: 'valve', kinds: [{ kind: 'stuck', label: 'stuck where it is' }, { kind: 'clear', label: 'clear fault' }] });
    if (e.type === 'regulator') {
      out.push({
        tag: e.id,
        type: 'regulator',
        CdAmax: e.CdAmax,
        kinds: [
          { kind: 'open', label: 'fails open' },
          { kind: 'closed', label: 'fails closed' },
          { kind: 'creep', label: 'seat creep', amount: 'Creep (% of full-open C_dA)' },
          { kind: 'clear', label: 'clear fault' },
        ],
      });
    }
    if (e.type === 'orifice' && /^(INJ-|THROAT)/.test(e.id)) {
      out.push({ tag: e.id, type: 'orifice', kinds: [{ kind: 'blockage', label: 'partly blocked', amount: 'Blocked (% of flow area)' }, { kind: 'clear', label: 'clear fault' }] });
    }
  }
  for (const g of net.igniters || []) out.push({ tag: g.id, type: 'igniter', kinds: [{ kind: 'no-light', label: 'no-light' }, { kind: 'clear', label: 'clear fault' }] });
  return out;
}

/** { id, cmd, label } for form { target, kind, amount }, or { error }. */
export function faultCommand(targets, form) {
  const tgt = targets.find((x) => x.tag === form.target);
  if (!tgt) return { error: 'Pick an element.' };
  const kind = tgt.kinds.find((k) => k.kind === form.kind) || tgt.kinds[0];
  const amt = Number(form.amount);
  if (kind.amount && !(form.amount !== '' && amt >= 0 && amt <= 100)) return { error: `${kind.amount}: give a number from 0 to 100.` };
  let cmd;
  if (kind.kind === 'clear') cmd = { fault: null };
  else if (tgt.type === 'valve') cmd = { fault: 'stuck' };
  else if (tgt.type === 'igniter') cmd = { fault: 'no-light' };
  else if (kind.kind === 'creep') cmd = { fault: { creep: (amt / 100) * tgt.CdAmax } };
  else if (kind.kind === 'blockage') cmd = { fault: { blockage: amt / 100 } };
  else cmd = { fault: kind.kind };
  return { id: tgt.tag, cmd, label: kind.amount ? `${kind.label} ${amt}%` : kind.label };
}

const fmtT = (t) => `${t.toFixed(3)} s`;

/** The live report, as HTML for the Setup panel. */
export function renderReport(seq, rep, t) {
  const done = t >= seq.tEnd - 1e-9;
  const aborts = seq.aborts.map((a) => {
    const hit = rep.tripped.find((x) => x.id === a.id);
    const first = rep.abort?.id === a.id;
    const state = hit ? `<b class="bad">${first ? 'ABORT' : 'tripped (latched)'} at ${fmtT(hit.t)}</b>` : '<span class="ok">armed, not tripped</span>';
    return `<li><b>${escapeHTML(a.id)}</b> ${escapeHTML(a.when)} → ${escapeHTML(a.action)}: ${state}</li>`;
  });
  const checks = rep.checks.map((c) => `<li><b>${escapeHTML(c.id)}</b> ${escapeHTML(c.expect)}: <b class="${c.pass ? 'ok' : 'bad'}">${c.pass ? 'pass' : 'FAIL'}</b> <span class="note">${escapeHTML(c.detail)}</span></li>`);
  return `${aborts.length ? `<ul>${aborts.join('')}</ul>` : ''}${checks.length ? `<ul>${checks.join('')}</ul>` : ''}<p class="note">${done ? `Run complete: ${rep.pass ? 'every check passed' : 'at least one check failed'}.` : 'Checks so far; the run is not over.'} Uncalibrated.</p>`;
}

/** The report as Markdown, for the Download report button. */
export function reportMarkdown({ stand, table, rep, t }) {
  const lines = [
    `# Sequence report: ${rep.sequence} on ${stand}`,
    '',
    `Table: ${table}. Simulated to t = ${t.toFixed(3)} s.`,
    '',
    '**Uncalibrated.** Placeholder hardware (issue #6) and an uncalibrated injector C_d and η_c*. Not a prediction of what the hardware will do, and not a substitute for any Phase 5 step.',
    '',
    '## Faults injected',
    '',
    ...(rep.faults.length ? rep.faults.map((f) => `- ${f.t} s: ${f.id} ${JSON.stringify(f.cmd)}`) : ['- none']),
    '',
    '## Aborts',
    '',
    ...(rep.tripped.length ? rep.tripped.map((x) => `- ${x.id} tripped at ${x.t.toFixed(3)} s (${x.when}); ${rep.abort?.id === x.id ? `action ${x.action} ran` : 'latched, no second action'}`) : ['- none tripped']),
    '',
    '## Checks',
    '',
    '| id | expect | result | detail |',
    '| --- | --- | --- | --- |',
    ...rep.checks.map((c) => `| ${c.id} | ${c.expect} | ${c.pass ? 'pass' : 'FAIL'} | ${c.detail} |`),
    '',
    `Overall: ${rep.pass ? 'every check passed' : 'at least one check failed'}.`,
    '',
  ];
  return lines.join('\n');
}
