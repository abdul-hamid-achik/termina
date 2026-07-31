import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import { makeCycleMessage, makeRoster, makeZone } from '~~/app/stories/fixtures'
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
  resizeCb = null
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

describe('GameScreen commands', () => {
  /**
   * R3-09 — prompt-primary on desktop. The real CommandInput refocuses after
   * its own submit; GameScreen reclaims the prompt after the last overlay
   * closes, gated on (pointer: fine).
   */

  async function order(wrapper: ReturnType<typeof mountGameScreen>, cmd: string) {
    // The zone panel is gone (R3-08): orders go through ActionRow / command input,
    // the same path a typed command takes.
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', cmd)
    await wrapper.vm.$nextTick()
  }

  /** The narrative lines the Stream is handed (engine + local events). */
  function feed(wrapper: ReturnType<typeof mountGameScreen>): string[] {
    const events = wrapper.findComponent({ name: 'Stream' }).props('events') as Array<{
      text: string
    }>
    return events.map((e) => e.text)
  }

  describe('prompt-primary (R3-09)', () => {
    it('holds focus on the command input after a command submit', async () => {
      // Real CommandInput (not the focus stub) so post-submit refocus is live.
      seedActiveGame()
      const wrapper = mount(GameScreen, {
        attachTo: document.body,
        global: { stubs: { ...stubs, CommandInput: false } },
      })
      const input = wrapper.find('[data-testid="command-input"] input')
      expect(input.exists()).toBe(true)
      ;(input.element as HTMLInputElement).focus()

      await input.setValue('status')
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(document.activeElement).toBe(input.element)
      expect(socketSpies.send).not.toHaveBeenCalled() // local readout
      wrapper.unmount()
    })

    it('reclaims the prompt when the shop overlay closes (fine pointer)', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()
      commandInputFocus.mockClear()

      const shopBtn = wrapper.findAll('.hud-action-btn').find((b) => b.text() === 'SHOP')
      await shopBtn!.trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[role="dialog"][aria-label="Item shop"]').exists()).toBe(true)
      commandInputFocus.mockClear()

      // Close via the same toggle.
      await shopBtn!.trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[role="dialog"][aria-label="Item shop"]').exists()).toBe(false)
      expect(commandInputFocus).toHaveBeenCalled()
      wrapper.unmount()
    })

    it('does not reclaim the prompt on a coarse pointer (soft keyboard)', async () => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query.includes('pointer: coarse'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      )
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })

      seedActiveGame()
      const wrapper = mountGameScreen()
      const shopBtn = wrapper.findAll('.hud-action-btn').find((b) => b.text() === 'SHOP')
      await shopBtn!.trigger('click')
      await wrapper.vm.$nextTick()
      commandInputFocus.mockClear()

      await shopBtn!.trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(commandInputFocus).not.toHaveBeenCalled()
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

      store.updateFromCycle(makeCycleMessage({ cycle: 10 })) // before SURRENDER_MIN_CYCLE (225)
      const early = mountGameScreen()
      expect(early.find('[data-testid="situational-surrender"]').exists()).toBe(false)
      early.unmount()

      store.updateFromCycle(makeCycleMessage({ cycle: 240 })) // past the gate
      const late = mountGameScreen()
      expect(late.find('[data-testid="situational-surrender"]').exists()).toBe(true)
      late.unmount()
    })
  })
  describe('jungle + Tenant targeting (W1-2)', () => {
    // `attack neutral:<i>` resolves against the WHOLE neutrals array server-side
    // (it reaches the client unfiltered), unlike the zone-local wave index. With
    // the zone panel gone (R3-08), targeting goes through the command path: the
    // client pre-flight refuses an out-of-zone camp, the server is the backstop.
    it('sends attack tenant through the command path from the pit', async () => {
      seedActiveGame({ players: rosterAt('hollow') })
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      await order(wrapper, 'attack tenant')
      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'attack', target: { kind: 'tenant' } },
      })
      wrapper.unmount()
    })

    it('refuses attack neutral:<i> that names a camp outside the zone before it costs a tick', async () => {
      seedActiveGame({
        neutrals: [
          {
            id: 'n0',
            zone: 'silt-audit-top',
            integ: 200,
            maxInteg: 200,
            type: 'stub',
            alive: true,
          },
          { id: 'n1', zone: 'mid-river', integ: 140, maxInteg: 200, type: 'warden', alive: true },
        ],
      })
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      await order(wrapper, 'attack neutral:0')
      expect(socketSpies.send).not.toHaveBeenCalled()

      await order(wrapper, 'attack neutral:1')
      expect(socketSpies.send).toHaveBeenCalledWith({
        type: 'action',
        command: { type: 'attack', target: { kind: 'neutral', index: 1 } },
      })
      wrapper.unmount()
    })

    it('withholds attack tenant while he is dead, even standing in the pit', async () => {
      seedActiveGame({
        players: rosterAt('hollow'),
        tenant: { alive: false, integ: 0, maxInteg: 5000, deathCycle: 200 },
      })
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      await order(wrapper, 'attack tenant')
      expect(socketSpies.send).not.toHaveBeenCalled()
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

    /** Seed a cycle with the human standing in `zone`, optionally still walking. */
    function seedWalkTick(
      zone: string,
      cycle: number,
      extra: Partial<PlayerState> = {},
    ): ReturnType<typeof useGameStore> {
      const store = useGameStore()
      store.gameId = 'game_walk'
      store.playerId = 'p1'
      const players = makeRoster()
      players.p1 = { ...players.p1!, zone, moveTarget: null, ...extra }
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const id of CORRIDOR) zones[id] = makeZone(id)
      store.updateFromCycle(makeCycleMessage({ cycle, players, zones }))
      return store
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
      seedWalkTick('mid-river', 241, { alive: false, integ: 0, respawnCycle: 250 })
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
      store.updateFromCycle(makeCycleMessage({ cycle: 240, players, zones }))
      return store
    }

    /** A real key press on the page, the way the window listener receives one. */
    function press(key: string) {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    }

    function lines(wrapper: ReturnType<typeof mountGameScreen>): string[] {
      const events = wrapper.findComponent({ name: 'Stream' }).props('events') as Array<{
        text: string
      }>
      return events.map((e) => e.text)
    }

    it('walks the lane forward, resolving the arrow against the 1D trace', async () => {
      // The 1D model: ArrowUp is one hop FORWARD along your route (toward the
      // enemy base), ArrowDown one hop back. No substring parsing — a Chaff
      // hero at mid-t3 (hop 0) walks to mid-t2 on ArrowUp.
      seedAt('mid-t3-chaff')
      const wrapper = mountGameScreen()

      socketSpies.send.mockClear()
      press('ArrowUp')
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

      const shop = wrapper.findAll('.hud-action-btn').find((b) => b.text() === 'SHOP')
      expect(shop?.attributes('title')).toContain('Esc then S')
      wrapper.unmount()
    })
  })
  describe('rejection feedback (W2-3)', () => {
    it('toasts a client-side rejection instead of burying it in grey [SYS]', () => {
      // Rejections shared one look with chat, pings and readouts, so the one
      // line the player MUST read was the easiest to scroll past.
      const store = seedActiveGame() // in mid-river, no shop
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'buy scrap_lot')

      expect(store.announcements.at(-1)).toContain('shop zone')
      expect(store.lastAnnouncementLevel).toBe('warning')
      expect(socketSpies.send).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('toasts an unparseable command too', () => {
      const store = seedActiveGame()
      const wrapper = mountGameScreen()

      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'flibbertigibbet')

      expect(store.announcements.at(-1)).toContain('Unknown command')
      wrapper.unmount()
    })

    it('leaves genuine meta-chatter silent', () => {
      const store = seedActiveGame()
      const wrapper = mountGameScreen()
      const before = store.announcements.length

      wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'status')

      expect(store.announcements).toHaveLength(before)
      wrapper.unmount()
    })
  })
  describe('effects that used to hurt (W2-6)', () => {
    async function hit(wrapper: ReturnType<typeof mountGameScreen>, cycle: number, amount: number) {
      useGameStore().addEvents([
        { cycle, type: 'damage', payload: { sourceId: 'e1', targetId: 'p1', amount } },
      ] as never)
      await wrapper.vm.$nextTick()
    }

    it('flashes the hero panel in team red, scaled by how hard the hit landed', async () => {
      // REGRESSION: a 30% WHITE wash — the brightest thing that ever appears on
      // a near-black palette — fired on the most frequent event in the game.
      seedActiveGame() // fixture maxInteg 620
      const wrapper = mountGameScreen()
      const flash = () => wrapper.find('[data-testid="hero-hit-flash"]')
      expect(flash().classes()).toContain('anim-flash-damage')
      expect(flash().classes()).not.toContain('anim-flash')

      await hit(wrapper, 240, 31) // 5% of max INTEG → floored
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
        { cycle: 240, type: 'death', payload: { playerId: 'p1', respawnCycle: 270 } },
      ] as never)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="impact-overlay"]').element).not.toBe(first)
      wrapper.unmount()
    })

    it('rises damage taken and damage dealt in separate lanes', async () => {
      seedActiveGame()
      const wrapper = mountGameScreen()

      useGameStore().addEvents([
        { cycle: 240, type: 'damage', payload: { sourceId: 'e1', targetId: 'p1', amount: 90 } },
        { cycle: 240, type: 'damage', payload: { sourceId: 'p1', targetId: 'e1', amount: 70 } },
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
      // which lands squarely on the focus banner and the cycle/gold/KDA row.
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
