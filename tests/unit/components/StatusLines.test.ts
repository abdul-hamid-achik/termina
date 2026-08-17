import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusLines from '~~/app/components/game/StatusLines.vue'
import { buildTrace } from '~~/app/components/game/traceModel'
import type { TerminalState, TeamId } from '~~/shared/types/game'

const TERMINALS: Record<TeamId, TerminalState> = {
  chaff: { team: 'chaff', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
  audit: { team: 'audit', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function mountLines(over: Partial<Parameters<typeof mount>[0]> = {}) {
  const trace = buildTrace({
    playerZone: 'coldstore-t2-chaff',
    playerTeam: 'chaff',
    contacts: [],
    terminals: TERMINALS,
  })
  return mount(StatusLines, {
    props: {
      trace,
      hpFraction: 0.8,
      alive: true,
      cycle: 240,
      nextCommitAt: Date.now() + 3000,
      orderCommitted: false,
      gameOver: false,
      enemyCount: 0,
      allyHeadcount: 1,
      enemyIcePresent: false,
      hasReadyAbility: true,
      rigOpen: true,
      here: 'clear',
      verb: null,
      stripReady: false,
      move: 'Coldstore Crossing',
      ...(over.props as object | undefined),
    },
  })
}

describe('StatusLines', () => {
  beforeEach(() => {
    stubReducedMotion(false)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides the hop line in compact mode — TRACE already has it', () => {
    const wrapper = mountLines({ props: { compact: true } })
    expect(wrapper.find('[data-testid="status-hop"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="status-here"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="status-clock"]').exists()).toBe(true)
  })

  it('renders the hop status line (route, threat, recommendation)', () => {
    const wrapper = mountLines()
    const hop = wrapper.get('[data-testid="status-hop"]').text()
    expect(hop).toContain('hop 2/8')
    expect(hop).toContain('CLEAR')
  })

  it('renders the cycle recap: HERE, the verb, and named MOVE hops', () => {
    const wrapper = mountLines({
      props: {
        here: '2 hostile waves',
        verb: 'STRIP',
        stripReady: true,
        move: 'Coldstore Crossing ?',
      },
    })
    expect(wrapper.get('[data-testid="status-here"]').text()).toContain('HERE 2 hostile waves')
    expect(wrapper.get('[data-testid="status-verb"]').text()).toContain('STRIP')
    expect(wrapper.get('[data-testid="status-move"]').text()).toContain('Coldstore Crossing')
  })

  it('does NOT render a net lead — that lives in GameStateBar only (dupe fix)', () => {
    expect(mountLines().find('[data-testid="status-net"]').exists()).toBe(false)
  })

  it('reads off route when the player is off all three routes', () => {
    const trace = buildTrace({
      playerZone: 'hollow',
      playerTeam: 'chaff',
      contacts: [],
      terminals: TERMINALS,
    })
    const wrapper = mount(StatusLines, {
      props: {
        trace,
        hpFraction: 1,
        alive: true,
        cycle: 240,
        nextCommitAt: Date.now() + 3000,
        orderCommitted: false,
        gameOver: false,
        enemyCount: 0,
        allyHeadcount: 1,
        enemyIcePresent: false,
        hasReadyAbility: true,
        rigOpen: true,
        here: 'clear',
        verb: null,
        stripReady: false,
        move: '—',
      },
    })
    expect(wrapper.get('[data-testid="status-hop"]').text()).toContain('off route')
  })

  describe('the persistent cycle clock', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('renders MAIN open with the remaining seconds when no order is queued', () => {
      const wrapper = mountLines({
        props: { cycle: 184, nextCommitAt: Date.now() + 2700, orderCommitted: false },
      })
      const text = wrapper.get('[data-testid="status-clock"]').text()
      expect(text).toContain('CYCLE 184')
      expect(text).toContain('MAIN open')
      expect(text).toContain('RIG open')
      expect(text).toContain('2.7s')
    })

    it('marks MAIN spent when an order is queued for the cycle', () => {
      const wrapper = mountLines({
        props: { cycle: 184, nextCommitAt: Date.now() + 1400, orderCommitted: true },
      })
      const text = wrapper.get('[data-testid="status-clock"]').text()
      expect(text).toContain('CYCLE 184')
      expect(text).toContain('MAIN spent')
      expect(text).toContain('1.4s')
    })

    it('counts down as wall-clock time passes', async () => {
      const wrapper = mountLines({
        props: { cycle: 10, nextCommitAt: Date.now() + 4000, orderCommitted: false },
      })
      expect(wrapper.get('[data-testid="status-clock"]').text()).toContain('4.0s')

      vi.advanceTimersByTime(1500)
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-testid="status-clock"]').text()).toContain('2.5s')
    })

    it('clamps at zero once the commit time has passed', async () => {
      const wrapper = mountLines({
        props: { cycle: 10, nextCommitAt: Date.now() + 200, orderCommitted: false },
      })
      vi.advanceTimersByTime(2000)
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-testid="status-clock"]').text()).toContain('0.0s')
    })

    it('stops ticking once unmounted (no leaked interval)', () => {
      const wrapper = mountLines()
      const before = vi.getTimerCount()
      expect(before).toBeGreaterThan(0)
      wrapper.unmount()
      expect(vi.getTimerCount()).toBe(before - 1)
    })

    it('does not start a countdown interval when the game is already over', () => {
      mountLines({ props: { gameOver: true } })
      expect(vi.getTimerCount()).toBe(0)
    })

    it('ticks at 1Hz instead of 10Hz under prefers-reduced-motion', async () => {
      stubReducedMotion(true)
      const wrapper = mountLines({
        props: { cycle: 10, nextCommitAt: Date.now() + 4000, orderCommitted: false },
      })
      vi.advanceTimersByTime(100)
      await wrapper.vm.$nextTick()
      // Under reduced motion the interval is 1000ms, so a 100ms advance must
      // not have re-rendered the countdown yet.
      expect(wrapper.get('[data-testid="status-clock"]').text()).toContain('4.0s')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()
      // The 1Hz interval has now fired once (at the 1000ms mark) — one whole
      // second down from 4.0s.
      expect(wrapper.get('[data-testid="status-clock"]').text()).toContain('3.0s')
    })
  })
})
