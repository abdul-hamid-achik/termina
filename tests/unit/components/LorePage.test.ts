import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import LorePage from '~~/app/pages/lore.vue'
import { TERMINAL_HP } from '~~/shared/constants/balance'
import { STRUCTURE_LABELS } from '~~/shared/constants/world'

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
        // Mirrors the real AsciiButton's `to` handling (renders AS the link,
        // never a <button> nested inside an <a>) so this stub can't silently
        // diverge from the flattened markup.
        AsciiButton: {
          props: ['label', 'disabled', 'variant', 'to'],
          emits: ['click'],
          template: `
            <a v-if="to" :href="to">{{ label }}</a>
            <button v-else :disabled="disabled" @click="$emit('click', $event)">{{ label }}</button>
          `,
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

  it('teaches the batch clock as a CYCLE and keeps the Terminal', () => {
    const text = mountLore().text()
    expect(text).toContain('CYCLE')
    expect(text).toContain('Terminal')
  })

  it('does not claim a single instruction per cycle; states one MAIN order plus standing orders', () => {
    const text = mountLore().text()
    expect(text).not.toContain('one instruction per cycle')
    expect(text).toContain('one main order per cycle')
    expect(text).toContain('keeps standing until you replace it')
  })

  it('states the win condition exactly: Terminal HP, T3 firewall, ICE falls in order', () => {
    const text = mountLore().text()
    const black = STRUCTURE_LABELS.ice[3]
    expect(text).toContain(`(${TERMINAL_HP} INTEG)`)
    expect(text).toContain(`any one of its crew's three ${black} is down`)
    expect(text).toContain('T1, T2, then')
  })

  it('draws the cycle diagram as five operators, not one player with five orders', () => {
    const caption = mountLore().get('[data-testid="cycle-diagram"] figcaption').text()
    expect(caption).toContain('5 different operators')
    expect(caption).not.toMatch(/five instructions/i)
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

  it('never nests a button inside the "meet the heroes" link (invalid, breaks AT)', () => {
    // Regression: this used to be `<NuxtLink to="/cast"><AsciiButton /></NuxtLink>`,
    // i.e. <a><button>…</button></a>. AsciiButton now renders AS the link via `to`.
    const link = mountLore().get('a[href="/cast"]')
    expect(link.find('button').exists()).toBe(false)
  })
})
