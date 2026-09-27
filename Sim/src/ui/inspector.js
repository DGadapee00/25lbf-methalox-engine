/**
 * The P&ID inspector (brief §5.2): hover (or tap) any element for what it is, its live state, the
 * law it obeys, and which of its numbers are placeholders. It reads the view's last readout and
 * the stand's netlist; it computes nothing.
 */
import { tex, escapeHTML } from './shared.js';
import { fmtP, fmtT, fmtMdot, fmtF, fmtTime, sig } from './format.js';
import { parseTag } from '../data/tags.js';
import { provenance } from '../data/components.js';

const LETTERS = {
  HV: 'Hand valve. The operator opens it: bottle isolation, before anything else can flow.',
  SV: 'Remotely actuated valve. The sequencer opens and closes it; its stem ramps over the open time after a command delay. Solenoid or pneumatic ball is open decision D-5.',
  XV: 'Actuated on/off valve.',
  PCV: 'Pressure regulator. It opens its poppet in proportion to how far the outlet is below lockup, so it holds the set point at rated flow and locks up above it when the outlet is shut.',
  PSV: 'Relief valve. Starts to lift at its set Δp and is fully open 10% above it; reseats after the pressure falls by its blowdown. It is what stops a failed-open regulator from bursting the manifold.',
  CKV: 'Check valve. Lets the purge into the chamber and nothing back: it opens at its cracking Δp and reseats below a lower one.',
  RO: 'Restriction orifice on the stand.',
  FE: 'Flow element: a metering orifice or venturi (D-6).',
  PT: 'Pressure transducer. What the DAQ and the sequencer see: the node pressure after the transducer lag, quantized to its ADC. Never the true pressure.',
  LC: 'Load cell under the thrust mount: the chamber thrust, through the same lag and quantization as a transducer.',
  TE: 'Temperature element.',
};
const PARTS = {
  'INJ-OX-01': 'GOX injector: 4 × ⌀1.4 mm holes (PROJECT_PLAN §2.3). Choked, its flow depends only on the manifold side; unchoked, the chamber pressure pushes back.',
  'INJ-FU-01': 'GCH₄ injector: 4 × ⌀1.0 mm holes (PROJECT_PLAN §2.3).',
  'THROAT-01': 'Nozzle throat, ⌀8 mm (PROJECT_PLAN §2.2). When the chamber burns, its choked flow is P_c A_t / c*: that is what sets the chamber pressure.',
  'IGN-IG-01': 'Igniter (D-4 open: spark or torch). A switch here: it lights the chamber only if the gas inside is within the CH₄/O₂ flammability limits.',
};
const LAW = {
  orifice: '\\dot m = C_dA\\,p_0\\sqrt{\\tfrac{\\gamma}{RT_0}}\\,\\Lambda(\\gamma)\\ \\text{(choked)}',
  valve: 'C_dA(t) = C_dA_{\\max}\\,\\phi(x(t))',
  regulator: 'z_{cmd} = K\\,(p_{lockup} - p_{out}),\\ \\tau\\dot z = z_{cmd} - z',
  relief: 'C_dA = L\\cdot C_dA_{rated},\\ L: 0 \\text{ at set} \\to 1 \\text{ at } 1.1\\times\\text{set}',
  check: '\\text{open when } \\Delta p > p_{crack},\\ \\text{shut when } \\Delta p < p_{reseat}',
  volume: 'p = \\dfrac{mRT}{V},\\quad \\dfrac{dU}{dt} = \\sum \\dot m\\,h',
  chamber: 'P_c = \\dfrac{\\dot m\\,c^*}{A_t}\\ \\text{(steady)},\\quad c^* = \\eta_{c^*} c^*_{\\text{CEA}}',
};

function nodeWhat(n) {
  if (n.kind === 'ambient') return n.label === 'atmosphere' ? 'The atmosphere: where vents, reliefs and the nozzle exhaust go. It keeps a tally of what it receives, so mass conservation can be checked.' : `A fixed-pressure reservoir (${n.label || n.id}): an idealized supply that does not blow down.`;
  if (n.kind === 'chamber') return 'Combustion chamber, 45 cm³. Cold, it fills like any volume; lit, its state comes from the CEA table at its O/F and pressure.';
  if (/bottle/.test(n.id)) return 'Supply bottle. It blows down as it feeds the regulator; its gas cools as it expands.';
  if (/-hp$|^hp$/.test(n.id)) return 'High-pressure tube between the bottle isolation valve and the regulator inlet.';
  if (/manifold/.test(n.id)) return 'Regulated manifold: the regulator\'s outlet, where the set point is held. Its relief and vent hang off it.';
  if (/line/.test(n.id)) return 'Line from the main valve to the injector: small, so it fills in milliseconds.';
  return 'A control volume: mass and energy balance, pressure from the ideal-gas law.';
}

function composition(Y, names, W) {
  if (!Y || !names) return '';
  const moles = Y.map((y, i) => y / (W?.[i] || 1));
  const tot = moles.reduce((a, b) => a + b, 0) || 1;
  const pretty = { PRODox: 'burned (ox)', PRODfu: 'burned (fuel)' };
  return moles
    .map((m, i) => [names[i], m / tot])
    .filter(([, x]) => x > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([k, x]) => `${pretty[k] || k} ${sig(x * 100, 3)}%`)
    .join(', ');
}

const row = (k, v) => `<div class="ins-row"><span>${k}</span><span>${v}</span></div>`;

