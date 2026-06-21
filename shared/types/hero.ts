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
  manaCost: number
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
  moveSpeed: number
  attackRange: 'melee' | 'ranged'
}

export interface HeroDef {
  id: string
  name: string
  role: HeroRole
  lore: string
  baseStats: HeroBaseStats
  growthPerLevel: Partial<HeroBaseStats>
  passive: AbilityDef
  abilities: { q: AbilityDef; w: AbilityDef; e: AbilityDef; r: AbilityDef }
}
