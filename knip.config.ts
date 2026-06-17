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
  //  - server/game/dev/simulate-game.ts — standalone manual balance tool, run
  //    directly (never imported), so it needs to be an explicit entry root.
  //  - tests/** — test suites.
  entry: [
    'app/components/**/*.vue',
    'server/db/**/*.ts',
    'server/game/dev/simulate-game.ts',
    'tests/**/*.ts',
    // Histoire config + setup live at repo root (outside `project` globs) and are
    // loaded by the `histoire` CLI, so mark them as entries — otherwise their
    // imports (@histoire/plugin-vue, @vitejs/plugin-vue, @tailwindcss/vite) read
    // as unused deps. Story files are discovered by Histoire's glob, not imported.
    'histoire.config.ts',
    'histoire.setup.ts',
    'app/**/*.story.vue',
  ],
  project: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts'],
  // hitspec and cairn are global dev CLIs invoked by the test:api / test:e2e
  // scripts (not npm deps). cairn is now called directly in package.json (it
  // used to be spawned from scripts/e2e.mjs), so it must be ignored explicitly.
  ignoreBinaries: ['hitspec', 'cairn'],
  ignoreDependencies: [
    // Provided by Nuxt, not directly imported
    'vue-router',
    // CLI type-checker — run via `npx vue-tsc` and Nuxt's typeCheck:true
    // (vite-plugin-checker), not imported in source. Pinned as a direct devDep
    // so the @nuxt/kit override can't drop it from the install.
    'vue-tsc',
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
