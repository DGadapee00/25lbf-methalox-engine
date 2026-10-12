/**
 * Real-scale drawing of the single-circuit GN₂ stand (gn2-coldflow).
 *
 * Metres, and only metres that are already in the design package:
 *   - HP run: components.json `hpline.V` note, "about 1 m of 1/4-in tube"
 *   - manifold and the injector line: that same length scaled by their placeholder
 *     volume over the HP placeholder volume (neither note gives a length)
 *   - bottle: a sphere of the placeholder volume (no bottle is selected, so there
 *     is no height or diameter to copy)
 *   - chamber barrel: PROJECT_PLAN §2.2 (⌀22.7 mm, ~90 mm)
 *   - throat, expansion ratio, 15° half-angle: components.json THROAT-01, so the
 *     exit diameter and the cone length are derived, not typed in again
 *   - injector holes: components.json INJ-OX-01
 *
 * Anything else (handle size, gauge size, where the stand sits in the room) is a
 * viewing rig so the tags can be read and pinched. It is labelled as such and it
 * is not hardware. No stand height, MEOP, or as-built route exists yet.
 */
import { components } from '../data/components.js';
import { INCH } from '../physics/constants.js';

/** 1/4 inch. The HP-line placeholder is "about 1 m of 1/4-in tube". */
export const TUBE_OD_M = 0.25 * INCH;

/** The "about 1 m" in that note. Not a measured length. */
export const HP_LENGTH_M = 1;

/**
 * One reading module is four tube diameters (1 inch). Gauges, the DAQ panel
 * and the pinch targets are sized in modules. Not a transducer or a valve.
 */
export const READ_MODULE_M = 4 * TUBE_OD_M;

/** Handle envelope. Four tube diameters, so a 1/4-in tube can be pinched. Not a selected valve (D-5 is open). */
export const HANDLE_M = READ_MODULE_M;

/** Gauge face, six modules (6 inch), so a psia figure can be read from the viewing rig. */
export const GAUGE_M = 6 * READ_MODULE_M;

/** DAQ panel width, sixteen modules. Height follows the canvas. */
export const PANEL_W_M = 16 * READ_MODULE_M;

/**
 * 45° snap turn. Four snaps make a full turn. A comfort setting, not hardware.
 * Positive is counterclockwise about world up.
 */
export const SNAP_TURN_RAD = Math.PI / 4;

/**
 * Viewing rig, not a stand height. The station in front of you sits one HP-line
 * length ahead of the head, and the tube centerline sits a fifth of that length
 * below eye level, so you look slightly down and do not have to walk.
 */
export const RIG_FORWARD_M = HP_LENGTH_M;
export const RIG_BELOW_EYE_M = HP_LENGTH_M / 5;

/**
 * Chamber barrel printed in PROJECT_PLAN §2.2. The "~" is the plan's. The sim
 * node stays the components.json volume (~45 cm³); this outline does not
 * rescale it. A cylinder of these two figures is not 45 cm³, and it is not
 * meant to be: the barrel is not the whole chamber volume.
 */
