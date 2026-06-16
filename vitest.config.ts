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
    // thresholds below — set just under the achieved actuals (lines 77.8 /
    // branches 69.0 / functions 75.9 / statements 76.4 after the buyback +
    // surrender + WS-routing + map-model coverage passes) so a real regression
    // trips the gate but normal churn doesn't. lines/branches/functions sit just
    // under their next integer (78/69/76) and v8 has minor run-to-run variance,
    // so they hold. Raise as coverage climbs; never above earned.
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
        lines: 77,
        branches: 68,
        functions: 75,
        statements: 76,
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
      {
        // In-process gameplay harness — drives the real engine (no browser, no
        // server, no DB). Owns "does this game situation resolve correctly".
        extends: true,
        test: {
          name: 'gameplay',
          include: ['tests/gameplay/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
})
