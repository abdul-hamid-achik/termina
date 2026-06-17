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
  playerAlive: boolean
  timeOfDay: 'day' | 'night'
  wardKey: string
  towerKey: string
  teammateKey: string
}

const visionCache = new Map<string, VisionCacheEntry>()

/** Cap on cache size — evicts oldest entries when exceeded. */
const VISION_CACHE_MAX = 256

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

export function calculateVision(state: GameState, playerId: string): Set<string> {
  const player = state.players[playerId]
  if (!player) return new Set()

  const team = player.team
  const wardKey = buildWardKey(state, team)
  const towerKey = buildTowerKey(state, team)
  const teammateKey = buildTeammateKey(state, team, playerId)
  const timeOfDay = state.timeOfDay

  const cached = visionCache.get(playerId)
  if (
    cached &&
    cached.playerZone === player.zone &&
    cached.playerAlive === player.alive &&
    cached.timeOfDay === timeOfDay &&
    cached.wardKey === wardKey &&
    cached.towerKey === towerKey &&
    cached.teammateKey === teammateKey
  ) {
    return cached.vision
  }

  const vision = calculateVisionUncached(state, player, team)

  // Bounded LRU-ish: re-set moves the key to the most-recent insertion order.
  // When over the cap, drop the oldest insertion.
  if (visionCache.size >= VISION_CACHE_MAX && !visionCache.has(playerId)) {
    const oldest = visionCache.keys().next().value
    if (oldest !== undefined) visionCache.delete(oldest)
  }
  visionCache.delete(playerId)
  visionCache.set(playerId, {
    vision,
    playerZone: player.zone,
    playerAlive: player.alive,
    timeOfDay,
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
  // Own zone is ALWAYS visible, even at night. (ADJACENT_CACHE stores
  // [...adjacentTo, zoneId] with zoneId last, so the old night `slice` lopped
  // the own zone off — a hero would go blind in its own zone at night.)
  visible.add(zoneId)
  const adjacent = ADJACENT_CACHE.get(zoneId)
  if (!adjacent) return
  const neighbors = adjacent.filter((z) => z !== zoneId)
  const zonesToAdd = isNight
    ? neighbors.slice(0, Math.max(0, neighbors.length - NIGHT_VISION_PENALTY))
    : neighbors
  for (const zone of zonesToAdd) {
    visible.add(zone)
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
  // `includes('invis')` covers invisible / invis / silver_edge_invis (Silver
  // Edge previously granted no stealth because its id matched none of the
  // exact checks); smoke = Smoke of Deceit.
  return player.buffs.some((b) => b.id.includes('invis') || b.id === 'stealth' || b.id === 'smoke')
}

/**
 * True when the player carries a 'revealed' buff applied by a member of the
 * viewing team. A reveal pierces fog AND invisibility/stealth for that team.
 */
function isRevealedToTeam(player: PlayerState, state: GameState, team: TeamId): boolean {
  return player.buffs.some((b) => b.id === 'revealed' && state.players[b.source]?.team === team)
}

/**
 * Build a `PlayerVisibleState` for a spectator — same shape as
 * `filterStateForPlayer` but with no fog applied. All players, zones,
 * creeps, and events are exposed. Reuses the player-state shape so the
 * existing renderer can consume it without changes.
 */
export function filterStateForSpectator(state: GameState): PlayerVisibleState {
  return {
    tick: state.tick,
    phase: state.phase,
    teams: state.teams,
    players: { ...state.players },
    zones: { ...state.zones },
    creeps: state.creeps,
    neutrals: state.neutrals ?? [],
    towers: state.towers,
    ancients: state.ancients,
    runes: state.runes ?? [],
    roshan: state.roshan,
    aegis: state.aegis,
    events: state.events,
    visibleZones: Object.keys(state.zones),
    timeOfDay: state.timeOfDay,
    dayNightTick: state.dayNightTick,
    mapId: state.mapId,
    mode: state.mode,
  }
}

/**
 * Filter the full game state to what a specific player can see.
 * NEVER leaks information about fogged zones.
 */
export function filterStateForPlayer(state: GameState, playerId: string): PlayerVisibleState {
  let visible = calculateVision(state, playerId)
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
      ancients: state.ancients,
      runes: state.runes ?? [],
      roshan: state.roshan,
      aegis: state.aegis,
      events: [],
      visibleZones: [],
      timeOfDay: state.timeOfDay,
      dayNightTick: state.dayNightTick,
      mapId: state.mapId,
      mode: state.mode,
    }
  }

  const team = player.team
  const trueSightZones = getZonesWithTrueSight(state, team)

  // Enemies revealed by the viewer's team are rendered unfogged and their
  // zones added to the visible set. Copy before mutating — the vision set is
  // shared via cache and must not be poisoned with transient reveal zones.
  const revealedEnemies = new Set<string>()
  for (const [pid, p] of Object.entries(state.players)) {
    if (p.team !== team && p.alive && isRevealedToTeam(p, state, team)) {
      revealedEnemies.add(pid)
      if (!visible.has(p.zone)) {
        visible = new Set(visible)
        visible.add(p.zone)
      }
    }
  }

  const filteredPlayers: Record<string, PlayerState | FoggedPlayer> = {}
  for (const [pid, p] of Object.entries(state.players)) {
    if (p.team === team) {
      filteredPlayers[pid] = p
    } else if (visible.has(p.zone) && p.alive) {
      // 'revealed' overrides invisibility/stealth
      if (isInvisible(p) && !trueSightZones.has(p.zone) && !revealedEnemies.has(pid)) {
        filteredPlayers[pid] = {
          id: p.id,
          name: p.name,
          team: p.team,
          heroId: p.heroId,
          level: p.level,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
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
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        alive: p.alive,
        fogged: true,
      }
    }
  }

  // Filter zones: only include visible zone states
  const filteredZones: Record<string, ZoneRuntimeState> = {}
  for (const [zoneId, zs] of Object.entries(state.zones)) {
    // Traps are invisible to the enemy even in a fully-visible zone — only the
    // owning team ever sees its own armed traps.
    const ownTraps = zs.traps?.filter((t) => t.team === team)
    if (visible.has(zoneId)) {
      filteredZones[zoneId] = zs.traps ? { ...zs, traps: ownTraps } : zs
    } else {
      // Show zone exists but strip wards and creep details for enemy info
      filteredZones[zoneId] = {
        id: zs.id,
        wards: zs.wards.filter((w) => w.team === team), // Only show own wards
        creeps: [], // Don't reveal enemy creep positions in fog
        ...(zs.traps ? { traps: ownTraps } : {}),
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
    ancients: state.ancients, // Ancients are always visible (global info)
    runes: state.runes ?? [],
    roshan: state.roshan,
    aegis: state.aegis,
    events: filteredEvents,
    visibleZones: [...visible],
    timeOfDay: state.timeOfDay,
    dayNightTick: state.dayNightTick,
    mapId: state.mapId,
    mode: state.mode,
  }
}
