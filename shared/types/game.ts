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
  lastActionTick?: number // last tick this player submitted any action (AFK detection)
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
  /**
   * Ticks spent idle in a base zone (no target, invulnerable Ancient).
   * Once it reaches CREEP_BASE_IDLE_DESPAWN_TICKS the creep is garbage
   * collected. Optional so spawners/tests don't have to set it.
   */
  baseIdleTicks?: number
}

/**
 * A team's core structure — themed as "the Mainframe" in the terminal UI.
 * Lives in the team's base zone. Invulnerable until at least one of the
 * team's own T3 towers has fallen; destroying it wins the game.
 */
export interface AncientState {
  team: TeamId
  hp: number
  maxHp: number
  alive: boolean
  vulnerable: boolean
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
  ancients: { radiant: AncientState; dire: AncientState }
  runes: RuneState[]
  roshan: RoshanState
  aegis: { zone: string; tick: number; holderId: string | null } | null
  events: GameEvent[]
  winner?: TeamId | null // set when the game ends (Ancient destroyed or surrender)
  surrenderVotes: { radiant: Set<string>; dire: Set<string> }
  lastSeen: Record<string, { zone: string; tick: number }> // Track last seen position for each player
  timeOfDay: 'day' | 'night'
  dayNightTick: number
  /** Which map this game runs on (see shared/constants/maps). Absent = full 5v5.
   *  The actual playable graph is reflected in `zones`/`towers`; this is the
   *  label the client uses to pick a layout and the tutorial uses to gate. */
  mapId?: string
  /** Game mode. Absent/'normal' = a regular match; 'tutorial' = the guided
   *  practice flow (staggered command unlocks + just-in-time hints). */
  mode?: GameMode
}

/** A game's mode. 'normal' is a standard match; 'tutorial' is the guided
 *  single-player practice flow built on the one-lane map. */
export type GameMode = 'normal' | 'tutorial'

export interface ZoneRuntimeState {
  id: string
  wards: WardState[]
  creeps: string[]
  // Socket's Listen traps armed in this zone. Optional so existing zone-init
  // sites don't need updating; invisible to enemies (stripped in vision filter).
  traps?: TrapState[]
}

export interface WardState {
  team: TeamId
  placedTick: number
  expiryTick: number
  type: 'observer' | 'sentry'
}

export interface TrapState {
  owner: string
  team: TeamId
  damage: number
  revealDuration: number
  expiryTick: number
}

export interface FoggedPlayer {
  id: string
  name: string
  team: string
  heroId: string | null
  level: number
  // KDA is public information (the scoreboard shows it for every player even in
  // fog) — only gold/items/position are hidden. Without these the scoreboard
  // renders a fogged enemy as 0/0/0.
  kills: number
  deaths: number
  assists: number
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
  ancients: { radiant: AncientState; dire: AncientState }
  runes: RuneState[]
  roshan: RoshanState
  aegis: { zone: string; tick: number; holderId: string | null } | null
  events: GameEvent[]
  visibleZones: string[]
  timeOfDay: 'day' | 'night'
  dayNightTick: number
  /** Map + mode labels, mirrored from GameState so the client can pick the
   *  right layout and show tutorial UI. Absent = full 5v5 / normal match. */
  mapId?: string
  mode?: GameMode
}
