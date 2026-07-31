import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import { useSettingsStore } from '~~/app/stores/settings'
import {
  makeCycleMessage,
  makeRoster,
  makePlayer,
  makeZone,
  SAMPLE_HEROES,
} from '~~/app/stories/fixtures'
import type { GameState, ZoneRuntimeState } from '~~/shared/types/game'
import { ULTIMATE_UNLOCK_LEVEL } from '~~/shared/constants/balance'

// ── useGameSocket mock ────────────────────────────────────────────────
// GameScreen calls useGameSocket() at setup and opens a real WebSocket in
// onMounted. Replace it with a no-op double exposing the same shape (reactive
// connection refs + connect/send/disconnect/onMessage) so mounting never
// touches the network. We capture the spies so tests can assert wiring.
const socketSpies = {
  connect: vi.fn(),
  // send() returns true when the message went out (socket open) — the happy
  // path for most tests; the disconnected case overrides it to false.
  send: vi.fn(() => true),
  disconnect: vi.fn(),
  onMessage: vi.fn(() => () => {}),
}
const socketRefs = {
  connected: ref(true),
  reconnecting: ref(false),
  connectionLost: ref(false),
  latency: ref(20),
}
vi.mock('~/composables/useGameSocket', () => ({
  useGameSocket: () => ({ ...socketRefs, ...socketSpies }),
}))

// requestAnimationFrame isn't in happy-dom by default; keep a synchronous shim
// for any child that schedules through it.
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0)
  return 0
})

// ── audio + layout doubles ────────────────────────────────────────────
// The real useAudio needs an AudioContext; record the cue names instead. The
// tick loop says a great deal through sound, so several tests assert on it.
const audio = vi.hoisted(() => ({ playSound: vi.fn() }))
vi.mock('~/composables/useAudio', () => ({ useAudio: () => audio }))

// R3-09 — CommandInput is stubbed (no real input focus), but GameScreen still
// holds a ref and calls `.focus()` after overlays close. Capture those calls.
const commandInputFocus = vi.hoisted(() => vi.fn())

// GameScreen measures the HUD bar to anchor the kill-feed / toast lanes;
// happy-dom ships no ResizeObserver, so capture the callback and drive it.
type ResizeCb = (entries: Array<{ contentRect: { height: number } }>) => void
let _resizeCb: ResizeCb | null = null
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(cb: ResizeCb) {
      _resizeCb = cb
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const mockStorage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => void mockStorage.set(key, value)),
  removeItem: vi.fn((key: string) => void mockStorage.delete(key)),
  clear: vi.fn(() => void mockStorage.clear()),
})

import GameScreen from '~~/app/components/game/GameScreen.vue'

// Stubs for every Nuxt auto-imported child (vitest has no auto-import). The
// data-testid-bearing markup the assertions care about (game-screen root,
// death-overlay, theater-header) lives in GameScreen's OWN template, so a slot-
// rendering TerminalPanel stub is enough to surface it. PostGame is the one
// child whose presence we assert directly, so it gets an identifiable stub.
const stubs = {
  TerminalPanel: {
    name: 'TerminalPanel',
    template: '<div class="terminal-panel-stub"><slot /></div>',
  },
  PostGame: {
    name: 'PostGame',
    props: ['winner', 'stats', 'players', 'currentPlayerId', 'gameId'],
    template: '<div data-testid="post-game-stub">post-game</div>',
  },
  GameStateBar: true,
  // StatusLines replaced the panel chrome (R3-08); surface its status texts so
  // the header assertions still hold under shallow stubbing.
  StatusLines: {
    name: 'StatusLines',
    props: ['trace', 'canAct', 'nextCycleIn', 'cycle', 'netLead', 'alive'],
    template:
      "<div data-testid=\"theater-header\">{{ !alive ? 'DOWN' : canAct ? 'AWAITING ORDERS' : 'RESOLVING' }}</div>",
  },
  Stream: {
    name: 'Stream',
    props: ['events'],
    template: '<div data-testid="stream" />',
  },
  KillFeed: true,
  Deck: true,
  // The rail trace (hop depth + contacts + terminals) — the board is gone.
  TraceRail: {
    name: 'TraceRail',
    props: ['trace'],
    template: '<div data-testid="trace-rail"><span data-testid="trace-current">hop</span></div>',
  },
  Scoreboard: true,
  ItemShop: true,
  InventoryBar: true,
  QuickBuy: true,
  // Expose focus() the way the real CommandInput does via defineExpose, so
  // GameScreen's commandInputRef.focus() path is testable (R3-09).
  CommandInput: {
    name: 'CommandInput',
    template: '<div data-testid="command-input" class="cmd-input-wrapper" />',
    setup(_: unknown, { expose }: { expose: (api: { focus: () => void }) => void }) {
      expose({ focus: () => commandInputFocus() })
      return {}
    },
  },
}

