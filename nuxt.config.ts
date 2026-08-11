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
  // workflow/nuxt: Vercel Workflow DevKit — drives each game's 4s tick
  // (server/workflows/gameTick.ts), replacing the DO-era in-process game
  // loop fiber. All-Vercel cutover is complete; this is load-bearing on main.
  modules: ['@pinia/nuxt', 'nuxt-auth-utils', 'workflow/nuxt'],
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
      link: [
        // SVG first: modern browsers prefer it and it stays crisp at every
        // size. The .ico is the legacy/crawler fallback — it was declared here
        // before but public/ did not exist, so every page load 404'd and the
        // tab showed a blank icon.
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },

  runtimeConfig: {
    // Public (client-exposed) — the API origin, a leftover of the Vercel
    // frontend → DigitalOcean API split (now deleted; all-Vercel runs
    // same-origin via vercel.json's /api/* rewrite). Empty string =
    // same-origin. Set NUXT_PUBLIC_API_URL only if a future deploy ever
    // splits origins again. The DO-era WS origin (wsUrl) and the
    // ablyTransport migration flag that picked between the DO WebSocket
    // (useGameSocket, deleted) and Ably (useGameChannel) are gone —
    // useGameTransport() always returns the Ably transport now.
    public: {
      apiUrl: '',
    },
    // Server-only: comma-separated allow-list of browser Origins permitted
    // credentialed CORS on /api/ (set NUXT_CORS_ALLOWED_ORIGINS to the Vercel
    // app URL in prod). Empty permits same-origin requests only.
    corsAllowedOrigins: '',
    session: {
      password: '',
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        // Empty = host-only cookie. Correct for dev and for the all-Vercel
        // deployment (frontend + API are same-origin — there is no DO split
        // to bridge anymore). Only needed if a future deploy ever splits
        // origins again (see NUXT_PUBLIC_API_URL above): set
        // NUXT_SESSION_COOKIE_DOMAIN to the shared parent domain on both
        // deployments, and keep NUXT_SESSION_PASSWORD identical everywhere.
        domain: '',
      },
    },
    oauth: {
      // redirectURL can be forced to a specific frontend origin in prod
      // (NUXT_OAUTH_*_REDIRECT_URL) — needed only if a request's Host header
      // ever diverges from the registered OAuth callback (e.g. a future
      // reverse proxy). On the all-Vercel deployment there is no such split,
      // so empty (derive from request) is correct everywhere, incl. dev.
      github: { clientId: '', clientSecret: '', redirectURL: '' },
      discord: { clientId: '', clientSecret: '', redirectURL: '' },
    },
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

  components: [{ path: '~/components', pathPrefix: false }],

  typescript: {
    strict: true,
    typeCheck: true,
  },
})
