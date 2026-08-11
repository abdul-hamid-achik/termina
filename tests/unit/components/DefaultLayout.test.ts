import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import DefaultLayout from '~~/app/layouts/default.vue'

// Same established pattern as LoginPage.test.ts / IndexPage.test.ts: the
// layout's Nuxt auto-imports (useUserSession) resolve as globals under plain
// @vitejs/plugin-vue, so stub them; useAuthStore is the REAL store (it just
// wraps the stubbed useUserSession).
const mockLoggedIn = ref(false)
const mockUser = ref<Record<string, unknown> | null>(null)
const mockFetchSession = vi.fn()
const mockClearSession = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  mockLoggedIn.value = false
  mockUser.value = null
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('navigateTo', vi.fn())
  vi.stubGlobal('useUserSession', () => ({
    loggedIn: mockLoggedIn,
    user: mockUser,
    fetch: mockFetchSession,
    clear: mockClearSession,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function mountLayout() {
  return mount(DefaultLayout, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        ClientOnly: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('default layout — guest affordance', () => {
  it('shows [LOGIN] for a logged-out visitor', () => {
    mockLoggedIn.value = false
    mockUser.value = null
    const text = mountLayout().text()
    expect(text).toContain('[LOGIN]')
    expect(text).not.toContain('[GUEST]')
  })

  it('shows [LOGOUT] and PROFILE/SETTINGS for a real signed-in account', () => {
    mockLoggedIn.value = true
    mockUser.value = { id: 'p1', username: 'alice', guest: false }
    const text = mountLayout().text()
    expect(text).toContain('[LOGOUT]')
    expect(text).toContain('[PROFILE]')
    expect(text).toContain('[SETTINGS]')
    expect(text).not.toContain('[GUEST]')
  })

  it('shows a one-line [GUEST] tag + sign-in nudge for a guest session', () => {
    mockLoggedIn.value = true
    mockUser.value = { id: 'guest_abc123', username: 'GUEST-ABC1', guest: true }
    const wrapper = mountLayout()

    expect(wrapper.get('[data-testid="guest-tag"]').text()).toBe('[GUEST]')
    const nudge = wrapper.get('[data-testid="guest-signin-nudge"]')
    expect(nudge.text()).toContain('SIGN IN')
    expect(nudge.text().toLowerCase()).toContain('keep progress')
    // No bare [LOGOUT] for a guest — signing out would just discard the
    // in-progress practice session with nothing to show for it.
    expect(wrapper.text()).not.toContain('[LOGOUT]')
  })

  it('hides PROFILE/SETTINGS for a guest — neither has anything to show', () => {
    // A guest has no `players` DB row: /profile/me and /profile/settings
    // would either 404 or (settings.put.ts) reject outright. Route guests to
    // the same nav a logged-out visitor gets.
    mockLoggedIn.value = true
    mockUser.value = { id: 'guest_abc123', guest: true }
    const text = mountLayout().text()
    expect(text).not.toContain('[PROFILE]')
    expect(text).not.toContain('[SETTINGS]')
  })
})
