/**
 * `npm test`: the physics self-test (brief §7). Runs headless in Node; nothing it imports may touch
 * the DOM (scripts/check-headless.mjs enforces that for src/physics/).
 *
 * Each suite lives in selftest/<name>.js and exports run(). The stiffness canary runs last, over
 * every simulation the suites recorded.
 */
import { summary, stiffnessReport } from './selftest/harness.js';
import * as registry from './selftest/registry.js';
import * as thermo from './selftest/thermo.js';
import * as integrator from './selftest/integrator.js';
import * as orifice from './selftest/orifice.js';
import * as blowdown from './selftest/blowdown.js';
import * as conservation from './selftest/conservation.js';
import * as devices from './selftest/devices.js';
import * as regulator from './selftest/regulator.js';
import * as reliefcheck from './selftest/reliefcheck.js';
import * as cv from './selftest/cv.js';

const SUITES = [registry, thermo, integrator, orifice, blowdown, conservation, devices, regulator, reliefcheck, cv];

for (const s of SUITES) await s.run();
await stiffnessReport();
if (summary()) process.exit(1);
