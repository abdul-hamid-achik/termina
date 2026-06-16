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
    // thresholds below — set just under the achieved actuals (lines 75.9 /
    // branches 67.4 / functions 74.6 / statements 74.6 after the gameplay
    // effect-assertion pass) so a real regression trips the gate but normal
    // churn doesn't. Raise them as coverage climbs; never set them above earned.
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
        lines: 75,
        branches: 66,
        functions: 73,
        statements: 73,
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
