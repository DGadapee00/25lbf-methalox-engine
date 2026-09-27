/**
 * stand-daq-v1 writer and parser. The format is Test_Stand/daq_format.md; this file is what the
 * self-test treats as the implementation of that page.
 */

function fmtValue(v) {
  if (!Number.isFinite(v)) return '';
  return Number(v.toPrecision(12)).toString();
}

/**
 * channels: [{ tag, quantity, unit, range, bits, tau }] in column order.
 * rows: [{ t, values: { tag } }] from measureSeries.
 * seed: the noise seed, omitted when the log is quiet.
 */
export function daqCsv({ source = 'sim', run, rateHz, channels, rows, seed = null }) {
  if (!run) throw new Error('daqCsv: run id is required');
  if (!(rateHz > 0)) throw new Error('daqCsv: rate_hz must be positive');
  const lines = [
    '# format: stand-daq-v1',
    `# source: ${source}`,
    `# run: ${run}`,
    '# t_unit: s',
    `# rate_hz: ${rateHz}`,
  ];
  if (seed != null) lines.push(`# noise_seed: ${seed}`);
  for (const ch of channels) {
    lines.push(`# channel: ${ch.tag} quantity=${ch.quantity} unit=${ch.unit} range=${ch.range} bits=${ch.bits} tau_s=${ch.tau}`);
  }
  lines.push(['t_s', ...channels.map((c) => c.tag)].join(','));
  for (const row of rows) {
    lines.push([row.t.toFixed(6), ...channels.map((c) => fmtValue(row.values[c.tag]))].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Parse a stand-daq-v1 file back to { fields, channels, header, rows }. */
export function parseDaq(text) {
  if (text.charCodeAt(0) === 0xfeff) throw new Error('parseDaq: BOM is not allowed');
  if (text.includes('\r')) throw new Error('parseDaq: CR is not allowed (LF only)');
  const fields = {};
  const channels = [];
  const rows = [];
  let header = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# channel:')) {
      const rest = line.slice('# channel:'.length).trim();
      const [tag, ...pairs] = rest.split(/\s+/);
      const ch = { tag };
      for (const pair of pairs) {
        const i = pair.indexOf('=');
        const k = pair.slice(0, i);
        const raw = pair.slice(i + 1);
        const n = Number(raw);
        ch[k] = Number.isFinite(n) && raw !== '' ? n : raw;
      }
      channels.push(ch);
      continue;
    }
    if (line.startsWith('#')) {
      const m = /^#\s*([^:]+):\s*(.*)$/.exec(line);
      if (m) fields[m[1].trim()] = m[2].trim();
      continue;
    }
    if (!header) {
      header = line.split(',');
      continue;
    }
    const cells = line.split(',');
    const values = {};
    header.slice(1).forEach((tag, i) => {
      values[tag] = Number(cells[i + 1]);
    });
    rows.push({ t: Number(cells[0]), values });
  }
  return { fields, channels, header, rows };
}
