import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroLoreCard from '../../../app/components/lore/HeroLoreCard.vue'
import type { HeroRole } from '../../../shared/types/hero'

// HeroLoreCard renders a <NuxtLink> for its TRAIN deep-link; the component
// vitest project has no Nuxt auto-import, so stub it as a real anchor mirroring
// the `to` → href contract.
const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

function mountCard(hero: { id?: string; name: string; role: HeroRole; lore: string }) {
  return mount(HeroLoreCard, {
    props: { hero: { id: 'echo', ...hero } },
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  })
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

  it('links TRAIN to the hero console deep-linked to this hero', () => {
    const wrapper = mountCard({
      id: 'daemon',
      name: 'Daemon',
      role: 'assassin',
      lore: 'lore',
    })
    const link = wrapper.find('a[href="/heroes?hero=daemon"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('TRAIN')
    expect(link.text()).toContain('Daemon')
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
