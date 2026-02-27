import type { CreepState, GameState } from '~~/shared/types/game'
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

/** Spawn a wave of creeps for one team on one lane. */
function spawnWave(
  team: 'radiant' | 'dire',
  lane: string,
  waveNumber: number,
): CreepState[] {
  const spawnZone = LANE_SPAWN_ZONES[lane]
  if (!spawnZone) return []
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

/** Spawn creep waves if the current tick is a wave tick. Returns new creeps to add. */
export function spawnCreepWaves(tick: number): CreepState[] {
  if (tick === 0 || tick % CREEP_WAVE_INTERVAL_TICKS !== 0) return []

  const waveNumber = tick / CREEP_WAVE_INTERVAL_TICKS
  const newCreeps: CreepState[] = []

  for (const lane of ['top', 'mid', 'bot']) {
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
const RUNE_INTERVAL_TICKS = 60

/** Spawn runes if the current tick is a rune tick. */
export function spawnRunes(tick: number): RuneSpawn[] {
  if (tick === 0 || tick % RUNE_INTERVAL_TICKS !== 0) return []

  const runes: RuneSpawn[] = []
  for (const zone of ['rune-top', 'rune-bot']) {
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

/** Respawn Roshan with increased HP. */
export function respawnRoshan(roshan: RoshanState): RoshanState {
  return {
    alive: true,
    hp: roshan.maxHp,
    maxHp: roshan.maxHp,
    deathTick: null,
  }
}
