import type {
  GameState,
  PlayerState,
  ZoneRuntimeState,
  FoggedPlayer,
  PlayerVisibleState,
  TeamId,
} from '~~/shared/types/game'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { SENTRY_WARD_TRUE_SIGHT_RADIUS, NIGHT_VISION_PENALTY } from '~~/shared/constants/balance'

export type { FoggedPlayer, PlayerVisibleState }

const ADJACENT_CACHE = new Map<string, string[]>()

for (const [zoneId, zoneData] of Object.entries(ZONE_MAP)) {
  ADJACENT_CACHE.set(zoneId, [...zoneData.adjacentTo, zoneId])
}

interface VisionCacheEntry {
  vision: Set<string>
  playerZone: string
  wardKey: string
  towerKey: string
  teammateKey: string
}

const visionCache = new Map<string, VisionCacheEntry>()

function buildWardKey(state: GameState, team: TeamId): string {
  const wards: string[] = []
  for (const [zoneId, zone] of Object.entries(state.zones)) {
    for (const ward of zone.wards) {
      if (ward.team === team) {
        wards.push(`${zoneId}:${ward.expiryTick}`)
      }
    }
  }
  return wards.sort().join(',')
}

function buildTowerKey(state: GameState, team: TeamId): string {
  return state.towers
    .filter((t) => t.team === team && t.alive)
    .map((t) => t.zone)
    .sort()
    .join(',')
}

function buildTeammateKey(state: GameState, team: TeamId, excludePlayerId: string): string {
  return Object.entries(state.players)
    .filter(([id, p]) => p.team === team && id !== excludePlayerId && p.alive)
    .map(([id, p]) => `${id}:${p.zone}`)
    .sort()
    .join(',')
}

export function invalidateVisionCache(playerId?: string): void {
  if (playerId) {
    visionCache.delete(playerId)
  } else {
    visionCache.clear()
  }
}

export function calculateVision(state: GameState, playerId: string): Set<string> {
  const player = state.players[playerId]
  if (!player) return new Set()

  const team = player.team
  const wardKey = buildWardKey(state, team)
  const towerKey = buildTowerKey(state, team)
  const teammateKey = buildTeammateKey(state, team, playerId)

  const cached = visionCache.get(playerId)
  if (
    cached &&
    cached.playerZone === player.zone &&
    cached.wardKey === wardKey &&
    cached.towerKey === towerKey &&
    cached.teammateKey === teammateKey
  ) {
    return cached.vision
  }

  const vision = calculateVisionUncached(state, player, team)
  visionCache.set(playerId, {
    vision,
    playerZone: player.zone,
    wardKey,
    towerKey,
    teammateKey,
  })

  return vision
}

function calculateVisionUncached(state: GameState, player: PlayerState, team: TeamId): Set<string> {
  const visible = new Set<string>()
  const isNight = state.timeOfDay === 'night'

  if (player.alive) {
    addZoneWithAdjacent(visible, player.zone, isNight)
  }

  const baseZone = team === 'radiant' ? 'radiant-base' : 'dire-base'
  const fountainZone = team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
  addZoneWithAdjacent(visible, baseZone, isNight)
  addZoneWithAdjacent(visible, fountainZone, isNight)

  for (const zoneState of Object.values(state.zones)) {
    for (const ward of zoneState.wards) {
      if (ward.team === team) {
        addZoneWithAdjacent(visible, zoneState.id, isNight)
      }
    }
  }

  for (const tower of state.towers) {
    if (tower.team === team && tower.alive) {
      addZoneWithAdjacent(visible, tower.zone, isNight)
    }
  }

  for (const p of Object.values(state.players)) {
    if (p.team === team && p.alive && p.id !== player.id) {
      addZoneWithAdjacent(visible, p.zone, isNight)
    }
  }

  return visible
}

function addZoneWithAdjacent(visible: Set<string>, zoneId: string, isNight: boolean = false): void {
  const adjacent = ADJACENT_CACHE.get(zoneId)
  if (adjacent) {
    const zonesToAdd = isNight
      ? adjacent.slice(0, Math.max(1, adjacent.length - NIGHT_VISION_PENALTY))
      : adjacent
    for (const zone of zonesToAdd) {
      visible.add(zone)
    }
  } else {
    visible.add(zoneId)
  }
}

