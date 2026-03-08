import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      exclude: ['tests/unit/components/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'components',
      include: ['tests/unit/components/**/*.test.ts'],
      environment: 'happy-dom',
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
])
