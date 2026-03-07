import { describe, it, expect } from 'vitest'
import type {
  HeroRole,
  AbilityTargetType,
  AbilityEffect,
  ScaledAbilityEffect,
  HeroAbility,
  HeroDefinition,
  DamageType,
  PrimaryAttribute,
  AbilityEffectScaling,
} from '../../../shared/types/hero'

describe('Hero Type Definitions', () => {
  describe('HeroRole', () => {
    it('should have all expected roles', () => {
      const roles: HeroRole[] = ['carry', 'support', 'tank', 'assassin', 'mage', 'offlaner']
      expect(roles.length).toBe(6)
    })
  })

  describe('AbilityTargetType', () => {
    it('should have all expected target types', () => {
      const types: AbilityTargetType[] = ['self', 'hero', 'zone', 'point']
      expect(types.length).toBe(4)
    })
  })

  describe('PrimaryAttribute', () => {
    it('should have all expected attributes', () => {
      const attrs: PrimaryAttribute[] = ['strength', 'agility', 'intelligence']
      expect(attrs.length).toBe(3)
    })
  })

  describe('AbilityEffect', () => {
    it('should validate damage effect', () => {
      const effect: AbilityEffect = {
        type: 'damage',
        value: 100,
        damageType: 'physical',
      }
      expect(effect.type).toBe('damage')
      expect(effect.value).toBe(100)
      expect(effect.damageType).toBe('physical')
    })

    it('should validate healing effect', () => {
      const effect: AbilityEffect = {
        type: 'heal',
        value: 80,
      }
      expect(effect.type).toBe('heal')
      expect(effect.value).toBe(80)
    })

    it('should validate buff effect with duration', () => {
      const effect: AbilityEffect = {
        type: 'buff',
        value: 15,
        duration: 3,
      }
      expect(effect.duration).toBe(3)
    })

    it('should validate DoT effect', () => {
      const effect: AbilityEffect = {
        type: 'dot',
        value: 50,
        damageType: 'magical',
        duration: 3,
      }
      expect(effect.type).toBe('dot')
      expect(effect.damageType).toBe('magical')
    })
  })

  describe('ScaledAbilityEffect', () => {
    it('should validate effect with scaling', () => {
      const effect: ScaledAbilityEffect = {
        type: 'damage',
        value: 100,
        damageType: 'magical',
        scaling: {
          stat: 'intelligence',
          ratio: 0.5,
        },
      }
      expect(effect.scaling?.stat).toBe('intelligence')
      expect(effect.scaling?.ratio).toBe(0.5)
    })

    it('should support array values for level scaling', () => {
      const effect: ScaledAbilityEffect = {
        type: 'damage',
        value: [80, 120, 160, 200],
        damageType: 'physical',
      }
      expect(Array.isArray(effect.value)).toBe(true)
      expect((effect.value as number[]).length).toBe(4)
    })
  })

  describe('AbilityEffectScaling', () => {
    it('should validate scaling configuration', () => {
      const scaling: AbilityEffectScaling = {
        stat: 'attack',
        ratio: 0.3,
      }
      expect(scaling.stat).toBe('attack')
      expect(scaling.ratio).toBe(0.3)
    })
  })

  describe('HeroAbility', () => {
    it('should validate basic ability structure', () => {
      const ability: HeroAbility = {
        id: 'test-q',
        name: 'Test Ability',
        description: 'A test ability',
        targetType: 'hero',
        cooldown: 6,
        manaCost: 50,
        effects: [{ type: 'damage', value: 100, damageType: 'physical' }],
      }
      expect(ability.id).toBe('test-q')
      expect(ability.targetType).toBe('hero')
      expect(ability.effects.length).toBe(1)
    })

    it('should support array cooldowns and mana costs', () => {
      const ability: HeroAbility = {
        id: 'test-w',
        name: 'Scaling Ability',
        description: 'Scales with level',
        targetType: 'hero',
        cooldown: [6, 5, 4, 3],
        manaCost: [40, 50, 60, 70],
        effects: [{ type: 'damage', value: [80, 120, 160, 200], damageType: 'physical' }],
      }
      expect(Array.isArray(ability.cooldown)).toBe(true)
      expect(Array.isArray(ability.manaCost)).toBe(true)
    })

    it('should support optional castRange and aoeRadius', () => {
      const ability: HeroAbility = {
        id: 'test-e',
        name: 'Ranged Ability',
        description: 'Has range',
        targetType: 'zone',
        cooldown: 10,
        manaCost: 80,
        effects: [{ type: 'stun', value: 1, duration: 2 }],
        castRange: 2,
        aoeRadius: 1,
      }
      expect(ability.castRange).toBe(2)
      expect(ability.aoeRadius).toBe(1)
    })
  })

  describe('HeroDefinition', () => {
    it('should validate complete hero structure', () => {
      const hero: HeroDefinition = {
        id: 'test-hero',
        name: 'Test Hero',
        role: 'carry',
        lore: 'A hero for testing',
        baseStats: {
          hp: 550,
          mp: 280,
          attack: 58,
          defense: 3,
          magicResist: 15,
          moveSpeed: 1,
          attackRange: 'ranged',
        },
        growthPerLevel: {
          hp: 55,
          mp: 25,
          attack: 7,
          defense: 1,
        },
        primaryAttribute: 'agility',
        passive: {
          id: 'test-passive',
          name: 'Test Passive',
          description: 'Passive ability',
          manaCost: 0,
          cooldownTicks: 0,
          targetType: 'none',
          effects: [{ type: 'buff', value: 10 }],
        },
        abilities: {
          Q: {
            id: 'test-q',
            name: 'Q Ability',
            description: 'Q',
            targetType: 'hero',
            cooldown: 6,
            manaCost: 50,
            effects: [{ type: 'damage', value: 100, damageType: 'physical' }],
          },
          W: {
            id: 'test-w',
            name: 'W Ability',
            description: 'W',
            targetType: 'self',
            cooldown: 12,
            manaCost: 60,
            effects: [{ type: 'buff', value: 20, duration: 3 }],
          },
          E: {
            id: 'test-e',
            name: 'E Ability',
            description: 'E',
            targetType: 'zone',
            cooldown: 15,
            manaCost: 70,
            effects: [{ type: 'stun', value: 1, duration: 2 }],
          },
          R: {
            id: 'test-r',
            name: 'R Ability',
            description: 'R',
            targetType: 'hero',
            cooldown: 50,
            manaCost: 150,
            effects: [{ type: 'damage', value: 300, damageType: 'magical' }],
          },
        },
        startingItems: ['potion', 'ward'],
      }

      expect(hero.id).toBe('test-hero')
      expect(hero.role).toBe('carry')
      expect(hero.primaryAttribute).toBe('agility')
      expect(hero.abilities.Q).toBeDefined()
      expect(hero.abilities.W).toBeDefined()
      expect(hero.abilities.E).toBeDefined()
      expect(hero.abilities.R).toBeDefined()
      expect(hero.startingItems).toEqual(['potion', 'ward'])
    })
  })

  describe('DamageType', () => {
    it('should have physical, magical, and pure types', () => {
      const types: DamageType[] = ['physical', 'magical', 'pure']
      expect(types.length).toBe(3)
    })
  })
})
