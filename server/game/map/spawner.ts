import type { WaveUnitState } from '~~/shared/types/game'
import {
  WAVE_INTERVAL_CYCLES,
  LINE_UNITS_PER_WAVE,
  SWEEP_UNITS_PER_WAVE,
  BREACH_WAVE_INTERVAL,
  waveUnitMaxHp,
  TENANT_RESPAWN_CYCLES,
  TENANT_BASE_HP,
  TENANT_HP_PER_MINUTE,
  CYCLE_DURATION_MS,
  CACHE_INTERVAL_CYCLES,
} from '~~/shared/constants/balance'

let waveIdCounter = 0

function nextWaveId(): string {
  return `wave-${++waveIdCounter}`
}

/** Reset the ID counter (useful for tests). */
export function resetWaveIdCounter(): void {
  waveIdCounter = 0
}

/** Lane spawn points for each team. */
const LANE_SPAWN_ZONES: Record<string, { chaff: string; audit: string }> = {
  seawall: { chaff: 'seawall-t3-chaff', audit: 'seawall-t3-audit' },
  coldstore: { chaff: 'coldstore-t3-chaff', audit: 'coldstore-t3-audit' },
  shallows: { chaff: 'shallows-t3-chaff', audit: 'shallows-t3-audit' },
}

/**
 * Spawn a wave of waves for one team on one lane. Throws on unknown lane.
 * `cycle` fixes the wave's escalation tier: waves keep the INTEG they spawned
 * with for life, so a late wave is permanently tougher than an early one.
 */
function spawnWave(
  team: 'chaff' | 'audit',
  lane: string,
  waveNumber: number,
  cycle: number,
): WaveUnitState[] {
  const spawnZone = LANE_SPAWN_ZONES[lane]
  if (!spawnZone) {
    throw new Error(`spawnWave: unknown lane '${lane}' — expected one of top/mid/bot`)
  }
  const zone = spawnZone[team]
  const waves: WaveUnitState[] = []

  // Stamp maxInteg at spawn: this wave keeps this max for life, so anything
  // reasoning about a fraction of full health stays correct after the wave
  // outlives an escalation boundary.
  const line = waveUnitMaxHp('line', cycle)
  for (let i = 0; i < LINE_UNITS_PER_WAVE; i++) {
    waves.push({ id: nextWaveId(), team, zone, integ: line, maxInteg: line, type: 'line' })
  }
  const sweep = waveUnitMaxHp('sweep', cycle)
  for (let i = 0; i < SWEEP_UNITS_PER_WAVE; i++) {
    waves.push({ id: nextWaveId(), team, zone, integ: sweep, maxInteg: sweep, type: 'sweep' })
  }
  if (waveNumber > 0 && waveNumber % BREACH_WAVE_INTERVAL === 0) {
    const breach = waveUnitMaxHp('breach', cycle)
    waves.push({ id: nextWaveId(), team, zone, integ: breach, maxInteg: breach, type: 'breach' })
  }

  return waves
}

/**
 * Spawn waves if the current cycle is a wave cycle. Returns new waves to add.
 * `hasZone` (the game's live zone set) gates lanes to the current map — a subset
 * map like one-lane only has its lanes' spawn zones, so top/bot are skipped.
 * Omitted = full map (all three lanes).
 */
export function spawnWaveUnits(
  cycle: number,
  hasZone?: (zoneId: string) => boolean,
): WaveUnitState[] {
  if (cycle === 0 || cycle % WAVE_INTERVAL_CYCLES !== 0) return []

  const waveNumber = cycle / WAVE_INTERVAL_CYCLES
  const newWaves: WaveUnitState[] = []

  for (const lane of ['seawall', 'coldstore', 'shallows']) {
    const spawn = LANE_SPAWN_ZONES[lane]
    if (hasZone && spawn && (!hasZone(spawn.chaff) || !hasZone(spawn.audit))) continue
    newWaves.push(...spawnWave('chaff', lane, waveNumber, cycle))
    newWaves.push(...spawnWave('audit', lane, waveNumber, cycle))
  }

  return newWaves
}

/** Cache spawn state. */
export interface CacheSpawn {
  zone: string
  type: 'haste' | 'dd' | 'regen' | 'arcane' | 'invis'
  cycle: number
}

const CACHE_TYPES = ['haste', 'dd', 'regen', 'arcane', 'invis'] as const

/** Spawn caches if the current cycle is a cache cycle. `hasZone` skips cache spots a
 *  subset map doesn't have (one-lane has no river caches). `activeCaches` prevents
 *  re-spawning a cache on an occupied spot (defensive — the timing invariant
 *  should prevent this, but occupancy check avoids stacking). */
export function spawnCaches(
  cycle: number,
  hasZone?: (zoneId: string) => boolean,
  activeCaches?: Set<string>,
  rng: () => number = Math.random,
): CacheSpawn[] {
  if (cycle === 0 || cycle % CACHE_INTERVAL_CYCLES !== 0) return []

  const caches: CacheSpawn[] = []
  for (const zone of ['cache-seawall', 'cache-shallows']) {
    if (hasZone && !hasZone(zone)) continue
    if (activeCaches && activeCaches.has(zone)) continue // spot already occupied
    const type = CACHE_TYPES[Math.floor(rng() * CACHE_TYPES.length)]!
    caches.push({ zone, type, cycle })
  }
  return caches
}

/** Tenant tracking state. */
export interface TenantState {
  alive: boolean
  integ: number
  maxInteg: number
  deathCycle: number | null
}

/** Initialize Tenant at cycle 0. */
export function initializeTenant(): TenantState {
  return {
    alive: true,
    integ: TENANT_BASE_HP,
    maxInteg: TENANT_BASE_HP,
    deathCycle: null,
  }
}

/** Check if Tenant should respawn. */
export function shouldTenantRespawn(tenant: TenantState, currentCycle: number): boolean {
  if (tenant.alive) return false
  if (tenant.deathCycle === null) return false
  return currentCycle - tenant.deathCycle >= TENANT_RESPAWN_CYCLES
}

/** Respawn Tenant with increased INTEG (+TENANT_HP_PER_MINUTE per game minute elapsed). */
export function respawnTenant(tenant: TenantState, currentCycle: number): TenantState {
  const minutesElapsed = Math.floor((currentCycle * CYCLE_DURATION_MS) / 60_000)
  const scaledMaxHp = TENANT_BASE_HP + minutesElapsed * TENANT_HP_PER_MINUTE
  return {
    alive: true,
    integ: scaledMaxHp,
    maxInteg: scaledMaxHp,
    deathCycle: null,
  }
}
