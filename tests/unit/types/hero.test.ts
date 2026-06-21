import { describe, it, expect } from 'vitest'
import type { HeroRole, AbilityEffect, DamageType } from '../../../shared/types/hero'

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

  describe('DamageType', () => {
    it('should have physical, magical, and pure types', () => {
      const types: DamageType[] = ['physical', 'magical', 'pure']
      expect(types.length).toBe(3)
    })
  })
})
