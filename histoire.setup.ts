// Histoire global setup.
//  - loads the terminal theme (Tailwind 4 entry + :root CSS vars + JetBrains Mono
//    fonts) so every story iframe is styled exactly like the app;
//  - installs Pinia so store-coupled components (WarRoom, GameScreen) can call
//    useGameStore() — seed state in the story via direct ref assignment
//    (store.tick = …, store.allPlayers = …) or the store's updateFromTick action;
//  - shims the few Nuxt auto-imports/globals Histoire's standalone (non-Nuxt)
//    runtime lacks: a <NuxtLink> passthrough and a no-op navigateTo.
import './app/assets/css/terminal.css'
import { defineSetupVue3 } from '@histoire/plugin-vue'
import { createPinia } from 'pinia'
import { h } from 'vue'

// `navigateTo` is referenced bare (Nuxt auto-import) in a couple of click
// handlers; define it on the global so those references resolve to a no-op in
// stories instead of throwing ReferenceError when invoked.
;(globalThis as Record<string, unknown>).navigateTo ??= () => Promise.resolve()

export const setupVue3 = defineSetupVue3(({ app }) => {
  app.use(createPinia())
  // <NuxtLink> → passthrough <a> (render fn, not a template string, so we don't
  // need Vue's runtime template compiler).
  app.component('NuxtLink', {
    props: { to: { type: [String, Object], default: '#' } },
    setup(
      props: { to: string | Record<string, unknown> },
      { slots }: { slots: Record<string, (() => unknown) | undefined> },
    ) {
      return () =>
        h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
    },
  })
})
