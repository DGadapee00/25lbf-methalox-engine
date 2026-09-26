import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/** Manim / 3Blue1Brown palette. */
export const M = {
  bg: 0x0b0c0e,
  white: 0xece6e2,
  grey: 0x888888,
  greyDark: 0x444444,
  blue: 0x58c4dd,
  blueD: 0x29abca,
  blueE: 0x1c758a,
  teal: 0x5cd0b3,
  green: 0x83c167,
  yellow: 0xf4d345,
  gold: 0xf0ac5f,
  red: 0xfc6255,
  maroon: 0xc55f73,
  purple: 0x9a72ac,
  lavender: 0xc7b3dc,
  pink: 0xd147bd,
};

/*
 * What a colour means on the stand, in every view (brief §5.3). One quantity, one colour:
 *
 *   oxidizer circuit (GOX)        blue        fuel circuit (GCH₄)          orange (gold)
 *   N₂ purge and pressurant       grey-green  chamber and hot gas          red / white
 *   the one control to press next yellow — reserved; nothing else is yellow
 *   selected                      white ring
 *
 * Line pressure is a colour *scale* (rampColorCVD below), not one of these.
 */
export const Q = {
  ox: M.blue,
  fuel: M.gold,
  n2: 0x8fa88a,
  hot: M.red,
  hotCore: M.white,
  next: M.yellow,
  select: M.white,
};

/** 3b1b vector-field colormap: slow = blue, fast = red. t in [0, 1]. */
const RAMP = [M.blueE, M.blue, M.teal, M.green, M.yellow, M.red].map((h) => new THREE.Color(h));
export function rampColor(t, out = new THREE.Color()) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], x - i);
}

/**
 * A ramp for readers with red-green colour blindness: dark blue → light blue → pale → amber →
 * orange runs along the blue–yellow axis they do see, with lightness steps between neighbours.
 * Lines on the P&ID use it for pressure, since there colour is the only cue for it.
 */
const CVD_RAMP = [0x1d4f8c, 0x3f8fd6, 0x8fd0ee, 0xece6b8, 0xf4b942, 0xe07b39].map((h) => new THREE.Color(h));
export function rampColorCVD(t, out = new THREE.Color()) {
  const x = Math.max(0, Math.min(1, t)) * (CVD_RAMP.length - 1);
  const i = Math.min(CVD_RAMP.length - 2, Math.floor(x));
  return out.copy(CVD_RAMP[i]).lerp(CVD_RAMP[i + 1], x - i);
}

export function lineMaterial({ color = M.white, width = 2.5, opacity = 1, vertexColors = false, dashed = false } = {}) {
  return new LineMaterial({
    color: vertexColors ? 0xffffff : color,
    linewidth: width,
    vertexColors,
    transparent: opacity < 1,
    opacity,
    dashed,
    dashSize: 0.18,
    gapSize: 0.12,
    depthWrite: opacity >= 1,
  });
}

/** Thick polyline. positions: flat [x,y,z,...]; colors optional flat [r,g,b,...]. */
export function fatLine(positions, opts = {}) {
  const geo = new LineGeometry();
  geo.setPositions(positions);
  if (opts.colors) geo.setColors(opts.colors);
  const line = new Line2(geo, lineMaterial({ ...opts, vertexColors: !!opts.colors }));
  if (opts.dashed) line.computeLineDistances();
  return line;
}

/** Thick disjoint segments. positions: flat pairs. */
export function fatSegments(positions, opts = {}) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(positions);
  if (opts.colors) geo.setColors(opts.colors);
  return new LineSegments2(geo, lineMaterial({ ...opts, vertexColors: !!opts.colors }));
}

const _up = new THREE.Vector3(0, 1, 0);
const SHAFT_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1).translate(0, 0.5, 0);
const TIP_GEO = new THREE.ConeGeometry(1, 1, 16, 1).translate(0, -0.5, 0);

/**
 * Manim-style vector: solid shaft, tip whose size stays fixed as length changes.
 * Drop-in for THREE.ArrowHelper (same constructor order, setDirection/setLength/setColor).
 */
/**
 * Objects that show an answer outright (the field arrow at a probe, force arrows) also live on
 * this layer only. Practice blind mode turns the layer off on the camera until the problem is solved.
 */
export const ANSWER_LAYER = 1;
export function markAnswer(obj) {
  obj.traverse((o) => o.layers.set(ANSWER_LAYER));
  return obj;
}

/** Put an object on the answer layer or take it off, for things that are an answer only sometimes. */
export function setAnswer(obj, on) {
  if (!obj || obj.userData.answer === on) return;
  obj.userData.answer = on;
  obj.traverse((o) => o.layers.set(on ? ANSWER_LAYER : 0));
}

