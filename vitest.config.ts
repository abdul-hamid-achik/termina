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
    // thresholds below — set just under the achieved actuals (lines 78.35 /
    // branches 69.56 / functions 77.04 / statements 76.91 after the HUD-settings
    // feature + deny-command + ws-log test additions) so a real regression trips
    // the gate but normal churn doesn't. lines (→78) and branches (→69) clear
    // their next integer with a comfortable buffer, so they're raised. functions
    // (77.04, only ~0.04 over 77) and statements (76.91, still under 77) sit too
    // thin above the next integer, so they HOLD at 76. Raise as coverage climbs;
    // never above earned.
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
        lines: 78,
        branches: 69,
        functions: 76,
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
