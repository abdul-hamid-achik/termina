/**
 * Playtest 2026-10 (live preview): the GameScreen-level behaviour fixes — the
 * threat verdict, NPC-hit feedback, notices vs rejections in the stream, and
 * the look overlay. Harness copied from GameScreenCommands.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import { makeCycleMessage, makeRoster, makeZone } from '~~/app/stories/fixtures'
import type { GameState } from '~~/shared/types/game'
import { TUTORIAL_FLOW } from '~~/shared/constants/tutorial'

// ── useGameTransport mock ────────────────────────────────────────────
// GameScreen calls useGameTransport() at setup (the WS/Ably picker) and
// opens a real connection in onMounted. Replace it with a no-op double
// exposing the same shape (reactive connection refs + connect/send/
// disconnect/onMessage) so mounting never touches the network. We capture
// the spies so tests can assert wiring.
const messageHandlers: Array<(msg: unknown) => void> = []
const socketSpies = {
  connect: vi.fn(),
  // send() returns true when the message went out (socket open) — the happy
  // path for most tests; the disconnected case overrides it to false.
  send: vi.fn(() => true),
  disconnect: vi.fn(),
  // Captured so a test can play the server's side of the channel.
  onMessage: vi.fn((h: (msg: unknown) => void) => {
    messageHandlers.push(h)
    return () => {}
  }),
}
const socketRefs = {
  connected: ref(true),
  reconnecting: ref(false),
  connectionLost: ref(false),
  latency: ref(20),
}
vi.mock('~/composables/useGameTransport', () => ({
  useGameTransport: () => ({ ...socketRefs, ...socketSpies }),
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
const audio = vi.hoisted(() => ({
  playSound: vi.fn(),
  startBed: vi.fn(),
  stopBed: vi.fn(),
  syncBed: vi.fn(),
}))
vi.mock('~/composables/useAudio', () => ({ useAudio: () => audio }))

// R3-09 — CommandInput is stubbed (no real input focus), but GameScreen still
// holds a ref and calls `.focus()` after overlays close. Capture those calls.
const commandInputFocus = vi.hoisted(() => vi.fn())

// GameScreen measures the HUD bar to anchor the kill-feed / toast lanes;
// happy-dom ships no ResizeObserver, so capture the callback and drive it.
type ResizeCb = (entries: Array<{ contentRect: { height: number } }>) => void
// GameScreen builds MORE than one observer (the HUD bar, and the stream body
// the overlay lanes hang off). A single `resizeCb` slot silently kept whichever
// was constructed last, so driving "the" observer stopped driving the bar.
const resizeCbs: ResizeCb[] = []
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(cb: ResizeCb) {
      resizeCbs.push(cb)
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
    props: [
      'winner',
      'stats',
      'players',
      'currentPlayerId',
      'gameId',
      'durationCycles',
      'skippedDrills',
    ],
    template: '<div data-testid="post-game-stub">post-game</div>',
  },
  GameStateBar: true,
  // StatusLines replaced the panel chrome (R3-08); surface its status texts so
  // the header assertions still hold under shallow stubbing.
  StatusLines: {
    name: 'StatusLines',
    props: ['trace', 'orderCommitted', 'nextCommitAt', 'cycle', 'netLead', 'alive', 'verdict'],
    template:
      "<div data-testid=\"theater-header\">{{ !alive ? 'DOWN' : orderCommitted ? 'RESOLVING' : 'AWAITING ORDERS' }}</div>",
  },
  Stream: {
    name: 'Stream',
    props: ['events'],
    template: '<div data-testid="stream" />',
  },
  ScanOverlay: {
    name: 'ScanOverlay',
    props: ['mode', 'zoneName', 'readout', 'moves', 'attacks', 'trace'],
    template: '<div data-testid="scan-overlay">{{ mode }}</div>',
  },
  TutorialHint: true,
  KillFeed: true,
  Deck: {
    name: 'Deck',
    props: ['hero', 'heroId', 'castsLocked', 'compact', 'slots'],
    template: '<div data-testid="deck-stub" />',
  },
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
  messageHandlers.length = 0
  audio.playSound.mockClear()
  commandInputFocus.mockClear()
  resizeCbs.length = 0
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

afterEach(() => {
  document.body.innerHTML = ''
})

/** The narrative lines the Stream is handed (engine + local events). */
function feed(wrapper: ReturnType<typeof mountGameScreen>): string[] {
  const events = wrapper.findComponent({ name: 'Stream' }).props('events') as Array<{
    text: string
  }>
  return events.map((e) => e.text)
}