export class Arrow extends THREE.Object3D {
  constructor(dir = new THREE.Vector3(1, 0, 0), origin = new THREE.Vector3(), length = 1, color = M.white, headLength, headWidth, shaft = 0.028) {
    super();
    this.type = 'Arrow';
    this.shaftRadius = shaft;
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    // `line` and `cone` names match ArrowHelper so existing dispose code keeps working.
    this.line = new THREE.Mesh(SHAFT_GEO, mat);
    this.cone = new THREE.Mesh(TIP_GEO, mat);
    this.line.geometry = SHAFT_GEO;
    this.add(this.line, this.cone);
    this.position.copy(origin);
    this.setDirection(dir);
    this.setLength(length, headLength, headWidth);
  }

  setDirection(dir) {
    this.quaternion.setFromUnitVectors(_up, dir.clone().normalize());
  }

  setLength(length, headLength = Math.min(0.26, length * 0.35), headWidth = headLength * 0.55) {
    const hl = Math.min(headLength * 1.25, length * 0.6);
    const hw = headWidth * 0.75;
    const shaftLen = Math.max(1e-4, length - hl * 0.85);
    this.line.scale.set(this.shaftRadius, shaftLen, this.shaftRadius);
    this.cone.scale.set(hw, hl, hw);
    this.cone.position.y = length;
  }

  setColor(color) {
    this.line.material.color.set(color);
  }

  dispose() {
    this.line.material.dispose();
  }
}

/** Disc sprite with a +/− sign (sign 0 = plain dot), the way 3b1b draws point charges. */
export function makeChargeTexture(hex, sign) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const col = new THREE.Color(hex);
  const rgb = (k) => `rgb(${Math.round(col.r * 255 * k)},${Math.round(col.g * 255 * k)},${Math.round(col.b * 255 * k)})`;
  const halo = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
  halo.addColorStop(0, `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},0.35)`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  const grd = g.createRadialGradient(S * 0.42, S * 0.4, S * 0.02, S / 2, S / 2, S * 0.3);
  grd.addColorStop(0, rgb(1.12));
  grd.addColorStop(1, rgb(0.78));
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
  g.fillStyle = grd;
  g.fill();
  g.lineWidth = S * 0.022;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.stroke();
  g.fillStyle = '#ffffff';
  const bar = S * 0.035;
  const len = S * 0.15;
  if (sign !== 0) g.fillRect(S / 2 - len, S / 2 - bar, 2 * len, 2 * bar);
  if (sign > 0) g.fillRect(S / 2 - bar, S / 2 - len, 2 * bar, 2 * len);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Move the vertices of an existing fatLine without reallocating (for per-frame animation).
 * `flat` must have the same number of points the line was created with.
 */
export function updateFatLine(line, flat) {
  const buf = line.geometry.attributes.instanceStart.data;
  const arr = buf.array;
  const n = flat.length / 3;
  for (let i = 0; i < n - 1; i++) {
    const o = i * 6;
    arr[o] = flat[i * 3];
    arr[o + 1] = flat[i * 3 + 1];
    arr[o + 2] = flat[i * 3 + 2];
    arr[o + 3] = flat[i * 3 + 3];
    arr[o + 4] = flat[i * 3 + 4];
    arr[o + 5] = flat[i * 3 + 5];
  }
  buf.needsUpdate = true;
  line.frustumCulled = false;
}

/**
 * Rewrite a fatSegments() line in place, and say how many segments it can ever hold.
 *
 * A Line2/LineSegments2 buffer cannot grow after its first draw: the renderer records how many
 * instances the first upload had (`_maxInstanceCount`) and never draws past it, however many
 * setPositions() puts in afterwards. So build the line once at its widest with segmentCapacity(),
 * then refill it through here — the segments you do not use collapse to a point and vanish.
 */
export function setFatSegments(line, flat) {
  const buf = line.geometry.attributes.instanceStart.data;
  const arr = buf.array;
  const n = Math.min(flat.length, arr.length);
  for (let i = 0; i < n; i++) arr[i] = flat[i];
  for (let i = n; i < arr.length; i++) arr[i] = 0; // zero-length segments draw nothing
  buf.needsUpdate = true;
  line.frustumCulled = false;
}

/** A zero-filled positions array for `count` segments, to build a line at its full capacity. */
export function segmentCapacity(count) {
  return new Array(count * 6).fill(0);
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry && o.geometry !== SHAFT_GEO && o.geometry !== TIP_GEO) o.geometry.dispose();
    if (o.material) o.material.dispose();
    if (o.element) o.element.remove();
  });
}
