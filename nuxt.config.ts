// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  // DevTools injects @vue/devtools-core/-kit into the browser in dev mode. On a
  // cold Vite cache (every fresh CI checkout) the first real page load makes
  // Vite "discover new dependencies at runtime" and force a full dep
  // re-optimization + page reload — which yanks the page out from under the
  // e2e browser mid-navigation, so the first spec's `open` never settles and
  // the whole suite hangs. The e2e dev server runs with TERMINA_TEST_HOOKS=1,
  // so disable DevTools there (normal local dev keeps it).
  devtools: { enabled: process.env.TERMINA_TEST_HOOKS !== '1' },

  future: {
    compatibilityVersion: 4,
  },

  // Don't ship the dev/test-only /api/test/* hooks (incl. the `login-as` auth
  // bypass) to a real production build — drop the code entirely, not just
  // 404-gate it at runtime (server/utils/testHooks.ts). The e2e + api-test
  // builds set TERMINA_TEST_HOOKS=1 and keep the hooks; every other build (the
  // prod Docker image, the CI `build` job) excludes them.
  ignore: process.env.TERMINA_TEST_HOOKS === '1' ? [] : ['server/api/test/**'],

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
    // Public (client-exposed) — the WS + API origins for the Vercel frontend →
    // DigitalOcean WS server split. Empty string = same-origin (dev +
    // single-instance DO). Set NUXT_PUBLIC_WS_URL / NUXT_PUBLIC_API_URL in prod
    // to point the Vercel SPA at the DO server.
    public: {
      wsUrl: '',
      apiUrl: '',
    },
    // Server-only: comma-separated allow-list of browser Origins permitted
    // credentialed CORS on /api/ (set NUXT_CORS_ALLOWED_ORIGINS to the Vercel
    // app URL in prod). Empty = echo the request origin (dev / same-origin DO).
    corsAllowedOrigins: '',
    session: {
      password: '',
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      },
    },
    oauth: {
      github: { clientId: '', clientSecret: '' },
      discord: { clientId: '', clientSecret: '' },
    },
    redis: { url: 'redis://localhost:6380' },
    database: { url: 'postgresql://termina:termina@localhost:5433/termina' },
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