/** A 3v2 in coldstore-cross: p1 + p2 + p3 against e1 + e2. */
function threeVsTwo(me: { integ: number; maxInteg?: number; alive?: boolean }) {
  const players = makeRoster()
  for (const id of ['p2', 'p3', 'e1', 'e2']) {
    players[id] = { ...players[id]!, zone: 'coldstore-cross', alive: true, integ: 500 }
  }
  players.p1 = { ...players.p1!, zone: 'coldstore-cross', maxInteg: 550, alive: true, ...me }
  return players
}

describe('threat verdict (playtest 28.png / 29.png)', () => {
  it('does not call a 24%-INTEG hero under two enemies FAVORED', async () => {
    const store = seedActiveGame({ players: threeVsTwo({ integ: 500 }) })
    const wrapper = mountGameScreen()
    store.updateFromCycle(makeCycleMessage({ players: threeVsTwo({ integ: 134 }) }))
    await wrapper.vm.$nextTick()

    const rig = feed(wrapper).filter((t) => t.includes('INTEG 134/550'))
    expect(rig.length).toBeGreaterThan(0)
    expect(rig.at(-1)).not.toContain('FAVORED')
    expect(rig.at(-1)).toContain('DANGER')
    // The HUD hop line prints the SAME verdict (one source).
    const verdict = wrapper.findComponent({ name: 'StatusLines' }).props('verdict') as {
      label: string
    }
    expect(verdict.label).toBe('DANGER')
    wrapper.unmount()
  })

  it('never reads FAVORED (or counts hostiles) while the hero is dead', async () => {
    const store = seedActiveGame({ players: threeVsTwo({ integ: 500 }) })
    const wrapper = mountGameScreen()
    store.updateFromCycle(makeCycleMessage({ players: threeVsTwo({ integ: 0, alive: false }) }))
    await wrapper.vm.$nextTick()

    const rig = feed(wrapper).filter((t) => t.startsWith('Dead'))
    expect(rig.length).toBeGreaterThan(0)
    expect(rig.at(-1)).not.toContain('FAVORED')
    expect(rig.at(-1)).not.toContain('hostile')
    wrapper.unmount()
  })

  it('reads a burst taken last cycle, not just the bar', async () => {
    const store = seedActiveGame({ players: threeVsTwo({ integ: 400 }) })
    const wrapper = mountGameScreen()
    store.addEvents([
      {
        cycle: store.cycle,
        type: 'damage',
        payload: { sourceId: 'e1', targetId: 'p1', amount: 150 },
      },
    ] as never)
    await wrapper.vm.$nextTick()

    expect(feed(wrapper).at(-1)).toContain('heavy fire')
    wrapper.unmount()
  })
})

describe('wave fire vetoes FAVORED on the rig line (playtest2 32.png)', () => {
  /** p1 alone at the crossing with ONE low enemy hero: a 1v1 p1 "leads". */
  function oneVsOne(integ: number) {
    const players = makeRoster()
    for (const id of Object.keys(players)) {
      if (id !== 'p1') players[id] = { ...players[id]!, zone: 'seawall-cross' }
    }
    players.e1 = { ...players.e1!, zone: 'coldstore-cross', alive: true, integ: 150 }
    players.p1 = { ...players.p1!, zone: 'coldstore-cross', alive: true, integ, maxInteg: 598 }
    return players
  }

  it('"Waves hit You ×4 for 118" at 480/598 reads CONTESTED, not FAVORED', async () => {
    const store = seedActiveGame({ players: oneVsOne(598) })
    const wrapper = mountGameScreen()
    store.updateFromCycle(makeCycleMessage({ players: oneVsOne(480) }))
    const hits = [30, 30, 29, 29].map((amount, i) => ({
      cycle: store.cycle,
      type: 'damage',
      payload: { sourceId: `wave_${i}`, targetId: 'p1', amount, damageType: 'kinetic' },
    }))
    store.addEvents(hits as never)
    await wrapper.vm.$nextTick()

    const rig = feed(wrapper).filter((t) => t.includes('INTEG 480/598'))
    expect(rig.at(-1)).toContain('Waves are chewing you')
    expect(rig.at(-1)).toContain('CONTESTED')
    expect(rig.at(-1)).not.toContain('FAVORED')
    wrapper.unmount()
  })
})

