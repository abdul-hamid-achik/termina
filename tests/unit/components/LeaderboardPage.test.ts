import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed, defineComponent, Suspense, h, onMounted, onUnmounted } from 'vue'

// ── Nuxt auto-import stubs ─────────────────────────────────────────
//
// leaderboard.vue is an async <script setup> that top-level-awaits two
// useFetch() calls. We stub useFetch to hand back Nuxt-shaped reactive
// results synchronously, plus the ref/computed auto-imports. (@nuxt/
// test-utils is not installed; this mirrors the project's existing
// vi.stubGlobal pattern in stores/auth.test.ts.)
//
// Globals are stubbed in beforeEach and removed via vi.unstubAllGlobals()
// in afterEach so they don't bleed into sibling component-project files.

import LeaderboardPage from '../../../app/pages/leaderboard.vue'

interface FetchResult {
  data: ReturnType<typeof ref>
  status: ReturnType<typeof ref>
  refresh: ReturnType<typeof vi.fn>
}

// Per-mount queue of useFetch results, consumed in call order
// (leaderboard first, then active-games).
let fetchResults: FetchResult[] = []
const mockUseFetch = vi.fn(() => fetchResults.shift()!)

function stubNuxtGlobals() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useFetch', mockUseFetch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onUnmounted', onUnmounted)
}

function leaderboardResult(
  leaderboard: unknown[] | null,
  status: 'pending' | 'success' | 'error' = 'success',
): FetchResult {
  return {
    data: ref(leaderboard === null ? null : { leaderboard }),
    status: ref(status),
    refresh: vi.fn(),
  }
}

function activeResult(games: unknown[] | null): FetchResult {
  return {
    data: ref(games === null ? null : { games }),
    status: ref('success'),
    refresh: vi.fn(),
  }
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    rank: 1,
    id: 'p1',
    username: 'shroud',
    avatarUrl: null,
    mmr: 2400,
    gamesPlayed: 100,
    wins: 70,
    winRate: 70,
    ...overrides,
  }
}

function makeActiveGame(overrides: Record<string, unknown> = {}) {
  return {
    gameId: 'g1',
    tick: 90,
    radiantKills: 12,
    direKills: 8,
    radiantHeroes: ['echo', 'kernel'],
    direHeroes: ['daemon', 'regex'],
    ...overrides,
  }
}

// leaderboard.vue is async; mount it inside <Suspense> so the top-level
// awaits resolve before we assert.
async function mountLeaderboard() {
  const wrapper = mount(
    defineComponent({
      render: () => h(Suspense, null, { default: () => h(LeaderboardPage) }),
    }),
    {
      global: {
        stubs: {
          TerminalPanel: {
            props: ['title'],
            template: '<section><h2>{{ title }}</h2><slot /></section>',
          },
          NuxtLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
        },
      },
    },
  )
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  stubNuxtGlobals()
  mockUseFetch.mockClear()
  fetchResults = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('leaderboard page', () => {
  describe('leaderboard table', () => {
    it('renders a row per player with rating, wins, losses and win%', async () => {
      fetchResults = [
        leaderboardResult([
          makeEntry({
            rank: 1,
            id: 'p1',
            username: 'alpha',
            mmr: 2400,
            gamesPlayed: 100,
            wins: 70,
            winRate: 70,
          }),
          makeEntry({
            rank: 2,
            id: 'p2',
            username: 'bravo',
            mmr: 2200,
            gamesPlayed: 50,
            wins: 20,
            winRate: 40,
          }),
        ]),
        activeResult([]),
      ]
      const wrapper = await mountLeaderboard()

      const rows = wrapper.findAll('tbody tr')
      expect(rows).toHaveLength(2)

      const first = rows[0]!.text()
      expect(first).toContain('alpha')
      expect(first).toContain('2400')
      expect(first).toContain('70') // wins
      expect(first).toContain('30') // losses = 100 - 70
      expect(first).toContain('70%')
    })

    it('links each player to their profile', async () => {
      fetchResults = [
        leaderboardResult([makeEntry({ id: 'github_42', username: 'linus' })]),
        activeResult([]),
      ]
      const wrapper = await mountLeaderboard()

      const link = wrapper.find('tbody a')
      expect(link.attributes('href')).toBe('/profile/github_42')
      expect(link.text()).toBe('linus')
    })
  })

  describe('empty + loading states', () => {
    it('shows the empty message when there are no players', async () => {
      fetchResults = [leaderboardResult([]), activeResult([])]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).toContain('No players found.')
      expect(wrapper.find('tbody').exists()).toBe(false)
    })

    it('shows a loading indicator while the fetch is pending', async () => {
      fetchResults = [leaderboardResult(null, 'pending'), activeResult([])]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).toContain('Loading leaderboard')
      expect(wrapper.find('tbody').exists()).toBe(false)
    })
  })

  describe('live games panel', () => {
    it('is hidden entirely when no games are active', async () => {
      fetchResults = [leaderboardResult([makeEntry()]), activeResult([])]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).not.toContain('Live Games')
      expect(wrapper.text()).not.toContain('in progress')
    })

    it('lists active games with score, formatted time and a spectate link', async () => {
      fetchResults = [
        leaderboardResult([makeEntry()]),
        // tick 90 → 360s → 6:00
        activeResult([makeActiveGame({ gameId: 'abc', tick: 90, radiantKills: 12, direKills: 8 })]),
      ]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).toContain('Live Games')
      expect(wrapper.text()).toContain('1 game in progress')
      expect(wrapper.text()).toContain('6:00')
      expect(wrapper.text()).toContain('echo, kernel')

      const spectate = wrapper.findAll('a').find((a) => a.text().includes('spectate'))!
      expect(spectate.attributes('href')).toBe('/spectate/abc')
    })

    it('pluralizes the in-progress count for multiple games', async () => {
      fetchResults = [
        leaderboardResult([makeEntry()]),
        activeResult([makeActiveGame({ gameId: 'a' }), makeActiveGame({ gameId: 'b' })]),
      ]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).toContain('2 games in progress')
    })

    it('formats sub-minute tick times with a zero-padded seconds field', async () => {
      fetchResults = [
        leaderboardResult([makeEntry()]),
        // tick 8 → 32s → 0:32
        activeResult([makeActiveGame({ tick: 8 })]),
      ]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).toContain('0:32')
    })
  })
})
