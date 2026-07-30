import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import LorePage from '~~/app/pages/lore.vue'

// lore.vue uses Nuxt auto-imports (useHead, $fetch, navigateTo) via the
// useStartTutorial composable; the SFC compiler leaves these as globals under
// plain @vitejs/plugin-vue, so we stub them (see IndexPage.test.ts).
const mockNavigateTo = vi.fn()
const mockFetch = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useHead', vi.fn())
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

function mountLore() {
  return mount(LorePage, {
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        AsciiButton: {
          props: ['label', 'disabled', 'variant'],
          emits: ['click'],
          template:
            '<button :disabled="disabled" @click="$emit(\'click\', $event)">{{ label }}</button>',
        },
        HeroLoreCard: { props: ['hero', 'tags'], template: '<div>{{ hero.name }}</div>' },
        InlineError: { props: ['message'], template: '<div>{{ message }}</div>' },
      },
    },
  })
}

describe('lore page — the TERMINA frame', () => {
  it('names the city, the four districts, and the crews', () => {
    const text = mountLore().text()
    expect(text).toContain('TERMINA')
    for (const district of ['LANDING', 'ROOKERY', 'COLDSTORE', 'SHALLOWS']) {
      expect(text).toContain(district)
    }
    expect(text).toContain('CHAFF')
    expect(text).toContain('AUDIT')
    expect(text).toContain('Quorum')
  })

  it('teaches the batch clock as a CYCLE and keeps the Mainframe', () => {
    const text = mountLore().text()
    expect(text).toContain('CYCLE')
    expect(text).toContain('Mainframe')
  })

  it('no longer frames operatives as processes given form, nor the world as THE GRID', () => {
    // B1a: the 18 are handles with a real person behind each — the deleted
    // framing directly contradicted that and must not come back.
    const text = mountLore().text()
    expect(text).not.toContain('processes given form')
    expect(text).not.toContain('THE GRID')
  })

  it('keeps the tutorial CTA wired', () => {
    expect(mountLore().find('[data-testid="start-tutorial"]').exists()).toBe(true)
  })
})
