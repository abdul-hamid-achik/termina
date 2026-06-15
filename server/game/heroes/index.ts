/**
 * Hero registry barrel.
 *
 * Each hero module ALSO self-registers via a top-level `registerHero(...)` call,
 * which is enough for the unit tests (vitest imports modules whole, no
 * tree-shaking) and dev (Vite preserves side-effect imports). But the PRODUCTION
 * Nitro/rollup build tree-shook those side-effect-only `import './echo'` lines —
 * this barrel's `export * from './_base'` let consumers resolve hero helpers
 * straight from `_base`, so the per-hero modules (and their registrations) were
 * dropped from the bundle entirely. The result: an empty registry at runtime and
 * every cast failing with "No resolver registered" (abilities silently did
 * nothing in any built/deployed server, though dev worked).
 *
 * The fix: explicit NAMED imports the bundler can't drop, registered by
 * `registerAllHeroes()`. The server plugin calls it at startup, so the whole
 * dependency chain (this barrel → every hero module) is retained and runs.
 */
import { registerHero } from './_base'
import { resolveHeroAbility as cacheAbility, resolveHeroPassive as cachePassive } from './cache'
import { resolveHeroAbility as cipherAbility, resolveHeroPassive as cipherPassive } from './cipher'
import { resolveHeroAbility as cronAbility, resolveHeroPassive as cronPassive } from './cron'
import { resolveHeroAbility as daemonAbility, resolveHeroPassive as daemonPassive } from './daemon'
import { resolveHeroAbility as echoAbility, resolveHeroPassive as echoPassive } from './echo'
import {
  resolveHeroAbility as firewallAbility,
  resolveHeroPassive as firewallPassive,
} from './firewall'
import { resolveHeroAbility as kernelAbility, resolveHeroPassive as kernelPassive } from './kernel'
import { resolveHeroAbility as lambdaAbility, resolveHeroPassive as lambdaPassive } from './lambda'
import { resolveHeroAbility as mallocAbility, resolveHeroPassive as mallocPassive } from './malloc'
import { resolveHeroAbility as mutexAbility, resolveHeroPassive as mutexPassive } from './mutex'
import {
  resolveHeroAbility as nullRefAbility,
  resolveHeroPassive as nullRefPassive,
} from './null_ref'
import { resolveHeroAbility as pingAbility, resolveHeroPassive as pingPassive } from './ping'
import { resolveHeroAbility as proxyAbility, resolveHeroPassive as proxyPassive } from './proxy'
import { resolveHeroAbility as regexAbility, resolveHeroPassive as regexPassive } from './regex'
import { resolveHeroAbility as sentryAbility, resolveHeroPassive as sentryPassive } from './sentry'
import { resolveHeroAbility as socketAbility, resolveHeroPassive as socketPassive } from './socket'
import { resolveHeroAbility as threadAbility, resolveHeroPassive as threadPassive } from './thread'
import {
  resolveHeroAbility as tracerouteAbility,
  resolveHeroPassive as traceroutePassive,
} from './traceroute'

const HERO_RESOLVERS = {
  cache: { ability: cacheAbility, passive: cachePassive },
  cipher: { ability: cipherAbility, passive: cipherPassive },
  cron: { ability: cronAbility, passive: cronPassive },
  daemon: { ability: daemonAbility, passive: daemonPassive },
  echo: { ability: echoAbility, passive: echoPassive },
  firewall: { ability: firewallAbility, passive: firewallPassive },
  kernel: { ability: kernelAbility, passive: kernelPassive },
  lambda: { ability: lambdaAbility, passive: lambdaPassive },
  malloc: { ability: mallocAbility, passive: mallocPassive },
  mutex: { ability: mutexAbility, passive: mutexPassive },
  null_ref: { ability: nullRefAbility, passive: nullRefPassive },
  ping: { ability: pingAbility, passive: pingPassive },
  proxy: { ability: proxyAbility, passive: proxyPassive },
  regex: { ability: regexAbility, passive: regexPassive },
  sentry: { ability: sentryAbility, passive: sentryPassive },
  socket: { ability: socketAbility, passive: socketPassive },
  thread: { ability: threadAbility, passive: threadPassive },
  traceroute: { ability: tracerouteAbility, passive: traceroutePassive },
} as const

let registered = false

/**
 * Register every hero's resolvers. Idempotent. Called at server startup (see
 * server/plugins/game-server.ts) so the build retains the whole chain. Safe to
 * call repeatedly — the per-hero self-registration runs too, this just makes the
 * dependency explicit so the bundler can't drop it.
 */
export function registerAllHeroes(): void {
  if (registered) return
  for (const [id, { ability, passive }] of Object.entries(HERO_RESOLVERS)) {
    registerHero(id, ability, passive)
  }
  registered = true
}

// Eagerly register on import too — covers any consumer (e.g. unit tests) that
// imports the barrel without going through the plugin startup path.
registerAllHeroes()

export * from './_base'
export { TALENT_TREES } from '~~/shared/constants/talents'
