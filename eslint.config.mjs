import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true,
    stylistic: false,
  },
})
  .append({
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  })
  .append({
    // consistent-type-imports needs the TS parser; only apply it to files it can parse.
    files: ['**/*.ts', '**/*.tsx', '**/*.vue', '**/*.mts', '**/*.cts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  })
