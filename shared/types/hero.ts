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
  | 'summon'

export type HeroRole = 'carry' | 'support' | 'tank' | 'assassin' | 'mage' | 'offlaner'

export type AbilityTargetType = 'self' | 'hero' | 'zone' | 'point'

export type PrimaryAttribute = 'strength' | 'agility' | 'intelligence'

export interface AbilityEffectScaling {
  stat: 'attack' | 'intelligence' | 'strength' | 'agility'
  ratio: number
}

export interface AbilityEffect {
  type: AbilityEffectType
  value: number
  duration?: number
  damageType?: DamageType
  description?: string
}

export interface ScaledAbilityEffect {
  type: AbilityEffectType
  value: number | number[]
  duration?: number
  damageType?: DamageType
  description?: string
  scaling?: AbilityEffectScaling
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

export interface HeroAbility {
  id: string
  name: string
  description: string
  targetType: AbilityTargetType
  cooldown: number | number[]
  manaCost: number | number[]
  effects: ScaledAbilityEffect[]
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

export interface HeroDefinition {
  id: string
  name: string
  role: HeroRole
  lore: string
  baseStats: HeroBaseStats
  growthPerLevel: Partial<HeroBaseStats>
  primaryAttribute: PrimaryAttribute
  passive: AbilityDef
  abilities: {
    Q: HeroAbility
    W: HeroAbility
    E: HeroAbility
    R: HeroAbility
  }
  startingItems?: string[]
}
