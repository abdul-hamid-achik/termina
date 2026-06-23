import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroLoreCard from '../../../app/components/lore/HeroLoreCard.vue'
import type { HeroRole } from '../../../shared/types/hero'

function mountCard(hero: { name: string; role: HeroRole; lore: string }) {
  return mount(HeroLoreCard, { props: { hero } })
}

describe('HeroLoreCard', () => {
  it('renders the hero name, role and lore', () => {
    const wrapper = mountCard({
      name: 'Echo',
      role: 'assassin',
      lore: 'A ghost in the wire, striking from the dark.',
    })

    const text = wrapper.text()
    expect(text).toContain('Echo')
    expect(text).toContain('assassin') // CSS uppercases it visually
    expect(text).toContain('A ghost in the wire, striking from the dark.')
  })

  // Role themes the roster so it reads at a glance — assert each mapping.
  const roleColors: Array<[HeroRole, string]> = [
    ['carry', 'text-gold'],
    ['mage', 'text-ability'],
    ['assassin', 'text-dire'],
    ['tank', 'text-radiant'],
    ['support', 'text-radiant'],
    ['offlaner', 'text-ability'],
  ]

  it.each(roleColors)('colours the %s role label with %s', (role, expectedClass) => {
    const wrapper = mountCard({ name: 'Test', role, lore: 'lore' })

    // the role label is the second baseline span; find the element carrying the role text
    const roleSpan = wrapper.findAll('span').find((s) => s.text() === role)
    expect(roleSpan, `role span for ${role}`).toBeTruthy()
    expect(roleSpan!.classes()).toContain(expectedClass)
  })
})
