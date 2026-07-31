import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, Suspense, h, nextTick, watchEffect } from 'vue'

// ── Nuxt auto-import stubs ─────────────────────────────────────────
// replay/[gameId].vue top-level-awaits two useFetch() calls and uses useRoute +
// watchEffect (Nuxt auto-imports). ref/computed/onUnmounted it imports from vue
// directly, so only the three auto-imports below need stubbing. (Mirrors the
// LeaderboardPage component-test pattern.)
import ReplayPage from '~~/app/pages/replay/[gameId].vue'
// Auto-imported by Nuxt in-app; register it explicitly for the test mount.
import PlayerScoreTable from '~~/app/components/game/PlayerScoreTable.vue'

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
        cycle: 50,
        phase: 'ended',
        teams: {
          chaff: { kills: 10, iceKills: 2, scrip: 0 },
          audit: { kills: 5, iceKills: 1, scrip: 0 },
        },
        players: {
          p1: {
            id: 'p1',
            name: 'alice',
            team: 'chaff',
            heroId: 'echo',
            level: 6,
            scrip: 5000,
            kills: 5,
            deaths: 2,
            assists: 3,
            alive: true,
            zone: 'mid-river',
          },
        },
        timeOfDay: 'day',
      },
      meta: { players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1500 }] },
      actions: [{ cycle: 10, playerId: 'p1', command: { type: 'cast', ability: 'q' } }],
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
          cycle: 0,
          teams: { chaff: { kills: 0, iceKills: 0 }, audit: { kills: 0, iceKills: 0 } },
          timeOfDay: 'day',
          players: {
            p1: {
              id: 'p1',
              integ: 600,
              maxInteg: 600,
              bw: 300,
              maxBw: 300,
              level: 1,
              scrip: 0,
              kills: 0,
              deaths: 0,
              assists: 0,
              alive: true,
              zone: 'chaff-base',
              items: [],
            },
          },
        },
      ],
      meta: { players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1500 }] },
    }),
  }
}

