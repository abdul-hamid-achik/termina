import { describe, it, expect } from 'vitest'
import type { HeroRole, AbilityEffect, DamageType } from '~~/shared/types/hero'

describe('Hero Type Definitions', () => {
  describe('HeroRole', () => {
    it('should have all expected roles', () => {
      const roles: HeroRole[] = ['carry', 'support', 'tank', 'assassin', 'mage', 'offlaner']
      expect(roles.length).toBe(6)
    })
  })

  describe('AbilityEffect', () => {
    it('should validate damage effect', () => {
      const effect: AbilityEffect = {
        type: 'damage',
        value: 100,
        damageType: 'kinetic',
      }
      expect(effect.type).toBe('damage')
      expect(effect.value).toBe(100)
      expect(effect.damageType).toBe('kinetic')
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
        damageType: 'code',
        duration: 3,
      }
      expect(effect.type).toBe('dot')
      expect(effect.damageType).toBe('code')
    })
  })

  describe('DamageType', () => {
    it('should have kinetic, code, and black types', () => {
      const types: DamageType[] = ['kinetic', 'code', 'black']
      expect(types.length).toBe(3)
    })
  })
})
