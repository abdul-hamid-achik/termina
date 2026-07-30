import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import { useSettingsStore } from '~~/app/stores/settings'
import {
  makeTickMessage,
  makeRoster,
  makePlayer,
  makePlayerEndStats,
  makeZone,
  SAMPLE_HEROES,
} from '~~/app/stories/fixtures'
import type { GameState, PlayerState, ZoneRuntimeState } from '~~/shared/types/game'

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

// GameScreen measures the HUD bar to anchor the kill-feed / toast lanes;
// happy-dom ships no ResizeObserver, so capture the callback and drive it.
type ResizeCb = (entries: Array<{ contentRect: { height: number } }>) => void
let resizeCb: ResizeCb | null = null
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(cb: ResizeCb) {
      resizeCb = cb
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
      'waves',
      'neutrals',
      'ice',
      'tenant',
    ],
    template: '<div data-testid="zone-panel" />',
  },
  // Surfaces the layout props GameScreen wires per instance (the rail map is
  // forced compact AND ships its overview grid open; the center map is full).
  AsciiMap: {
    name: 'AsciiMap',
    props: ['zones', 'playerZone', 'ancients', 'forceMode', 'mapId', 'overviewOpen', 'moveTarget'],
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

/** Seed the store into a live, playing game where `p1` (chaff) is the human. */
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
  resizeCb = null
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

    it('names the ice that killed you (W1-1: "why did I die?")', () => {
      // ICE, waves and neutrals are not eligible killers — handleDeaths only
      // accepts a killerId that resolves to a player — so an NPC kill emits a
      // `death` with no `kill` event at all. Before NPC damage events existed the
      // overlay had nothing to show after the single most instructive death in
      // the game, the ice dive; worse, it scanned the 200-entry ring buffer
      // unbounded, so it could name a killer from a totally unrelated earlier
      // death.
      const store = seedDeadPlayer()
      store.addEvents([
        { tick: 100, type: 'kill', payload: { victimId: 'p1', killerId: 'e1' } },
        {
          tick: 240,
          type: 'damage',
          payload: { sourceId: 'ice_mid-t1-audit', targetId: 'p1', amount: 110 },
        },
        { tick: 240, type: 'death', payload: { playerId: 'p1', respawnTick: 270 } },
      ] as never)

      const overlay = mountGameScreen().find('[data-testid="death-overlay"]')
      expect(overlay.text()).toContain('ice (mid-t1-audit)')
      // ...and NOT the stale killer from the death 140 ticks ago.
      expect(overlay.text()).not.toContain('Daemon')
    })

    it('still prefers real kill credit over the last thing that hit you', () => {
      // A hero kill must not be relabelled as "a wave" just because a wave got
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
      expect(overlay.text()).not.toContain('a wave')
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

    it('shows a sub-minute respawn as cycles AND seconds', () => {
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
      expect(wrapper.find('[data-testid="death-overlay"]').text()).toContain('12c (48s)')
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

    // ── W2-10: death is not a blackout ────────────────────────────────
    // Respawn runs up to 108 seconds. The overlay used to be a full-bleed scrim
    // that also swallowed every click, so the map, log, war room and scoreboard
    // were unreadable and unreachable for the duration.
    it('renders as a centered card, not a full-height panel', () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      const card = wrapper.get('[data-testid="death-overlay"] > div')
      expect(card.classes()).not.toContain('h-full')
      // The scrim is click-through (see the .death-overlay rule); the card puts
      // pointer events back so buyback and surrender still work.
      expect(card.classes()).toContain('pointer-events-auto')
      wrapper.unmount()
    })

    it('tells a dead player the truth about why the shop is closed', async () => {
      // `canBuy` is false while dead AND while out of a shop zone; the shop only
      // ever named the zone, telling a corpse to walk somewhere it cannot walk.
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      await wrapper.get('[aria-label="Toggle shop"]').trigger('click')

      const warn = wrapper.get('[data-testid="shop-blocked-reason"]').text()
      expect(warn).toContain('cannot buy while dead')
      expect(warn).not.toContain('fountain or base zone')
      wrapper.unmount()
    })
  })

  describe('game over (game_over oracle)', () => {
    function seedGameOver(winner: 'chaff' | 'audit' = 'chaff') {
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
      seedGameOver('chaff')
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="post-game-stub"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="game-screen"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('passes the winner + stats through to PostGame so it can render', () => {
      seedGameOver('audit')
      const wrapper = mountGameScreen()

      const postGame = wrapper.findComponent({ name: 'PostGame' })
      expect(postGame.exists()).toBe(true)
      expect(postGame.props('winner')).toBe('audit')
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

  describe('situational action bar (#11)', () => {
    it('surfaces harden as an on-screen button and runs it via the command path', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      expect(wrapper.find('[data-testid="situational-actions"]').exists()).toBe(true)
      const harden = wrapper.find('[data-testid="situational-harden"]')
      expect(harden.exists()).toBe(true)
      expect(harden.attributes('aria-label')).toContain('harden')

      socketSpies.send.mockClear()
      await harden.trigger('click')
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

  describe('jungle + Tenant targeting (W1-2)', () => {
    // `attack neutral:<i>` resolves against the WHOLE neutrals array server-side
    // (it reaches the client unfiltered), unlike the zone-local wave index. If
    // the zone filter ran before the index was captured, the panel would send
    // the player at a camp in a different jungle.
    it('passes in-zone neutrals to the Zone panel tagged with their global index', () => {
      seedActiveGame({
        neutrals: [
          { id: 'n0', zone: 'silt-audit-top', hp: 200, maxHp: 200, type: 'stub', alive: true },
          { id: 'n1', zone: 'silt-audit-top', hp: 200, maxHp: 200, type: 'stub', alive: true },
          { id: 'n2', zone: 'mid-river', hp: 140, maxHp: 200, type: 'warden', alive: true },
          { id: 'n3', zone: 'mid-river', hp: 0, maxHp: 200, type: 'warden', alive: false },
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

    it('passes Tenant to the Zone panel only from inside the pit', () => {
      seedActiveGame({ players: rosterAt('mid-river') })
      const outside = mountGameScreen()
      expect(outside.findComponent({ name: 'ZonePanel' }).props('tenant')).toBeNull()
      outside.unmount()

      seedActiveGame({ players: rosterAt('hollow') })
      const inPit = mountGameScreen()
      expect(inPit.findComponent({ name: 'ZonePanel' }).props('tenant')).toMatchObject({
        alive: true,
      })
      inPit.unmount()
    })

    it('withholds Tenant while he is dead, even standing in the pit', () => {
      seedActiveGame({
        players: rosterAt('hollow'),
        tenant: { alive: false, hp: 0, maxHp: 5000, deathTick: 200 },
      })
      const wrapper = mountGameScreen()

      expect(wrapper.findComponent({ name: 'ZonePanel' }).props('tenant')).toBeNull()
      wrapper.unmount()
    })

    it('sends attack tenant through the command path from the pit', async () => {
      seedActiveGame({ players: rosterAt('hollow') })
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'attack tenant')
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'attack', target: { kind: 'tenant' } },
      })
      wrapper.unmount()
    })

    it('refuses attack neutral:<i> that names a camp outside the zone before it costs a tick', async () => {
      seedActiveGame({
        neutrals: [
          { id: 'n0', zone: 'silt-audit-top', hp: 200, maxHp: 200, type: 'stub', alive: true },
          { id: 'n1', zone: 'mid-river', hp: 140, maxHp: 200, type: 'warden', alive: true },
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
    // The chaff mid corridor, fountain through the river. Seeding the whole
    // walkable chain (not just the hops under test) matters: the watcher's
    // distance BFS is restricted to known zones, so a gap would silence a line
    // for the wrong reason and hide a regression.
    const CORRIDOR = [
      'chaff-fountain',
      'chaff-base',
      'mid-t3-chaff',
      'mid-t2-chaff',
      'mid-t1-chaff',
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

      await order(wrapper, 'move mid-t1-chaff')
      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'move', zone: 'mid-t1-chaff' },
      })

      seedWalkTick('mid-t1-chaff', 241)
      await wrapper.vm.$nextTick()

      expect(feed(wrapper)).toContain('▸ You arrive at Coldstore T1 (CHAFF)')
      wrapper.unmount()
    })

    it('narrates each hop of an auto-path walk and then the arrival', async () => {
      seedWalkTick('mid-river', 240)
      const wrapper = mountGameScreen()

      await order(wrapper, 'move mid-t2-chaff')

      // Mid-walk: the server still reports the destination.
      seedWalkTick('mid-t1-chaff', 241, { moveTarget: 'mid-t2-chaff' })
      await wrapper.vm.$nextTick()
      expect(feed(wrapper)).toContain(
        '▸ You reach Coldstore T1 (CHAFF) — 1 more to Coldstore T2 (CHAFF)',
      )
      expect(feed(wrapper).some((t) => t.includes('You arrive'))).toBe(false)

      // Final hop: moveTarget is already null, so only the local order knows.
      seedWalkTick('mid-t2-chaff', 242)
      await wrapper.vm.$nextTick()
      expect(feed(wrapper)).toContain('▸ You arrive at Coldstore T2 (CHAFF)')
      wrapper.unmount()
    })

    it('does not narrate the respawn jump as an arrival', async () => {
      seedWalkTick('mid-river', 240)
      const wrapper = mountGameScreen()

      await order(wrapper, 'move mid-t2-chaff')

      // Death cancels the walk server-side; the client must forget it too, or
      // the fountain respawn would read as reaching the abandoned destination.
      seedWalkTick('mid-river', 241, { alive: false, hp: 0, respawnTick: 250 })
      await wrapper.vm.$nextTick()
      seedWalkTick('chaff-fountain', 250)
      await wrapper.vm.$nextTick()

      expect(feed(wrapper).some((t) => t.includes('You arrive'))).toBe(false)
      expect(feed(wrapper).some((t) => t.includes('You reach'))).toBe(false)
      wrapper.unmount()
    })

    it('drops the pending walk when a deliberate non-move order replaces it', async () => {
      seedWalkTick('mid-river', 240)
      const wrapper = mountGameScreen()

      await order(wrapper, 'move mid-t2-chaff')
      // Mirrors GameLoop's KEEPS_AUTOPATH: warding cancels the walk, so a later
      // relocation (a teleport, already narrated on its own) owes no arrival.
      seedWalkTick('mid-river', 241)
      await order(wrapper, 'ward mid-river')

      seedWalkTick('mid-t2-chaff', 242)
      await wrapper.vm.$nextTick()

      expect(feed(wrapper).some((t) => t.includes('You arrive'))).toBe(false)
      wrapper.unmount()
    })
  })

  describe('keyboard mode (W1-10)', () => {
    // The mid corridor, so an arrow order passes the pre-flight path check.
    const CORRIDOR = ['chaff-base', 'mid-t3-chaff', 'mid-t2-chaff', 'mid-t1-chaff', 'mid-river']

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
      // REGRESSION: resolved by zone-name substring, so a Chaff hero could not
      // walk down mid at all — every forward neighbour is named `-chaff`. The fix
      // needs the origin zone AND the map id, so this fails if either is dropped.
      seedAt('mid-t3-chaff')
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      press('ArrowDown')
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'move', zone: 'mid-t2-chaff' },
      })
      wrapper.unmount()
    })

    it('says so when nothing lies that way instead of eating the press', async () => {
      seedAt('mid-t1-chaff')
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      press('ArrowLeft') // the lane has no left-hand neighbour here
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).not.toHaveBeenCalled()
      expect(lines(wrapper).some((t) => t.startsWith('No zone left of Coldstore T1'))).toBe(true)
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
      store.updateFromTick(makeTickMessage({ tick: 240, players, zones, ...overrides }))
      return store
    }

    const mapZoneIds = (wrapper: ReturnType<typeof mountGameScreen>) =>
      (wrapper.findComponent({ name: 'AsciiMap' }).props('zones') as { id: string }[]).map(
        (z) => z.id,
      )

    it('feeds the map the full 32 zones by default', () => {
      seedMap('mid-river')
      const wrapper = mountGameScreen()
      expect(mapZoneIds(wrapper)).toContain('bot-t1-audit')
      expect(mapZoneIds(wrapper).length).toBe(32)
      wrapper.unmount()
    })

    it('drops zones the game map does not contain, killing the phantom move targets', () => {
      // REGRESSION: built from the global ZONES regardless of mapId, so on the
      // one-lane tutorial map the compact map's tap-to-move cards — derived from
      // this list — offered cache-top and cache-bot, which `move` would reject.
      seedMap('mid-river', { mapId: 'one_lane' })
      const wrapper = mountGameScreen()
      const ids = mapZoneIds(wrapper)
      expect(ids).toHaveLength(11)
      expect(ids).toContain('mid-river')
      expect(ids).not.toContain('cache-top')
      expect(ids.some((id) => id.startsWith('top-') || id.startsWith('bot-'))).toBe(false)
      wrapper.unmount()
    })

    it('shows a live cache on the map even where the player has no vision', () => {
      // Caches reach the client unfiltered and the War Room ticker already names
      // the live one; gating the map marker on vision only made them disagree.
      seedMap('mid-river', { caches: [{ zone: 'cache-bot', type: 'haste', tick: 240 }] })
      const wrapper = mountGameScreen()
      const zones = wrapper.findComponent({ name: 'AsciiMap' }).props('zones') as {
        id: string
        fogged: boolean
        cacheType?: string
      }[]
      const cacheZone = zones.find((z) => z.id === 'cache-bot')!
      expect(cacheZone.fogged).toBe(true)
      expect(cacheZone.cacheType).toBe('haste')
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

      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'move mid-t1-chaff')
      await wrapper.vm.$nextTick()

      // chaff-base → mid-t3-chaff → mid-t2-chaff → mid-t1-chaff
      expect(wrapper.find('[data-testid="walk-strip"]').text()).toContain(
        'WALKING → Coldstore T1 (CHAFF) · 3t',
      )
      // The same destination is what the map draws its route from.
      expect(wrapper.findComponent({ name: 'AsciiMap' }).props('moveTarget')).toBe('mid-t1-chaff')

      seedMap('mid-t3-chaff', { players: rosterWalking('mid-t3-chaff', 'mid-t1-chaff') })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="walk-strip"]').text()).toContain('· 2t')
      wrapper.unmount()
    })

    it('[stop] cancels the walk by re-ordering a move to where you stand', async () => {
      seedMap('chaff-base')
      const wrapper = mountGameScreen()
      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'move mid-t1-chaff')
      await wrapper.vm.$nextTick()

      // One hop later, mid-walk — the tick that frees the player to act again.
      seedMap('mid-t3-chaff', { tick: 241, players: rosterWalking('mid-t3-chaff', 'mid-t1-chaff') })
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

      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'move mid-t3-chaff')
      await wrapper.vm.$nextTick()

      seedMap('mid-t2-chaff', { tick: 241 })
      await wrapper.vm.$nextTick()

      const feed = (
        wrapper.findComponent({ name: 'TickTheater' }).props('events') as { text: string }[]
      ).map((e) => e.text)
      expect(feed.some((t) => t.includes('more to Mid Lane T3'))).toBe(false)
      wrapper.unmount()
    })
  })

  describe('effect cues (W2-1)', () => {
    /** Feed the store a batch the way a tick_state would, then let watchers run. */
    async function emit(
      wrapper: ReturnType<typeof mountGameScreen>,
      events: Array<{ tick: number; type: string; payload: Record<string, unknown> }>,
    ) {
      useGameStore().addEvents(events as never)
      await wrapper.vm.$nextTick()
    }

    it('pays the farming loop a gold cue and an amber +Ng float', async () => {
      // REGRESSION: the gold cue hung off `gold_change`, whose only emitter is a
      // win sentinel carrying an empty playerId — so last-hitting, the core
      // economic loop of the whole match, was completely silent.
      seedActiveGame()
      const wrapper = mountGameScreen()

      await emit(wrapper, [
        {
          tick: 240,
          type: 'wave_strip',
          payload: { playerId: 'p1', waveId: 'c1', waveType: 'line', goldAwarded: 41 },
        },
      ])

      expect(audio.playSound).toHaveBeenCalledWith('gold')
      const float = wrapper.find('[data-testid="damage-float-gold"]')
      expect(float.exists()).toBe(true)
      expect(float.text()).toBe('+41g')
      wrapper.unmount()
    })

    it('pays a burn and a jungle camp the same cue', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      await emit(wrapper, [
        {
          tick: 240,
          type: 'wave_burn',
          payload: { playerId: 'p1', waveId: 'c2', waveType: 'sweep', goldAwarded: 12 },
        },
        {
          tick: 240,
          type: 'neutral_killed',
          payload: { playerId: 'p1', neutralId: 'n0', neutralType: 'stub', zone: 'silt-chaff' },
        },
      ])

      expect(audio.playSound.mock.calls.filter(([n]) => n === 'gold')).toHaveLength(2)
      // The camp's bounty isn't on the wire, so only the burn floats a number.
      expect(wrapper.findAll('[data-testid="damage-float-gold"]')).toHaveLength(1)
      wrapper.unmount()
    })

    it('stays silent when the gold is somebody else’s', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      await emit(wrapper, [
        {
          tick: 240,
          type: 'wave_strip',
          payload: { playerId: 'p2', waveId: 'c1', waveType: 'line', goldAwarded: 41 },
        },
      ])

      expect(audio.playSound).not.toHaveBeenCalledWith('gold')
      expect(wrapper.find('[data-testid="damage-float-gold"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('tells your ice falling apart from your own push', async () => {
      // REGRESSION: the branch tested `killerId`, a field IceKillEvent has
      // never carried, so every ice in the match read identically.
      seedActiveGame()
      const wrapper = mountGameScreen()
      const store = useGameStore()

      await emit(wrapper, [
        {
          tick: 240,
          type: 'ice_kill',
          payload: { zone: 'mid-t1-chaff', team: 'chaff', killerTeam: 'audit' },
        },
      ])
      expect(audio.playSound).toHaveBeenCalledWith('ice_lost')
      expect(audio.playSound).not.toHaveBeenCalledWith('ice_fall')
      expect(store.announcements.at(-1)).toContain('Ice lost')

      audio.playSound.mockClear()
      await emit(wrapper, [
        {
          tick: 241,
          type: 'ice_kill',
          payload: { zone: 'mid-t1-audit', team: 'audit', killerTeam: 'chaff' },
        },
      ])
      expect(audio.playSound).toHaveBeenCalledWith('ice_fall')
      expect(audio.playSound).not.toHaveBeenCalledWith('ice_lost')
      wrapper.unmount()
    })

    it('credits an assist with the kill cue and a KDA pop', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()
      const bar = wrapper.findComponent({ name: 'GameStateBar' })
      const before = bar.props('kdaPopKey')

      await emit(wrapper, [
        {
          tick: 240,
          type: 'kill',
          payload: { killerId: 'p2', victimId: 'e1', assisters: ['p1', 'p3'] },
        },
      ])

      expect(audio.playSound).toHaveBeenCalledWith('kill')
      expect(bar.props('kdaPopKey')).not.toBe(before)
      // You did not land it — no screen flare for an assist.
      expect(wrapper.find('[data-testid="impact-overlay"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('announces coming back from the dead', async () => {
      // Respawn was a UI element silently disappearing.
      const store = seedActiveGame()
      const wrapper = mountGameScreen()

      const dead = makeRoster()
      dead.p1 = { ...dead.p1!, alive: false, hp: 0, respawnTick: 250 }
      store.updateFromTick(makeTickMessage({ tick: 240, players: dead }))
      await wrapper.vm.$nextTick()
      audio.playSound.mockClear()

      store.updateFromTick(makeTickMessage({ tick: 250 }))
      await wrapper.vm.$nextTick()

      expect(audio.playSound).toHaveBeenCalledWith('respawn')
      expect(wrapper.find('[data-testid="respawn-vignette"]').exists()).toBe(true)
      const feed = (
        wrapper.findComponent({ name: 'TickTheater' }).props('events') as { text: string }[]
      ).map((e) => e.text)
      expect(feed.some((t) => t.includes('PROCESS RESTORED'))).toBe(true)
      wrapper.unmount()
    })

    it('does not mistake the first tick of a match for a respawn', async () => {
      // The store reports "not alive" until a player exists, so an ungated
      // rising edge fires the respawn cue on every single game load.
      const store = useGameStore()
      store.gameId = 'game_fresh'
      store.playerId = 'p1'
      const wrapper = mountGameScreen()

      store.updateFromTick(makeTickMessage())
      await wrapper.vm.$nextTick()

      expect(audio.playSound).not.toHaveBeenCalledWith('respawn')
      expect(wrapper.find('[data-testid="respawn-vignette"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('confirms a plain move, which used to send in total silence', async () => {
      // The `submit` sound was fully designed with zero call sites: move, buy,
      // ward and burn all went out with no confirmation at all.
      const store = useGameStore()
      store.gameId = 'game_submit'
      store.playerId = 'p1'
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const id of ['mid-river', 'mid-t1-chaff']) zones[id] = makeZone(id)
      store.updateFromTick(makeTickMessage({ tick: 240, zones }))
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'move mid-t1-chaff')
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).toHaveBeenCalled()
      expect(audio.playSound).toHaveBeenCalledWith('submit')
      wrapper.unmount()
    })

    it('keeps the meatier cast whoosh for offensive orders', async () => {
      seedActiveGame({ players: rosterAt('hollow') })
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'attack tenant')
      await wrapper.vm.$nextTick()

      expect(audio.playSound).toHaveBeenCalledWith('cast')
      expect(audio.playSound).not.toHaveBeenCalledWith('submit')
      wrapper.unmount()
    })
  })

  describe('rejection feedback (W2-3)', () => {
    it('toasts a client-side rejection instead of burying it in grey [SYS]', () => {
      // Rejections shared one look with chat, pings and readouts, so the one
      // line the player MUST read was the easiest to scroll past.
      const store = seedActiveGame() // in mid-river, no shop
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'buy scrap_lot')

      expect(store.announcements.at(-1)).toContain('shop zone')
      expect(store.lastAnnouncementLevel).toBe('warning')
      expect(socketSpies.send).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('toasts an unparseable command too', () => {
      const store = seedActiveGame()
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'flibbertigibbet')

      expect(store.announcements.at(-1)).toContain('Unknown command')
      wrapper.unmount()
    })

    it('leaves genuine meta-chatter silent', () => {
      const store = seedActiveGame()
      const wrapper = mountGameScreen()
      const before = store.announcements.length

      wrapper.findComponent({ name: 'ZonePanel' }).vm.$emit('command', 'status')

      expect(store.announcements).toHaveLength(before)
      wrapper.unmount()
    })
  })

  describe('effects that used to hurt (W2-6)', () => {
    async function hit(wrapper: ReturnType<typeof mountGameScreen>, tick: number, amount: number) {
      useGameStore().addEvents([
        { tick, type: 'damage', payload: { sourceId: 'e1', targetId: 'p1', amount } },
      ] as never)
      await wrapper.vm.$nextTick()
    }

    it('flashes the hero panel in team red, scaled by how hard the hit landed', async () => {
      // REGRESSION: a 30% WHITE wash — the brightest thing that ever appears on
      // a near-black palette — fired on the most frequent event in the game.
      seedActiveGame() // fixture maxHp 620
      const wrapper = mountGameScreen()
      const flash = () => wrapper.find('[data-testid="hero-hit-flash"]')
      expect(flash().classes()).toContain('anim-flash-damage')
      expect(flash().classes()).not.toContain('anim-flash')

      await hit(wrapper, 240, 31) // 5% of max HP → floored
      expect(flash().attributes('style')).toContain('--hit-intensity: 0.25')

      await hit(wrapper, 241, 400) // most of the bar → full strength
      expect(flash().attributes('style')).toContain('--hit-intensity: 1')
      wrapper.unmount()
    })

    it('punches with an overlay instead of translating the screen you are typing into', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      await hit(wrapper, 240, 120)

      const root = wrapper.find('[data-testid="game-screen"]')
      expect(root.classes().some((c) => c.startsWith('anim-shake'))).toBe(false)
      const flare = wrapper.find('[data-testid="impact-overlay"]')
      expect(flare.exists()).toBe(true)
      expect(flare.classes()).toContain('anim-impact')
      expect(flare.classes()).toContain('pointer-events-none')
      wrapper.unmount()
    })

    it('does not restart the flare for every hit inside one burst', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      await hit(wrapper, 240, 60)
      const first = wrapper.find('[data-testid="impact-overlay"]').element
      await hit(wrapper, 240, 45)
      expect(wrapper.find('[data-testid="impact-overlay"]').element).toBe(first)

      // Dying is not a repeat of the same beat and must always land.
      useGameStore().addEvents([
        { tick: 240, type: 'death', payload: { playerId: 'p1', respawnTick: 270 } },
      ] as never)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="impact-overlay"]').element).not.toBe(first)
      wrapper.unmount()
    })

    it('rises damage taken and damage dealt in separate lanes', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      useGameStore().addEvents([
        { tick: 240, type: 'damage', payload: { sourceId: 'e1', targetId: 'p1', amount: 90 } },
        { tick: 240, type: 'damage', payload: { sourceId: 'p1', targetId: 'e1', amount: 70 } },
      ] as never)
      await wrapper.vm.$nextTick()

      const self = wrapper.find('[data-anchor="self"]')
      const target = wrapper.find('[data-anchor="target"]')
      expect(self.find('[data-testid="damage-float-taken"]').exists()).toBe(true)
      expect(self.find('[data-testid="damage-float-dealt"]').exists()).toBe(false)
      expect(target.find('[data-testid="damage-float-dealt"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('anchors the overlay lanes to the measured HUD bar', async () => {
      // The kill feed sat at a hardcoded 4.25rem — 59.5px at the 14px root —
      // which lands squarely on the focus banner and the tick/gold/KDA row.
      seedActiveGame()
      const wrapper = mountGameScreen()
      expect(resizeCb).toBeTypeOf('function')

      resizeCb!([{ contentRect: { height: 72 } }])
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="game-screen"]').attributes('style')).toContain(
        '--hud-bar-h: 72px',
      )
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

  it('keeps the board on screen: it gets its own row and never scrolls', () => {
    // Losing sight of the map costs the player all spatial sense of the match,
    // so the board is the one region that must not be scrollable OR scrolled
    // away. A plain max-height (what this used to be) makes it do both.
    // The cap lives on the TRACK. A percentage max-height on an `auto` track is
    // cyclic and silently does nothing, and an `auto` track sized by the board's
    // natural height ate the entire rail — Hero Status collapsed to 0px.
    expect(SFC).toMatch(
      /\.game-grid__rail\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*60%\)\s+minmax\(0,\s*1fr\)/s,
    )
    // Both children pinned, so the map being v-if'd out cannot shift the rows.
    expect(SFC).toMatch(/\.rail-map\s*\{[^}]*grid-row:\s*1/s)
    expect(SFC).toMatch(/\.rail-scroll\s*\{[^}]*grid-row:\s*2/s)
    // Clipped, not visible: spilling let the board intercept taps on the action
    // bar, SHOP and the talent picker.
    expect(SFC).toMatch(/\.rail-map\s*\{[^}]*overflow:\s*hidden/s)
    // ...and the board shrinks to fit. The hook must be the class the COMPACT
    // overview renders (AsciiMap.test.ts asserts it exists in the DOM).
    expect(SFC).toMatch(/\.rail-map :deep\(\.map-cell-compact\)\s*\{[^}]*height:\s*clamp\(/s)
  })
})
