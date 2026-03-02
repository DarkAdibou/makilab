import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  test: {
    env: {
      // Isolate test DB from production — each test run uses a temp file
      MAKILAB_DB_PATH: resolve(tmpdir(), `makilab-test-${process.pid}.db`),
    },
  },
});
