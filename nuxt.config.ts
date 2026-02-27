// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  future: {
    compatibilityVersion: 4,
  },

  modules: ['@pinia/nuxt', '@nuxtjs/tailwindcss', '@nuxt/eslint', 'nuxt-auth-utils'],

  app: {
    head: {
      title: 'TERMINA',
      meta: [
        {
          name: 'description',
          content: 'A text-based multiplayer MOBA — where every command is a kill',
        },
        { name: 'theme-color', content: '#0a0a0f' },
      ],
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
    },
  },

  css: ['@fontsource/jetbrains-mono/400.css', '@fontsource/jetbrains-mono/700.css'],

  runtimeConfig: {
    sessionSecret: '',
    oauth: {
      github: { clientId: '', clientSecret: '' },
      discord: { clientId: '', clientSecret: '' },
    },
    redis: { url: 'redis://localhost:6379' },
    database: { url: 'postgresql://termina:termina@localhost:5432/termina' },
  },

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  tailwindcss: {
    cssPath: '~/assets/css/terminal.css',
  },

  components: [{ path: '~/components', pathPrefix: false }],

  typescript: {
    strict: true,
    typeCheck: false,
  },
})
