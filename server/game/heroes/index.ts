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
  cache: { ability: cacheAbility, passive: cachePassive, events: ['damage_taken'] as const },
  cipher: { ability: cipherAbility, passive: cipherPassive, events: ['attack'] as const },
  cron: { ability: cronAbility, passive: cronPassive, events: ['tick_end'] as const },
  daemon: {
    ability: daemonAbility,
    passive: daemonPassive,
    events: ['attack', 'ability_cast', 'item_used', 'damage_taken', 'tick_end'] as const,
  },
  echo: { ability: echoAbility, passive: echoPassive, events: ['attack'] as const },
  firewall: {
    ability: firewallAbility,
    passive: firewallPassive,
    // tick_end keeps the permanent packetInspection buff marker applied; without
    // it the buff — and the first-hit reflect its ensure-block guards — only
    // appears after firewall has already taken damage.
    events: ['damage_taken', 'tick_end'] as const,
  },
  kernel: { ability: kernelAbility, passive: kernelPassive, events: ['tick_end'] as const },
  lambda: { ability: lambdaAbility, passive: lambdaPassive, events: ['ability_cast'] as const },
  malloc: { ability: mallocAbility, passive: mallocPassive, events: ['tick_end'] as const },
  mutex: { ability: mutexAbility, passive: mutexPassive, events: ['move', 'tick_end'] as const },
  null_ref: { ability: nullRefAbility, passive: nullRefPassive, events: ['kill'] as const },
  ping: { ability: pingAbility, passive: pingPassive, events: ['attack'] as const },
  proxy: {
    ability: proxyAbility,
    passive: proxyPassive,
    // tick_end keeps the permanent middleman marker buff applied (the redirect
    // itself reacts to damage_taken); without it the UI marker only appears
    // after the first damage event in the game. Same pattern as firewall.
    events: ['damage_taken', 'tick_end'] as const,
  },
  regex: { ability: regexAbility, passive: regexPassive, events: ['ability_cast'] as const },
  sentry: { ability: sentryAbility, passive: sentryPassive, events: ['tick_end'] as const },
  socket: { ability: socketAbility, passive: socketPassive, events: ['attack'] as const },
  thread: { ability: threadAbility, passive: threadPassive, events: ['attack'] as const },
  traceroute: { ability: tracerouteAbility, passive: traceroutePassive, events: ['move'] as const },
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
  for (const [id, { ability, passive, events }] of Object.entries(HERO_RESOLVERS)) {
    registerHero(id, ability, passive, [...events])
  }
  registered = true
}

// Eagerly register on import too — covers any consumer (e.g. unit tests) that
// imports the barrel without going through the plugin startup path.
registerAllHeroes()

export * from './_base'
export { TALENT_TREES, getTalentTree } from '~~/shared/constants/talents'
