/**
 * The floating DAQ panel: one canvas, so the plot and the buttons are a single
 * texture upload. Button positions are in canvas pixels. A ray hit reports uv;
 * buttonAt maps that uv back to a button. PlaneGeometry's uv origin is the
 * bottom-left of the plane, and canvas y grows downward.
 */
import { drawPlot } from '../ui/plot.js';
import { fmtP, sig } from '../ui/format.js';
import { PSI } from '../physics/constants.js';

export const PANEL_W = 800;
const PLOT_TOP = 36;
const PLOT_H = 250;
const BTN_H = 34;
const GAP = 8;
const COLS = 4;
const FOOT = 22;

export function panelModel(actions) {
  const rows = Math.ceil(actions.length / COLS) || 1;
  const h = PLOT_TOP + PLOT_H + GAP + rows * (BTN_H + GAP) + FOOT;
  const bw = (PANEL_W - GAP * (COLS + 1)) / COLS;
  const top = PLOT_TOP + PLOT_H + GAP;
  const rects = actions.map((a, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
      ...a,
      x: GAP + col * (bw + GAP),
      y: top + row * (BTN_H + GAP),
      w: bw,
      h: BTN_H,
    };
  });
  return {
    w: PANEL_W,
    h,
    rects,
    plot: { x: GAP, y: PLOT_TOP, w: PANEL_W - GAP * 2, h: PLOT_H - GAP },
  };
}

/** uv from a three.js plane hit. Null when the hit is the plot or the banner. */
export function buttonAt(u, v, model) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  const x = u * model.w;
  const y = (1 - v) * model.h;
  return model.rects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || null;
}

/**
 * Pressures and flows for the single-circuit stand, the same series the
 * desktop Operate plot draws (labs/stand.js). Display units only.
 */
export function plotSpec(state) {
  const hist = state.history;
  if (!hist.length) return null;
  const ts = hist.map((x) => x.t);
  const axis = { xLabel: 't (s)', yMin: 0, xFmt: (v) => sig(v, 3), yFmt: (v) => sig(v, 3) };
  if (state.plot === 'flows') {
    const ids = ['INJ-OX-01', 'THROAT-01'];
    const col = { 'INJ-OX-01': '#58c4dd', 'THROAT-01': '#fc6255' };
    return {
      ...axis,
      series: ids.map((e) => ({ xs: ts, ys: hist.map((x) => (x.m[e] ?? 0) * 1e3), color: col[e], label: e })),
      yLabel: 'ṁ (g/s)',
    };
  }
  const series = [
    { xs: ts, ys: hist.map((x) => x.p.manifold / PSI), color: '#8fa88a', label: 'manifold' },
    { xs: ts, ys: hist.map((x) => x.p.line / PSI), color: '#58c4dd', label: 'line' },
    { xs: ts, ys: hist.map((x) => x.p.chamber / PSI), color: '#fc6255', label: 'chamber' },
  ];
  if (state.quiet.length && state.quiet[0].values['PT-OX-02'] != null) {
    series.push({
      xs: state.quiet.map((x) => x.t),
      ys: state.quiet.map((x) => x.values['PT-OX-02'] / PSI),
      color: '#c7b3dc',
      label: 'PT-OX-02',
    });
  }
  const pSet = state.pSetPsia['PCV-OX-01'];
  return {
    ...axis,
    series,
    hlines: [{ y: pSet, color: '#9a9591', label: 'p_set' }],
    yLabel: 'p (psia)',
  };
}

export function createPanelCanvas() {
  const panel = document.createElement('canvas');
  const plot = document.createElement('canvas');
  plot.style.cssText = 'position:fixed;left:-4000px;top:0;';
  document.body.appendChild(plot);
  return { panel, plot };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Redraw the panel. Returns true when the texture should be reuploaded. */
export function paintPanel(canvases, model, state) {
  const { panel, plot } = canvases;
  const spec = plotSpec(state);
  if (panel.width !== model.w) panel.width = model.w;
  if (panel.height !== model.h) panel.height = model.h;
  plot.style.width = `${model.plot.w}px`;
  plot.style.height = `${model.plot.h}px`;
  const g = panel.getContext('2d');
  g.fillStyle = '#14161a';
  g.fillRect(0, 0, model.w, model.h);
  g.fillStyle = '#f0ac5f';
  g.font = '600 18px ui-monospace, Menlo, monospace';
  g.fillText('UNCALIBRATED — not a hardware prediction', 12, 24);
  if (spec) {
    drawPlot(plot, spec);
    g.drawImage(plot, model.plot.x, model.plot.y, model.plot.w, model.plot.h);
  } else {
    g.fillStyle = '#9a9591';
    g.font = '16px ui-monospace, Menlo, monospace';
    g.fillText('Waiting for the worker…', model.plot.x + 8, model.plot.y + 28);
  }
  g.font = '15px ui-monospace, Menlo, monospace';
  for (const r of model.rects) {
    const on = r.act.type === 'amount' && state.amount === r.act.amount;
    g.fillStyle = on ? '#3a3428' : '#1c1f24';
    roundRect(g, r.x, r.y, r.w, r.h, 6);
    g.fill();
    g.strokeStyle = on ? '#f0ac5f' : '#2a2d33';
    g.stroke();
    g.fillStyle = '#ece6e2';
    g.fillText(r.label, r.x + 8, r.y + 22);
  }
  const foot = state.message || bannerLine(state);
  g.fillStyle = '#9a9591';
  g.font = '13px ui-monospace, Menlo, monospace';
  g.fillText(foot.slice(0, 90), 12, model.h - 6);
  return true;
}

function bannerLine(state) {
  const fo = state.failsOpen?.[0];
  if (fo && !fo.error) return `Fails-open peak ${fmtP(fo.peak)} (model scale, not MEOP). ${fo.caveat}`;
  return 'PLACEHOLDER hardware, issue #6.';
}
