import type {
  GameState,
  PlayerState,
  ZoneRuntimeState,
  FoggedPlayer,
  PlayerVisibleState,
} from '~~/shared/types/game'
import { getAdjacentZones } from '../map/topology'

export type { FoggedPlayer, PlayerVisibleState }

/**
 * Calculate the set of zone IDs visible to a given player.
 *
 * Vision sources:
 * 1. Current zone + adjacent zones (base vision)
 * 2. Ward zones + adjacent zones (team wards)
 * 3. Standing (alive) tower zones + adjacent zones (team towers)
 * 4. Zones granted by abilities (buffs with reveal)
 */
export function calculateVision(state: GameState, playerId: string): Set<string> {
  const player = state.players[playerId]
  if (!player) return new Set()

  const visible = new Set<string>()
  const team = player.team

  // 1. Base vision: current zone + adjacent
  if (player.alive) {
    addZoneWithAdjacent(visible, player.zone)
  }

  // Always see your own base/fountain
  const baseZone = team === 'radiant' ? 'radiant-base' : 'dire-base'
  const fountainZone = team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
  addZoneWithAdjacent(visible, baseZone)
  addZoneWithAdjacent(visible, fountainZone)

  // 2. Ward vision: team wards grant vision of their zone + adjacent
  for (const zoneState of Object.values(state.zones)) {
    for (const ward of zoneState.wards) {
      if (ward.team === team) {
        addZoneWithAdjacent(visible, zoneState.id)
      }
    }
  }

  // 3. Tower vision: alive team towers grant vision of their zone + adjacent
  for (const tower of state.towers) {
    if (tower.team === team && tower.alive) {
      addZoneWithAdjacent(visible, tower.zone)
    }
  }

  // 4. Allied hero vision (all alive teammates)
  for (const p of Object.values(state.players)) {
    if (p.team === team && p.alive && p.id !== playerId) {
      addZoneWithAdjacent(visible, p.zone)
    }
  }

  return visible
}

/** Add a zone and its adjacent zones to the visibility set. */
function addZoneWithAdjacent(visible: Set<string>, zoneId: string): void {
  visible.add(zoneId)
  for (const adj of getAdjacentZones(zoneId)) {
    visible.add(adj)
  }
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
      towers: state.towers, // Tower states are public (you can see HP bars)
      events: [],
      visibleZones: [],
    }
  }

  const team = player.team

  // Filter players: show full info for teammates + visible enemies; fog the rest
  const filteredPlayers: Record<string, PlayerState | FoggedPlayer> = {}
  for (const [pid, p] of Object.entries(state.players)) {
    if (p.team === team) {
      // Always show full teammate info
      filteredPlayers[pid] = p
    } else if (visible.has(p.zone) && p.alive) {
      // Enemy in a visible zone — show full info
      filteredPlayers[pid] = p
    } else {
      // Fogged enemy — only show minimal info
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
    towers: state.towers, // Towers are always visible (global info)
    events: filteredEvents,
    visibleZones: [...visible],
  }
}
