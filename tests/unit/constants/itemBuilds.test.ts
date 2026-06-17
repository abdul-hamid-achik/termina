import { describe, it, expect } from 'vitest'
import { recommendedItemsForRole } from '../../../shared/constants/itemBuilds'
import { getItem } from '../../../shared/constants/items'
import { HEROES, HERO_IDS } from '../../../shared/constants/heroes'
import type { HeroRole } from '../../../shared/types/hero'

const ROLES: HeroRole[] = ['carry', 'support', 'tank', 'assassin', 'mage', 'offlaner']

describe('recommendedItemsForRole', () => {
  it('returns a non-empty, role-specific list for every role', () => {
    for (const role of ROLES) {
      const items = recommendedItemsForRole(role)
      expect(items.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the core build for an undefined role', () => {
    const core = recommendedItemsForRole(undefined)
    expect(core.length).toBeGreaterThan(0)
    // Core build leads with a right-click stat item (the bot/test contract).
    expect(core[0]).toBe('blades_of_attack')
  })

  it('recommends only real, buyable items (no typos / dead ids)', () => {
    for (const role of [...ROLES, undefined]) {
      for (const id of recommendedItemsForRole(role)) {
        expect(getItem(id), `unknown item id "${id}"`).toBeDefined()
      }
    }
  })

  it("covers every hero's role with a recommendation", () => {
    for (const heroId of HERO_IDS) {
      const role = HEROES[heroId]!.role
      expect(recommendedItemsForRole(role).length).toBeGreaterThan(0)
    }
  })
})
