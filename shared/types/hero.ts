export type DamageType = 'physical' | 'magical' | 'pure'

export type TargetType = 'none' | 'hero' | 'unit' | 'zone' | 'self'

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
  role: 'carry' | 'support' | 'assassin' | 'tank' | 'mage' | 'offlaner'
  lore: string
  baseStats: HeroBaseStats
  growthPerLevel: Partial<HeroBaseStats>
  passive: AbilityDef
  abilities: { q: AbilityDef; w: AbilityDef; e: AbilityDef; r: AbilityDef }
}
