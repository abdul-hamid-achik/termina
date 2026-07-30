import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import HeroesPage from '~~/app/pages/heroes.vue'
import { HEROES } from '~~/shared/constants/heroes'
import { getTalentTree, talentUnlockLevel } from '~~/shared/constants/talents'
import { ULTIMATE_UNLOCK_LEVEL } from '~~/shared/constants/balance'

// heroes.vue leans on Nuxt auto-imports (ref/computed/watch/lifecycle hooks,
// useHead, useRoute, $fetch, navigateTo); the SFC compiler leaves them as
// globals under plain @vitejs/plugin-vue, so stub them — the project's
// established page-test pattern (see IndexPage.test.ts).
const mockFetch = vi.fn()
const mockNavigateTo = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  mockNavigateTo.mockReset()
  mockFetch.mockResolvedValue({ url: '/game/abc' })
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('useHead', vi.fn())
  vi.stubGlobal('useRoute', () => ({ query: {} }))
  vi.stubGlobal('$fetch', mockFetch)
  vi.stubGlobal('navigateTo', mockNavigateTo)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function mountHeroes() {
  return mount(HeroesPage, {
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        AsciiButton: {
          props: ['label', 'disabled', 'variant'],
          emits: ['click'],
          template:
            '<button :disabled="disabled" @click="$emit(\'click\', $event)">{{ label }}</button>',
        },
        InlineError: true,
      },
    },
  })
}

/** Click the hero-grid button for a given hero name. */
async function selectHero(wrapper: ReturnType<typeof mountHeroes>, name: string) {
  const btn = wrapper.findAll('[data-testid="hero-pick"]').find((b) => b.text().includes(name))
  await btn!.trigger('click')
}

describe('heroes page — decision content', () => {
  it('marks the easy heroes as beginner picks in the grid', () => {
    const wrapper = mountHeroes()
    const badges = wrapper.findAll('[data-testid="hero-beginner-badge"]')
    const easyCount = Object.values(HEROES).filter((h) => h.difficulty === 'easy').length
    expect(easyCount).toBeGreaterThan(0)
    expect(badges).toHaveLength(easyCount)
  })

  it('shows the selected hero difficulty, opening combo and tip', async () => {
    const wrapper = mountHeroes()
    await selectHero(wrapper, HEROES.cache!.name)

    expect(wrapper.find('[data-testid="hero-difficulty"]').text()).toBe('HARD')
    expect(wrapper.find('[data-testid="hero-tip"]').text()).toBe(HEROES.cache!.oneLineTip)

    const combo = wrapper.find('[data-testid="hero-opening-combo"]').text()
    for (const slot of HEROES.cache!.openingCombo) {
      expect(combo).toContain(HEROES.cache!.abilities[slot].name)
    }
  })

  it('renders every talent tier as a left/right pair and states the pick is permanent', () => {
    const wrapper = mountHeroes()
    const talents = wrapper.find('[data-testid="hero-talents"]')
    const tree = getTalentTree('echo')!

    for (const tier of [10, 15, 20, 25] as const) {
      const [left, right] = tree.tiers[tier]
      expect(talents.text()).toContain(left.name)
      expect(talents.text()).toContain(right.name)
      // The unlock LEVEL, not the tier id — the two are different numbers.
      expect(talents.text()).toContain(`tier ${tier} · unlocks at level ${talentUnlockLevel(tier)}`)
    }
    expect(talents.text()).toContain('there is no respec')
  })

  it('locks the ultimate at level 1 and unlocks it at the selector level', async () => {
    const wrapper = mountHeroes()
    expect(wrapper.find('[data-testid="ability-lock-r"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ability-lock-q"]').exists()).toBe(false)

    await wrapper.find(`[data-testid="console-level-${ULTIMATE_UNLOCK_LEVEL}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ability-lock-r"]').exists()).toBe(false)
  })

  it('scales the console BW pool with the selected level', async () => {
    const wrapper = mountHeroes()
    const echo = HEROES.echo!
    expect(wrapper.text()).toContain(`bw ${echo.baseStats.bw} / ${echo.baseStats.bw}`)

    await wrapper.find('[data-testid="console-level-18"]').trigger('click')
    await flushPromises()
    const at18 = echo.baseStats.bw + (echo.growthPerLevel.bw ?? 0) * 17
    expect(at18).toBeGreaterThan(echo.baseStats.bw)
    expect(wrapper.text()).toContain(`bw ${at18} / ${at18}`)
  })

  it('labels the per-tick refill as a sandbox aid, not innate regen', () => {
    const note = mountHeroes().find('[data-testid="console-refill-note"]').text()
    expect(note).toContain('no innate regen')
    expect(note).toContain('fountain')
  })

  it('starts practice as the selected hero', async () => {
    const wrapper = mountHeroes()
    await selectHero(wrapper, HEROES.malloc!.name)

    const cta = wrapper.findAll('button').find((b) => b.text().startsWith('PRACTICE AS'))!
    expect(cta.text()).toBe(`PRACTICE AS ${HEROES.malloc!.name.toUpperCase()}`)

    await cta.trigger('click')
    await flushPromises()
    expect(mockFetch).toHaveBeenCalledWith('/api/game/tutorial', {
      method: 'POST',
      body: { heroSelf: 'malloc' },
    })
  })
})