describe('coaching is tagged by mode, one line per tip (playtest2 76/82.png)', () => {
  function contact() {
    const players = makeRoster()
    players.e1 = { ...players.e1!, zone: 'coldstore-cross', alive: true, integ: 500 }
    players.p1 = { ...players.p1!, zone: 'coldstore-cross', alive: true }
    return players
  }
  const coachLines = (lines: string[]) =>
    lines.filter((t) => t.startsWith('[COACH]') || t.startsWith('[TUTORIAL]'))

  it('a normal match prints [COACH] with the command inline — no [TUTORIAL], no try: line', async () => {
    const store = seedActiveGame({ players: contact(), cycle: 30 } as Partial<GameState>)
    const wrapper = mountGameScreen()
    store.updateFromCycle(makeCycleMessage({ players: contact(), cycle: 31 } as Partial<GameState>))
    await wrapper.vm.$nextTick()

    const lines = feed(wrapper)
    expect(coachLines(lines).length).toBeGreaterThan(0)
    expect(coachLines(lines).every((t) => t.startsWith('[COACH]'))).toBe(true)
    expect(lines.some((t) => t.includes('try:'))).toBe(false)
    wrapper.unmount()
  })

  it('a scripted tutorial step prints no coach line at all — the drill notice is the line', async () => {
    const tut = { players: contact(), mode: 'tutorial', tutorialStep: 2 } as Partial<GameState>
    const store = seedActiveGame({ ...tut, cycle: 30 } as Partial<GameState>)
    const wrapper = mountGameScreen()
    store.updateFromCycle(makeCycleMessage({ ...tut, cycle: 31 } as Partial<GameState>))
    await wrapper.vm.$nextTick()

    const lines = feed(wrapper)
    expect(coachLines(lines)).toEqual([])
    expect(lines.some((t) => t.includes('try:'))).toBe(false)
    wrapper.unmount()
  })
})

describe('the prompt learns when the situation changed (playtest2 30.png)', () => {
  it('hands CommandInput a situation key that changes on death / respawn and step', async () => {
    const store = seedActiveGame({ mode: 'tutorial', tutorialStep: 7 } as Partial<GameState>)
    const wrapper = mountGameScreen()
    const key = () => wrapper.get('[data-testid="command-input"]').attributes('situation-key') ?? ''
    const alive = key()
    expect(alive).not.toBe('')
    const dead = makeRoster()
    dead.p1 = { ...dead.p1!, alive: false, integ: 0 }
    store.updateFromCycle(
      makeCycleMessage({ players: dead, mode: 'tutorial', tutorialStep: 7 } as Partial<GameState>),
    )
    await wrapper.vm.$nextTick()
    expect(key()).not.toBe(alive)
    store.updateFromCycle(
      makeCycleMessage({ mode: 'tutorial', tutorialStep: 8 } as Partial<GameState>),
    )
    await wrapper.vm.$nextTick()
    expect(key()).not.toBe(alive)
    wrapper.unmount()
  })
})

describe('a self-buff cast reports what it gave you (playtest2 84.png)', () => {
  it('`cast w socket` as Echo says Phase Shift went up on you', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    store.addEvents([
      {
        cycle: store.cycle,
        type: 'ability_used',
        payload: { playerId: 'p1', abilityId: 'echo-w', targetId: 'e1', cooldown: 12 },
      },
    ] as never)
    await wrapper.vm.$nextTick()
    const line = feed(wrapper).find((t) => t.startsWith('Phase Shift up'))
    expect(line).toContain('dodge the next incoming attack')
    expect(line).toContain('it went on you')
    wrapper.unmount()
  })
})

