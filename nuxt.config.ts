// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  // DevTools injects @vue/devtools-core/-kit into the browser in dev mode. On a
  // cold Vite cache (every fresh CI checkout) the first real page load makes
  // Vite "discover new dependencies at runtime" and force a full dep
  // re-optimization + page reload — which yanks the page out from under the
  // e2e browser mid-navigation, so the first spec's `open` never settles and
  // the whole suite hangs. The e2e server runs with TERMINA_TEST_HOOKS=1, so
  // disable DevTools there (normal local dev keeps it).
  devtools: { enabled: process.env.TERMINA_TEST_HOOKS !== '1' },

  future: {
    compatibilityVersion: 4,
  },

  // Prerender the static legal pages to real HTML so they're served directly at
  // /terms and /privacy (incl. on the static Vercel deploy) — important for the
  // OAuth providers' app review + crawlers, which shouldn't depend on client JS.
  routeRules: {
    '/terms': { prerender: true },
    '/privacy': { prerender: true },
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
        // Empty = host-only cookie. This is correct for dev AND for the default
        // production same-origin proxy (the browser only ever talks to www, so
        // the cookie need not be shared). It is ONLY needed for the direct
        // cross-origin fallback (NUXT_PUBLIC_API_URL set → the SPA calls
        // api.terminamoba.com directly): then set NUXT_SESSION_COOKIE_DOMAIN=
        // .terminamoba.com on BOTH deployments so the cookie is shared across
        // www. and api. (www↔api are same-site, so SameSite=Lax suffices). In
        // every mode NUXT_SESSION_PASSWORD must be identical on Vercel and DO.
        domain: '',
      },
    },
    oauth: {
      github: { clientId: '', clientSecret: '' },
      discord: { clientId: '', clientSecret: '' },
    },
    redis: { url: 'redis://localhost:6380' },
    database: { url: 'postgresql://termina:termina@localhost:5433/termina' },
    // Transactional email (Resend). apiKey ← NUXT_RESEND_API_KEY (secret); from
    // ← NUXT_RESEND_FROM (needs a verified domain in Resend). Empty apiKey =
    // emails are logged + skipped (see server/utils/email.ts). redirectTo ←
    // NUXT_RESEND_REDIRECT_TO routes ALL mail to one address (testing sink).
    resend: { apiKey: '', from: '', redirectTo: '' },
    // Public base URL used to build links inside emails (verify / reset). Set
    // NUXT_APP_URL to the frontend origin in prod, e.g. https://terminamoba.com.
    appUrl: 'http://localhost:3000',
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
