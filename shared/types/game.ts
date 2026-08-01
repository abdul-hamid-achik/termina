import type { TargetRef } from './commands'

export type TeamId = 'chaff' | 'audit'

export type GamePhase = 'waiting' | 'picking' | 'playing' | 'ended'

export interface BuffState {
  id: string
  stacks: number
  cyclesRemaining: number
  source: string
  destination?: string
}

export interface PlayerState {
  id: string
  name: string
  /** Guild/clan tag (resolved at game creation) — shown next to the name. */
  guildTag?: string
  team: TeamId
  heroId: string | null
  zone: string
  integ: number
  maxInteg: number
  bw: number
  maxBw: number
  level: number
  xp: number
  scrip: number
  items: (string | null)[]
  cooldowns: { q: number; w: number; e: number; r: number }
  buffs: BuffState[]
  alive: boolean
  respawnCycle: number | null
  plate: number
  ice: number
  kills: number
  deaths: number
  assists: number
  damageDealt: number
  iceDamageDealt: number
  killStreak: number
  buybackCost: number
  buybackCooldown?: number // cycle when buyback becomes available again
  lastActionCycle?: number // last cycle this player submitted any action (AFK detection)
  aiControlled?: boolean // true once an AFK human is replaced by a bot (no-reclaim takeover)
  // Auto-path destination: the hero walks one zone per cycle toward it until
  // arrival or any new deliberate action. Stripped from enemy views in the
  // vision filter (it would leak intent).
  moveTarget?: string | null
  // Standing attack order: the hero keeps swinging at it every cycle until it
  // dies, leaves the zone, or any new deliberate order lands. NEVER set for
  // `kind: 'wave'` — last-hitting is a timing skill and stays a manual input.
  // Stripped from enemy views alongside moveTarget (it leaks the same intent).
  attackTarget?: TargetRef | null
  talents: {
    tier10: string | null // Talent ID chosen at level 10
    tier15: string | null // Talent ID chosen at level 15
    tier20: string | null // Talent ID chosen at level 20
    tier25: string | null // Talent ID chosen at level 25
  }
}

export interface WaveUnitState {
  id: string
  team: TeamId
  zone: string
  integ: number
  /**
   * The integrity this wave spawned with. Waves escalate with match time, so their
   * max is a property of WHEN THEY SPAWNED, not of the current cycle — anything
   * that reasons about a fraction of full health (the burn window, INTEG bars) has
   * to read it from here. Optional so fixtures can omit it; callers fall back to
   * the cycle-0 base rather than the current tier.
   */
  maxInteg?: number
  type: 'line' | 'sweep' | 'breach'
  /**
   * Ticks spent idle in a base zone (no target, invulnerable Terminal).
   * Once it reaches WAVE_BASE_IDLE_DESPAWN_CYCLES the wave is garbage
   * collected. Optional so spawners/tests don't have to set it.
   */
  baseIdleCycles?: number
}

/**
 * A team's core structure — themed as "the Terminal" in the terminal UI.
 * Lives in the team's base zone. Invulnerable until at least one of the
 * team's own T3 ice has fallen; destroying it wins the game.
 */
export interface TerminalState {
  team: TeamId
  integ: number
  maxInteg: number
  alive: boolean
  vulnerable: boolean
}

export interface SiltDwellerState {
  id: string
  zone: string
  integ: number
  maxInteg: number
  type: string // 'stub', 'watchdog', 'warden', 'orphan', 'zombie'
  alive: boolean
}

export interface IceState {
  team: TeamId
  zone: string
  integ: number
  maxInteg: number
  alive: boolean
  invulnerable: boolean
}

export interface GameEvent {
  cycle: number
  type: string
  payload: Record<string, unknown>
}

export interface TeamState {
  id: TeamId
  kills: number
  iceKills: number
  scrip: number
  hardenUsedCycle: number | null
}

export interface CacheState {
  zone: string
  type: 'haste' | 'dd' | 'regen' | 'arcane' | 'invis'
  cycle: number
}

export interface TenantState {
  alive: boolean
  integ: number
  maxInteg: number
  deathCycle: number | null
}

