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
