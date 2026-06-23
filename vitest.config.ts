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
    // thresholds below — set just under the achieved actuals (lines 79.29 /
    // branches 71.01 / functions 78.06 / statements 78.00 after the loop's test
    // additions: combatLog / RateLimiter / queue / lobby / useGameSocket /
    // day-night / glyph-expiry / respawn-scaling / kill-streak / aegis / etc.) so
    // a real regression trips the gate but normal churn doesn't. Each clears its
    // next integer with a comfortable buffer, so all four are raised: branches
    // (+1.01), functions (+1.06), statements (+1.00), and lines (+0.29 over 79 —
    // the established ~0.35 line tightness). Raise as coverage climbs; never
    // above earned.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.*',
        'app/**/*.story.vue',
        // Route components (pages) are exercised by cairntrace e2e + render
        // checks, not unit tests — per the project's responsibility split (UI/e2e
        // → cairntrace, logic → unit). Counting them in UNIT coverage just drags
        // the logic bar down for code that's covered elsewhere.
        'app/pages/**',
        'server/db/migrations/**',
        'server/game/dev/simulate-game.ts', // standalone manual tool (its simStats helper IS covered)
        '.nuxt/**',
        '.output/**',
      ],
      thresholds: {
        lines: 79,
        branches: 70,
        functions: 77,
        statements: 77,
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
