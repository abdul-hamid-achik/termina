/**
 * Whether the dev/test-only e2e hooks (`server/api/test/*`) and the
 * `TERMINA_TEST_FAST_GAME` accelerator are active.
 *
 * SECURITY MODEL — read before changing:
 * The SOLE gate is the explicit `TERMINA_TEST_HOOKS=1` opt-in. It is OFF unless
 * that env var is set, and a real production deployment must NEVER set it.
 *
 * We intentionally do NOT also gate on `NODE_ENV !== 'production'`: the e2e suite
 * runs against a PRODUCTION BUILD preview server (so `NODE_ENV === 'production'`
 * there too) to escape the dev server's flakiness. That means NODE_ENV can no
 * longer distinguish "e2e preview" from "real prod" — the explicit env var is the
 * only honest signal, so it is the whole gate.
 *
 * These hooks are dangerous on purpose (e.g. `login-as` mints a session for ANY
 * username — an auth bypass). They 404 unless enabled. `server/plugins/game-server.ts`
 * logs a loud startup warning whenever they are enabled so an accidental
 * production opt-in is impossible to miss.
 */
export function testHooksEnabled(): boolean {
  return process.env.TERMINA_TEST_HOOKS === '1'
}