function getZonesWithTrueSight(state: GameState, team: TeamId): Set<string> {
  const trueSightZones = new Set<string>()

  for (const zoneState of Object.values(state.zones)) {
    for (const ward of zoneState.wards) {
      if (ward.team === team && ward.type === 'sentry') {
        trueSightZones.add(zoneState.id)
        if (SENTRY_WARD_TRUE_SIGHT_RADIUS >= 1) {
          const adjacent = ADJACENT_CACHE.get(zoneState.id)
          if (adjacent) {
            for (const z of adjacent) {
              trueSightZones.add(z)
            }
          }
        }
      }
    }
  }

  return trueSightZones
}

function isInvisible(player: PlayerState): boolean {
  return player.buffs.some((b) => b.id.includes('invisible') || b.id === 'invis')
}

/**
 * Filter the full game state to what a specific player can see.
 * NEVER leaks information about fogged zones.
 */
export function filterStateForPlayer(state: GameState, playerId: string): PlayerVisibleState {
  const visible = calculateVision(state, playerId)
  const player = state.players[playerId]
  if (!player) {
    return {
      tick: state.tick,
      phase: state.phase,
      teams: state.teams,
      players: {},
      zones: {},
      creeps: [],
      neutrals: [],
      towers: state.towers,
      runes: state.runes ?? [],
      roshan: state.roshan,
      aegis: state.aegis,
      events: [],
      visibleZones: [],
      timeOfDay: state.timeOfDay,
      dayNightTick: state.dayNightTick,
    }
  }

  const team = player.team
  const trueSightZones = getZonesWithTrueSight(state, team)

  const filteredPlayers: Record<string, PlayerState | FoggedPlayer> = {}
  for (const [pid, p] of Object.entries(state.players)) {
    if (p.team === team) {
      filteredPlayers[pid] = p
    } else if (visible.has(p.zone) && p.alive) {
      if (isInvisible(p) && !trueSightZones.has(p.zone)) {
        filteredPlayers[pid] = {
          id: p.id,
          name: p.name,
          team: p.team,
          heroId: p.heroId,
          level: p.level,
          alive: p.alive,
          fogged: true,
        }
      } else {
        filteredPlayers[pid] = p
      }
    } else {
      filteredPlayers[pid] = {
        id: p.id,
        name: p.name,
        team: p.team,
        heroId: p.heroId,
        level: p.level,
        alive: p.alive,
        fogged: true,
      }
    }
  }

  // Filter zones: only include visible zone states
  const filteredZones: Record<string, ZoneRuntimeState> = {}
  for (const [zoneId, zs] of Object.entries(state.zones)) {
    if (visible.has(zoneId)) {
      filteredZones[zoneId] = zs
    } else {
      // Show zone exists but strip wards and creep details for enemy info
      filteredZones[zoneId] = {
        id: zs.id,
        wards: zs.wards.filter((w) => w.team === team), // Only show own wards
        creeps: [], // Don't reveal enemy creep positions in fog
      }
    }
  }

  // Filter creeps: only show creeps in visible zones
  const filteredCreeps = state.creeps.filter((c) => visible.has(c.zone))

  // Filter events: only show events relevant to visible zones or the player's team
  const filteredEvents = state.events.filter((e) => {
    // Always show team-relevant events
    if (e.payload['team'] === team) return true
    if (e.payload['playerId'] && state.players[e.payload['playerId'] as string]?.team === team)
      return true
    // Show events in visible zones
    if (e.payload['zone'] && visible.has(e.payload['zone'] as string)) return true
    return false
  })

  return {
    tick: state.tick,
    phase: state.phase,
    teams: state.teams,
    players: filteredPlayers,
    zones: filteredZones,
    creeps: filteredCreeps,
    neutrals: state.neutrals ?? [], // Neutrals are visible in their zones (public info)
    towers: state.towers, // Towers are always visible (global info)
    runes: state.runes ?? [],
    roshan: state.roshan,
    aegis: state.aegis,
    events: filteredEvents,
    visibleZones: [...visible],
    timeOfDay: state.timeOfDay,
    dayNightTick: state.dayNightTick,
  }
}
