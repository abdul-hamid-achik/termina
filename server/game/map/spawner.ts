import type { CreepState } from '~~/shared/types/game'
import {
  CREEP_WAVE_INTERVAL_TICKS,
  MELEE_CREEPS_PER_WAVE,
  RANGED_CREEPS_PER_WAVE,
  SIEGE_CREEP_WAVE_INTERVAL,
  MELEE_CREEP_HP,
  RANGED_CREEP_HP,
  SIEGE_CREEP_HP,
  ROSHAN_RESPAWN_TICKS,
  ROSHAN_BASE_HP,
  ROSHAN_HP_PER_MINUTE,
  TICK_DURATION_MS,
  RUNE_INTERVAL_TICKS,
} from '~~/shared/constants/balance'

let creepIdCounter = 0

function nextCreepId(): string {
  return `creep-${++creepIdCounter}`
}

/** Reset the ID counter (useful for tests). */
export function resetCreepIdCounter(): void {
  creepIdCounter = 0
}

/** Lane spawn points for each team. */
const LANE_SPAWN_ZONES: Record<string, { radiant: string; dire: string }> = {
  top: { radiant: 'top-t3-rad', dire: 'top-t3-dire' },
  mid: { radiant: 'mid-t3-rad', dire: 'mid-t3-dire' },
  bot: { radiant: 'bot-t3-rad', dire: 'bot-t3-dire' },
}

/** Spawn a wave of creeps for one team on one lane. Throws on unknown lane. */
function spawnWave(team: 'radiant' | 'dire', lane: string, waveNumber: number): CreepState[] {
  const spawnZone = LANE_SPAWN_ZONES[lane]
  if (!spawnZone) {
    throw new Error(`spawnWave: unknown lane '${lane}' — expected one of top/mid/bot`)
  }
  const zone = spawnZone[team]
  const creeps: CreepState[] = []

  for (let i = 0; i < MELEE_CREEPS_PER_WAVE; i++) {
    creeps.push({ id: nextCreepId(), team, zone, hp: MELEE_CREEP_HP, type: 'melee' })
  }
  for (let i = 0; i < RANGED_CREEPS_PER_WAVE; i++) {
    creeps.push({ id: nextCreepId(), team, zone, hp: RANGED_CREEP_HP, type: 'ranged' })
  }
  if (waveNumber > 0 && waveNumber % SIEGE_CREEP_WAVE_INTERVAL === 0) {
    creeps.push({ id: nextCreepId(), team, zone, hp: SIEGE_CREEP_HP, type: 'siege' })
  }

  return creeps
}

/**
 * Spawn creep waves if the current tick is a wave tick. Returns new creeps to add.
 * `hasZone` (the game's live zone set) gates lanes to the current map — a subset
 * map like one-lane only has its lanes' spawn zones, so top/bot are skipped.
 * Omitted = full map (all three lanes).
 */
export function spawnCreepWaves(tick: number, hasZone?: (zoneId: string) => boolean): CreepState[] {
  if (tick === 0 || tick % CREEP_WAVE_INTERVAL_TICKS !== 0) return []

  const waveNumber = tick / CREEP_WAVE_INTERVAL_TICKS
  const newCreeps: CreepState[] = []

  for (const lane of ['top', 'mid', 'bot']) {
    const spawn = LANE_SPAWN_ZONES[lane]
    if (hasZone && spawn && (!hasZone(spawn.radiant) || !hasZone(spawn.dire))) continue
    newCreeps.push(...spawnWave('radiant', lane, waveNumber))
    newCreeps.push(...spawnWave('dire', lane, waveNumber))
  }

  return newCreeps
}

/** Rune spawn state. */
export interface RuneSpawn {
  zone: string
  type: 'haste' | 'dd' | 'regen' | 'arcane' | 'invis'
  tick: number
}

const RUNE_TYPES = ['haste', 'dd', 'regen', 'arcane', 'invis'] as const

/** Spawn runes if the current tick is a rune tick. `hasZone` skips rune spots a
 *  subset map doesn't have (one-lane has no river runes). `activeRunes` prevents
 *  re-spawning a rune on an occupied spot (defensive — the timing invariant
 *  should prevent this, but occupancy check avoids stacking). */
export function spawnRunes(
  tick: number,
  hasZone?: (zoneId: string) => boolean,
  activeRunes?: Set<string>,
): RuneSpawn[] {
  if (tick === 0 || tick % RUNE_INTERVAL_TICKS !== 0) return []

  const runes: RuneSpawn[] = []
  for (const zone of ['rune-top', 'rune-bot']) {
    if (hasZone && !hasZone(zone)) continue
    if (activeRunes && activeRunes.has(zone)) continue // spot already occupied
    const type = RUNE_TYPES[Math.floor(Math.random() * RUNE_TYPES.length)]!
    runes.push({ zone, type, tick })
  }
  return runes
}

/** Roshan tracking state. */
export interface RoshanState {
  alive: boolean
  hp: number
  maxHp: number
  deathTick: number | null
}

/** Initialize Roshan at tick 0. */
export function initializeRoshan(): RoshanState {
  return {
    alive: true,
    hp: ROSHAN_BASE_HP,
    maxHp: ROSHAN_BASE_HP,
    deathTick: null,
  }
}

/** Check if Roshan should respawn. */
export function shouldRoshanRespawn(roshan: RoshanState, currentTick: number): boolean {
  if (roshan.alive) return false
  if (roshan.deathTick === null) return false
  return currentTick - roshan.deathTick >= ROSHAN_RESPAWN_TICKS
}

/** Respawn Roshan with increased HP (+ROSHAN_HP_PER_MINUTE per game minute elapsed). */
export function respawnRoshan(roshan: RoshanState, currentTick: number): RoshanState {
  const minutesElapsed = Math.floor((currentTick * TICK_DURATION_MS) / 60_000)
  const scaledMaxHp = ROSHAN_BASE_HP + minutesElapsed * ROSHAN_HP_PER_MINUTE
  return {
    alive: true,
    hp: scaledMaxHp,
    maxHp: scaledMaxHp,
    deathTick: null,
  }
}
