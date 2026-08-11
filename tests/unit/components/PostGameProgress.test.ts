import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PostGame from '~~/app/components/lobby/PostGame.vue'
import { makePlayerEndStats, SAMPLE_HEROES } from '~~/app/stories/fixtures'
import type { TeamId } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'

/**
 * The progression half of the post-game screen: net worth (not the wallet
 * balance), CS, and the coaching panel driven off them. Stubs mirror
 * PostGame.test.ts — the components project has no Nuxt auto-import pass.
 */
const AsciiButtonStub = {
  name: 'AsciiButton',
  props: ['label', 'variant', 'disabled'],
  emits: ['click'],
  template: `<button :disabled="disabled" @click="$emit('click', $event)">{{ label }}</button>`,
}

const TerminalPanelStub = {
  name: 'TerminalPanel',
  props: ['title', 'variant'],
  template: `<section><h3 v-if="title">{{ title }}</h3><slot /></section>`,
}

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: `<a :href="to"><slot /></a>`,
}

const ME = { id: 'p1', name: 'you', heroId: SAMPLE_HEROES.echo, team: 'chaff' as TeamId }
const THEM = { id: 'e1', name: 'them', heroId: SAMPLE_HEROES.daemon, team: 'audit' as TeamId }

/** A stat line with nothing for the coach to complain about. */
function cleanStats(over: Partial<PlayerEndStats> = {}): PlayerEndStats {
  return makePlayerEndStats({
    kills: 9,
    deaths: 1,
    assists: 7,
    scrip: 200,
    netWorth: 12_400,
    lastHits: 90,
    burns: 6,
    ...over,
  })
}

function mountPostGame(props: Record<string, unknown> = {}) {
  return mount(PostGame, {
    props: {
      winner: 'chaff' as TeamId,
      stats: { p1: cleanStats(), e1: cleanStats() },
      players: [ME, THEM],
      currentPlayerId: 'p1',
      ...props,
    },
    global: {
      stubs: {
        AsciiButton: AsciiButtonStub,
        TerminalPanel: TerminalPanelStub,
        NuxtLink: NuxtLinkStub,
      },
    },
  })
}

/** The advice ids rendered, in order. */
function adviceIds(wrapper: ReturnType<typeof mountPostGame>): string[] {
  return wrapper.findAll('[data-advice]').map((el) => el.attributes('data-advice')!)
}

describe('PostGame — net worth', () => {
  it('reports net worth, not the unspent wallet balance', () => {
    // REGRESSION: the tile used to read `scrip`, so the player who converted
    // every coin into items showed the LOWEST number on the board.
    const wrapper = mountPostGame({
      stats: { p1: cleanStats({ scrip: 200, netWorth: 12_400 }), e1: cleanStats() },
    })
    const tile = wrapper.get('[data-testid="my-net-worth"]')
    expect(tile.text()).toContain('Net Worth')
    expect(tile.text()).toContain('12,400')
    expect(tile.text()).not.toContain('200')
    expect(wrapper.text()).not.toContain('Gold Earned')
  })

  it('ranks the scoreboard by net worth so the big spender is not last', () => {
    const spender = cleanStats({ scrip: 150, netWorth: 14_000 })
    const hoarder = cleanStats({ scrip: 5000, netWorth: 5000 })
    const wrapper = mountPostGame({ stats: { p1: spender, e1: hoarder } })
    const rows = wrapper.findAll('tbody tr').map((r) => r.text())
    expect(rows[0]).toContain('14,000')
    expect(rows[1]).toContain('5,000')
  })

  it('falls back to the wallet balance when the server sent no net worth', () => {
    const legacy = makePlayerEndStats({ scrip: 6200, netWorth: undefined })
    const wrapper = mountPostGame({ stats: { p1: legacy, e1: legacy } })
    expect(wrapper.get('[data-testid="my-net-worth"]').text()).toContain('6,200')
  })
})

describe('PostGame — CS', () => {
  it('shows last hits and burns for the player and in every scoreboard row', () => {
    const wrapper = mountPostGame({
      stats: { p1: cleanStats({ lastHits: 87, burns: 12 }), e1: cleanStats({ lastHits: 41 }) },
    })
    const mine = wrapper.get('[data-testid="my-cs"]')
    expect(mine.text()).toContain('87')
    expect(mine.text()).toContain('12')

    const headers = wrapper.findAll('th[scope="col"]').map((h) => h.text())
    expect(headers).toContain('CS')
    expect(wrapper.findAll('tbody tr')[1]!.text()).toContain('41')
  })

  it('states CS as a rate once the match length is known', () => {
    // 60 CS over 10 minutes (150 ticks × 4s) = 6.0/min.
    const wrapper = mountPostGame({
      durationCycles: 150,
      stats: { p1: cleanStats({ lastHits: 60 }), e1: cleanStats() },
    })
    expect(wrapper.get('[data-testid="my-cs"]').text()).toContain('6.0/min')
  })

  it('omits the rate when the match length was not sent', () => {
    expect(mountPostGame().get('[data-testid="my-cs"]').text()).not.toContain('/min')
  })
})

