import type { GameState, CacheState } from '~~/shared/types/game'
import type { GameEngineEvent, CachePickedEvent } from '~~/server/game/protocol/events'
import {
  CACHE_BUFF_TICKS,
  CACHE_DURATION_TICKS,
  REGEN_CACHE_HEAL_PERCENT,
} from '~~/shared/constants/balance'

/**
 * Get the buff effect for a cache type.
 */
export function getCacheBuff(type: CacheState['type']): {
  id: string
  stacks: number
  ticksRemaining: number
  source: string
} {
  const duration = CACHE_BUFF_TICKS[type]

  switch (type) {
    case 'haste':
      return { id: 'haste', stacks: 1, ticksRemaining: duration, source: 'cache_haste' }
    case 'dd':
      return { id: 'dd', stacks: 1, ticksRemaining: duration, source: 'cache_dd' }
    case 'regen':
      return { id: 'regen', stacks: 1, ticksRemaining: duration, source: 'cache_regen' }
    case 'arcane':
      return { id: 'arcane', stacks: 1, ticksRemaining: duration, source: 'cache_arcane' }
    case 'invis':
      return { id: 'invis', stacks: 1, ticksRemaining: duration, source: 'cache_invis' }
  }
}

/**
 * Apply cache buff effects to a player.
 */
function applyCacheBuff(
  players: GameState['players'],
  playerId: string,
  cacheType: CacheState['type'],
): GameState['players'] {
  const player = players[playerId]
  if (!player) return players

  const buff = getCacheBuff(cacheType)

  return {
    ...players,
    [playerId]: {
      ...player,
      buffs: [...player.buffs, buff],
    },
  }
}

/**
 * Pick up a cache - player must be in the same zone as the cache.
 * Returns the updated state and a cache_picked event; the caller (ActionResolver)
 * merges the event into the tick's allEvents instead of mutating state.events.
 */
export function pickupCache(
  state: GameState,
  playerId: string,
  zone: string,
): { state: GameState; event: GameEngineEvent | null } {
  const player = state.players[playerId]
  if (!player || !player.alive) return { state, event: null }
  if (player.zone !== zone) return { state, event: null }

  // Find cache in this zone (handle undefined caches)
  const caches = state.caches ?? []
  const cacheIndex = caches.findIndex((r) => r.zone === zone)
  if (cacheIndex === -1) return { state, event: null }

  const cache = caches[cacheIndex]!

  // Apply the cache buff to the player
  const players = applyCacheBuff(state.players, playerId, cache.type)

  // Remove the cache from the ground
  const newCaches = caches.filter((_, i) => i !== cacheIndex)

  return {
    state: { ...state, players, caches: newCaches },
    event: {
      _tag: 'cache_picked',
      tick: state.tick,
      playerId,
      zone,
      cacheType: cache.type,
    } satisfies CachePickedEvent,
  }
}

/**
 * Remove expired caches from the map.
 */
export function removeExpiredCaches(state: GameState): GameState {
  // Handle case where caches might be undefined (for old test states)
  const caches = state.caches ?? []
  const currentTick = state.tick
  const activeCaches = caches.filter((cache) => {
    // Cache expires after CACHE_DURATION_TICKS
    return currentTick - cache.tick < CACHE_DURATION_TICKS
  })

  // Also normalize when caches was undefined, so the result always has a caches array.
  if (state.caches === undefined || activeCaches.length !== caches.length) {
    return { ...state, caches: activeCaches }
  }

  return state
}

/**
 * Process per-tick heal-over-time buffs: the regeneration cache and Cron's
 * Crontab (R). Runs every tick in the game loop.
 */
export function processCacheBuffs(state: GameState): GameState {
  const players = { ...state.players }

  for (const [playerId, player] of Object.entries(players)) {
    if (!player.alive) continue

    let integ = player.integ
    let bw = player.bw

    // Check for active cache buffs
    const hasRegen = player.buffs.some((b) => b.id === 'regen')

    // Regeneration cache: REGEN_CACHE_HEAL_PERCENT of max INTEG/MP per tick
    if (hasRegen) {
      integ = Math.min(
        player.maxInteg,
        integ + Math.floor(player.maxInteg * REGEN_CACHE_HEAL_PERCENT),
      )
      bw = Math.min(player.maxBw, bw + Math.floor(player.maxBw * REGEN_CACHE_HEAL_PERCENT))
    }

    // Cron's Crontab (R): heal + BW regen over time on self + allies; the
    // per-tick amounts ride in the buff stacks. (Heal was applied but never
    // processed; the mana half was advertised by the ability but unimplemented.)
    const crontab = player.buffs.find((b) => b.id === 'crontabHeal')
    if (crontab) {
      integ = Math.min(player.maxInteg, integ + crontab.stacks)
    }
    const crontabMana = player.buffs.find((b) => b.id === 'crontabMana')
    if (crontabMana) {
      bw = Math.min(player.maxBw, bw + crontabMana.stacks)
    }

    // Haste cache is handled via movement (can't be rooted/stunned)
    // This is processed in the movement validation

    if (integ !== player.integ || bw !== player.bw) {
      players[playerId] = { ...player, integ, bw }
    }
  }

  return { ...state, players }
}
