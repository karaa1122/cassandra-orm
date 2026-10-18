import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against package sources, so nothing has to be built first.
const resolve = {
  alias: {
    '@cassandra-orm/core': fileURLToPath(
      new URL('./packages/core/src/index.ts', import.meta.url),
    ),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.spec.ts'],
          setupFiles: ['reflect-metadata'],
        },
      },
      {
        resolve,
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int-spec.ts'],
          setupFiles: ['reflect-metadata'],
          globalSetup: ['./test/cassandra.global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
