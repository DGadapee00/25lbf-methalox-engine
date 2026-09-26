/**
 * `npm test`: the physics self-test (brief §7). Runs headless in Node; nothing it imports may touch
 * the DOM (scripts/check-headless.mjs enforces that for src/physics/).
 *
 * Each suite lives in selftest/<name>.js and exports run().
 */
import { summary } from './selftest/harness.js';
import * as registry from './selftest/registry.js';

const SUITES = [registry];

for (const s of SUITES) await s.run();
if (summary()) process.exit(1);