export interface GameState {
  cycle: number
  phase: GamePhase
  teams: { chaff: TeamState; audit: TeamState }
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  waves: WaveUnitState[]
  neutrals: SiltDwellerState[]
  ice: IceState[]
  terminals: { chaff: TerminalState; audit: TerminalState }
  caches: CacheState[]
  tenant: TenantState
  backup: { zone: string; cycle: number; holderId: string | null } | null
  events: GameEvent[]
  winner?: TeamId | null // set when the game ends (Terminal destroyed or surrender)
  surrenderVotes: { chaff: Set<string>; audit: Set<string> }
  timeOfDay: 'day' | 'night'
  dayNightCycle: number
  /** Which map this game runs on (see shared/constants/maps). Absent = full 5v5.
   *  The actual playable graph is reflected in `zones`/`ice`; this is the
   *  label the client uses to pick a layout and the tutorial uses to gate. */
  mapId?: string
  /** Game mode. Absent/'normal' = a regular match; 'tutorial' = the guided
   *  practice flow (staggered command unlocks + just-in-time hints). */
  mode?: GameMode
  /** Tutorial progress: which step of the flow the player is on (0-based).
   *  Only meaningful when mode === 'tutorial'; drives command-gating + hints. */
  tutorialStep?: number
  /** Tick the current tutorial step became active. Server-only (not broadcast):
   *  it exists so a step that the live match makes unsatisfiable — no wave wave
   *  yet, no enemy hero in range — eventually times out instead of dead-ending
   *  the player. See TUTORIAL_STEP_DEADLINE_CYCLES. */
  tutorialStepSince?: number
}

/** A game's mode. 'normal' is a standard match; 'tutorial' is the guided
 *  single-player practice flow built on the one-lane map. */
export type GameMode = 'normal' | 'tutorial'

export interface ZoneRuntimeState {
  id: string
  wards: WardState[]
  // Socket's Listen traps armed in this zone. Optional so existing zone-init
  // sites don't need updating; invisible to enemies (stripped in vision filter).
  traps?: TrapState[]
}

export interface WardState {
  team: TeamId
  placedTick: number
  expiryTick: number
  type: 'camtap' | 'sniffer'
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
  /** Guild tag is public identity (like KDA) — shown even in fog. */
  guildTag?: string
  team: string
  heroId: string | null
  level: number
  // KDA is public information (the scoreboard shows it for every player even in
  // fog) — only scrip/items/position are hidden. Without these the scoreboard
  // renders a fogged enemy as 0/0/0.
  kills: number
  deaths: number
  assists: number
  alive: boolean
  fogged: true
}

/**
 * The subset of `GameState` fields that are mirrored verbatim into a player's
 * fog-of-war-filtered view. Using `Pick` keeps the two interfaces in lockstep —
 * adding/renaming/removing a field on `GameState` surfaces a compile error here
 * instead of silently drifting (the old hand-mirored list was missing the
 * `mode`/`mapId`/`tutorialStep` fields until they were bolted on ad hoc).
 */
export type VisibleStateBase = Pick<
  GameState,
  | 'cycle'
  | 'phase'
  | 'teams'
  | 'zones'
  | 'waves'
  | 'neutrals'
  | 'ice'
  | 'terminals'
  | 'caches'
  | 'tenant'
  | 'backup'
  | 'events'
  | 'timeOfDay'
  | 'dayNightCycle'
  | 'mapId'
  | 'mode'
  | 'tutorialStep'
>

export interface PlayerVisibleState extends VisibleStateBase {
  // Fog-of-war: enemy players outside vision are replaced by a `FoggedPlayer`
  // stub (KDA + hero + level only), unlike `GameState` which holds full
  // `PlayerState`s. Visible allies/enemies keep their full `PlayerState`.
  players: Record<string, PlayerState | FoggedPlayer>
  // Zones the viewer can currently see — drives the client's fog overlay.
  // Has no counterpart on `GameState` (where every zone is "visible" to the
  // authoritative state).
  visibleZones: string[]
}
