import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Several suites build every catalogue piece or a whole podium level; on a loaded 8 GB machine they pass 5 s without being wrong.
    testTimeout: 30000,
    include: ['tests/**/*.test.ts'],
    // *.local.test.ts run real COLMAP/Brush or read files outside the repo: opt in with `npm run test:local`
    exclude: process.env.WALKTHRU_LOCAL ? [] : ['tests/**/*.local.test.ts', 'node_modules/**'],
  },
});
