export type TeamId = 'radiant' | 'dire'

export type GamePhase = 'waiting' | 'picking' | 'playing' | 'ended'

export interface BuffState {
  id: string
  stacks: number
  ticksRemaining: number
  source: string
}

export interface PlayerState {
  id: string
  name: string
  team: TeamId
  heroId: string | null
  zone: string
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  level: number
  xp: number
  gold: number
  items: (string | null)[]
  cooldowns: { q: number; w: number; e: number; r: number }
  buffs: BuffState[]
  alive: boolean
  respawnTick: number | null
  kills: number
  deaths: number
  assists: number
}

export interface CreepState {
  id: string
  team: TeamId
  zone: string
  hp: number
  type: 'melee' | 'ranged' | 'siege'
}

export interface TowerState {
  team: TeamId
  zone: string
  hp: number
  maxHp: number
  alive: boolean
}

export interface GameEvent {
  tick: number
  type: string
  payload: Record<string, unknown>
}

export interface TeamState {
  id: TeamId
  kills: number
  towerKills: number
  gold: number
}

export interface GameState {
  tick: number
  phase: GamePhase
  teams: { radiant: TeamState; dire: TeamState }
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  creeps: CreepState[]
  towers: TowerState[]
  events: GameEvent[]
}

export interface ZoneRuntimeState {
  id: string
  wards: WardState[]
  creeps: string[]
}

export interface WardState {
  team: TeamId
  placedTick: number
  expiryTick: number
}
