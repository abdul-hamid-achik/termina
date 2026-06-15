import { defineConfig } from 'histoire'
import { HstVue } from '@histoire/plugin-vue'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Histoire is PINNED to the 1.0.0-beta line (see package.json) — it's the only
// release that supports Vite 7 (what Nuxt 4 ships). It renders Vue components in
// a standalone Vite context with NO Nuxt runtime, so:
//  - the Tailwind 4 plugin is added here (mirrors nuxt.config.ts vite.plugins) so
//    `@import 'tailwindcss'` + the @config directive in terminal.css resolve;
//  - the ~ / ~~ / @ aliases mirror vitest.config.ts so story imports resolve;
//  - terminal.css (theme vars + fonts) is imported by histoire.setup.ts so the
//    story iframe is themed.
// Components that touch Nuxt auto-imports / Pinia get those shimmed in the setup
// file (createPinia + NuxtLink/useRoute/navigateTo/definePageMeta stubs).
export default defineConfig({
  plugins: [HstVue()],
  setupFile: './histoire.setup.ts',
  storyMatch: ['app/**/*.story.vue'],
  theme: {
    title: 'Termina — UI & Gameplay',
  },
  vite: {
    // @vitejs/plugin-vue is needed even though HstVue() handles rendering —
    // Histoire's separate story-COLLECTION Vite pass must transform .vue too.
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '~~': path.resolve(__dirname),
        '~': path.resolve(__dirname, 'app'),
        '@': path.resolve(__dirname, 'app'),
      },
    },
  },
})