/** HTML for the element `target` ({ kind, id }) on view `pid` (a PidView after update()). */
export function inspectorHTML(target, pid) {
  const gas = pid.gas;
  const r = pid.last || { nodes: {}, edges: {} };
  const net = pid.net;
  let title = target.id;
  let what = '';
  let law = '';
  const rows = [];
  if (target.kind === 'node') {
    const n = net.nodes.find((x) => x.id === target.id);
    const s = r.nodes?.[target.id] || {};
    title = n.label || n.id;
    what = nodeWhat(n);
    law = n.kind === 'chamber' ? LAW.chamber : n.kind === 'ambient' ? '' : LAW.volume;
    if (s.p != null) rows.push(row('pressure', fmtP(s.p)));
    if (s.T != null && n.kind !== 'ambient') rows.push(row('temperature', fmtT(s.T)));
    if (s.m != null && n.kind !== 'ambient') rows.push(row('gas in it', `${sig(s.m * 1e3, 4)} g`));
    const mix = composition(s.Y, gas?.names, gas?.W);
    if (mix) rows.push(row('mixture (mol)', mix));
    const ch = r.chambers?.[target.id];
    if (ch) {
      rows.push(row('state', ch.burning ? '<b class="hot">burning</b>' : 'not burning'));
      if (ch.burning) rows.push(row('O/F · c*', `${sig(ch.OF, 3)} · ${sig(ch.cstar, 4)} m/s`));
      if (ch.F > 1e-3) rows.push(row('thrust · I_sp', `${fmtF(ch.F)} · ${sig(ch.Isp, 3)} s`));
      if (ch.unburnedMass > 1e-9) rows.push(row('unburned propellant', `${sig(ch.unburnedMass * 1e3, 3)} g, ${sig(ch.unburnedEnergy, 3)} J`));
    }
  } else if (target.kind === 'edge') {
    const e = net.edges.find((x) => x.id === target.id);
    const f = r.edges?.[target.id] || {};
    const letters = parseTag(e.id)?.letters;
    what = PARTS[e.id] || LETTERS[letters] || '';
    law = LAW[e.type] || '';
    title = `${e.id} · ${e.type}`;
    if (f.mdot != null) rows.push(row('mass flow', fmtMdot(f.mdot)));
    if (e.type === 'orifice' && f.mdot != null) {
      const state = Math.abs(f.mdot) < 1e-6 ? 'no flow' : !f.choked ? '<b class="bad">not choked</b>' : f.margin >= 2.2 ? '<b class="ok">choked, margin ≥ 2.2</b>' : '<b class="warn">choked, below 2.2</b>';
      rows.push(row('p₀/p', `${sig(f.margin, 4)}: ${state}`));
    }
    if (f.CdA != null) rows.push(row('C_dA now', `${sig(f.CdA * 1e6, 4)} mm²`));
    if (f.x != null) rows.push(row('stem position', `${sig(f.x * 100, 3)}% open${f.stuck ? ' (STUCK)' : ''}`));
    if (e.type === 'valve') rows.push(row('ramp · delay', `${fmtTime(e.tOpen)} · ${fmtTime(e.delay ?? 0)}`));
    if (f.z != null) rows.push(row('poppet opening', sig(f.z, 3)));
    if (f.pSet != null) rows.push(row('set · lockup', `${fmtP(f.pSet)} · ${fmtP(f.pLockup)}`));
    if (f.jt) rows.push(row('outlet (JT)', fmtT(f.Tout)));
    if (e.type === 'relief') rows.push(row('set Δp · lift', `${fmtP(e.set).replace('psia', 'psi')} · ${sig((f.lift ?? 0) * 100, 3)}%`));
    if (e.type === 'check') rows.push(row('state', f.open ? 'open' : 'shut'));
    if (f.blockage) rows.push(row('fault', `${sig(f.blockage * 100, 3)}% blocked`));
  } else if (target.kind === 'igniter') {
    const g = (net.igniters || []).find((x) => x.id === target.id);
    const ch = r.chambers?.[g?.chamber];
    title = target.id;
    what = PARTS[target.id] || '';
    rows.push(row('switch', ch?.igniter?.on ? 'on' : 'off'));
    if (ch?.igniter?.fault) rows.push(row('fault', ch.igniter.fault));
    if (ch) rows.push(row('ignitions so far', String(ch.ignitions)));
  } else if (target.kind === 'sensor') {
    const s = pid.sensors.find((x) => x.tag === target.id);
    title = target.id;
    what = LETTERS[parseTag(target.id)?.letters] || '';
    const measured = r.measured?.[target.id];
    const truth = s?.quantity === 'F' ? r.chambers?.[s.node]?.F : r.nodes?.[s?.node]?.p;
    const fmt = s?.quantity === 'F' ? fmtF : fmtP;
    if (measured != null) rows.push(row('reading', fmt(measured)));
    if (truth != null) rows.push(row(s?.quantity === 'F' ? 'true thrust' : 'true pressure', fmt(truth)));
    if (s) rows.push(row('range · lag', `${s.quantity === 'F' ? fmtF(s.range) : fmtP(s.range)} · ${fmtTime(s.tau)}`));
  }
  const ph = provenance().filter((p) => p.part === target.id);
  const phs = ph.length ? `<p class="ins-prov">${ph.map((p) => `${escapeHTML(p.key)} = ${p.value} ${escapeHTML(p.unit)}`).join(', ')}: <b>${ph.some((p) => p.kind === 'placeholder') ? 'placeholder (issue #6)' : 'uncalibrated'}</b></p>` : '';
  return `<div class="ins-title">${escapeHTML(title)}</div>${what ? `<p class="ins-what">${escapeHTML(what)}</p>` : ''}${rows.join('')}${law ? `<div class="ins-law">${tex(law)}</div>` : ''}${phs}`;
}
