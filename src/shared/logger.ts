// Tiny logger. `debug` is gated by `verbose`; everything else always
// prints. Background and content scripts wire `setVerbose` to the
// current `settings.verboseLogging` value on boot and on settings change.

let verbose = false;
const tag = '[ToDoTube]';

export function setVerbose(v: boolean): void {
  verbose = v;
}

export const log = {
  debug: (...args: unknown[]): void => {
    if (verbose) console.debug(tag, ...args);
  },
  info: (...args: unknown[]): void => {
    console.info(tag, ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(tag, ...args);
  },
  error: (...args: unknown[]): void => {
    console.error(tag, ...args);
  },
};
