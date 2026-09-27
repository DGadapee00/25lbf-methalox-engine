/**
 * Training table: a sequence in the Test_Stand/sequences/ format for the hot-fire stand, with
 * steps, two aborts, a safe-shutdown action and four checks. It exists so the guide can teach
 * Sequence mode, faults and aborts on the hot-fire stand, and the M5 self-test runs the same table.
 *
 * EVERY timing and threshold here is made up to exercise the tool. It is not a proposed hot-fire
 * sequence, abort set or safe-shutdown: those are Dalton's (brief §5.4), and none has been written.
 * That is why it lives in Sim/src/data and not in Test_Stand/sequences/.
 */
export const TRAINING_ABORTS = {
  id: 'training-hotfire-aborts',
  purpose: 'TRAINING TABLE: made-up timings and thresholds for learning the tool and for the self-test. Not a proposed hot-fire sequence, abort set or safe-shutdown.',
  tEnd: 3.0,
  rateHz: 50,
  steps: [
    { t: 0, cmd: { 'HV-OX-01': 'open', 'HV-FU-01': 'open', 'HV-N2-01': 'open' } },
    { t: 1.0, cmd: { 'IGN-IG-01': 'on' } },
    { t: 1.1, cmd: { 'SV-OX-01': 'open' } },
    { t: 1.15, cmd: { 'SV-FU-01': 'open' } },
    { t: 2.5, cmd: { 'SV-FU-01': 'close' } },
    { t: 2.55, cmd: { 'SV-OX-01': 'close', 'IGN-IG-01': 'off' } },
  ],
  aborts: [
    { id: 'A-1', when: 'PT-CH-01 < 150 psia after t=1.6 before t=2.5', action: 'safe-shutdown', test: { faults: [{ t: 0, id: 'IGN-IG-01', cmd: { fault: 'no-light' } }] } },
    { id: 'A-2', when: 'PT-OX-02 > 650 psia for 3 samples', action: 'safe-shutdown', test: { faults: [{ t: 0.5, id: 'PCV-OX-01', cmd: { fault: 'open' } }] } },
  ],
  actions: {
    'safe-shutdown': [
      { dt: 0, cmd: { 'SV-FU-01': 'close', 'SV-OX-01': 'close', 'IGN-IG-01': 'off' } },
      { dt: 0.2, cmd: { 'SV-N2-01': 'open' } },
    ],
  },
  checks: [
    { id: 'C-1', expect: 'unburned energy at ignition < 2000 J' },
    { id: 'C-2', expect: 'no abort' },
    { id: 'C-3', expect: 'chamber not burning after abort + 0.5 s' },
    { id: 'C-4', expect: 'INJ-OX-01 choked from t=1.6 to t=2.5' },
  ],
};
