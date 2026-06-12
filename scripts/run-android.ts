/**
 * Picks the first connected Android device from `adb devices` and passes it
 * to `web-ext run --firefox-android` so the npm script works without manually
 * copying the device serial.
 *
 * Usage (via npm script):
 *   pnpm dev:firefox-android
 */

import { execSync, spawn } from 'node:child_process';

function firstDevice(): string {
  let output: string;
  try {
    output = execSync('adb devices', { encoding: 'utf8' });
  } catch {
    console.error('ERROR: `adb` not found. Install Android platform-tools and add to PATH.');
    process.exit(1);
  }

  // adb output: first line is "List of devices attached", rest are "<serial>\t<state>"
  const device = output
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('\tdevice') || (l.includes('\t') && l.split('\t')[1] === 'device'))
    .map((l) => l.split('\t')[0].trim())[0];

  if (!device) {
    console.error(
      'ERROR: No Android device in "device" state found.\n' +
        'Check:\n' +
        '  1. USB debugging enabled on the phone\n' +
        '  2. Remote debugging via USB enabled in Firefox Nightly settings\n' +
        '  3. `adb devices` shows the serial with status "device" (not "unauthorized")',
    );
    process.exit(1);
  }

  return device;
}

const deviceId = firstDevice();
console.log(`Android device: ${deviceId}`);

const proc = spawn(
  'npx',
  [
    '-y',
    'web-ext',
    'run',
    '--target',
    'firefox-android',
    '--android-device',
    deviceId,
    '--firefox-apk',
    'org.mozilla.fenix',
    '--source-dir',
    '.output/firefox-mv3',
  ],
  { stdio: 'inherit', shell: true },
);

proc.on('exit', (code) => process.exit(code ?? 0));
