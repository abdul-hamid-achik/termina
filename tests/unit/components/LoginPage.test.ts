import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'

// ── Nuxt auto-import + composable stubs ────────────────────────────
//
// login.vue relies on Nuxt's auto-imports (ref / computed from Vue,
// useRoute / navigateTo from Nuxt, $fetch, and the auth store's
// useUserSession). The SFC compiler does NOT transform these to real
// imports under plain @vitejs/plugin-vue, so they resolve as globals —
// we provide them here. (@nuxt/test-utils is not installed; this is the
// project's established pattern, mirroring stores/auth.test.ts.)
//
// Globals are stubbed in beforeEach and torn down with
// vi.unstubAllGlobals() in afterEach so they never bleed into sibling
// component-project test files (several of which also unstub globals).

import { createPinia, setActivePinia } from 'pinia'
import LoginPage from '../../../app/pages/login.vue'

const mockNavigateTo = vi.fn()
const mockRoute = { query: {} as Record<string, unknown> }
const mockFetch = vi.fn()
const mockLoggedIn = ref(false)
const mockUser = ref<Record<string, unknown> | null>(null)
const mockFetchSession = vi.fn()
const mockClearSession = vi.fn()

function stubNuxtGlobals() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('navigateTo', mockNavigateTo)
  vi.stubGlobal('useRoute', () => mockRoute)
  vi.stubGlobal('$fetch', mockFetch)
  vi.stubGlobal('useUserSession', () => ({
    loggedIn: mockLoggedIn,
    user: mockUser,
    fetch: mockFetchSession,
    clear: mockClearSession,
  }))
}

// ── Stubs for global components ────────────────────────────────────
// TerminalPanel renders its slot; AsciiButton becomes a real <button>
// that mirrors the disabled prop + click emit so we can drive submits.

