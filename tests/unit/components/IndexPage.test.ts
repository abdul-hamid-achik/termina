import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import IndexPage from '../../../app/pages/index.vue'
import { HERO_IDS } from '../../../shared/constants/heroes'

// index.vue uses Nuxt auto-imports ($fetch, navigateTo) in startTutorial; the
// SFC compiler leaves these as globals under plain @vitejs/plugin-vue, so we
// stub them (the project's established pattern — see LoginPage.test.ts).
const mockNavigateTo = vi.fn()
const mockFetch = vi.fn()

beforeEach(() => {
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
    },
  })
}

describe('index (landing) page', () => {
  it('shows the live hero count from the registry, not a hardcoded 6', () => {
    const text = mountIndex().text()
    expect(text).toContain(`${HERO_IDS.length} unique heroes`)
    expect(text).not.toContain('6 unique heroes')
  })

  it('does not advertise the unimplemented scan command', () => {
    const text = mountIndex().text()
    expect(text).not.toContain('scan')
    expect(text).toContain('place wards to reveal the unseen')
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

      expect(mockNavigateTo).toHaveBeenCalledWith('/login')
    })

    it('routes to /lobby on any other failure (e.g. already in a game)', async () => {
      mockFetch.mockRejectedValue({ statusCode: 409 })
      const wrapper = mountIndex()

      await wrapper.get('[data-testid="start-tutorial"]').trigger('click')
      await flushPromises()

      expect(mockNavigateTo).toHaveBeenCalledWith('/lobby')
    })
  })
})
