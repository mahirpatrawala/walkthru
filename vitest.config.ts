import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // *.local.test.ts run real COLMAP/Brush or read files outside the repo: opt in with `npm run test:local`
    exclude: process.env.WALKTHRU_LOCAL ? [] : ['tests/**/*.local.test.ts', 'node_modules/**'],
  },
});
