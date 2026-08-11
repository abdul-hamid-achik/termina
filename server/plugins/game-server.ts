import { ManagedRuntime } from 'effect'
import { testHooksEnabled } from '~~/server/utils/testHooks'
import {
  DatabaseService,
  DatabaseServiceLive,
  type DatabaseServiceApi,
} from '~~/server/services/DatabaseService'
import { gameLog } from '~~/server/utils/log'
import { registerAllHeroes } from '~~/server/game/heroes'

/**
 * Minimal boot plugin for the all-Vercel deployment (Workflow tick + Neon +
 * Ably — see CLAUDE.md's Deployment section). Everything Redis/fiber/
 * reaper/spectator/finalize-intent that used to live here died with the
 * DO-era in-process game server: Vercel Workflow (server/workflows/gameTick.ts
 * + gameTickCore.ts) now owns each game's lifecycle tick-by-tick, reading and
 * writing `live_games`/`pending_actions` in Neon directly — it neither reads
 * nor needs anything this plugin sets up.
 *
 * What's left, and why each survives:
 *  - `registerAllHeroes()` — every hero module self-registers its ability/
 *    passive resolvers on import, but a production bundle can tree-shake
 *    those side-effect-only imports away (see server/game/heroes/index.ts),
 *    leaving an empty registry. Calling it here pins the whole hero chain
 *    into this plugin's bundle. gameTickCore.ts's rehydrateRegistries also
 *    calls it per-tick (a fresh serverless instance has no boot-time state to
 *    rely on) — belt and suspenders, cheap and idempotent.
 *  - `DatabaseServiceLive` — the Effect-wrapped Neon/Postgres access layer.
 *    Resolved once here into `getGameRuntime().dbService` because a large
 *    number of unrelated API routes (auth, guild, player, match, leaderboard,
 *    party, replay, ready) already call `getGameRuntime()` as their
 *    "is the DB layer up" readiness gate before reaching for `dbService` —
 *    rewriting every one of those call sites to construct their own layer
 *    was out of scope for this cutover; this plugin is what keeps that
 *    existing call shape working.
 */

export interface GameRuntime {
  dbService: DatabaseServiceApi
  managedRuntime: ManagedRuntime.ManagedRuntime<never, never>
}

let _runtime: GameRuntime | null = null

export function getGameRuntime(): GameRuntime | null {
  return _runtime
}

export default defineNitroPlugin(async (nitroApp) => {
  // During the build-time prerender pass, Nitro boots the server in-process to
  // SSR the prerendered routes (/terms, /privacy). Skip DB bring-up then —
  // prerendering only needs the HTTP/SSR layer.
  if (import.meta.prerender) return

  // Populate the hero ability/passive registry up front — see module doc.
  registerAllHeroes()

  // Loud, unmissable warning if the test-only relaxations are enabled. The gate is
  // the explicit TERMINA_TEST_HOOKS=1 opt-in alone. It enables no endpoints — the
  // /api/test/* seed routes were removed — but it DOES relax the auth rate limit
  // (with TERMINA_DISABLE_RATE_LIMIT) and the cycle accelerator, so it must NEVER
  // be set in a real deployment.
  if (testHooksEnabled()) {
    gameLog.warn(
      '\n⚠️  TERMINA_TEST_HOOKS=1 — test-only relaxations are ENABLED.\n' +
        '   Auth rate-limit escape hatch + fast-game accelerator + DevTools off.\n' +
        '   NEVER set this in production.\n',
    )
  }

  const managedRuntime = ManagedRuntime.make(DatabaseServiceLive)
  const db = await managedRuntime.runPromise(DatabaseService)

  _runtime = { dbService: db, managedRuntime }

  gameLog.info('Game server initialized (DB service layer)')

  nitroApp.hooks.hook('close', async () => {
    await managedRuntime.runPromise(db.shutdown())
    await managedRuntime.dispose()
    _runtime = null
  })
})
