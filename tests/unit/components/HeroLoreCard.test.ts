import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroLoreCard from '~~/app/components/lore/HeroLoreCard.vue'
import type { HeroPosture, OperatorOrigin } from '~~/shared/types/hero'

// HeroLoreCard renders a <NuxtLink> for its TRAIN deep-link; the component
// vitest project has no Nuxt auto-import, so stub it as a real anchor mirroring
// the `to` → href contract.
const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

function mountCard(
  hero: { id?: string; name: string; role: string; posture: HeroPosture },
  extras: {
    realName?: string
    origin?: OperatorOrigin
    bio?: string
    handleRationale?: string
    tags?: string[]
  } = {},
) {
  return mount(HeroLoreCard, {
    props: {
      hero: { id: 'echo', ...hero },
      realName: extras.realName ?? 'Rosane Vieira',
      origin: extras.origin ?? 'street',
      bio: extras.bio ?? 'A biography of the operator.',
      handleRationale: extras.handleRationale ?? 'The handle is the count.',
      ...(extras.tags ? { tags: extras.tags } : {}),
    },
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  })
}

describe('HeroLoreCard', () => {
  it('leads with the operator realName, the handle, posture and origin chips, and the bio', () => {
    const wrapper = mountCard(
      { name: 'Echo', role: 'carry', posture: 'HARDLINE' },
      { bio: 'She has a firing line and a number.' },
    )

    const text = wrapper.text()
    expect(text).toContain('Rosane Vieira')
    expect(text).toContain('`echo`')
    expect(text).toContain('HARDLINE')
    expect(text).toContain('street')
    expect(text).toContain('She has a firing line and a number.')
  })

  it('emits NO role colour class (the roleColor map is deleted)', () => {
    const wrapper = mountCard({ name: 'Echo', role: 'carry', posture: 'HARDLINE' })
    const html = wrapper.html()
    expect(html).not.toContain('text-gold')
    expect(wrapper.find('[data-posture="HARDLINE"]').exists()).toBe(true)
    expect(wrapper.find('[data-origin="street"]').exists()).toBe(true)
  })

  it('shows the why-the-handle line', () => {
    const wrapper = mountCard(
      { name: 'Echo', role: 'carry', posture: 'HARDLINE' },
      { handleRationale: 'A signal that repeats and builds.' },
    )
    expect(wrapper.text()).toContain('why the handle: A signal that repeats and builds.')
  })

  it('renders kit-identity playstyle tags when provided', () => {
    const wrapper = mountCard(
      { name: 'Echo', role: 'carry', posture: 'HARDLINE' },
      { tags: ['Burst', 'Mobility'] },
    )
    const tags = wrapper.find('[data-testid="lore-playstyle"]')
    expect(tags.exists()).toBe(true)
    expect(tags.text()).toContain('Burst')
    expect(tags.text()).toContain('Mobility')
  })

  it('omits the playstyle row when no tags are given', () => {
    const wrapper = mountCard({ name: 'Echo', role: 'carry', posture: 'HARDLINE' })
    expect(wrapper.find('[data-testid="lore-playstyle"]').exists()).toBe(false)
  })

  it('links TRAIN to the hero console deep-linked to this hero', () => {
    const wrapper = mountCard({ id: 'daemon', name: 'Daemon', role: 'assassin', posture: 'BREACH' })
    const link = wrapper.find('a[href="/cast?hero=daemon"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('TRAIN')
    expect(link.text()).toContain('DAEMON')
  })

  it('anchors the card with a per-hero id for /lore#lore-<id> deep links', () => {
    const wrapper = mountCard({ id: 'daemon', name: 'Daemon', role: 'assassin', posture: 'BREACH' })
    expect(wrapper.find('#lore-daemon').exists()).toBe(true)
  })
})
