import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import {
  makeCycleMessage,
  makeRoster,
  makePlayer,
  makePlayerEndStats,
  makeZone,
  SAMPLE_HEROES,
} from '~~/app/stories/fixtures'
import type { GameState, ZoneRuntimeState } from '~~/shared/types/game'

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
// cycle loop says a great deal through sound, so several tests assert on it.
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

describe('GameScreen overlays', () => {
  describe('death overlay (game_death_overlay oracle)', () => {
    function seedDeadPlayer() {
      const store = useGameStore()
      store.gameId = 'game_test_dead'
      store.playerId = 'p1'
      // Roster where the human is dead with a future respawn cycle (self_dead).
      const roster = makeRoster()
      roster.p1 = makePlayer({
        id: 'p1',
        name: 'you',
        heroId: SAMPLE_HEROES.echo,
        alive: false,
        integ: 0,
        respawnCycle: 270,
      })
      store.updateFromCycle(makeCycleMessage({ cycle: 240, players: roster }))
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
        { cycle: 100, type: 'kill', payload: { victimId: 'p1', killerId: 'e1' } },
        {
          cycle: 240,
          type: 'damage',
          payload: { sourceId: 'ice_coldstore-t1-audit', targetId: 'p1', amount: 110 },
        },
        { cycle: 240, type: 'death', payload: { playerId: 'p1', respawnCycle: 270 } },
      ] as never)

      const overlay = mountGameScreen().find('[data-testid="death-overlay"]')
      expect(overlay.text()).toContain('ice (coldstore-t1-audit)')
      // ...and NOT the stale killer from the death 140 ticks ago.
      expect(overlay.text()).not.toContain('Daemon')
    })

    it('still prefers real kill credit over the last thing that hit you', () => {
      // A hero kill must not be relabelled as "a wave" just because a wave got
      // the last chip in before the killing blow.
      const store = seedDeadPlayer()
      store.addEvents([
        {
          cycle: 240,
          type: 'damage',
          payload: { sourceId: 'creep_r_1', targetId: 'p1', amount: 20 },
        },
        { cycle: 240, type: 'kill', payload: { victimId: 'p1', killerId: 'e1' } },
        { cycle: 240, type: 'death', payload: { playerId: 'p1', respawnCycle: 270 } },
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

    it('shows the respawn countdown computed from respawnCycle - tick', () => {
      seedDeadPlayer()
      const wrapper = mountGameScreen()

      const overlay = wrapper.find('[data-testid="death-overlay"]')
      expect(overlay.text()).toContain('Respawning in')
      // respawnCycle 270 - cycle 240 = 30 ticks = 120s, shown as wall time.
      expect(overlay.text()).toContain('2:00')
      expect(overlay.text()).not.toContain('30 ticks')
      wrapper.unmount()
    })

    it('shows a sub-minute respawn as cycles AND seconds', () => {
      // The common case: most respawns are well under a minute, where "0:12"
      // reads worse than the cycle count plus the seconds it actually costs.
      const store = useGameStore()
      store.gameId = 'game_test_dead'
      store.playerId = 'p1'
      const roster = makeRoster()
      roster.p1 = makePlayer({
        id: 'p1',
        name: 'you',
        heroId: SAMPLE_HEROES.echo,
        alive: false,
        integ: 0,
        respawnCycle: 252,
      })
      store.updateFromCycle(makeCycleMessage({ cycle: 240, players: roster }))
      const wrapper = mountGameScreen()

      // 12 cycles left → 48 seconds.
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
        integ: 0,
        respawnCycle: 270,
        buybackCooldown: 330, // 90 ticks out = 6 minutes
      })
      store.updateFromCycle(makeCycleMessage({ cycle: 240, players: roster }))
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

      // attempted, reported failure → buffered for next-cycle retry, not lost
      expect(socketSpies.send).toHaveBeenCalled()
      expect(store.bufferedCommand).toBe('surrender confirm')
      wrapper.unmount()
    })

    // ── W2-10: death is not a blackout ────────────────────────────────
    // Respawn runs up to 108 seconds. The overlay used to be a full-bleed scrim
    // that also swallowed every click, so the TRACE, stream, deck and scoreboard
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
      store.updateFromCycle(makeCycleMessage())
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
  describe('effect cues (W2-1)', () => {
    /** Feed the store a batch the way a cycle_state would, then let watchers run. */
    async function emit(
      wrapper: ReturnType<typeof mountGameScreen>,
      events: Array<{ cycle: number; type: string; payload: Record<string, unknown> }>,
    ) {
      useGameStore().addEvents(events as never)
      await wrapper.vm.$nextTick()
    }

    it('pays the farming loop a scrip cue and an amber +Ng float', async () => {
      // REGRESSION: the scrip cue hung off `scrip_change`, whose only emitter is a
      // win sentinel carrying an empty playerId — so last-hitting, the core
      // economic loop of the whole match, was completely silent.
      seedActiveGame()
      const wrapper = mountGameScreen()

      await emit(wrapper, [
        {
          cycle: 240,
          type: 'wave_strip',
          payload: { playerId: 'p1', waveId: 'c1', waveType: 'line', scripAwarded: 41 },
        },
      ])

      expect(audio.playSound).toHaveBeenCalledWith('scrip')
      const float = wrapper.find('[data-testid="damage-float-scrip"]')
      expect(float.exists()).toBe(true)
      expect(float.text()).toBe('+41sc')
      wrapper.unmount()
    })

    it('pays a burn and a silt camp the same cue', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      await emit(wrapper, [
        {
          cycle: 240,
          type: 'wave_burn',
          payload: { playerId: 'p1', waveId: 'c2', waveType: 'sweep', scripAwarded: 12 },
        },
        {
          cycle: 240,
          type: 'neutral_killed',
          payload: { playerId: 'p1', neutralId: 'n0', neutralType: 'stub', zone: 'silt-chaff' },
        },
      ])

      expect(audio.playSound.mock.calls.filter(([n]) => n === 'scrip')).toHaveLength(2)
      // The camp's bounty isn't on the wire, so only the burn floats a number.
      expect(wrapper.findAll('[data-testid="damage-float-scrip"]')).toHaveLength(1)
      wrapper.unmount()
    })

    it('stays silent when the scrip is somebody else’s', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      await emit(wrapper, [
        {
          cycle: 240,
          type: 'wave_strip',
          payload: { playerId: 'p2', waveId: 'c1', waveType: 'line', scripAwarded: 41 },
        },
      ])

      expect(audio.playSound).not.toHaveBeenCalledWith('scrip')
      expect(wrapper.find('[data-testid="damage-float-scrip"]').exists()).toBe(false)
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
          cycle: 240,
          type: 'ice_kill',
          payload: { zone: 'coldstore-t1-chaff', team: 'chaff', killerTeam: 'audit' },
        },
      ])
      expect(audio.playSound).toHaveBeenCalledWith('ice_lost')
      expect(audio.playSound).not.toHaveBeenCalledWith('ice_fall')
      expect(store.announcements.at(-1)).toContain('Ice lost')

      audio.playSound.mockClear()
      await emit(wrapper, [
        {
          cycle: 241,
          type: 'ice_kill',
          payload: { zone: 'coldstore-t1-audit', team: 'audit', killerTeam: 'chaff' },
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
          cycle: 240,
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
      dead.p1 = { ...dead.p1!, alive: false, integ: 0, respawnCycle: 250 }
      store.updateFromCycle(makeCycleMessage({ cycle: 240, players: dead }))
      await wrapper.vm.$nextTick()
      audio.playSound.mockClear()

      store.updateFromCycle(makeCycleMessage({ cycle: 250 }))
      await wrapper.vm.$nextTick()

      expect(audio.playSound).toHaveBeenCalledWith('respawn')
      expect(wrapper.find('[data-testid="respawn-vignette"]').exists()).toBe(true)
      const feed = (
        wrapper.findComponent({ name: 'Stream' }).props('events') as { text: string }[]
      ).map((e) => e.text)
      expect(feed.some((t) => t.includes('PROCESS RESTORED'))).toBe(true)
      wrapper.unmount()
    })

    it('does not mistake the first cycle of a match for a respawn', async () => {
      // The store reports "not alive" until a player exists, so an ungated
      // rising edge fires the respawn cue on every single game load.
      const store = useGameStore()
      store.gameId = 'game_fresh'
      store.playerId = 'p1'
      const wrapper = mountGameScreen()

      store.updateFromCycle(makeCycleMessage())
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
      for (const id of ['coldstore-cross', 'coldstore-t1-chaff']) zones[id] = makeZone(id)
      store.updateFromCycle(makeCycleMessage({ cycle: 240, zones }))
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'move coldstore-t1-chaff')
      await wrapper.vm.$nextTick()

      expect(socketSpies.send).toHaveBeenCalled()
      expect(audio.playSound).toHaveBeenCalledWith('submit')
      wrapper.unmount()
    })

    it('keeps the meatier cast whoosh for offensive orders', async () => {
      seedActiveGame({ players: rosterAt('hollow') })
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'attack tenant')
      await wrapper.vm.$nextTick()

      expect(audio.playSound).toHaveBeenCalledWith('cast')
      expect(audio.playSound).not.toHaveBeenCalledWith('submit')
      wrapper.unmount()
    })
  })
})
