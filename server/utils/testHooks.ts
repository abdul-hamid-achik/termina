/**
 * Whether the test-only server relaxations are active. There are NO dev endpoints
 * behind this flag any more — the `server/api/test/*` seed routes were removed and
 * e2e now drives the real app. What it still gates:
 *   - the auth rate-limit escape hatch (paired with `TERMINA_DISABLE_RATE_LIMIT`
 *     so an e2e run can register many users from one IP — see RateLimiter.ts),
 *   - the `TERMINA_TEST_FAST_GAME` tick accelerator,
 *   - DevTools being disabled (nuxt.config.ts).
 *
 * SECURITY MODEL — read before changing:
 * The SOLE gate is the explicit `TERMINA_TEST_HOOKS=1` opt-in. It is OFF unless
 * that env var is set, and a real production deployment must NEVER set it.
 *
 * We intentionally do NOT also gate on `NODE_ENV !== 'production'`: the e2e suite
 * runs against a PRODUCTION BUILD preview server (so `NODE_ENV === 'production'`
 * there too) to escape the dev server's flakiness. That means NODE_ENV can no
 * longer distinguish "e2e preview" from "real prod" — the explicit env var is the
 * only honest signal, so it is the whole gate. `server/plugins/game-server.ts`
 * logs a loud startup warning whenever it is enabled so an accidental production
 * opt-in is impossible to miss.
 */
export function testHooksEnabled(): boolean {
  return process.env.TERMINA_TEST_HOOKS === '1'
}
