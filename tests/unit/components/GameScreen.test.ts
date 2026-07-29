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
  makeZone,
  SAMPLE_HEROES,
} from '../../../app/stories/fixtures'
import type { GameState, PlayerState, ZoneRuntimeState } from '../../../shared/types/game'

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
import { ULTIMATE_UNLOCK_LEVEL } from '~~/shared/constants/balance'

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
    props: [
      'zoneName',
      'zoneId',
      'playerTeam',
      'enemies',
      'allies',
      'creeps',
      'neutrals',
      'tower',
      'roshan',
    ],
    template: '<div data-testid="zone-panel" />',
  },
  // Surfaces the layout props GameScreen wires per instance (the rail map is
  // forced compact AND ships its overview grid open; the center map is full).
  AsciiMap: {
    name: 'AsciiMap',
    props: ['zones', 'playerZone', 'ancients', 'forceMode', 'mapId', 'overviewOpen'],
    template:
      '<div data-testid="ascii-map" :data-force-mode="forceMode" :data-overview-open="String(overviewOpen === true)" />',
  },
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
function seedActiveGame(overrides: Partial<GameState> = {}) {
  const store = useGameStore()
  store.gameId = 'game_test_1'
  store.playerId = 'p1'
  store.updateFromTick(makeTickMessage(overrides))
  return store
}

