import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, onMounted, onUnmounted, reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import PlayPage from '~~/app/pages/play.vue'

// Each GameScreen instance connects in onMounted and disconnects in
// onUnmounted — so a mount is a channel subscription for the ids of the moment.
const subscriptions: string[] = []
const teardowns: string[] = []
const GameScreenStub = defineComponent({
  name: 'GameScreen',
  setup() {
    const game = useGameStore()
    const name = `game:${game.gameId}:p:${game.playerId}`
    onMounted(() => subscriptions.push(name))
    onUnmounted(() => teardowns.push(name))
    return () => h('div', { 'data-testid': 'screen' }, name)
  },
})

const route = reactive<{ query: Record<string, string> }>({ query: {} })
const sessionUser = ref<{ id: string } | null>(null)
const navigateTo = vi.fn()

function mountPlay() {
  return mount(PlayPage, { global: { stubs: { GameScreen: GameScreenStub } } })
}

/**
 * Playtest 3: [NEW PRACTICE] on the ended-session panel navigates /play →
 * /play?gameId=<new>. Same route, so the page is REUSED: the ids were read only
 * on mount and the old screen kept its old (guest) subscription.
 */
describe('/play', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    subscriptions.length = 0
    teardowns.length = 0
    navigateTo.mockReset()
    route.query = {}
    sessionUser.value = { id: 'guest_abc' }
    vi.stubGlobal('definePageMeta', () => {})
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('useUserSession', () => ({ user: sessionUser }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens a tutorial URL as the session player', async () => {
    route.query = { tutorial: '1', gameId: 'g1', playerId: 'guest_abc' }
    const w = mountPlay()
    await flushPromises()
    expect(subscriptions).toEqual(['game:g1:p:guest_abc'])
    w.unmount()
  })

  it('a new game on the same page re-subscribes as the CURRENT player', async () => {
    route.query = { tutorial: '1', gameId: 'g1', playerId: 'guest_abc' }
    const w = mountPlay()
    await flushPromises()

    // Signed in elsewhere; the launcher refreshed the session, then navigated
    // with the player the new game was created for.
    sessionUser.value = { id: 'github_7' }
    route.query = { tutorial: '1', gameId: 'g2', playerId: 'github_7' }
    await flushPromises()

    expect(teardowns).toContain('game:g1:p:guest_abc')
    expect(subscriptions.at(-1)).toBe('game:g2:p:github_7')
    expect(useGameStore().sessionEnded).toBeNull()
    expect(navigateTo).not.toHaveBeenCalled()
    w.unmount()
  })

  it('reloading an old guest practice after signing in shows the changed panel at once', async () => {
    sessionUser.value = { id: 'github_7' }
    route.query = { tutorial: '1', gameId: 'g_guest', playerId: 'guest_abc' }
    const w = mountPlay()
    await flushPromises()
    const game = useGameStore()
    expect(game.sessionEndReason).toBe('changed')
    expect(game.sessionEnded).toMatch(/signed in on another tab/)
    expect(navigateTo).not.toHaveBeenCalled()
    w.unmount()
  })

  it('sends a tab with nothing to open to the lobby', async () => {
    const w = mountPlay()
    await flushPromises()
    expect(navigateTo).toHaveBeenCalledWith('/lobby')
    w.unmount()
  })
})
