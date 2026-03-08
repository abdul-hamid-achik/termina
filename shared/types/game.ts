export type TeamId = 'radiant' | 'dire'

export type GamePhase = 'waiting' | 'picking' | 'playing' | 'ended'

export interface BuffState {
  id: string
  stacks: number
  ticksRemaining: number
  source: string
  destination?: string
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
  defense: number
  magicResist: number
  kills: number
  deaths: number
  assists: number
  damageDealt: number
  towerDamageDealt: number
  killStreak: number
  buybackCost: number
  buybackCooldown?: number // tick when buyback becomes available again
  talents: {
    tier10: string | null // Talent ID chosen at level 10
    tier15: string | null // Talent ID chosen at level 15
    tier20: string | null // Talent ID chosen at level 20
    tier25: string | null // Talent ID chosen at level 25
  }
}

export interface CreepState {
  id: string
  team: TeamId
  zone: string
  hp: number
  type: 'melee' | 'ranged' | 'siege'
}

export interface NeutralCreepState {
  id: string
  zone: string
  hp: number
  maxHp: number
  type: string // 'kobold', 'ogre_mage', 'centaur', 'ancient_dragon', 'ancient_rock_golem'
  alive: boolean
}

export interface TowerState {
  team: TeamId
  zone: string
  hp: number
  maxHp: number
  alive: boolean
  invulnerable: boolean
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
  glyphUsedTick: number | null
}

export interface RuneState {
  zone: string
  type: 'haste' | 'dd' | 'regen' | 'arcane' | 'invis'
  tick: number
}

export interface RoshanState {
  alive: boolean
  hp: number
  maxHp: number
  deathTick: number | null
}

export interface GameState {
  tick: number
  phase: GamePhase
  teams: { radiant: TeamState; dire: TeamState }
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  creeps: CreepState[]
  neutrals: NeutralCreepState[]
  towers: TowerState[]
  runes: RuneState[]
  roshan: RoshanState
  aegis: { zone: string; tick: number; holderId: string | null } | null
  events: GameEvent[]
  surrenderVotes: { radiant: Set<string>; dire: Set<string> }
  lastSeen: Record<string, { zone: string; tick: number }> // Track last seen position for each player
  timeOfDay: 'day' | 'night'
  dayNightTick: number
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
  type: 'observer' | 'sentry'
}

export interface FoggedPlayer {
  id: string
  name: string
  team: string
  heroId: string | null
  level: number
  alive: boolean
  fogged: true
}

export interface PlayerVisibleState {
  tick: number
  phase: GamePhase
  teams: { radiant: TeamState; dire: TeamState }
  players: Record<string, PlayerState | FoggedPlayer>
  zones: Record<string, ZoneRuntimeState>
  creeps: CreepState[]
  neutrals: NeutralCreepState[]
  towers: TowerState[]
  runes: RuneState[]
  roshan: RoshanState
  aegis: { zone: string; tick: number; holderId: string | null } | null
  events: GameEvent[]
  visibleZones: string[]
  timeOfDay: 'day' | 'night'
  dayNightTick: number
}