describe('PostGame — what to work on', () => {
  it('calls out deaths with the retreat command', () => {
    const wrapper = mountPostGame({
      stats: { p1: cleanStats({ deaths: 9 }), e1: cleanStats() },
    })
    const panel = wrapper.get('[data-testid="what-to-work-on"]')
    expect(adviceIds(wrapper)[0]).toBe('deaths')
    expect(panel.text()).toContain('You died 9 times')
    expect(panel.text()).toContain('move base')
  })

  it('judges farm by rate, so the same CS total reads differently at 10m and 40m', () => {
    // 30 last hits: 3.0/min over 10 minutes is fine; 0.75/min over 40 is not.
    const stats = { p1: cleanStats({ lastHits: 30 }), e1: cleanStats() }
    const short = mountPostGame({ durationCycles: 150, stats })
    const long = mountPostGame({ durationCycles: 600, stats })

    expect(adviceIds(short)).not.toContain('last-hits')
    expect(adviceIds(long)).toContain('last-hits')
    expect(long.get('[data-advice="last-hits"]').text()).toContain('0.8/min')
    expect(long.get('[data-advice="last-hits"]').text()).toContain('attack wave:0')
  })

  it('teaches denying to a player who never burned', () => {
    const wrapper = mountPostGame({
      stats: { p1: cleanStats({ burns: 0 }), e1: cleanStats() },
    })
    expect(adviceIds(wrapper)).toContain('burns')
    expect(wrapper.get('[data-advice="burns"]').text()).toContain('burn wave:0')
  })

  it('tells a hoarder to spend', () => {
    const wrapper = mountPostGame({
      stats: { p1: cleanStats({ scrip: 4200 }), e1: cleanStats() },
    })
    expect(wrapper.get('[data-advice="unspent"]').text()).toContain('4,200')
  })

  it('never renders an empty panel — a clean game gets a next step', () => {
    const ids = adviceIds(mountPostGame({ durationCycles: 300 }))
    expect(ids).toEqual(['next'])
  })

  it('shows at most three items so the panel stays readable', () => {
    const wrapper = mountPostGame({
      durationCycles: 600,
      stats: {
        p1: cleanStats({ deaths: 11, lastHits: 4, burns: 0, scrip: 9000 }),
        e1: cleanStats(),
      },
    })
    expect(adviceIds(wrapper)).toEqual(['deaths', 'last-hits', 'burns'])
  })

  it('links out to the basics', () => {
    expect(mountPostGame().find('a[href="/learn"]').exists()).toBe(true)
  })

  it('hides the whole panel when the player has no stats at all', () => {
    const wrapper = mountPostGame({ currentPlayerId: 'ghost' })
    expect(wrapper.find('[data-testid="what-to-work-on"]').exists()).toBe(false)
    // …but the result itself still renders rather than stranding the player.
    expect(wrapper.text()).toContain('CHAFF VICTORY')
  })

  it('renders a result with no stats payload at all', () => {
    const wrapper = mountPostGame({ stats: undefined })
    expect(wrapper.text()).toContain('CHAFF VICTORY')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })
})

describe('PostGame — practice this', () => {
  const navigate = vi.fn()
  const fetchMock = vi.fn().mockResolvedValue({ url: '/game/dev_1' })

  beforeEach(() => {
    navigate.mockClear()
    fetchMock.mockClear()
    fetchMock.mockResolvedValue({ gameId: 'dev_1' })
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('$fetch', fetchMock)
    // useStartTutorial's launch() reads the session for the playerId it
    // appends to the built /play URL.
    vi.stubGlobal('useUserSession', () => ({ user: { value: null }, fetch: vi.fn() }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts a practice game straight from the coaching panel', async () => {
    const wrapper = mountPostGame({ stats: { p1: cleanStats({ deaths: 9 }), e1: cleanStats() } })
    await wrapper.get('[data-testid="practice-this-btn"]').trigger('click')
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledWith('/api/game/practice', expect.anything())
    expect(navigate).toHaveBeenCalledWith('/play?gameId=dev_1&tutorial=1')
  })

  it('does not offer practice at the end of a practice game', () => {
    const wrapper = mountPostGame({ mode: 'tutorial' })
    expect(wrapper.find('[data-testid="practice-this-btn"]').exists()).toBe(false)
  })
})
