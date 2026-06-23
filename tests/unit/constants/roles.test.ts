import { describe, it, expect } from 'vitest'
import { ROLE_META, ROLE_ORDER } from '../../../shared/constants/roles'
import { HEROES } from '../../../shared/constants/heroes'

describe('ROLE_META', () => {
  it('ROLE_ORDER lists exactly the ROLE_META keys', () => {
    expect([...ROLE_ORDER].sort()).toEqual(Object.keys(ROLE_META).sort())
  })

  it('gives every role a non-empty label and teaching blurb', () => {
    for (const role of ROLE_ORDER) {
      expect(ROLE_META[role].label.length, role).toBeGreaterThan(0)
      expect(ROLE_META[role].blurb.length, role).toBeGreaterThan(0)
    }
  })

  // Structural guard: every role a hero actually uses must have display metadata,
  // so the lore roster + /heroes role filter can never hit a missing role.
  it('covers every role present in the hero registry', () => {
    const heroRoles = new Set(Object.values(HEROES).map((h) => h.role))
    for (const role of heroRoles) {
      expect(ROLE_META[role], `ROLE_META is missing role: ${role}`).toBeTruthy()
    }
  })
})
