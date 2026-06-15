import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed, defineComponent, Suspense, h } from 'vue'
import { HEROES } from '../../../shared/constants/heroes'

// ── Nuxt auto-import + composable stubs ────────────────────────────
//
// profile/settings.vue is an async <script setup> (top-level awaits a
// useFetch for connected providers) that leans on definePageMeta,
// $fetch, navigateTo, the auth store (useUserSession) and ref/computed
// auto-imports. (@nuxt/test-utils isn't installed — this follows the
// project's vi.stubGlobal pattern from stores/auth.test.ts.)
//
// Globals are stubbed in beforeEach and removed via vi.unstubAllGlobals()
// in afterEach so they don't bleed into sibling component-project files.

import { createPinia, setActivePinia } from 'pinia'
import SettingsPage from '../../../app/pages/profile/settings.vue'

const mockNavigateTo = vi.fn()
const mockFetch = vi.fn()

// useFetch (providers list) — synchronous Nuxt-shaped result.
const providersRef = ref<unknown[]>([])
const mockRefreshProviders = vi.fn()

// Auth store backing session.
const mockUser = ref<Record<string, unknown> | null>(null)
const mockLoggedIn = ref(true)
const mockFetchSession = vi.fn()
const mockClearSession = vi.fn()

function stubNuxtGlobals() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('definePageMeta', () => {})
  vi.stubGlobal('navigateTo', mockNavigateTo)
  vi.stubGlobal('$fetch', mockFetch)
  vi.stubGlobal('useFetch', () => ({ data: providersRef, refresh: mockRefreshProviders }))
  vi.stubGlobal('useUserSession', () => ({
    loggedIn: mockLoggedIn,
    user: mockUser,
    fetch: mockFetchSession,
    clear: mockClearSession,
  }))
}

const FIRST_HERO = Object.keys(HEROES)[0]!

// HeroAvatar stub exposes its hero-id so we can assert selection.
async function mountSettings() {
  const wrapper = mount(
    defineComponent({
      render: () => h(Suspense, null, { default: () => h(SettingsPage) }),
    }),
    {
      global: {
        stubs: {
          TerminalPanel: {
            props: ['title'],
            template: '<section><h2>{{ title }}</h2><slot /></section>',
          },
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          ClientOnly: { template: '<div><slot /></div>' },
          HeroAvatar: {
            props: ['heroId', 'size'],
            template: '<span class="hero-avatar" :data-hero="heroId" />',
          },
          AsciiButton: {
            props: ['label', 'disabled', 'variant'],
            emits: ['click'],
            template:
              '<button :disabled="disabled" @click="$emit(\'click\', $event)">{{ label }}</button>',
          },
        },
      },
    },
  )
  await flushPromises()
  return wrapper
}

function buttonByLabel(wrapper: Awaited<ReturnType<typeof mountSettings>>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))!
}

const flush = () => flushPromises()