export const CHAMBER_DIAMETER_M = 22.7e-3;
export const CHAMBER_BARREL_M = 90e-3;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export function gn2Layout(c = components()) {
  const tubeR = TUBE_OD_M / 2;
  const halfH = HANDLE_M / 2;
  const bottleR = Math.cbrt((3 * c.bottle.V) / (4 * Math.PI));
  const run = (V) => HP_LENGTH_M * (V / c.hpline.V);
  const manifoldLen = run(c.manifold.V);
  const lineLen = run(c.line.V);
  // The relief and the vent have no length in the notes. The stub is the
  // injector-line run (the shortest volume-scaled length we already have).
  const branchLen = lineLen;

  const throatD = c['THROAT-01'].d;
  const exitD = throatD * Math.sqrt(c['THROAT-01'].eps);
  const halfAngle = c['THROAT-01'].halfAngle;
  const nozzleLen = (exitD - throatD) / 2 / Math.tan(halfAngle);
  const injD = c['INJ-OX-01'].d;
  const injN = c['INJ-OX-01'].n;
  // Plate thickness equal to the hole diameter: the hole has a length to draw.
  // Not an injector design. D-1 (element type) is open.
  const plate = injD;

  let x = 0;
  const bottle = { id: 'bottle', position: [0, 0, 0], radius: bottleR };
  x = bottleR + halfH;
  const hv = { id: 'HV-OX-01', kind: 'valve', axis: 'x', position: [x, 0, 0] };
  x += halfH;
  const hpA = [x, 0, 0];
  x += HP_LENGTH_M;
  const hpB = [x, 0, 0];
  x += halfH;
  const pcv = { id: 'PCV-OX-01', kind: 'regulator', axis: 'x', position: [x, 0, 0] };
  x += halfH;
  const manA = [x, 0, 0];
  const manMidX = x + manifoldLen / 2;
  x += manifoldLen;
  const manB = [x, 0, 0];
  x += halfH;
  const sv1 = { id: 'SV-OX-01', kind: 'valve', axis: 'x', position: [x, 0, 0] };
  x += halfH;
  const lineA = [x, 0, 0];
  x += lineLen;
  const lineB = [x, 0, 0];
  const injX = lineB[0] + plate / 2;
  x = lineB[0] + plate;
  const barrelA = x;
  const barrelMid = x + CHAMBER_BARREL_M / 2;
  x += CHAMBER_BARREL_M;
  const throatX = x;
  const nozzleMid = x + nozzleLen / 2;
  x += nozzleLen;

  const manMid = [manMidX, 0, 0];
  const psv = { id: 'PSV-OX-01', kind: 'relief', axis: 'y', position: [manMidX, branchLen, 0] };
  const sv2 = { id: 'SV-OX-02', kind: 'valve', axis: 'y', position: [manMidX, -branchLen, 0] };

  const segments = [
    { id: 'hpline', from: 'hp', a: hpA, b: hpB },
    { id: 'manifold', from: 'manifold', a: manA, b: manB },
    { id: 'line', from: 'line', a: lineA, b: lineB },
    { id: 'psv-stub', from: 'manifold', a: manMid, b: psv.position },
    { id: 'vent-stub', from: 'manifold', a: manMid, b: sv2.position },
  ];

  const gaugeAt = (nodePos, lift) => add(nodePos, [0, lift, tubeR + GAUGE_M * 0.55]);
  const gauges = {
    'PT-OX-01': { node: 'bottle', position: gaugeAt(bottle.position, bottleR + GAUGE_M * 0.5) },
    'PT-OX-02': { node: 'manifold', position: gaugeAt(manMid, GAUGE_M * 0.65) },
    'PT-OX-03': { node: 'line', position: gaugeAt([(lineA[0] + lineB[0]) / 2, 0, 0], GAUGE_M * 0.65) },
    'PT-CH-01': { node: 'chamber', position: gaugeAt([barrelMid, 0, 0], GAUGE_M * 0.65) },
  };

  const engine = {
    diameter: CHAMBER_DIAMETER_M,
    barrel: CHAMBER_BARREL_M,
    throatD,
    exitD,
    nozzleLen,
    halfAngle,
    injN,
    injD,
    plate,
    // Four holes on a circle of D_c/4. The pattern is not D-1; D-1 is open.
    holeCircle: CHAMBER_DIAMETER_M / 4,
    injX,
    barrelA,
    barrelMid,
    throatX,
    nozzleMid,
    exitX: x,
  };

  const stations = {
    bottle: bottle.position,
    manifold: pcv.position,
    engine: [barrelMid, 0, 0],
  };

  const parts = {
    [hv.id]: hv,
    [pcv.id]: pcv,
    [sv1.id]: sv1,
    [sv2.id]: sv2,
    [psv.id]: psv,
    'INJ-OX-01': { id: 'INJ-OX-01', kind: 'orifice', position: [injX, 0, 0] },
    'THROAT-01': { id: 'THROAT-01', kind: 'orifice', position: [throatX, 0, 0] },
  };

  const nodes = {
    bottle,
    hp: { id: 'hp', a: hpA, b: hpB },
    manifold: { id: 'manifold', a: manA, b: manB, mid: manMid },
    line: { id: 'line', a: lineA, b: lineB },
    chamber: { id: 'chamber', position: [barrelMid, 0, 0] },
  };

  const xs = [0, x, ...segments.flatMap((s) => [s.a[0], s.b[0]])];
  const span = Math.max(...xs) - Math.min(...xs);

  const placard = [
    'UNCALIBRATED',
    'Not a hardware prediction. Not a Phase 5 test.',
    'PLACEHOLDER geometry, issue #6.',
    'HP line: about 1 m of 1/4-in tube (components.json).',
    'Manifold and injector line: that length × their volume / the HP volume.',
    'Bottle: a sphere of the placeholder volume. No bottle is selected.',
    'Chamber barrel ⌀22.7 mm × ~90 mm, PROJECT_PLAN §2.2.',
    'Nozzle: throat, ε and 15° from components.json. Exit is Dt √ε.',
    'Handles and this panel are a viewing rig, not selected hardware.',
    'D-5 (valve actuation) is open. Stand height is not designed.',
  ];

  return {
    tubeOd: TUBE_OD_M,
    tubeR,
    runs: { hp: HP_LENGTH_M, manifold: manifoldLen, line: lineLen, branch: branchLen },
    bottle,
    nodes,
    parts,
    segments,
    gauges,
    engine,
    stations,
    span,
    placard,
  };
}
