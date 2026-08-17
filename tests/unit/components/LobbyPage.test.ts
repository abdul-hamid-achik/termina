import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useLobbyStore } from '~~/app/stores/lobby'

// ── useAudio double ─────────────────────────────────────────────────
// lobby.vue plays through the Web Audio synth (absent in happy-dom) —
// replaced with a spy so the audio cues become assertable.
const playSound = vi.fn()
vi.mock('~/composables/useAudio', () => ({
  useAudio: () => ({ playSound }),
}))

import LobbyPage from '~~/app/pages/lobby.vue'

const MY_ID = 'github_me'

const stubs = {
  TerminalPanel: { name: 'TerminalPanel', template: '<section><slot /></section>' },
  AnnouncementToast: true,
  // A real enough stub to click "cancel" on — the default auto-stub renders
  // as an opaque <match-queue-stub> with no way to fire its `cancel` emit
  // from a DOM trigger.
  MatchQueue: {
    name: 'MatchQueue',
    emits: ['cancel'],
    template: `<button data-testid="cancel-queue" @click="$emit('cancel')">CANCEL</button>`,
  },
  PartyPanel: true,
  GuildPanel: true,
  // Real enough to click: the mode selector and the practice launcher are only
  // reachable through the button's click emit.
  AsciiButton: {
    name: 'AsciiButton',
    props: ['label', 'variant', 'disabled'],
    emits: ['click'],
    template: `<button :disabled="disabled" @click="$emit('click', $event)">{{ label }}</button>`,
  },
  InlineError: {
    name: 'InlineError',
    props: ['message'],
    template: `<p v-if="message" data-testid="inline-error">{{ message }}</p>`,
  },
}

function mountLobby() {
  return mount(LobbyPage, { global: { stubs } })
}

/**
 * Route-aware $fetch: recovery/queue calls fail (keeping the page idle, as the
 * original blanket rejection did) while the practice launcher gets a real
 * response so its redirect is assertable.
 */
let apiCalls: Array<[string, { method?: string; body?: unknown }]>
const navigateTo = vi.fn()
const routerPush = vi.fn()
// Flips true once /api/queue/join-neon has been called — status-neon's stub
// response below switches from 'idle' to 'found' from that point on, so the
// tests don't need fake timers: useQueuePolling's very first (immediate,
// pre-interval) poll already sees the match.
let neonJoined = false

function apiFetch(url: string, opts: { method?: string; body?: unknown } = {}) {
  apiCalls.push([url, opts])
  if (url === '/api/game/practice') return Promise.resolve({ gameId: 'dev_1' })
  if (url === '/api/queue/join-neon') {
    neonJoined = true
    return Promise.resolve({ success: true, queueSize: 1 })
  }
  if (url === '/api/queue/status-neon') {
    return Promise.resolve(neonJoined ? { status: 'found', gameId: 'g_neon' } : { status: 'idle' })
  }
  if (url === '/api/queue/leave-neon') return Promise.resolve({ success: true })
  return Promise.reject(new Error('no session'))
}

const joinCalls = () => apiCalls.filter(([url]) => url === '/api/queue/join-neon')

