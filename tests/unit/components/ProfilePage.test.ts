import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed, defineComponent, Suspense, h } from 'vue'

// profile/[id].vue uses an explicit Pinia store (useAuthStore) — mock the module
// — plus auto-imported useRoute/useFetch/computed. (Mirrors the LeaderboardPage /
// ReplayPage component-test patterns.)
let viewerId = 'viewer' // the logged-in user viewing the profile
vi.mock('~/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: viewerId } }),
}))

import ProfilePage from '../../../app/pages/profile/[id].vue'

interface FetchResult {
  data: ReturnType<typeof ref>
  status?: ReturnType<typeof ref>
}
let fetchResults: FetchResult[] = []
const mockUseFetch = vi.fn(() => fetchResults.shift()!)

let routeId = 'p1'

function stubGlobals() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useFetch', mockUseFetch)
  vi.stubGlobal('useRoute', () => ({ params: { id: routeId } }))
}

function profileResult(): FetchResult {
  return {
    data: ref({
      player: {
        id: 'p1',
        username: 'alice',
        avatarUrl: null,
        selectedAvatar: null,
        mmr: 1800,
        gamesPlayed: 10,
        wins: 7,
        createdAt: '2026-01-01T00:00:00Z',
      },
      heroStats: [
        {
          heroId: 'echo',
          gamesPlayed: 8,
          wins: 5,
          totalKills: 40,
          totalDeaths: 10,
          totalAssists: 20,
        },
      ],
    }),
    status: ref('success'),
  }
}

function matchesResult(): FetchResult {
  return {
    data: ref({
      matches: [
        {
          id: 'm1',
          mode: 'ranked_5v5',
          winner: 'radiant',
          team: 'radiant',
          durationTicks: 150,
          createdAt: '2026-01-02T00:00:00Z',
        },
      ],
    }),
  }
}

async function mountProfile() {
  const wrapper = mount(
    defineComponent({
      render: () => h(Suspense, null, { default: () => h(ProfilePage) }),
    }),
    {
      global: {
        stubs: {
          TerminalPanel: {
            props: ['title'],
            template: '<section><h2>{{ title }}</h2><slot /></section>',
          },
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          ClientOnly: { template: '<slot />' },
          HeroAvatar: { props: ['heroId', 'size'], template: '<span class="avatar" />' },
        },
      },
    },
  )
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  viewerId = 'viewer'
  routeId = 'p1'
  stubGlobals()
  mockUseFetch.mockClear()
  fetchResults = [profileResult(), matchesResult()]
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('profile page', () => {
  it('renders the whois line and W/L record', async () => {
    const wrapper = await mountProfile()
    const text = wrapper.text()
    expect(text).toContain('whois alice')
    expect(text).toContain('7W')
    expect(text).toContain('3L') // 10 - 7
    expect(text).toContain('70.0%')
  })

  it('renders the Most Played Heroes panel with win% and KDA', async () => {
    const wrapper = await mountProfile()
    const text = wrapper.text()
    expect(text).toContain('Most Played Heroes')
    expect(text).toContain('Echo') // hero name resolved
    expect(text).toContain('63%') // 5/8 = 62.5 → 63
    expect(text).toContain('6') // KDA (40+20)/10
  })

  it('links each most-played hero to its training console', async () => {
    const wrapper = await mountProfile()
    expect(wrapper.find('a[href="/heroes?hero=echo"]').exists()).toBe(true)
  })

  it('formats recent matches: friendly mode + perspective result', async () => {
    const wrapper = await mountProfile()
    const text = wrapper.text()
    expect(text).toContain('Ranked 5v5') // formatGameMode
    expect(text).toContain('Victory') // radiant winner + radiant team
  })

  it('shows the [EDIT] link only on your own profile', async () => {
    const otherView = await mountProfile()
    expect(otherView.find('a[href="/profile/settings"]').exists()).toBe(false)

    // now view as the profile owner
    viewerId = 'p1'
    fetchResults = [profileResult(), matchesResult()]
    const ownView = await mountProfile()
    expect(ownView.find('a[href="/profile/settings"]').exists()).toBe(true)
  })
})