/** The fixture roster with the human moved to `zone`. */
function rosterAt(zone: string) {
  const players = makeRoster()
  players.p1 = { ...players.p1!, zone }
  return players
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

      it('classic: the rail map ships with its overview grid already open', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        const map = wrapper.find('.game-grid__rail [data-testid="ascii-map"]')
        expect(map.exists()).toBe(true)
        expect(map.attributes('data-force-mode')).toBe('compact')
        expect(map.attributes('data-overview-open')).toBe('true')
        wrapper.unmount()
      })

      it('classic: the map leads the rail, above Hero Status', () => {
        localStorage.clear()
        seedActiveGame()
        const wrapper = mountGameScreen()

        const rail = wrapper.find('.game-grid__rail').element
        const map = rail.querySelector('[data-testid="ascii-map"]')
        const hero = rail.querySelector('hero-status-stub')
        expect(map).not.toBeNull()
        expect(hero).not.toBeNull()
        // DOCUMENT_POSITION_FOLLOWING = the hero panel comes after the map.
        expect(map!.compareDocumentPosition(hero!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

    it('names the tower that killed you (W1-1: "why did I die?")', () => {
      // Towers, creeps and neutrals are not eligible killers — handleDeaths only
      // accepts a killerId that resolves to a player — so an NPC kill emits a
      // `death` with no `kill` event at all. Before NPC damage events existed the
      // overlay had nothing to show after the single most instructive death in
      // the game, the tower dive; worse, it scanned the 200-entry ring buffer
      // unbounded, so it could name a killer from a totally unrelated earlier
      // death.
      const store = seedDeadPlayer()
      store.addEvents([
        { tick: 100, type: 'kill', payload: { victimId: 'p1', killerId: 'e1' } },
        {
          tick: 240,
          type: 'damage',
          payload: { sourceId: 'tower_mid-t1-dire', targetId: 'p1', amount: 110 },
        },
        { tick: 240, type: 'death', payload: { playerId: 'p1', respawnTick: 270 } },
      ] as never)

      const overlay = mountGameScreen().find('[data-testid="death-overlay"]')
      expect(overlay.text()).toContain('tower (mid-t1-dire)')
      // ...and NOT the stale killer from the death 140 ticks ago.
      expect(overlay.text()).not.toContain('Daemon')
    })

    it('still prefers real kill credit over the last thing that hit you', () => {
      // A hero kill must not be relabelled as "a creep" just because a creep got
      // the last chip in before the killing blow.
      const store = seedDeadPlayer()
      store.addEvents([
        {
          tick: 240,
          type: 'damage',
          payload: { sourceId: 'creep_r_1', targetId: 'p1', amount: 20 },
        },
        { tick: 240, type: 'kill', payload: { victimId: 'p1', killerId: 'e1' } },
        { tick: 240, type: 'death', payload: { playerId: 'p1', respawnTick: 270 } },
      ] as never)

      const overlay = mountGameScreen().find('[data-testid="death-overlay"]')
      expect(overlay.text()).not.toContain('a creep')
    })

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
      // respawnTick 270 - tick 240 = 30 ticks = 120s, shown as wall time.
      expect(overlay.text()).toContain('2:00')
      expect(overlay.text()).not.toContain('30 ticks')
      wrapper.unmount()
    })

    it('shows a sub-minute respawn as ticks AND seconds', () => {
      // The common case: most respawns are well under a minute, where "0:12"
      // reads worse than the tick count plus the seconds it actually costs.
      const store = useGameStore()
      store.gameId = 'game_test_dead'
      store.playerId = 'p1'
      const roster = makeRoster()
      roster.p1 = makePlayer({
        id: 'p1',
        name: 'you',
        heroId: SAMPLE_HEROES.echo,
        alive: false,
        hp: 0,
        respawnTick: 252,
      })
      store.updateFromTick(makeTickMessage({ tick: 240, players: roster }))
      const wrapper = mountGameScreen()

      // 12 ticks left → 48 seconds.
      expect(wrapper.find('[data-testid="death-overlay"]').text()).toContain('12t (48s)')
      wrapper.unmount()
    })

    it('spells the buyback cooldown out in wall time', () => {
      const store = useGameStore()
      store.gameId = 'game_test_dead'
      store.playerId = 'p1'
      const roster = makeRoster()
      roster.p1 = makePlayer({
        id: 'p1',
        name: 'you',
        heroId: SAMPLE_HEROES.echo,
        alive: false,
        hp: 0,
        respawnTick: 270,
        buybackCooldown: 330, // 90 ticks out = 6 minutes
      })
      store.updateFromTick(makeTickMessage({ tick: 240, players: roster }))
      const wrapper = mountGameScreen()

      const overlay = wrapper.find('[data-testid="death-overlay"]')
      expect(overlay.text()).toContain('Buyback on cooldown')
      expect(overlay.text()).toContain('6:00')
      expect(overlay.text()).not.toContain('90 ticks')
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
      store.updateFromTick(makeTickMessage({ players: roster }))
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
      expect(w?.attributes('aria-label')).toContain('on cooldown 2 ticks, about 8 seconds')
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

  describe('jungle + Roshan targeting (W1-2)', () => {
    // `attack neutral:<i>` resolves against the WHOLE neutrals array server-side
    // (it reaches the client unfiltered), unlike the zone-local creep index. If
    // the zone filter ran before the index was captured, the panel would send
    // the player at a camp in a different jungle.
    it('passes in-zone neutrals to the Zone panel tagged with their global index', () => {
      seedActiveGame({
        neutrals: [
          { id: 'n0', zone: 'jungle-dire-top', hp: 200, maxHp: 200, type: 'kobold', alive: true },
          { id: 'n1', zone: 'jungle-dire-top', hp: 200, maxHp: 200, type: 'kobold', alive: true },
          { id: 'n2', zone: 'mid-river', hp: 140, maxHp: 200, type: 'centaur', alive: true },
          { id: 'n3', zone: 'mid-river', hp: 0, maxHp: 200, type: 'centaur', alive: false },
        ],
      })
      const wrapper = mountGameScreen()

      const passed = wrapper.findComponent({ name: 'ZonePanel' }).props('neutrals') as Array<{
        id: string
        index: number
      }>
      expect(passed).toHaveLength(1)
      expect(passed[0]).toMatchObject({ id: 'n2', index: 2 })
      wrapper.unmount()
    })

    it('passes Roshan to the Zone panel only from inside the pit', () => {
      seedActiveGame({ players: rosterAt('mid-river') })
      const outside = mountGameScreen()
      expect(outside.findComponent({ name: 'ZonePanel' }).props('roshan')).toBeNull()
      outside.unmount()

      seedActiveGame({ players: rosterAt('roshan-pit') })
      const inPit = mountGameScreen()
      expect(inPit.findComponent({ name: 'ZonePanel' }).props('roshan')).toMatchObject({
        alive: true,
      })
      inPit.unmount()
    })

    it('withholds Roshan while he is dead, even standing in the pit', () => {
      seedActiveGame({
        players: rosterAt('roshan-pit'),
        roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: 200 },
      })
      const wrapper = mountGameScreen()

      expect(wrapper.findComponent({ name: 'ZonePanel' }).props('roshan')).toBeNull()
      wrapper.unmount()
    })

    it('sends attack roshan through the command path from the pit', async () => {
      seedActiveGame({ players: rosterAt('roshan-pit') })
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'attack roshan')
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'attack', target: { kind: 'roshan' } },
      })
      wrapper.unmount()
    })

    it('refuses attack neutral:<i> that names a camp outside the zone before it costs a tick', async () => {
      seedActiveGame({
        neutrals: [
          { id: 'n0', zone: 'jungle-dire-top', hp: 200, maxHp: 200, type: 'kobold', alive: true },
          { id: 'n1', zone: 'mid-river', hp: 140, maxHp: 200, type: 'centaur', alive: true },
        ],
      })
      const wrapper = mountGameScreen()
      const panel = wrapper.findComponent({ name: 'ZonePanel' })

      socketSpies.send.mockClear()
      panel.vm.$emit('command', 'attack neutral:0')
      await wrapper.vm.$nextTick()
      expect(socketSpies.send).not.toHaveBeenCalled()

      panel.vm.$emit('command', 'attack neutral:1')
      await wrapper.vm.$nextTick()
      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'attack', target: { kind: 'neutral', index: 1 } },
      })
      wrapper.unmount()
    })
  })

  describe('movement narration (W1-7)', () => {
    // The radiant mid corridor, fountain through the river. Seeding the whole
    // walkable chain (not just the hops under test) matters: the watcher's
    // distance BFS is restricted to known zones, so a gap would silence a line
    // for the wrong reason and hide a regression.
    const CORRIDOR = [
      'radiant-fountain',
      'radiant-base',
      'mid-t3-rad',
      'mid-t2-rad',
      'mid-t1-rad',
      'mid-river',
    ]

    /** Seed a tick with the human standing in `zone`, optionally still walking. */
    function seedWalkTick(
      zone: string,
      tick: number,
      extra: Partial<PlayerState> = {},
    ): ReturnType<typeof useGameStore> {
      const store = useGameStore()
      store.gameId = 'game_walk'
      store.playerId = 'p1'
      const players = makeRoster()
      players.p1 = { ...players.p1!, zone, moveTarget: null, ...extra }
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const id of CORRIDOR) zones[id] = makeZone(id)
      store.updateFromTick(makeTickMessage({ tick, players, zones }))
      return store
    }

    /** The narrative lines the Tick Theater is handed (engine + local events). */
    function feed(wrapper: ReturnType<typeof mountGameScreen>): string[] {
      const events = wrapper.findComponent({ name: 'TickTheater' }).props('events') as Array<{
        text: string
      }>
      return events.map((e) => e.text)
    }

    async function order(wrapper: ReturnType<typeof mountGameScreen>, cmd: string) {
      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', cmd)
      await wrapper.vm.$nextTick()
    }

    it('announces arrival after a single-hop move', async () => {
      // The server nulls moveTarget on the arriving hop, so a one-zone move had
      // NO feedback at all — the most-used command in the game resolved silently.
      seedWalkTick('mid-river', 240)
      const wrapper = mountGameScreen()

      await order(wrapper, 'move mid-t1-rad')
      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'move', zone: 'mid-t1-rad' },
      })

      seedWalkTick('mid-t1-rad', 241)
      await wrapper.vm.$nextTick()

      expect(feed(wrapper)).toContain('▸ You arrive at Mid Lane T1 (Radiant)')
      wrapper.unmount()
    })

    it('narrates each hop of an auto-path walk and then the arrival', async () => {
      seedWalkTick('mid-river', 240)
      const wrapper = mountGameScreen()

      await order(wrapper, 'move mid-t2-rad')

      // Mid-walk: the server still reports the destination.
      seedWalkTick('mid-t1-rad', 241, { moveTarget: 'mid-t2-rad' })
      await wrapper.vm.$nextTick()
      expect(feed(wrapper)).toContain(
        '▸ You reach Mid Lane T1 (Radiant) — 1 more to Mid Lane T2 (Radiant)',
      )
      expect(feed(wrapper).some((t) => t.includes('You arrive'))).toBe(false)

      // Final hop: moveTarget is already null, so only the local order knows.
      seedWalkTick('mid-t2-rad', 242)
      await wrapper.vm.$nextTick()
      expect(feed(wrapper)).toContain('▸ You arrive at Mid Lane T2 (Radiant)')
      wrapper.unmount()
    })

    it('does not narrate the respawn jump as an arrival', async () => {
      seedWalkTick('mid-river', 240)
      const wrapper = mountGameScreen()

      await order(wrapper, 'move mid-t2-rad')

      // Death cancels the walk server-side; the client must forget it too, or
      // the fountain respawn would read as reaching the abandoned destination.
      seedWalkTick('mid-river', 241, { alive: false, hp: 0, respawnTick: 250 })
      await wrapper.vm.$nextTick()
      seedWalkTick('radiant-fountain', 250)
      await wrapper.vm.$nextTick()

      expect(feed(wrapper).some((t) => t.includes('You arrive'))).toBe(false)
      expect(feed(wrapper).some((t) => t.includes('You reach'))).toBe(false)
      wrapper.unmount()
    })

    it('drops the pending walk when a deliberate non-move order replaces it', async () => {
      seedWalkTick('mid-river', 240)
      const wrapper = mountGameScreen()

      await order(wrapper, 'move mid-t2-rad')
      // Mirrors GameLoop's KEEPS_AUTOPATH: warding cancels the walk, so a later
      // relocation (a teleport, already narrated on its own) owes no arrival.
      seedWalkTick('mid-river', 241)
      await order(wrapper, 'ward mid-river')

      seedWalkTick('mid-t2-rad', 242)
      await wrapper.vm.$nextTick()

      expect(feed(wrapper).some((t) => t.includes('You arrive'))).toBe(false)
      wrapper.unmount()
    })
  })

  describe('keyboard mode (W1-10)', () => {
    // The mid corridor, so an arrow order passes the pre-flight path check.
    const CORRIDOR = ['radiant-base', 'mid-t3-rad', 'mid-t2-rad', 'mid-t1-rad', 'mid-river']

    function seedAt(zone: string) {
      const store = useGameStore()
      store.gameId = 'game_keys'
      store.playerId = 'p1'
      const players = makeRoster()
      players.p1 = { ...players.p1!, zone }
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const id of CORRIDOR) zones[id] = makeZone(id)
      store.updateFromTick(makeTickMessage({ tick: 240, players, zones }))
      return store
    }

    /** A real key press on the page, the way the window listener receives one. */
    function press(key: string) {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    }

    function lines(wrapper: ReturnType<typeof mountGameScreen>): string[] {
      const events = wrapper.findComponent({ name: 'TickTheater' }).props('events') as Array<{
        text: string
      }>
      return events.map((e) => e.text)
    }

    it('walks the lane forward, resolving the arrow against the drawn map', async () => {
      // REGRESSION: resolved by zone-name substring, so a Radiant hero could not
      // walk down mid at all — every forward neighbour is named `-rad`. The fix
      // needs the origin zone AND the map id, so this fails if either is dropped.
      seedAt('mid-t3-rad')
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      press('ArrowDown')
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'move', zone: 'mid-t2-rad' },
      })
      wrapper.unmount()
    })

    it('says so when nothing lies that way instead of eating the press', async () => {
      seedAt('mid-t1-rad')
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      press('ArrowLeft') // the lane has no left-hand neighbour here
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).not.toHaveBeenCalled()
      expect(lines(wrapper).some((t) => t.startsWith('No zone left of Mid Lane T1'))).toBe(true)
      wrapper.unmount()
    })

    it('tells first-time players how to reach the shop key', async () => {
      localStorage.clear()
      seedActiveGame()
      const wrapper = mountGameScreen()
      await wrapper.vm.$nextTick() // the intro is pushed in onMounted, after the first render

      const intro = lines(wrapper).join('\n')
      // The bare "press [S]" it used to promise does nothing while the prompt
      // has focus, which it does by default.
      expect(intro).toContain('press Esc, then S')
      expect(intro).not.toContain('press [S]')
      wrapper.unmount()
    })

    it('qualifies the shop button tooltip the same way', () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      const shop = wrapper.findAll('button').find((b) => b.text() === '[SHOP]')
      expect(shop?.attributes('title')).toContain('Esc then S')
      wrapper.unmount()
    })
  })
})
