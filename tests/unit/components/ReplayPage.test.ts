import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, Suspense, h, nextTick, watchEffect } from 'vue'

// ── Nuxt auto-import stubs ─────────────────────────────────────────
// replay/[gameId].vue top-level-awaits two useFetch() calls and uses useRoute +
// watchEffect (Nuxt auto-imports). ref/computed/onUnmounted it imports from vue
// directly, so only the three auto-imports below need stubbing. (Mirrors the
// LeaderboardPage component-test pattern.)
import ReplayPage from '../../../app/pages/replay/[gameId].vue'

interface FetchResult {
  data: ReturnType<typeof ref>
  error?: ReturnType<typeof ref>
  pending?: ReturnType<typeof ref>
}

let fetchResults: FetchResult[] = []
const mockUseFetch = vi.fn(() => fetchResults.shift()!)

function stubNuxtGlobals() {
  vi.stubGlobal('useFetch', mockUseFetch)
  vi.stubGlobal('useRoute', () => ({ params: { gameId: 'g1' } }))
  vi.stubGlobal('watchEffect', watchEffect)
  vi.stubGlobal('definePageMeta', () => {}) // compiler macro — no-op in vitest
}

function replayResult(): FetchResult {
  return {
    data: ref({
      gameId: 'g1',
      savedAt: 0,
      state: {
        tick: 50,
        phase: 'ended',
        teams: {
          radiant: { kills: 10, towerKills: 2, gold: 0 },
          dire: { kills: 5, towerKills: 1, gold: 0 },
        },
        players: {
          p1: {
            id: 'p1',
            name: 'alice',
            team: 'radiant',
            heroId: 'echo',
            level: 6,
            gold: 5000,
            kills: 5,
            deaths: 2,
            assists: 3,
            alive: true,
            zone: 'mid-river',
          },
        },
        timeOfDay: 'day',
      },
      meta: { players: [{ playerId: 'p1', team: 'radiant', heroId: 'echo', mmr: 1500 }] },
      actions: [{ tick: 10, playerId: 'p1', command: { type: 'cast', ability: 'q' } }],
    }),
    error: ref(null),
    pending: ref(false),
  }
}

function framesResult(): FetchResult {
  return {
    data: ref({
      gameId: 'g1',
      totalTicks: 50,
      frames: [
        {
          tick: 0,
          teams: { radiant: { kills: 0, towerKills: 0 }, dire: { kills: 0, towerKills: 0 } },
          timeOfDay: 'day',
          players: {
            p1: {
              id: 'p1',
              hp: 600,
              maxHp: 600,
              mp: 300,
              maxMp: 300,
              level: 1,
              gold: 0,
              kills: 0,
              deaths: 0,
              assists: 0,
              alive: true,
              zone: 'radiant-base',
              items: [],
            },
          },
        },
      ],
      meta: { players: [{ playerId: 'p1', team: 'radiant', heroId: 'echo', mmr: 1500 }] },
    }),
  }
}

async function mountReplay() {
  const wrapper = mount(
    defineComponent({
      render: () => h(Suspense, null, { default: () => h(ReplayPage) }),
    }),
    { global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } },
  )
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  stubNuxtGlobals()
  mockUseFetch.mockClear()
  fetchResults = [replayResult(), framesResult()]
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('replay page', () => {
  it('renders the score banner + a player row from the replay data', async () => {
    const wrapper = await mountReplay()
    const text = wrapper.text()
    expect(text).toContain('10') // radiant kills
    expect(text).toContain('5') // dire kills
    expect(text).toContain('Echo') // hero name resolved
  })

  it('initialises the scrubber to the final tick', async () => {
    const wrapper = await mountReplay()
    expect(wrapper.text()).toContain('scrub: tick 50')
  })

  it('PLAY restarts from the top and auto-advances the scrubber, then PAUSE stops it', async () => {
    vi.useFakeTimers()
    const wrapper = await mountReplay()
    const play = wrapper.find('[data-testid="replay-play"]')
    expect(play.text()).toContain('PLAY')

    await play.trigger('click') // at the end (50) → restarts to 0 and plays
    expect(play.text()).toContain('PAUSE')
    expect(wrapper.text()).toContain('scrub: tick 0')

    vi.advanceTimersByTime(600)
    await nextTick()
    expect(wrapper.text()).toContain('scrub: tick 1')

    vi.advanceTimersByTime(600)
    await nextTick()
    expect(wrapper.text()).toContain('scrub: tick 2')

    await play.trigger('click') // pause
    expect(play.text()).toContain('PLAY')
    vi.advanceTimersByTime(600 * 5)
    await nextTick()
    expect(wrapper.text()).toContain('scrub: tick 2') // frozen after pause
  })
})
