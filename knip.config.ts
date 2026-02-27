import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    'app/app.vue',
    'app/pages/**/*.vue',
    'app/layouts/**/*.vue',
    'app/components/**/*.vue',
    'app/composables/**/*.ts',
    'app/stores/**/*.ts',
    'server/**/*.ts',
    'shared/**/*.ts',
  ],
  project: [
    'app/**/*.{ts,vue}',
    'server/**/*.ts',
    'shared/**/*.ts',
    'tests/**/*.ts',
  ],
  ignore: ['eslint.config.mjs'],
  ignoreDependencies: [
    // Fonts loaded via CSS
    '@fontsource/jetbrains-mono',
    // Provided by Nuxt, not directly imported
    'vue-router',
    // Peer dep of @effect/schema, pins effect version
    '@effect/platform',
  ],
}

export default config
