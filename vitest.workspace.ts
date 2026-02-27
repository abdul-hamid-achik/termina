import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'e2e',
      include: ['tests/e2e/**/*.test.ts'],
      environment: 'happy-dom',
    },
  },
])
