/**
 * Canvas line plots for lab panels: time histories and swept curves. In the spirit of FLUX's
 * drawRC — a small, dependency-free plot with a marker for "now" — generalized to several series
 * and labelled reference lines (set point, lockup, full lift, critical ratio).
 *
 * spec: {
 *   series: [{ xs, ys, color, width?, dash?, label }],
 *   hlines: [{ y, color, label, dash? }],   vlines: [{ x, color, label }],
 *   marker: { x, y, color } | null,
 *   xLabel, yLabel, xMin?, xMax?, yMin?, yMax?,
 *   yFmt(y) → string, xFmt(x) → string
 * }
 * All values are already in display units; the plot does not convert.
 */
const AXIS = '#9a9591';
const GRID = 'rgba(255,255,255,0.07)';

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export function drawPlot(canvas, spec) {
  if (!canvas) return;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const W = canvas.clientWidth || 300;
  const H = canvas.clientHeight || 170;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  // The legend gets its own strip above the plot area, so it can never sit on a curve.
  const labelled = spec.series.filter((s) => s.label);
  g.font = '11px ui-monospace, Menlo, monospace';
  const rows = [];
  let row = [];
  let rowW = 0;
  for (const s of labelled) {
    const w = 18 + g.measureText(s.label).width + 12;
    if (row.length && rowW + w > W - 48 - 10) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    row.push({ s, w });
    rowW += w;
  }
  if (row.length) rows.push(row);
  const pad = { l: 48, r: 10, t: 10 + rows.length * 14, b: 30 };
  const all = spec.series.flatMap((s) => s.xs.map((x, i) => [x, s.ys[i]])).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const hy = (spec.hlines || []).map((h) => h.y);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]).concat(hy);
  const xMin = spec.xMin ?? (xs.length ? Math.min(...xs) : 0);
  const xMax = spec.xMax ?? (xs.length ? Math.max(...xs) : 1);
  let yMin = spec.yMin ?? (ys.length ? Math.min(...ys) : 0);
  let yMax = spec.yMax ?? (ys.length ? Math.max(...ys) : 1);
  if (yMax - yMin < 1e-12) {
    yMax += 1;
    yMin -= 1;
  }
  const yPad = spec.yMax === undefined ? 0.06 * (yMax - yMin) : 0;
  yMax += yPad;
  if (spec.yMin === undefined) yMin -= yPad;
  const X = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r);
  const Y = (y) => H - pad.b - ((y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  g.font = '11px ui-monospace, Menlo, monospace';
  g.lineWidth = 1;
  const xf = spec.xFmt || ((v) => String(v));
  const yf = spec.yFmt || ((v) => String(v));
  for (const t of niceTicks(xMin, xMax)) {
    g.strokeStyle = GRID;
    g.beginPath();
    g.moveTo(X(t), pad.t);
    g.lineTo(X(t), H - pad.b);
    g.stroke();
    g.fillStyle = AXIS;
    g.textAlign = 'center';
    g.fillText(xf(t), X(t), H - pad.b + 13);
  }
  for (const t of niceTicks(yMin, yMax, 4)) {
    g.strokeStyle = GRID;
    g.beginPath();
    g.moveTo(pad.l, Y(t));
    g.lineTo(W - pad.r, Y(t));
    g.stroke();
    g.fillStyle = AXIS;
    g.textAlign = 'right';
    g.fillText(yf(t), pad.l - 4, Y(t) + 4);
  }
  g.fillStyle = AXIS;
  g.textAlign = 'center';
  if (spec.xLabel) g.fillText(spec.xLabel, pad.l + (W - pad.l - pad.r) / 2, H - 3);
  if (spec.yLabel) {
    g.save();
    g.translate(11, pad.t + (H - pad.t - pad.b) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(spec.yLabel, 0, 0);
    g.restore();
  }

  for (const h of spec.hlines || []) {
    g.strokeStyle = h.color;
    g.setLineDash(h.dash || [4, 4]);
    g.beginPath();
    g.moveTo(pad.l, Y(h.y));
    g.lineTo(W - pad.r, Y(h.y));
    g.stroke();
    g.setLineDash([]);
    if (h.label) {
      g.fillStyle = h.color;
      g.textAlign = 'right';
      g.fillText(h.label, W - pad.r - 2, Y(h.y) - 3);
    }
  }
  // Vertical reference lines. Each label sits on the side of its line away from the nearest other
  // line, and labels step down one row each, so two close lines (r* and 1/2.2) cannot collide.
  const vls = (spec.vlines || []).slice().sort((a, b) => a.x - b.x);
  vls.forEach((v, i) => {
    g.strokeStyle = v.color;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(X(v.x), pad.t);
    g.lineTo(X(v.x), H - pad.b);
    g.stroke();
    g.setLineDash([]);
    if (!v.label) return;
    const leftN = i > 0 ? X(v.x) - X(vls[i - 1].x) : Infinity;
    const rightN = i < vls.length - 1 ? X(vls[i + 1].x) - X(v.x) : Infinity;
    const onRight = rightN >= leftN;
    g.fillStyle = v.color;
    g.textAlign = onRight ? 'left' : 'right';
    g.fillText(v.label, X(v.x) + (onRight ? 4 : -4), pad.t + 11 + 12 * i);
  });
  for (const s of spec.series) {
    g.strokeStyle = s.color;
    g.lineWidth = s.width || 2;
    g.setLineDash(s.dash || []);
    g.beginPath();
    let pen = false;
    s.xs.forEach((x, i) => {
      const y = s.ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false;
        return;
      }
      if (pen) g.lineTo(X(x), Y(y));
      else g.moveTo(X(x), Y(y));
      pen = true;
    });
    g.stroke();
    g.setLineDash([]);
  }
  // Legend strip, above the plot area.
  g.textAlign = 'left';
  rows.forEach((r, ri) => {
    let lx = pad.l;
    const ly = 12 + ri * 14;
    for (const { s, w } of r) {
      g.fillStyle = s.color;
      g.fillRect(lx, ly - 5, 12, 3);
      g.fillText(s.label, lx + 16, ly);
      lx += w;
    }
  });
  if (spec.marker && Number.isFinite(spec.marker.x) && Number.isFinite(spec.marker.y)) {
    g.fillStyle = spec.marker.color || '#ece6e2';
    g.beginPath();
    g.arc(X(spec.marker.x), Y(spec.marker.y), 4, 0, 2 * Math.PI);
    g.fill();
  }
}