describe('PostGame gets the match length and the skipped drills (playtest2 #7/#8)', () => {
  it('passes durationCycles and the drills a "Moving on" notice skipped', async () => {
    const store = seedActiveGame({ mode: 'tutorial', tutorialStep: 5 } as Partial<GameState>)
    const wrapper = mountGameScreen()
    const castSkip = TUTORIAL_FLOW.find((s) => s.id === 'cast')!.skipNote
    for (const h of messageHandlers) {
      h({ type: 'announcement', level: 'info', message: `🎓 Moving on — ${castSkip}` })
    }
    store.setGameOver('chaff', {}, undefined, false, 150)
    await wrapper.vm.$nextTick()
    const post = wrapper.findComponent({ name: 'PostGame' })
    expect(post.props('durationCycles')).toBe(150)
    expect(post.props('skippedDrills')).toEqual(['cast'])
    wrapper.unmount()
  })
})

describe('a coaching notice says whose wave:N it means (playtest2 #9)', () => {
  it('tags `attack wave:N` in a server notice with the unit owner', async () => {
    const unit = (id: string, team: 'chaff' | 'audit', integ: number) => ({
      id,
      team,
      zone: 'coldstore-cross',
      integ,
      maxInteg: 400,
      type: 'line' as const,
    })
    seedActiveGame({
      waves: [unit('mine', 'chaff', 300), unit('foe', 'audit', 111)],
    } as Partial<GameState>)
    const wrapper = mountGameScreen()
    for (const h of messageHandlers) {
      h({
        type: 'announcement',
        level: 'info',
        message: '🎓 A unit in your zone is at 111/400 INTEG. Swing now: `attack wave:1`.',
      })
    }
    await wrapper.vm.$nextTick()
    const line = feed(wrapper).find((t) => t.includes('Swing now'))
    expect(line).toContain('`attack wave:1` (enemy guard)')
    wrapper.unmount()
  })
})

describe('a game this session no longer owns (playtest2 #10)', () => {
  it('shows one clear panel with a way out, outranks CONNECTION LOST, and sends nothing', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    store.endSession('You signed in on another tab — this guest practice ended.')
    socketRefs.connectionLost.value = true
    await wrapper.vm.$nextTick()

    const panel = wrapper.get('[data-testid="session-ended-overlay"]')
    expect(panel.text()).toContain('signed in on another tab')
    expect(panel.find('[data-testid="session-ended-practice"]').exists()).toBe(true)
    expect(panel.find('[data-testid="session-ended-lobby"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="connection-lost-overlay"]').exists()).toBe(false)

    socketSpies.send.mockClear()
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'move coldstore-t1-chaff')
    await wrapper.vm.$nextTick()
    expect(socketSpies.send).not.toHaveBeenCalled()
    expect(feed(wrapper).some((t) => t.includes('retry') || t.includes('retype'))).toBe(false)
    socketRefs.connectionLost.value = false
    wrapper.unmount()
  })
})