async function mountReplay() {
  const wrapper = mount(
    defineComponent({
      render: () => h(Suspense, null, { default: () => h(ReplayPage) }),
    }),
    {
      global: {
        components: { PlayerScoreTable },
        stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
      },
    },
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
  it('explains an unavailable replay with the server sentence and truthful retention copy', async () => {
    // REGRESSION: the notice said replays are "dropped on game-over", the exact
    // opposite of the endpoint's rule (403 until `phase === 'ended'`), and the
    // detail line read the FetchError's statusMessage — "Server Error" for any
    // error Nitro didn't give one, which blames the backend for a 403.
    fetchResults = [
      {
        data: ref(null),
        error: ref({
          statusCode: 403,
          statusMessage: 'Server Error',
          message: '[GET] "/api/replay/g1": 403',
          data: { statusCode: 403, message: 'Replay available after the game ends' },
        }),
        pending: ref(false),
      },
      { data: ref(null) },
    ]
    const wrapper = await mountReplay()
    const text = wrapper.text()

    expect(text).toContain('REPLAY UNAVAILABLE')
    expect(wrapper.find('[data-testid="replay-error-detail"]').text()).toBe(
      'Replay available after the game ends',
    )
    expect(text).not.toContain('Server Error')
    expect(text).not.toContain('dropped on game-over')
    expect(text).toContain('written when the game ends')
  })

  it('renders the score banner + a player row from the replay data', async () => {
    const wrapper = await mountReplay()
    const text = wrapper.text()
    expect(text).toContain('10') // chaff kills
    expect(text).toContain('5') // audit kills
    expect(text).toContain('Echo') // hero name resolved
  })

  it('initialises the scrubber to the final tick', async () => {
    const wrapper = await mountReplay()
    expect(wrapper.text()).toContain('scrub: cycle 50')
  })

  it('PLAY restarts from the top and auto-advances the scrubber, then PAUSE stops it', async () => {
    vi.useFakeTimers()
    const wrapper = await mountReplay()
    const play = wrapper.find('[data-testid="replay-play"]')
    expect(play.text()).toContain('PLAY')

    await play.trigger('click') // at the end (50) → restarts to 0 and plays
    expect(play.text()).toContain('PAUSE')
    expect(wrapper.text()).toContain('scrub: cycle 0')

    vi.advanceTimersByTime(600)
    await nextTick()
    expect(wrapper.text()).toContain('scrub: cycle 1')

    vi.advanceTimersByTime(600)
    await nextTick()
    expect(wrapper.text()).toContain('scrub: cycle 2')

    await play.trigger('click') // pause
    expect(play.text()).toContain('PLAY')
    vi.advanceTimersByTime(600 * 5)
    await nextTick()
    expect(wrapper.text()).toContain('scrub: cycle 2') // frozen after pause
  })

  it('renders key-moment markers and jumps the scrubber when one is clicked', async () => {
    // A multi-frame replay with a kill (cycle 5) and a ice fall (cycle 12).
    const frame = (cycle: number, rk: number, dk: number, rt: number, dt: number) => ({
      cycle,
      teams: { chaff: { kills: rk, iceKills: rt }, audit: { kills: dk, iceKills: dt } },
      timeOfDay: 'day' as const,
      players: {},
    })
    fetchResults = [
      replayResult(),
      {
        data: ref({
          gameId: 'g1',
          totalTicks: 12,
          frames: [frame(0, 0, 0, 0, 0), frame(5, 1, 0, 0, 0), frame(12, 1, 0, 1, 0)],
          meta: { players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1500 }] },
        }),
      },
    ]
    const wrapper = await mountReplay()

    const strip = wrapper.find('[data-testid="replay-key-moments"]')
    expect(strip.exists()).toBe(true)
    expect(wrapper.find('[data-testid="key-moment-fight"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="key-moment-ice"]').exists()).toBe(true)

    // scrubber initialises to the final cycle (12); clicking the fight jumps to 5
    expect(wrapper.text()).toContain('scrub: cycle 12')
    await wrapper.find('[data-testid="key-moment-fight"]').trigger('click')
    expect(wrapper.text()).toContain('scrub: cycle 5')
  })

  it('shows the net-worth scrip lead derived from the current frame', async () => {
    const fp = (id: string, scrip: number) => ({
      id,
      integ: 600,
      maxInteg: 600,
      bw: 300,
      maxBw: 300,
      level: 6,
      scrip,
      kills: 0,
      deaths: 0,
      assists: 0,
      alive: true,
      zone: 'mid-river',
      items: [] as (string | null)[],
    })
    // Teams are grouped by the snapshot meta, so it must carry both players.
    const snapshot = replayResult()
    ;(snapshot.data.value as { meta: { players: unknown[] } }).meta = {
      players: [
        { playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1500 },
        { playerId: 'd1', team: 'audit', heroId: 'daemon', mmr: 1500 },
      ],
    }
    fetchResults = [
      snapshot,
      {
        data: ref({
          gameId: 'g1',
          totalTicks: 1,
          frames: [
            {
              cycle: 0,
              teams: { chaff: { kills: 0, iceKills: 0 }, audit: { kills: 0, iceKills: 0 } },
              timeOfDay: 'day' as const,
              // chaff 3000sc vs audit 1000sc → chaff +2000 net worth
              players: { p1: fp('p1', 3000), d1: fp('d1', 1000) },
            },
          ],
          meta: {
            players: [
              { playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1500 },
              { playerId: 'd1', team: 'audit', heroId: 'daemon', mmr: 1500 },
            ],
          },
        }),
      },
    ]
    const wrapper = await mountReplay()
    const leadEl = wrapper.find('[data-testid="replay-scrip-lead"]')
    expect(leadEl.exists()).toBe(true)
    expect(leadEl.text()).toContain('CHAFF')
    expect(leadEl.text()).toContain('2.0k') // 3000 − 1000 = 2000
  })
})
