import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useLobbyStore } from '~~/app/stores/lobby'

// ── useGameSocket / useAudio doubles ──────────────────────────────────
// lobby.vue opens a real WebSocket in onMounted and plays through the Web
// Audio synth (absent in happy-dom). Both are replaced with spies so mounting
// stays offline and the audio cues become assertable. Mirrors GameScreen.test.
const socketSpies = {
  connect: vi.fn(),
  send: vi.fn(() => true),
  disconnect: vi.fn(),
  onMessage: vi.fn(() => () => {}),
}
vi.mock('~/composables/useGameSocket', () => ({
  useGameSocket: () => ({ connected: ref(true), ...socketSpies }),
}))

const playSound = vi.fn()
vi.mock('~/composables/useAudio', () => ({
  useAudio: () => ({ playSound }),
}))

import LobbyPage from '~~/app/pages/lobby.vue'

const MY_ID = 'github_me'

const stubs = {
  TerminalPanel: { name: 'TerminalPanel', template: '<section><slot /></section>' },
  AnnouncementToast: true,
  HeroPicker: true,
  MatchQueue: true,
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

function apiFetch(url: string, opts: { method?: string; body?: unknown } = {}) {
  apiCalls.push([url, opts])
  if (url === '/api/game/tutorial') return Promise.resolve({ url: '/play?gameId=dev_1&tutorial=1' })
  return Promise.reject(new Error('no session'))
}

const joinCalls = () => apiCalls.filter(([url]) => url === '/api/queue/join')

describe('lobby page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    playSound.mockClear()
    apiCalls = []
    navigateTo.mockReset()
    vi.stubGlobal('definePageMeta', () => {})
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
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

  it('plays the ready cue when a match is found', async () => {
    const wrapper = mountLobby()
    await flushPromises()
    playSound.mockClear()

    useLobbyStore().matchFound('lobby-1')
    await nextTick()

    expect(playSound).toHaveBeenCalledWith('ready')
    wrapper.unmount()
  })

  it('plays the ready cue when the draft turn becomes mine, not on someone else’s', async () => {
    const wrapper = mountLobby()
    await flushPromises()
    const lobby = useLobbyStore()

    lobby.setPickTurn('github_other', 'other', 15000)
    await nextTick()
    expect(playSound).not.toHaveBeenCalledWith('ready')

    lobby.setPickTurn(MY_ID, 'me', 15000)
    await nextTick()
    expect(playSound).toHaveBeenCalledWith('ready')
    wrapper.unmount()
  })

  it('ticks only over the final three seconds of the countdown', async () => {
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

  describe('draft hand-off', () => {
    it('tells the picker the player has never finished the tutorial', async () => {
      vi.stubGlobal('useUserSession', () => ({
        loggedIn: ref(true),
        user: ref({ id: MY_ID, tutorialCompleted: false }),
        fetch: vi.fn(),
        clear: vi.fn(),
      }))
      const wrapper = mountLobby()
      await flushPromises()

      useLobbyStore().queueStatus = 'picking'
      await nextTick()

      // The picker uses this to pre-select a beginner hero; without it a
      // first-timer's 15s draft ends in an auto-random.
      expect(wrapper.get('hero-picker-stub').attributes('new-player')).toBe('true')
      wrapper.unmount()
    })
  })

  describe('practice vs bots', () => {
    it('starts a tutorial game and jumps into it', async () => {
      const wrapper = mountLobby()
      await flushPromises()

      await wrapper.get('[data-testid="lobby-practice"]').trigger('click')
      await flushPromises()

      // The bare @click hands the handler a click event; it must not travel to
      // the server as a hero id.
      expect(apiCalls.filter(([url]) => url === '/api/game/tutorial')).toEqual([
        ['/api/game/tutorial', { method: 'POST', body: {} }],
      ])
      expect(navigateTo).toHaveBeenCalledWith('/play?gameId=dev_1&tutorial=1')
      expect(joinCalls()).toHaveLength(0)
      wrapper.unmount()
    })
  })

  it('pops the countdown digit each second instead of blinking it out of sight', async () => {
    const wrapper = mountLobby()
    await flushPromises()
    const lobby = useLobbyStore()
    lobby.allPicksComplete()
    lobby.countdown = 3
    await nextTick()

    const digit = wrapper.get('[data-testid="countdown-digit"]')
    expect(digit.text()).toBe('3')
    expect(digit.classes()).toContain('anim-pop')
    // animate-blink is a 1s step-end infinite loop: it left the digit fully
    // transparent for half of every second, reading as a broken countdown.
    expect(digit.classes()).not.toContain('animate-blink')

    // Re-keyed per second so the pop animation replays rather than running once.
    const firstKey = digit.element
    lobby.countdown = 2
    await nextTick()
    const next = wrapper.get('[data-testid="countdown-digit"]')
    expect(next.text()).toBe('2')
    expect(next.element).not.toBe(firstKey)
    wrapper.unmount()
  })
})