describe('lobby page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    playSound.mockClear()
    apiCalls = []
    neonJoined = false
    navigateTo.mockReset()
    routerPush.mockReset()
    vi.stubGlobal('definePageMeta', () => {})
    vi.stubGlobal('useRouter', () => ({ push: routerPush }))
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('$fetch', vi.fn(apiFetch))
    vi.stubGlobal('useUserSession', () => ({
      loggedIn: ref(true),
      user: ref({ id: MY_ID }),
      fetch: vi.fn(),
      clear: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ticks only over the final three seconds of the countdown', async () => {
    // Kept for when a future Neon-backed draft/countdown wires
    // lobbyStore.startCountdown again — a quick-match today jumps straight
    // into a running game with no countdown, but the watch itself survives.
    const wrapper = mountLobby()
    await flushPromises()
    const lobby = useLobbyStore()

    lobby.countdown = 5
    await nextTick()
    lobby.countdown = 4
    await nextTick()
    expect(playSound).not.toHaveBeenCalledWith('cycle')

    for (const n of [3, 2, 1]) {
      lobby.countdown = n
      await nextTick()
    }
    expect(playSound.mock.calls.filter(([name]) => name === 'cycle')).toHaveLength(3)

    // 0 is the hand-off to the game screen, not a beat of its own.
    lobby.countdown = 0
    await nextTick()
    expect(playSound.mock.calls.filter(([name]) => name === 'cycle')).toHaveLength(3)
    wrapper.unmount()
  })

  describe('mode selector', () => {
    it('queues the full 5v5 by default', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      await wrapper.get('[data-testid="find-match"]').trigger('click')
      await flushPromises()

      expect(joinCalls()).toHaveLength(1)
      expect(joinCalls()[0]![1].body).toEqual({ mode: 'ranked_5v5' })
      wrapper.unmount()
    })

    it('queues the mode the player selected, not the default', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      await wrapper.get('[data-testid="mode-quick_3v3"]').trigger('click')
      await wrapper.get('[data-testid="find-match"]').trigger('click')
      await flushPromises()

      expect(joinCalls()).toHaveLength(1)
      expect(joinCalls()[0]![1].body).toEqual({ mode: 'quick_3v3' })
      wrapper.unmount()
    })

    it('marks exactly one mode as checked and moves the mark on selection', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      const checked = () =>
        wrapper
          .findAll('[data-testid^="mode-"]')
          .filter((b) => b.attributes('aria-checked') === 'true')
          .map((b) => b.attributes('data-testid'))

      expect(checked()).toEqual(['mode-ranked_5v5'])
      await wrapper.get('[data-testid="mode-1v1"]').trigger('click')
      expect(checked()).toEqual(['mode-1v1'])
      wrapper.unmount()
    })

    it('does not advertise a draft, and does not pin every mode at five a side', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      expect(wrapper.text().toLowerCase()).not.toContain('the full draft')
      expect(wrapper.get('[data-testid="mode-blurb"]').text()).toMatch(/five each/)
      expect(wrapper.get('[data-testid="mode-blurb"]').text()).toMatch(/no pick screen/)

      await wrapper.get('[data-testid="mode-quick_3v3"]').trigger('click')
      expect(wrapper.get('[data-testid="mode-blurb"]').text()).toMatch(/three each/)
      expect(wrapper.get('[data-testid="mode-blurb"]').text()).not.toMatch(/five each/)

      await wrapper.get('[data-testid="mode-1v1"]').trigger('click')
      expect(wrapper.get('[data-testid="mode-blurb"]').text()).toMatch(/one opponent/)
      expect(wrapper.get('[data-testid="mode-blurb"]').text()).not.toMatch(/five each/)
      wrapper.unmount()
    })

    it('advertises each map size from the zone set the mode actually resolves to', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      // Derived, not authored: the roadmap's "19-zone two-lane map" was stale —
      // TWO_LANE_ZONES has 22.
      expect(wrapper.get('[data-testid="mode-ranked_5v5"]').text()).toContain('3 lanes · 32 zones')
      expect(wrapper.get('[data-testid="mode-quick_3v3"]').text()).toContain('2 lanes · 22 zones')
      expect(wrapper.get('[data-testid="mode-1v1"]').text()).toContain('1 route · 11 zones')
      wrapper.unmount()
    })
  })

  describe('practice vs bots', () => {
    it('starts a practice game and jumps into it', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      await wrapper.get('[data-testid="lobby-practice"]').trigger('click')
      await flushPromises()

      // The bare @click hands the handler a click event; it must not travel to
      // the server as a hero id.
      expect(apiCalls.filter(([url]) => url === '/api/game/practice')).toEqual([
        ['/api/game/practice', { method: 'POST', body: {} }],
      ])
      expect(navigateTo).toHaveBeenCalledWith('/play?gameId=dev_1&tutorial=1&playerId=github_me')
      expect(joinCalls()).toHaveLength(0)
      wrapper.unmount()
    })
  })

  describe('quick-match queue (Neon-backed — the only path)', () => {
    it('joins over /api/queue/join-neon', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      await wrapper.get('[data-testid="find-match"]').trigger('click')
      await flushPromises()

      expect(apiCalls.some(([url]) => url === '/api/queue/join-neon')).toBe(true)
      wrapper.unmount()
    })

    it('navigates to /play once the status-neon poll reports found', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      await wrapper.get('[data-testid="find-match"]').trigger('click')
      await flushPromises()

      expect(apiCalls.some(([url]) => url === '/api/queue/status-neon')).toBe(true)
      expect(routerPush).toHaveBeenCalledWith('/play')
      wrapper.unmount()
    })

    it('leaves over /api/queue/leave-neon when cancelling from the searching screen', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      await wrapper.get('[data-testid="find-match"]').trigger('click')
      await flushPromises()
      // The join's own immediate status-neon poll already reported 'found'
      // (via the shared apiFetch stub) and navigated away by this point in
      // the OTHER test above — force back to 'searching' here so this test
      // can exercise cancel independently of that race.
      useLobbyStore().queueStatus = 'searching'
      await nextTick()

      await wrapper.get('[data-testid="cancel-queue"]').trigger('click')
      await flushPromises()

      expect(apiCalls.some(([url]) => url === '/api/queue/leave-neon')).toBe(true)
      wrapper.unmount()
    })
  })
})
