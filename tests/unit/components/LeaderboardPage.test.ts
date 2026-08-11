import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed, defineComponent, Suspense, h, onMounted, onUnmounted } from 'vue'
import { PLACEMENT_GAMES } from '~~/shared/constants/ranks'

// ── Nuxt auto-import stubs ─────────────────────────────────────────
//
// leaderboard.vue is an async <script setup> that top-level-awaits
// useFetch(). We stub useFetch to hand back a Nuxt-shaped reactive result
// synchronously, plus the ref/computed auto-imports. (@nuxt/test-utils is
// not installed; this mirrors the project's existing vi.stubGlobal pattern
// in stores/auth.test.ts.)
//
// Globals are stubbed in beforeEach and removed via vi.unstubAllGlobals()
// in afterEach so they don't bleed into sibling component-project files.

import LeaderboardPage from '~~/app/pages/leaderboard.vue'

interface FetchResult {
  data: ReturnType<typeof ref>
  status: ReturnType<typeof ref>
  refresh: ReturnType<typeof vi.fn>
}

// Per-mount queue of useFetch results, consumed in call order.
let fetchResults: FetchResult[] = []
const mockUseFetch = vi.fn(() => fetchResults.shift()!)

// The session user the page sees (null = anonymous viewer). Set per-test before
// mounting to exercise the "highlight my row" path.
let sessionUserId: string | null = null

function stubNuxtGlobals() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useFetch', mockUseFetch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onUnmounted', onUnmounted)
  vi.stubGlobal('useUserSession', () => ({
    user: ref(sessionUserId ? { id: sessionUserId } : null),
  }))
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

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    rank: 1,
    id: 'p1',
    username: 'shroud',
    avatarUrl: null,
    mmr: 2400,
    lifetimeMmr: 2400,
    rankTier: 'terminal',
    rankName: 'Terminal',
    gamesPlayed: 100,
    wins: 70,
    winRate: 70,
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
  sessionUserId = null
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
      fetchResults = [leaderboardResult([makeEntry({ id: 'github_42', username: 'linus' })])]
      const wrapper = await mountLeaderboard()

      const link = wrapper.find('tbody a')
      expect(link.attributes('href')).toBe('/profile/github_42')
      expect(link.text()).toBe('linus')
    })

    it('highlights the viewing player’s own row with a "you" marker', async () => {
      sessionUserId = 'p2'
      fetchResults = [
        leaderboardResult([
          makeEntry({ rank: 1, id: 'p1', username: 'alpha' }),
          makeEntry({ rank: 2, id: 'p2', username: 'me' }),
        ]),
      ]
      const wrapper = await mountLeaderboard()

      const rows = wrapper.findAll('tbody tr')
      // only my row is flagged
      expect(rows[0]!.attributes('data-self')).toBeUndefined()
      expect(rows[1]!.attributes('data-self')).toBe('true')
      expect(rows[1]!.text()).toContain('you')
    })

    it('flags no row when the viewer is anonymous or absent from the board', async () => {
      sessionUserId = null
      fetchResults = [
        leaderboardResult([makeEntry({ id: 'p1' }), makeEntry({ rank: 2, id: 'p2' })]),
      ]
      const wrapper = await mountLeaderboard()
      expect(wrapper.find('tbody tr[data-self="true"]').exists()).toBe(false)
    })

    it('exposes accessible table semantics (caption + scoped headers + row headers)', async () => {
      sessionUserId = null
      fetchResults = [leaderboardResult([makeEntry({ id: 'p1', username: 'alpha' })])]
      const wrapper = await mountLeaderboard()

      expect(wrapper.find('caption').text()).toContain('Top players')
      expect(wrapper.findAll('th[scope="col"]').length).toBe(7)
      const rowHeader = wrapper.find('tbody th[scope="row"]')
      expect(rowHeader.exists()).toBe(true)
      expect(rowHeader.text()).toContain('alpha')
    })
  })

  describe('empty + loading states', () => {
    it('explains the placement requirement when the ladder is empty', async () => {
      // An empty ladder is the DEFAULT state at launch, not an error: the board
      // lists only players past PLACEMENT_GAMES. "No players found." read as a
      // fault and left a new player with nothing to do about it.
      fetchResults = [leaderboardResult([])]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).toContain(`${PLACEMENT_GAMES} placement matches`)
      expect(wrapper.find('a[href="/lobby"]').exists()).toBe(true)
      expect(wrapper.find('tbody').exists()).toBe(false)
    })

    it('states the qualification bar in the header', async () => {
      fetchResults = [leaderboardResult([])]
      const wrapper = await mountLeaderboard()
      expect(wrapper.text()).toContain(`${PLACEMENT_GAMES} ranked matches to qualify`)
    })

    it('shows a loading indicator while the fetch is pending', async () => {
      fetchResults = [leaderboardResult(null, 'pending')]
      const wrapper = await mountLeaderboard()

      expect(wrapper.text()).toContain('Loading leaderboard')
      expect(wrapper.find('tbody').exists()).toBe(false)
    })
  })
})
