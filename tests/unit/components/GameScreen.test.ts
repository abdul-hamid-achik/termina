import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../../app/stores/game'
import { useSettingsStore } from '../../../app/stores/settings'
import {
  makeTickMessage,
  makeRoster,
  makePlayer,
  makePlayerEndStats,
  SAMPLE_HEROES,
} from '../../../app/stories/fixtures'

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

// requestAnimationFrame isn't in happy-dom by default; the screen-shake helper
// schedules through it. A synchronous shim keeps any event-driven shake safe.
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0)
  return 0
})

const mockStorage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => void mockStorage.set(key, value)),
  removeItem: vi.fn((key: string) => void mockStorage.delete(key)),
  clear: vi.fn(() => void mockStorage.clear()),
})

import GameScreen from '../../../app/components/game/GameScreen.vue'

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
  WarRoom: true,
  CombatLog: true,
  // TickTheater (extracted) owns the theater-header now; surface its `status`
  // prop so the header-text assertions still hold under shallow stubbing.
  TickTheater: {
    name: 'TickTheater',
    props: [
      'events',
      'status',
      'bar',
      'tickImminent',
      'nextTickIn',
      'isAlive',
      'canAct',
      'pulseKey',
    ],
    template: '<div data-testid="theater-header">{{ status }}</div>',
  },
  KillFeed: true,
  HeroStatus: true,
  ZonePanel: {
    name: 'ZonePanel',
    template: '<div data-testid="zone-panel" />',
  },
  AsciiMap: true,
  Scoreboard: true,
  ItemShop: true,
  InventoryBar: true,
  QuickBuy: true,
  CommandInput: true,
}

function mountGameScreen() {
  return mount(GameScreen, {
    attachTo: document.body,
    global: { stubs },
  })
}

