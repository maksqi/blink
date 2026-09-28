import { fileURLToPath } from 'node:url'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Same aliases Nuxt provides, for plain-Node unit tests of app/lib, shared and server modules. */
const alias = {
  '~~': r('./'),
  '~': r('./app'),
  '@': r('./app'),
  '#shared': r('./shared'),
}

const exclude = ['**/node_modules/**', '**/.claude/**', '**/.nuxt/**', '**/.output/**']

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'app/lib/**/*.test.ts',
            'app/composables/**/*.test.ts',
            'shared/**/*.test.ts',
            'server/services/**/*.test.ts',
            'server/utils/**/*.test.ts',
            'server/database/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
          // *.nuxt.test.ts files need the Nuxt environment and run in the `nuxt` project.
          exclude: [...exclude, '**/*.nuxt.test.ts'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          include: ['app/**/*.nuxt.test.ts'],
          exclude,
        },
      }),
      {
        resolve: { alias },
        test: {
          name: 'api',
          environment: 'node',
          include: ['tests/api/**/*.test.ts'],
          exclude,
          // Builds and starts the server once for all API test files (tests/api/_harness, owned by server-core).
          globalSetup: ['tests/api/_harness/global-setup.ts'],
          // Files share one server, limiter store and settings cache: run them one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
})
