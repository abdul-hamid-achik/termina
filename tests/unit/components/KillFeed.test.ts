import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import KillFeed from '../../../app/components/game/KillFeed.vue'
import type { KillFeedEntry } from '../../../app/utils/combatNarrative'

function entry(overrides: Partial<KillFeedEntry> = {}): KillFeedEntry {
  return {
    tick: 10,
    category: 'hero',
    killerId: 'me',
    victimId: 'enemy1',
    assisters: [],
    text: 'FIRST BLOOD  You SIGKILL\'d enemy1',
    ...overrides,
  }
}

describe('KillFeed', () => {
  it('shows recent headline plays', () => {
    const w = mount(KillFeed, { props: { entries: [entry()], currentTick: 10 } })
    const banner = w.get('[data-testid="kill-feed"]')
    expect(banner.text()).toContain('FIRST BLOOD')
  })

  it('ages out plays older than the window', () => {
    const w = mount(KillFeed, { props: { entries: [entry({ tick: 1 })], currentTick: 20, window: 2 } })
    expect(w.find('[data-testid="kill-feed"]').exists()).toBe(false)
  })

  it('caps the number of simultaneous banners', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({ tick: 10, victimId: `v${i}`, text: `kill ${i}` }),
    )
    const w = mount(KillFeed, { props: { entries, currentTick: 10, max: 3 } })
    expect(w.findAll('[data-testid="kill-feed-entry"]')).toHaveLength(3)
  })

  it('renders nothing when there are no recent plays', () => {
    const w = mount(KillFeed, { props: { entries: [], currentTick: 10 } })
    expect(w.find('[data-testid="kill-feed"]').exists()).toBe(false)
  })
})