/** Seed the store into a live, playing game where `p1` (radiant) is the human. */
function seedActiveGame() {
  const store = useGameStore()
  store.gameId = 'game_test_1'
  store.playerId = 'p1'
  store.updateFromTick(makeTickMessage())
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockStorage.clear()
  for (const spy of Object.values(socketSpies)) spy.mockClear()
  vi.mocked(localStorage.clear).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('GameScreen', () => {
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

    it('renders the Tick Theater header showing AWAITING ORDERS when the player can act', () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      const header = wrapper.find('[data-testid="theater-header"]')
      expect(header.exists()).toBe(true)
      // Alive + not yet acted this tick → AWAITING ORDERS (see theaterStatus).
      expect(header.text()).toContain('AWAITING ORDERS')
      wrapper.unmount()
    })

    it('shows RESOLVING once the player has already acted this tick', async () => {
      const store = seedActiveGame()
      store.markActionSent('move mid-river') // lastActionTick === current tick
      const wrapper = mountGameScreen()

      const header = wrapper.find('[data-testid="theater-header"]')
      expect(header.text()).toContain('RESOLVING')
      expect(header.text()).not.toContain('AWAITING ORDERS')
      wrapper.unmount()
    })

    describe('HUD layout (setting A)', () => {
      it('keeps the Zone panel in the left column instead of the right rail', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        expect(wrapper.find('.game-grid__war [data-testid="zone-panel"]').exists()).toBe(true)
        expect(wrapper.find('.game-grid__rail [data-testid="zone-panel"]').exists()).toBe(false)
        wrapper.unmount()
      })

      it('defaults to classic: combat log in the center, map a rail widget', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        expect(wrapper.find('[data-testid="game-screen"]').attributes('data-layout')).toBe(
          'classic',
        )
        expect(wrapper.find('[data-testid="theater-header"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="center-map"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="rail-log"]').exists()).toBe(false)
        wrapper.unmount()
      })

      it('map-centric: map takes the center, the combat log demotes to the rail', () => {
        localStorage.clear()
        useSettingsStore().setHud('layoutMode', 'map-centric')
        seedActiveGame()
        const wrapper = mountGameScreen()

        expect(wrapper.find('[data-testid="game-screen"]').attributes('data-layout')).toBe(
          'map-centric',
        )
        expect(wrapper.find('[data-testid="center-map"]').exists()).toBe(true)
        // The combat log still renders — now in the rail.
        expect(wrapper.find('[data-testid="rail-log"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="theater-header"]').exists()).toBe(true)
        wrapper.unmount()
      })
    })

    describe('HUD density & vitals (setting C)', () => {
      it('defaults to comfortable density and vitals off', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        const root = wrapper.find('[data-testid="game-screen"]')
        expect(root.attributes('data-density')).toBe('comfortable')
        expect(root.attributes('data-vitals')).toBe('off')
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

      it('reflects emphasize-vitals as data-vitals=on', () => {
        localStorage.clear()
        useSettingsStore().setHud('emphasizeVitals', true)
        seedActiveGame()
        const wrapper = mountGameScreen()

        expect(wrapper.find('[data-testid="game-screen"]').attributes('data-vitals')).toBe('on')
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

  describe('death overlay (game_death_overlay oracle)', () => {
    function seedDeadPlayer() {
      const store = useGameStore()
      store.gameId = 'game_test_dead'
      store.playerId = 'p1'
      // Roster where the human is dead with a future respawn tick (self_dead).
      const roster = makeRoster()
      roster.p1 = makePlayer({
        id: 'p1',
        name: 'you',
        heroId: SAMPLE_HEROES.echo,
        alive: false,
        hp: 0,
        respawnTick: 270,
      })
      store.updateFromTick(makeTickMessage({ tick: 240, players: roster }))
      return store
    }

    it('renders the death overlay with the PROCESS TERMINATED headline', () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      const overlay = wrapper.find('[data-testid="death-overlay"]')
      expect(overlay.exists()).toBe(true)
      expect(overlay.text()).toContain('PROCESS TERMINATED')
      wrapper.unmount()
    })

    it('shows the respawn countdown computed from respawnTick - tick', () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      const overlay = wrapper.find('[data-testid="death-overlay"]')
      expect(overlay.text()).toContain('Respawning in')
      // respawnTick 270 - tick 240 = 30 ticks remaining.
      expect(overlay.text()).toContain('30')
      wrapper.unmount()
    })

    it('still routes to the active game screen (overlay is layered, not post-game)', () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="game-screen"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="post-game-stub"]').exists()).toBe(false)
      // Theater header reflects the DOWN state for a dead player.
      expect(wrapper.find('[data-testid="theater-header"]').text()).toContain('DOWN')
      wrapper.unmount()
    })

    it('renders a buyback button for the dead player', () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="buyback-button"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('lets a dead player vote to surrender from the death overlay', async () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      const btn = wrapper.find('[data-testid="death-surrender-button"]')
      expect(btn.exists()).toBe(true)

      socketSpies.send.mockClear()
      await btn.trigger('click')
      // surrender is a "special" action that bypasses the canAct gate, so it
      // must actually reach the socket even while dead.
      expect(socketSpies.send).toHaveBeenCalled()
      wrapper.unmount()
    })

    it('buffers an action for retry instead of faking "sent" when the socket is down', async () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()
      const store = useGameStore()
      socketSpies.send.mockImplementationOnce(() => false) // socket down for this send

      await wrapper.find('[data-testid="death-surrender-button"]').trigger('click')

      // attempted, reported failure → buffered for next-tick retry, not lost
      expect(socketSpies.send).toHaveBeenCalled()
      expect(store.bufferedCommand).toBe('surrender confirm')
      wrapper.unmount()
    })
  })

  describe('game over (game_over oracle)', () => {
    function seedGameOver(winner: 'radiant' | 'dire' = 'radiant') {
      const store = useGameStore()
      store.gameId = 'game_test_over'
      store.playerId = 'p1'
      // Populate the roster so postGamePlayers + scoreboard have content.
      store.updateFromTick(makeTickMessage())
      const stats: Record<string, ReturnType<typeof makePlayerEndStats>> = {}
      for (const id of Object.keys(makeRoster())) stats[id] = makePlayerEndStats()
      store.setGameOver(winner, stats)
      return store
    }

    it('renders the post-game screen and unmounts the active game screen on game over', () => {
      seedGameOver('radiant')
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="post-game-stub"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="game-screen"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('passes the winner + stats through to PostGame so it can render', () => {
      seedGameOver('dire')
      const wrapper = mountGameScreen()

      const postGame = wrapper.findComponent({ name: 'PostGame' })
      expect(postGame.exists()).toBe(true)
      expect(postGame.props('winner')).toBe('dire')
      expect(postGame.props('currentPlayerId')).toBe('p1')
      // postGamePlayers is derived from the full roster (5v5).
      expect((postGame.props('players') as unknown[]).length).toBe(10)
      wrapper.unmount()
    })

    it('does not show the post-game screen until the winner + stats are set', () => {
      // Phase 'ended' alone is not enough — PostGame's v-if also requires
      // winner + gameOverStats. A live game must NOT show post-game.
      seedActiveGame()
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="post-game-stub"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="game-screen"]').exists()).toBe(true)
      wrapper.unmount()
    })
  })

  describe('in-game a11y', () => {
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

  describe('situational action bar (#11)', () => {
    it('surfaces glyph as an on-screen button and runs it via the command path', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="situational-actions"]').exists()).toBe(true)
      const glyph = wrapper.find('[data-testid="situational-glyph"]')
      expect(glyph.exists()).toBe(true)
      expect(glyph.attributes('aria-label')).toContain('glyph')

      socketSpies.send.mockClear()
      await glyph.trigger('click')
      expect(socketSpies.send).toHaveBeenCalled()
      wrapper.unmount()
    })

    it('gates the surrender button on the surrender tick', () => {
      const store = useGameStore()
      store.gameId = 'g'
      store.playerId = 'p1'

      store.updateFromTick(makeTickMessage({ tick: 10 })) // before SURRENDER_MIN_TICK (225)
      const early = mountGameScreen()
      expect(early.find('[data-testid="situational-surrender"]').exists()).toBe(false)
      early.unmount()

      store.updateFromTick(makeTickMessage({ tick: 240 })) // past the gate
      const late = mountGameScreen()
      expect(late.find('[data-testid="situational-surrender"]').exists()).toBe(true)
      late.unmount()
    })
  })
})
