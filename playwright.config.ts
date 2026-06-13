import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e/specs',
  globalSetup: 'tests/e2e/global-setup.ts',
  globalTeardown: 'tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  // The game-fixture specs depend on real matchmaking over the dev-mode WS
  // proxy chain, which intermittently drops the lobby socket (documented dev
  // fragility — see CLAUDE.md), so lobby_state occasionally never arrives and
  // the hero picker stalls. That's a dev-environment artifact, not a product
  // bug (matchmaking works; the stall is rare and non-deterministic), so we
  // retry rather than chase a phantom. The real fix is a load/WS-independent
  // direct start-game test hook — documented follow-up.
  retries: 2,
  reporter: 'html',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    // Locally, reuse a dev server already on :3000 (it must run with the env
    // below — termina_test DB / redis db1); CI always spawns its own.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NUXT_DATABASE_URL:
        process.env.NUXT_DATABASE_URL ??
        'postgresql://termina:termina@localhost:5432/termina_test',
      NUXT_REDIS_URL: process.env.NUXT_REDIS_URL ?? 'redis://localhost:6379/1',
      NUXT_SESSION_PASSWORD:
        process.env.NUXT_SESSION_PASSWORD ?? 'e2e-test-session-secret-at-least-32-characters-long',
      // Dev/test-only game accelerator (server/game/engine/fastGame.ts):
      // ticks run 8x faster and structure HP shrinks so bot games end via
      // Ancient destruction in ~2-4 minutes instead of 35-50. Required by
      // the game-over and smoke specs, which play a game to completion.
      TERMINA_TEST_FAST_GAME: process.env.TERMINA_TEST_FAST_GAME ?? '8',
      // The suite registers ~50 users from one IP; the per-IP auth limit would
      // 429 most of them. Disable rate limiting for the test server only.
      TERMINA_DISABLE_RATE_LIMIT: '1',
      // Opt-in for test-only server hooks (server/api/test/*). Enables the
      // /api/test/force-end route the game-over + smoke specs use to end a
      // game deterministically instead of playing a full match to completion.
      TERMINA_TEST_HOOKS: '1',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Mobile-only specs (touch viewport assertions) run in mobile-chromium
      testIgnore: ['**/mobile/**'],
    },
    {
      // Mobile viewport coverage: Pixel 7 ships isMobile + hasTouch + a
      // 412×915 viewport. Runs the mobile-specific specs plus the item shop
      // (which must open via a real tap on touch devices — no force clicks).
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], isMobile: true, hasTouch: true },
      testMatch: ['**/mobile/**/*.spec.ts', '**/game/item-shop.spec.ts'],
    },
  ],
})