function mountGameScreen() {
  return mount(GameScreen, {
    attachTo: document.body,
    global: { stubs },
  })
}

/** Seed the store into a live, playing game where `p1` (chaff) is the human. */
function seedActiveGame(overrides: Partial<GameState> = {}) {
  const store = useGameStore()
  store.gameId = 'game_test_1'
  store.playerId = 'p1'
  store.updateFromCycle(makeCycleMessage(overrides))
  return store
}

/** The fixture roster with the human moved to `zone`. */
function rosterAt(zone: string) {
  const players = makeRoster()
  players.p1 = { ...players.p1!, zone }
  return players
}

/** The human standing in `zone` mid-walk, still headed for `moveTarget`. */
function rosterWalking(zone: string, moveTarget: string) {
  const players = rosterAt(zone)
  players.p1 = { ...players.p1!, moveTarget }
  return players
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockStorage.clear()
  for (const spy of Object.values(socketSpies)) spy.mockClear()
  audio.playSound.mockClear()
  commandInputFocus.mockClear()
  _resizeCb = null
  vi.mocked(localStorage.clear).mockClear()
  // Desktop default for R3-09: fine pointer so overlay-close reclaims the prompt.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('pointer: fine'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('GameScreen', () => {
  /**
   * R3-09 — prompt-primary on desktop. The real CommandInput refocuses after
   * its own submit; GameScreen reclaims the prompt after the last overlay
   * closes, gated on (pointer: fine).
   */

  describe('active game (game_screen_renders oracle)', () => {
    it('renders the active game screen (not the post-game screen) while playing', () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="game-screen"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="post-game-stub"]').exists()).toBe(false)
      // The seeded gameId is reflected onto the root for the e2e harness.
      expect(wrapper.find('[data-testid="game-screen"]').attributes('data-game-id')).toBe(
        'game_test_1',
      )
      wrapper.unmount()
    })

    it('connects the socket on mount with the store gameId + playerId', () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      expect(socketSpies.connect).toHaveBeenCalledWith('game_test_1', 'p1')
      wrapper.unmount()
    })

    it('renders the TraceRail header showing AWAITING ORDERS when the player can act', () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      const header = wrapper.find('[data-testid="theater-header"]')
      expect(header.exists()).toBe(true)
      // Alive + not yet acted this cycle → AWAITING ORDERS (see theaterStatus).
      expect(header.text()).toContain('AWAITING ORDERS')
      wrapper.unmount()
    })

    it('shows RESOLVING once the player has already acted this cycle', async () => {
      const store = seedActiveGame()
      store.markActionSent('move mid-river') // lastActionCycle === current tick
      const wrapper = mountGameScreen()

      const header = wrapper.find('[data-testid="theater-header"]')
      expect(header.text()).toContain('RESOLVING')
      expect(header.text()).not.toContain('AWAITING ORDERS')
      wrapper.unmount()
    })

    describe('HUD layout (setting A)', () => {
      it('keeps the status lines in the left column instead of the right rail', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        expect(wrapper.find('[data-testid="theater-header"]').exists()).toBe(true)
        expect(wrapper.find('.game-grid__rail [data-testid="zone-panel"]').exists()).toBe(false)
        wrapper.unmount()
      })

      it('the combat log is the centerpiece and the map a rail widget (one layout)', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        expect(wrapper.find('[data-testid="theater-header"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="center-map"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="rail-log"]').exists()).toBe(false)
        wrapper.unmount()
      })

      it('classic: the rail carries the trace (your route as hop depth)', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        const trace = wrapper.find('.game-grid__rail [data-testid="trace-rail"]')
        expect(trace.exists()).toBe(true)
        expect(wrapper.find('[data-testid="trace-current"]').exists()).toBe(true)
        wrapper.unmount()
      })

      it('classic: the trace leads the rail, above Deck', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        const rail = wrapper.find('.game-grid__rail').element
        const map = rail.querySelector('[data-testid="trace-rail"]')
        const hero = rail.querySelector('deck-stub')
        expect(map).not.toBeNull()
        expect(hero).not.toBeNull()
        // DOCUMENT_POSITION_FOLLOWING = the hero panel comes after the map.
        expect(map!.compareDocumentPosition(hero!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        wrapper.unmount()
      })
    })

    describe('HUD density & vitals (setting C)', () => {
      it('defaults to comfortable density', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        const root = wrapper.find('[data-testid="game-screen"]')
        expect(root.attributes('data-density')).toBe('comfortable')
        wrapper.unmount()
      })

      it('reflects compact density on the grid root', () => {
        localStorage.clear()
        useSettingsStore().setHud('density', 'compact')
        seedActiveGame()
        const wrapper = mountGameScreen()

        expect(wrapper.find('[data-testid="game-screen"]').attributes('data-density')).toBe(
          'compact',
        )
        wrapper.unmount()
      })
    })

    it('does not render the death overlay while the player is alive', () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="death-overlay"]').exists()).toBe(false)
      wrapper.unmount()
    })
  })
  describe('in-game a11y', () => {
    it('locks the ultimate button until it is actually learned', () => {
      // REGRESSION: R rendered as READY from level 1, promising a cast the
      // server always refused with "Ability not yet learned" (getAbilityLevel
      // returns rank 0 for R below ULTIMATE_UNLOCK_LEVEL). Nothing on screen
      // said why. Every other fixture seeds level 9, so this is the only test
      // that exercises the locked branch.
      const store = useGameStore()
      store.gameId = 'game_test_1'
      store.playerId = 'p1'
      const roster = makeRoster()
      roster.p1 = makePlayer({
        id: 'p1',
        name: 'you',
        heroId: SAMPLE_HEROES.echo,
        level: 1,
      })
      store.updateFromCycle(makeCycleMessage({ players: roster }))
      const wrapper = mountGameScreen()

      const r = wrapper.findAll('.hud-action-btn').find((b) => b.text().startsWith('R'))
      expect(r?.text()).toBe(`R·L${ULTIMATE_UNLOCK_LEVEL}`)
      expect(r?.attributes('aria-label')).toContain(`unlocks at level ${ULTIMATE_UNLOCK_LEVEL}`)
      expect(r?.attributes('aria-disabled')).toBe('true')
      wrapper.unmount()
    })

    it('shows the ultimate as available once the level requirement is met', () => {
      // The mirror of the case above — the default fixture is level 9, so R must
      // NOT be reported as locked (guards against an over-broad lock).
      seedActiveGame()
      const wrapper = mountGameScreen()

      const r = wrapper.findAll('.hud-action-btn').find((b) => b.text().startsWith('R'))
      expect(r?.text()).not.toContain(`L${ULTIMATE_UNLOCK_LEVEL}`)
      expect(r?.attributes('aria-label')).not.toContain('unlocks at level')
      wrapper.unmount()
    })

    it('exposes a11y state on the quick-action bar (aria-label + toggle aria-pressed)', () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      const btns = wrapper.findAll('.hud-action-btn')
      const shop = btns.find((b) => b.text() === 'SHOP')
      const score = btns.find((b) => b.text() === 'SCORE')
      expect(shop?.attributes('aria-label')).toBe('Toggle shop')
      expect(shop?.attributes('aria-pressed')).toBe('false')
      expect(score?.attributes('aria-pressed')).toBe('false')
      // ability buttons carry a descriptive label (name + state)
      const q = btns.find((b) => b.text().startsWith('Q'))
      expect(q?.attributes('aria-label')).toBeTruthy()
      wrapper.unmount()
    })

    it('puts the cooldown seconds in the ability aria label, not on the chip', () => {
      // The chip must stay narrow ("W·2") in the dense bar, so the wall-clock
      // meaning of a tick lives in the accessible name instead.
      seedActiveGame()
      const wrapper = mountGameScreen()

      // The fixture hero has W on a 2-tick cooldown.
      const w = wrapper.findAll('.hud-action-btn').find((b) => b.text().startsWith('W'))
      expect(w?.text()).toBe('W·2')
      expect(w?.attributes('aria-label')).toContain('on cooldown 2 cycles, about 8 seconds')
      wrapper.unmount()
    })

    it('opens the shop overlay as an accessible modal dialog', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      const shopBtn = wrapper.findAll('.hud-action-btn').find((b) => b.text() === 'SHOP')
      await shopBtn!.trigger('click')

      const dialog = wrapper.find('[role="dialog"][aria-label="Item shop"]')
      expect(dialog.exists()).toBe(true)
      expect(dialog.attributes('aria-modal')).toBe('true')
      wrapper.unmount()
    })
  })
  describe('map affordances (W2-8)', () => {
    /** The mid corridor plus a cache spot, so subset-map pruning is observable. */
    const CORRIDOR = [
      'chaff-base',
      'mid-t3-chaff',
      'mid-t2-chaff',
      'mid-t1-chaff',
      'mid-river',
      'cache-top',
    ]

    function seedMap(zone: string, overrides: Partial<GameState> = {}) {
      const store = useGameStore()
      store.gameId = 'game_map'
      store.playerId = 'p1'
      const players = makeRoster()
      players.p1 = { ...players.p1!, zone, moveTarget: null }
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const id of CORRIDOR) zones[id] = makeZone(id)
      store.updateFromCycle(makeCycleMessage({ cycle: 240, players, zones, ...overrides }))
      return store
    }

    it('renders the trace rail with the player route as hop depth', () => {
      seedMap('mid-river')
      const wrapper = mountGameScreen()
      expect(wrapper.find('[data-testid="trace-rail"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="trace-current"]').text()).toContain('hop')
      wrapper.unmount()
    })

    it('the trace still renders on a subset map (no phantom zones in the picker)', () => {
      // REGRESSION coverage moved to the [MOVE] picker test below — the picker
      // only ever offers on-map adjacent zones. Here the rail simply must render.
      seedMap('mid-river', { mapId: 'one_lane' })
      const wrapper = mountGameScreen()
      expect(wrapper.find('[data-testid="trace-rail"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('[MOVE] opens a picker of named adjacent zones instead of dumping slugs', async () => {
      // REGRESSION: it printed "Adjacent zones: mid-t1-chaff, cache-top, …" — raw
      // identifiers that appear nowhere else in the UI, and no way to act on them.
      seedMap('mid-t1-chaff')
      const wrapper = mountGameScreen()
      const moveBtn = wrapper.findAll('button').find((b) => b.text() === 'MOVE')!

      expect(wrapper.find('[data-testid="move-picker"]').exists()).toBe(false)
      await moveBtn.trigger('click')

      const picker = wrapper.find('[data-testid="move-picker"]')
      expect(picker.exists()).toBe(true)
      expect(picker.text()).toContain('Coldstore T2 (CHAFF)')
      expect(picker.text()).toContain('Coldstore Crossing')
      expect(picker.text()).not.toContain('mid-t2-chaff')
      wrapper.unmount()
    })

    it('[MOVE] picker actually moves', async () => {
      seedMap('mid-t1-chaff')
      const wrapper = mountGameScreen()
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'MOVE')!
        .trigger('click')

      socketSpies.send.mockClear()
      await wrapper.find('[data-testid="move-picker-mid-river"]').trigger('click')

      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'move', zone: 'mid-river' },
      })
      // The picker closes behind the order rather than covering the log.
      expect(wrapper.find('[data-testid="move-picker"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('offers only on-map zones in the picker on a subset map', async () => {
      seedMap('mid-river', { mapId: 'one_lane' })
      const wrapper = mountGameScreen()
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'MOVE')!
        .trigger('click')

      const picker = wrapper.find('[data-testid="move-picker"]')
      // mid-river's GLOBAL neighbours are mid-t1-chaff, mid-t1-audit, cache-top and
      // cache-bot — half of them do not exist in a one-lane game.
      expect(picker.findAll('button')).toHaveLength(2)
      expect(picker.text()).not.toMatch(/Cache/i)
      wrapper.unmount()
    })

    it('surfaces the queued walk with a live hop count and a stop control', async () => {
      seedMap('chaff-base')
      const wrapper = mountGameScreen()
      expect(wrapper.find('[data-testid="walk-strip"]').exists()).toBe(false)

      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'move mid-t1-chaff')
      await wrapper.vm.$nextTick()

      // chaff-base → mid-t3-chaff → mid-t2-chaff → mid-t1-chaff
      expect(wrapper.find('[data-testid="walk-strip"]').text()).toContain(
        'WALKING → Coldstore T1 (CHAFF) · 3t',
      )
      seedMap('mid-t3-chaff', { players: rosterWalking('mid-t3-chaff', 'mid-t1-chaff') })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="walk-strip"]').text()).toContain('· 2t')
      wrapper.unmount()
    })

    it('[stop] cancels the walk by re-ordering a move to where you stand', async () => {
      seedMap('chaff-base')
      const wrapper = mountGameScreen()
      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'move mid-t1-chaff')
      await wrapper.vm.$nextTick()

      // One hop later, mid-walk — the tick that frees the player to act again.
      seedMap('mid-t3-chaff', {
        cycle: 241,
        players: rosterWalking('mid-t3-chaff', 'mid-t1-chaff'),
      })
      await wrapper.vm.$nextTick()

      socketSpies.send.mockClear()
      await wrapper.find('[data-testid="walk-stop"]').trigger('click')

      // Ordering a move to your own zone is the stop: the server's BFS finds no
      // next hop and nulls moveTarget (resolveMovementPhase).
      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'move', zone: 'mid-t3-chaff' },
      })
      wrapper.unmount()
    })

    it('a stop order does not leave the current zone queued as a destination', async () => {
      // handleCommand remembers every move order locally (the server nulls
      // moveTarget on the last hop). Remembering a stop would make the NEXT
      // zone change narrate as progress back toward where you stopped.
      seedMap('mid-t3-chaff')
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'move mid-t3-chaff')
      await wrapper.vm.$nextTick()

      seedMap('mid-t2-chaff', { cycle: 241 })
      await wrapper.vm.$nextTick()

      const feed = (
        wrapper.findComponent({ name: 'Stream' }).props('events') as { text: string }[]
      ).map((e) => e.text)
      expect(feed.some((t) => t.includes('more to Mid Lane T3'))).toBe(false)
      wrapper.unmount()
    })
  })
})
describe('GameScreen overlay lanes', () => {
  const SFC = readFileSync(resolve(process.cwd(), 'app/components/game/GameScreen.vue'), 'utf8')

  it('positions both floating overlays off the measured bar height', () => {
    const killfeed = /\.game-grid__killfeed\s*\{([^}]*)\}/.exec(SFC)?.[1] ?? ''
    expect(killfeed).toContain('var(--hud-bar-h')
    expect(SFC).toMatch(/:deep\(\.announcement-toast\)\s*\{[^}]*var\(--hud-bar-h/)
  })

  // W2-10: the death scrim's own rule, which no mounted assertion can see —
  // scoped <style> is not applied by @vue/test-utils.
  it('lets the HUD show and work through the death scrim', () => {
    const scrim = /\.death-overlay\s*\{([^}]*)\}/.exec(SFC)?.[1] ?? ''

    expect(scrim).toMatch(/pointer-events:\s*none/)
    const alpha = Number(/--bg-overlay\)\s*\/\s*(\d*\.?\d+)\)/.exec(scrim)?.[1])
    expect(alpha).toBeLessThanOrEqual(0.4)
  })
})

