import { defineConfig } from 'vitest/config'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'

// Vitest 4 replaced vitest.workspace.ts / defineWorkspace with `test.projects`.
// Each project `extends: true` to inherit the root resolve aliases + vue plugin.
export default defineConfig({
  resolve: {
    alias: {
      '~~': path.resolve(__dirname),
      '~': path.resolve(__dirname, 'app'),
    },
  },
  plugins: [vue()],
  test: {
    globals: true,
    // Coverage (v8). `bun run test:coverage` runs all projects and ENFORCES the
    // thresholds below — set just under the achieved actuals (lines 74.4 /
    // branches 66 / functions 73.9 / statements 73.2 as of the UI-gap close) so a
    // real regression trips the gate but normal churn doesn't. Raise them as
    // coverage climbs; never set them above what's earned.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.*',
        'app/**/*.story.vue',
        'server/db/migrations/**',
        'scripts/**',
        '.nuxt/**',
        '.output/**',
      ],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 68,
        statements: 70,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          exclude: ['tests/unit/components/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          include: ['tests/unit/components/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
})
