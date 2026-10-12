/**
 * Quest 3 emulator for a desktop browser that has no headset.
 *
 * IWER replaces navigator.xr. The dev UI is how you move the emulated head
 * and controllers. main.js loads this file only after Emulate Quest 3 (or
 * ?emulate), so a headset session does not download it. See docs/vr-plan.md.
 */
import { XRDevice, metaQuest3 } from 'iwer';
import { DevUI } from '@iwer/devui';

let ui = null;

export function emulatorInstalled() {
  return ui != null;
}

/** Install once, before requestSession. A second call does nothing. */
export function installEmulator() {
  if (ui) return ui;
  const device = new XRDevice(metaQuest3, { stereoEnabled: true });
  device.installRuntime();
  let captured = null;
  device.installDevUI(
    class extends DevUI {
      constructor(d) {
        super(d);
        captured = this;
      }
    },
  );
  ui = captured;
  return ui;
}

export function renderEmulator(time) {
  if (ui) ui.render(time);
}