function mountLogin() {
  return mount(LoginPage, {
    global: {
      stubs: {
        TerminalPanel: { template: '<section><slot /></section>' },
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

const flush = () => new Promise((r) => setTimeout(r, 0))

// The submit button lives inside the <form>; the OAuth buttons sit after
// it, so "last button" is not the submit. Find it within the form.
function submitButton(wrapper: ReturnType<typeof mountLogin>) {
  return wrapper.find('form').findAll('button').at(-1)!
}

beforeEach(() => {
  stubNuxtGlobals()
  setActivePinia(createPinia())
  mockNavigateTo.mockReset()
  mockFetch.mockReset()
  mockFetchSession.mockReset()
  mockClearSession.mockReset()
  mockRoute.query = {}
  mockLoggedIn.value = false
  mockUser.value = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('login page', () => {
  describe('mode switching', () => {
    it('starts in login mode with no confirm-password field', () => {
      const wrapper = mountLogin()

      expect(wrapper.findAll('input[type="password"]')).toHaveLength(1)
      expect(wrapper.find('input[autocomplete="username"]').exists()).toBe(true)
      expect(submitButton(wrapper).text()).toBe('LOGIN')
    })

    it('switching to register reveals the confirm-password field and changes the submit label', async () => {
      const wrapper = mountLogin()

      const registerTab = wrapper.findAll('button').find((b) => b.text().includes('register'))!
      await registerTab.trigger('click')

      expect(wrapper.findAll('input[type="password"]')).toHaveLength(2)
      expect(submitButton(wrapper).text()).toBe('REGISTER')
    })
  })

  describe('register validation', () => {
    async function toRegister(wrapper: ReturnType<typeof mountLogin>) {
      const registerTab = wrapper.findAll('button').find((b) => b.text().includes('register'))!
      await registerTab.trigger('click')
    }

    it('flags a too-short username', async () => {
      const wrapper = mountLogin()
      await toRegister(wrapper)

      await wrapper.find('input[autocomplete="username"]').setValue('ab')

      expect(wrapper.text()).toContain('must be 3-20 characters')
    })

    it('flags username with illegal characters', async () => {
      const wrapper = mountLogin()
      await toRegister(wrapper)

      await wrapper.find('input[autocomplete="username"]').setValue('bad name!')

      expect(wrapper.text()).toContain('letters, numbers, and underscores only')
    })

    it('shows the running char count for a short password', async () => {
      const wrapper = mountLogin()
      await toRegister(wrapper)

      await wrapper.find('input[autocomplete="new-password"]').setValue('abc')

      expect(wrapper.text()).toContain('3/8 chars required')
    })

    it('flags mismatched confirm password', async () => {
      const wrapper = mountLogin()
      await toRegister(wrapper)

      const pwInputs = wrapper.findAll('input[type="password"]')
      await pwInputs[0]!.setValue('password123')
      await pwInputs[1]!.setValue('password999')

      expect(wrapper.text()).toContain('passwords do not match')
    })

    it('keeps the submit button disabled until the register form is fully valid', async () => {
      const wrapper = mountLogin()
      await toRegister(wrapper)

      expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

      await wrapper.find('input[autocomplete="username"]').setValue('validuser')
      const pwInputs = wrapper.findAll('input[type="password"]')
      await pwInputs[0]!.setValue('password123')
      await pwInputs[1]!.setValue('password123')

      expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
    })
  })

  describe('login submission', () => {
    it('calls loginWithCredentials and redirects home on success', async () => {
      mockFetch.mockResolvedValue({ success: true })
      const wrapper = mountLogin()

      await wrapper.find('input[autocomplete="username"]').setValue('user')
      await wrapper.find('input[type="password"]').setValue('secret')
      await wrapper.find('form').trigger('submit')
      await flush()

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        body: { username: 'user', password: 'secret' },
      })
      expect(mockNavigateTo).toHaveBeenCalledWith('/')
    })

    it('redirects to the ?redirect target after login', async () => {
      mockFetch.mockResolvedValue({ success: true })
      mockRoute.query = { redirect: '/leaderboard' }
      const wrapper = mountLogin()

      await wrapper.find('input[autocomplete="username"]').setValue('user')
      await wrapper.find('input[type="password"]').setValue('secret')
      await wrapper.find('form').trigger('submit')
      await flush()

      expect(mockNavigateTo).toHaveBeenCalledWith('/leaderboard')
    })

    it('surfaces the server error message on a failed login and does not navigate', async () => {
      mockFetch.mockRejectedValue({ data: { message: 'Invalid credentials' } })
      const wrapper = mountLogin()

      await wrapper.find('input[autocomplete="username"]').setValue('user')
      await wrapper.find('input[type="password"]').setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flush()

      expect(wrapper.text()).toContain('Invalid credentials')
      expect(mockNavigateTo).not.toHaveBeenCalled()
    })

    it('falls back to a generic error when the failure has no message', async () => {
      mockFetch.mockRejectedValue(new Error('network'))
      const wrapper = mountLogin()

      await wrapper.find('input[autocomplete="username"]').setValue('user')
      await wrapper.find('input[type="password"]').setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flush()

      expect(wrapper.text()).toContain('Something went wrong')
    })
  })

  describe('OAuth error from URL', () => {
    it('renders a sanitized OAuth error from the query string', () => {
      mockRoute.query = { error: 'access_denied<script>alert(1)</script>' }
      const wrapper = mountLogin()

      const text = wrapper.text()
      expect(text).toContain('OAuth login failed')
      expect(text).toContain('access_denied')
      expect(text).not.toContain('<script>')
    })
  })

  describe('OAuth buttons', () => {
    it('triggers a github OAuth redirect', async () => {
      const wrapper = mountLogin()

      const githubBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('CONTINUE WITH GITHUB'))!
      await githubBtn.trigger('click')

      expect(mockNavigateTo).toHaveBeenCalledWith('/api/auth/github', { external: true })
    })
  })
})
