import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import IndexPage from '~~/app/pages/index.vue'
import InlineError from '~~/app/components/ui/InlineError.vue'
import ParallaxLayer from '~~/app/components/ui/ParallaxLayer.vue'
import ScrambleText from '~~/app/components/ui/ScrambleText.vue'
import MarqueeStrip from '~~/app/components/ui/MarqueeStrip.vue'
import { HERO_IDS, HEROES } from '~~/shared/constants/heroes'

// index.vue uses Nuxt auto-imports ($fetch, navigateTo) in startTutorial; the
// SFC compiler leaves these as globals under plain @vitejs/plugin-vue, so we
// stub them (the project's established pattern — see LoginPage.test.ts).
const mockNavigateTo = vi.fn()
const mockFetch = vi.fn()

beforeEach(() => {
  // index.vue reads useAuthStore() to personalize the funnel CTAs; the store
  // wraps useUserSession (a nuxt-auth-utils global) — stub it like LoginPage.
  setActivePinia(createPinia())
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useUserSession', () => ({
    loggedIn: ref(false),
    user: ref(null),
    fetch: vi.fn(),
    clear: vi.fn(),
  }))
  mockNavigateTo.mockReset()
  mockFetch.mockReset()
  vi.stubGlobal('navigateTo', mockNavigateTo)
  vi.stubGlobal('$fetch', mockFetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function mountIndex() {
  return mount(IndexPage, {
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        // A real <button> so we can click the Practice CTA and see its label.
        AsciiButton: {
          props: ['label', 'disabled', 'variant'],
          emits: ['click'],
          template:
            '<button :disabled="disabled" @click="$emit(\'click\', $event)">{{ label }}</button>',
        },
      },
      // Real component (not a stub) — the point of the failure test below is
      // that the reason actually reaches the page.
      // Real components, not stubs — the landing page's content lives inside
      // ParallaxLayer slots and MarqueeStrip items, so stubbing them would make
      // every content assertion below pass vacuously.
      components: { InlineError, ParallaxLayer, ScrambleText, MarqueeStrip },
    },
  })
}

describe('index (landing) page', () => {
  it('shows the live hero count from the registry, not a hardcoded 6', () => {
    const text = mountIndex().text()
    expect(text).toContain(`${HERO_IDS.length} operators`)
    expect(text).not.toContain('6 heroes')
    // The posture pillar teaches the pick-screen vocabulary (B2a).
    for (const posture of ['BREACH', 'HOLD', 'ROAM', 'HARDLINE']) {
      expect(text).toContain(posture)
    }
  })

  it('does not advertise the unimplemented scan command', () => {
    const text = mountIndex().text()
    expect(text).not.toContain('scan')
  })

  it('teaches no feed and tapping the routes', () => {
    // Reworded freely over time; assert the concept is present, not the phrasing.
    expect(mountIndex().text().toLowerCase()).toMatch(/no feed/)
    expect(mountIndex().text().toLowerCase()).toMatch(/\btap/)
  })

  it('names every hero in the roster ticker, straight from the registry', () => {
    // The strip is the page's only breadth claim — if it drifts from the
    // registry it advertises heroes that do not exist.
    const text = mountIndex().text()
    for (const id of HERO_IDS) {
      expect(text).toContain(HEROES[id]!.name)
    }
  })

  describe('Practice vs bots CTA', () => {
    it('POSTs to the tutorial route and navigates to the returned game URL', async () => {
      mockFetch.mockResolvedValue({ url: '/play?gameId=g1&playerId=p1&tutorial=1' })
      const wrapper = mountIndex()

      await wrapper.get('[data-testid="start-tutorial"]').trigger('click')
      await flushPromises()

      expect(mockFetch).toHaveBeenCalledWith('/api/game/tutorial', { method: 'POST', body: {} })
      expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g1&playerId=p1&tutorial=1')
    })

    it('routes to /login when the player is not signed in (401)', async () => {
      mockFetch.mockRejectedValue({ statusCode: 401 })
      const wrapper = mountIndex()

      await wrapper.get('[data-testid="start-tutorial"]').trigger('click')
      await flushPromises()

      expect(mockNavigateTo).toHaveBeenCalledWith({
        path: '/login',
        query: { next: 'practice' },
      })
    })

    it('shows the reason on the page instead of redirecting away', async () => {
      // REGRESSION: this used to navigateTo('/lobby') on any non-401 failure.
      // The player pressed PRACTICE, arrived somewhere they did not ask for with
      // no message, and could only read that as "the button is broken".
      mockFetch.mockRejectedValue({
        statusCode: 409,
        data: { message: "You're already in a match" },
      })
      const wrapper = mountIndex()

      await wrapper.get('[data-testid="start-tutorial"]').trigger('click')
      await flushPromises()

      expect(mockNavigateTo).not.toHaveBeenCalled()
      expect(wrapper.get('[data-testid="inline-error"]').text()).toContain('already in a match')
    })
  })
})
