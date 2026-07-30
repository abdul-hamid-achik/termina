import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import ItemsPage from '~~/app/pages/items.vue'
import { ITEMS } from '~~/shared/constants/items'
import type { HeroRole } from '~~/shared/types/hero'
const ROLE_ORDER: HeroRole[] = ['carry', 'mage', 'assassin', 'tank', 'support', 'offlaner']
import { recommendedItemsForRole } from '~~/shared/constants/itemBuilds'

// items.vue leans on Nuxt auto-imports (ref/computed/useHead); the SFC compiler
// leaves them as globals under plain @vitejs/plugin-vue, so stub them — the
// project's established page-test pattern (see IndexPage.test.ts).
beforeEach(() => {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useHead', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function mountItems() {
  return mount(ItemsPage, {
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        AsciiButton: {
          props: ['label', 'disabled', 'variant'],
          template: '<button>{{ label }}</button>',
        },
        InlineError: true,
      },
    },
  })
}

describe('items page — build guidance', () => {
  it('renders the canonical build order for the default role, in order', () => {
    const wrapper = mountItems()
    const steps = wrapper.findAll('[data-testid="build-order"] li').map((li) => li.text())
    const expected = recommendedItemsForRole(ROLE_ORDER[0]!)
    expect(steps).toHaveLength(expected.length)
    expected.forEach((id, i) => {
      expect(steps[i]).toContain(ITEMS[id]!.name)
      expect(steps[i]).toContain(`${i + 1}.`)
    })
  })

  it('shows a running gold total that accumulates down the build', () => {
    const wrapper = mountItems()
    const ids = recommendedItemsForRole(ROLE_ORDER[0]!)
    const steps = wrapper.findAll('[data-testid="build-order"] li')
    let running = 0
    ids.forEach((id, i) => {
      running += ITEMS[id]!.cost
      expect(steps[i]!.text()).toContain(`${running}sc total`)
    })
    // The last entry is the full build cost, not just the last item's price.
    expect(running).toBeGreaterThan(ITEMS[ids[ids.length - 1]!]!.cost)
  })

  it('switches the whole strip when another role chip is picked', async () => {
    const wrapper = mountItems()
    const role = ROLE_ORDER.find((r) => r !== ROLE_ORDER[0])!
    await wrapper.find(`[data-testid="build-role-${role}"]`).trigger('click')

    const steps = wrapper.findAll('[data-testid="build-order"] li').map((li) => li.text())
    recommendedItemsForRole(role).forEach((id, i) => {
      expect(steps[i]).toContain(ITEMS[id]!.name)
    })
    expect(wrapper.find(`[data-testid="build-role-${role}"]`).attributes('aria-pressed')).toBe(
      'true',
    )
  })

  it('badges the catalogue cards that belong to the selected role build', () => {
    const wrapper = mountItems()
    const ids = recommendedItemsForRole(ROLE_ORDER[0]!)
    const first = ids[0]!
    const badge = wrapper.find(`[data-testid="build-badge-${first}"]`)
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('#1')

    // An item outside this role's build carries no badge.
    const outside = Object.keys(ITEMS).find((id) => !ids.includes(id))!
    expect(wrapper.find(`[data-testid="build-badge-${outside}"]`).exists()).toBe(false)
  })

  it('re-badges when the role changes', async () => {
    const wrapper = mountItems()
    const role = ROLE_ORDER.find(
      (r) => !recommendedItemsForRole(ROLE_ORDER[0]!).includes(recommendedItemsForRole(r)[0]!),
    )!
    const target = recommendedItemsForRole(role)[0]!
    expect(wrapper.find(`[data-testid="build-badge-${target}"]`).exists()).toBe(false)
    await wrapper.find(`[data-testid="build-role-${role}"]`).trigger('click')
    expect(wrapper.find(`[data-testid="build-badge-${target}"]`).exists()).toBe(true)
  })
})
