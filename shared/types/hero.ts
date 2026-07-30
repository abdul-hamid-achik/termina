export type DamageType = 'physical' | 'magical' | 'pure'

export type TargetType = 'none' | 'hero' | 'unit' | 'zone' | 'self' | 'ally'

export type AbilityEffectType =
  | 'damage'
  | 'heal'
  | 'stun'
  | 'silence'
  | 'root'
  | 'slow'
  | 'shield'
  | 'dot'
  | 'buff'
  | 'debuff'
  | 'teleport'
  | 'reveal'
  | 'taunt'
  | 'fear'
  | 'execute'

export type HeroRole = 'carry' | 'support' | 'tank' | 'assassin' | 'mage' | 'offlaner'

/** The four active ability slots, in cast order. */
export type AbilitySlot = 'q' | 'w' | 'e' | 'r'

/**
 * How punishing a kit is to misuse — conditional gates (an execute that fails
 * above a threshold), stack economies, and self-displacement, NOT raw power.
 */
export type HeroDifficulty = 'easy' | 'medium' | 'hard'

/**
 * `HeroId` is now a literal union derived from the `HEROES` registry keys
 * (see `shared/constants/heroes.ts`). It is re-exported here so existing
 * `import type { HeroId } from '../types/hero'` paths keep working, but the
 * authoritative definition lives in `heroes.ts` — adding a hero there without
 * updating `Record<HeroId, T>` consumers (e.g. `TALENT_TREES`) is now a
 * compile-time error.
 */
export type { HeroId } from '../constants/heroes'

export interface AbilityEffect {
  type: AbilityEffectType
  value: number
  duration?: number
  damageType?: DamageType
  description?: string
}

export interface AbilityDef {
  id: string
  name: string
  description: string
  /**
   * Rank-1 cost — the headline number for surfaces with no player level (the
   * hero grid, the draft picker) and the whole cost for abilities that don't
   * scale. Always equals `manaCostByLevel[0]` when a table is present.
   */
  manaCost: number
  /**
   * Cost per ability rank. The registry is the ONLY copy — the hero resolvers
   * read it via `abilityManaTable` instead of keeping their own table. They
   * used to keep one, and the client, which knows only `manaCost`, displayed
   * and pre-validated the rank-1 cost of abilities the engine charged up to
   * 2.2x for. Absent means the cost is flat.
   */
  manaCostByLevel?: readonly number[]
  cooldownTicks: number
  targetType: TargetType
  damageType?: DamageType
  effects: AbilityEffect[]
  castRange?: number
  aoeRadius?: number
}

export interface HeroBaseStats {
  hp: number
  mp: number
  attack: number
  defense: number
  magicResist: number
}

export type HeroPosture = 'BREACH' | 'HOLD' | 'ROAM' | 'HARDLINE'

export type OperatorOrigin = 'street' | 'corp'

export interface OperatorBio {
  realName: string
  origin: OperatorOrigin
  /** The biography paragraph (canon, Cast.md). */
  bio: string
  /** Why the existing id already describes this person. */
  handleRationale: string
  /** How the kit reads as this person. */
  kitReading: string
}

export interface HeroDef {
  id: string
  name: string
  role: HeroRole
  /**
   * The player-facing axis (B2a): what a player PICKS on. `role` is retained
   * only because BotManager's lane priority and itemBuilds consume it.
   */
  posture: HeroPosture
  baseStats: HeroBaseStats
  growthPerLevel: Partial<HeroBaseStats>
  passive: AbilityDef
  abilities: { q: AbilityDef; w: AbilityDef; e: AbilityDef; r: AbilityDef }
  /**
   * Authored pick guidance, surfaced on /heroes as a difficulty badge and a
   * "How to play" block. Required rather than optional: a roster where some
   * cards carry guidance and some don't reads as a bug, and a required field
   * makes a new hero without guidance a compile error instead of a blank card.
   */
  difficulty: HeroDifficulty
  /**
   * The kit's opening rotation, in cast order. Drives the training console's
   * CAST COMBO button, so it has to be a rotation that actually resolves —
   * slots the hero cannot use yet at the selected level are skipped.
   */
  openingCombo: AbilitySlot[]
  /** The single thing that makes this kit work, in one sentence. */
  oneLineTip: string
}
