import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // The built-in Nuxt plugin discovers app entry points (app.vue, pages,
  // layouts, middleware) and the Nitro server handlers — but its default
  // patterns assume the Nuxt v3 layout (srcDir = root). This project uses the
  // Nuxt v4 layout (srcDir = app/), so re-point the plugin's entry patterns
  // under app/ and keep the server-side patterns it already covers.
  nuxt: {
    entry: [
      'app/app.{js,ts,mjs,jsx,tsx,vue}',
      'app/error.{js,ts,mjs,jsx,tsx,vue}',
      'app/pages/**/*.{js,ts,mjs,jsx,tsx,vue}',
      'app/layouts/**/*.{js,ts,mjs,jsx,tsx,vue}',
      'app/middleware/**/*.{js,ts,mjs,jsx,tsx,vue}',
      'app/plugins/**/*.{js,ts,mjs,jsx,tsx,vue}',
      'server/api/**/*.{js,ts,mjs}',
      'server/routes/**/*.{js,ts,mjs}',
      'server/middleware/**/*.{js,ts,mjs}',
      'server/plugins/**/*.{js,ts,mjs}',
    ],
  },
  // Entry points the Nuxt plugin can't infer:
  //  - app/components/** — Nuxt globally auto-registers every component
  //    (components: [{ path: '~/components', pathPrefix: false }]), so they are
  //    reachable from templates without an explicit import; treat them as roots.
  //  - server/db/** — DB layer wired via Nitro runtime config / migrations.
  //  - scripts/** — standalone simulation harness.
  //  - tests/** — test suites.
  entry: [
    'app/components/**/*.vue',
    'server/db/**/*.ts',
    'scripts/**/*.ts',
    'tests/**/*.ts',
  ],
  project: [
    'app/**/*.{ts,vue}',
    'server/**/*.ts',
    'shared/**/*.ts',
    'tests/**/*.ts',
  ],
  ignore: ['eslint.config.mjs'],
  ignoreBinaries: ['hitspec'],
  ignoreDependencies: [
    // Fonts loaded via CSS
    '@fontsource/jetbrains-mono',
    // Provided by Nuxt, not directly imported
    'vue-router',
  ],
  // The pre-commit gate cares most about unused FILES and DEPENDENCIES (real
  // bloat / supply-chain surface) — those stay errors. Unused exports/types are
  // lower-severity and the repo currently carries ~75 pre-existing ones (e.g.
  // the per-hero `export { resolveHeroAbility, ... }` after registerHero); they
  // are surfaced as warnings so the gate doesn't block on them. A dedicated
  // dead-export sweep can clear them later.
  rules: {
    exports: 'warn',
    types: 'warn',
    enumMembers: 'warn',
  },
}

export default config
