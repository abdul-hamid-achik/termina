import type { WaveUnitState } from '~~/shared/types/game'
import {
  WAVE_INTERVAL_TICKS,
  LINE_UNITS_PER_WAVE,
  SWEEP_UNITS_PER_WAVE,
  BREACH_WAVE_INTERVAL,
  waveUnitMaxHp,
  TENANT_RESPAWN_TICKS,
  TENANT_BASE_HP,
  TENANT_HP_PER_MINUTE,
  TICK_DURATION_MS,
  CACHE_INTERVAL_TICKS,
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
  top: { chaff: 'top-t3-chaff', audit: 'top-t3-audit' },
  mid: { chaff: 'mid-t3-chaff', audit: 'mid-t3-audit' },
  bot: { chaff: 'bot-t3-chaff', audit: 'bot-t3-audit' },
}

/**
 * Spawn a wave of waves for one team on one lane. Throws on unknown lane.
 * `tick` fixes the wave's escalation tier: waves keep the INTEG they spawned
 * with for life, so a late wave is permanently tougher than an early one.
 */
function spawnWave(
  team: 'chaff' | 'audit',
  lane: string,
  waveNumber: number,
  tick: number,
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
  const line = waveUnitMaxHp('line', tick)
  for (let i = 0; i < LINE_UNITS_PER_WAVE; i++) {
    waves.push({ id: nextWaveId(), team, zone, integ: line, maxInteg: line, type: 'line' })
  }
  const sweep = waveUnitMaxHp('sweep', tick)
  for (let i = 0; i < SWEEP_UNITS_PER_WAVE; i++) {
    waves.push({ id: nextWaveId(), team, zone, integ: sweep, maxInteg: sweep, type: 'sweep' })
  }
  if (waveNumber > 0 && waveNumber % BREACH_WAVE_INTERVAL === 0) {
    const breach = waveUnitMaxHp('breach', tick)
    waves.push({ id: nextWaveId(), team, zone, integ: breach, maxInteg: breach, type: 'breach' })
  }

  return waves
}

/**
 * Spawn wave waves if the current tick is a wave tick. Returns new waves to add.
 * `hasZone` (the game's live zone set) gates lanes to the current map — a subset
 * map like one-lane only has its lanes' spawn zones, so top/bot are skipped.
 * Omitted = full map (all three lanes).
 */
export function spawnWaveUnits(
  tick: number,
  hasZone?: (zoneId: string) => boolean,
): WaveUnitState[] {
  if (tick === 0 || tick % WAVE_INTERVAL_TICKS !== 0) return []

  const waveNumber = tick / WAVE_INTERVAL_TICKS
  const newWaves: WaveUnitState[] = []

  for (const lane of ['top', 'mid', 'bot']) {
    const spawn = LANE_SPAWN_ZONES[lane]
    if (hasZone && spawn && (!hasZone(spawn.chaff) || !hasZone(spawn.audit))) continue
    newWaves.push(...spawnWave('chaff', lane, waveNumber, tick))
    newWaves.push(...spawnWave('audit', lane, waveNumber, tick))
  }

  return newWaves
}

/** Cache spawn state. */
export interface CacheSpawn {
  zone: string
  type: 'haste' | 'dd' | 'regen' | 'arcane' | 'invis'
  tick: number
}

const CACHE_TYPES = ['haste', 'dd', 'regen', 'arcane', 'invis'] as const

/** Spawn caches if the current tick is a cache tick. `hasZone` skips cache spots a
 *  subset map doesn't have (one-lane has no river caches). `activeCaches` prevents
 *  re-spawning a cache on an occupied spot (defensive — the timing invariant
 *  should prevent this, but occupancy check avoids stacking). */
export function spawnCaches(
  tick: number,
  hasZone?: (zoneId: string) => boolean,
  activeCaches?: Set<string>,
): CacheSpawn[] {
  if (tick === 0 || tick % CACHE_INTERVAL_TICKS !== 0) return []

  const caches: CacheSpawn[] = []
  for (const zone of ['cache-top', 'cache-bot']) {
    if (hasZone && !hasZone(zone)) continue
    if (activeCaches && activeCaches.has(zone)) continue // spot already occupied
    const type = CACHE_TYPES[Math.floor(Math.random() * CACHE_TYPES.length)]!
    caches.push({ zone, type, tick })
  }
  return caches
}

/** Tenant tracking state. */
export interface TenantState {
  alive: boolean
  integ: number
  maxInteg: number
  deathTick: number | null
}

/** Initialize Tenant at tick 0. */
export function initializeTenant(): TenantState {
  return {
    alive: true,
    integ: TENANT_BASE_HP,
    maxInteg: TENANT_BASE_HP,
    deathTick: null,
  }
}

/** Check if Tenant should respawn. */
export function shouldTenantRespawn(tenant: TenantState, currentTick: number): boolean {
  if (tenant.alive) return false
  if (tenant.deathTick === null) return false
  return currentTick - tenant.deathTick >= TENANT_RESPAWN_TICKS
}

/** Respawn Tenant with increased INTEG (+TENANT_HP_PER_MINUTE per game minute elapsed). */
export function respawnTenant(tenant: TenantState, currentTick: number): TenantState {
  const minutesElapsed = Math.floor((currentTick * TICK_DURATION_MS) / 60_000)
  const scaledMaxHp = TENANT_BASE_HP + minutesElapsed * TENANT_HP_PER_MINUTE
  return {
    alive: true,
    integ: scaledMaxHp,
    maxInteg: scaledMaxHp,
    deathTick: null,
  }
}