describe('a game that simply finished is not a "session changed" (review r3 C5)', () => {
  it('a ranked game whose row is gone reads GAME FINISHED with replay + lobby, no practice', async () => {
    const store = seedActiveGame()
    store.mode = 'normal'
    const wrapper = mountGameScreen()
    store.endSession('This game has finished — it is no longer running.', 'finished')
    await wrapper.vm.$nextTick()
    const panel = wrapper.get('[data-testid="session-ended-overlay"]')
    expect(panel.get('[data-testid="session-ended-title"]').text()).toContain('GAME FINISHED')
    expect(panel.text()).not.toContain('SESSION CHANGED')
    expect(panel.find('[data-testid="session-ended-replay"]').exists()).toBe(true)
    expect(panel.find('[data-testid="session-ended-lobby"]').exists()).toBe(true)
    expect(panel.find('[data-testid="session-ended-practice"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('a finished practice offers another practice and no replay (none is recorded)', async () => {
    const store = seedActiveGame()
    store.mode = 'tutorial'
    const wrapper = mountGameScreen()
    store.endSession('This game has finished — it is no longer running.', 'finished')
    await wrapper.vm.$nextTick()
    const panel = wrapper.get('[data-testid="session-ended-overlay"]')
    expect(panel.find('[data-testid="session-ended-replay"]').exists()).toBe(false)
    expect(panel.find('[data-testid="session-ended-practice"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('a real session change keeps its own panel', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    store.endSession('You signed in on another tab — this guest practice ended.', 'changed')
    await wrapper.vm.$nextTick()
    const panel = wrapper.get('[data-testid="session-ended-overlay"]')
    expect(panel.get('[data-testid="session-ended-title"]').text()).toContain('SESSION CHANGED')
    expect(panel.find('[data-testid="session-ended-replay"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('NPC damage fires the hit cue once per cycle (25.png)', () => {
  async function emit(
    wrapper: ReturnType<typeof mountGameScreen>,
    events: Array<{ cycle: number; type: string; payload: Record<string, unknown> }>,
  ) {
    useGameStore().addEvents(events as never)
    await wrapper.vm.$nextTick()
  }
  const hit = (sourceId: string, amount: number, cycle = 19) => ({
    cycle,
    type: 'damage',
    payload: { sourceId, targetId: 'p1', amount, damageType: 'kinetic' },
  })
  const damageCues = () => audio.playSound.mock.calls.filter((c) => c[0] === 'damage').length

  it('sums a wave stack into one sound and one float', async () => {
    seedActiveGame()
    const wrapper = mountGameScreen()
    audio.playSound.mockClear()

    await emit(wrapper, [
      hit('wave_1', 19),
      hit('wave_2', 19),
      hit('wave_3', 19),
      hit('wave_4', 29),
    ])

    expect(damageCues()).toBe(1)
    const floats = wrapper.findAll('[data-testid="damage-float-taken"]')
    expect(floats).toHaveLength(1)
    expect(floats[0]!.text()).toContain('86')
    wrapper.unmount()
  })

  it('does not fire again for a late split of the same cycle', async () => {
    seedActiveGame()
    const wrapper = mountGameScreen()
    audio.playSound.mockClear()
    await emit(wrapper, [hit('wave_1', 19), hit('ice_coldstore-t1-audit', 40)])
    await emit(wrapper, [hit('wave_2', 19)])
    expect(damageCues()).toBe(1)
    wrapper.unmount()
  })

  it('still shows the late split’s damage — the floats add up to the cycle’s total', async () => {
    seedActiveGame()
    const wrapper = mountGameScreen()
    audio.playSound.mockClear()
    await emit(wrapper, [hit('wave_1', 19), hit('ice_coldstore-t1-audit', 40)])
    await emit(wrapper, [hit('wave_2', 23)])
    const floats = wrapper.findAll('[data-testid="damage-float-taken"]')
    expect(floats.map((f) => f.text().replace(/\D/g, ''))).toEqual(['59', '23'])
    expect(damageCues()).toBe(1) // ...without a second strobe of sound
    wrapper.unmount()
  })

  it('keeps hero hits individual', async () => {
    seedActiveGame()
    const wrapper = mountGameScreen()
    audio.playSound.mockClear()
    await emit(wrapper, [hit('e1', 60), hit('e2', 45), hit('wave_1', 19)])
    expect(damageCues()).toBe(3)
    wrapper.unmount()
  })
})

describe('the map look closes on the next thing you do (item 9)', () => {
  async function openMap() {
    seedActiveGame()
    const wrapper = mountGameScreen()
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'map')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(true)
    return wrapper
  }

  it('closes when another command is sent', async () => {
    const wrapper = await openMap()
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'status')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes on Enter', async () => {
    const wrapper = await openMap()
    await wrapper.get('[data-testid="look-overlay"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hands typing back to the prompt instead of swallowing it', async () => {
    const wrapper = await openMap()
    commandInputFocus.mockClear()
    await wrapper.get('[data-testid="look-overlay"]').trigger('keydown', { key: 'm' })
    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(false)
    expect(commandInputFocus).toHaveBeenCalled()
    wrapper.unmount()
  })

  // REAL focus flow (the stubbed CommandInput.focus() above can't see this): the
  // dialog trap remembers the element that was focused when the look opened and,
  // on close, used to hand focus BACK to it a tick after the prompt took it — the
  // typed character was lost and the next keys fired hotkeys.
  it('typing from the look lands in the prompt, not on the button that opened it', async () => {
    // Coarse pointer (tablet + hardware keyboard): the "reclaim the prompt on close"
    // watch is off there, so the key handler's own focus() is the ONLY thing that
    // puts the caret in the prompt — and the trap must not undo it.
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('pointer: coarse'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    seedActiveGame()
    const wrapper = mount(GameScreen, {
      attachTo: document.body,
      global: {
        stubs: {
          ...stubs,
          // Stream's real MAP button: the opener the focus trap will remember.
          Stream: {
            name: 'Stream',
            props: ['events'],
            emits: ['inspect'],
            template:
              '<button data-testid="map-button" @click="$emit(\'inspect\', \'map\')">MAP</button>',
          },
          CommandInput: {
            name: 'CommandInput',
            template: '<input data-testid="real-prompt" />',
            setup(_: unknown, { expose }: { expose: (api: { focus: () => void }) => void }) {
              expose({
                focus: () =>
                  document.querySelector<HTMLInputElement>('[data-testid="real-prompt"]')?.focus(),
              })
              return {}
            },
          },
        },
      },
    })
    const opener = wrapper.get('[data-testid="map-button"]').element as HTMLButtonElement
    opener.focus()
    opener.click()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const look = wrapper.get('[data-testid="look-overlay"]')
    expect(look.element.contains(document.activeElement)).toBe(true)

    await look.trigger('keydown', { key: 'm' })
    socketSpies.send.mockClear()
    for (let i = 0; i < 5; i++) await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="real-prompt"]').element)
    // ...so the NEXT key is typed into the prompt, not read as a hotkey.
    const w = new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(w)
    expect(socketSpies.send).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('closes on a click outside the card', async () => {
    const wrapper = await openMap()
    await wrapper.get('[data-testid="look-overlay"]').trigger('click')
    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('rejections and notices land in the stream once (items 3 + 4)', () => {
  const play = (msg: unknown) => {
    for (const h of messageHandlers) h(msg)
  }
  /** What the channel does: the router stores it (toast), then handlers run. */
  const announce = (store: ReturnType<typeof useGameStore>, message: string, level: string) => {
    store.addAnnouncement(message, level as never)
    play({ type: 'announcement', message, level })
  }
  const toast = (wrapper: ReturnType<typeof mountGameScreen>) =>
    wrapper.findComponent({ name: 'AnnouncementToast' })

  it('marks a server rejection in the stream and still toasts it', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    announce(store, 'No hero named "nobody" in this game', 'warning')
    await wrapper.vm.$nextTick()

    const lines = feed(wrapper).filter((t) => t.includes('nobody'))
    expect(lines).toEqual(['✕ REJECTED — No hero named "nobody" in this game'])
    expect(toast(wrapper).props('text')).toContain('nobody')
    expect(toast(wrapper).props('seq')).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('prints the same rejection once per cycle', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    announce(store, 'Not in a shop zone', 'warning')
    announce(store, 'Not in a shop zone', 'warning')
    await wrapper.vm.$nextTick()
    expect(feed(wrapper).filter((t) => t.includes('Not in a shop zone'))).toHaveLength(1)
    wrapper.unmount()
  })

  it('puts a tutorial notice in the feed once and never toasts it', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    const seqBefore = toast(wrapper).props('seq')
    announce(store, '🎓 On the route. Stay behind your own ICE.', 'info')
    announce(store, '🎓 On the route. Stay behind your own ICE.', 'info')
    await wrapper.vm.$nextTick()

    expect(feed(wrapper).filter((t) => t.includes('On the route'))).toHaveLength(1)
    expect(toast(wrapper).props('seq')).toBe(seqBefore)
    wrapper.unmount()
  })

  it('still toasts a rejection that arrives in the same flush as a notice', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    announce(store, 'Slowed — failed to move', 'warning')
    announce(store, '🎓 Try again next cycle.', 'info')
    await wrapper.vm.$nextTick()
    expect(toast(wrapper).props('text')).toBe('Slowed — failed to move')
    wrapper.unmount()
  })

  it('puts a refused order (action_ack) in the stream, not only a toast', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    store.addAnnouncement(
      '[CYCLE] Order arrived after the batch committed — retype it for cycle 7',
      'warning',
    )
    await wrapper.vm.$nextTick()
    expect(feed(wrapper).some((t) => t.startsWith('✕ REJECTED — [CYCLE] Order arrived'))).toBe(true)
    wrapper.unmount()
  })

  it('puts a refusal from the prompt (blocked Enter) in the stream + toast', async () => {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('reject', 'No zone called "banana"')
    await wrapper.vm.$nextTick()
    expect(feed(wrapper)).toContain('✕ REJECTED — No zone called "banana"')
    expect(store.announcements.at(-1)).toContain('banana')
    wrapper.unmount()
  })
})

describe('Deck slots are the engine truth (item 8)', () => {
  const slotsOf = (wrapper: ReturnType<typeof mountGameScreen>) =>
    wrapper.findComponent({ name: 'Deck' }).props('slots') as Record<
      string,
      { state: string; chip: string; reason: string }
    >

  it('a level-1 ultimate is locked with its unlock level, not READY', async () => {
    const players = makeRoster()
    players.p1 = {
      ...players.p1!,
      level: 1,
      bw: 300,
      maxBw: 300,
      cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    }
    seedActiveGame({ players })
    const wrapper = mountGameScreen()
    await wrapper.vm.$nextTick()
    const slots = slotsOf(wrapper)
    expect(slots.r!.state).toBe('locked')
    expect(slots.r!.chip).toBe('L6')
    expect(slots.q!.chip).toBe('RDY')
    wrapper.unmount()
  })

  it('a tutorial step that has not opened casting names the lock', async () => {
    const players = makeRoster()
    players.p1 = { ...players.p1!, level: 1, cooldowns: { q: 0, w: 0, e: 0, r: 0 } }
    seedActiveGame({ players, mode: 'tutorial', tutorialStep: 0 } as Partial<GameState>)
    const wrapper = mountGameScreen()
    await wrapper.vm.$nextTick()
    const slots = slotsOf(wrapper)
    expect(slots.q!.chip).toBe('LOCK')
    expect(slots.q!.reason).toContain('tutorial')
    wrapper.unmount()
  })
})

describe('natural zone words reach the server as zone ids (item 5)', () => {
  it('sends `move crossing` from a route as that route’s crossing', async () => {
    // The walkable chain must be known zones, or the pre-flight finds no path.
    const zones = Object.fromEntries(
      ['coldstore-t1-chaff', 'coldstore-cross'].map((id) => [id, makeZone(id)]),
    )
    seedActiveGame({ players: rosterAt('coldstore-t1-chaff'), zones })
    const wrapper = mountGameScreen()
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'move crossing')
    await wrapper.vm.$nextTick()
    expect(socketSpies.send).toHaveBeenCalledWith({
      type: 'action',
      command: { type: 'move', zone: 'coldstore-cross' },
    })
    wrapper.unmount()
  })
})

describe('the look overlay never leaks a keystroke to the hotkeys', () => {
  async function openMap() {
    const store = seedActiveGame()
    const wrapper = mountGameScreen()
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'map')
    await wrapper.vm.$nextTick()
    return { store, wrapper }
  }

  it.each(['w', 's', '1'])('pressing %s closes the look and does nothing else', async (key) => {
    const { wrapper } = await openMap()
    socketSpies.send.mockClear()
    commandInputFocus.mockClear()
    await wrapper.get('[data-testid="look-overlay"]').trigger('keydown', { key })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(false)
    expect(socketSpies.send).not.toHaveBeenCalled()
    expect(wrapper.find('[role="dialog"][aria-label="Item shop"]').exists()).toBe(false)
    expect(commandInputFocus).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('a buffered order auto-sent at the cycle does not pull the look away', async () => {
    const { store, wrapper } = await openMap()
    store.bufferCommand('status')
    store.updateFromCycle(makeCycleMessage({ cycle: store.cycle + 1 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="look-overlay"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('every client-side refusal is a marked stream line (item 4)', () => {
  it('marks the bare-attack "no target" refusal and toasts it', async () => {
    const players = makeRoster()
    players.e1 = { ...players.e1!, zone: 'landing-anchor' }
    const store = seedActiveGame({ players })
    const wrapper = mountGameScreen()
    wrapper.findComponent({ name: 'CommandInput' }).vm.$emit('submit', 'attack')
    await wrapper.vm.$nextTick()
    const marked = feed(wrapper).filter((t) => t.startsWith('✕ REJECTED —'))
    expect(marked).toHaveLength(1)
    expect(store.lastAnnouncementLevel).toBe('warning')
    wrapper.unmount()
  })
})