beforeEach(() => {
  stubNuxtGlobals()
  setActivePinia(createPinia())
  mockNavigateTo.mockReset()
  mockFetch.mockReset()
  mockRefreshProviders.mockReset()
  mockFetchSession.mockReset()
  mockClearSession.mockReset()
  providersRef.value = []
  mockUser.value = { username: 'currentname', selectedAvatar: '', hasPassword: true }
  mockLoggedIn.value = true
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('profile settings page', () => {
  describe('avatar', () => {
    it('renders a chooser button for every hero', async () => {
      const wrapper = await mountSettings()

      // Each hero gets a 48px chooser tile (plus possibly the 96px preview).
      const avatars = wrapper.findAll('.hero-avatar')
      expect(avatars.length).toBeGreaterThanOrEqual(Object.keys(HEROES).length)
    })

    it('saves the selected avatar then refreshes the session', async () => {
      mockFetch.mockResolvedValue({})
      const wrapper = await mountSettings()

      // Select the first hero tile.
      const tile = wrapper.findAll('button').find((b) => b.find('.hero-avatar').exists())!
      await tile.trigger('click')

      await buttonByLabel(wrapper, 'SAVE AVATAR').trigger('click')
      await flush()

      expect(mockFetch).toHaveBeenCalledWith('/api/player/settings', {
        method: 'PUT',
        body: { selectedAvatar: FIRST_HERO },
      })
      expect(mockFetchSession).toHaveBeenCalled()
      expect(wrapper.text()).toContain('Avatar updated')
    })

    it('shows an error message when the avatar save fails', async () => {
      mockFetch.mockRejectedValue({ data: { message: 'Avatar boom' } })
      const wrapper = await mountSettings()

      await buttonByLabel(wrapper, 'SAVE AVATAR').trigger('click')
      await flush()

      expect(wrapper.text()).toContain('Avatar boom')
    })
  })

  describe('username', () => {
    it('disables save while the username is unchanged', async () => {
      const wrapper = await mountSettings()

      const saveBtn = buttonByLabel(wrapper, 'SAVE USERNAME')
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })

    it('flags an invalid username and keeps save disabled', async () => {
      const wrapper = await mountSettings()

      await wrapper.find('input[autocomplete="username"]').setValue('no')

      expect(wrapper.text()).toContain('must be 3-20 characters')
      expect(buttonByLabel(wrapper, 'SAVE USERNAME').attributes('disabled')).toBeDefined()
    })

    it('enables save and persists a valid, changed username', async () => {
      mockFetch.mockResolvedValue({})
      const wrapper = await mountSettings()

      await wrapper.find('input[autocomplete="username"]').setValue('brandnew')
      const saveBtn = buttonByLabel(wrapper, 'SAVE USERNAME')
      expect(saveBtn.attributes('disabled')).toBeUndefined()

      await saveBtn.trigger('click')
      await flush()

      expect(mockFetch).toHaveBeenCalledWith('/api/player/settings', {
        method: 'PUT',
        body: { username: 'brandnew' },
      })
      expect(wrapper.text()).toContain('Username updated')
    })
  })

  describe('password', () => {
    it('asks for the current password when the account already has one', async () => {
      mockUser.value = { username: 'x', hasPassword: true }
      const wrapper = await mountSettings()

      expect(wrapper.text()).toContain('current password')
      expect(buttonByLabel(wrapper, 'CHANGE PASSWORD')).toBeTruthy()
    })

    it('hides current-password and offers SET PASSWORD when none exists', async () => {
      mockUser.value = { username: 'x', hasPassword: false }
      const wrapper = await mountSettings()

      expect(wrapper.text()).toContain('Set a password to enable credential login.')
      expect(wrapper.text()).not.toContain('current password')
      expect(buttonByLabel(wrapper, 'SET PASSWORD')).toBeTruthy()
    })

    it('keeps save disabled until new + confirm match and meet the length rule', async () => {
      mockUser.value = { username: 'x', hasPassword: false }
      const wrapper = await mountSettings()

      const save = () => buttonByLabel(wrapper, 'SET PASSWORD')
      expect(save().attributes('disabled')).toBeDefined()

      const pwInputs = wrapper.findAll('input[type="password"]')
      await pwInputs[0]!.setValue('short') // new
      await pwInputs[1]!.setValue('short') // confirm
      expect(wrapper.text()).toContain('5/8 chars required')
      expect(save().attributes('disabled')).toBeDefined()

      await pwInputs[0]!.setValue('longenough')
      await pwInputs[1]!.setValue('different')
      expect(wrapper.text()).toContain('passwords do not match')
      expect(save().attributes('disabled')).toBeDefined()

      await pwInputs[1]!.setValue('longenough')
      expect(save().attributes('disabled')).toBeUndefined()
    })

    it('submits a password change with the current + new passwords', async () => {
      mockUser.value = { username: 'x', hasPassword: true }
      mockFetch.mockResolvedValue({})
      const wrapper = await mountSettings()

      const pwInputs = wrapper.findAll('input[type="password"]')
      // [current, new, confirm]
      await pwInputs[0]!.setValue('oldpassword')
      await pwInputs[1]!.setValue('newpassword')
      await pwInputs[2]!.setValue('newpassword')

      await buttonByLabel(wrapper, 'CHANGE PASSWORD').trigger('click')
      await flush()

      expect(mockFetch).toHaveBeenCalledWith('/api/player/password', {
        method: 'PUT',
        body: { currentPassword: 'oldpassword', newPassword: 'newpassword' },
      })
      expect(wrapper.text()).toContain('Password changed')
    })
  })

  describe('connected accounts', () => {
    it('shows both providers as not connected when none are linked', async () => {
      providersRef.value = []
      const wrapper = await mountSettings()

      expect(wrapper.text()).toContain('GitHub')
      expect(wrapper.text()).toContain('Discord')
      expect(wrapper.text()).toContain('not connected')
      // both show CONNECT
      expect(wrapper.findAll('button').filter((b) => b.text().includes('CONNECT'))).toHaveLength(2)
    })

    it('shows the linked username and a disconnect button for a connected provider', async () => {
      providersRef.value = [
        {
          provider: 'github',
          providerId: '42',
          providerUsername: 'octocat',
          linkedAt: '2026-01-01',
        },
      ]
      const wrapper = await mountSettings()

      expect(wrapper.text()).toContain('connected as octocat')
      expect(buttonByLabel(wrapper, 'DISCONNECT')).toBeTruthy()
    })

    it('navigates to the OAuth connect endpoint for an unlinked provider', async () => {
      providersRef.value = []
      const wrapper = await mountSettings()

      // First CONNECT button is GitHub.
      await buttonByLabel(wrapper, 'CONNECT').trigger('click')

      expect(mockNavigateTo).toHaveBeenCalledWith('/api/auth/github', { external: true })
    })

    it('disconnects a linked provider and refreshes the list', async () => {
      providersRef.value = [
        {
          provider: 'discord',
          providerId: '7',
          providerUsername: 'disco',
          linkedAt: '2026-01-01',
        },
      ]
      mockFetch.mockResolvedValue({})
      const wrapper = await mountSettings()

      await buttonByLabel(wrapper, 'DISCONNECT').trigger('click')
      await flush()

      expect(mockFetch).toHaveBeenCalledWith('/api/player/providers/discord', { method: 'DELETE' })
      expect(mockRefreshProviders).toHaveBeenCalled()
      expect(wrapper.text()).toContain('discord disconnected')
    })
  })
})
