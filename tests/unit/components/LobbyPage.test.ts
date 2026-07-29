import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useLobbyStore } from '../../../app/stores/lobby'

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

import LobbyPage from '../../../app/pages/lobby.vue'

const MY_ID = 'github_me'

const stubs = {
  TerminalPanel: { name: 'TerminalPanel', template: '<section><slot /></section>' },
  AnnouncementToast: true,
  HeroPicker: true,
  MatchQueue: true,
  PartyPanel: true,
  GuildPanel: true,
  AsciiButton: true,
}

function mountLobby() {
  return mount(LobbyPage, { global: { stubs } })
}

describe('lobby page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    playSound.mockClear()
    vi.stubGlobal('definePageMeta', () => {})
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    // Recovery on mount hits /api/queue/status; rejecting keeps the page idle.
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('no session')))
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
    expect(playSound).not.toHaveBeenCalledWith('tick')

    for (const n of [3, 2, 1]) {
      lobby.countdown = n
      await nextTick()
    }
    expect(playSound.mock.calls.filter(([name]) => name === 'tick')).toHaveLength(3)

    // 0 is the hand-off to the game screen, not a beat of its own.
    lobby.countdown = 0
    await nextTick()
    expect(playSound.mock.calls.filter(([name]) => name === 'tick')).toHaveLength(3)
    wrapper.unmount()
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
