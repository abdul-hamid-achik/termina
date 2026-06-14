// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  future: {
    compatibilityVersion: 4,
  },

  // Tailwind v4 is wired via its Vite plugin (the @nuxtjs/tailwindcss module is
  // v3-only). The stylesheet is imported directly via `css` below.
  modules: ['@pinia/nuxt', 'nuxt-auth-utils'],
  css: ['~/assets/css/terminal.css'],
  vite: {
    plugins: [tailwindcss()],
  },

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

  runtimeConfig: {
    session: {
      password: '',
      cookie: {
        secure: process.env.NODE_ENV === 'production',
      },
    },
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

  components: [{ path: '~/components', pathPrefix: false }],

  typescript: {
    strict: true,
    typeCheck: true,
  },
})
