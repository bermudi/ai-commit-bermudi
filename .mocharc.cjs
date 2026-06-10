'use strict';

const path = require('path');

/**
 * Mocha config for the unit test harness.
 *
 * - Run TypeScript source tests directly via `tsx` (no compile step).
 * - Load `src/test/setup.ts` first so `vscode` and `fs-extra` are mocked
 *   before any source module imports them.
 * - Tests live alongside source under `src/test/`.
 */
module.exports = {
  extension: ['ts'],
  spec: ['src/test/**/*.test.ts'],
  require: ['tsx', path.join(__dirname, 'src/test/setup.ts')],
  reporter: 'spec',
  timeout: 10000,
  recursive: true,
  exit: true
};
