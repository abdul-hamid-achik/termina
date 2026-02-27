import type { ZoneRuntimeState, WardState, TowerState, TeamId } from '~~/shared/types/game'
import { ZONES } from '~~/shared/constants/zones'
import {
  TOWER_HP_T1,
  TOWER_HP_T2,
  TOWER_HP_T3,
  WARD_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
} from '~~/shared/constants/balance'

/** Determine tower tier from zone ID. Returns 0 if no tower. */
function getTowerTier(zoneId: string): number {
  if (zoneId.includes('-t1-')) return 1
  if (zoneId.includes('-t2-')) return 2
  if (zoneId.includes('-t3-')) return 3
  return 0
}

/** Get tower max HP by tier. */
function getTowerMaxHp(tier: number): number {
  switch (tier) {
    case 1: return TOWER_HP_T1
    case 2: return TOWER_HP_T2
    case 3: return TOWER_HP_T3
    default: return 0
  }
}

/** Initialize all zone runtime states from the static zone graph. */
export function initializeZoneStates(): Record<string, ZoneRuntimeState> {
  const states: Record<string, ZoneRuntimeState> = {}
  for (const zone of ZONES) {
    states[zone.id] = {
      id: zone.id,
      wards: [],
      creeps: [],
    }
  }
  return states
}

/** Build the initial tower list from the zone graph. */
export function initializeTowers(): TowerState[] {
  const towers: TowerState[] = []
  for (const zone of ZONES) {
    if (!zone.tower) continue
    const tier = getTowerTier(zone.id)
    const maxHp = getTowerMaxHp(tier)
    towers.push({
      team: zone.team as TeamId,
      zone: zone.id,
      hp: maxHp,
      maxHp,
      alive: true,
    })
  }
  return towers
}

/** Place a ward in a zone. Returns false if the team has reached the ward limit. */
export function placeWard(
  zones: Record<string, ZoneRuntimeState>,
  zoneId: string,
  team: TeamId,
  currentTick: number,
): boolean {
  // Count existing wards for this team
  let teamWardCount = 0
  for (const zrs of Object.values(zones)) {
    teamWardCount += zrs.wards.filter((w) => w.team === team).length
  }
  if (teamWardCount >= WARD_LIMIT_PER_TEAM) return false

  const zoneState = zones[zoneId]
  if (!zoneState) return false

  const ward: WardState = {
    team,
    placedTick: currentTick,
    expiryTick: currentTick + WARD_DURATION_TICKS,
  }
  zoneState.wards.push(ward)
  return true
}

/** Remove expired wards from all zones. */
export function removeExpiredWards(
  zones: Record<string, ZoneRuntimeState>,
  currentTick: number,
): void {
  for (const zrs of Object.values(zones)) {
    zrs.wards = zrs.wards.filter((w) => w.expiryTick > currentTick)
  }
}

/** Check if a tower at a zone can be attacked (preceding tower must be destroyed). */
export function canAttackTower(towers: TowerState[], zoneId: string): boolean {
  const tower = towers.find((t) => t.zone === zoneId && t.alive)
  if (!tower) return false

  const tier = getTowerTier(zoneId)
  if (tier <= 1) return true // T1 can always be attacked

  // Determine the lane and team from the zone ID
  const lane = zoneId.startsWith('top-') ? 'top' : zoneId.startsWith('mid-') ? 'mid' : 'bot'
  const team = tower.team
  const precedingTier = tier - 1
  const precedingZoneId = `${lane}-t${precedingTier}-${team === 'radiant' ? 'rad' : 'dire'}`

  const precedingTower = towers.find((t) => t.zone === precedingZoneId)
  return !precedingTower || !precedingTower.alive
}
