import type { ZoneRuntimeState, WardState, IceState, TeamId } from '~~/shared/types/game'
import type { Zone } from '~~/shared/types/map'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import {
  ICE_HP_T1,
  ICE_HP_T2,
  ICE_HP_T3,
  CAMTAP_DURATION_TICKS,
  SNIFFER_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
} from '~~/shared/constants/balance'
import { scaledIceHp } from '~~/server/game/engine/fastGame'

/** Determine ice tier from a zone. Returns 0 if the zone has no ice or tier is unset. */
function getIceTier(zoneId: string): number {
  const zone = ZONE_MAP[zoneId]
  return zone?.tier ?? 0
}

/** Get ice max HP by tier. */
function getIceMaxHp(tier: number): number {
  // scaledIceHp is a no-op unless the dev/test-only TERMINA_TEST_FAST_GAME
  // accelerator is active — see ../engine/fastGame.ts.
  switch (tier) {
    case 1:
      return scaledIceHp(ICE_HP_T1)
    case 2:
      return scaledIceHp(ICE_HP_T2)
    case 3:
      return scaledIceHp(ICE_HP_T3)
    default:
      return 0
  }
}

/** Initialize all zone runtime states from a zone graph (the full map by default). */
export function initializeZoneStates(
  zones: readonly Zone[] = ZONES,
): Record<string, ZoneRuntimeState> {
  const states: Record<string, ZoneRuntimeState> = {}
  for (const zone of zones) {
    states[zone.id] = {
      id: zone.id,
      wards: [],
      creeps: [],
    }
  }
  return states
}

/** Build the initial ice list from a zone graph (the full map by default). */
export function initializeIce(zones: readonly Zone[] = ZONES): IceState[] {
  const ice: IceState[] = []
  for (const zone of zones) {
    if (!zone.ice) continue
    if (zone.team === 'neutral') continue // neutral zones don't have ice
    const tier = zone.tier ?? getIceTier(zone.id)
    const maxHp = getIceMaxHp(tier)
    ice.push({
      team: zone.team,
      zone: zone.id,
      hp: maxHp,
      maxHp,
      alive: true,
      invulnerable: false,
    })
  }
  return ice
}

/** Place a ward in a zone. Returns false if the team has reached the ward limit. */
export function placeWard(
  zones: Record<string, ZoneRuntimeState>,
  zoneId: string,
  team: TeamId,
  currentTick: number,
  wardType: 'camtap' | 'sniffer' = 'camtap',
): boolean {
  let teamWardCount = 0
  for (const zrs of Object.values(zones)) {
    teamWardCount += zrs.wards.filter((w) => w.team === team).length
  }
  if (teamWardCount >= WARD_LIMIT_PER_TEAM) return false

  const zoneState = zones[zoneId]
  if (!zoneState) return false

  const duration = wardType === 'camtap' ? CAMTAP_DURATION_TICKS : SNIFFER_DURATION_TICKS

  const ward: WardState = {
    team,
    placedTick: currentTick,
    expiryTick: currentTick + duration,
    type: wardType,
  }
  zones[zoneId] = { ...zoneState, wards: [...zoneState.wards, ward] }
  return true
}

/** Remove expired wards from all zones. Returns a new zones record. */
export function removeExpiredWards(
  zones: Record<string, ZoneRuntimeState>,
  currentTick: number,
): Record<string, ZoneRuntimeState> {
  let changed = false
  const updated: Record<string, ZoneRuntimeState> = {}
  for (const [id, zrs] of Object.entries(zones)) {
    const filtered = zrs.wards.filter((w) => w.expiryTick > currentTick)
    if (filtered.length !== zrs.wards.length) {
      updated[id] = { ...zrs, wards: filtered }
      changed = true
    } else {
      updated[id] = zrs
    }
  }
  return changed ? updated : zones
}

/** Check if a ice at a zone can be attacked (preceding ice must be destroyed). */
export function canAttackIce(ice: IceState[], zoneId: string): boolean {
  const target = ice.find((t) => t.zone === zoneId && t.alive)
  if (!target) return false

  const zone = ZONE_MAP[zoneId]
  const tier = zone?.tier ?? getIceTier(zoneId)
  if (tier <= 1) return true // T1 can always be attacked

  // Determine the lane and team from the explicit zone fields (fall back to id parse for safety)
  const lane =
    zone?.lane ?? (zoneId.startsWith('top-') ? 'top' : zoneId.startsWith('mid-') ? 'mid' : 'bot')
  const team = target.team
  const precedingTier = tier - 1
  const precedingZoneId = `${lane}-t${precedingTier}-${team}`

  const precedingIce = ice.find((t) => t.zone === precedingZoneId)
  return !precedingIce || !precedingIce.alive
}