/**
 * The responsive grid's content rows must stay collapsible. `.game-grid` is
 * `overflow: hidden; height: 100dvh`, so a px floor on a content row is taken
 * out of the LAST row — the command input, Q/W/E/R and the shop button — and on
 * a 375x667 phone that row was pushed clean off the bottom of the screen.
 * Anchored on the vitest root: under happy-dom `import.meta.url` is an http: URL.
 */
describe('GameScreen responsive grid', () => {
  const SFC = readFileSync(resolve(process.cwd(), 'app/components/game/GameScreen.vue'), 'utf8')

  // Every grid-template-rows in the file: the three .game-grid breakpoints plus
  // the rail's own two-row grid.
  const allRowDecls = [...SFC.matchAll(/grid-template-rows:([^;]*);/g)].map((m) => m[1]!)

  it('declares row templates for desktop, tablet and phone', () => {
    // Three .game-grid templates plus the rail's own.
    expect(allRowDecls.length).toBeGreaterThanOrEqual(3)
  })

  it('puts no px floor on any content row, at ANY breakpoint', () => {
    // Select by owner, not by position: the rail added its own template and an
    // index-based `it.each([0,1,2])` silently stopped covering the phone one.
    const gridDecls = [...SFC.matchAll(/\.game-grid\s*\{[^}]*grid-template-rows:([^;]*);/gs)].map(
      (m) => m[1]!,
    )
    expect(gridDecls.length).toBeGreaterThanOrEqual(3)
    for (const decl of gridDecls) {
      expect([...decl.matchAll(/minmax\(\s*(\d+)px/g)].map((m) => Number(m[1]))).toEqual([])
    }
  })

  it('still lets every content region scroll internally, so nothing needs a floor', () => {
    // The rail's lower half scrolls; the panel regions are TerminalPanels, whose
    // body is `flex-1 overflow-auto`.
    expect(SFC).toMatch(/\.rail-scroll\s*\{[^}]*overflow-y:\s*auto/s)
    const panel = readFileSync(
      resolve(process.cwd(), 'app/components/ui/TerminalPanel.vue'),
      'utf8',
    )
    expect(panel).toMatch(/flex-1 overflow-auto/)
  })

  it('keeps TRACE on screen: it gets its own row and never scrolls', () => {
    // Losing the route costs spatial sense; TRACE is pinned and does not scroll
    // away. The cap lives on the TRACK so DECK cannot steal the rail.
    expect(SFC).toMatch(
      /\.game-grid__rail\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*60%\)\s+minmax\(0,\s*1fr\)/s,
    )
    // Both children pinned so TRACE cannot shift DECK into the spatial slot.
    expect(SFC).toMatch(/\.rail-map\s*\{[^}]*grid-row:\s*1/s)
    expect(SFC).toMatch(/\.rail-scroll\s*\{[^}]*grid-row:\s*2/s)
    // Clipped: spilling would intercept taps on the action bar / SHOP / talents.
    expect(SFC).toMatch(/\.rail-map\s*\{[^}]*overflow:\s*hidden/s)
  })
})
